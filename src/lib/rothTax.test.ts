import { describe, expect, it } from 'vitest';
import { TAX_2026 as T } from '../data/taxYears';
import { RETIREMENT_RULES_2026 as R, rmdFactor, rmdStartAge } from '../data/retirementTax';
import { acaCliffIncome, acaNet, acaPercent, bracketTop, federalTax, irmaaCost, irmaaTier, makeEnv, maTax, taxableSocialSecurity } from './rothTax';

const $ = (n: number) => Math.round(n * 100);
const env = (year = 2026, idx = 1) => makeEnv(T, R, year, idx);
const fed = (o: Partial<Parameters<typeof federalTax>[1]>, e = env()) => federalTax(e, { ordinary: 0, preferential: 0, investIncome: 0, ss: 0, n65: 0, ...o });

describe('Social Security taxation (joint)', () => {
  it('none below $32,000 of provisional income', () => {
    expect(taxableSocialSecurity($(20000), $(10000), R)).toBe(0);
  });
  it('up to 50% between $32,000 and $44,000', () => {
    // provisional = 30,000 + 10,000 = 40,000 -> 50% of the 8,000 over 32,000
    expect(taxableSocialSecurity($(20000), $(30000), R)).toBe($(4000));
  });
  it('up to 85% above $44,000', () => {
    // provisional = 30,000 + 20,000 = 50,000 -> 0.85 x 6,000 + min(20,000, 6,000) = 11,100
    expect(taxableSocialSecurity($(40000), $(30000), R)).toBe($(11100));
  });
  it('never more than 85% of the benefit', () => {
    expect(taxableSocialSecurity($(40000), $(500000), R)).toBe($(34000));
  });
});

describe('federal tax', () => {
  it('ordinary income: $100,000 joint, standard deduction', () => {
    const r = fed({ ordinary: $(100000) });
    expect(r.taxableIncome).toBe($(67800));
    expect(r.incomeTax).toBe($(2480 + 5160));
  });
  it('long-term gains stack on top of ordinary income: fully in the 0% bracket', () => {
    const r = fed({ ordinary: $(80000), preferential: $(50000) });
    expect(r.ordinaryTaxable).toBe($(47800));
    expect(r.incomeTax).toBe($(2480 + 2760));
  });
  it('...and the part above $98,900 of taxable income is taxed at 15%', () => {
    const r = fed({ ordinary: $(80000), preferential: $(60000) });
    expect(r.incomeTax).toBe($(5240) + $(8900 * 0.15));
  });
  it('age 65+ adds the extra standard deduction and the senior deduction (2026)', () => {
    const r = fed({ ordinary: $(100000), n65: 2 });
    expect(r.deduction).toBe($(32200 + 3300 + 12000));
  });
  it('the senior deduction phases out at 6% of income over $150,000 and ends in 2029', () => {
    expect(fed({ ordinary: $(200000), n65: 2 }).deduction).toBe($(32200 + 3300 + 6000)); // each 6,000 - 3,000
    expect(fed({ ordinary: $(260000), n65: 2 }).deduction).toBe($(32200 + 3300));
    expect(fed({ ordinary: $(100000), n65: 2 }, env(2029, 1)).deduction).toBe($(32200 + 3300));
  });
  it('Social Security enters income through the taxable share', () => {
    const r = fed({ ordinary: $(30000), ss: $(40000) });
    expect(r.ssTaxable).toBe($(11100));
    expect(r.agi).toBe($(41100));
  });
  it('net investment income tax: 3.8% of the smaller of investment income and income over $250,000', () => {
    const r = fed({ ordinary: $(200000), preferential: $(100000), investIncome: $(100000) });
    expect(r.niit).toBe($(50000 * 0.038));
    expect(fed({ ordinary: $(100000), investIncome: $(10000) }).niit).toBe(0);
  });
  it('indexed amounts scale with inflation; the Social Security thresholds do not', () => {
    const e = env(2036, 1.28);
    expect(e.brackets[1].over).toBe(Math.round($(24800) * 1.28));
    expect(fed({ ordinary: $(100000) }, e).deduction).toBe(Math.round($(32200) * 1.28));
    expect(taxableSocialSecurity($(20000), $(30000), R)).toBe($(4000));
  });
  it('finds the top of a bracket and reports the marginal rate', () => {
    expect(bracketTop(env(), 0.22)).toBe($(211400));
    expect(bracketTop(env(2030, 1.1), 0.22)).toBe(Math.round($(211400) * 1.1));
    expect(bracketTop(env(), 0.37)).toBe(Infinity);
    expect(bracketTop(env(), 0.99)).toBe(0);
    expect(fed({ ordinary: $(32200 + 150000) }).marginalRate).toBe(0.22);
  });
});

describe('Massachusetts', () => {
  it('5% of income over the exemption, with no Social Security in the base', () => {
    expect(maTax(env(), $(100000), 0)).toBe(Math.round(($(100000) - $(8800)) * 0.05));
    expect(maTax(env(), $(100000), 2)).toBe(Math.round(($(100000) - $(8800) - $(1400)) * 0.05));
  });
  it('adds the 4% surtax over the threshold', () => {
    const inc = $(1183150);
    const base = Math.round((inc - $(8800)) * 0.05);
    expect(maTax(env(), inc, 0)).toBe(base + Math.round((inc - $(8800) - $(1083150)) * 0.04));
  });
});

describe('Medicare IRMAA', () => {
  it('uses the tier from income two years earlier, per person on Medicare', () => {
    expect(irmaaTier(env(), $(218000))).toBe(0);
    expect(irmaaTier(env(), $(218001))).toBe(1);
    expect(irmaaTier(env(), $(800000))).toBe(5);
    expect(irmaaCost(env(), $(200000), 2)).toBe(0);
    expect(irmaaCost(env(), $(220000), 2)).toBe(2 * Math.round(12 * (81.2 + 14.5) * 100));
    expect(irmaaCost(env(), $(220000), 1)).toBe(Math.round(12 * (81.2 + 14.5) * 100));
  });
  it('tiers scale with inflation', () => {
    expect(irmaaTier(env(2036, 1.28), $(220000))).toBe(0);
  });
});

describe('ACA premium credit', () => {
  const bench = $(24000);
  it('interpolates the share of income you pay', () => {
    expect(acaPercent(1.0, R)).toBe(0.021);
    expect(acaPercent(2.0, R)).toBeCloseTo(0.066, 6);
    expect(acaPercent(2.75, R)).toBeCloseTo((0.0844 + 0.0996) / 2, 6);
    expect(acaPercent(3.5, R)).toBeCloseTo(0.0996, 6);
  });
  it('credit = benchmark premium less your share of income', () => {
    const r = acaNet(env(), $(50000), bench);
    expect(r.subsidy).toBeGreaterThan(0);
    expect(r.subsidy + r.net).toBe(bench);
  });
  it('the credit vanishes just above 400% of the poverty guideline', () => {
    const cliff = acaCliffIncome(env());
    expect(cliff).toBe($(84600));
    expect(acaNet(env(), cliff, bench).subsidy).toBeGreaterThan(0);
    expect(acaNet(env(), cliff + 100, bench)).toEqual({ subsidy: 0, net: bench });
  });
});

describe('required minimum distributions', () => {
  it('start age depends on birth year', () => {
    expect(rmdStartAge(1950)).toBe(72);
    expect(rmdStartAge(1955)).toBe(73);
    expect(rmdStartAge(1959)).toBe(73);
    expect(rmdStartAge(1960)).toBe(75);
  });
  it('uniform lifetime table', () => {
    expect(rmdFactor(73)).toBe(26.5);
    expect(rmdFactor(75)).toBe(24.6);
    expect(rmdFactor(90)).toBe(12.2);
    expect(rmdFactor(130)).toBe(2);
    expect(rmdFactor(60)).toBe(Infinity);
  });
});
