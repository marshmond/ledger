import type { FinanceDB } from '../db';
import { builtInTables, type TaxTables } from '../data/taxYears';
import type { Bonus, IncomeProfile, PayDay, Person, RsuVest, Security, TaxSettings } from '../types';
import { resolveVests, type ResolvedVest } from './rsu';
import { defaultFlags, householdTax, simulatePerson, type HouseholdTax, type PersonYear } from './payroll';

export const DEFAULT_SETTINGS = (year: number): TaxSettings => ({
  year,
  itemizedDeductionCents: 0,
  otherIncomeCents: 0,
  federalCreditsCents: 0,
  maDependents: 0,
  maCreditsCents: 0,
});

export function newProfile(personId: number, year: number): IncomeProfile {
  return {
    personId,
    year,
    mode: 'paycheck',
    frequency: 'semimonthly',
    firstPayDate: `${year}-01-15`,
    semiDays: [1, 15],
    salary: [{ effectiveDate: `${year}-01-01`, annualCents: 0 }],
    deductions: [],
    match: null,
    employerHsaAnnualCents: 0,
    hsaCoverage: 'family',
    esppDiscountPct: 15,
    // Both spouses working: the "Step 2" W-4 box is normally checked, which withholds at higher per-job rates.
    fedWithholding: { mode: 'estimate', manualPerPaycheckCents: 0, twoJobs: true, extraPerPaycheckCents: 0 },
    stateWithholding: { mode: 'estimate', manualPerPaycheckCents: 0 },
  };
}

/** Copies a profile into a new year, shifting every date (pay anchor, raises) by the year difference. */
export function rollForward(p: IncomeProfile, toYear: number): IncomeProfile {
  const shift = (d: string) => `${toYear}${d.slice(4)}`;
  const { id: _id, ...rest } = p;
  void _id;
  return {
    ...rest,
    year: toYear,
    firstPayDate: shift(p.firstPayDate),
    // Keep only the latest salary as the starting salary of the new year.
    salary: [{ effectiveDate: `${toYear}-01-01`, annualCents: [...p.salary].sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate)).at(-1)?.annualCents ?? 0 }],
    deductions: p.deductions.map((d) => ({ ...d })),
  };
}

export function newDeduction(type: import('../types').DeductionType) {
  const names: Record<string, string> = {
    k401_pretax: '401(k) pre-tax',
    k401_roth: '401(k) Roth',
    hsa: 'HSA',
    health: 'Health premium',
    dental: 'Dental premium',
    vision: 'Vision premium',
    fsa: 'Health FSA',
    espp: 'ESPP',
    custom: 'Other',
  };
  const percentTypes = ['k401_pretax', 'k401_roth', 'espp'];
  return {
    id: crypto.randomUUID(),
    type,
    name: names[type],
    mode: percentTypes.includes(type) ? ('percent' as const) : ('fixed' as const),
    value: 0,
    appliesToBonus: false,
    ...defaultFlags(type),
  };
}

/** Parses an edited tax table JSON; returns an error message instead of throwing. */
export function parseTablesJson(text: string, year: number): { tables?: TaxTables; error?: string } {
  try {
    const t = JSON.parse(text) as TaxTables;
    if (!t || typeof t !== 'object') return { error: 'Not an object' };
    if (t.year !== year) return { error: `The "year" field must be ${year}` };
    if (!Array.isArray(t.fedBracketsMFJ) || t.fedBracketsMFJ.length === 0) return { error: 'fedBracketsMFJ is missing' };
    for (const k of ['stdDeductionMFJ', 'ssWageBase', 'ssRate', 'medicareRate'] as const) {
      if (typeof t[k] !== 'number') return { error: `${k} must be a number` };
    }
    if (!t.limits || !t.ma) return { error: 'limits and ma sections are required' };
    return { tables: t };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Invalid JSON' };
  }
}

/** Tables for a year: your edited copy if you saved one, else the built-in table, else null (never a silent guess). */
export function resolveTables(year: number, settings?: TaxSettings): { tables: TaxTables | null; source: 'custom' | 'built-in' | 'none' } {
  if (settings?.tablesOverride) {
    const r = parseTablesJson(settings.tablesOverride, year);
    if (r.tables) return { tables: r.tables, source: 'custom' };
  }
  const b = builtInTables(year);
  return b ? { tables: b, source: 'built-in' } : { tables: null, source: 'none' };
}

export interface IncomeModel {
  year: number;
  tables: TaxTables | null;
  tableSource: 'custom' | 'built-in' | 'none';
  people: Person[];
  years: PersonYear[];
  household: HouseholdTax | null;
  /** Every RSU vest with its value (all years). */
  vests: ResolvedVest[];
  missingProfiles: Person[];
}

export async function loadIncomeModel(d: FinanceDB, year: number): Promise<IncomeModel> {
  const [people, profiles, bonuses, allSettings, rsuVests, securities] = await Promise.all([
    d.people.toArray(),
    d.incomeProfiles.toArray(), // filtered by year in buildIncomeModel
    d.bonuses.toArray(),
    d.taxSettings.where('year').equals(year).toArray(),
    d.rsuVests.toArray(),
    d.securities.toArray(),
  ]);
  return buildIncomeModel(year, people, profiles, bonuses, allSettings[0], { vests: rsuVests, securities });
}

export function buildIncomeModel(
  year: number,
  people: Person[],
  profiles: IncomeProfile[],
  bonuses: Bonus[],
  settings?: TaxSettings,
  rsu?: { vests: RsuVest[]; securities: Security[] },
  /** HSA withdrawals that were not for medical costs: added to income, with the penalty on top. */
  hsa?: { taxableCents: number; penaltyCents: number },
  /** Realized capital gains for the year, netted for tax (see netForTax in lots.ts). */
  gains?: { stcgCents: number; ltcgCents: number; lossDeductionCents: number },
): IncomeModel {
  const { tables, source } = resolveTables(year, settings);
  const vests = resolveVests(rsu?.vests ?? [], rsu?.securities ?? []);
  const mine = profiles.filter((p) => p.year === year);
  const years = tables
    ? mine.map((p) => simulatePerson(p, people.find((x) => x.id === p.personId), bonuses, tables, vests))
    : [];
  return {
    year,
    tables,
    tableSource: source,
    people,
    years,
    household: tables && years.length
      ? householdTax(years, { ...(settings ?? DEFAULT_SETTINGS(year)), otherIncomeCents: (settings?.otherIncomeCents ?? 0) + (hsa?.taxableCents ?? 0) }, tables, { hsaPenaltyCents: hsa?.penaltyCents ?? 0, stcgCents: gains?.stcgCents, ltcgCents: gains?.ltcgCents, lossDeductionCents: gains?.lossDeductionCents })
      : null,
    vests,
    missingProfiles: people.filter((p) => !mine.some((m) => m.personId === p.id)),
  };
}

// ---- benefit switches (ESPP / HSA appear only when switched on) ----

/** An explicit switch wins; otherwise a profile that already has an ESPP deduction counts as enrolled. */
export const esppOn = (p: IncomeProfile): boolean => p.esppEnrolled ?? p.deductions.some((d) => d.type === 'espp');
export const hsaOn = (p: IncomeProfile): boolean => p.hasHsa ?? (p.deductions.some((d) => d.type === 'hsa') || p.employerHsaAnnualCents > 0);

// ---- pay days ----

/** The pay days to show for a day-of-month schedule: saved choices, else what older profiles implied. */
export function payDaysOf(p: Pick<IncomeProfile, 'frequency' | 'payDays' | 'semiDays' | 'firstPayDate'>): PayDay[] {
  const need = p.frequency === 'semimonthly' ? 2 : p.frequency === 'monthly' ? 1 : 0;
  const base: PayDay[] = p.payDays?.length
    ? p.payDays
    : p.frequency === 'semimonthly'
      ? [...(p.semiDays ?? [1, 15])]
      : [Number(p.firstPayDate.slice(8, 10)) || 1];
  const out = base.slice(0, need);
  while (out.length < need) out.push(out.length === 0 ? 1 : 15);
  return out;
}
