import { describe, expect, it } from 'vitest';
import { FinanceDB } from '../../db';
import { exportAll, importAll } from '../../lib/backup';
import { checkBackupText } from '../../lib/backupFile';
import { dexieMeta, RemoteConflict, SyncEngine, type RemoteFile, type RemoteStore } from '../../lib/sync/engine';
import { installTracking } from '../../lib/sync/track';
import type { ModuleRecord } from '../../core/entities';
import { applyScheduleChange, planScheduleChange, applyUndo } from './changes';
import { createArrangement, getArrangement, loadArrangements, tasksOfArrangement } from './data';
import { asArrangement, blankArrangement, cadenceBetween, cadenceText, toStored, type Cadence } from './model';
import * as old from './legacy/preS3-model';
import { scheduleHealth as oldHealth } from './legacy/preS3-schedule';
import { nextAfterVisit as oldNextAfterVisit } from './legacy/preS3-next';
import { scheduleHealth } from './schedule';
import type { Semimonthly } from './semimonthly';

/**
 * Pre-commit correction, finding 2: an OLDER running build (an old browser tab, an offline device) must never misread, mis-schedule or erase a
 * twice-monthly arrangement. The "older build" here is the REAL pre-S3 code, copied verbatim from git `fe2c673` into `legacy/` (model, schedule and
 * `nextAfterVisit`), not a mock. 2026-11-06 is a Friday. Invented data.
 */
let n = 0;
const fresh = () => { const d = new FinanceDB(`test-corr2-${n++}`); installTracking(d); return d; };
const TODAY = '2026-11-06';
const never = { type: 'never' } as const;
const SEMI: Semimonthly = { a: { kind: 'day', day: 15, adjust: 'none' }, b: { kind: 'lastBusinessDay' } };
const semiCad: Cadence = { mode: 'fixed', anchorDate: '2026-11-15', rule: { freq: 'monthly', interval: 1, monthly: 'date', end: never }, semi: SEMI };
const rec = (data: Record<string, unknown>): ModuleRecord => ({ id: 1, module: 'services', kind: 'arrangement', createdAt: 1, updatedAt: 1, data } as ModuleRecord);
const arrangementData = (over: Record<string, unknown> = {}) => ({ title: 'Pool service', status: 'active', ...over });
const open = async (d: FinanceDB, id: number) => (await tasksOfArrangement(id, d)).filter((t) => t.data.status !== 'done');

describe('correction 2: evidence of the risk in the first S3 storage form (cadence.semi with a monthly placeholder)', () => {
  const firstForm = rec(arrangementData({ cadence: semiCad }));
  it('the pre-S3 reader reads it as an ORDINARY MONTHLY schedule and would schedule the wrong date', () => {
    const a = old.asArrangement(firstForm);
    expect(a.data.cadence).toMatchObject({ mode: 'fixed', rule: { freq: 'monthly', interval: 1 } });
    expect(old.cadenceText(a.data.cadence)).toBe('Every month on day 15');
    // after the 15 Nov visit the older build would pick 15 Dec, skipping the last business day (30 Nov) entirely
    expect(oldNextAfterVisit(a.data, { status: 'completed', occurrence: '2026-11-15', taskDue: '2026-11-15', visitDate: '2026-11-15', today: '2026-11-15' })).toBe('2026-12-15');
  });
  it('and its next save rewrites the cadence from what it understood, so the twice-monthly rule is lost', () => {
    const a = old.asArrangement(firstForm);
    const rewritten = { ...old.normalizeArrangement({ ...a.data, title: 'Renamed' }) } as Record<string, unknown>;
    expect(JSON.stringify(rewritten)).not.toContain('lastBusinessDay');
    expect(asArrangement(rec(rewritten)).data.cadence?.semi).toBeUndefined();
  });
});

describe('correction 2: the stored form now fails closed in an older build', () => {
  const stored = toStored(blankArrangement({ title: 'Pool service', cadence: semiCad }));
  it('is stored beside `cadence`, which is null; nothing about it looks like a monthly rule', () => {
    expect(stored.cadence).toBeNull();
    expect(stored.semiCadence).toEqual({ anchorDate: '2026-11-15', end: never, semi: SEMI });
  });
  it('this build reads it back exactly', () => {
    expect(asArrangement(rec(stored)).data.cadence).toEqual(semiCad);
    expect(cadenceText(asArrangement(rec(stored)).data.cadence)).toMatch(/^Twice monthly: the 15th and the last business day/);
  });
  it('the pre-S3 reader sees NO schedule (never a monthly one), so it can compute no date', () => {
    const a = old.asArrangement(rec(stored));
    expect(a.data.cadence).toBeNull();
    expect(old.cadenceText(a.data.cadence)).toMatch(/^On demand/);
    expect(oldNextAfterVisit(a.data, { status: 'completed', occurrence: '2026-11-15', taskDue: '2026-11-15', visitDate: '2026-11-15', today: '2026-11-15' })).toBeNull();
    expect(old.validateArrangement(old.normalizeArrangement(a.data))).toBeNull(); // and it can still save the arrangement
  });
  it('the pre-S3 schedule check raises no false alarm and offers no "fix" that would change the Task (the Task has no repeat, and nor does "no schedule")', async () => {
    const d = fresh();
    const r = await createArrangement({ data: blankArrangement({ title: 'Pool service', cadence: semiCad }), provider: { name: 'Pat Pools' }, today: TODAY }, d);
    const raw = (await d.moduleRecords.get(r.id))!;
    const a = old.asArrangement(raw);
    const tasks = await tasksOfArrangement(r.id, d);
    expect(oldHealth(a, tasks).state).toBe('ok');
  });
  it('the pre-S3 build rewriting the arrangement (any edit) keeps the twice-monthly rule: it carries the unknown field through untouched', () => {
    const a = old.asArrangement(rec(stored));
    const rewritten = { ...old.normalizeArrangement({ ...a.data, title: 'Renamed by an older tab', notes: 'x' }) } as Record<string, unknown>;
    expect(rewritten.semiCadence).toEqual(stored.semiCadence);
    expect(rewritten.cadence).toBeNull();
    const back = asArrangement(rec(rewritten));
    expect(back.data.title).toBe('Renamed by an older tab');
    expect(back.data.cadence).toEqual(semiCad);
  });
  it('an older build that changes the schedule ON PURPOSE wins: this build then reads that schedule, and its next write removes the stale twice-monthly rule', () => {
    const a = old.asArrangement(rec(stored));
    const monthly: Cadence = { mode: 'fixed', rule: { freq: 'monthly', interval: 1, monthly: 'date', end: never }, anchorDate: '2026-12-01' };
    const rewritten = { ...old.normalizeArrangement({ ...a.data, cadence: monthly }) } as Record<string, unknown>;
    expect(rewritten.semiCadence).toBeDefined(); // the older build does not know to remove it
    const mine = asArrangement(rec(rewritten));
    expect(mine.data.cadence?.semi).toBeUndefined();
    expect(mine.data.cadence?.rule.freq).toBe('monthly');
    expect(toStored(mine.data).semiCadence).toBeUndefined(); // cleaned the next time this build writes it
  });
  it('a damaged twice-monthly field reads as no schedule, never as monthly; the first-draft form is still read', () => {
    expect(asArrangement(rec(arrangementData({ cadence: null, semiCadence: { anchorDate: '2026-11-15', end: never, semi: { a: 1 } } }))).data.cadence).toBeNull();
    expect(asArrangement(rec(arrangementData({ cadence: semiCad }))).data.cadence).toEqual(semiCad);
  });
});

describe('correction 2: every write path in this build uses the safe form (real database)', () => {
  const raw = async (d: FinanceDB, id: number) => (await d.moduleRecords.get(id))!.data as Record<string, unknown>;
  const safe = (r: Record<string, unknown>) => { expect(r.cadence).toBeNull(); expect(r.semiCadence).toBeTruthy(); };
  it('create, the open-Task pointer, edit, pause, resume and schedule change all store the safe form; a change away from twice-monthly removes it; Undo restores it', async () => {
    const d = fresh();
    const r = await createArrangement({ data: blankArrangement({ title: 'Pool service', cadence: semiCad }), provider: { name: 'Pat Pools' }, today: TODAY }, d);
    safe(await raw(d, r.id)); // create + ensureNextVisitTask (openTaskId written)
    expect((await raw(d, r.id)).openTaskId).toBe(r.taskId);
    const { updateArrangement } = await import('./data');
    const a0 = (await getArrangement(r.id, d))!;
    await updateArrangement(r.id, { title: 'Pool service 2', startDate: null, extraContactIds: [], expected: null, refs: [], notes: 'n', assetIds: [] }, a0.updatedAt, d);
    safe(await raw(d, r.id));
    const { planLifecycle, applyLifecycle } = await import('./changes');
    const p = await planLifecycle(r.id, 'pause', TODAY, d);
    await applyLifecycle({ action: 'pause', arrangementId: r.id, expect: p.expect, today: TODAY }, d);
    safe(await raw(d, r.id));
    const q = await planLifecycle(r.id, 'resume', TODAY, d);
    await applyLifecycle({ action: 'resume', arrangementId: r.id, expect: q.expect, today: TODAY }, d);
    safe(await raw(d, r.id));
    // change to every 2 weeks: the twice-monthly field must disappear
    const bi: Cadence = { mode: 'fixed', rule: { freq: 'weekly', interval: 2, byWeekday: [5], end: never }, anchorDate: TODAY };
    const plan = await planScheduleChange(r.id, bi, null, TODAY, d);
    const res = await applyScheduleChange({ arrangementId: r.id, expect: plan.expect, today: TODAY, cadence: bi, visitTime: null, currentVisit: 'move' }, d);
    const after = await raw(d, r.id);
    expect(after.semiCadence).toBeUndefined();
    expect((after.cadence as Cadence).rule.interval).toBe(2);
    await applyUndo(res.undo, d); // the guarded Undo puts the twice-monthly rule back, in the safe form
    safe(await raw(d, r.id));
    expect((await getArrangement(r.id, d))!.data.cadence).toEqual({ ...semiCad });
  });
  it('replace provider copies the schedule to the successor in the safe form', async () => {
    const d = fresh();
    const r = await createArrangement({ data: blankArrangement({ title: 'Pool service', cadence: semiCad }), provider: { name: 'Pat Pools' }, today: TODAY }, d);
    const { planLifecycle, applyLifecycle } = await import('./changes');
    const p = await planLifecycle(r.id, 'replace', TODAY, d);
    const res = await applyLifecycle({ action: 'replace', arrangementId: r.id, expect: p.expect, today: TODAY, replace: { provider: { name: 'Sam Pool Care' } } }, d);
    safe(await raw(d, res.successorId!));
    expect((await getArrangement(res.successorId!, d))!.data.cadence?.semi).toEqual(SEMI);
  });
  it('backup and restore carry the safe form unchanged and this build reads it back', async () => {
    const d = fresh();
    const r = await createArrangement({ data: blankArrangement({ title: 'Pool service', cadence: semiCad }), provider: { name: 'Pat Pools' }, today: TODAY }, d);
    const C = fresh();
    await importAll(C, checkBackupText(JSON.stringify(await exportAll(d))).file);
    safe(await raw(C, r.id));
    const a = (await getArrangement(r.id, C))!;
    expect(a.data.cadence).toEqual(semiCad);
    expect(cadenceBetween(a.data.cadence!, '2026-11-01', '2026-12-31')).toEqual(['2026-11-15', '2026-11-30', '2026-12-15', '2026-12-31']);
    expect(scheduleHealth(a, await tasksOfArrangement(r.id, C)).state).toBe('ok');
  });
});

function remoteStore() {
  const r = {
    puts: 0, file: null as RemoteFile | null,
    async getFile() { return r.file ? { sha: r.file.sha, bytes: r.file.bytes.slice() } : null; },
    async putFile(bytes: Uint8Array, sha: string | undefined) {
      if ((r.file?.sha ?? undefined) !== sha) throw new RemoteConflict('stale');
      r.puts++; r.file = { sha: `sha${r.puts}`, bytes: bytes.slice() }; return r.file.sha;
    },
  };
  return r satisfies RemoteStore;
}
describe('correction 2 across two devices (real SyncEngine): an older build on one device', () => {
  it('B (older build) edits the arrangement and logs nothing wrong: A keeps the twice-monthly rule and its schedule, and no wrong Task or date reaches A', async () => {
    const remote = remoteStore();
    const mk = () => { const d = fresh(); return { d, engine: new SyncEngine(d, dexieMeta(`corr2-meta-${n++}`), remote, 'a good passphrase') }; };
    const A = mk(), B = mk();
    const r = await createArrangement({ data: blankArrangement({ title: 'Pool service', cadence: semiCad }), provider: { name: 'Pat Pools' }, today: TODAY }, A.d);
    await A.engine.initialUpload(); await B.engine.replaceFromRemote();
    // B behaves exactly like the pre-S3 code: it reads, and writes back what it understood
    const rowB = (await B.d.moduleRecords.get(r.id))!;
    const olderView = old.asArrangement(rowB);
    expect(olderView.data.cadence).toBeNull();
    const rewritten = { ...old.normalizeArrangement({ ...olderView.data, title: 'Pool service (older tab)' }) };
    await B.d.moduleRecords.put({ ...rowB, data: rewritten as never, updatedAt: rowB.updatedAt + 5 });
    for (let i = 0; i < 2; i++) { await A.engine.sync(); await B.engine.sync(); }
    await A.engine.sync();
    for (const x of [A, B]) {
      const a = (await getArrangement(r.id, x.d))!;
      expect(a.data.title).toBe('Pool service (older tab)');
      expect(a.data.cadence).toEqual(semiCad);
      expect(await open(x.d, r.id)).toHaveLength(1);
      expect((await open(x.d, r.id))[0].data.dueDate).toBe('2026-11-15');
    }
    const arrs = await loadArrangements(A.d);
    expect(arrs).toHaveLength(1);
  }, 90000);
});
