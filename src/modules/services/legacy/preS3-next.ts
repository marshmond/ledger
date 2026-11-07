/** VERBATIM copy of the pre-S3 `nextAfterVisit` (git fe2c673, src/modules/services/visits.ts). Used only by the older-build compatibility test. */
import { addDays } from '../../../lib/dates';
import { nextDueDate } from '../../tasks/recur';
import type { VisitStatus } from '../visitModel';
import { nextCadenceDate, type ArrangementData } from './preS3-model';

/**
 * The date of the next visit after one is finished, skipped or cancelled. Pure.
 *  - fixed cadence: the first cadence date AFTER both the occurrence just dealt with and the day it was dealt with, and not before today.
 *    So moving one visit never shifts later ones, finishing early does not repeat the same date, and finishing late does not create a
 *    backlog of missed visits.
 *  - repeat-after-each-visit ("N months after each visit"): counted from the visit's OWN date, with Tasks' own `nextDueDate`.
 *      completed: the service date (never later than today, which validation guarantees), so a visit done early or late re-bases the cycle.
 *      skipped or cancelled: nothing was serviced, so the day it was RECORDED must not stand in for a service date. The intended
 *      occurrence (the visit's date, past or future) is the anchor instead: a visit due on 23 Nov and cancelled on 6 Nov counts from 23 Nov.
 *      If that already lies in the past (a missed visit recorded late) the next one is due today, never earlier (no backlog).
 * Returns null when there is no schedule, the arrangement is not active, or the schedule has ended.
 */
export function nextAfterVisit(a: ArrangementData, v: { status?: VisitStatus; occurrence: string | null; taskDue: string | null; visitDate: string; today: string }): string | null {
  const c = a.cadence;
  if (!c || a.status !== 'active') return null;
  const base = v.visitDate < v.today ? v.visitDate : v.today;
  if (c.mode === 'after') {
    const next = nextDueDate(null, { mode: 'after', rule: c.rule }, v.visitDate);
    return next && v.status && v.status !== 'completed' && next < v.today ? v.today : next;
  }
  // The occurrence just dealt with; a skipped or cancelled visit dated in the future also passes over that later date.
  const occ = v.occurrence ?? v.taskDue ?? base;
  const after = [occ, v.visitDate, base].reduce((x, y) => (y > x ? y : x));
  const from = addDays(after, 1) > v.today ? addDays(after, 1) : v.today;
  return nextCadenceDate(c, from);
}

