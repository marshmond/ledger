/**
 * ESTIMATES of what upcoming visits may cost (S3-B7). Pure. Always labelled "Estimates"; never added to what was paid, never spending.
 *
 * Only a per-visit estimate on a schedule the app can project exactly is turned into a figure: the cadence's own dates in the window, counted from
 * the open visit Task (visits before it were already dealt with) and never before today, times the estimate. A per-month, per-season, per-year or
 * quoted amount is NOT multiplied by visits and NOT prorated (there is no approved rule for part months or seasons), so it is listed as "not
 * converted" with the reason. An on-demand arrangement, a paused or ended one, or a cadence with no dates in the window gives no figure.
 * A schedule "after each visit" can only be projected as far as the one open visit, because later dates depend on when each is done.
 */
import { addDays } from '../../lib/dates';
import type { TaskRecord } from '../tasks/model';
import { BASIS_LABEL, cadenceBetween, type ArrangementRecord } from './model';
import { markersOf } from './schedule';

export interface ExpectedItem { arrangementId: number; title: string; visits: number; /** The projected visit dates, in order. */ dates: string[]; centsEach: number; cents: number; partial: boolean }
export interface NotConverted { arrangementId: number; title: string; reason: string }
export interface ExpectedWindow {
  days: number;
  /** Sum of the per-visit estimates that could be projected, whole cents. */
  estimateCents: number;
  items: ExpectedItem[];
  notConverted: NotConverted[];
}

/** What the arrangement's visit Tasks say about where the schedule stands. Pure; read from the Tasks, never written. */
export interface ScheduleState {
  /** The open visit Task's due date (where the next visit really is, even if it was moved), or null. */
  openDue: string | null;
  /** The cadence date the open Task stands for (its "occurrence" marker), or its due date when it has none. */
  openOccurrence: string | null;
  /** The latest cadence date a FINISHED visit Task stood for (logged or not yet logged). Nothing at or before it is upcoming. */
  lastDoneOccurrence: string | null;
}
export function scheduleStateOf(visitTasks: TaskRecord[]): ScheduleState {
  const open = visitTasks.filter((t) => t.data.status !== 'done').sort((a, b) => (a.data.dueDate ?? '9999').localeCompare(b.data.dueDate ?? '9999') || a.id - b.id)[0];
  const done = visitTasks.filter((t) => t.data.status === 'done').map((t) => markersOf(t).occurrence ?? t.data.dueDate).filter((x): x is string => !!x).sort();
  return { openDue: open?.data.dueDate ?? null, openOccurrence: open ? markersOf(open).occurrence ?? open.data.dueDate : null, lastDoneOccurrence: done.length ? done[done.length - 1] : null };
}

/**
 * The window is [today, today + days], both included. Per-visit projection, anchored to the standing arrangement exactly like the real scheduler:
 *  - the open Task is THE next visit, on the date it really has (so a visit moved to another day is counted once, on that day, and is not lost);
 *  - later visits are the cadence's own dates AFTER both that visit's date and the date it stood for (what `nextAfterVisit` does when it is logged),
 *    never before today, so a one-time move never shifts them and a visit moved past the next usual date passes over it;
 *  - with no open Task (paused arrangements are skipped; or a visit finished elsewhere and not yet logged) projection starts after the last finished
 *    visit's date, so a finished visit is never counted again.
 * Nothing here marks a visit completed or paid.
 */
export function expectedWindow(arrangements: ArrangementRecord[], state: Map<number, ScheduleState>, today: string, days: number): ExpectedWindow {
  const end = addDays(today, days);
  const out: ExpectedWindow = { days, estimateCents: 0, items: [], notConverted: [] };
  for (const a of [...arrangements].sort((x, y) => x.id - y.id)) {
    const e = a.data.expected;
    if (!e || a.data.status !== 'active') continue;
    const skip = (reason: string) => out.notConverted.push({ arrangementId: a.id, title: a.data.title, reason });
    if (e.basis !== 'perVisit') { skip(`The estimate is ${BASIS_LABEL[e.basis]}, which is not converted into a ${days}-day figure (no rule for part months, seasons or years). It is not multiplied by visits.`); continue; }
    const c = a.data.cadence;
    if (!c) { skip('On demand: there is no schedule to project visits from.'); continue; }
    const st = state.get(a.id) ?? { openDue: null, openOccurrence: null, lastDoneOccurrence: null };
    const due = st.openDue;
    if (c.mode === 'after') {
      if (due && due >= today && due <= end) { out.items.push({ arrangementId: a.id, title: a.data.title, visits: 1, dates: [due], centsEach: e.cents, cents: e.cents, partial: true }); out.estimateCents += e.cents; }
      else skip('Repeats after each visit, so only the next visit can be projected, and it is not due in this period.');
      continue;
    }
    // the visit that is already scheduled (moved or not) counts once, on its own date; the others follow the arrangement
    const upcoming = due && due >= today && due <= end ? [due] : [];
    const passed = [st.openOccurrence, due, st.lastDoneOccurrence].filter((x): x is string => !!x).sort().pop() ?? null;
    const after = passed && addDays(passed, 1) > today ? addDays(passed, 1) : today;
    const dates = [...upcoming, ...cadenceBetween(c, after, end).filter((x) => !upcoming.includes(x))];
    if (!dates.length) { skip('No visit is scheduled in this period.'); continue; }
    const cents = e.cents * dates.length;
    out.items.push({ arrangementId: a.id, title: a.data.title, visits: dates.length, dates, centsEach: e.cents, cents, partial: false });
    out.estimateCents += cents;
  }
  return out;
}
