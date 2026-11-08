/**
 * POSSIBLE CHARGES AFTER A CANCELLATION (B4). PURE: no database, no clock, no network. Given Finance transactions that were loaded in bulk (dated after
 * the effective date), it says which of them LOOK like this subscription's, and why they deserve a look. It is a reader and a nudge, never a verdict.
 *
 * WHAT IT NEVER DOES (tested): dispute a charge, contact anyone, reverse or delete a transaction, create a refund, link a payment, reopen the
 * subscription, or conclude that the cancellation failed because a transaction exists.
 *
 * EVIDENCE RULES
 *  - A matching payee is a REASON TO LOOK, not proof. Only an exact payee match (a word the owner approved, the provider's name or the title) is counted; a weak resemblance is
 *    listed apart and never counted.
 *  - A pending transaction is shown as pending ("may not be final"); it proves nothing about settlement.
 *  - A refund (money back from the same payee) is listed beside the charges; a refund at least as large as a charge, on or after it, offsets that charge.
 *  - A charge the owner said to expect (a final charge in the confirmation, up to the amount they recorded) is shown as expected and not counted.
 *  - A transaction the owner already linked to ANOTHER bill belongs to that bill and is not counted here. One linked to THIS bill is still listed
 *    (a recorded payment dated after the cancellation is exactly what to look at).
 *  - A change in the set of charges gives a new evidence key, so something acknowledged earlier is raised again only when the evidence changed.
 */
import { daysBetween } from '../../lib/money';
import { isSpendingTxn, pieceKey, makeTxnRef, type TxnRef } from '../../lib/txnRef';
import type { Txn } from '../../types';
import { isEffective, type CycleRecord } from './cycleModel';
import type { ObligationRecord } from './model';
import { namesOfBill, payeeMatch, type PayeeVia } from './payeeMatch';
import { piecesOf } from './suggest';

export const REFUND_OFFSET_DAYS = 60;
export const FINAL_CHARGE_DAYS = 60;
/** Charges are looked for this many days after the effective date; an old cancellation stops raising attention by itself. */
export const AFTER_WINDOW_DAYS = 400;

export interface AfterItem {
  key: string;
  ref: TxnRef;
  txn: Txn;
  date: string;
  /** Always positive. */
  cents: number;
  kind: 'charge' | 'refund';
  status: Txn['status'];
  match: 'exact' | 'partial';
  via: PayeeVia;
  /** The billing period of THIS bill the owner linked it to, if any. */
  linkedSlot: string | null;
  /** Titles of other bills it is linked to. */
  elsewhere: string[];
  daysAfter: number;
  /** A refund that is at least as large, on or after it, offsets this charge. */
  offsetBy: string | null;
  /** The owner's confirmation said a final charge was expected and this fits what they recorded. */
  expectedFinal: boolean;
  notes: string[];
}
export interface AfterCancel {
  effectiveOn: string;
  /** Exact payee matches that count: charges not offset, not expected and not linked to another bill. */
  counted: AfterItem[];
  /** Every exact-match charge, with the reason it is or is not counted in `notes`. */
  charges: AfterItem[];
  refunds: AfterItem[];
  /** Weak resemblances, never counted. */
  weaker: AfterItem[];
  evidenceKey: string;
  acknowledged: boolean;
}

/** The day after which a payment would be unexpected: the confirmed effective date, or the date the owner ended it as cancelled. Null when there is none. */
export function cancellationDate(ob: ObligationRecord): string | null {
  const d = ob.data;
  return d.lc?.cutoffOn ?? (d.status === 'ended' && d.endReason === 'cancelled' ? d.endedOn : null);
}

export interface AfterInput { obligation: ObligationRecord; obligations: ObligationRecord[]; cycles: CycleRecord[]; transactions: Txn[]; today: string }

export function chargesAfterCancellation(input: AfterInput): AfterCancel | null {
  const ob = input.obligation;
  const effectiveOn = cancellationDate(ob);
  if (effectiveOn === null || effectiveOn >= input.today) return null;
  const names = namesOfBill(ob.data);
  const linked = new Map<string, { obligationId: number; slot: string }[]>();
  for (const c of input.cycles) if (isEffective(c) && c.body.fact === 'payment-link') linked.set(pieceKey(c.body.ref), [...(linked.get(pieceKey(c.body.ref)) ?? []), { obligationId: c.obligationId, slot: c.slot }]);
  const titleOf = (id: number) => input.obligations.find((o) => o.id === id)?.data.title ?? 'another bill';
  const confirm = ob.data.lc?.cancel.confirm?.body ?? null;

  const items: AfterItem[] = [];
  for (const t of input.transactions) {
    if (t.id === undefined || t.date <= effectiveOn || t.date > input.today || daysBetween(t.date, effectiveOn) > AFTER_WINDOW_DAYS || !isSpendingTxn(t)) continue;
    const m = payeeMatch(t.payee, names);
    if (m.kind === 'none' || m.via === null) continue;
    const base = { txn: t, date: t.date, status: t.status, match: m.kind, via: m.via, daysAfter: daysBetween(t.date, effectiveOn), offsetBy: null as string | null, expectedFinal: false, notes: [] as string[] };
    const mk = (ref: TxnRef, key: string, cents: number, kind: AfterItem['kind']): AfterItem => {
      const uses = linked.get(key) ?? [];
      return { ...base, key, ref, cents, kind, linkedSlot: uses.find((u) => u.obligationId === ob.id)?.slot ?? null, elsewhere: [...new Set(uses.filter((u) => u.obligationId !== ob.id).map((u) => titleOf(u.obligationId)))] };
    };
    if (t.amountCents > 0) items.push(mk(makeTxnRef(t), pieceKey(makeTxnRef(t)), t.amountCents, 'refund'));
    else for (const p of piecesOf(t)) items.push(mk(p.ref, p.key, p.spendCents, 'charge'));
  }
  const refunds = items.filter((i) => i.kind === 'refund' && i.match === 'exact').sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key));
  const charges = items.filter((i) => i.kind === 'charge' && i.match === 'exact').sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key));
  const weaker = items.filter((i) => i.match === 'partial').sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key));
  // money coming back is spent down across the charges it covers, earliest charge first; a charge is offset only when it is covered IN FULL
  const left = new Map(refunds.map((r) => [r.key, r.cents]));
  const used = new Set<string>();
  const counted: AfterItem[] = [];
  for (const c of charges) {
    if (c.status === 'pending') c.notes.push('Pending: a pending transaction may not be final, and it does not show how the charge will settle.');
    if (c.linkedSlot) c.notes.push('You linked it to this bill as a payment.');
    if (c.elsewhere.length) c.notes.push(`You linked it to ${c.elsewhere.join(' and ')}, so it belongs to that bill and is not counted here.`);
    const usable = refunds.filter((r) => (left.get(r.key) ?? 0) > 0 && r.date >= c.date && daysBetween(r.date, c.date) <= REFUND_OFFSET_DAYS);
    if (usable.reduce((n, r) => n + (left.get(r.key) ?? 0), 0) >= c.cents) {
      let need = c.cents;
      for (const r of usable) { const take = Math.min(need, left.get(r.key) ?? 0); left.set(r.key, (left.get(r.key) ?? 0) - take); need -= take; used.add(r.key); c.offsetBy = c.offsetBy ?? r.key; if (need === 0) break; }
      c.notes.push('Money came back from the same payee afterwards, enough to cover this charge, so it looks offset.');
    }
    if (confirm && confirm.finalCharge !== 'none' && c.daysAfter <= FINAL_CHARGE_DAYS && (confirm.finalCharge === 'unknown' ? false : confirm.finalChargeCents !== null && c.cents <= confirm.finalChargeCents)) { c.expectedFinal = true; c.notes.push('You recorded that a final charge was expected, and this is within that amount.'); }
    else if (confirm && confirm.finalCharge === 'unknown' && c.daysAfter <= FINAL_CHARGE_DAYS) c.notes.push('A final or partial-period charge can be legitimate. You recorded that you were not sure whether one was coming.');
    if (!c.offsetBy && !c.expectedFinal && c.elsewhere.length === 0) counted.push(c);
  }
  for (const r of refunds) r.notes.push(used.has(r.key) ? 'It offsets a charge listed above.' : 'Money back. Ledger does not know what it is for.');
  const evidenceKey = `after|${ob.id}|${effectiveOn}|${counted.map((c) => c.key).sort().join(',')}`;
  return { effectiveOn, counted, charges, refunds, weaker, evidenceKey, acknowledged: ob.data.lc?.acked.has(evidenceKey) ?? false };
}
