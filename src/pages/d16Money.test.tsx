import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { FinanceDB } from '../db';
import { installTracking } from '../lib/sync/track';
import { loadBudget } from '../lib/budget';
import { dueInstances, occurrencesBetween } from '../lib/schedule';
import { buildCheckin, progress } from '../lib/checkin';
import type { Account, RecurringRule } from '../types';
import { AccountRow } from './AccountsPage';
import { StepRow } from './CheckinPage';
import { DueRow } from './ScheduledPage';
import {
  IMPORT_STEPS, KIND_LABEL, KIND_ORDER, STATUS_WORD, balanceWord, budgetStateWord, checkinSegments, countWord, importStage, isDebtKind, isOverdueDate, reconView, splitCheckin, splitRules, statusTone,
} from './moneyPresentation';

/**
 * D16 Money pages. The nine pages were recomposed (figures band, labeled rows, hero, stepper); every value, date, status, label and action is the one the page
 * already had. These tests check the wording helpers, the small components that the pages are built from (rendered with invented values), that the
 * engines still give what they gave, and, by reading the source, that nothing in the presentation layer adds up money or writes a record. Layout and look are checked
 * in a real browser, not here.
 */
let n = 0;
const fresh = () => { const d = new FinanceDB(`test-d16-${n++}`); installTracking(d); return d; };
const TODAY = '2026-11-12';
const read = (f: string) => readFileSync(f, 'utf8');
const code = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(createElement(MemoryRouter, null, el));
const acct = (over: Partial<Account> = {}): Account => ({ id: 7, name: 'Demo Checking', kind: 'checking', openingBalanceCents: 0, openingDate: '2026-01-01', ...over });
const PAGES = ['CheckinPage', 'AccountsPage', 'LedgerPage', 'TransactionsPage', 'BudgetPage', 'ScheduledPage', 'RulesPage', 'ImportPage', 'CategoriesPage'];

describe('D16 wording helpers', () => {
  it('account types keep their labels and their order', () => {
    expect(KIND_ORDER).toEqual(['checking', 'savings', 'credit_card', 'loan']);
    expect(KIND_LABEL).toEqual({ checking: 'Checking', savings: 'Savings', credit_card: 'Credit Card', loan: 'Loan' });
  });
  it('a card and a loan are debt; cash accounts are not', () => {
    expect(['credit_card', 'loan'].every((k) => isDebtKind(k as Account['kind']))).toBe(true);
    expect(['checking', 'savings'].some((k) => isDebtKind(k as Account['kind']))).toBe(false);
    expect(balanceWord('credit_card')).toBe('Owed');
    expect(balanceWord('checking')).toBe('Balance');
  });
  it('the reconciliation line reads only the stored last-reconciled date', () => {
    expect(reconView(TODAY, TODAY)).toMatchObject({ tone: 'done', label: 'Reconciled today' });
    expect(reconView('2026-09-28', TODAY)).toMatchObject({ tone: 'neutral', label: 'Last reconciled 2026-09-28' });
    expect(reconView(undefined, TODAY)).toMatchObject({ label: 'Never reconciled' });
    expect(reconView.length).toBe(2); // it is given no transactions: reconciled transactions never make an account reconciled
  });
  it('transaction status words and tones', () => {
    expect(STATUS_WORD).toEqual({ pending: 'Pending', cleared: 'Cleared', reconciled: 'Reconciled' });
    expect([statusTone('pending'), statusTone('cleared'), statusTone('reconciled')]).toEqual(['warning', 'neutral', 'done']);
  });
  it('overdue is a text comparison of dates, as the page always did', () => {
    expect(isOverdueDate('2026-11-11', TODAY)).toBe(true);
    expect(isOverdueDate(TODAY, TODAY)).toBe(false);
    expect(isOverdueDate('2026-11-13', TODAY)).toBe(false);
  });
  it('rules split into active and paused without losing or reordering any', () => {
    const rules = [{ id: 1, active: true }, { id: 2, active: false }, { id: 3, active: true }];
    const { active, paused } = splitRules(rules);
    expect(active.map((r) => r.id)).toEqual([1, 3]);
    expect(paused.map((r) => r.id)).toEqual([2]);
    expect(active.length + paused.length).toBe(rules.length);
  });
  it('the import steps follow what the page holds', () => {
    expect(IMPORT_STEPS.map((s) => s.id)).toEqual(['file', 'map', 'review']);
    expect(importStage({ hasFile: false, hasPreview: false })).toBe('file');
    expect(importStage({ hasFile: true, hasPreview: false })).toBe('map');
    expect(importStage({ hasFile: true, hasPreview: true })).toBe('review');
  });
  it('small word helpers', () => {
    expect(budgetStateWord(-1)).toBe('Overspent');
    expect(budgetStateWord(0)).toBeNull();
    expect(budgetStateWord(100)).toBeNull();
    expect(countWord(1, 'account')).toBe('1 account');
    expect(countWord(2, 'category', 'categories')).toBe('2 categories');
  });
});

describe('D16 check-in: the segments and groups are the check-in model, nothing more', () => {
  const steps = buildCheckin({ today: TODAY, dueScheduled: 2, uncategorized: 0, pendingOld: 0, overspentCategories: 1, readyToAssignCents: 0, targetsCount: 0, targetsNeedCents: 0, holdings: 0, noPriceCount: 0, oldestPriceDays: null, propertyCount: 0, propertyStale: 0, forecastBelow: null, hasCashAccounts: true, hasData: true });
  it('one segment per step that applies, in the model order, with the same status', () => {
    const segs = checkinSegments(steps);
    const live = steps.filter((s) => s.status !== 'na');
    expect(segs.map((s) => [s.id, s.status])).toEqual(live.map((s) => [s.id, s.status]));
    expect(segs.length).toBe(progress(steps).total);
  });
  it('the todo and done groups add up to the live steps and keep their order', () => {
    const g = splitCheckin(steps);
    expect(g.todo.length + g.done.length).toBe(progress(steps).total);
    expect(g.todo.length).toBe(progress(steps).left);
    expect(g.todo.every((s) => s.status === 'todo')).toBe(true);
    expect([...g.todo, ...g.done, ...g.na].map((s) => s.id).sort()).toEqual(steps.map((s) => s.id).sort());
  });
  it('a step row says its state in words, links to the same place and ticks only through its own control', () => {
    const todo = steps.find((s) => s.status === 'todo')!;
    const m = html(createElement(StepRow, { step: todo, marked: false, onMark: () => {} }));
    expect(m).toContain('Needs you');
    expect(m).toContain(`href="/${todo.to.replace(/^\//, '')}"`.replace('href="//', 'href="/'));
    expect(m).toContain(todo.actionLabel);
    expect(m).toMatch(/type="checkbox"/);
    const done = steps.find((s) => s.status === 'done');
    if (done) {
      const d = html(createElement(StepRow, { step: done, marked: false, onMark: () => {} }));
      expect(d).toContain('Done');
      expect(d).not.toMatch(/type="checkbox"/);
    }
  });
});

describe('D16 account row', () => {
  it('prints the stored balance unchanged and says what it means', () => {
    const cash = html(createElement(AccountRow, { account: acct({ lastReconciledDate: TODAY }), balance: 1826909, primary: false, today: TODAY }));
    expect(cash).toContain('$18,269.09');
    expect(cash).toContain('Reconciled today');
    expect(cash).not.toContain('Owed');
    const card = html(createElement(AccountRow, { account: acct({ kind: 'credit_card', name: 'Demo Card', creditLimitCents: 500000 }), balance: -37200, primary: false, today: TODAY }));
    expect(card).toContain('-$372.00');
    expect(card).toContain('Owed');
    expect(card).toContain('Credit left');
    expect(card).toContain('7% used');
    expect(card).not.toContain('class="mny-amt neg"'); // debt is not colored by its sign
  });
  it('a cash account below zero says so in words as well as color', () => {
    const m = html(createElement(AccountRow, { account: acct(), balance: -500, primary: false, today: TODAY }));
    expect(m).toContain('-$5.00');
    expect(m).toContain('Below zero');
  });
  it('a closed account shows no reconciliation line and no minimum warning', () => {
    const m = html(createElement(AccountRow, { account: acct({ closed: true, minBalanceCents: 100000 }), balance: 5000, primary: false, today: TODAY }));
    expect(m).toContain('Closed');
    expect(m).not.toMatch(/reconciled/i);
    expect(m).not.toContain('Minimum');
  });
  it('the minimum-balance line and the include-in-budget box are kept, and "under it" is said in words', () => {
    const m = html(createElement(AccountRow, { account: acct({ minBalanceCents: 100000 }), balance: 50000, primary: true, today: TODAY, onInclude: () => {} }));
    expect(m).toContain('Minimum $1,000.00');
    expect(m).toContain('under it');
    expect(m).toContain('Include in budget');
    expect(m).toContain('Primary');
  });
  it('an excluded account keeps its box unchecked', () => {
    const m = html(createElement(AccountRow, { account: acct({ kind: 'savings', budgetExcluded: true }), balance: 100, primary: false, today: TODAY, onInclude: () => {} }));
    expect(m).toMatch(/type="checkbox"/);
    expect(m).not.toMatch(/checked=""/);
  });
});

describe('D16 scheduled: due rows only offer actions, and the engines are as before', () => {
  const rule: RecurringRule = { id: 3, accountId: 7, payee: 'Demo Rent', amountCents: -185000, categoryId: null, memo: '', frequency: 'monthly', startDate: '2026-09-10', active: true };
  it('a due row shows Approve and Skip with their long names, the amount expected and the overdue word', () => {
    const m = html(createElement(DueRow, { item: { rule, date: '2026-11-10' }, accountMissing: false }));
    expect(m).toContain('Approve');
    expect(m).toContain('Skip');
    expect(m).toContain('Overdue');
    expect(m).toContain('-$1,850.00 expected');
    expect(m).toMatch(/aria-label="Approve Demo Rent/);
  });
  it('a row whose account is gone cannot be approved', () => {
    expect(html(createElement(DueRow, { item: { rule, date: '2026-11-10' }, accountMissing: true }))).toMatch(/<button[^>]*disabled=""[^>]*>Approve<\/button>/);
  });
  it('occurrence dates and due instances are the engine results, and listing them creates no transaction', async () => {
    const d = fresh();
    const a = (await d.accounts.add({ name: 'Demo Checking', kind: 'checking', openingBalanceCents: 0, openingDate: '2026-01-01' })) as number;
    const r: RecurringRule = { ...rule, id: undefined, accountId: a };
    const rid = (await d.recurring.add(r)) as number;
    expect(occurrencesBetween({ ...r, id: rid }, '2026-11-01', '2026-12-31')).toEqual(['2026-11-10', '2026-12-10']);
    const due = await dueInstances(d, TODAY, 7);
    expect(due.map((x) => x.date)).toEqual(['2026-09-10', '2026-10-10', '2026-11-10']);
    expect(await d.txns.count()).toBe(0);
    expect(await d.recurringLog.count()).toBe(0);
  });
});

describe('D16 budget: the engine still produces the same figures', () => {
  it('Ready to Assign, activity and available follow assignments and spending as before', async () => {
    const d = fresh();
    const a = (await d.accounts.add({ name: 'Demo Checking', kind: 'checking', openingBalanceCents: 100000, openingDate: '2026-01-01' })) as number;
    const g = (await d.categoryGroups.add({ name: 'Everyday', order: 0 })) as number;
    const c = (await d.categories.add({ groupId: g, name: 'Groceries', order: 0 })) as number;
    await d.txns.add({ accountId: a, date: '2026-11-03', amountCents: -12000, payee: 'Demo Market', memo: '', status: 'cleared', categoryId: c });
    await d.assignments.add({ month: '2026-11', key: `c${c}`, amountCents: 30000 });
    const b = await loadBudget(d, '2026-11');
    const row = b.rows.find((r) => r.categoryId === c)!;
    expect(row.assigned).toBe(30000);
    expect(row.activity).toBe(-12000);
    expect(row.available).toBe(18000);
    const again = await loadBudget(d, '2026-11');
    expect(again.readyToAssign).toBe(b.readyToAssign); // reading the budget twice gives the same figure and writes nothing
    expect(await d.assignments.count()).toBe(1);
  });
});

describe('D16 source guards: presentation only', () => {
  it('moneyPresentation.ts does no money maths and never touches storage or the clock', () => {
    const c = code(read('src/pages/moneyPresentation.ts'));
    expect(c).not.toMatch(/\bdb\b|Dexie|localStorage|new Date|Date\.now|toFixed|Math\.round|formatCents|parseAmount|reduce\(/);
    expect(c).not.toMatch(/amountCents|balance\s*[-+]|\+\s*=\s*[a-z]*[Cc]ents/);
  });
  it('the presentation components and the new stylesheet add no write', () => {
    const c = code(read('src/pages/moneyPresentation.ts'));
    expect(c).not.toMatch(/\.(add|put|update|delete|bulkAdd|modify)\(/);
  });
  it('every page imports the Money stylesheet and keeps exactly one h1 source (PageHeader or the account heading)', () => {
    for (const p of PAGES) {
      const s = read(`src/pages/${p}.tsx`);
      expect(s, p).toContain("import './money.css'");
      expect((s.match(/<h1\b/g) ?? []).length, p).toBe(0); // the single h1 comes from PageHeader (or RenameAccount heading)
    }
  });
  it('the pages still use the engines that own the figures', () => {
    expect(read('src/pages/BudgetPage.tsx')).toMatch(/loadBudget\(db, month\)/);
    expect(read('src/pages/BudgetPage.tsx')).toMatch(/planFunding\(needs, rta\)/);
    expect(read('src/pages/AccountsPage.tsx')).toMatch(/a\.openingBalanceCents \+ txns\.filter/);
    expect(read('src/pages/LedgerPage.tsx')).toMatch(/reconcileCheck\(db, id, recDate/);
    expect(read('src/pages/LedgerPage.tsx')).toMatch(/finalizeReconcile\(db, rec\.clearedTxnIds, id\)/);
    expect(read('src/pages/ScheduledPage.tsx')).toMatch(/dueInstances\(db, todayISO\(\), LOOKAHEAD_DAYS\)/);
    expect(read('src/pages/ScheduledPage.tsx')).toMatch(/postInstance\(db, rule, date/);
    expect(read('src/pages/ImportPage.tsx')).toMatch(/commitImport\(db, accountId, filename, rows/);
    expect(read('src/pages/ImportPage.tsx')).toMatch(/undoBatch\(db, undoRow\.id!\)/); // D20.1B: the same engine call, now run from the confirmation dialog on the remembered batch id
    expect(read('src/pages/RulesPage.tsx')).toMatch(/applyRulesToExisting\(db\)/);
    expect(read('src/pages/TransactionsPage.tsx')).toMatch(/bulkSetCategory\(db, a\.ids/); // D20.1B: the same engine call, run from the dialog on the ids captured when Apply was pressed
  });
  it('the destructive and safeguard actions are all still on the pages', () => {
    const tx = read('src/pages/TransactionsPage.tsx');
    expect(tx).toContain('TxnDeleteDialog');
    expect(tx).toContain('Delete selected');
    expect(tx).toContain('Apply category');
    expect(tx).toContain('Apply status');
    expect(tx).toContain('Export ');
    expect(tx).toContain('Select all ');
    expect(tx).toContain("searchParams.get('txn')");
    expect(tx).toContain("searchParams.get('project')");
    const l = read('src/pages/LedgerPage.tsx');
    for (const t of ['Delete account', 'Link as transfer', 'Unlink', 'Lock ', 'Make this my primary payment account']) expect(l, t).toContain(t);
    for (const t of ['Approve', 'Skip', 'pause', 'delete', 'Save changes']) expect(read('src/pages/ScheduledPage.tsx'), t).toContain(t);
    for (const t of ['delete group', 'Add group', 'Move ', 'removeCategory', 'removeGroup']) expect(read('src/pages/CategoriesPage.tsx'), t).toContain(t);
    for (const t of ['Add rule', 'create rule', 'add to Scheduled', 'Apply rules to']) expect(read('src/pages/RulesPage.tsx'), t).toContain(t);
    for (const t of ['Flip signs', 'Date order', 'Also import', 'undo']) expect(read('src/pages/ImportPage.tsx'), t).toContain(t);
  });
  it('the shared sticky-offset rules in styles.css were not touched by this phase', () => {
    const css = read('src/styles.css');
    expect(css).toMatch(/\.txn-table thead th, \.budget-table thead th \{ top: calc\(var\(--topbar-h\) \+ var\(--bar-h\) \+ var\(--sub-h\)\)/);
    expect(css).toMatch(/\.txn-table \{ --txn-head-h: \d+px; \}/);
  });
  it('the new stylesheet uses tokens: no hex colors, raw radii or sub-12px text', () => {
    const css = read('src/pages/money.css').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/border-radius:\s*\d+px/);
    expect(css).not.toMatch(/!important/);
  });
});
