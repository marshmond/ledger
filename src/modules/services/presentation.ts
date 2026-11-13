import type { StatusTone } from '../../ui/StatusChip';
import { scheduleStateOf } from './expectedCharges';
import { BASIS_LABEL, cadenceText, type ArrangementRecord, type Status } from './model';
import { horizonEnd, plannedVisitDates } from './plannedVisits';
import type { TaskRecord } from '../tasks/model';
import type { VisitStatus } from './visitModel';
import type { Row } from './views';

/**
 * D15. Presentation helpers for the Household Services screens. Nothing here reads or writes a record, and nothing works out a schedule of its own:
 * the cadence words come from `cadenceText`, the expected dates from `plannedVisitDates` (the same function the Calendar layer uses), and the next
 * visit is the one open visit Task. A date that has passed is never turned into "done".
 */

/** The chip tone for an arrangement's status. The words always carry the meaning, so colour is never the only cue. */
export const ARRANGEMENT_TONE: Record<Status, StatusTone> = { active: 'active', paused: 'warning', ended: 'neutral' };

/** The chip tone for a logged visit's outcome. */
export const VISIT_TONE: Record<VisitStatus | 'unsupported', StatusTone> = { completed: 'done', skipped: 'neutral', cancelled: 'warning', unsupported: 'warning' };

export type NextVisitState = 'overdue' | 'scheduled' | 'nothing' | 'inactive';
export interface NextVisitView { state: NextVisitState; date: string | null; /** words for a screen that has no date tile */ label: string }

/**
 * Where an arrangement's next visit stands. `date` is the open visit Task's due date. An active arrangement with no open Task says "Nothing scheduled";
 * a paused or ended one says nothing is expected (never "overdue").
 */
export function nextVisitView(status: Status, nextDate: string | null, today: string): NextVisitView {
  if (status !== 'active') return { state: 'inactive', date: null, label: status === 'paused' ? 'Paused: no visits expected' : 'Ended: no visits expected' };
  if (!nextDate) return { state: 'nothing', date: null, label: 'Nothing scheduled' };
  return nextDate < today ? { state: 'overdue', date: nextDate, label: 'Overdue' } : { state: 'scheduled', date: nextDate, label: nextDate === today ? 'Today' : 'Next visit' };
}

export interface ArrangementCardModel {
  id: number;
  title: string;
  provider: string;
  providerMissing: boolean;
  cadence: string;
  next: NextVisitView;
  /** "Estimate $150.00 per visit", or null when no estimate was entered. A missing estimate is never shown as a price. */
  estimate: string | null;
  status: Status;
  assetNames: string[];
}

/** One arrangement as a card needs it. `money` is the caller's Hide-Amounts-aware formatter. */
export function arrangementCard(r: Row, today: string, money: (cents: number) => string): ArrangementCardModel {
  const d = r.a.data;
  return {
    id: r.a.id, title: d.title, provider: d.providerNameSnapshot || 'No provider yet', providerMissing: !d.providerNameSnapshot, cadence: cadenceText(d.cadence),
    next: nextVisitView(d.status, r.nextDate, today), estimate: d.expected ? `Estimate ${money(d.expected.cents)} ${BASIS_LABEL[d.expected.basis]}` : null,
    status: d.status, assetNames: r.assets.filter((a) => !a.missing).map((a) => a.name).slice(0, 2),
  };
}

/** Rows grouped under their date, in the order given (the rows arrive sorted by date). */
export function groupByDate<T extends { date: string }>(rows: T[]): { date: string; rows: T[] }[] {
  const out: { date: string; rows: T[] }[] = [];
  for (const r of rows) {
    const last = out[out.length - 1];
    if (last && last.date === r.date) last.rows.push(r);
    else out.push({ date: r.date, rows: [r] });
  }
  return out;
}

/** The two kinds of upcoming row, in plain words. A task is the one actionable visit; an expected date is derived and never a task. */
export const UPCOMING_KIND_WORDS = { task: 'Next visit (a task)', expected: 'Expected from schedule' } as const;

export interface Occurrences { dates: string[]; /** how many expected dates the next 12 months hold in all */ total: number }

/**
 * The expected visit dates AFTER the open visit Task, from the schedule alone (read only; nothing is created or stored). Uses the same function the
 * Calendar layer uses, so the dates match the Calendar. `limit` only shortens the list; `total` is the whole 12-month count.
 */
export function occurrencesOf(a: ArrangementRecord, tasks: TaskRecord[], today: string, limit = 6): Occurrences {
  const all = plannedVisitDates(a, scheduleStateOf(tasks), today, today, horizonEnd(today));
  return { dates: all.slice(0, limit), total: all.length };
}
