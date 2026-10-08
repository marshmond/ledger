import type { FinanceDB } from '../db';
import { builtInTables, type TaxTables } from '../data/taxYears';
import type { Bonus, IncomeProfile, Person, TaxSettings } from '../types';
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
  missingProfiles: Person[];
}

export async function loadIncomeModel(d: FinanceDB, year: number): Promise<IncomeModel> {
  const [people, profiles, bonuses, allSettings] = await Promise.all([
    d.people.toArray(),
    d.incomeProfiles.toArray(), // filtered by year in buildIncomeModel
    d.bonuses.toArray(),
    d.taxSettings.where('year').equals(year).toArray(),
  ]);
  return buildIncomeModel(year, people, profiles, bonuses, allSettings[0]);
}

export function buildIncomeModel(
  year: number,
  people: Person[],
  profiles: IncomeProfile[],
  bonuses: Bonus[],
  settings?: TaxSettings,
): IncomeModel {
  const { tables, source } = resolveTables(year, settings);
  const mine = profiles.filter((p) => p.year === year);
  const years = tables
    ? mine.map((p) => simulatePerson(p, people.find((x) => x.id === p.personId), bonuses, tables))
    : [];
  return {
    year,
    tables,
    tableSource: source,
    people,
    years,
    household: tables && years.length ? householdTax(years, settings ?? DEFAULT_SETTINGS(year), tables) : null,
    missingProfiles: people.filter((p) => !mine.some((m) => m.personId === p.id)),
  };
}
