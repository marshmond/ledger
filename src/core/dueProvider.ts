/**
 * The due-provider contract. A module that owns dated things (Ledger's scheduled bills, Tasks' due dates, ...) registers ONE provider.
 * The Calendar asks every provider "what falls in this date range?" each time it draws. Providers are READ-ONLY and PURE:
 * they work the answer out from the module's own records and store nothing, so there is never a second copy to go stale
 * or to double up when two devices sync. See docs/due-provider.md.
 */
import type { DueItemInput, Priority, RecordId } from './entities';

/** Everything a provider needs to know about the request. All dates are local calendar dates, 'YYYY-MM-DD'. */
export interface DueQuery {
  from: string;
  to: string;
  /** Today on the device asking (so providers and the Calendar agree on what "past due" means). */
  today: string;
  /**
   * Also return OPEN items dated in the `overdueDays` days before `today`, even when they fall before `from`.
   * 0 = only what is inside from..to. (The Agenda's "Overdue" section asks for these.)
   */
  overdueDays: number;
}

/**
 * One derived item. Built on the `DueItem` shape (title, date, time, allDay, priority, source) but never stored: it only exists
 * while the Calendar is drawing.
 */
export interface DerivedItem extends Pick<DueItemInput, 'sourceModule' | 'sourceRecordId' | 'title' | 'date' | 'time' | 'allDay' | 'priority'> {
  /** Stable across redraws and devices: `module:recordId:date`. */
  id: string;
  /** `open` = still needs attention. `handled` = done/posted/skipped (providers normally just leave those out). */
  status: 'open' | 'handled';
  /** One extra line of explanation, shown in the item's detail. */
  detail?: string;
  /** Last day, for items that span several days. Omit for one-day items. */
  endDate?: string;
  /** Shows the item in its own module (e.g. the Scheduled page). Navigation only: never changes data. */
  openSource(): void;
  /** Text for the "go to the source" button, e.g. "Edit in Ledger". */
  sourceLabel?: string;
  /**
   * Optional write-through for modules whose items are normal editable records (Tasks). Leave out for read-only sources
   * such as Ledger: the Calendar then shows only `openSource`.
   */
  actions?: {
    complete?(): Promise<void>;
    reopen?(): Promise<void>;
    reschedule?(date: string): Promise<void>;
  };
  /** The project this item belongs to, when it comes from a project-linked record (a task, a milestone, a project date). */
  projectId?: number;
  /** Calendar-file (.ics) export: the event id to use, so a phone calendar that already has the event does not get a duplicate. */
  icsUid?: string;
  /** Calendar-file export: add an alarm this many minutes before the event. */
  icsAlarmMinutes?: number;
}

export interface DueProvider {
  /** Permanent id, e.g. 'ledger'. Also links a derived calendar layer to its provider. */
  id: string;
  /** Name of the calendar layer these items appear on, e.g. 'Finance'. */
  layerName: string;
  /** Default layer colour (the user can recolour the layer). */
  color: string;
  /**
   * Items in `q.from..q.to`, plus open overdue ones as described on `DueQuery.overdueDays`. Must be fast for a month-sized range,
   * must not write anything, and may be called often (it is re-run when the module's data changes).
   */
  getDueItems(q: DueQuery): Promise<DerivedItem[]> | DerivedItem[];
  /**
   * Optional. How many OPEN items are dated before `cutoff` (older than the Today screen's overdue window), and where to see them in
   * the module's own view. Today shows this as "N older items". Read-only, like `getDueItems`.
   */
  olderThan?(cutoff: string, today: string): Promise<{ count: number; path: string } | null> | { count: number; path: string } | null;
}

const providers: DueProvider[] = [];

/** Modules normally register through `contributes.dueProvider` in their ModuleDef. A future feed adapter (a subscribed .ics URL) is just another provider. */
export function registerDueProvider(p: DueProvider) {
  if (providers.some((x) => x.id === p.id)) throw new Error(`Due provider "${p.id}" is registered twice.`);
  providers.push(p);
}
export const allDueProviders = (): readonly DueProvider[] => providers;
export const getDueProvider = (id: string | null | undefined) => providers.find((p) => p.id === id);

/** Asks the given providers (default: all) in parallel. One provider failing never hides the others. */
export async function queryProviders(q: DueQuery, only: readonly DueProvider[] = providers): Promise<Record<string, DerivedItem[]>> {
  const out: Record<string, DerivedItem[]> = {};
  await Promise.all(only.map(async (p) => {
    try {
      const rows = await p.getDueItems(q);
      out[p.id] = rows.filter((r) => (r.date >= q.from && r.date <= q.to) || (r.status === 'open' && r.date < q.today && q.overdueDays > 0));
    } catch {
      out[p.id] = [];
    }
  }));
  return out;
}

/** Builds the stable item id for a provider's item. */
export const derivedId = (module: string, recordId: RecordId, date: string) => `${module}:${recordId}:${date}`;

/** Takes the user to a page by its full address, e.g. `/ledger/scheduled`. Used by `openSource`. */
export function goTo(path: string) {
  if (typeof window !== 'undefined') window.location.hash = `#${path}`;
}

export type { Priority };
