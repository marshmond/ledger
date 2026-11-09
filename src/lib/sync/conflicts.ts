/**
 * The list of edits that lost a tie between devices ("Edits that lost a tie" on the Sync page), kept in this browser's sync-meta database.
 *
 * ST-S1 / SY-01. The rule this module enforces: **an overwritten version stays recoverable until the owner deliberately puts it back or
 * removes it.** There is no size limit and nothing here drops an entry. (Before ST-S1 the list was cut to the newest 50, so with 80 clashes
 * 30 overwritten versions were lost although the screen said nothing was.)
 *
 *  - `addConflicts` keeps the entries already there, adds new ones, and ignores one it already holds (the same overwritten version
 *    seen again on a retry), newest first.
 *  - `removeConflict` and `clearConflicts` read the CURRENT list and remove only what they were asked to, so a screen that was drawn
 *    before a sync finished can never write an old copy of the list back over newer entries.
 *  - Every change reads the CURRENT list and saves the result in ONE IndexedDB read-write transaction (`MetaStore.update`). The browser lets only one
 *    such transaction use the store at a time, across every tab and window of this browser, so two tabs that save at the same moment
 *    cannot overwrite each other's list (ST-S5.1, ST5-F2; before, the queue was per tab and one tab's additions were lost in 24 of 25 simulated runs).
 *    If the save fails the stored list is left exactly as it was, and the sync that wanted to add to it stops before changing anything.
 *
 * Whether a limit on displayed rows is needed is a screen matter (SyncPage shows the first rows and a "Show all" button). It is never a storage limit.
 */
import type { MetaStore } from './engine';
import type { Conflict } from './merge';

export const CONFLICTS_KEY = 'conflicts';

/**
 * Identifies one overwritten version: the record, which side lost, and the lost version's own edit time. It does NOT include when the
 * sync ran, so seeing the same clash again on a retry gives the same key and is not added twice.
 */
export function conflictKey(c: Conflict): string {
  const at = c.lost && typeof c.lost.updatedAt === 'number' ? c.lost.updatedAt : 0;
  return `${c.table}|${c.id}|${c.kept}|${at}`;
}

export async function readConflicts(meta: MetaStore): Promise<Conflict[]> {
  const list = await meta.get<Conflict[]>(CONFLICTS_KEY);
  return Array.isArray(list) ? list : [];
}

const asList = (x: Conflict[] | undefined): Conflict[] => (Array.isArray(x) ? x : []);

/** Adds new overwritten versions (newest first) to those already kept. Returns how many were actually new. Throws if the list cannot be saved. */
export async function addConflicts(meta: MetaStore, fresh: Conflict[]): Promise<number> {
  let added = 0;
  await meta.update<Conflict[]>(CONFLICTS_KEY, (cur) => {
    const have = asList(cur);
    const seen = new Set(have.map(conflictKey));
    const add: Conflict[] = [];
    for (const c of fresh) {
      const k = conflictKey(c);
      if (seen.has(k)) continue;
      seen.add(k);
      add.push(c);
    }
    added = add.length;
    return add.length ? [...add, ...have] : cur;
  });
  return added;
}

/** Removes one entry (after it was put back or dismissed). Works on the current list inside the save, so newer entries are never lost. */
export async function removeConflict(meta: MetaStore, key: string): Promise<void> {
  await removeConflicts(meta, [key]);
}

/** Removes every entry. Only for the owner's deliberate "clear this list". */
export async function clearConflicts(meta: MetaStore): Promise<void> {
  await meta.update<Conflict[]>(CONFLICTS_KEY, () => []);
}

/**
 * Removes exactly the entries whose keys are given, in ONE step, and returns how many were removed. This is what the Sync page's "clear this list"
 * question uses: the keys are the versions the owner was looking at when they confirmed, so a version that a sync added a moment later is never
 * removed without being seen. The current list is read inside the same all-or-nothing save, like every other change here.
 */
export async function removeConflicts(meta: MetaStore, keys: string[]): Promise<number> {
  let removed = 0;
  await meta.update<Conflict[]>(CONFLICTS_KEY, (cur) => {
    const drop = new Set(keys);
    const have = asList(cur);
    const rest = have.filter((c) => !drop.has(conflictKey(c)));
    removed = have.length - rest.length;
    return removed ? rest : cur;
  });
  return removed;
}
