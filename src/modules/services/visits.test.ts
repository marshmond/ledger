import { describe, expect, it, vi } from 'vitest';
import { FinanceDB } from '../../db';
import { installTracking } from '../../lib/sync/track';
import { completeTask, createTask, getTask, loadTasks, removeTasks, saveTask } from '../tasks/data';
import { blankTask } from '../tasks/model';
import { taskDueItems } from '../tasks/dueProvider';
import { createAsset } from '../assets/data';
import { blankAsset } from '../assets/model';
import { createArrangement, getArrangement, tasksOfArrangement, bookingTasksOf } from './data';
import { applyLifecycle, applyRepair, applyUndo, planLifecycle, planRepair, STALE } from './changes';
import { arrangementRef, blankArrangement, type Cadence } from './model';
import { markersOf, purposeOf, scheduleHealth } from './schedule';
import {
  addBookingReminder, isoOfMs, loadVisits, logStandaloneVisit, logVisitFromTask, nextAfterVisit, planLogVisit, unloggedVisits, updateVisit, visitAssetIds, type VisitInput,
} from './visits';
import {
  asVisit, blankVisit, chargeWords, duplicateGroups, normalizeVisit, statusWords, validateVisit, visitStats, type VisitRecord,
} from './visitModel';
import { providerNamed } from '../../core/contactTestkit';

/** Invented data only. Each test gets its own database. 2026-11-06 is a Friday. */
let n = 0;
const fresh = () => { const d = new FinanceDB(`test-visit-${n++}`); installTracking(d); return d; };
const TODAY = '2026-11-06';
const biweekly = (anchor = '2026-11-06'): Cadence => ({ mode: 'fixed', rule: { freq: 'weekly', interval: 2, end: { type: 'never' } }, anchorDate: anchor });
const weekly = (anchor = '2026-11-06'): Cadence => ({ mode: 'fixed', rule: { freq: 'weekly', interval: 1, end: { type: 'never' } }, anchorDate: anchor });
const quarterlyAfter = (anchor = '2026-11-06'): Cadence => ({ mode: 'after', rule: { freq: 'monthly', interval: 3, end: { type: 'never' } }, anchorDate: anchor });
const add = async (d: FinanceDB, over = {}, extra: Partial<Parameters<typeof createArrangement>[0]> = {}) =>
  createArrangement({ data: blankArrangement({ title: 'House cleaning', cadence: biweekly(), ...over }), provider: await providerNamed(d, "Rosa's Cleaning"), today: TODAY, ...extra }, d);
const openTasks = async (d: FinanceDB, id: number) => (await tasksOfArrangement(id, d)).filter((t) => t.data.status !== 'done');
const input = (over: Partial<VisitInput> = {}): VisitInput => ({ status: 'completed', cancelledBy: null, date: TODAY, notes: '', chargedCents: null, chargeKind: null, ...over });
const snapshot = async (d: FinanceDB) => JSON.stringify([await d.moduleRecords.toArray(), await d.links.toArray(), await d.contacts.toArray()]);
/** Preview, then write, exactly as the dialog does. */
async function log(d: FinanceDB, arrId: number, taskId: number, over: Partial<VisitInput> = {}, today = TODAY) {
  const inp = input({ date: today, ...over });
  const plan = await planLogVisit(arrId, taskId, inp, today, d);
  return logVisitFromTask({ arrangementId: arrId, taskId, input: inp, today, expect: plan.expect }, d);
}
const dueOf = async (d: FinanceDB, id: number) => (await openTasks(d, id)).map((t) => t.data.dueDate);

describe('visit model and validation', () => {
  const v = (over = {}) => blankVisit({ title: 'Lawn mowing', date: '2026-11-05', ...over });
  it('a valid completed visit passes; the title and a real date are required', () => {
    expect(validateVisit(v(), TODAY)).toBeNull();
    expect(validateVisit(v({ title: ' ' }), TODAY)).toMatch(/Enter what was done/);
    expect(validateVisit(v({ date: '2026-02-30' }), TODAY)).toMatch(/real date/);
    expect(validateVisit(v({ date: '' }), TODAY)).toMatch(/real date/);
    expect(validateVisit(v({ endDate: '2026-11-04' }), TODAY)).toMatch(/before the date/);
    expect(validateVisit(v({ endDate: '2026-11-31' }), TODAY)).toMatch(/not a real date/);
  });
  it('a completed visit cannot be in the future; skipped and cancelled may be, or in the past', () => {
    expect(validateVisit(v({ date: '2026-11-07' }), TODAY)).toMatch(/cannot be dated in the future/);
    expect(validateVisit(v({ date: '2026-11-07', status: 'skipped' }), TODAY)).toBeNull();
    expect(validateVisit(v({ date: '2026-11-07', status: 'cancelled', cancelledBy: 'provider' }), TODAY)).toBeNull();
    expect(validateVisit(v({ date: '2026-10-01', status: 'cancelled', cancelledBy: 'household' }), TODAY)).toBeNull();
  });
  it('a cancelled visit says who cancelled, and nobody else may', () => {
    expect(validateVisit(v({ status: 'cancelled' }), TODAY)).toMatch(/who cancelled/);
    expect(validateVisit(v({ status: 'completed', cancelledBy: 'provider' }), TODAY)).toMatch(/Only a cancelled/);
    expect(validateVisit(v({ status: 'skipped', cancelledBy: 'household' }), TODAY)).toMatch(/Only a cancelled/);
  });
  it('charges: whole non-negative cents with a valid kind; a cancelled visit is never charged as service', () => {
    expect(validateVisit(v({ chargedCents: 8500, chargeKind: 'service' }), TODAY)).toBeNull();
    expect(validateVisit(v({ chargedCents: -1, chargeKind: 'service' }), TODAY)).toMatch(/cannot be negative/);
    expect(validateVisit(v({ chargedCents: 10.5, chargeKind: 'service' }), TODAY)).toMatch(/whole number of cents/);
    expect(validateVisit(v({ chargedCents: Number.NaN, chargeKind: 'service' }), TODAY)).toMatch(/whole number/);
    expect(validateVisit(v({ chargedCents: 5, chargeKind: null }), TODAY)).toMatch(/what the charge is for/);
    expect(validateVisit(v({ chargedCents: 5, chargeKind: 'bogus' as never }), TODAY)).toMatch(/what the charge is for/);
    expect(validateVisit(v({ chargedCents: null, chargeKind: 'service' }), TODAY)).toMatch(/Enter the amount/);
    const c = v({ status: 'cancelled', cancelledBy: 'household' });
    expect(validateVisit({ ...c, chargedCents: 4000, chargeKind: 'service' }, TODAY)).toMatch(/cannot be charged as service/);
    expect(validateVisit({ ...c, chargedCents: 4000, chargeKind: 'cancellationFee' }, TODAY)).toBeNull();
    expect(validateVisit({ ...c, chargedCents: 4000, chargeKind: 'other' }, TODAY)).toBeNull();
  });
  it('normalising rounds a pasted float amount to whole cents; document links must be http(s)', () => {
    expect(normalizeVisit(v({ chargedCents: 85.4, chargeKind: 'service' })).chargedCents).toBe(85);
    expect(validateVisit(v({ refs: [{ label: 'Invoice', url: 'javascript:alert(1)' }] }), TODAY)).toMatch(/http/);
    expect(validateVisit(v({ refs: [{ label: 'Invoice', url: 'https://example.com/i.pdf' }] }), TODAY)).toBeNull();
    expect(validateVisit(v({ refs: [{ label: '', url: 'https://example.com' }] }), TODAY)).toMatch(/name/);
  });
  it('the reader never throws; an unknown status reads as unsupported (never as service, skipped or cancelled); unknown fields survive', () => {
    const rec = { id: 3, module: 'services', kind: 'visit', createdAt: 1, updatedAt: 1, data: { title: 5, status: 'rescheduled', date: 'x', chargedCents: 'a', chargeKind: 7, refs: [null, { label: 'ok' }], payment: 'finance', txnRefs: [{ a: 1 }], futureThing: { z: 1 } } };
    const a = asVisit(rec as never);
    expect(a.data).toMatchObject({ title: '(no title)', status: 'unsupported', statusRaw: 'rescheduled', date: '', chargedCents: null, chargeKind: null, refs: [{ label: 'ok' }], payment: 'none', txnRefs: [], futureThing: { z: 1 } }); // S3: `payment` is a real field now; a reference with no transaction id is dropped, and no payment is read from junk
    expect(() => asVisit({ ...rec, data: null } as never)).not.toThrow();
    expect(asVisit({ ...rec, data: { status: 'cancelled', cancelledBy: 'nobody' } } as never).data.cancelledBy).toBeNull();
    // a negative stored charge is not trusted
    expect(asVisit({ ...rec, data: { chargedCents: -5, chargeKind: 'service' } } as never).data).toMatchObject({ chargedCents: null, chargeKind: null });
  });
  it('has no account number, password, code or bank field', () => {
    expect(Object.keys(blankVisit()).filter((k) => /account|password|passcode|code|bank|iban|routing|pin\b/i.test(k))).toEqual([]);
  });
  it('plain-words labels keep the five outcomes apart', () => {
    const money = (c: number) => `$${c / 100}`;
    expect(statusWords({ status: 'completed', cancelledBy: null })).toBe('Completed');
    expect(statusWords({ status: 'skipped', cancelledBy: null })).toBe('Skipped');
    expect(statusWords({ status: 'cancelled', cancelledBy: 'provider' })).toBe('Cancelled by provider');
    expect(statusWords({ status: 'cancelled', cancelledBy: 'household' })).toBe('Cancelled by household');
    expect(chargeWords({ status: 'cancelled', chargedCents: 4000, chargeKind: 'cancellationFee' }, money)).toBe('Cancellation fee charged $40');
    expect(chargeWords({ status: 'completed', chargedCents: 8500, chargeKind: 'service' }, money)).toBe('Charged $85');
    expect(chargeWords({ status: 'completed', chargedCents: null, chargeKind: null }, money)).toBeNull();
  });
});

describe('the next visit follows the arrangement, not the moved Task (pure)', () => {
  const fixed = (c: Cadence) => blankArrangement({ cadence: c });
  it('weekly: a visit moved a day later still gives the next usual Friday', () => {
    expect(nextAfterVisit(fixed(weekly()), { occurrence: '2026-11-06', taskDue: '2026-11-07', visitDate: '2026-11-07', today: '2026-11-07' })).toBe('2026-11-13');
  });
  it('every other week: a move across a Sunday-to-Saturday week boundary keeps the same weeks', () => {
    // Fri 6 Nov moved to Sun 8 Nov, finished that day: next is Fri 20 Nov, never Fri 13 Nov
    expect(nextAfterVisit(fixed(biweekly()), { occurrence: '2026-11-06', taskDue: '2026-11-08', visitDate: '2026-11-08', today: '2026-11-08' })).toBe('2026-11-20');
    // and moved earlier, finished early
    expect(nextAfterVisit(fixed(biweekly()), { occurrence: '2026-11-20', taskDue: '2026-11-17', visitDate: '2026-11-17', today: '2026-11-17' })).toBe('2026-12-04');
  });
  it('early completion does not repeat the same date; late completion makes no backlog', () => {
    expect(nextAfterVisit(fixed(biweekly()), { occurrence: '2026-11-20', taskDue: '2026-11-20', visitDate: '2026-11-14', today: '2026-11-14' })).toBe('2026-12-04');
    expect(nextAfterVisit(fixed(biweekly()), { occurrence: '2026-11-20', taskDue: '2026-11-20', visitDate: '2026-12-05', today: '2026-12-05' })).toBe('2026-12-18');
  });
  it('repeat-after-each-visit counts from the service day, not from the occurrence', () => {
    expect(nextAfterVisit(fixed(quarterlyAfter()), { occurrence: '2026-11-06', taskDue: '2026-11-06', visitDate: '2026-11-04', today: '2026-11-06' })).toBe('2027-02-04');
    expect(nextAfterVisit(fixed(quarterlyAfter()), { occurrence: '2026-11-06', taskDue: '2026-11-06', visitDate: '2026-11-06', today: '2026-11-06' })).toBe('2027-02-06');
  });
  it('no schedule, a paused or ended arrangement, or an ended schedule gives no next date', () => {
    expect(nextAfterVisit(blankArrangement(), { occurrence: null, taskDue: TODAY, visitDate: TODAY, today: TODAY })).toBeNull();
    expect(nextAfterVisit({ ...fixed(weekly()), status: 'paused' }, { occurrence: TODAY, taskDue: TODAY, visitDate: TODAY, today: TODAY })).toBeNull();
    const until = { ...weekly(), rule: { ...weekly().rule, end: { type: 'until' as const, date: '2026-11-10' } } };
    expect(nextAfterVisit(fixed(until), { occurrence: TODAY, taskDue: TODAY, visitDate: TODAY, today: TODAY })).toBeNull();
  });
});

describe('Done, log it (one transaction)', () => {
  it('finishes the Task, saves a completed visit with snapshots, and creates the next Task from the schedule', async () => {
    const d = fresh();
    const r = await add(d);
    const t = (await openTasks(d, r.id))[0];
    const res = await log(d, r.id, r.taskId!, { notes: 'Brought extra supplies', chargedCents: 12000, chargeKind: 'service' });
    expect(res.mode).toBe('complete');
    const visits = await loadVisits(d);
    expect(visits).toHaveLength(1);
    expect(visits[0].data).toMatchObject({
      arrangementId: r.id, providerNameSnapshot: "Rosa's Cleaning", title: 'House cleaning', status: 'completed', date: TODAY, notes: 'Brought extra supplies',
      chargedCents: 12000, chargeKind: 'service', taskId: t.id, occurrence: TODAY, taskTitleSnapshot: "House cleaning: Rosa's Cleaning",
    });
    expect((await getTask(t.id, d))!.data.status).toBe('done');
    expect(await dueOf(d, r.id)).toEqual(['2026-11-20']);
    const next = (await openTasks(d, r.id))[0];
    expect(markersOf(next)).toEqual({ occurrence: '2026-11-20', arrangement: r.id });
  });
  it('keeps the next Task\'s id, links and contact (the spawned copy is reconciled, not replaced)', async () => {
    const d = fresh();
    const r = await add(d);
    const res = await log(d, r.id, r.taskId!);
    const next = (await openTasks(d, r.id))[0];
    expect(next.id).toBe(res.nextTaskId);
    expect(next.data.contactIds).toEqual((await getTask(r.taskId!, d))!.data.contactIds);
    const open = (await loadTasks(d)).filter((x) => x.data.status !== 'done');
    expect(open).toHaveLength(1); // exactly one: no second Task made independently
    expect(scheduleHealth((await getArrangement(r.id, d))!, await tasksOfArrangement(r.id, d)).state).toBe('ok');
  });
  it('weekly: a visit moved one day and finished that day does not shift any later visit', async () => {
    const d = fresh();
    const r = await add(d, { cadence: weekly() });
    const t = (await openTasks(d, r.id))[0];
    await saveTask(t.id, { ...t.data, dueDate: '2026-11-07' }, d); // moved once; the marker stays
    expect(scheduleHealth((await getArrangement(r.id, d))!, await tasksOfArrangement(r.id, d)).state).toBe('moved-once');
    await log(d, r.id, t.id, {}, '2026-11-07');
    expect(await dueOf(d, r.id)).toEqual(['2026-11-13']);
  });
  it('every other week: a move across a week boundary keeps the same weeks for every later visit', async () => {
    const d = fresh();
    const r = await add(d);
    let t = (await openTasks(d, r.id))[0];
    await saveTask(t.id, { ...t.data, dueDate: '2026-11-08' }, d); // Sunday
    await log(d, r.id, t.id, {}, '2026-11-08');
    expect(await dueOf(d, r.id)).toEqual(['2026-11-20']);
    t = (await openTasks(d, r.id))[0];
    await log(d, r.id, t.id, {}, '2026-11-20');
    expect(await dueOf(d, r.id)).toEqual(['2026-12-04']);
    t = (await openTasks(d, r.id))[0];
    await log(d, r.id, t.id, {}, '2026-12-04');
    expect(await dueOf(d, r.id)).toEqual(['2026-12-18']);
  });
  it('finishing early and finishing late give the right next Task, with no backlog of missed Tasks', async () => {
    const d = fresh();
    const r = await add(d);
    let t = (await openTasks(d, r.id))[0];
    await log(d, r.id, t.id, {}, '2026-11-04'); // early (the visit was due Fri 6 Nov); today is 4 Nov
    expect(await dueOf(d, r.id)).toEqual(['2026-11-20']);
    t = (await openTasks(d, r.id))[0];
    await log(d, r.id, t.id, {}, '2026-12-05'); // a fortnight late
    expect(await dueOf(d, r.id)).toEqual(['2026-12-18']);
    expect((await loadTasks(d)).filter((x) => x.data.status !== 'done')).toHaveLength(1);
  });
  it('fixed and repeat-after-visit cadences differ correctly', async () => {
    const f = fresh(); const a = fresh();
    const rf = await add(f, { cadence: { mode: 'fixed', rule: { freq: 'monthly', interval: 3, monthly: 'date', end: { type: 'never' } }, anchorDate: '2026-11-06' } });
    const ra = await add(a, { cadence: quarterlyAfter() });
    await log(f, rf.id, rf.taskId!, {}, '2026-11-04');
    await log(a, ra.id, ra.taskId!, {}, '2026-11-04');
    expect(await dueOf(f, rf.id)).toEqual(['2027-02-06']); // the arrangement's own 6th
    expect(await dueOf(a, ra.id)).toEqual(['2027-02-04']); // three months after the visit
    const nextA = (await openTasks(a, ra.id))[0];
    expect(nextA.data.repeat!.mode).toBe('after');
  });
  it('a time stays a standing property of the arrangement, not of a one-off change', async () => {
    const d = fresh();
    const r = await add(d, { visitTime: '09:00' });
    const t = (await openTasks(d, r.id))[0];
    expect(t.data.dueTime).toBe('09:00');
    await saveTask(t.id, { ...t.data, dueTime: '14:30' }, d); // one-time change
    await log(d, r.id, t.id);
    expect((await openTasks(d, r.id))[0].data.dueTime).toBe('09:00');
  });
  it('an arrangement with no schedule makes no next Task; a stopped-repeating Task still gets its next visit from the schedule', async () => {
    const d = fresh();
    const one = await add(d, { cadence: null }, { today: TODAY });
    const t1 = await createTask(blankTask({ title: 'Furnace check', dueDate: TODAY }), [arrangementRef(one.id)], d);
    await log(d, one.id, t1);
    expect(await openTasks(d, one.id)).toHaveLength(0);
    const e = await add(d, {}, {});
    const plan = await planLifecycle(e.id, 'pause', TODAY, d);
    await applyLifecycle({ action: 'pause', arrangementId: e.id, expect: plan.expect, today: TODAY, taskChoice: 'stop' }, d);
    const plan2 = await planLifecycle(e.id, 'resume', TODAY, d);
    await applyLifecycle({ action: 'resume', arrangementId: e.id, expect: plan2.expect, today: TODAY }, d);
    const t = (await openTasks(d, e.id))[0];
    await saveTask(t.id, { ...t.data, repeat: null }, d); // a Task that does not repeat
    await log(d, e.id, t.id);
    expect(await dueOf(d, e.id)).toEqual(['2026-11-20']);
  });
  it('copies the arrangement\'s asset links onto the visit (skipping assets that are gone)', async () => {
    const d = fresh();
    const house = await createAsset(blankAsset({ name: 'Main house', type: 'property' }), d);
    const r = await add(d, {}, { assetIds: [house] });
    const res = await log(d, r.id, r.taskId!);
    expect(await visitAssetIds(res.visitId, d)).toEqual([house]);
  });
  it('a timed visit stays ONE entry on the Calendar Tasks layer before and after logging, and is still logged', async () => {
    const d = fresh();
    const r = await add(d, { visitTime: '09:30' });
    const q = { from: '2026-11-01', to: '2026-12-31', today: TODAY, overdueDays: 0 } as never;
    let items = await taskDueItems(d, q);
    expect(items.filter((i) => i.title.startsWith('House cleaning'))).toHaveLength(1);
    expect(items[0]).toMatchObject({ time: '09:30', allDay: false, date: TODAY });
    await log(d, r.id, r.taskId!);
    items = await taskDueItems(d, q);
    const cleaning = items.filter((i) => i.title.startsWith('House cleaning'));
    expect(cleaning).toHaveLength(1);
    expect(cleaning[0]).toMatchObject({ time: '09:30', date: '2026-11-20' });
    expect(await loadVisits(d)).toHaveLength(1);
  });
});

describe('Skip and Cancel', () => {
  it('skip: a skipped visit, the task finished, the next visit scheduled; not service', async () => {
    const d = fresh();
    const r = await add(d);
    await log(d, r.id, r.taskId!, { status: 'skipped', notes: 'Away that week' });
    const [v] = await loadVisits(d);
    expect(v.data).toMatchObject({ status: 'skipped', cancelledBy: null, date: TODAY });
    expect(await dueOf(d, r.id)).toEqual(['2026-11-20']);
    expect(visitStats([v]).lastServiced).toBeNull();
  });
  it('cancel by provider with a cancellation fee: the status stays cancelled and it is never service', async () => {
    const d = fresh();
    const r = await add(d);
    await log(d, r.id, r.taskId!, { status: 'cancelled', cancelledBy: 'provider', chargedCents: 4000, chargeKind: 'cancellationFee' });
    const [v] = await loadVisits(d);
    expect(v.data).toMatchObject({ status: 'cancelled', cancelledBy: 'provider', chargedCents: 4000, chargeKind: 'cancellationFee' });
    const stats = visitStats([v]);
    expect(stats).toMatchObject({ completed: 0, cancelled: 1, cancelledWithFee: 1, lastServiced: null });
  });
  it('cancelling without saying who, or charging a cancelled visit as service, is refused and changes nothing', async () => {
    const d = fresh();
    const r = await add(d);
    const snap = await snapshot(d);
    await expect(log(d, r.id, r.taskId!, { status: 'cancelled' })).rejects.toThrow(/who cancelled/);
    await expect(log(d, r.id, r.taskId!, { status: 'cancelled', cancelledBy: 'household', chargedCents: 100, chargeKind: 'service' })).rejects.toThrow(/cannot be charged as service/);
    expect(await snapshot(d)).toBe(snap);
  });
  it('skipping or cancelling a FUTURE visit is allowed, and the next visit comes after that occurrence', async () => {
    const d = fresh();
    const r = await add(d);
    let t = (await openTasks(d, r.id))[0];
    await saveTask(t.id, { ...t.data, dueDate: '2026-11-20' }, d);
    await log(d, r.id, t.id, { status: 'cancelled', cancelledBy: 'household', date: '2026-11-20' });
    expect(await dueOf(d, r.id)).toEqual(['2026-12-04']);
    t = (await openTasks(d, r.id))[0];
    await log(d, r.id, t.id, { status: 'skipped', date: '2026-12-04' });
    expect(await dueOf(d, r.id)).toEqual(['2026-12-18']);
  });
});

describe('safety: rollback, repeats, conflicts', () => {
  it('a failed visit write rolls back the finished Task and the new Task and links (nothing changed)', async () => {
    const d = fresh();
    const r = await add(d);
    const snap = await snapshot(d);
    const orig = d.moduleRecords.add.bind(d.moduleRecords);
    const spy = vi.spyOn(d.moduleRecords, 'add').mockImplementation(((rec: { kind?: string }) => {
      if (rec.kind === 'visit') throw new Error('disk full');
      return orig(rec as never);
    }) as never);
    await expect(log(d, r.id, r.taskId!)).rejects.toThrow(/disk full/);
    spy.mockRestore();
    expect(await snapshot(d)).toBe(snap);
    expect((await getTask(r.taskId!, d))!.data.status).toBe('todo');
    expect(await loadVisits(d)).toHaveLength(0);
  });
  it('a failure while fixing the next Task also rolls everything back', async () => {
    const d = fresh();
    const r = await add(d);
    const snap = await snapshot(d);
    const orig = d.moduleRecords.put.bind(d.moduleRecords);
    let calls = 0;
    const spy = vi.spyOn(d.moduleRecords, 'put').mockImplementation(((rec: { module?: string }) => {
      if (rec.module === 'tasks' && ++calls >= 2) throw new Error('task write failed'); // the first put finishes the Task, the second moves the copy
      return orig(rec as never);
    }) as never);
    await expect(log(d, r.id, r.taskId!)).rejects.toThrow(/task write failed/);
    spy.mockRestore();
    expect(await snapshot(d)).toBe(snap);
  });
  it('a failed asset link write rolls back too', async () => {
    const d = fresh();
    const house = await createAsset(blankAsset({ name: 'Main house', type: 'property' }), d);
    const r = await add(d, {}, { assetIds: [house] });
    const snap = await snapshot(d);
    const orig = d.links.add.bind(d.links);
    const spy = vi.spyOn(d.links, 'add').mockImplementation(((rec: { fromModule?: string; fromId?: unknown }) => {
      if (String(rec.fromId).startsWith('visit:')) throw new Error('link failed');
      return orig(rec as never);
    }) as never);
    await expect(log(d, r.id, r.taskId!)).rejects.toThrow();
    spy.mockRestore();
    expect(await snapshot(d)).toBe(snap);
  });
  it('three overlapping presses (Done, Skip, Cancel) produce exactly one visit', async () => {
    const d = fresh();
    const r = await add(d);
    const plans = await Promise.all((['completed', 'skipped', 'cancelled'] as const).map((s) => planLogVisit(r.id, r.taskId!, input({ status: s, cancelledBy: s === 'cancelled' ? 'household' : null }), TODAY, d)));
    const res = await Promise.allSettled((['completed', 'skipped', 'cancelled'] as const).map((s, i) => logVisitFromTask({
      arrangementId: r.id, taskId: r.taskId!, input: input({ status: s, cancelledBy: s === 'cancelled' ? 'household' : null }), today: TODAY, expect: plans[i].expect }, d)));
    expect(res.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(res.filter((x) => x.status === 'rejected')).toHaveLength(2);
    expect(await loadVisits(d)).toHaveLength(1);
    expect((await loadTasks(d)).filter((t) => t.data.status !== 'done')).toHaveLength(1);
  });
  it('logging the same Task twice in a row is refused with a plain message', async () => {
    const d = fresh();
    const r = await add(d);
    await log(d, r.id, r.taskId!);
    await expect(log(d, r.id, r.taskId!)).rejects.toThrow(/already logged/);
    expect(await loadVisits(d)).toHaveLength(1);
  });
  it('a change after the preview (the Task was edited) is detected and nothing is written', async () => {
    const d = fresh();
    const r = await add(d);
    const plan = await planLogVisit(r.id, r.taskId!, input(), TODAY, d);
    await new Promise((res) => setTimeout(res, 5));
    const t = (await getTask(r.taskId!, d))!;
    await saveTask(t.id, { ...t.data, notes: 'edited elsewhere' }, d);
    const snap = await snapshot(d);
    await expect(logVisitFromTask({ arrangementId: r.id, taskId: t.id, input: input(), today: TODAY, expect: plan.expect }, d)).rejects.toThrow(STALE);
    expect(await snapshot(d)).toBe(snap);
  });
  it('a change to the arrangement after the preview is detected too', async () => {
    const d = fresh();
    const r = await add(d);
    const plan = await planLogVisit(r.id, r.taskId!, input(), TODAY, d);
    await new Promise((res) => setTimeout(res, 5));
    const a = (await getArrangement(r.id, d))!;
    await d.moduleRecords.update(a.id, { updatedAt: Date.now() + 10 });
    await expect(logVisitFromTask({ arrangementId: r.id, taskId: r.taskId!, input: input(), today: TODAY, expect: plan.expect }, d)).rejects.toThrow(STALE);
  });
  it('Undo takes it all back: the Task is open again, the copy and the visit are gone', async () => {
    const d = fresh();
    const r = await add(d);
    const res = await log(d, r.id, r.taskId!);
    await applyUndo(res.undo, d);
    expect(await loadVisits(d)).toHaveLength(0);
    expect(await dueOf(d, r.id)).toEqual([TODAY]);
    expect((await getTask(r.taskId!, d))!.data.status).toBe('todo');
    expect((await loadTasks(d)).filter((t) => t.data.status !== 'done')).toHaveLength(1);
  });
  it('a deleted Task never removes history', async () => {
    const d = fresh();
    const r = await add(d);
    await log(d, r.id, r.taskId!);
    await removeTasks([r.taskId!], d);
    expect(await loadVisits(d)).toHaveLength(1);
  });
});

describe('booking reminders are not visits', () => {
  it('a booking reminder is not a visit Task: not in the schedule, not offered for logging, not listed as unlogged', async () => {
    const d = fresh();
    const r = await add(d);
    const b = await addBookingReminder(r.id, '2026-11-10', d);
    const task = (await getTask(b, d))!;
    expect(purposeOf(task)).toBe('book');
    expect((await tasksOfArrangement(r.id, d)).map((t) => t.id)).not.toContain(b);
    expect((await bookingTasksOf(r.id, d)).map((t) => t.id)).toEqual([b]);
    expect(scheduleHealth((await getArrangement(r.id, d))!, await tasksOfArrangement(r.id, d)).state).toBe('ok'); // not "two upcoming tasks"
    await expect(log(d, r.id, b)).rejects.toThrow(/reminder to book/);
    await completeTask(b, TODAY, d);
    expect(await loadVisits(d)).toHaveLength(0);
    const a = (await getArrangement(r.id, d))!;
    expect(unloggedVisits([a], new Map([[r.id, await tasksOfArrangement(r.id, d)]]), [])).toHaveLength(0);
  });
  it('the reminder title and fields hold no contact details, amounts or notes', async () => {
    const d = fresh();
    const r = await add(d, { notes: 'secret note' });
    const t = (await getTask(await addBookingReminder(r.id, null, d), d))!;
    expect(t.data.title).toBe("Book: House cleaning with Rosa's Cleaning");
    expect(JSON.stringify(t.data)).not.toMatch(/secret note/);
  });
  it('a Task with no purpose marker (every S1 Task, or one linked by hand) is a visit Task', async () => {
    const d = fresh();
    const r = await add(d, { cadence: null });
    const t = await createTask(blankTask({ title: 'Linked by hand', dueDate: TODAY }), [arrangementRef(r.id)], d);
    expect(purposeOf((await getTask(t, d))!)).toBe('visit');
    expect((await tasksOfArrangement(r.id, d)).map((x) => x.id)).toEqual([t]);
  });
});

describe('finished, but not logged', () => {
  const finishInTasks = async (d: FinanceDB, taskId: number, day: string) => completeTask(taskId, day, d);
  it('a Task finished in Tasks is listed; nothing is created for it automatically', async () => {
    const d = fresh();
    const r = await add(d);
    await finishInTasks(d, r.taskId!, TODAY);
    expect(await loadVisits(d)).toHaveLength(0);
    const a = (await getArrangement(r.id, d))!;
    const tasksBy = new Map([[r.id, await tasksOfArrangement(r.id, d)]]);
    const list = unloggedVisits([a], tasksBy, []);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ arrangementId: r.id, finishedOn: isoOfMs(Date.now()), staleCopy: true });
    expect(list[0].task.id).toBe(r.taskId);
  });
  it('the respawned Task is flagged stale-marker; late-logging re-aligns it and keeps the REAL date, not today', async () => {
    const d = fresh();
    const r = await add(d);
    await finishInTasks(d, r.taskId!, TODAY);
    const a = (await getArrangement(r.id, d))!;
    expect(scheduleHealth(a, await tasksOfArrangement(r.id, d)).state).toBe('stale-marker');
    const copyBefore = (await openTasks(d, r.id))[0];
    // logged a week later, with the day it really happened
    const later = '2026-11-13';
    const res = await log(d, r.id, r.taskId!, { date: TODAY }, later);
    expect(res.mode).toBe('late');
    const [v] = await loadVisits(d);
    expect(v.data).toMatchObject({ date: TODAY, status: 'completed', taskId: r.taskId, occurrence: TODAY });
    expect(res.nextTaskId).toBe(copyBefore.id); // the same Task (id and links kept), not a new one
    expect((await openTasks(d, r.id)).map((t) => t.id)).toEqual([copyBefore.id]);
    expect(scheduleHealth((await getArrangement(r.id, d))!, await tasksOfArrangement(r.id, d)).state).toBe('ok');
    expect(await dueOf(d, r.id)).toEqual(['2026-11-20']);
    expect(unloggedVisits([(await getArrangement(r.id, d))!], new Map([[r.id, await tasksOfArrangement(r.id, d)]]), await loadVisits(d))).toHaveLength(0);
  });
  it('the late action does not finish the Task again (its completion time is untouched) and writes the date it is given', async () => {
    const d = fresh();
    const r = await add(d);
    await finishInTasks(d, r.taskId!, TODAY);
    const before = (await getTask(r.taskId!, d))!;
    await log(d, r.id, r.taskId!, { date: '2026-11-04' }, '2026-11-10');
    const after = (await getTask(r.taskId!, d))!;
    expect(after.data.completedAt).toBe(before.data.completedAt);
    expect(after.updatedAt).toBe(before.updatedAt);
    expect((await loadVisits(d))[0].data.date).toBe('2026-11-04');
  });
  it('logging it twice does not make a second visit', async () => {
    const d = fresh();
    const r = await add(d);
    await finishInTasks(d, r.taskId!, TODAY);
    await log(d, r.id, r.taskId!, { date: TODAY });
    await expect(log(d, r.id, r.taskId!, { date: TODAY })).rejects.toThrow(/already logged/);
    expect(await loadVisits(d)).toHaveLength(1);
  });
  it('the schedule-health check explains the disagreement in words and the Re-align fix still works', async () => {
    const d = fresh();
    const r = await add(d);
    await finishInTasks(d, r.taskId!, TODAY);
    const a = (await getArrangement(r.id, d))!;
    const h = scheduleHealth(a, await tasksOfArrangement(r.id, d));
    expect(h).toMatchObject({ state: 'stale-marker', needsAttention: true });
    const plan = await planRepair('realign', r.id, null, TODAY, d);
    await applyRepair({ kind: 'realign', arrangementId: r.id, taskId: null, expect: plan.expect, today: TODAY }, d);
    expect(scheduleHealth((await getArrangement(r.id, d))!, await tasksOfArrangement(r.id, d)).state).toBe('ok');
  });
  it('a copy the owner already re-aligned is left alone when the original is logged', async () => {
    const d = fresh();
    const r = await add(d);
    await finishInTasks(d, r.taskId!, TODAY);
    const plan = await planRepair('realign', r.id, null, TODAY, d);
    await applyRepair({ kind: 'realign', arrangementId: r.id, taskId: null, expect: plan.expect, today: TODAY }, d);
    const copy = (await openTasks(d, r.id))[0];
    const res = await log(d, r.id, r.taskId!, { date: TODAY });
    expect(res.nextTaskId).toBeNull();
    expect((await getTask(copy.id, d))!.updatedAt).toBe(copy.updatedAt);
  });
  it('a Task finished from the Calendar-style complete (completeTask) and one whose Task was deleted behave: deleted never listed', async () => {
    const d = fresh();
    const r = await add(d);
    await finishInTasks(d, r.taskId!, TODAY);
    await removeTasks([r.taskId!], d);
    const a = (await getArrangement(r.id, d))!;
    expect(unloggedVisits([a], new Map([[r.id, await tasksOfArrangement(r.id, d)]]), [])).toHaveLength(0);
  });
});

describe('one-off visits and late entries', () => {
  it('a one-off: provider, work and date only; no arrangement, no Task, and an existing contact is reused', async () => {
    const d = fresh();
    await add(d); // makes the "Rosa's Cleaning" contact
    const tasksBefore = (await loadTasks(d)).length;
    const arrBefore = await d.moduleRecords.where('[module+kind]').equals(['services', 'arrangement']).count();
    const res = await logStandaloneVisit({ provider: await providerNamed(d, "  rosa's cleaning "), input: input({ title: 'Fixed the outlet', date: '2026-11-03' }), today: TODAY }, d);
    expect(res.contactCreated).toBe(false);
    expect(await d.contacts.count()).toBe(1);
    const [v] = await loadVisits(d);
    expect(v.data).toMatchObject({ arrangementId: null, taskId: null, status: 'completed', date: '2026-11-03', title: 'Fixed the outlet', providerNameSnapshot: "Rosa's Cleaning" });
    expect((await loadTasks(d)).length).toBe(tasksBefore);
    expect(await d.moduleRecords.where('[module+kind]').equals(['services', 'arrangement']).count()).toBe(arrBefore);
  });
  it('a one-off with a new provider makes one contact; optional charge, document and asset are kept', async () => {
    const d = fresh();
    const house = await createAsset(blankAsset({ name: 'Main house', type: 'property' }), d);
    const res = await logStandaloneVisit({
      provider: { name: 'Pat the Plumber' }, assetIds: [house],
      input: input({ title: 'Drain repair', date: '2026-11-02', chargedCents: 18000, chargeKind: 'service', refs: [{ label: 'Invoice', url: 'https://example.com/inv.pdf' }] }), today: TODAY,
    }, d);
    expect(res.contactCreated).toBe(true);
    expect(await d.contacts.count()).toBe(1);
    const [v] = await loadVisits(d);
    expect(v.data).toMatchObject({ chargedCents: 18000, chargeKind: 'service', refs: [{ label: 'Invoice', url: 'https://example.com/inv.pdf' }] });
    expect(await visitAssetIds(v.id, d)).toEqual([house]);
  });
  it('needs a provider, a real date not in the future, and a double click saves once (the same operation)', async () => {
    const d = fresh();
    await expect(logStandaloneVisit({ provider: null, input: input({ title: 'X', date: TODAY }), today: TODAY }, d)).rejects.toThrow(/provider/);
    await expect(logStandaloneVisit({ provider: { name: 'Pat' }, input: input({ title: 'X', date: '2026-11-09' }), today: TODAY }, d)).rejects.toThrow(/future/);
    await expect(logStandaloneVisit({ provider: { name: 'Pat' }, input: input({ title: '', date: TODAY }), today: TODAY }, d)).rejects.toThrow(/what was done/);
    expect(await d.contacts.count()).toBe(0); // a refused one-off leaves no stray contact
    const req = { provider: { name: 'Pat' }, input: input({ title: 'Drain repair', date: TODAY }), today: TODAY, operationId: 'one-press' };
    await Promise.allSettled([logStandaloneVisit(req, d), logStandaloneVisit(req, d), logStandaloneVisit(req, d)]);
    expect(await loadVisits(d)).toHaveLength(1);
  });
  it('an ended arrangement keeps its history and accepts an explicitly logged late visit', async () => {
    const d = fresh();
    const r = await add(d);
    await log(d, r.id, r.taskId!);
    const plan = await planLifecycle(r.id, 'end', TODAY, d);
    await applyLifecycle({ action: 'end', arrangementId: r.id, expect: plan.expect, today: TODAY, taskChoice: 'remove' }, d);
    const res = await logStandaloneVisit({ arrangementId: r.id, input: input({ date: '2026-11-05', title: 'Last clean' }), today: TODAY }, d);
    const v = (await loadVisits(d)).find((x) => x.id === res.visitId)!;
    expect(v.data).toMatchObject({ arrangementId: r.id, providerNameSnapshot: "Rosa's Cleaning", taskId: null });
    expect(await openTasks(d, r.id)).toHaveLength(0); // still no new Task
    expect(await loadVisits(d)).toHaveLength(2);
  });
});

describe('history, editing and replaced providers', () => {
  it('history is newest first; only completed visits give "last serviced" and the completed count', async () => {
    const d = fresh();
    const r = await add(d, { cadence: weekly() });
    let t = (await openTasks(d, r.id))[0];
    await log(d, r.id, t.id, { date: '2026-11-06' });
    t = (await openTasks(d, r.id))[0];
    await log(d, r.id, t.id, { status: 'cancelled', cancelledBy: 'provider', date: '2026-11-13', chargedCents: 3000, chargeKind: 'cancellationFee' }, '2026-11-13');
    t = (await openTasks(d, r.id))[0];
    await log(d, r.id, t.id, { status: 'skipped', date: '2026-11-20' }, '2026-11-20');
    const visits = await loadVisits(d);
    expect(visits.map((v) => v.data.date)).toEqual(['2026-11-20', '2026-11-13', '2026-11-06']);
    expect(visitStats(visits)).toEqual({ completed: 1, skipped: 1, cancelled: 1, cancelledWithFee: 1, needsReview: 0, lastServiced: '2026-11-06' });
  });
  it('editing keeps the provider, arrangement, Task and occurrence; refuses bad data; keeps unknown fields; detects a stale edit', async () => {
    const d = fresh();
    const r = await add(d);
    const res = await log(d, r.id, r.taskId!);
    await d.moduleRecords.update(res.visitId, { 'data.futureField': { keep: true }, 'data.payment': 'finance' });
    const v0 = (await loadVisits(d))[0];
    await updateVisit(res.visitId, {
      title: 'Deep clean', status: 'completed', cancelledBy: null, date: '2026-11-05', endDate: null, notes: 'Windows too', chargedCents: 15000, chargeKind: 'service', refs: [], assetIds: [],
    }, TODAY, v0.updatedAt, d);
    const raw = (await d.moduleRecords.get(res.visitId))!.data as Record<string, unknown>;
    expect(raw).toMatchObject({ title: 'Deep clean', date: '2026-11-05', arrangementId: r.id, taskId: r.taskId, occurrence: TODAY, providerNameSnapshot: "Rosa's Cleaning", futureField: { keep: true }, payment: 'finance' });
    await expect(updateVisit(res.visitId, { title: 'X', status: 'completed', cancelledBy: null, date: '2026-12-31', endDate: null, notes: '', chargedCents: null, chargeKind: null, refs: [], assetIds: [] }, TODAY, null, d)).rejects.toThrow(/future/);
    await expect(updateVisit(res.visitId, { title: 'X', status: 'completed', cancelledBy: null, date: '2026-11-05', endDate: null, notes: '', chargedCents: null, chargeKind: null, refs: [], assetIds: [] }, TODAY, v0.updatedAt, d)).rejects.toThrow(/changed/);
  });
  it('the status can be corrected: a visit saved as completed can become skipped, and then it stops being service', async () => {
    const d = fresh();
    const r = await add(d);
    const res = await log(d, r.id, r.taskId!);
    await updateVisit(res.visitId, { title: 'House cleaning', status: 'skipped', cancelledBy: null, date: TODAY, endDate: null, notes: '', chargedCents: null, chargeKind: null, refs: [], assetIds: [] }, TODAY, null, d);
    expect(visitStats(await loadVisits(d)).lastServiced).toBeNull();
  });
  it('replacing the provider leaves earlier visits with the original provider and arrangement', async () => {
    const d = fresh();
    const r = await add(d);
    await log(d, r.id, r.taskId!);
    const plan = await planLifecycle(r.id, 'replace', TODAY, d);
    const res = await applyLifecycle({ action: 'replace', arrangementId: r.id, expect: plan.expect, today: TODAY, replace: { provider: { name: 'Bright Maids' } }, taskChoice: 'remove' }, d);
    const [v] = await loadVisits(d);
    expect(v.data).toMatchObject({ arrangementId: r.id, providerNameSnapshot: "Rosa's Cleaning" });
    expect(res.successorId).not.toBe(r.id);
    const succ = await openTasks(d, res.successorId!);
    await log(d, res.successorId!, succ[0].id);
    const both = await loadVisits(d);
    expect(both.map((x) => x.data.providerNameSnapshot).sort()).toEqual(['Bright Maids', "Rosa's Cleaning"]);
  });
  it('a removed contact or a missing arrangement does not stop history loading', async () => {
    const d = fresh();
    const r = await add(d);
    const res = await log(d, r.id, r.taskId!);
    await d.contacts.clear();
    await d.moduleRecords.update(r.id, { deletedAt: Date.now() });
    const [v] = await loadVisits(d);
    expect(v.id).toBe(res.visitId);
    expect(v.data.providerNameSnapshot).toBe("Rosa's Cleaning");
  });
});

describe('possible duplicate visits (pure, deterministic)', () => {
  const mk = (id: number, over = {}): VisitRecord => ({ id, createdAt: id, updatedAt: id, data: blankVisit({ title: 'Cleaning', date: '2026-11-06', arrangementId: 1, ...over }) });
  it('groups visits for the same Task; leaves different Tasks alone; look-alike one-offs are only a weak notice', () => {
    const g = duplicateGroups([mk(2, { taskId: 7 }), mk(1, { taskId: 7 }), mk(3, { taskId: 8 }), mk(4, { arrangementId: null }), mk(5, { arrangementId: null })]);
    expect(g.map((x) => x.reason)).toEqual(['task', 'lookalike']);
    expect(g[0].visits.map((v) => v.id)).toEqual([1, 2]);
    expect(g[1].visits.map((v) => v.id)).toEqual([4, 5]);
  });
  it('groups the same occurrence from different Tasks, and same-day hand-logged visits, but not different statuses', () => {
    const occ = duplicateGroups([mk(1, { taskId: 7, occurrence: '2026-11-06' }), mk(2, { taskId: 9, occurrence: '2026-11-06' }), mk(3, { taskId: 10, occurrence: '2026-11-06', status: 'skipped' })]);
    expect(occ).toHaveLength(1);
    expect(occ[0].reason).toBe('occurrence');
    expect(occ[0].visits.map((v) => v.id)).toEqual([1, 2]);
    expect(duplicateGroups([mk(1), mk(2)])[0].reason).toBe('same-day');
    expect(duplicateGroups([mk(1), mk(2, { status: 'skipped' })])).toHaveLength(0);
  });
  it('is order-independent and each visit appears in only one group', () => {
    const list = [mk(1, { taskId: 7, occurrence: '2026-11-06' }), mk(2, { taskId: 7, occurrence: '2026-11-06' }), mk(3, { taskId: 9, occurrence: '2026-11-06' })];
    const a = duplicateGroups(list), b = duplicateGroups([...list].reverse());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const ids = a.flatMap((g) => g.visits.map((v) => v.id));
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('Finance and other modules are untouched', () => {
  it('logging, skipping, cancelling and one-offs write nothing to any Finance table', async () => {
    const d = fresh();
    const tables = ['accounts', 'transactions', 'categories', 'recurring', 'recurringLog'].filter((t) => d.tables.some((x) => x.name === t));
    const before = JSON.stringify(await Promise.all(tables.map((t) => d.table(t).toArray())));
    const r = await add(d);
    await log(d, r.id, r.taskId!, { chargedCents: 9900, chargeKind: 'service' });
    const t = (await openTasks(d, r.id))[0];
    await log(d, r.id, t.id, { status: 'cancelled', cancelledBy: 'provider', chargedCents: 2500, chargeKind: 'cancellationFee', date: TODAY });
    await logStandaloneVisit({ provider: await providerNamed(d, 'Pat'), input: input({ title: 'Repair', chargedCents: 1000, chargeKind: 'other' }), today: TODAY }, d);
    expect(tables.length).toBeGreaterThan(0);
    expect(JSON.stringify(await Promise.all(tables.map((tb) => d.table(tb).toArray())))).toBe(before);
    const stored = JSON.stringify(await d.moduleRecords.where('[module+kind]').equals(['services', 'visit']).toArray());
    expect(stored).not.toMatch(/txnRefs|paidManual/);
  });
});
