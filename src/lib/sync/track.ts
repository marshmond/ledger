/**
 * Change tracking for sync. Every record gets an `updatedAt` time whenever it is written, and new records get ids that cannot
 * collide with ones made on another device (time-based instead of 1, 2, 3...). Deleted records are noticed at sync time by
 * comparing with the list of ids from the last sync, so deletions need no hook.
 */
import type { FinanceDB } from '../../db';

let last = 0;
/** A new record id: milliseconds * 1000 plus a random part, always increasing on this device, and far above old 1, 2, 3 ids. */
export function newId(): number {
  last = Math.max(last + 1, Date.now() * 1000 + Math.floor(Math.random() * 1000));
  return last;
}

/** Records being written by sync itself (as "table|key"); they keep the time they already carry. */
export const applying = new Set<string>();

let listener: (() => void) | null = null;
/** Called after a local write, so sync can run a moment later. */
export function setChangeListener(fn: (() => void) | null) {
  listener = fn;
}
const changed = () => listener?.();

const installed = new WeakSet<FinanceDB>();

export function installTracking(d: FinanceDB) {
  if (installed.has(d)) return;
  installed.add(d);
  for (const t of d.tables) {
    const settings = t.name === 'settings';
    t.hook('creating', function (primKey, obj) {
      const key = settings ? (obj as { key?: string }).key : primKey;
      if (key !== undefined && applying.has(`${t.name}|${key}`)) return undefined;
      (obj as { updatedAt?: number }).updatedAt = Date.now();
      changed();
      return !settings && primKey === undefined ? newId() : undefined;
    });
    t.hook('updating', function (_mods, primKey) {
      if (applying.has(`${t.name}|${primKey}`)) return undefined;
      changed();
      return { updatedAt: Date.now() };
    });
    t.hook('deleting', function (primKey) {
      if (!applying.has(`${t.name}|${primKey}`)) changed();
    });
  }
}

/** Marks every record as changed now. Used after restoring a backup, so the restored data wins over older copies elsewhere. */
export async function touchAll(d: FinanceDB) {
  const now = Date.now();
  await d.transaction('rw', d.tables, async () => {
    for (const t of d.tables) await t.toCollection().modify((r: { updatedAt?: number }) => { r.updatedAt = now; });
  });
}
