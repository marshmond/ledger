import { describe, expect, it } from 'vitest';
import { FinanceDB } from '../../db';
import { exportAll, importAll } from '../../lib/backup';
import { checkBackupText } from '../../lib/backupFile';
import { dexieMeta, RemoteConflict, SyncEngine, type RemoteFile, type RemoteStore } from '../../lib/sync/engine';
import { installTracking, touchAll } from '../../lib/sync/track';
import { createAsset } from '../assets/data';
import { blankAsset } from '../assets/model';
import { loadTasks } from '../tasks/data';
import { applyLifecycle, planLifecycle } from './changes';
import { createArrangement, getArrangement, linkedAssetIds, loadArrangements, tasksOfArrangement, updateArrangement } from './data';
import { blankArrangement, type Cadence } from './model';
import { scheduleHealth } from './schedule';

/** Real SyncEngine and merge with two devices (same set-up as the Home & Assets sync tests). Invented data only. */
let n = 0;
const fresh = () => { const d = new FinanceDB(`test-svc-sync-${n++}`); installTracking(d); return d; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const TODAY = '2026-11-06';
const cadence: Cadence = { mode: 'fixed', rule: { freq: 'weekly', interval: 2, end: { type: 'never' } }, anchorDate: TODAY };

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
  const mk = () => { const d = fresh(); return { d, engine: new SyncEngine(d, dexieMeta(`svc-meta-${n++}`), remote, 'a good passphrase') }; };
  return { A: mk(), B: mk() };
};
type Dev = ReturnType<typeof devices>['A'];
const settle = async (A: Dev, B: Dev) => { for (let i = 0; i < 2; i++) { await A.engine.sync(); await B.engine.sync(); } await A.engine.sync(); };
const everywhere = (xs: Dev[], check: (d: FinanceDB) => Promise<void>) => Promise.all(xs.map((x) => check(x.d)));

async function seeded() {
  const { A, B } = devices();
  const house = await createAsset(blankAsset({ name: 'Main house', type: 'property' }), A.d);
  const r = await createArrangement({ data: blankArrangement({ title: 'House cleaning', cadence }), provider: { name: "Rosa's Cleaning" }, assetIds: [house], today: TODAY }, A.d);
  await A.engine.initialUpload();
  await B.engine.replaceFromRemote();
  return { A, B, house, r };
}
const lc = async (d: FinanceDB, id: number, action: 'pause' | 'resume' | 'end', taskChoice?: 'remove' | 'keep' | 'stop') => {
  const plan = await planLifecycle(id, action, TODAY, d);
  return applyLifecycle({ action, arrangementId: id, expect: plan.expect, today: TODAY, taskChoice }, d);
};
const open = async (d: FinanceDB, id: number) => (await tasksOfArrangement(id, d)).filter((t) => t.data.status !== 'done');

describe('Household Services across two devices (real sync engine)', () => {
  it('the schema is still Dexie v15 and no table was added', () => {
    const d = fresh();
    expect(d.verno).toBe(15);
    expect(d.tables.map((t) => t.name).sort()).not.toContain('services');
  });
  it('a. arrangement, its task, provider contact and asset link all arrive on the second device', async () => {
    const { A, B, house, r } = await seeded();
    await everywhere([A, B], async (d) => {
      expect((await getArrangement(r.id, d))!.data).toMatchObject({ title: 'House cleaning', providerNameSnapshot: "Rosa's Cleaning" });
      expect(await open(d, r.id)).toHaveLength(1);
      expect(await linkedAssetIds(r.id, d)).toEqual([house]);
      expect(await d.contacts.count()).toBe(1);
    });
  }, 90000);
  it('b. cancelling the arrangement on A while B edits its notes converges: the later write wins whole-record, the task and links are untouched', async () => {
    const { A, B, r } = await seeded();
    await lc(A.d, r.id, 'end', 'stop');
    await sleep(15);
    const b = (await getArrangement(r.id, B.d))!;
    await updateArrangement(r.id, { title: b.data.title, startDate: null, extraContactIds: [], expected: null, refs: [], notes: 'edited on B', assetIds: await linkedAssetIds(r.id, B.d) }, null, B.d);
    await settle(A, B);
    const seen = await Promise.all([A, B].map(async (x) => JSON.stringify((await getArrangement(r.id, x.d))!.data)));
    expect(seen[0]).toBe(seen[1]); // converged
    await everywhere([A, B], async (d) => { expect(await loadArrangements(d)).toHaveLength(1); expect(await open(d, r.id)).toHaveLength(1); });
  }, 90000);
  it('c. both devices Resume offline: after sync BOTH visit tasks are kept and flagged as duplicates; nothing is deleted automatically', async () => {
    const { A, B, r } = await seeded();
    await lc(A.d, r.id, 'pause', 'remove');
    await settle(A, B);
    await everywhere([A, B], async (d) => expect(await open(d, r.id)).toHaveLength(0));
    await lc(A.d, r.id, 'resume');
    await sleep(15);
    await lc(B.d, r.id, 'resume');
    await settle(A, B);
    await everywhere([A, B], async (d) => {
      const tasks = await open(d, r.id);
      expect(tasks).toHaveLength(2);
      const h = scheduleHealth((await getArrangement(r.id, d))!, await tasksOfArrangement(r.id, d));
      expect(h).toMatchObject({ state: 'duplicate-open', needsAttention: true });
      expect(h.taskIds).toHaveLength(2);
    });
    // the extra task is only removed by an explicit choice, never by sync
    expect((await loadTasks(A.d)).filter((t) => t.data.status !== 'done')).toHaveLength(2);
  }, 90000);
  it('d. the task is edited on A while B pauses: both survive (separate records)', async () => {
    const { A, B, r } = await seeded();
    const t = (await open(A.d, r.id))[0];
    await A.d.moduleRecords.update(t.id, { 'data.notes': 'bring ladder', updatedAt: Date.now() });
    await sleep(15);
    await lc(B.d, r.id, 'pause', 'keep');
    await settle(A, B);
    await everywhere([A, B], async (d) => {
      expect((await getArrangement(r.id, d))!.data.status).toBe('paused');
      expect((await open(d, r.id))[0].data.notes).toBe('bring ladder');
    });
  }, 90000);
  it('e. backup and restore bring arrangements, links, task and markers back on a fresh device', async () => {
    const { A, r, house } = await seeded();
    const text = JSON.stringify(await exportAll(A.d));
    const C = fresh();
    await importAll(C, checkBackupText(text).file);
    expect((await getArrangement(r.id, C))!.data.title).toBe('House cleaning');
    expect(await linkedAssetIds(r.id, C)).toEqual([house]);
    const tasks = await open(C, r.id);
    expect(tasks).toHaveLength(1);
    expect(scheduleHealth((await getArrangement(r.id, C))!, tasks).state).toBe('ok'); // markers survived the round trip
    expect(await C.contacts.count()).toBe(1);
    // an intentional restore then sync-stamp does not duplicate anything
    await touchAll(C);
    expect(await loadArrangements(C)).toHaveLength(1);
  }, 90000);
});
