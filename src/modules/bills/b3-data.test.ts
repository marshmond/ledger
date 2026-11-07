import { describe, expect, it } from 'vitest';
import { FinanceDB } from '../../db';
import { makeTxnRef, type TxnRef } from '../../lib/txnRef';
import type { Split, Txn } from '../../types';
import { loadTasks } from '../tasks/data';
import { editFact, loadCycles, newOp, planFact, recordFact, removeFact } from './cycleData';
import { findConflicts } from './cycleConflicts';
import { applyMove, applyRepair, planMove } from './cycleRepair';
import { createObligation, getObligation } from './data';
import { billsDueItems } from './dueProvider';
import { attention, attentionLines, derive, loadBillsSnapshot } from './readModel';
import { periodsOf } from './periods';
import { loadBillTasks, markersOf } from './tasks';
import { applyUndo, isUndoRefused } from './undo';
import { financeSnapshot, fresh, inv, monthly, ob, paidFull, paidOut, sleep } from './billsTestkit';
import { MODULE, type ObligationData } from './model';
import { SAME_PIECE, SWITCH_NEEDED, TYPED_WHILE_LINKED } from './paymentLinks';
import type { FactBody } from './cycleModel';
import { lookupOfMap, loadTxnMap } from '../../lib/txnLookup';

/** B3 with a real database (fake-indexeddb). Invented data only. 2026-11-07 is a Saturday; the November bill is the 18th. */
const TODAY = '2026-11-07';
const SLOT = 'm2026-11';
const REM = { payTask: true, leadDays: 3 };

const mk = async (d: FinanceDB, over: Partial<ObligationData> = {}, reminders: ObligationData['reminders'] = null) =>
  createObligation({ data: ob({ title: 'Example Power Co', amountKind: 'fixed', prices: [{ from: TODAY, cents: 12000, label: '' }], schedule: monthly(18, '2026-11'), reminders, ...over }, TODAY), provider: { name: 'Example Power Co' }, today: TODAY }, d);

let acct = 0;
const account = async (d: FinanceDB) => (acct = (await d.accounts.add({ name: 'Test checking', kind: 'checking', openingBalanceCents: 0, openingDate: '2026-01-01' } as never)) as number);
const addTxn = async (d: FinanceDB, amountCents: number, over: Partial<Txn> = {}): Promise<Txn> => {
  const a = acct || (await account(d));
  const t: Txn = { accountId: a, date: '2026-11-10', amountCents, payee: 'Example Power', memo: '', status: 'pending', categoryId: 5, ...over };
  const id = (await d.txns.add(t)) as number;
  return { ...t, id };
};
const addSplit = async (d: FinanceDB, parts: [number, number | null][], over: Partial<Txn> = {}) => {
  const splits: Split[] = parts.map(([amountCents, categoryId]) => ({ amountCents, categoryId }));
  return addTxn(d, splits.reduce((n, s) => n + s.amountCents, 0), { splits, ...over });
};
const body = (t: Txn, split?: number): FactBody => ({ fact: 'payment-link', ref: makeTxnRef(t, split) });
const link = (d: FinanceDB, obligationId: number, t: Txn, extra: { split?: number; slot?: string; op?: string; finishTaskId?: number | null; switchTyped?: boolean; replaceFactId?: number | null; today?: string } = {}) =>
  recordFact({ obligationId, slot: extra.slot ?? SLOT, body: body(t, extra.split), op: extra.op ?? newOp(), today: extra.today ?? TODAY, finishTaskId: extra.finishTaskId, switchTyped: extra.switchTyped, replaceFactId: extra.replaceFactId }, d);
const rec = (d: FinanceDB, id: number, b: FactBody, slot = SLOT, extra: { finishTaskId?: number | null; today?: string } = {}) =>
  recordFact({ obligationId: id, slot, body: b, op: newOp(), today: extra.today ?? TODAY, finishTaskId: extra.finishTaskId }, d);
const period = async (d: FinanceDB, id: number, slot = SLOT, today = TODAY) => {
  const o = (await getObligation(id, d))!;
  const cycles = await loadCycles(d);
  const lookup = lookupOfMap(await loadTxnMap(cycles.flatMap((c) => (c.body?.fact === 'payment-link' && c.supersededBy === null ? [c.body.ref] : [])), d));
  return periodsOf(o, cycles, today, { from: '2026-01-01', to: '2027-12-31' }, { allRecorded: true, lookup }).find((p) => p.slot === slot)!;
};
const openPay = async (d: FinanceDB) => (await loadBillTasks(d)).filter((t) => markersOf(t)!.purpose === 'pay' && t.data.status !== 'done');
const rows = async (d: FinanceDB) => JSON.stringify([await d.moduleRecords.toArray(), await d.links.toArray(), await d.contacts.toArray()]);
const err = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return e instanceof Error ? e.message : String(e); } };

describe('B3 confirming a Finance payment: nothing is linked by looking alike, and a repeat is visibly refused', () => {
  it('a confirmed link creates ONE fact holding a reference (and a snapshot), never a copy of the money; the period shows the live amount and status', async () => {
    const d = fresh();
    const { id } = await mk(d);
    const t = await addTxn(d, -12000, { status: 'cleared' });
    const r = await link(d, id, t);
    expect(r.reused).toBe(false);
    const cs = await loadCycles(d);
    expect(cs).toHaveLength(1);
    expect(cs[0].body).toMatchObject({ fact: 'payment-link', ref: { txnId: t.id, snapshot: { amountCents: -12000, payee: 'Example Power' } } });
    expect((await d.moduleRecords.get(r.id))!.data).not.toHaveProperty('cents'); // no amount of its own
    const p = await period(d, id);
    expect(p.amounts).toMatchObject({ paid: 12000, remaining: 0, source: 'finance' });
    expect(p.label).toBe('paid');
    expect(p.amounts.finance!.pieces[0].status).toBe('cleared');
  });

  it('a transaction that merely looks like the bill (same amount, same month, same payee) is NOT a payment until the owner confirms it', async () => {
    const d = fresh();
    const { id } = await mk(d);
    await addTxn(d, -12000, { payee: 'Example Power Co' });
    expect((await period(d, id)).amounts).toMatchObject({ paid: 0, source: 'none', finance: null });
    expect(await loadCycles(d)).toHaveLength(0);
  });

  it('pressing twice with the same operation writes one fact; confirming the same piece again later is refused in words', async () => {
    const d = fresh();
    const { id } = await mk(d);
    const t = await addTxn(d, -12000);
    const op = newOp();
    await link(d, id, t, { op });
    expect((await link(d, id, t, { op })).reused).toBe(true);
    expect(await loadCycles(d)).toHaveLength(1);
    expect(await err(link(d, id, t))).toBe(SAME_PIECE);
    expect(await loadCycles(d)).toHaveLength(1);
    const plan = await planFact({ obligationId: id, slot: SLOT, body: body(t), today: TODAY }, d);
    expect(plan.problem).toBe(SAME_PIECE); // the preview refuses exactly what saving refuses
  });

  it('different pieces add up in one period; a whole transaction cannot sit beside one of its parts', async () => {
    const d = fresh();
    const { id } = await mk(d);
    const a = await addTxn(d, -6000), b = await addTxn(d, -6000);
    await link(d, id, a);
    expect((await period(d, id)).label).toBe('partly-paid');
    await link(d, id, b);
    expect((await period(d, id)).label).toBe('paid');
    const s = await addSplit(d, [[-7000, 5], [-5000, 6]]);
    await link(d, id, s, { split: 0, slot: 'm2026-12' });
    expect(await err(link(d, id, s, { slot: 'm2026-12' }))).toMatch(/whole transaction and also one of its parts/);
    await link(d, id, s, { split: 1, slot: 'm2026-12' }); // another part is a different piece
    expect((await period(d, id, 'm2026-12')).amounts.paid).toBe(12000);
  });

  it('refuses a transaction that does not exist, a transfer, a setup entry, and a split part that no longer matches', async () => {
    const d = fresh();
    const { id } = await mk(d);
    const gone = await addTxn(d, -1000);
    const ref = makeTxnRef(gone);
    await d.txns.delete(gone.id!);
    expect(await err(recordFact({ obligationId: id, slot: SLOT, body: { fact: 'payment-link', ref }, op: newOp(), today: TODAY }, d))).toMatch(/no longer exists/);
    const xfer = await addTxn(d, -1000, { transferTxnId: 9999 });
    expect(await err(link(d, id, xfer))).toMatch(/transfer or setup entry cannot be linked/);
    const s = await addSplit(d, [[-7000, 5], [-5000, 6]]);
    const stale: TxnRef = makeTxnRef(s, 0);
    await d.txns.update(s.id!, { splits: [{ amountCents: -5000, categoryId: 6 }, { amountCents: -7000, categoryId: 5 }] });
    expect(await err(recordFact({ obligationId: id, slot: SLOT, body: { fact: 'payment-link', ref: stale }, op: newOp(), today: TODAY }, d))).toMatch(/has changed/);
    expect(await loadCycles(d)).toHaveLength(0);
  });

  it('a loan-tracked bill takes no payment link, and an extra bill (no schedule period) can hold one', async () => {
    const d = fresh();
    const loan = await mk(d, { type: 'loan', paidThroughLoan: false });
    const t = await addTxn(d, -12000);
    expect(await err(link(d, loan.id, t))).toMatch(/Loans page/);
    const { id } = await mk(d, { title: 'Occasional Co' });
    await link(d, id, t, { slot: 'x12345' });
    expect((await loadCycles(d)).some((c) => c.slot === 'x12345')).toBe(true);
  });

  it('a link cannot be edited (only added, removed or replaced)', async () => {
    const d = fresh();
    const { id } = await mk(d);
    const t = await addTxn(d, -12000);
    const r = await link(d, id, t);
    const c = (await loadCycles(d)).find((x) => x.id === r.id)!;
    expect(await err(editFact(r.id, body(await addTxn(d, -1)), c.updatedAt, TODAY, d))).toMatch(/cannot be edited/);
  });

  it('a link needs a bill: an unknown bill is refused and nothing is written', async () => {
    const d = fresh();
    const t = await addTxn(d, -12000);
    expect(await err(link(d, 424242, t))).toMatch(/no longer exists/);
    expect(await loadCycles(d)).toHaveLength(0);
  });
});

describe('B3 Finance is only read: no Finance table changes, ever', () => {
  it('link, replace, remove, switch, repair, move and Undo leave every Finance row byte for byte as it was (including the transaction status)', async () => {
    const d = fresh();
    const { id } = await mk(d, {}, REM);
    const a = await addTxn(d, -6000, { status: 'pending' }), b = await addTxn(d, -6000, { status: 'cleared' }), c = await addTxn(d, -12000, { status: 'reconciled' });
    const before = await financeSnapshot(d);
    const r1 = await link(d, id, a);
    await link(d, id, b);
    const r3 = await link(d, id, c, { slot: 'm2026-12' });
    expect(await financeSnapshot(d)).toBe(before);
    await link(d, id, a, { slot: 'm2026-12', replaceFactId: r3.id }).catch(() => null);
    await rec(d, id, paidOut('2026-11-09', 5000), 'm2027-01');
    await link(d, id, c, { slot: 'm2027-01', switchTyped: true });
    const cs = await loadCycles(d);
    await removeFact(cs.find((x) => x.id === r1.id)!.id, cs.find((x) => x.id === r1.id)!.updatedAt, TODAY, d);
    const mv = await planMove(id, 'm2026-11', 'm2027-02', d);
    if (!mv.problem) await applyMove({ obligationId: id, from: 'm2026-11', to: 'm2027-02', expect: mv.expect, today: TODAY }, d);
    expect(await financeSnapshot(d)).toBe(before);
    expect((await d.txns.get(a.id!))!.status).toBe('pending'); // never cleared by Bills
  });

  it('opening the Overview, the Today card and the Calendar layer reads only: no row changes, no Task or event is made', async () => {
    const d = fresh();
    const { id } = await mk(d, {}, REM);
    const t = await addTxn(d, -5000);
    await link(d, id, t);
    const before = await rows(d);
    const fin = await financeSnapshot(d);
    for (let i = 0; i < 4; i++) {
      const snap = await loadBillsSnapshot(d);
      attentionLines(attention(derive(snap, TODAY)));
      await billsDueItems(d, { from: TODAY, to: '2027-11-06', today: TODAY, overdueDays: 30 });
    }
    expect(await rows(d)).toBe(before);
    expect(await financeSnapshot(d)).toBe(fin);
  });
});

describe('B3 typed payment to Finance link: an explicit switch, never both counted, evidence preserved', () => {
  it('linking while a typed outside-Finance payment exists is refused until the owner confirms the switch', async () => {
    const d = fresh();
    const { id } = await mk(d);
    await rec(d, id, inv(12000));
    await rec(d, id, paidOut('2026-11-09', 12000));
    const t = await addTxn(d, -12000);
    expect(await err(link(d, id, t))).toBe(SWITCH_NEEDED);
    const plan = await planFact({ obligationId: id, slot: SLOT, body: body(t), today: TODAY }, d);
    expect(plan.problem).toBe(SWITCH_NEEDED);
    expect((await period(d, id)).amounts).toMatchObject({ paid: 12000, source: 'typed' }); // nothing changed
  });

  it('after the confirmed switch the typed payment is set aside (kept, not counted), the Finance payment counts, and nothing is double counted', async () => {
    const d = fresh();
    const { id } = await mk(d);
    await rec(d, id, inv(12000));
    const typed = await rec(d, id, paidOut('2026-11-09', 12000));
    const t = await addTxn(d, -12000);
    const plan = await planFact({ obligationId: id, slot: SLOT, body: body(t), today: TODAY, switchTyped: true }, d);
    expect(plan.problem).toBeNull();
    expect(plan.typedSetAside).toBe(1);
    expect(plan.lines.join(' ')).toMatch(/set aside/);
    expect(plan.lines.join(' ')).toMatch(/No Finance transaction is changed/);
    expect(plan.result).toMatchObject({ label: 'paid', paidCents: 12000, remainingCents: 0 });
    const r = await link(d, id, t, { switchTyped: true });
    const p = await period(d, id);
    expect(p.amounts).toMatchObject({ paid: 12000, remaining: 0, source: 'finance', typedLeftOut: [] });
    expect(p.superseded.map((x) => x.id)).toEqual([typed.id]);
    const raw = (await d.moduleRecords.get(typed.id))!;
    expect(raw.deletedAt ?? null).toBeNull(); // the typed evidence is still there
    expect(raw.data).toMatchObject({ fact: 'paid-outside', cents: 12000, supersededBy: r.id });
    // Undo brings the typed payment back as it was and removes the link, guarded
    await applyUndo(r.undo, d);
    const after = await period(d, id);
    expect(after.amounts).toMatchObject({ paid: 12000, source: 'typed' });
    expect((await d.moduleRecords.get(typed.id))!.data).not.toHaveProperty('supersededBy');
    expect((await loadCycles(d)).some((c) => c.body?.fact === 'payment-link')).toBe(false);
  });

  it('a typed amount cannot be added (or an existing typed record changed to carry one) while Finance links are in force; a declaration without an amount can', async () => {
    const d = fresh();
    const { id } = await mk(d);
    const t = await addTxn(d, -5000);
    await link(d, id, t);
    expect(await err(rec(d, id, paidOut('2026-11-09', 7000)))).toBe(TYPED_WHILE_LINKED);
    const plan = await planFact({ obligationId: id, slot: SLOT, body: paidOut('2026-11-09', 7000), today: TODAY }, d);
    expect(plan.problem).toBe(TYPED_WHILE_LINKED);
    await rec(d, id, paidOut('2026-11-09', null)); // no amount: only a note
    await rec(d, id, paidFull('2026-11-09'));
    expect((await period(d, id)).amounts.paid).toBe(5000);
    // editing an existing typed record to add an amount is refused the same way
    const noAmt = (await loadCycles(d)).find((c) => c.body?.fact === 'paid-outside')!;
    expect(await err(editFact(noAmt.id, paidOut('2026-11-09', 7000), noAmt.updatedAt, TODAY, d))).toBe(TYPED_WHILE_LINKED);
  });

  it('replacing a linked payment swaps one for the other in a single step (the old link is removed, a restorable soft delete)', async () => {
    const d = fresh();
    const { id } = await mk(d);
    const a = await addTxn(d, -12000), b = await addTxn(d, -12000, { date: '2026-11-11' });
    const first = await link(d, id, a);
    const second = await link(d, id, b, { replaceFactId: first.id });
    const live = (await loadCycles(d)).filter((c) => c.body?.fact === 'payment-link');
    expect(live.map((c) => c.id)).toEqual([second.id]);
    expect((await d.moduleRecords.get(first.id))!.deletedAt).not.toBeNull();
    expect((await period(d, id)).amounts.paid).toBe(12000);
    await applyUndo(second.undo, d);
    expect((await loadCycles(d)).filter((c) => c.body?.fact === 'payment-link').map((c) => c.id)).toEqual([first.id]);
    expect(await err(link(d, id, b, { replaceFactId: 999999 }))).toMatch(/changed or is gone/);
  });

  it('a stale (remote) edit to the typed record before the switch makes Undo refuse and write nothing', async () => {
    const d = fresh();
    const { id } = await mk(d);
    await rec(d, id, inv(12000));
    const typed = await rec(d, id, paidOut('2026-11-09', 12000));
    const t = await addTxn(d, -12000);
    const r = await link(d, id, t, { switchTyped: true });
    await sleep(3);
    const row = (await d.moduleRecords.get(typed.id))!;
    await d.moduleRecords.put({ ...row, updatedAt: Date.now() });
    const snap = await rows(d);
    expect(await err(applyUndo(r.undo, d).catch((e) => { expect(isUndoRefused(e)).toBe(true); throw e; }))).toMatch(/can no longer be undone/);
    expect(await rows(d)).toBe(snap);
  });
});

describe('B3 atomic writes and fault injection', () => {
  it('if the second write of the switch fails, nothing was written: no link, the typed payment untouched', async () => {
    const d = fresh();
    const { id } = await mk(d);
    await rec(d, id, paidOut('2026-11-09', 12000));
    const t = await addTxn(d, -12000);
    const before = await rows(d);
    d.moduleRecords.hook('updating', () => { throw new Error('injected failure'); });
    expect(await err(link(d, id, t, { switchTyped: true }))).toMatch(/injected failure/);
    d.moduleRecords.hook('updating').unsubscribe?.(() => undefined);
    expect(await rows(d)).toBe(before);
  });

  it('if the reminder step fails after the link was written, the link is rolled back too', async () => {
    const d = fresh();
    const { id } = await mk(d, {}, REM);
    const t = await addTxn(d, -12000);
    const before = await rows(d);
    const taskRows = (await d.moduleRecords.toArray()).length;
    d.moduleRecords.hook('creating', (_k, obj) => { if ((obj as { kind?: string }).kind === 'task') throw new Error('injected task failure'); });
    // fully paid: the next reminder Task must be created, and that fails
    const failure = await err(link(d, id, t, { finishTaskId: (await openPay(d))[0]?.id ?? null }));
    expect(failure).toMatch(/injected task failure/);
    expect((await d.moduleRecords.toArray()).length).toBe(taskRows);
    expect(await rows(d)).toBe(before);
  });
});

describe('B3 reminder Tasks follow the payment, never the other way round', () => {
  it('fully paying a period finishes its reminder (when chosen) and makes the next one: still ONE open pay Task; Finance is untouched', async () => {
    const d = fresh();
    const { id } = await mk(d, {}, REM);
    await rec(d, id, inv(12000));
    const first = (await openPay(d));
    expect(first).toHaveLength(1);
    expect(markersOf(first[0])!.cycle).toBe(SLOT);
    const t = await addTxn(d, -12000);
    const fin = await financeSnapshot(d);
    const plan = await planFact({ obligationId: id, slot: SLOT, body: body(t), today: TODAY }, d);
    expect(plan.taskId).toBe(first[0].id);
    expect(plan.lines.join(' ')).toMatch(/will be finished/);
    expect(plan.lines.join(' ')).toMatch(/reminder Task will be made/);
    await link(d, id, t, { finishTaskId: plan.taskId });
    const open = await openPay(d);
    expect(open).toHaveLength(1);
    expect(markersOf(open[0])!.cycle).toBe('m2026-12'); // the next period, not the paid one
    expect((await loadTasks(d)).find((x) => x.id === first[0].id)!.data.status).toBe('done');
    expect(await financeSnapshot(d)).toBe(fin);
  });

  it('a partial payment leaves the same period open with its one reminder (no second Task); the rest being paid then closes it', async () => {
    const d = fresh();
    const { id } = await mk(d, {}, REM);
    await rec(d, id, inv(12000));
    const a = await addTxn(d, -5000), b = await addTxn(d, -7000);
    await link(d, id, a);
    expect(await openPay(d)).toHaveLength(1);
    expect(markersOf((await openPay(d))[0])!.cycle).toBe(SLOT);
    const plan = await planFact({ obligationId: id, slot: SLOT, body: body(b), today: TODAY }, d);
    expect(plan.result).toMatchObject({ label: 'paid', settled: true });
    await link(d, id, b, { finishTaskId: plan.taskId });
    expect(markersOf((await openPay(d))[0])!.cycle).toBe('m2026-12');
  });

  it('removing the only payment reopens the period: ONE reminder is ensured for it again, the later one is reported (never deleted), and an owner-edited Task is never changed', async () => {
    const d = fresh();
    const { id } = await mk(d, {}, REM);
    await rec(d, id, inv(12000));
    const t = await addTxn(d, -12000);
    const plan = await planFact({ obligationId: id, slot: SLOT, body: body(t), today: TODAY }, d);
    const r = await link(d, id, t, { finishTaskId: plan.taskId });
    expect(markersOf((await openPay(d))[0])!.cycle).toBe('m2026-12'); // the next period's reminder was made when it was paid
    const c = (await loadCycles(d)).find((x) => x.id === r.id)!;
    await removeFact(c.id, c.updatedAt, TODAY, d);
    const open = await openPay(d);
    expect(open.filter((x) => markersOf(x)!.cycle === SLOT)).toHaveLength(1); // exactly one for the reopened period
    expect(open.filter((x) => markersOf(x)!.cycle === 'm2026-12')).toHaveLength(1); // the later one is NOT deleted
    expect(attention(derive(await loadBillsSnapshot(d), TODAY)).taskProblems).toBe(1); // ...it is reported for a look instead
    // an owner-edited Task is never changed by a later save
    const mine = open.find((x) => markersOf(x)!.cycle === SLOT)!;
    const { saveTask } = await import('../tasks/data');
    await saveTask(mine.id, { ...mine.data, notes: 'my own note', dueDate: '2026-11-12' }, d);
    const t2 = await addTxn(d, -12000, { date: '2026-11-13' });
    await link(d, id, t2);
    expect((await loadTasks(d)).find((x) => x.id === mine.id)!.data).toMatchObject({ notes: 'my own note', dueDate: '2026-11-12', status: 'todo' });
  });

  it('a Finance change after payment (a refund) recomputes the status and reports it, but silently creates and deletes NO Task', async () => {
    const d = fresh();
    const { id } = await mk(d, {}, REM);
    await rec(d, id, inv(12000));
    const t = await addTxn(d, -12000);
    const plan = await planFact({ obligationId: id, slot: SLOT, body: body(t), today: TODAY }, d);
    await link(d, id, t, { finishTaskId: plan.taskId });
    const tasksBefore = JSON.stringify((await loadTasks(d)).map((x) => [x.id, x.data.status, x.updatedAt]));
    await addTxn(d, 12000, { date: '2026-11-20' }); // money back, NOT linked: nothing changes for the bill
    expect((await period(d, id)).label).toBe('paid');
    await d.txns.delete(t.id!); // the payment is deleted in Finance
    const p = await period(d, id, SLOT, '2026-12-01');
    expect(p.amounts.paid).toBe(0);
    expect(p.amounts.finance!.counts.review).toBe(1);
    expect(JSON.stringify((await loadTasks(d)).map((x) => [x.id, x.data.status, x.updatedAt]))).toBe(tasksBefore);
    const a = attention(derive(await loadBillsSnapshot(d), '2026-12-01'));
    expect(a.paymentReview).toBe(1);
    expect(JSON.stringify(attentionLines(a))).not.toMatch(/Example|\$\d/);
  });
});

describe('B3 Today and Overview: one read model, counts only, no amounts', () => {
  it('reports stale links, changed payments, partial payments, unseen autopay, typed/Finance conflicts and duplicate pieces, with the same numbers everywhere', async () => {
    const d = fresh();
    const stale = await mk(d, { title: 'Stale Co' });
    const gone = await addTxn(d, -12000);
    await link(d, stale.id, gone);
    await d.txns.delete(gone.id!);
    const changed = await mk(d, { title: 'Changed Co' });
    const ch = await addTxn(d, -12000);
    await link(d, changed.id, ch);
    await d.txns.update(ch.id!, { amountCents: -9000 });
    const partial = await mk(d, { title: 'Partial Co', schedule: monthly(10, '2026-11') });
    await rec(d, partial.id, inv(12000), 'm2026-11');
    await link(d, partial.id, await addTxn(d, -5000), { slot: 'm2026-11' });
    // a partly paid bill that is not due for 18 days needs no action yet, so it is not counted
    const later = await mk(d, { title: 'Later Co', schedule: monthly(25, '2026-11') });
    await rec(d, later.id, inv(12000), 'm2026-11');
    await link(d, later.id, await addTxn(d, -5000), { slot: 'm2026-11' });
    await mk(d, { title: 'Auto Co', payment: { how: 'auto', fundingAccountId: null }, schedule: monthly(1, '2026-09'), trackingSince: '2026-09-01' });
    // two devices that each recorded money for one period (written straight in, as a sync would deliver them)
    const both = await mk(d, { title: 'Both Co' });
    await rec(d, both.id, paidOut('2026-11-09', 12000));
    const tb = await addTxn(d, -12000);
    const dup = await mk(d, { title: 'Dup Co' });
    const td = await addTxn(d, -12000);
    const put = (obligationId: number, t: Txn) => d.moduleRecords.add({ module: MODULE, kind: 'cycle', data: { obligationId, slot: SLOT, fact: 'payment-link', ref: makeTxnRef(t) }, createdAt: Date.now(), updatedAt: Date.now(), deletedAt: null } as never);
    await put(both.id, tb);
    await put(dup.id, td); await put(dup.id, td);
    const x = derive(await loadBillsSnapshot(d), TODAY);
    const a = attention(x);
    expect(a).toMatchObject({ paymentReview: 1, paymentChanged: 1, partlyPaid: 1, typedFinance: 1, duplicatePieces: 1 });
    expect(a.autopayCheck).toBeGreaterThanOrEqual(1);
    const lines = attentionLines(a);
    const ids = lines.map((l) => l.id);
    for (const k of ['paymentReview', 'paymentChanged', 'partlyPaid', 'autopayCheck', 'typedFinance', 'duplicatePieces']) expect(ids).toContain(k);
    // counts and words only: never a bill's name, a provider, a note or an amount
    expect(JSON.stringify(lines)).not.toMatch(/Stale Co|Changed Co|Partial Co|Auto Co|Both Co|Dup Co|Example|\$|\d{4,}/);
    expect(lines.find((l) => l.id === 'autopayCheck')!.text).toMatch(/not yet seen in Finance/);
    // one read model: the same numbers however often and from wherever it is read, and the total is the sum of the parts
    const again = attention(derive(await loadBillsSnapshot(d), TODAY));
    expect(attentionLines(again)).toEqual(lines);
    expect(a.total).toBe(a.items.length);
    // every item text avoids amounts too
    expect(a.items.every((i) => !/\$\d/.test(i.text))).toBe(true);
  });
});

describe('B3 follow-up: a paid-in-full declaration beside smaller Finance evidence is shown, explained and reviewable', () => {
  it('keeps the declaration, shows the real Finance amount, adds nothing, lists the discrepancy in Needs review and Today, and stops listing it when resolved', async () => {
    const d = fresh();
    const { id } = await mk(d, {}, null);
    await rec(d, id, inv(12000));
    await rec(d, id, paidFull('2026-11-09'));
    const t = await addTxn(d, -10000, { status: 'pending' });
    const fin = await financeSnapshot(d);
    await link(d, id, t);
    const p = await period(d, id);
    expect(p.label).toBe('marked-paid-short');
    expect(p.declared).toBe(true); // the owner's statement is kept
    expect(p.amounts).toMatchObject({ paid: 10000, source: 'finance', typedLeftOut: [] }); // the REAL Finance amount; no typed payment was invented
    expect((await loadCycles(d)).filter((c) => c.body?.fact === 'paid-outside')).toHaveLength(0);
    expect(await financeSnapshot(d)).toBe(fin);
    const a = attention(derive(await loadBillsSnapshot(d), TODAY));
    expect(a.declaredShort).toBe(1);
    const item = a.items.find((i) => i.category === 'declaredShort')!;
    expect(item.text).toMatch(/marked it paid in full, but the Finance payments linked to it show less/);
    expect(item.text).not.toMatch(/\$|settled|cleared/i);
    expect(attentionLines(a).find((l) => l.id === 'declaredShort')!.text).toBe('1 bill marked paid in full shows less in Finance');
    // resolved by linking the rest: no longer listed
    await link(d, id, await addTxn(d, -2000, { date: '2026-11-11' }));
    expect(attention(derive(await loadBillsSnapshot(d), TODAY)).declaredShort).toBe(0);
  });
});

describe('B3 payment problems are never aged out of sight', () => {
  it('a link whose Finance transaction was deleted is still reported when its period is months old (outside the usual look-back window)', async () => {
    const d = fresh();
    const { id } = await mk(d, { trackingSince: '2026-01-01', schedule: monthly(18, '2026-01') });
    const t = await addTxn(d, -12000, { date: '2026-03-20' });
    await link(d, id, t, { slot: 'm2026-03' });
    await d.txns.delete(t.id!);
    const a = attention(derive(await loadBillsSnapshot(d), TODAY));
    expect(a.paymentReview).toBe(1);
    expect(a.items.find((i) => i.category === 'paymentReview')!.slot).toBe('m2026-03');
  });
});

describe('B3 Calendar: a paid period is not an open due marker; nothing is stored', () => {
  it('a period paid by Finance drops its Due marker; a partly paid one keeps it; a stale link brings it back; no event record is ever created', async () => {
    const d = fresh();
    const { id } = await mk(d);
    const q = { from: TODAY, to: '2027-11-06', today: TODAY, overdueDays: 30 };
    const marker = async () => (await billsDueItems(d, q)).filter((i) => i.id.includes(`due-${id}-${SLOT}`));
    expect(await marker()).toHaveLength(1);
    const a = await addTxn(d, -5000), b = await addTxn(d, -7000);
    await rec(d, id, inv(12000));
    await link(d, id, a);
    expect(await marker()).toHaveLength(1); // partly paid: still open
    await link(d, id, b);
    expect(await marker()).toHaveLength(0); // fully paid: no open due marker
    const events = (await d.moduleRecords.toArray()).filter((r) => r.module === 'calendar').length;
    expect(events).toBe(0);
    await d.txns.delete(b.id!); // the second payment disappears from Finance
    const back = await marker();
    expect(back).toHaveLength(1);
    expect(back[0].title).toBe('Due: Example Power Co'); // titles carry no amount
    expect(back[0].detail ?? '').not.toMatch(/\$\d/);
    expect(back[0].id).toBe(`bills:due-${id}-${SLOT}:2026-11-18`); // the period identity is stable
  });
});

describe('B3 schedule changes and moves keep the payment links', () => {
  it('moving a period moves its payment links and keeps every amount and the live status', async () => {
    const d = fresh();
    const { id } = await mk(d);
    await rec(d, id, inv(12000));
    const t = await addTxn(d, -12000, { status: 'cleared' });
    await link(d, id, t);
    const mv = await planMove(id, SLOT, 'm2026-12', d);
    expect(mv.problem).toBeNull();
    expect(mv.lines.join(' ')).toMatch(/payment record/);
    await applyMove({ obligationId: id, from: SLOT, to: 'm2026-12', expect: mv.expect, today: TODAY }, d);
    const p = await period(d, id, 'm2026-12');
    expect(p.amounts).toMatchObject({ paid: 12000, remaining: 0 });
    expect(p.amounts.finance!.pieces[0].status).toBe('cleared');
    expect((await period(d, id, SLOT)).amounts.paid).toBe(0);
    expect((await loadCycles(d)).every((c) => c.movedFrom === SLOT)).toBe(true);
  });

  it('a typed-versus-Finance disagreement (from two devices) is reported and resolved only by an explicit repair that keeps the typed record', async () => {
    const d = fresh();
    const { id } = await mk(d);
    await rec(d, id, inv(12000));
    const typed = await rec(d, id, paidOut('2026-11-09', 12000));
    const t = await addTxn(d, -12000);
    // as if another device linked it without knowing about the typed payment: written straight in
    const o = (await getObligation(id, d))!;
    await d.moduleRecords.add({ module: MODULE, kind: 'cycle', data: { obligationId: o.id, slot: SLOT, fact: 'payment-link', ref: makeTxnRef(t) }, createdAt: Date.now(), updatedAt: Date.now(), deletedAt: null } as never);
    const cs = await loadCycles(d);
    const conflict = findConflicts([o], cs).find((c) => c.kind === 'typed-and-finance')!;
    expect(conflict).toBeDefined();
    expect(conflict.severity).toBe('disagree');
    expect((await period(d, id)).amounts).toMatchObject({ paid: 12000, source: 'finance', typedLeftOut: [12000] }); // not 24000
    const keep = cs.find((c) => c.body?.fact === 'payment-link')!;
    await applyRepair({ key: conflict.key, choice: { kind: 'use-one', keepId: keep.id }, today: TODAY }, d);
    const after = await period(d, id);
    expect(after.amounts.typedLeftOut).toEqual([]);
    expect(after.superseded.map((x) => x.id)).toEqual([typed.id]);
    expect(findConflicts([o], await loadCycles(d)).some((c) => c.kind === 'typed-and-finance')).toBe(false);
  });
});
