import type { Category, Txn } from '../types';
import { allocations } from './ledger';
import { normPayee } from './rules';
import { addMonths } from './dates';

/**
 * Spending reports from the ledger: month-by-month totals, category trends, where spending jumped, and top payees.
 * Transfers are left out (they move money, they do not spend it). Refunds reduce spending. Money in cents.
 */

/** The `n` months ending at `endMonth` (YYYY-MM), oldest first. */
export function lastMonths(endMonth: string, n: number): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(addMonths(`${endMonth}-01`, -i).slice(0, 7));
  return out;
}

export interface CategoryRow {
  name: string;
  /** Spending per month, aligned with `months`. */
  byMonth: number[];
  total: number;
}

export interface Matrix {
  months: string[];
  cats: CategoryRow[];
  spent: number[];
  income: number[];
}

export function spendingMatrix(txns: Txn[], categories: Category[], months: string[]): Matrix {
  const catById = new Map(categories.map((c) => [c.id!, c]));
  const idx = new Map(months.map((m, i) => [m, i]));
  const rows = new Map<string, number[]>();
  const spent = months.map(() => 0);
  const income = months.map(() => 0);
  for (const t of txns) {
    const i = idx.get(t.date.slice(0, 7));
    if (i === undefined || t.transferTxnId) continue;
    for (const s of allocations(t)) {
      const cat = s.categoryId == null ? undefined : catById.get(s.categoryId);
      if (cat?.kind === 'income' || (!cat && s.amountCents > 0)) {
        income[i] += s.amountCents;
        continue;
      }
      const name = cat?.name ?? 'Uncategorized';
      const row = rows.get(name) ?? months.map(() => 0);
      row[i] -= s.amountCents;
      rows.set(name, row);
      spent[i] -= s.amountCents;
    }
  }
  const cats = [...rows.entries()].map(([name, byMonth]) => ({ name, byMonth, total: byMonth.reduce((a, b) => a + b, 0) })).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  return { months, cats, spent: spent.map((v) => Math.max(0, v)), income };
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export interface CategoryStat {
  name: string;
  thisMonth: number;
  lastMonth: number;
  avg3: number;
  avg12: number;
  /** This month against the 3-month average before it, as a fraction (0.4 = 40% more). Null when there is no average. */
  vsAvg3: number | null;
}

/** For the last month in the matrix: how each category compares with the months before it. */
export function categoryStats(m: Matrix): CategoryStat[] {
  const n = m.months.length;
  return m.cats
    .map((c) => {
      const prior3 = c.byMonth.slice(Math.max(0, n - 4), n - 1);
      const prior = c.byMonth.slice(0, n - 1);
      const a3 = avg(prior3);
      return {
        name: c.name,
        thisMonth: c.byMonth[n - 1] ?? 0,
        lastMonth: c.byMonth[n - 2] ?? 0,
        avg3: Math.round(a3),
        avg12: Math.round(avg(prior)),
        vsAvg3: a3 > 0 ? (c.byMonth[n - 1] - a3) / a3 : null,
      };
    })
    .sort((a, b) => b.thisMonth - a.thisMonth || a.name.localeCompare(b.name));
}

/** Categories that jumped: at least 30% and $50 above their recent average. */
export function jumps(stats: CategoryStat[]): CategoryStat[] {
  return stats.filter((s) => s.vsAvg3 !== null && s.vsAvg3 >= 0.3 && s.thisMonth - s.avg3 >= 5000).sort((a, b) => b.thisMonth - b.avg3 - (a.thisMonth - a.avg3));
}

/** Saved share of income each month, as a fraction. Null where there was no income. */
export const savingsRates = (m: Matrix): (number | null)[] => m.income.map((inc, i) => (inc > 0 ? (inc - m.spent[i]) / inc : null));

export interface PayeeTotal {
  payee: string;
  cents: number;
  count: number;
}

/** The payees you spent the most with between two dates (inclusive). Similar spellings are combined. */
export function topPayees(txns: Txn[], categories: Category[], from: string, to: string, n = 10): PayeeTotal[] {
  const income = new Set(categories.filter((c) => c.kind === 'income').map((c) => c.id!));
  const groups = new Map<string, PayeeTotal>();
  for (const t of txns) {
    if (t.transferTxnId || t.date < from || t.date > to || t.amountCents >= 0) continue;
    if (t.categoryId != null && income.has(t.categoryId)) continue;
    const key = normPayee(t.payee) || '(no payee)';
    const g = groups.get(key) ?? { payee: t.payee.trim() || '(no payee)', cents: 0, count: 0 };
    g.cents -= t.amountCents;
    g.count++;
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => b.cents - a.cents || a.payee.localeCompare(b.payee)).slice(0, n);
}

export interface Comparison {
  thisMonth: number;
  lastMonth: number;
  sameMonthLastYear: number | null;
  avg3: number;
}

/** Total spending in the last month of the matrix against last month, the same month a year earlier, and the 3-month average. */
export function compareTotals(m: Matrix): Comparison {
  const n = m.months.length;
  return {
    thisMonth: m.spent[n - 1] ?? 0,
    lastMonth: m.spent[n - 2] ?? 0,
    sameMonthLastYear: n >= 13 ? m.spent[n - 13] : null,
    avg3: Math.round(avg(m.spent.slice(Math.max(0, n - 4), n - 1))),
  };
}

const d = (c: number) => (c / 100).toFixed(2);

/** The category table as CSV (plain dollar numbers). */
export function categoryCsv(m: Matrix): string {
  const head = ['Category', ...m.months, 'Total'];
  const q = (s: string) => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const lines = [head.map(q).join(',')];
  for (const c of m.cats) lines.push([q(c.name), ...c.byMonth.map(d), d(c.total)].join(','));
  lines.push(['Total spending', ...m.spent.map(d), d(m.spent.reduce((a, b) => a + b, 0))].join(','));
  lines.push(['Income', ...m.income.map(d), d(m.income.reduce((a, b) => a + b, 0))].join(','));
  return lines.join('\r\n') + '\r\n';
}
