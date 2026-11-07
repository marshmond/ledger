import { describe, expect, it } from 'vitest';
import { FinanceDB } from '../../db';
import { exportAll, importAll } from '../../lib/backup';
import { buildBackup, checkBackupText, restoreChecked } from '../../lib/backupFile';
import { summarizeBackup } from '../../lib/backupSummary';
import { stable } from '../../lib/sync/merge';
import { applyLifecycle, createObligation, editObligation, getObligation, planLifecycle, type ObligationEdit } from './data';
import { editFact, loadCycles, newOp, recordFact, removeFact } from './cycleData';
import { findConflicts } from './cycleConflicts';
import { applyMove, applyRepair, planMove } from './cycleRepair';
import { periodsOf } from './periods';
import { attention, derive, loadBillsSnapshot } from './readModel';
import { ensureBillTasks, loadBillTasks } from './tasks';
import { saveReminders } from './contractData';
import { MODULE, type ObligationData } from './model';
import { applyUndo, isUndoRefused } from './undo';
import { creditF, devices, dueOn, financeSnapshot, fresh, inv, monthly, ob, paidFull, paidOut, settle, skipF, sleep } from './billsTestkit';
import type { FactBody } from './cycleModel';

/** Real SyncEngine with two devices, and the real backup export, file checker and restore. Invented data only. 2026-11-07 is a Saturday. */
const TODAY = '2026-11-07';
const mkOb = (over: Partial<ObligationData> = {}): ObligationData => ob({ title: 'Example Power Co', amountKind: 'variable', prices: [{ from: TODAY, cents: 9000, label: '' }], schedule: monthly(18, '2026-11'), reminders: null, ...over }, TODAY);
const rec = (d: FinanceDB, id: number, slot: string, body: FactBody, finishTaskId?: number | null) => recordFact({ obligationId: id, slot, body, op: newOp(), today: TODAY, finishTaskId }, d);
const billsRows = async (d: FinanceDB) => (await d.moduleRecords.toArray()).filter((r) => r.module === MODULE).sort((a, b) => (a.id as number) - (b.id as number));
const same = async (a: FinanceDB, b: FinanceDB) => { expect(stable(await billsRows(a))).toBe(stable(await billsRows(b))); };
const edit = (cur: ObligationData): ObligationEdit => ({
  title: cur.title, type: cur.type, need: cur.need, amountKind: cur.amountKind, amountCents: cur.prices[0]?.cents ?? null, trackingSince: cur.trackingSince, schedule: cur.schedule,
  payment: cur.payment, paidThroughLoan: cur.paidThroughLoan, review: { on: cur.review.on, note: cur.review.note }, refs: cur.refs, notes: cur.notes,
});
async function seeded(over: Partial<ObligationData> = {}) {
  const { A, B } = devices();
  const r = await createObligation({ data: mkOb(over), provider: { name: 'Example Power Co' }, today: TODAY }, A.d);
  await A.engine.initialUpload();
  await B.engine.replaceFromRemote();
  return { A, B, id: r.id };
}
const period = async (d: FinanceDB, id: number, slot = 'm2026-11') => periodsOf((await getObligation(id, d))!, await loadCycles(d), TODAY, { from: '2026-11-01', to: '2027-12-31' }, { allRecorded: true }).find((p) => p.slot === slot)!;
const conflicts = async (d: FinanceDB, id: number) => findConflicts([(await getObligation(id, d))!], await loadCycles(d));

describe('B2 two devices: independent evidence is never overwritten (tests 39, 81, 82)', () => {
  it('1. A records an invoice while B records a due-date correction: both survive and both are used; no conflict', async () => {
    const { A, B, id } = await seeded();
    await rec(A.d, id, 'm2026-11', inv(11420));
    await rec(B.d, id, 'm2026-11', dueOn('2026-11-25'));
    await settle(A, B);
    for (const d of [A.d, B.d]) {
      expect(await loadCycles(d)).toHaveLength(2);
      const p = await period(d, id);
      expect([p.amounts.owed, p.timing.date, p.label]).toEqual([11420, '2026-11-25', 'upcoming']);
      expect(await conflicts(d, id)).toHaveLength(0);
    }
    await same(A.d, B.d);
  });
  it('2. both record different invoice amounts: both kept, the amount owed is unknown on both until someone chooses, and the choice syncs', async () => {
    const { A, B, id } = await seeded();
    await rec(A.d, id, 'm2026-11', inv(10000));
    await rec(B.d, id, 'm2026-11', inv(12000));
    await settle(A, B);
    for (const d of [A.d, B.d]) {
      expect(await loadCycles(d)).toHaveLength(2);
      expect([(await period(d, id)).amounts.basis, (await period(d, id)).amounts.owed]).toEqual(['disagree', null]);
    }
    const [c] = await conflicts(A.d, id);
    await applyRepair({ key: c.key, choice: { kind: 'use-one', keepId: c.ids[1] }, today: TODAY }, A.d);
    await settle(A, B);
    expect((await period(B.d, id)).amounts.owed).toBe(12000); // the repair reached the other device
    expect((await period(B.d, id)).superseded).toHaveLength(1); // and the set-aside record is still there as history
    expect(await conflicts(B.d, id)).toHaveLength(0);
  });
  it('3. one device skips a period while the other records a payment: the payment counts, the skip never removes it', async () => {
    const { A, B, id } = await seeded();
    await rec(A.d, id, 'm2026-11', skipF('away'));
    await rec(B.d, id, 'm2026-11', paidOut('2026-11-12', 5000));
    await settle(A, B);
    for (const d of [A.d, B.d]) {
      const p = await period(d, id);
      expect([p.skipVsPayment, p.amounts.paid, p.label]).toEqual([true, 5000, 'partly-paid']);
      expect((await conflicts(d, id)).map((c) => c.kind)).toEqual(['skip-payment']);
      expect(attention(derive(await loadBillsSnapshot(d), TODAY)).conflicts).toBe(1);
    }
  });
  it('4. two devices record the same invoice: both kept, counted once, flagged as a possible duplicate, never deleted', async () => {
    const { A, B, id } = await seeded();
    await rec(A.d, id, 'm2026-11', inv(11420, { dueDate: '2026-11-22' }));
    await rec(B.d, id, 'm2026-11', inv(11420, { dueDate: '2026-11-22' }));
    await settle(A, B);
    for (const d of [A.d, B.d]) {
      expect(await loadCycles(d)).toHaveLength(2);
      const p = await period(d, id);
      expect(p.amounts.owed).toBe(11420); // not 22840
      expect((await conflicts(d, id)).map((c) => c.kind)).toEqual(['invoice-duplicate']);
    }
  });
  it('5. one device moves a period while the other adds a fact at the old period: the late fact is flagged, never merged', async () => {
    const { A, B, id } = await seeded();
    await rec(A.d, id, 'm2026-11', inv(11420));
    await settle(A, B);
    const plan = await planMove(id, 'm2026-11', 'm2026-12', A.d);
    await applyMove({ obligationId: id, from: 'm2026-11', to: 'm2026-12', expect: plan.expect, today: TODAY }, A.d);
    const lateId = (await rec(B.d, id, 'm2026-11', paidFull())).id; // B had not seen the move
    await settle(A, B);
    for (const d of [A.d, B.d]) {
      const cs = await loadCycles(d);
      expect(cs.find((c) => c.id === lateId)!.slot).toBe('m2026-11'); // not moved, not merged
      const flagged = (await conflicts(d, id)).find((c) => c.kind === 'moved-arrival')!;
      expect([flagged.ids, flagged.target]).toEqual([[lateId], 'm2026-12']);
    }
    await same(A.d, B.d);
  });
  it('6. a bill is ended on A while B records a new fact for it: the fact and the ended bill both survive', async () => {
    const { A, B, id } = await seeded();
    const plan = await planLifecycle(id, 'end', { today: TODAY, date: TODAY }, A.d);
    await applyLifecycle({ id, action: 'end', expect: plan.expect, today: TODAY, date: TODAY }, A.d);
    await rec(B.d, id, 'm2026-11', inv(4200));
    await settle(A, B);
    for (const d of [A.d, B.d]) {
      expect((await getObligation(id, d))!.data.status).toBe('ended');
      expect((await loadCycles(d)).map((c) => c.body?.fact)).toEqual(['invoice']);
    }
    await same(A.d, B.d);
  });
  it('7. a bill that is not on one device yet: its records are listed as belonging to a missing bill, kept, and resolve when the bill arrives', async () => {
    const { A, B, id } = await seeded();
    await rec(A.d, id, 'm2026-11', inv(500));
    // B's copy of the bill is not there (it was deleted before the records arrived): simulate by a soft-deleted bill
    const row = (await B.d.moduleRecords.get(id))!;
    await B.d.moduleRecords.put({ ...row, deletedAt: Date.now(), updatedAt: row.updatedAt + 1 });
    const x = await findConflicts([], await loadCycles(A.d));
    expect(x.map((c) => c.kind)).toEqual(['missing-obligation']);
    expect((await loadCycles(A.d)).length).toBe(1); // nothing deleted
    expect(findConflicts([(await getObligation(id, A.d))!], await loadCycles(A.d))).toHaveLength(0); // present again: resolved
  });
  it('8. a finished Task and its fact arriving in either order: each half-state is explained, and both together agree', async () => {
    const { A, B, id } = await seeded({ reminders: { payTask: true, leadDays: 3 } });
    await ensureBillTasks(id, TODAY, A.d);
    await settle(A, B);
    const task = (await loadBillTasks(A.d))[0];
    const r = await rec(A.d, id, 'm2026-11', paidOut('2026-11-12', 9000), task.id); // Done, mark paid on A
    expect(r.finishedTask).toBe(task.id);
    // order 1: B has the finished Task but not the fact yet
    const tRow = (await A.d.moduleRecords.get(task.id))!;
    await B.d.moduleRecords.put({ ...(await B.d.moduleRecords.get(task.id))!, data: tRow.data, updatedAt: tRow.updatedAt });
    expect(attention(derive(await loadBillsSnapshot(B.d), TODAY)).unconfirmedTasks).toBe(1); // "finished, not yet confirmed" until the fact arrives
    await settle(A, B);
    expect(attention(derive(await loadBillsSnapshot(B.d), TODAY)).unconfirmedTasks).toBe(0);
    // order 2: the fact is on a device whose Task is still open: the Task is flagged as standing for a settled period, not deleted
    const C = fresh('bsync');
    for (const row of await A.d.moduleRecords.toArray()) await C.moduleRecords.put(row);
    const open = (await C.moduleRecords.get(task.id))!;
    await C.moduleRecords.put({ ...open, data: { ...(open.data as object), status: 'todo', completedAt: null } as never });
    await C.moduleRecords.put({ ...(await C.moduleRecords.get(id))!, updatedAt: Date.now() });
    expect((await loadBillTasks(C))).toHaveLength(2);
    expect(attention(derive(await loadBillsSnapshot(C), TODAY)).unconfirmedTasks).toBe(0);
    await same(A.d, B.d);
  });
  it('9. an Undo is refused after a conflicting remote change reached this device, and writes nothing', async () => {
    const { A, B, id } = await seeded();
    const made = await rec(A.d, id, 'm2026-11', inv(100));
    await settle(A, B);
    const onB = (await loadCycles(B.d))[0];
    await sleep(5);
    await editFact(onB.id, inv(222), onB.updatedAt, TODAY, B.d);
    await settle(A, B);
    const before = stable(await billsRows(A.d));
    await expect(applyUndo(made.undo, A.d)).rejects.toSatisfy(isUndoRefused);
    expect(stable(await billsRows(A.d))).toBe(before);
    expect((await loadCycles(A.d))[0].body).toMatchObject({ invoicedCents: 222 });
  });
  it('10. a record kind or fact this build does not know travels through sync and an edit of the same period without any loss', async () => {
    const { A, B, id } = await seeded();
    await A.d.moduleRecords.add({ id: 880001, module: MODULE, kind: 'cycle', data: { obligationId: id, slot: 'm2026-11', fact: 'payment-link', ref: { txnId: 77, snapshot: { amountCents: -9000 } }, extra: [1, { z: 'kept' }] }, createdAt: Date.now(), updatedAt: Date.now(), deletedAt: null } as never);
    await A.d.moduleRecords.add({ id: 880002, module: MODULE, kind: 'newer-kind', data: { anything: true }, createdAt: Date.now(), updatedAt: Date.now(), deletedAt: null } as never);
    await settle(A, B);
    await rec(B.d, id, 'm2026-11', inv(9000)); // an ordinary edit of the same period on the other device
    await settle(A, B);
    for (const d of [A.d, B.d]) {
      expect((await d.moduleRecords.get(880001))!.data).toMatchObject({ fact: 'payment-link', ref: { txnId: 77, snapshot: { amountCents: -9000 } }, extra: [1, { z: 'kept' }] });
      expect((await d.moduleRecords.get(880002))!.data).toEqual({ anything: true });
      const p = await period(d, id);
      expect(p.unreadable.map((r) => r.id)).toEqual([880001]);
      expect(p.amounts.paid).toBe(0); // an unreadable record is never counted
      expect(p.amounts.owed).toBe(9000);
    }
  });
  it('two devices each turn reminders on and make the Task for the same bill offline: both are kept, flagged, and never deleted', async () => {
    const { A, B, id } = await seeded();
    await saveReminders(id, { payTask: true, leadDays: 3, deadlineTasks: true }, null, TODAY, A.d);
    await saveReminders(id, { payTask: true, leadDays: 3, deadlineTasks: true }, null, TODAY, B.d);
    await settle(A, B);
    for (const d of [A.d, B.d]) {
      const tasks = (await loadBillTasks(d)).filter((t) => t.data.status !== 'done');
      expect(tasks).toHaveLength(2);
      expect(attention(derive(await loadBillsSnapshot(d), TODAY)).taskProblems).toBe(1);
    }
    await ensureBillTasks(id, TODAY, A.d); // asking again never adds a third
    expect((await loadBillTasks(A.d)).filter((t) => t.data.status !== 'done')).toHaveLength(2);
  });
  it('removing a record on one device (a soft delete) and adding another on the other: both changes reach both', async () => {
    const { A, B, id } = await seeded();
    const first = await rec(A.d, id, 'm2026-11', creditF(100, 'a'));
    await settle(A, B);
    const c = (await loadCycles(A.d))[0];
    await removeFact(c.id, c.updatedAt, TODAY, A.d);
    await rec(B.d, id, 'm2026-11', creditF(200, 'b'));
    await settle(A, B);
    for (const d of [A.d, B.d]) expect((await loadCycles(d)).map((x) => x.body)).toEqual([{ fact: 'credit', cents: 200, note: 'b' }]);
    void first;
  });
  it('Finance tables are identical on both devices and unchanged by any of this', async () => {
    const { A, B, id } = await seeded();
    const fa = await financeSnapshot(A.d), fb = await financeSnapshot(B.d);
    await rec(A.d, id, 'm2026-11', inv(100));
    await rec(B.d, id, 'm2026-11', skipF());
    await settle(A, B);
    expect(await financeSnapshot(A.d)).toBe(fa);
    expect(await financeSnapshot(B.d)).toBe(fb);
  });
  it('a bill edited on one device while a fact is recorded on the other: the fact is independent of the schedule edit and survives', async () => {
    const { A, B, id } = await seeded();
    await rec(B.d, id, 'm2026-12', inv(7000));
    const cur = (await getObligation(id, A.d))!;
    await editObligation(id, { ...edit(cur.data), schedule: monthly(25, '2027-01'), scheduleFrom: '2027-01-01' }, cur.updatedAt, TODAY, A.d);
    await settle(A, B);
    for (const d of [A.d, B.d]) {
      expect((await loadCycles(d))).toHaveLength(1);
      const p = await period(d, id, 'm2026-12');
      expect([p.amounts.owed, p.slot]).toEqual([7000, 'm2026-12']);
    }
  });
});

describe('B2 backup and restore (test 42, 43)', () => {
  const mem = { getItem: () => null, setItem: () => undefined, removeItem: () => undefined } as never;
  const populate = async (d: FinanceDB) => {
    const r = await createObligation({ data: mkOb({ reminders: { payTask: true, leadDays: 3 } }), provider: { name: 'Example Power Co' }, today: TODAY }, d);
    const t = (await loadBillTasks(d))[0];
    await rec(d, r.id, 'm2026-11', inv(11420, { dueDate: '2026-11-22', invoiceNumber: 'A-1' }));
    await rec(d, r.id, 'm2026-11', creditF(500, 'goodwill'));
    await rec(d, r.id, 'm2026-11', paidOut('2026-11-20', 10920), t.id);
    await rec(d, r.id, 'm2026-12', skipF('away'));
    await d.moduleRecords.add({ id: 770001, module: MODULE, kind: 'cycle', data: { obligationId: r.id, slot: 'm2026-11', fact: 'payment-link', ref: { txnId: 5 }, futureField: { deep: [1, 2] } }, createdAt: 1, updatedAt: 1, deletedAt: null } as never);
    return r.id;
  };
  // a restore re-stamps every row as changed now (documented since Phase 0), so compare everything else exactly
  const strip = <T extends object>(rows: T[]) => rows.map((r) => { const { updatedAt: _u, ...rest } = r as Record<string, unknown>; void _u; return rest; });
  const everything = async (d: FinanceDB) => stable([strip(await billsRows(d)), strip((await d.moduleRecords.toArray()).filter((r) => r.module === 'tasks')), strip(await d.links.toArray())]);
  it('every record, link, Task marker and unknown fact comes back exactly; restoring twice changes nothing more; Finance is untouched', async () => {
    const d = fresh();
    await populate(d);
    const before = await everything(d);
    const e = fresh();
    await e.open();
    await importAll(e, await exportAll(d));
    expect(await everything(e)).toBe(before);
    expect((await e.moduleRecords.get(770001))!.data).toMatchObject({ fact: 'payment-link', futureField: { deep: [1, 2] } });
    await importAll(e, await exportAll(d));
    expect(await everything(e)).toBe(before);
    expect(await financeSnapshot(e, false)).toBe(await financeSnapshot(d, false));
  });
  it('the file backup and its checker carry them; the summary counts them and names no bill, amount or note', async () => {
    const d = fresh();
    await populate(d);
    const file = checkBackupText(JSON.stringify(await buildBackup(d))).file;
    const e = fresh();
    await e.open();
    await restoreChecked(e, file, mem);
    expect((await e.moduleRecords.get(770001))!.data).toMatchObject({ fact: 'payment-link' });
    expect((await loadCycles(e)).length).toBe(5); // four readable facts and the one this version cannot read
    const groups = summarizeBackup(await exportAll(d));
    const g = groups.find((x) => x.id === 'bills')!;
    expect([...g.items].sort((x, y) => x.label.localeCompare(y.label))).toEqual([{ label: 'Billing-period records', n: 5 }, { label: 'Bills and subscriptions', n: 1 }]); // four readable facts plus the one this version cannot read
    expect(groups.find((x) => x.id === 'other')).toBeUndefined();
    expect(JSON.stringify(groups)).not.toMatch(/Example Power|11420|114.20|goodwill|A-1/);
  });
  it('an unknown fact survives a restore and an ordinary edit of its period, and is still never counted', async () => {
    const d = fresh();
    const id = await populate(d);
    const e = fresh();
    await e.open();
    await importAll(e, await exportAll(d));
    const inv1 = (await loadCycles(e)).find((c) => c.body?.fact === 'invoice')!;
    await sleep(3);
    await editFact(inv1.id, inv(12000), inv1.updatedAt, TODAY, e);
    expect((await e.moduleRecords.get(770001))!.data).toMatchObject({ futureField: { deep: [1, 2] } });
    expect((await period(e, id)).amounts.owed).toBe(12000 - 500);
  });
});
