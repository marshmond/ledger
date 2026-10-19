import type { BudgetTarget } from '../types';
import { addMonths } from './dates';

/**
 * Budget targets: tell each category what it needs (a set amount every month, an amount by a date, or a bill that comes every year),
 * and the budget shows how much to assign this month to be on track. Money in cents.
 */

export interface RowLike {
  /** Balance carried into the month. */
  carry: number;
  assigned: number;
  available: number;
}

export interface TargetNeed {
  target: BudgetTarget;
  /** The month the money is due (null for a monthly target). */
  dueMonth: string | null;
  /** Months left to save, counting this one and the due month (1 when due now or overdue). */
  monthsLeft: number | null;
  /** The amount to set aside each month to be on track. */
  perMonthCents: number;
  /** Still to assign this month. */
  needCents: number;
  /** Nothing more is needed this month. */
  funded: boolean;
  overdue: boolean;
  description: string;
}

/** Whole months from `from` to `to` (both 'YYYY-MM'): 0 if the same month, negative if `to` is earlier. */
export function monthsBetween(from: string, to: string): number {
  return (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + (Number(to.slice(5, 7)) - Number(from.slice(5, 7)));
}

/** The next month on or after `month` that is the given month of the year. */
export function nextDueMonth(month: string, monthOfYear: number): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const year = m <= monthOfYear ? y : y + 1;
  return `${year}-${String(monthOfYear).padStart(2, '0')}`;
}

export function targetNeed(t: BudgetTarget, row: RowLike, month: string, fmt: (c: number) => string = (c) => `$${(c / 100).toFixed(2)}`): TargetNeed {
  if (t.kind === 'monthly') {
    const need = Math.max(0, t.amountCents - row.assigned);
    return { target: t, dueMonth: null, monthsLeft: null, perMonthCents: t.amountCents, needCents: need, funded: need === 0, overdue: false, description: `${fmt(t.amountCents)} every month` };
  }
  const due = t.kind === 'yearly' ? nextDueMonth(month, t.dueMonthOfYear ?? 1) : t.dueMonth ?? month;
  const gap = monthsBetween(month, due);
  const overdue = gap < 0;
  const monthsLeft = overdue ? 1 : gap + 1;
  const remaining = Math.max(0, t.amountCents - Math.max(0, row.carry));
  const per = remaining === 0 ? 0 : Math.ceil(remaining / monthsLeft);
  const need = Math.max(0, per - row.assigned);
  return {
    target: t,
    dueMonth: due,
    monthsLeft,
    perMonthCents: per,
    needCents: need,
    funded: need === 0,
    overdue,
    description: `${fmt(t.amountCents)} ${t.kind === 'yearly' ? 'every year, next in' : 'by'} ${due}${overdue ? ' (past due)' : ''}`,
  };
}

export interface FundingPlan {
  /** What to add to each category's assignment this month (key = category id). */
  adds: { categoryId: number; addCents: number; fullyFunded: boolean }[];
  totalNeedCents: number;
  totalAddCents: number;
  /** Money still missing after spending all of Ready to Assign. */
  shortCents: number;
}

/** Funds targets with the money available: bills due soonest first, then monthly amounts, until it runs out. */
export function planFunding(needs: TargetNeed[], readyCents: number): FundingPlan {
  const open = needs.filter((n) => n.needCents > 0);
  const order = [...open].sort((a, b) => {
    const da = a.dueMonth ?? '9999-99';
    const db = b.dueMonth ?? '9999-99';
    return da.localeCompare(db) || (a.target.id ?? 0) - (b.target.id ?? 0);
  });
  let left = Math.max(0, readyCents);
  const adds: FundingPlan['adds'] = [];
  for (const n of order) {
    const add = Math.min(n.needCents, left);
    if (add > 0) adds.push({ categoryId: n.target.categoryId, addCents: add, fullyFunded: add === n.needCents });
    left -= add;
  }
  const total = open.reduce((a, n) => a + n.needCents, 0);
  const added = adds.reduce((a, x) => a + x.addCents, 0);
  return { adds, totalNeedCents: total, totalAddCents: added, shortCents: total - added };
}

export { addMonths };
