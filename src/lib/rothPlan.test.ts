import { describe, expect, it } from 'vitest';
import { TAX_2026 as T } from '../data/taxYears';
import { RETIREMENT_RULES_2026 as R } from '../data/retirementTax';
import { comparePlans, firstRmdYear, makeZPaths, NO_CONVERSION, planEndYear, runMonteCarlo, simulatePlan, type PlanInput, type PlanPerson, type Strategy } from './rothPlan';

const $ = (n: number) => Math.round(n * 100);

const person = (p: Partial<PlanPerson> = {}): PlanPerson => ({
  name: 'A', birthYear: 1965, retireYear: 2031, wagesCents: 0, contribTradCents: 0, contribRothCents: 0, ssAnnualCents: 0, ssClaimAge: 67,
  ira: 0, k401: 0, roth: 0, iraBasisCents: 0, ...p,
});
const input = (p: Partial<PlanInput> = {}): PlanInput => ({
  startYear: 2026, planAge: 95, people: [person({ ira: $(1000000), name: 'A' }), person({ ira: $(500000), birthYear: 1966, name: 'B' })],
  taxableCents: $(300000), taxableBasisCents: $(200000), other: [], extraWages: {}, spendingCents: $(100000),
  inflationPct: 2.5, wageGrowthPct: 3, returnPct: { trad: 6, roth: 6, taxable: 6 }, volPct: 12, yieldPct: 2, yieldOrdinaryPct: 40,
  aca: { on: false, benchmarkCents: $(24000), premiumGrowthPct: 5 }, conversionTaxFrom: 'outside', endTaxRatePct: 24, heirTaxRatePct: 24, T, R, ...p,
});
const flat = (p: Partial<PlanInput> = {}) => input({ inflationPct: 0, wageGrowthPct: 0, returnPct: { trad: 0, roth: 0, taxable: 0 }, yieldPct: 0, spendingCents: 0, ...p });
const strat = (s: Partial<Strategy>): Strategy => ({ ...NO_CONVERSION(2026, 2040), id: 's', label: 's', ...s });
const wealth = (i: PlanInput, s: Strategy) => {
  const r = simulatePlan(i, s);
  return { r, total: r.summary.endWealth + r.summary.lifetimeCost };
};
const initial = (i: PlanInput) => i.people.reduce((a, p) => a + p.ira + p.k401 + p.roth, 0) + i.taxableCents;

describe('plan horizon and dates', () => {
  it('runs until the youngest person reaches the plan age', () => {
    expect(planEndYear(input())).toBe(1966 + 95);
    expect(simulatePlan(input(), NO_CONVERSION(2026, 2040)).rows.length).toBe(1966 + 95 - 2026 + 1);
  });
  it('first RMD year is the earliest anyone reaches their start age', () => {
    expect(firstRmdYear(input())).toBe(1965 + 75);
    expect(firstRmdYear(input({ people: [person({ birthYear: 1955 }), person({ birthYear: 1962 })] }))).toBe(1955 + 73);
  });
});

describe('money is conserved', () => {
  it('no conversions: what is left plus all taxes equals what you started with (no growth, no spending)', () => {
    const i = flat();
    const { total } = wealth(i, NO_CONVERSION(2026, 2040));
    expect(Math.abs(total - initial(i))).toBeLessThan(100);
  });
  it('with conversions the same holds (the tax comes out of the taxable account)', () => {
    const i = flat();
    const { total, r } = wealth(i, strat({ kind: 'fixed', fixedCents: $(60000) }));
    expect(r.summary.totalConverted).toBeGreaterThan(0);
    expect(Math.abs(total - initial(i))).toBeLessThan(100);
  });
  it('...and when the tax is taken out of the conversion itself', () => {
    const i = flat({ conversionTaxFrom: 'conversion' });
    const { total, r } = wealth(i, strat({ kind: 'fixed', fixedCents: $(60000) }));
    expect(r.summary.totalConverted).toBeGreaterThan(0);
    expect(Math.abs(total - initial(i))).toBeLessThan(100);
  });
  it('with spending: wealth + taxes + spending equals the start (no growth, no inflation)', () => {
    const i = flat({ spendingCents: $(60000), people: [person({ ira: $(900000), retireYear: 2026 }), person({ ira: $(400000), birthYear: 1966, retireYear: 2026 })], planAge: 80 });
    const r = simulatePlan(i, NO_CONVERSION(2026, 2030));
    const spent = r.rows.reduce((a, row) => a + row.spending, 0);
    expect(Math.abs(r.summary.endWealth + r.summary.lifetimeCost + spent - initial(i))).toBeLessThan(100);
  });
});

describe('conversions', () => {
  it('a fixed conversion moves that amount from the traditional IRA to Roth, once taxes are paid from outside', () => {
    const i = flat({ spendingCents: 0, planAge: 70, people: [person({ ira: $(500000) })], taxableCents: $(200000), taxableBasisCents: $(200000) });
    const r = simulatePlan(i, strat({ kind: 'fixed', fixedCents: $(50000), fromYear: 2026, toYear: 2026 }));
    expect(r.rows[0].conversion).toBe($(50000));
    expect(r.rows[0].roth).toBe($(50000));
    expect(r.rows[0].trad).toBe($(450000));
    expect(r.rows[1].conversion).toBe(0);
  });
  it('is limited by what is in the IRA', () => {
    const i = flat({ planAge: 70, people: [person({ ira: $(30000) })] });
    const r = simulatePlan(i, strat({ kind: 'fixed', fixedCents: $(50000), fromYear: 2026, toYear: 2026 }));
    expect(r.rows[0].conversion).toBe($(30000));
    expect(r.rows[0].trad).toBe(0);
  });
  it('401(k) money cannot be converted until the owner retires, then it rolls into the IRA', () => {
    const i = flat({ planAge: 80, people: [person({ k401: $(400000), retireYear: 2030, wagesCents: $(150000) })] });
    const r = simulatePlan(i, strat({ kind: 'fixed', fixedCents: $(40000), fromYear: 2026, toYear: 2034 }));
    expect(r.rows.find((x) => x.year === 2029)!.conversion).toBe(0);
    expect(r.rows.find((x) => x.year === 2030)!.conversion).toBe($(40000));
  });
  it('after-tax IRA money (pro-rata rule) makes part of each conversion tax-free', () => {
    const i = flat({ planAge: 70, people: [person({ ira: $(100000), iraBasisCents: $(20000) })], taxableCents: $(100000) });
    const r = simulatePlan(i, strat({ kind: 'fixed', fixedCents: $(50000), fromYear: 2026, toYear: 2026 }));
    expect(r.rows[0].convTaxable).toBe($(40000)); // 80% of the conversion is taxable
  });
  it('filling a bracket stops at the top of that bracket', () => {
    const i = input({ planAge: 80, people: [person({ ira: $(3000000), retireYear: 2026 }), person({ ira: $(1000000), birthYear: 1966, retireYear: 2026 })] });
    const r = simulatePlan(i, strat({ kind: 'bracket', bracketRate: 0.22, fromYear: 2026, toYear: 2030 }));
    const converting = r.rows.filter((x) => x.conversion > 0);
    expect(converting.length).toBeGreaterThan(0);
    for (const row of converting) expect(row.marginal).toBe(0.22);
    // converting a bit more would reach the 24% bracket: compare against a fixed conversion $20,000 larger
    const row0 = r.rows[0];
    const more = simulatePlan(i, strat({ kind: 'fixed', fixedCents: row0.conversion + $(20000), fromYear: 2026, toYear: 2026 }));
    expect(more.rows[0].marginal).toBe(0.24);
  });
  it('a higher bracket converts more', () => {
    const i = input({ planAge: 80, people: [person({ ira: $(3000000), retireYear: 2026 }), person({ ira: $(1000000), birthYear: 1966, retireYear: 2026 })] });
    const a = simulatePlan(i, strat({ kind: 'bracket', bracketRate: 0.12, fromYear: 2026, toYear: 2026 }));
    const b = simulatePlan(i, strat({ kind: 'bracket', bracketRate: 0.24, fromYear: 2026, toYear: 2026 }));
    expect(b.rows[0].conversion).toBeGreaterThan(a.rows[0].conversion);
  });
  it('a table strategy converts exactly the amounts given', () => {
    const i = flat({ planAge: 70, people: [person({ ira: $(500000) })] });
    const r = simulatePlan(i, strat({ kind: 'table', table: { 2026: $(10000), 2028: $(25000) } }));
    expect(r.rows.map((x) => x.conversion).slice(0, 3)).toEqual([$(10000), 0, $(25000)]);
  });
  it('conversions are the same amount in today’s dollars when inflation is on', () => {
    const i = input({ planAge: 80, spendingCents: 0, people: [person({ ira: $(2000000), retireYear: 2026 })], taxableCents: $(500000) });
    const r = simulatePlan(i, strat({ kind: 'fixed', fixedCents: $(50000), fromYear: 2026, toYear: 2030 }));
    expect(r.rows[0].conversion).toBe($(50000));
    expect(r.rows[4].conversion).toBe(Math.round($(50000) * Math.pow(1.025, 4)));
  });
});

describe('required minimum distributions in the plan', () => {
  it('start at the right age and use last year-end balance over the table factor', () => {
    const i = flat({ startYear: 2026, planAge: 100, people: [person({ birthYear: 1950, ira: $(1000000), retireYear: 2020 })], taxableCents: 0 });
    const r = simulatePlan(i, NO_CONVERSION(2026, 2030));
    expect(r.rows[0].rmd).toBe(Math.round($(1000000) / 23.7)); // age 76 in 2026
  });
  it('conversions shrink later RMDs', () => {
    const i = input({ planAge: 100, spendingCents: $(60000), people: [person({ birthYear: 1960, ira: $(2000000), retireYear: 2026 })] });
    const none = simulatePlan(i, NO_CONVERSION(2026, 2034));
    const conv = simulatePlan(i, strat({ kind: 'bracket', bracketRate: 0.24, fromYear: 2026, toYear: 2034 }));
    const y = 1960 + 75;
    expect(conv.rows.find((x) => x.year === y)!.rmd).toBeLessThan(none.rows.find((x) => x.year === y)!.rmd);
    expect(conv.summary.endRoth).toBeGreaterThan(none.summary.endRoth);
  });
});

describe('healthcare costs', () => {
  it('the IRMAA cap keeps income at the first tier when someone will be on Medicare in two years', () => {
    const i = input({ planAge: 85, spendingCents: $(60000), people: [person({ birthYear: 1968, ira: $(4000000), retireYear: 2026 })] });
    const capped = simulatePlan(i, strat({ kind: 'bracket', bracketRate: 0.35, fromYear: 2026, toYear: 2040, capIrmaa: true }));
    const uncapped = simulatePlan(i, strat({ kind: 'bracket', bracketRate: 0.35, fromYear: 2026, toYear: 2040 }));
    const y = 1968 + 63; // two years before 65
    const row = capped.rows.find((x) => x.year === y)!;
    expect(row.agi).toBeLessThanOrEqual(Math.round(R.irmaaThresholds[0] * Math.pow(1.025, y - 2026)));
    expect(uncapped.rows.find((x) => x.year === y)!.agi).toBeGreaterThan(row.agi);
    expect(capped.summary.irmaa).toBeLessThanOrEqual(uncapped.summary.irmaa);
  });
  it('before Medicare, the ACA credit is lost above the cliff; the ACA cap avoids it', () => {
    const i = input({ planAge: 80, spendingCents: $(60000), aca: { on: true, benchmarkCents: $(20000), premiumGrowthPct: 0 }, people: [person({ birthYear: 1966, ira: $(2000000), retireYear: 2026 })] });
    const bracket = strat({ kind: 'bracket', bracketRate: 0.24, fromYear: 2026, toYear: 2030 });
    const free = simulatePlan(i, bracket);
    const capped = simulatePlan(i, { ...bracket, capAca: true });
    expect(free.rows[0].acaSubsidy).toBe(0);
    expect(capped.rows[0].acaSubsidy).toBeGreaterThan(0);
    expect(capped.rows[0].conversion).toBeLessThan(free.rows[0].conversion);
    expect(capped.rows[0].acaNet).toBeLessThan(free.rows[0].acaNet);
    // no marketplace premium once everyone is 65
    expect(free.rows.find((x) => x.year === 1966 + 65)!.acaNet).toBe(0);
  });
});

describe('running out of money', () => {
  it('flags the first year the money cannot cover spending', () => {
    const i = flat({ planAge: 90, spendingCents: $(200000), people: [person({ ira: $(300000), retireYear: 2026 })], taxableCents: $(50000) });
    const r = simulatePlan(i, NO_CONVERSION(2026, 2030));
    expect(r.summary.failedYear).not.toBeNull();
    expect(r.warnings[0]).toMatch(/runs out/);
  });
  it('a comfortable plan does not fail', () => {
    const r = simulatePlan(input({ spendingCents: $(60000) }), NO_CONVERSION(2026, 2030));
    expect(r.summary.failedYear).toBeNull();
  });
});

describe('income in the plan', () => {
  it('Social Security starts at the claim age, grows with inflation, and is partly taxable', () => {
    const i = input({ planAge: 85, people: [person({ ira: $(500000), retireYear: 2026, ssAnnualCents: $(36000), ssClaimAge: 67 })] });
    const r = simulatePlan(i, NO_CONVERSION(2026, 2030));
    expect(r.rows.find((x) => x.year === 1965 + 66)!.ss).toBe(0);
    expect(r.rows.find((x) => x.year === 1965 + 67)!.ss).toBe(Math.round($(36000) * Math.pow(1.025, 1965 + 67 - 2026)));
  });
  it('RSU vests count as wages in their year', () => {
    const base = simulatePlan(input({ planAge: 70 }), NO_CONVERSION(2026, 2030));
    const withVest = simulatePlan(input({ planAge: 70, extraWages: { 2027: $(80000) } }), NO_CONVERSION(2026, 2030));
    expect(withVest.rows[1].wages - base.rows[1].wages).toBe($(80000));
    expect(withVest.rows[1].fed).toBeGreaterThan(base.rows[1].fed);
  });
  it('pensions and other income are taxed', () => {
    const r = simulatePlan(input({ planAge: 70, other: [{ label: 'Pension', annualCents: $(30000), startYear: 2026, endYear: null, taxablePct: 100 }] }), NO_CONVERSION(2026, 2030));
    expect(r.rows[0].other).toBe($(30000));
  });
});

describe('comparing strategies', () => {
  it('reports the best strategy for each goal and ignores strategies that run out of money', () => {
    const i = input({ planAge: 90, spendingCents: $(90000), people: [person({ ira: $(2500000), retireYear: 2026 }), person({ ira: $(500000), birthYear: 1966, retireYear: 2026 })] });
    const list = [NO_CONVERSION(2026, 2034), { ...strat({ kind: 'bracket', bracketRate: 0.22, fromYear: 2026, toYear: 2034 }), id: 'b22' }, { ...strat({ kind: 'bracket', bracketRate: 0.24, fromYear: 2026, toYear: 2034 }), id: 'b24' }];
    const { results, winners } = comparePlans(i, list);
    expect(results).toHaveLength(3);
    expect(['none', 'b22', 'b24']).toContain(winners.lowestCost);
    expect(['none', 'b22', 'b24']).toContain(winners.highestHeirs);
    // converting a large IRA lowers the taxes heirs pay, so some conversion beats none for heirs
    expect(winners.highestHeirs).not.toBe('none');
  });
});

describe('random returns', () => {
  const i = input({ planAge: 90, spendingCents: $(70000), people: [person({ ira: $(1500000), retireYear: 2026 })] });
  const s = NO_CONVERSION(2026, 2034);
  const years = planEndYear(i) - i.startYear + 1;

  it('are reproducible, and the same paths are used for every strategy', () => {
    const a = makeZPaths(20, years, 3);
    const b = makeZPaths(20, years, 3);
    expect(a).toEqual(b);
    expect(runMonteCarlo(i, s, a)).toEqual(runMonteCarlo(i, s, b));
  });
  it('with no volatility every future equals the steady path', () => {
    const steady = simulatePlan({ ...i, volPct: 0 }, s).summary;
    const mc = runMonteCarlo({ ...i, volPct: 0 }, s, makeZPaths(5, years));
    expect(mc.endWealthReal[1]).toBe(steady.endWealthReal);
    expect(mc.successPct).toBe(steady.failedYear === null ? 100 : 0);
  });
  it('more spending lowers the success rate', () => {
    const paths = makeZPaths(60, years, 11);
    const lo = runMonteCarlo({ ...i, spendingCents: $(50000) }, s, paths);
    const hi = runMonteCarlo({ ...i, spendingCents: $(160000) }, s, paths);
    expect(hi.successPct).toBeLessThan(lo.successPct);
    expect(lo.heirsReal[0]).toBeLessThanOrEqual(lo.heirsReal[1]);
    expect(lo.heirsReal[1]).toBeLessThanOrEqual(lo.heirsReal[2]);
  });
});
