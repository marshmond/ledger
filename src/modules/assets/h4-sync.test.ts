import { describe, expect, it } from 'vitest';
import { FinanceDB } from '../../db';
import { repo } from '../../core/store';
import type { ModuleRecord } from '../../core/entities';
import { dexieMeta, RemoteConflict, SyncEngine, type RemoteFile, type RemoteStore } from '../../lib/sync/engine';
import { installTracking, touchAll } from '../../lib/sync/track';
import { exportAll, importAll } from '../../lib/backup';
import { checkBackupText } from '../../lib/backupFile';
import { createTask, getTask } from '../tasks/data';
import { blankTask } from '../tasks/model';
import { assetRef, createAsset, getAsset, loadAssets, loadLinkedWork, updateAsset } from './data';
import { deleteAssetPermanently, planAssetDeletion } from './deletion';
import { applyRetirement, type RetireRequest } from './lifecycle';
import { blankAsset } from './model';
import { detectOrphans, rehomeOrphan } from './orphans';
import { blankService } from './service';
import { createService, loadServicesFor } from './serviceData';
import { blankWarranty } from './warranty';
import { createWarranty, deleteWarranty, getWarranty, loadWarrantiesFor, updateWarranty } from './warrantyData';

/** Real SyncEngine and merge with two devices (same set-up as assets-sync.test.ts). Invented data only. */
let n = 0;
const fresh = () => { const d = new FinanceDB(`test-h4-sync-${n++}`); installTracking(d); return d; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const TODAY = '2026-11-06';
const mk = (d: FinanceDB, name: string, over = {}) => createAsset(blankAsset({ name, ...over }), d);
const war = (assetId: number, title = 'Manufacturer warranty') => blankWarranty(assetId, { title, endDate: '2027-03-01' });
const req = (assetId: number, over: Partial<RetireRequest> = {}): RetireRequest => ({ assetId, status: 'replaced', statusDate: TODAY, statusNote: '', replacement: { kind: 'none' }, descendantIds: [], taskActions: {}, ...over });

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
  const mkd = () => { const d = fresh(); return { d, engine: new SyncEngine(d, dexieMeta(`h4-meta-${n++}`), remote, 'a good passphrase') }; };
  return { A: mkd(), B: mkd() };
};
type Dev = ReturnType<typeof devices>['A'];
const settle = async (A: Dev, B: Dev) => { for (let i = 0; i < 2; i++) { await A.engine.sync(); await B.engine.sync(); } await A.engine.sync(); };
const everywhere = (xs: Dev[], check: (d: FinanceDB) => Promise<void>) => Promise.all(xs.map((x) => check(x.d)));

async function seeded() {
  const { A, B } = devices();
  const x = await mk(A.d, 'Furnace');
  const other = await mk(A.d, 'Boiler');
  await A.engine.initialUpload();
  await B.engine.replaceFromRemote();
  return { A, B, x, other };
}

describe('H4 warranties and lifecycle across two devices (real sync engine)', () => {
  it('a. a warranty added on one device and asset metadata changed on the other both survive', async () => {
    const { A, B, x } = await seeded();
    const w = await createWarranty(war(x), A.d);
    await sleep(15);
    await updateAsset(x, { ...(await getAsset(x, B.d))!.data, notes: 'edited on B' }, B.d);
    await settle(A, B);
    await everywhere([A, B], async (d) => {
      expect((await getAsset(x, d))!.data.notes).toBe('edited on B');
      expect((await getWarranty(w, d))!.data.title).toBe('Manufacturer warranty');
    });
  });

  it('b. a warranty made on a stale device keeps the asset alive that another device deleted permanently', async () => {
    const { A, B, x } = await seeded();
    await deleteAssetPermanently(x, A.d);
    await sleep(15);
    const w = await createWarranty(war(x), B.d); // B has not heard yet
    await settle(A, B);
    await everywhere([A, B], async (d) => {
      expect(await getAsset(x, d)).toBeDefined();
      expect((await getWarranty(w, d))!.data.assetId).toBe(x);
    });
    expect((await planAssetDeletion(x, A.d)).canDelete).toBe(false);
    expect(await detectOrphans(A.d)).toEqual([]); // nothing is orphaned
  });

  it('c. same when the warranty was made BEFORE the deletion but synced after; and deleting the warranty first lets the deletion hold', async () => {
    const { A, B, x, other } = await seeded();
    const w = await createWarranty(war(x), B.d);
    await sleep(15);
    await deleteAssetPermanently(x, A.d);
    await settle(A, B);
    await everywhere([A, B], async (d) => { expect(await getAsset(x, d)).toBeDefined(); expect(await getWarranty(w, d)).toBeDefined(); });
    // the owner deletes the warranty, then the asset: the deletion now holds everywhere
    await deleteWarranty(w, A.d);
    await deleteAssetPermanently(x, A.d);
    await sleep(15);
    await settle(A, B);
    await everywhere([A, B], async (d) => { expect(await getAsset(x, d)).toBeUndefined(); expect(await getAsset(other, d)).toBeDefined(); });
  });

  it('d. warranties edited on two devices at once keep the later edit; a deletion on one device syncs', async () => {
    const { A, B, x } = await seeded();
    const w = await createWarranty(war(x), A.d);
    await settle(A, B);
    await updateWarranty(w, { ...(await getWarranty(w, A.d))!.data, coverageNotes: 'from A' }, A.d);
    await sleep(15);
    await updateWarranty(w, { ...(await getWarranty(w, B.d))!.data, coverageNotes: 'from B' }, B.d);
    await settle(A, B);
    await everywhere([A, B], async (d) => expect((await getWarranty(w, d))!.data.coverageNotes).toBe('from B'));
    await sleep(15);
    await deleteWarranty(w, A.d);
    await settle(A, B);
    await everywhere([A, B], async (d) => expect(await loadWarrantiesFor(x, d)).toEqual([]));
  });

  it('e. a replacement made offline on A while B edits an older copy of the old asset: the new asset always survives and no pointer dangles', async () => {
    const { A, B, x } = await seeded();
    await sleep(15);
    const r = await applyRetirement(req(x, { replacement: { kind: 'new', data: blankAsset({ name: 'Furnace 2', type: 'system' }) } }), A.d);
    await sleep(15);
    await updateAsset(x, { ...(await getAsset(x, B.d))!.data, notes: 'edited on B later' }, B.d); // B's later edit wins the old record (document: last writer wins)
    await settle(A, B);
    await everywhere([A, B], async (d) => {
      expect(await getAsset(r.newAssetId!, d)).toBeDefined();
      const old = (await getAsset(x, d))!;
      expect(old.data.notes).toBe('edited on B later');
      expect(old.data.replacedById === null || old.data.replacedById === r.newAssetId).toBe(true);
      expect(await detectOrphans(d)).toEqual([]);
    });
    // and the other order: A's replacement is later than B's edit
    const { A: A2, B: B2, x: x2 } = await seeded();
    await updateAsset(x2, { ...(await getAsset(x2, B2.d))!.data, notes: 'edited on B first' }, B2.d);
    await sleep(15);
    const r2 = await applyRetirement(req(x2, { replacement: { kind: 'new', data: blankAsset({ name: 'Furnace 2', type: 'system' }) } }), A2.d);
    await settle(A2, B2);
    await everywhere([A2, B2], async (d) => { expect((await getAsset(x2, d))!.data).toMatchObject({ status: 'replaced', replacedById: r2.newAssetId }); });
  });

  it('f. two devices replacing the same asset differently: one pointer wins everywhere, both new assets exist, nothing is orphaned or lost', async () => {
    const { A, B, x } = await seeded();
    const ra = await applyRetirement(req(x, { replacement: { kind: 'new', data: blankAsset({ name: 'Furnace from A', type: 'system' }) } }), A.d);
    await sleep(15);
    const rb = await applyRetirement(req(x, { replacement: { kind: 'new', data: blankAsset({ name: 'Furnace from B', type: 'system' }) } }), B.d);
    await settle(A, B);
    await everywhere([A, B], async (d) => {
      const names = (await loadAssets(d)).map((a) => a.data.name).sort();
      expect(names).toEqual(['Boiler', 'Furnace', 'Furnace 2'.replace('Furnace 2', 'Furnace from A'), 'Furnace from B'].sort());
      const old = (await getAsset(x, d))!;
      expect(old.data.status).toBe('replaced');
      expect([ra.newAssetId, rb.newAssetId]).toContain(old.data.replacedById);
      expect(await detectOrphans(d)).toEqual([]);
    });
  });

  it('g. bulk retirement on A and a later rename of one child on B: each record keeps its own last writer; the property stays retired', async () => {
    const { A, B } = devices();
    const home = await mk(A.d, 'Test House', { type: 'property' });
    const kitchen = await mk(A.d, 'Kitchen', { type: 'area', parentId: home });
    const dish = await mk(A.d, 'Dishwasher', { type: 'appliance', parentId: kitchen });
    await A.engine.initialUpload();
    await B.engine.replaceFromRemote();
    await applyRetirement(req(home, { status: 'sold', descendantIds: [kitchen, dish] }), A.d);
    await sleep(15);
    await updateAsset(dish, { ...(await getAsset(dish, B.d))!.data, name: 'Dishwasher (renamed)' }, B.d);
    await settle(A, B);
    await everywhere([A, B], async (d) => {
      expect((await getAsset(home, d))!.data.status).toBe('sold');
      expect((await getAsset(kitchen, d))!.data.status).toBe('sold');
      expect((await getAsset(dish, d))!.data.name).toBe('Dishwasher (renamed)');
      expect((await getAsset(dish, d))!.data.parentId).toBe(kitchen); // structure never changes
    });
  });

  it('h. an orphan made by an ordinary removal plus a stale device: repair on one device, then sync, resolves it everywhere', async () => {
    const { A, B, x, other } = await seeded();
    await repo<ModuleRecord>(A.d.moduleRecords).remove(x); // ordinary removal (no permanent marker, no protection)
    await sleep(15);
    const sid = await createService(blankService(x, { title: 'Pump', date: '2026-05-05' }), B.d, TODAY);
    const t = await createTask(blankTask({ title: 'Check filter', dueDate: '2026-12-01' }), [assetRef(x)], B.d);
    await settle(A, B);
    await everywhere([A, B], async (d) => {
      const o = await detectOrphans(d);
      expect(o.map((v) => [v.kind, v.why]).sort()).toEqual([['link', 'removed'], ['service', 'removed']]);
    });
    for (const o of await detectOrphans(A.d)) await rehomeOrphan(o, other, A.d);
    await settle(A, B);
    await everywhere([A, B], async (d) => {
      expect(await detectOrphans(d)).toEqual([]);
      expect((await loadServicesFor(other, d)).map((s) => s.id)).toEqual([sid]);
      expect((await loadLinkedWork(other, d)).openTasks.map((v) => v.id)).toEqual([t]);
      expect((await getTask(t, d))!.data.title).toBe('Check filter');
    });
  });

  it('i. a record that arrives before its asset (temporarily missing) is reported as "absent", nothing is changed, and sync resolves it', async () => {
    const { A, B, x } = await seeded();
    const sid = await createService(blankService(x, { title: 'Pump', date: '2026-05-05' }), A.d, TODAY);
    await A.engine.sync();
    await B.engine.sync();
    // Simulate the asset not having reached B yet (it is simply not on this device).
    await B.d.moduleRecords.delete(x);
    const o = await detectOrphans(B.d);
    expect(o.map((v) => [v.kind, v.why])).toEqual([['service', 'absent']]);
    expect((await loadServicesFor(x, B.d)).length).toBe(1); // untouched: no auto-delete, no auto-move
    // the asset then arrives with the next full copy from the other device: the orphan disappears by itself
    await B.engine.replaceFromRemote();
    expect(await detectOrphans(B.d)).toEqual([]);
    expect(await getAsset(x, B.d)).toBeDefined();
    expect((await loadServicesFor(x, B.d)).map((s) => s.id)).toEqual([sid]);
  });

  it('j. backup restore: warranties come back with the restored database, and an intentional restore still revives a deleted asset', async () => {
    const { A, B, x } = await seeded();
    const w = await createWarranty(war(x), A.d);
    const text = JSON.stringify(await exportAll(A.d));
    await settle(A, B);
    await deleteWarranty(w, A.d);
    await deleteAssetPermanently(x, A.d);
    await settle(A, B);
    await sleep(15);
    // restore the old backup on B (what Restore does), then stamp for sync
    await importAll(B.d, checkBackupText(text).file);
    await touchAll(B.d);
    await settle(A, B);
    await everywhere([A, B], async (d) => {
      expect(await getAsset(x, d)).toBeDefined();
      expect((await getWarranty(w, d))!.data.title).toBe('Manufacturer warranty');
    });
  });
});
