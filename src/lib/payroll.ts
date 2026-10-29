import type { Bracket, TaxTables } from '../data/taxYears';
import type { Bonus, DeductionItem, DeductionType, IncomeProfile, Person, TaxSettings } from '../types';
import { addDays, monthPayDate } from './dates';
import { daysBetween } from './money';
import { occurrencesBetween } from './schedule';
import { RETIREMENT_RULES_2026 } from '../data/retirementTax';
import type { ResolvedVest } from './rsu';

/**
 * Payroll engine: simulates one person's year paycheck by paycheck, applying annual caps (Social Security wage base,
 * 401(k), HSA, FSA, ESPP) as they are reached, then a household calculation of the actual annual tax liability.
 * Pure functions. All money in cents.
 */

// ---------- helpers ----------

export function bracketTax(taxable: number, brackets: Bracket[]): number {
  let tax = 0;
  for (let i = 0; i < brackets.length; i++) {
    const lo = brackets[i].over;
    const hi = i + 1 < brackets.length ? brackets[i + 1].over : Infinity;
    if (taxable > lo) tax += (Math.min(taxable, hi) - lo) * brackets[i].rate;
  }
  return Math.round(tax);
}

const scaleBrackets = (b: Bracket[], f: number): Bracket[] => b.map((x) => ({ ...x, over: Math.round(x.over * f) }));

export function nominalPeriods(p: Pick<IncomeProfile, 'mode' | 'frequency'>): number {
  if (p.mode === 'annual') return 12;
  return { weekly: 52, biweekly: 26, semimonthly: 24, monthly: 12 }[p.frequency];
}

export function defaultFlags(type: DeductionType): Pick<DeductionItem, 'fedExempt' | 'ficaExempt' | 'stateExempt'> {
  switch (type) {
    case 'k401_pretax':
      // Exempt from federal income tax, NOT from Social Security/Medicare. MA state treatment: see TaxTables notes.
      return { fedExempt: true, ficaExempt: false, stateExempt: true };
    case 'hsa':
    case 'health':
    case 'dental':
    case 'vision':
    case 'fsa':
      return { fedExempt: true, ficaExempt: true, stateExempt: true };
    default:
      return { fedExempt: false, ficaExempt: false, stateExempt: false };
  }
}

export function catchUpFor(p: Person | undefined, year: number, t: TaxTables): { k401: number; hsa: number } {
  if (!p?.birthYear) return { k401: 0, hsa: 0 };
  const age = year - p.birthYear; // age reached during the year
  const k401 = age >= 60 && age <= 63 ? t.limits.k401CatchUp6063 : age >= 50 ? t.limits.k401CatchUp50 : 0;
  return { k401, hsa: age >= 55 ? t.limits.hsaCatchUp55 : 0 };
}

// ---------- per-person simulation ----------

export interface PayEvent {
  date: string;
  kind: 'regular' | 'bonus' | 'rsu';
  label: string;
  /** RSU vests: the vest this event came from. */
  vestId?: number;
  gross: number;
  /** Employee deductions by deduction id (after caps). */
  deductions: Record<string, number>;
  employerMatch: number;
  fedTaxable: number;
  ficaTaxable: number;
  stateTaxable: number;
  fedWithholding: number;
  socialSecurity: number;
  medicare: number;
  addlMedicare: number;
  stateWithholding: number;
  pfml: number;
  /** Cash that reaches you. A vest you keep as shares has none: see keptValue. */
  net: number;
  /** Held RSU vests: the after-tax value of the shares kept, in dollars (not cash, so not part of net). */
  keptValue?: number;
  notes: string[];
}

export interface PersonYear {
  personId: number;
  year: number;
  events: PayEvent[];
  totals: {
    gross: number;
    bonusGross: number;
    /** Gross value of RSU vests paid in the year. */
    rsuGross: number;
    net: number;
    fedTaxable: number;
    ficaTaxable: number;
    stateTaxable: number;
    fedWithholding: number;
    socialSecurity: number;
    medicare: number;
    addlMedicare: number;
    stateWithholding: number;
    pfml: number;
    employerMatch: number;
    deductions: Record<string, number>;
  };
  limits: { k401: number; hsa: number; fsa: number; espp: number };
  /** Contributions by account type for the year (feeds investment projections). */
  contributions: { k401Pretax: number; k401Roth: number; employerMatch: number; hsa: number; employerHsa: number; espp: number };
  milestones: {
    ssCapDate: string | null;
    k401LimitDate: string | null;
    hsaLimitDate: string | null;
    esppCapDate: string | null;
    addlMedicareStartDate: string | null;
    /** The date the employer's yearly contribution maximum was reached, if one is set and reached. */
    matchCapDate: string | null;
  };
  warnings: string[];
}

function salaryAt(p: IncomeProfile, date: string): number {
  const sorted = [...p.salary].sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
  let cur = sorted[0]?.annualCents ?? 0;
  for (const s of sorted) if (s.effectiveDate <= date) cur = s.annualCents;
  return cur;
}

function payDates(p: IncomeProfile, year: number): string[] {
  if (p.mode === 'annual') return Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}-15`);
  // The entered pay date is just an anchor: the schedule runs both forward and backward from it, so the whole
  // year is covered no matter which pay date was entered.
  const jan1 = `${year}-01-01`;
  if (p.frequency === 'monthly' || p.frequency === 'semimonthly') {
    // Day-of-month schedules: specs are explicit days (31 = last day) or the last business day, optionally moved off weekends.
    const want = p.frequency === 'semimonthly' ? 2 : 1;
    const fallback = p.frequency === 'semimonthly' ? (p.semiDays ?? [1, 15]) : [Number(p.firstPayDate.slice(8, 10)) || 1];
    const specs = (p.payDays?.length ? p.payDays : fallback).slice(0, want);
    const adjust = p.weekendAdjust ?? false;
    const out: string[] = [];
    // Include next January: a 1st that falls on a weekend moves back into December of this year.
    for (let m = 1; m <= 13; m++) {
      const month = m === 13 ? `${year + 1}-01` : `${year}-${String(m).padStart(2, '0')}`;
      for (const spec of specs) out.push(monthPayDate(month, spec, adjust));
    }
    return out.filter((d) => d.startsWith(`${year}-`)).sort();
  }
  let startDate: string;
  if (p.frequency === 'weekly' || p.frequency === 'biweekly') {
    const step = p.frequency === 'weekly' ? 7 : 14;
    startDate = addDays(p.firstPayDate, Math.floor(daysBetween(jan1, p.firstPayDate) / step) * step);
  } else startDate = jan1;
  const rule = {
    accountId: 0,
    payee: '',
    amountCents: 0,
    categoryId: null,
    memo: '',
    frequency: p.frequency,
    startDate,
    semiDays: p.semiDays,
    active: true,
  } as const;
  return occurrencesBetween({ ...rule }, jan1, `${year}-12-31`);
}

export function simulatePerson(
  profile: IncomeProfile,
  person: Person | undefined,
  bonuses: Bonus[],
  t: TaxTables,
  vests: ResolvedVest[] = [],
): PersonYear {
  const year = profile.year;
  const nominal = nominalPeriods(profile);
  const catchUp = catchUpFor(person, year, t);
  const hsaBase = profile.hsaCoverage === 'family' ? t.limits.hsaFamily : t.limits.hsaSelf;
  const caps = {
    k401: t.limits.k401Deferral + catchUp.k401,
    hsa: Math.max(0, hsaBase + catchUp.hsa - profile.employerHsaAnnualCents),
    fsa: t.limits.healthFsa,
    espp: Math.round(t.limits.esppStockValue * (1 - profile.esppDiscountPct / 100)),
  };

  type Slot = { date: string; kind: 'regular' | 'bonus' | 'rsu'; label: string; bonusGross: number; vestId?: number; kept?: boolean };
  const slots: Slot[] = [
    ...payDates(profile, year).map((date): Slot => ({ date, kind: 'regular', label: 'Paycheck', bonusGross: 0 })),
    ...bonuses
      .filter((b) => b.personId === profile.personId && b.year === year)
      .map((b): Slot => ({ date: `${year}-${String(b.month).padStart(2, '0')}-15`, kind: 'bonus', label: b.label || 'Bonus', bonusGross: b.grossCents })),
    ...vests
      .filter((r) => r.vest.personId === profile.personId && r.vest.date.startsWith(`${year}-`) && r.grossCents > 0)
      .map((r): Slot => ({ date: r.vest.date, kind: 'rsu', label: r.vest.grant ? `RSU: ${r.vest.grant}` : 'RSU vest', bonusGross: r.grossCents, vestId: r.vest.id, kept: r.vest.kind === 'stock' && r.vest.afterVest === 'held' })),
  ].sort((a, b) => a.date.localeCompare(b.date) || (a.kind === 'regular' ? -1 : 1));

  const ytd = { k401: 0, hsa: 0, fsa: 0, espp: 0, ficaWages: 0, ssWages: 0, eligibleComp: 0, k401Defer: 0, pfmlWages: 0, employer: 0 };
  const events: PayEvent[] = [];
  const warnings: string[] = [];
  const milestones: PersonYear['milestones'] = { ssCapDate: null, k401LimitDate: null, hsaLimitDate: null, esppCapDate: null, addlMedicareStartDate: null, matchCapDate: null };
  const match = profile.match ?? null;

  for (const s of slots) {
    const isRsu = s.kind === 'rsu';
    const isBonus = s.kind !== 'regular';
    const gross = isBonus ? s.bonusGross : Math.round(salaryAt(profile, s.date) / nominal);
    const notes: string[] = [];
    const ded: Record<string, number> = {};
    let fedEx = 0;
    let ficaEx = 0;
    let stateEx = 0;
    let deferThisEvent = 0;

    for (const item of profile.deductions) {
      let planned = 0;
      if (isRsu) planned = 0;
      else if (isBonus) planned = item.mode === 'percent' && item.appliesToBonus ? Math.round((gross * item.value) / 100) : 0;
      else if (item.mode === 'percent') planned = Math.round((gross * item.value) / 100);
      else planned = profile.mode === 'annual' ? Math.round(item.value / 12) : item.value;

      // Annual caps, applied as the year progresses.
      let amt = planned;
      const capped = (key: 'k401' | 'hsa' | 'fsa' | 'espp') => {
        const remaining = Math.max(0, caps[key] - ytd[key]);
        if (amt > remaining) {
          amt = remaining;
          notes.push(`${item.name} limited by the annual limit`);
        }
        ytd[key] += amt;
        return amt;
      };
      if (item.type === 'k401_pretax' || item.type === 'k401_roth') {
        capped('k401');
        deferThisEvent += amt;
        if (!milestones.k401LimitDate && ytd.k401 >= caps.k401 && caps.k401 > 0) milestones.k401LimitDate = s.date;
      } else if (item.type === 'hsa') {
        capped('hsa');
        if (!milestones.hsaLimitDate && ytd.hsa >= caps.hsa && caps.hsa > 0) milestones.hsaLimitDate = s.date;
      } else if (item.type === 'fsa') capped('fsa');
      else if (item.type === 'espp') {
        capped('espp');
        if (!milestones.esppCapDate && ytd.espp >= caps.espp && caps.espp > 0) milestones.esppCapDate = s.date;
      }
      ded[item.id] = amt;
      if (item.fedExempt) fedEx += amt;
      if (item.ficaExempt) ficaEx += amt;
      if (item.stateExempt) stateEx += amt;
    }

    const fedTaxable = Math.max(0, gross - fedEx);
    const ficaTaxable = Math.max(0, gross - ficaEx);
    const stateTaxable = Math.max(0, gross - stateEx);

    // Social Security (stops at the wage base) and Medicare.
    const ssRoom = Math.max(0, t.ssWageBase - ytd.ssWages);
    const ssWagesNow = Math.min(ficaTaxable, ssRoom);
    const socialSecurity = Math.round(ssWagesNow * t.ssRate);
    ytd.ssWages += ssWagesNow;
    if (!milestones.ssCapDate && ytd.ssWages >= t.ssWageBase) milestones.ssCapDate = s.date;
    const medicare = Math.round(ficaTaxable * t.medicareRate);
    const overBefore = Math.max(0, ytd.ficaWages - t.addlMedicareWithholdingThreshold);
    const overAfter = Math.max(0, ytd.ficaWages + ficaTaxable - t.addlMedicareWithholdingThreshold);
    const addlMedicare = Math.round((overAfter - overBefore) * t.addlMedicareRate);
    if (addlMedicare > 0 && !milestones.addlMedicareStartDate) milestones.addlMedicareStartDate = s.date;
    ytd.ficaWages += ficaTaxable;
    const pfml = Math.round(Math.max(0, Math.min(ficaTaxable, t.ma.pfmlWageCap - ytd.pfmlWages)) * t.ma.pfmlEmployeeRate);
    ytd.pfmlWages += ficaTaxable; // tracks PFML wages (same base as FICA wages)

    // Income tax withholding (estimates; see TaxTables notes).
    let fedWithholding: number;
    let stateWithholding: number;
    if (isRsu) {
      // Vests are withheld at the rates you set for them (default: the supplemental federal rate and the MA flat rate).
      const fedRate = profile.rsuWithholding ? profile.rsuWithholding.fedPct / 100 : t.supplementalFedRate;
      const stateRate = profile.rsuWithholding ? profile.rsuWithholding.statePct / 100 : t.ma.withholdingRate;
      fedWithholding = Math.round(fedTaxable * fedRate);
      stateWithholding = Math.round(stateTaxable * stateRate);
    } else if (isBonus) {
      fedWithholding = profile.fedWithholding.mode === 'manual' ? 0 : Math.round(fedTaxable * t.supplementalFedRate);
      stateWithholding = profile.stateWithholding.mode === 'manual' ? 0 : Math.round(stateTaxable * t.ma.withholdingRate);
    } else {
      if (profile.fedWithholding.mode === 'manual') fedWithholding = profile.fedWithholding.manualPerPaycheckCents;
      else {
        const f = profile.fedWithholding.twoJobs ? 0.5 : 1;
        const annualized = fedTaxable * nominal;
        const base = Math.max(0, annualized - Math.round(t.stdDeductionMFJ * f));
        fedWithholding = Math.round(bracketTax(base, scaleBrackets(t.fedBracketsMFJ, f)) / nominal) + profile.fedWithholding.extraPerPaycheckCents;
      }
      if (profile.stateWithholding.mode === 'manual') stateWithholding = profile.stateWithholding.manualPerPaycheckCents;
      else {
        const base = Math.max(0, stateTaxable * nominal - t.ma.withholdingAllowancePerPerson);
        stateWithholding = Math.round((base * t.ma.withholdingRate) / nominal);
      }
    }

    // Employer 401(k) contribution. Two formulas: a match on what you contribute (default) or a flat % of pay.
    // An optional yearly dollar maximum stops it once reached. (A match with true-up is computed at year end instead.)
    let employerMatch = 0;
    if (match) {
      const eligible = isRsu ? 0 : isBonus ? (match.appliesToBonus ? gross : 0) : gross;
      ytd.eligibleComp += eligible;
      ytd.k401Defer += deferThisEvent;
      const flat = match.formula === 'flat';
      if (flat) employerMatch = Math.round((eligible * (match.flatPctOfPay ?? 0)) / 100);
      else if (!match.trueUp) {
        const matchable = Math.min(deferThisEvent, Math.round((eligible * match.upToPctOfPay) / 100));
        employerMatch = Math.round((matchable * match.ratePct) / 100);
      }
      const cap = match.annualCapCents && match.annualCapCents > 0 ? match.annualCapCents : null;
      if (cap !== null && (flat || !match.trueUp)) {
        employerMatch = Math.max(0, Math.min(employerMatch, cap - ytd.employer));
        ytd.employer += employerMatch;
        if (!milestones.matchCapDate && ytd.employer >= cap) milestones.matchCapDate = s.date;
      }
    }

    const dedTotal = Object.values(ded).reduce((a, b) => a + b, 0);
    let net = gross - dedTotal - fedWithholding - socialSecurity - medicare - addlMedicare - stateWithholding - pfml;
    // Shares you keep are not cash: the tax comes out of the vest (sell-to-cover) and the rest stays as stock.
    let keptValue: number | undefined;
    if (s.kept) {
      notes.push('Net amount kept as shares, not paid as cash');
      keptValue = Math.max(0, net);
      net = 0;
    }
    if (net < 0) notes.push('Deductions and taxes exceed this paycheck');
    events.push({
      date: s.date,
      kind: s.kind,
      label: s.label,
      vestId: s.vestId,
      gross,
      deductions: ded,
      employerMatch,
      fedTaxable,
      ficaTaxable,
      stateTaxable,
      fedWithholding,
      socialSecurity,
      medicare,
      addlMedicare,
      stateWithholding,
      pfml,
      net,
      keptValue,
      notes,
    });
  }

  // Year-end true-up of the employer match.
  if (match?.trueUp && match.formula !== 'flat' && events.length) {
    let total = Math.round((Math.min(ytd.k401Defer, Math.round((ytd.eligibleComp * match.upToPctOfPay) / 100)) * match.ratePct) / 100);
    const cap = match.annualCapCents && match.annualCapCents > 0 ? match.annualCapCents : null;
    if (cap !== null && total >= cap) {
      total = cap;
      milestones.matchCapDate = events[events.length - 1].date; // known only at year end
    }
    events[events.length - 1].employerMatch = total;
    events[events.length - 1].notes.push('Includes year-end match true-up');
  }

  const sum = (f: (e: PayEvent) => number) => events.reduce((a, e) => a + f(e), 0);
  const dedTotals: Record<string, number> = {};
  for (const item of profile.deductions) dedTotals[item.id] = sum((e) => e.deductions[item.id] ?? 0);
  const typeTotal = (types: DeductionType[]) =>
    profile.deductions.filter((i) => types.includes(i.type)).reduce((a, i) => a + dedTotals[i.id], 0);

  for (const r of vests) if (r.vest.personId === profile.personId && r.vest.date.startsWith(`${year}-`) && r.warning) warnings.push(r.warning);
  if (events.length === 0) warnings.push('No pay dates fall in this year. Check the first pay date and frequency.');

  return {
    personId: profile.personId,
    year,
    events,
    totals: {
      gross: sum((e) => e.gross),
      bonusGross: sum((e) => (e.kind === 'bonus' ? e.gross : 0)),
      rsuGross: sum((e) => (e.kind === 'rsu' ? e.gross : 0)),
      net: sum((e) => e.net),
      fedTaxable: sum((e) => e.fedTaxable),
      ficaTaxable: sum((e) => e.ficaTaxable),
      stateTaxable: sum((e) => e.stateTaxable),
      fedWithholding: sum((e) => e.fedWithholding),
      socialSecurity: sum((e) => e.socialSecurity),
      medicare: sum((e) => e.medicare),
      addlMedicare: sum((e) => e.addlMedicare),
      stateWithholding: sum((e) => e.stateWithholding),
      pfml: sum((e) => e.pfml),
      employerMatch: sum((e) => e.employerMatch),
      deductions: dedTotals,
    },
    limits: caps,
    contributions: {
      k401Pretax: typeTotal(['k401_pretax']),
      k401Roth: typeTotal(['k401_roth']),
      employerMatch: sum((e) => e.employerMatch),
      hsa: typeTotal(['hsa']),
      employerHsa: profile.employerHsaAnnualCents,
      espp: typeTotal(['espp']),
    },
    milestones,
    warnings,
  };
}

// ---------- household annual liability ----------

export interface HouseholdTax {
  federal: {
    wages: number;
    otherIncome: number;
    deduction: number;
    usedItemized: boolean;
    taxableIncome: number;
    taxBeforeCredits: number;
    credits: number;
    incomeTax: number;
    addlMedicareLiability: number;
    /** 20% penalty on HSA withdrawals that were not for medical costs (owner under 65). */
    hsaPenalty: number;
    /** Realized capital gains for the year (after netting losses) and the tax on the long-term part and the 3.8% net investment income tax. */
    shortTermGains: number;
    longTermGains: number;
    capitalGainsTax: number;
    niit: number;
    totalLiability: number;
    withheld: number;
    /** Positive = refund, negative = you owe. */
    balance: number;
  };
  ma: {
    wages: number;
    exemptions: number;
    ficaDeduction: number;
    taxableIncome: number;
    baseTax: number;
    surtax: number;
    credits: number;
    totalLiability: number;
    withheld: number;
    balance: number;
  };
  ficaTotal: number;
  pfmlTotal: number;
}

export interface HouseholdExtras {
  hsaPenaltyCents?: number;
  /** Realized gains, already netted: short-term is taxed as ordinary income, long-term at 0/15/20%. */
  stcgCents?: number;
  ltcgCents?: number;
  /** Net capital loss deducted against other income (up to $3,000). */
  lossDeductionCents?: number;
}

export function householdTax(years: PersonYear[], s: TaxSettings, t: TaxTables, extra: HouseholdExtras = {}): HouseholdTax {
  const sum = (f: (p: PersonYear) => number) => years.reduce((a, p) => a + f(p), 0);

  const fedWages = sum((p) => p.totals.fedTaxable);
  const stcg = extra.stcgCents ?? 0;
  const ltcg = extra.ltcgCents ?? 0;
  const lossDed = extra.lossDeductionCents ?? 0;
  const gross = fedWages + s.otherIncomeCents + stcg - lossDed + ltcg;
  const std = t.stdDeductionMFJ;
  const usedItemized = s.itemizedDeductionCents > std;
  const deduction = usedItemized ? s.itemizedDeductionCents : std;
  const taxable = Math.max(0, gross - deduction);
  // Long-term gains sit on top of ordinary income and are taxed at 0%, 15%, or 20%.
  const prefIncome = Math.min(ltcg, taxable);
  const ordTaxable = taxable - prefIncome;
  const z = RETIREMENT_RULES_2026.ltcg0Top;
  const f15 = RETIREMENT_RULES_2026.ltcg15Top;
  const amt15 = Math.max(0, Math.min(ordTaxable + prefIncome, f15) - Math.max(ordTaxable, z));
  const amt20 = Math.max(0, ordTaxable + prefIncome - Math.max(ordTaxable, f15));
  const capitalGainsTax = Math.round(amt15 * 0.15 + amt20 * 0.2);
  const niit = Math.round(RETIREMENT_RULES_2026.niitRate * Math.max(0, Math.min(stcg + ltcg, gross - RETIREMENT_RULES_2026.niitThreshold)));
  const before = bracketTax(ordTaxable, t.fedBracketsMFJ) + capitalGainsTax;
  const incomeTax = Math.max(0, before - s.federalCreditsCents);
  const medicareWages = sum((p) => p.totals.ficaTaxable);
  const addlLiability = Math.round(Math.max(0, medicareWages - t.addlMedicareThresholdMFJ) * t.addlMedicareRate);
  const hsaPenalty = extra.hsaPenaltyCents ?? 0;
  const fedLiability = incomeTax + addlLiability + hsaPenalty + niit;
  const fedWithheld = sum((p) => p.totals.fedWithholding + p.totals.addlMedicare);

  const maWages = sum((p) => p.totals.stateTaxable) + s.otherIncomeCents + stcg + ltcg - lossDed;
  const exemptions = t.ma.personalExemptionMFJ + s.maDependents * t.ma.dependentExemption;
  const ficaDeduction = years.reduce(
    (a, p) => a + Math.min(t.ma.ficaDeductionCapPerSpouse, p.totals.socialSecurity + p.totals.medicare + p.totals.addlMedicare),
    0,
  );
  const maTaxable = Math.max(0, maWages - exemptions - ficaDeduction);
  const base = Math.round(maTaxable * t.ma.rate);
  const surtax = Math.round(Math.max(0, maTaxable - t.ma.surtaxThreshold) * t.ma.surtaxRate);
  const maLiability = Math.max(0, base + surtax - s.maCreditsCents);
  const maWithheld = sum((p) => p.totals.stateWithholding);

  return {
    federal: {
      wages: fedWages,
      otherIncome: s.otherIncomeCents,
      deduction,
      usedItemized,
      taxableIncome: taxable,
      taxBeforeCredits: before,
      credits: s.federalCreditsCents,
      incomeTax,
      addlMedicareLiability: addlLiability,
      hsaPenalty,
      shortTermGains: stcg,
      longTermGains: ltcg,
      capitalGainsTax,
      niit,
      totalLiability: fedLiability,
      withheld: fedWithheld,
      balance: fedWithheld - fedLiability,
    },
    ma: {
      wages: maWages,
      exemptions,
      ficaDeduction,
      taxableIncome: maTaxable,
      baseTax: base,
      surtax,
      credits: s.maCreditsCents,
      totalLiability: maLiability,
      withheld: maWithheld,
      balance: maWithheld - maLiability,
    },
    ficaTotal: sum((p) => p.totals.socialSecurity + p.totals.medicare),
    pfmlTotal: sum((p) => p.totals.pfml),
  };
}

/** Take-home pay by month (index 0 = January) across the given people. `excludeRsu` leaves stock vests out (paychecks and bonuses only). */
export function monthlyNet(years: PersonYear[], opts: { excludeRsu?: boolean } = {}): number[] {
  const out = Array<number>(12).fill(0);
  for (const y of years) for (const e of y.events) if (!(opts.excludeRsu && e.kind === 'rsu')) out[Number(e.date.slice(5, 7)) - 1] += e.net;
  return out;
}
