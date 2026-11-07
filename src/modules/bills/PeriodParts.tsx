import { evidenceLine, LABEL_TEXT } from './labels';
import type { Period } from './periods';
import { slotWords2 } from './schedule';
import { day, type Money } from './BillsParts';

/** The primary label in words, with the amounts that matter (all through the Hide-Amounts-aware `money`). */
export function labelText(p: Period, money: Money): string {
  const a = p.amounts;
  if (p.label === 'partly-paid' && a.owed !== null) return `Partly paid (${money(a.paid)} of ${money(a.owed)})`;
  if (p.label === 'payment-recorded') return `Payment recorded (${money(a.paid)})`;
  if (p.label === 'paid' && a.overpaid > 0) return `Paid (${money(a.overpaid)} more than billed)`;
  if ((p.label === 'scheduled-auto') && p.timing.days !== null) return `${LABEL_TEXT[p.label]} (${p.timing.days > 0 ? `due in ${p.timing.days} day${p.timing.days === 1 ? '' : 's'}` : p.timing.days === 0 ? 'due today' : 'due date passed'})`;
  return LABEL_TEXT[p.label];
}

/** What the household owes for the period, in words. An estimate says so; unknown is never shown as $0. */
export function amountLine(p: Period, money: Money): string {
  const a = p.amounts;
  const owed = a.basis === 'disagree' ? 'Amount unclear: the records disagree'
    : a.basis === 'unknown' ? 'Amount not known'
    : a.basis === 'billed' ? `Billed ${money(a.basisCents!)}`
    : a.basis === 'expected' ? `Expected ${money(a.basisCents!)}`
    : `Estimate, about ${money(a.basisCents!)}`;
  const credit = a.creditCents > 0 ? `, credit ${money(a.creditCents)}${a.owed !== null ? `, owed ${money(a.owed)}` : ''}` : '';
  const paid = a.paid > 0 ? ` · paid outside Finance ${money(a.paid)}${a.remaining !== null ? `, ${money(a.remaining)} left` : ''}` : a.paidConflict ? ' · two different paid amounts recorded' : '';
  return `${owed}${credit}${paid}`;
}

/** "Due 20 Dec (you recorded it; the schedule said 18 Dec)" / "Expected 18 Dec" / "Due date unclear". */
export function dueLine(p: Period): string {
  const t = p.timing;
  if (t.source === 'due') return `Due ${day(t.date!)}${p.nominal && p.nominal !== t.date ? ` (recorded by you; the schedule said ${day(p.nominal)})` : ''}`;
  if (t.source === 'nominal') return `Expected ${day(t.date!)} (from the schedule; no due date recorded)`;
  if (t.source === 'conflict') return `Due date unclear: different dates are recorded${t.date ? ` (the schedule says ${day(t.date)})` : ''}`;
  return 'No due date recorded';
}

export const periodName = (p: { slot: string }) => slotWords2(p.slot);

/** The label and the mandatory second line saying what Ledger actually knows. Never colour alone. */
export function PeriodLabel({ p, money }: { p: Period; money: Money }) {
  return (
    <span className="bl-plabel">
      <span className={`bl-chip bl-l-${p.label}`}>{labelText(p, money)}</span>
      <span className="muted small bl-ev">{evidenceLine(p.label)}</span>
    </span>
  );
}
