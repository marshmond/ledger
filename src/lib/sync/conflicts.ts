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
 *  - All changes are queued one after another, so two changes in this tab cannot interleave. (Two browser tabs on one device could
 *    still race; that is not new, and a lost removal only brings back an entry, never loses one.)
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

let queue: Promise<unknown> = Promise.resolve();
function serial<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job, job);
  queue = run.catch(() => undefined);
  return run;
}

export async function readConflicts(meta: MetaStore): Promise<Conflict[]> {
  const list = await meta.get<Conflict[]>(CONFLICTS_KEY);
  return Array.isArray(list) ? list : [];
}

/** Adds new overwritten versions (newest first) to those already kept. Returns how many were actually new. Throws if the list cannot be saved. */
export function addConflicts(meta: MetaStore, fresh: Conflict[]): Promise<number> {
  return serial(async () => {
    const have = await readConflicts(meta);
    const seen = new Set(have.map(conflictKey));
    const add: Conflict[] = [];
    for (const c of fresh) {
      const k = conflictKey(c);
      if (seen.has(k)) continue;
      seen.add(k);
      add.push(c);
    }
    if (add.length) await meta.set(CONFLICTS_KEY, [...add, ...have]);
    return add.length;
  });
}

/** Removes one entry (after it was put back or dismissed). Reads the current list, so newer entries are never lost. */
export function removeConflict(meta: MetaStore, key: string): Promise<void> {
  return serial(async () => {
    const have = await readConflicts(meta);
    const rest = have.filter((c) => conflictKey(c) !== key);
    if (rest.length !== have.length) await meta.set(CONFLICTS_KEY, rest);
  });
}

/** Removes every entry. Only for the owner's deliberate "clear this list". */
export function clearConflicts(meta: MetaStore): Promise<void> {
  return serial(async () => {
    await meta.set(CONFLICTS_KEY, []);
  });
}
