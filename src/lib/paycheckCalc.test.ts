import { describe, expect, it } from 'vitest';
import { TAX_2026 as T } from '../data/taxYears';
import { defaultFlags } from './payroll';
import { newDeduction, newProfile } from './income';
import { blankScenario, headline, paycheckLines, runActual, runScenario, scenarioFromProfile, type ScenarioInputs } from './paycheckCalc';
import type { Bonus, IncomeProfile, Person } from '../types';

const $ = (n: number) => Math.round(n * 100);
const people: Person[] = [{ id: 1, name: 'Alex', birthYear: 1985 }, { id: 2, name: 'Sam', birthYear: 1986 }];
const prof = (personId: number, salary: number, extra: Partial<IncomeProfile> = {}): IncomeProfile => ({
  ...newProfile(personId, 2026), salary: [{ effectiveDate: '2026-01-01', annualCents: $(salary) }], ...extra,
});
const k401 = (pct: number) => ({ ...newDeduction('k401_pretax'), value: pct });
const inputs = (profiles: IncomeProfile[], bonuses: Bonus[] = []): ScenarioInputs => ({ people, profiles, bonuses });

describe('starting a scenario', () => {
  it('copies the real setup without sharing it', () => {
    const real = prof(1, 150000, { deductions: [k401(10)] });
    const sc = scenarioFromProfile(real, 'What-if');
    expect(sc.profile.deductions).toEqual(real.deductions);
    sc.profile.deductions[0].value = 20;
    sc.profile.salary[0].annualCents = 1;
    expect(real.deductions[0].value).toBe(10);
    expect(real.salary[0].annualCents).toBe($(150000));
    expect(sc.startedFrom).toBe('income');
  });
  it('a blank scenario has the salary and no deductions', () => {
    const sc = blankScenario(1, 2026, 'New job', $(200000));
    expect(sc.profile.deductions).toEqual([]);
    expect(sc.profile.salary[0].annualCents).toBe($(200000));
    expect(sc.startedFrom).toBe('blank');
  });
});

describe('running a scenario', () => {
  const real = prof(1, 150000, { deductions: [k401(10)] });
  const inp = inputs([real, prof(2, 100000)]);

  it('a copy of the real setup gives the same numbers as the Income tab', () => {
    const a = runActual(1, 2026, inp)!;
    const b = runScenario(scenarioFromProfile(real, 'x'), inp)!;
    expect(b.year.totals.net).toBe(a.year.totals.net);
    expect(a.year.totals.gross).toBe($(150000));
  });
  it('a raise raises gross and take-home; more 401(k) lowers take-home but raises saving', () => {
    const base = runScenario(scenarioFromProfile(real, 'base'), inp)!;
    const raise = scenarioFromProfile(real, 'raise');
    raise.profile.salary = [{ effectiveDate: '2026-01-01', annualCents: $(180000) }];
    const r = runScenario(raise, inp)!;
    expect(r.year.totals.gross).toBe($(180000));
    expect(r.year.totals.net).toBeGreaterThan(base.year.totals.net);
    const more = scenarioFromProfile(real, 'more');
    more.profile.deductions = [k401(15)];
    const m = runScenario(more, inp)!;
    expect(m.year.totals.net).toBeLessThan(base.year.totals.net);
    expect(m.year.contributions.k401Pretax).toBeGreaterThan(base.year.contributions.k401Pretax);
  });
  it('bonuses in the scenario count; the real bonuses are not copied in', () => {
    const sc = scenarioFromProfile(real, 'bonus');
    sc.bonuses = [{ month: 12, grossCents: $(20000), label: 'Annual' }];
    expect(runScenario(sc, inputs([real, prof(2, 100000)], [{ personId: 1, year: 2026, month: 3, grossCents: $(99999), label: 'real' }]))!.year.totals.bonusGross).toBe($(20000));
  });
  it('yearly tax uses the other person’s real income when asked', () => {
    const sc = scenarioFromProfile(real, 'with');
    const withSpouse = runScenario(sc, inp)!;
    const alone = runScenario({ ...sc, includeSpouse: false }, inp)!;
    expect(withSpouse.household!.federal.wages).toBeGreaterThan(alone.household!.federal.wages);
    expect(withSpouse.household!.federal.wages - alone.household!.federal.wages).toBe(runActual(2, 2026, inp)!.year.totals.fedTaxable);
  });
  it('returns null without tax tables for the year', () => {
    expect(runScenario({ ...scenarioFromProfile(real, 'x'), year: 2031 }, inp)).toBeNull();
  });
  it('a manually built deduction list works from a blank scenario', () => {
    const sc = blankScenario(1, 2026, 'offer', $(240000));
    sc.profile.deductions = [{ ...newDeduction('health'), value: $(300) }, k401(8)];
    const r = runScenario(sc, inp)!;
    expect(r.year.totals.deductions[sc.profile.deductions[0].id]).toBe($(300) * 24);
    expect(r.year.contributions.k401Pretax).toBe(Math.round($(240000) * 0.08));
    expect(defaultFlags('health').fedExempt).toBe(true);
  });
});

describe('paycheck breakdown', () => {
  const real = prof(1, 150000, { deductions: [k401(10), { ...newDeduction('health'), value: $(200) }] });
  const r = runActual(1, 2026, inputs([real]))!;
  const lines = paycheckLines(r, r.firstCheck!);

  it('lines add up to take-home, for the paycheck and for the year', () => {
    expect(lines.reduce((a, l) => a + (l.kind === 'net' ? 0 : l.cents), 0)).toBe(r.firstCheck!.net);
    expect(lines.at(-1)!.cents).toBe(r.firstCheck!.net);
    expect(lines.reduce((a, l) => a + (l.kind === 'net' ? 0 : l.yearCents ?? 0), 0)).toBe(r.year.totals.net);
  });
  it('lists each deduction by name', () => {
    expect(lines.map((l) => l.label)).toEqual(expect.arrayContaining(['401(k) pre-tax', 'Health premium', 'Social Security', 'Medicare']));
  });
});

describe('headline numbers', () => {
  it('summarize a scenario for comparison', () => {
    const real = prof(1, 150000, { deductions: [k401(10)], match: { ratePct: 50, upToPctOfPay: 6, trueUp: false, appliesToBonus: false } });
    const h = headline(runActual(1, 2026, inputs([real]))!);
    expect(h.annualGross).toBe($(150000));
    expect(h.k401).toBe($(15000));
    expect(h.employerMatch).toBe($(4500));
    expect(h.monthlyNet).toBe(Math.round(h.annualNet / 12));
    expect(h.fedBalance).not.toBeNull();
  });
});

void T;
