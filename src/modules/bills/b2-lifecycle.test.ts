import { describe, expect, it } from 'vitest';
import { FinanceDB } from '../../db';
import { completeTask, loadDeletedTasks, loadTasks, saveTask } from '../tasks/data';
import { applyLifecycle, createObligation, getObligation, planDelete, planLifecycle, type LifecycleAction } from './data';
import { loadCycles, newOp, recordFact } from './cycleData';
import { saveReminders, saveTerms, tidyReminders } from './contractData';
import { attention, derive, loadBillsSnapshot } from './readModel';
import { ensureBillTasks, loadBillTasks, markersOf } from './tasks';
import { blankTerms } from './terms';
import type { ObligationData } from './model';
import { applyUndo, isUndoRefused } from './undo';
import { devices, fresh, inv, monthly, ob, paidOut, settle, sleep } from './billsTestkit';
import type { FactBody } from './cycleModel';

/** Real Dexie and the real SyncEngine. Invented data only. 2026-11-07 is a Saturday. */
const TODAY = '2026-11-07';
const REM = { payTask: true, leadDays: 3 };
const mkData = (over: Partial<ObligationData> = {}) => ob({ title: 'Example Power Co', amountKind: 'variable', prices: [{ from: TODAY, cents: 9000, label: '' }], schedule: monthly(18, '2026-11'), reminders: REM, ...over }, TODAY);
const mk = (d: FinanceDB, over: Partial<ObligationData> = {}) => createObligation({ data: mkData(over), provider: { name: 'Example Power Co' }, today: TODAY }, d);
const rec = (d: FinanceDB, id: number, slot: string, body: FactBody, finishTaskId?: number | null) => recordFact({ obligationId: id, slot, body, op: newOp(), today: TODAY, finishTaskId }, d);
const life = async (d: FinanceDB, id: number, action: LifecycleAction, date?: string) => {
  const plan = await planLifecycle(id, action, { today: TODAY, date }, d);
  const r = await applyLifecycle({ id, action, expect: plan.expect, today: TODAY, date }, d);
  await sleep(2);
  return { ...r, plan };
};
const open = async (d: FinanceDB) => (await loadBillTasks(d)).filter((t) => t.data.status !== 'done');
const cyc = async (d: FinanceDB) => JSON.stringify((await loadCycles(d)).map((c) => c.raw));

describe('B2 pausing and ending a bill that has reminder Tasks', () => {
  it('pausing from today: the untouched reminder for a period that is no longer expected is removed (restorable), nothing new is made, facts are untouched', async () => {
    const d = fresh();
    const { id } = await mk(d);
    expect(await open(d)).toHaveLength(1);
    await rec(d, id, 'm2026-12', inv(5000));
    const facts = await cyc(d);
    const r = await life(d, id, 'pause');
    expect(r.plan.lines.join(' ')).toMatch(/1 reminder Task that Bills made and you have not changed will be removed/);
    expect(await open(d)).toHaveLength(0);
    expect((await loadDeletedTasks(d)).filter((t) => markersOf(t))).toHaveLength(1); // a soft delete: it can be restored
    expect(await cyc(d)).toBe(facts);
    await ensureBillTasks(id, TODAY, d);
    expect(await open(d)).toHaveLength(0); // no new reminder for an inactive bill
  });
  it('pausing from a later date keeps the reminder for the bill that is still expected before the pause', async () => {
    const d = fresh();
    const { id } = await mk(d);
    await life(d, id, 'pause', '2026-12-01');
    const tasks = await open(d);
    expect(tasks).toHaveLength(1);
    expect(markersOf(tasks[0])!.cycle).toBe('m2026-11');
  });
  it('ending: the untouched reminders (pay and cancel-by) are removed, a finished Task and every billing record are kept', async () => {
    const d = fresh();
    const { id } = await mk(d);
    const t0 = (await open(d))[0];
    await rec(d, id, 'm2026-11', paidOut('2026-11-10', 9000), t0.id); // finished Task + the next one for December
    expect(await open(d)).toHaveLength(1);
    const o = (await getObligation(id, d))!;
    await saveTerms(id, { ...blankTerms(), noticeByDate: '2026-12-20' }, o.updatedAt, TODAY, d);
    expect(await open(d)).toHaveLength(2);
    const facts = await cyc(d);
    await life(d, id, 'end');
    expect(await open(d)).toHaveLength(0);
    const all = await loadBillTasks(d);
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(t0.id);
    expect(all[0].data.status).toBe('done'); // the finished Task is history and stays
    expect(await cyc(d)).toBe(facts);
  });
  it('a Task the owner moved, renamed or started is never removed: it stays open and is reported for a look', async () => {
    for (const change of [{ dueDate: '2026-11-20' }, { title: 'Pay the power company (mine)' }, { status: 'doing' as const }, { notes: 'call them first' }]) {
      const d = fresh();
      const { id } = await mk(d);
      const t = (await open(d))[0];
      await saveTask(t.id, { ...t.data, ...change }, d);
      const r = await life(d, id, 'end');
      expect(r.plan.lines.join(' '), JSON.stringify(change)).toMatch(/1 reminder Task you changed stays open/);
      const after = await open(d);
      expect(after.map((x) => x.id), JSON.stringify(change)).toEqual([t.id]);
      expect(attention(derive(await loadBillsSnapshot(d), TODAY)).taskProblems, JSON.stringify(change)).toBe(1);
    }
  });
  it('a partly paid bill that is then paused keeps the reminder for the balance (the period holds records)', async () => {
    const d = fresh();
    const { id } = await mk(d);
    const t = (await open(d))[0];
    await rec(d, id, 'm2026-11', inv(10000));
    await rec(d, id, 'm2026-11', paidOut('2026-11-10', 6000), t.id); // $60.00 of $100.00: still open, a new Task for the balance
    expect((await open(d)).map((x) => markersOf(x)!.cycle)).toEqual(['m2026-11']);
    await life(d, id, 'pause');
    const kept = await open(d);
    expect(kept.map((x) => markersOf(x)!.cycle)).toEqual(['m2026-11']); // the balance is still owed, so the reminder stays
  });
  it('the action date stays a reminder date and the bill due date stays recorded: removing a reminder never changes a due date', async () => {
    const d = fresh();
    const { id } = await mk(d);
    await rec(d, id, 'm2026-11', inv(5000, { dueDate: '2026-11-25' }));
    await life(d, id, 'end', '2026-11-30');
    const o = (await getObligation(id, d))!;
    expect((await loadCycles(d))[0].body).toMatchObject({ dueDate: '2026-11-25' });
    expect(o.data.status).toBe('ended');
    expect((await open(d)).map((x) => [markersOf(x)!.cycle, markersOf(x)!.due])).toEqual([['m2026-11', '2026-11-25']]); // the final bill is still expected, so its reminder stays, dated 22 Nov for the 25th
  });
});

describe('B2 resuming and reopening: no duplicates, no revival of removed Tasks', () => {
  it('resume after a pause that removed the reminder makes exactly one new Task; asking again adds none', async () => {
    const d = fresh();
    const { id } = await mk(d);
    await life(d, id, 'pause');
    expect(await open(d)).toHaveLength(0);
    const r = await life(d, id, 'resume', TODAY);
    expect(r.plan.lines.join(' ')).toMatch(/A reminder Task will be made/);
    expect(await open(d)).toHaveLength(1);
    await ensureBillTasks(id, TODAY, d);
    await ensureBillTasks(id, TODAY, d);
    expect(await open(d)).toHaveLength(1);
    expect((await loadTasks(d)).length).toBe(1); // the removed one stays removed
  });
  it('a Task the owner kept (moved) is reused after the bill is resumed: no second Task, and the report clears', async () => {
    const d = fresh();
    const { id } = await mk(d);
    const t = (await open(d))[0];
    await saveTask(t.id, { ...t.data, dueDate: '2026-11-16' }, d);
    await life(d, id, 'pause');
    expect(attention(derive(await loadBillsSnapshot(d), TODAY)).taskProblems).toBe(1);
    await life(d, id, 'resume', TODAY);
    const tasks = await open(d);
    expect(tasks.map((x) => x.id)).toEqual([t.id]);
    expect(tasks[0].data.dueDate).toBe('2026-11-16'); // the owner's date is untouched
    expect(attention(derive(await loadBillsSnapshot(d), TODAY)).taskProblems).toBe(0);
  });
  it('end then reopen: one new reminder, history intact', async () => {
    const d = fresh();
    const { id } = await mk(d);
    await rec(d, id, 'm2026-11', inv(5000, { dueDate: '2026-11-20' }));
    await life(d, id, 'end', TODAY);
    await life(d, id, 'reopen', TODAY);
    expect((await open(d)).length).toBe(1);
    expect((await loadCycles(d)).length).toBe(1);
  });
  it('Undo of an End puts the removed reminder back, and is refused once that Task changed', async () => {
    const d = fresh();
    const { id } = await mk(d);
    const t = (await open(d))[0];
    const ended = await life(d, id, 'end');
    expect(await open(d)).toHaveLength(0);
    await applyUndo(ended.undo, d);
    expect((await open(d)).map((x) => x.id)).toEqual([t.id]);
    expect((await getObligation(id, d))!.data.status).toBe('active');
    const again = await life(d, id, 'end');
    const row = (await d.moduleRecords.get(t.id))!;
    await d.moduleRecords.put({ ...row, updatedAt: Date.now() + 5 }); // changed since
    await expect(applyUndo(again.undo, d)).rejects.toSatisfy(isUndoRefused);
  });
});

describe('B2 two devices: a bill ended on one while the other finishes its Task', () => {
  const seeded = async () => {
    const { A, B } = devices();
    const r = await createObligation({ data: mkData(), provider: { name: 'Example Power Co' }, today: TODAY }, A.d);
    await A.engine.initialUpload();
    await B.engine.replaceFromRemote();
    return { A, B, id: r.id };
  };
  it('B finishes the Task after A ended the bill: both converge on a finished Task, the bill ended, no new reminder', async () => {
    const { A, B, id } = await seeded();
    await life(A.d, id, 'end');
    await sleep(5);
    const t = (await open(B.d))[0];
    await completeTask(t.id, TODAY, B.d);
    await settle(A, B);
    for (const d of [A.d, B.d]) {
      expect((await getObligation(id, d))!.data.status).toBe('ended');
      expect((await loadBillTasks(d)).map((x) => x.data.status)).toEqual(['done']);
      expect(await open(d)).toHaveLength(0);
    }
  });
  it('A ends the bill after B finished the Task offline: both devices converge on the same state and no billing record is lost (the removal may hide the finished Task, which stays restorable)', async () => {
    const { A, B, id } = await seeded();
    const t = (await open(B.d))[0];
    await rec(B.d, id, 'm2026-11', paidOut('2026-11-12', 9000), t.id); // Done, mark paid on B
    await sleep(5);
    await life(A.d, id, 'end'); // A has not seen it yet and retires its untouched copy of the Task
    await settle(A, B);
    const a = await loadTasks(A.d), b = await loadTasks(B.d);
    expect(JSON.stringify(a.map((x) => [x.id, x.data.status]))).toBe(JSON.stringify(b.map((x) => [x.id, x.data.status])));
    for (const d of [A.d, B.d]) {
      expect((await loadCycles(d)).map((c) => c.body?.fact)).toEqual(['paid-outside']); // the payment note survives on both
      expect((await getObligation(id, d))!.data.status).toBe('ended');
    }
    expect((await loadTasks(A.d)).length + (await loadDeletedTasks(A.d)).length).toBeGreaterThanOrEqual(1); // nothing was destroyed
    // B had already made the next reminder (for December) before it saw the end: it is reported, and "Update reminders" removes it (untouched, guarded, undoable)
    const stray = await open(A.d);
    expect(stray).toHaveLength(1);
    expect(attention(derive(await loadBillsSnapshot(A.d), TODAY)).taskProblems).toBe(1);
    const tidied = await tidyReminders(id, TODAY, A.d);
    expect(tidied.retired).toBe(1);
    expect(await open(A.d)).toHaveLength(0);
    expect(attention(derive(await loadBillsSnapshot(A.d), TODAY)).taskProblems).toBe(0);
    await applyUndo(tidied.undo, A.d);
    expect(await open(A.d)).toHaveLength(1);
  });
});

describe('B2 Task association: markers, links, deletion and Undo', () => {
  it('the markers on the Task row are how Bills finds its Tasks; the `about` link is only a pointer for other screens and the delete guard', async () => {
    const d = fresh();
    const { id } = await mk(d);
    const t = (await open(d))[0];
    expect(markersOf(t)!.obligation).toBe(id);
    const links = (await d.links.toArray()).filter((l) => l.deletedAt == null && l.fromModule === 'tasks');
    expect(links).toHaveLength(1);
    expect([links[0].fromId, links[0].toModule, links[0].toId, links[0].type]).toEqual([t.id, 'bills', `obligation:${id}`, 'about']);
    // remove the link row by hand: Bills still finds the Task (discovery is by marker, never by link)
    await d.links.put({ ...links[0], deletedAt: Date.now() });
    expect((await open(d)).map((x) => x.id)).toEqual([t.id]);
    await ensureBillTasks(id, TODAY, d);
    expect(await open(d)).toHaveLength(1); // not duplicated
  });
  it('a Task deleted by the owner leaves no ghost: the bill can be deleted again, and one fresh reminder is made when asked', async () => {
    const d = fresh();
    const { id } = await mk(d, { reminders: null });
    const o = (await getObligation(id, d))!;
    await saveReminders(id, { payTask: true, leadDays: 3, deadlineTasks: true }, o.updatedAt, TODAY, d);
    const t = (await open(d))[0];
    expect((await planDelete(id, d)).allowed).toBe(false); // a live reminder Task is linked
    const row = (await d.moduleRecords.get(t.id))!;
    await d.moduleRecords.put({ ...row, deletedAt: Date.now(), updatedAt: Date.now() }); // the owner deletes it in Tasks
    const plan = await planDelete(id, d);
    expect(plan.reasons.join(' ')).not.toMatch(/reminder Task/); // the link row remains, but its Task is gone
    expect(plan.allowed).toBe(true);
    await ensureBillTasks(id, TODAY, d);
    expect(await open(d)).toHaveLength(1);
    expect((await open(d))[0].id).not.toBe(t.id);
  });
  it('a Task edited independently keeps its markers and association; a bill deleted while its Task exists is refused', async () => {
    const d = fresh();
    const { id } = await mk(d);
    const t = (await open(d))[0];
    await saveTask(t.id, { ...t.data, title: 'Renamed', priority: 'high' }, d);
    expect(markersOf((await open(d))[0])).toMatchObject({ obligation: id, purpose: 'pay' });
    expect((await planDelete(id, d)).allowed).toBe(false);
  });
});

describe('B2 the "no deadline reminders" choice survives an older build editing the bill', () => {
  /** What the deployed B1 build does to a stored bill on any edit: it reads `reminders` as exactly {payTask, leadDays} and keeps every other top-level field it does not know (B1 model.ts, the `extras` carry-through). */
  const olderBuildEdit = (data: Record<string, unknown>) => {
    const { reminders, ...rest } = data as { reminders?: { payTask?: unknown; leadDays?: unknown } } & Record<string, unknown>;
    return { ...rest, ...(reminders && typeof reminders.payTask === 'boolean' && Number.isInteger(reminders.leadDays) ? { reminders: { payTask: reminders.payTask, leadDays: reminders.leadDays } } : {}) };
  };
  it('the choice is stored as a top-level field an older build keeps, so an edit there cannot switch deadline Tasks back on', async () => {
    const d = fresh();
    const { id } = await mk(d, { reminders: null, payment: { how: 'auto', fundingAccountId: null } });
    const o = (await getObligation(id, d))!;
    await saveReminders(id, { payTask: false, leadDays: 3, deadlineTasks: false }, o.updatedAt, TODAY, d);
    const stored = (await d.moduleRecords.get(id))!.data as Record<string, unknown>;
    expect(stored.noDeadlineTasks).toBe(true);
    expect((stored.reminders as Record<string, unknown>).deadlineTasks).toBeUndefined();
    await d.moduleRecords.put({ ...(await d.moduleRecords.get(id))!, data: olderBuildEdit(stored) as never, updatedAt: Date.now() + 2 });
    const after = (await getObligation(id, d))!;
    expect(after.data.noDeadlineTasks).toBe(true);
    const o2 = (await getObligation(id, d))!;
    await saveTerms(id, { ...blankTerms(), noticeByDate: '2026-12-20' }, o2.updatedAt, TODAY, d);
    expect(await loadTasks(d)).toHaveLength(0); // still no deadline Task
  });
});
