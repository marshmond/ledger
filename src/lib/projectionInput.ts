import type { AssetClass, Holding, InvAccount, Security } from '../types';
import { allocationFor } from './investments';
import type { PersonYear } from './payroll';
import type { ClassAssumption, ProjAccount, ProjInput } from './projection';
import { summarize } from './investments';

export interface ProjectionSettings {
  years: number;
  inflationPct: number;
  /** Show values in today's dollars. */
  realTerms: boolean;
  sims: number;
  /** Target portfolio value in today's dollars (0 = none). */
  targetCents: number;
  /** Which year (from now) the target is tested at. */
  targetYear: number;
}

export const DEFAULT_PROJECTION: ProjectionSettings = {
  years: 30,
  inflationPct: 2.5,
  realTerms: true,
  sims: 5000,
  targetCents: 0,
  targetYear: 30,
};

export function toClassAssumptions(classes: AssetClass[]): ClassAssumption[] {
  return classes.map((c) => ({ id: c.id!, name: c.name, kind: c.kind, mu: c.expectedReturnPct / 100, sigma: c.volatilityPct / 100 }));
}

/** First-year contribution for an account: from the income model when linked (401k), else the amount you entered. */
export function baseContribution(a: InvAccount, incomeYears: PersonYear[]): { cents: number; note?: string } {
  if (a.kind === '401k' && a.linkToIncome) {
    const py = incomeYears.find((y) => y.personId === a.personId);
    if (!py) return { cents: 0, note: 'Linked to income, but no income model found for this person and year' };
    return { cents: py.contributions.k401Pretax + py.contributions.k401Roth + py.contributions.employerMatch };
  }
  return { cents: a.annualContributionCents };
}

export interface BuiltProjection {
  input: ProjInput;
  warnings: string[];
  startTotal: number;
}

export function buildProjection(
  p: { accounts: InvAccount[]; holdings: Holding[]; securities: Security[]; assetClasses: AssetClass[] },
  incomeYears: PersonYear[],
  s: ProjectionSettings,
): BuiltProjection {
  const warnings: string[] = [];
  const open = p.accounts.filter((a) => !a.closed);
  const portfolioMix = allocationFor('all', p);
  const sum = summarize(p);
  const cc = p.assetClasses.find((c) => c.kind === 'cash');

  const accounts: ProjAccount[] = open.map((a) => {
    const slices = allocationFor([a.id!], p);
    let mix = slices.filter((x) => x.assetClassId !== null);
    const total = mix.reduce((t, x) => t + x.cents, 0);
    if (total <= 0) {
      // Empty account: its contributions follow the whole portfolio's mix.
      mix = portfolioMix.filter((x) => x.assetClassId !== null);
      if (mix.reduce((t, x) => t + x.cents, 0) > 0) warnings.push(`${a.name} has no holdings, so its contributions use the overall portfolio mix.`);
      else if (cc) {
        mix = [{ assetClassId: cc.id!, name: cc.name, cents: 1, pct: 100 }];
        warnings.push(`${a.name}: no holdings anywhere yet, so it is projected as cash.`);
      }
    }
    const mt = mix.reduce((t, x) => t + x.cents, 0) || 1;
    const weights = new Map<number, number>();
    for (const x of mix) weights.set(x.assetClassId!, (weights.get(x.assetClassId!) ?? 0) + x.cents / mt);

    const base = baseContribution(a, incomeYears);
    if (base.note) warnings.push(`${a.name}: ${base.note}.`);
    const growth = a.contributionGrowthPct / 100;
    return {
      id: a.id!,
      name: a.name,
      kind: a.kind,
      startCents: sum.accounts.find((x) => x.account.id === a.id)?.total ?? 0,
      weights,
      contribution: (t: number) => base.cents * Math.pow(1 + growth, t - 1),
    };
  });

  if (sum.missing.length) warnings.push(`No price for ${sum.missing.join(', ')}; those holdings count as $0 until you enter a price.`);
  return {
    input: { accounts, classes: toClassAssumptions(p.assetClasses), years: s.years, inflation: s.inflationPct / 100 },
    warnings,
    startTotal: accounts.reduce((t, a) => t + a.startCents, 0),
  };
}
