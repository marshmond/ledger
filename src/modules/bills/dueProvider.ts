/**
 * The Bills & Subscriptions due provider: a read-only Calendar layer worked out when the Calendar draws (B2). Nothing is stored, copied or
 * written, and no Task, event or reminder is made. Because it is derived, the horizon moves with the clock by itself: today through the same
 * day 12 calendar months later (the same convention Household Services uses), both ends included, clamped to the month length. No future
 * period record or Calendar event is ever created to fill it.
 *
 * Two kinds of marker, never mixed:
 *  1. EXPECTED BILLS `bills:due-<bill>-<slot>:<date>`: a billing period that is still open (not paid, skipped or zero) on its timing date, which is the
 *     recorded actual due date when there is one and otherwise the schedule's date. A period with a recorded due date moves with it; its identity (the
 *     slot) does not, so the phone-calendar id stays the same. Bills paid by hand that are past their date and not confirmed stay visible for review
 *     (inside the Calendar's overdue window); automatic payments past their date are not shown as overdue (the Today card counts them).
 *  2. CONTRACT DATES `bills:<notice|trial|renewal>-<bill>:<date>`: cancel-by, trial end and renewal. A passed date is `handled`; nothing happens when it passes.
 *
 * NO DUPLICATES BY PURPOSE AND OCCURRENCE (not by title): an open pay Task whose reminder date is the same day as an expected-bill marker for the
 * SAME period stands for it and the marker is left out; a pay Task on a different day does not, because "do it on the 12th" and "due on the 15th"
 * are two different facts. A notice or trial marker is left out only when an open Task for that same kind of deadline is dated the same day. A
 * renewal and a notice on one day are two markers. (Cross-layer suppression against Finance scheduled items and Household Services contract dates
 * arrives with the later phases that link them.)
 *
 * PRIVACY: the title is the bill's own title and a short word ("Due", "Cancel by"). Never an amount, an account number, a note or a link, in the
 * title, the detail or the exported calendar text.
 */
import { db, type FinanceDB } from '../../db';
import { derivedId, goTo, type DerivedItem, type DueProvider, type DueQuery } from '../../core/dueProvider';
import { addDays, addMonths } from '../../lib/dates';
import { LABEL_TEXT, SETTLED_LABELS } from './labels';
import { isLoanExcluded } from './model';
import { obligationPath } from './paths';
import { periodsOf } from './periods';
import { loadBillsSnapshot } from './readModel';
import { lookupOfMap } from '../../lib/txnLookup';
import { markersOf } from './tasks';
import { deadlinesOf, DEADLINE_MEANING, DEADLINE_SHORT, isActionDeadline, readTerms } from './terms';
import { daysUntil } from './timing';

export const BILLS_LAYER_COLOR = '#b94a7c';
export const HORIZON_MONTHS = 12;
/** The last day shown: the same day of the month, 12 calendar months after `today`, clamped. Inclusive. */
export const horizonEnd = (today: string) => addMonths(today, HORIZON_MONTHS);

export async function billsDueItems(d: FinanceDB, q: DueQuery): Promise<DerivedItem[]> {
  const snap = await loadBillsSnapshot(d);
  if (snap.obligations.length === 0) return [];
  const lo = q.overdueDays > 0 && addDays(q.today, -q.overdueDays) < q.from ? addDays(q.today, -q.overdueDays) : q.from;
  const hi = q.to < horizonEnd(q.today) ? q.to : horizonEnd(q.today);
  if (lo > hi) return [];
  const openTasks = snap.tasks.filter((t) => t.data.status !== 'done');
  const lookup = lookupOfMap(snap.financeTxns); // a period paid by linked Finance payments is not an open due marker (read only; nothing is stored)
  const out: DerivedItem[] = [];

  for (const ob of snap.obligations) {
    const title = ob.data.title;
    const go = () => goTo(obligationPath(ob.id));
    if (!isLoanExcluded(ob.data)) {
      for (const p of periodsOf(ob, snap.cycles, q.today, { from: lo, to: hi }, { lookup })) {
        const date = p.timing.date;
        if (date === null || SETTLED_LABELS.has(p.label) || !p.open) continue;
        const late = date < q.today;
        if (late && ob.data.payment.how === 'auto') continue; // automatic payments are never shown as overdue here
        const task = openTasks.find((t) => { const m = markersOf(t); return m && m.obligation === ob.id && m.purpose === 'pay' && m.cycle === p.slot && t.data.dueDate === date; });
        if (task) continue; // the open Task for this very period is dated the same day and stands for it
        const manual = ob.data.payment.how !== 'auto';
        out.push({
          id: derivedId('bills', `due-${ob.id}-${p.slot}`, date), sourceModule: 'bills', sourceRecordId: `obligation:${ob.id}`, title: `Due: ${title}`, date, allDay: true,
          priority: manual && late ? 'high' : manual && p.timing.days !== null && p.timing.days <= 3 ? 'high' : manual ? 'medium' : 'low', status: 'open',
          detail: `${LABEL_TEXT[p.label]}. ${p.timing.source === 'due' ? 'The due date is the one recorded for this bill.' : p.timing.source === 'conflict' ? 'The due date is to be confirmed: different dates are recorded.' : 'Expected date from the schedule; the provider\'s own due date is not recorded.'} Ledger does not know whether it was paid.`,
          openSource: go, sourceLabel: 'Open bill', icsUid: `bills-${ob.id}-${p.slot}@ledger.local`,
        });
      }
    }
    if (ob.data.status === 'ended') continue;
    for (const dl of deadlinesOf(readTerms(ob.data.terms))) {
      if (dl.date < lo || dl.date > hi) continue;
      const task = isActionDeadline(dl.kind) && openTasks.find((t) => { const m = markersOf(t); return m && m.obligation === ob.id && m.purpose === dl.kind && t.data.dueDate === dl.date; });
      if (task) continue;
      const days = daysUntil(dl.date, q.today);
      out.push({
        id: derivedId('bills', `${dl.kind}-${ob.id}`, dl.date), sourceModule: 'bills', sourceRecordId: `obligation:${ob.id}`, title: `${DEADLINE_SHORT[dl.kind]}: ${title}`, date: dl.date, allDay: true,
        priority: isActionDeadline(dl.kind) ? (days >= 0 && days <= 7 ? 'high' : 'medium') : 'low', status: dl.date >= q.today ? 'open' : 'handled',
        detail: DEADLINE_MEANING[dl.kind], openSource: go, sourceLabel: 'Open bill', icsUid: `bills-${dl.kind}-${ob.id}@ledger.local`, ...(isActionDeadline(dl.kind) ? { icsAlarmMinutes: 1440 } : {}),
      });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
}

export const billsDueProvider: DueProvider = {
  id: 'bills',
  layerName: 'Bills & Subscriptions',
  color: BILLS_LAYER_COLOR,
  getDueItems: (q) => billsDueItems(db, q),
};
