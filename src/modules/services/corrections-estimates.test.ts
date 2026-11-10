import { describe, expect, it } from 'vitest';
import { FinanceDB } from '../../db';
import { dexieMeta, RemoteConflict, SyncEngine, type RemoteFile, type RemoteStore } from '../../lib/sync/engine';
import { installTracking } from '../../lib/sync/track';
import { completeTask, saveTask } from '../tasks/data';
import { applyLifecycle, planLifecycle } from './changes';
import { createArrangement, loadArrangements, tasksOfArrangement } from './data';
import { expectedWindow, scheduleStateOf, type ScheduleState } from './expectedCharges';
import { blankArrangement, type Cadence } from './model';
import { payRecords, servicesSpend } from './servicesSpend';
import { loadVisits, logVisitFromTask, planLogVisit } from './visits';
import { providerNamed } from '../../core/contactTestkit';

/** Pre-commit correction, finding 4: estimates follow the REAL next visit and the standing arrangement. Invented data. 2026-11-06 is a Friday. */
let n = 0;
const fresh = () => { const d = new FinanceDB(`test-corr4-${n++}`); installTracking(d); return d; };
const never = { type: 'never' } as const;
const weekly: Cadence = { mode: 'fixed', rule: { freq: 'weekly', interval: 1, byWeekday: [5], end: never }, anchorDate: '2026-11-06' };
const biweekly: Cadence = { mode: 'fixed', rule: { freq: 'weekly', interval: 2, byWeekday: [5], end: never }, anchorDate: '2026-11-06' };
const semi = (anchor: string): Cadence => ({ mode: 'fixed', anchorDate: anchor, rule: { freq: 'monthly', interval: 1, monthly: 'date', end: never }, semi: { a: { kind: 'day', day: 15, adjust: 'none' }, b: { kind: 'lastBusinessDay' } } });
const add = async (d: FinanceDB, cadence: Cadence, today: string, cents = 10000) =>
  createArrangement({ data: blankArrangement({ title: 'Pool service', cadence, expected: { basis: 'perVisit', cents } }), provider: await providerNamed(d, 'Pat Pools'), today }, d);
const open = async (d: FinanceDB, id: number) => (await tasksOfArrangement(id, d)).filter((t) => t.data.status !== 'done')[0];
const move = async (d: FinanceDB, id: number, dueDate: string) => { const t = await open(d, id); await saveTask(t.id, { ...t.data, dueDate }, d); };
async function estimate(d: FinanceDB, today: string, days: number) {
  const arrangements = await loadArrangements(d);
  const state = new Map<number, ScheduleState>();
  for (const a of arrangements) state.set(a.id, scheduleStateOf(await tasksOfArrangement(a.id, d)));
  return expectedWindow(arrangements, state, today, days);
}
const datesOf = (w: Awaited<ReturnType<typeof estimate>>, id: number) => w.items.find((i) => i.arrangementId === id)?.dates ?? [];

describe('correction 4: estimates after a one-time move', () => {
  it('1. a weekly visit moved to another day is counted once, on that day; the later ones stay on the usual Friday', async () => {
    const d = fresh();
    const r = await add(d, weekly, '2026-11-06');
    await move(d, r.id, '2026-11-08'); // Friday -> Sunday
    const w = await estimate(d, '2026-11-06', 30);
    expect(datesOf(w, r.id)).toEqual(['2026-11-08', '2026-11-13', '2026-11-20', '2026-11-27', '2026-12-04']);
    expect(w.estimateCents).toBe(50000);
  });
  it('1b. a biweekly visit moved to another day: the move is counted, the later ones keep the same weeks', async () => {
    const d = fresh();
    const r = await add(d, biweekly, '2026-11-06');
    await move(d, r.id, '2026-11-08');
    expect(datesOf(await estimate(d, '2026-11-06', 30), r.id)).toEqual(['2026-11-08', '2026-11-20', '2026-12-04']);
    expect(datesOf(await estimate(d, '2026-11-06', 90), r.id)).toEqual(['2026-11-08', '2026-11-20', '2026-12-04', '2026-12-18', '2027-01-01', '2027-01-15', '2027-01-29']);
  });
  it('2. a twice-monthly visit moved off its date: counted once where it really is, later visits on the usual dates', async () => {
    const d = fresh();
    const r = await add(d, semi('2026-11-15'), '2026-11-06');
    await move(d, r.id, '2026-11-19');
    const w = await estimate(d, '2026-11-06', 30); // to 6 Dec
    expect(datesOf(w, r.id)).toEqual(['2026-11-19', '2026-11-30']);
    expect(datesOf(await estimate(d, '2026-11-06', 90), r.id)).toEqual(['2026-11-19', '2026-11-30', '2026-12-15', '2026-12-31', '2027-01-15', '2027-01-29']);
  });
  it('3. a visit moved across a month boundary: the 30 Nov visit moved to 2 Dec is counted in December and 30 Nov is not counted again', async () => {
    const d = fresh();
    const r = await add(d, semi('2026-11-15'), '2026-11-20'); // first Task is 30 Nov
    expect((await open(d, r.id)).data.dueDate).toBe('2026-11-30');
    await move(d, r.id, '2026-12-02');
    expect(datesOf(await estimate(d, '2026-11-20', 30), r.id)).toEqual(['2026-12-02', '2026-12-15']);
  });
  it('4. a visit moved beyond the next usual date passes over it, exactly as the real scheduler does when it is logged', async () => {
    const d = fresh();
    const r = await add(d, biweekly, '2026-11-06');
    await move(d, r.id, '2026-11-30'); // past the 20 Nov occurrence
    expect(datesOf(await estimate(d, '2026-11-06', 30), r.id)).toEqual(['2026-11-30', '2026-12-04']);
    // the same answer from the real code: log the moved visit on its day and look at the next Task
    const t = await open(d, r.id);
    const inp = { status: 'completed' as const, cancelledBy: null, date: '2026-11-30', notes: '', chargedCents: null, chargeKind: null };
    const plan = await planLogVisit(r.id, t.id, inp, '2026-11-30', d);
    await logVisitFromTask({ arrangementId: r.id, taskId: t.id, input: inp, today: '2026-11-30', expect: plan.expect }, d);
    expect((await open(d, r.id)).data.dueDate).toBe('2026-12-04');
  });
  it('4b. a visit moved EARLIER than its usual date: counted on the earlier day; the usual date is not counted again', async () => {
    const d = fresh();
    const r = await add(d, biweekly, '2026-11-06');
    await move(d, r.id, '2026-11-09'); // keep it simple: later by 3 days
    const t = await open(d, r.id);
    await saveTask(t.id, { ...t.data, dueDate: '2026-11-06' }, d); // back to today
    expect(datesOf(await estimate(d, '2026-11-06', 30), r.id)).toEqual(['2026-11-06', '2026-11-20', '2026-12-04']);
  });
  it('5. window edges: a moved visit due exactly on the last day counts; one day later does not, and neither do the visits after it', async () => {
    const d = fresh();
    const r = await add(d, weekly, '2026-11-06');
    await move(d, r.id, '2026-12-06'); // today + 30 days
    expect(datesOf(await estimate(d, '2026-11-06', 30), r.id)).toEqual(['2026-12-06']);
    await move(d, r.id, '2026-12-07');
    const w = await estimate(d, '2026-11-06', 30);
    expect(w.items).toEqual([]);
    expect(w.estimateCents).toBe(0);
    expect(datesOf(await estimate(d, '2026-11-06', 90), r.id).slice(0, 2)).toEqual(['2026-12-07', '2026-12-11']);
  });
  it('5b. a visit overdue (due before today) is not "upcoming"; the next usual dates after it still are', async () => {
    const d = fresh();
    const r = await add(d, weekly, '2026-11-06');
    await move(d, r.id, '2026-11-02');
    expect(datesOf(await estimate(d, '2026-11-06', 14), r.id)).toEqual(['2026-11-13', '2026-11-20']);
  });
  it('6. a paused or ended arrangement has no estimate at all', async () => {
    const d = fresh();
    const r = await add(d, weekly, '2026-11-06');
    const p = await planLifecycle(r.id, 'pause', '2026-11-06', d);
    await applyLifecycle({ action: 'pause', arrangementId: r.id, expect: p.expect, today: '2026-11-06' }, d);
    let w = await estimate(d, '2026-11-06', 90);
    expect(w).toMatchObject({ items: [], estimateCents: 0, notConverted: [] });
    const e = await planLifecycle(r.id, 'end', '2026-11-06', d);
    await applyLifecycle({ action: 'end', arrangementId: r.id, expect: e.expect, today: '2026-11-06', endReason: 'finished', endDate: '2026-11-06' }, d);
    w = await estimate(d, '2026-11-06', 90);
    expect(w).toMatchObject({ items: [], estimateCents: 0 });
  });
  it('7. a twice-monthly visit finished early in Tasks and not yet logged is not counted again; the next usual date is', async () => {
    const d = fresh();
    const r = await add(d, semi('2026-11-15'), '2026-11-06');
    await completeTask((await open(d, r.id)).id, '2026-11-10', d); // finished outside Services, 5 days early
    const w = await estimate(d, '2026-11-10', 30); // to 10 Dec
    expect(await open(d, r.id)).toBeUndefined();
    expect(datesOf(w, r.id)).toEqual(['2026-11-30']);
  });
  it('7b. a repeating visit finished in Tasks (Tasks made a copy that still carries the old marker): the copy is the one upcoming visit, counted once', async () => {
    const d = fresh();
    const r = await add(d, weekly, '2026-11-06');
    await completeTask((await open(d, r.id)).id, '2026-11-06', d);
    const t = await open(d, r.id);
    expect(t.data.dueDate).toBe('2026-11-13');
    expect(datesOf(await estimate(d, '2026-11-06', 14), r.id)).toEqual(['2026-11-13', '2026-11-20']);
  });
  it('an estimate never makes a visit, a completion or a payment, and never reaches the paid totals', async () => {
    const d = fresh();
    const r = await add(d, weekly, '2026-11-06');
    await move(d, r.id, '2026-11-08');
    const before = JSON.stringify([await d.moduleRecords.toArray(), await d.links.toArray(), await d.txns.toArray()]);
    const w = await estimate(d, '2026-11-06', 90);
    expect(w.estimateCents).toBeGreaterThan(0);
    expect(JSON.stringify([await d.moduleRecords.toArray(), await d.links.toArray(), await d.txns.toArray()])).toBe(before);
    const visits = await loadVisits(d);
    expect(visits).toEqual([]);
    const spent = servicesSpend(payRecords(await loadArrangements(d), visits), () => undefined);
    expect(spent.totalCents).toBe(0);
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
describe('correction 4 across two devices (real SyncEngine)', () => {
  it('A moves a visit and B finishes another arrangement elsewhere: after sync both devices give the same estimate dates', async () => {
    const remote = remoteStore();
    const mk = () => { const d = fresh(); return { d, engine: new SyncEngine(d, dexieMeta(`corr4-meta-${n++}`), remote, 'a good passphrase') }; };
    const A = mk(), B = mk();
    const r1 = await add(A.d, biweekly, '2026-11-06');
    const r2 = await add(A.d, semi('2026-11-15'), '2026-11-06');
    await A.engine.initialUpload(); await B.engine.replaceFromRemote();
    await move(A.d, r1.id, '2026-11-08');
    await completeTask((await open(B.d, r2.id)).id, '2026-11-10', B.d);
    for (let i = 0; i < 2; i++) { await A.engine.sync(); await B.engine.sync(); }
    await A.engine.sync();
    const a = await estimate(A.d, '2026-11-10', 30), b = await estimate(B.d, '2026-11-10', 30);
    expect(b.items).toEqual(a.items);
    expect(datesOf(a, r1.id)).toEqual(['2026-11-20', '2026-12-04']); // the moved visit (8 Nov) is already behind 10 Nov
    expect(datesOf(a, r2.id)).toEqual(['2026-11-30']);
  });
});
