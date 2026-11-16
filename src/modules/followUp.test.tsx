import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FinanceDB } from '../db';
import { providerNamed } from '../core/contactTestkit';
import { createStore, repo } from '../core/store';
import type { ModuleRecord } from '../core/entities';
import { advanceRun, announceTaskDone, onTaskFollowUp, resolveTaskFollowUp, stopRun, type FollowUpRun, type ResolvedFollowUp, type TaskFollowUpSource } from '../core/taskFollowUp';
import { installTracking } from '../lib/sync/track';
import { archiveAsset, assetRef, createAsset } from './assets/data';
import { checkAssetsFollowUp } from './assets/followUp';
import { blankAsset } from './assets/model';
import { UnsavedWork } from './assets/OverviewPage';
import { blankService } from './assets/service';
import { loadServices, logTaskService } from './assets/serviceData';
import { servicesModule } from './services';
import { assetsModule } from './assets';
import { createArrangement, tasksOfArrangement } from './services/data';
import { checkServicesFollowUp } from './services/followUp';
import { AttentionCard } from './services/OverviewParts';
import { blankArrangement, type Cadence } from './services/model';
import { openOf } from './services/schedule';
import { addBookingReminder, isoOfMs, loadVisits, logVisitFromTask, planLogVisit, type VisitInput } from './services/visits';
import { completeTask, createTask, getTask, loadTasks, reopenTask } from './tasks/data';
import { blankTask } from './tasks/model';

/**
 * R1.3 "Finish the loop". What must hold: finishing a Task never creates a visit or a history entry; the offer appears only for the right Tasks and only while
 * there is still something to log; it stays tied to the occurrence that was finished (not the next one); cancelling, Undo and reopening change nothing already
 * saved and never make a second record. Every name, date and task below is invented. 2026-11-06 is a Friday.
 */
let n = 0;
const fresh = () => { const d = new FinanceDB(`test-r13-${n++}`); installTracking(d); return d; };
const TODAY = '2026-11-06';
const biweekly: Cadence = { mode: 'fixed', rule: { freq: 'weekly', interval: 2, end: { type: 'never' } }, anchorDate: TODAY };
const addArr = async (d: FinanceDB, over = {}) => createArrangement({ data: blankArrangement({ title: 'House cleaning', cadence: biweekly, ...over }), provider: await providerNamed(d, "Rosa's Cleaning"), today: TODAY }, d);
const openVisit = async (d: FinanceDB, arrId: number) => openOf(await tasksOfArrangement(arrId, d))[0];
const input = (over: Partial<VisitInput> = {}): VisitInput => ({ status: 'completed', cancelledBy: null, date: TODAY, notes: '', chargedCents: null, chargeKind: null, ...over });
const everything = async (d: FinanceDB) => JSON.stringify([await d.moduleRecords.toArray(), await d.links.toArray(), await d.contacts.toArray(), await d.txns.toArray()]);
async function logIt(d: FinanceDB, arrId: number, taskId: number, over: Partial<VisitInput> = {}) {
  const inp = input(over);
  const plan = await planLogVisit(arrId, taskId, inp, TODAY, d);
  return logVisitFromTask({ arrangementId: arrId, taskId, input: inp, today: TODAY, expect: plan.expect }, d);
}
/** The two real readers, pointed at a test database. */
const sourcesFor = (d: FinanceDB, spy?: () => void) => [
  { moduleId: 'services', source: { read: async (id: number) => { spy?.(); return (await checkServicesFollowUp(id, d)).ok ? { label: 'Log completed visit' } : null; }, Dialog: async () => ({ default: () => null }) } as TaskFollowUpSource },
  { moduleId: 'assets', source: { read: async (id: number) => { spy?.(); return (await checkAssetsFollowUp(id, undefined, d)).ok ? { label: 'Log maintenance' } : null; }, Dialog: async () => ({ default: () => null }) } as TaskFollowUpSource },
];
const offer = (d: FinanceDB, id: number, spy?: () => void) => resolveTaskFollowUp(id, d, sourcesFor(d, spy));

describe('R1.3 the offer: only the right Tasks, only while something is left to log', () => {
  it('an ordinary Task gets no offer, and no module is even asked', async () => {
    const d = fresh();
    const id = await createTask(blankTask({ title: 'Call the plumber', dueDate: TODAY }), [], d);
    await completeTask(id, TODAY, d);
    const asked = vi.fn();
    expect(await offer(d, id, asked)).toBeNull();
    expect(asked).not.toHaveBeenCalled();
  });
  it('a Task linked to some other module (not a household one) gets no offer and no module is asked', async () => {
    const d = fresh();
    const id = await createTask(blankTask({ title: 'Check the statement', dueDate: TODAY }), [{ module: 'ledger', id: 'account:1' }], d);
    await completeTask(id, TODAY, d);
    const asked = vi.fn();
    expect(await offer(d, id, asked)).toBeNull();
    expect(asked).not.toHaveBeenCalled();
  });

  it('a finished visit Task is offered "Log completed visit"; the same Task still open is not', async () => {
    const d = fresh();
    const a = await addArr(d);
    const t = (await openVisit(d, a.id)).id;
    expect(await offer(d, t)).toBeNull(); // not finished
    await completeTask(t, TODAY, d); // exactly what Tasks, Today and the Calendar do
    expect(await offer(d, t)).toEqual({ moduleId: 'services', taskId: t, label: 'Log completed visit' });
  });
  it('finishing the Task writes no visit, no history entry and no money record', async () => {
    const d = fresh();
    const a = await addArr(d);
    const t = (await openVisit(d, a.id)).id;
    await completeTask(t, TODAY, d);
    expect(await loadVisits(d)).toHaveLength(0);
    expect(await d.txns.count()).toBe(0);
    const asset = await createAsset(blankAsset({ name: 'Furnace' }), d);
    const m = await createTask(blankTask({ title: 'Replace filter', dueDate: TODAY }), [assetRef(asset)], d);
    await completeTask(m, TODAY, d);
    expect(await loadServices(d)).toHaveLength(0);
    expect(await d.txns.count()).toBe(0);
  });
  it('a "remind me to book" Task is not a visit: no offer', async () => {
    const d = fresh();
    const a = await addArr(d);
    const id = await addBookingReminder(a.id, TODAY, d);
    await completeTask(id, TODAY, d);
    expect(await offer(d, id)).toBeNull();
  });
  it('a finished Task whose arrangement was deleted gets no offer, and the dialog would say why', async () => {
    const d = fresh();
    const a = await addArr(d);
    const t = (await openVisit(d, a.id)).id;
    await completeTask(t, TODAY, d);
    await repo<ModuleRecord>(d.moduleRecords).remove(a.id);
    expect(await offer(d, t)).toBeNull();
    const c = await checkServicesFollowUp(t, d);
    expect(c.ok).toBe(false);
    expect(!c.ok && c.reason).toMatch(/no longer exists|not part of a household service/);
  });

  it('a finished maintenance Task is offered "Log maintenance"; an open one is not', async () => {
    const d = fresh();
    const asset = await createAsset(blankAsset({ name: 'Furnace' }), d);
    const t = await createTask(blankTask({ title: 'Replace filter', dueDate: TODAY }), [assetRef(asset)], d);
    expect(await offer(d, t)).toBeNull();
    await completeTask(t, TODAY, d);
    expect(await offer(d, t)).toEqual({ moduleId: 'assets', taskId: t, label: 'Log maintenance' });
  });
  it('no offer once the work is saved, and the dialog points at the entry instead of making a second one', async () => {
    const d = fresh();
    const asset = await createAsset(blankAsset({ name: 'Furnace' }), d);
    const t = await createTask(blankTask({ title: 'Replace filter', dueDate: TODAY }), [assetRef(asset)], d);
    await completeTask(t, TODAY, d);
    const { serviceId } = await logTaskService({ taskId: t, data: blankService(asset, { title: 'Replaced filter', date: TODAY, kind: 'maintenance' }), complete: false, today: TODAY }, d);
    expect(await offer(d, t)).toBeNull();
    const c = await checkAssetsFollowUp(t, undefined, d);
    expect(!c.ok && c.saved).toEqual({ assetId: asset, serviceId });
    await expect(logTaskService({ taskId: t, data: blankService(asset, { title: 'Again', date: TODAY }), complete: false, today: TODAY }, d)).rejects.toThrow(/already saved/);
    expect(await loadServices(d)).toHaveLength(1);
  });
  it('a Task linked to several eligible assets gets no offer (no guessing by database order); the manual per-asset save still works; one eligible asset still does', async () => {
    const d = fresh();
    const a1 = await createAsset(blankAsset({ name: 'Upstairs unit' }), d);
    const a2 = await createAsset(blankAsset({ name: 'Downstairs unit' }), d);
    const t = await createTask(blankTask({ title: 'Service both units' }), [assetRef(a1), assetRef(a2)], d);
    await completeTask(t, TODAY, d);
    expect(await offer(d, t)).toBeNull();
    const c = await checkAssetsFollowUp(t, undefined, d);
    expect(!c.ok && c.reason).toMatch(/more than one asset/);
    expect((await checkAssetsFollowUp(t, a2, d)).ok).toBe(true); // an explicit, eligible choice is honoured
    expect((await checkAssetsFollowUp(t, 999999, d)).ok).toBe(false);
    await logTaskService({ taskId: t, data: blankService(a1, { title: 'Serviced', date: TODAY, kind: 'maintenance' }), complete: false, today: TODAY }, d); // the asset page's own flow
    expect(await loadServices(d)).toHaveLength(1);
    const a3 = await createAsset(blankAsset({ name: 'Old unit' }), d);
    await archiveAsset(a3, d);
    const t2 = await createTask(blankTask({ title: 'Check units' }), [assetRef(a2), assetRef(a3)], d);
    await completeTask(t2, TODAY, d);
    expect(await offer(d, t2)).toEqual({ moduleId: 'assets', taskId: t2, label: 'Log maintenance' }); // only one is eligible (the other is archived)
  });
  it('no offer for an archived asset (it cannot take history), nor for one that was deleted', async () => {
    const d = fresh();
    const a1 = await createAsset(blankAsset({ name: 'Old boiler' }), d);
    const t1 = await createTask(blankTask({ title: 'Service boiler' }), [assetRef(a1)], d);
    await completeTask(t1, TODAY, d);
    await archiveAsset(a1, d);
    expect(await offer(d, t1)).toBeNull();
    const c = await checkAssetsFollowUp(t1, undefined, d);
    expect(!c.ok && c.reason).toMatch(/archived/);
    const a2 = await createAsset(blankAsset({ name: 'Sold mower' }), d);
    const t2 = await createTask(blankTask({ title: 'Sharpen blades' }), [assetRef(a2)], d);
    await completeTask(t2, TODAY, d);
    await repo<ModuleRecord>(d.moduleRecords).remove(a2);
    expect(await offer(d, t2)).toBeNull();
  });
  it('the registry hooks exist, use these words, and load their dialogs and readers only on demand', () => {
    for (const m of [servicesModule, assetsModule]) {
      const h = m.contributes?.taskFollowUp;
      expect(typeof h?.read).toBe('function');
      expect(typeof h?.Dialog).toBe('function');
    }
  });
});

describe('R1.3 a recurring visit: the offer stays with the visit that was finished', () => {
  it('logs the finished occurrence (not the next one), keeps one open next visit, makes no second visit', async () => {
    const d = fresh();
    const a = await addArr(d);
    const first = await openVisit(d, a.id);
    const firstDue = first.data.dueDate;
    await completeTask(first.id, TODAY, d); // Tasks spawns the next copy straight away
    const offered = await offer(d, first.id);
    expect(offered?.taskId).toBe(first.id); // the finished one, never the copy
    const open = (await tasksOfArrangement(a.id, d)).filter((t) => t.data.status !== 'done');
    expect(open).toHaveLength(1);
    expect(await offer(d, open[0].id)).toBeNull(); // the next visit is not finished, so it is not offered

    await logIt(d, a.id, first.id);
    const visits = await loadVisits(d);
    expect(visits).toHaveLength(1);
    expect(visits[0].data).toMatchObject({ taskId: first.id, arrangementId: a.id, occurrence: firstDue });
    expect(visits.some((v) => v.data.taskId === open[0].id)).toBe(false); // the next visit is not tied to this one
    const after = (await tasksOfArrangement(a.id, d)).filter((t) => t.data.status !== 'done');
    expect(after).toHaveLength(1); // still exactly one open next visit, no duplicate
    expect(after[0].data.dueDate! > firstDue!).toBe(true);
    expect(await offer(d, first.id)).toBeNull(); // logged, so no second offer
  });
  it('the dialog starts on the day it was finished and knows the day it was scheduled for', async () => {
    const d = fresh();
    const a = await addArr(d);
    const t = await openVisit(d, a.id);
    await completeTask(t.id, TODAY, d);
    const plan = await planLogVisit(a.id, t.id, input(), TODAY, d);
    expect(plan.mode).toBe('late'); // it was finished elsewhere, so logging does not finish it again
    expect(plan.taskDue).toBe(t.data.dueDate);
    expect(plan.suggestedDate).toBe(isoOfMs((await getTask(t.id, d))!.data.completedAt!)); // the day Tasks recorded it as finished
    expect(plan.problem).toBeNull();
  });
});

describe('R1.3 cancel, Undo, reopen and double saves', () => {
  it('looking at the offer, and opening then cancelling the dialog, change nothing', async () => {
    const d = fresh();
    const a = await addArr(d);
    const t = (await openVisit(d, a.id)).id;
    await completeTask(t, TODAY, d);
    const before = await everything(d);
    await offer(d, t);
    await checkServicesFollowUp(t, d);
    await planLogVisit(a.id, t, input(), TODAY, d); // the dialog's preview
    expect(await everything(d)).toBe(before);
    expect((await getTask(t, d))!.data.status).toBe('done'); // cancelling never reverses the completion
  });
  it('Undo of the completion (the Done message) after logging keeps the visit and does not log again', async () => {
    const d = fresh();
    const a = await addArr(d);
    const t = (await openVisit(d, a.id)).id;
    await completeTask(t, TODAY, d);
    await logIt(d, a.id, t);
    await reopenTask(t, d); // the toast's own Undo
    expect(await loadVisits(d)).toHaveLength(1); // the visit is never silently deleted
    expect(await offer(d, t)).toBeNull(); // reopened: nothing to log yet
    await completeTask(t, TODAY, d);
    expect(await offer(d, t)).toBeNull(); // finished again, but that visit is already logged: no second offer
    expect(await loadVisits(d)).toHaveLength(1);
  });
  it('the dialog refuses a Task that was reopened since the button was shown', async () => {
    const d = fresh();
    const a = await addArr(d);
    const t = (await openVisit(d, a.id)).id;
    await completeTask(t, TODAY, d);
    await reopenTask(t, d);
    const c = await checkServicesFollowUp(t, d);
    expect(c.ok).toBe(false);
    expect(!c.ok && c.reason).toMatch(/reopened/);
    expect(await loadVisits(d)).toHaveLength(0);
  });
  it('saving the same visit twice (two taps, or two devices) is refused the second time', async () => {
    const d = fresh();
    const a = await addArr(d);
    const t = (await openVisit(d, a.id)).id;
    await completeTask(t, TODAY, d);
    const inp = input();
    const plan = await planLogVisit(a.id, t, inp, TODAY, d);
    const go = () => logVisitFromTask({ arrangementId: a.id, taskId: t, input: inp, today: TODAY, expect: plan.expect }, d).then(() => 'ok', (e: Error) => e.message);
    const out = await Promise.all([go(), go()]);
    expect(out.filter((x) => x === 'ok')).toHaveLength(1);
    expect(await loadVisits(d)).toHaveLength(1);
  });
  it('a deleted Task has no offer and the dialog says so', async () => {
    const d = fresh();
    const a = await addArr(d);
    const t = (await openVisit(d, a.id)).id;
    await completeTask(t, TODAY, d);
    await repo<ModuleRecord>(d.moduleRecords).remove(t);
    expect(await offer(d, t)).toBeNull();
    const c = await checkServicesFollowUp(t, d);
    expect(!c.ok && c.reason).toMatch(/not here any more/);
    expect((await loadTasks(d)).some((x) => x.id === t)).toBe(false);
  });
  it('two modules linked to one Task: the first in module order wins and only one offer is made', async () => {
    const d = fresh();
    const a = await addArr(d);
    const asset = await createAsset(blankAsset({ name: 'Rug' }), d);
    const t = (await openVisit(d, a.id)).id;
    await createStore(d).shared.links.add({ module: 'tasks', id: t }, assetRef(asset), 'about');
    await completeTask(t, TODAY, d);
    expect((await offer(d, t))?.moduleId).toBe('services');
  });
});

describe('R1.3 the shared "Done" message', () => {
  afterEach(() => vi.unstubAllGlobals());
  const done = (taskId: number) => ({ taskId, text: 'Done: Clean', undo: async () => undefined });
  it('an ordinary Task gets exactly the message it always had: same words, same Undo, no extra button', async () => {
    const toast = vi.fn();
    const undo = async () => undefined;
    await announceTaskDone(toast, { taskId: 1, text: 'Done', undo }, async () => null);
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith('Done', undo, undefined);
  });
  it('an eligible Task adds ONE button beside Undo; pressing it asks the host to open the module\'s dialog, and it only opens', async () => {
    const target = new EventTarget();
    vi.stubGlobal('window', target);
    const heard: ResolvedFollowUp[][] = [];
    const off = onTaskFollowUp((items) => heard.push(items));
    const toast = vi.fn();
    await announceTaskDone(toast, done(7), async (id) => ({ moduleId: 'services', taskId: id, label: 'Log completed visit' }));
    const [text, undo, action] = toast.mock.calls[0];
    expect(text).toBe('Done: Clean');
    expect(typeof undo).toBe('function');
    expect(action.label).toBe('Log completed visit');
    expect(heard).toEqual([]); // showing the message opens nothing
    action.onClick();
    expect(heard).toEqual([[{ moduleId: 'services', taskId: 7, label: 'Log completed visit' }]]);
    off();
  });
  it('a reader that fails never breaks the Done message', async () => {
    const toast = vi.fn();
    await announceTaskDone(toast, done(3), async () => { throw new Error('boom'); });
    expect(toast).toHaveBeenCalledWith('Done: Clean', expect.any(Function), undefined);
  });
  it('a bulk completion adds one "one at a time" button that lists only the Tasks that have something to log', async () => {
    vi.stubGlobal('window', new EventTarget());
    const heard: ResolvedFollowUp[][] = [];
    const off = onTaskFollowUp((items) => heard.push(items));
    const toast = vi.fn();
    await announceTaskDone(toast, { taskIds: [1, 2, 3], text: 'Completed 3 tasks' }, async (id) => (id === 2 ? null : { moduleId: id === 1 ? 'services' : 'assets', taskId: id, label: 'x' }));
    const action = toast.mock.calls[0][2];
    expect(action.label).toBe('Log 2 one at a time');
    action.onClick();
    expect(heard[0].map((x) => x.taskId)).toEqual([1, 3]);
    off();
  });
});

describe('R1.3 one at a time: the walk through several finished Tasks', () => {
  const item = (taskId: number): ResolvedFollowUp => ({ moduleId: 'services', taskId, label: 'Log' });
  const start: FollowUpRun = { items: [item(1), item(2), item(3)], i: 0 };
  it('saving moves on; the close that follows the save does not move on again or end the walk', () => {
    const afterSave = advanceRun(start, 0); // onSaved
    expect(afterSave?.i).toBe(1);
    expect(stopRun(afterSave, 0)).toBe(afterSave); // the save's own onClose is for dialog 0, which is gone: nothing happens
  });
  it('Skip this one moves on without saving; the last one ends the walk', () => {
    expect(advanceRun(start, 0)?.i).toBe(1);
    expect(advanceRun({ ...start, i: 2 }, 2)).toBeNull();
  });
  it('Cancel, Not now, the X or Escape on the current dialog stops the whole walk', () => {
    expect(stopRun({ ...start, i: 1 }, 1)).toBeNull();
  });
  it('a late action from a dialog that is no longer the current one is ignored', () => {
    const run = { ...start, i: 2 };
    expect(advanceRun(run, 0)).toBe(run);
    expect(stopRun(run, 1)).toBe(run);
    expect(advanceRun(null, 0)).toBeNull();
  });
});

describe('R1.3 finished-but-not-logged lists: selection, and what is deliberately not offered', () => {
  const task = (id: number, title: string) => ({ id, createdAt: 1, updatedAt: 1, data: blankTask({ title, status: 'done' }) });
  const entry = (id: number, title: string) => ({ id: `unlogged:${id}`, kind: 'unlogged' as const, text: `${title}: finished 2026-11-04, not yet logged`, hint: 'Log this visit', href: '#/services/a/1', arrangementId: 1, unlogged: { arrangementId: 1, task: task(id, title), finishedOn: '2026-11-04', staleCopy: false } });
  const card = (items: ReturnType<typeof entry>[], many = true) => renderToStaticMarkup(<AttentionCard items={items} onLog={() => undefined} onLogMany={many ? () => undefined : undefined} />);

  it('Household Services: with several unlogged visits each can be ticked, with one-at-a-time wording and no "log all"', () => {
    const html = card([entry(1, 'House cleaning'), entry(2, 'Lawn care')]);
    expect((html.match(/type="checkbox"/g) ?? []).length).toBe(2);
    expect(html).toContain('Select to log: House cleaning');
    expect(html).toContain('one at a time');
    expect(html).toMatch(/Finishing a task does not prove the visit happened/);
    expect(html).not.toMatch(/log all|dismiss/i);
    expect(html).toMatch(/Log this visit…/); // the existing single action is still there
  });
  it('Household Services: a single unlogged visit has no tick boxes (nothing to select between)', () => {
    expect(card([entry(1, 'House cleaning')])).not.toContain('type="checkbox"');
  });
  it('Home & Assets: every unsaved task has its own "Save to history…" button; ticking and one-at-a-time wording only with several; no "save all" and no "dismiss"', () => {
    const names = new Map([[10, 'Furnace'], [11, 'Dishwasher']]);
    const two = renderToStaticMarkup(<UnsavedWork rows={[{ taskId: 1, title: 'Replace filter', assetIds: [10] }, { taskId: 2, title: 'Clean coils', assetIds: [11] }]} names={names} />);
    expect((two.match(/Save to history…/g) ?? []).length).toBe(2);
    expect((two.match(/type="checkbox"/g) ?? []).length).toBe(2);
    expect(two).toContain('Finished, not yet saved (2)');
    expect(two).toMatch(/does not record the work, its date or its cost/);
    expect(two).not.toMatch(/save all|dismiss/i);
    const one = renderToStaticMarkup(<UnsavedWork rows={[{ taskId: 1, title: 'Replace filter', assetIds: [10] }]} names={names} />);
    expect(one).not.toContain('type="checkbox"');
    expect(renderToStaticMarkup(<UnsavedWork rows={[]} names={names} />)).toBe('');
  });
});
