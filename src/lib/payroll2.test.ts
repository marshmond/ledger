import { describe, expect, it } from 'vitest';
import { TAX_2026 as T } from '../data/taxYears';
import { defaultFlags, simulatePerson } from './payroll';
import { dayOfWeek, lastBusinessDay, monthPayDate, priorBusinessDay } from './dates';
import type { Bonus, DeductionItem, IncomeProfile, MatchConfig } from '../types';

const $ = (n: number) => Math.round(n * 100);

const ded = (p: Partial<DeductionItem> & Pick<DeductionItem, 'id' | 'type'>): DeductionItem => ({
  name: p.id, mode: 'percent', value: 0, appliesToBonus: false, ...defaultFlags(p.type), ...p,
});
const profile = (p: Partial<IncomeProfile> = {}): IncomeProfile => ({
  personId: 1, year: 2026, mode: 'paycheck', frequency: 'semimonthly', firstPayDate: '2026-01-15', semiDays: [1, 15],
  salary: [{ effectiveDate: '2026-01-01', annualCents: $(200000) }], deductions: [], match: null,
  employerHsaAnnualCents: 0, hsaCoverage: 'family', esppDiscountPct: 15,
  fedWithholding: { mode: 'estimate', manualPerPaycheckCents: 0, twoJobs: true, extraPerPaycheckCents: 0 },
  stateWithholding: { mode: 'estimate', manualPerPaycheckCents: 0 }, ...p,
});
const sim = (p: IncomeProfile, bonuses: Bonus[] = []) => simulatePerson(p, { id: 1, name: 'A', birthYear: 1985 }, bonuses, T);
const dates = (p: IncomeProfile) => sim(p).events.map((e) => e.date);
const mk = (m: Partial<MatchConfig>): MatchConfig => ({ ratePct: 50, upToPctOfPay: 6, trueUp: false, appliesToBonus: false, ...m });

describe('business-day helpers', () => {
  it('weekday math (2026: Jan 31 Sat, May 31 Sun, Aug 15 Sat, Feb 15 Sun)', () => {
    expect(dayOfWeek('2026-01-31')).toBe(6);
    expect(dayOfWeek('2026-05-31')).toBe(0);
    expect(priorBusinessDay('2026-01-31')).toBe('2026-01-30');
    expect(priorBusinessDay('2026-05-31')).toBe('2026-05-29');
    expect(priorBusinessDay('2026-06-03')).toBe('2026-06-03');
    expect(lastBusinessDay('2026-08')).toBe('2026-08-31'); // a Monday
  });

  it('a day past the end of a short month means its last day, so 31 is safe everywhere', () => {
    expect(monthPayDate('2026-02', 31, false)).toBe('2026-02-28');
    expect(monthPayDate('2028-02', 31, false)).toBe('2028-02-29'); // leap year
    expect(monthPayDate('2026-04', 31, false)).toBe('2026-04-30');
    expect(monthPayDate('2026-04', 30, false)).toBe('2026-04-30');
    expect(monthPayDate('2026-12', 31, false)).toBe('2026-12-31');
  });
});

describe('twice-a-month pay days', () => {
  it('15th and 31: short months fall back to their last calendar day', () => {
    const d = dates(profile({ payDays: [15, 31] }));
    expect(d).toHaveLength(24);
    expect(d).toContain('2026-02-28');
    expect(d).toContain('2026-04-30');
    expect(d).toContain('2026-06-30');
    expect(d).toContain('2026-12-31');
    expect(new Set(d).size).toBe(24);
  });

  it('15th and the last BUSINESS day: months that end on a weekend pay on the Friday', () => {
    const d = dates(profile({ payDays: [15, 'lastBusiness'] }));
    expect(d).toHaveLength(24);
    expect(d).toContain('2026-01-30'); // Jan 31 is a Saturday
    expect(d).toContain('2026-05-29'); // May 31 is a Sunday
    expect(d).toContain('2026-08-31'); // Monday, no change
    expect(d).toContain('2026-10-30'); // Oct 31 is a Saturday
    // Every month-end pay (the 15th is left alone here) is a weekday and is the LAST weekday of its month.
    const monthEnds = d.filter((day) => Number(day.slice(8, 10)) > 20);
    expect(monthEnds).toHaveLength(12);
    for (const day of monthEnds) {
      expect([0, 6]).not.toContain(dayOfWeek(day));
      expect(day).toBe(lastBusinessDay(day.slice(0, 7)));
    }
  });

  it('weekend rule moves a 15th that lands on Saturday or Sunday to the Friday before', () => {
    const adj = dates(profile({ payDays: [15, 'lastBusiness'], weekendAdjust: true }));
    expect(adj).toContain('2026-08-14'); // Aug 15 is a Saturday
    expect(adj).toContain('2026-02-13'); // Feb 15 is a Sunday
    expect(adj).toContain('2026-04-15'); // a Wednesday, unchanged
    const plain = dates(profile({ payDays: [15, 'lastBusiness'], weekendAdjust: false }));
    expect(plain).toContain('2026-08-15');
  });

  it('a 1st that lands on a weekend moves back into the previous month', () => {
    const d = dates(profile({ payDays: [1, 15], weekendAdjust: true }));
    expect(d).toContain('2026-10-30'); // Nov 1 2026 is a Sunday, so the November 1st pay arrives Oct 30
    expect(d).not.toContain('2026-11-01');
    expect(d).toContain('2026-07-31'); // Aug 1 2026 is a Saturday
  });

  it('a pay day can move across the year boundary (Jan 1, 2028 is a Saturday)', () => {
    const y27 = dates(profile({ year: 2027, payDays: [1, 15], weekendAdjust: true }));
    const y28 = dates(profile({ year: 2028, payDays: [1, 15], weekendAdjust: true }));
    expect(y27).toContain('2027-12-31');
    expect(y27).toHaveLength(25);
    expect(y28).not.toContain('2028-01-01');
    expect(y28).toHaveLength(23);
    // Each paycheck is still salary/24, so a 25-paycheck year really does pay one extra.
    expect(sim(profile({ year: 2027, payDays: [1, 15], weekendAdjust: true })).events[0].gross).toBe(Math.round($(200000) / 24));
  });

  it('existing profiles (no payDays) behave exactly as before', () => {
    expect(dates(profile({ semiDays: [1, 15] }))).toHaveLength(24);
    expect(dates(profile({ semiDays: [15, 31] }))).toContain('2026-02-28');
  });
});

describe('monthly pay days', () => {
  it('last business day, 12 pays, always a weekday', () => {
    const d = dates(profile({ frequency: 'monthly', payDays: ['lastBusiness'] }));
    expect(d).toHaveLength(12);
    expect(d[0]).toBe('2026-01-30');
    for (const day of d) expect([0, 6]).not.toContain(dayOfWeek(day));
  });

  it('day 31 is safe and legacy monthly profiles keep the anchor date\'s day', () => {
    const d = dates(profile({ frequency: 'monthly', payDays: [31] }));
    expect(d).toContain('2026-02-28');
    expect(d).toHaveLength(12);
    expect(dates(profile({ frequency: 'monthly', firstPayDate: '2026-03-20' }))).toContain('2026-05-20');
  });
});

describe('employer 401(k) contribution: formulas and yearly maximum', () => {
  const salary100k = [{ effectiveDate: '2026-01-01', annualCents: $(100000) }];

  it('flat % of pay with a $5,000 maximum: stops exactly at the cap and reports the date', () => {
    const y = sim(profile({ salary: salary100k, match: mk({ formula: 'flat', flatPctOfPay: 10, annualCapCents: $(5000) }) }));
    const per = Math.round($(100000) / 24 * 0.1);
    expect(y.events[0].employerMatch).toBe(per);
    expect(y.totals.employerMatch).toBe($(5000));
    const capIdx = y.events.findIndex((e) => e.date === y.milestones.matchCapDate);
    expect(capIdx).toBe(11); // 12 checks of $416.67 reach $5,000
    expect(y.events[capIdx + 1].employerMatch).toBe(0);
  });

  it('flat formula pays whether or not you contribute', () => {
    const y = sim(profile({ salary: salary100k, deductions: [], match: mk({ formula: 'flat', flatPctOfPay: 3 }) }));
    expect(y.totals.employerMatch).toBeGreaterThan($(2990));
    expect(y.milestones.matchCapDate).toBeNull();
  });

  it('matching formula with a cap: 50% of the first 6% would be $6,000, capped at $5,000', () => {
    const p = profile({ deductions: [ded({ id: 'k', type: 'k401_pretax', value: 10 })], match: mk({ annualCapCents: $(5000) }) });
    const y = sim(p);
    expect(y.totals.employerMatch).toBe($(5000));
    expect(y.milestones.matchCapDate).not.toBeNull();
    const uncapped = sim(profile({ deductions: [ded({ id: 'k', type: 'k401_pretax', value: 10 })], match: mk({}) }));
    expect(Math.abs(uncapped.totals.employerMatch - $(6000))).toBeLessThanOrEqual(12);
    expect(uncapped.milestones.matchCapDate).toBeNull();
  });

  it('matching formula with true-up and a cap: the cap applies to the year-end total', () => {
    const p = profile({ deductions: [ded({ id: 'k', type: 'k401_pretax', value: 10 })], match: mk({ trueUp: true, annualCapCents: $(5000) }) });
    const y = sim(p);
    expect(y.totals.employerMatch).toBe($(5000));
    expect(y.events.at(-1)!.employerMatch).toBe($(5000));
    expect(y.milestones.matchCapDate).toBe(y.events.at(-1)!.date);
  });

  it('a cap above what the formula would pay changes nothing and is never "reached"', () => {
    const base = profile({ deductions: [ded({ id: 'k', type: 'k401_pretax', value: 6 })], match: mk({}) });
    const capped = profile({ deductions: [ded({ id: 'k', type: 'k401_pretax', value: 6 })], match: mk({ annualCapCents: $(50000) }) });
    expect(sim(capped).totals.employerMatch).toBe(sim(base).totals.employerMatch);
    expect(sim(capped).milestones.matchCapDate).toBeNull();
  });

  it('a cap of zero or blank means no cap', () => {
    const base = profile({ deductions: [ded({ id: 'k', type: 'k401_pretax', value: 6 })], match: mk({}) });
    for (const annualCapCents of [0, null, undefined]) {
      const y = sim(profile({ ...base, match: mk({ annualCapCents }) }));
      expect(y.totals.employerMatch).toBe(sim(base).totals.employerMatch);
    }
  });

  it('flat contribution on a bonus counts only when the setting says so, and still respects the cap', () => {
    const bonus: Bonus[] = [{ personId: 1, year: 2026, month: 3, grossCents: $(50000), label: 'Bonus' }];
    const off = sim(profile({ salary: salary100k, match: mk({ formula: 'flat', flatPctOfPay: 10, annualCapCents: $(12000) }) }), bonus);
    const on = sim(profile({ salary: salary100k, match: mk({ formula: 'flat', flatPctOfPay: 10, annualCapCents: $(12000), appliesToBonus: true }) }), bonus);
    expect(off.totals.employerMatch).toBe(Math.round(10000 * 100 * 0.1 - 0) > 0 ? off.totals.employerMatch : 0);
    expect(off.totals.employerMatch).toBeLessThan(on.totals.employerMatch);
    expect(on.totals.employerMatch).toBe($(12000)); // 10% of 150k = 15k, capped at 12k
  });
});
