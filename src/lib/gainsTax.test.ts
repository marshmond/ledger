import { describe, expect, it } from 'vitest';
import { TAX_2026 as T } from '../data/taxYears';
import { RETIREMENT_RULES_2026 as R } from '../data/retirementTax';
import { NO_CONVERSION, simulatePlan, type PlanInput } from './rothPlan';
import { buildIncomeModel, newProfile } from './income';
import { buildPlanInput, DEFAULT_ROTH, type RothSources } from './rothInputs';
import type { Person, Sale } from '../types';

const $ = (n: number) => Math.round(n * 100);
const people: Person[] = [{ id: 1, name: 'Alex', birthYear: 1985 }];
const prof = (salary: number) => ({ ...newProfile(1, 2026), salary: [{ effectiveDate: '2026-01-01', annualCents: $(salary) }] });
const model = (salary: number, gains?: { stcgCents: number; ltcgCents: number; lossDeductionCents: number }) =>
  buildIncomeModel(2026, people, [prof(salary)], [], undefined, undefined, undefined, gains).household!;

describe('realized gains in the yearly tax estimate', () => {
  it('short-term gains are taxed like wages', () => {
    const none = model(120000);
    const st = model(120000, { stcgCents: $(10000), ltcgCents: 0, lossDeductionCents: 0 });
    expect(st.federal.taxableIncome - none.federal.taxableIncome).toBe($(10000));
    expect(st.federal.longTermGains).toBe(0);
    expect(st.federal.totalLiability - none.federal.totalLiability).toBe(st.federal.incomeTax - none.federal.incomeTax);
  });
  it('long-term gains inside the 0% band cost nothing federally', () => {
    const none = model(40000);
    const lt = model(40000, { stcgCents: 0, ltcgCents: $(20000), lossDeductionCents: 0 });
    expect(lt.federal.capitalGainsTax).toBe(0);
    expect(lt.federal.totalLiability).toBe(none.federal.totalLiability);
  });
  it('...and are taxed at 15% above the 0% threshold, stacked on top of other income', () => {
    const lt = model(150000, { stcgCents: 0, ltcgCents: $(50000), lossDeductionCents: 0 });
    // wages are above the 0% band already, so every dollar of gain is 15%
    expect(lt.federal.capitalGainsTax).toBe($(50000 * 0.15));
    const ord = model(150000).federal.incomeTax;
    expect(lt.federal.incomeTax).toBe(ord + $(7500));
  });
  it('a long-term gain is taxed less than the same short-term gain', () => {
    const st = model(150000, { stcgCents: $(50000), ltcgCents: 0, lossDeductionCents: 0 }).federal.totalLiability;
    const lt = model(150000, { stcgCents: 0, ltcgCents: $(50000), lossDeductionCents: 0 }).federal.totalLiability;
    expect(lt).toBeLessThan(st);
  });
  it('net investment income tax applies above $250,000 of income', () => {
    const h = model(400000, { stcgCents: 0, ltcgCents: $(100000), lossDeductionCents: 0 });
    expect(h.federal.niit).toBeGreaterThan(0);
    expect(model(100000, { stcgCents: 0, ltcgCents: $(20000), lossDeductionCents: 0 }).federal.niit).toBe(0);
  });
  it('a capital loss deduction lowers income', () => {
    const none = model(120000);
    const loss = model(120000, { stcgCents: 0, ltcgCents: 0, lossDeductionCents: $(3000) });
    expect(none.federal.taxableIncome - loss.federal.taxableIncome).toBe($(3000));
    expect(none.ma.taxableIncome - loss.ma.taxableIncome).toBe($(3000));
  });
  it('gains also count in Massachusetts', () => {
    const none = model(120000);
    const g = model(120000, { stcgCents: 0, ltcgCents: $(10000), lossDeductionCents: 0 });
    expect(g.ma.taxableIncome - none.ma.taxableIncome).toBe($(10000));
  });
  it('no gains leaves the old numbers unchanged', () => {
    expect(model(120000, { stcgCents: 0, ltcgCents: 0, lossDeductionCents: 0 })).toEqual(model(120000));
  });
});

describe('realized gains in the Roth planner', () => {
  const person = { name: 'A', birthYear: 1965, retireYear: 2026, wagesCents: 0, contribTradCents: 0, contribRothCents: 0, ssAnnualCents: 0, ssClaimAge: 67, ira: $(500000), k401: 0, roth: 0, iraBasisCents: 0 };
  const base: PlanInput = {
    startYear: 2026, planAge: 70, people: [person], taxableCents: $(200000), taxableBasisCents: $(200000), other: [], extraWages: {}, spendingCents: $(60000),
    inflationPct: 0, wageGrowthPct: 0, returnPct: { trad: 0, roth: 0, taxable: 0 }, volPct: 0, yieldPct: 0, yieldOrdinaryPct: 0,
    aca: { on: false, benchmarkCents: 0, premiumGrowthPct: 0 }, conversionTaxFrom: 'outside', endTaxRatePct: 24, heirTaxRatePct: 24, T, R,
  };
  it('count in the year they happened', () => {
    const a = simulatePlan(base, NO_CONVERSION(2026, 2030));
    const b = simulatePlan({ ...base, extraGains: { 2026: { stcg: $(60000), ltcg: $(20000), lossDeduction: 0 } } }, NO_CONVERSION(2026, 2030));
    expect(b.rows[0].agi - a.rows[0].agi).toBe($(80000));
    expect(b.rows[0].fed).toBeGreaterThan(a.rows[0].fed);
    expect(b.rows[1].agi).toBe(a.rows[1].agi);
  });
  it('are taken from logged sales in the plan inputs', () => {
    const sale = (date: string, st: number, lt: number): Sale => ({
      accountId: 1, securityId: 1, date, shares: 1, proceedsCents: 0, feesCents: 0, method: 'fifo', taxable: true, lots: [], basisCents: 0,
      gainCents: st + lt, shortTermCents: st, longTermCents: lt, toCashCents: 0, note: '',
    });
    const income = buildIncomeModel(2026, people, [], []);
    const src: RothSources = { year0: 2026, people, profiles: [], income, accounts: [], holdings: [], securities: [], classes: [], retirement: { retireYear: 2031, spendingCents: $(60000) }, sales: [sale('2026-03-01', $(5000), $(7000)), sale('2025-03-01', $(9999), 0)] };
    const b = buildPlanInput(src, DEFAULT_ROTH);
    expect(b.input!.extraGains).toEqual({ 2026: { stcg: $(5000), ltcg: $(7000), lossDeduction: 0 } });
    expect(b.notes.join(' ')).toMatch(/realized so far in 2026/);
  });
});
