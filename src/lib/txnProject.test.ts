import { describe, expect, it } from 'vitest';
import { FinanceDB } from '../db';
import { installTracking } from './sync/track';
import { spendingSnapshot } from './spending';
import { exportAll, importAll } from './backup';
import { snapshotOf } from './sync/engine';
import { bulkSetCategory } from './txnBulk';
import { convertToTransfer, createTransfer } from './transfers';
import type { Txn } from '../types';
import {
  bulkSetTxnProject, loadProjectSummary, projectAllocations, setTxnProject, summariseProject,
  type BudgetLineInfo, type CommitmentInfo,
} from './txnProject';

/** All amounts here are invented. Figures in the comments are dollars; the code uses cents. */
const $ = (n: number) => Math.round(n * 100);
let n = 0;
const fresh = () => { const d = new FinanceDB(`test-txnproject-${n++}`); installTracking(d); return d; };

const tx = (amount: number, project?: Txn['project'], over: Partial<Txn> = {}): Txn => ({
  id: ++n, accountId: 1, date: '2026-11-01', amountCents: $(amount), payee: 'x', memo: '', status: 'cleared', categoryId: null, ...(project ? { project } : {}), ...over,
});
const com = (id: number, over: Partial<CommitmentInfo> = {}): CommitmentInfo => ({ id, projectId: 1, budgetLineId: null, title: 'c', status: 'accepted', amountCents: 0, parentId: null, ...over });
const line = (id: number, plannedCents: number): BudgetLineInfo => ({ id, projectId: 1, name: `line${id}`, plannedCents });
const P = 1;
const sum = (txns: Txn[], commitments: CommitmentInfo[], lines: BudgetLineInfo[], budget: number | null = $(60000)) => summariseProject({ project: { budgetCents: budget }, lines, commitments, txns });
const figs = (s: ReturnType<typeof sum>) => [s.agreedCents, s.paidCents, s.leftToPayCents, s.expectedTotalCents, s.leftInBudgetCents].map((c) => c / 100);

describe('worked example 1: cabinets from quote to refund', () => {
  const lines = [line(10, $(20000))];
  it('follows the table step by step', () => {
    const quotes = [com(1, { status: 'quoted', amountCents: $(19000), budgetLineId: 10 }), com(2, { status: 'quoted', amountCents: $(21500), budgetLineId: 10 })];
    expect(figs(sum([], [], lines))).toEqual([0, 0, 0, 0, 60000]);
    const s1 = sum([], quotes, lines);
    expect(figs(s1)).toEqual([0, 0, 0, 0, 60000]);
    expect(s1.quotedCents).toBe($(40500));

    const accepted = [com(1, { amountCents: $(19000), budgetLineId: 10 }), com(2, { status: 'declined', amountCents: $(21500), budgetLineId: 10 })];
    expect(figs(sum([], accepted, lines))).toEqual([19000, 0, 19000, 19000, 41000]);

    const ref = { projectId: P, commitmentId: 1, budgetLineId: 10 };
    const t1 = tx(-6000, ref);
    expect(figs(sum([t1], accepted, lines))).toEqual([19000, 6000, 13000, 19000, 41000]);
    const t2 = tx(-7000, ref);
    expect(figs(sum([t1, t2], accepted, lines))).toEqual([19000, 13000, 6000, 19000, 41000]);

    const withCo = [...accepted, com(3, { parentId: 1, amountCents: $(1200), budgetLineId: 10 })];
    const s5 = sum([t1, t2], withCo, lines);
    expect(figs(s5)).toEqual([20200, 13000, 7200, 20200, 39800]);
    expect(s5.lines[0].varianceCents).toBe($(20000) - $(20200));

    const t3 = tx(-7200, ref);
    expect(figs(sum([t1, t2, t3], withCo, lines))).toEqual([20200, 20200, 0, 20200, 39800]);

    const credit = tx(500, { projectId: P, budgetLineId: 10 });
    const s7 = sum([t1, t2, t3, credit], withCo, lines);
    expect(figs(s7)).toEqual([20200, 19700, 0, 19700, 40300]);
    expect(s7.flags.overpaid).toEqual([]);
  });

  it('a credit refund without a matching reduction makes the contract look owed again, and says so', () => {
    const accepted = [com(1, { amountCents: $(1000) })];
    const s = sum([tx(-1000, { projectId: P, commitmentId: 1 }), tx(200, { projectId: P, commitmentId: 1, effect: 'credit' })], accepted, []);
    expect(s.paidCents).toBe($(800));
    expect(s.leftToPayCents).toBe($(200)); // the agreed amount was not lowered, so $200 looks owed
    expect(s.flags.creditsNotReflected).toEqual([1]);
  });

  it('a credit with a matching negative change order lowers Agreed and raises no flag', () => {
    const lines = [line(10, $(20000))];
    const base = [com(1, { amountCents: $(20200), budgetLineId: 10 })];
    const paid = tx(-20200, { projectId: P, commitmentId: 1, budgetLineId: 10 });
    const credit = tx(500, { projectId: P, commitmentId: 1, budgetLineId: 10, effect: 'credit' });
    const withReduction = [...base, com(4, { parentId: 1, amountCents: -$(500), budgetLineId: 10 })];
    const s = sum([paid, credit], withReduction, lines);
    expect(figs(s)).toEqual([19700, 19700, 0, 19700, 40300]);
    expect(s.flags.creditsNotReflected).toEqual([]);
    expect(s.flags.overpaid).toEqual([]);
  });

  it('a credit applied to the balance with no transaction is just the negative change order', () => {
    const s = sum([tx(-6000, { projectId: P, commitmentId: 1 })], [com(1, { amountCents: $(10000) }), com(2, { parentId: 1, amountCents: -$(1000) })], []);
    expect(figs(s).slice(0, 4)).toEqual([9000, 6000, 3000, 9000]);
  });

  it("the owner's case: a refunded deposit on a live contract is a reversal and the contract is owed again", () => {
    const contract = [com(1, { amountCents: $(10000) })];
    const deposit = tx(-3000, { projectId: P, commitmentId: 1 });
    expect(figs(sum([], contract, [])).slice(0, 4)).toEqual([10000, 0, 10000, 10000]);
    expect(figs(sum([deposit], contract, [])).slice(0, 4)).toEqual([10000, 3000, 7000, 10000]);
    const back = tx(3000, { projectId: P, commitmentId: 1, effect: 'reversal' });
    const s = sum([deposit, back], contract, []);
    expect(figs(s).slice(0, 4)).toEqual([10000, 0, 10000, 10000]);
    expect(s.flags.unmarkedRefunds).toBe(0);
  });

  it('the same refund marked as a credit with a -$3,000 change order', () => {
    const contract = [com(1, { amountCents: $(10000) }), com(2, { parentId: 1, amountCents: -$(3000) })];
    const s = sum([tx(-3000, { projectId: P, commitmentId: 1 }), tx(3000, { projectId: P, commitmentId: 1, effect: 'credit' })], contract, []);
    expect(figs(s).slice(0, 4)).toEqual([7000, 0, 7000, 7000]);
    expect(s.flags.creditsNotReflected).toEqual([]);
  });

  it('a reversal larger than what was paid never makes the paid-on-contract figure negative', () => {
    const s = sum([tx(500, { projectId: P, commitmentId: 1, effect: 'reversal' })], [com(1, { amountCents: $(1000) })], []);
    expect(s.leftToPayCents).toBe($(1000));
  });

  it('a reversal bigger than the payments is flagged, and Paid on the contract never goes below zero', () => {
    const s = sum([tx(-3000, { projectId: P, commitmentId: 1 }), tx(5000, { projectId: P, commitmentId: 1, effect: 'reversal' })], [com(1, { amountCents: $(10000) })], []);
    expect(s.flags.reversalsExceedPayments).toEqual([1]);
    expect(s.leftToPayCents).toBe($(10000));
    expect(s.paidByCommitment[1]).toBe(0);
    const ok = sum([tx(-3000, { projectId: P, commitmentId: 1 }), tx(1000, { projectId: P, commitmentId: 1, effect: 'reversal' })], [com(1, { amountCents: $(10000) })], []);
    expect(ok.flags.reversalsExceedPayments).toEqual([]);
    expect(ok.paidByCommitment[1]).toBe($(2000));
  });

  it('old or foreign data with an unmarked refund on a contract is counted and flagged', () => {
    const s = sum([tx(-1000, { projectId: P, commitmentId: 1 }), tx(100, { projectId: P, commitmentId: 1 })], [com(1, { amountCents: $(1000) })], []);
    expect(s.flags.unmarkedRefunds).toBe(1);
  });
});

describe('worked example 2: a vendor is replaced, with a card and a transfer', () => {
  const lines = [line(20, $(8000))];
  it('follows the table step by step', () => {
    const open = [com(1, { amountCents: $(8400), budgetLineId: 20 })];
    expect(figs(sum([], open, lines)).slice(0, 4)).toEqual([8400, 0, 8400, 8400]);
    const deposit = tx(-2000, { projectId: P, commitmentId: 1, budgetLineId: 20 });
    expect(figs(sum([deposit], open, lines)).slice(0, 4)).toEqual([8400, 2000, 6400, 8400]);
    // the card bill paid from checking is a transfer: never counted
    const cardBill = tx(-2000, { projectId: P }, { transferTxnId: 999 });
    expect(figs(sum([deposit, cardBill], open, lines)).slice(0, 4)).toEqual([8400, 2000, 6400, 8400]);
    const cancelled = [com(1, { status: 'cancelled', amountCents: $(8400), budgetLineId: 20 })];
    const s4 = sum([deposit], cancelled, lines);
    expect(figs(s4).slice(0, 4)).toEqual([0, 2000, 0, 2000]);
    expect(s4.flags.paidOnInactive).toEqual([1]);
    const refund = tx(2000, { projectId: P, budgetLineId: 20 });
    expect(figs(sum([deposit, refund], cancelled, lines)).slice(0, 4)).toEqual([0, 0, 0, 0]);
    const next = [...cancelled, com(2, { amountCents: $(9000), budgetLineId: 20 })];
    const s6 = sum([deposit, refund], next, lines);
    expect(figs(s6).slice(0, 4)).toEqual([9000, 0, 9000, 9000]);
    expect(s6.lines[0].varianceCents).toBe(-$(1000));
  });
});

describe('worked example 3: tagging later, a split receipt, spending with no contract', () => {
  const lines = [line(30, $(10000))];
  const plumber = [com(1, { amountCents: $(4500), budgetLineId: 30 })];
  it('follows the table step by step', () => {
    expect(figs(sum([], plumber, lines)).slice(0, 4)).toEqual([4500, 0, 4500, 4500]);
    const untagged = tx(-412.37);
    expect(figs(sum([untagged], plumber, lines)).slice(0, 4)).toEqual([4500, 0, 4500, 4500]);
    const tagged = tx(-412.37, { projectId: P, budgetLineId: 30 });
    expect(figs(sum([tagged], plumber, lines)).slice(0, 4)).toEqual([4500, 412.37, 4500, 4912.37]);
    const receipt = tx(-300, undefined, { splits: [{ categoryId: 1, amountCents: $(-240), project: { projectId: P, budgetLineId: 30 } }, { categoryId: 2, amountCents: $(-60) }] });
    expect(figs(sum([tagged, receipt], plumber, lines)).slice(0, 4)).toEqual([4500, 652.37, 4500, 5152.37]);
    const cheque = tx(-2000, { projectId: P, commitmentId: 1 });
    const s5 = sum([tagged, receipt, cheque], plumber, lines);
    expect(figs(s5).slice(0, 4)).toEqual([4500, 2652.37, 2500, 5152.37]);
    expect(s5.lines[0].paidCents).toBe($(2652.37));
  });
});

describe('rules', () => {
  it('a split reference wins over the transaction one; transfers give nothing', () => {
    const t = tx(-100, { projectId: 1 }, { splits: [{ categoryId: 1, amountCents: $(-60), project: { projectId: 2 } }, { categoryId: 2, amountCents: $(-40) }] });
    expect(projectAllocations(t).map((p) => [p.projectId, p.amountCents])).toEqual([[2, $(-60)], [1, $(-40)]]);
    expect(projectAllocations(tx(-100, { projectId: 1 }, { transferTxnId: 5 }))).toEqual([]);
  });
  it('budget defaults to the sum of the lines; flags report problems', () => {
    const s = sum([], [], [line(1, $(700)), line(2, $(500))], null);
    expect(s.budgetCents).toBe($(1200));
    const over = summariseProject({ project: { budgetCents: $(1000) }, lines: [line(1, $(700)), line(2, $(500))], commitments: [com(1, { amountCents: $(100) })], txns: [tx(-300, { projectId: P, commitmentId: 1 })] });
    expect(over.flags).toMatchObject({ linesOverBudget: true, overpaid: [1] });
    expect(over.notYetPlannedCents).toBe(-$(200));
  });
  it('dates outside the project are counted but still included', () => {
    const s = summariseProject({ project: { budgetCents: 1, startDate: '2026-11-05', targetDate: '2026-12-01' }, lines: [], commitments: [], txns: [tx(-5, { projectId: P })] });
    expect(s.flags.outsideDates).toBe(1);
    expect(s.paidCents).toBe($(5));
  });
});

async function setup() {
  const d = fresh();
  await d.open();
  const a = await d.accounts.add({ name: 'A', kind: 'checking', openingBalanceCents: 0, openingDate: '2026-01-01' });
  const b = await d.accounts.add({ name: 'B', kind: 'savings', openingBalanceCents: 0, openingDate: '2026-01-01' });
  const rec = (kind: string, data: Record<string, unknown>) => d.moduleRecords.add({ module: 'projects', kind, data } as never) as unknown as Promise<number>;
  const project = await rec('project', { name: 'Kitchen', budgetCents: $(60000) });
  const other = await rec('project', { name: 'Fence' });
  const ln = await rec('budgetLine', { projectId: project, name: 'Cabinets', plannedCents: $(20000) });
  const cm = await rec('commitment', { projectId: project, budgetLineId: ln, title: 'Cabinets', status: 'accepted', amountCents: $(19000) });
  const foreign = await rec('commitment', { projectId: other, title: 'Fence', status: 'accepted', amountCents: 1 });
  const add = (amount: number, over: Partial<Txn> = {}) => d.txns.add({ accountId: a, date: '2026-11-01', amountCents: $(amount), payee: 'Shop', memo: '', status: 'cleared', categoryId: null, ...over });
  return { d, a, b, project, other, ln, cm, foreign, add };
}

describe('tagging transactions', () => {
  it('tags, reads back through the database, and clears', async () => {
    const { d, project, ln, cm, add } = await setup();
    const t1 = await add(-6000);
    await setTxnProject(d, t1, { projectId: project, budgetLineId: ln, commitmentId: cm });
    expect((await d.txns.get(t1))!.project).toEqual({ projectId: project, budgetLineId: ln, commitmentId: cm });
    const s = (await loadProjectSummary(d, project))!;
    expect(s.paidCents).toBe($(6000));
    expect(s.leftToPayCents).toBe($(13000));
    expect(s.expectedTotalCents).toBe($(19000));
    await setTxnProject(d, t1, null);
    expect('project' in (await d.txns.get(t1))!).toBe(false);
    expect((await loadProjectSummary(d, project))!.paidCents).toBe(0);
  });

  it('refuses transfers, another project\'s line or commitment, and a missing project', async () => {
    const { d, a, b, project, other, cm, foreign, add } = await setup();
    const { fromTxnId } = await createTransfer(d, { fromAccountId: a, toAccountId: b, date: '2026-11-01', amountCents: $(100) });
    await expect(setTxnProject(d, fromTxnId, { projectId: project })).rejects.toThrow(/transfer/i);
    const t = await add(-5);
    await expect(setTxnProject(d, t, { projectId: other, commitmentId: cm })).rejects.toThrow(/commitment/);
    await expect(setTxnProject(d, t, { projectId: project, commitmentId: foreign })).rejects.toThrow(/commitment/);
    await expect(setTxnProject(d, t, { projectId: 123456 })).rejects.toThrow(/project/);
  });

  it('turning a tagged transaction into a transfer clears the tag', async () => {
    const { d, b, project, add } = await setup();
    const t = await add(-250);
    await setTxnProject(d, t, { projectId: project });
    await convertToTransfer(d, t, b);
    expect((await d.txns.get(t))!.project).toBeUndefined();
    expect((await loadProjectSummary(d, project))!.paidCents).toBe(0);
  });

  it('money coming back on a contract must be marked reversal or credit; the mark means nothing otherwise', async () => {
    const { d, project, cm, add } = await setup();
    const out = await add(-1000);
    await setTxnProject(d, out, { projectId: project, commitmentId: cm });
    const back = await add(300);
    await expect(setTxnProject(d, back, { projectId: project, commitmentId: cm })).rejects.toThrow(/reversal.*credit/);
    await setTxnProject(d, back, { projectId: project, commitmentId: cm, effect: 'reversal' });
    expect((await d.txns.get(back))!.project).toEqual({ projectId: project, commitmentId: cm, effect: 'reversal' });
    await expect(setTxnProject(d, out, { projectId: project, commitmentId: cm, effect: 'credit' })).rejects.toThrow(/only applies/);
    await expect(setTxnProject(d, back, { projectId: project, effect: 'credit' })).rejects.toThrow(/only applies/);
    await setTxnProject(d, back, { projectId: project }); // money in with no contract needs no choice
    expect((await d.txns.get(back))!.project).toEqual({ projectId: project });
  });

  it('money coming back cannot be more than what was paid on the contract', async () => {
    const { d, project, cm, add } = await setup();
    const dep = await add(-3000);
    await setTxnProject(d, dep, { projectId: project, commitmentId: cm });
    const tooMuch = await add(5000);
    await expect(setTxnProject(d, tooMuch, { projectId: project, commitmentId: cm, effect: 'reversal' })).rejects.toThrow('more than the $3,000.00 paid');
    expect((await d.txns.get(tooMuch))!.project).toBeUndefined();
    const part = await add(1000);
    await setTxnProject(d, part, { projectId: project, commitmentId: cm, effect: 'reversal' }); // partial reversal is fine
    const s = (await loadProjectSummary(d, project))!;
    expect(s.paidCents).toBe($(2000));
    expect(s.leftToPayCents).toBe($(17000));
    // a second one that would take it past what is left to reverse is refused
    const again = await add(2500);
    await expect(setTxnProject(d, again, { projectId: project, commitmentId: cm, effect: 'reversal' })).rejects.toThrow(/more than/);
    // changing the existing reversal does not count it against itself
    await setTxnProject(d, part, { projectId: project, commitmentId: cm, effect: 'credit' });
    expect((await d.txns.get(part))!.project?.effect).toBe('credit');
  });

  it('bulk tagging counts money coming back that exceeds the payments and leaves it alone', async () => {
    const { d, project, cm, add } = await setup();
    const dep = await add(-100);
    await setTxnProject(d, dep, { projectId: project, commitmentId: cm });
    const back = await add(900);
    const r = await bulkSetTxnProject(d, [back], { projectId: project, commitmentId: cm, effect: 'reversal' });
    expect(r).toMatchObject({ updated: 0, skippedTransfers: 0, exceedsPayments: 1 });
    expect((await d.txns.get(back))!.project).toBeUndefined();
  });

  it('bulk tagging leaves money coming back on a contract untouched and counts it', async () => {
    const { d, project, cm, add } = await setup();
    const out = await add(-1000), back = await add(300);
    const r = await bulkSetTxnProject(d, [out, back], { projectId: project, commitmentId: cm });
    expect(r).toMatchObject({ updated: 1, skippedTransfers: 0, needsChoice: 1 });
    expect((await d.txns.get(back))!.project).toBeUndefined();
  });

  it('the full reversal case through the database', async () => {
    const { d, project, cm, add } = await setup();
    const dep = await add(-3000), back = await add(3000);
    await setTxnProject(d, dep, { projectId: project, commitmentId: cm });
    await setTxnProject(d, back, { projectId: project, commitmentId: cm, effect: 'reversal' });
    const s = (await loadProjectSummary(d, project))!;
    expect(s.paidCents).toBe(0);
    expect(s.leftToPayCents).toBe($(19000));
  });

  it('tags one split, and removing splits by a bulk category change says so', async () => {
    const { d, project, ln, add } = await setup();
    const t = await add(-300, { splits: [{ categoryId: 1, amountCents: $(-240) }, { categoryId: 2, amountCents: $(-60) }] });
    await setTxnProject(d, t, { projectId: project, budgetLineId: ln }, { splitIndex: 0 });
    expect((await loadProjectSummary(d, project))!.paidCents).toBe($(240));
    const res = await bulkSetCategory(d, [t], 5);
    expect(res.splitProjectRefsDropped).toBe(1);
    expect((await loadProjectSummary(d, project))!.paidCents).toBe(0);
  });

  it('bulk tagging skips transfers and counts them', async () => {
    const { d, a, b, project, add } = await setup();
    const { fromTxnId } = await createTransfer(d, { fromAccountId: a, toAccountId: b, date: '2026-11-01', amountCents: $(10) });
    const x = await add(-1), y = await add(-2);
    const r = await bulkSetTxnProject(d, [x, y, fromTxnId], { projectId: project });
    expect(r).toMatchObject({ updated: 2, skippedTransfers: 1 });
    expect((await loadProjectSummary(d, project))!.paidCents).toBe($(3));
  });

  it('a split pointing at another project is not counted here', async () => {
    const { d, project, other, add } = await setup();
    await add(-100, { project: { projectId: project }, splits: [{ categoryId: 1, amountCents: $(-60), project: { projectId: other } }, { categoryId: 2, amountCents: $(-40) }] });
    expect((await loadProjectSummary(d, project))!.paidCents).toBe($(40));
    expect((await loadProjectSummary(d, other))!.paidCents).toBe($(60));
  });
});

describe('nothing else changes', () => {
  it('spending reports give the same answer with and without project tags', async () => {
    const { d, project, add } = await setup();
    await add(-1234, { categoryId: 7 });
    await add(-500, { categoryId: 8 });
    const cats = [{ id: 7, groupId: 1, name: 'Home', kind: 'expense' as const }, { id: 8, groupId: 1, name: 'Food', kind: 'expense' as const }];
    const before = spendingSnapshot(await d.txns.toArray(), cats, '2026-11');
    for (const t of await d.txns.toArray()) await setTxnProject(d, t.id!, { projectId: project });
    const after = spendingSnapshot(await d.txns.toArray(), cats, '2026-11');
    expect(after).toEqual(before);
  });

  it('the project field survives backup, restore and the sync snapshot', async () => {
    const { d, project, add } = await setup();
    const t = await add(-77);
    await setTxnProject(d, t, { projectId: project });
    expect((await snapshotOf(d)).tables.txns[String(t)]).toMatchObject({ project: { projectId: project } });
    const target = fresh();
    await target.open();
    await importAll(target, JSON.parse(JSON.stringify(await exportAll(d))));
    expect((await target.txns.get(t))!.project).toEqual({ projectId: project });
  });
});
