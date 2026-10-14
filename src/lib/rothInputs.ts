import { TAX_2026 } from '../data/taxYears';
import { RETIREMENT_RULES_2026, rmdStartAge } from '../data/retirementTax';
import type { AssetClass, Holding, IncomeProfile, InvAccount, Person, RetirementSettings, Security } from '../types';
import type { IncomeModel } from './income';
import { holdingValue } from './investments';
import { DEFAULT_RETIREMENT } from './retirement';
import type { OtherIncome, PlanInput, PlanPerson, Strategy } from './rothPlan';
import { NO_CONVERSION } from './rothPlan';

/** What you can change on the Roth page (stored on this device under the settings key 'rothPlan'). */
export interface RothSettings {
  planAge: number;
  /** null = use the retirement spending figure from the Retirement tab. */
  spendingCents: number | null;
  inflationPct: number;
  wageGrowthPct: number;
  /** null = estimated from your holdings and asset-class assumptions. */
  returnPct: { trad: number | null; roth: number | null; taxable: number | null };
  volPct: number | null;
  yieldPct: number;
  yieldOrdinaryPct: number;
  perPerson: { personId: number; retireYear: number | null; ssAnnualCents: number; ssClaimAge: number; iraBasisCents: number }[];
  other: OtherIncome[];
  aca: { on: boolean; benchmarkCents: number; premiumGrowthPct: number };
  conversionTaxFrom: 'outside' | 'conversion';
  endTaxRatePct: number;
  heirTaxRatePct: number;
  sims: number;
  /** null = the starter set, built from your dates. */
  strategies: Strategy[] | null;
}

export const DEFAULT_ROTH: RothSettings = {
  planAge: 95,
  spendingCents: null,
  inflationPct: 2.5,
  wageGrowthPct: 3,
  returnPct: { trad: null, roth: null, taxable: null },
  volPct: null,
  yieldPct: 2,
  yieldOrdinaryPct: 40,
  perPerson: [],
  other: [],
  aca: { on: false, benchmarkCents: 0, premiumGrowthPct: 5 },
  conversionTaxFrom: 'outside',
  endTaxRatePct: 24,
  heirTaxRatePct: 24,
  sims: 300,
  strategies: null,
};

export interface RothSources {
  year0: number;
  people: Person[];
  profiles: IncomeProfile[];
  income: IncomeModel;
  accounts: InvAccount[];
  holdings: Holding[];
  securities: Security[];
  classes: AssetClass[];
  retirement: Partial<RetirementSettings> | undefined;
  /** Saved Projections inflation, used as the starting inflation assumption. */
  projectionInflationPct?: number;
}

export interface BuiltPlan {
  input: PlanInput | null;
  /** Things to fix before the numbers mean much. */
  problems: string[];
  /** Plain-language notes about how your data was read. */
  notes: string[];
  /** Per person: where their balances came from. */
  balances: { name: string; ira: number; k401: number; roth: number }[];
  taxable: number;
  taxableBasis: number;
  estReturn: { trad: number; roth: number; taxable: number };
  estVol: number;
  retireDefault: number;
}

const weighted = (items: { w: number; v: number }[], fallback: number) => {
  const tot = items.reduce((a, b) => a + b.w, 0);
  return tot > 0 ? items.reduce((a, b) => a + b.w * b.v, 0) / tot : fallback;
};

export function buildPlanInput(src: RothSources, s: RothSettings): BuiltPlan {
  const { year0 } = src;
  const problems: string[] = [];
  const notes: string[] = [];
  const people = [...src.people].sort((a, b) => (a.id ?? 0) - (b.id ?? 0)).slice(0, 2);
  const ret = { ...DEFAULT_RETIREMENT(year0), ...(src.retirement ?? {}) };
  const secById = new Map(src.securities.map((x) => [x.id!, x]));
  const classById = new Map(src.classes.map((c) => [c.id!, c]));

  if (people.length === 0) problems.push('Add yourself (and your spouse) on the Income tab first.');
  for (const p of people) if (!p.birthYear) problems.push(`${p.name} needs a birth year (Income tab, People). RMD ages, Medicare, and catch-up limits depend on it.`);

  // Accounts -> buckets. An account with no owner goes to the first person.
  const open = src.accounts.filter((a) => !a.closed);
  const owner = (a: InvAccount) => {
    const i = people.findIndex((p) => p.id === a.personId);
    return i >= 0 ? i : 0;
  };
  const value = (a: InvAccount) => src.holdings.filter((h) => h.accountId === a.id).reduce((t, h) => t + holdingValue(h, secById.get(h.securityId)), 0) + a.cashCents;
  const bal = people.map(() => ({ ira: 0, k401: 0, roth: 0 }));
  let taxable = 0;
  let taxableBasis = 0;
  const unowned: string[] = [];
  const missingPrice = new Set<string>();
  for (const a of open) {
    if (a.taxType === '529') continue;
    const v = value(a);
    for (const h of src.holdings.filter((x) => x.accountId === a.id)) {
      const sec = secById.get(h.securityId);
      if (sec && sec.priceCents === null) missingPrice.add(sec.ticker);
    }
    if (a.taxType === 'taxable') {
      taxable += v;
      taxableBasis += src.holdings.filter((h) => h.accountId === a.id).reduce((t, h) => t + (h.costBasisCents ?? holdingValue(h, secById.get(h.securityId))), 0) + a.cashCents;
      continue;
    }
    if (people.length === 0) continue;
    if (a.personId == null || !people.some((p) => p.id === a.personId)) unowned.push(a.name);
    const b = bal[owner(a)];
    if (a.taxType === 'roth') b.roth += v;
    else if (a.kind === '401k') b.k401 += v;
    else b.ira += v;
  }
  if (unowned.length) notes.push(`${unowned.join(', ')} ${unowned.length === 1 ? 'has' : 'have'} no owner set, so ${unowned.length === 1 ? 'it is' : 'they are'} counted as ${people[0]?.name ?? 'the first person'}’s. Set the owner on the Investments tab.`);
  if (missingPrice.size) problems.push(`No price for ${[...missingPrice].join(', ')}: those holdings count as $0. Enter prices on the Investments tab.`);

  // Return assumptions from what you hold.
  const bucketItems = { trad: [] as { w: number; v: number }[], roth: [] as { w: number; v: number }[], taxable: [] as { w: number; v: number }[] };
  const vols: { w: number; v: number }[] = [];
  for (const a of open) {
    if (a.taxType === '529') continue;
    const key = a.taxType === 'traditional' ? 'trad' : a.taxType === 'roth' ? 'roth' : 'taxable';
    for (const h of src.holdings.filter((x) => x.accountId === a.id)) {
      const sec = secById.get(h.securityId);
      const cls = sec ? classById.get(sec.assetClassId) : undefined;
      const w = holdingValue(h, sec);
      if (!cls || w <= 0) continue;
      bucketItems[key].push({ w, v: cls.expectedReturnPct });
      vols.push({ w, v: cls.volatilityPct });
    }
  }
  const all = [...bucketItems.trad, ...bucketItems.roth, ...bucketItems.taxable];
  const fallbackReturn = weighted(all, 6);
  const estReturn = {
    trad: weighted(bucketItems.trad, fallbackReturn),
    roth: weighted(bucketItems.roth, fallbackReturn),
    taxable: weighted(bucketItems.taxable, fallbackReturn),
  };
  const estVol = weighted(vols, 12);
  if (all.length === 0) notes.push('No priced holdings, so returns start at 6% a year with 12% volatility. Change them below.');

  // People: wages and contributions come from the Income tab (RSU vests are handled separately, by year).
  const retireDefault = ret.retireYear;
  const planPeople: PlanPerson[] = people.map((p, i) => {
    const cfg = s.perPerson.find((x) => x.personId === p.id);
    const y = src.income.years.find((x) => x.personId === p.id);
    const prof = src.profiles.find((x) => x.personId === p.id && x.year === year0);
    const wages = y ? y.events.filter((e) => e.kind !== 'rsu').reduce((a, e) => a + e.fedTaxable, 0) : 0;
    if (!prof) notes.push(`${p.name} has no ${year0} income setup, so wages and 401(k) saving start at $0.`);
    return {
      name: p.name,
      birthYear: p.birthYear ?? year0 - 55,
      retireYear: cfg?.retireYear ?? retireDefault,
      wagesCents: wages,
      contribTradCents: y ? y.contributions.k401Pretax + y.contributions.employerMatch : 0,
      contribRothCents: y ? y.contributions.k401Roth : 0,
      ssAnnualCents: cfg?.ssAnnualCents ?? 0,
      ssClaimAge: cfg?.ssClaimAge ?? 67,
      ira: bal[i].ira,
      k401: bal[i].k401,
      roth: bal[i].roth,
      iraBasisCents: cfg?.iraBasisCents ?? 0,
    };
  });

  const spending = s.spendingCents ?? ret.spendingCents;
  if (!(spending > 0)) problems.push('Set yearly spending in retirement (here or on the Retirement tab).');
  if (planPeople.length && planPeople.every((p) => p.ssAnnualCents === 0)) notes.push('Social Security is $0 for everyone. Enter expected benefits below; they change how much room you have each year.');

  // RSU vests by year (all of it is wages in the year it vests).
  const extraWages: Record<number, number> = {};
  for (const r of src.income.vests) {
    const y = Number(r.vest.date.slice(0, 4));
    if (y >= year0) extraWages[y] = (extraWages[y] ?? 0) + r.grossCents;
  }

  const input: PlanInput | null =
    planPeople.length === 0
      ? null
      : {
          startYear: year0,
          planAge: s.planAge,
          people: planPeople,
          taxableCents: taxable,
          taxableBasisCents: taxableBasis,
          other: s.other,
          extraWages,
          spendingCents: spending,
          inflationPct: s.inflationPct,
          wageGrowthPct: s.wageGrowthPct,
          returnPct: { trad: s.returnPct.trad ?? estReturn.trad, roth: s.returnPct.roth ?? estReturn.roth, taxable: s.returnPct.taxable ?? estReturn.taxable },
          volPct: s.volPct ?? estVol,
          yieldPct: s.yieldPct,
          yieldOrdinaryPct: s.yieldOrdinaryPct,
          aca: s.aca,
          conversionTaxFrom: s.conversionTaxFrom,
          endTaxRatePct: s.endTaxRatePct,
          heirTaxRatePct: s.heirTaxRatePct,
          T: TAX_2026,
          R: RETIREMENT_RULES_2026,
        };

  return {
    input,
    problems,
    notes,
    balances: planPeople.map((p) => ({ name: p.name, ira: p.ira, k401: p.k401, roth: p.roth })),
    taxable,
    taxableBasis,
    estReturn,
    estVol,
    retireDefault,
  };
}

let seq = 0;
export const newStrategyId = () => `s${Date.now().toString(36)}${seq++}`;

/** The starter comparison, built from your dates. */
export function starterStrategies(input: PlanInput): Strategy[] {
  const y0 = input.startYear;
  const rmd = Math.min(...input.people.map((p) => p.birthYear + rmdStartAge(p.birthYear)));
  const retire = Math.max(...input.people.map((p) => p.retireYear));
  const lastBefore = Math.max(y0, rmd - 1);
  const from = Math.max(y0, retire);
  const base = NO_CONVERSION(y0, lastBefore);
  return [
    base,
    { ...base, id: 'fill22', label: 'Fill the 22% bracket, now until RMDs', kind: 'bracket', bracketRate: 0.22, fromYear: y0, toYear: lastBefore },
    { ...base, id: 'gap24', label: 'Fill the 24% bracket, retirement until RMDs', kind: 'bracket', bracketRate: 0.24, fromYear: from, toYear: lastBefore },
    { ...base, id: 'gap24c', label: '24% bracket, but stay under IRMAA and the ACA cliff', kind: 'bracket', bracketRate: 0.24, fromYear: from, toYear: lastBefore, capIrmaa: true, capAca: true },
    { ...base, id: 'fixed50', label: '$50,000 a year, retirement until RMDs', kind: 'fixed', fixedCents: 5000000, fromYear: from, toYear: lastBefore },
  ].map((s) => ({ ...s, kind: s.kind as Strategy['kind'] }));
}
