import { describe, expect, it } from 'vitest';
import { TAX_2026 as T } from '../data/taxYears';
import { bracketTax, defaultFlags, householdTax, monthlyNet, simulatePerson, type PersonYear } from './payroll';
import type { Bonus, DeductionItem, IncomeProfile, TaxSettings } from '../types';

const $ = (n: number) => Math.round(n * 100);

const ded = (p: Partial<DeductionItem> & Pick<DeductionItem, 'id' | 'type'>): DeductionItem => ({
  name: p.id,
  mode: 'percent',
  value: 0,
  appliesToBonus: false,
  ...defaultFlags(p.type),
  ...p,
});

const profile = (p: Partial<IncomeProfile> = {}): IncomeProfile => ({
  personId: 1,
  year: 2026,
  mode: 'paycheck',
  frequency: 'semimonthly',
  firstPayDate: '2026-01-15',
  semiDays: [1, 15],
  salary: [{ effectiveDate: '2026-01-01', annualCents: $(200000) }],
  deductions: [],
  match: null,
  employerHsaAnnualCents: 0,
  hsaCoverage: 'family',
  esppDiscountPct: 15,
  fedWithholding: { mode: 'estimate', manualPerPaycheckCents: 0, twoJobs: true, extraPerPaycheckCents: 0 },
  stateWithholding: { mode: 'estimate', manualPerPaycheckCents: 0 },
  ...p,
});

const settings: TaxSettings = { year: 2026, itemizedDeductionCents: 0, otherIncomeCents: 0, federalCreditsCents: 0, maDependents: 0, maCreditsCents: 0 };
const sim = (p: IncomeProfile, bonuses: Bonus[] = [], birthYear?: number) =>
  simulatePerson(p, { id: 1, name: 'A', birthYear }, bonuses, T);

describe('bracketTax (2026 MFJ)', () => {
  it('computes known values', () => {
    expect(bracketTax($(24800), T.fedBracketsMFJ)).toBe($(2480));
    expect(bracketTax($(100000), T.fedBracketsMFJ)).toBe($(11504)); // 2,480 + 12% of 75,200
    expect(bracketTax(0, T.fedBracketsMFJ)).toBe(0);
    // top bracket: 37% over 768,700
    const top = bracketTax($(868700), T.fedBracketsMFJ) - bracketTax($(768700), T.fedBracketsMFJ);
    expect(top).toBe($(37000));
  });
});

describe('paycheck simulation', () => {
  it('semimonthly salary => 24 equal paychecks', () => {
    const y = sim(profile());
    expect(y.events).toHaveLength(24);
    expect(y.events[0].gross).toBe(Math.round($(200000) / 24));
    expect(y.totals.gross).toBeGreaterThanOrEqual($(200000) - 24);
  });

  it('Social Security stops at the wage base and the cap month is reported', () => {
    const y = sim(profile());
    // 8,333.33 per check: 22 checks = 183,333; the 23rd (Dec 1) crosses 184,500.
    expect(y.milestones.ssCapDate).toBe('2026-12-01');
    expect(y.events[22].socialSecurity).toBe(Math.round((T.ssWageBase - 22 * y.events[0].gross) * 0.062));
    expect(y.events[23].socialSecurity).toBe(0);
    // Each paycheck is rounded to the cent, as payroll does, so allow about a cent per paycheck of drift.
    expect(Math.abs(y.totals.socialSecurity - Math.round(T.ssWageBase * 0.062))).toBeLessThanOrEqual(23);
  });

  it('401(k) deferrals reduce federal wages but not FICA wages', () => {
    const y = sim(profile({ deductions: [ded({ id: 'k', type: 'k401_pretax', value: 6 })] }));
    const e = y.events[0];
    expect(e.deductions.k).toBe(Math.round(e.gross * 0.06));
    expect(e.fedTaxable).toBe(e.gross - e.deductions.k);
    expect(e.ficaTaxable).toBe(e.gross);
  });

  it('Roth 401(k) does not reduce any taxable wages', () => {
    const y = sim(profile({ deductions: [ded({ id: 'r', type: 'k401_roth', value: 5 })] }));
    expect(y.events[0].fedTaxable).toBe(y.events[0].gross);
  });

  it('stops 401(k) at the annual limit and reports when', () => {
    // 15% of 8,333.33 = 1,250/check -> 24,500 reached on check 20 (19*1250 = 23,750; 20th is partial)
    const y = sim(profile({ deductions: [ded({ id: 'k', type: 'k401_pretax', value: 15 })] }));
    expect(y.totals.deductions.k).toBe(T.limits.k401Deferral);
    expect(y.milestones.k401LimitDate).toBe(y.events[19].date);
    expect(y.events[20].deductions.k).toBe(0);
    expect(y.events[19].notes.join()).toContain('limited');
  });

  it('adds catch-up by age (50+ and 60-63)', () => {
    const base = profile({ deductions: [ded({ id: 'k', type: 'k401_pretax', value: 25 })] });
    expect(sim(base, [], 1990).totals.deductions.k).toBe(T.limits.k401Deferral);
    expect(sim(base, [], 1970).totals.deductions.k).toBe(T.limits.k401Deferral + T.limits.k401CatchUp50);
    expect(sim(base, [], 1964).totals.deductions.k).toBe(T.limits.k401Deferral + T.limits.k401CatchUp6063);
  });

  it('pre-tax and Roth share the same 401(k) limit', () => {
    const y = sim(profile({ deductions: [ded({ id: 'p', type: 'k401_pretax', value: 10 }), ded({ id: 'r', type: 'k401_roth', value: 10 })] }));
    expect(y.totals.deductions.p + y.totals.deductions.r).toBe(T.limits.k401Deferral);
  });

  it('employer match: 50% up to 6%, per paycheck, stops with the deferral limit', () => {
    const y = sim(
      profile({
        deductions: [ded({ id: 'k', type: 'k401_pretax', value: 15 })],
        match: { ratePct: 50, upToPctOfPay: 6, trueUp: false, appliesToBonus: false },
      }),
    );
    expect(y.events[0].employerMatch).toBe(Math.round(Math.round(y.events[0].gross * 0.06) * 0.5));
    expect(y.events[22].employerMatch).toBe(0); // deferrals stopped, so did the match
    const withTrueUp = sim(
      profile({
        deductions: [ded({ id: 'k', type: 'k401_pretax', value: 15 })],
        match: { ratePct: 50, upToPctOfPay: 6, trueUp: true, appliesToBonus: false },
      }),
    );
    expect(withTrueUp.totals.employerMatch).toBeGreaterThan(y.totals.employerMatch);
    expect(Math.abs(withTrueUp.totals.employerMatch - Math.round($(200000) * 0.06 * 0.5))).toBeLessThanOrEqual(30);
  });

  it('HSA is limited by coverage and net of employer contribution', () => {
    const y = sim(profile({ employerHsaAnnualCents: $(1000), deductions: [ded({ id: 'h', type: 'hsa', mode: 'fixed', value: $(500) })] }));
    expect(y.totals.deductions.h).toBe(T.limits.hsaFamily - $(1000));
    expect(y.milestones.hsaLimitDate).not.toBeNull();
    expect(y.events[0].fedTaxable).toBe(y.events[0].gross - $(500)); // HSA is exempt from fed and FICA
    expect(y.events[0].ficaTaxable).toBe(y.events[0].gross - $(500));
  });

  it('ESPP is capped at $25,000 of stock value net of the discount', () => {
    const y = sim(profile({ deductions: [ded({ id: 'e', type: 'espp', value: 15 })] }));
    expect(y.totals.deductions.e).toBe(Math.round($(25000) * 0.85));
    expect(y.milestones.esppCapDate).not.toBeNull();
    expect(y.events[0].fedTaxable).toBe(y.events[0].gross); // ESPP is after-tax
  });

  it('bonuses: entered by month, supplemental withholding, only percent deductions flagged to apply', () => {
    const bonuses: Bonus[] = [{ personId: 1, year: 2026, month: 3, grossCents: $(20000), label: 'Retention' }];
    const y = sim(
      profile({
        deductions: [
          ded({ id: 'k', type: 'k401_pretax', value: 10, appliesToBonus: true }),
          ded({ id: 'h', type: 'health', mode: 'fixed', value: $(100) }),
        ],
      }),
      bonuses,
    );
    const b = y.events.find((e) => e.kind === 'bonus')!;
    expect(b.date).toBe('2026-03-15');
    expect(b.label).toBe('Retention');
    expect(b.deductions.k).toBe($(2000));
    expect(b.deductions.h).toBe(0); // fixed per-paycheck items are not taken from bonuses
    expect(b.fedWithholding).toBe(Math.round((b.gross - $(2000)) * 0.22));
    expect(y.totals.bonusGross).toBe($(20000));
    expect(y.events).toHaveLength(25);
  });

  it('a bonus can move the Social Security cap earlier', () => {
    const none = sim(profile());
    const withBonus = sim(profile(), [{ personId: 1, year: 2026, month: 6, grossCents: $(60000), label: 'Bonus' }]);
    expect(withBonus.milestones.ssCapDate! < none.milestones.ssCapDate!).toBe(true);
  });

  it('additional Medicare withholding starts above $200k of wages', () => {
    const y = sim(profile({ salary: [{ effectiveDate: '2026-01-01', annualCents: $(300000) }] }));
    expect(y.milestones.addlMedicareStartDate).not.toBeNull();
    expect(Math.abs(y.totals.addlMedicare - $(900))).toBeLessThanOrEqual(5);
  });

  it('raises apply from their effective date', () => {
    const y = sim(
      profile({
        frequency: 'monthly',
        firstPayDate: '2026-01-31',
        salary: [
          { effectiveDate: '2026-01-01', annualCents: $(120000) },
          { effectiveDate: '2026-07-01', annualCents: $(144000) },
        ],
      }),
    );
    expect(y.events[0].gross).toBe($(10000));
    expect(y.events[11].gross).toBe($(12000));
  });

  it('weekly/biweekly years with an extra paycheck pay per-period salary each time', () => {
    const y = sim(profile({ frequency: 'biweekly', firstPayDate: '2026-01-02' })); // 27 Fridays? 2026: Jan 2 ... Dec 25 = 26
    expect(y.events.length).toBe(26);
    const y27 = sim(profile({ frequency: 'biweekly', firstPayDate: '2025-12-31', year: 2026 }));
    expect(y27.events.every((e) => e.gross === Math.round($(200000) / 26))).toBe(true);
  });

  it('annual mode spreads everything over 12 months, fixed amounts are per year', () => {
    const y = sim(profile({ mode: 'annual', deductions: [ded({ id: 'h', type: 'health', mode: 'fixed', value: $(6000) })] }));
    expect(y.events).toHaveLength(12);
    expect(y.events[0].gross).toBe(Math.round($(200000) / 12));
    expect(y.totals.deductions.h).toBe($(6000));
  });

  it('manual withholding overrides the estimate', () => {
    const y = sim(profile({ fedWithholding: { mode: 'manual', manualPerPaycheckCents: $(1500), twoJobs: true, extraPerPaycheckCents: 0 } }));
    expect(y.events[0].fedWithholding).toBe($(1500));
  });

  it('net pay reconciles', () => {
    const y = sim(profile({ deductions: [ded({ id: 'k', type: 'k401_pretax', value: 6 }), ded({ id: 'm', type: 'health', mode: 'fixed', value: $(150) })] }));
    const e = y.events[3];
    const dd = Object.values(e.deductions).reduce((a, b) => a + b, 0);
    expect(e.net).toBe(e.gross - dd - e.fedWithholding - e.socialSecurity - e.medicare - e.addlMedicare - e.stateWithholding - e.pfml);
  });
});

describe('household annual tax', () => {
  it('federal: wages minus standard deduction through MFJ brackets', () => {
    const a = sim(profile({ salary: [{ effectiveDate: '2026-01-01', annualCents: $(150000) }] }));
    const b = sim(profile({ personId: 2, salary: [{ effectiveDate: '2026-01-01', annualCents: $(100000) }] }));
    const h = householdTax([a, b], settings, T);
    const wages = a.totals.fedTaxable + b.totals.fedTaxable;
    expect(h.federal.taxableIncome).toBe(wages - T.stdDeductionMFJ);
    expect(h.federal.incomeTax).toBe(bracketTax(wages - T.stdDeductionMFJ, T.fedBracketsMFJ));
    expect(h.federal.addlMedicareLiability).toBe(0); // 250k is not over 250k (within rounding of paychecks)
  });

  it('itemized deduction is used only when larger than standard', () => {
    const a = sim(profile());
    expect(householdTax([a], { ...settings, itemizedDeductionCents: $(20000) }, T).federal.usedItemized).toBe(false);
    expect(householdTax([a], { ...settings, itemizedDeductionCents: $(40000) }, T).federal.usedItemized).toBe(true);
  });

  it('credits reduce income tax but not below zero', () => {
    const a = sim(profile({ salary: [{ effectiveDate: '2026-01-01', annualCents: $(30000) }] }));
    expect(householdTax([a], { ...settings, federalCreditsCents: $(99999) }, T).federal.incomeTax).toBe(0);
  });

  it('401(k) deferral lowers federal liability', () => {
    const none = householdTax([sim(profile())], settings, T).federal.incomeTax;
    const def = householdTax([sim(profile({ deductions: [ded({ id: 'k', type: 'k401_pretax', value: 10 })] }))], settings, T).federal.incomeTax;
    expect(def).toBeLessThan(none);
  });

  it('Massachusetts: 5% of wages less exemption and FICA deduction ($2,000 per spouse cap)', () => {
    const a = sim(profile({ salary: [{ effectiveDate: '2026-01-01', annualCents: $(100000) }] }));
    const b = sim(profile({ personId: 2, salary: [{ effectiveDate: '2026-01-01', annualCents: $(100000) }] }));
    const h = householdTax([a, b], { ...settings, maDependents: 1 }, T);
    expect(h.ma.exemptions).toBe($(8800) + $(1000));
    expect(h.ma.ficaDeduction).toBe($(4000)); // each spouse's FICA far exceeds $2,000
    expect(h.ma.taxableIncome).toBe(a.totals.stateTaxable + b.totals.stateTaxable - $(9800) - $(4000));
    expect(h.ma.baseTax).toBe(Math.round(h.ma.taxableIncome * 0.05));
    expect(h.ma.surtax).toBe(0);
  });

  it('Massachusetts 4% surtax applies above the threshold', () => {
    const a = sim(profile({ salary: [{ effectiveDate: '2026-01-01', annualCents: $(1500000) }] }));
    const h = householdTax([a], settings, T);
    expect(h.ma.surtax).toBe(Math.round((h.ma.taxableIncome - T.ma.surtaxThreshold) * 0.04));
  });

  it('withholding vs liability gives a refund/owe balance', () => {
    const a = sim(profile());
    const h = householdTax([a], settings, T);
    expect(h.federal.balance).toBe(h.federal.withheld - h.federal.totalLiability);
  });
});

describe('monthlyNet', () => {
  it('sums take-home by month and shows 3-paycheck months for biweekly', () => {
    const y = sim(profile({ frequency: 'biweekly', firstPayDate: '2026-01-02' }));
    const m = monthlyNet([y]);
    expect(m).toHaveLength(12);
    expect(m.reduce((a, b) => a + b, 0)).toBe(y.totals.net);
    const counts = Array<number>(12).fill(0);
    y.events.forEach((e) => counts[Number(e.date.slice(5, 7)) - 1]++);
    expect(Math.max(...counts)).toBe(3);
  });
});

describe('monthlyNet without stock vests', () => {
  it('leaves vests out when asked, and keeps paychecks and bonuses', () => {
    const y = { events: [
      { date: '2026-03-05', kind: 'rsu', net: 500 },
      { date: '2026-03-15', kind: 'regular', net: 300 },
      { date: '2026-03-20', kind: 'bonus', net: 200 },
    ] } as unknown as PersonYear;
    expect(monthlyNet([y])[2]).toBe(1000);
    expect(monthlyNet([y], { excludeRsu: true })[2]).toBe(500);
  });
});
