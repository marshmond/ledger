import type { AssetKind, InvKind } from '../types';

/**
 * Long-term projection engine. Pure functions, all money in cents, all rates as fractions.
 *
 * Model:
 *  - Each asset class has a long-run compound (geometric) yearly return `mu` and a yearly volatility `sigma`.
 *  - Each account holds a fixed mix of asset classes (rebalanced yearly) taken from its current holdings.
 *  - Contributions arrive evenly through the year, modelled as mid-year: bal' = (bal + c/2) * (1 + r) + c/2.
 *  - Steady path: every year earns exactly the mix's compound return (the "expected" path).
 *  - Monte Carlo: yearly returns are drawn from a lognormal distribution per class (compound return mu, volatility sigma,
 *    never worse than -100%) with correlations between classes, many times, to show the range of outcomes.
 *
 * Because `mu` is already a compound return, the volatility drag (a -20% year then a +25% year does not net out to +5%) is built
 * into it. The simulation is centred so its typical (median) outcome tracks the steady path; the spread around it is what
 * volatility adds. (Each yearly draw therefore averages a little above `mu`.) The mix's own compound return can land a bit above
 * the weighted average of its classes because rebalancing between classes that do not move together earns a diversification gain,
 * so the steady path is, if anything, slightly conservative for a mixed portfolio.
 *
 * All inputs are assumptions. Nothing here predicts returns.
 */

/**
 * Parameters of the yearly lognormal return for a class whose long-run COMPOUND (geometric) return is `g` and whose yearly
 * volatility (standard deviation of the yearly return) is `sigma`. The log of the growth factor is centred on ln(1+g), so the typical
 * (median) path compounds at about `g`; the arithmetic average then comes out a little higher, as it should.
 *
 * Solving mean = (1+g)·e^(s²/2) and sd = mean·sqrt(e^(s²) − 1) for s gives u = e^(s²) = (1 + sqrt(1 + 4σ²/(1+g)²)) / 2.
 */
export function lognormalFromGeometric(g: number, sigma: number): { lnMu: number; lnS: number } {
  const G = Math.max(0.01, 1 + g);
  const u = (1 + Math.sqrt(1 + (4 * sigma * sigma) / (G * G))) / 2;
  return { lnMu: Math.log(G), lnS: Math.sqrt(Math.log(u)) };
}

export interface ClassAssumption {
  id: number;
  name: string;
  kind: AssetKind;
  /** Long-run compound (geometric) nominal return per year, as a fraction. */
  mu: number;
  sigma: number;
}

export interface ProjAccount {
  id: number;
  name: string;
  kind: InvKind;
  startCents: number;
  /** asset class id -> weight (sums to 1). */
  weights: Map<number, number>;
  /** Contribution in cents for year t (1-based). */
  contribution: (t: number) => number;
}

export interface ProjInput {
  accounts: ProjAccount[];
  classes: ClassAssumption[];
  years: number;
  inflation: number;
  /**
   * One-time inflows/outflows (windfalls) in cents for year t, signed. Treated as arriving at the end of year t and
   * spread across accounts in proportion to their balances. Balances never go below zero.
   */
  extraFlow?: (t: number) => number;
}

/** Spreads a flow across balances pro rata (equally if all are zero); balances are floored at zero. */
function spreadFlow(bals: number[] | Float64Array, flow: number): void {
  if (flow === 0 || bals.length === 0) return;
  let total = 0;
  for (let i = 0; i < bals.length; i++) total += bals[i];
  for (let i = 0; i < bals.length; i++) {
    const share = total > 0 ? bals[i] / total : 1 / bals.length;
    bals[i] = Math.max(0, bals[i] + flow * share);
  }
}

// ---------- steady (expected) path ----------

export interface Steady {
  /** total[t] = value after t years (t = 0..years). */
  total: number[];
  perAccount: { id: number; name: string; values: number[] }[];
}

const accountMu = (a: ProjAccount, mu: Map<number, number>) => {
  let r = 0;
  for (const [cid, w] of a.weights) r += w * (mu.get(cid) ?? 0);
  return r;
};

export function steadyPath(inp: ProjInput): Steady {
  const mu = new Map(inp.classes.map((c) => [c.id, c.mu]));
  const rates = inp.accounts.map((a) => accountMu(a, mu));
  const per = inp.accounts.map((a) => ({ id: a.id, name: a.name, values: [a.startCents] }));
  for (let t = 1; t <= inp.years; t++) {
    const bals = inp.accounts.map((a, i) => {
      const c = a.contribution(t);
      return (per[i].values[t - 1] + c / 2) * (1 + rates[i]) + c / 2;
    });
    if (inp.extraFlow) spreadFlow(bals, inp.extraFlow(t));
    bals.forEach((b, i) => per[i].values.push(b));
  }
  const total = Array.from({ length: inp.years + 1 }, (_, t) => per.reduce((s, p) => s + p.values[t], 0));
  return { total, perAccount: per };
}

// ---------- randomness ----------

/** Small fast seeded PRNG (mulberry32) so a simulation can be reproduced from its seed. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function normalSampler(rand: () => number): () => number {
  let spare: number | null = null;
  return () => {
    if (spare !== null) {
      const v = spare;
      spare = null;
      return v;
    }
    let u = 0;
    while (u === 0) u = rand();
    const v = rand();
    const m = Math.sqrt(-2 * Math.log(u));
    spare = m * Math.sin(2 * Math.PI * v);
    return m * Math.cos(2 * Math.PI * v);
  };
}

// Default correlations between asset-class KINDS (assumptions, in the spirit of long-run history).
const CORR: Record<string, number> = {
  'equity|equity': 0.85,
  'equity|bond': 0.1,
  'equity|real_estate': 0.65,
  'equity|balanced': 0.95,
  'equity|cash': 0,
  'equity|other': 0.5,
  'bond|bond': 0.8,
  'bond|real_estate': 0.25,
  'bond|balanced': 0.5,
  'bond|cash': 0.1,
  'bond|other': 0.2,
  'real_estate|real_estate': 0.85,
  'real_estate|balanced': 0.7,
  'real_estate|cash': 0,
  'real_estate|other': 0.4,
  'balanced|balanced': 0.9,
  'balanced|cash': 0.05,
  'balanced|other': 0.5,
  'cash|cash': 0.5,
  'cash|other': 0,
  'other|other': 0.6,
};

export function kindCorrelation(a: AssetKind, b: AssetKind): number {
  return CORR[`${a}|${b}`] ?? CORR[`${b}|${a}`] ?? 0.3;
}

export function correlationMatrix(classes: ClassAssumption[], scale = 1): number[][] {
  return classes.map((a, i) => classes.map((b, j) => (i === j ? 1 : kindCorrelation(a.kind, b.kind) * scale)));
}

/** Cholesky factor L (lower triangular) with L*L' = M, or null if M is not positive definite. */
export function cholesky(m: number[][]): number[][] | null {
  const n = m.length;
  const L = Array.from({ length: n }, () => Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = m[i][j];
      for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
      if (i === j) {
        if (s <= 1e-12) return null;
        L[i][i] = Math.sqrt(s);
      } else L[i][j] = s / L[j][j];
    }
  }
  return L;
}

/** If the correlation matrix is not valid, shrink the off-diagonals toward zero until it is. */
export function choleskyWithFallback(classes: ClassAssumption[]): number[][] {
  for (let scale = 1; scale >= 0; scale -= 0.1) {
    const L = cholesky(correlationMatrix(classes, scale));
    if (L) return L;
  }
  return classes.map((_, i) => classes.map((__, j) => (i === j ? 1 : 0)));
}

// ---------- Monte Carlo ----------

export interface McResult {
  years: number;
  sims: number;
  seed: number;
  /** Row-major: paths[s * (years + 1) + t] = total value of simulation s after t years. */
  paths: Float64Array;
  p10: number[];
  p25: number[];
  p50: number[];
  p75: number[];
  p90: number[];
  mean: number[];
}

const pick = (sorted: Float64Array, p: number) => {
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
};

export function runMonteCarlo(inp: ProjInput, sims = 5000, seed = 1): McResult {
  const { classes, accounts, years } = inp;
  const L = choleskyWithFallback(classes);
  const n = classes.length;
  const classIndex = new Map(classes.map((c, i) => [c.id, i]));

  // Lognormal parameters per class: compound return mu (the typical path), volatility sigma.
  const lnMu = new Float64Array(n);
  const lnS = new Float64Array(n);
  classes.forEach((c, i) => {
    const p = lognormalFromGeometric(c.mu, c.sigma);
    lnS[i] = p.lnS;
    lnMu[i] = p.lnMu;
  });

  // Per-account weight vectors over class indices, and contribution tables.
  const W = accounts.map((a) => {
    const w = new Float64Array(n);
    for (const [cid, wt] of a.weights) {
      const i = classIndex.get(cid);
      if (i !== undefined) w[i] += wt;
    }
    return w;
  });
  const C = accounts.map((a) => Array.from({ length: years + 1 }, (_, t) => (t === 0 ? 0 : a.contribution(t))));

  const rand = mulberry32(seed);
  const normal = normalSampler(rand);
  const stride = years + 1;
  const paths = new Float64Array(sims * stride);
  const z = new Float64Array(n);
  const R = new Float64Array(n);
  const bal = new Float64Array(accounts.length);

  for (let s = 0; s < sims; s++) {
    for (let a = 0; a < accounts.length; a++) bal[a] = accounts[a].startCents;
    paths[s * stride] = accounts.reduce((sum, a) => sum + a.startCents, 0);
    for (let t = 1; t <= years; t++) {
      for (let i = 0; i < n; i++) z[i] = normal();
      for (let i = 0; i < n; i++) {
        let x = 0;
        for (let k = 0; k <= i; k++) x += L[i][k] * z[k];
        R[i] = Math.exp(lnMu[i] + lnS[i] * x);
      }
      let total = 0;
      for (let a = 0; a < accounts.length; a++) {
        let g = 0;
        for (let i = 0; i < n; i++) g += W[a][i] * R[i];
        const c = C[a][t];
        bal[a] = (bal[a] + c / 2) * g + c / 2;
      }
      if (inp.extraFlow) spreadFlow(bal, inp.extraFlow(t));
      for (let a = 0; a < accounts.length; a++) total += bal[a];
      paths[s * stride + t] = total;
    }
  }

  const p10: number[] = [], p25: number[] = [], p50: number[] = [], p75: number[] = [], p90: number[] = [], mean: number[] = [];
  const col = new Float64Array(sims);
  for (let t = 0; t <= years; t++) {
    let sum = 0;
    for (let s = 0; s < sims; s++) {
      col[s] = paths[s * stride + t];
      sum += col[s];
    }
    col.sort();
    p10.push(pick(col, 0.1));
    p25.push(pick(col, 0.25));
    p50.push(pick(col, 0.5));
    p75.push(pick(col, 0.75));
    p90.push(pick(col, 0.9));
    mean.push(sum / sims);
  }
  return { years, sims, seed, paths, p10, p25, p50, p75, p90, mean };
}

/** Share of simulations whose total at `yearIdx` is at least `targetNominal` (cents). */
export function probAtLeast(r: McResult, yearIdx: number, targetNominal: number): number {
  const stride = r.years + 1;
  let hit = 0;
  for (let s = 0; s < r.sims; s++) if (r.paths[s * stride + yearIdx] >= targetNominal) hit++;
  return hit / r.sims;
}

/** Converts a nominal series (index = years from now) to today's dollars. */
export function toReal(values: number[], inflation: number): number[] {
  return values.map((v, t) => v / Math.pow(1 + inflation, t));
}

/** Target in today's dollars -> nominal dollars at `yearIdx` years from now. */
export function realTargetToNominal(targetReal: number, inflation: number, yearIdx: number): number {
  return targetReal * Math.pow(1 + inflation, yearIdx);
}
