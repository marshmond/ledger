import type { Bonus, IncomeProfile, Person } from '../types';
import type { PersonYear } from '../lib/payroll';
import { monthLabel } from '../lib/dates';

export const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
export const monthName = (m: number) => monthLabel(`2026-${String(m).padStart(2, '0')}`).split(' ')[0];

/**
 * D18.1 Person-centric Income: who a compensation record belongs to, and what a person's collapsed header says.
 * Everything here is a pure helper on records that already exist. Ownership is the record's stored personId (never a name), and nothing here
 * writes, repairs, reassigns or works out money: the figures come from the income model the page already built.
 */

/** Which owner's records a component shows: one person's, or the ones whose person no longer exists, or (undefined) everyone's as before. */
export interface OwnerScope {
  personId?: number;
  /** Only records whose personId matches no person on the page (they need a decision from the owner; nothing is reassigned here). */
  unassigned?: boolean;
}

export function inScope(rowPersonId: number, scope: OwnerScope, people: Pick<Person, 'id'>[]): boolean {
  if (scope.unassigned) return !people.some((p) => p.id === rowPersonId);
  if (scope.personId !== undefined) return rowPersonId === scope.personId;
  return true;
}

export function scopeRows<T extends { personId: number }>(rows: T[], scope: OwnerScope, people: Pick<Person, 'id'>[]): T[] {
  return rows.filter((r) => inScope(r.personId, scope, people));
}

/** The bonus a person's "Add bonus" button saves: the owner comes from the workspace, never from a field the user could leave on someone else. */
export function bonusFor(personId: number, year: number, month: number, grossCents: number, label: string): Bonus {
  return { personId, year, month, grossCents, label: label.trim() || 'Bonus' };
}

/** The key the folded/open choice of one person's workspace is remembered under (by stable id, never by name or position). */
export const personCollapseId = (personId: number) => `income.person.${personId}`;
/** The page anchor of one person's workspace (the jump list goes here). */
export const personAnchorId = (personId: number) => `income-person-${personId}`;

/** First person open, the others folded, until the owner chooses otherwise (their choice is remembered per device and wins). */
export const personStartsOpen = (index: number) => index === 0;

export type PersonSummary =
  | { state: 'ready'; gross: number; net: number; bonusGross: number; rsuGross: number; warnings: number }
  | { state: 'not-set-up' }
  | { state: 'not-calculated'; reason: string };

/**
 * What the collapsed header shows for one person. Amounts are the income model's own totals for the selected year (cents); an unvested
 * award is not added to anything here, and a person with no setup is told so instead of being shown zeros.
 */
export function personSummary(year: number, profile: IncomeProfile | undefined, py: PersonYear | undefined, tablesAvailable: boolean): PersonSummary {
  if (!profile) return { state: 'not-set-up' };
  if (!py) return { state: 'not-calculated', reason: tablesAvailable ? `No ${year} estimate yet` : `No ${year} tax tables, so no estimate` };
  return { state: 'ready', gross: py.totals.gross, net: py.totals.net, bonusGross: py.totals.bonusGross, rsuGross: py.totals.rsuGross, warnings: py.warnings.length };
}
