import { choleskyWithFallback, mulberry32, normalSampler, type ClassAssumption } from './projection';

/**
 * A single pool of money with signed yearly cash flows (contributions in, withdrawals out) and a mix that can change
 * over time. Used for retirement (the pool can run out) and for goals like college (a pool that is drawn down).
 * Same return model as runMonteCarlo: correlated lognormal draws per asset class, mid-year flows.
 */

export interface PoolInput {
  start: number;
  years: number;
  classes: ClassAssumption[];
  /** Asset mix (class id -> weight, sums to 1) used during year t (1-based). */
  weightsAt: (t: number) => Map<number, number>;
  /** Net cash flow in cents during year t: positive adds, negative withdraws. */
  flowAt: (t: number) => number;
}

export interface PoolResult {
  years: number;
  sims: number;
  /** Share of simulations that never ran out of money. */
  successRate: number;
  /** ruinedByYear[t] = share of simulations that have run out by the end of year t. */
  ruinedByYear: number[];
  /** First year of ruin for each failed simulation. */
  ruinYears: number[];
  p10: number[];
  p25: number[];
  p50: number[];
  p75: number[];
  p90: number[];
}

const pick = (sorted: Float64Array, p: number) => {
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
};

export function runPool(inp: PoolInput, sims = 5000, seed = 1, percentiles = true): PoolResult {
  const { classes, years } = inp;
  const n = classes.length;
  const L = choleskyWithFallback(classes);
  const idx = new Map(classes.map((c, i) => [c.id, i]));

  const lnMu = new Float64Array(n);
  const lnS = new Float64Array(n);
  classes.forEach((c, i) => {
    const m = Math.max(0.01, 1 + c.mu);
    const s2 = Math.log(1 + (c.sigma * c.sigma) / (m * m));
    lnS[i] = Math.sqrt(s2);
    lnMu[i] = Math.log(m) - s2 / 2;
  });

  const W: Float64Array[] = [new Float64Array(n)];
  const F: number[] = [0];
  for (let t = 1; t <= years; t++) {
    const w = new Float64Array(n);
    for (const [cid, wt] of inp.weightsAt(t)) {
      const i = idx.get(cid);
      if (i !== undefined) w[i] += wt;
    }
    W.push(w);
    F.push(inp.flowAt(t));
  }

  const normal = normalSampler(mulberry32(seed));
  const z = new Float64Array(n);
  const R = new Float64Array(n);
  const stride = years + 1;
  const keep = percentiles ? new Float64Array(sims * stride) : null;
  const ruinedCount = new Float64Array(years + 1);
  const ruinYears: number[] = [];

  for (let s = 0; s < sims; s++) {
    let bal = inp.start;
    let ruinedAt = 0;
    if (keep) keep[s * stride] = bal;
    for (let t = 1; t <= years; t++) {
      for (let i = 0; i < n; i++) z[i] = normal();
      for (let i = 0; i < n; i++) {
        let x = 0;
        for (let k = 0; k <= i; k++) x += L[i][k] * z[k];
        R[i] = Math.exp(lnMu[i] + lnS[i] * x);
      }
      let g = 0;
      for (let i = 0; i < n; i++) g += W[t][i] * R[i];
      const f = F[t];
      bal = (bal + f / 2) * g + f / 2;
      if (bal <= 0) {
        // A withdrawal year that leaves nothing means the money ran out.
        bal = 0;
        if (ruinedAt === 0 && f < 0) ruinedAt = t;
      }
      if (ruinedAt > 0) ruinedCount[t]++;
      if (keep) keep[s * stride + t] = bal;
    }
    if (ruinedAt > 0) ruinYears.push(ruinedAt);
  }

  // Cumulative: once ruined, always counted in later years.
  const ruinedByYear: number[] = [];
  for (let t = 0; t <= years; t++) ruinedByYear.push(ruinedCount[t] / sims);

  const out: PoolResult = {
    years,
    sims,
    successRate: 1 - ruinYears.length / sims,
    ruinedByYear,
    ruinYears,
    p10: [], p25: [], p50: [], p75: [], p90: [],
  };
  if (keep) {
    const col = new Float64Array(sims);
    for (let t = 0; t <= years; t++) {
      for (let s = 0; s < sims; s++) col[s] = keep[s * stride + t];
      col.sort();
      out.p10.push(pick(col, 0.1));
      out.p25.push(pick(col, 0.25));
      out.p50.push(pick(col, 0.5));
      out.p75.push(pick(col, 0.75));
      out.p90.push(pick(col, 0.9));
    }
  }
  return out;
}

/** The expected (average-return) path of the pool, and the first year it runs out, if any. */
export function steadyPool(inp: PoolInput): { values: number[]; ruinYear: number | null } {
  const mu = new Map(inp.classes.map((c) => [c.id, c.mu]));
  const values = [inp.start];
  let bal = inp.start;
  let ruinYear: number | null = null;
  for (let t = 1; t <= inp.years; t++) {
    let r = 0;
    for (const [cid, w] of inp.weightsAt(t)) r += w * (mu.get(cid) ?? 0);
    const f = inp.flowAt(t);
    bal = (bal + f / 2) * (1 + r) + f / 2;
    if (bal <= 0) {
      bal = 0;
      if (ruinYear === null && f < 0) ruinYear = t;
    }
    values.push(bal);
  }
  return { values, ruinYear };
}

/**
 * Bisection for the largest `x` in [lo, hi] such that ok(x) holds, assuming ok is true for small x and false for large x.
 * Returns lo if even lo fails. 'iterations' of 22 narrows a range of $10M to well under a dollar.
 */
export function bisectMax(ok: (x: number) => boolean, lo: number, hi: number, iterations = 22): number {
  if (!ok(lo)) return lo;
  if (ok(hi)) return hi;
  for (let i = 0; i < iterations; i++) {
    const mid = (lo + hi) / 2;
    if (ok(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** Smallest `x` in [lo, hi] such that ok(x) holds, assuming ok is false for small x and true for large x. */
export function bisectMin(ok: (x: number) => boolean, lo: number, hi: number, iterations = 22): number {
  if (ok(lo)) return lo;
  if (!ok(hi)) return hi;
  for (let i = 0; i < iterations; i++) {
    const mid = (lo + hi) / 2;
    if (ok(mid)) hi = mid;
    else lo = mid;
  }
  return hi;
}
