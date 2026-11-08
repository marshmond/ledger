import { describe, expect, it } from 'vitest';
import { addConflicts, conflictKey, readConflicts, removeConflicts } from './conflicts';
import { dexieMeta } from './engine';
import type { Conflict } from './merge';

/**
 * ST-S3 / UX-03. The Sync page's "clear this list" question now removes exactly the versions the owner was shown when they confirmed.
 * A version that a sync adds after the question opened is kept, and nothing is ever removed silently. Disposable database, invented data.
 */
let n = 0;
const uniq = () => `cc${Date.now()}-${n++}`;
const mk = (id: number, stamp: number): Conflict => ({ table: 'contacts', id: String(id), label: `Person ${id}`, kept: 'other device', at: 1, lost: { id, updatedAt: stamp, name: `v${stamp}` } });

describe('removeConflicts: clearing the list removes only what was shown', () => {
  it('removes every version that was listed when the question opened, and reports how many', async () => {
    const meta = dexieMeta(uniq());
    const batch = Array.from({ length: 120 }, (_, i) => mk(i, 5));
    await addConflicts(meta, batch);
    const shown = (await readConflicts(meta)).map(conflictKey);
    expect(shown).toHaveLength(120);
    expect(await removeConflicts(meta, shown)).toBe(120);
    expect(await readConflicts(meta)).toEqual([]);
  });

  it('a version added by a sync while the question was open is KEPT (the stale question cannot erase what it never showed)', async () => {
    const meta = dexieMeta(uniq());
    await addConflicts(meta, [mk(1, 10), mk(2, 10), mk(3, 10)]);
    const shown = (await readConflicts(meta)).map(conflictKey); // the owner is looking at 3
    await addConflicts(meta, [mk(4, 20), mk(5, 20)]); // a sync finishes while the question is open
    expect(await removeConflicts(meta, shown)).toBe(3);
    const left = await readConflicts(meta);
    expect(left.map((c) => c.id).sort()).toEqual(['4', '5']);
    expect(left.every((c) => c.lost)).toBe(true); // and they are still recoverable
  });

  it('asking to remove nothing, or keys that are already gone, changes nothing', async () => {
    const meta = dexieMeta(uniq());
    await addConflicts(meta, [mk(1, 10), mk(2, 10)]);
    expect(await removeConflicts(meta, [])).toBe(0);
    expect(await removeConflicts(meta, ['contacts|999|other device|0'])).toBe(0);
    expect(await readConflicts(meta)).toHaveLength(2);
  });

  it('removing twice is safe: the second call finds nothing to remove', async () => {
    const meta = dexieMeta(uniq());
    await addConflicts(meta, [mk(1, 10), mk(2, 10)]);
    const keys = (await readConflicts(meta)).map(conflictKey);
    expect(await removeConflicts(meta, keys)).toBe(2);
    expect(await removeConflicts(meta, keys)).toBe(0);
  });

  it('runs in the same queue as adds, so a clear and an add started together never lose the add', async () => {
    const meta = dexieMeta(uniq());
    await addConflicts(meta, [mk(1, 10)]);
    const keys = (await readConflicts(meta)).map(conflictKey);
    await Promise.all([removeConflicts(meta, keys), addConflicts(meta, [mk(2, 20)])]);
    expect((await readConflicts(meta)).map((c) => c.id)).toEqual(['2']);
  });
});
