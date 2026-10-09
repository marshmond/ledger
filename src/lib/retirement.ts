import type { Account, Category, RetirementSettings, Txn, Windfall } from '../types';
import { monthOf, prevMonth } from './dates';
import { allocations } from './ledger';
import { bisectMax, runPool, steadyPool, type PoolInput, type PoolResult } from './pool';
import type { ClassAssumption, ProjAccount } from './projection';

export const DEFAULT_RETIREMENT = (year0: number): RetirementSettings => ({
  retireYear: year0 + 20,
  planYears: 30,
  spendingCents: 0,
  taxRatePct: 15,
  streams: [],
  equityPctAtRetirement: null,
  targetConfidencePct: 90,
  sims: 5000,
});

/**
 * Windfall flow by period t (1-based; period t ends at the end of calendar year year0 + t). A windfall in a year that
 * has already started counts in period 1. Amounts in today's dollars are inflated to the year they arrive.
 */
export function windfallFlow(ws: Windfall[], year0: number, inflation: number): (t: number) => number {
  const active = ws.filter((w) => w.include);
  return (t: number) =>
    active
      .filter((w) => Math.max(1, w.year - year0) === t)
      .reduce((s, w) => s + (w.todaysDollars ? w.amountCents * Math.pow(1 + inflation, t) : w.amountCents), 0);
}

/** Blends account mixes by (current value + first year's contributions). */
export function blendMix(accounts: ProjAccount[]): Map<number, number> {
  const w = new Map<number, number>();
  let total = 0;
  for (const a of accounts) {
    const size = a.startCents + a.contribution(1);
    total += size;
    for (const [cid, x] of a.weights) w.set(cid, (w.get(cid) ?? 0) + x * size);
  }
  if (total <= 0) return accounts[0] ? new Map(accounts[0].weights) : new Map();
  for (const [k, v] of w) w.set(k, v / total);
  return w;
}

/** Stock/bond mix for an equity share, using the first equity and first bond class. Null if either is missing. */
export function mixWithEquity(classes: ClassAssumption[], equityPct: number): Map<number, number> | null {
  const eq = classes.find((c) => c.kind === 'equity');
  const bd = classes.find((c) => c.kind === 'bond');
  if (!eq || !bd) return null;
  const e = Math.min(1, Math.max(0, equityPct / 100));
  return new Map([[eq.id, e], [bd.id, 1 - e]]);
}

export interface RetirementInput {
  year0: number;
  /** Accounts that fund retirement (exclude 529s). */
  accounts: ProjAccount[];
  classes: ClassAssumption[];
  windfalls: Windfall[];
  inflation: number;
  settings: RetirementSettings;
  /** Loan payments (principal + interest + extra) in cents for period t, nominal. Used only when includeDebtPayments is on. */
  debtPaymentsAt?: (t: number) => number;
}

export interface RetirementModel {
  pool: PoolInput;
  horizon: number;
  /** Period index at which retirement begins (the last working period). */
  retireIdx: number;
  /** Net spending need (before income streams and tax gross-up) in nominal dollars for period t. */
  spendingNominal: (t: number) => number;
  /** Amount withdrawn from the portfolio in period t (nominal, after streams, grossed up for tax). */
  withdrawal: (t: number) => number;
}

/** Builds the pool for a given yearly spending level (today's dollars, cents). */
export function buildRetirementModel(inp: RetirementInput, spendingCents = inp.settings.spendingCents): RetirementModel {
  const { year0, settings: s, inflation } = inp;
  const retireIdx = Math.max(0, s.retireYear - year0);
  const horizon = retireIdx + s.planYears;
  const wf = windfallFlow(inp.windfalls, year0, inflation);
  const tax = Math.min(0.9, Math.max(0, s.taxRatePct / 100));

  const spendingNominal = (t: number) => spendingCents * Math.pow(1 + inflation, t);
  const streamsAt = (t: number) =>
    s.streams
      .filter((x) => year0 + t >= x.startYear && (x.endYear == null || year0 + t <= x.endYear))
      .reduce((sum, x) => sum + x.annualCents * Math.pow(1 + inflation, t), 0);
  const debt = (t: number) => (s.includeDebtPayments && inp.debtPaymentsAt ? Math.max(0, inp.debtPaymentsAt(t)) : 0);
  // Loan payments come from after-tax money like spending, so they are grossed up the same way.
  const withdrawal = (t: number) => (Math.max(0, spendingNominal(t) - streamsAt(t)) + debt(t)) / (1 - tax);

  const before = blendMix(inp.accounts);
  const after = s.equityPctAtRetirement != null ? mixWithEquity(inp.classes, s.equityPctAtRetirement) ?? before : before;
  const contributions = (t: number) => inp.accounts.reduce((sum, a) => sum + a.contribution(t), 0);

  const pool: PoolInput = {
    start: inp.accounts.reduce((sum, a) => sum + a.startCents, 0),
    years: horizon,
    classes: inp.classes,
    weightsAt: (t) => (t > retireIdx ? after : before),
    flowAt: (t) => (t > retireIdx ? -withdrawal(t) : contributions(t)) + wf(t),
  };
  return { pool, horizon, retireIdx, spendingNominal, withdrawal };
}

export interface RetirementResult {
  model: RetirementModel;
  mc: PoolResult;
  steady: { values: number[]; ruinYear: number | null };
  /** Median balance at retirement (nominal cents). */
  medianAtRetirement: number;
  /** First-year withdrawal as a percent of the median balance at retirement. */
  firstYearWithdrawalPct: number;
  /** Year the money runs out in the median-failure case, or null if nothing failed. */
  medianRuinYear: number | null;
}

export function planRetirement(inp: RetirementInput, seed = 1): RetirementResult {
  const model = buildRetirementModel(inp);
  const mc = runPool(model.pool, inp.settings.sims, seed, true);
  const steady = steadyPool(model.pool);
  const medianAtRetirement = mc.p50[Math.min(model.retireIdx, model.horizon)] ?? 0;
  const first = model.withdrawal(model.retireIdx + 1);
  const ruins = [...mc.ruinYears].sort((a, b) => a - b);
  return {
    model,
    mc,
    steady,
    medianAtRetirement,
    firstYearWithdrawalPct: medianAtRetirement > 0 ? (first / medianAtRetirement) * 100 : first > 0 ? Infinity : 0,
    medianRuinYear: ruins.length ? ruins[Math.floor(ruins.length / 2)] : null,
  };
}

/**
 * The most yearly spending (today's dollars, cents) the plan supports while the money lasts in at least
 * `confidencePct` of simulated futures. Same random draws at every step, so the answer is stable.
 */
export function sustainableSpending(inp: RetirementInput, confidencePct = inp.settings.targetConfidencePct, sims = 3000, seed = 1): number {
  const target = confidencePct / 100;
  const ok = (spending: number) => runPool(buildRetirementModel(inp, spending).pool, sims, seed, false).successRate >= target;
  const hi = Math.max(inp.settings.spendingCents * 4, 50_000_000);
  return Math.round(bisectMax(ok, 0, hi, 20)); // whole cents
}

/**
 * Average yearly spending from your own ledger: the last `months` full months of outflows (card payments and other
 * transfers are excluded because the purchases are already counted). Uses fewer months if the ledger is newer.
 */
export function trailingAnnualSpending(
  txns: Txn[],
  categories: Category[],
  accounts: Account[],
  today: string,
  months = 3,
): { annualCents: number; monthsUsed: number } {
  const incomeIds = new Set(categories.filter((c) => c.kind === 'income').map((c) => c.id!));
  const window: string[] = [];
  for (let m = prevMonth(monthOf(today)); window.length < months; m = prevMonth(m)) window.push(m);
  const earliestTxn = txns.reduce((m, t) => (monthOf(t.date) < m ? monthOf(t.date) : m), monthOf(today));
  const earliestAcct = accounts.reduce((m, a) => (monthOf(a.openingDate) < m ? monthOf(a.openingDate) : m), monthOf(today));
  const start = earliestTxn < earliestAcct ? earliestTxn : earliestAcct;
  const used = window.filter((m) => m > start); // months fully after the first activity
  if (used.length === 0) return { annualCents: 0, monthsUsed: 0 };
  const inWindow = new Set(used);
  let spend = 0;
  for (const t of txns) {
    if (t.transferTxnId || !inWindow.has(monthOf(t.date))) continue;
    for (const a of allocations(t)) {
      if (a.categoryId !== null && incomeIds.has(a.categoryId)) continue;
      if (a.categoryId === null && a.amountCents > 0) continue; // uncategorized deposits are income
      spend -= a.amountCents;
    }
  }
  return { annualCents: Math.max(0, Math.round((spend / used.length) * 12)), monthsUsed: used.length };
}
