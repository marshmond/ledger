import { describe, expect, it } from 'vitest';
import { FinanceDB } from '../../db';
import { exportAll, importAll } from '../../lib/backup';
import { checkBackupText } from '../../lib/backupFile';
import { dexieMeta, RemoteConflict, SyncEngine, type RemoteFile, type RemoteStore } from '../../lib/sync/engine';
import { installTracking, touchAll } from '../../lib/sync/track';
import { createAsset } from '../assets/data';
import { blankAsset } from '../assets/model';
import { loadTasks, removeTasks, saveTask, getTask } from '../tasks/data';
import { applyLifecycle, planLifecycle } from './changes';
import { createArrangement, getArrangement, tasksOfArrangement } from './data';
import { blankArrangement, type Cadence } from './model';
import { scheduleHealth } from './schedule';
import { duplicateGroups, visitStats } from './visitModel';
import { loadVisits, logVisitFromTask, planLogVisit, unloggedVisits, visitAssetIds, type VisitInput } from './visits';

/** Real SyncEngine and merge with two devices (the same set-up as the Home & Assets and S1 sync tests). Invented data only. */
let n = 0;
const fresh = () => { const d = new FinanceDB(`test-visit-sync-${n++}`); installTracking(d); return d; };
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
  const mk = () => { const d = fresh(); return { d, engine: new SyncEngine(d, dexieMeta(`visit-meta-${n++}`), remote, 'a good passphrase') }; };
  return { A: mk(), B: mk() };
};
type Dev = ReturnType<typeof devices>['A'];
const settle = async (A: Dev, B: Dev) => { for (let i = 0; i < 2; i++) { await A.engine.sync(); await B.engine.sync(); } await A.engine.sync(); };
const everywhere = (xs: Dev[], check: (d: FinanceDB) => Promise<void>) => Promise.all(xs.map((x) => check(x.d)));
const input = (over: Partial<VisitInput> = {}): VisitInput => ({ status: 'completed', cancelledBy: null, date: TODAY, notes: '', chargedCents: null, chargeKind: null, ...over });
async function log(d: FinanceDB, arrId: number, taskId: number, over: Partial<VisitInput> = {}) {
  const inp = input(over);
  const plan = await planLogVisit(arrId, taskId, inp, TODAY, d);
  return logVisitFromTask({ arrangementId: arrId, taskId, input: inp, today: TODAY, expect: plan.expect }, d);
}
const open = async (d: FinanceDB, id: number) => (await tasksOfArrangement(id, d)).filter((t) => t.data.status !== 'done');

async function seeded() {
  const { A, B } = devices();
  const house = await createAsset(blankAsset({ name: 'Main house', type: 'property' }), A.d);
  const r = await createArrangement({ data: blankArrangement({ title: 'House cleaning', cadence }), provider: { name: "Rosa's Cleaning" }, assetIds: [house], today: TODAY }, A.d);
  await A.engine.initialUpload();
  await B.engine.replaceFromRemote();
  return { A, B, house, r };
}

describe('visits across two devices (real sync engine)', () => {
  it('the schema is still Dexie v15 and no table was added', () => {
    const d = fresh();
    expect(d.verno).toBe(15);
    expect(d.tables.map((t) => t.name)).not.toContain('visits');
  });
  it('a. a visit logged on A arrives on B with its status, snapshots, links, the finished Task and the next Task', async () => {
    const { A, B, house, r } = await seeded();
    const res = await log(A.d, r.id, r.taskId!, { notes: 'Windows too', chargedCents: 9000, chargeKind: 'service' });
    await settle(A, B);
    await everywhere([A, B], async (d) => {
      const [v] = await loadVisits(d);
      expect(v.id).toBe(res.visitId);
      expect(v.data).toMatchObject({ status: 'completed', providerNameSnapshot: "Rosa's Cleaning", taskId: r.taskId, occurrence: TODAY, chargedCents: 9000, chargeKind: 'service' });
      expect(await visitAssetIds(v.id, d)).toEqual([house]);
      expect((await getTask(r.taskId!, d))!.data.status).toBe('done');
      const o = await open(d, r.id);
      expect(o.map((t) => t.data.dueDate)).toEqual(['2026-11-20']);
      expect(scheduleHealth((await getArrangement(r.id, d))!, await tasksOfArrangement(r.id, d)).state).toBe('ok');
    });
  }, 90000);
  it('b. BOTH devices log the same Task offline: both visits survive, are flagged, and nothing is merged or deleted', async () => {
    const { A, B, r } = await seeded();
    const a = await log(A.d, r.id, r.taskId!);
    await sleep(15);
    const b = await log(B.d, r.id, r.taskId!, { notes: 'logged on the other device' });
    expect(a.visitId).not.toBe(b.visitId);
    await settle(A, B);
    await everywhere([A, B], async (d) => {
      const visits = await loadVisits(d);
      expect(visits.map((v) => v.id).sort()).toEqual([a.visitId, b.visitId].sort());
      const groups = duplicateGroups(visits);
      expect(groups).toHaveLength(1);
      expect(groups[0].reason).toBe('task');
      expect(visitStats(visits).completed).toBe(2); // counted as the data says; the owner decides
      // both devices also made a "next" Task: shown as two upcoming-visit tasks, not removed
      expect(await open(d, r.id)).toHaveLength(2);
      expect(scheduleHealth((await getArrangement(r.id, d))!, await tasksOfArrangement(r.id, d)).state).toBe('duplicate-open');
    });
    // a second press on the device that already logged it is still refused
    await expect(log(A.d, r.id, r.taskId!)).rejects.toThrow(/already logged/);
    expect(await loadVisits(A.d)).toHaveLength(2);
  }, 90000);
  it('c. A cancels a visit while B completes the same occurrence: both records survive and are flagged, neither is chosen automatically', async () => {
    const { A, B, r } = await seeded();
    await log(A.d, r.id, r.taskId!, { status: 'cancelled', cancelledBy: 'provider', chargedCents: 4000, chargeKind: 'cancellationFee' });
    await sleep(15);
    await log(B.d, r.id, r.taskId!);
    await settle(A, B);
    await everywhere([A, B], async (d) => {
      const visits = await loadVisits(d);
      expect(visits.map((v) => v.data.status).sort()).toEqual(['cancelled', 'completed']);
      expect(duplicateGroups(visits)).toHaveLength(1);
      // the cancelled one is never service, whatever the other says
      expect(visitStats(visits.filter((v) => v.data.status === 'cancelled')).lastServiced).toBeNull();
    });
  }, 90000);
  it('d. B reschedules the Task while A logs it: the visit survives; the later write reopens the Task and Done is refused as already logged', async () => {
    const { A, B, r } = await seeded();
    await log(A.d, r.id, r.taskId!);
    await sleep(15);
    const t = (await getTask(r.taskId!, B.d))!;
    await saveTask(t.id, { ...t.data, dueDate: '2026-11-07' }, B.d); // B did not know it was finished
    await settle(A, B);
    await everywhere([A, B], async (d) => {
      expect(await loadVisits(d)).toHaveLength(1); // the history is never lost
      // whole-record last-writer-wins: B's later edit put the Task back to open on both devices. The visit is safe and Done is refused.
      const t = (await getTask(r.taskId!, d))!;
      expect(t.data.status).toBe('todo');
      expect((await planLogVisit(r.id, r.taskId!, input(), TODAY, d)).problem).toMatch(/already logged/);
      expect((await open(d, r.id)).length).toBeGreaterThanOrEqual(2); // the reopened Task and the next one A made
    });
  }, 90000);
  it('e. the provider is replaced on A while an older B logs a historical visit: the visit keeps the ORIGINAL provider and arrangement', async () => {
    const { A, B, r } = await seeded();
    const plan = await planLifecycle(r.id, 'replace', TODAY, A.d);
    const res = await applyLifecycle({ action: 'replace', arrangementId: r.id, expect: plan.expect, today: TODAY, replace: { provider: { name: 'Bright Maids' } }, taskChoice: 'stop' }, A.d);
    await sleep(15);
    await log(B.d, r.id, r.taskId!, { date: '2026-11-05' });
    await settle(A, B);
    await everywhere([A, B], async (d) => {
      const [v] = await loadVisits(d);
      expect(v.data).toMatchObject({ arrangementId: r.id, providerNameSnapshot: "Rosa's Cleaning", date: '2026-11-05' });
      expect((await getArrangement(r.id, d))!.data.status).toBe('ended');
      expect((await getArrangement(res.successorId!, d))!.data.providerNameSnapshot).toBe('Bright Maids');
    });
  }, 90000);
  it('f. the Task is deleted on A while B logs it: the visit survives on both devices', async () => {
    const { A, B, r } = await seeded();
    await removeTasks([r.taskId!], A.d);
    await sleep(15);
    await log(B.d, r.id, r.taskId!);
    await settle(A, B);
    await everywhere([A, B], async (d) => { expect(await loadVisits(d)).toHaveLength(1); });
  }, 90000);
  it('g. a Task finished on A (outside Services) shows on B as finished, not yet logged; logging it on B converges', async () => {
    const { A, B, r } = await seeded();
    const { completeTask } = await import('../tasks/data');
    await completeTask(r.taskId!, TODAY, A.d);
    await settle(A, B);
    const arr = (await getArrangement(r.id, B.d))!;
    const tasksBy = new Map([[r.id, await tasksOfArrangement(r.id, B.d)]]);
    expect(unloggedVisits([arr], tasksBy, await loadVisits(B.d))).toHaveLength(1);
    await log(B.d, r.id, r.taskId!);
    await settle(A, B);
    await everywhere([A, B], async (d) => {
      expect(await loadVisits(d)).toHaveLength(1);
      expect(unloggedVisits([(await getArrangement(r.id, d))!], new Map([[r.id, await tasksOfArrangement(r.id, d)]]), await loadVisits(d))).toHaveLength(0);
      expect(scheduleHealth((await getArrangement(r.id, d))!, await tasksOfArrangement(r.id, d)).state).toBe('ok');
    });
  }, 90000);
  it('h. both devices Resume offline (S1 behaviour still holds with visits present): two open Tasks are kept and flagged', async () => {
    const { A, B, r } = await seeded();
    await log(A.d, r.id, r.taskId!);
    const pa = await planLifecycle(r.id, 'pause', TODAY, A.d);
    await applyLifecycle({ action: 'pause', arrangementId: r.id, expect: pa.expect, today: TODAY, taskChoice: 'remove' }, A.d);
    await settle(A, B);
    for (const x of [A, B]) {
      const p = await planLifecycle(r.id, 'resume', TODAY, x.d);
      await applyLifecycle({ action: 'resume', arrangementId: r.id, expect: p.expect, today: TODAY }, x.d);
      await sleep(15);
    }
    await settle(A, B);
    await everywhere([A, B], async (d) => {
      expect(await open(d, r.id)).toHaveLength(2);
      expect(scheduleHealth((await getArrangement(r.id, d))!, await tasksOfArrangement(r.id, d)).state).toBe('duplicate-open');
      expect(await loadVisits(d)).toHaveLength(1);
    });
    expect((await loadTasks(A.d)).filter((t) => t.data.status !== 'done')).toHaveLength(2);
  }, 90000);
  it('i. backup and restore bring visits back with statuses, snapshots, links, charge, markers and unknown fields', async () => {
    const { A, r, house } = await seeded();
    const done = await log(A.d, r.id, r.taskId!, { notes: 'Bring supplies', chargedCents: 12000, chargeKind: 'service' });
    await A.d.moduleRecords.update(done.visitId, { 'data.futureField': { keep: 1 }, 'data.payment': 'finance' });
    const next = (await open(A.d, r.id))[0];
    const skipped = await log(A.d, r.id, next.id, { status: 'skipped', date: '2026-11-20' });
    const text = JSON.stringify(await exportAll(A.d));
    const C = fresh();
    await importAll(C, checkBackupText(text).file);
    const visits = await loadVisits(C);
    expect(visits.map((v) => v.id).sort()).toEqual([done.visitId, skipped.visitId].sort());
    const v = visits.find((x) => x.id === done.visitId)!;
    expect(v.data).toMatchObject({ status: 'completed', providerNameSnapshot: "Rosa's Cleaning", taskId: r.taskId, occurrence: TODAY, chargedCents: 12000, chargeKind: 'service', notes: 'Bring supplies', futureField: { keep: 1 }, payment: 'finance' });
    expect(visits.find((x) => x.id === skipped.visitId)!.data.status).toBe('skipped');
    expect(await visitAssetIds(done.visitId, C)).toEqual([house]);
    expect(scheduleHealth((await getArrangement(r.id, C))!, await tasksOfArrangement(r.id, C)).state).toBe('ok');
    await touchAll(C);
    expect(await loadVisits(C)).toHaveLength(2);
  }, 90000);
});
