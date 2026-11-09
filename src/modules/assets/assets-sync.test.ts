import { describe, expect, it } from 'vitest';
import { FinanceDB } from '../../db';
import { repo } from '../../core/store';
import type { ModuleRecord } from '../../core/entities';
import { dexieMeta, RemoteConflict, SyncEngine, type RemoteFile, type RemoteStore } from '../../lib/sync/engine';
import { mergeSnapshots } from '../../lib/sync/merge';
import { installTracking, touchAll } from '../../lib/sync/track';
import { archiveAsset, createAsset, getAsset, loadAssets, updateAsset } from './data';
import { blankAsset } from './model';
import { deleteAssetPermanently } from './deletion';

/** Real SyncEngine and mergeSnapshots with two devices. Invented data only. */
let n = 0;
const fresh = () => { const d = new FinanceDB(`test-assets-sync-${n++}`); installTracking(d); return d; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const mk = (d: FinanceDB, name: string, over = {}) => createAsset(blankAsset({ name, ...over }), d);
const raw = (d: FinanceDB, id: number) => d.moduleRecords.get(id) as Promise<{ data: Record<string, unknown>; deletedAt?: number | null }>;

function remoteStore() {
  const r = {
    puts: 0, file: null as RemoteFile | null,
    async getFile() { return r.file ? { sha: r.file.sha, bytes: r.file.bytes.slice() } : null; },
    async putFile(bytes: Uint8Array, sha: string | undefined) {
      if ((r.file?.sha ?? undefined) !== sha) throw new RemoteConflict('stale');
      r.puts++;
      r.file = { sha: `sha${r.puts}`, bytes: bytes.slice() };
      return r.file.sha;
    },
  };
  return r satisfies RemoteStore;
}
const devices = () => {
  const remote = remoteStore();
  const mkd = () => { const d = fresh(); return { d, engine: new SyncEngine(d, dexieMeta(`assets-meta-${n++}`), remote, 'a good passphrase') }; };
  return { A: mkd(), B: mkd() };
};
type Dev = ReturnType<typeof devices>['A'];
const full = async (A: Dev, B: Dev, rounds = 2) => { for (let i = 0; i < rounds; i++) { await A.engine.sync(); await B.engine.sync(); } await A.engine.sync(); };
const everywhere = (xs: Dev[], check: (d: FinanceDB) => Promise<void>) => Promise.all(xs.map((x) => check(x.d)));

/** A makes a clean asset "Mistake" and an unrelated "Other"; both devices hold them. */
async function seeded() {
  const { A, B } = devices();
  const x = await mk(A.d, 'Mistake');
  const other = await mk(A.d, 'Other');
  await A.engine.initialUpload();
  await B.engine.replaceFromRemote();
  return { A, B, x, other };
}

describe('H1: a permanently deleted asset stays deleted across devices (real sync engine and merge)', () => {
  it('a. an older edit made on the other device before the deletion does not bring it back', async () => {
    const { A, B, x } = await seeded();
    await updateAsset(x, { ...(await getAsset(x, B.d))!.data, name: 'Renamed on B' }, B.d);
    await sleep(15);
    await deleteAssetPermanently(x, A.d);
    await B.engine.sync(); await A.engine.sync(); await B.engine.sync();
    await everywhere([A, B], async (d) => expect(await getAsset(x, d)).toBeUndefined());
  });

  it('b. a NEWER edit against the stale copy, pushed first, does not either', async () => {
    const { A, B, x } = await seeded();
    await deleteAssetPermanently(x, A.d);
    await sleep(15);
    await updateAsset(x, { ...(await getAsset(x, B.d))!.data, name: 'Edited later on B' }, B.d);
    await B.engine.sync(); await A.engine.sync(); await B.engine.sync();
    await everywhere([A, B], async (d) => { expect(await getAsset(x, d)).toBeUndefined(); expect((await raw(d, x)).deletedAt).toBeGreaterThan(0); });
  });

  it('c. repeated syncs from both devices keep it deleted', async () => {
    const { A, B, x } = await seeded();
    await deleteAssetPermanently(x, A.d);
    await sleep(15);
    await updateAsset(x, { ...(await getAsset(x, B.d))!.data, notes: 'late' }, B.d);
    await full(A, B, 3);
    await everywhere([A, B], async (d) => expect(await getAsset(x, d)).toBeUndefined());
    await full(A, B, 2);
    await everywhere([A, B], async (d) => expect(await getAsset(x, d)).toBeUndefined());
  });

  it('d. a child made on the stale device keeps the asset alive, and nothing is lost', async () => {
    const { A, B, x } = await seeded();
    await deleteAssetPermanently(x, A.d);
    await sleep(15);
    const child = await mk(B.d, 'Added on B', { parentId: x });
    await full(A, B, 2);
    await everywhere([A, B], async (d) => {
      expect((await getAsset(x, d))?.data.name).toBe('Mistake');
      expect((await getAsset(child, d))?.data.parentId).toBe(x);
    });
  });

  it('e. a service or warranty record made on the stale device keeps the asset alive', async () => {
    for (const kind of ['service', 'warranty']) {
      const { A, B, x } = await seeded();
      await deleteAssetPermanently(x, A.d);
      await sleep(15);
      const rec = await repo<ModuleRecord>(B.d.moduleRecords).put({ module: 'assets', kind, data: { assetId: x, title: 'Fixed' } });
      await full(A, B, 2);
      await everywhere([A, B], async (d) => { expect(await getAsset(x, d), kind).toBeDefined(); expect(await raw(d, rec)).toBeDefined(); });
    }
  });

  it('f. a parent / child / grandchild chain gives the same answer whichever device syncs first', async () => {
    for (const order of ['A first', 'B first']) {
      const { A, B } = devices();
      const top = await mk(A.d, 'Top'), mid = await mk(A.d, 'Mid', { parentId: top }), low = await mk(A.d, 'Low', { parentId: mid });
      await A.engine.initialUpload();
      await B.engine.replaceFromRemote();
      await deleteAssetPermanently(low, A.d); await deleteAssetPermanently(mid, A.d); await deleteAssetPermanently(top, A.d);
      await sleep(15);
      const added = await mk(B.d, 'Added under Low', { parentId: low }); // B has not heard of any deletion
      if (order === 'A first') { await A.engine.sync(); await B.engine.sync(); } else { await B.engine.sync(); await A.engine.sync(); }
      await full(A, B, 2);
      await everywhere([A, B], async (d) => {
        for (const id of [top, mid, low, added]) expect(await getAsset(id, d), `${order} ${id}`).toBeDefined();
      });
    }
  });

  it('g. archive and restore are still last-writer-wins across devices', async () => {
    const { A, B, other } = await seeded();
    await archiveAsset(other, A.d);
    await sleep(15);
    await updateAsset(other, { ...(await getAsset(other, B.d))!.data, notes: 'newer on B' }, B.d);
    await full(A, B, 2);
    await everywhere([A, B], async (d) => expect((await getAsset(other, d))?.data).toMatchObject({ archived: false, notes: 'newer on B' }));
  });

  it('h. an ordinary removal (Add-box Undo style) is NOT protected: a newer edit elsewhere wins', async () => {
    const { A, B, other } = await seeded();
    await repo<ModuleRecord>(A.d.moduleRecords).remove(other);
    await sleep(15);
    await updateAsset(other, { ...(await getAsset(other, B.d))!.data, notes: 'kept' }, B.d);
    await full(A, B, 2);
    await everywhere([A, B], async (d) => expect(await getAsset(other, d)).toBeDefined());
  });

  it('i. an intentional backup restore still wins over the deletion', async () => {
    const { A, B, x } = await seeded();
    await deleteAssetPermanently(x, A.d);
    await A.engine.sync();
    await sleep(15);
    await touchAll(B.d); // what a restore does when sync is on
    await full(A, B, 2);
    await everywhere([A, B], async (d) => expect(await getAsset(x, d)).toBeDefined());
  });

  it('j. unrelated assets merge exactly as before (later edit wins)', async () => {
    const { A, B, x, other } = await seeded();
    await updateAsset(other, { ...(await getAsset(other, A.d))!.data, notes: 'from A' }, A.d);
    await sleep(15);
    await updateAsset(other, { ...(await getAsset(other, B.d))!.data, notes: 'from B' }, B.d);
    await deleteAssetPermanently(x, A.d);
    await full(A, B, 2);
    await everywhere([A, B], async (d) => {
      expect((await getAsset(other, d))?.data.notes).toBe('from B');
      expect(await getAsset(x, d)).toBeUndefined();
      expect((await loadAssets(d)).map((a) => a.id)).toEqual([other]);
    });
  });
});

describe('H1 prerequisite: readable conflict labels for module records', () => {
  const snap = (id: string, data: Record<string, unknown>, updatedAt: number) => ({ tables: { moduleRecords: { [id]: { id: Number(id), module: 'assets', kind: 'asset', data, updatedAt } } }, tombstones: {} });
  const merge = (l: Record<string, unknown>, r: Record<string, unknown>) =>
    mergeSnapshots({ local: snap('1', l, 200), remote: snap('1', r, 300), base: { moduleRecords: ['1'] }, lastSync: 100, now: 1_000_000 });
  it('names the record from data.name, then data.title, and falls back to #id', () => {
    expect(merge({ name: 'Furnace' }, { name: 'Boiler' }).conflicts[0].label).toBe('Furnace');
    expect(merge({ title: 'Replace filter' }, { title: 'x' }).conflicts[0].label).toBe('Replace filter');
    expect(merge({ name: '  ' }, { name: '' }).conflicts[0].label).toBe('#1');
    expect(merge({ name: 5 }, { name: 6 }).conflicts[0].label).toBe('#1');
  });
});
