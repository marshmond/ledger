/**
 * Reads the Finance transactions a record points at (READ ONLY). Done before a save's database transaction opens, so Finance's tables never
 * join it; the references that are already on a record are not re-checked, so a record with a stale reference can still be edited.
 */
import { db, type FinanceDB } from '../../db';
import type { Txn } from '../../types';
import { checkNewRefs, type TxnLookup, type TxnRef } from './txnRef';

export async function loadTxnMap(refs: TxnRef[], d: FinanceDB = db): Promise<Map<number, Txn>> {
  const ids = [...new Set(refs.map((r) => r.txnId))];
  const rows = ids.length ? await d.txns.bulkGet(ids) : [];
  return new Map(rows.flatMap((t) => (t && t.id !== undefined ? [[t.id, t] as [number, Txn]] : [])));
}
export const lookupOfMap = (m: Map<number, Txn>): TxnLookup => (id) => m.get(id);

/** The problem with references that are NEW on a record, or null. */
export async function newRefsProblem(next: TxnRef[], existing: TxnRef[], d: FinanceDB = db): Promise<string | null> {
  if (!next.length) return null;
  return checkNewRefs(next, existing, lookupOfMap(await loadTxnMap(next, d)));
}
