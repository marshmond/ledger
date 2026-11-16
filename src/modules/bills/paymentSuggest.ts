/**
 * R2.2 "Possible matches" for Bills & Subscriptions: the adapter between the shell's neutral contract (`core/paymentSuggestions.ts`) and what Bills already has.
 *
 *  - SUGGEST reuses `suggestMatches` (B3.1) through `suggestForTxns`: the same payee, date and amount rules and the same "Not this payment" memory as the Link-a-payment
 *    dialog, so the two places can never disagree about a payment the owner rejected. Nothing here scores anything of its own.
 *  - ACCEPT is Bills' own `recordFact` with a `payment-link` fact: the very call the Link-a-payment dialog makes. Nothing else is written.
 *  - REJECT is Bills' own `rejectSuggestion` (the `suggestion-reject` fact, for THIS billing period only).
 *
 * Accept is offered only when the whole association is clear: a strong match, an unsplit payment, nothing the owner already typed for the period, no open reminder
 * Task to decide about, and nothing to look at closely. Anything else is a "Review link" that opens the bill, where the existing dialog asks the question.
 * Reasons never contain an amount (Hide Amounts cannot mask text); the screen shows the payment's own amount through its masked formatter.
 */
import type { FinanceDB } from '../../db';
import type { LinkCandidate, LinkResult, PaymentSuggestionContext, RawCandidate } from '../../core/paymentSuggestions';
import { loadTxnMap, lookupOfMap } from '../../lib/txnLookup';
import type { TxnRef } from '../../lib/txnRef';
import { addDays } from '../../lib/dates';
import { newOp, planFact, recordFact, rejectSuggestion } from './cycleData';
import { typedPayments } from './paymentLinks';
import { periodsOf } from './periods';
import { loadBillsSnapshot } from './readModel';
import { slotWords2 } from './schedule';
import { suggestionStale, type Evidence } from './suggest';
import { suggestForTxns } from './suggestData';
import { runUndo } from './undo';

interface Payload { obligationId: number; slot: string; due: string; ref: TxnRef }

const BASIS: Record<NonNullable<Evidence['basis']>, string> = { billed: 'the bill you recorded', expected: 'the amount this bill expects', remaining: 'what is still left to pay', estimate: 'the typical amount' };
const dayWords = (n: number) => (n === 0 ? 'on the due date' : n < 0 ? `${-n} day${n === -1 ? '' : 's'} before the due date` : `${n} day${n === 1 ? '' : 's'} after the due date`);

/** One piece of evidence in plain words, with no amount in it. Only evidence the matcher actually found is worded; anything else is left out. */
export function reasonWords(e: Evidence): string | null {
  switch (e.kind) {
    case 'rule-posted': return 'It was posted from the Finance Scheduled payment you linked to this bill.';
    case 'payee-exact': return e.via === 'hint' ? 'The payee matches a payee you asked Ledger to remember for this bill.' : e.via === 'provider' ? 'The payee matches this bill’s provider.' : e.via === 'rule' ? 'The payee matches the linked Scheduled payment.' : 'The payee matches the name of this bill.';
    case 'payee-partial': return `The payee shares the word “${e.text}” with this bill.`;
    case 'date': return `The payment is dated ${dayWords(e.n ?? 0)}.`;
    case 'amount-match': return `The amount matches ${BASIS[e.basis ?? 'billed']}.`;
    case 'amount-range': return 'The amount is within the range of the payments you linked to this bill before.';
    case 'amount-typical': return 'The amount is near the typical amount you entered for this bill.';
    case 'category-same': return 'It has the same Finance category as this bill.';
    default: return null;
  }
}

export async function suggest({ txns, today, d }: PaymentSuggestionContext): Promise<RawCandidate[]> {
  const found = await suggestForTxns(txns, today, d);
  const out: RawCandidate[] = [];
  const seen = new Set<string>();
  for (const { ob, period, s } of found) {
    const t = s.txn;
    const split = (t.splits?.length ?? 0) > 1;
    const targetKey = `${ob.id}:${period.slot}`;
    // a split payment gives one candidate per bill period (never a separate whole and part), and the owner picks the piece in the bill's own dialog
    if (seen.has(`${t.id}|${targetKey}`)) continue;
    seen.add(`${t.id}|${targetKey}`);
    const due = period.timing.date ?? period.nominal;
    if (due === null) continue;
    // would the existing link operation refuse? (the same payment already on the period, a transfer, ...) then there is nothing to suggest
    const plan = await planFact({ obligationId: ob.id, slot: period.slot, body: { fact: 'payment-link', ref: s.ref }, today }, d);
    if (plan.problem) continue;
    const reasons = s.forPoints.map(reasonWords).filter((x): x is string => !!x);
    let note: string | null = null;
    if (s.needsReview) note = s.reviewReasons[0] ?? 'Look at this one closely first.';
    else if (split) note = 'This payment is split into parts. Choose the whole payment or one part when you link it.';
    else if (s.tier !== 'strong') note = 'Ledger could not check the amount against this bill, so it needs your look first.';
    else if (typedPayments(period.effective).length > 0) note = 'You already typed a payment outside Finance for this period. Linking this one means choosing which counts.';
    else if (plan.taskId !== null) note = 'This bill has an open reminder. The link dialog lets you choose whether to finish it with this payment.';
    out.push({
      txnId: t.id!, targetKey, targetKind: 'Bill', targetTitle: ob.data.title, targetDetail: `${slotWords2(period.slot)}, due ${due}`,
      href: `/bills/o/${ob.id}`, reasons, action: note === null ? 'accept' : 'review', reviewNote: note, reviewHref: `/bills/o/${ob.id}`,
      payload: { obligationId: ob.id, slot: period.slot, due, ref: s.ref } satisfies Payload,
    });
  }
  return out;
}

/** Links the payment with Bills' own `recordFact`, after re-reading the bill, the period and the payment. */
export async function accept(c: LinkCandidate, d: FinanceDB, today: string): Promise<LinkResult> {
  const p = c.payload as Payload;
  const stale = suggestionStale(p.ref, lookupOfMap(await loadTxnMap([p.ref], d)));
  if (stale) return { ok: false, message: stale };
  const snap = await loadBillsSnapshot(d);
  const ob = snap.obligations.find((o) => o.id === p.obligationId);
  if (!ob || ob.data.status !== 'active') return { ok: false, message: 'That bill is no longer active, so nothing was linked.' };
  const live = new Map(snap.financeTxns);
  for (const [id, t] of await loadTxnMap([p.ref], d)) live.set(id, t);
  const period = periodsOf(ob, snap.cycles, today, { from: addDays(p.due, -40), to: addDays(p.due, 40) }, { allRecorded: true, lookup: lookupOfMap(live) }).find((x) => x.slot === p.slot);
  if (!period) return { ok: false, message: 'That billing period is no longer on this bill, so nothing was linked.' };
  if (!period.open) return { ok: false, message: 'That billing period is no longer waiting for a payment, so nothing was linked.' };
  if (typedPayments(period.effective).length > 0) return { ok: false, message: 'A payment was typed for that period since Ledger looked. Open the bill to choose which counts. Nothing was linked.' };
  const plan = await planFact({ obligationId: ob.id, slot: p.slot, body: { fact: 'payment-link', ref: p.ref }, today }, d);
  if (plan.problem) return { ok: false, message: `${plan.problem} Nothing was linked.` };
  if (plan.taskId !== null) return { ok: false, message: 'That bill has an open reminder now. Open the bill to link the payment and choose whether to finish the reminder. Nothing was linked.' };
  const r = await recordFact({ obligationId: ob.id, slot: p.slot, body: { fact: 'payment-link', ref: p.ref }, op: newOp(), today }, d);
  return { ok: true, message: r.reused ? `That payment was already linked to ${ob.data.title}.` : `Linked to ${ob.data.title}, ${slotWords2(p.slot)}. Nothing in Finance was changed.` };
}

export async function reject(c: LinkCandidate, d: FinanceDB): Promise<() => Promise<void>> {
  const p = c.payload as Payload;
  const r = await rejectSuggestion({ obligationId: p.obligationId, slot: p.slot, ref: p.ref, op: newOp() }, d);
  return async () => { if (!r.reused) await runUndo(r.undo, () => undefined, d); };
}

