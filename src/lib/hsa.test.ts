import { beforeEach, describe, expect, it } from 'vitest';
import { FinanceDB } from '../db';
import { exportAll, importAll } from './backup';
import { hsaYearImpact, withdrawalYears } from './hsa';
import { baseContribution } from './projectionInput';
import { buildIncomeModel, newProfile } from './income';
import { buildPlanInput, DEFAULT_ROTH, type RothSources } from './rothInputs';
import type { HsaWithdrawal, InvAccount, Person } from '../types';

const $ = (n: number) => Math.round(n * 100);
const people: Person[] = [{ id: 1, name: 'Alex', birthYear: 1985 }, { id: 2, name: 'Sam', birthYear: 1955 }];
const acct = (id: number, personId: number | null, extra: Partial<InvAccount> = {}): InvAccount => ({
  id, name: `HSA ${id}`, kind: 'hsa', taxType: 'hsa', personId, cashCents: 0, annualContributionCents: 0, contributionGrowthPct: 0, linkToIncome: false, ...extra,
});
const w = (accountId: number, date: string, amt: number, qualified: boolean): HsaWithdrawal => ({ accountId, date, amountCents: $(amt), qualified, note: '', fromCashCents: 0 });

describe('HSA withdrawals and tax', () => {
  const accounts = [acct(1, 1), acct(2, 2), acct(3, null)];
  it('qualified withdrawals are tax-free', () => {
    const r = hsaYearImpact([w(1, '2026-03-01', 500, true)], accounts, people, 2026);
    expect(r).toEqual({ qualifiedCents: $(500), taxableCents: 0, penaltyCents: 0, assumedUnder65: 0 });
  });
  it('others are taxable, with a 20% penalty under 65 and none at 65 or over', () => {
    const r = hsaYearImpact([w(1, '2026-03-01', 1000, false), w(2, '2026-04-01', 1000, false)], accounts, people, 2026);
    expect(r.taxableCents).toBe($(2000));
    expect(r.penaltyCents).toBe($(200)); // Sam is 71
  });
  it('an account with no owner assumes the penalty and says so', () => {
    const r = hsaYearImpact([w(3, '2026-03-01', 1000, false)], accounts, people, 2026);
    expect(r.penaltyCents).toBe($(200));
    expect(r.assumedUnder65).toBe(1);
  });
  it('only counts the requested year', () => {
    const ws = [w(1, '2025-12-31', 1000, false), w(1, '2026-01-01', 300, false)];
    expect(hsaYearImpact(ws, accounts, people, 2026).taxableCents).toBe($(300));
    expect(withdrawalYears(ws)).toEqual([2026, 2025]);
  });
  it('flows into the Income tab: more income and the penalty on top', () => {
    const prof = { ...newProfile(1, 2026), salary: [{ effectiveDate: '2026-01-01', annualCents: $(150000) }] };
    const none = buildIncomeModel(2026, people, [prof], []);
    const imp = hsaYearImpact([w(1, '2026-03-01', 5000, false)], accounts, people, 2026);
    const withHsa = buildIncomeModel(2026, people, [prof], [], undefined, undefined, { taxableCents: imp.taxableCents, penaltyCents: imp.penaltyCents });
    expect(withHsa.household!.federal.otherIncome).toBe($(5000));
    expect(withHsa.household!.federal.hsaPenalty).toBe($(1000));
    expect(withHsa.household!.federal.totalLiability).toBeGreaterThan(none.household!.federal.totalLiability + $(1000));
    expect(withHsa.household!.ma.taxableIncome - none.household!.ma.taxableIncome).toBe($(5000));
  });
});

describe('HSA contributions in projections', () => {
  it('a linked HSA takes payroll saving plus employer money from the Income tab', () => {
    const prof = {
      ...newProfile(1, 2026), salary: [{ effectiveDate: '2026-01-01', annualCents: $(150000) }], employerHsaAnnualCents: $(1000),
      deductions: [{ id: 'h', type: 'hsa' as const, name: 'HSA', mode: 'fixed' as const, value: $(100), appliesToBonus: false, fedExempt: true, ficaExempt: true, stateExempt: true }],
    };
    const m = buildIncomeModel(2026, people, [prof], []);
    expect(baseContribution(acct(1, 1, { linkToIncome: true }), m.years).cents).toBe($(100) * 24 + $(1000));
    expect(baseContribution(acct(1, 1, { linkToIncome: false, annualContributionCents: $(777) }), m.years).cents).toBe($(777));
  });
});

describe('HSA in the Roth planner inputs', () => {
  const income = buildIncomeModel(2026, people, [], []);
  const src: RothSources = {
    year0: 2026, people, profiles: [], income, accounts: [acct(1, 1, { cashCents: $(30000) })], holdings: [], securities: [], classes: [],
    retirement: { retireYear: 2031, spendingCents: $(100000) },
  };
  it('keeps the HSA out of the IRA/401(k)/Roth buckets and passes it as its own bucket', () => {
    const b = buildPlanInput(src, { ...DEFAULT_ROTH, hsaMedicalCents: $(8000) });
    expect(b.hsa).toBe($(30000));
    expect(b.input!.people[0].ira + b.input!.people[0].k401 + b.input!.people[0].roth).toBe(0);
    expect(b.input!.hsa).toEqual({ balanceCents: $(30000), contribCents: 0, medicalCents: $(8000) });
  });
  it('reminds you to enter medical costs', () => {
    expect(buildPlanInput(src, DEFAULT_ROTH).notes.join(' ')).toMatch(/medical costs/);
  });
});

describe('HSA withdrawals survive a backup', () => {
  let d: FinanceDB;
  let n = 0;
  beforeEach(() => { d = new FinanceDB(`hsa-${n++}`); });
  it('round trip', async () => {
    await d.hsaWithdrawals.add(w(1, '2026-03-01', 250, true));
    const file = await exportAll(d);
    expect(file.version).toBe(14);
    await d.hsaWithdrawals.clear();
    await importAll(d, file);
    expect(await d.hsaWithdrawals.count()).toBe(1);
  });
});
