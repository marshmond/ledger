import { describe, expect, it } from 'vitest';
import { TAX_2026, TAX_2027, TAX_YEARS, builtInTables, latestBuiltInYear } from '../data/taxYears';
import { RETIREMENT_RULES_2026, RETIREMENT_RULES_2027, retirementRulesFor } from '../data/retirementTax';
import { bracketTax, catchUpFor, simulatePerson } from './payroll';
import { buildIncomeModel, newDeduction, newProfile, parseTablesJson, resolveTables } from './income';
import { blankScenario, runScenario } from './paycheckCalc';
import { bracketRoom } from './taxPlan';
import { buildPlanInput, DEFAULT_ROTH, planBaseTables, type RothSources } from './rothInputs';
import { provenanceCounts } from '../pages/TaxProvenance';
import type { Bonus, IncomeProfile, Person, RsuVest, TaxSettings } from '../types';

/**
 * 2027 tax-year data. Every expected number below was typed from an official publication (dollars, as printed), not produced by
 * the code under test: IRS Rev. Proc. 2026-35 (brackets with their printed base amounts, standard deduction, capital-gains thresholds,
 * health FSA), IRS Notice 2026-66 (401(k)), IRS Rev. Proc. 2026-24 (HSA), SSA 2027 fact sheet (wage base), MA DFML (PFML).
 * Cases that are plain arithmetic on those numbers are worked out in the comments.
 */

const $ = (n: number) => Math.round(n * 100);
/** Cents versus a dollar figure, allowing up to 25 cents: each of 24+ paychecks is rounded to a cent. */
const near = (cents: number, dollars: number, tolCents = 25) => expect(Math.abs(cents - $(dollars))).toBeLessThanOrEqual(tolCents);

const person = (id: number, birthYear: number): Person => ({ id, name: `P${id}`, birthYear });
const profile2027 = (salary: number, extra: Partial<IncomeProfile> = {}): IncomeProfile => ({
  ...newProfile(1, 2027), salary: [{ effectiveDate: '2027-01-01', annualCents: $(salary) }], ...extra,
});
const noSettings: TaxSettings = { year: 2027, itemizedDeductionCents: 0, otherIncomeCents: 0, federalCreditsCents: 0, maDependents: 0, maCreditsCents: 0 };

describe('2027 table selection', () => {
  it('builtInTables picks the table for the year asked, and still has nothing for years without one', () => {
    expect(builtInTables(2027)?.year).toBe(2027);
    expect(builtInTables(2026)?.year).toBe(2026);
    expect(builtInTables(2028)).toBeNull();
    expect(Object.keys(TAX_YEARS).map(Number)).toEqual([2026, 2027]);
    expect(latestBuiltInYear()).toBe(2027);
    expect(resolveTables(2027)).toMatchObject({ source: 'built-in' });
    expect(resolveTables(2028)).toEqual({ tables: null, source: 'none' });
  });
});

describe('2027 federal figures (IRS Rev. Proc. 2026-35)', () => {
  it('joint brackets start where the revenue procedure says', () => {
    expect(TAX_2027.fedBracketsMFJ.map((b) => [b.over, b.rate])).toEqual([
      [0, 0.1], [$(25600), 0.12], [$(104050), 0.22], [$(218250), 0.24], [$(416650), 0.32], [$(529100), 0.35], [$(793650), 0.37],
    ]);
  });
  it('the tax at each bracket start equals the "tax is" amount printed in the revenue procedure', () => {
    const printed: [number, number][] = [[25600, 2560], [104050, 11974], [218250, 37098], [416650, 84714], [529100, 120698], [793650, 213290.5]];
    for (const [income, tax] of printed) expect(bracketTax($(income), TAX_2027.fedBracketsMFJ)).toBe($(tax));
    // one dollar over $793,650 is taxed at 37%: $213,290.50 + $0.37
    expect(bracketTax($(793651), TAX_2027.fedBracketsMFJ)).toBe($(213290.5 + 0.37));
  });
  it('standard deduction, health FSA and the capital-gains rules', () => {
    expect(TAX_2027.stdDeductionMFJ).toBe($(33200));
    expect(TAX_2027.limits.healthFsa).toBe($(3500));
    expect(RETIREMENT_RULES_2027.ltcg0Top).toBe($(102100));
    expect(RETIREMENT_RULES_2027.ltcg15Top).toBe($(633600));
    expect(RETIREMENT_RULES_2027.addlStdDeduction65).toBe($(1700));
  });
  it('supplemental withholding and the Medicare thresholds are the fixed statutory figures', () => {
    expect(TAX_2027.supplementalFedRate).toBe(0.22);
    expect(TAX_2027.addlMedicareRate).toBe(0.009);
    expect(TAX_2027.addlMedicareWithholdingThreshold).toBe($(200000));
    expect(TAX_2027.addlMedicareThresholdMFJ).toBe($(250000));
    expect(TAX_2027.medicareRate).toBe(0.0145);
  });
});

describe('2027 Social Security, 401(k), HSA, ESPP', () => {
  it('Social Security: 6.2% up to $192,300 (SSA), then none', () => {
    expect(TAX_2027.ssRate).toBe(0.062);
    expect(TAX_2027.ssWageBase).toBe($(192300));
    const y = simulatePerson(profile2027(250000), person(1, 1985), [], TAX_2027);
    near(y.totals.socialSecurity, 192300 * 0.062); // $11,922.60
    expect(y.milestones.ssCapDate).not.toBeNull();
  });
  it('401(k): $25,500, +$8,500 from age 50, +$11,750 instead at 60-63 (Notice 2026-66)', () => {
    expect(TAX_2027.limits.k401Deferral).toBe($(25500));
    const cap = (birthYear: number) => simulatePerson({ ...profile2027(400000), deductions: [{ ...newDeduction('k401_pretax'), value: 50 }] }, person(1, birthYear), [], TAX_2027).limits.k401;
    expect(cap(1990)).toBe($(25500)); // age 37
    expect(cap(1978)).toBe($(25500)); // age 49 in 2027
    expect(cap(1977)).toBe($(25500 + 8500)); // age 50
    expect(cap(1967)).toBe($(25500 + 11750)); // age 60: the enhanced amount
  });
  it('the 60-63 catch-up replaces the regular one, and goes back to it at 64', () => {
    const k = (birth: number) => catchUpFor(person(1, birth), 2027, TAX_2027).k401;
    expect(k(1967)).toBe($(11750)); // 60
    expect(k(1964)).toBe($(11750)); // 63
    expect(k(1963)).toBe($(8500)); // 64
    expect(k(1977)).toBe($(8500)); // 50
    expect(k(1978)).toBe(0); // 49
  });
  it('HSA: $4,500 self-only, $9,000 family, +$1,000 from 55; FSA and ESPP', () => {
    expect(TAX_2027.limits.hsaSelf).toBe($(4500));
    expect(TAX_2027.limits.hsaFamily).toBe($(9000));
    expect(TAX_2027.limits.hsaCatchUp55).toBe($(1000));
    const hsa = (cov: 'self' | 'family', birth: number) =>
      simulatePerson({ ...profile2027(150000), hsaCoverage: cov }, person(1, birth), [], TAX_2027).limits.hsa;
    expect(hsa('self', 1990)).toBe($(4500));
    expect(hsa('family', 1990)).toBe($(9000));
    expect(hsa('family', 1972)).toBe($(10000)); // age 55
    expect(simulatePerson(profile2027(150000), person(1, 1990), [], TAX_2027).limits.fsa).toBe($(3500));
    // $25,000 of stock at grant-date value, bought at a 15% discount -> $21,250 of payroll deductions
    expect(simulatePerson(profile2027(150000), person(1, 1990), [], TAX_2027).limits.espp).toBe($(21250));
  });
});

describe('2027 Massachusetts', () => {
  it('PFML: employee 0.46% (0.28% family + 0.18% medical) up to the $192,300 Social Security maximum', () => {
    expect(TAX_2027.ma.pfmlEmployeeRate).toBe(0.0046);
    expect(0.0028 + 0.0018).toBeCloseTo(TAX_2027.ma.pfmlEmployeeRate, 10);
    expect(TAX_2027.ma.pfmlWageCap).toBe($(192300));
    const y = simulatePerson(profile2027(250000), person(1, 1985), [], TAX_2027);
    near(y.totals.pfml, 192300 * 0.0046); // $884.58, not 0.88% of pay
  });
  it('exemptions and rate', () => {
    expect(TAX_2027.ma.personalExemptionMFJ).toBe($(8800));
    expect(TAX_2027.ma.dependentExemption).toBe($(1000));
    expect(TAX_2027.ma.rate).toBe(0.05);
    expect(TAX_2027.ma.surtaxRate).toBe(0.04);
  });
});

describe('unpublished values are labelled, never invented or zero', () => {
  it('the 2027 MA surtax threshold is a labelled placeholder (the 2026 amount), not zero and not presented as verified', () => {
    expect(TAX_2027.ma.surtaxThreshold).toBe($(1107750));
    const f = TAX_2027.provenance!.fields.find((x) => x.field === 'MA 4% surtax threshold')!;
    expect(f.status).toBe('provisional');
    expect(TAX_2027.notes.join(' ')).toContain('PROVISIONAL');
    const c = provenanceCounts(TAX_2027.provenance!);
    expect(c.provisional).toBe(1); // only the surtax threshold; dependent care FSA is statutory (P.L. 119-21)
    expect(TAX_2027.provenance!.fields.find((x) => x.field === 'Dependent care FSA limit')!.status).toBe('statutory');
    expect(f.note).toContain('not a 2027 figure');
    expect(f.note).toContain('may change');
    expect(c.verified).toBeGreaterThanOrEqual(8);
  });
  it('every provenance source is an official government page', () => {
    for (const s of TAX_2027.provenance!.sources) expect(s.url).toMatch(/^https:\/\/www\.(irs|ssa|mass)\.gov\//);
  });
  it('retirement rules: an unknown year says so instead of passing an older year off as its own', () => {
    expect(retirementRulesFor(2027)).toMatchObject({ ruleYear: 2027, exact: true });
    expect(retirementRulesFor(2026)).toMatchObject({ ruleYear: 2026, exact: true });
    expect(retirementRulesFor(2029)).toMatchObject({ ruleYear: 2027, exact: false });
    expect(retirementRulesFor(2025)).toMatchObject({ ruleYear: 2026, exact: false });
    expect(RETIREMENT_RULES_2027.notes.join(' ')).toContain('NOT VERIFIED for 2027');
  });
  it('a year with no table still produces no results', () => {
    const m = buildIncomeModel(2028, [person(1, 1985)], [{ ...newProfile(1, 2028), salary: [{ effectiveDate: '2028-01-01', annualCents: $(100000) }] }], []);
    expect(m.tableSource).toBe('none');
    expect(m.household).toBeNull();
    expect(m.capGainsRules).toBeNull();
  });
});

describe('2026 stays exactly as it was', () => {
  it('key 2026 values are unchanged (including the Massachusetts surtax figure, a separate open question)', () => {
    expect(TAX_2026.stdDeductionMFJ).toBe($(32200));
    expect(TAX_2026.ssWageBase).toBe($(184500));
    expect(TAX_2026.limits.k401Deferral).toBe($(24500));
    expect(TAX_2026.limits.healthFsa).toBe($(3400));
    expect(TAX_2026.fedBracketsMFJ[1].over).toBe($(24800));
    expect(TAX_2026.ma.surtaxThreshold).toBe($(1083150));
    expect(TAX_2026.ma.pfmlWageCap).toBe($(184500));
    expect(TAX_2026.provenance).toBeUndefined();
    expect(RETIREMENT_RULES_2026.ltcg0Top).toBe($(98900));
    expect(RETIREMENT_RULES_2026.ltcg15Top).toBe($(613700));
    expect(RETIREMENT_RULES_2026.addlStdDeduction65).toBe($(1650));
  });
  it('a 2026 household is taxed with the 2026 numbers', () => {
    // $150,000 wages, nothing else: taxable 150,000 - 32,200 = 117,800.
    // 10% x 24,800 + 12% x (100,800 - 24,800) + 22% x (117,800 - 100,800) = 2,480 + 9,120 + 3,740 = 15,340.
    const p = { ...newProfile(1, 2026), salary: [{ effectiveDate: '2026-01-01', annualCents: $(150000) }] };
    const h = buildIncomeModel(2026, [person(1, 1985)], [p], []).household!;
    expect(h.federal.taxableIncome).toBe($(117800));
    expect(h.federal.taxBeforeCredits).toBe($(15340));
  });
  it('2026 capital gains use the 2026 zero-rate limit of $98,900', () => {
    // Wages 120,000 + long-term gain 20,000 = 140,000; less 32,200 = 107,800 taxable; ordinary part 87,800.
    // 15% applies above 98,900: 107,800 - 98,900 = 8,900 -> $1,335.
    const p = { ...newProfile(1, 2026), salary: [{ effectiveDate: '2026-01-01', annualCents: $(120000) }] };
    const h = buildIncomeModel(2026, [person(1, 1985)], [p], [], undefined, undefined, undefined, { stcgCents: 0, ltcgCents: $(20000), lossDeductionCents: 0 }).household!;
    expect(h.federal.capitalGainsTax).toBe($(1335));
  });
});

describe('2027 in the Income calculation', () => {
  it('uses the built-in 2027 table and a 2027 household is taxed with 2027 numbers', () => {
    // $150,000 wages: taxable 150,000 - 33,200 = 116,800.
    // 2,560 (printed base at 25,600) + 12% x (104,050 - 25,600) = 9,414 -> 11,974, + 22% x (116,800 - 104,050) = 2,805 -> 14,779.
    const m = buildIncomeModel(2027, [person(1, 1985)], [profile2027(150000)], []);
    expect(m.tableSource).toBe('built-in');
    expect(m.tables?.year).toBe(2027);
    expect(m.capGainsRules).toEqual({ ruleYear: 2027, exact: true });
    expect(m.household!.federal.taxableIncome).toBe($(116800));
    expect(m.household!.federal.taxBeforeCredits).toBe($(14779));
  });
  it('2027 capital gains use $102,100 and 15% above it', () => {
    // Wages 120,000 + long-term gain 20,000 = 140,000; less 33,200 = 106,800 taxable; ordinary part 86,800.
    // 0% up to 102,100; 15% on 106,800 - 102,100 = 4,700 -> $705.
    const m = buildIncomeModel(2027, [person(1, 1985)], [profile2027(120000)], [], undefined, undefined, undefined, { stcgCents: 0, ltcgCents: $(20000), lossDeductionCents: 0 });
    expect(m.household!.federal.capitalGainsTax).toBe($(705));
  });
  it('tax planning: room in the 0% gains band uses the table year', () => {
    expect(bracketRoom(TAX_2027, $(80000), 0).zeroGainRoomCents).toBe($(22100)); // 102,100 - 80,000
    expect(bracketRoom(TAX_2026, $(80000), 0).zeroGainRoomCents).toBe($(18900)); // 98,900 - 80,000
  });
  it('a saved 2027 custom table still wins over the built-in one, and resetting returns to built-in', () => {
    const custom = JSON.stringify({ ...TAX_2026, year: 2027, ssWageBase: $(190000) });
    const r = resolveTables(2027, { ...noSettings, tablesOverride: custom });
    expect(r.source).toBe('custom');
    expect(r.tables?.ssWageBase).toBe($(190000));
    expect(resolveTables(2027, { ...noSettings, tablesOverride: undefined }).tables?.ssWageBase).toBe($(192300));
    // a broken saved copy falls back to the built-in 2027 table
    expect(resolveTables(2027, { ...noSettings, tablesOverride: '{broken' }).source).toBe('built-in');
    // edited text exported from the page (no provenance) is still accepted for 2027
    const { provenance: _p, ...editable } = TAX_2027;
    void _p;
    expect(parseTablesJson(JSON.stringify(editable), 2027).tables?.year).toBe(2027);
    // the built-in table is not touched by any of this
    expect(TAX_2027.ssWageBase).toBe($(192300));
  });
});

describe('a representative 2027 year: salary, bonus and RSU vest', () => {
  // Alex, born 1985, $150,000 salary, a $60,000 December bonus and a $10,000 cash-settled RSU vest in June. No deductions.
  const bonus: Bonus = { personId: 1, year: 2027, month: 12, grossCents: $(60000), label: 'Bonus' };
  const vest: RsuVest = { id: 1, personId: 1, date: '2027-06-15', grant: 'g', kind: 'cash', shares: 100, priceCents: $(100) };
  const m = buildIncomeModel(2027, [person(1, 1985)], [profile2027(150000)], [bonus], undefined, { vests: [vest], securities: [] });
  const t = m.years[0].totals;
  it('gross is $220,000', () => near(t.gross, 220000, 0));
  it('Social Security stops at the $192,300 wage base: $11,922.60', () => near(t.socialSecurity, 11922.6));
  it('Medicare 1.45% of everything ($3,190) and Additional Medicare 0.9% of the $20,000 above $200,000 ($180)', () => {
    near(t.medicare, 3190);
    near(t.addlMedicare, 180);
  });
  it('MA PFML is 0.46% of the first $192,300: $884.58', () => near(t.pfml, 884.58));
  it('household tax: taxable 220,000 - 33,200 = 186,800; 11,974 + 22% x (186,800 - 104,050) = 30,179', () => {
    expect(m.household!.federal.taxableIncome).toBe($(186800));
    expect(m.household!.federal.taxBeforeCredits).toBe($(30179));
  });
  it('the bonus and the vest are withheld at the flat 22% supplemental rate', () => {
    const b = m.years[0].events.find((e) => e.kind === 'bonus')!;
    const r = m.years[0].events.find((e) => e.kind === 'rsu')!;
    expect(b.fedWithholding).toBe($(13200)); // 60,000 x 22%
    expect(r.fedWithholding).toBe($(2200)); // 10,000 x 22%
  });
});

describe('Paycheck calculator with 2027', () => {
  it('a new 2027 scenario resolves the 2027 tables and caps Social Security at $192,300', () => {
    const sc = blankScenario(1, 2027, 'New job', $(250000), '2026-11-13T12:00:00.000Z');
    const res = runScenario(sc, { people: [person(1, 1985)], profiles: [], bonuses: [] });
    expect(res).not.toBeNull();
    near(res!.year.totals.socialSecurity, 192300 * 0.062);
  });
  it('a 2026 scenario still uses the 2026 wage base of $184,500', () => {
    const sc = blankScenario(1, 2026, 'Old', $(250000), '2026-11-13T12:00:00.000Z');
    const res = runScenario(sc, { people: [person(1, 1985)], profiles: [], bonuses: [] });
    near(res!.year.totals.socialSecurity, 184500 * 0.062);
  });
  it('a 2028 scenario has no tables and is not calculated', () => {
    const sc = blankScenario(1, 2028, 'Later', $(250000), '2026-11-13T12:00:00.000Z');
    expect(runScenario(sc, { people: [person(1, 1985)], profiles: [], bonuses: [] })).toBeNull();
  });
});

describe('Roth planner base tables follow the plan year', () => {
  it('chooses the newest built-in year that is not after the first plan year', () => {
    expect(planBaseTables(2025).year).toBe(2026);
    expect(planBaseTables(2026).year).toBe(2026);
    expect(planBaseTables(2027).year).toBe(2027);
    expect(planBaseTables(2030).year).toBe(2027);
  });
  const people = [person(1, 1966), person(2, 1968)];
  const src = (year0: number): RothSources => ({
    year0, people, profiles: [], income: buildIncomeModel(2026, people, [], []), accounts: [], holdings: [], securities: [], classes: [], retirement: { retireYear: 2031, spendingCents: $(100000) },
  });
  it('a plan starting in 2026 is unchanged; one starting in 2027 uses the 2027 tables and rules', () => {
    const a = buildPlanInput(src(2026), DEFAULT_ROTH).input;
    const b = buildPlanInput(src(2027), DEFAULT_ROTH).input;
    expect(a?.T.year).toBe(2026);
    expect(a?.R.ltcg0Top).toBe($(98900));
    expect(b?.T.year).toBe(2027);
    expect(b?.R.ltcg0Top).toBe($(102100));
    expect(b?.T.stdDeductionMFJ).toBe($(33200));
  });
  it('a later start year says it is scaling the 2027 tables', () => {
    const c = buildPlanInput(src(2029), DEFAULT_ROTH);
    expect(c.input?.T.year).toBe(2027);
    expect(c.notes.join(' ')).toContain('No built-in 2029 tax tables yet');
  });
});
