import { describe, expect, it } from 'vitest';
import { buildIncomeModel, newProfile } from './income';
import { buildPlanInput, DEFAULT_ROTH, starterStrategies, type RothSources } from './rothInputs';
import { rmdStartAge } from '../data/retirementTax';
import type { AssetClass, Holding, InvAccount, Person, RsuVest, Security } from '../types';

const $ = (n: number) => Math.round(n * 100);
const people: Person[] = [{ id: 1, name: 'Alex', birthYear: 1966 }, { id: 2, name: 'Sam', birthYear: 1968 }];
const cls: AssetClass[] = [{ id: 1, name: 'Stocks', kind: 'equity', expectedReturnPct: 8, volatilityPct: 16 }, { id: 2, name: 'Bonds', kind: 'bond', expectedReturnPct: 4, volatilityPct: 6 }];
const secs: Security[] = [
  { id: 1, ticker: 'STK', name: 'Stock fund', assetClassId: 1, priceCents: $(100), priceDate: '2026-10-01', priceSource: 'manual' },
  { id: 2, ticker: 'BND', name: 'Bond fund', assetClassId: 2, priceCents: $(50), priceDate: '2026-10-01', priceSource: 'manual' },
];
const acct = (id: number, name: string, kind: InvAccount['kind'], taxType: InvAccount['taxType'], personId: number | null): InvAccount => ({
  id, name, kind, taxType, personId, cashCents: 0, annualContributionCents: 0, contributionGrowthPct: 0, linkToIncome: false,
});
const accounts = [
  acct(1, 'Alex IRA', 'ira', 'traditional', 1), acct(2, 'Alex 401k', '401k', 'traditional', 1), acct(3, 'Sam 401k', '401k', 'traditional', 2),
  acct(4, 'Roth', 'ira', 'roth', 2), acct(5, 'Brokerage', 'brokerage', 'taxable', null), acct(6, '529', '529', '529', null),
];
const hold = (accountId: number, securityId: number, shares: number, basis: number | null = null): Holding => ({ accountId, securityId, shares, costBasisCents: basis });
const holdings = [hold(1, 1, 1000), hold(2, 1, 2000), hold(3, 2, 4000), hold(4, 1, 500), hold(5, 1, 1000, $(60000)), hold(6, 1, 9999)];

const profileA = { ...newProfile(1, 2026), salary: [{ effectiveDate: '2026-01-01', annualCents: $(150000) }] };
const vests: RsuVest[] = [
  { id: 1, personId: 1, date: '2026-12-15', grant: 'g', kind: 'cash', shares: 100, priceCents: $(10) },
  { id: 2, personId: 1, date: '2027-03-15', grant: 'g', kind: 'cash', shares: 200, priceCents: $(10) },
  { id: 3, personId: 1, date: '2025-03-15', grant: 'old', kind: 'cash', shares: 50, priceCents: $(10) },
];
const income = buildIncomeModel(2026, people, [profileA], [], undefined, { vests, securities: secs });
const src = (p: Partial<RothSources> = {}): RothSources => ({
  year0: 2026, people, profiles: [profileA], income, accounts, holdings, securities: secs, classes: cls, retirement: { retireYear: 2031, spendingCents: $(100000) }, ...p,
});

describe('building the plan from your data', () => {
  it('sorts accounts into each person’s IRA, 401(k), and Roth, and the household taxable account; 529s are left out', () => {
    const b = buildPlanInput(src(), DEFAULT_ROTH);
    const [a, s] = b.input!.people;
    expect(a.ira).toBe($(100000));
    expect(a.k401).toBe($(200000));
    expect(s.k401).toBe($(200000));
    expect(s.roth).toBe($(50000));
    expect(b.input!.taxableCents).toBe($(100000));
    expect(b.input!.taxableBasisCents).toBe($(60000));
  });
  it('an account with no owner counts as the first person’s, with a note', () => {
    const b = buildPlanInput(src({ accounts: [...accounts.slice(0, 4), acct(7, 'Orphan IRA', 'ira', 'traditional', null)], holdings: [...holdings, hold(7, 1, 100)] }), DEFAULT_ROTH);
    expect(b.input!.people[0].ira).toBe($(100000) + $(10000));
    expect(b.notes.join(' ')).toMatch(/Orphan IRA/);
  });
  it('wages and 401(k) saving come from the Income tab, without RSU vests', () => {
    const b = buildPlanInput(src(), DEFAULT_ROTH);
    expect(b.input!.people[0].wagesCents).toBe($(150000));
    expect(b.input!.people[1].wagesCents).toBe(0);
    expect(b.notes.join(' ')).toMatch(/Sam has no 2026 income setup/);
  });
  it('RSU vests from this year on become extra wages in the year they vest', () => {
    const b = buildPlanInput(src(), DEFAULT_ROTH);
    expect(b.input!.extraWages).toEqual({ 2026: $(1000), 2027: $(2000) });
  });
  it('spending and retirement year default from the Retirement tab and can be overridden', () => {
    const b = buildPlanInput(src(), DEFAULT_ROTH);
    expect(b.input!.spendingCents).toBe($(100000));
    expect(b.input!.people[0].retireYear).toBe(2031);
    const o = buildPlanInput(src(), { ...DEFAULT_ROTH, spendingCents: $(80000), perPerson: [{ personId: 1, retireYear: 2029, ssAnnualCents: $(36000), ssClaimAge: 70, iraBasisCents: $(5000) }] });
    expect(o.input!.spendingCents).toBe($(80000));
    expect(o.input!.people[0]).toMatchObject({ retireYear: 2029, ssAnnualCents: $(36000), ssClaimAge: 70, iraBasisCents: $(5000) });
    expect(o.input!.people[1].retireYear).toBe(2031);
  });
  it('estimates returns from the asset classes you hold, weighted by value', () => {
    const b = buildPlanInput(src(), DEFAULT_ROTH);
    // trad: STK 3000 sh x $100 = $300k at 8%, BND 4000 x $50 = $200k at 4%
    expect(b.estReturn.trad).toBeCloseTo((300000 * 8 + 200000 * 4) / 500000, 6);
    expect(b.input!.returnPct.trad).toBeCloseTo(6.4, 6);
    expect(buildPlanInput(src(), { ...DEFAULT_ROTH, returnPct: { trad: 5, roth: null, taxable: null } }).input!.returnPct.trad).toBe(5);
  });
  it('says what is missing', () => {
    const none = buildPlanInput(src({ people: [] }), DEFAULT_ROTH);
    expect(none.input).toBeNull();
    expect(none.problems.join(' ')).toMatch(/Income tab/);
    const noBirth = buildPlanInput(src({ people: [{ id: 1, name: 'Alex' }, people[1]] }), DEFAULT_ROTH);
    expect(noBirth.problems.join(' ')).toMatch(/Alex needs a birth year/);
    const noSpend = buildPlanInput(src({ retirement: { retireYear: 2031, spendingCents: 0 } }), DEFAULT_ROTH);
    expect(noSpend.problems.join(' ')).toMatch(/spending/);
    const noPrice = buildPlanInput(src({ securities: [{ ...secs[0], priceCents: null }, secs[1]] }), DEFAULT_ROTH);
    expect(noPrice.problems.join(' ')).toMatch(/STK/);
  });
});

describe('starter strategies', () => {
  it('start with no conversions and use your dates', () => {
    const input = buildPlanInput(src(), DEFAULT_ROTH).input!;
    const list = starterStrategies(input);
    expect(list[0].kind).toBe('none');
    expect(list.length).toBeGreaterThanOrEqual(4);
    const lastBefore = Math.min(...input.people.map((p) => p.birthYear + rmdStartAge(p.birthYear))) - 1;
    for (const s of list.slice(1)) expect(s.toYear).toBe(lastBefore);
    expect(list.find((s) => s.id === 'gap24')!.fromYear).toBe(2031);
    expect(new Set(list.map((s) => s.id)).size).toBe(list.length);
  });
});
