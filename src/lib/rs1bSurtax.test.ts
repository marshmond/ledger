import { describe, expect, it } from 'vitest';
import { TAX_2026, TAX_2027 } from '../data/taxYears';
import { RETIREMENT_RULES_2026 as R } from '../data/retirementTax';
import { householdTax } from './payroll';
import { makeEnv, maTax } from './rothTax';
import type { TaxSettings } from '../types';

/**
 * RS-1B: the 2026 Massachusetts 4% surtax threshold. Massachusetts DOR (mass.gov "Massachusetts 4% surtax on taxable income", updated 2026-06-01):
 * 2025 = $1,083,150, 2026 = $1,107,750. Both calculators must read the shared tax-year table, not a separate number.
 */
const $ = (n: number) => Math.round(n * 100);
const THRESHOLD = $(1107750);
const EXEMPTION = $(8800);
const settings: TaxSettings = { year: 2026, itemizedDeductionCents: 0, otherIncomeCents: 0, federalCreditsCents: 0, maDependents: 0, maCreditsCents: 0 };

describe('RS-1B: 2026 Massachusetts surtax threshold', () => {
  it('2026 uses the 2026 figure; the 2027 placeholder is untouched', () => {
    expect(TAX_2026.ma.surtaxThreshold).toBe(THRESHOLD);
    expect(TAX_2027.ma.surtaxThreshold).toBe($(1107750));
    expect(TAX_2026.ma.surtaxRate).toBe(0.04);
  });

  it('the household tax calculator charges nothing just below, nothing at, and 4% of the excess above the threshold', () => {
    // No wages: taxable income = other income - the $8,800 exemption, so the target is hit exactly.
    const tax = (taxable: number) => householdTax([], { ...settings, otherIncomeCents: taxable + EXEMPTION }, TAX_2026).ma;
    const below = tax(THRESHOLD - 1);
    expect(below.taxableIncome).toBe(THRESHOLD - 1);
    expect(below.surtax).toBe(0);
    expect(tax(THRESHOLD).surtax).toBe(0);
    const above = tax(THRESHOLD + $(100000));
    expect(above.surtax).toBe($(4000));
    expect(above.baseTax).toBe(Math.round((THRESHOLD + $(100000)) * 0.05));
    // The old 2025 figure would have charged surtax on income between the two thresholds; it must not now.
    expect(tax($(1090000)).surtax).toBe(0);
  });

  it('the Roth planner reads the same shared table (threshold scaled only by its inflation index)', () => {
    const env = makeEnv(TAX_2026, R, 2026, 1);
    const at = THRESHOLD + EXEMPTION;
    expect(maTax(env, at, 0)).toBe(Math.round(THRESHOLD * 0.05));
    expect(maTax(env, at - 1, 0) - Math.round((THRESHOLD - 1) * 0.05)).toBe(0);
    expect(maTax(env, at + $(50000), 0)).toBe(Math.round((THRESHOLD + $(50000)) * 0.05) + $(2000));
  });
});
