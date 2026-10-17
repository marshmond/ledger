import { describe, expect, it } from 'vitest';
import { buildReview, type ReviewInput } from './review';
import { buildIncomeModel, newProfile } from './income';
import { spendingMatrix } from './reports';
import type { Category, NetWorthSnapshot, Txn } from '../types';

const $ = (n: number) => Math.round(n * 100);
const fmt = (c: number) => `$${(c / 100).toFixed(0)}`;
const snap = (date: string, total: number): NetWorthSnapshot => ({ date, cashCents: 0, investmentsCents: 0, propertyCents: 0, cardsCents: 0, loansCents: 0, totalCents: $(total) });
const cats: Category[] = [{ id: 1, groupId: 1, name: 'Groceries', kind: 'expense' }, { id: 2, groupId: 1, name: 'Dining', kind: 'expense' }, { id: 3, groupId: 2, name: 'Paycheck', kind: 'income' }];
const t = (date: string, amt: number, categoryId: number): Txn => ({ accountId: 1, date, amountCents: $(amt), payee: 'x', memo: '', status: 'cleared', categoryId });
const months = Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, '0')}`);
const profile = { ...newProfile(1, 2026), salary: [{ effectiveDate: '2026-01-01', annualCents: $(150000) }], deductions: [{ id: 'k', type: 'k401_pretax' as const, name: '401k', mode: 'percent' as const, value: 10, appliesToBonus: false, fedExempt: true, ficaExempt: false, stateExempt: true }], match: { ratePct: 50, upToPctOfPay: 6, trueUp: false, appliesToBonus: false } };
const model = buildIncomeModel(2026, [{ id: 1, name: 'Alex', birthYear: 1985 }], [profile], []);

const input = (over: Partial<ReviewInput> = {}): ReviewInput => ({
  year: 2026,
  snapshots: [snap('2025-12-15', 400000), snap('2026-03-01', 410000), snap('2026-10-01', 460000)],
  matrix: spendingMatrix([t('2026-01-05', -500, 1), t('2026-02-05', -300, 2), t('2026-02-06', -200, 1), t('2026-03-01', 6000, 3), t('2026-02-01', 6000, 3)], cats, months),
  years: model.years, household: model.household,
  realized: { shortTermCents: $(500), longTermCents: $(1500), netCents: $(2000), proceedsCents: 0, count: 3 },
  rsuGrossCents: 0,
  loans: [{ name: 'Mortgage', interestCents: $(9000), principalCents: $(4000) }],
  hsaWithdrawals: { qualifiedCents: $(300), taxableCents: 0 },
  ...over,
});

describe('year in review', () => {
  const r = buildReview(input(), fmt);

  it('measures net worth change from the end of last year to the last point this year', () => {
    expect(r.netWorth).toMatchObject({ startCents: $(400000), endCents: $(460000), changeCents: $(60000), startDate: '2025-12-15', endDate: '2026-10-01' });
    expect(r.netWorth!.changePct).toBeCloseTo(0.15, 5);
  });
  it('falls back to the first point of the year, and has nothing with fewer than two points', () => {
    const r2 = buildReview(input({ snapshots: [snap('2026-03-01', 410000), snap('2026-10-01', 460000)] }), fmt);
    expect(r2.netWorth!.startCents).toBe($(410000));
    expect(buildReview(input({ snapshots: [snap('2026-03-01', 1)] }), fmt).netWorth).toBeNull();
    expect(buildReview(input({ snapshots: [] }), fmt).netWorth).toBeNull();
  });
  it('totals pay from the Income tab', () => {
    expect(r.pay.grossCents).toBe($(150000));
    expect(r.pay.netCents).toBe(model.years[0].totals.net);
  });
  it('totals spending, income, and the savings rate from the ledger', () => {
    expect(r.spending.totalCents).toBe($(1000));
    expect(r.spending.incomeCents).toBe($(12000));
    expect(r.spending.savedCents).toBe($(11000));
    expect(r.spending.savingsRate).toBeCloseTo(11000 / 12000, 5);
    expect(r.spending.top[0]).toEqual({ name: 'Groceries', cents: $(700) });
    expect(r.spending.biggestMonth).toEqual({ month: '2026-01', cents: $(500) }); // January and February tie: the earlier month is reported
    expect(r.spending.monthlyAvgCents).toBe(Math.round($(1000) / 3));
  });
  it('totals retirement and health savings including the employer', () => {
    expect(r.retirement.employeeCents).toBe($(15000));
    expect(r.retirement.employerCents).toBe($(4500));
    expect(r.retirement.totalCents).toBe($(19500));
  });
  it('adds up taxes and the effective rate', () => {
    const h = model.household!;
    expect(r.taxes.federalCents).toBe(h.federal.totalLiability);
    expect(r.taxes.payrollCents).toBe(h.ficaTotal + h.pfmlTotal);
    expect(r.taxes.totalCents).toBe(h.federal.totalLiability + h.ma.totalLiability + h.ficaTotal + h.pfmlTotal);
    expect(r.taxes.effectiveRate).toBeCloseTo(r.taxes.totalCents / $(150000), 5);
    expect(r.taxes.refundCents).toBe(h.federal.balance + h.ma.balance);
  });
  it('reports investing and debt', () => {
    expect(r.investing).toMatchObject({ netCents: $(2000), sales: 3 });
    expect(r.debt).toEqual({ principalCents: $(4000), interestCents: $(9000) });
  });
  it('writes plain-language highlights', () => {
    expect(r.highlights[0]).toBe('Your net worth grew by $60000 (15%), from $400000 to $460000.');
    expect(r.highlights.join(' ')).toMatch(/saved 92% of the income/);
    expect(r.highlights.join(' ')).toMatch(/Groceries was your biggest expense at \$700, 70% of your spending/);
    expect(r.highlights.join(' ')).toMatch(/realized \$2000 of gains on 3 sales/);
    expect(r.highlights.join(' ')).toMatch(/paid down \$4000 of loan principal/);
  });
  it('has no highlights for an empty year, and does not claim a savings rate without income', () => {
    const empty = buildReview(input({ snapshots: [], matrix: spendingMatrix([], cats, months), years: [], household: null, realized: { shortTermCents: 0, longTermCents: 0, netCents: 0, proceedsCents: 0, count: 0 }, loans: [] }), fmt);
    expect(empty.highlights).toEqual([]);
    expect(empty.spending.savingsRate).toBeNull();
    expect(empty.taxes.effectiveRate).toBeNull();
  });
  it('a year of overspending says so', () => {
    const over = buildReview(input({ matrix: spendingMatrix([t('2026-01-05', -900, 1), t('2026-01-06', 500, 3)], cats, months) }), fmt);
    expect(over.highlights.join(' ')).toMatch(/spent \$400 more than came into your accounts/);
  });
});
