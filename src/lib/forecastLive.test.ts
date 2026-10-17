import { beforeEach, describe, expect, it } from 'vitest';
import { FinanceDB } from '../db';
import { DEFAULT_FORECAST, estimateEveryday, loadForecast } from './forecastLive';
import { newProfile } from './income';
import type { Category, Txn } from '../types';

const $ = (n: number) => Math.round(n * 100);
const cats: Category[] = [
  { id: 1, groupId: 1, name: 'Groceries', kind: 'expense' },
  { id: 2, groupId: 1, name: 'Mortgage interest', kind: 'expense' },
  { id: 3, groupId: 2, name: 'Paycheck', kind: 'income' },
];
const t = (date: string, amt: number, categoryId: number | null, extra: Partial<Txn> = {}): Txn => ({ accountId: 1, date, amountCents: $(amt), payee: 'x', memo: '', status: 'cleared', categoryId, ...extra });

describe('estimating everyday spending', () => {
  const today = '2026-10-17'; // the three full months are July, August, September
  it('averages the last three full months', () => {
    const e = estimateEveryday([t('2026-07-05', -300, 1), t('2026-08-05', -600, 1), t('2026-09-05', -900, 1), t('2026-10-05', -5000, 1)], cats, today);
    expect(e).toBe($(600));
  });
  it('leaves out scheduled items, transfers, income, and the excluded categories', () => {
    const e = estimateEveryday([
      t('2026-09-01', -100, 1), t('2026-09-02', -2000, 1, { recurringId: 4 }), t('2026-09-03', -500, null, { transferTxnId: 9 }),
      t('2026-09-04', 4000, 3), t('2026-09-05', -900, 2), t('2026-09-06', 30, 1),
    ], cats, today, [2]);
    expect(e).toBe($(70)); // 100 spent, 30 refunded
  });
  it('does not count months with no transactions at all', () => {
    expect(estimateEveryday([t('2026-09-01', -300, 1)], cats, today)).toBe($(300));
    expect(estimateEveryday([], cats, today)).toBe(0);
  });
});

describe('loading the forecast from the database', () => {
  let d: FinanceDB;
  let n = 0;
  beforeEach(async () => {
    d = new FinanceDB(`fc-${n++}`);
    await d.accounts.bulkAdd([
      { id: 1, name: 'Checking', kind: 'checking', openingBalanceCents: $(4000), openingDate: '2026-01-01' },
      { id: 2, name: 'Savings', kind: 'savings', openingBalanceCents: $(10000), openingDate: '2026-01-01' },
      { id: 3, name: 'Visa', kind: 'credit_card', openingBalanceCents: 0, openingDate: '2026-01-01' },
    ]);
    await d.categories.bulkAdd(cats);
  });

  it('starts from checking and savings, and can leave savings out', async () => {
    expect((await loadForecast(d, '2026-10-17')).input.startCents).toBe($(14000));
    expect((await loadForecast(d, '2026-10-17', { includeSavings: false })).input.startCents).toBe($(4000));
  });

  it('includes scheduled items but not the ones already handled, transfers, or inactive rules', async () => {
    const base = { accountId: 1, categoryId: null, memo: '', frequency: 'monthly' as const, startDate: '2026-10-20', active: true };
    const rent = await d.recurring.add({ ...base, payee: 'Rent', amountCents: -$(1500) });
    await d.recurring.add({ ...base, payee: 'Move money', amountCents: -$(500), transferAccountId: 2 });
    await d.recurring.add({ ...base, payee: 'Old', amountCents: -$(50), active: false });
    await d.recurringLog.add({ ruleId: rent, date: '2026-10-20', action: 'posted' });
    const f = await loadForecast(d, '2026-10-17', { months: 3 });
    expect(f.input.scheduled.map((s) => [s.date, s.label])).toEqual([['2026-11-20', 'Rent'], ['2026-12-20', 'Rent']]);
  });

  it('adds loan payments with escrow, and the estimate leaves out the loan categories', async () => {
    await d.loans.add({ name: 'Mortgage', kind: 'mortgage', setup: 'current', balanceCents: $(200000), asOfDate: '2026-10-01', nextPaymentDate: '2026-11-01', remainingMonths: 300, annualRatePct: 6, extraMode: 'shorten', escrowMonthlyCents: $(600), interestCategoryId: 2 });
    await d.txns.bulkAdd([t('2026-09-02', -1000, 2), t('2026-09-03', -200, 1), t('2026-08-03', -200, 1), t('2026-07-03', -200, 1)]);
    const f = await loadForecast(d, '2026-10-17', { months: 3 });
    expect(f.input.loans).toHaveLength(2); // November and December 1st
    expect(f.input.loans[0].paymentCents).toBeGreaterThan($(1288) + $(600) - 100);
    expect(f.estimateCents).toBe($(200));
    expect(f.input.everydayMonthlyCents).toBe($(200));
    expect((await loadForecast(d, '2026-10-17', { everydayCents: $(900) })).input.everydayMonthlyCents).toBe($(900));
  });

  it('adds paychecks from the Income tab and keeps shares from a held vest out of cash', async () => {
    const pid = await d.people.add({ name: 'Alex', birthYear: 1985 });
    await d.incomeProfiles.add({ ...newProfile(pid, 2026), salary: [{ effectiveDate: '2026-01-01', annualCents: $(120000) }] });
    const f = await loadForecast(d, '2026-10-17', { months: 3, includeTaxes: false });
    expect(f.input.pay.length).toBeGreaterThanOrEqual(4);
    expect(f.input.pay.every((p) => p.date > '2026-10-17' && p.netCents > 0)).toBe(true);
    expect(f.result.endCents).toBeGreaterThan(f.input.startCents);
  });

  it('includes tax due at filing (or a refund) for the year, and one-off items', async () => {
    const pid = await d.people.add({ name: 'Alex', birthYear: 1985 });
    await d.incomeProfiles.add({ ...newProfile(pid, 2026), salary: [{ effectiveDate: '2026-01-01', annualCents: $(300000) }], fedWithholding: { mode: 'manual', manualPerPaycheckCents: 0, twoJobs: false, extraPerPaycheckCents: 0 } });
    const f = await loadForecast(d, '2026-10-17', { months: 12, oneOffs: [{ id: 'a', date: '2027-03-01', label: 'Trip', cents: -$(3000) }] });
    expect(f.input.taxes.some((x) => x.label.includes('Federal tax due') && x.cents < 0 && x.date === '2027-04-15')).toBe(true);
    expect(f.result.events.some((e) => e.label === 'Trip')).toBe(true);
  });

  it('defaults are sensible', () => {
    expect(DEFAULT_FORECAST).toMatchObject({ months: 12, includeSavings: true, everydayCents: null, thresholdCents: $(1000) });
  });
});
