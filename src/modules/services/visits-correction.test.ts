import { describe, expect, it } from 'vitest';
import { FinanceDB } from '../../db';
import { exportAll, importAll } from '../../lib/backup';
import { checkBackupText } from '../../lib/backupFile';
import { dexieMeta, RemoteConflict, SyncEngine, type RemoteFile, type RemoteStore } from '../../lib/sync/engine';
import { installTracking } from '../../lib/sync/track';
import { completeTask, createTask, getTask, saveTask } from '../tasks/data';
import { blankTask } from '../tasks/model';
import { createAsset } from '../assets/data';
import { blankAsset } from '../assets/model';
import { createArrangement, tasksOfArrangement } from './data';
import { applyLifecycle, applyUndo, planLifecycle, UNDO_REFUSED, UNDO_UNVERIFIED } from './changes';
import { arrangementRef, blankArrangement, type Cadence } from './model';
import { asVisit, duplicateGroups, statusWords, validateVisit, visitStats } from './visitModel';
import { loadVisits, logStandaloneVisit, logVisitFromTask, nextAfterVisit, planLogVisit, updateVisit, visitAssetIds, type VisitEdit, type VisitInput } from './visits';
import { attentionCounts, buildOverview, loadSnapshot } from './views';
import { attentionLines } from './todayCards';
import { providerNamed } from '../../core/contactTestkit';

/** Pre-commit correction pass: tests added AFTER the S2 report, one section per finding. Invented data only. 2026-11-06 is a Friday. */
let n = 0;
const fresh = () => { const d = new FinanceDB(`test-visit-fix-${n++}`); installTracking(d); return d; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const TODAY = '2026-11-06';
const fixedBiweekly: Cadence = { mode: 'fixed', rule: { freq: 'weekly', interval: 2, end: { type: 'never' } }, anchorDate: TODAY };
const afterQuarterly = (anchor = TODAY): Cadence => ({ mode: 'after', rule: { freq: 'monthly', interval: 3, end: { type: 'never' } }, anchorDate: anchor });
const afterMonths = (interval: number): Cadence => ({ mode: 'after', rule: { freq: 'monthly', interval, end: { type: 'never' } }, anchorDate: TODAY });
const add = async (d: FinanceDB, over = {}) => createArrangement({ data: blankArrangement({ title: 'House cleaning', cadence: fixedBiweekly, ...over }), provider: await providerNamed(d, "Rosa's Cleaning"), today: TODAY }, d);
const input = (over: Partial<VisitInput> = {}): VisitInput => ({ status: 'completed', cancelledBy: null, date: TODAY, notes: '', chargedCents: null, chargeKind: null, ...over });
const openTasks = async (d: FinanceDB, id: number) => (await tasksOfArrangement(id, d)).filter((t) => t.data.status !== 'done');
const snapshot = async (d: FinanceDB) => JSON.stringify([await d.moduleRecords.toArray(), await d.links.toArray(), await d.contacts.toArray()]);
async function log(d: FinanceDB, arrId: number, taskId: number, over: Partial<VisitInput> = {}, today = TODAY) {
  const inp = input({ date: today, ...over });
  const plan = await planLogVisit(arrId, taskId, inp, today, d);
  return logVisitFromTask({ arrangementId: arrId, taskId, input: inp, today, expect: plan.expect }, d);
}
const edit = (v: ReturnType<typeof asVisit>, over: Partial<VisitEdit> = {}): VisitEdit => ({
  title: v.data.title, status: v.data.status, cancelledBy: v.data.cancelledBy, date: v.data.date, endDate: v.data.endDate, notes: v.data.notes,
  chargedCents: v.data.chargedCents, chargeKind: v.data.chargeKind, refs: v.data.refs, assetIds: [], ...over,
});

describe('Finding 1: repeat-after cadence anchors', () => {
  const arr = (c: Cadence, status: 'active' | 'paused' | 'ended' = 'active') => blankArrangement({ cadence: c, status });
  it('completed EARLIER than its occurrence: counted from the service date, not the occurrence or today', () => {
    expect(nextAfterVisit(arr(afterQuarterly()), { status: 'completed', occurrence: '2026-11-20', taskDue: '2026-11-20', visitDate: '2026-11-14', today: '2026-11-14' })).toBe('2027-02-14');
  });
  it('completed LATE: counted from the service date', () => {
    expect(nextAfterVisit(arr(afterQuarterly()), { status: 'completed', occurrence: '2026-11-06', taskDue: '2026-11-06', visitDate: '2026-12-05', today: '2026-12-05' })).toBe('2027-03-05');
    // logged later than it happened: still the service date, even if that makes the next one overdue
    expect(nextAfterVisit(arr(afterQuarterly()), { status: 'completed', occurrence: '2026-11-06', taskDue: '2026-11-06', visitDate: '2026-05-01', today: '2026-11-06' })).toBe('2026-08-01');
  });
  it('a FUTURE visit CANCELLED today counts from the date it was due, not from the day it was cancelled', () => {
    const next = nextAfterVisit(arr(afterQuarterly()), { status: 'cancelled', occurrence: '2026-11-23', taskDue: '2026-11-23', visitDate: '2026-11-23', today: TODAY });
    expect(next).toBe('2027-02-23');
    expect(next).not.toBe('2027-02-06'); // what "today plus the interval" would have given
  });
  it('a FUTURE visit SKIPPED today is the same', () => {
    expect(nextAfterVisit(arr(afterQuarterly()), { status: 'skipped', occurrence: '2026-11-23', taskDue: '2026-11-23', visitDate: '2026-11-23', today: TODAY })).toBe('2027-02-23');
  });
  it('a missed visit cancelled or skipped long after its date is due today, never in the past', () => {
    expect(nextAfterVisit(arr(afterQuarterly()), { status: 'cancelled', occurrence: '2026-08-01', taskDue: '2026-08-01', visitDate: '2026-08-01', today: TODAY })).toBe(TODAY);
    expect(nextAfterVisit(arr(afterQuarterly()), { status: 'skipped', occurrence: '2026-05-01', taskDue: '2026-05-01', visitDate: '2026-05-01', today: TODAY })).toBe(TODAY);
  });
  it('across a month and a year boundary (and a leap year)', () => {
    const at = (c: Cadence, date: string) => nextAfterVisit(arr(c), { status: 'completed', occurrence: date, taskDue: date, visitDate: date, today: date });
    expect(at(afterMonths(1), '2026-12-15')).toBe('2027-01-15'); // year boundary
    expect(at(afterMonths(2), '2026-11-30')).toBe('2027-01-30');
    expect(at(afterQuarterly(), '2026-11-30')).toBe('2027-02-28'); // short month
    expect(at(afterQuarterly(), '2027-11-30')).toBe('2028-02-29'); // leap year
    const yearly: Cadence = { mode: 'after', rule: { freq: 'yearly', interval: 1, end: { type: 'never' } }, anchorDate: TODAY };
    expect(at(yearly, '2026-12-31')).toBe('2027-12-31');
    // cancelled across a boundary uses the intended date
    expect(nextAfterVisit(arr(afterMonths(2)), { status: 'cancelled', occurrence: '2026-12-20', taskDue: '2026-12-20', visitDate: '2026-12-20', today: TODAY })).toBe('2027-02-20');
  });
  it('a PAUSED or ENDED arrangement gives no next date for any status', () => {
    for (const status of ['paused', 'ended'] as const) {
      for (const st of ['completed', 'skipped', 'cancelled'] as const) {
        expect(nextAfterVisit(arr(afterQuarterly(), status), { status: st, occurrence: TODAY, taskDue: TODAY, visitDate: TODAY, today: TODAY })).toBeNull();
      }
    }
  });
  it('end to end: a future visit cancelled today moves the next Task to its intended date plus the interval, and the preview says why', async () => {
    const d = fresh();
    const r = await add(d, { cadence: afterQuarterly() });
    const t = (await openTasks(d, r.id))[0];
    await saveTask(t.id, { ...t.data, dueDate: '2026-11-23' }, d);
    const inp = input({ status: 'cancelled', cancelledBy: 'provider', date: '2026-11-23' });
    const plan = await planLogVisit(r.id, t.id, inp, TODAY, d);
    expect(plan.nextDate).toBe('2027-02-23');
    expect(plan.lines.join(' ')).toMatch(/counted from the date this visit was due.*not from today/);
    await logVisitFromTask({ arrangementId: r.id, taskId: t.id, input: inp, today: TODAY, expect: plan.expect }, d);
    expect((await openTasks(d, r.id)).map((x) => x.data.dueDate)).toEqual(['2027-02-23']);
  });
  it('end to end: a completed visit re-bases the cycle on its own date', async () => {
    const d = fresh();
    const r = await add(d, { cadence: afterQuarterly() });
    await log(d, r.id, r.taskId!, {}, '2026-11-04');
    expect((await openTasks(d, r.id)).map((x) => x.data.dueDate)).toEqual(['2027-02-04']);
  });
  it('end to end: logging on an ended arrangement schedules nothing and creates no Task', async () => {
    const d = fresh();
    const r = await add(d, { cadence: afterQuarterly() });
    const plan = await planLifecycle(r.id, 'end', TODAY, d);
    await applyLifecycle({ action: 'end', arrangementId: r.id, expect: plan.expect, today: TODAY, taskChoice: 'keep' }, d);
    const inp = input();
    const p = await planLogVisit(r.id, r.taskId!, inp, TODAY, d);
    expect(p.nextDate).toBeNull();
    expect(p.lines.join(' ')).toMatch(/ended, so no further visit/);
    await logVisitFromTask({ arrangementId: r.id, taskId: r.taskId!, input: inp, today: TODAY, expect: p.expect }, d);
    expect(await openTasks(d, r.id)).toHaveLength(0);
  });
});

describe('Finding 2: one-off visits are idempotent per operation, not per description', () => {
  const req = (over = {}) => ({ provider: { name: 'Pat the Plumber' }, input: input({ title: 'Drain repair', date: TODAY }), today: TODAY, ...over });
  it('the SAME operation submitted repeatedly (a double click) saves one visit and reports the earlier one', async () => {
    const d = fresh();
    const res = await Promise.allSettled([1, 2, 3].map(() => logStandaloneVisit(req({ operationId: 'op-1' }), d)));
    expect(res.every((x) => x.status === 'fulfilled')).toBe(true);
    const ok = res.map((x) => (x as PromiseFulfilledResult<Awaited<ReturnType<typeof logStandaloneVisit>>>).value);
    expect(new Set(ok.map((x) => x.visitId)).size).toBe(1);
    expect(ok.filter((x) => x.repeated)).toHaveLength(2);
    expect(await loadVisits(d)).toHaveLength(1);
    expect(await d.contacts.count()).toBe(1);
  });
  it('two SEPARATE entries with identical details are both saved, with a warning, and both flagged as look-alikes', async () => {
    const d = fresh();
    const plumber = await providerNamed(d, 'Pat the Plumber'); // one Contact, chosen by id, for both entries
    const a = await logStandaloneVisit(req({ provider: plumber, operationId: 'op-a' }), d);
    const b = await logStandaloneVisit(req({ provider: plumber, operationId: 'op-b' }), d);
    expect(a.similarVisitId).toBeNull();
    expect(b).toMatchObject({ repeated: false, similarVisitId: a.visitId });
    expect(await loadVisits(d)).toHaveLength(2);
    const groups = duplicateGroups(await loadVisits(d));
    expect(groups).toHaveLength(1);
    expect(groups[0].reason).toBe('lookalike');
    // the weak notice is shown on the pages but is not an attention item on Today
    const snap = await loadSnapshot(d);
    expect(buildOverview(snap).duplicates).toHaveLength(1);
    expect(attentionCounts(snap).duplicateGroups).toBe(0);
  });
  it('legitimate same-day visits with different details, an entry without an operation id, and a different provider are not warned about', async () => {
    const d = fresh();
    const plumber = await providerNamed(d, 'Pat the Plumber');
    await logStandaloneVisit(req({ provider: plumber, operationId: 'op-1' }), d);
    const other = await logStandaloneVisit(req({ provider: plumber, operationId: 'op-2', input: input({ title: 'Boiler check', date: TODAY }) }), d);
    expect(other.similarVisitId).toBeNull();
    const noId = await logStandaloneVisit(req({ provider: plumber, input: input({ title: 'Drain repair', date: '2026-11-05' }) }), d);
    expect(noId.similarVisitId).toBeNull();
    const diff = await logStandaloneVisit(req({ operationId: 'op-3', provider: await providerNamed(d, 'Sam the Plumber') }), d);
    expect(diff.similarVisitId).toBeNull();
    expect(await loadVisits(d)).toHaveLength(4);
  });
  it('the operation id survives an edit, so a repeated press after editing is still harmless', async () => {
    const d = fresh();
    const a = await logStandaloneVisit(req({ operationId: 'op-keep' }), d);
    const v = (await loadVisits(d))[0];
    await updateVisit(a.visitId, edit(v, { notes: 'Edited' }), TODAY, null, d);
    const again = await logStandaloneVisit(req({ operationId: 'op-keep' }), d);
    expect(again).toMatchObject({ repeated: true, visitId: a.visitId });
    expect(await loadVisits(d)).toHaveLength(1);
  });
  it('an invalid or refused entry stores nothing and burns no operation id', async () => {
    const d = fresh();
    await expect(logStandaloneVisit(req({ operationId: 'op-x', input: input({ title: '', date: TODAY }) }), d)).rejects.toThrow();
    expect(await d.contacts.count()).toBe(0);
    await logStandaloneVisit(req({ operationId: 'op-x' }), d);
    expect(await loadVisits(d)).toHaveLength(1);
  });
  it('the strong guard for an originating Task is unchanged (same Task twice is refused)', async () => {
    const d = fresh();
    const r = await add(d);
    await log(d, r.id, r.taskId!);
    await expect(log(d, r.id, r.taskId!)).rejects.toThrow(/already logged/);
    expect(await loadVisits(d)).toHaveLength(1);
  });
});

describe('Finding 3: an unknown visit status is neither counted nor silently converted', () => {
  const rec = (status: unknown, extra = {}) => ({ id: 9, module: 'services', kind: 'visit', createdAt: 1, updatedAt: 1, data: { title: 'Odd', date: '2026-11-01', status, cancelledBy: 'provider', ...extra } });
  it('an invented future status and malformed ones read as unsupported with the raw value kept', () => {
    for (const raw of ['rescheduled', 'COMPLETED', 7, null, { a: 1 }, undefined, '']) {
      const v = asVisit(rec(raw) as never);
      expect(v.data.status).toBe('unsupported');
      expect(v.data.statusRaw).toEqual(raw);
      expect(v.data.cancelledBy).toBeNull();
      expect(statusWords(v.data)).toMatch(/Needs review/);
    }
    expect(asVisit(rec('completed') as never).data.statusRaw).toBeUndefined();
  });
  it('it is not completed service, not skipped, not cancelled: it appears only in the needs-review count', () => {
    const list = [asVisit(rec('rescheduled') as never), asVisit({ ...rec('completed'), id: 10 } as never)];
    expect(visitStats(list)).toMatchObject({ completed: 1, skipped: 0, cancelled: 0, needsReview: 1, lastServiced: '2026-11-01' });
    expect(visitStats([list[0]])).toMatchObject({ completed: 0, skipped: 0, cancelled: 0, needsReview: 1, lastServiced: null });
    expect(validateVisit(list[0].data, TODAY)).toMatch(/Pick whether/); // it can never be written as a new visit
  });
  it('the overview, the Today lines and the counts say so, and a group of them is never a duplicate', async () => {
    const d = fresh();
    await d.moduleRecords.bulkAdd([rec('rescheduled', { providerContactId: null }), { ...rec('rescheduled'), id: 11 }] as never);
    const snap = await loadSnapshot(d);
    expect(buildOverview(snap).needsReview).toHaveLength(2);
    expect(attentionCounts(snap).needsReview).toBe(2);
    expect(attentionLines({ unlogged: 0, duplicateGroups: 0, scheduleChecks: 0, needsReview: 2 })[0].text).toBe('2 visits have a status this version does not understand');
    expect(duplicateGroups(snap.visits)).toHaveLength(0);
  });
  it('an ordinary edit keeps the raw status, who cancelled and every unknown field exactly as found', async () => {
    const d = fresh();
    await d.moduleRecords.add({ ...rec('rescheduled', { futureField: { keep: 1 }, payment: 'finance' }), id: 20, deletedAt: null } as never);
    const v = (await loadVisits(d))[0];
    await updateVisit(20, edit(v, { notes: 'Added a note', title: 'Renamed' }), TODAY, v.updatedAt, d);
    const raw = (await d.moduleRecords.get(20))!.data as Record<string, unknown>;
    expect(raw).toMatchObject({ status: 'rescheduled', cancelledBy: 'provider', futureField: { keep: 1 }, payment: 'finance', title: 'Renamed', notes: 'Added a note' });
    expect(raw.statusRaw).toBeUndefined(); // the reader-only field is never stored
    expect((await loadVisits(d))[0].data.status).toBe('unsupported');
  });
  it('a malformed status (a number) round-trips as the same number', async () => {
    const d = fresh();
    await d.moduleRecords.add({ ...rec(7), id: 21, deletedAt: null } as never);
    const v = (await loadVisits(d))[0];
    await updateVisit(21, edit(v, { notes: 'x' }), TODAY, null, d);
    expect(((await d.moduleRecords.get(21))!.data as Record<string, unknown>).status).toBe(7);
  });
  it('only an explicit choice converts it; the dialog value "unsupported" on a supported visit is refused', async () => {
    const d = fresh();
    await d.moduleRecords.add({ ...rec('rescheduled'), id: 22, deletedAt: null } as never);
    const v = (await loadVisits(d))[0];
    await updateVisit(22, edit(v, { status: 'skipped' }), TODAY, null, d);
    const raw = (await d.moduleRecords.get(22))!.data as Record<string, unknown>;
    expect(raw.status).toBe('skipped');
    expect(raw.statusRaw).toBeUndefined();
    const ok = (await loadVisits(d))[0];
    await expect(updateVisit(22, edit(ok, { status: 'unsupported' }), TODAY, null, d)).rejects.toThrow(/Pick whether/);
  });
  it('a stale edit of an unsupported visit is still refused', async () => {
    const d = fresh();
    await d.moduleRecords.add({ ...rec('rescheduled'), id: 23, deletedAt: null } as never);
    const v = (await loadVisits(d))[0];
    await expect(updateVisit(23, edit(v), TODAY, v.updatedAt - 1, d)).rejects.toThrow(/changed/);
  });
});

describe('Finding 4: Undo refuses when what it would reverse has changed', () => {
  const refused = async (d: FinanceDB, undo: Parameters<typeof applyUndo>[0]) => {
    const snap = await snapshot(d);
    await expect(applyUndo(undo, d)).rejects.toThrow(UNDO_REFUSED);
    expect(await snapshot(d)).toBe(snap); // nothing at all was written
  };
  it('still works when nothing changed (Done, Skip, Cancel, one-off, late log)', async () => {
    const d = fresh();
    const r = await add(d);
    for (const s of ['completed', 'skipped', 'cancelled'] as const) {
      const before = await snapshot(d);
      const t = (await openTasks(d, r.id))[0];
      const res = await log(d, r.id, t.id, { status: s, cancelledBy: s === 'cancelled' ? 'household' : null });
      await applyUndo(res.undo, d);
      expect((await loadVisits(d)).length).toBe(0);
      expect((await getTask(t.id, d))!.data.status).toBe('todo');
      expect((await openTasks(d, r.id)).length).toBe(1);
      void before;
    }
    const one = await logStandaloneVisit({ provider: await providerNamed(d, 'Pat'), input: input({ title: 'Tap' }), today: TODAY, operationId: 'u1' }, d);
    await applyUndo(one.undo, d);
    expect(await loadVisits(d)).toHaveLength(0);
    await completeTask(r.taskId!, TODAY, d);
    const late = await log(d, r.id, r.taskId!);
    expect(late.mode).toBe('late');
    await applyUndo(late.undo, d);
    expect(await loadVisits(d)).toHaveLength(0);
  });
  it('refuses when the visit was edited afterwards (here or on another device)', async () => {
    const d = fresh();
    const r = await add(d);
    const res = await log(d, r.id, r.taskId!);
    await sleep(5);
    const v = (await loadVisits(d))[0];
    await updateVisit(res.visitId, edit(v, { notes: 'Edited later' }), TODAY, null, d);
    await refused(d, res.undo);
    expect((await loadVisits(d))[0].data.notes).toBe('Edited later');
  });
  it('refuses when the next Task Tasks made was modified, completed or moved afterwards', async () => {
    const d = fresh();
    const r = await add(d);
    const res = await log(d, r.id, r.taskId!);
    await sleep(5);
    const next = (await openTasks(d, r.id))[0];
    await saveTask(next.id, { ...next.data, notes: 'bring a ladder' }, d);
    await refused(d, res.undo);
    expect((await getTask(next.id, d))!.data.notes).toBe('bring a ladder');
    await sleep(5);
    await completeTask(next.id, TODAY, d); // acted upon independently
    await refused(d, res.undo);
  });
  it('refuses when the finished Task was reopened or changed after the original action', async () => {
    const d = fresh();
    const r = await add(d);
    const res = await log(d, r.id, r.taskId!);
    await sleep(5);
    const t = (await getTask(r.taskId!, d))!;
    await saveTask(t.id, { ...t.data, status: 'todo', completedAt: null, dueDate: '2026-11-09' }, d);
    await refused(d, res.undo);
    expect((await getTask(r.taskId!, d))!.data.dueDate).toBe('2026-11-09');
  });
  it('refuses when a later operation changed the visit\'s links (asset links are edited through the visit record)', async () => {
    const d = fresh();
    const house = await createAsset(blankAsset({ name: 'Main house', type: 'property' }), d);
    const r = await createArrangement({ data: blankArrangement({ title: 'House cleaning', cadence: fixedBiweekly }), provider: await providerNamed(d, "Rosa's Cleaning"), assetIds: [house], today: TODAY }, d);
    const res = await log(d, r.id, r.taskId!);
    await sleep(5);
    const v = (await loadVisits(d))[0];
    await updateVisit(res.visitId, edit(v, { assetIds: [] }), TODAY, null, d);
    await refused(d, res.undo);
    expect(await visitAssetIds(res.visitId, d)).toEqual([]);
  });
  it('refuses to reverse a one-off visit that was edited, and a late log whose Task copy was changed', async () => {
    const d = fresh();
    const one = await logStandaloneVisit({ provider: await providerNamed(d, 'Pat'), input: input({ title: 'Tap' }), today: TODAY, operationId: 'u2' }, d);
    await sleep(5);
    const v = (await loadVisits(d))[0];
    await updateVisit(one.visitId, edit(v, { title: 'Tap fixed' }), TODAY, null, d);
    await refused(d, one.undo);
    const r = await add(d);
    await completeTask(r.taskId!, TODAY, d);
    const late = await log(d, r.id, r.taskId!);
    await sleep(5);
    const copy = (await openTasks(d, r.id))[0];
    await saveTask(copy.id, { ...copy.data, notes: 'changed' }, d);
    await refused(d, late.undo);
  });
  it('a visit with a different provider acted upon independently does not block an unrelated Undo', async () => {
    const d = fresh();
    const r = await add(d);
    const a = await log(d, r.id, r.taskId!);
    const other = await logStandaloneVisit({ provider: await providerNamed(d, 'Pat'), input: input({ title: 'Tap' }), today: TODAY, operationId: 'u3' }, d);
    await sleep(5);
    const v = (await loadVisits(d)).find((x) => x.id === other.visitId)!;
    await updateVisit(other.visitId, edit(v, { notes: 'unrelated edit' }), TODAY, null, d);
    await applyUndo(a.undo, d); // only records THIS action touched are checked
    expect((await loadVisits(d)).map((x) => x.id)).toEqual([other.visitId]);
  });
  it('an Undo with no remembered state (made before the S2.1 guard) is refused, never trusted', async () => {
    const d = fresh();
    const r = await add(d);
    const res = await log(d, r.id, r.taskId!);
    const legacy = { ...res.undo, sealed: undefined };
    const snap = await snapshot(d);
    await expect(applyUndo(legacy, d)).rejects.toThrow(UNDO_UNVERIFIED);
    expect(await snapshot(d)).toBe(snap);
    expect(await loadVisits(d)).toHaveLength(1);
  });
});

describe('Findings 3 and 4 across two devices (real sync engine) and backup', () => {
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
  const devices = () => {
    const remote = remoteStore();
    const mk = () => { const d = fresh(); return { d, engine: new SyncEngine(d, dexieMeta(`fix-meta-${n++}`), remote, 'a good passphrase') }; };
    return { A: mk(), B: mk() };
  };
  type Dev = ReturnType<typeof devices>['A'];
  const settle = async (A: Dev, B: Dev) => { for (let i = 0; i < 2; i++) { await A.engine.sync(); await B.engine.sync(); } await A.engine.sync(); };
  async function seeded() {
    const { A, B } = devices();
    const r = await createArrangement({ data: blankArrangement({ title: 'House cleaning', cadence: fixedBiweekly }), provider: await providerNamed(A.d, "Rosa's Cleaning"), today: TODAY }, A.d);
    await A.engine.initialUpload();
    await B.engine.replaceFromRemote();
    return { A, B, r };
  }
  it('A logs a visit, B edits it, they sync: A\'s Undo is refused and both devices keep the edited visit and its Tasks', async () => {
    const { A, B, r } = await seeded();
    const res = await log(A.d, r.id, r.taskId!);
    await settle(A, B);
    await sleep(15);
    const vb = (await loadVisits(B.d))[0];
    await updateVisit(res.visitId, edit(vb, { notes: 'edited on B' }), TODAY, null, B.d);
    await settle(A, B);
    for (const x of [A, B]) {
      const snap = await snapshot(x.d);
      await expect(applyUndo(res.undo, x.d)).rejects.toThrow(UNDO_REFUSED);
      expect(await snapshot(x.d)).toBe(snap);
      expect((await loadVisits(x.d))[0].data.notes).toBe('edited on B');
      expect((await openTasks(x.d, r.id)).length).toBe(1);
    }
  });
  it('A logs a visit, B changes the next Task, they sync: A\'s Undo is refused and the Task keeps B\'s change', async () => {
    const { A, B, r } = await seeded();
    const res = await log(A.d, r.id, r.taskId!);
    await settle(A, B);
    await sleep(15);
    const next = (await openTasks(B.d, r.id))[0];
    await saveTask(next.id, { ...next.data, notes: 'changed on B' }, B.d);
    await settle(A, B);
    const snap = await snapshot(A.d);
    await expect(applyUndo(res.undo, A.d)).rejects.toThrow(UNDO_REFUSED);
    expect(await snapshot(A.d)).toBe(snap);
    expect((await openTasks(A.d, r.id))[0].data.notes).toBe('changed on B');
  });
  it('an unsupported status survives sync and backup restore byte for byte', async () => {
    const { A, B } = devices();
    await A.d.moduleRecords.add({ id: 77, module: 'services', kind: 'visit', createdAt: 1, updatedAt: 5, deletedAt: null, data: { title: 'Odd', date: '2026-11-01', status: 'rescheduled-by-a-future-version', cancelledBy: 'provider', futureField: { a: [1, 2] } } } as never);
    await A.engine.initialUpload();
    await B.engine.replaceFromRemote();
    const raw = async (d: FinanceDB) => JSON.stringify((await d.moduleRecords.get(77))!.data);
    expect(await raw(B.d)).toBe(await raw(A.d));
    const C = fresh();
    await importAll(C, checkBackupText(JSON.stringify(await exportAll(A.d))).file);
    expect(await raw(C)).toBe(await raw(A.d));
    expect((await loadVisits(C))[0].data.status).toBe('unsupported');
  });
  it('a hand-linked Task and an operation id round-trip through backup', async () => {
    const d = fresh();
    const r = await add(d, { cadence: null });
    const t = await createTask(blankTask({ title: 'Linked by hand', dueDate: TODAY }), [arrangementRef(r.id)], d);
    await log(d, r.id, t);
    await logStandaloneVisit({ provider: await providerNamed(d, 'Pat'), input: input({ title: 'Tap' }), today: TODAY, operationId: 'op-backup' }, d);
    const C = fresh();
    await importAll(C, checkBackupText(JSON.stringify(await exportAll(d))).file);
    expect(((await loadVisits(C)).find((v) => v.data.title === 'Tap')!.data as unknown as Record<string, unknown>).operationId).toBe('op-backup');
    const again = await logStandaloneVisit({ provider: await providerNamed(d, 'Pat'), input: input({ title: 'Tap' }), today: TODAY, operationId: 'op-backup' }, C);
    expect(again.repeated).toBe(true);
  });
});
