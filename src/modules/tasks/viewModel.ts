/**
 * D11: presentation helpers for the Tasks screen, kept pure so they are tested without a browser.
 *
 * Nothing here is a task rule. Which tasks a view shows, what is overdue, how a list is sorted and what a filter matches all stay in
 * views.ts; this file only decides how that is laid out: which of the ten views a phone shows as its four main buttons (the other six sit
 * under "More"), how many filters are switched on, and which words a row prints for its due date. `isFiltering` is the exact test the
 * page used before D11 (a filter equal to `NO_FILTER` is "off"), so the desktop chips and the phone sheet, which read and write the one
 * filter state, can never disagree about whether filtering is on.
 */
import { addDays } from '../../lib/dates';
import { PRIORITY_LABEL } from '../../core/priority';
import { NO_FILTER, VIEWS, isOverdue, type Filter, type ViewId } from './views';
import type { TaskRecord } from './model';

/** The four views a phone shows as buttons; every other view in VIEWS is reached from "More". */
export const PHONE_PRIMARY: readonly ViewId[] = ['today', 'upcoming', 'overdue', 'all'];

export const phonePrimaryViews = () => VIEWS.filter((v) => PHONE_PRIMARY.includes(v.id));
/** The views under "More", in the order VIEWS lists them. */
export const phoneMoreViews = () => VIEWS.filter((v) => !PHONE_PRIMARY.includes(v.id));
export const isMoreView = (id: ViewId) => !PHONE_PRIMARY.includes(id);

/** Exactly the page's original test for "a filter is on" (so a filter that merely equals the default is off). */
export const isFiltering = (f: Filter) => JSON.stringify(f) !== JSON.stringify(NO_FILTER);

/** How many of the filters other than the search words are on (the number shown on the phone's Filters button). The search box is visible by itself, so it is not counted. */
export function activeFilterCount(f: Filter): number {
  let n = 0;
  if (f.priority !== '') n++;
  if (f.listId !== '') n++;
  if (f.tagId !== '') n++;
  if (f.contactId !== undefined && f.contactId !== '') n++;
  if (f.projectId !== undefined && f.projectId !== '') n++;
  return n;
}

/** Plain words for each filter that is on ("Priority: High"), so a phone can show them under the search box. Names come from the caller. */
export function describeFilters(f: Filter, names: { lists: { id: number; name: string }[]; tags: { id: number; name: string }[]; projectLabel: (id: number) => string; contact?: string }): string[] {
  const out: string[] = [];
  if (f.priority !== '') out.push(`Priority: ${PRIORITY_LABEL[f.priority]}`);
  if (f.listId === 'none') out.push('List: none');
  else if (f.listId !== '') out.push(`List: ${names.lists.find((l) => l.id === f.listId)?.name ?? 'unknown'}`);
  if (f.tagId !== '') out.push(`Tag: #${names.tags.find((t) => t.id === f.tagId)?.name ?? 'unknown'}`);
  if (f.projectId === 'none') out.push('Project: none');
  else if (f.projectId !== undefined && f.projectId !== '') out.push(`Project: ${names.projectLabel(f.projectId)}`);
  if (f.contactId !== undefined && f.contactId !== '') out.push(`Contact: ${names.contact ?? 'unknown'}`);
  return out;
}

export type DueState = 'done' | 'overdue' | 'today' | 'tomorrow' | 'upcoming' | 'planned' | 'none';

/**
 * Which of the five looks a row's date gets. It restates the row's existing wording (done, overdue, "Due today", "Due <date>", "Do on <date>")
 * and adds nothing: `isOverdue` is the module's own test, "tomorrow" is a calendar fact (the day after `today`), and a task with no date at all is "none".
 */
export function dueState(t: TaskRecord, today: string): DueState {
  const d = t.data;
  if (d.status === 'done') return 'done';
  if (isOverdue(t, today)) return 'overdue';
  if (d.dueDate) return d.dueDate === today ? 'today' : d.dueDate === addDays(today, 1) ? 'tomorrow' : 'upcoming';
  return d.startDate ? 'planned' : 'none';
}

// ---- bulk actions: the value is captured BEFORE the work starts ----
//
// A bulk dropdown resets itself to "" as soon as the choice is made, and the change below runs later (inside a database transaction). Reading the
// dropdown's value from inside that later function therefore saw "" and stored an empty priority, list id 0 or tag id 0 (found in D11; present since the
// bulk bar was built). These helpers take the value as a plain string that the handler read first, check it, and return the label and the change, or
// null (nothing is written and no toast is shown) for a value that is not a real choice.
import { PRIORITIES } from '../../core/priority';
import type { TaskData } from './model';

export interface BulkAction { label: string; change: (d: TaskData) => TaskData }

const realId = (v: string): number | null => { const n = Number(v); return v !== '' && Number.isInteger(n) && n > 0 ? n : null; };

export function bulkPriorityAction(value: string): BulkAction | null {
  const p = PRIORITIES.find((x) => x === value);
  return p ? { label: `Priority ${p}`, change: (d) => ({ ...d, priority: p }) } : null;
}

/** `none` takes the tasks off their list (listId null, the existing "no list" value); otherwise a real list id. */
export function bulkListAction(value: string): BulkAction | null {
  if (value === 'none') return { label: 'List changed', change: (d) => ({ ...d, listId: null }) };
  const id = realId(value);
  return id === null ? null : { label: 'List changed', change: (d) => ({ ...d, listId: id }) };
}

export function bulkTagAction(value: string): BulkAction | null {
  const id = realId(value);
  return id === null ? null : { label: 'Tag added', change: (d) => ({ ...d, tagIds: [...new Set([...d.tagIds, id])] }) };
}
