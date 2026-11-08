/**
 * A POSSIBLE PRICE CHANGE, noticed from what Finance shows (B4, brief section 4). PURE: it reads billing periods that were already derived and writes nothing.
 *
 * "Your latest recorded payment differs from the expected subscription price" is a REASON TO LOOK. It is not evidence of a new price, and Ledger never acts on it:
 * the expected price is not rewritten, no price step is recorded, nothing is assumed permanent and nothing is assumed to be a contract change. A difference can be
 * tax, a fee, a credit, a proration or a one-off, so the notice says so and offers only the owner's own "Record a price change" (a normal, previewed, undoable action).
 *
 * It looks at the NEWEST billing period that (1) is paid by Finance links, (2) is judged against the EXPECTED price (no recorded bill, which would be the amount owed),
 * (3) has no provider credit, (4) has no payment problem (missing, changed or reversed link), and (5) leaves the period over-paid against that price. A bill whose
 * amount varies, an inactive bill and a loan-related bill give nothing. A lower amount is not reported: it looks like a partial payment and the existing "partly paid"
 * review already covers it.
 */
import type { ObligationRecord } from './model';
import { isLoanExcluded } from './model';
import type { Period } from './periods';

export interface PriceNotice {
  slot: string;
  /** The period's date (its due date when recorded, otherwise the schedule date). */
  date: string | null;
  paidCents: number;
  expectedCents: number;
  /** Always positive: how much more was paid than the expected price. */
  differenceCents: number;
  /** Earlier periods paid by Finance at exactly the expected price (context for the owner). */
  matchedBefore: number;
  /** The exact evidence, for "Leave as is": a different payment gives a different key. */
  key: string;
  acknowledged: boolean;
}

export const priceNoticeKey = (obligationId: number, slot: string, paidCents: number) => `price|${obligationId}|${slot}|${paidCents}`;

export function priceNotice(ob: ObligationRecord, periods: Period[], today: string): PriceNotice | null {
  const d = ob.data;
  if (d.status !== 'active' || d.amountKind !== 'fixed' || isLoanExcluded(d)) return null;
  const paidByFinance = periods
    .filter((p) => p.amounts.source === 'finance' && p.amounts.paid > 0 && p.amounts.finance !== null && p.timing.date !== null && p.timing.date <= today)
    .sort((a, b) => (b.timing.date ?? '').localeCompare(a.timing.date ?? '') || b.slot.localeCompare(a.slot));
  const latest = paidByFinance[0];
  if (!latest) return null;
  const a = latest.amounts;
  const fin = a.finance!;
  if (a.basis !== 'expected' || a.invoiceRecorded || a.creditCents !== 0 || a.basisCents === null || a.overpaid <= 0 || fin.counts.review > 0 || fin.reversed) return null;
  const key = priceNoticeKey(ob.id, latest.slot, a.paid);
  return {
    slot: latest.slot, date: latest.timing.date, paidCents: a.paid, expectedCents: a.basisCents, differenceCents: a.overpaid,
    matchedBefore: paidByFinance.slice(1).filter((p) => p.amounts.basis === 'expected' && p.amounts.overpaid === 0 && p.amounts.paid === p.amounts.basisCents).length,
    key, acknowledged: d.lc?.acked.has(key) ?? false,
  };
}
