/**
 * CS-1: the structural exclusions of the display-source adapters (CS-0.1 design F.4a). PURE.
 *
 * An event is NOT display-safe merely because it sits on a shared calendar. Before any other field is read, an event is rejected when it is
 *  - a known Finance-type event (`bill`, `finance`),
 *  - a type this list does not know (CLOSED BY DEFAULT: an unrecognized non-empty type is rejected until the owner-approved list says otherwise),
 *  - retired or handed off to another module,
 *  - on a project, or linked to any record outside the small list of harmless modules (Finance, Bills, Services, Projects, Home & Assets and any
 *    module added later are therefore all excluded),
 *  - on a calendar that is derived or subscribed rather than a local one.
 * This holds even when the calendar is shared and even when the event has its own `show` decision. It is based on stored type, ownership and links;
 * it cannot know that an ordinary untyped event was TITLED with something private. A title is the owner's own words and stays the owner's judgment.
 */

/** Event types that may appear. The empty type is a plain event; `birthday` is a yearly all-day event about a person. */
export const SAFE_EVENT_TYPES: readonly string[] = ['', 'birthday'];
/** Types we recognize as Finance-related (named in the rejection text). Every other non-empty, non-safe type is rejected as unknown. */
export const FINANCE_EVENT_TYPES: readonly string[] = ['bill', 'finance'];
/** Records an event may be linked to without being excluded. */
export const HARMLESS_LINK_MODULES: readonly string[] = ['calendar', 'tasks', 'family', 'contacts'];
/** Records a Task may NOT be linked to (or made from) and still be shown. */
export const BLOCKED_TASK_MODULES: readonly string[] = ['ledger', 'finance', 'bills', 'services'];

export type RejectionCode = 'finance' | 'unknown-type' | 'retired' | 'project' | 'linked' | 'derived-calendar';
export interface Rejection { code: RejectionCode; text: string }

export interface EventFacts {
  type: string | undefined;
  retired: boolean;
  projectId: number | undefined;
  /** The modules at the other end of every live link on this event. */
  linkedModules: readonly string[];
  /** The calendar's source type, or undefined when the calendar record is missing. */
  calendarSource: 'local' | 'derived' | 'subscribed' | undefined;
}

export function eventRejection(f: EventFacts): Rejection | null {
  if (f.retired) return { code: 'retired', text: 'Not eligible: this event was handed over to another part of Ledger.' };
  const type = f.type ?? '';
  if (FINANCE_EVENT_TYPES.includes(type)) return { code: 'finance', text: 'Not eligible: belongs to Finance.' };
  if (!SAFE_EVENT_TYPES.includes(type)) return { code: 'unknown-type', text: 'Not eligible: this kind of event is not on the list of kinds that may be shown.' };
  if (f.calendarSource !== undefined && f.calendarSource !== 'local') return { code: 'derived-calendar', text: 'Not eligible: it is not on one of your own calendars.' };
  if (f.projectId !== undefined) return { code: 'project', text: 'Not eligible: it is part of a project.' };
  if (f.linkedModules.some((m) => !HARMLESS_LINK_MODULES.includes(m))) return { code: 'linked', text: 'Not eligible: it is linked to a bill, service, project, asset or Finance record.' };
  return null;
}

export interface TaskFacts { createdFromModule: string | undefined; linkedModules: readonly string[] }
export function taskRejection(f: TaskFacts): Rejection | null {
  if ((f.createdFromModule && BLOCKED_TASK_MODULES.includes(f.createdFromModule)) || f.linkedModules.some((m) => BLOCKED_TASK_MODULES.includes(m))) {
    return { code: 'linked', text: 'Not eligible: it is tied to a bill, service or Finance record.' };
  }
  return null;
}
