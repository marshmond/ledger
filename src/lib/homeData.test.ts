import { describe, expect, it } from 'vitest';
import { computeAlerts, type AlertInput } from './alerts';
import { spendingSnapshot } from './spending';
import { computeNetWorth } from './netWorth';
import type { Account, Category, Txn } from '../types';

const $ = (n: number) => Math.round(n * 100);
const base: AlertInput = {
  today: '2026-10-17', hasData: true, lastBackup: '2026-10-10T00:00:00Z', scheduledDue: 0, overspent: [], invAccounts: [], holdings: [], securities: [], lots: [], vests: [], people: [],
};

describe('alerts', () => {
  it('says nothing when everything is fine', () => {
    expect(computeAlerts(base)).toEqual([]);
  });
  it('does not nag an empty app', () => {
    expect(computeAlerts({ ...base, hasData: false, lastBackup: undefined })).toEqual([]);
  });
  it('flags a missing or old backup', () => {
    expect(computeAlerts({ ...base, lastBackup: undefined })[0]).toMatchObject({ id: 'backup', level: 'warn', to: '/backup' });
    expect(computeAlerts({ ...base, lastBackup: '2026-08-01T00:00:00Z' })[0].title).toMatch(/77 days ago/);
    expect(computeAlerts({ ...base, lastBackup: '2026-10-01T00:00:00Z' })).toEqual([]);
  });
  it('flags overspent categories, scheduled items, and a tax shortfall', () => {
    const a = computeAlerts({ ...base, overspent: ['Dining', 'Gas', 'Fun', 'Gifts'], scheduledDue: 2, federalBalanceCents: -$(2500) });
    expect(a.map((x) => x.id)).toEqual(['overspent', 'owe', 'scheduled']);
    expect(a[0].title).toBe('Over budget: Dining, Gas, Fun and 1 more');
    expect(a[1].title).toMatch(/\$2,500\.00/);
    expect(computeAlerts({ ...base, federalBalanceCents: -$(500) })).toEqual([]);
    expect(computeAlerts({ ...base, federalBalanceCents: $(900) })).toEqual([]);
  });
  it('flags retirement accounts with no owner only when people exist', () => {
    const acct = { id: 1, name: 'IRA', kind: 'ira' as const, taxType: 'traditional' as const, personId: null, cashCents: 0, annualContributionCents: 0, contributionGrowthPct: 0, linkToIncome: false };
    expect(computeAlerts({ ...base, invAccounts: [acct] })).toEqual([]);
    expect(computeAlerts({ ...base, invAccounts: [acct], people: [{ id: 1, name: 'A' }] })[0].id).toBe('owners');
    expect(computeAlerts({ ...base, invAccounts: [{ ...acct, personId: 1 }], people: [{ id: 1, name: 'A' }] })).toEqual([]);
  });
  it('flags missing and stale prices for held securities only', () => {
    const acct = { id: 1, name: 'B', kind: 'brokerage' as const, taxType: 'taxable' as const, cashCents: 0, annualContributionCents: 0, contributionGrowthPct: 0, linkToIncome: false };
    const h = [{ id: 1, accountId: 1, securityId: 1, shares: 1, costBasisCents: null }];
    const sec = (priceCents: number | null, priceDate: string | null) => [{ id: 1, ticker: 'VTI', name: 'x', assetClassId: 1, priceCents, priceDate, priceSource: null }, { id: 2, ticker: 'ZZZ', name: 'unused', assetClassId: 1, priceCents: null, priceDate: null, priceSource: null }];
    expect(computeAlerts({ ...base, invAccounts: [acct], holdings: h, securities: sec(null, null) })[0]).toMatchObject({ id: 'noprice', title: 'No price for VTI' });
    expect(computeAlerts({ ...base, invAccounts: [acct], holdings: h, securities: sec(100, '2026-10-01') })[0].id).toBe('stale');
    expect(computeAlerts({ ...base, invAccounts: [acct], holdings: h, securities: sec(100, '2026-10-15') })).toEqual([]);
  });
  it('flags lots missing a cost or date and vests coming up', () => {
    const lot = { id: 1, holdingId: 1, accountId: 1, securityId: 1, acquiredDate: null, shares: 1, costBasisCents: 0, source: 'opening' as const };
    expect(computeAlerts({ ...base, lots: [lot] })[0].id).toBe('lots');
    const v = { personId: 1, date: '2026-11-05', grant: 'g', kind: 'cash' as const, shares: 1 };
    expect(computeAlerts({ ...base, vests: [v] })[0].id).toBe('vest');
    expect(computeAlerts({ ...base, vests: [{ ...v, date: '2026-12-25' }, { ...v, date: '2026-09-01' }] })).toEqual([]);
  });
  it('puts warnings before information', () => {
    const a = computeAlerts({ ...base, scheduledDue: 1, overspent: ['X'] });
    expect(a.map((x) => x.level)).toEqual(['warn', 'info']);
  });
});

describe('spending snapshot', () => {
  const cats: Category[] = [
    { id: 1, groupId: 1, name: 'Groceries', kind: 'expense' },
    { id: 2, groupId: 1, name: 'Dining', kind: 'expense' },
    { id: 3, groupId: 2, name: 'Paycheck', kind: 'income' },
  ];
  const t = (id: number, date: string, amt: number, categoryId: number | null, extra: Partial<Txn> = {}): Txn => ({ id, accountId: 1, date, amountCents: $(amt), payee: 'x', memo: '', status: 'cleared', categoryId, ...extra });
  it('totals spending and income for the month, leaving out transfers and other months', () => {
    const s = spendingSnapshot(
      [t(1, '2026-10-02', -50, 1), t(2, '2026-10-03', -30, 2), t(3, '2026-10-04', -20, 1), t(4, '2026-10-05', 3000, 3), t(5, '2026-10-06', -500, null, { transferTxnId: 9 }), t(6, '2026-09-30', -999, 1)],
      cats, '2026-10',
    );
    expect(s.spentCents).toBe($(100));
    expect(s.incomeCents).toBe($(3000));
    expect(s.top).toEqual([{ name: 'Groceries', cents: $(70) }, { name: 'Dining', cents: $(30) }]);
    expect(s.count).toBe(4);
  });
  it('splits go to their own categories, and refunds reduce spending', () => {
    const s = spendingSnapshot(
      [t(1, '2026-10-02', -100, null, { splits: [{ categoryId: 1, amountCents: -$(60) }, { categoryId: 2, amountCents: -$(40) }] }), t(2, '2026-10-03', 25, 1)],
      cats, '2026-10',
    );
    expect(s.spentCents).toBe($(75));
    expect(s.top).toEqual([{ name: 'Dining', cents: $(40) }, { name: 'Groceries', cents: $(35) }]);
  });
  it('uncategorized spending is grouped', () => {
    expect(spendingSnapshot([t(1, '2026-10-02', -10, null)], cats, '2026-10').top).toEqual([{ name: 'Uncategorized', cents: $(10) }]);
  });
});

describe('net worth', () => {
  const acct = (id: number, kind: Account['kind'], opening: number, extra: Partial<Account> = {}): Account => ({ id, name: `a${id}`, kind, openingBalanceCents: $(opening), openingDate: '2026-01-01', ...extra });
  const txn = (accountId: number, amt: number): Txn => ({ accountId, date: '2026-02-01', amountCents: $(amt), payee: '', memo: '', status: 'cleared', categoryId: null });
  it('adds cash and investments and subtracts cards and loans', () => {
    const n = computeNetWorth([acct(1, 'checking', 1000), acct(2, 'savings', 5000), acct(3, 'credit_card', -400)], [txn(1, -100), txn(3, -50)], $(20000), [{ owedCents: $(100000) }]);
    expect(n).toEqual({ cash: $(5900), investments: $(20000), cards: -$(450), loans: -$(100000), total: $(5900) + $(20000) - $(450) - $(100000) });
  });
  it('counts a loan once when it is tied to a ledger account', () => {
    const accounts = [acct(1, 'checking', 1000), acct(2, 'loan', -90000)];
    const n = computeNetWorth(accounts, [], 0, [{ ledgerAccountId: 2, owedCents: $(90000) }]);
    expect(n.loans).toBe(-$(90000));
    expect(n.total).toBe($(1000) - $(90000));
  });
  it('ignores closed accounts', () => {
    expect(computeNetWorth([acct(1, 'checking', 1000, { closed: true })], [], 0, []).cash).toBe(0);
  });
});
