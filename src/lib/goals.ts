import type { Goal } from '../types';
import { bisectMin, runPool, steadyPool, type PoolInput } from './pool';
import type { ClassAssumption, ProjAccount } from './projection';

/**
 * A goal is a pool that is added to for a while and then drawn down by yearly costs (college, a down payment...).
 * "Funded" means no cost year goes unpaid. The solver finds the yearly contribution that gets there.
 */

export interface GoalContext {
  year0: number;
  inflation: number;
  classes: ClassAssumption[];
  /** The funding account (balance and mix), if one is chosen. */
  account: ProjAccount | undefined;
  /** Mix to use when the account is empty/unset. */
  fallbackWeights: Map<number, number>;
}

export interface GoalModel {
  startIdx: number; // first period in which a cost is paid
  horizon: number;
  costs: number[]; // nominal cost for period t (index = t), 0 outside the cost years
  totalCost: number;
  pool: (contribution: number) => PoolInput;
}

export function buildGoalModel(g: Goal, ctx: GoalContext): GoalModel {
  const startIdx = Math.max(1, g.startYear - ctx.year0);
  const horizon = startIdx + Math.max(1, g.years) - 1;
  const ci = g.costInflationPct / 100;
  const share = Math.min(1, Math.max(0, g.fundingPct / 100));
  const costs = Array.from({ length: horizon + 1 }, (_, t) => (t >= startIdx ? g.annualCostCents * share * Math.pow(1 + ci, t) : 0));
  const weights = ctx.account && ctx.account.weights.size ? ctx.account.weights : ctx.fallbackWeights;
  const growth = g.contributionGrowthPct / 100;
  return {
    startIdx,
    horizon,
    costs,
    totalCost: costs.reduce((a, b) => a + b, 0),
    pool: (c0: number) => ({
      start: ctx.account?.startCents ?? 0,
      years: horizon,
      classes: ctx.classes,
      weightsAt: () => weights,
      flowAt: (t) => (t < startIdx ? c0 * Math.pow(1 + growth, t - 1) : -costs[t]),
    }),
  };
}

export interface GoalSolution {
  model: GoalModel;
  /** Yearly contribution (cents, first year) for the average-return path to just cover every cost. */
  steadyAnnual: number;
  /** Yearly contribution for the money to be there in at least `confidencePct` of simulated futures. */
  confidenceAnnual: number;
  /** True when contributions cannot help because costs begin within the first year. */
  noTimeToSave: boolean;
  /** Chance of full funding on the contribution currently planned (annualCents). */
  currentSuccessPct: number;
  /** The first year costs are not covered on the average path with the current contribution, if any. */
  currentShortfallYear: number | null;
}

export function solveGoal(g: Goal, ctx: GoalContext, currentAnnual: number, sims = 3000, seed = 1): GoalSolution {
  const model = buildGoalModel(g, ctx);
  const conf = g.confidencePct / 100;
  const noTimeToSave = model.startIdx <= 1;
  const hi = Math.max(model.totalCost, 1);
  const steadyOk = (c: number) => steadyPool(model.pool(c)).ruinYear === null;
  const mcOk = (c: number) => runPool(model.pool(c), sims, seed, false).successRate >= conf;
  const steadyAnnual = noTimeToSave ? (steadyOk(0) ? 0 : hi) : bisectMin(steadyOk, 0, hi, 24);
  const confidenceAnnual = noTimeToSave ? (mcOk(0) ? 0 : hi) : bisectMin(mcOk, 0, hi, 20);
  const cur = runPool(model.pool(currentAnnual), sims, seed, false);
  const steady = steadyPool(model.pool(currentAnnual));
  return {
    model,
    steadyAnnual,
    confidenceAnnual,
    noTimeToSave,
    currentSuccessPct: cur.successRate * 100,
    currentShortfallYear: steady.ruinYear === null ? null : ctx.year0 + steady.ruinYear,
  };
}
