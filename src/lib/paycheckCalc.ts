import type { TaxTables } from '../data/taxYears';
import type { Bonus, IncomeProfile, PayScenario, Person, RsuVest, Security, TaxSettings } from '../types';
import { buildIncomeModel, DEFAULT_SETTINGS, newProfile, resolveTables } from './income';
import { householdTax, simulatePerson, type HouseholdTax, type PayEvent, type PersonYear } from './payroll';

/**
 * Paycheck calculator: a what-if copy of one person's pay (salary, schedule, deductions, match, withholding) run through the
 * same payroll engine as the Income tab. The real setup is never changed. The household's yearly tax can include the other
 * person's real income.
 */

export function scenarioFromProfile(p: IncomeProfile, name: string, now = new Date().toISOString()): PayScenario {
  const { id: _id, ...rest } = p;
  void _id;
  return {
    name,
    personId: p.personId,
    year: p.year,
    profile: JSON.parse(JSON.stringify(rest)) as IncomeProfile,
    bonuses: [],
    includeSpouse: true,
    startedFrom: 'income',
    updatedAt: now,
  };
}

/** Starts with no deductions and the salary you give; add deductions by hand. */
export function blankScenario(personId: number, year: number, name: string, annualSalaryCents: number, now = new Date().toISOString()): PayScenario {
  const p = newProfile(personId, year);
  p.salary = [{ effectiveDate: `${year}-01-01`, annualCents: annualSalaryCents }];
  return { name, personId, year, profile: p, bonuses: [], includeSpouse: true, startedFrom: 'blank', updatedAt: now };
}

export interface ScenarioInputs {
  people: Person[];
  profiles: IncomeProfile[];
  bonuses: Bonus[];
  settings?: TaxSettings;
  vests?: RsuVest[];
  securities?: Security[];
}

export interface ScenarioResult {
  scenario: PayScenario;
  tables: TaxTables;
  year: PersonYear;
  /** Yearly tax for the household with this scenario in place of the person's real income. Null if the other person has no setup and includeSpouse is off. */
  household: HouseholdTax | null;
  /** The first ordinary paycheck of the year (or any event if there are no regular ones). */
  firstCheck: PayEvent | null;
}

/** Runs one scenario. Returns null when there are no tax tables for the scenario's year. */
export function runScenario(sc: PayScenario, inp: ScenarioInputs): ScenarioResult | null {
  const { tables } = resolveTables(sc.year, inp.settings);
  if (!tables) return null;
  const person = inp.people.find((p) => p.id === sc.personId);
  const bonuses: Bonus[] = sc.bonuses.map((b) => ({ personId: sc.personId, year: sc.year, month: b.month, grossCents: b.grossCents, label: b.label }));
  const profile = { ...sc.profile, personId: sc.personId, year: sc.year };
  const year = simulatePerson(profile, person, bonuses, tables);
  const others: PersonYear[] = sc.includeSpouse
    ? buildIncomeModel(sc.year, inp.people, inp.profiles, inp.bonuses, inp.settings, { vests: inp.vests ?? [], securities: inp.securities ?? [] }).years.filter((y) => y.personId !== sc.personId)
    : [];
  const household = householdTax([year, ...others], inp.settings ?? DEFAULT_SETTINGS(sc.year), tables);
  return { scenario: sc, tables, year, household, firstCheck: year.events.find((e) => e.kind === 'regular') ?? year.events[0] ?? null };
}

/** Result of the person's real, saved setup (the baseline to compare against). Null if they have none for that year. */
export function runActual(personId: number, year: number, inp: ScenarioInputs): ScenarioResult | null {
  const prof = inp.profiles.find((p) => p.personId === personId && p.year === year);
  if (!prof) return null;
  const bonuses = inp.bonuses.filter((b) => b.personId === personId && b.year === year).map((b) => ({ month: b.month, grossCents: b.grossCents, label: b.label }));
  const sc = { ...scenarioFromProfile(prof, 'Current setup'), bonuses };
  return runScenario(sc, inp);
}

export interface Line {
  label: string;
  cents: number;
  kind: 'gross' | 'deduction' | 'tax' | 'net';
  /** Deductions: also taken from the full year, for the second column. */
  yearCents?: number;
}

/** Gross-to-net lines for one paycheck, with the year's totals alongside. */
export function paycheckLines(r: ScenarioResult, e: PayEvent): Line[] {
  const y = r.year;
  const lines: Line[] = [{ label: e.kind === 'regular' ? 'Gross pay' : `Gross pay (${e.label})`, cents: e.gross, kind: 'gross', yearCents: y.totals.gross }];
  for (const d of r.scenario.profile.deductions) {
    lines.push({ label: d.name, cents: -(e.deductions[d.id] ?? 0), kind: 'deduction', yearCents: -(y.totals.deductions[d.id] ?? 0) });
  }
  lines.push(
    { label: 'Federal income tax withheld', cents: -e.fedWithholding, kind: 'tax', yearCents: -y.totals.fedWithholding },
    { label: 'Social Security', cents: -e.socialSecurity, kind: 'tax', yearCents: -y.totals.socialSecurity },
    { label: 'Medicare', cents: -e.medicare, kind: 'tax', yearCents: -y.totals.medicare },
  );
  if (e.addlMedicare > 0 || y.totals.addlMedicare > 0) lines.push({ label: 'Additional Medicare', cents: -e.addlMedicare, kind: 'tax', yearCents: -y.totals.addlMedicare });
  lines.push(
    { label: 'MA income tax withheld', cents: -e.stateWithholding, kind: 'tax', yearCents: -y.totals.stateWithholding },
    { label: 'MA paid family & medical leave', cents: -e.pfml, kind: 'tax', yearCents: -y.totals.pfml },
    { label: 'Take-home pay', cents: e.net, kind: 'net', yearCents: y.totals.net },
  );
  return lines;
}

export interface Headline {
  label: string;
  firstNet: number;
  annualGross: number;
  annualNet: number;
  monthlyNet: number;
  withheld: number;
  deductionsTotal: number;
  fedBalance: number | null;
  maBalance: number | null;
  k401: number;
  employerMatch: number;
  ssCapDate: string | null;
  k401LimitDate: string | null;
}

export function headline(r: ScenarioResult, label = r.scenario.name): Headline {
  const t = r.year.totals;
  const ded = Object.values(t.deductions).reduce((a, b) => a + b, 0);
  return {
    label,
    firstNet: r.firstCheck?.net ?? 0,
    annualGross: t.gross,
    annualNet: t.net,
    monthlyNet: Math.round(t.net / 12),
    withheld: t.fedWithholding + t.stateWithholding + t.socialSecurity + t.medicare + t.addlMedicare + t.pfml,
    deductionsTotal: ded,
    fedBalance: r.household?.federal.balance ?? null,
    maBalance: r.household?.ma.balance ?? null,
    k401: r.year.contributions.k401Pretax + r.year.contributions.k401Roth,
    employerMatch: r.year.contributions.employerMatch,
    ssCapDate: r.year.milestones.ssCapDate,
    k401LimitDate: r.year.milestones.k401LimitDate,
  };
}
