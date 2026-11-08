/**
 * Small PURE helper shared by the module readers (Bills, Services, Home & Assets): turns the shared Finance references a record holds into
 * `TxnDependent` rows. It judges each reference with the SAME `resolveRef` the spending readers use, so "stale" here means exactly what
 * "needs review" means there. It adds no rule of its own about what counts as spending.
 */
import { resolveRef, type TxnRef } from '../lib/txnRef';
import type { Txn } from '../types';
import type { TxnDependent } from './txnDependents';

export type DependentBase = Pick<TxnDependent, 'module' | 'moduleLabel' | 'recordId' | 'title' | 'noun' | 'relation' | 'href' | 'note'>;

export function dependentsFromRefs(refs: readonly TxnRef[], ids: ReadonlySet<number>, txns: Map<number, Txn>, base: DependentBase, opts: { historical?: boolean } = {}): TxnDependent[] {
  const out: TxnDependent[] = [];
  for (const ref of refs) {
    if (!ids.has(ref.txnId)) continue;
    const r = resolveRef(ref, (id) => txns.get(id));
    const standing: TxnDependent['standing'] = opts.historical ? 'historical' : r.needsReview ? 'stale' : 'current';
    out.push({ ...base, txnId: ref.txnId, scope: ref.splitIndex === undefined ? 'whole' : 'part', parts: ref.splitIndex === undefined ? [] : [ref.splitIndex], standing, evidence: standing === 'current' });
  }
  return out;
}
