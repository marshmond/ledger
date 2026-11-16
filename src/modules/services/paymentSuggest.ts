/**
 * R2.2 "Possible matches" for Household Services: which LOGGED VISIT a Finance payment may have paid for.
 *
 *  - The candidates are visit records only: something that was written after a visit happened (completed) or a cancellation fee. A scheduled visit, a Task or an expected
 *    date is never a candidate, and a suggestion never creates, completes or changes a visit.
 *  - Identity is the PROVIDER: the payment's payee must match the provider recorded on the visit (the same word-based comparison Bills uses, `lib/payeeMatch`). The date
 *    must be close (7 days before to 30 after the visit). A recorded charge, when the visit has one, must agree (within 1%), otherwise the visit is not suggested (one
 *    invoice covering several visits stays a manual link). Amount alone is never enough: with no payee match there is no candidate.
 *  - ACCEPT is Services' own `setVisitPayment` (the call the visit's payment dialog makes), guarded by the visit's `updatedAt` so a visit changed since is refused.
 *    It is offered only when the visit has no payment recorded and either its recorded charge agrees with the payment or it has none and the payment is dated within 14 days after (3 before) the visit. A visit with a typed "paid outside Finance" amount, a split
 *    payment, or a payment dated further from a visit with no charge to check is a REVIEW: the visit opens, where the existing dialog asks the question.
 *  - REJECT is the shared per-pair memory (`core/paymentSuggestions`), nothing Services-specific.
 */
import type { FinanceDB } from '../../db';
import { isRejected, liveContactNames, loadRejections, saveRejection } from '../../core/paymentSuggestions';
import type { LinkCandidate, LinkResult, PaymentSuggestionContext, RawCandidate } from '../../core/paymentSuggestions';
import { payeeMatch, type PayeeName } from '../../lib/payeeMatch';
import { daysBetween } from '../../lib/money';
import { makeTxnRef, type TxnRef } from '../../lib/txnRef';
import { setVisitPayment } from './payments';
import { loadVisits, getVisit } from './visits';
import { visitRoute } from './paths';

const MODULE_ID = 'services';
const BEFORE = 7;
const AFTER = 30;
const MAX_PER_TXN = 3;

interface Payload { visitId: number; visitUpdatedAt: number; ref: TxnRef }
const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(1, Math.round(b * 0.01));
const dayWords = (n: number) => (n === 0 ? 'on the day of the visit' : n < 0 ? `${-n} day${n === -1 ? '' : 's'} before the visit` : `${n} day${n === 1 ? '' : 's'} after the visit`);

export async function suggest({ txns, d }: PaymentSuggestionContext): Promise<RawCandidate[]> {
  const [visits, rejected] = await Promise.all([loadVisits(d), loadRejections(d, MODULE_ID)]);
  // a visit that already has a Finance payment is never offered again (a second payment on one visit stays a manual choice)
  const open = visits.filter((v) => v.data.date && v.data.txnRefs.length === 0 && (v.data.status === 'completed' || (v.data.status === 'cancelled' && v.data.chargeKind === 'cancellationFee')));
  if (open.length === 0) return [];
  const names = await liveContactNames(d, open.flatMap((v) => (v.data.providerContactId !== null ? [v.data.providerContactId] : [])));
  const out: RawCandidate[] = [];
  for (const t of txns) {
    const spend = -t.amountCents;
    const split = (t.splits?.length ?? 0) > 1;
    const found: { c: RawCandidate; gap: number }[] = [];
    for (const v of open) {
      const gap = daysBetween(t.date, v.data.date);
      if (gap < -BEFORE || gap > AFTER) continue; // dated at most BEFORE days before the visit, or AFTER days after it
      const providerNames: PayeeName[] = [
        ...(v.data.providerNameSnapshot.trim() ? [{ text: v.data.providerNameSnapshot, via: 'provider' as const }] : []),
        ...(v.data.providerContactId !== null && names.has(v.data.providerContactId) ? [{ text: names.get(v.data.providerContactId)!, via: 'provider' as const }] : []),
      ];
      if (payeeMatch(t.payee, providerNames).kind !== 'exact') continue;
      const targetKey = `visit:${v.id}`;
      if (isRejected(rejected, t, targetKey)) continue;
      const charged = v.data.chargedCents;
      if (charged !== null && !near(spend, charged)) continue; // the visit says it cost something else
      const reasons = ['The payee matches the provider on this visit.', `The payment is dated ${dayWords(gap)}.`];
      if (charged !== null) reasons.push('The amount matches the charge you recorded for this visit.');
      let note: string | null = null;
      if (split) note = 'This payment is split into parts. Choose the whole payment or one part when you link it.';
      else if (v.data.paidManualCents !== null) note = 'You typed a payment made outside Finance for this visit. Linking this one means choosing which counts.';
      else if (charged === null && !(gap >= -3 && gap <= 14)) note = 'This visit has no recorded charge to compare the amount with, and the payment is dated some time from the visit. Look at it first.';
      found.push({
        gap: Math.abs(gap),
        c: {
          txnId: t.id!, targetKey, targetKind: 'Service visit', targetTitle: v.data.title || 'Visit', targetDetail: `${v.data.providerNameSnapshot || 'Provider'}, ${v.data.date}`,
          href: `/services${visitRoute(v.id)}`, reasons, action: note === null ? 'accept' : 'review', reviewNote: note, reviewHref: `/services${visitRoute(v.id)}`,
          payload: { visitId: v.id, visitUpdatedAt: v.updatedAt, ref: makeTxnRef(t) } satisfies Payload,
        },
      });
    }
    found.sort((a, b) => a.gap - b.gap || a.c.targetKey.localeCompare(b.c.targetKey));
    out.push(...found.slice(0, MAX_PER_TXN).map((x) => x.c));
  }
  return out;
}

/** Links the payment with Services' own `setVisitPayment`, refused if the visit changed, got a payment, or the charge no longer agrees. */
export async function accept(c: LinkCandidate, d: FinanceDB, _today?: string): Promise<LinkResult> {
  const p = c.payload as Payload;
  const v = await getVisit(p.visitId, d);
  if (!v || v.updatedAt !== p.visitUpdatedAt) return { ok: false, message: 'That visit changed since Ledger looked, so nothing was linked. Look at the possible matches again.' };
  if (v.data.txnRefs.length > 0 || v.data.paidManualCents !== null) return { ok: false, message: 'That visit already has a payment recorded, so nothing was linked.' };
  const t = await d.txns.get(p.ref.txnId);
  if (!t) return { ok: false, message: 'That payment is no longer in Finance, so nothing was linked.' };
  if (v.data.chargedCents !== null && !near(-t.amountCents, v.data.chargedCents)) return { ok: false, message: 'The amount no longer agrees with the visit’s recorded charge, so nothing was linked.' };
  await setVisitPayment(p.visitId, { source: 'finance', refs: [p.ref], manualCents: null }, p.visitUpdatedAt, d);
  return { ok: true, message: `Linked to the visit “${v.data.title}” on ${v.data.date}. Nothing in Finance was changed.` };
}

export async function reject(c: LinkCandidate, d: FinanceDB): Promise<() => Promise<void>> {
  const t = await d.txns.get(c.txnId);
  if (!t) throw new Error('That payment is no longer in Finance.');
  return saveRejection(d, MODULE_ID, t, c.targetKey);
}

