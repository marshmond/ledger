import type { DeductionType, IncomeProfile } from '../types';
import type { PersonYear } from '../lib/payroll';
import { personSummary } from './incomeOwners';

/**
 * D18.2 Gross-to-net statement for each person on the Income page.
 *
 * This file is presentation only. It READS the income model's own totals (`PersonYear`) and lays them out in one fixed set of columns that is the same for
 * every person, so two people can be compared position by position. It never calculates tax, never changes a stored record, and never adds a balancing
 * figure: when the lines cannot be reconciled with the model's cash figure, the difference is reported, not hidden.
 *
 * Three states of a cell, kept apart on purpose:
 *   value        the person has this item and the model's amount is shown (a genuine $0.00 is a value)
 *   blank        the person simply has no such item (no bonus record, no HSA deduction): shown as empty space, never as $0
 *   unavailable  the model produced no figures for this person (no setup, or no tax tables)
 */

export type ColumnGroup = 'income' | 'deductions' | 'taxes' | 'net' | 'employer';
export type ColumnId =
  | 'wages' | 'bonus' | 'rsu' | 'otherEarnings' | 'gross'
  | 'ded.k401Pretax' | 'ded.k401Roth' | 'ded.hsa' | 'ded.fsa' | 'ded.insurance' | 'ded.espp' | 'ded.other' | 'deductions'
  | 'tax.fed' | 'tax.state' | 'tax.ss' | 'tax.medicare' | 'tax.addlMedicare' | 'tax.pfml' | 'taxes'
  | 'net' | 'kept'
  | 'er.k401' | 'er.hsa';

export interface StatementColumn {
  id: ColumnId;
  group: ColumnGroup;
  label: string;
  /** A subtotal or outcome (drawn heavier), as opposed to a detail line. */
  total?: boolean;
  /** One line of plain words about what the column is (read by assistive technology and shown as a hint where there is room). */
  help?: string;
}

/** A deduction slot is chosen from the stored deduction TYPE, never from its label. An unknown or custom type goes to "Other deductions". */
export const DEDUCTION_SLOT_BY_TYPE: Record<DeductionType, ColumnId> = {
  k401_pretax: 'ded.k401Pretax',
  k401_roth: 'ded.k401Roth',
  hsa: 'ded.hsa',
  fsa: 'ded.fsa',
  health: 'ded.insurance',
  dental: 'ded.insurance',
  vision: 'ded.insurance',
  espp: 'ded.espp',
  custom: 'ded.other',
};

export const deductionSlotFor = (type: DeductionType): ColumnId => DEDUCTION_SLOT_BY_TYPE[type] ?? 'ded.other';

const BASE_COLUMNS: StatementColumn[] = [
  { id: 'wages', group: 'income', label: 'Regular wages' },
  { id: 'bonus', group: 'income', label: 'Bonuses' },
  { id: 'rsu', group: 'income', label: 'Vested stock awards', help: 'Counted when they vest' },
  { id: 'gross', group: 'income', label: 'Gross compensation', total: true },
  { id: 'ded.k401Pretax', group: 'deductions', label: 'Traditional 401(k)' },
  { id: 'ded.k401Roth', group: 'deductions', label: 'Roth 401(k)' },
  { id: 'ded.hsa', group: 'deductions', label: 'HSA' },
  { id: 'ded.fsa', group: 'deductions', label: 'Health care FSA' },
  { id: 'ded.insurance', group: 'deductions', label: 'Insurance premiums', help: 'Health, dental and vision' },
  { id: 'ded.espp', group: 'deductions', label: 'ESPP' },
  { id: 'ded.other', group: 'deductions', label: 'Other deductions' },
  { id: 'deductions', group: 'deductions', label: 'Employee deductions', total: true },
  { id: 'tax.fed', group: 'taxes', label: 'Federal income tax' },
  { id: 'tax.state', group: 'taxes', label: 'Massachusetts income tax' },
  { id: 'tax.ss', group: 'taxes', label: 'Social Security' },
  { id: 'tax.medicare', group: 'taxes', label: 'Medicare' },
  { id: 'tax.addlMedicare', group: 'taxes', label: 'Additional Medicare' },
  { id: 'tax.pfml', group: 'taxes', label: 'Massachusetts PFML' },
  { id: 'taxes', group: 'taxes', label: 'Taxes withheld', total: true },
  { id: 'net', group: 'net', label: 'Cash take-home', total: true },
  { id: 'kept', group: 'net', label: 'Equity kept as shares', help: 'Not cash' },
  { id: 'er.k401', group: 'employer', label: 'Employer 401(k) contribution' },
  { id: 'er.hsa', group: 'employer', label: 'Employer HSA contribution' },
];

const OTHER_EARNINGS: StatementColumn = { id: 'otherEarnings', group: 'income', label: 'Other modeled earnings', help: 'Earnings the model counts in gross pay that are not wages, bonuses or stock awards' };

export interface StatementSchema {
  /** Every column, in display order. The same list is used for every person. */
  columns: StatementColumn[];
  byGroup: Record<ColumnGroup, StatementColumn[]>;
  /** Detail columns only (no subtotals), per group. */
  detail: Record<ColumnGroup, StatementColumn[]>;
  index: Record<ColumnId, number>;
}

function assemble(columns: StatementColumn[]): StatementSchema {
  const groups: ColumnGroup[] = ['income', 'deductions', 'taxes', 'net', 'employer'];
  const byGroup = Object.fromEntries(groups.map((g) => [g, columns.filter((c) => c.group === g)])) as Record<ColumnGroup, StatementColumn[]>;
  const detail = Object.fromEntries(groups.map((g) => [g, byGroup[g].filter((c) => !c.total)])) as Record<ColumnGroup, StatementColumn[]>;
  const index = Object.fromEntries(columns.map((c, i) => [c.id, i])) as Record<ColumnId, number>;
  return { columns, byGroup, detail, index };
}

/**
 * The one column layout for a household and year. It does not depend on who has what: every standard category is always present, in this order.
 * The only way the list grows is a category the model actually produces for someone (today only "Other modeled earnings", if gross pay ever contains
 * something that is not a wage, bonus or stock award). Then the extra column appears in the same position for everyone.
 */
export function buildStatementSchema(years: PersonYear[]): StatementSchema {
  const withOther = years.some((y) => otherEarningsOf(y) !== 0);
  if (!withOther) return assemble(BASE_COLUMNS);
  const at = BASE_COLUMNS.findIndex((c) => c.id === 'gross');
  return assemble([...BASE_COLUMNS.slice(0, at), OTHER_EARNINGS, ...BASE_COLUMNS.slice(at)]);
}

export type StatementCell =
  | { state: 'value'; cents: number }
  | { state: 'blank' }
  | { state: 'unavailable' };

export interface StatementReconciliation {
  /** Gross − employee deductions − taxes withheld − cash − equity kept. Zero when the lines explain the model's cash figure exactly. */
  difference: number;
  /** Paychecks where deductions and taxes were more than the pay (the model counts these as negative cash). */
  negativePaychecks: number;
  /** Gross − wages − bonuses − stock awards. Zero unless the model counts some other earning. */
  otherEarnings: number;
  /** Sum of the deduction columns minus the model's own deduction total. Zero unless a deduction could not be placed. */
  deductionPlacementGap: number;
}

export type StatementStatus = 'ready' | 'not-set-up' | 'not-calculated';

export interface PersonStatement {
  personId: number;
  status: StatementStatus;
  /** Plain-words reason when the status is not ready. */
  reason?: string;
  cells: Record<ColumnId, StatementCell>;
  reconciliation: StatementReconciliation;
}

const sumDeductions = (py: PersonYear) => py.events.reduce((a, e) => a + Object.values(e.deductions).reduce((x, y) => x + y, 0), 0);
function otherEarningsOf(py: PersonYear): number {
  const wages = py.events.reduce((a, e) => a + (e.kind === 'regular' ? e.gross : 0), 0);
  return py.totals.gross - wages - py.totals.bonusGross - py.totals.rsuGross;
}

const NO_RECON: StatementReconciliation = { difference: 0, negativePaychecks: 0, otherEarnings: 0, deductionPlacementGap: 0 };

function allCells(schema: StatementSchema, cell: StatementCell): Record<ColumnId, StatementCell> {
  return Object.fromEntries(schema.columns.map((c) => [c.id, cell])) as Record<ColumnId, StatementCell>;
}

/**
 * One person's statement in the shared schema. `py` is the income model's result for the person and year (undefined when there is none), `profile` the stored pay setup
 * (used only to know which deduction and employer items exist, so a real zero can be told from an item the person does not have).
 */
export function buildPersonStatement(
  schema: StatementSchema,
  personId: number,
  year: number,
  profile: IncomeProfile | undefined,
  py: PersonYear | undefined,
  tablesAvailable: boolean,
): PersonStatement {
  const summary = personSummary(year, profile, py, tablesAvailable);
  if (summary.state !== 'ready' || !py || !profile) {
    const reason = summary.state === 'not-calculated' ? summary.reason : `Not set up for ${year}`;
    return { personId, status: summary.state === 'ready' ? 'not-calculated' : summary.state, reason, cells: allCells(schema, { state: 'unavailable' }), reconciliation: NO_RECON };
  }

  const cells = allCells(schema, { state: 'blank' });
  const set = (id: ColumnId, cents: number) => { if (id in cells) cells[id] = { state: 'value', cents }; };
  const t = py.totals;

  // Income sources. Wages exist whenever there is a setup (a genuine $0.00 is shown); bonuses and stock awards exist only if the model has such a pay event.
  const wages = py.events.reduce((a, e) => a + (e.kind === 'regular' ? e.gross : 0), 0);
  set('wages', wages);
  if (py.events.some((e) => e.kind === 'bonus')) set('bonus', t.bonusGross);
  if (py.events.some((e) => e.kind === 'rsu')) set('rsu', t.rsuGross);
  const other = otherEarningsOf(py);
  if (other !== 0) set('otherEarnings', other);
  set('gross', t.gross);

  // Deductions: by the stored deduction type. A slot has a value when the person has at least one deduction of that kind (even if the model capped it at zero).
  const slotSum: Partial<Record<ColumnId, number>> = {};
  for (const d of profile.deductions) {
    const slot = deductionSlotFor(d.type);
    slotSum[slot] = (slotSum[slot] ?? 0) + (t.deductions[d.id] ?? 0);
  }
  let placed = 0;
  for (const [slot, cents] of Object.entries(slotSum) as [ColumnId, number][]) { set(slot, cents); placed += cents; }
  const dedTotal = sumDeductions(py);
  set('deductions', dedTotal);

  // Taxes withheld from pay (not the year's tax bill: that stays in the household results).
  set('tax.fed', t.fedWithholding);
  set('tax.state', t.stateWithholding);
  set('tax.ss', t.socialSecurity);
  set('tax.medicare', t.medicare);
  set('tax.addlMedicare', t.addlMedicare);
  set('tax.pfml', t.pfml);
  const taxTotal = t.fedWithholding + t.stateWithholding + t.socialSecurity + t.medicare + t.addlMedicare + t.pfml;
  set('taxes', taxTotal);

  // Cash and equity kept as shares (kept value is not cash and is not part of `net`).
  set('net', t.net);
  const keptEvents = py.events.filter((e) => e.keptValue !== undefined);
  const kept = keptEvents.reduce((a, e) => a + (e.keptValue ?? 0), 0);
  if (keptEvents.length > 0) set('kept', kept);

  // Employer contributions: shown on their own, never subtracted and never added to gross.
  if (profile.match) set('er.k401', t.employerMatch);
  if (profile.employerHsaAnnualCents > 0) set('er.hsa', py.contributions.employerHsa);

  return {
    personId,
    status: 'ready',
    cells,
    reconciliation: {
      difference: t.gross - dedTotal - taxTotal - t.net - kept,
      negativePaychecks: py.events.filter((e) => e.net < 0).length,
      otherEarnings: other,
      deductionPlacementGap: placed - dedTotal,
    },
  };
}

/** Everyone's statement, in the order people are listed, all drawn from the same schema. */
export function buildHouseholdStatements(
  year: number,
  people: { id?: number }[],
  profiles: IncomeProfile[],
  years: PersonYear[],
  tablesAvailable: boolean,
): { schema: StatementSchema; statements: PersonStatement[] } {
  const schema = buildStatementSchema(years);
  const statements = people.map((p) =>
    buildPersonStatement(
      schema,
      p.id!,
      year,
      profiles.find((x) => x.personId === p.id && x.year === year),
      years.find((y) => y.personId === p.id),
      tablesAvailable,
    ),
  );
  return { schema, statements };
}

/** Household row of the comparison: the sum of the people who HAVE the item; blank when nobody does, unavailable people are left out. */
export function householdCell(statements: PersonStatement[], id: ColumnId): StatementCell {
  const vals = statements.map((s) => s.cells[id]).filter((c): c is { state: 'value'; cents: number } => c.state === 'value');
  if (vals.length === 0) return statements.length > 0 && statements.every((s) => s.status !== 'ready') ? { state: 'unavailable' } : { state: 'blank' };
  return { state: 'value', cents: vals.reduce((a, c) => a + c.cents, 0) };
}
