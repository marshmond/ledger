/** Which tasks each view shows, and in what order. Pure, so it is tested without a screen. */
import { addDays } from '../../lib/dates';
import { PRIORITIES, PRIORITY_LABEL } from '../../core/priority';
import type { Priority } from '../../core/entities';
import type { TaskList, TaskRecord } from './model';

export type ViewId = 'today' | 'upcoming' | 'overdue' | 'all' | 'lists' | 'tags' | 'priority' | 'waiting' | 'completed' | 'deleted';
export const VIEWS: { id: ViewId; label: string }[] = [
  { id: 'today', label: 'Today' }, { id: 'upcoming', label: 'Upcoming' }, { id: 'overdue', label: 'Overdue' }, { id: 'all', label: 'All' },
  { id: 'lists', label: 'By list' }, { id: 'tags', label: 'By tag' }, { id: 'priority', label: 'By priority' }, { id: 'waiting', label: 'Waiting' },
  { id: 'completed', label: 'Completed' }, { id: 'deleted', label: 'Deleted' },
];

export type SortKey = 'due' | 'priority' | 'created' | 'title' | 'completed';
export const SORTS: { id: SortKey; label: string }[] = [{ id: 'due', label: 'Due date' }, { id: 'priority', label: 'Priority' }, { id: 'created', label: 'Newest first' }, { id: 'title', label: 'Title' }, { id: 'completed', label: 'Recently completed' }];

export interface Filter {
  text: string;
  priority: Priority | '';
  listId: number | '' | 'none';
  tagId: number | '';
  /** Only tasks involving this contact (set from global search). Optional so existing filters need not mention it. */
  contactId?: number | '';
}
export const NO_FILTER: Filter = { text: '', priority: '', listId: '', tagId: '' };

export interface Group {
  key: string;
  title: string;
  tasks: TaskRecord[];
  /** Highlight (overdue). */
  tone?: 'bad';
}

export const isOpen = (t: TaskRecord) => t.data.status !== 'done';
export const isOverdue = (t: TaskRecord, today: string) => isOpen(t) && !!t.data.dueDate && t.data.dueDate < today;

const PRI: Record<Priority, number> = { high: 0, medium: 1, low: 2, reminder: 3 };
const dueKey = (t: TaskRecord) => (t.data.dueDate ? `${t.data.dueDate} ${t.data.dueTime ?? '99:99'}` : t.data.startDate ? `${t.data.startDate} 99:99` : '9999-99-99');

export function sortTasks(tasks: TaskRecord[], by: SortKey): TaskRecord[] {
  const cmp: Record<SortKey, (a: TaskRecord, b: TaskRecord) => number> = {
    due: (a, b) => dueKey(a).localeCompare(dueKey(b)) || PRI[a.data.priority] - PRI[b.data.priority],
    priority: (a, b) => PRI[a.data.priority] - PRI[b.data.priority] || dueKey(a).localeCompare(dueKey(b)),
    created: (a, b) => b.createdAt - a.createdAt,
    title: (a, b) => a.data.title.localeCompare(b.data.title),
    completed: (a, b) => (b.data.completedAt ?? 0) - (a.data.completedAt ?? 0),
  };
  return [...tasks].sort((a, b) => cmp[by](a, b) || a.data.title.localeCompare(b.data.title) || a.id - b.id);
}

export function matches(t: TaskRecord, f: Filter): boolean {
  const q = f.text.trim().toLowerCase();
  if (q && ![t.data.title, t.data.notes, ...t.data.checklist.map((c) => c.text)].some((s) => s.toLowerCase().includes(q))) return false;
  if (f.priority && t.data.priority !== f.priority) return false;
  if (f.listId === 'none' ? t.data.listId !== null : f.listId !== '' && t.data.listId !== f.listId) return false;
  if (f.tagId !== '' && !t.data.tagIds.includes(f.tagId)) return false;
  if (f.contactId !== undefined && f.contactId !== '' && !t.data.contactIds.includes(f.contactId)) return false;
  return true;
}

export interface ViewContext {
  today: string;
  /** Upcoming: how many days ahead (7, 14 or 30). */
  days: number;
  sort: SortKey;
  filter: Filter;
  lists: TaskList[];
  tags: { id: number; name: string }[];
  /** For the Completed view: how many days back. */
  completedDays?: number;
  now?: number;
}

/** The groups of tasks a view shows. */
export function buildView(view: ViewId, all: TaskRecord[], deleted: TaskRecord[], c: ViewContext): Group[] {
  const src = (view === 'deleted' ? deleted : all).filter((t) => matches(t, c.filter));
  const open = src.filter(isOpen);
  const sorted = (xs: TaskRecord[]) => sortTasks(xs, c.sort);
  const g = (key: string, title: string, tasks: TaskRecord[], tone?: 'bad'): Group[] => (tasks.length ? [{ key, title, tasks: sorted(tasks), tone }] : []);

  switch (view) {
    case 'today': {
      const late = open.filter((t) => isOverdue(t, c.today));
      const due = open.filter((t) => t.data.dueDate === c.today);
      // "Scheduled for today": the do-on date has arrived and it is not due today or earlier
      const planned = open.filter((t) => !!t.data.startDate && t.data.startDate <= c.today && (!t.data.dueDate || t.data.dueDate > c.today));
      return [...g('overdue', 'Overdue', late, 'bad'), ...g('due', 'Due today', due), ...g('planned', 'Scheduled for today', planned)];
    }
    case 'upcoming': {
      const end = addDays(c.today, c.days);
      const dateOf = (t: TaskRecord) => t.data.dueDate ?? t.data.startDate;
      const inRange = open.filter((t) => { const d = dateOf(t); return !!d && d > c.today && d <= end; });
      // Sorted by anything other than date: one list, so the choice applies across days too.
      if (c.sort !== 'due') return g('range', `Next ${c.days} days`, inRange);
      const days = [...new Set(inRange.map((t) => dateOf(t)!))].sort();
      return days.map((d) => ({ key: d, title: d, tasks: sorted(inRange.filter((t) => dateOf(t) === d)) }));
    }
    case 'overdue': return g('overdue', 'Overdue', open.filter((t) => isOverdue(t, c.today)), 'bad');
    case 'all': return g('all', 'All open tasks', open);
    case 'lists': {
      const out: Group[] = c.lists.flatMap((l) => g(`l${l.id}`, l.name, open.filter((t) => t.data.listId === l.id)));
      const known = new Set(c.lists.map((l) => l.id));
      return [...out, ...g('none', 'No list', open.filter((t) => t.data.listId === null || !known.has(t.data.listId)))];
    }
    case 'tags': {
      const out: Group[] = [...c.tags].sort((a, b) => a.name.localeCompare(b.name)).flatMap((t) => g(`t${t.id}`, `#${t.name}`, open.filter((x) => x.data.tagIds.includes(t.id))));
      return [...out, ...g('none', 'No tag', open.filter((t) => t.data.tagIds.length === 0))];
    }
    case 'priority': return PRIORITIES.flatMap((p) => g(p, PRIORITY_LABEL[p], open.filter((t) => t.data.priority === p)));
    case 'waiting': return g('waiting', 'Waiting on someone or something', open.filter((t) => t.data.status === 'waiting'));
    case 'completed': {
      const since = (c.now ?? Date.now()) - (c.completedDays ?? 30) * 86_400_000;
      const done = src.filter((t) => t.data.status === 'done' && (t.data.completedAt ?? 0) >= since);
      return done.length ? [{ key: 'done', title: `Completed in the last ${c.completedDays ?? 30} days`, tasks: sorted(done) }] : [];
    }
    case 'deleted': return src.length ? [{ key: 'deleted', title: 'Deleted (restore to bring one back)', tasks: sortTasks(src, 'created') }] : [];
  }
}

/** Counts for the tab badges. */
export function counts(all: TaskRecord[], today: string) {
  const open = all.filter(isOpen);
  return {
    today: buildView('today', all, [], { today, days: 7, sort: 'due', filter: NO_FILTER, lists: [], tags: [] }).reduce((n, g) => n + g.tasks.length, 0),
    overdue: open.filter((t) => isOverdue(t, today)).length,
    waiting: open.filter((t) => t.data.status === 'waiting').length,
  };
}
