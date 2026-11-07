/**
 * EXPECTED visits for the Calendar (S4 correction 1): every date the arrangement's standing schedule says a service should happen, across a rolling
 * 12-calendar-month horizon. Pure and read only. Nothing is stored, no Task, Event or visit is made, and a derived date is never "done".
 *
 * Authority: the ARRANGEMENT's cadence (through `cadenceBetween`, so every-N-weeks, monthly and twice-monthly all come from the one existing adapter and
 * `generateDates`; there is no new recurrence engine). The ONE open visit Task stays the single actionable next visit. The Tasks Calendar layer shows
 * only that Task (it does not expand repeats), so to avoid showing the same visit twice this layer starts AFTER the Task, exactly as the real scheduler
 * does when the visit is logged (`nextAfterVisit`, and the S3 estimate window):
 *   later dates = cadence dates after BOTH the open Task's date and the date it stands for, after any visit already finished (logged or not), and never
 *   before today.
 * So: a visit moved to another day is shown once, by its Task, and does not shift the later dates; a visit moved past the next usual date passes over it;
 * a visit finished in Tasks and not yet logged is never shown again.
 *
 * HORIZON CONVENTION: from today through the same day-of-month 12 calendar months later, BOTH ends included, clamped to the month length
 * (today 2026-11-06 gives 2027-11-06; 2028-02-29 gives 2029-02-28). It is worked out from the date the Calendar asks with, so it moves forward by itself
 * with the clock and with no database write. Dates before today are never produced (history is the visit records).
 *
 * Not produced: an arrangement that is paused, ended or on demand; a schedule "after each visit" (its later dates depend on when each visit is done);
 * a damaged schedule (it reads as no schedule). Single-occurrence cancellations and moves are NOT stored in the arrangement (a skipped or cancelled visit
 * is logged and the Task moves on; a future one-off skip cannot be recorded in advance), so they cannot appear here: that limit is documented, not hidden.
 */
import { addDays, addMonths } from '../../lib/dates';
import { cadenceBetween, type ArrangementRecord } from './model';
import type { ScheduleState } from './expectedCharges';

export const HORIZON_MONTHS = 12;
/** The last day shown: the same day of the month, 12 calendar months after `today`, clamped. Inclusive. */
export const horizonEnd = (today: string) => addMonths(today, HORIZON_MONTHS);

const latest = (xs: (string | null)[]) => xs.filter((x): x is string => !!x).sort().pop() ?? null;

/** The expected visit dates of one arrangement inside `from..to` (both included), clamped to today..horizon. Sorted, no repeats. */
export function plannedVisitDates(a: ArrangementRecord, state: ScheduleState, today: string, from: string, to: string): string[] {
  if (a.data.status !== 'active') return [];
  const c = a.data.cadence;
  if (!c || c.mode !== 'fixed') return [];
  const passed = latest([state.openOccurrence, state.openDue, state.lastDoneOccurrence]);
  const first = [from, today, passed ? addDays(passed, 1) : today].sort().pop()!;
  const last = [to, horizonEnd(today)].sort()[0];
  if (first > last) return [];
  return [...new Set(cadenceBetween(c, first, last))].sort();
}

/** Stable id of one expected visit: the arrangement and the date, in a key no renewal or notice marker can share. */
export const plannedVisitKey = (arrangementId: number) => `visit-${arrangementId}`;
