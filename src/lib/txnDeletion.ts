/**
 * DELETING FINANCE TRANSACTIONS WITH A PREVIEW (ST-S2, DI-02). One plan, one guarded apply, one database transaction.
 *
 *   plan   = look at the chosen transactions and ask every registered module "which of your records point at these?" (READ ONLY, nothing changes).
 *   apply  = in ONE database transaction: plan AGAIN from the live data, refuse if anything differs from what the owner was shown, then delete all of it or none of it.
 *
 * What it does NOT do: it never deletes, edits or "repairs" a Bill, a Services visit, a Home & Assets record or a Project. Those records stay exactly as they are; their
 * references to the deleted payment become the "payment not found, needs review" state that every household reader already handles (it counts nothing and says so).
 * It never swaps in a typed amount. It does not change `spend()`, `householdSpend()`, `billsRecordedPayments()` or the B5 union.
 *
 * Deleting one half of a transfer deletes the other half (existing Finance behaviour). The plan lists those partners so the owner sees them before confirming.
 * If any module's reader fails, `verified` is false and apply REFUSES: "could not check" is never shown as "nothing depends on this".
 *
 * The older `deleteTxn` and `bulkDelete` stay as the plain internal operations (used by account clean-up and tests). The Finance screens use this file.
 */
import type { FinanceDB } from '../db';
import { countByKind, describeCounts, readTxnDependents, type ModuleCount, type TxnDependent, type TxnReferenceProvider, type UnverifiedReader } from '../core/txnDependents';
import type { Txn } from '../types';

export interface DeletionPlan {
  /** The ids the owner chose that still exist, in the order chosen. */
  requested: number[];
  /** Chosen ids that no longer exist (already deleted, or on another device). */
  missing: number[];
  /** Every transaction that WOULD be deleted: the chosen ones plus the other half of each transfer. */
  willDelete: number[];
  /** Other halves of transfers that go with the chosen ones. */
  transferPartners: number[];
  splitTransactions: number;
  dependents: TxnDependent[];
  /** Distinct records per module/kind. */
  counts: ModuleCount[];
  /** Distinct records whose payment evidence would be removed (their link becomes "needs review" and counts nothing). */
  evidenceRecords: number;
  /** Distinct records already out of date (nothing live counted through them) or kept as history only. */
  otherRecords: number;
  verified: boolean;
  unverified: UnverifiedReader[];
  /** Equal fingerprints mean the same transactions with the same content and the same dependents. */
  fingerprint: string;
}

export class DeletionRefused extends Error {
  constructor(public reason: 'stale' | 'unverified' | 'empty', message: string) { super(message); this.name = 'DeletionRefused'; }
}

/** Every stored field except the sync time stamp, in a fixed key order, so ANY change to the transaction (its memo, status, account, a split, a tag) makes an old preview stale. */
const canon = (v: unknown): unknown => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])])) : v === undefined ? null : v);
const txnLine = (t: Txn) => { const { updatedAt: _stamp, ...rest } = t as Txn & { updatedAt?: number }; void _stamp; return JSON.stringify(canon(rest)); };

/** Reads everything and decides what a deletion would touch. READ ONLY. */
export async function planTxnDeletion(d: FinanceDB, ids: readonly number[], providers: readonly TxnReferenceProvider[]): Promise<DeletionPlan> {
  const chosen = [...new Set(ids)];
  const rows = await d.txns.bulkGet(chosen);
  const present = new Map<number, Txn>();
  const missing: number[] = [];
  chosen.forEach((id, i) => { const t = rows[i]; if (t && t.id !== undefined) present.set(id, t); else missing.push(id); });
  const requested = chosen.filter((id) => present.has(id));
  // the other half of a transfer goes too
  const partnerIds = [...new Set(requested.flatMap((id) => { const p = present.get(id)!.transferTxnId; return p ? [p] : []; }))].filter((p) => !present.has(p));
  const partnerRows = partnerIds.length ? await d.txns.bulkGet(partnerIds) : [];
  const partners: number[] = [];
  partnerIds.forEach((id, i) => { const t = partnerRows[i]; if (t && t.id !== undefined) { present.set(id, t); partners.push(id); } });
  const willDelete = [...requested, ...partners];
  const all = new Map(present);
  const found = willDelete.length ? await readTxnDependents(willDelete, all, d, providers) : { verified: true, dependents: [], unverified: [], signature: '' };
  const evidence = new Set(found.dependents.filter((x) => x.evidence).map((x) => `${x.module}|${x.recordId}`));
  const everyone = new Set(found.dependents.map((x) => `${x.module}|${x.recordId}`));
  const fingerprint = [
    ...willDelete.slice().sort((a, b) => a - b).map((id) => txnLine(all.get(id)!)),
    `missing:${missing.slice().sort((a, b) => a - b).join(',')}`,
    `verified:${found.verified}`,
    found.signature,
  ].join('\n');
  return {
    requested, missing, willDelete, transferPartners: partners,
    splitTransactions: willDelete.filter((id) => (all.get(id)!.splits?.length ?? 0) > 0).length,
    dependents: found.dependents, counts: countByKind(found.dependents),
    evidenceRecords: evidence.size, otherRecords: everyone.size - evidence.size,
    verified: found.verified, unverified: found.unverified, fingerprint,
  };
}

/**
 * Deletes what the plan described, all or nothing. Inside ONE database transaction it plans again from the live data; if the result differs from `plan` in any way
 * (a transaction was edited, a split changed, a module added or removed a link, a selection changed, a reader cannot run) NOTHING is deleted and `DeletionRefused` is thrown.
 * The caller shows the owner a fresh preview.
 */
export async function applyTxnDeletion(d: FinanceDB, plan: DeletionPlan, providers: readonly TxnReferenceProvider[]): Promise<{ deleted: number }> {
  if (!plan.verified) throw new DeletionRefused('unverified', 'Ledger could not check what depends on these transactions, so nothing was deleted.');
  if (plan.willDelete.length === 0) throw new DeletionRefused('empty', 'There is nothing left to delete.');
  return d.transaction('rw', d.txns, d.moduleRecords, d.recurring, d.recurringLog, async () => {
    const live = await planTxnDeletion(d, plan.requested.concat(plan.missing), providers);
    if (!live.verified) throw new DeletionRefused('unverified', 'Ledger could not check what depends on these transactions, so nothing was deleted.');
    if (live.fingerprint !== plan.fingerprint) throw new DeletionRefused('stale', 'Something changed since you looked (a transaction, or a record linked to it). Nothing was deleted. Look at the new list and confirm again.');
    for (const id of live.willDelete) await d.txns.delete(id);
    return { deleted: live.willDelete.length };
  });
}

// ---- words for the screen (no amounts anywhere) ----

export interface DeletionWords {
  /** One sentence for the top of the dialog. */
  headline: string;
  /** What happens to the other records. */
  consequence: string | null;
  /** Spending/evidence effect. */
  spending: string | null;
}

export function deletionWords(plan: DeletionPlan, subject: 'transaction' | 'selection' = 'transaction'): DeletionWords {
  const n = plan.willDelete.length;
  const thing = subject === 'selection' ? `${plan.requested.length} selected transaction${plan.requested.length === 1 ? '' : 's'}` : 'this transaction';
  const extra = plan.transferPartners.length ? ` ${plan.transferPartners.length === 1 ? 'The matching half of a transfer' : `${plan.transferPartners.length} matching transfer halves`} will be deleted too (${n} in all).` : '';
  if (!plan.verified) return { headline: `Ledger could not finish checking what depends on ${thing}.`, consequence: null, spending: null };
  if (plan.dependents.length === 0) return { headline: `Nothing else in Ledger points at ${thing}.${extra}`, consequence: null, spending: null };
  const list = describeCounts(plan.counts);
  const total = new Set(plan.dependents.map((x) => `${x.module}|${x.recordId}`)).size;
  return {
    headline: `${subject === 'selection' ? 'These payments are' : 'This payment is'} used by ${list}.${extra}`,
    consequence: `Deleting ${subject === 'selection' ? 'them' : 'it'} leaves ${total === 1 ? 'that record' : 'those records'} in place. ${total === 1 ? 'Its' : 'Their'} payment reference${total === 1 ? '' : 's'} will say the payment was not found and need${total === 1 ? 's' : ''} review. Nothing else is deleted and no typed amount is put in its place.`,
    spending: plan.evidenceRecords > 0 ? `${plan.evidenceRecords === 1 ? 'One record' : `${plan.evidenceRecords} records`} will stop counting ${subject === 'selection' ? 'these payments' : 'this payment'} in recorded spending (and any Project paid figure) until you link a payment again.` : null,
  };
}
