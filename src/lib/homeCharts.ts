import type { Category, NetWorthSnapshot, Txn } from '../types';
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

export interface NetWorthBar {
  date: string;
  /** Short month label such as "Oct '26". */
  label: string;
  cashCents: number;
  investmentsCents: number;
  propertyCents: number;
  /** Amounts owed, as positive numbers (the bars go below the zero line). */
  cardsOwedCents: number;
  loansOwedCents: number;
  upCents: number;
  downCents: number;
  netCents: number;
  /** False for a past point entered by hand with only a total: it has a net worth dot but no bars. */
  hasParts: boolean;
}

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Saved net worth points (oldest first, the latest `limit`) shaped for the assets/liabilities chart. A negative cash, investments or property figure is left out of the bars (the net worth line still includes it). */
export function netWorthBars(snaps: NetWorthSnapshot[], limit = 24): NetWorthBar[] {
  return [...snaps]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-limit)
    .map((s) => {
      const cashCents = Math.max(0, s.cashCents);
      const investmentsCents = Math.max(0, s.investmentsCents);
      const propertyCents = Math.max(0, s.propertyCents);
      const cardsOwedCents = Math.max(0, -s.cardsCents);
      const loansOwedCents = Math.max(0, -s.loansCents);
      return {
        date: s.date,
        label: `${SHORT_MONTHS[Number(s.date.slice(5, 7)) - 1]} '${s.date.slice(2, 4)}`,
        cashCents,
        investmentsCents,
        propertyCents,
        cardsOwedCents,
        loansOwedCents,
        upCents: cashCents + investmentsCents + propertyCents,
        downCents: cardsOwedCents + loansOwedCents,
        netCents: s.totalCents,
        hasParts: s.cashCents !== 0 || s.investmentsCents !== 0 || s.propertyCents !== 0 || s.cardsCents !== 0 || s.loansCents !== 0,
      };
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
