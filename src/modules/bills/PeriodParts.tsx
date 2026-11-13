import { evidenceLine, LABEL_TEXT } from './labels';
import { STATUS_DETAIL, statusSummary } from './payments';
import type { Period } from './periods';
import { slotWords2 } from './schedule';
import { day, type Money } from './BillsParts';
import { StatusChip } from '../../ui/StatusChip';
import { LABEL_TONE } from './presentation';

/** The primary label in words, with the amounts that matter (all through the Hide-Amounts-aware `money`). */
export function labelText(p: Period, money: Money): string {
  const a = p.amounts;
  if (p.label === 'partly-paid' && a.owed !== null) return `Partly paid (${money(a.paid)} of ${money(a.owed)})`;
  if (p.label === 'payment-recorded') return `Payment recorded (${money(a.paid)})`;
  if (p.label === 'marked-paid-short' && a.owed !== null) return `Marked paid in full by you; Finance shows ${money(a.paid)} of ${money(a.owed)}`;
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
  const left = a.remaining !== null ? `, ${money(a.remaining)} left` : '';
  const f = a.finance;
  const paid = f
    ? (a.paid > 0 ? ` · recorded in Finance ${money(a.paid)}${left}` : f.reversed ? ' · payments and money back add up to nothing paid' : ' · a Finance payment is linked, but nothing is counted yet')
    : a.paid > 0 ? ` · paid outside Finance ${money(a.paid)}${left}` : a.paidConflict ? ' · two different paid amounts recorded' : '';
  const typed = a.typedLeftOut.length > 0 ? ` · a typed payment (${a.typedLeftOut.map(money).join(', ')}) is left out while a Finance payment is linked` : '';
  return `${owed}${credit}${paid}${typed}`;
}

/**
 * The mandatory second line under a label: what Ledger actually knows. With Finance payments it quotes ONLY Finance's own status words (pending, cleared,
 * reconciled: your own marks and imports) and never claims bank settlement.
 */
export function evidenceText(p: Period, money: Money): string {
  const f = p.amounts.finance;
  if (!f) return evidenceLine(p.label);
  const note = `${f.counts.review > 0 ? ' A linked Finance payment needs review and is not counted.' : ''}${f.reversed ? ' A payment was reversed or refunded in Finance.' : ''}`;
  if (p.label === 'paid' || p.label === 'partly-paid' || p.label === 'payment-recorded') {
    const one = (['pending', 'cleared', 'reconciled'] as const).filter((k) => f.statuses[k] > 0);
    return `${statusSummary(f) ?? 'Recorded in Finance'}. ${one.length === 1 ? STATUS_DETAIL[one[0]] : "Finance's status words are your own marks and imports; they do not show that the provider received the money."}${note}`;
  }
  if (p.label === 'marked-paid-short') return `You declared it paid in full. Finance shows ${money(p.amounts.paid)}${p.amounts.owed !== null ? ` of ${money(p.amounts.owed)}` : ''}; the difference is shown, not hidden.${note}`;
  return `${evidenceLine(p.label)}${note}`;
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
      <StatusChip tone={LABEL_TONE[p.label]}>{labelText(p, money)}</StatusChip>
      <span className="muted small bl-ev">{evidenceText(p, money)}</span>
    </span>
  );
}
