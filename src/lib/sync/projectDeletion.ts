/**
 * One narrow exception to "the newest edit wins", for a project the owner deleted PERMANENTLY.
 *
 * Why it is needed: a deleted record is just a record with `deletedAt` set, so the normal merge treats it like any edit, and an edit
 * made later on another device (against its stale copy) would beat the deletion and bring the project back. For a project that is
 * wrong: the owner chose "Delete permanently".
 *
 * How it works (nothing new is stored beyond one number inside the project's own data):
 *  - `deleteProjectPermanently` writes `data.permanentlyDeletedAt` on the project before soft-deleting it.
 *  - After the ordinary merge, a project with that marker stays deleted whatever any other copy says, and its budget lines follow it
 *    (a line made or edited on a stale device is deleted too), so lines are never orphaned or half restored.
 *  - Money keeps a project alive: if a live commitment or a transaction (whole or split) still points at the project after the merge
 *    (made on a stale device), the project and its lines are kept as they are on the live side, and nothing financial is orphaned.
 *  - An intentional backup restore keeps winning, as documented: restoring stamps live projects with `data.revivedAt` (see
 *    `touchAll`), and a live copy revived after the deletion beats it.
 * Tasks and events are not touched here: the deletion already unlinked them, and a stale pointer is read as "(project removed)".
 * Only records of module 'projects' kind 'project' or 'budgetLine' are ever changed. Everything else merges as before.
 */
import type { Rec, TableData } from './merge';

export const PERMANENT_DELETE_KEY = 'permanentlyDeletedAt';
export const REVIVED_KEY = 'revivedAt';

const dataOf = (r: Rec): Record<string, unknown> => (r.data && typeof r.data === 'object' ? (r.data as Record<string, unknown>) : {});
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const isDeleted = (r: Rec) => r.deletedAt != null;
const stamp = (r?: Rec) => (r && typeof r.updatedAt === 'number' ? r.updatedAt : 0);
const isKind = (r: Rec | undefined, kind: string): r is Rec => !!r && r.module === 'projects' && r.kind === kind;
const newest = (xs: Rec[]): Rec | undefined => [...xs].sort((a, b) => stamp(b) - stamp(a))[0];

/** When this copy was permanently deleted, or undefined when it is not a permanently deleted project. */
export const permanentDeleteTime = (r?: Rec): number | undefined => (r && isKind(r, 'project') && isDeleted(r) ? num(dataOf(r)[PERMANENT_DELETE_KEY]) : undefined);

const tagsProject = (t: Rec, pid: number): boolean => {
  const own = (t.project as { projectId?: unknown } | undefined)?.projectId;
  if (own === pid) return true;
  const splits = t.splits;
  return Array.isArray(splits) && splits.some((s) => (s as { project?: { projectId?: unknown } } | null)?.project?.projectId === pid);
};

/**
 * Applies the rule to the merged `moduleRecords` table, in place. `local` and `remote` are the two copies that were merged, `txns` is
 * the merged transactions table. Returns true when anything changed.
 */
export function enforceProjectDeletions(a: {
  merged: TableData;
  local: TableData;
  remote: TableData;
  txns: TableData | undefined;
  now: number;
  same: (x: Rec, y: Rec) => boolean;
}): boolean {
  const { merged, local, remote, txns, now, same } = a;
  let changed = false;
  const set = (id: string, rec: Rec) => {
    if (!merged[id] || !same(merged[id], rec)) { merged[id] = rec; changed = true; }
  };
  const ids = new Set([...Object.keys(local), ...Object.keys(remote)]);
  for (const id of ids) {
    const l = local[id], r = remote[id];
    const flagged = [l, r].filter((x): x is Rec => permanentDeleteTime(x) !== undefined);
    if (!flagged.length) continue;
    const T = Math.max(...flagged.map((x) => permanentDeleteTime(x) as number));
    const live = [l, r].filter((x): x is Rec => !!x && isKind(x, 'project') && !isDeleted(x));
    // An intentional restore (stamped after the deletion) wins, as before.
    if (live.some((x) => (num(dataOf(x)[REVIVED_KEY]) ?? 0) > T)) continue;

    const pid = Number(id);
    const lineIds = [...ids].filter((k) => [local[k], remote[k]].some((x) => isKind(x, 'budgetLine') && num(dataOf(x as Rec).projectId) === pid));
    const hasMoney =
      Object.values(merged).some((x) => isKind(x, 'commitment') && !isDeleted(x) && num(dataOf(x).projectId) === pid) ||
      Object.values(txns ?? {}).some((t) => tagsProject(t, pid));

    if (hasMoney) {
      // Money still points here: keep the project and its lines alive, as they are on the live side.
      const keep = newest(live);
      if (!keep) continue;
      set(id, keep);
      for (const k of lineIds) {
        const lv = newest([local[k], remote[k]].filter((x): x is Rec => !!x && !isDeleted(x)));
        if (lv) set(k, lv);
      }
    } else {
      set(id, newest(flagged) as Rec);
      for (const k of lineIds) {
        const copies = [local[k], remote[k]].filter((x): x is Rec => !!x);
        const dead = newest(copies.filter(isDeleted));
        set(k, dead ?? { ...(newest(copies) as Rec), deletedAt: T, updatedAt: now });
      }
    }
  }
  return changed;
}
