import type { Category, Txn } from '../types';
import type { BudgetRow } from './budget';
import { prevMonth } from './dates';
import { spendingSnapshot } from './spending';

/** Numbers for the Home charts. Money is whole cents. */

export interface Slice {
  name: string;
  cents: number;
}

/** The biggest `keep` spending categories this month, with everything smaller lumped into "Other". */
export function spendingSlices(txns: Txn[], categories: Category[], month: string, keep = 5): Slice[] {
  const all = spendingSnapshot(txns, categories, month, 1000).top;
  if (all.length <= keep + 1) return all;
  const head = all.slice(0, keep);
  const other = all.slice(keep).reduce((s, t) => s + t.cents, 0);
  return [...head, { name: 'Other', cents: other }];
}

export interface MonthFlow {
  month: string;
  incomeCents: number;
  spentCents: number;
}

/** Income and spending for the `count` months ending with `month` (oldest first). */
export function monthlyFlow(txns: Txn[], categories: Category[], month: string, count = 6): MonthFlow[] {
  const months: string[] = [];
  for (let m = month, i = 0; i < count; i++, m = prevMonth(m)) months.unshift(m);
  return months.map((m) => {
    const s = spendingSnapshot(txns, categories, m, 0);
    return { month: m, incomeCents: s.incomeCents, spentCents: s.spentCents };
  });
}

export interface BudgetBar {
  name: string;
  spentCents: number;
  fundsCents: number;
  /** spent / funds; above 1 means overspent. Spending with no money set aside counts as 2 (over). */
  ratio: number;
  over: boolean;
}

/** Categories with spending or money set aside this month, most used first. Card payment lines are left out. */
export function budgetBars(rows: BudgetRow[], limit = 6): BudgetBar[] {
  return rows
    .filter((r) => r.kind === 'category')
    .map((r) => {
      const spentCents = Math.max(0, -r.activity);
      const fundsCents = Math.max(0, r.carry + r.assigned);
      return { name: r.name, spentCents, fundsCents, ratio: fundsCents > 0 ? spentCents / fundsCents : spentCents > 0 ? 2 : 0, over: r.available < 0 };
    })
    .filter((b) => b.spentCents > 0 || b.fundsCents > 0)
    .sort((a, b) => b.ratio - a.ratio || b.spentCents - a.spentCents)
    .slice(0, limit);
}
