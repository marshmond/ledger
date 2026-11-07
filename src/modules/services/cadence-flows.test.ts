import { describe, expect, it } from 'vitest';
import { FinanceDB } from '../../db';
import { exportAll, importAll } from '../../lib/backup';
import { checkBackupText } from '../../lib/backupFile';
import { addDays } from '../../lib/dates';
import { dexieMeta, RemoteConflict, SyncEngine, type RemoteFile, type RemoteStore } from '../../lib/sync/engine';
import { installTracking } from '../../lib/sync/track';
import { completeTask, getTask, saveTask } from '../tasks/data';
import { addBookingReminder, loadVisits, logVisitFromTask, planLogVisit, unloggedVisits, type VisitInput } from './visits';
import { applyLifecycle, applyRepair, applyScheduleChange, applyUndo, planLifecycle, planRepair, planScheduleChange } from './changes';
import { bookingTasksOf, createArrangement, getArrangement, tasksOfArrangement, writeArrangement } from './data';
import { blankArrangement, cadenceBetween, type Cadence } from './model';
import { markersOf, scheduleHealth } from './schedule';
import { semiDates, type Semimonthly, type Slot } from './semimonthly';
import { duplicateGroups } from './visitModel';

/** Invented data only. 2026-11-06 is a Friday. Each test gets its own database. */
let n = 0;
const fresh = () => { const d = new FinanceDB(`test-cadence-${n++}`); installTracking(d); return d; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const TODAY = '2026-11-06';
const day = (d: number, adjust: Slot['adjust'] = 'none'): Slot => ({ kind: 'day', day: d, adjust });
const LASTBIZ: Slot = { kind: 'lastBusinessDay' };
const SEMI: Semimonthly = { a: day(15), b: LASTBIZ };
const never = { type: 'never' } as const;
const semiCad = (anchor = '2026-11-15', semi: Semimonthly = SEMI): Cadence => ({ mode: 'fixed', rule: { freq: 'monthly', interval: 1, monthly: 'date', end: never }, anchorDate: anchor, semi });
const biweekly = (anchor = TODAY): Cadence => ({ mode: 'fixed', rule: { freq: 'weekly', interval: 2, byWeekday: [5], end: never }, anchorDate: anchor });
const add = (d: FinanceDB, cadence: Cadence, over = {}, today = TODAY) =>
  createArrangement({ data: blankArrangement({ title: 'Pool service', cadence, ...over }), provider: { name: "Pat's Pools" }, today }, d);
const open = async (d: FinanceDB, id: number) => (await tasksOfArrangement(id, d)).filter((t) => t.data.status !== 'done');
const input = (over: Partial<VisitInput> = {}): VisitInput => ({ status: 'completed', cancelledBy: null, date: TODAY, notes: '', chargedCents: null, chargeKind: null, ...over });
async function log(d: FinanceDB, arrId: number, taskId: number, over: Partial<VisitInput> = {}, today = TODAY) {
  const inp = input({ date: today, ...over });
  const plan = await planLogVisit(arrId, taskId, inp, today, d);
  return logVisitFromTask({ arrangementId: arrId, taskId, input: inp, today, expect: plan.expect }, d);
}
const health = async (d: FinanceDB, id: number) => scheduleHealth((await getArrangement(id, d))!, await tasksOfArrangement(id, d));

describe('S3-A every 2 weeks (existing weekly rule, interval 2)', () => {
  it('26 visits in a row: always exactly 14 days apart, always one open Task, the same Friday, the Task repeats every 2 weeks', async () => {
    const d = fresh();
    const r = await add(d, biweekly());
    const want = Array.from({ length: 27 }, (_, i) => addDays(TODAY, 14 * i));
    for (let i = 0; i < 26; i++) {
      const o = await open(d, r.id);
      expect(o).toHaveLength(1);
      expect(o[0].data.dueDate).toBe(want[i]);
      expect(o[0].data.repeat?.rule).toMatchObject({ freq: 'weekly', interval: 2, byWeekday: [5] });
      await log(d, r.id, o[0].id, {}, want[i]);
    }
    expect((await open(d, r.id))[0].data.dueDate).toBe(want[26]);
    expect(await loadVisits(d)).toHaveLength(26);
  }, 120000);
  it('a visit moved across a week boundary (Friday to Sunday) never changes the parity of later visits', async () => {
    const d = fresh();
    const r = await add(d, biweekly());
    const t = (await open(d, r.id))[0];
    await saveTask(t.id, { ...t.data, dueDate: '2026-11-08' }, d); // moved to the Sunday AFTER the Friday
    expect(markersOf((await getTask(t.id, d))!).occurrence).toBe('2026-11-06');
    await log(d, r.id, t.id, {}, '2026-11-08');
    expect((await open(d, r.id))[0].data.dueDate).toBe('2026-11-20');
    const t2 = (await open(d, r.id))[0];
    await saveTask(t2.id, { ...t2.data, dueDate: '2026-11-17' }, d); // moved EARLIER, to the Tuesday of the week before
    await log(d, r.id, t2.id, {}, '2026-11-17');
    expect((await open(d, r.id))[0].data.dueDate).toBe('2026-12-04');
  });
  it('late completion skips the missed one (no backlog); skipped and cancelled visits also move on, with one open Task each time', async () => {
    const d = fresh();
    const r = await add(d, biweekly());
    await log(d, r.id, (await open(d, r.id))[0].id, {}, '2026-11-20'); // two weeks late
    expect((await open(d, r.id)).map((t) => t.data.dueDate)).toEqual(['2026-12-04']);
    await log(d, r.id, (await open(d, r.id))[0].id, { status: 'skipped', date: '2026-12-04' }, '2026-12-04');
    expect((await open(d, r.id)).map((t) => t.data.dueDate)).toEqual(['2026-12-18']);
    await log(d, r.id, (await open(d, r.id))[0].id, { status: 'cancelled', cancelledBy: 'household', date: '2026-12-18' }, '2026-12-18');
    expect((await open(d, r.id)).map((t) => t.data.dueDate)).toEqual(['2027-01-01']);
  });
});

describe('S3-A twice a month: the Task, the markers and the lifecycle', () => {
  it('the visit Task has NO repeat, carries the occurrence date, and the arrangement is healthy', async () => {
    const d = fresh();
    const r = await add(d, semiCad());
    const [t] = await open(d, r.id);
    expect(t.data.dueDate).toBe('2026-11-15');
    expect(t.data.repeat).toBeNull();
    expect(markersOf(t)).toEqual({ occurrence: '2026-11-15', arrangement: r.id });
    expect((await health(d, r.id)).state).toBe('ok');
  });
  it('a full year of visits (24): every next date is the schedule\'s next date, one open Task each time, never a repeat', async () => {
    const d = fresh();
    const r = await add(d, semiCad());
    const want = semiDates(SEMI, '2026-11-15', '2026-11-15', '2027-12-31');
    for (let i = 0; i < 24; i++) {
      const o = await open(d, r.id);
      expect(o).toHaveLength(1);
      expect(o[0].data.dueDate).toBe(want[i]);
      expect(o[0].data.repeat).toBeNull();
      expect(markersOf(o[0]).occurrence).toBe(want[i]);
      expect((await health(d, r.id)).state).toBe('ok');
      await log(d, r.id, o[0].id, {}, want[i]);
    }
    expect((await open(d, r.id))[0].data.dueDate).toBe(want[24]);
    expect(await loadVisits(d)).toHaveLength(24);
    expect(want.slice(0, 4)).toEqual(['2026-11-15', '2026-11-30', '2026-12-15', '2026-12-31']);
  }, 120000);
  it('early and late completion: early does not repeat the same date; late skips what was missed', async () => {
    const d = fresh();
    const r = await add(d, semiCad());
    await log(d, r.id, (await open(d, r.id))[0].id, {}, '2026-11-10'); // 5 days early
    expect((await open(d, r.id))[0].data.dueDate).toBe('2026-11-30');
    await log(d, r.id, (await open(d, r.id))[0].id, {}, '2026-12-20'); // three weeks late: 30 Nov and the 15 Dec are passed over
    expect((await open(d, r.id))[0].data.dueDate).toBe('2026-12-31');
  });
  it('moving one visit does not move the others, and the next date still follows the schedule', async () => {
    const d = fresh();
    const r = await add(d, semiCad());
    const t = (await open(d, r.id))[0];
    await saveTask(t.id, { ...t.data, dueDate: '2026-11-19' }, d);
    expect((await health(d, r.id)).state).toBe('moved-once');
    await log(d, r.id, t.id, {}, '2026-11-19');
    expect((await open(d, r.id))[0].data.dueDate).toBe('2026-11-30');
  });
  it('skipped and cancelled visits pass over their date and the next one is made', async () => {
    const d = fresh();
    const r = await add(d, semiCad());
    await log(d, r.id, (await open(d, r.id))[0].id, { status: 'skipped', date: '2026-11-15' }, '2026-11-15');
    expect((await open(d, r.id))[0].data.dueDate).toBe('2026-11-30');
    await log(d, r.id, (await open(d, r.id))[0].id, { status: 'cancelled', cancelledBy: 'provider', date: '2026-11-30' }, '2026-11-30');
    expect((await open(d, r.id))[0].data.dueDate).toBe('2026-12-15');
    expect((await loadVisits(d)).map((v) => v.data.status).sort()).toEqual(['cancelled', 'skipped']);
  });
  it('a booking reminder is not a visit: finishing it logs nothing and makes no visit Task', async () => {
    const d = fresh();
    const r = await add(d, semiCad());
    const id = await addBookingReminder(r.id, '2026-11-10', d);
    await completeTask(id, TODAY, d);
    expect(await loadVisits(d)).toHaveLength(0);
    expect(await open(d, r.id)).toHaveLength(1);
    expect(await bookingTasksOf(r.id, d)).toHaveLength(1);
    await expect(log(d, r.id, id)).rejects.toThrow(/reminder to book/);
  });
  it('Pause then Resume: no catching up; Resume makes ONE Task for the next date; End leaves none', async () => {
    const d = fresh();
    const r = await add(d, semiCad());
    const p = await planLifecycle(r.id, 'pause', TODAY, d);
    await applyLifecycle({ action: 'pause', arrangementId: r.id, expect: p.expect, today: TODAY }, d);
    expect(await open(d, r.id)).toHaveLength(0);
    const LATER = '2026-12-20';
    const q = await planLifecycle(r.id, 'resume', LATER, d);
    await applyLifecycle({ action: 'resume', arrangementId: r.id, expect: q.expect, today: LATER }, d);
    const o = await open(d, r.id);
    expect(o.map((t) => t.data.dueDate)).toEqual(['2026-12-31']);
    expect(o[0].data.repeat).toBeNull();
    const e = await planLifecycle(r.id, 'end', LATER, d);
    await applyLifecycle({ action: 'end', arrangementId: r.id, expect: e.expect, today: LATER, endReason: 'finished', endDate: LATER }, d);
    expect(await open(d, r.id)).toHaveLength(0);
  });
  it('Replace provider: the new arrangement inherits the twice-monthly pattern and gets its own Task; history stays with the old provider', async () => {
    const d = fresh();
    const r = await add(d, semiCad());
    await log(d, r.id, (await open(d, r.id))[0].id, {}, '2026-11-15');
    const p = await planLifecycle(r.id, 'replace', '2026-11-20', d);
    const res = await applyLifecycle({ action: 'replace', arrangementId: r.id, expect: p.expect, today: '2026-11-20', replace: { provider: { name: 'Sam Pool Care' } } }, d);
    const succ = (await getArrangement(res.successorId!, d))!;
    expect(succ.data.cadence?.semi).toEqual(SEMI);
    const o = await open(d, res.successorId!);
    expect(o.map((t) => t.data.dueDate)).toEqual(['2026-11-30']);
    expect(o[0].data.repeat).toBeNull();
    const visits = await loadVisits(d);
    expect(visits).toHaveLength(1);
    expect(visits[0].data.providerNameSnapshot).toBe("Pat's Pools");
  });
  it('Change schedule: biweekly to twice monthly is previewed, saved, and Undo puts the old repeat and date back', async () => {
    const d = fresh();
    const r = await add(d, biweekly());
    const before = (await open(d, r.id))[0];
    expect(before.data.repeat?.rule.interval).toBe(2);
    const plan = await planScheduleChange(r.id, semiCad(), null, TODAY, d);
    expect(plan.problem).toBeNull();
    expect(plan.moveTo).toBe('2026-11-15');
    expect(plan.lines.join(' ')).toMatch(/Twice monthly: the 15th and the last business day/);
    const res = await applyScheduleChange({ arrangementId: r.id, expect: plan.expect, today: TODAY, cadence: semiCad(), visitTime: null, currentVisit: 'move' }, d);
    const t = (await open(d, r.id))[0];
    expect(t.data.dueDate).toBe('2026-11-15');
    expect(t.data.repeat).toBeNull();
    expect((await getArrangement(r.id, d))!.data.cadence?.semi).toEqual(SEMI);
    await applyUndo(res.undo, d);
    const back = (await open(d, r.id))[0];
    expect(back.data.dueDate).toBe(TODAY);
    expect(back.data.repeat?.rule).toMatchObject({ freq: 'weekly', interval: 2 });
    expect((await getArrangement(r.id, d))!.data.cadence?.semi).toBeUndefined();
    expect((await getArrangement(r.id, d))!.data.cadence?.rule.interval).toBe(2);
  });
  it('Change schedule refuses a rule whose two days can collide, and says why, before anything is written', async () => {
    const d = fresh();
    const r = await add(d, biweekly());
    const bad = semiCad('2026-11-30', { a: day(30), b: { kind: 'lastDay' } });
    const plan = await planScheduleChange(r.id, bad, null, TODAY, d);
    expect(plan.problem).toMatch(/same date/);
  });
  it('a twice-monthly Task that someone makes repeat in Tasks is noticed; "make the task follow the arrangement" fixes it', async () => {
    const d = fresh();
    const r = await add(d, semiCad());
    const t = (await open(d, r.id))[0];
    await saveTask(t.id, { ...t.data, repeat: { mode: 'fixed', rule: { freq: 'monthly', interval: 1, monthly: 'date', end: never } } }, d);
    expect((await health(d, r.id)).state).toBe('rule-differs');
    const plan = await planRepair('task-follows', r.id, t.id, TODAY, d);
    await applyRepair({ kind: 'task-follows', arrangementId: r.id, taskId: t.id, expect: plan.expect, today: TODAY }, d);
    expect((await getTask(t.id, d))!.data.repeat).toBeNull();
    expect((await health(d, r.id)).state).toBe('ok');
  });
  it('an arrangement that is not twice monthly still schedules exactly as before (monthly repeat, Tasks makes the copy)', async () => {
    const d = fresh();
    const monthly: Cadence = { mode: 'fixed', rule: { freq: 'monthly', interval: 1, monthly: 'date', end: never }, anchorDate: '2026-11-15' };
    const r = await add(d, monthly);
    const t = (await open(d, r.id))[0];
    expect(t.data.repeat?.rule.freq).toBe('monthly');
    await log(d, r.id, t.id, {}, '2026-11-15');
    expect((await open(d, r.id)).map((x) => x.data.dueDate)).toEqual(['2026-12-15']);
  });
});

describe('S3-A twice a month: a Task finished outside Services', () => {
  it('finishing it in Tasks leaves nothing scheduled and a clear notice; it is listed as not yet logged', async () => {
    const d = fresh();
    const r = await add(d, semiCad());
    const t = (await open(d, r.id))[0];
    const res = await completeTask(t.id, '2026-11-16', d);
    expect(res.spawnedId).toBeUndefined(); // no repeat, so Tasks makes no copy
    expect(await open(d, r.id)).toHaveLength(0);
    expect((await health(d, r.id)).state).toBe('no-task');
    const a = (await getArrangement(r.id, d))!;
    const un = unloggedVisits([a], new Map([[r.id, await tasksOfArrangement(r.id, d)]]), await loadVisits(d));
    expect(un).toHaveLength(1);
  });
  it('logging it afterwards records the visit AND makes the next Task, once, from the schedule', async () => {
    const d = fresh();
    const r = await add(d, semiCad());
    const t = (await open(d, r.id))[0];
    await completeTask(t.id, '2026-11-16', d);
    const plan = await planLogVisit(r.id, t.id, input({ date: '2026-11-16' }), '2026-11-16', d);
    expect(plan.mode).toBe('late');
    expect(plan.createsNext).toBe(true);
    expect(plan.nextDate).toBe('2026-11-30');
    expect(plan.lines.join(' ')).toMatch(/one will be made for/);
    const res = await logVisitFromTask({ arrangementId: r.id, taskId: t.id, input: input({ date: '2026-11-16' }), today: '2026-11-16', expect: plan.expect }, d);
    expect(res.nextTaskId).not.toBeNull();
    const o = await open(d, r.id);
    expect(o.map((x) => [x.data.dueDate, x.data.repeat])).toEqual([['2026-11-30', null]]);
    expect(markersOf(o[0]).occurrence).toBe('2026-11-30');
    expect((await health(d, r.id)).state).toBe('ok');
    expect(await loadVisits(d)).toHaveLength(1);
    // the Undo takes the new Task away again and nothing else changes
    await applyUndo(res.undo, d);
    expect(await loadVisits(d)).toHaveLength(0);
  });
  it('"Schedule the next visit" first, then logging the finished one: still exactly one open Task', async () => {
    const d = fresh();
    const r = await add(d, semiCad());
    const t = (await open(d, r.id))[0];
    await completeTask(t.id, '2026-11-16', d);
    const rp = await planRepair('schedule-next', r.id, null, '2026-11-16', d);
    await applyRepair({ kind: 'schedule-next', arrangementId: r.id, taskId: null, expect: rp.expect, today: '2026-11-16' }, d);
    expect((await open(d, r.id)).map((x) => x.data.dueDate)).toEqual(['2026-11-30']);
    const plan = await planLogVisit(r.id, t.id, input({ date: '2026-11-16' }), '2026-11-16', d);
    expect(plan.createsNext).toBe(false);
    await logVisitFromTask({ arrangementId: r.id, taskId: t.id, input: input({ date: '2026-11-16' }), today: '2026-11-16', expect: plan.expect }, d);
    expect(await open(d, r.id)).toHaveLength(1);
  });
  it('two overlapping attempts to log the same finished Task make one visit and one next Task', async () => {
    const d = fresh();
    const r = await add(d, semiCad());
    const t = (await open(d, r.id))[0];
    await completeTask(t.id, '2026-11-16', d);
    const plan = await planLogVisit(r.id, t.id, input({ date: '2026-11-16' }), '2026-11-16', d);
    const go = () => logVisitFromTask({ arrangementId: r.id, taskId: t.id, input: input({ date: '2026-11-16' }), today: '2026-11-16', expect: plan.expect }, d);
    const results = await Promise.allSettled([go(), go()]);
    expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(await loadVisits(d)).toHaveLength(1);
    expect(await open(d, r.id)).toHaveLength(1);
  });
  it('an ended or paused arrangement gets no next Task from a late log', async () => {
    const d = fresh();
    const r = await add(d, semiCad());
    const t = (await open(d, r.id))[0];
    await completeTask(t.id, '2026-11-16', d);
    const a = (await getArrangement(r.id, d))!;
    await writeArrangement(r.id, { ...a.data, status: 'paused' }, d);
    const plan = await planLogVisit(r.id, t.id, input({ date: '2026-11-16' }), '2026-11-16', d);
    expect(plan.createsNext).toBe(false);
    await logVisitFromTask({ arrangementId: r.id, taskId: t.id, input: input({ date: '2026-11-16' }), today: '2026-11-16', expect: plan.expect }, d);
    expect(await open(d, r.id)).toHaveLength(0);
  });
});

// ---- two devices ----
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
  const mk = () => { const d = fresh(); return { d, engine: new SyncEngine(d, dexieMeta(`cadence-meta-${n++}`), remote, 'a good passphrase') }; };
  return { A: mk(), B: mk() };
};
type Dev = ReturnType<typeof devices>['A'];
const settle = async (A: Dev, B: Dev) => { for (let i = 0; i < 2; i++) { await A.engine.sync(); await B.engine.sync(); } await A.engine.sync(); };
async function seeded(cadence: Cadence = semiCad()) {
  const { A, B } = devices();
  const r = await add(A.d, cadence);
  await A.engine.initialUpload();
  await B.engine.replaceFromRemote();
  return { A, B, r };
}

describe('S3-A twice a month: two devices (real SyncEngine) and backup', () => {
  it('both devices complete the same twice-monthly occurrence offline: both visits are kept and flagged; two next Tasks are flagged', async () => {
    const { A, B, r } = await seeded();
    const id = (await open(A.d, r.id))[0].id;
    await log(A.d, r.id, id, {}, '2026-11-15');
    await sleep(15);
    await log(B.d, r.id, id, {}, '2026-11-15');
    await settle(A, B);
    for (const x of [A, B]) {
      const visits = await loadVisits(x.d);
      expect(visits).toHaveLength(2);
      expect(duplicateGroups(visits)).toHaveLength(1);
      expect(await open(x.d, r.id)).toHaveLength(2);
      expect((await health(x.d, r.id)).state).toBe('duplicate-open');
    }
  }, 90000);
  it('A reschedules while B completes: nothing is lost, both devices agree, and the schedule is not changed', async () => {
    const { A, B, r } = await seeded();
    const t = (await open(A.d, r.id))[0];
    await saveTask(t.id, { ...t.data, dueDate: '2026-11-19' }, A.d);
    await sleep(15);
    await log(B.d, r.id, t.id, {}, '2026-11-15');
    await settle(A, B);
    const va = await loadVisits(A.d), vb = await loadVisits(B.d);
    expect(va.map((v) => v.id)).toEqual(vb.map((v) => v.id));
    expect(va).toHaveLength(1);
    expect((await getArrangement(r.id, A.d))!.data.cadence).toEqual((await getArrangement(r.id, B.d))!.data.cadence);
    expect((await getArrangement(r.id, A.d))!.data.cadence?.semi).toEqual(SEMI);
  }, 90000);
  it('both devices change the cadence: the later write wins on both, whole record, and the result is a valid schedule', async () => {
    const { A, B, r } = await seeded();
    const setSemi = async (x: Dev, semi: Semimonthly, anchor: string) => {
      const a = (await getArrangement(r.id, x.d))!;
      await writeArrangement(r.id, { ...a.data, cadence: semiCad(anchor, semi) }, x.d);
    };
    await setSemi(A, { a: day(1), b: day(15) }, '2026-11-15');
    await sleep(15);
    await setSemi(B, { a: day(10), b: day(25) }, '2026-11-25');
    await settle(A, B);
    const ca = (await getArrangement(r.id, A.d))!.data.cadence, cb = (await getArrangement(r.id, B.d))!.data.cadence;
    expect(ca).toEqual(cb);
    expect(ca?.semi).toEqual({ a: day(10), b: day(25) });
    expect(cadenceBetween(ca!, '2026-11-01', '2026-12-31')).toEqual(['2026-11-25', '2026-12-10', '2026-12-25']);
  }, 90000);
  it('backup and restore keep both day-rules, the Task marker, the visit and unknown fields; restoring twice changes nothing', async () => {
    const { A, r } = await seeded();
    const id = (await open(A.d, r.id))[0].id;
    await log(A.d, r.id, id, {}, '2026-11-15');
    await A.d.moduleRecords.update(r.id, { 'data.futureField': { keep: 1 } });
    const text = JSON.stringify(await exportAll(A.d));
    const C = fresh();
    await importAll(C, checkBackupText(text).file);
    await importAll(C, checkBackupText(text).file);
    const a = (await getArrangement(r.id, C))!;
    expect(a.data.cadence?.semi).toEqual(SEMI);
    expect((a.data as unknown as Record<string, unknown>).futureField).toEqual({ keep: 1 });
    const o = await open(C, r.id);
    expect(o).toHaveLength(1);
    expect(o[0].data.repeat).toBeNull();
    expect(markersOf(o[0]).occurrence).toBe('2026-11-30');
    expect(await loadVisits(C)).toHaveLength(1);
    expect((await health(C, r.id)).state).toBe('ok');
  }, 90000);
  it('an older arrangement (no twice-monthly field) is read and scheduled exactly as before after a restore', async () => {
    const A = fresh();
    const monthly: Cadence = { mode: 'fixed', rule: { freq: 'monthly', interval: 1, monthly: 'date', end: never }, anchorDate: '2026-11-15' };
    const r = await add(A, monthly);
    const text = JSON.stringify(await exportAll(A));
    const C = fresh();
    await importAll(C, checkBackupText(text).file);
    const a = (await getArrangement(r.id, C))!;
    expect(a.data.cadence).toEqual(monthly);
    expect(a.data.cadence?.semi).toBeUndefined();
  });
});
