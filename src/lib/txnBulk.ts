import type { FinanceDB } from '../db';
import type { TxnStatus } from '../types';
import { deleteTxn, updateTxn } from './transfers';
import { EMPTY_FILTER, DEFAULT_SORT, type Sort, type TxnFilter } from './txnQuery';

/** Bulk actions for the All Transactions screen. Transfers keep both halves in sync. */

export interface BulkResult {
  updated: number;
  skippedTransfers: number;
  splitsCleared: number;
}

/** Sets one category on many transactions. Transfers have no category and are skipped; splits are replaced by the single category. */
export async function bulkSetCategory(d: FinanceDB, ids: number[], categoryId: number | null): Promise<BulkResult> {
  const res: BulkResult = { updated: 0, skippedTransfers: 0, splitsCleared: 0 };
  await d.transaction('rw', d.txns, async () => {
    for (const id of ids) {
      const t = await d.txns.get(id);
      if (!t) continue;
      if (t.transferTxnId) {
        res.skippedTransfers++;
        continue;
      }
      if (t.splits?.length) res.splitsCleared++;
      await d.txns.update(id, { categoryId, splits: undefined });
      res.updated++;
    }
  });
  return res;
}

/** Sets the status on many transactions (a transfer's other half follows). */
export async function bulkSetStatus(d: FinanceDB, ids: number[], status: TxnStatus): Promise<number> {
  let n = 0;
  for (const id of ids) {
    if (!(await d.txns.get(id))) continue;
    await updateTxn(d, id, { status });
    n++;
  }
  return n;
}

/** Deletes many transactions. Deleting one half of a transfer deletes the other, so the count can include those. */
export async function bulkDelete(d: FinanceDB, ids: number[]): Promise<number> {
  let n = 0;
  for (const id of new Set(ids)) {
    const t = await d.txns.get(id);
    if (!t) continue; // already removed as the other half of a transfer
    n += t.transferTxnId && (await d.txns.get(t.transferTxnId)) ? 2 : 1;
    await deleteTxn(d, id);
  }
  return n;
}

// ---- saved filters (stored with the app's settings, so they are included in backups) ----

export interface SavedFilter {
  id: string;
  name: string;
  filter: TxnFilter;
  sort: Sort;
}

const KEY = 'savedFilters';

export async function listSavedFilters(d: FinanceDB): Promise<SavedFilter[]> {
  const v = (await d.settings.get(KEY))?.value;
  if (!Array.isArray(v)) return [];
  // Fill in any fields added after a filter was saved.
  return v
    .filter((x): x is SavedFilter => !!x && typeof x === 'object' && typeof (x as SavedFilter).name === 'string')
    .map((x) => ({ ...x, filter: { ...EMPTY_FILTER, ...x.filter }, sort: { ...DEFAULT_SORT, ...x.sort } }));
}

/** Saves a filter under a name; a filter with the same name (any capitalization) is replaced. */
export async function saveFilter(d: FinanceDB, name: string, filter: TxnFilter, sort: Sort): Promise<SavedFilter[]> {
  const clean = name.trim();
  if (!clean) throw new Error('Give the filter a name');
  const all = (await listSavedFilters(d)).filter((f) => f.name.toLowerCase() !== clean.toLowerCase());
  all.push({ id: crypto.randomUUID(), name: clean, filter, sort });
  all.sort((a, b) => a.name.localeCompare(b.name));
  await d.settings.put({ key: KEY, value: all });
  return all;
}

export async function deleteSavedFilter(d: FinanceDB, id: string): Promise<SavedFilter[]> {
  const all = (await listSavedFilters(d)).filter((f) => f.id !== id);
  await d.settings.put({ key: KEY, value: all });
  return all;
}
