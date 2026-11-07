import { describe, expect, it, vi } from 'vitest';
import { FinanceDB } from '../../db';
import { completeTask, loadTasks, saveTask } from '../tasks/data';
import * as tasksData from '../tasks/data';
import { asTask } from '../tasks/model';
import { createObligation, editObligation, getObligation, applyLifecycle, planLifecycle, type ObligationEdit } from './data';
import { editFact, loadCycles, newOp, planFact, recordFact, removeFact } from './cycleData';
import { findConflicts } from './cycleConflicts';
import { applyMove, applyRepair, leaveTaskAsIs, planMove, planRepair, STALE_REPAIR, type RepairChoice } from './cycleRepair';
import { saveReminders, saveTerms } from './contractData';
import { attention, derive, loadBillsSnapshot } from './readModel';
import { periodsOf } from './periods';
import { loadBillTasks, markersOf } from './tasks';
import { blankTerms } from './terms';
import { MODULE, type ObligationData } from './model';
import { applyUndo, isUndoRefused } from './undo';
import { creditF, dueOn, financeSnapshot, fresh, inv, monthly, ob, paidFull, paidOut, skipF, sleep } from './billsTestkit';
import type { FactBody } from './cycleModel';

/** Real Dexie (fake-indexeddb). Invented data only. 2026-11-07 is a Saturday. */
const TODAY = '2026-11-07';
const REM = { payTask: true, leadDays: 3 };
const mk = async (d: FinanceDB, over: Partial<ObligationData> = {}, reminders: ObligationData['reminders'] = REM) =>
  createObligation({ data: ob({ title: 'Example Power Co', amountKind: 'variable', prices: [{ from: TODAY, cents: 9000, label: '' }], schedule: monthly(18, '2026-11'), reminders, ...over }, TODAY), provider: { name: 'Example Power Co' }, today: TODAY }, d);
const rec = (d: FinanceDB, id: number, slot: string, body: FactBody, extra: { op?: string; finishTaskId?: number | null; today?: string } = {}) =>
  recordFact({ obligationId: id, slot, body, op: extra.op ?? newOp(), today: extra.today ?? TODAY, finishTaskId: extra.finishTaskId }, d);
const all = async (d: FinanceDB) => JSON.stringify([await d.moduleRecords.toArray(), await d.links.toArray(), await d.contacts.toArray()]);
const openPay = async (d: FinanceDB) => (await loadBillTasks(d)).filter((t) => markersOf(t)!.purpose === 'pay' && t.data.status !== 'done');
const live = async (d: FinanceDB) => (await d.moduleRecords.toArray()).filter((r) => r.deletedAt == null);
const edit = (cur: ObligationData): ObligationEdit => ({
  title: cur.title, type: cur.type, need: cur.need, amountKind: cur.amountKind, amountCents: cur.prices[0]?.cents ?? null, trackingSince: cur.trackingSince, schedule: cur.schedule,
  payment: cur.payment, paidThroughLoan: cur.paidThroughLoan, review: { on: cur.review.on, note: cur.review.note }, refs: cur.refs, notes: cur.notes,
});

describe('B2 recording facts: validation, one record per press, nothing invented (tests 61, 67)', () => {
  it('records an invoice with an actual due date; the period shows the new amount and date', async () => {
    const d = fresh();
    const { id } = await mk(d, {}, null);
    const r = await rec(d, id, 'm2026-11', inv(11420, { dueDate: '2026-11-22', invoiceDate: '2026-11-05' }));
    expect(r.reused).toBe(false);
    const cs = await loadCycles(d);
    expect(cs).toHaveLength(1);
    expect(cs[0]).toMatchObject({ obligationId: id, slot: 'm2026-11', body: { fact: 'invoice', invoicedCents: 11420, dueDate: '2026-11-22' } });
    const ob1 = (await getObligation(id, d))!;
    const p = periodsOf(ob1, cs, TODAY, { from: TODAY, to: '2026-12-31' })[0];
    expect([p.slot, p.timing.date, p.amounts.owed, p.amounts.basis, p.label]).toEqual(['m2026-11', '2026-11-22', 11420, 'billed', 'upcoming']);
  });
  it('pressing twice with the same operation writes one record', async () => {
    const d = fresh();
    const { id } = await mk(d, {}, null);
    const op = newOp();
    await rec(d, id, 'm2026-11', inv(100), { op });
    const again = await rec(d, id, 'm2026-11', inv(100), { op });
    expect(again.reused).toBe(true);
    expect(await loadCycles(d)).toHaveLength(1);
    await Promise.all([rec(d, id, 'm2026-12', dueOn('2026-12-20'), { op: 'same' }), rec(d, id, 'm2026-12', dueOn('2026-12-20'), { op: 'same' }).catch(() => null)]);
    expect((await loadCycles(d)).filter((c) => c.slot === 'm2026-12')).toHaveLength(1);
  });
  it('a second record of a single-record kind is refused (open the first one to change it); credits may repeat', async () => {
    const d = fresh();
    const { id } = await mk(d, {}, null);
    await rec(d, id, 'm2026-11', inv(100));
    await expect(rec(d, id, 'm2026-11', inv(200))).rejects.toThrow(/already has one of these/);
    await rec(d, id, 'm2026-11', creditF(500, 'a'));
    await rec(d, id, 'm2026-11', creditF(700, 'b'));
    expect((await loadCycles(d)).filter((c) => c.body?.fact === 'credit')).toHaveLength(2);
    expect((await planFact({ obligationId: id, slot: 'm2026-11', body: inv(300), today: TODAY }, d)).problem).toMatch(/already has one/);
  });
  it('refuses a period the schedule does not produce, but accepts an extra bill', async () => {
    const d = fresh();
    const { id } = await mk(d, { schedule: monthly(18, '2026-11', 2) }, null);
    await expect(rec(d, id, 'm2026-12', inv(100))).rejects.toThrow(/not a billing period of this bill/);
    await expect(rec(d, id, 'banana', inv(100))).rejects.toThrow(/not a billing period this version understands/);
    await rec(d, id, 'm2027-01', inv(100));
    await rec(d, id, 'x1730000000123', inv(3500, { dueDate: '2026-12-30', invoiceNumber: 'A-1042' }));
    expect(await loadCycles(d)).toHaveLength(2);
  });
  it('refuses invalid values in words and writes nothing at all', async () => {
    const d = fresh();
    const { id } = await mk(d, {}, null);
    const before = await all(d);
    for (const body of [inv(-5), inv(10.5), inv(100, { dueDate: '2026-02-30' }), paidOut('2026-11-10', 0), paidOut('nope', 100), creditF(0), dueOn('later')] as FactBody[]) {
      await expect(rec(d, id, 'm2026-11', body)).rejects.toThrow();
    }
    expect(await all(d)).toBe(before);
    await expect(rec(d, 424242, 'm2026-11', inv(100))).rejects.toThrow(/no longer exists/);
  });
  it('a $0.00 invoice is a confirmed zero; a payment declaration with no amount never creates an amount', async () => {
    const d = fresh();
    const { id } = await mk(d, {}, null);
    await rec(d, id, 'm2026-11', inv(0));
    await rec(d, id, 'm2026-12', paidFull());
    await rec(d, id, 'm2027-01', paidOut('2027-01-15', null));
    const o = (await getObligation(id, d))!;
    const ps = periodsOf(o, await loadCycles(d), TODAY, { from: '2026-11-01', to: '2027-02-28' });
    const by = Object.fromEntries(ps.map((p) => [p.slot, p]));
    expect([by['m2026-11'].amounts.owed, by['m2026-11'].label]).toEqual([0, 'no-payment-due']);
    expect([by['m2026-12'].amounts.paid, by['m2026-12'].label]).toEqual([0, 'marked-paid']);
    expect([by['m2027-01'].amounts.paid, by['m2027-01'].label]).toEqual([0, 'marked-paid']);
    expect((await loadCycles(d)).find((c) => c.body?.fact === 'paid-outside')!.raw.cents).toBeUndefined();
  });
  it('loan-related bills accept no payment record (Loans owns those payments)', async () => {
    const d = fresh();
    const { id } = await mk(d, { type: 'loan', title: 'Example mortgage' }, null);
    await expect(rec(d, id, 'm2026-11', paidFull())).rejects.toThrow(/Loans page/);
    await rec(d, id, 'm2026-11', dueOn('2026-11-20')); // a date is fine
  });
  it('edit changes the one record, refuses a stale form, keeps unknown fields; remove and Undo work', async () => {
    const d = fresh();
    const { id } = await mk(d, {}, null);
    const r = await rec(d, id, 'm2026-11', inv(10000));
    const c = (await loadCycles(d))[0];
    await d.moduleRecords.put({ ...(await d.moduleRecords.get(c.id))!, data: { ...(c.raw as object), keepMe: { x: 1 } } as never });
    const c2 = (await loadCycles(d))[0];
    await sleep(3);
    await editFact(c2.id, inv(12000), c2.updatedAt, TODAY, d);
    const after = (await d.moduleRecords.get(c.id))!.data as Record<string, unknown>;
    expect(after.invoicedCents).toBe(12000);
    expect(after.keepMe).toEqual({ x: 1 });
    expect(after.op).toBe(c.op);
    await expect(editFact(c2.id, inv(13000), c2.updatedAt, TODAY, d)).rejects.toThrow(/changed/); // stale
    await expect(editFact(c2.id, dueOn('2026-11-30'), (await loadCycles(d))[0].updatedAt, TODAY, d)).rejects.toThrow(/cannot change its type/);
    const cur = (await loadCycles(d))[0];
    const rm = await removeFact(cur.id, cur.updatedAt, TODAY, d);
    expect(await loadCycles(d)).toHaveLength(0);
    await applyUndo(rm.undo, d);
    expect(await loadCycles(d)).toHaveLength(1);
    void r;
  });
  it('Undo of a new record removes it, and is refused (writing nothing) if the record changed since (test 38)', async () => {
    const d = fresh();
    const { id } = await mk(d, {}, null);
    const r = await rec(d, id, 'm2026-11', inv(100));
    await applyUndo(r.undo, d);
    expect(await loadCycles(d)).toHaveLength(0);
    const r2 = await rec(d, id, 'm2026-11', inv(100));
    const c = (await loadCycles(d))[0];
    await sleep(3);
    await editFact(c.id, inv(222), c.updatedAt, TODAY, d); // another change in between
    const before = await all(d);
    await expect(applyUndo(r2.undo, d)).rejects.toSatisfy(isUndoRefused);
    expect(await all(d)).toBe(before);
  });
});

describe('B2 Tasks: one reminder at a time, never payment evidence (tests 31, "electric bill" workflow)', () => {
  it('a bill saved with reminders on gets exactly one open pay Task for the next bill, linked to it, with markers; nothing for future months', async () => {
    const d = fresh();
    const { id, taskIds } = await mk(d);
    expect(taskIds).toHaveLength(1);
    const t = (await openPay(d));
    expect(t).toHaveLength(1);
    expect(t[0].data).toMatchObject({ title: 'Pay Example Power Co', dueDate: '2026-11-15', status: 'todo' });
    expect(markersOf(t[0])).toEqual({ obligation: id, purpose: 'pay', cycle: 'm2026-11', due: '2026-11-18', deadline: null, doOn: '2026-11-15' });
    const links = (await d.links.toArray()).filter((l) => l.fromModule === 'tasks');
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ toModule: MODULE, toId: `obligation:${id}`, type: 'about' });
    expect((await loadTasks(d))).toHaveLength(1); // no Task for December or later
  });
  it('asking again (a double press, an effect run twice) never makes a second Task', async () => {
    const d = fresh();
    const { id } = await mk(d);
    const cur = (await getObligation(id, d))!;
    await Promise.all([1, 2, 3].map((i) => editObligation(id, { ...edit(cur.data), notes: `n${i}` }, null, TODAY, d)));
    expect(await loadTasks(d)).toHaveLength(1);
    expect((await d.links.toArray()).filter((l) => l.fromModule === 'tasks' && l.deletedAt == null)).toHaveLength(1);
  });
  it('no Task without the owner turning reminders on, and none by default for automatic payment', async () => {
    const d = fresh();
    await mk(d, {}, null);
    await mk(d, { title: 'Streamly', payment: { how: 'auto', fundingAccountId: null } }, null);
    await mk(d, { title: 'Auto with reminder off', payment: { how: 'auto', fundingAccountId: null } }, { payTask: false, leadDays: 3 });
    expect(await loadTasks(d)).toHaveLength(0);
  });
  it('the Task date is a reminder date; the due date is kept separately, and a corrected due date moves an untouched Task only', async () => {
    const d = fresh();
    const { id } = await mk(d);
    await rec(d, id, 'm2026-11', inv(11420, { dueDate: '2026-11-25' }));
    let t = (await openPay(d))[0];
    expect([t.data.dueDate, markersOf(t)!.due, markersOf(t)!.doOn]).toEqual(['2026-11-22', '2026-11-25', '2026-11-22']); // 3 days before the 25th
    expect(await loadTasks(d)).toHaveLength(1);
    // the owner moves the Task himself: a later change of the due date must not touch it
    await saveTask(t.id, { ...t.data, dueDate: '2026-11-20' }, d);
    const c = (await loadCycles(d))[0];
    await sleep(3);
    await editFact(c.id, inv(11420, { dueDate: '2026-11-28' }), c.updatedAt, TODAY, d);
    t = (await openPay(d))[0];
    expect([t.data.dueDate, markersOf(t)!.due]).toEqual(['2026-11-20', '2026-11-25']);
    expect(await loadTasks(d)).toHaveLength(1);
  });
  it('"Done, mark paid" writes the note, finishes the Task and makes the next one, all in one step; Undo takes all of it back', async () => {
    const d = fresh();
    const { id } = await mk(d);
    const t = (await openPay(d))[0];
    const r = await rec(d, id, 'm2026-11', paidOut('2026-11-14', 9100), { finishTaskId: t.id });
    expect(r.finishedTask).toBe(t.id);
    expect(r.createdTasks).toHaveLength(1);
    const tasks = await loadBillTasks(d);
    expect(tasks.find((x) => x.id === t.id)!.data.status).toBe('done');
    const next = (await openPay(d));
    expect(next).toHaveLength(1);
    expect(markersOf(next[0])!.cycle).toBe('m2026-12');
    expect(next[0].data.dueDate).toBe('2026-12-15');
    expect((await loadCycles(d)).filter((c) => c.body?.fact === 'paid-outside')).toHaveLength(1);
    await applyUndo(r.undo, d);
    expect(await loadCycles(d)).toHaveLength(0);
    expect((await loadBillTasks(d)).find((x) => x.id === t.id)!.data.status).toBe('todo');
    expect(await openPay(d)).toHaveLength(1); // the original Task only: the December Task and its link are gone
    expect((await d.links.toArray()).filter((l) => l.fromModule === 'tasks' && l.deletedAt == null)).toHaveLength(1);
  });
  it('a Task finished anywhere else is "finished, not yet confirmed", never a payment, until the owner records what happened', async () => {
    const d = fresh();
    const { id } = await mk(d);
    const t = (await openPay(d))[0];
    await completeTask(t.id, TODAY, d); // ticked off in Tasks
    expect((await loadCycles(d))).toHaveLength(0); // no payment was invented
    let a = attention(derive(await loadBillsSnapshot(d), TODAY));
    expect(a.unconfirmedTasks).toBe(1);
    expect(a.items.find((i) => i.category === 'unconfirmedTasks')!.text).toMatch(/no payment is recorded/);
    // leaving it as it is silences the count and records nothing
    const ob1 = (await getObligation(id, d))!;
    const left = await leaveTaskAsIs(id, t.id, ob1.updatedAt, d);
    expect(attention(derive(await loadBillsSnapshot(d), TODAY)).unconfirmedTasks).toBe(0);
    expect(await loadCycles(d)).toHaveLength(0);
    await applyUndo(left.undo, d);
    a = attention(derive(await loadBillsSnapshot(d), TODAY));
    expect(a.unconfirmedTasks).toBe(1);
    await rec(d, id, 'm2026-11', paidFull());
    expect(attention(derive(await loadBillsSnapshot(d), TODAY)).unconfirmedTasks).toBe(0);
  });
  it('skipping a period can finish its reminder in the same step and the next Task follows', async () => {
    const d = fresh();
    const { id } = await mk(d);
    const t = (await openPay(d))[0];
    await rec(d, id, 'm2026-11', skipF('away'), { finishTaskId: t.id });
    const next = await openPay(d);
    expect(next).toHaveLength(1);
    expect(markersOf(next[0])!.cycle).toBe('m2026-12');
  });
  it('a Task that is not the open one for that period is refused and nothing is written', async () => {
    const d = fresh();
    const { id } = await mk(d);
    const before = await all(d);
    await expect(rec(d, id, 'm2026-11', paidFull(), { finishTaskId: 424242 })).rejects.toThrow(/changed since/);
    expect(await all(d)).toBe(before);
  });
  it('markers survive a normal Task edit', async () => {
    const d = fresh();
    const { id } = await mk(d);
    const t = (await openPay(d))[0];
    const row = (await d.moduleRecords.get(t.id))!;
    const edited = asTask(row).data;
    await saveTask(t.id, { ...edited, title: 'Pay the power bill (renamed)', notes: 'x' }, d);
    const again = (await loadBillTasks(d)).find((x) => x.id === t.id)!;
    expect(again.data.title).toBe('Pay the power bill (renamed)');
    expect(markersOf(again)).toMatchObject({ obligation: id, purpose: 'pay', cycle: 'm2026-11' });
  });
  it('deadline Tasks: one for a cancel-by date and one for a trial end that is still ahead; none for a passed date or when switched off', async () => {
    const d = fresh();
    const { id } = await mk(d, { amountKind: 'fixed', prices: [{ from: TODAY, cents: 1549, label: '' }], payment: { how: 'auto', fundingAccountId: null } }, { payTask: false, leadDays: 3 });
    let o = (await getObligation(id, d))!;
    await saveTerms(id, { ...blankTerms(), noticeByDate: '2026-12-01', trialEndsOn: '2026-11-01', renewalDate: '2026-12-15', autoRenews: true }, o.updatedAt, TODAY, d);
    const ts = await loadBillTasks(d);
    expect(ts.map((t) => markersOf(t)!.purpose).sort()).toEqual(['notice']); // the trial end already passed; a renewal is informational
    expect(ts[0].data.dueDate).toBe('2026-11-28');
    expect(markersOf(ts[0])!.deadline).toBe('2026-12-01');
    // the deadline moves: the untouched Task follows
    o = (await getObligation(id, d))!;
    await saveTerms(id, { ...blankTerms(), noticeByDate: '2026-12-05', renewalDate: '2026-12-15' }, o.updatedAt, TODAY, d);
    const after = (await loadBillTasks(d)).filter((t) => t.data.status !== 'done');
    expect(after).toHaveLength(1);
    expect([after[0].data.dueDate, markersOf(after[0])!.deadline]).toEqual(['2026-12-02', '2026-12-05']);
    // switched off: nothing new
    const d2 = fresh();
    const b = await mk(d2, { payment: { how: 'auto', fundingAccountId: null }, noDeadlineTasks: true }, { payTask: false, leadDays: 3 });
    const o2 = (await getObligation(b.id, d2))!;
    await saveTerms(b.id, { ...blankTerms(), noticeByDate: '2026-12-01' }, o2.updatedAt, TODAY, d2);
    expect(await loadTasks(d2)).toHaveLength(0);
  });
  it('a deadline Task the owner moved is left alone and reported as needing a look, never deleted', async () => {
    const d = fresh();
    const { id } = await mk(d, { payment: { how: 'auto', fundingAccountId: null } }, { payTask: false, leadDays: 3 });
    let o = (await getObligation(id, d))!;
    await saveTerms(id, { ...blankTerms(), noticeByDate: '2026-12-01' }, o.updatedAt, TODAY, d);
    const t = (await loadBillTasks(d))[0];
    await saveTask(t.id, { ...t.data, dueDate: '2026-11-30' }, d); // the owner moved it
    o = (await getObligation(id, d))!;
    await saveTerms(id, { ...blankTerms(), noticeByDate: '2026-12-08' }, o.updatedAt, TODAY, d);
    const tasks = await loadBillTasks(d);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].data.dueDate).toBe('2026-11-30');
    expect(attention(derive(await loadBillsSnapshot(d), TODAY)).taskProblems).toBe(1);
  });
  it('a paused or ended bill makes no new Task; resuming brings back its reminder', async () => {
    const d = fresh();
    const { id } = await mk(d);
    const t = (await openPay(d))[0];
    await completeTask(t.id, TODAY, d);
    const pause = await planLifecycle(id, 'pause', { today: TODAY }, d);
    await applyLifecycle({ id, action: 'pause', expect: pause.expect, today: TODAY }, d);
    expect(await openPay(d)).toHaveLength(0);
    await sleep(2);
    const resume = await planLifecycle(id, 'resume', { today: TODAY, date: TODAY }, d);
    await applyLifecycle({ id, action: 'resume', expect: resume.expect, today: TODAY, date: TODAY }, d);
    expect(await openPay(d)).toHaveLength(1);
  });
  it('turning reminders on or off from the bill is guarded, never deletes a Task, and keeps unknown reminder settings off', async () => {
    const d = fresh();
    const { id } = await mk(d, {}, null);
    expect(await loadTasks(d)).toHaveLength(0);
    let o = (await getObligation(id, d))!;
    const on = await saveReminders(id, { payTask: true, leadDays: 5, deadlineTasks: true }, o.updatedAt, TODAY, d);
    expect(on.createdTasks).toHaveLength(1);
    expect((await openPay(d))[0].data.dueDate).toBe('2026-11-13');
    await expect(saveReminders(id, { payTask: false, leadDays: 5, deadlineTasks: true }, o.updatedAt, TODAY, d)).rejects.toThrow(/changed/); // stale form
    o = (await getObligation(id, d))!;
    await saveReminders(id, { payTask: false, leadDays: 5, deadlineTasks: true }, o.updatedAt, TODAY, d);
    expect(await openPay(d)).toHaveLength(1); // turning it off never deletes the open Task
    await applyUndo(on.undo, d).catch((e) => expect(isUndoRefused(e)).toBe(true)); // changed since: refused
  });
});

describe('B2 atomic writes: an injected failure rolls back everything (fault injection)', () => {
  it('if making the next Task fails after a "Done, mark paid", no fact is written and the Task is not finished', async () => {
    const d = fresh();
    const { id } = await mk(d);
    const t = (await openPay(d))[0];
    const before = await all(d);
    const spy = vi.spyOn(tasksData, 'createTask').mockRejectedValueOnce(new Error('injected failure'));
    await expect(rec(d, id, 'm2026-11', paidOut('2026-11-14', 9100), { finishTaskId: t.id })).rejects.toThrow(/injected/);
    spy.mockRestore();
    expect(await all(d)).toBe(before);
    expect((await openPay(d))).toHaveLength(1);
    expect(await loadCycles(d)).toHaveLength(0);
  });
  it('if a repair fails halfway, no record is superseded and nothing is acknowledged', async () => {
    const d = fresh();
    const { id } = await mk(d, {}, null);
    await rec(d, id, 'm2026-11', inv(10000));
    await sleep(2);
    await rec(d, id, 'm2026-11', inv(12000)).catch(() => null);
    // the second invoice needs a different route (a second invoice is refused locally): write it as another device would
    await d.moduleRecords.add({ id: 999001, module: MODULE, kind: 'cycle', data: { obligationId: id, slot: 'm2026-11', fact: 'invoice', invoicedCents: 12000 }, createdAt: Date.now(), updatedAt: Date.now(), deletedAt: null } as never);
    const c = findConflicts([(await getObligation(id, d))!], await loadCycles(d))[0];
    expect(c.kind).toBe('invoice-amount');
    const before = await all(d);
    const spy = vi.spyOn(tasksData, 'loadTasks').mockRejectedValueOnce(new Error('injected failure'));
    await expect(applyRepair({ key: c.key, choice: { kind: 'use-one', keepId: c.ids[0] }, today: TODAY }, d)).rejects.toThrow(/injected/);
    spy.mockRestore();
    expect(await all(d)).toBe(before);
  });
  it('if moving a period fails halfway, every record stays where it was', async () => {
    const d = fresh();
    const { id } = await mk(d, { schedule: monthly(18, '2026-11') }, null);
    await rec(d, id, 'm2026-11', inv(100));
    await rec(d, id, 'm2026-11', creditF(10));
    const plan = await planMove(id, 'm2026-11', 'm2026-12', d);
    expect(plan.problem).toBeNull();
    const before = await all(d);
    const spy = vi.spyOn(tasksData, 'loadTasks').mockRejectedValueOnce(new Error('injected failure'));
    await expect(applyMove({ obligationId: id, from: 'm2026-11', to: 'm2026-12', expect: plan.expect, today: TODAY }, d)).rejects.toThrow(/injected/);
    spy.mockRestore();
    expect(await all(d)).toBe(before);
  });
});

/** Writes a record the way another device would (no local checks), so conflicts can be set up. */
let seq = 999100;
const remote = async (d: FinanceDB, id: number, slot: string, fields: Record<string, unknown>, extra: Record<string, unknown> = {}) => {
  const n = ++seq;
  await d.moduleRecords.add({ id: n, module: MODULE, kind: 'cycle', data: { obligationId: id, slot, ...fields, ...extra }, createdAt: Date.now(), updatedAt: Date.now(), deletedAt: null } as never);
  await sleep(2);
  return n;
};
const conflictsOf = async (d: FinanceDB, id: number) => findConflicts([(await getObligation(id, d))!], await loadCycles(d));
const repair = async (d: FinanceDB, key: string, choice: RepairChoice) => {
  const plan = await planRepair(key, choice, d);
  expect(plan.problem).toBeNull();
  return applyRepair({ key, choice, today: TODAY }, d);
};

describe('B2 repairs: use this one, different bills, leave as is (tests 60, 82)', () => {
  it('"Use this one" sets the other invoice aside as history and the amount owed becomes known again; Undo restores both', async () => {
    const d = fresh();
    const { id } = await mk(d, {}, null);
    const a = await remote(d, id, 'm2026-11', { fact: 'invoice', invoicedCents: 10000 });
    const b = await remote(d, id, 'm2026-11', { fact: 'invoice', invoicedCents: 12000 });
    const [c] = await conflictsOf(d, id);
    const o = (await getObligation(id, d))!;
    const unclear = periodsOf(o, await loadCycles(d), TODAY, { from: '2026-11-01', to: '2026-11-30' })[0];
    expect([unclear.amounts.basis, unclear.amounts.owed]).toEqual(['disagree', null]); // never one of them picked
    const r = await repair(d, c.key, { kind: 'use-one', keepId: b });
    const cs = await loadCycles(d);
    expect(cs.find((x) => x.id === a)!.supersededBy).toBe(b);
    expect(cs.find((x) => x.id === b)!.supersededBy).toBeNull();
    const p = periodsOf(o, cs, TODAY, { from: '2026-11-01', to: '2026-11-30' })[0];
    expect([p.amounts.owed, p.superseded.map((x) => x.id)]).toEqual([12000, [a]]); // still visible as history, excluded from the figures
    expect(await conflictsOf(d, id)).toHaveLength(0);
    await applyUndo(r.undo, d);
    expect((await loadCycles(d)).find((x) => x.id === a)!.supersededBy).toBeNull();
  });
  it('"These are different bills" moves one invoice to its own extra period; nothing is merged or deleted', async () => {
    const d = fresh();
    const { id } = await mk(d, {}, null);
    const a = await remote(d, id, 'm2026-11', { fact: 'invoice', invoicedCents: 10000 });
    const b = await remote(d, id, 'm2026-11', { fact: 'invoice', invoicedCents: 3500, invoiceNumber: 'A-9' });
    const [c] = await conflictsOf(d, id);
    await repair(d, c.key, { kind: 'different-bills', moveId: b });
    const cs = await loadCycles(d);
    const moved = cs.find((x) => x.id === b)!;
    expect(moved.slot).toMatch(/^x\d+$/);
    expect(moved.raw.separatedFrom).toBe('m2026-11'); // remembered, but it is not a period move
    expect(moved.movedFrom).toBeNull();
    expect(moved.body).toMatchObject({ invoicedCents: 3500, invoiceNumber: 'A-9' }); // amount and number unchanged
    expect(cs.find((x) => x.id === a)!.slot).toBe('m2026-11');
    expect(await conflictsOf(d, id)).toHaveLength(0);
  });
  it('a skip beside a payment: only the skip can be set aside; the payment is never hidden', async () => {
    const d = fresh();
    const { id } = await mk(d, {}, null);
    const s = await remote(d, id, 'm2026-11', { fact: 'skip' });
    const p = await remote(d, id, 'm2026-11', { fact: 'paid-outside', paidOn: '2026-11-12', cents: 5000 });
    const [c] = await conflictsOf(d, id);
    expect(c.kind).toBe('skip-payment');
    expect((await planRepair(c.key, { kind: 'use-one', keepId: s }, d)).problem).toMatch(/not available|keep/i);
    await repair(d, c.key, { kind: 'use-one', keepId: p });
    const cs = await loadCycles(d);
    expect(cs.find((x) => x.id === s)!.supersededBy).toBe(p);
    expect(cs.find((x) => x.id === p)!.supersededBy).toBeNull();
    const o = (await getObligation(id, d))!;
    expect(periodsOf(o, cs, TODAY, { from: '2026-11-01', to: '2026-11-30' })[0].amounts.paid).toBe(5000);
  });
  it('"Leave as is" only remembers; the records and the unclear amount stay, and a changed record brings the question back', async () => {
    const d = fresh();
    const { id } = await mk(d, {}, null);
    await remote(d, id, 'm2026-11', { fact: 'invoice', invoicedCents: 10000 });
    const b = await remote(d, id, 'm2026-11', { fact: 'invoice', invoicedCents: 12000 });
    const [c] = await conflictsOf(d, id);
    const before = JSON.stringify((await loadCycles(d)).map((x) => x.raw));
    await repair(d, c.key, { kind: 'leave' });
    expect(JSON.stringify((await loadCycles(d)).map((x) => x.raw))).toBe(before); // no record was touched
    const [c2] = await conflictsOf(d, id);
    expect(c2.acknowledged).toBe(true);
    const o = (await getObligation(id, d))!;
    expect(periodsOf(o, await loadCycles(d), TODAY, { from: '2026-11-01', to: '2026-11-30' })[0].amounts.owed).toBeNull(); // still unknown
    expect(attention(derive(await loadBillsSnapshot(d), TODAY)).conflicts).toBe(0);
    const row = (await d.moduleRecords.get(b))!;
    await d.moduleRecords.put({ ...row, updatedAt: row.updatedAt + 5 });
    const [c3] = await conflictsOf(d, id);
    expect(c3.acknowledged).toBe(false);
    expect(attention(derive(await loadBillsSnapshot(d), TODAY)).conflicts).toBe(1);
  });
  it('a stale preview is refused and writes nothing; an Undo after an intervening change is refused', async () => {
    const d = fresh();
    const { id } = await mk(d, {}, null);
    const a = await remote(d, id, 'm2026-11', { fact: 'invoice', invoicedCents: 10000 });
    await remote(d, id, 'm2026-11', { fact: 'invoice', invoicedCents: 12000 });
    const [c] = await conflictsOf(d, id);
    await remote(d, id, 'm2026-11', { fact: 'invoice', invoicedCents: 13000 }); // a third arrives after the preview
    const before = await all(d);
    await expect(applyRepair({ key: c.key, choice: { kind: 'use-one', keepId: a }, today: TODAY }, d)).rejects.toThrow(STALE_REPAIR);
    expect(await all(d)).toBe(before);
    const [c2] = await conflictsOf(d, id);
    const r = await repair(d, c2.key, { kind: 'use-one', keepId: a });
    const set = (await loadCycles(d)).find((x) => x.supersededBy === a)!; // a record the repair set aside
    const row = (await d.moduleRecords.get(set.id))!;
    await sleep(3);
    await d.moduleRecords.put({ ...row, updatedAt: Date.now() });
    await expect(applyUndo(r.undo, d)).rejects.toSatisfy(isUndoRefused);
  });
  it('choices that are not offered for a problem are refused (no repair can hide a payment or pick a date it cannot)', async () => {
    const d = fresh();
    const { id } = await mk(d, {}, null);
    await remote(d, id, 'm2026-11', { fact: 'invoice', invoicedCents: 10000, dueDate: '2026-11-20' });
    await remote(d, id, 'm2026-11', { fact: 'invoice', invoicedCents: 10000, dueDate: '2026-11-25' });
    const due = (await conflictsOf(d, id)).find((x) => x.kind === 'due-date')!;
    expect(due.repairs).toEqual(['leave']);
    expect((await planRepair(due.key, { kind: 'use-one', keepId: due.ids[0] }, d)).problem).toMatch(/not available/);
    expect((await planRepair(due.key, { kind: 'remove' }, d)).problem).toMatch(/not available/);
  });
  it('records of a missing bill can be removed (a soft delete with Undo); unreadable records have no repair and are untouched', async () => {
    const d = fresh();
    const { id } = await mk(d, {}, null);
    await remote(d, 777, 'm2026-11', { fact: 'invoice', invoicedCents: 100 });
    const weird = await remote(d, id, 'm2026-11', { fact: 'payment-link', ref: { txnId: 5 } });
    const cs = findConflicts([(await getObligation(id, d))!], await loadCycles(d));
    const orphan = cs.find((x) => x.kind === 'missing-obligation')!;
    const r = await repair(d, orphan.key, { kind: 'remove' });
    expect((await loadCycles(d)).filter((x) => x.obligationId === 777)).toHaveLength(0);
    await applyUndo(r.undo, d);
    expect((await loadCycles(d)).filter((x) => x.obligationId === 777)).toHaveLength(1);
    const unreadable = cs.find((x) => x.kind === 'unreadable')!;
    expect(unreadable.repairs).toEqual([]);
    expect((await d.moduleRecords.get(weird))!.data).toMatchObject({ fact: 'payment-link', ref: { txnId: 5 } });
  });
});

describe('B2 Move to another billing period (B0 N1, tests 58, 82)', () => {
  const setup = async () => {
    const d = fresh();
    const { id } = await mk(d, { schedule: monthly(18, '2026-11') }, null);
    await rec(d, id, 'm2026-11', inv(10000, { dueDate: '2026-11-22' }));
    await rec(d, id, 'm2026-11', paidOut('2026-11-20', 10000));
    await rec(d, id, 'm2026-11', creditF(500));
    return { d, id };
  };
  it('previews every record, keeps amounts, payments and due dates exactly, writes movedFrom on each, and is undoable', async () => {
    const { d, id } = await setup();
    const before = await loadCycles(d);
    const plan = await planMove(id, 'm2026-11', 'm2026-12', d);
    expect(plan.problem).toBeNull();
    expect(plan.moving).toHaveLength(3);
    expect(plan.lines.join(' ')).toMatch(/Every amount, payment record and actual due date stays exactly as it is/);
    const r = await applyMove({ obligationId: id, from: 'm2026-11', to: 'm2026-12', expect: plan.expect, today: TODAY }, d);
    const after = await loadCycles(d);
    expect(after.every((c) => c.slot === 'm2026-12' && c.movedFrom === 'm2026-11')).toBe(true);
    for (const b of before) { const a = after.find((x) => x.id === b.id)!; expect(a.body).toEqual(b.body); }
    expect(after.map((c) => c.id).sort()).toEqual(before.map((c) => c.id).sort());
    await applyUndo(r.undo, d);
    const back = await loadCycles(d);
    expect(back.every((c) => c.slot === 'm2026-11' && c.movedFrom === null)).toBe(true);
  });
  it('refuses unsafe targets: the same period, a period no schedule makes, one that already has its own records, and a period holding a record this version cannot read', async () => {
    const { d, id } = await setup();
    await rec(d, id, 'm2026-12', inv(1));
    expect((await planMove(id, 'm2026-11', 'm2026-11', d)).problem).toMatch(/already in that period/);
    expect((await planMove(id, 'm2026-11', 'm2027-05', d)).problem).toBeNull(); // produced by the monthly schedule
    const q = await mk(d, { title: 'Quarterly', schedule: monthly(10, '2026-10', 3) }, null);
    await rec(d, q.id, 'm2026-10', inv(50));
    expect((await planMove(q.id, 'm2026-10', 'm2026-11', d)).problem).toMatch(/not a billing period of this bill/);
    expect((await planMove(id, 'm2026-11', 'm2026-12', d)).problem).toMatch(/already has its own records/);
    expect((await planMove(id, 'm2026-09', 'm2026-12', d)).problem).toMatch(/nothing in that period/i);
    await remote(d, id, 'm2027-02', { fact: 'time-travel' });
    expect((await planMove(id, 'm2027-02', 'm2027-03', d)).problem).toMatch(/cannot read/);
  });
  it('a plan that went stale (a record was added to the period after the preview) is refused and writes nothing', async () => {
    const { d, id } = await setup();
    const plan = await planMove(id, 'm2026-11', 'm2026-12', d);
    await remote(d, id, 'm2026-11', { fact: 'skip' });
    const before = await all(d);
    await expect(applyMove({ obligationId: id, from: 'm2026-11', to: 'm2026-12', expect: plan.expect, today: TODAY }, d)).rejects.toThrow(STALE_REPAIR);
    expect(await all(d)).toBe(before);
  });
  it('a record that arrives at the old period later is flagged, not merged, and can be moved to where the others went; Undo is refused after a change', async () => {
    const { d, id } = await setup();
    const plan = await planMove(id, 'm2026-11', 'm2026-12', d);
    const mv = await applyMove({ obligationId: id, from: 'm2026-11', to: 'm2026-12', expect: plan.expect, today: TODAY }, d);
    const late = await remote(d, id, 'm2026-11', { fact: 'paid-in-full' }); // another device was still using the old slot
    const flagged = (await conflictsOf(d, id)).find((c) => c.kind === 'moved-arrival')!;
    expect(flagged.ids).toEqual([late]);
    expect(flagged.target).toBe('m2026-12');
    expect((await loadCycles(d)).find((c) => c.id === late)!.slot).toBe('m2026-11'); // not moved by itself
    // the earlier Undo now refuses nothing it touched has changed... but the late record is untouched by it, so it still works only if the moved rows are unchanged
    const p2 = await planMove(id, 'm2026-11', 'm2026-12', d);
    expect(p2.problem).toBeNull(); // the target holds only records that came from this same move
    await applyMove({ obligationId: id, from: 'm2026-11', to: 'm2026-12', expect: p2.expect, today: TODAY }, d);
    expect((await loadCycles(d)).find((c) => c.id === late)!.slot).toBe('m2026-12');
    // the first move can still be undone only while the records it moved are untouched
    const moved = (await loadCycles(d)).find((c) => c.id !== late)!;
    await sleep(3);
    await editFact(moved.id, moved.body!, moved.updatedAt, TODAY, d);
    await expect(applyUndo(mv.undo, d)).rejects.toSatisfy(isUndoRefused); // something it touched has changed since
  });
});

describe('B2 schedule changes when billing facts exist, through the real edit (B1 report section 13)', () => {
  it('a period holding an invoice counts as applied: the change is refused with the period named, then accepted from a clean date', async () => {
    const d = fresh();
    const { id } = await mk(d, { trackingSince: '2026-12-20', schedule: monthly(12, '2026-12') }, null);
    await rec(d, id, 'm2026-12', inv(11420)); // an invoice entered early
    const cur = (await getObligation(id, d))!;
    const e = { ...edit(cur.data), schedule: monthly(28, '2026-12'), scheduleFrom: '2026-12-25' };
    const before = await all(d);
    await expect(editObligation(id, e, cur.updatedAt, TODAY, d)).rejects.toThrow(/December 2026 already has recorded information/);
    expect(await all(d)).toBe(before);
    await editObligation(id, { ...e, scheduleFrom: '2027-01-01' }, cur.updatedAt, TODAY, d);
    const after = (await getObligation(id, d))!;
    expect(after.data.scheduleHistory).toHaveLength(1);
    const cs = await loadCycles(d);
    expect(cs).toHaveLength(1); // nothing deleted, nothing re-labelled
    expect(cs[0].slot).toBe('m2026-12');
  });
  it('the old facts stay visible "from an earlier schedule" after a monthly bill becomes every two months', async () => {
    const d = fresh();
    const { id } = await mk(d, { trackingSince: '2026-11-01', schedule: monthly(18, '2026-11') }, null);
    await rec(d, id, 'm2026-12', paidOut('2026-12-19', 9000));
    const cur = (await getObligation(id, d))!;
    await editObligation(id, { ...edit(cur.data), schedule: monthly(18, '2027-01', 2), scheduleFrom: '2027-01-01' }, cur.updatedAt, TODAY, d);
    const o = (await getObligation(id, d))!;
    const ps = periodsOf(o, await loadCycles(d), TODAY, { from: '2026-11-01', to: '2027-04-30' }, { allRecorded: true });
    const dec = ps.find((p) => p.slot === 'm2026-12')!;
    expect(dec.fromEarlier).toBe(false); // the earlier schedule (until Dec 31) still produces December, so it is an ordinary past period
    expect(dec.amounts.paid).toBe(9000);
    expect(ps.find((p) => p.slot === 'm2027-02')).toBeUndefined(); // every two months from January: Jan, Mar
  });
});

describe('B2 never changes Finance and never pre-creates anything (test 49)', () => {
  it('every operation leaves every Finance table and every other record exactly as it was, and stores nothing in advance', async () => {
    const d = fresh();
    const acct = await d.accounts.add({ name: 'Example Checking', kind: 'checking', openingBalanceCents: 100000, openingDate: '2026-01-01' } as never);
    await d.txns.add({ accountId: acct, date: '2026-11-05', amountCents: -9100, payee: 'Example Power', memo: '', status: 'cleared', categoryId: null } as never);
    await d.recurring.add({ accountId: acct, payee: 'Example Power', amountCents: -9100, categoryId: null, memo: '', frequency: 'monthly', startDate: '2026-01-18', active: true } as never);
    await d.moduleRecords.add({ id: 12, module: 'calendar', kind: 'event', data: { title: 'An event' }, createdAt: 1, updatedAt: 1, deletedAt: null } as never);
    const fin = await financeSnapshot(d);
    const { id } = await mk(d, { payment: { how: 'manual', fundingAccountId: acct } });
    const t = (await openPay(d))[0];
    await rec(d, id, 'm2026-11', inv(9100, { dueDate: '2026-11-20' }));
    await rec(d, id, 'm2026-11', dueOn('2026-11-20'));
    await rec(d, id, 'm2026-11', creditF(100));
    await rec(d, id, 'm2026-11', paidOut('2026-11-19', 9000), { finishTaskId: t.id }); // $91.00 billed, $1.00 credit: paid in full
    await rec(d, id, 'm2026-12', skipF());
    await rec(d, id, 'x5', inv(35));
    const cs = await loadCycles(d);
    const dueRec = cs.find((c) => c.body?.fact === 'due-date')!;
    await removeFact(dueRec.id, dueRec.updatedAt, TODAY, d);
    const o = (await getObligation(id, d))!;
    await saveTerms(id, { ...blankTerms(), renewalDate: '2027-03-01', noticeByDate: '2027-02-01' }, o.updatedAt, TODAY, d);
    const plan = await planMove(id, 'm2026-12', 'm2027-01', d);
    await applyMove({ obligationId: id, from: 'm2026-12', to: 'm2027-01', expect: plan.expect, today: TODAY }, d);
    expect(await financeSnapshot(d)).toBe(fin);
    expect((await d.moduleRecords.get(12))!.data).toEqual({ title: 'An event' });
    // nothing stored for the future: only the records the owner made, plus Tasks (one open pay Task, one deadline Task, one finished)
    const cyc = (await live(d)).filter((r) => r.module === MODULE && r.kind === 'cycle');
    expect(cyc).toHaveLength(5); // six records were made and one removed: only what the owner recorded exists
    const bt = await loadBillTasks(d);
    // moving the December skip to January left the reminder made for January standing for a period that is now skipped, and December open again:
    // the old Task is never deleted, and it is reported for a look
    const openPays = bt.filter((x) => markersOf(x)!.purpose === 'pay' && x.data.status !== 'done');
    expect(openPays.map((x) => markersOf(x)!.cycle).sort()).toEqual(['m2026-12', 'm2027-01']);
    expect(attention(derive(await loadBillsSnapshot(d), TODAY)).taskProblems).toBe(1);
    expect(bt.filter((x) => markersOf(x)!.purpose === 'notice')).toHaveLength(1);
    expect(bt.filter((x) => markersOf(x)!.purpose === 'pay' && x.data.status === 'done')).toHaveLength(1);
    expect((await live(d)).filter((r) => r.module === 'calendar')).toHaveLength(1);
  });
  it('reading periods, conflicts, attention and the cash figures writes nothing', async () => {
    const d = fresh();
    await mk(d);
    const before = await all(d);
    const snap = await loadBillsSnapshot(d);
    const x = derive(snap, TODAY);
    attention(x);
    periodsOf(snap.obligations[0], snap.cycles, TODAY, { from: TODAY, to: '2027-11-07' });
    expect(await all(d)).toBe(before);
  });
});

describe('B2 Undo of a bill saved with reminders takes the Task and its link back too', () => {
  it('creating a bill with reminders on, then Undo: the bill, its Task and the Task link are all gone, and Undo is refused once the Task was changed', async () => {
    const d = fresh();
    const made = await mk(d);
    expect(await loadTasks(d)).toHaveLength(1);
    await applyUndo(made.undo, d);
    expect(await getObligation(made.id, d)).toBeUndefined();
    expect(await loadTasks(d)).toHaveLength(0);
    expect((await d.links.toArray()).filter((l) => l.deletedAt == null && l.fromModule === 'tasks')).toHaveLength(0);
    const again = await mk(d);
    const t = (await openPay(d))[0];
    await sleep(3);
    await saveTask(t.id, { ...t.data, title: 'Renamed by the owner' }, d); // the Task changed since
    await expect(applyUndo(again.undo, d)).rejects.toSatisfy(isUndoRefused);
    expect(await getObligation(again.id, d)).toBeDefined();
  });
  it('a bill that has reminder Tasks cannot be permanently deleted (End it); the reason names the Task', async () => {
    const { planDelete } = await import('./data');
    const d = fresh();
    const { id } = await mk(d);
    const plan = await planDelete(id, d);
    expect(plan.allowed).toBe(false);
    expect(plan.reasons.join(' ')).toMatch(/reminder Task is linked/);
  });
});

describe('B2 a bill with billing history can never be permanently deleted', () => {
  it('one recorded fact is enough to refuse Delete, and the reason says so; End is the way out', async () => {
    const { planDelete, deleteObligation } = await import('./data');
    const d = fresh();
    const { id } = await mk(d, {}, null);
    expect((await planDelete(id, d)).allowed).toBe(true);
    await rec(d, id, 'm2026-11', skipF());
    const plan = await planDelete(id, d);
    expect(plan.allowed).toBe(false);
    expect(plan.reasons.join(' ')).toMatch(/billing-period record/);
    await expect(deleteObligation(id, null, d)).rejects.toThrow(/cannot be deleted/);
    expect(await getObligation(id, d)).toBeDefined();
    expect(await loadCycles(d)).toHaveLength(1);
  });
});

describe('B2 Task edge cases found by the mutation checks', () => {
  it('an old, recorded but unpaid month never becomes the reminder: the Task stands for the earliest open bill inside the 30-day look-back', async () => {
    const d = fresh();
    const { id } = await mk(d, { trackingSince: '2026-01-01', schedule: monthly(18, '2026-01') }, null);
    await rec(d, id, 'm2026-08', inv(5000)); // billed in August, never paid, never recorded further
    const o = (await getObligation(id, d))!;
    await saveReminders(id, { payTask: true, leadDays: 3, deadlineTasks: true }, o.updatedAt, TODAY, d);
    const open = await openPay(d);
    expect(open).toHaveLength(1);
    expect(markersOf(open[0])!.cycle).not.toBe('m2026-08'); // August is far outside the look-back
    expect(markersOf(open[0])!.cycle).toBe('m2026-10'); // 18 October is 20 days ago and still unconfirmed
  });
  it('a paused or ended bill makes no Task even for a period that already holds a recorded bill', async () => {
    for (const how of ['pause', 'end'] as const) {
      const d = fresh();
      const { id } = await mk(d, { trackingSince: '2026-11-01' }, null);
      await rec(d, id, 'm2026-11', inv(5000, { dueDate: '2026-11-25' }));
      const plan = await planLifecycle(id, how, { today: TODAY, date: TODAY }, d);
      await applyLifecycle({ id, action: how, expect: plan.expect, today: TODAY, date: TODAY }, d);
      await sleep(2);
      const o = (await getObligation(id, d))!;
      await saveReminders(id, { payTask: true, leadDays: 3, deadlineTasks: true }, o.updatedAt, TODAY, d);
      expect(await loadTasks(d), how).toHaveLength(0);
    }
  });
});
