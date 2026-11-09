import { describe, expect, it } from 'vitest';
import { FinanceDB } from '../../db';
import { addConflicts, clearConflicts, conflictKey, readConflicts, removeConflict } from './conflicts';
import { dexieMeta, RemoteConflict, SyncEngine, type MetaStore, type RemoteFile, type RemoteStore } from './engine';
import { restoreLostVersion } from './safety';
import { installTracking } from './track';
import type { Conflict } from './merge';

/**
 * ST-S1 / SY-01. Every overwritten edit stays recoverable until the owner puts it back or removes it. The real SyncEngine and the real merge run
 * over disposable fake-indexeddb databases with an in-memory remote and real encryption. All data is invented.
 */
let n = 0;
const uniq = () => `ch${Date.now()}-${n++}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const PASS = 'a test passphrase';

interface Remote extends RemoteStore { puts: number; file: RemoteFile | null; failNextPut: 'none' | 'network' | 'race' }
function memoryRemote(): Remote {
  const r: Remote = {
    puts: 0,
    file: null,
    failNextPut: 'none',
    async getFile() { return r.file ? { sha: r.file.sha, bytes: r.file.bytes.slice() } : null; },
    async putFile(bytes, sha) {
      if (r.failNextPut === 'network') { r.failNextPut = 'none'; throw new Error('network down'); }
      if (r.failNextPut === 'race') { r.failNextPut = 'none'; throw new RemoteConflict('another device synced at the same moment'); }
      if ((r.file?.sha ?? undefined) !== sha) throw new RemoteConflict('stale');
      r.puts++;
      r.file = { sha: `sha${r.puts}`, bytes: bytes.slice() };
      return r.file.sha;
    },
  };
  return r;
}
function device(remote: RemoteStore, over: { metaName?: string; wrap?: (m: MetaStore) => MetaStore; pass?: string } = {}) {
  const d = new FinanceDB(uniq());
  installTracking(d);
  const metaName = over.metaName ?? uniq();
  const meta = dexieMeta(metaName);
  const used = over.wrap ? over.wrap(meta) : meta;
  return { d, meta, metaName, engine: new SyncEngine(d, used, remote, over.pass ?? PASS) };
}

/**
 * Two synced devices that then both edit the same `count` records. `loser` is the device whose edit is overwritten:
 * 'B' = B edits LAST so B wins and A's pushed version is the one lost; 'A' = B edits FIRST so A's later edit wins and B's local version is overwritten.
 */
async function clash(count: number, who: 'B-wins' | 'A-wins' = 'A-wins') {
  const remote = memoryRemote();
  const A = device(remote);
  const B = device(remote);
  const ids = (await A.d.contacts.bulkAdd(Array.from({ length: count }, (_, i) => ({ name: `Person ${i}` })) as never, { allKeys: true })) as number[];
  await A.engine.initialUpload();
  await B.engine.replaceFromRemote();
  await sleep(5);
  const editA = async () => { for (const id of ids) await A.d.contacts.update(id, { name: `A edit of ${id}` }); };
  const editB = async () => { for (const id of ids) await B.d.contacts.update(id, { name: `B edit of ${id}` }); };
  if (who === 'A-wins') { await editB(); await sleep(5); await editA(); } else { await editA(); await sleep(5); await editB(); }
  return { remote, A, B, ids };
}

describe('SY-01 every overwritten edit stays recoverable, whatever the number', () => {
  for (const count of [0, 1, 50, 51, 80, 120, 500]) {
    it(`${count} clashing records: all ${count} overwritten versions are kept, each recoverable, and the winner is unchanged`, async () => {
      const { A, B, ids } = await clash(count, 'A-wins');
      await A.engine.sync(); // A's later edits go up
      const out = await B.engine.sync(); // B's older local edits are overwritten here
      expect(out.conflicts).toHaveLength(count); // the merge saw them all (as before ST-S1)
      const kept = await B.engine.conflicts();
      expect(kept).toHaveLength(count); // ...and ALL are retained (before ST-S1: min(count, 50))
      expect(new Set(kept.map(conflictKey)).size).toBe(count);
      for (const id of ids.slice(0, 5).concat(ids.slice(-5))) { // sample of both ends: the lost copy is B's own version, the winner is A's
        const c = kept.find((x) => x.id === String(id));
        expect(c?.kept).toBe('other device');
        expect((c?.lost as { name?: string }).name).toBe(`B edit of ${id}`);
        expect((await B.d.contacts.get(id))?.name).toBe(`A edit of ${id}`);
      }
    });
  }

  it('REGRESSION of the S0 finding: 80 clashes were detected and only 50 were retained; now 80 of 80', async () => {
    const { A, B } = await clash(80, 'A-wins');
    await A.engine.sync();
    const out = await B.engine.sync();
    expect(out.conflicts.length).toBe(80);
    expect((await B.engine.conflicts()).length).toBe(80);
  });

  it('when the OTHER device\'s version is the one overwritten (this device wins), all of those are kept too', async () => {
    const { A, B, ids } = await clash(70, 'B-wins');
    await A.engine.sync();
    await B.engine.sync();
    const kept = await B.engine.conflicts();
    expect(kept).toHaveLength(70);
    expect(kept.every((c) => c.kept === 'this device')).toBe(true);
    expect((kept.find((c) => c.id === String(ids[0]))?.lost as { name?: string }).name).toBe(`A edit of ${ids[0]}`);
    expect((await B.d.contacts.get(ids[0]))?.name).toBe(`B edit of ${ids[0]}`); // the later edit still wins, exactly as before
  });
});

describe('SY-01 across several syncs, reviews and restarts', () => {
  it('new clashes are added to earlier unreviewed ones; nothing earlier is displaced', async () => {
    const { A, B, ids } = await clash(80, 'A-wins');
    await A.engine.sync();
    await B.engine.sync();
    expect(await B.engine.conflicts()).toHaveLength(80);
    // second round on 30 NEW records
    const more = (await A.d.contacts.bulkAdd(Array.from({ length: 30 }, (_, i) => ({ name: `Late ${i}` })) as never, { allKeys: true })) as number[];
    await A.engine.sync();
    await B.engine.sync();
    await sleep(5);
    for (const id of more) await B.d.contacts.update(id, { name: `B late ${id}` });
    await sleep(5);
    for (const id of more) await A.d.contacts.update(id, { name: `A late ${id}` });
    await A.engine.sync();
    await B.engine.sync();
    const all = await B.engine.conflicts();
    expect(all).toHaveLength(110);
    expect(all.filter((c) => ids.map(String).includes(c.id))).toHaveLength(80); // the first 80 are all still there
    expect(all.slice(0, 30).every((c) => more.map(String).includes(c.id))).toBe(true); // newest first
  });

  it('putting back one version removes only that entry; the rest stay, and the restored edit reaches the other device', async () => {
    const { A, B, ids } = await clash(60, 'A-wins');
    await A.engine.sync();
    await B.engine.sync();
    const kept = await B.engine.conflicts();
    const target = kept.find((c) => c.id === String(ids[7]))!;
    await restoreLostVersion(B.d, target);
    await removeConflict(B.meta, conflictKey(target));
    expect(await B.engine.conflicts()).toHaveLength(59);
    expect((await B.d.contacts.get(ids[7]))?.name).toBe(`B edit of ${ids[7]}`);
    await B.engine.sync();
    await A.engine.sync();
    expect((await A.d.contacts.get(ids[7]))?.name).toBe(`B edit of ${ids[7]}`); // an ordinary new edit: it wins and travels
    expect((await A.d.contacts.get(ids[8]))?.name).toBe(`A edit of ${ids[8]}`); // the others are untouched
  });

  it('a recreated engine (app restart) reads the same saved list; the count a screen would show equals what is stored', async () => {
    const { A, B } = await clash(66, 'A-wins');
    await A.engine.sync();
    await B.engine.sync();
    const again = new SyncEngine(B.d, dexieMeta(B.metaName), memoryRemote(), PASS);
    const list = await again.conflicts();
    expect(list).toHaveLength(66);
    expect((await readConflicts(dexieMeta(B.metaName))).length).toBe(list.length); // the status chip uses readConflicts
  });

  it('replacing this device from the synced copy and forgetting the sync setup do NOT discard unreviewed overwritten edits', async () => {
    const { A, B } = await clash(55, 'A-wins');
    await A.engine.sync();
    await B.engine.sync();
    await B.engine.replaceFromRemote();
    expect(await B.engine.conflicts()).toHaveLength(55);
    await B.engine.forget();
    expect(await B.engine.conflicts()).toHaveLength(55);
  });
});

describe('SY-01 failures never lose or double-count a version', () => {
  it('the list cannot be saved: the sync STOPS before anything is overwritten, and a retry with storage working records everything', async () => {
    const remote = memoryRemote();
    let failSave = true;
    const wrap = (m: MetaStore): MetaStore => ({ get: m.get.bind(m), set: async (k, v) => { if (failSave && k === 'conflicts') throw new Error('storage full'); return m.set(k, v); } });
    const A = device(remote);
    const B = device(remote, { wrap });
    const ids = (await A.d.contacts.bulkAdd(Array.from({ length: 12 }, (_, i) => ({ name: `P${i}` })) as never, { allKeys: true })) as number[];
    await A.engine.initialUpload();
    await B.engine.replaceFromRemote();
    await sleep(5);
    for (const id of ids) await B.d.contacts.update(id, { name: `B ${id}` });
    await sleep(5);
    for (const id of ids) await A.d.contacts.update(id, { name: `A ${id}` });
    await A.engine.sync();
    const sha = remote.file!.sha;
    await expect(B.engine.sync()).rejects.toThrow(/storage full/);
    expect((await B.d.contacts.get(ids[0]))?.name).toBe(`B ${ids[0]}`); // B's own version is STILL there: nothing was overwritten
    expect(remote.file!.sha).toBe(sha); // and nothing was uploaded
    failSave = false;
    const ok = await B.engine.sync();
    expect(ok.conflicts).toHaveLength(12);
    expect(await B.engine.conflicts()).toHaveLength(12);
  });

  it('the upload fails AFTER this device was overwritten: the overwritten versions are already saved, and the retry does not duplicate them', async () => {
    const { remote, A, B, ids } = await clash(40, 'A-wins');
    await A.engine.sync();
    await B.d.contacts.add({ name: 'New only on B' } as never); // forces an upload from B, which then fails
    remote.failNextPut = 'network';
    await expect(B.engine.sync()).rejects.toThrow(/network down/);
    expect(await B.engine.conflicts()).toHaveLength(40); // saved even though the sync failed
    expect((await B.d.contacts.get(ids[0]))?.name).toBe(`A edit of ${ids[0]}`); // B was overwritten, so keeping them mattered
    await B.engine.sync(); // retry succeeds
    expect(await B.engine.conflicts()).toHaveLength(40); // still exactly 40
    await A.engine.sync();
    expect((await A.d.contacts.toArray()).some((c) => c.name === 'New only on B')).toBe(true);
  });

  it('another device syncs at the same moment (version race): the merge is retried and the same clashes are not saved twice', async () => {
    const { remote, A, B } = await clash(45, 'B-wins'); // B wins, so B must upload
    await A.engine.sync();
    remote.failNextPut = 'race'; // first upload is refused as stale; the engine merges again
    const out = await B.engine.sync();
    expect(out.pushed).toBe(true);
    const kept = await B.engine.conflicts();
    expect(kept).toHaveLength(45);
    expect(new Set(kept.map(conflictKey)).size).toBe(45);
  });

  it('a wrong passphrase or a damaged remote file changes nothing, and the saved list is intact', async () => {
    const { remote, A, B } = await clash(30, 'A-wins');
    await A.engine.sync();
    await B.engine.sync();
    expect(await B.engine.conflicts()).toHaveLength(30);
    const wrong = new SyncEngine(B.d, dexieMeta(B.metaName), remote, 'not the passphrase');
    await expect(wrong.sync()).rejects.toThrow(/Wrong sync passphrase/);
    const saved = remote.file!;
    remote.file = { sha: saved.sha, bytes: new Uint8Array(200) }; // garbage
    await expect(B.engine.sync()).rejects.toThrow(/not a Ledger sync file/);
    remote.file = saved;
    expect(await B.engine.conflicts()).toHaveLength(30);
  });
});

describe('SY-01 the saved list cannot be shortened by accident', () => {
  const mk = (id: number, stamp: number): Conflict => ({ table: 'contacts', id: String(id), label: `P${id}`, kept: 'other device', at: 1, lost: { id, updatedAt: stamp, name: `v${stamp}` } });

  it('an old copy of the list held by a screen cannot be written back over newer entries: removing by key reads the CURRENT list', async () => {
    const meta = dexieMeta(uniq());
    await addConflicts(meta, [mk(1, 10), mk(2, 10)]);
    const stale = await readConflicts(meta); // a screen drew this
    await addConflicts(meta, [mk(3, 20), mk(4, 20)]); // a sync finished afterwards
    await removeConflict(meta, conflictKey(stale[0])); // the owner puts back one from the old screen
    const now = await readConflicts(meta);
    expect(now).toHaveLength(3);
    expect(now.map((c) => c.id).sort()).toEqual(['1', '2', '3', '4'].filter((x) => x !== stale[0].id).sort()); // only the one asked for is gone; entries 3 and 4 (newer than the screen) survive
  });

  it('adding is idempotent for the same overwritten version, never truncates, and queued changes do not interleave', async () => {
    const meta = dexieMeta(uniq());
    const batch = Array.from({ length: 300 }, (_, i) => mk(i, 5));
    expect(await addConflicts(meta, batch)).toBe(300);
    expect(await addConflicts(meta, batch)).toBe(0); // the same versions again: not added twice
    await Promise.all([addConflicts(meta, [mk(1000, 7)]), removeConflict(meta, conflictKey(batch[0])), addConflicts(meta, [mk(1001, 7)])]);
    expect(await readConflicts(meta)).toHaveLength(301);
    await clearConflicts(meta);
    expect(await readConflicts(meta)).toEqual([]);
  });

  it('two DIFFERENT overwritten versions of the same record are both kept', async () => {
    const meta = dexieMeta(uniq());
    await addConflicts(meta, [mk(9, 10)]);
    await addConflicts(meta, [mk(9, 11)]);
    expect(await readConflicts(meta)).toHaveLength(2);
  });
});
