import { describe, expect, it } from 'vitest';
import { FinanceDB } from '../../db';
import { dexieMeta, RemoteConflict, SyncEngine, type RemoteFile, type RemoteStore } from '../../lib/sync/engine';
import { installTracking } from '../../lib/sync/track';
import { createTask, completeTask, getTask, removeTasks } from '../tasks/data';
import { blankTask } from '../tasks/model';
import { assetRef, createAsset, getAsset, loadLinkedWork } from './data';
import { blankAsset } from './model';
import { deleteAssetPermanently, planAssetDeletion } from './deletion';
import { duplicateTaskGroups, summarize, unsavedTasks } from './maintenance';
import { blankService } from './service';
import { createService, deleteService, getService, loadServices, logTaskService, updateService } from './serviceData';

/** Real SyncEngine and mergeSnapshots with two devices (the same set-up as assets-sync.test.ts). Invented data only. */
let n = 0;
const fresh = () => { const d = new FinanceDB(`test-service-sync-${n++}`); installTracking(d); return d; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const TODAY = '2026-11-06';
const mk = (d: FinanceDB, name: string) => createAsset(blankAsset({ name }), d);
const svc = (assetId: number, title = 'Replaced filter') => blankService(assetId, { title, date: '2026-11-01' });

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
  const mkd = () => { const d = fresh(); return { d, engine: new SyncEngine(d, dexieMeta(`svc-meta-${n++}`), remote, 'a good passphrase') }; };
  return { A: mkd(), B: mkd() };
};
type Dev = ReturnType<typeof devices>['A'];
const settle = async (A: Dev, B: Dev) => { await A.engine.sync(); await B.engine.sync(); await A.engine.sync(); await B.engine.sync(); await A.engine.sync(); };
const everywhere = (xs: Dev[], check: (d: FinanceDB) => Promise<void>) => Promise.all(xs.map((x) => check(x.d)));

async function seeded() {
  const { A, B } = devices();
  const x = await mk(A.d, 'Furnace');
  const other = await mk(A.d, 'Boiler');
  await A.engine.initialUpload();
  await B.engine.replaceFromRemote();
  return { A, B, x, other };
}

describe('H2: service history across two devices (real sync engine and merge)', () => {
  it('a. service records sync as independent records, edits included, and a deletion syncs', async () => {
    const { A, B, x } = await seeded();
    const s1 = await createService(svc(x, 'From A'), A.d, TODAY);
    const s2 = await createService(svc(x, 'From B'), B.d, TODAY);
    await settle(A, B);
    await everywhere([A, B], async (d) => { expect((await loadServices(d)).map((s) => s.data.title).sort()).toEqual(['From A', 'From B']); });
    await sleep(15);
    await updateService(s1, { ...(await getService(s1, B.d))!.data, notes: 'edited on B' }, B.d, TODAY);
    await deleteService(s2, A.d);
    await settle(A, B);
    await everywhere([A, B], async (d) => {
      expect((await getService(s1, d))!.data.notes).toBe('edited on B');
      expect(await getService(s2, d)).toBeUndefined();
    });
  });

  it('b. a service record made on a stale device keeps the asset alive that another device deleted permanently', async () => {
    const { A, B, x } = await seeded();
    await deleteAssetPermanently(x, A.d); // A: clean asset, deleted for good
    await sleep(15);
    const sid = await createService(svc(x), B.d, TODAY); // B has not heard yet
    await A.engine.sync(); await B.engine.sync(); await A.engine.sync(); await B.engine.sync(); await A.engine.sync();
    await everywhere([A, B], async (d) => {
      expect(await getAsset(x, d)).toBeDefined(); // history is never orphaned
      expect((await getService(sid, d))!.data.assetId).toBe(x);
    });
    // and the owner now sees the asset is blocked from deletion
    expect((await planAssetDeletion(x, A.d)).canDelete).toBe(false);
  });

  it('c. same, when the service record was made BEFORE the deletion but synced after', async () => {
    const { A, B, x } = await seeded();
    const sid = await createService(svc(x), B.d, TODAY);
    await sleep(15);
    await deleteAssetPermanently(x, A.d);
    await B.engine.sync(); await A.engine.sync(); await B.engine.sync(); await A.engine.sync();
    await everywhere([A, B], async (d) => { expect(await getAsset(x, d)).toBeDefined(); expect(await getService(sid, d)).toBeDefined(); });
  });

  it('d. with no history anywhere, the permanent deletion still holds (H1 rule unchanged)', async () => {
    const { A, B, x, other } = await seeded();
    await createService(svc(other), A.d, TODAY); // history on an unrelated asset
    await deleteAssetPermanently(x, A.d);
    await sleep(15);
    await B.engine.sync(); await A.engine.sync(); await B.engine.sync();
    await everywhere([A, B], async (d) => { expect(await getAsset(x, d)).toBeUndefined(); expect(await getAsset(other, d)).toBeDefined(); });
  });

  it('e. a task deleted or renamed on another device leaves the saved record and its snapshot readable', async () => {
    const { A, B, x } = await seeded();
    const t = await createTask(blankTask({ title: 'Service furnace', dueDate: '2026-11-10' }), [assetRef(x)], A.d);
    await A.engine.sync(); await B.engine.sync();
    const { serviceId } = await logTaskService({ taskId: t, data: svc(x, 'Serviced'), complete: true, today: TODAY }, A.d);
    await sleep(15);
    await removeTasks([t], B.d);
    await settle(A, B);
    await everywhere([A, B], async (d) => {
      expect((await getService(serviceId, d))!.data).toMatchObject({ taskTitleSnapshot: 'Service furnace', title: 'Serviced', taskId: t });
    });
  });

  it('f. two devices saving the same completed task offline: both records survive (nothing silently lost) and the task is no longer "unsaved"', async () => {
    const { A, B, x } = await seeded();
    const t = await createTask(blankTask({ title: 'Test alarms', dueDate: '2026-11-03' }), [assetRef(x)], A.d);
    await completeTask(t, TODAY, A.d);
    await A.engine.sync(); await B.engine.sync();
    await logTaskService({ taskId: t, data: svc(x, 'Saved on A'), complete: false, today: TODAY }, A.d);
    await logTaskService({ taskId: t, data: svc(x, 'Saved on B'), complete: false, today: TODAY }, B.d); // B has not seen A's record
    await settle(A, B);
    await everywhere([A, B], async (d) => {
      const all = await loadServices(d);
      expect(all.filter((s) => s.data.taskId === t)).toHaveLength(2); // a known limit: two devices offline can both save once
      expect(unsavedTasks((await loadLinkedWork(x, d)).completedTasks, all)).toHaveLength(0);
      const groups = duplicateTaskGroups(all);
      expect(groups).toHaveLength(1); // detected, on both devices, from the shared task id
      expect(groups[0].map((r) => r.data.title).sort()).toEqual(['Saved on A', 'Saved on B']);
      const sm = summarize([], (await loadLinkedWork(x, d)).completedTasks, all, TODAY);
      expect(sm.needsAttention).toBe(0);
      expect(sm.lastServiced).toMatchObject({ date: '2026-11-01' }); // one date, not doubled
      expect((await planAssetDeletion(x, d)).canDelete).toBe(false); // protection stays while either record is live
      expect((await getTask(t, d))!.data.status).toBe('done');
    });
  });

  it('f2. deleting the erroneous duplicate on one device clears the warning everywhere; the other record and the task are untouched', async () => {
    const { A, B, x } = await seeded();
    const t = await createTask(blankTask({ title: 'Test alarms', dueDate: '2026-11-03' }), [assetRef(x)], A.d);
    await completeTask(t, TODAY, A.d);
    await A.engine.sync(); await B.engine.sync();
    const a = (await logTaskService({ taskId: t, data: svc(x, 'Saved on A'), complete: false, today: TODAY }, A.d)).serviceId;
    const b = (await logTaskService({ taskId: t, data: svc(x, 'Saved on B'), complete: false, today: TODAY }, B.d)).serviceId;
    await settle(A, B);
    await sleep(15);
    await deleteService(b, A.d);
    await settle(A, B);
    await everywhere([A, B], async (d) => {
      const all = await loadServices(d);
      expect(all.map((r) => r.id)).toEqual([a]);
      expect(duplicateTaskGroups(all)).toHaveLength(0);
      expect((await getTask(t, d))!.data.status).toBe('done');
    });
  });

  it('f3. two separate jobs with the same title and date but no shared task are NOT flagged', async () => {
    const { A, B, x } = await seeded();
    await createService(svc(x, 'Same title'), A.d, TODAY);
    await createService(svc(x, 'Same title'), B.d, TODAY);
    await settle(A, B);
    await everywhere([A, B], async (d) => { expect(await loadServices(d)).toHaveLength(2); expect(duplicateTaskGroups(await loadServices(d))).toHaveLength(0); });
  });

  it('g. a failed deletion attempt on a device with history changes nothing, there or after sync', async () => {
    const { A, B, x } = await seeded();
    const sid = await createService(svc(x), A.d, TODAY);
    await A.engine.sync(); await B.engine.sync();
    await expect(deleteAssetPermanently(x, B.d)).rejects.toThrow(/cannot be deleted/);
    await settle(A, B);
    await everywhere([A, B], async (d) => { expect(await getAsset(x, d)).toBeDefined(); expect(await getService(sid, d)).toBeDefined(); });
  });
});
