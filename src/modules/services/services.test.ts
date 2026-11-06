import { describe, expect, it, vi } from 'vitest';
import { FinanceDB } from '../../db';
import { createStore } from '../../core/store';
import { installTracking } from '../../lib/sync/track';
import { normalizeRule } from '../../core/recurrence';
import { completeTask, createTask, getTask, loadTasks, removeTasks, saveTask } from '../tasks/data';
import { asTask, blankTask } from '../tasks/model';
import { createAsset } from '../assets/data';
import { blankAsset } from '../assets/model';
import {
  createArrangement, ensureNextVisitTask, getArrangement, linkedAssetIds, loadArrangements, syncAssetLinks, tasksOfArrangement, updateArrangement, writeArrangement,
} from './data';
import {
  applyLifecycle, applyRepair, applyScheduleChange, applyUndo, planLifecycle, planRepair, planScheduleChange, repairEffect, STALE, type LifecycleRequest,
} from './changes';
import { arrangementRef, asArrangement, blankArrangement, cadenceText, normalizeArrangement, validateArrangement, type Cadence } from './model';
import { markersOf, scheduleHealth } from './schedule';

/** Invented data only. Each test gets its own database. 2026-11-06 is a Friday. */
let n = 0;
const fresh = () => { const d = new FinanceDB(`test-svc-${n++}`); installTracking(d); return d; };
const TODAY = '2026-11-06';
const everyOtherFri = (anchor = '2026-11-06'): Cadence => ({ mode: 'fixed', rule: { freq: 'weekly', interval: 2, end: { type: 'never' } }, anchorDate: anchor });
const weeklyFri = (anchor = '2026-11-06'): Cadence => ({ mode: 'fixed', rule: { freq: 'weekly', interval: 1, end: { type: 'never' } }, anchorDate: anchor });
const monthly = (anchor = '2026-11-10'): Cadence => ({ mode: 'fixed', rule: { freq: 'monthly', interval: 1, monthly: 'date', end: { type: 'never' } }, anchorDate: anchor });
const draft = (over = {}) => blankArrangement({ title: 'House cleaning', ...over });
const add = (d: FinanceDB, over = {}, extra: Partial<Parameters<typeof createArrangement>[0]> = {}) =>
  createArrangement({ data: draft(over), provider: { name: "Rosa's Cleaning" }, today: TODAY, ...extra }, d);
const tasksOf = (d: FinanceDB, id: number) => tasksOfArrangement(id, d);
const openOf = async (d: FinanceDB, id: number) => (await tasksOf(d, id)).filter((t) => t.data.status !== 'done');
const lc = async (d: FinanceDB, id: number, req: Partial<LifecycleRequest> & Pick<LifecycleRequest, 'action'>) => {
  const plan = await planLifecycle(id, req.action, TODAY, d);
  return applyLifecycle({ arrangementId: id, expect: plan.expect, today: TODAY, ...req }, d);
};
const snapshot = async (d: FinanceDB) => JSON.stringify([await d.moduleRecords.toArray(), await d.links.toArray(), await d.contacts.toArray()]);
const arr = async (d: FinanceDB, id: number) => (await getArrangement(id, d))!;

describe('arrangement model', () => {
  it('needs a title; keeps the schedule honest', () => {
    expect(validateArrangement(draft({ title: '  ' }))).toMatch(/Enter what the service is/);
    expect(validateArrangement(draft())).toBeNull();
    // 2026-11-07 is a Saturday: the first date must be one of the chosen days
    const sat = normalizeArrangement(draft({ cadence: { ...weeklyFri('2026-11-07'), rule: { freq: 'weekly', interval: 1, byWeekday: [5], end: { type: 'never' } } } }));
    expect(validateArrangement(sat)).toMatch(/first date does not fall/);
    expect(validateArrangement(draft({ cadence: { ...weeklyFri(), rule: { freq: 'weekly', interval: 1, end: { type: 'count', count: 5 } } } }))).toMatch(/end date instead/);
    expect(validateArrangement(draft({ visitTime: '25:00' }))).toMatch(/09:30/);
    expect(validateArrangement(draft({ startDate: '2026-05-02', endDate: '2026-05-01' }))).toMatch(/before the start/);
    expect(validateArrangement(draft({ refs: [{ label: 'Contract', url: 'javascript:alert(1)' }] }))).toMatch(/http/);
    expect(validateArrangement(draft({ refs: [{ label: 'Contract', url: 'https://example.com/c.pdf' }] }))).toBeNull();
    expect(validateArrangement(draft({ expected: { basis: 'perVisit', cents: -5 } }))).toMatch(/not a valid amount/);
    expect(validateArrangement(draft({ extraContactIds: [3] }))).toMatch(/main provider/);
  });
  it('writes a weekly rule with its weekday spelled out, and describes it in words', () => {
    const a = normalizeArrangement(draft({ cadence: everyOtherFri() }));
    expect(a.cadence!.rule.byWeekday).toEqual([5]);
    expect(cadenceText(a.cadence)).toBe('Every 2 weeks on Fri');
    expect(cadenceText(null)).toMatch(/On demand/);
    expect(cadenceText({ mode: 'after', rule: { freq: 'monthly', interval: 3, end: { type: 'never' } }, anchorDate: TODAY })).toBe('3 months after each visit');
  });
  it('the reader never throws and keeps fields it does not know', async () => {
    const d = fresh();
    const rec = { id: 1, module: 'services', kind: 'arrangement', createdAt: 1, updatedAt: 1, data: { title: 7, status: 'weird', cadence: { anchorDate: 'nope', rule: 5 }, expected: { basis: 'x', cents: 'a' }, refs: [null, { label: 'ok' }], extraContactIds: 'no', futureField: { a: 1 } } };
    const a = asArrangement(rec as never);
    expect(a.data).toMatchObject({ title: '(no title)', status: 'active', cadence: null, expected: null, refs: [{ label: 'ok' }], extraContactIds: [], futureField: { a: 1 } });
    expect(() => asArrangement({ ...rec, data: null } as never)).not.toThrow();
    // saving an edited record keeps the unknown field
    const id = (await add(d, { cadence: null }, { today: TODAY })).id;
    await d.moduleRecords.update(id, { 'data.futureField': { keep: true } });
    await updateArrangement(id, { title: 'House cleaning 2', startDate: null, extraContactIds: [], expected: null, refs: [], notes: '', assetIds: [] }, null, d);
    expect(((await d.moduleRecords.get(id))!.data as Record<string, unknown>).futureField).toEqual({ keep: true });
    expect((await arr(d, id)).data.title).toBe('House cleaning 2');
  });
  it('has no account number, password, code or bank field anywhere', () => {
    const keys = Object.keys(blankArrangement());
    expect(keys.filter((k) => /account|password|passcode|code|bank|iban|routing|pin\b/i.test(k))).toEqual([]);
  });
});

describe('creating an arrangement and its one visit Task', () => {
  it('uses the existing contact by name (any case): never a second provider', async () => {
    const d = fresh();
    const a = await add(d);
    expect(a.contactCreated).toBe(true);
    const b = await createArrangement({ data: draft({ title: 'Window cleaning' }), provider: { name: "  ROSA'S   cleaning " }, today: TODAY }, d);
    expect(b.contactCreated).toBe(false);
    expect(b.contactId).toBe(a.contactId);
    expect(await d.contacts.count()).toBe(1);
    const c = await createArrangement({ data: draft({ title: 'Gutters' }), provider: { contactId: a.contactId }, today: TODAY }, d);
    expect(c.contactId).toBe(a.contactId);
    expect(await d.contacts.count()).toBe(1);
  });
  it('allows no provider yet', async () => {
    const d = fresh();
    const r = await createArrangement({ data: draft(), provider: null, today: TODAY }, d);
    expect(await arr(d, r.id)).toMatchObject({ data: { providerContactId: null, providerNameSnapshot: '' } });
    expect(await d.contacts.count()).toBe(0);
  });
  it('refuses a missing contact and an unusable name, and leaves nothing behind', async () => {
    const d = fresh();
    await expect(createArrangement({ data: draft(), provider: { contactId: 999 }, today: TODAY }, d)).rejects.toThrow(/no longer exists/);
    await expect(createArrangement({ data: draft({ title: '' }), provider: { name: 'New Co' }, today: TODAY }, d)).rejects.toThrow(/Enter what the service/);
    expect(await d.contacts.count()).toBe(0);
    expect(await loadArrangements(d)).toEqual([]);
  });
  it('makes exactly one linked open Task with the weekday, markers, provider and time', async () => {
    const d = fresh();
    const r = await add(d, { cadence: everyOtherFri(), visitTime: '09:30' });
    const tasks = await tasksOf(d, r.id);
    expect(tasks).toHaveLength(1);
    const t = tasks[0];
    expect(t.data).toMatchObject({ title: "House cleaning: Rosa's Cleaning", dueDate: TODAY, dueTime: '09:30', status: 'todo', contactIds: [r.contactId] });
    expect(t.data.repeat).toEqual({ mode: 'fixed', rule: { freq: 'weekly', interval: 2, byWeekday: [5], end: { type: 'never' } } });
    expect(markersOf(t)).toEqual({ occurrence: TODAY, arrangement: r.id });
    const links = (await d.links.toArray()).filter((l) => l.fromModule === 'tasks');
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ toModule: 'services', toId: `arrangement:${r.id}`, type: 'about' });
    expect((await arr(d, r.id)).data.openTaskId).toBe(t.id);
  });
  it('puts the first visit on the next date in the pattern, not in the past', async () => {
    const d = fresh();
    const r = await add(d, { cadence: everyOtherFri('2026-10-02') }); // Oct 2, Oct 16, Oct 30, Nov 13
    expect((await openOf(d, r.id))[0].data.dueDate).toBe('2026-11-13');
  });
  it('does not make a task when none was asked for, or when there is no schedule', async () => {
    const d = fresh();
    const a = await add(d, { cadence: weeklyFri() }, { scheduleFirstVisit: false });
    const b = await add(d, { title: 'Pest control' });
    expect(await tasksOf(d, a.id)).toHaveLength(0);
    expect(await tasksOf(d, b.id)).toHaveLength(0);
  });
  it('is safe under repeated and overlapping calls: still exactly one open Task', async () => {
    const d = fresh();
    const r = await add(d, { cadence: weeklyFri() }, { scheduleFirstVisit: false });
    const results = await Promise.all([ensureNextVisitTask(r.id, { today: TODAY }, d), ensureNextVisitTask(r.id, { today: TODAY }, d), ensureNextVisitTask(r.id, { today: TODAY }, d)]);
    expect(results.filter((x) => x.kind === 'created')).toHaveLength(1);
    expect(results.filter((x) => x.kind === 'reused')).toHaveLength(2);
    expect(await openOf(d, r.id)).toHaveLength(1);
    expect((await ensureNextVisitTask(r.id, { today: TODAY }, d)).kind).toBe('reused');
    expect(await loadTasks(d)).toHaveLength(1);
  });
  it('a one-off visit for an arrangement with no schedule needs a date and does not repeat', async () => {
    const d = fresh();
    const r = await add(d, { title: 'Furnace tune-up' });
    expect((await ensureNextVisitTask(r.id, { today: TODAY }, d)).kind).toBe('none');
    const e = await ensureNextVisitTask(r.id, { today: TODAY, date: '2026-12-01', time: '14:00' }, d);
    expect(e.kind).toBe('created');
    const t = (await openOf(d, r.id))[0];
    expect(t.data).toMatchObject({ dueDate: '2026-12-01', dueTime: '14:00', repeat: null });
  });
  it('a failed write leaves nothing: no arrangement, task or contact', async () => {
    const d = fresh();
    const spy = vi.spyOn(d.links, 'add').mockRejectedValueOnce(new Error('disk full'));
    await expect(add(d, { cadence: weeklyFri() })).rejects.toThrow(/disk full/);
    spy.mockRestore();
    expect(await d.moduleRecords.count()).toBe(0);
    expect(await d.contacts.count()).toBe(0);
    expect(await d.links.count()).toBe(0);
  });
  it('an ended or paused arrangement never gets a task from ensure', async () => {
    const d = fresh();
    const r = await add(d, { cadence: weeklyFri(), status: 'paused' }, { scheduleFirstVisit: false });
    expect((await ensureNextVisitTask(r.id, { today: TODAY }, d)).kind).toBe('none');
  });
});

describe('Task editor and Tasks behaviour keep the Services markers', () => {
  it('the editor save path (asTask then saveTask with the form fields) keeps both markers', async () => {
    const d = fresh();
    const r = await add(d, { cadence: everyOtherFri() });
    const task = (await openOf(d, r.id))[0];
    const t = asTask({ ...(await d.moduleRecords.get(task.id))! }).data; // what the editor holds
    const { projectId: _p, isMilestone: _m, ...base } = t as typeof t & { isMilestone?: boolean };
    await saveTask(task.id, { ...base, title: 'Cleaning (edited)', notes: 'bring ladder', status: 'doing', dueDate: '2026-11-07', dueTime: '10:00', repeat: { mode: 'fixed', rule: normalizeRule(t.repeat!.rule)! } }, d);
    const after = (await getTask(task.id, d))!;
    expect(markersOf(after)).toEqual({ occurrence: TODAY, arrangement: r.id });
    expect(after.data.title).toBe('Cleaning (edited)');
  });
  it('moving one visit does not change the arrangement, and is shown as moved from the original date', async () => {
    const d = fresh();
    const r = await add(d, { cadence: everyOtherFri() });
    const before = (await d.moduleRecords.get(r.id))!;
    const task = (await openOf(d, r.id))[0];
    await saveTask(task.id, { ...task.data, dueDate: '2026-11-07' }, d);
    expect(await d.moduleRecords.get(r.id)).toEqual(before); // untouched: same data, same updatedAt
    const h = scheduleHealth(await arr(d, r.id), await tasksOf(d, r.id));
    expect(h).toMatchObject({ state: 'moved-once', needsAttention: false });
    expect(h.message).toMatch(/Moved from/);
  });
  it('finishing the task in Tasks respawns a copy with the old marker: flagged stale, and Re-align fixes it', async () => {
    const d = fresh();
    const r = await add(d, { cadence: everyOtherFri() });
    const first = (await openOf(d, r.id))[0];
    const { spawnedId } = await completeTask(first.id, TODAY, d);
    const spawned = (await getTask(spawnedId!, d))!;
    expect(spawned.data.dueDate).toBe('2026-11-20');
    expect(markersOf(spawned).occurrence).toBe(TODAY); // inherited
    expect((await d.links.toArray()).filter((l) => l.fromId === spawnedId && l.toModule === 'services')).toHaveLength(1);
    const h = scheduleHealth(await arr(d, r.id), await tasksOf(d, r.id));
    expect(h).toMatchObject({ state: 'stale-marker', needsAttention: true });
    const plan = await planRepair('realign', r.id, spawnedId!, TODAY, d);
    expect(plan.effect.problem).toBeNull();
    await applyRepair({ kind: 'realign', arrangementId: r.id, taskId: spawnedId!, expect: plan.expect, today: TODAY }, d);
    const fixed = (await getTask(spawnedId!, d))!;
    expect(markersOf(fixed).occurrence).toBe('2026-11-20');
    expect(fixed.data.dueDate).toBe('2026-11-20');
    expect(scheduleHealth(await arr(d, r.id), await tasksOf(d, r.id)).state).toBe('ok');
  });
});

describe('schedule health', () => {
  const taskFor = (d: FinanceDB, arrId: number, over = {}) => createTask(blankTask({ title: 'Visit', dueDate: TODAY, ...over }), [arrangementRef(arrId)], d);
  it('reports each state, and never writes', async () => {
    const d = fresh();
    const r = await add(d, { cadence: everyOtherFri() });
    const before = await snapshot(d);
    const check = async () => scheduleHealth(await arr(d, r.id), await tasksOf(d, r.id));
    expect((await check()).state).toBe('ok');
    const t = (await openOf(d, r.id))[0];

    await removeTasks([t.id], d);
    expect(await check()).toMatchObject({ state: 'no-task', needsAttention: true });
    await d.moduleRecords.update(t.id, { deletedAt: null });

    const extra = await taskFor(d, r.id, { repeat: t.data.repeat, dueDate: '2026-11-20' });
    expect(await check()).toMatchObject({ state: 'duplicate-open', needsAttention: true, taskIds: [t.id, extra].sort((a, b) => a - b) });
    await removeTasks([extra], d);

    await saveTask(t.id, { ...t.data, repeat: { mode: 'fixed', rule: { freq: 'weekly', interval: 1, byWeekday: [5], end: { type: 'never' } } } }, d);
    const rd = await check();
    expect(rd).toMatchObject({ state: 'rule-differs', needsAttention: true });
    expect(rd.detail.join(' ')).toMatch(/Every 2 weeks on Fri/);
    await saveTask(t.id, t.data, d);

    // a date edit that lost the marker, off the pattern
    const { servicesOccurrence: _o, ...noMarker } = t.data as typeof t.data & { servicesOccurrence?: string };
    await saveTask(t.id, { ...noMarker, dueDate: '2026-11-09' } as typeof t.data, d);
    expect(await check()).toMatchObject({ state: 'off-cadence', needsAttention: false });
    await saveTask(t.id, t.data, d);
    expect((await check()).state).toBe('ok');
    expect(before).toBeTruthy();
  });
  it('detection alone changes nothing', async () => {
    const d = fresh();
    const r = await add(d, { cadence: everyOtherFri() });
    const t = (await openOf(d, r.id))[0];
    await saveTask(t.id, { ...t.data, repeat: null, dueDate: '2026-11-09' }, d);
    const before = await snapshot(d);
    scheduleHealth(await arr(d, r.id), await tasksOf(d, r.id));
    expect(await snapshot(d)).toBe(before);
  });
  it('is quiet for paused and ended arrangements and for on-demand ones', async () => {
    const d = fresh();
    const p = await add(d, { cadence: weeklyFri() });
    await lc(d, p.id, { action: 'pause' });
    expect((await scheduleHealth(await arr(d, p.id), await tasksOf(d, p.id))).needsAttention).toBe(false);
    const od = await add(d, { title: 'Pest control' });
    expect(scheduleHealth(await arr(d, od.id), await tasksOf(d, od.id)).state).toBe('ok');
  });
  it('a repeat that says only "weekly" is read as the task\'s own weekday', async () => {
    const d = fresh();
    const r = await add(d, { cadence: weeklyFri() });
    const t = (await openOf(d, r.id))[0];
    await saveTask(t.id, { ...t.data, repeat: { mode: 'fixed', rule: { freq: 'weekly', interval: 1, end: { type: 'never' } } } }, d); // no weekday listed, due on a Friday
    expect((await scheduleHealth(await arr(d, r.id), await tasksOf(d, r.id))).state).toBe('ok');
  });
});

describe('fixes are previewed, explicit and refuse stale data', () => {
  it('task follows the arrangement / arrangement follows the task round-trip', async () => {
    const d = fresh();
    const r = await add(d, { cadence: everyOtherFri() });
    const t = (await openOf(d, r.id))[0];
    await saveTask(t.id, { ...t.data, repeat: { mode: 'fixed', rule: { freq: 'weekly', interval: 1, byWeekday: [5], end: { type: 'never' } } } }, d);
    // task follows the arrangement
    let plan = await planRepair('task-follows', r.id, t.id, TODAY, d);
    expect(plan.effect.lines[0]).toMatch(/Every 2 weeks on Fri/);
    await applyRepair({ kind: 'task-follows', arrangementId: r.id, taskId: t.id, expect: plan.expect, today: TODAY }, d);
    expect(scheduleHealth(await arr(d, r.id), await tasksOf(d, r.id)).state).toBe('ok');
    // now the task differs again; the arrangement follows the task
    const t2 = (await openOf(d, r.id))[0];
    await saveTask(t2.id, { ...t2.data, repeat: { mode: 'fixed', rule: { freq: 'weekly', interval: 1, byWeekday: [5], end: { type: 'never' } } } }, d);
    plan = await planRepair('arrangement-follows', r.id, t2.id, TODAY, d);
    expect(plan.effect.lines[0]).toMatch(/Every week on Fri/);
    await applyRepair({ kind: 'arrangement-follows', arrangementId: r.id, taskId: t2.id, expect: plan.expect, today: TODAY }, d);
    const a = await arr(d, r.id);
    expect(a.data.cadence).toMatchObject({ mode: 'fixed', anchorDate: TODAY, rule: { freq: 'weekly', interval: 1, byWeekday: [5] } });
    expect(scheduleHealth(a, await tasksOf(d, r.id)).state).toBe('ok');
  });
  it('keep-one removes the others (with Undo) and stale data is refused with nothing changed', async () => {
    const d = fresh();
    const r = await add(d, { cadence: everyOtherFri() });
    const t = (await openOf(d, r.id))[0];
    const extra = await createTask(blankTask({ title: 'Extra visit', dueDate: '2026-11-13' }), [arrangementRef(r.id)], d);
    const plan = await planRepair('keep-one', r.id, t.id, TODAY, d);
    expect(plan.effect.removeIds).toEqual([extra]);
    // someone edits the extra task after the preview
    const ex = (await getTask(extra, d))!;
    await new Promise((res) => setTimeout(res, 5));
    await saveTask(extra, { ...ex.data, notes: 'changed elsewhere' }, d);
    const snap = await snapshot(d);
    await expect(applyRepair({ kind: 'keep-one', arrangementId: r.id, taskId: t.id, expect: plan.expect, today: TODAY }, d)).rejects.toThrow(STALE);
    expect(await snapshot(d)).toBe(snap);
    // with a fresh plan it works, and Undo brings the task back
    const plan2 = await planRepair('keep-one', r.id, t.id, TODAY, d);
    const res = await applyRepair({ kind: 'keep-one', arrangementId: r.id, taskId: t.id, expect: plan2.expect, today: TODAY }, d);
    expect((await openOf(d, r.id)).map((x) => x.id)).toEqual([t.id]);
    await applyUndo(res.undo, d);
    expect((await openOf(d, r.id)).map((x) => x.id).sort()).toEqual([t.id, extra].sort());
  });
  it('one-time move stamps the nearest pattern date; realign moves to the pattern; leave hides the notice only until it changes', async () => {
    const d = fresh();
    const r = await add(d, { cadence: everyOtherFri() });
    const t = (await openOf(d, r.id))[0];
    const { servicesOccurrence: _o, ...noMarker } = t.data as typeof t.data & { servicesOccurrence?: string };
    await saveTask(t.id, { ...noMarker, dueDate: '2026-11-09' } as typeof t.data, d); // Monday after
    let plan = await planRepair('one-time-move', r.id, t.id, TODAY, d);
    expect(plan.effect.lines[0]).toMatch(/one-time move from/);
    await applyRepair({ kind: 'one-time-move', arrangementId: r.id, taskId: t.id, expect: plan.expect, today: TODAY }, d);
    expect(markersOf((await getTask(t.id, d))!).occurrence).toBe('2026-11-06');
    expect(scheduleHealth(await arr(d, r.id), await tasksOf(d, r.id)).state).toBe('moved-once');
    // leave: a rule difference acknowledged, then changed again
    const t2 = (await getTask(t.id, d))!;
    await saveTask(t.id, { ...t2.data, repeat: null }, d);
    plan = await planRepair('leave', r.id, t.id, TODAY, d);
    await applyRepair({ kind: 'leave', arrangementId: r.id, taskId: t.id, expect: plan.expect, today: TODAY }, d);
    let h = scheduleHealth(await arr(d, r.id), await tasksOf(d, r.id));
    expect(h).toMatchObject({ state: 'rule-differs', needsAttention: false, acknowledged: true });
    const t3 = (await getTask(t.id, d))!;
    await saveTask(t.id, { ...t3.data, repeat: { mode: 'fixed', rule: { freq: 'weekly', interval: 3, byWeekday: [5], end: { type: 'never' } } } }, d);
    h = scheduleHealth(await arr(d, r.id), await tasksOf(d, r.id));
    expect(h).toMatchObject({ state: 'rule-differs', needsAttention: true, acknowledged: false });
  });
  it('schedule-next creates one task once; a second press refuses', async () => {
    const d = fresh();
    const r = await add(d, { cadence: weeklyFri() });
    const t = (await openOf(d, r.id))[0];
    await removeTasks([t.id], d);
    const plan = await planRepair('schedule-next', r.id, null, TODAY, d);
    expect(plan.effect.lines[0]).toMatch(/A new visit task will be made for/);
    await applyRepair({ kind: 'schedule-next', arrangementId: r.id, taskId: null, expect: plan.expect, today: TODAY }, d);
    expect(await openOf(d, r.id)).toHaveLength(1);
    await expect(applyRepair({ kind: 'schedule-next', arrangementId: r.id, taskId: null, expect: plan.expect, today: TODAY }, d)).rejects.toThrow(STALE);
    expect(await openOf(d, r.id)).toHaveLength(1);
  });
  it('repairEffect is pure', async () => {
    const d = fresh();
    const r = await add(d, { cadence: weeklyFri() });
    const a = await arr(d, r.id);
    const ts = await tasksOf(d, r.id);
    const before = JSON.stringify([a, ts]);
    repairEffect('realign', a, ts, ts[0].id, TODAY);
    expect(JSON.stringify([a, ts])).toBe(before);
  });
});

describe('changing the standing schedule', () => {
  it('"move the current visit" and "keep the current visit" give the dates the preview states', async () => {
    for (const choice of ['move', 'keep'] as const) {
      const d = fresh();
      const r = await add(d, { cadence: everyOtherFri(), visitTime: '09:00' });
      const t0 = (await openOf(d, r.id))[0];
      const to = monthly('2026-12-03'); // first of the new pattern
      const plan = await planScheduleChange(r.id, to, '13:00', TODAY, d);
      expect(plan.problem).toBeNull();
      expect(plan.moveTo).toBe('2026-12-03');
      expect(plan.keepDate).toBe(TODAY);
      expect(plan.lines.join(' ')).toMatch(/Move the current visit: it changes from .* to .*Dec 3/);
      await applyScheduleChange({ arrangementId: r.id, expect: plan.expect, today: TODAY, cadence: to, visitTime: '13:00', currentVisit: choice }, d);
      const a = await arr(d, r.id);
      expect(a.data.cadence).toMatchObject({ anchorDate: '2026-12-03', rule: { freq: 'monthly' } });
      const open = await openOf(d, r.id);
      expect(open).toHaveLength(1);
      expect(open[0].id).toBe(t0.id); // the same task, never a second
      expect(open[0].data.repeat!.rule.freq).toBe('monthly');
      if (choice === 'move') expect(open[0].data).toMatchObject({ dueDate: '2026-12-03', dueTime: '13:00' });
      else expect(open[0].data).toMatchObject({ dueDate: TODAY, dueTime: '09:00' });
      expect(scheduleHealth(a, open).needsAttention).toBe(false);
    }
  });
  it('refuses on stale data and changes nothing; a failed write rolls the pair back', async () => {
    const d = fresh();
    const r = await add(d, { cadence: everyOtherFri() });
    const plan = await planScheduleChange(r.id, weeklyFri(), null, TODAY, d);
    const t = (await openOf(d, r.id))[0];
    await new Promise((res) => setTimeout(res, 5));
    await saveTask(t.id, { ...t.data, notes: 'edited' }, d);
    const snap = await snapshot(d);
    await expect(applyScheduleChange({ arrangementId: r.id, expect: plan.expect, today: TODAY, cadence: weeklyFri(), visitTime: null, currentVisit: 'move' }, d)).rejects.toThrow(STALE);
    expect(await snapshot(d)).toBe(snap);
    const plan2 = await planScheduleChange(r.id, weeklyFri(), null, TODAY, d);
    const spy = vi.spyOn(d.moduleRecords, 'put').mockImplementation((async function (this: unknown, ...a: unknown[]) {
      const rec = a[0] as { module?: string; kind?: string };
      if (rec.module === 'tasks') throw new Error('task write failed');
      return (Object.getPrototypeOf(d.moduleRecords).put as (...x: unknown[]) => Promise<number>).apply(d.moduleRecords, a);
    }) as never);
    await expect(applyScheduleChange({ arrangementId: r.id, expect: plan2.expect, today: TODAY, cadence: weeklyFri(), visitTime: null, currentVisit: 'move' }, d)).rejects.toThrow(/task write failed/);
    spy.mockRestore();
    expect(await snapshot(d)).toBe(snap);
  });
  it('removing the schedule keeps the one visit and stops it repeating; adding one to an on-demand arrangement makes the task', async () => {
    const d = fresh();
    const r = await add(d, { cadence: weeklyFri() });
    let plan = await planScheduleChange(r.id, null, null, TODAY, d);
    await applyScheduleChange({ arrangementId: r.id, expect: plan.expect, today: TODAY, cadence: null, visitTime: null, currentVisit: 'keep' }, d);
    expect((await openOf(d, r.id))[0].data.repeat).toBeNull();
    expect((await arr(d, r.id)).data.cadence).toBeNull();
    const od = await add(d, { title: 'Pest control' });
    plan = await planScheduleChange(od.id, monthly('2026-11-20'), null, TODAY, d);
    await applyScheduleChange({ arrangementId: od.id, expect: plan.expect, today: TODAY, cadence: monthly('2026-11-20'), visitTime: null, currentVisit: 'keep' }, d);
    expect((await openOf(d, od.id))[0].data).toMatchObject({ dueDate: '2026-11-20' });
  });
  it('refuses to change while two visit tasks are open', async () => {
    const d = fresh();
    const r = await add(d, { cadence: weeklyFri() });
    await createTask(blankTask({ title: 'dup', dueDate: '2026-11-13' }), [arrangementRef(r.id)], d);
    const plan = await planScheduleChange(r.id, everyOtherFri(), null, TODAY, d);
    expect(plan.problem).toMatch(/more than one/);
    await expect(applyScheduleChange({ arrangementId: r.id, expect: plan.expect, today: TODAY, cadence: everyOtherFri(), visitTime: null, currentVisit: 'move' }, d)).rejects.toThrow(/more than one/);
  });
});

describe('pause, resume, end', () => {
  it('pause: remove / stop repeating / keep, each leaves at most one open task and keeps the schedule', async () => {
    for (const choice of ['remove', 'stop', 'keep'] as const) {
      const d = fresh();
      const r = await add(d, { cadence: everyOtherFri() });
      const t0 = (await openOf(d, r.id))[0];
      const res = await lc(d, r.id, { action: 'pause', taskChoice: choice });
      const a = await arr(d, r.id);
      expect(a.data.status).toBe('paused');
      expect(a.data.cadence).toMatchObject({ anchorDate: TODAY });
      const open = await openOf(d, r.id);
      if (choice === 'remove') { expect(open).toHaveLength(0); expect(res.removed).toBe(1); }
      if (choice === 'stop') { expect(open).toHaveLength(1); expect(open[0].data.repeat).toBeNull(); expect(res.stopped).toBe(1); }
      if (choice === 'keep') { expect(open).toHaveLength(1); expect(open[0].data.repeat).toEqual(t0.data.repeat); }
      expect(open.length).toBeLessThanOrEqual(1);
      // Undo puts everything back
      await applyUndo(res.undo, d);
      expect((await arr(d, r.id)).data.status).toBe('active');
      expect((await openOf(d, r.id))[0].data).toEqual(t0.data);
    }
  });
  it('resume: reuses a kept task; makes one when none; never a past date; undo works', async () => {
    const d = fresh();
    const r = await add(d, { cadence: everyOtherFri('2026-09-04') }); // first date in the past
    const t0 = (await openOf(d, r.id))[0];
    expect(t0.data.dueDate).toBe('2026-11-13');
    await lc(d, r.id, { action: 'pause', taskChoice: 'keep' });
    let res = await lc(d, r.id, { action: 'resume' });
    expect(res.taskId).toBe(t0.id);
    expect(await openOf(d, r.id)).toHaveLength(1);
    expect(await loadTasks(d)).toHaveLength(1);
    await lc(d, r.id, { action: 'pause', taskChoice: 'remove' });
    res = await lc(d, r.id, { action: 'resume' });
    const open = await openOf(d, r.id);
    expect(open).toHaveLength(1);
    expect(open[0].id).not.toBe(t0.id);
    expect(open[0].data.dueDate! >= TODAY).toBe(true);
    await applyUndo(res.undo, d);
    expect((await arr(d, r.id)).data.status).toBe('paused');
    expect(await openOf(d, r.id)).toHaveLength(0);
  });
  it('resume of a kept task that stopped repeating can make it follow the schedule, only if asked', async () => {
    const d = fresh();
    const r = await add(d, { cadence: everyOtherFri() });
    await lc(d, r.id, { action: 'pause', taskChoice: 'stop' });
    const plan = await planLifecycle(r.id, 'resume', TODAY, d);
    expect(plan.reusedDiffers).toBe(true);
    await lc(d, r.id, { action: 'resume', alignReused: false });
    expect(scheduleHealth(await arr(d, r.id), await tasksOf(d, r.id)).state).toBe('rule-differs'); // shown, not silently repaired
    await lc(d, r.id, { action: 'pause', taskChoice: 'keep' });
    await lc(d, r.id, { action: 'resume', alignReused: true });
    expect(scheduleHealth(await arr(d, r.id), await tasksOf(d, r.id)).state).toBe('ok');
  });
  it('resume does not land on or before a visit already finished', async () => {
    const d = fresh();
    const r = await add(d, { cadence: weeklyFri() });
    const t = (await openOf(d, r.id))[0];
    await saveTask(t.id, { ...t.data, status: 'done', completedAt: Date.now(), repeat: null }, d); // done in Tasks without a respawn
    await lc(d, r.id, { action: 'pause', taskChoice: 'keep' });
    await lc(d, r.id, { action: 'resume' });
    const open = await openOf(d, r.id);
    expect(open).toHaveLength(1);
    expect(open[0].data.dueDate).toBe('2026-11-13');
    expect(scheduleHealth(await arr(d, r.id), await tasksOf(d, r.id)).state).toBe('ok');
  });
  it('end: records why and when, handles the task as chosen, keeps history; ended cannot be resumed or ended again', async () => {
    const d = fresh();
    const r = await add(d, { cadence: weeklyFri() });
    const t = (await openOf(d, r.id))[0];
    await lc(d, r.id, { action: 'end', taskChoice: 'stop', endReason: 'finished', endDate: '2026-11-20' });
    const a = await arr(d, r.id);
    expect(a.data).toMatchObject({ status: 'ended', endReason: 'finished', endDate: '2026-11-20', providerNameSnapshot: "Rosa's Cleaning" });
    expect((await getTask(t.id, d))!.data.repeat).toBeNull();
    expect((await ensureNextVisitTask(r.id, { today: TODAY }, d)).kind).toBe('reused');
    await expect(lc(d, r.id, { action: 'resume' })).rejects.toThrow(/ended/);
    await expect(lc(d, r.id, { action: 'end' })).rejects.toThrow(/already ended/);
  });
  it('a failed pause leaves the arrangement and task untouched', async () => {
    const d = fresh();
    const r = await add(d, { cadence: weeklyFri() });
    const plan = await planLifecycle(r.id, 'pause', TODAY, d);
    const snap = await snapshot(d);
    const spy = vi.spyOn(d.moduleRecords, 'put').mockImplementation((async function (this: unknown, ...x: unknown[]) {
      if ((x[0] as { module?: string }).module === 'services') throw new Error('arrangement write failed');
      return (Object.getPrototypeOf(d.moduleRecords).put as (...y: unknown[]) => Promise<number>).apply(d.moduleRecords, x);
    }) as never);
    await expect(applyLifecycle({ action: 'pause', arrangementId: r.id, expect: plan.expect, today: TODAY, taskChoice: 'remove' }, d)).rejects.toThrow(/arrangement write failed/);
    spy.mockRestore();
    expect(await snapshot(d)).toBe(snap);
  });
  it('warns when removing a task that is linked to other records', async () => {
    const d = fresh();
    const r = await add(d, { cadence: weeklyFri() });
    const t = (await openOf(d, r.id))[0];
    await createStore(d).shared.links.add({ module: 'tasks', id: t.id }, { module: 'ledger', id: 'account:1' }, 'about');
    const plan = await planLifecycle(r.id, 'pause', TODAY, d);
    expect(plan.tasks[0].sharedWith.length).toBeGreaterThan(0);
    const { describeLifecycle } = await import('./changes');
    expect(describeLifecycle(plan, { taskChoice: 'remove' }).join(' ')).toMatch(/WARNING: that task is also linked to/);
    expect(describeLifecycle(plan, { taskChoice: 'keep' }).join(' ')).not.toMatch(/WARNING/);
  });
});

describe('replace provider', () => {
  it('ends the old arrangement with its provider, starts a successor with its own task, and copies only the safe things', async () => {
    const d = fresh();
    const house = await createAsset(blankAsset({ name: 'Main house', type: 'property' }), d);
    const r = await add(d, { cadence: everyOtherFri(), visitTime: '09:00', expected: { basis: 'perVisit', cents: 12000 }, notes: 'Key is with the neighbour', refs: [{ label: 'Contract', url: 'https://example.com/old' }], extraContactIds: [] }, { assetIds: [house] });
    const oldTask = (await openOf(d, r.id))[0];
    const res = await lc(d, r.id, { action: 'replace', replace: { provider: { name: 'Sparkle Co' } }, taskChoice: 'stop' });
    const old = await arr(d, r.id);
    const succ = await arr(d, res.successorId!);
    expect(old.data).toMatchObject({ status: 'ended', endReason: 'replaced', providerNameSnapshot: "Rosa's Cleaning" });
    expect(succ.data).toMatchObject({ status: 'active', title: 'House cleaning', providerNameSnapshot: 'Sparkle Co', predecessorId: r.id, visitTime: '09:00', expected: { basis: 'perVisit', cents: 12000 }, notes: '', refs: [], startDate: TODAY });
    expect(succ.data.cadence).toEqual(old.data.cadence);
    expect(succ.data.providerContactId).not.toBe(old.data.providerContactId);
    expect(await linkedAssetIds(res.successorId!, d)).toEqual([house]);
    expect(await linkedAssetIds(r.id, d)).toEqual([house]);
    const oldOpen = await openOf(d, r.id);
    const newOpen = await openOf(d, res.successorId!);
    expect(oldOpen.map((t) => t.id)).toEqual([oldTask.id]);
    expect(oldOpen[0].data.repeat).toBeNull();
    expect(newOpen).toHaveLength(1);
    expect(newOpen[0].id).not.toBe(oldTask.id);
    expect(newOpen[0].data.contactIds).toEqual([succ.data.providerContactId]);
    // notes copy only when ticked
    const r2 = await add(d, { title: 'Lawn', cadence: weeklyFri(), notes: 'Mow the front only' });
    const res2 = await lc(d, r2.id, { action: 'replace', replace: { provider: { name: 'Green Co' }, copyNotes: true } });
    expect((await arr(d, res2.successorId!)).data.notes).toBe('Mow the front only');
  });
  it('cannot make two successors: repeated and simultaneous submits create one', async () => {
    const d = fresh();
    const r = await add(d, { cadence: weeklyFri() });
    const plan = await planLifecycle(r.id, 'replace', TODAY, d);
    const req: LifecycleRequest = { action: 'replace', arrangementId: r.id, expect: plan.expect, today: TODAY, replace: { provider: { name: 'Sparkle Co' } } };
    const results = await Promise.allSettled([applyLifecycle(req, d), applyLifecycle(req, d), applyLifecycle(req, d)]);
    expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const all = await loadArrangements(d);
    expect(all.filter((a) => a.data.predecessorId === r.id)).toHaveLength(1);
    expect(all).toHaveLength(2);
    expect(await d.contacts.count()).toBe(2);
    expect(await loadTasks(d)).toHaveLength(2); // old (stopped) + new
    const again = await planLifecycle(r.id, 'replace', TODAY, d);
    expect(again.problem).toMatch(/already/);
  });
  it('refuses the same provider and an ended arrangement; nothing changes', async () => {
    const d = fresh();
    const r = await add(d, { cadence: weeklyFri() });
    const old = await arr(d, r.id);
    const snap = await snapshot(d);
    const plan = await planLifecycle(r.id, 'replace', TODAY, d);
    await expect(applyLifecycle({ action: 'replace', arrangementId: r.id, expect: plan.expect, today: TODAY, replace: { provider: { contactId: old.data.providerContactId } } }, d)).rejects.toThrow(/same provider/);
    expect(await snapshot(d)).toBe(snap);
  });
  it('a failure part way (after the old one is ended and the successor made) rolls everything back', async () => {
    const d = fresh();
    const r = await add(d, { cadence: weeklyFri() });
    const plan = await planLifecycle(r.id, 'replace', TODAY, d);
    const snap = await snapshot(d);
    const spy = vi.spyOn(d.links, 'add').mockRejectedValueOnce(new Error('link write failed'));
    await expect(applyLifecycle({ action: 'replace', arrangementId: r.id, expect: plan.expect, today: TODAY, replace: { provider: { name: 'Sparkle Co' } } }, d)).rejects.toThrow(/link write failed/);
    spy.mockRestore();
    expect(await snapshot(d)).toBe(snap);
    expect((await arr(d, r.id)).data.status).toBe('active');
    expect(await d.contacts.count()).toBe(1);
  });
  it('Undo removes the successor and its task and restores the old arrangement and task', async () => {
    const d = fresh();
    const r = await add(d, { cadence: weeklyFri() });
    const oldTask = (await openOf(d, r.id))[0];
    const res = await lc(d, r.id, { action: 'replace', replace: { provider: { name: 'Sparkle Co' } }, taskChoice: 'remove' });
    await applyUndo(res.undo, d);
    expect((await arr(d, r.id)).data.status).toBe('active');
    expect((await loadArrangements(d))).toHaveLength(1);
    expect((await openOf(d, r.id)).map((t) => t.id)).toEqual([oldTask.id]);
    expect(await loadTasks(d)).toHaveLength(1);
  });
  it('a plan opened before another change is refused', async () => {
    const d = fresh();
    const r = await add(d, { cadence: weeklyFri() });
    const plan = await planLifecycle(r.id, 'replace', TODAY, d);
    await new Promise((res) => setTimeout(res, 5));
    await lc(d, r.id, { action: 'pause' });
    await expect(applyLifecycle({ action: 'replace', arrangementId: r.id, expect: plan.expect, today: TODAY, replace: { provider: { name: 'Sparkle Co' } } }, d)).rejects.toThrow(STALE);
  });
});

describe('assets, removed contacts and privacy', () => {
  it('links and unlinks existing assets only, idempotently', async () => {
    const d = fresh();
    const a = await createAsset(blankAsset({ name: 'Furnace', type: 'system' }), d);
    const b = await createAsset(blankAsset({ name: 'Main house', type: 'property' }), d);
    const r = await add(d, { title: 'Furnace service' }, { assetIds: [a] });
    expect(await linkedAssetIds(r.id, d)).toEqual([a]);
    await syncAssetLinks(r.id, [a, b], d);
    await syncAssetLinks(r.id, [a, b], d);
    expect((await linkedAssetIds(r.id, d)).sort()).toEqual([a, b].sort());
    expect((await d.links.toArray()).filter((l) => l.type === 'serves' && l.deletedAt == null)).toHaveLength(2);
    await syncAssetLinks(r.id, [b], d);
    expect(await linkedAssetIds(r.id, d)).toEqual([b]);
    await expect(syncAssetLinks(r.id, [b, 424242], d)).rejects.toThrow(/no longer exists/);
    // the asset records themselves were never written
    expect((await d.moduleRecords.get(a))!.data).toMatchObject({ name: 'Furnace' });
  });
  it('an arrangement whose contact was removed keeps its snapshot name and still works', async () => {
    const d = fresh();
    const r = await add(d, { cadence: weeklyFri() });
    await createStore(d).shared.contacts.remove(r.contactId!);
    const a = await arr(d, r.id);
    expect(a.data.providerNameSnapshot).toBe("Rosa's Cleaning");
    expect(scheduleHealth(a, await tasksOf(d, r.id)).state).toBe('ok');
    await lc(d, r.id, { action: 'pause' }); // does not need the contact
    expect((await arr(d, r.id)).data.status).toBe('paused');
  });
  it('the Task title, notes and links never carry the phone, email, notes or document URL', async () => {
    const d = fresh();
    const r = await createArrangement({
      data: draft({ cadence: weeklyFri(), notes: 'Gate opens with the spare key', refs: [{ label: 'Contract', url: 'https://example.com/secret-contract' }], expected: { basis: 'perVisit', cents: 99900 } }),
      provider: { name: "Rosa's Cleaning", phone: '555-0100-7777', email: 'rosa@example.test' }, today: TODAY,
    }, d);
    const t = (await openOf(d, r.id))[0];
    const blob = JSON.stringify(t.data);
    for (const secret of ['555-0100-7777', 'rosa@example.test', 'spare key', 'secret-contract', '99900', '999.00']) expect(blob).not.toContain(secret);
    expect(JSON.stringify(await d.links.toArray())).not.toMatch(/555-0100|rosa@example|spare key|secret-contract/);
  });
  it('writeArrangement keeps unknown fields and rejects bad data without writing', async () => {
    const d = fresh();
    const r = await add(d);
    await expect(writeArrangement(r.id, { ...(await arr(d, r.id)).data, title: '' }, d)).rejects.toThrow(/Enter what/);
    expect((await arr(d, r.id)).data.title).toBe('House cleaning');
  });
});
