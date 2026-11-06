/**
 * "Delete permanently" for a Home & Assets asset holds across devices. A narrow sibling of projectDeletion.ts (which is left as it is).
 *
 * Why: a deleted record is just a copy with `deletedAt` set, so the ordinary merge lets an edit made LATER on a stale device beat the
 * deletion and recreate the asset. For an asset the owner deleted permanently that is wrong.
 *
 * The rule (applied after the ordinary merge, on module 'assets' kind 'asset' only):
 *  - `deleteAssetPermanently` writes `data.permanentlyDeletedAt` before soft-deleting. A flagged asset stays deleted whatever any copy says.
 *  - What keeps it alive (history and structure are never orphaned): a LIVE child asset (parentId), a live asset whose replacedById points
 *    at it, or a live record of a dependent kind (`ASSET_DEPENDENT_KINDS`: service, warranty) with `assetId` pointing at it. Transaction
 *    references live inside service records, so this also protects every financial reference; assets never own or edit transactions.
 *    The asset is then kept exactly as it is on its live side.
 *  - Repeats until nothing changes, so a parent / child / grandchild chain gives the same answer whichever device syncs first.
 *  - An intentional backup restore still wins: `touchAll` stamps live assets with `data.revivedAt`; a copy revived after the deletion beats it.
 * Nothing else changes. No new table, no file-format change.
 */
import { ASSET_DEPENDENT_KINDS } from '../../modules/assets/model';
import { PERMANENT_DELETE_KEY, REVIVED_KEY } from './projectDeletion';
import type { Rec, TableData } from './merge';

const dataOf = (r: Rec): Record<string, unknown> => (r.data && typeof r.data === 'object' ? (r.data as Record<string, unknown>) : {});
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const isDeleted = (r: Rec) => r.deletedAt != null;
const stamp = (r?: Rec) => (r && typeof r.updatedAt === 'number' ? r.updatedAt : 0);
const isAsset = (r: Rec | undefined): r is Rec => !!r && r.module === 'assets' && r.kind === 'asset';
const newest = (xs: Rec[]): Rec | undefined => [...xs].sort((a, b) => stamp(b) - stamp(a))[0];

/** When this copy was permanently deleted, or undefined when it is not a permanently deleted asset. */
export const assetDeleteTime = (r?: Rec): number | undefined => (r && isAsset(r) && isDeleted(r) ? num(dataOf(r)[PERMANENT_DELETE_KEY]) : undefined);

/** True when a live record in `merged` points at asset `id` (child, replacement pointer, or a dependent kind). */
function hasDependents(merged: TableData, id: number): boolean {
  for (const x of Object.values(merged)) {
    if (x.module !== 'assets' || isDeleted(x)) continue;
    const d = dataOf(x);
    if (x.kind === 'asset' && (num(d.parentId) === id || num(d.replacedById) === id)) return true;
    if ((ASSET_DEPENDENT_KINDS as readonly string[]).includes(String(x.kind)) && num(d.assetId) === id) return true;
  }
  return false;
}

/** Applies the rule to the merged `moduleRecords` table, in place. Returns true when anything changed. */
export function enforceAssetDeletions(a: { merged: TableData; local: TableData; remote: TableData; same: (x: Rec, y: Rec) => boolean }): boolean {
  const { merged, local, remote, same } = a;
  const flaggedIds = [...new Set([...Object.keys(local), ...Object.keys(remote)])].filter((id) => assetDeleteTime(local[id]) !== undefined || assetDeleteTime(remote[id]) !== undefined);
  if (!flaggedIds.length) return false;
  let any = false;
  for (let pass = 0; pass <= flaggedIds.length + 1; pass++) {
    let changed = false;
    const set = (id: string, rec: Rec) => { if (!merged[id] || !same(merged[id], rec)) { merged[id] = rec; changed = true; } };
    for (const id of flaggedIds) {
      const l = local[id], r = remote[id];
      const flagged = [l, r].filter((x): x is Rec => assetDeleteTime(x) !== undefined);
      const T = Math.max(...flagged.map((x) => assetDeleteTime(x) as number));
      const live = [l, r].filter((x): x is Rec => isAsset(x) && !isDeleted(x));
      if (live.some((x) => (num(dataOf(x)[REVIVED_KEY]) ?? 0) > T)) { const k = newest(live); if (k) set(id, k); continue; } // a deliberate restore wins
      if (hasDependents(merged, Number(id))) {
        const keep = newest(live);
        if (keep) set(id, keep);
      } else {
        set(id, newest(flagged) as Rec);
      }
    }
    if (!changed) break;
    any = true;
  }
  return any;
}
