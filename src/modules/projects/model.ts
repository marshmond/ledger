/**
 * Project records. They live in the shared `moduleRecords` table (module 'projects'), one record per fact, so backup, restore and device
 * sync already cover them and two devices editing different budget lines never overwrite each other. Two kinds so far: 'project' and
 * 'budgetLine'. (Commitments come later, as a third kind.)
 *
 * The field names `name`, `budgetCents`, `startDate`, `targetDate` (project) and `projectId`, `name`, `plannedCents` (line) are the ones
 * Finance's project layer (src/lib/txnProject.ts) already reads. Do not rename them. Money is whole cents.
 */
import type { ModuleRecord } from '../../core/entities';
import { parseAmountToCents } from '../../lib/money';

export const MODULE = 'projects';

export type ProjectStatus = 'planning' | 'active' | 'on_hold' | 'completed' | 'cancelled';
export const STATUSES: ProjectStatus[] = ['planning', 'active', 'on_hold', 'completed', 'cancelled'];
export const STATUS_LABEL: Record<ProjectStatus, string> = { planning: 'Planning', active: 'Active', on_hold: 'On hold', completed: 'Completed', cancelled: 'Cancelled' };
/** Statuses that mean the project is still going. */
export const OPEN_STATUSES: ProjectStatus[] = ['planning', 'active', 'on_hold'];

export interface ProjectData {
  name: string;
  notes: string;
  status: ProjectStatus;
  /** Local date 'YYYY-MM-DD' (no time zone). */
  startDate: string | null;
  targetDate: string | null;
  /** The overall budget in cents. null = not set, so the total of the budget lines is used. */
  budgetCents: number | null;
  /** Shared contacts (core/contacts.ts). The same contact can be on several projects. */
  vendorContactIds: number[];
  archived: boolean;
}
export interface ProjectRecord {
  id: number;
  createdAt: number;
  updatedAt: number;
  data: ProjectData;
}

export interface BudgetLineData {
  projectId: number;
  name: string;
  plannedCents: number;
  sort: number;
}
export interface BudgetLineRecord {
  id: number;
  createdAt: number;
  updatedAt: number;
  data: BudgetLineData;
}

export const str = (v: unknown, d = '') => (typeof v === 'string' ? v : d);
/** A real calendar date written YYYY-MM-DD (so 2026-02-30 is not one). */
export const isDate = (v: unknown): v is string => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
};
export const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const ids = (v: unknown): number[] => (Array.isArray(v) ? [...new Set(v.filter((x): x is number => typeof x === 'number' && Number.isFinite(x)))] : []);

/** Fields these readers understand. Anything else in a stored record (another module, a newer version) is carried through untouched. */
const PROJECT_KEYS = new Set(['name', 'notes', 'status', 'startDate', 'targetDate', 'budgetCents', 'vendorContactIds', 'archived']);
const LINE_KEYS = new Set(['projectId', 'name', 'plannedCents', 'sort']);
export const extras = (d: object, known: Set<string>) => Object.fromEntries(Object.entries(d).filter(([k, v]) => !known.has(k) && v !== undefined)) as object;

/** Reads a stored record defensively, so a record from another device or version can never crash a screen. */
export function asProject(r: ModuleRecord): ProjectRecord {
  const d = (r.data ?? {}) as Record<string, unknown>;
  return {
    id: r.id as number,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    data: {
      ...extras(d, PROJECT_KEYS),
      name: str(d.name).trim() || 'Untitled project',
      notes: str(d.notes),
      status: STATUSES.includes(d.status as ProjectStatus) ? (d.status as ProjectStatus) : 'planning',
      startDate: isDate(d.startDate) ? d.startDate : null,
      targetDate: isDate(d.targetDate) ? d.targetDate : null,
      budgetCents: finite(d.budgetCents) ? Math.round(d.budgetCents) : null,
      vendorContactIds: ids(d.vendorContactIds),
      archived: d.archived === true,
    },
  };
}

export function asBudgetLine(r: ModuleRecord): BudgetLineRecord {
  const d = (r.data ?? {}) as Record<string, unknown>;
  return {
    id: r.id as number,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    data: {
      ...extras(d, LINE_KEYS),
      projectId: finite(d.projectId) ? d.projectId : -1,
      name: str(d.name).trim() || 'Budget line',
      plannedCents: finite(d.plannedCents) ? Math.round(d.plannedCents) : 0,
      sort: finite(d.sort) ? d.sort : 0,
    },
  };
}

export const blankProject = (over: Partial<ProjectData> = {}): ProjectData => ({
  name: '', notes: '', status: 'planning', startDate: null, targetDate: null, budgetCents: null, vendorContactIds: [], archived: false, ...over,
});

/** Lines in the order the owner put them (ties, from two devices adding at once, fall back to creation order). */
export const sortLines = (lines: BudgetLineRecord[]): BudgetLineRecord[] =>
  [...lines].sort((a, b) => a.data.sort - b.data.sort || a.createdAt - b.createdAt || a.id - b.id);

// ---- checking what was typed ----

export interface ProjectInput {
  name: string;
  startDate: string;
  targetDate: string;
  /** Text as typed; blank = use the budget lines. */
  budget: string;
}

/** The plain-words problem with a project form, or null. */
export function validateProject(i: ProjectInput): string | null {
  if (!i.name.trim()) return 'Give the project a name.';
  if (i.name.trim().length > 120) return 'That name is too long.';
  if (i.startDate && !isDate(i.startDate)) return 'The start date is not a real date.';
  if (i.targetDate && !isDate(i.targetDate)) return 'The target date is not a real date.';
  if (i.startDate && i.targetDate && i.targetDate < i.startDate) return 'The target date is before the start date.';
  if (i.budget.trim()) {
    const c = parseAmountToCents(i.budget);
    if (c === null) return 'The budget is not an amount.';
    if (c < 0) return 'The budget cannot be negative.';
  }
  return null;
}

/** Blank budget text means "not set" (null); otherwise whole cents. Call after `validateProject`. */
export const budgetFromText = (text: string): number | null => (text.trim() ? parseAmountToCents(text) : null);

/** The plain-words problem with a budget line form, or null. */
export function validateLine(name: string, amount: string): string | null {
  if (!name.trim()) return 'Give the line a name.';
  if (name.trim().length > 120) return 'That name is too long.';
  const c = parseAmountToCents(amount.trim() === '' ? '0' : amount);
  if (c === null) return 'The planned amount is not an amount.';
  if (c < 0) return 'The planned amount cannot be negative.';
  return null;
}

// ---- budget against lines ----

export type BudgetState = 'derived' | 'balanced' | 'under' | 'over';
export interface BudgetSummary {
  /** The lines added up. */
  plannedTotalCents: number;
  /** The overall budget in use: the one set on the project, or the lines' total when none is set. */
  budgetCents: number;
  /** True when no overall budget is set, so `budgetCents` is the lines' total. */
  derived: boolean;
  /** Overall budget minus lines. Positive = money not yet planned; negative = the lines add up to more than the budget. Zero when derived. */
  notYetPlannedCents: number;
  /** derived = no budget set; balanced = lines match it; under = some of it is unplanned; over = lines exceed it. */
  state: BudgetState;
}

export function budgetSummary(budgetCents: number | null, lines: BudgetLineRecord[]): BudgetSummary {
  const plannedTotalCents = lines.reduce((s, l) => s + l.data.plannedCents, 0);
  if (budgetCents === null) return { plannedTotalCents, budgetCents: plannedTotalCents, derived: true, notYetPlannedCents: 0, state: 'derived' };
  const diff = budgetCents - plannedTotalCents;
  return { plannedTotalCents, budgetCents, derived: false, notYetPlannedCents: diff, state: diff === 0 ? 'balanced' : diff > 0 ? 'under' : 'over' };
}
