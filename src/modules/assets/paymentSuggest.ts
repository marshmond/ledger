/**
 * R2.2 "Possible matches" for Home & Assets: which existing MAINTENANCE / SERVICE-HISTORY record a Finance payment may have paid for.
 *
 *  - The candidates are service records that already exist (work the owner recorded as done). A suggestion never creates, edits or backdates a record, and never touches
 *    an asset's own purchase record. A record on an archived asset is not offered.
 *  - Identity is the PROVIDER on the record: the payee must match that Contact's name (the same word-based comparison Bills uses, `lib/payeeMatch`) and the date must be close
 *    (7 days before to 30 after the work). A cost the owner TYPED must agree with the payment (within 1%), otherwise the record is not offered. Amount alone is never enough.
 *  - ONE SOURCE. A record counts either a typed cost or Finance payments, never both (`costSource`, H3). So a record that already holds a typed cost is always a REVIEW:
 *    the existing edit form asks which one counts. Ledger never combines them and never silently swaps one for the other.
 *  - ACCEPT is Home & Assets' own `updateService` with the payment added to `txnRefs` (the same change the record's own form makes), guarded by the record's `updatedAt`.
 *    Offered only for a record with no cost and no payment yet, an unsplit payment, and a payment dated 3 days before to 14 days after the work.
 *  - REJECT is the shared per-pair memory (`core/paymentSuggestions`).
 */
import type { FinanceDB } from '../../db';
import { isRejected, liveContactNames, loadRejections, saveRejection } from '../../core/paymentSuggestions';
import type { LinkCandidate, LinkResult, PaymentSuggestionContext, RawCandidate } from '../../core/paymentSuggestions';
import { payeeMatch } from '../../lib/payeeMatch';
import { daysBetween, todayISO } from '../../lib/money';
import { makeTxnRef, type TxnRef } from '../../lib/txnRef';
import { loadAssets } from './data';
import { getService, loadServices, updateService } from './serviceData';

const MODULE_ID = 'assets';
const BEFORE = 7;
const AFTER = 30;
const MAX_PER_TXN = 3;

interface Payload { serviceId: number; serviceUpdatedAt: number; ref: TxnRef }
const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(1, Math.round(b * 0.01));
const dayWords = (n: number) => (n === 0 ? 'on the day the work was done' : n < 0 ? `${-n} day${n === -1 ? '' : 's'} before the work` : `${n} day${n === 1 ? '' : 's'} after the work`);

export async function suggest({ txns, d }: PaymentSuggestionContext): Promise<RawCandidate[]> {
  const [services, assets, rejected] = await Promise.all([loadServices(d), loadAssets(d), loadRejections(d, MODULE_ID)]);
  const live = new Map(assets.filter((a) => !a.data.archived).map((a) => [a.id, a.data.name]));
  const open = services.filter((s) => s.data.txnRefs.length === 0 && s.data.providerContactId !== null && s.data.date && live.has(s.data.assetId));
  if (open.length === 0) return [];
  const names = await liveContactNames(d, open.map((s) => s.data.providerContactId!));
  const out: RawCandidate[] = [];
  for (const t of txns) {
    const spend = -t.amountCents;
    const split = (t.splits?.length ?? 0) > 1;
    const found: { c: RawCandidate; gap: number }[] = [];
    for (const s of open) {
      const gap = daysBetween(t.date, s.data.date);
      if (gap < -BEFORE || gap > AFTER) continue;
      const provider = names.get(s.data.providerContactId!);
      if (!provider || payeeMatch(t.payee, [{ text: provider, via: 'provider' }]).kind !== 'exact') continue;
      const targetKey = `service:${s.id}`;
      if (isRejected(rejected, t, targetKey)) continue;
      const typed = s.data.costCents;
      if (typed !== null && !near(spend, typed)) continue; // the record says the work cost something else
      const reasons = ['The payee matches the provider on this record.', `The payment is dated ${dayWords(gap)}.`];
      if (typed !== null) reasons.push('The amount matches the cost you typed on this record.');
      let note: string | null = null;
      if (split) note = 'This payment is split into parts. Choose the whole payment or one part when you link it.';
      else if (typed !== null) note = 'This record holds a cost you typed. Ledger counts either that or a linked payment, never both, so you choose which one in the record.';
      else if (gap < -3 || gap > 14) note = 'The payment is dated some time from the work, and there is no cost on the record to compare it with. Look at it first.';
      const asset = live.get(s.data.assetId)!;
      found.push({
        gap: Math.abs(gap),
        c: {
          txnId: t.id!, targetKey, targetKind: 'Maintenance record', targetTitle: s.data.title, targetDetail: `${asset}, ${s.data.date}`,
          href: `/assets/${s.data.assetId}?service=${s.id}`, reasons, action: note === null ? 'accept' : 'review', reviewNote: note, reviewHref: `/assets/${s.data.assetId}?service=${s.id}`,
          payload: { serviceId: s.id, serviceUpdatedAt: s.updatedAt, ref: makeTxnRef(t) } satisfies Payload,
        },
      });
    }
    found.sort((a, b) => a.gap - b.gap || a.c.targetKey.localeCompare(b.c.targetKey));
    out.push(...found.slice(0, MAX_PER_TXN).map((x) => x.c));
  }
  return out;
}

/** Links the payment with Home & Assets' own `updateService`, refused if the record changed, got a cost or a payment, or its asset was archived. */
export async function accept(c: LinkCandidate, d: FinanceDB, today: string = todayISO()): Promise<LinkResult> {
  const p = c.payload as Payload;
  const s = await getService(p.serviceId, d);
  if (!s || s.updatedAt !== p.serviceUpdatedAt) return { ok: false, message: 'That maintenance record changed since Ledger looked, so nothing was linked. Look at the possible matches again.' };
  if (s.data.txnRefs.length > 0) return { ok: false, message: 'That record already has a payment linked, so nothing was linked.' };
  if (s.data.costCents !== null) return { ok: false, message: 'That record now holds a typed cost, so you need to choose which one counts. Open it. Nothing was linked.' };
  const asset = (await loadAssets(d)).find((a) => a.id === s.data.assetId);
  if (!asset || asset.data.archived) return { ok: false, message: 'The asset for that record is archived or gone, so nothing was linked.' };
  await updateService(s.id, { ...s.data, txnRefs: [p.ref] }, d, today);
  return { ok: true, message: `Linked to “${s.data.title}” on ${s.data.date}. Nothing in Finance was changed.` };
}

export async function reject(c: LinkCandidate, d: FinanceDB): Promise<() => Promise<void>> {
  const t = await d.txns.get(c.txnId);
  if (!t) throw new Error('That payment is no longer in Finance.');
  return saveRejection(d, MODULE_ID, t, c.targetKey);
}
