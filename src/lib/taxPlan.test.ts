import { describe, expect, it } from 'vitest';
import { TAX_2026 as T } from '../data/taxYears';
import { appreciatedCandidates, bracketRoom, estimatedDueDates, harvestCandidates, withHarvest, withholdingPlan, yearEndChecklist } from './taxPlan';
import { buildIncomeModel, newProfile } from './income';
import { netForTax, realizedFor } from './lots';
import type { InvAccount, Person, Security, TaxLot } from '../types';

const $ = (n: number) => Math.round(n * 100);
const people: Person[] = [{ id: 1, name: 'Alex', birthYear: 1985 }];
const prof = (salary: number, extra = {}) => ({ ...newProfile(1, 2026), salary: [{ effectiveDate: '2026-01-01', annualCents: $(salary) }], ...extra });
const model = (salary: number, gains?: { stcgCents: number; ltcgCents: number; lossDeductionCents: number }) => buildIncomeModel(2026, people, [prof(salary)], [], undefined, undefined, undefined, gains);

describe('bracket room', () => {
  it('finds the bracket and the room left before the next one', () => {
    const r = bracketRoom(T, $(150000), 0);
    expect(r.rate).toBe(0.22);
    expect(r.top).toBe($(211400));
    expect(r.roomCents).toBe($(61400));
    expect(r.nextRate).toBe(0.24);
  });
  it('long-term gains do not count toward the ordinary bracket and the 0% gain band shrinks', () => {
    const r = bracketRoom(T, $(150000), $(40000));
    expect(r.ordinaryTaxable).toBe($(110000));
    expect(r.zeroGainRoomCents).toBe(0);
    expect(bracketRoom(T, $(60000), 0).zeroGainRoomCents).toBe($(98900) - $(60000));
  });
  it('has no room figure in the top bracket', () => {
    const r = bracketRoom(T, $(900000), 0);
    expect(r.rate).toBe(0.37);
    expect(r.roomCents).toBeNull();
  });
});

describe('withholding plan', () => {
  it('counts what has been withheld to date and what is left to pay', () => {
    const m = model(150000, undefined);
    const wp = withholdingPlan(m.household!, m.years, '2026-07-01', null);
    const half = m.years[0].events.filter((e) => e.date <= '2026-07-01').reduce((s, e) => s + e.fedWithholding, 0);
    expect(wp.federal.withheldToDate).toBe(half);
    expect(wp.federal.projected).toBe(m.household!.federal.withheld);
    expect(wp.remaining[0].checks).toBe(m.years[0].events.filter((e) => e.date > '2026-07-01').length);
  });
  it('suggests extra withholding per remaining paycheck when there is a shortfall', () => {
    const m = model(150000, { stcgCents: $(60000), ltcgCents: 0, lossDeductionCents: 0 });
    const wp = withholdingPlan(m.household!, m.years, '2026-07-01', null);
    expect(wp.federal.balance).toBeLessThan(0);
    expect(wp.estimatedPaymentCents).toBe(-wp.federal.balance);
    const per = wp.extraPerCheck[0];
    expect(per.cents * wp.remaining[0].checks).toBeGreaterThanOrEqual(-wp.federal.balance);
    expect(per.cents * (wp.remaining[0].checks - 1)).toBeLessThan(-wp.federal.balance);
  });
  it('no suggestion when you will get a refund', () => {
    const m = model(150000, undefined);
    const wp = withholdingPlan(m.household!, m.years, '2026-07-01', null);
    if (wp.federal.balance >= 0) expect(wp.extraPerCheck).toEqual([]);
  });
  it('safe harbor compares withholding with the smaller of 90% now or last year', () => {
    const cur = model(150000);
    const prior = buildIncomeModel(2026, people, [prof(100000)], []).household!;
    const sh = withholdingPlan(cur.household!, cur.years, '2026-07-01', prior).safeHarbor!;
    expect(sh.requiredCents).toBe(Math.min(Math.round(cur.household!.federal.totalLiability * 0.9), prior.federal.totalLiability));
    expect(sh.met).toBe(cur.household!.federal.withheld >= sh.requiredCents);
    const none = withholdingPlan(cur.household!, cur.years, '2026-07-01', null).safeHarbor!;
    expect(none.basis).toMatch(/90%/);
  });
  it('lists the four estimated-payment dates', () => {
    expect(estimatedDueDates(2026)).toEqual(['2026-04-15', '2026-06-15', '2026-09-15', '2027-01-15']);
  });
});

describe('tax-loss harvesting', () => {
  const acct = (id: number, taxType: InvAccount['taxType']): InvAccount => ({ id, name: `A${id}`, kind: taxType === 'taxable' ? 'brokerage' : 'ira', taxType, cashCents: 0, annualContributionCents: 0, contributionGrowthPct: 0, linkToIncome: false });
  const sec = (id: number, ticker: string, price: number | null): Security => ({ id, ticker, name: ticker, assetClassId: 1, priceCents: price === null ? null : $(price), priceDate: null, priceSource: null });
  const lot = (id: number, securityId: number, date: string | null, shares: number, cost: number, accountId = 1): TaxLot => ({ id, holdingId: 1, accountId, securityId, acquiredDate: date, shares, costBasisCents: $(cost), source: 'buy' });
  const accounts = [acct(1, 'taxable'), acct(2, 'traditional')];

  it('finds lots below their cost, biggest loss first, with their holding period', () => {
    const securities = [sec(1, 'AAA', 80), sec(2, 'BBB', 120)];
    const lots = [lot(1, 1, '2025-01-10', 100, 12000), lot(2, 1, '2026-06-01', 50, 5000), lot(3, 2, '2024-01-01', 10, 1000), lot(4, 1, null, 10, 0)];
    const c = harvestCandidates(lots, securities, accounts, [], '2026-10-17');
    expect(c.map((h) => h.lot.id)).toEqual([1, 2]);
    expect(c[0]).toMatchObject({ ticker: 'AAA', lossCents: $(4000), longTerm: true });
    expect(c[1]).toMatchObject({ lossCents: $(1000), longTerm: false });
  });
  it('ignores unpriced securities, closed accounts, and sheltered accounts', () => {
    const lots = [lot(1, 1, '2025-01-10', 100, 12000), lot(2, 1, '2025-01-10', 100, 12000, 2)];
    expect(harvestCandidates(lots, [sec(1, 'AAA', null)], accounts, [], '2026-10-17')).toEqual([]);
    expect(harvestCandidates(lots, [sec(1, 'AAA', 80)], [{ ...accounts[0], closed: true }, accounts[1]], [], '2026-10-17')).toEqual([]);
    expect(harvestCandidates(lots, [sec(1, 'AAA', 80)], accounts, [], '2026-10-17').map((h) => h.lot.id)).toEqual([1]);
  });
  it('flags a wash-sale risk when the same security is held in an IRA', () => {
    const c = harvestCandidates([lot(1, 1, '2025-01-10', 100, 12000)], [sec(1, 'AAA', 80)], accounts, [{ accountId: 2, securityId: 1 }], '2026-10-17');
    expect(c[0].washRisk).toBe(true);
  });
  it('harvesting a loss against realized gains lowers the tax', () => {
    const realized = { shortTermCents: 0, longTermCents: $(20000), netCents: $(20000), proceedsCents: 0, count: 1 };
    const pick = harvestCandidates([lot(1, 1, '2025-01-10', 100, 12000)], [sec(1, 'AAA', 80)], accounts, [], '2026-10-17');
    const after = withHarvest(realized, pick);
    expect(after.longTermCents).toBe($(16000));
    const before = model(150000, { stcgCents: 0, ltcgCents: $(20000), lossDeductionCents: 0 }).household!;
    const ng = netForTax(after);
    const post = model(150000, { stcgCents: ng.stcgCents, ltcgCents: ng.ltcgCents, lossDeductionCents: ng.lossDeductionCents }).household!;
    expect(post.federal.totalLiability).toBeLessThan(before.federal.totalLiability);
    expect(realizedFor([], 2026).count).toBe(0);
  });
  it('lists appreciated lots, biggest gain first', () => {
    const securities = [sec(1, 'AAA', 200)];
    const c = appreciatedCandidates([lot(1, 1, '2020-01-01', 10, 1000), lot(2, 1, '2021-01-01', 10, 500), lot(3, 1, '2021-01-01', 10, 9000)], securities, accounts, '2026-10-17');
    expect(c.map((h) => h.lot.id)).toEqual([2, 1]);
    expect(c[0].lossCents).toBe(-$(1500));
  });
});

describe('year-end checklist', () => {
  const m = buildIncomeModel(2026, people, [prof(150000, { deductions: [{ id: 'k', type: 'k401_pretax', name: '401k', mode: 'percent', value: 5, appliesToBonus: false, fedExempt: true, ficaExempt: false, stateExempt: true }] })], []);
  const base = {
    today: '2026-10-17', year: 2026, people, years: m.years, household: m.household, room: bracketRoom(T, m.household!.federal.taxableIncome, 0), vests: [], invAccounts: [],
    traditionalByOwner: new Map<number, number>(), itemizedCents: 0, standardCents: T.stdDeductionMFJ, appreciatedLots: [], fmt: (c: number) => `$${(c / 100).toFixed(0)}`,
  };
  it('flags unused 401(k) room and shows conversion room', () => {
    const items = yearEndChecklist(base);
    const k = items.find((x) => x.id === 'k401-1')!;
    expect(k.status).toBe('todo');
    expect(k.detail).toMatch(/still unused/);
    expect(items.find((x) => x.id === 'room')!.detail).toMatch(/bracket/);
    expect(items.some((x) => x.id === 'days')).toBe(true);
  });
  it('mentions an RMD only for someone old enough, with a rough estimate', () => {
    const old = [{ id: 1, name: 'Alex', birthYear: 1950 }];
    const items = yearEndChecklist({ ...base, people: old, traditionalByOwner: new Map([[1, $(1000000)]]) });
    const r = items.find((x) => x.id === 'rmd-1')!;
    expect(r.status).toBe('todo');
    expect(r.detail).toContain('$42194'); // 1,000,000 / 23.7
    expect(yearEndChecklist(base).some((x) => x.id.startsWith('rmd'))).toBe(false);
  });
  it('counts only upcoming vests and explains the charity choice', () => {
    const v = (date: string, g: number) => ({ vest: { personId: 1, date, grant: '', kind: 'cash' as const, shares: 1 }, grossCents: $(g) });
    const items = yearEndChecklist({ ...base, vests: [v('2026-12-01', 5000), v('2026-03-01', 9999)] });
    expect(items.find((x) => x.id === 'vests')!.detail).toContain('1 vest worth $5000');
    expect(items.find((x) => x.id === 'charity')!.detail).toMatch(/below the standard deduction/);
    expect(yearEndChecklist({ ...base, itemizedCents: $(40000) }).find((x) => x.id === 'charity')!.detail).toMatch(/You itemize/);
  });
});
