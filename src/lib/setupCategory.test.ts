import { describe, expect, it } from 'vitest';
import { FinanceDB } from '../db';
import type { Account, Category, CategoryGroup, Txn } from '../types';
import { computeBudget } from './budget';
import { buildFlow, filterTree, SETUP_IN } from './flow';
import { estimateEveryday } from './forecastLive';
import { spendingMatrix, topPayees } from './reports';
import { trailingAnnualSpending } from './retirement';
import { detectRecurring, suggestCategory, suggestRules } from './rules';
import { SETUP_CATEGORY_ID, SETUP_GROUP_ID, ensureSetupCategory, isSetupAlloc, isSetupTxn } from './setupCategory';
import { spendingSnapshot } from './spending';

const $ = (n: number) => Math.round(n * 100);
let nextId = 1;
const acct = (id: number, kind: Account['kind']): Account => ({ id, name: `A${id}`, kind, openingBalanceCents: 0, openingDate: '2026-01-01' });
const accounts = [acct(1, 'checking'), acct(2, 'credit_card')];
const groups: CategoryGroup[] = [{ id: 1, name: 'Food' }, { id: 2, name: 'Income' }, { id: SETUP_GROUP_ID, name: 'System' }];
const categories: Category[] = [
  { id: 10, groupId: 1, name: 'Groceries', kind: 'expense' },
  { id: 20, groupId: 2, name: 'Paycheck', kind: 'income' },
  { id: SETUP_CATEGORY_ID, groupId: SETUP_GROUP_ID, name: 'Initial setup', kind: 'expense' },
];
const t = (date: string, amount: number, categoryId: number | null, accountId = 1, extra: Partial<Txn> = {}): Txn => ({
  id: nextId++, accountId, date, amountCents: $(amount), payee: 'x', memo: '', status: 'cleared', categoryId, ...extra,
});
const setupIn = t('2026-09-01', 5000, SETUP_CATEGORY_ID, 1, { payee: 'Starting balance' });
const setupCard = t('2026-09-01', -1200, SETUP_CATEGORY_ID, 2, { payee: 'Starting balance' });
const real = [t('2026-09-02', 3000, 20), t('2026-09-05', -400, 10)];

describe('creating the category', () => {
  it('makes the group and category once, with fixed ids, and never overwrites your edits', async () => {
    const d = new FinanceDB(`setup-${Date.now()}`);
    await ensureSetupCategory(d);
    await ensureSetupCategory(d);
    expect(await d.categoryGroups.toArray()).toEqual([{ id: SETUP_GROUP_ID, name: 'System' }]);
    expect(await d.categories.toArray()).toEqual([{ id: SETUP_CATEGORY_ID, groupId: SETUP_GROUP_ID, name: 'Initial setup', kind: 'expense' }]);
    await d.categories.update(SETUP_CATEGORY_ID, { hidden: true });
    await ensureSetupCategory(d);
    expect((await d.categories.get(SETUP_CATEGORY_ID))!.hidden).toBe(true);
    expect(SETUP_CATEGORY_ID).toBeLessThan(Number.MAX_SAFE_INTEGER);
  });
  it('recognizes setup entries, whole or split', () => {
    expect(isSetupTxn(setupIn)).toBe(true);
    expect(isSetupTxn(real[1])).toBe(false);
    expect(isSetupTxn({ categoryId: null, splits: [{ categoryId: SETUP_CATEGORY_ID, amountCents: 1 }] })).toBe(false);
    expect(isSetupAlloc({ categoryId: SETUP_CATEGORY_ID })).toBe(true);
    expect(isSetupAlloc({ categoryId: null })).toBe(false);
  });
});

describe('the budget', () => {
  const run = (txns: Txn[]) => computeBudget({ accounts, categories, txns, assignments: [], month: '2026-09' });
  it('counts the money (cash and Ready to Assign) but not as income, a category, or uncategorized', () => {
    const without = run(real);
    const withSetup = run([...real, setupIn, setupCard]);
    expect(withSetup.cash).toBe(without.cash + $(5000));
    expect(withSetup.readyToAssign).toBe(without.readyToAssign + $(5000));
    expect(withSetup.incomeThisMonth).toBe(without.incomeThisMonth);
    expect(withSetup.uncategorizedCount).toBe(without.uncategorizedCount);
    expect(withSetup.rows.some((r) => r.categoryId === SETUP_CATEGORY_ID)).toBe(false);
    expect(withSetup.rows.find((r) => r.categoryId === 10)).toEqual(without.rows.find((r) => r.categoryId === 10));
  });
  it('a card balance entered this way shows as owed and unfunded', () => {
    const b = run([setupCard]);
    expect(b.unfunded).toEqual([{ accountId: 2, name: 'A2', owedCents: $(1200), unfundedCents: $(1200) }]);
  });
});

describe('reports and summaries', () => {
  it('spending and income by month ignore them', () => {
    const m = spendingMatrix([...real, setupIn, setupCard], categories, ['2026-09']);
    expect(m.spent).toEqual([$(400)]);
    expect(m.income).toEqual([$(3000)]);
    expect(m.cats.map((c) => c.name)).toEqual(['Groceries']);
  });
  it('top payees ignore them', () => {
    expect(topPayees([...real, setupCard], categories, '2026-09-01', '2026-09-30').map((p) => p.payee)).toEqual(['x']);
    expect(topPayees([setupCard], categories, '2026-09-01', '2026-09-30')).toEqual([]);
  });
  it('the Home spending snapshot ignores them, including the count', () => {
    const s = spendingSnapshot([...real, setupIn, setupCard], categories, '2026-09');
    expect(s).toMatchObject({ spentCents: $(400), incomeCents: $(3000), count: 2 });
  });
});

describe('estimates', () => {
  it('everyday spending ignores them, and a month with only a setup entry is not counted', () => {
    const base = [t('2026-08-10', -600, 10), t('2026-07-10', -300, 10)];
    expect(estimateEveryday([...base, setupCard, t('2026-09-01', -9999, SETUP_CATEGORY_ID), t('2026-06-01', -777, SETUP_CATEGORY_ID)], categories, '2026-10-19')).toBe(estimateEveryday(base, categories, '2026-10-19'));
  });
  it('trailing annual spending ignores them, and they do not count as the first activity', () => {
    const history = [t('2026-01-10', -100, 10), t('2026-07-10', -300, 10), t('2026-08-10', -300, 10), t('2026-09-10', -300, 10)];
    const plain = trailingAnnualSpending(history, categories, accounts, '2026-10-19', 3);
    const withSetup = trailingAnnualSpending([...history, t('2026-09-30', -50000, SETUP_CATEGORY_ID)], categories, accounts, '2026-10-19', 3);
    expect(withSetup).toEqual(plain);
    expect(plain.monthsUsed).toBe(3);
    // a setup entry dated now must not make everything look like brand-new data
    const onlySetup = trailingAnnualSpending([t('2026-10-01', 5000, SETUP_CATEGORY_ID)], categories, [{ ...acct(1, 'checking'), openingDate: '2025-01-01' }], '2026-10-19', 3);
    expect(onlySetup).toEqual({ annualCents: 0, monthsUsed: 3 });
  });
});

describe('rules and repeating charges', () => {
  it('a payee filed under Initial setup is never suggested as a category or a rule, or found as a repeating charge', () => {
    const many = [1, 2, 3, 4].map((i) => t(`2026-0${i}-01`, -100, SETUP_CATEGORY_ID, 1, { payee: 'Starting balance' }));
    expect(suggestCategory(many, [], 'Starting balance')).toBeNull();
    expect(suggestRules(many, [])).toEqual([]);
    expect(detectRecurring(many, [], '2026-10-19')).toEqual([]);
    const normal = [1, 2, 3, 4].map((i) => t(`2026-0${i}-01`, -100, 10, 1, { payee: 'Corner Market' }));
    expect(suggestCategory(normal, [], 'Corner Market')?.categoryId).toBe(10);
  });
});

describe('the flow diagram', () => {
  const base = { accounts, categories, groups, start: '2026-09-01', end: '2026-09-30', detail: 'groups' as const };
  const txns = [...real, setupIn, setupCard];
  it('leaves them out by default', () => {
    const g = buildFlow({ ...base, txns });
    expect(g.income).toBe($(3000));
    expect(g.spending).toBe($(400));
    expect(g.nodes.some((n) => /setup/i.test(n.label))).toBe(false);
  });
  it('shows them when asked, as their own money in and money out', () => {
    const g = buildFlow({ ...base, txns, includeSetup: true });
    expect(g.income).toBe($(8000));
    expect(g.spending).toBe($(1600));
    expect(g.nodes.map((n) => n.label)).toEqual(expect.arrayContaining(['Initial setup (money in)', 'Initial setup']));
    expect(buildFlow({ ...base, txns, includeSetup: true, off: new Set([SETUP_IN]) }).income).toBe($(3000));
  });
  it('is not in the category filter list', () => {
    const f = filterTree(categories, groups);
    expect(f.groups.flatMap((g) => g.items.map((i) => i.label))).not.toContain('Initial setup');
    expect(f.groups.map((g) => g.label)).not.toContain('System');
  });
});
