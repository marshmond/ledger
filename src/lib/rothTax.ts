import type { Bracket, TaxTables } from '../data/taxYears';
import type { RetirementTaxRules } from '../data/retirementTax';
import { bracketTax } from './payroll';

/**
 * Tax rules for one calendar year of a retirement plan: federal (joint) with Social Security taxation, capital-gains stacking,
 * the senior deduction, and NIIT; Massachusetts; Medicare IRMAA; ACA premium subsidy. Pure functions, money in cents.
 * Indexed amounts are the base-year tables scaled by `idx` (cumulative inflation since the table year).
 */

export interface TaxEnv {
  year: number;
  /** Cumulative inflation factor since the tables' year. */
  idx: number;
  T: TaxTables;
  R: RetirementTaxRules;
  brackets: Bracket[];
}

export function makeEnv(T: TaxTables, R: RetirementTaxRules, year: number, idx: number): TaxEnv {
  return { year, idx, T, R, brackets: T.fedBracketsMFJ.map((b) => ({ ...b, over: Math.round(b.over * idx) })) };
}

/** The upper edge of the bracket taxed at `rate` (Infinity for the top bracket, 0 if there is no such bracket). */
export function bracketTop(env: TaxEnv, rate: number): number {
  const i = env.brackets.findIndex((b) => Math.abs(b.rate - rate) < 1e-9);
  if (i < 0) return 0;
  return i + 1 < env.brackets.length ? env.brackets[i + 1].over : Infinity;
}

/** The share of Social Security that is taxable (joint filers; thresholds are not indexed). */
export function taxableSocialSecurity(ss: number, otherIncome: number, R: RetirementTaxRules): number {
  if (ss <= 0) return 0;
  const prov = otherIncome + ss / 2;
  if (prov <= R.ssBase1) return 0;
  const tier1Max = Math.min(ss / 2, (R.ssBase2 - R.ssBase1) / 2);
  if (prov <= R.ssBase2) return Math.round(Math.min(0.5 * (prov - R.ssBase1), ss / 2));
  return Math.round(Math.min(0.85 * ss, 0.85 * (prov - R.ssBase2) + tier1Max));
}

export interface FedInput {
  /** All ordinary taxable income except Social Security: wages, pensions, interest, IRA/401(k) distributions, the taxable part of conversions. */
  ordinary: number;
  /** Qualified dividends and long-term gains (taxed at 0/15/20%). */
  preferential: number;
  /** Interest, dividends, and gains, for the net investment income tax. */
  investIncome: number;
  /** Gross Social Security benefits. */
  ss: number;
  /** How many spouses are 65 or older this year (0-2). */
  n65: number;
}

export interface FedResult {
  ssTaxable: number;
  agi: number;
  deduction: number;
  taxableIncome: number;
  ordinaryTaxable: number;
  incomeTax: number;
  niit: number;
  total: number;
  /** The rate on the last dollar of ordinary income. */
  marginalRate: number;
}

export function federalTax(env: TaxEnv, i: FedInput): FedResult {
  const { T, R, idx } = env;
  const ssTaxable = taxableSocialSecurity(i.ss, i.ordinary + i.preferential, R);
  const agi = i.ordinary + i.preferential + ssTaxable;
  const senior = env.year <= R.seniorDeductionLastYear ? Math.round(i.n65 * Math.max(0, R.seniorDeduction - R.seniorPhaseRate * Math.max(0, agi - R.seniorPhaseStart))) : 0;
  const deduction = Math.round(T.stdDeductionMFJ * idx) + Math.round(i.n65 * R.addlStdDeduction65 * idx) + senior;
  const taxableIncome = Math.max(0, agi - deduction);
  const pref = Math.min(Math.max(0, i.preferential), taxableIncome);
  const ordinaryTaxable = taxableIncome - pref;
  const tOrd = bracketTax(ordinaryTaxable, env.brackets);
  const z = Math.round(R.ltcg0Top * idx);
  const f = Math.round(R.ltcg15Top * idx);
  const lo = ordinaryTaxable;
  const hi = ordinaryTaxable + pref;
  const amt15 = Math.max(0, Math.min(hi, f) - Math.max(lo, z));
  const amt20 = Math.max(0, hi - Math.max(lo, f));
  const incomeTax = tOrd + Math.round(amt15 * 0.15 + amt20 * 0.2);
  const niit = Math.round(R.niitRate * Math.max(0, Math.min(i.investIncome, agi - R.niitThreshold)));
  let marginalRate = env.brackets[0].rate;
  for (const b of env.brackets) if (ordinaryTaxable > b.over) marginalRate = b.rate;
  return { ssTaxable, agi, deduction, taxableIncome, ordinaryTaxable, incomeTax, niit, total: incomeTax + niit, marginalRate };
}

/** Massachusetts: 5% on everything except Social Security, less exemptions, plus the surtax on very high income. */
export function maTax(env: TaxEnv, income: number, n65: number): number {
  const { T, R } = env;
  const taxable = Math.max(0, income - T.ma.personalExemptionMFJ - n65 * R.maExemption65);
  const base = Math.round(taxable * T.ma.rate);
  const surtax = Math.round(Math.max(0, taxable - Math.round(T.ma.surtaxThreshold * env.idx)) * T.ma.surtaxRate);
  return base + surtax;
}

/** Index of the IRMAA tier (0 = none) for the income two years earlier. */
export function irmaaTier(env: TaxEnv, magi: number): number {
  let tier = 0;
  env.R.irmaaThresholds.forEach((t, k) => {
    if (magi > Math.round(t * env.idx)) tier = k + 1;
  });
  return tier;
}

/** Extra Medicare premium for the year: per person on Medicare, at the tier set by income two years earlier. */
export function irmaaCost(env: TaxEnv, magiTwoYearsAgo: number, nOnMedicare: number): number {
  const t = irmaaTier(env, magiTwoYearsAgo);
  return t === 0 ? 0 : Math.round(nOnMedicare * env.R.irmaaPerPerson[t - 1] * env.idx);
}

/** Share of income the household must pay toward the benchmark plan, by income as a multiple of the poverty guideline. */
export function acaPercent(ratio: number, R: RetirementTaxRules): number {
  const k = R.acaKnots;
  if (ratio < k[0][0]) return 0.021;
  for (let i = 1; i < k.length; i++) {
    if (ratio <= k[i][0]) {
      const [x0, y0] = k[i - 1];
      const [x1, y1] = k[i];
      return x1 === x0 ? y1 : y0 + ((y1 - y0) * (ratio - x0)) / (x1 - x0);
    }
  }
  return k[k.length - 1][1];
}

/** Premium tax credit for a two-person household, and what the household pays: zero credit above the 400% cliff. */
export function acaNet(env: TaxEnv, magi: number, benchmark: number): { subsidy: number; net: number } {
  const fpl = env.R.fplTwo * env.idx;
  const ratio = magi / fpl;
  if (benchmark <= 0) return { subsidy: 0, net: 0 };
  if (ratio > env.R.acaCliff) return { subsidy: 0, net: benchmark };
  const expected = acaPercent(ratio, env.R) * magi;
  const subsidy = Math.max(0, Math.round(benchmark - expected));
  return { subsidy, net: benchmark - subsidy };
}

/** The highest income that still gets an ACA subsidy this year. */
export const acaCliffIncome = (env: TaxEnv): number => Math.round(env.R.fplTwo * env.idx * env.R.acaCliff);
