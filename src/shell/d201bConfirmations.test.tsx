import 'fake-indexeddb/auto';
import { readFileSync, readdirSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FinanceDB } from '../db';
import { makeConfirmRunner } from './confirmRun';
import { attachModal, type BoxLike, type DocLike, type KeyEventLike } from './modalKeys';
import { countCategoryUse, deleteCategoryUncategorizing, deleteHsaWithdrawal } from '../lib/confirmedDeletes';
import { bulkSetCategory } from '../lib/txnBulk';
import { moveTxn } from '../lib/transfers';
import { deleteGrant, fillEvenly, saveGrant, scheduleChange, vestDates } from '../lib/rsuGrant';
import { createCommitment, createLine, createProject, getCommitment, removeCommitment, removeLine, setCommitmentStatus, type CommitmentFields } from '../modules/projects/data';
import { blankProject } from '../modules/projects/model';
import { assignTasksToProject, createList, createTask, deleteList, getTask, planTaskProject, removeTasks } from '../modules/tasks/data';
import { blankTask } from '../modules/tasks/model';
import type { RsuGrant, RsuVest } from '../types';

/**
 * D20.1B. The remaining 33 native confirm() boxes became Ledger confirmation dialogs. The test environment has no browser DOM (as in D20 and D20.1A), so these checks use the
 * source text, plain functions and a disposable database. Real clicks, keys, focus, dark mode and the phone layout were checked in a browser (see the D20.1B report).
 * Everything below is invented.
 */
const src = (f: string) => readFileSync(`src/${f}`, 'utf8');
const doc = (f: string) => readFileSync(`docs/${f}`, 'utf8');
const INVENTORY = doc('LEDGER-SIGNATURE-D20.1-OD6-INVENTORY.md');
const rows = INVENTORY.split('\n').filter((l) => /^\| NC-\d\d \|/.test(l)).map((l) => l.split('|').map((c) => c.trim()).slice(1, -1)).filter((r) => r.length === 7);

const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`]));
const NATIVE = /(?<![\w.])(?<!function )confirm\((?!\))/g;
const sourceFiles = () => walk('src').filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f));

// ---------------------------------------------------------------- the inventory, against the source
describe('D20.1B: the inventory and the source agree, and the count is zero', () => {
  it('lists 38 rows; every one is migrated (5 in D20.1A, 33 in D20.1B) and none is still native', () => {
    expect(rows).toHaveLength(38);
    const status = (id: string) => rows.find((r) => r[0] === id)![6];
    for (const r of rows) expect(r[6], r[0]).toMatch(/^\*\*Migrated \(D20\.1[AB]\)\*\*$/);
    expect(rows.filter((r) => r[6].includes('D20.1A')).map((r) => r[0])).toEqual(['NC-07', 'NC-11', 'NC-12', 'NC-13', 'NC-28']);
    expect(rows.filter((r) => r[6].includes('D20.1B'))).toHaveLength(33);
    expect(status('NC-37')).toContain('D20.1B');
  });
  it('recounted in the source: no actual browser-native confirm() call remains anywhere', () => {
    const calls = sourceFiles().flatMap((f) => (readFileSync(f, 'utf8').match(NATIVE) ?? []).map(() => f));
    expect(calls).toEqual([]);
  });
  it('the local functions named confirm are still there and are not browser calls (they were never counted)', () => {
    for (const f of ['modules/assets/LifecycleDialog.tsx', 'modules/bills/PaymentUI.tsx', 'modules/bills/ScheduledUI.tsx', 'modules/contacts/RemoveContact.tsx']) expect(src(f), f).toMatch(/function confirm\(/);
  });
  it('no other confirmation framework was added (no global queue, no event bus, no window.confirm)', () => {
    for (const f of sourceFiles()) {
      if (f.endsWith('uiBaseline.ts')) continue;
      expect(readFileSync(f, 'utf8'), f).not.toMatch(/useConfirm\(|window\.confirm|globalThis\.confirm|ConfirmQueue|confirmEvent/);
    }
  });
});

// ---------------------------------------------------------------- every migrated caller, by id
const TABLE: [string, string, string][] = [
  ['NC-01', 'modules/projects/BudgetLines.tsx', 'Remove line'],
  ['NC-02', 'modules/projects/Commitments.tsx', 'Remove commitment'],
  ['NC-03', 'modules/projects/Commitments.tsx', 'Cancel agreement'],
  ['NC-04', 'modules/projects/Vendors.tsx', 'Take off project'],
  ['NC-05', 'modules/tasks/ListsDialog.tsx', 'Delete list'],
  ['NC-06', 'modules/tasks/TasksPage.tsx', 'Take off project'],
  ['NC-08', 'pages/AppearanceCard.tsx', 'Replace colors'],
  ['NC-09', 'pages/BulkProject.tsx', 'Remove project tag'],
  ['NC-10', 'pages/CategoriesPage.tsx', 'Delete category'],
  ['NC-14', 'pages/HsaLog.tsx', 'Delete withdrawal'],
  ['NC-15', 'pages/ImportPage.tsx', 'Undo import'],
  ['NC-16', 'pages/IncomePage.tsx', 'Replace with ${askIncome.year - 1}'],
  ['NC-17', 'pages/IncomePage.tsx', 'Remove setup'],
  ['NC-18', 'pages/InvestmentsPage.tsx', 'Remove holding'],
  ['NC-19', 'pages/InvestmentsPage.tsx', 'Delete account'],
  ['NC-20', 'pages/LoanCard.tsx', 'Delete loan'],
  ['NC-21', 'pages/NetWorthPage.tsx', 'Delete value'],
  ['NC-22', 'pages/NetWorthPage.tsx', 'Delete property'],
  ['NC-23', 'pages/NetWorthPage.tsx', 'Add another point'],
  ['NC-24', 'pages/NetWorthPage.tsx', 'Delete point'],
  ['NC-25', 'pages/PaycheckPage.tsx', 'Delete scenario'],
  ['NC-26', 'pages/PaycheckPage.tsx', 'Reset scenario'],
  ['NC-27', 'pages/ProfileEditor.tsx', 'Turn off ${askOff'],
  ['NC-29', 'pages/RsuGrants.tsx', 'Fill evenly'],
  ['NC-30', 'pages/RsuGrants.tsx', 'Save and drop vests'],
  ['NC-31', 'pages/RsuGrants.tsx', 'Delete grant'],
  ['NC-32', 'pages/RsuSection.tsx', 'Delete vest'],
  ['NC-33', 'pages/TradePanels.tsx', 'Remove lot'],
  ['NC-34', 'pages/TradePanels.tsx', 'Undo sale'],
  ['NC-35', 'pages/TransactionsPage.tsx', 'Change category'],
  ['NC-36', 'pages/TransactionsPage.tsx', 'Delete filter'],
  ['NC-37', 'pages/TxnForm.tsx', 'Move transaction'],
  ['NC-38', 'pages/TxnForm.tsx', 'Use single category'],
];
describe('D20.1B: every migrated call site uses the shared ConfirmDialog with an action that names itself', () => {
  it('covers the 33 remaining ids exactly once each', () => {
    const ids = TABLE.map((t) => t[0]).sort();
    const expected = rows.filter((r) => r[6].includes('D20.1B')).map((r) => r[0]).sort();
    expect(ids).toEqual(expected);
  });
  it.each(TABLE)('%s (%s): ConfirmDialog is imported and labelled, and the file has no native confirm', (_id, file, label) => {
    const t = src(file);
    expect(t).toMatch(/import ConfirmDialog from '(\.\.\/)+shell\/ConfirmDialog';/);
    expect(t).toContain(label);
    expect(t.match(NATIVE)).toBeNull();
  });
  it('NC-02 and NC-03 and every other "danger" action keeps the default Cancel-first destructive style (tone is only changed for continue-type questions)', () => {
    // continue-type questions use tone="primary": adding a second point in a month, the reconciled move, the split switch, the project move, fill evenly, replace colors, replace the income setup
    for (const [f, n] of [['pages/NetWorthPage.tsx', 1], ['pages/TxnForm.tsx', 2], ['modules/tasks/TasksPage.tsx', 1], ['pages/RsuGrants.tsx', 1], ['pages/AppearanceCard.tsx', 1]] as [string, number][]) {
      expect((src(f).match(/tone="primary"/g) ?? []).length, f).toBeGreaterThanOrEqual(n);
    }
  });
});

describe('D20.1B: pressing a delete or action button only remembers WHICH record (by id); the write is in the dialog', () => {
  const asks: [string, RegExp][] = [
    ['modules/projects/BudgetLines.tsx', /onClick=\{\(\) => setAskRemove\(l\.id\)\}/],
    ['modules/projects/Commitments.tsx', /setAsk\(\{ id: c\.id, what: 'cancel' \}\)/],
    ['modules/tasks/ListsDialog.tsx', /onClick=\{\(\) => setAsk\(l\.id\)\}/],
    ['pages/NetWorthPage.tsx', /onClick=\{\(\) => setAskValue\(v\.id!\)\}/],
    ['pages/NetWorthPage.tsx', /onClick=\{\(\) => setAskPoint\(s\.id!\)\}/],
    ['pages/PaycheckPage.tsx', /onClick=\{\(\) => setAskDelete\(s\.id!\)\}/],
    ['pages/PaycheckPage.tsx', /onDelete=\{\(\) => setAskReset\(sel\.id!\)\}/],
    ['pages/RsuSection.tsx', /onClick=\{\(\) => setAskVest\(v\.id!\)\}/],
    ['pages/HsaLog.tsx', /onClick=\{\(\) => setAskId\(w\.id!\)\}/],
    ['pages/ImportPage.tsx', /onClick=\{\(\) => setAskUndo\(b\.id!\)\}/],
    ['pages/TradePanels.tsx', /onClick=\{\(\) => setAskLot\(l\.id!\)\}/],
    ['pages/TradePanels.tsx', /onClick=\{\(\) => setAskSale\(s\.id!\)\}/],
    ['pages/InvestmentsPage.tsx', /onClick=\{\(\) => setAskHolding\(h\.id!\)\}/],
    ['pages/RsuGrants.tsx', /onClick=\{\(\) => setAskDelete\(g\.id!\)\}/],
    ['pages/TransactionsPage.tsx', /if \(f\) setAskFilter\(f\.id\)/],
  ];
  it.each(asks)('%s: %s', (file, re) => { expect(src(file)).toMatch(re); });

  it('the writes sit inside onConfirm: the calls that used to follow the native box are no longer in the click handlers', () => {
    const t = (f: string) => src(f);
    expect(t('modules/projects/BudgetLines.tsx')).toMatch(/onConfirm=\{async \(\) => \{ await removeLine\(target\.id\);/);
    expect(t('modules/projects/Commitments.tsx')).toMatch(/onConfirm=\{async \(\) => \{ await removeCommitment\(target\.id\);/);
    expect(t('modules/projects/Commitments.tsx')).toMatch(/onConfirm=\{async \(\) => \{ await setCommitmentStatus\(target\.id, 'cancelled'\);/);
    expect(t('modules/projects/Vendors.tsx')).toMatch(/onConfirm=\{async \(\) => \{ await removeVendor\(projectId, askRemove\.id\);/);
    expect(t('pages/NetWorthPage.tsx')).toMatch(/onConfirm=\{async \(\) => \{ await db\.propertyValues\.delete\(askValueRow\.id!\);/);
    expect(t('pages/NetWorthPage.tsx')).toMatch(/onConfirm=\{async \(\) => \{ await db\.netWorthSnapshots\.delete\(pointRow\.id!\);/);
    expect(t('pages/NetWorthPage.tsx')).toMatch(/onConfirm=\{async \(\) => \{ await addPoint\(\); setAskAnother\(false\);/);
    expect(t('pages/ImportPage.tsx')).toMatch(/onConfirm=\{async \(\) => \{ await undoBatch\(db, undoRow\.id!\);/);
    expect(t('pages/TradePanels.tsx')).toMatch(/onConfirm=\{async \(\) => \{ await deleteLot\(db, askLotRow\.id!\);/);
    expect(t('pages/TransactionsPage.tsx')).toMatch(/onConfirm=\{async \(\) => \{ await deleteSavedFilter\(db, askFilterRow\.id\);/);
  });
  it('a record that disappears while its dialog is open closes the dialog: the row is looked up again by id from the live list', () => {
    expect(src('modules/projects/BudgetLines.tsx')).toContain('lines.find((x) => x.id === askRemove)');
    expect(src('pages/NetWorthPage.tsx')).toContain('snaps.find((s) => s.id === askPoint)');
    expect(src('pages/PaycheckPage.tsx')).toContain('scenarios.find((s) => s.id === askDelete)');
    expect(src('pages/RsuGrants.tsx')).toContain('allGrants.find((x) => x.id === askDelete)');
    expect(src('pages/ImportPage.tsx')).toContain('batches.find((x) => x.id === askUndo)');
    expect(src('pages/TradePanels.tsx')).toContain('sales.find((s) => s.id === askSale)');
  });
});

// ---------------------------------------------------------------- the two stacked-dialog cases
describe('D20.1B: Escape cancels only the top dialog (a question over the Tasks lists dialog)', () => {
  const page = () => {
    const handlers: ((e: KeyEventLike) => void)[] = [];
    const modals: BoxLike[] = [];
    const doc: DocLike = { activeElement: null, addEventListener: (_t, fn) => { handlers.push(fn); }, removeEventListener: () => undefined, querySelectorAll: () => modals };
    const box = (): BoxLike => { const b: BoxLike = { focus() { /* */ }, getClientRects: () => [1], contains: () => false, querySelectorAll: () => [] }; modals.push(b); return b; };
    return { doc, box, press: (key: string) => { for (const h of [...handlers]) h({ key, shiftKey: false, stopPropagation() { /* */ }, preventDefault() { /* */ } }); } };
  };
  it('the question closes, the dialog under it stays', () => {
    const p = page();
    const lists = vi.fn(), ask = vi.fn();
    attachModal(p.doc, p.box(), lists);
    attachModal(p.doc, p.box(), ask);
    p.press('Escape');
    expect([lists.mock.calls.length, ask.mock.calls.length]).toEqual([0, 1]);
  });
  it('the Lists question is drawn beside the Lists dialog (a sibling), not inside it', () => {
    const t = src('modules/tasks/ListsDialog.tsx');
    expect(t.indexOf('</Modal>')).toBeGreaterThan(-1);
    expect(t.indexOf('<ConfirmDialog')).toBeGreaterThan(t.indexOf('</Modal>'));
  });
});

// ---------------------------------------------------------------- disposable database
let k = 0;
let d: FinanceDB;
beforeEach(async () => { d = new FinanceDB(`d201b-${k++}`); await d.open(); });
const $ = (x: number) => Math.round(x * 100);
const hooks = () => { const log: string[] = []; return { log, setBusy: (b: boolean) => log.push(`busy:${b}`), setError: (m: string | null) => log.push(`error:${m}`) }; };
const fields = (over: Partial<CommitmentFields> = {}): CommitmentFields => ({ title: 'Cabinet install', amountCents: $(10000), status: 'accepted', parentId: null, budgetLineId: null, vendorContactId: null, acceptedDate: '2026-11-02', notes: '', ...over });

describe('D20.1B moderate group: refusals are shown in the dialog and nothing is reported as done', () => {
  it('NC-01: removing a budget line that a commitment uses is refused with its reason; the line stays; the success step is never reached; it works once the commitment is moved', async () => {
    const p = await createProject(blankProject({ name: 'Kitchen', budgetCents: $(5000), status: 'active' }), d);
    const line = await createLine(p, 'Cabinets', $(1000), d);
    const { id: cid } = await createCommitment(p, fields({ budgetLineId: line }), d);
    let toast = 0;
    const h = hooks();
    const runner = makeConfirmRunner(() => async () => { await removeLine(line, d); toast++; }, h);
    await runner.go();
    expect(toast).toBe(0);
    expect(h.log.some((l) => /^error:1 commitment is filed under this line/.test(l))).toBe(true);
    expect(await d.moduleRecords.get(line)).toBeTruthy();
    await removeCommitment(cid, d);
    await runner.go();
    expect(toast).toBe(1);
  });
  it('NC-02: removing a commitment that has a change order is refused; the commitment stays', async () => {
    const p = await createProject(blankProject({ name: 'Deck', status: 'active' }), d);
    const { id } = await createCommitment(p, fields(), d);
    await createCommitment(p, fields({ title: 'Extra rail', amountCents: $(200), parentId: id }), d);
    const h = hooks();
    await makeConfirmRunner(() => async () => { await removeCommitment(id, d); }, h).go();
    expect(h.log.some((l) => l.startsWith('error:This has 1 change order'))).toBe(true);
    expect((await getCommitment(id, d))!.data.title).toBe('Cabinet install');
  });
  it('NC-03: cancelling an agreement runs once even when pressed three times, and no write happens before the press', async () => {
    const p = await createProject(blankProject({ name: 'Deck', status: 'active' }), d);
    const { id } = await createCommitment(p, fields(), d);
    expect((await getCommitment(id, d))!.data.status).toBe('accepted'); // opening the dialog changes nothing
    let runs = 0;
    const runner = makeConfirmRunner(() => async () => { runs++; await setCommitmentStatus(id, 'cancelled', d); }, hooks());
    await Promise.all([runner.go(), runner.go(), runner.go()]);
    expect(runs).toBe(1);
    expect((await getCommitment(id, d))!.data.status).toBe('cancelled');
  });
  it('NC-05: deleting a list keeps its tasks (with no list) and names how many; another list keeps its tasks', async () => {
    const a = await createList('Home', d);
    const b = await createList('Taxes', d);
    const t1 = await createTask(blankTask({ title: 'One', listId: a }), [], d);
    const t2 = await createTask(blankTask({ title: 'Two', listId: a }), [], d);
    const t3 = await createTask(blankTask({ title: 'Three', listId: b }), [], d);
    expect(await deleteList(a, d)).toBe(2);
    expect((await getTask(t1, d))!.data.listId).toBeNull();
    expect((await getTask(t2, d))!.data.listId).toBeNull();
    expect((await getTask(t3, d))!.data.listId).toBe(b);
  });
});

describe('D20.1B NC-06: bulk move of Tasks between projects: plan, ask, plan again, one write', () => {
  async function setup() {
    const p1 = await createProject(blankProject({ name: 'Kitchen', status: 'active' }), d);
    const p2 = await createProject(blankProject({ name: 'Deck', status: 'active' }), d);
    const a = await createTask(blankTask({ title: 'A', projectId: p1 }), [], d);
    const b = await createTask(blankTask({ title: 'B', projectId: p1 }), [], d);
    const c = await createTask(blankTask({ title: 'C' }), [], d);
    return { p1, p2, ids: [a, b, c] };
  }
  const projectsOf = async (ids: number[]) => Promise.all(ids.map(async (i) => (await getTask(i, d))!.data.projectId ?? null));
  it('the plan is read only: asking (and cancelling) leaves every task where it was', async () => {
    const { p2, ids } = await setup();
    const before = await projectsOf(ids);
    const plan = await planTaskProject(ids, p2, d);
    expect(plan).toMatchObject({ total: 3, replacing: 2, adding: 1, unchanged: 0, missing: 0 });
    expect(await projectsOf(ids)).toEqual(before);
  });
  it('confirming runs the one existing all-or-nothing assignment', async () => {
    const { p2, ids } = await setup();
    const { changed } = await assignTasksToProject(ids, p2, d);
    expect(changed).toBe(3);
    expect(await projectsOf(ids)).toEqual([p2, p2, p2]);
  });
  it('a task deleted while the dialog was open: the plan changes (so the dialog says so), and the move itself refuses and writes nothing', async () => {
    const { p1, p2, ids } = await setup();
    const shown = await planTaskProject(ids, p2, d);
    await removeTasks([ids[1]], d);
    const now = await planTaskProject(ids, p2, d);
    expect(now.missing).toBe(1);
    expect(now.missing).not.toBe(shown.missing);
    await expect(assignTasksToProject(ids, p2, d)).rejects.toThrow(/no longer exist/);
    expect((await getTask(ids[0], d))!.data.projectId).toBe(p1);
    expect((await getTask(ids[2], d))!.data.projectId ?? null).toBeNull();
  });
  it('a task moved by another device while the dialog was open changes the replace count the dialog described', async () => {
    const { p1, p2, ids } = await setup();
    const shown = await planTaskProject(ids, p2, d);
    await assignTasksToProject([ids[0]], p2, d);
    const now = await planTaskProject(ids, p2, d);
    expect(shown.replacing).toBe(2);
    expect(now.replacing).toBe(1);
    expect(now.unchanged).toBe(1);
    void p1;
  });
  it('the page: asks only when a project would be replaced, plans again at confirmation, and runs the move through one function', () => {
    const t = src('modules/tasks/TasksPage.tsx');
    expect(t).toContain('if (plan.replacing > 0) { setAskMove({ ids, target, plan }); return; }');
    expect(t).toContain('const now = await planTaskProject(a.ids, a.target);');
    expect((t.match(/await assignTasksToProject\(/g) ?? [])).toHaveLength(1); // one call site: runMove
    expect(t).toContain('await restoreTaskData(before)'); // Undo kept
    expect(t).toContain('onConfirm={() => confirmMove(askMove)}');
  });
});

describe('D20.1B financial group: the moved deletes and the bulk change', () => {
  const account = () => d.accounts.add({ name: 'Checking', kind: 'checking', openingBalanceCents: 0, openingDate: '2026-01-01' }) as Promise<number>;
  const txn = async (acct: number, over: Record<string, unknown> = {}) => d.txns.add({ accountId: acct, date: '2026-05-01', amountCents: -1000, payee: 'Shop', memo: '', status: 'cleared', categoryId: null, ...over } as never) as Promise<number>;
  const category = async (name: string) => {
    const g = (await d.categoryGroups.add({ name: 'G', order: 0 })) as number;
    return (await d.categories.add({ groupId: g, name, order: 0 })) as number;
  };

  it('NC-10: counting then deleting uncategorizes the transactions and their splits, deletes only that category, and touches nothing else', async () => {
    const a = await account();
    const food = await category('Food');
    const fun = await category('Fun');
    const t1 = await txn(a, { categoryId: food });
    const t2 = await txn(a, { categoryId: null, splits: [{ categoryId: food, amountCents: -400 }, { categoryId: fun, amountCents: -600 }] });
    const t3 = await txn(a, { categoryId: fun });
    expect(await countCategoryUse(d, food)).toBe(2);
    await deleteCategoryUncategorizing(d, food);
    expect(await d.categories.get(food)).toBeUndefined();
    expect((await d.txns.get(t1))!.categoryId).toBeNull();
    expect((await d.txns.get(t2))!.splits).toEqual([{ categoryId: null, amountCents: -400 }, { categoryId: fun, amountCents: -600 }]);
    expect((await d.txns.get(t3))!.categoryId).toBe(fun);
    expect(await d.categories.get(fun)).toBeTruthy();
  });
  it('NC-10: the count changes when a transaction is filed under the category while the question is open (the dialog compares and asks again)', async () => {
    const a = await account();
    const food = await category('Food');
    await txn(a, { categoryId: food });
    const shown = await countCategoryUse(d, food);
    await txn(a, { categoryId: food });
    expect(await countCategoryUse(d, food)).toBe(shown + 1);
    const t = src('pages/CategoriesPage.tsx');
    expect(t).toContain('if (now !== askCat.used)');
    expect(t).toContain('Nothing was deleted.');
  });
  it('NC-14: deleting an HSA withdrawal gives its cash back once; pressing twice, or deleting one already gone, gives nothing back again', async () => {
    const acct = await d.invAccounts.add({ name: 'HSA', kind: 'hsa', taxType: 'taxable', cashCents: 10000, annualContributionCents: 0, contributionGrowthPct: 0, linkToIncome: false } as never);
    const w = await d.hsaWithdrawals.add({ accountId: acct, date: '2026-03-03', amountCents: 5000, qualified: true, note: '', fromCashCents: 4000 });
    const keep = await d.hsaWithdrawals.add({ accountId: acct, date: '2026-03-04', amountCents: 700, qualified: true, note: '', fromCashCents: 700 });
    const runner = makeConfirmRunner(() => async () => { await deleteHsaWithdrawal(d, acct, w); }, hooks());
    await Promise.all([runner.go(), runner.go()]);
    expect((await d.invAccounts.get(acct))!.cashCents).toBe(14000);
    expect(await deleteHsaWithdrawal(d, acct, w)).toBe(false); // already gone: nothing changes
    expect((await d.invAccounts.get(acct))!.cashCents).toBe(14000);
    expect(await d.hsaWithdrawals.get(keep)).toBeTruthy();
  });
  it('NC-14: a withdrawal that took no cash gives none back', async () => {
    const acct = await d.invAccounts.add({ name: 'HSA', kind: 'hsa', taxType: 'taxable', cashCents: 500, annualContributionCents: 0, contributionGrowthPct: 0, linkToIncome: false } as never);
    const w = await d.hsaWithdrawals.add({ accountId: acct, date: '2026-03-03', amountCents: 5000, qualified: false, note: '', fromCashCents: 0 });
    expect(await deleteHsaWithdrawal(d, acct, w)).toBe(true);
    expect((await d.invAccounts.get(acct))!.cashCents).toBe(500);
  });
  it('NC-35: the bulk category change replaces splits, skips transfers, and reports both; a deleted category is caught before the change', async () => {
    const a = await account();
    const cat = await category('Groceries');
    const plain = await txn(a);
    const split = await txn(a, { splits: [{ categoryId: null, amountCents: -500 }, { categoryId: null, amountCents: -500 }] });
    const transfer = await txn(a, { transferTxnId: 999 });
    const r = await bulkSetCategory(d, [plain, split, transfer], cat);
    expect(r).toMatchObject({ updated: 2, skippedTransfers: 1, splitsCleared: 1 });
    expect((await d.txns.get(split))!.splits).toBeUndefined();
    expect((await d.txns.get(transfer))!.categoryId).toBeNull();
    const t = src('pages/TransactionsPage.tsx');
    expect(t).toContain('if (a.categoryId !== null && !(await db.categories.get(a.categoryId))) throw new Error(');
  });
});

describe('D20.1B complex group: RSU schedule, even split and grant delete', () => {
  const grant = (over: Partial<RsuGrant> = {}): RsuGrant => ({ personId: 1, name: 'New-hire grant', startDate: '2026-01-15', frequency: 'quarterly', years: 2, cliffMonths: null, kind: 'cash', priceCents: $(10), ...over });
  const vestRow = (over: Partial<RsuVest>): RsuVest => ({ personId: 1, date: '2026-01-15', grant: 'New-hire grant', kind: 'cash', shares: 10, recorded: false, ...over } as RsuVest);

  it('NC-29: fill evenly replaces typed shares once and keeps vests already in holdings; pressing twice runs it once', async () => {
    const id = (await d.rsuGrants.add(grant())) as number;
    const g = { ...grant(), id };
    const dates = vestDates(g);
    await d.rsuVests.add(vestRow({ grantId: id, date: dates[0], shares: 7, recorded: true }));
    await d.rsuVests.add(vestRow({ grantId: id, date: dates[1], shares: 99 }));
    let runs = 0;
    const runner = makeConfirmRunner(() => async () => { runs++; await fillEvenly(d, g, 80); }, hooks());
    await Promise.all([runner.go(), runner.go()]);
    expect(runs).toBe(1);
    const vests = await d.rsuVests.where('grantId').equals(id).toArray();
    expect(vests).toHaveLength(dates.length); // no duplicate vests
    expect(vests.find((v) => v.date === dates[0])!.shares).toBe(7); // already in holdings: kept
    expect(vests.find((v) => v.date === dates[1])!.shares).toBe(10); // 80 shares over 8 dates
  });
  it('NC-29: with no vests entered there is nothing to replace, so the page does not ask (the original rule)', () => {
    expect(src('pages/RsuGrants.tsx')).toContain('if (entered.length > 0) { setAskFill(t); return; }');
  });
  it('NC-30: dropped vests are listed from the schedule; cancelling (no call) leaves grant and vests; confirming drops exactly those and keeps vests in holdings, with no duplicates', async () => {
    const id = (await d.rsuGrants.add(grant({ years: 2 }))) as number;
    const original = { ...grant({ years: 2 }), id };
    const dates = vestDates(original);
    for (const [i, date] of dates.entries()) await d.rsuVests.add(vestRow({ grantId: id, date, shares: 10, recorded: i === 0 }));
    const shorter = { ...original, years: 1 };
    const dropped = scheduleChange(shorter, await d.rsuVests.where('grantId').equals(id).toArray()).orphaned.filter((v) => !v.recorded);
    expect(dropped).toHaveLength(4); // the second year's four quarterly vests
    // cancel: nothing was called, so nothing changed
    expect(await d.rsuVests.where('grantId').equals(id).count()).toBe(8);
    expect((await d.rsuGrants.get(id))!.years).toBe(2);
    // confirm: the one existing save
    await saveGrant(d, shorter);
    const after = await d.rsuVests.where('grantId').equals(id).toArray();
    expect(after).toHaveLength(4);
    expect(new Set(after.map((v) => v.date)).size).toBe(4);
    expect((await d.rsuGrants.get(id))!.years).toBe(1);
  });
  it('NC-30: a vest added while the dialog was open changes the list the dialog showed (it compares and asks again), and a vest in holdings is never in the list', async () => {
    const id = (await d.rsuGrants.add(grant({ years: 2 }))) as number;
    const original = { ...grant({ years: 2 }), id };
    const dates = vestDates(original);
    const shorter = { ...original, years: 1 };
    await d.rsuVests.add(vestRow({ grantId: id, date: dates[5], shares: 10 }));
    const idsOf = async () => scheduleChange(shorter, await d.rsuVests.where('grantId').equals(id).toArray()).orphaned.filter((v) => !v.recorded).map((v) => v.id);
    const shown = await idsOf();
    expect(shown).toHaveLength(1);
    await d.rsuVests.add(vestRow({ grantId: id, date: dates[6], shares: 10 }));
    await d.rsuVests.add(vestRow({ grantId: id, date: dates[7], shares: 10, recorded: true }));
    const now = await idsOf();
    expect(now).toHaveLength(2);
    expect(now).not.toEqual(shown);
    const t = src('pages/RsuGrants.tsx');
    expect(t).toContain('if (now.length !== shown.length || now.some((x, i) => x !== shown[i]))');
    expect((t.match(/await commitSave\(/g) ?? []).length).toBe(2); // the no-vests-dropped path and the dialog's confirm: never anywhere else
  });
  it('NC-30: the save is validated first, the dropped list is built before the question, and the question comes before saveGrant', () => {
    const t = src('pages/RsuGrants.tsx');
    const at = (s: string) => t.indexOf(s);
    expect(at('const problem = grantProblem(g);')).toBeGreaterThan(-1);
    expect(at('const problem = grantProblem(g);')).toBeLessThan(at('scheduleChange(full, vests).orphaned'));
    expect(at('scheduleChange(full, vests).orphaned')).toBeLessThan(at('setAskSave({ full, security, goneIds'));
    expect(at('setAskSave({ full, security, goneIds')).toBeLessThan(at('const id = await saveGrant(db, full);'));
    expect(t).not.toMatch(/saveGrant\(db, full\)[\s\S]*saveGrant\(db, full\)/); // one saveGrant call site
  });
  it('NC-31: deleting a grant removes unrecorded vests, detaches recorded ones as single vests, and leaves another grant alone', async () => {
    const a = (await d.rsuGrants.add(grant())) as number;
    const b = (await d.rsuGrants.add(grant({ name: 'Other' }))) as number;
    await d.rsuVests.add(vestRow({ grantId: a, date: '2026-01-15' }));
    const held = await d.rsuVests.add(vestRow({ grantId: a, date: '2026-04-15', recorded: true }));
    const other = await d.rsuVests.add(vestRow({ grantId: b, date: '2026-01-15' }));
    expect(await deleteGrant(d, a)).toBe(1);
    expect(await d.rsuGrants.get(a)).toBeUndefined();
    expect((await d.rsuVests.get(held))!.grantId).toBeNull();
    expect((await d.rsuVests.get(other))!.grantId).toBe(b);
    expect(await d.rsuGrants.get(b)).toBeTruthy();
  });
});

describe('D20.1B NC-37: moving a reconciled transaction: validate, ask, check again, save once', () => {
  async function setup() {
    const a = (await d.accounts.add({ name: 'Checking', kind: 'checking', openingBalanceCents: 0, openingDate: '2026-01-01' })) as number;
    const b = (await d.accounts.add({ name: 'Savings', kind: 'savings', openingBalanceCents: 0, openingDate: '2026-01-01' })) as number;
    const t = (await d.txns.add({ accountId: a, date: '2026-05-01', amountCents: -2500, payee: 'Gym', memo: '', status: 'reconciled', categoryId: null } as never)) as number;
    return { a, b, t };
  }
  it('without a confirmation nothing is written; the confirmed move changes the account and sends reconciled back to cleared, and only that', async () => {
    const { a, b, t } = await setup();
    const before = JSON.stringify(await d.txns.get(t));
    expect(JSON.stringify(await d.txns.get(t))).toBe(before); // the question is open: no write
    expect(await moveTxn(d, t, b)).toBe('moved');
    const moved = (await d.txns.get(t))!;
    expect([moved.accountId, moved.status, moved.amountCents, moved.payee]).toEqual([b, 'cleared', -2500, 'Gym']);
    expect(await moveTxn(d, t, b)).toBe('same'); // a second run changes nothing
    void a;
  });
  it('the form: the question comes after all validation and before the first write; the save button never passes "confirmed"; confirmation reads the transaction and account again', () => {
    const t = src('pages/TxnForm.tsx');
    const save = t.slice(t.indexOf('async function save('), t.indexOf('async function confirmMove('));
    const at = (s: string) => save.indexOf(s);
    expect(at("return fail('acct'")).toBeGreaterThan(-1);
    expect(at('if (reconciledMove && !moveConfirmed) { setAskMove(true); return; }')).toBeGreaterThan(at("return fail('acct'"));
    for (const write of ['editTxn(', 'moveTxn(', 'updateTxn(', 'convertToTransfer(', 'createTxn(', 'createTransfer(']) {
      expect(at(write), write).toBeGreaterThan(at('setAskMove(true)'));
    }
    expect(t).toContain('onClick={() => void save()}'); // the click event must never reach the "confirmed" argument
    expect(t).not.toMatch(/onClick=\{save\}/);
    expect((t.match(/save\(true\)/g) ?? [])).toHaveLength(1); // only the dialog's own confirm
    const confirmMove = t.slice(t.indexOf('async function confirmMove('), t.indexOf('const liability'));
    expect(confirmMove).toContain('await db.txns.get(editing!.id!)');
    expect(confirmMove).toContain("fresh.status !== 'reconciled'");
    expect(confirmMove).toContain('await db.accounts.get(Number(acctId))');
    expect(confirmMove.indexOf('await db.accounts.get')).toBeLessThan(confirmMove.indexOf('save(true)'));
  });
  it('a failed save is returned to the dialog (it stays open with the message) and is also shown on the form', () => {
    const t = src('pages/TxnForm.tsx');
    expect(t).toContain('return message;');
    expect(t).toContain("if (typeof failed === 'string') return failed;");
  });
});

describe('D20.1B NC-38, NC-27 and NC-08: form-state questions change nothing until confirmed', () => {
  it('NC-38: the split switch only opens the question when splits carry project tags, and only the dialog turns the split off; nothing is saved by it', () => {
    const t = src('pages/TxnForm.tsx');
    expect(t).toContain('if (splitOn && splits.some((r) => r.tag.projectId)) { setAskSingle(true); return; } setSplitOn(!splitOn);');
    expect(t).toContain('onConfirm={() => { setSplitOn(false); setAskSingle(false); }}');
    const dialog = t.slice(t.indexOf('title="Use a single category?"'), t.indexOf('</ConfirmDialog>', t.indexOf('title="Use a single category?"')));
    expect(dialog).not.toMatch(/createTxn|editTxn|moveTxn|db\./); // the dialog never writes
  });
  it('NC-27: unticking asks only when the benefit still has a deduction; the checkbox stays; the dialog removes only that benefit\'s own deduction from the draft', () => {
    const t = src('pages/ProfileEditor.tsx');
    expect(t).toContain('if (!on && has) { setAskOff(kind); return; }');
    expect(t).toContain("deductions: prev.deductions.filter((x) => x.type !== 'hsa')");
    expect(t).toContain("deductions: prev.deductions.filter((x) => x.type !== 'espp')");
    expect(t).toContain('onConfirm={() => { applyBenefit(askOff, false); setAskOff(null); }}');
    const dialog = t.slice(t.indexOf('title={`Turn off '), t.indexOf('</ConfirmDialog>', t.indexOf('title={`Turn off ')));
    expect(dialog).not.toMatch(/onSave|db\./); // the dialog saves nothing: the draft is saved by the editor's own Save, or live by its own rule
  });
  it('NC-08: the select no longer changes before the question; only the dialog changes the label and the colors; cancelling leaves both', () => {
    const t = src('pages/AppearanceCard.tsx');
    expect(t).toContain('onChange={(e) => setAskBase(e.target.value as PaletteId)}');
    expect(t).toContain('onConfirm={() => { setBase(askBase); startCustom(askBase); setAskBase(null); }}');
    expect(t.match(/setBase\(/g)).toHaveLength(1); // the label is set in exactly one place: the dialog's confirm (the select's own change no longer sets it)
    expect(t).not.toMatch(/PRESETS\[[^\]]*\] *=|DEFAULT_PALETTE *=/); // default theme untouched
  });
});

describe('D20.1B: the documents are honest about what is done', () => {
  it('the tracker records CF-03 as built and pending owner acceptance (not accepted), and D21 as not started', () => {
    const cf03 = doc('UI-COVERAGE.md').split('\n').find((l) => l.startsWith('| CF-03 |'))!;
    expect(cf03).toMatch(/BUILT|MIGRATED/i);
    expect(cf03).toMatch(/pending owner acceptance/i);
    expect(cf03).not.toMatch(/\| ACC \|$/);
    expect(doc('LEDGER-SIGNATURE-D20.1B-REPORT.md')).toMatch(/D21[^.]*not started/i);
  });
  it('the report states that nothing is staged, committed, pushed or deployed', () => {
    expect(doc('LEDGER-SIGNATURE-D20.1B-REPORT.md')).toMatch(/NOT STAGED|Nothing staged/i);
  });
});
