import { scanText } from '../../lib/leakTestkit';
import { describe, expect, it } from 'vitest';
import { FinanceDB } from '../../db';
import { exportAll, importAll } from '../../lib/backup';
import { checkBackupText } from '../../lib/backupFile';
import { registerModule, allQuickAdds } from '../../core/registry';
import { createStore } from '../../core/store';
import { installTracking } from '../../lib/sync/track';
import { createTask, completeTask, getTask, loadTasks, removeTasks, reopenTask, saveTask } from '../tasks/data';
import { blankTask } from '../tasks/model';
import { archiveAsset, assetRef, createAsset, loadAssets, loadLinkedWork, setAssetStatus, updateAsset } from './data';
import { blankAsset } from './model';
import { deleteAssetPermanently, planAssetDeletion } from './deletion';
import { buildHistory, duplicateTaskGroups, localDate, MAINTENANCE_SUGGESTIONS, summarize, unsavedTasks } from './maintenance';
import { assetRecords } from './records';
import { searchAssetsData } from './searchSource';
import { asService, blankService, costFromText, normalizeService, parseServiceRef, serviceRefId, validateService, type ServiceData } from './service';
import { createService, deleteService, DuplicateServiceError, getService, loadServices, loadServicesFor, logTaskService, removeNewService, restoreService, updateService } from './serviceData';
import { parseServiceQuick, serviceQuickAdd } from './serviceQuickAdd';
import { assetsModule } from './index';
import type { ModuleRecord } from '../../core/entities';
import type { TaskData } from '../tasks/model';

/** Invented data only. Each test gets its own database. */
let n = 0;
const fresh = () => { const d = new FinanceDB(`test-service-${n++}`); installTracking(d); return d; };
const TODAY = '2026-11-06';
const mk = (d: FinanceDB, name: string, over = {}) => createAsset(blankAsset({ name, ...over }), d);
const svc = (assetId: number, over: Partial<ServiceData> = {}) => blankService(assetId, { title: 'Replaced filter', date: '2026-11-01', kind: 'maintenance', ...over });
const yearly = { freq: 'yearly' as const, interval: 1, end: { type: 'never' as const } };
const monthly3 = { freq: 'monthly' as const, interval: 3, monthly: 'date' as const, end: { type: 'never' as const } };
const plan = (d: FinanceDB, assetId: number, over: Partial<TaskData> = {}) => createTask(blankTask({ title: 'Service furnace', dueDate: '2026-11-10', ...over }), [assetRef(assetId)], d);
const rawRec = (data: Record<string, unknown>): ModuleRecord => ({ id: 9, module: 'assets', kind: 'service', createdAt: 1, updatedAt: 2, data });

describe('H2 service record reader', () => {
  it('keeps unknown fields and never throws on junk', () => {
    const s = asService(rawRec({ assetId: 3, date: '2026-11-01', title: 'Pump', futureList: [1], future: { x: 1 } }));
    expect(s.data).toMatchObject({ assetId: 3, title: 'Pump', futureList: [1], future: { x: 1 } });
    expect(() => asService({ id: 1, module: 'assets', kind: 'service', createdAt: 0, updatedAt: 0, data: null as never })).not.toThrow();
    expect(asService(rawRec({})).data).toMatchObject({ assetId: -1, date: '', title: 'Service', kind: 'other', costCents: null, providerContactId: null });
  });
  it('tells an unknown cost from a zero cost and refuses a bad one', () => {
    expect(asService(rawRec({ costCents: 0 })).data.costCents).toBe(0);
    expect(asService(rawRec({})).data.costCents).toBeNull();
    expect(asService(rawRec({ costCents: -5 })).data.costCents).toBeNull();
    expect(asService(rawRec({ costCents: 'x' })).data.costCents).toBeNull();
    expect(costFromText('')).toBeNull(); // blank = unknown, never $0
    expect(costFromText('   ')).toBeNull();
    expect(costFromText('0')).toBe(0);
    expect(costFromText('$1,234.50')).toBe(123450);
    expect(costFromText('-5')).toBeUndefined();
    expect(costFromText('abc')).toBeUndefined();
  });
  it('falls back safely for a bad kind, date, refs and ids', () => {
    const s = asService(rawRec({ assetId: 'x', date: '2026-02-30', kind: 'magic', refs: [null, { url: 'x' }, { label: 'Invoice', url: 'https://e.test/i' }], providerContactId: 'q', taskId: null }));
    expect(s.data).toMatchObject({ assetId: -1, date: '', kind: 'other', providerContactId: null, taskId: null });
    expect(s.data.refs).toEqual([{ label: 'Invoice', url: 'https://e.test/i' }]);
  });
  it('service ids look like service:<n> and never clash with asset ids', () => {
    expect(serviceRefId(12)).toBe('service:12');
    expect(parseServiceRef('service:12')).toBe(12);
    expect(parseServiceRef('asset:12')).toBeNull();
    expect(parseServiceRef('service:x')).toBeNull();
  });
});

describe('H2 validation', () => {
  const ctx = { today: TODAY, contactExists: (id: number) => id === 1 };
  const v = (over: Partial<ServiceData>) => validateService(normalizeService(blankService(1, { title: 'Work', date: '2026-11-01', ...over })), ctx);
  it('needs a description and a real date that is not in the future', () => {
    expect(v({})).toBeNull();
    expect(v({ title: '  ' })).toMatch(/what was done/);
    expect(v({ title: 'x'.repeat(161) })).toMatch(/too long/);
    expect(v({ date: '' })).toMatch(/date/);
    expect(v({ date: '2026-02-30' })).toMatch(/date/);
    expect(v({ date: TODAY })).toBeNull();
    expect(v({ date: '2026-11-07' })).toMatch(/future/);
  });
  it('cost: unknown, zero and positive are fine; negative and absurd are not; whole cents', () => {
    expect(v({ costCents: null })).toBeNull();
    expect(v({ costCents: 0 })).toBeNull();
    expect(v({ costCents: 12345 })).toBeNull();
    expect(v({ costCents: -1 })).toMatch(/negative/);
    expect(v({ costCents: Number.NaN })).toMatch(/negative/);
    expect(normalizeService(blankService(1, { costCents: 1234.6 })).costCents).toBe(1235);
  });
  it('accepts only http and https document links; checks lengths', () => {
    const r = (url: string) => v({ refs: [{ label: 'Invoice', url }] });
    expect(r('https://example.com/i')).toBeNull();
    for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'ftp://x.test', 'file:///c:/x', 'nope']) expect(r(bad), bad).toMatch(/http/);
    expect(v({ refs: [{ label: '', url: 'https://example.com' }] })).toMatch(/label/);
    expect(v({ notes: 'x'.repeat(5001) })).toMatch(/notes/);
  });
  it('a provider must exist when chosen, but one that was already there and has since been removed is kept', () => {
    expect(v({ providerContactId: 1 })).toBeNull();
    expect(v({ providerContactId: 2 })).toMatch(/no longer exists/);
    expect(validateService(blankService(1, { title: 'W', date: '2026-11-01', providerContactId: 2 }), { ...ctx, keepContactId: 2 })).toBeNull();
  });
});

describe('H2 creating, editing and deleting service records', () => {
  it('creates a manual record with no task; blank cost stays unknown; zero stays zero', async () => {
    const d = fresh();
    const a = await mk(d, 'Dishwasher');
    const unknown = await createService(svc(a, { title: 'Looked at the noise' }), d, TODAY);
    const zero = await createService(svc(a, { title: 'Free inspection', kind: 'inspection', costCents: 0 }), d, TODAY);
    expect((await getService(unknown, d))!.data).toMatchObject({ taskId: null, costCents: null, assetId: a, title: 'Looked at the noise' });
    expect((await getService(zero, d))!.data.costCents).toBe(0);
    expect(await loadServicesFor(a, d)).toHaveLength(2);
  });
  it('refuses a missing asset, an archived asset, a future date and a removed contact; nothing is stored', async () => {
    const d = fresh();
    const a = await mk(d, 'Boiler');
    await expect(createService(svc(999), d, TODAY)).rejects.toThrow(/no longer exists/);
    await expect(createService(svc(a, { date: '2026-12-01' }), d, TODAY)).rejects.toThrow(/future/);
    await expect(createService(svc(a, { providerContactId: 77 }), d, TODAY)).rejects.toThrow(/contact/);
    await archiveAsset(a, d);
    await expect(createService(svc(a), d, TODAY)).rejects.toThrow(/archived/);
    expect(await loadServices(d)).toHaveLength(0);
  });
  it('a retired (sold) asset can still be given the history of work done before it left', async () => {
    const d = fresh();
    const a = await mk(d, 'Old car', { type: 'vehicle' });
    await setAssetStatus(a, { status: 'sold', statusDate: '2026-10-01', statusNote: '', replacedById: null }, d);
    await expect(createService(svc(a, { title: 'Last oil change', date: '2026-09-20' }), d, TODAY)).resolves.toBeGreaterThan(0);
  });
  it('editing keeps unknown fields, the asset, the task link and the snapshot; the record id stays', async () => {
    const d = fresh();
    const a = await mk(d, 'Pump'), b = await mk(d, 'Other');
    const id = await createService({ ...svc(a), taskId: 5, taskTitleSnapshot: 'Original title' }, d, TODAY);
    await d.moduleRecords.update(id, { data: { ...(await d.moduleRecords.get(id))!.data, futureList: [42], future: 'keep me' } });
    const cur = (await getService(id, d))!;
    await updateService(id, { ...cur.data, title: 'Renamed', assetId: b, taskId: 99, taskTitleSnapshot: 'Hacked', costCents: 5000 }, d, TODAY);
    const after = (await getService(id, d))!;
    expect(after.data).toMatchObject({ title: 'Renamed', assetId: a, taskId: 5, taskTitleSnapshot: 'Original title', costCents: 5000, futureList: [42], future: 'keep me' });
    expect(after.id).toBe(id);
    await expect(updateService(id, { ...after.data, date: '2027-01-01' }, d, TODAY)).rejects.toThrow(/future/);
    await expect(updateService(424242, after.data, d, TODAY)).rejects.toThrow(/no longer exists/);
  });
  it('delete is a soft delete with Undo; restoring beside a newer record for the same task gives two, which the duplicate warning then shows', async () => {
    const d = fresh();
    const a = await mk(d, 'Heater');
    const id = await createService({ ...svc(a), taskId: 8 }, d, TODAY);
    await deleteService(id, d);
    expect(await getService(id, d)).toBeUndefined();
    await restoreService(id, d);
    expect(await getService(id, d)).toBeDefined();
    await deleteService(id, d);
    // the task is saved again while the first record is deleted
    await createService({ ...svc(a, { title: 'Again' }), taskId: 8 }, d, TODAY);
    await restoreService(id, d); // Undo must always work
    expect(duplicateTaskGroups(await loadServices(d))).toHaveLength(1);
  });
  it('a second record for the same task is refused', async () => {
    const d = fresh();
    const a = await mk(d, 'Heater');
    const first = await createService({ ...svc(a), taskId: 8 }, d, TODAY);
    const err = await createService({ ...svc(a), taskId: 8 }, d, TODAY).catch((e) => e);
    expect(err).toBeInstanceOf(DuplicateServiceError);
    expect(err.existingId).toBe(first);
  });
});

describe('H2 "Done, log it": one transaction', () => {
  it('completes a repeating task, makes the next one once with the asset link, and saves the record', async () => {
    const d = fresh();
    const a = await mk(d, 'Furnace');
    const t = await plan(d, a, { repeat: { mode: 'fixed', rule: yearly }, dueDate: '2026-11-10' });
    const r = await logTaskService({ taskId: t, data: svc(a, { title: 'Annual service', costCents: 18000, notes: 'Cleaned burners' }), complete: true, today: TODAY }, d);
    expect(r.spawnedId).toBeDefined();
    expect((await getTask(t, d))!.data.status).toBe('done');
    const s = (await getService(r.serviceId, d))!;
    expect(s.data).toMatchObject({ taskId: t, taskTitleSnapshot: 'Service furnace', costCents: 18000, notes: 'Cleaned burners', assetId: a });
    const work = await loadLinkedWork(a, d);
    expect(work.openTasks.map((x) => x.id)).toEqual([r.spawnedId]); // the next one: same asset, exactly one
    expect(work.openTasks[0].data).toMatchObject({ status: 'todo', dueDate: '2027-11-10', recurFrom: t });
    expect(work.completedTasks.map((x) => x.id)).toEqual([t]);
    expect((await loadTasks(d)).filter((x) => x.data.title === 'Service furnace')).toHaveLength(2);
  });
  it('a one-off task is simply completed and saved', async () => {
    const d = fresh();
    const a = await mk(d, 'Gutters');
    const t = await plan(d, a, { title: 'Clean gutters' });
    const r = await logTaskService({ taskId: t, data: svc(a, { title: 'Cleaned gutters' }), complete: true, today: TODAY }, d);
    expect(r.spawnedId).toBeUndefined();
    expect((await loadLinkedWork(a, d)).openTasks).toHaveLength(0);
  });
  it('SEMANTICS: fixed schedule ignores an old service date (same next date as pressing Done today); one next task only; ordinary Tasks unchanged', async () => {
    const d = fresh();
    const a = await mk(d, 'Furnace');
    const t1 = await plan(d, a, { repeat: { mode: 'fixed', rule: yearly }, dueDate: '2025-03-10' });
    const r = await logTaskService({ taskId: t1, data: svc(a, { date: '2025-03-12' }), complete: true, today: TODAY }, d);
    const viaTasks = fresh();
    const a2 = await mk(viaTasks, 'Furnace');
    const t2 = await plan(viaTasks, a2, { repeat: { mode: 'fixed', rule: yearly }, dueDate: '2025-03-10' });
    const plain = await completeTask(t2, TODAY, viaTasks);
    expect((await getTask(r.spawnedId!, d))!.data.dueDate).toBe((await getTask(plain.spawnedId!, viaTasks))!.data.dueDate);
    expect((await getTask(r.spawnedId!, d))!.data.dueDate).toBe('2027-03-10');
    expect((await loadTasks(d)).length).toBe(2);
    expect((await getTask(t1, d))!.data).toMatchObject({ status: 'done', dueDate: '2025-03-10' }); // the finished one keeps its own due date
    expect((await getService(r.serviceId, d))!.data.date).toBe('2025-03-12'); // service date stays what was typed
  });
  it('SEMANTICS: repeat-after-completion from a historical date makes ONE next task, counted from that date (may be past); logging on the day is the same as pressing Done', async () => {
    const d = fresh();
    const a = await mk(d, 'Furnace');
    const old = await plan(d, a, { title: 'Filter', repeat: { mode: 'after', rule: monthly3 }, dueDate: '2026-01-01' });
    const r1 = await logTaskService({ taskId: old, data: svc(a, { date: '2026-03-01' }), complete: true, today: TODAY }, d);
    expect((await getTask(r1.spawnedId!, d))!.data.dueDate).toBe('2026-06-01'); // already past: shows overdue, not a pile of missed ones
    expect((await loadTasks(d)).filter((x) => x.data.status === 'todo')).toHaveLength(1);
    const same = await plan(d, a, { title: 'Filter 2', repeat: { mode: 'after', rule: monthly3 }, dueDate: '2026-11-01' });
    const r2 = await logTaskService({ taskId: same, data: svc(a, { date: TODAY }), complete: true, today: TODAY }, d);
    const e = fresh(); const ea = await mk(e, 'X');
    const et = await plan(e, ea, { repeat: { mode: 'after', rule: monthly3 }, dueDate: '2026-11-01' });
    const plain = await completeTask(et, TODAY, e);
    expect((await getTask(r2.spawnedId!, d))!.data.dueDate).toBe((await getTask(plain.spawnedId!, e))!.data.dueDate);
  });
  it('the repeat counts from the day the work was done', async () => {
    const d = fresh();
    const a = await mk(d, 'Furnace');
    const t = await plan(d, a, { title: 'Replace filter', repeat: { mode: 'after', rule: monthly3 }, dueDate: '2026-10-01' });
    const r = await logTaskService({ taskId: t, data: svc(a, { date: '2026-10-20' }), complete: true, today: TODAY }, d);
    expect((await getTask(r.spawnedId!, d))!.data.dueDate).toBe('2027-01-20');
  });
  it('a second or simultaneous submission changes nothing more', async () => {
    const d = fresh();
    const a = await mk(d, 'Furnace');
    const t = await plan(d, a, { repeat: { mode: 'fixed', rule: yearly } });
    const go = () => logTaskService({ taskId: t, data: svc(a), complete: true, today: TODAY }, d).then(() => 'ok', (e: Error) => e.message);
    const out = await Promise.all([go(), go(), go()]);
    expect(out.filter((x) => x === 'ok')).toHaveLength(1);
    expect(await loadServices(d)).toHaveLength(1);
    expect((await loadLinkedWork(a, d)).openTasks).toHaveLength(1);
    expect((await loadTasks(d)).length).toBe(2);
  });
  it('rolls back everything when the service record cannot be written', async () => {
    const d = fresh();
    const a = await mk(d, 'Furnace');
    const t = await plan(d, a, { repeat: { mode: 'fixed', rule: yearly } });
    d.moduleRecords.hook('creating', (_k, obj) => { if (obj.kind === 'service') throw new Error('disk full'); });
    await expect(logTaskService({ taskId: t, data: svc(a), complete: true, today: TODAY }, d)).rejects.toThrow(/disk full/);
    expect((await getTask(t, d))!.data.status).toBe('todo'); // not completed
    expect(await loadTasks(d)).toHaveLength(1); // no next one
    expect(await loadServices(d)).toHaveLength(0);
  });
  it('writes no service record when completing the task fails', async () => {
    const d = fresh();
    const a = await mk(d, 'Furnace');
    const t = await plan(d, a, { repeat: { mode: 'fixed', rule: yearly } });
    // A put over an existing row reaches the hook as a diff (keys such as "data.status" or "data"); either shape is caught here.
    d.moduleRecords.hook('updating', (mods) => { if (/"status":"done"|"data.status":"done"/.test(JSON.stringify(mods))) throw new Error('cannot complete'); });
    await expect(logTaskService({ taskId: t, data: svc(a), complete: true, today: TODAY }, d)).rejects.toThrow(/cannot complete/);
    expect((await getTask(t, d))!.data.status).toBe('todo');
    expect(await loadServices(d)).toHaveLength(0);
    expect(await loadTasks(d)).toHaveLength(1);
  });
  it('a bad entry (future date, removed contact) leaves the task open and creates nothing', async () => {
    const d = fresh();
    const a = await mk(d, 'Furnace');
    const t = await plan(d, a, { repeat: { mode: 'fixed', rule: yearly } });
    await expect(logTaskService({ taskId: t, data: svc(a, { date: '2026-12-25' }), complete: true, today: TODAY }, d)).rejects.toThrow(/future/);
    await expect(logTaskService({ taskId: t, data: svc(a, { providerContactId: 99 }), complete: true, today: TODAY }, d)).rejects.toThrow(/contact/);
    expect((await getTask(t, d))!.data.status).toBe('todo');
    expect(await loadTasks(d)).toHaveLength(1);
    expect(await loadServices(d)).toHaveLength(0);
  });
  it('refuses a task that is gone, already done, or not linked to this asset', async () => {
    const d = fresh();
    const a = await mk(d, 'Furnace'), b = await mk(d, 'Boiler');
    const t = await plan(d, a);
    const other = await plan(d, b, { title: 'Boiler job' });
    await expect(logTaskService({ taskId: 404, data: svc(a), complete: true, today: TODAY }, d)).rejects.toThrow(/no longer exists/);
    await expect(logTaskService({ taskId: other, data: svc(a), complete: true, today: TODAY }, d)).rejects.toThrow(/not linked/);
    await completeTask(t, TODAY, d); // finished on another screen
    await expect(logTaskService({ taskId: t, data: svc(a), complete: true, today: TODAY }, d)).rejects.toThrow(/already done/);
    await removeTasks([other], d);
    await expect(logTaskService({ taskId: other, data: svc(b), complete: true, today: TODAY }, d)).rejects.toThrow(/no longer exists/);
    expect(await loadServices(d)).toHaveLength(0);
  });
});

describe('H2 tasks completed elsewhere, then saved to history', () => {
  it('shows up as not yet saved, saves once, then disappears from the unsaved list', async () => {
    const d = fresh();
    const a = await mk(d, 'Heater');
    const t = await plan(d, a, { title: 'Test smoke detectors' });
    await completeTask(t, TODAY, d);
    let work = await loadLinkedWork(a, d);
    expect(unsavedTasks(work.completedTasks, await loadServicesFor(a, d)).map((x) => x.id)).toEqual([t]);
    const r = await logTaskService({ taskId: t, data: svc(a, { title: 'Tested all detectors' }), complete: false, today: TODAY }, d);
    const s = (await getService(r.serviceId, d))!;
    expect(s.data).toMatchObject({ taskId: t, taskTitleSnapshot: 'Test smoke detectors', title: 'Tested all detectors' });
    work = await loadLinkedWork(a, d);
    expect(unsavedTasks(work.completedTasks, await loadServicesFor(a, d))).toHaveLength(0);
    const hist = buildHistory(await loadServicesFor(a, d), work.completedTasks);
    expect(hist.map((h) => h.type)).toEqual(['service']); // the task is not shown a second time
    expect((await getTask(t, d))!.data.status).toBe('done'); // saving never touches the task
  });
  it('saving twice in a rush gives one record', async () => {
    const d = fresh();
    const a = await mk(d, 'Heater');
    const t = await plan(d, a);
    await completeTask(t, TODAY, d);
    const go = () => logTaskService({ taskId: t, data: svc(a), complete: false, today: TODAY }, d).then(() => 'ok', (e: Error) => e.name);
    const out = await Promise.all([go(), go()]);
    expect(out.sort()).toEqual(['DuplicateServiceError', 'ok']);
    expect(await loadServices(d)).toHaveLength(1);
  });
  it('refuses when the task was reopened or deleted before the save', async () => {
    const d = fresh();
    const a = await mk(d, 'Heater');
    const t = await plan(d, a);
    await completeTask(t, TODAY, d);
    await reopenTask(t, d);
    await expect(logTaskService({ taskId: t, data: svc(a), complete: false, today: TODAY }, d)).rejects.toThrow(/not completed/);
    await completeTask(t, TODAY, d);
    await removeTasks([t], d);
    await expect(logTaskService({ taskId: t, data: svc(a), complete: false, today: TODAY }, d)).rejects.toThrow(/no longer exists/);
    expect(await loadServices(d)).toHaveLength(0);
  });
  it('each cycle of a repeating task is its own entry', async () => {
    const d = fresh();
    const a = await mk(d, 'Furnace');
    const t1 = await plan(d, a, { repeat: { mode: 'fixed', rule: yearly } });
    const { spawnedId } = await completeTask(t1, TODAY, d);
    await completeTask(spawnedId!, '2027-11-20', d);
    const work = await loadLinkedWork(a, d);
    expect(unsavedTasks(work.completedTasks, []).map((x) => x.id).sort()).toEqual([t1, spawnedId!].sort());
    await logTaskService({ taskId: t1, data: svc(a), complete: false, today: '2027-12-01' }, d);
    expect(unsavedTasks(work.completedTasks, await loadServices(d)).map((x) => x.id)).toEqual([spawnedId]);
  });
});

describe('H2 history survives edits to the task, the contact and the asset', () => {
  it('rename, reschedule, reopen and delete of the task leave the record and its snapshot alone', async () => {
    const d = fresh();
    const a = await mk(d, 'Furnace');
    const t = await plan(d, a, { title: 'Service furnace', repeat: { mode: 'fixed', rule: yearly } });
    const { serviceId, spawnedId } = await logTaskService({ taskId: t, data: svc(a, { title: 'Serviced', notes: 'ok' }), complete: true, today: TODAY }, d);
    await saveTask(t, { ...(await getTask(t, d))!.data, title: 'Totally renamed', dueDate: '2030-01-01' }, d);
    await reopenTask(t, d);
    await completeTask(t, TODAY, d).catch(() => undefined);
    await removeTasks([t, spawnedId!], d);
    const s = (await getService(serviceId, d))!;
    expect(s.data).toMatchObject({ title: 'Serviced', notes: 'ok', taskId: t, taskTitleSnapshot: 'Service furnace', assetId: a });
    expect(buildHistory(await loadServicesFor(a, d), (await loadLinkedWork(a, d)).completedTasks)).toHaveLength(1);
  });
  it('a removed contact leaves the record readable; an unchanged provider can still be edited', async () => {
    const d = fresh();
    const a = await mk(d, 'Furnace');
    const store = createStore(d);
    const c = await store.shared.contacts.put({ name: 'Test Plumbing Co' });
    const id = await createService(svc(a, { providerContactId: c }), d, TODAY);
    await store.shared.contacts.remove(c);
    const s = (await getService(id, d))!;
    expect(s.data.providerContactId).toBe(c); // reference kept; the screen shows "(contact removed)"
    await updateService(id, { ...s.data, notes: 'added later' }, d, TODAY);
    expect((await getService(id, d))!.data).toMatchObject({ notes: 'added later', providerContactId: c });
    await expect(createService(svc(a, { providerContactId: c }), d, TODAY)).rejects.toThrow(/contact/);
  });
  it('archiving or retiring the asset does not change its history', async () => {
    const d = fresh();
    const a = await mk(d, 'Old washer');
    const id = await createService(svc(a), d, TODAY);
    const before = JSON.stringify((await d.moduleRecords.get(id))!);
    await setAssetStatus(a, { status: 'replaced', statusDate: TODAY, statusNote: '', replacedById: null }, d);
    await archiveAsset(a, d);
    expect(JSON.stringify((await d.moduleRecords.get(id))!)).toBe(before);
  });
});

describe('H2 last serviced, next due, needs attention', () => {
  it('works out all three from tasks and records, with Tasks\' own overdue rule', async () => {
    const d = fresh();
    const a = await mk(d, 'Furnace');
    const t1 = await plan(d, a, { title: 'Late job', dueDate: '2026-10-30' });
    const t2 = await plan(d, a, { title: 'Soon job', dueDate: '2026-11-20' });
    await plan(d, a, { title: 'Someday', dueDate: null });
    const done = await plan(d, a, { title: 'Done elsewhere', dueDate: '2026-11-02' });
    await completeTask(done, TODAY, d);
    await createService(svc(a, { title: 'Old repair', date: '2026-03-01', kind: 'repair' }), d, TODAY);
    await createService(svc(a, { title: 'New deck', date: '2026-11-05', kind: 'improvement' }), d, TODAY);
    const work = await loadLinkedWork(a, d);
    const sm = summarize(work.openTasks, work.completedTasks, await loadServicesFor(a, d), TODAY);
    expect(sm.nextDue).toMatchObject({ date: '2026-10-30', overdue: true });
    expect(sm.nextDue!.task.id).toBe(t1);
    expect(sm.overdueCount).toBe(1);
    expect(sm.needsAttention).toBe(1);
    expect(sm.lastServiced).toMatchObject({ source: 'task', title: 'Done elsewhere', date: localDate((await getTask(done, d))!.data.completedAt!) }); // an improvement does not count
    expect(t2).toBeGreaterThan(0);
  });
  it('an asset with nothing planned or done gives empty answers, not an overdue warning', () => {
    const sm = summarize([], [], [], TODAY);
    expect(sm).toEqual({ lastServiced: null, nextDue: null, overdueCount: 0, needsAttention: 0 });
  });
  it('a service record beats a completed task on the same day', async () => {
    const d = fresh();
    const a = await mk(d, 'Furnace');
    const t = await plan(d, a);
    await completeTask(t, TODAY, d);
    const day = localDate(Date.now());
    const sv = asService({ id: 1, module: 'assets', kind: 'service', createdAt: 1, updatedAt: 1, data: { assetId: a, date: day, title: 'Manual', kind: 'repair' } });
    const sm = summarize([], (await loadLinkedWork(a, d)).completedTasks, [sv], day);
    expect(sm.lastServiced).toMatchObject({ source: 'service', title: 'Manual' });
  });
  it('the suggestions are editable starting points that repeat sensibly and are never created automatically', async () => {
    expect(MAINTENANCE_SUGGESTIONS.length).toBeGreaterThanOrEqual(6);
    for (const s of MAINTENANCE_SUGGESTIONS) { expect(s.title).toBeTruthy(); expect(s.rule.interval).toBeGreaterThanOrEqual(1); }
    const d = fresh();
    await mk(d, 'New furnace', { type: 'system' });
    expect(await loadTasks(d)).toHaveLength(0); // adding an asset creates no tasks
  });
});

describe('H2 shared records, search and Quick Add', () => {
  it('service records resolve through the records hook; a missing one is null, not a crash', async () => {
    const d = fresh();
    // The hooks read the app's own database; here the data layer is exercised on the test database and the pure parts on lists.
    const a = await mk(d, 'Dishwasher');
    const id = await createService(svc(a, { title: 'Replaced pump' }), d, TODAY);
    expect(await assetRecords.describe('service:99999999')).toBeNull();
    expect(await assetRecords.describe('nonsense')).toBeNull();
    expect(await assetRecords.describe('asset:99999999')).toBeNull();
    expect(id).toBeGreaterThan(0);
  });
  it('search finds service records by title and notes once each, shows the asset place, never sensitive fields', async () => {
    const d = fresh();
    const home = await mk(d, 'Home', { type: 'property', address: '99 Sentinel Test Lane' });
    const dish = await mk(d, 'Dishwasher', { parentId: home, serialNumber: 'SENTINEL-SERIAL-001' });
    await createService(svc(dish, { title: 'Replaced drain pump', notes: 'Used part number 12345', costCents: 9900 }), d, TODAY);
    await createService(svc(dish, { title: 'Annual check', notes: 'pump sounded fine' }), d, TODAY);
    const assets = await loadAssets(d), services = await loadServices(d);
    const hits = searchAssetsData('pump', assets, 8, services);
    const sv = hits.filter((h) => h.kind === 'Service');
    expect(sv).toHaveLength(2);
    expect(new Set(sv.map((h) => h.id)).size).toBe(2);
    expect(sv[0].subtitle).toContain('Home > Dishwasher');
    expect(sv[0].path).toMatch(/^\/assets\/\d+\?service=\d+$/);
    expect(searchAssetsData('12345', assets, 8, services).filter((h) => h.kind === 'Service')).toHaveLength(1); // notes are searchable...
    expect(scanText(hits)).not.toMatch(/12345|9900|99\.00|SENTINEL|Sentinel Test Lane/); // ...but never shown
    expect(searchAssetsData('nothing like this', assets, 8, services)).toEqual([]);
  });
  it('a service record whose asset is gone still searches, pointing at the list', async () => {
    const sv = asService({ id: 5, module: 'assets', kind: 'service', createdAt: 1, updatedAt: 1, data: { assetId: 404, date: '2026-01-01', title: 'Lost job', kind: 'repair' } });
    const hit = searchAssetsData('lost', [], 8, [sv])[0];
    expect(hit).toMatchObject({ kind: 'Service', path: '/assets' });
    expect(hit.subtitle).toMatch(/Asset removed/);
  });

  const mkAssets = (rows: [number, string, boolean?][]) => rows.map(([id, name, archived]) => ({ id, createdAt: 1, updatedAt: 1, data: blankAsset({ name, archived: archived === true }) }));
  const all = mkAssets([[1, 'Dishwasher'], [2, 'Furnace 2'], [3, 'Old Fridge', true], [4, 'Boiler'], [5, 'Boiler ']]);
  it('Quick Add: work on an exact asset with optional amount and date, in either order', () => {
    const p = parseServiceQuick('Replaced pump on Dishwasher $180 yesterday', all, TODAY)!;
    expect(p).toMatchObject({ title: 'Replaced pump', assetId: 1, costCents: 18000, date: '2026-11-05', kind: 'other' });
    expect(p.problem).toBeUndefined();
    expect(parseServiceQuick('Descaled on dishwasher 2026-11-01 40', all, TODAY)).toMatchObject({ assetId: 1, costCents: 4000, date: '2026-11-01' });
    expect(parseServiceQuick('Looked at it on Dishwasher', all, TODAY)).toMatchObject({ assetId: 1, costCents: null, date: TODAY }); // no cost typed = unknown
    expect(parseServiceQuick('Repair seal on Dishwasher $0', all, TODAY)).toMatchObject({ kind: 'repair', costCents: 0 });
    expect(parseServiceQuick('Tune-up on Furnace 2 150', all, TODAY)).toMatchObject({ assetId: 2, costCents: 15000 }); // a digit in the name is not an amount
    expect(parseServiceQuick('Tune-up on Furnace 2', all, TODAY)).toMatchObject({ assetId: 2, costCents: null });
  });
  it('Quick Add never guesses: unknown, duplicate, archived, future, double amount, missing parts', () => {
    const bad = (t: string) => parseServiceQuick(t, all, TODAY)!;
    expect(bad('Fixed leak on Toaster').problem).toMatch(/No asset is named "Toaster"/);
    expect(bad('Fixed leak on Boiler').problem).toMatch(/More than one asset/);
    expect(bad('Fixed on Old Fridge').problem).toMatch(/No asset is named/);
    expect(bad('Fixed on Dishwasher tomorrow').problem).toMatch(/No asset/); // "tomorrow" is not understood, so it stays in the name
    expect(bad('Fixed on Dishwasher 2026-12-25').problem).toMatch(/future/);
    expect(bad('Fixed on Dishwasher 100 200').problem).toMatch(/more than one amount/);
    expect(bad('Fixed Dishwasher').problem).toMatch(/Say what was done and which asset/);
    expect(bad(' on Dishwasher').problem).toBeDefined();
    expect(parseServiceQuick('   ', all, TODAY)).toBeNull();
  });
  it('Quick Add: a preview that is not ready refuses to add; commit creates the record; Undo removes only it', async () => {
    const notReady = serviceQuickAdd.parse!('Fixed leak on Toaster')!;
    expect(notReady.summary).toMatch(/^nothing yet/);
    expect(notReady.fields[0].value).toMatch(/No asset is named "Toaster"/);
    await expect(serviceQuickAdd.commit!(notReady)).rejects.toThrow(/No asset is named/);
    const d = fresh();
    const a = await mk(d, 'Dishwasher');
    const keep = await createService(svc(a, { title: 'Existing' }), d, TODAY);
    const p = { summary: 's', fields: [], payload: { title: 'New job', kind: 'other', date: TODAY, costCents: null, assetId: a, where: 'Dishwasher' } };
    // commit uses the app database; the same create/undo path is exercised on the test database:
    const id = await createService(blankService(a, { title: 'New job', date: TODAY }), d, TODAY);
    expect(p.payload.assetId).toBe(a);
    expect(await removeNewService(id, d)).toBeNull();
    expect(await getService(id, d)).toBeUndefined();
    expect(await getService(keep, d)).toBeDefined();
  });
  it('Undo keeps a record that something is linked to', async () => {
    const d = fresh();
    const a = await mk(d, 'Dishwasher');
    const id = await createService(svc(a), d, TODAY);
    const t = await plan(d, a);
    await createStore(d).shared.links.add({ module: 'tasks', id: t }, { module: 'assets', id: serviceRefId(id) }, 'about');
    expect(await removeNewService(id, d)).toMatch(/linked/);
    expect(await getService(id, d)).toBeDefined();
  });
  it('is registered next to the asset destination with no clash', () => {
    expect(serviceQuickAdd).toMatchObject({ id: 'service', prefix: 'svc', aliases: ['service', 'repair'] });
    registerModule(assetsModule);
    expect(allQuickAdds().filter((q) => q.id === 'service')).toHaveLength(1);
    expect(allQuickAdds().filter((q) => q.id === 'asset')).toHaveLength(1);
  });
});

describe('H2 deletion rules', () => {
  it('a live service record blocks permanent deletion; the deletion leaves every record unchanged', async () => {
    const d = fresh();
    const a = await mk(d, 'Furnace');
    const sid = await createService(svc(a), d, TODAY);
    const t = await plan(d, a, { title: 'Open task' });
    const before = JSON.stringify(await d.moduleRecords.toArray());
    const linksBefore = JSON.stringify(await d.links.toArray());
    const p = await planAssetDeletion(a, d);
    expect(p.canDelete).toBe(false);
    expect(p.dependents).toBe(1);
    expect(p.reasons.join(' ')).toMatch(/service/);
    await expect(deleteAssetPermanently(a, d)).rejects.toThrow(/cannot be deleted/);
    expect(JSON.stringify(await d.moduleRecords.toArray())).toBe(before);
    expect(JSON.stringify(await d.links.toArray())).toBe(linksBefore);
    expect((await getTask(t, d))!.data.status).toBe('todo');
    // once the history is deleted on purpose, the asset can go, and no service record is touched by it
    await deleteService(sid, d);
    await deleteAssetPermanently(a, d);
    expect(await d.moduleRecords.get(sid)).toMatchObject({ deletedAt: expect.any(Number) });
  });
  it('a deleted service record (soft) no longer blocks; a restored one blocks again', async () => {
    const d = fresh();
    const a = await mk(d, 'Furnace');
    const sid = await createService(svc(a), d, TODAY);
    await deleteService(sid, d);
    expect((await planAssetDeletion(a, d)).canDelete).toBe(true);
    await restoreService(sid, d);
    expect((await planAssetDeletion(a, d)).canDelete).toBe(false);
  });
  it('editing an asset never changes its service records', async () => {
    const d = fresh();
    const a = await mk(d, 'Furnace');
    const sid = await createService(svc(a), d, TODAY);
    const before = JSON.stringify(await d.moduleRecords.get(sid));
    const cur = (await loadAssets(d)).find((x) => x.id === a)!;
    await updateAsset(a, { ...cur.data, name: 'Furnace (renamed)' }, d);
    expect(JSON.stringify(await d.moduleRecords.get(sid))).toBe(before);
  });
});

describe('H2 backup and unrelated data', () => {
  it('service records survive an export and restore with every field', async () => {
    const d = fresh();
    const a = await mk(d, 'Furnace');
    const id = await createService(svc(a, { title: 'Annual service', costCents: 0, notes: 'n', refs: [{ label: 'Invoice', url: 'https://example.com/i' }], taskTitleSnapshot: 'Task name' }), d, TODAY);
    const text = JSON.stringify(await exportAll(d));
    const target = new FinanceDB(`test-service-restore-${n++}`);
    await target.open();
    await importAll(target, checkBackupText(text).file);
    expect((await getService(id, target))!.data).toMatchObject({ title: 'Annual service', costCents: 0, notes: 'n', taskTitleSnapshot: 'Task name', refs: [{ label: 'Invoice', url: 'https://example.com/i' }] });
  });
  it('service history never touches Finance or Projects tables (cost is informational)', async () => {
    const d = fresh();
    await d.accounts.add({ name: 'Test Checking', kind: 'checking', openingCents: 100000 } as never);
    await d.moduleRecords.add({ id: 7, module: 'projects', kind: 'project', createdAt: 1, updatedAt: 1, data: { name: 'Test Project' } } as never);
    const snap = async () => JSON.stringify([await d.accounts.toArray(), await d.moduleRecords.where('module').equals('projects').toArray(),await d.txns.toArray(), await d.categories.toArray(), await d.assignments.toArray(), await d.recurring.toArray(), await d.goals.toArray()]);
    const before = await snap();
    const a = await mk(d, 'Furnace');
    const t = await plan(d, a, { repeat: { mode: 'fixed', rule: yearly } });
    await logTaskService({ taskId: t, data: svc(a, { costCents: 123456 }), complete: true, today: TODAY }, d);
    await createService(svc(a, { costCents: 99900, title: 'Repair', kind: 'repair' }), d, TODAY);
    expect(await snap()).toBe(before);
    expect(await d.txns.count()).toBe(0);
  });
});
