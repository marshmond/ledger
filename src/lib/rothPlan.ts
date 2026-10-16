import type { TaxTables } from '../data/taxYears';
import { rmdFactor, rmdStartAge, type RetirementTaxRules } from '../data/retirementTax';
import { acaCliffIncome, acaNet, federalTax, irmaaCost, makeEnv, maTax, bracketTop, type FedResult, type TaxEnv } from './rothTax';
import { mulberry32, normalSampler } from './projection';

/**
 * Roth conversion planner. Simulates the household year by year (taxes computed exactly each year) under a conversion
 * strategy, tracking traditional IRA / 401(k) money per person, Roth, and a taxable account with cost basis.
 * Assumptions are listed on the page; the main ones: both spouses live through the plan, conversions are done on January 1,
 * a 401(k) is rolled into the IRA when its owner retires, no early-withdrawal penalties, tax law as in the tables scaled by inflation.
 * All money is in cents.
 */

export interface PlanPerson {
  name: string;
  birthYear: number;
  retireYear: number;
  /** Taxable wages per year now (after pre-tax deductions). Grown by the wage growth rate until retirement. */
  wagesCents: number;
  contribTradCents: number;
  contribRothCents: number;
  /** Social Security at the claiming age, in today's dollars per year. */
  ssAnnualCents: number;
  ssClaimAge: number;
  ira: number;
  k401: number;
  roth: number;
  /** After-tax (nondeductible) money inside the IRAs: it makes part of each conversion tax-free (pro-rata rule). */
  iraBasisCents: number;
}

export interface OtherIncome {
  label: string;
  /** Per year in today's dollars; rises with inflation. */
  annualCents: number;
  startYear: number;
  endYear: number | null;
  /** Share that is taxable income (a pension is usually 100%). */
  taxablePct: number;
}

export interface PlanInput {
  startYear: number;
  /** Plan through the year the youngest person reaches this age. */
  planAge: number;
  people: PlanPerson[];
  taxableCents: number;
  taxableBasisCents: number;
  other: OtherIncome[];
  /** Extra wages by calendar year (RSU vests), taxed as ordinary income. */
  extraWages: Record<number, number>;
  /** Gains already realized in a year (from logged sales), netted for tax: short-term is ordinary income, long-term is taxed at 0/15/20%. */
  extraGains?: Record<number, { stcg: number; ltcg: number; lossDeduction: number }>;
  /** Yearly spending in today's dollars, after tax, NOT including ACA premiums (they are added). */
  spendingCents: number;
  inflationPct: number;
  wageGrowthPct: number;
  returnPct: { trad: number; roth: number; taxable: number };
  volPct: number;
  yieldPct: number;
  yieldOrdinaryPct: number;
  aca: { on: boolean; benchmarkCents: number; premiumGrowthPct: number };
  conversionTaxFrom: 'outside' | 'conversion';
  /** Health savings account: grows tax-free, is added to while someone works, and pays qualified medical costs tax-free in retirement. */
  hsa?: { balanceCents: number; contribCents: number; medicalCents: number };
  /** Rates used to value what is left at the end of the plan. */
  endTaxRatePct: number;
  heirTaxRatePct: number;
  T: TaxTables;
  R: RetirementTaxRules;
}

export type StrategyKind = 'none' | 'bracket' | 'fixed' | 'table';

export interface Strategy {
  id: string;
  label: string;
  kind: StrategyKind;
  fromYear: number;
  toYear: number;
  /** bracket: fill ordinary income up to the top of this bracket (0.22 = the 22% bracket). */
  bracketRate: number;
  /** fixed: today's dollars per year (rises with inflation). */
  fixedCents: number;
  /** table: exact amounts by year. */
  table: Record<number, number>;
  /** Never let the conversion push income into the first IRMAA tier / over the ACA subsidy cliff. */
  capIrmaa: boolean;
  capAca: boolean;
}

export interface YearRow {
  year: number;
  ages: number[];
  wages: number;
  ss: number;
  ssTaxable: number;
  other: number;
  rmd: number;
  conversion: number;
  convTaxable: number;
  fromTaxable: number;
  fromTrad: number;
  fromRoth: number;
  hsaDraw: number;
  hsa: number;
  agi: number;
  fed: number;
  niit: number;
  ma: number;
  irmaa: number;
  acaNet: number;
  acaSubsidy: number;
  spending: number;
  marginal: number;
  trad: number;
  roth: number;
  taxable: number;
  unmet: number;
}

export interface PlanSummary {
  years: number;
  totalConverted: number;
  /** Federal + MA + NIIT + IRMAA + ACA premiums over the whole plan. */
  lifetimeCost: number;
  /** Same, in today's dollars. */
  lifetimeCostReal: number;
  federal: number;
  ma: number;
  irmaa: number;
  acaNet: number;
  endTrad: number;
  endRoth: number;
  endHsa: number;
  endTaxable: number;
  endWealth: number;
  endWealthReal: number;
  /** After tax on what remains in traditional accounts, at the planned end-tax rate. */
  ownAfterTax: number;
  heirs: number;
  heirsReal: number;
  failedYear: number | null;
}

export interface PlanResult {
  rows: YearRow[];
  summary: PlanSummary;
  warnings: string[];
}

export const NO_CONVERSION = (from: number, to: number): Strategy => ({
  id: 'none', label: 'No conversions', kind: 'none', fromYear: from, toYear: to, bracketRate: 0.22, fixedCents: 0, table: {}, capIrmaa: false, capAca: false,
});

/** The last plan year: when the youngest person reaches the plan age. */
export const planEndYear = (inp: PlanInput): number => (inp.people.length ? Math.max(...inp.people.map((p) => p.birthYear)) + inp.planAge : inp.startYear);

/** The first calendar year anyone must take a required minimum distribution. */
export const firstRmdYear = (inp: PlanInput): number => Math.min(...inp.people.map((p) => p.birthYear + rmdStartAge(p.birthYear)));
/** The year the last working person retires (the household stops earning wages). */
export const householdRetireYear = (inp: PlanInput): number => Math.max(...inp.people.map((p) => p.retireYear));

const growth = (pct: number, n: number) => Math.pow(1 + pct / 100, n);

interface Person {
  ira: number;
  k401: number;
  roth: number;
  basis: number;
  prevEnd: number;
}

/** Returns for one year, from a standard-normal draw: lognormal with the given mean and volatility. */
export function lognormalReturn(meanPct: number, volPct: number, z: number): number {
  const m = 1 + meanPct / 100;
  const s2 = Math.log(1 + (volPct / 100) ** 2 / (m * m));
  return Math.exp(Math.log(m) - s2 / 2 + Math.sqrt(s2) * z) - 1;
}

export interface RunOptions {
  /** Standard-normal draws, one per plan year: random returns. Without it, returns are the steady assumptions. */
  z?: number[];
  rows?: boolean;
}

export function simulatePlan(inp: PlanInput, strat: Strategy, opts: RunOptions = {}): PlanResult {
  const { T, R } = inp;
  const start = inp.startYear;
  const end = planEndYear(inp);
  const infl = inp.inflationPct;
  const n = inp.people.length;
  const rows: YearRow[] = [];
  const warnings: string[] = [];
  const ps: Person[] = inp.people.map((p) => ({ ira: p.ira, k401: p.k401, roth: p.roth, basis: Math.min(p.iraBasisCents, p.ira), prevEnd: p.ira + p.k401 }));
  const tx = { bal: inp.taxableCents, basis: Math.min(inp.taxableBasisCents, inp.taxableCents) };
  let hsaBal = inp.hsa?.balanceCents ?? 0;
  const hist = new Map<number, number>();
  let firstBaseAgi: number | null = null;

  const sum = { converted: 0, fed: 0, ma: 0, irmaa: 0, aca: 0, real: 0 };
  let failedYear: number | null = null;
  let lastC = 1;

  for (let Y = start; Y <= end; Y++) {
    const t = Y - start;
    const c = growth(infl, t); // today's dollars -> this year's dollars
    lastC = c;
    const env: TaxEnv = makeEnv(T, R, Y, growth(infl, Y - T.year));
    const wg = growth(inp.wageGrowthPct, t);
    const ages = inp.people.map((p) => Y - p.birthYear);
    const retired = inp.people.map((p) => Y >= p.retireYear);
    const fullyRetired = retired.every(Boolean);

    // Retirement: a person's 401(k) is rolled into their IRA.
    inp.people.forEach((_, i) => {
      if (retired[i] && ps[i].k401 > 0) {
        ps[i].ira += ps[i].k401;
        ps[i].k401 = 0;
      }
    });

    // --- fixed parts of the year ---
    const wages = inp.people.reduce((a, p, i) => a + (retired[i] ? 0 : Math.round(p.wagesCents * wg)), 0) + (inp.extraWages[Y] ?? 0);
    const ssEach = inp.people.map((p, i) => (ages[i] >= p.ssClaimAge ? Math.round(p.ssAnnualCents * c) : 0));
    const ss = ssEach.reduce((a, b) => a + b, 0);
    let otherCash = 0;
    let otherTaxable = 0;
    for (const o of inp.other) {
      if (Y < o.startYear || (o.endYear !== null && Y > o.endYear)) continue;
      const v = Math.round(o.annualCents * c);
      otherCash += v;
      otherTaxable += Math.round((v * o.taxablePct) / 100);
    }
    const yieldTotal = Math.round((tx.bal * inp.yieldPct) / 100);
    const yieldOrd = Math.round((yieldTotal * inp.yieldOrdinaryPct) / 100);
    const yieldQual = yieldTotal - yieldOrd;
    const n65 = ages.filter((a) => a >= 65).length;
    const nMedicare = n65;
    const startIra = ps.map((p) => p.ira);
    const frac = ps.map((p) => (p.ira > 0 ? 1 - Math.min(1, p.basis / p.ira) : 1)); // taxable share of any IRA distribution

    // Required minimum distributions (from the IRA first).
    const rmdIra = Array<number>(n).fill(0);
    const rmdK = Array<number>(n).fill(0);
    let rmd = 0;
    let rmdK401 = 0;
    inp.people.forEach((p, i) => {
      if (ages[i] < rmdStartAge(p.birthYear)) return;
      const amt = Math.min(Math.round(ps[i].prevEnd / rmdFactor(ages[i])), ps[i].ira + ps[i].k401);
      rmdIra[i] = Math.min(amt, ps[i].ira);
      rmdK[i] = amt - rmdIra[i];
      rmdK401 += rmdK[i];
      rmd += amt;
    });
    const rmdTaxable = rmdIra.reduce((a, v, i) => a + Math.round(v * frac[i]), 0) + rmdK401;
    const capacity = ps.map((p, i) => Math.max(0, p.ira - rmdIra[i]));
    const capTotal = capacity.reduce((a, b) => a + b, 0);
    const spending = fullyRetired ? Math.round(inp.spendingCents * c) : 0;
    const acaOn = inp.aca.on && inp.people.some((_, i) => retired[i] && ages[i] < R.medicareAge);
    const benchmark = acaOn ? Math.round(inp.aca.benchmarkCents * growth(inp.aca.premiumGrowthPct, t)) : 0;
    const gainFrac = tx.bal > 0 ? Math.max(0, 1 - tx.basis / tx.bal) : 0;
    const magiAt = (y: number) => hist.get(y) ?? firstBaseAgi ?? 0;
    const eg = inp.extraGains?.[Y] ?? { stcg: 0, ltcg: 0, lossDeduction: 0 };

    interface Ev { fed: FedResult; ma: number; irmaa: number; aca: { subsidy: number; net: number }; agiAca: number; costs: number }
    const evalYear = (conv: number[], wTax: number, wTrad: number[]): Ev => {
      const tradTaxable = wTrad.reduce((a, v, i) => a + Math.round(v * frac[i]), 0) + conv.reduce((a, v, i) => a + Math.round(v * frac[i]), 0);
      const ordinary = wages + otherTaxable + yieldOrd + rmdTaxable + tradTaxable + eg.stcg - eg.lossDeduction;
      const gain = Math.round(wTax * gainFrac);
      const pref = yieldQual + gain + eg.ltcg;
      const fed = federalTax(env, { ordinary, preferential: pref, investIncome: yieldTotal + gain + eg.stcg + eg.ltcg, ss, n65 });
      const ma = maTax(env, ordinary + pref, n65);
      const irmaa = nMedicare > 0 ? irmaaCost(env, magiAt(Y - 2), nMedicare) : 0;
      const agiAca = fed.agi + (ss - fed.ssTaxable);
      const aca = acaOn ? acaNet(env, agiAca, benchmark) : { subsidy: 0, net: 0 };
      return { fed, ma, irmaa, aca, agiAca, costs: fed.total + ma + irmaa + aca.net };
    };

    const zeros = Array<number>(n).fill(0);
    const base = evalYear(zeros, 0, zeros);
    if (firstBaseAgi === null) firstBaseAgi = base.fed.agi;
    // The HSA pays qualified medical costs tax-free once everyone has retired.
    const hsaDraw = fullyRetired ? Math.min(hsaBal, Math.round((inp.hsa?.medicalCents ?? 0) * c)) : 0;
    const fixedCash = fullyRetired ? ss + otherCash + rmd + hsaDraw : 0;

    // Where withdrawals come from: taxable account, then traditional IRAs (pro rata), then Roth.
    const allocate = (conv: number[], total: number) => {
      let left = total;
      const wTax = Math.min(left, tx.bal);
      left -= wTax;
      const avail = ps.map((p, i) => Math.max(0, p.ira - rmdIra[i] - conv[i]));
      const availT = avail.reduce((a, b) => a + b, 0);
      const takeT = Math.min(left, availT);
      const wTrad = avail.map((a) => (availT > 0 ? Math.round((takeT * a) / availT) : 0));
      left -= takeT;
      const rothAvail = ps.reduce((a, p) => a + p.roth, 0);
      const wRoth = Math.min(left, rothAvail);
      left -= wRoth;
      return { wTax, wTrad, wRoth, unmet: Math.max(0, left) };
    };

    const settle = (conv: number[]) => {
      const convSum = conv.reduce((a, b) => a + b, 0);
      let W = 0;
      let out = { alloc: allocate(conv, 0), ev: evalYear(conv, 0, zeros), incTax: 0, needed: 0 };
      for (let it = 0; it < 80; it++) {
        const alloc = allocate(conv, W);
        const ev = evalYear(conv, alloc.wTax, alloc.wTrad);
        const incTax = inp.conversionTaxFrom === 'conversion' && convSum > 0 ? ev.costs - evalYear(zeros, alloc.wTax, alloc.wTrad).costs : 0;
        const needed = fullyRetired ? spending + ev.costs - incTax : ev.costs - base.costs - incTax;
        out = { alloc, ev, incTax, needed };
        const nextW = Math.max(0, needed - fixedCash);
        if (Math.abs(nextW - W) < 1) break;
        W = nextW;
      }
      return out;
    };

    // Largest conversion (up to `limit`) for which measure(evaluation) stays at or under `ceiling`.
    const split = (total: number) => capacity.map((cap) => (capTotal > 0 ? Math.round((total * cap) / capTotal) : 0));
    const maxConv = (limit: number, ceiling: number, measure: (e: Ev) => number, w: { wTax: number; wTrad: number[] }) => {
      const at = (x: number) => measure(evalYear(split(x), w.wTax, w.wTrad));
      if (at(0) > ceiling) return 0;
      if (at(limit) <= ceiling) return limit;
      let lo = 0;
      let hi = limit;
      for (let k = 0; k < 34 && hi - lo > 1; k++) {
        const mid = Math.floor((lo + hi) / 2);
        if (at(mid) <= ceiling) lo = mid;
        else hi = mid;
      }
      return lo;
    };

    const inWindow = Y >= strat.fromYear && Y <= strat.toYear;
    const chooseConversion = (w: { wTax: number; wTrad: number[] }): number => {
      if (strat.kind === 'none' || capTotal <= 0) return 0;
      let amount = 0;
      if (strat.kind === 'table') amount = Math.min(capTotal, strat.table[Y] ?? 0);
      else if (!inWindow) return 0;
      else if (strat.kind === 'fixed') amount = Math.min(capTotal, Math.round(strat.fixedCents * c));
      else {
        const top = bracketTop(env, strat.bracketRate);
        amount = top === 0 ? 0 : maxConv(capTotal, top, (e) => e.fed.ordinaryTaxable, w);
      }
      if (amount > 0 && strat.capIrmaa && ages.some((a) => a + 2 >= R.medicareAge)) {
        amount = Math.min(amount, maxConv(amount, Math.round(R.irmaaThresholds[0] * env.idx), (e) => e.fed.agi, w));
      }
      if (amount > 0 && strat.capAca && acaOn) {
        amount = Math.min(amount, maxConv(amount, acaCliffIncome(env) - 1, (e) => e.agiAca, w));
      }
      return amount;
    };

    let res = settle(zeros);
    let conv = zeros;
    if (strat.kind !== 'none') {
      for (let pass = 0; pass < 2; pass++) {
        const total = chooseConversion({ wTax: res.alloc.wTax, wTrad: res.alloc.wTrad });
        conv = split(total);
        res = settle(conv);
        if (total === 0) break;
      }
    }

    // --- apply the year ---
    const { alloc, ev, incTax } = res;
    const convSum = conv.reduce((a, b) => a + b, 0);
    const surplus = fullyRetired ? Math.max(0, fixedCash - res.needed) : 0;
    if (alloc.unmet > 1) {
      if (failedYear === null) failedYear = Y;
    }
    const convTaxable = conv.reduce((a, v, i) => a + Math.round(v * frac[i]), 0);

    // taxable account
    const txBefore = tx.bal;
    const basisUsed = txBefore > 0 ? Math.round((tx.basis * alloc.wTax) / txBefore) : 0;
    tx.bal = Math.max(0, tx.bal - alloc.wTax) + surplus;
    tx.basis = Math.max(0, tx.basis - basisUsed) + yieldTotal + surplus;
    tx.bal = Math.round(tx.bal * (1 + (opts.z ? lognormalReturn(inp.returnPct.taxable, inp.volPct, opts.z[t] ?? 0) : inp.returnPct.taxable / 100)));
    tx.basis = Math.min(tx.basis, tx.bal);

    const rTrad = opts.z ? lognormalReturn(inp.returnPct.trad, inp.volPct, opts.z[t] ?? 0) : inp.returnPct.trad / 100;
    const rRoth = opts.z ? lognormalReturn(inp.returnPct.roth, inp.volPct, opts.z[t] ?? 0) : inp.returnPct.roth / 100;
    const rothDeposit = convSum - incTax;
    const rothTotalBefore = ps.reduce((a, p) => a + p.roth, 0);
    inp.people.forEach((_, i) => {
      const dist = rmdIra[i] + conv[i] + alloc.wTrad[i];
      ps[i].basis = Math.max(0, ps[i].basis - (startIra[i] > 0 ? Math.round((ps[i].basis * dist) / startIra[i]) : 0));
      ps[i].ira = Math.max(0, ps[i].ira - dist);
      ps[i].k401 = Math.max(0, ps[i].k401 - rmdK[i]); // 401(k) required distributions, for people still working past RMD age
    });
    // Roth: deposit the converted money, withdraw if needed (pro rata across people), then grow.
    ps.forEach((p, i) => {
      const share = rothTotalBefore > 0 ? p.roth / rothTotalBefore : 1 / n;
      p.roth = Math.max(0, p.roth - Math.round(alloc.wRoth * share));
      if (i === 0) p.roth += rothDeposit;
    });
    inp.people.forEach((p, i) => {
      ps[i].ira = Math.round(ps[i].ira * (1 + rTrad));
      ps[i].k401 = Math.round(ps[i].k401 * (1 + rTrad)) + (retired[i] ? 0 : Math.round(p.contribTradCents * wg));
      ps[i].roth = Math.round(ps[i].roth * (1 + rRoth)) + (retired[i] ? 0 : Math.round(p.contribRothCents * wg));
      ps[i].prevEnd = ps[i].ira + ps[i].k401;
    });

    hsaBal = Math.round((hsaBal - hsaDraw) * (1 + rRoth)) + (fullyRetired ? 0 : Math.round((inp.hsa?.contribCents ?? 0) * wg));
    hist.set(Y, ev.fed.agi);
    sum.converted += convSum;
    sum.fed += ev.fed.total;
    sum.ma += ev.ma;
    sum.irmaa += ev.irmaa;
    sum.aca += ev.aca.net;
    sum.real += (ev.fed.total + ev.ma + ev.irmaa + ev.aca.net) / c;

    if (opts.rows !== false) {
      rows.push({
        year: Y, ages, wages, ss, ssTaxable: ev.fed.ssTaxable, other: otherTaxable, rmd, conversion: convSum, convTaxable,
        fromTaxable: alloc.wTax, fromTrad: alloc.wTrad.reduce((a, b) => a + b, 0), fromRoth: alloc.wRoth, hsaDraw, hsa: hsaBal,
        agi: ev.fed.agi, fed: ev.fed.incomeTax, niit: ev.fed.niit, ma: ev.ma, irmaa: ev.irmaa, acaNet: ev.aca.net, acaSubsidy: ev.aca.subsidy,
        spending, marginal: ev.fed.marginalRate,
        trad: ps.reduce((a, p) => a + p.ira + p.k401, 0), roth: ps.reduce((a, p) => a + p.roth, 0), taxable: tx.bal, unmet: Math.round(alloc.unmet),
      });
    }
  }

  const endTrad = ps.reduce((a, p) => a + p.ira + p.k401, 0);
  const endRoth = ps.reduce((a, p) => a + p.roth, 0);
  const endWealth = endTrad + endRoth + hsaBal + tx.bal;
  const ownAfterTax = Math.round(endTrad * (1 - inp.endTaxRatePct / 100)) + endRoth + hsaBal + tx.bal;
  // An HSA left to someone other than a spouse is taxable to them like traditional money.
  const heirs = Math.round((endTrad + hsaBal) * (1 - inp.heirTaxRatePct / 100)) + endRoth + tx.bal;
  if (failedYear !== null) warnings.push(`The money runs out in ${failedYear}: spending and taxes cannot be paid after that.`);
  return {
    rows,
    warnings,
    summary: {
      years: Math.max(0, end - start + 1),
      totalConverted: sum.converted,
      lifetimeCost: sum.fed + sum.ma + sum.irmaa + sum.aca,
      lifetimeCostReal: Math.round(sum.real),
      federal: sum.fed,
      ma: sum.ma,
      irmaa: sum.irmaa,
      acaNet: sum.aca,
      endTrad, endRoth, endHsa: hsaBal, endTaxable: tx.bal, endWealth,
      endWealthReal: Math.round(endWealth / lastC),
      ownAfterTax,
      heirs,
      heirsReal: Math.round(heirs / lastC),
      failedYear,
    },
  };
}

export interface Compared {
  strategy: Strategy;
  result: PlanResult;
}

export interface Winners {
  lowestCost: string | null;
  highestWealth: string | null;
  highestHeirs: string | null;
}

export function comparePlans(inp: PlanInput, strategies: Strategy[]): { results: Compared[]; winners: Winners } {
  const results = strategies.map((strategy) => ({ strategy, result: simulatePlan(inp, strategy) }));
  const viable = results.filter((r) => r.result.summary.failedYear === null);
  const pool = viable.length ? viable : results;
  const best = (f: (r: Compared) => number, dir: 1 | -1) => (pool.length ? pool.reduce((a, b) => (f(b) * dir > f(a) * dir ? b : a)).strategy.id : null);
  return {
    results,
    winners: {
      lowestCost: best((r) => r.result.summary.lifetimeCostReal, -1),
      highestWealth: best((r) => r.result.summary.endWealthReal, 1),
      highestHeirs: best((r) => r.result.summary.heirsReal, 1),
    },
  };
}

// ---------- random returns ----------

export function makeZPaths(sims: number, years: number, seed = 7): number[][] {
  const out: number[][] = [];
  for (let s = 0; s < sims; s++) {
    const z = normalSampler(mulberry32(seed + s * 7919));
    out.push(Array.from({ length: years }, () => z()));
  }
  return out;
}

export interface McSummary {
  sims: number;
  /** Share of simulated futures in which the money lasts for the whole plan. */
  successPct: number;
  /** After-tax wealth to heirs in today's dollars: 10th, 50th, 90th percentile. */
  heirsReal: [number, number, number];
  endWealthReal: [number, number, number];
}

const pct = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * sorted.length)))] ?? 0;

/** The same random returns are used for every strategy, so differences between strategies are not noise. */
export function runMonteCarlo(inp: PlanInput, strat: Strategy, paths: number[][]): McSummary {
  const heirs: number[] = [];
  const wealth: number[] = [];
  let ok = 0;
  for (const z of paths) {
    const r = simulatePlan(inp, strat, { z, rows: false });
    if (r.summary.failedYear === null) ok++;
    heirs.push(r.summary.heirsReal);
    wealth.push(r.summary.endWealthReal);
  }
  heirs.sort((a, b) => a - b);
  wealth.sort((a, b) => a - b);
  return {
    sims: paths.length,
    successPct: paths.length ? (ok / paths.length) * 100 : 0,
    heirsReal: [pct(heirs, 10), pct(heirs, 50), pct(heirs, 90)],
    endWealthReal: [pct(wealth, 10), pct(wealth, 50), pct(wealth, 90)],
  };
}
