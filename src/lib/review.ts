import type { NetWorthSnapshot } from '../types';
import type { HouseholdTax, PersonYear } from './payroll';
import type { Realized } from './lots';
import type { Matrix } from './reports';
import { monthLabel } from './dates';

/**
 * Year in review: what happened across your money in one calendar year, with a few plain-language highlights.
 * Pure: the page gathers the data. Money in cents.
 */

export interface ReviewInput {
  year: number;
  snapshots: NetWorthSnapshot[];
  /** Spending and income by month for the year (January to December), from the ledger. */
  matrix: Matrix;
  years: PersonYear[];
  household: HouseholdTax | null;
  realized: Realized;
  rsuGrossCents: number;
  loans: { name: string; interestCents: number; principalCents: number }[];
  hsaWithdrawals: { qualifiedCents: number; taxableCents: number };
}

export interface Review {
  year: number;
  netWorth: { startCents: number; endCents: number; changeCents: number; changePct: number | null; startDate: string; endDate: string } | null;
  pay: { grossCents: number; bonusCents: number; rsuCents: number; netCents: number };
  spending: { totalCents: number; monthlyAvgCents: number; incomeCents: number; savedCents: number; savingsRate: number | null; top: { name: string; cents: number }[]; biggestMonth: { month: string; cents: number } | null };
  retirement: { employeeCents: number; employerCents: number; hsaCents: number; totalCents: number };
  taxes: { federalCents: number; maCents: number; payrollCents: number; totalCents: number; effectiveRate: number | null; refundCents: number | null };
  investing: { shortTermCents: number; longTermCents: number; netCents: number; sales: number };
  debt: { principalCents: number; interestCents: number };
  hsa: { qualifiedCents: number; taxableCents: number };
  highlights: string[];
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export function buildReview(i: ReviewInput, fmt: (cents: number) => string): Review {
  const inYear = i.snapshots.filter((s) => s.date.startsWith(`${i.year}-`)).sort((a, b) => a.date.localeCompare(b.date));
  const before = i.snapshots.filter((s) => s.date < `${i.year}-01-01`).sort((a, b) => b.date.localeCompare(a.date))[0];
  const first = before ?? inYear[0];
  const last = inYear[inYear.length - 1];
  const netWorth =
    first && last && first.date !== last.date
      ? { startCents: first.totalCents, endCents: last.totalCents, changeCents: last.totalCents - first.totalCents, changePct: first.totalCents > 0 ? (last.totalCents - first.totalCents) / first.totalCents : null, startDate: first.date, endDate: last.date }
      : null;

  const t = (f: (y: PersonYear) => number) => sum(i.years.map(f));
  const gross = t((y) => y.totals.gross);
  const pay = { grossCents: gross - t((y) => y.totals.rsuGross), bonusCents: t((y) => y.totals.bonusGross), rsuCents: t((y) => y.totals.rsuGross) || i.rsuGrossCents, netCents: t((y) => y.totals.net) };

  const m = i.matrix;
  const spent = sum(m.spent);
  const income = sum(m.income);
  const months = m.spent.filter((v, k) => v > 0 || m.income[k] > 0).length;
  const bigIdx = m.spent.reduce((best, v, k) => (v > m.spent[best] ? k : best), 0);
  const spending = {
    totalCents: spent,
    monthlyAvgCents: months ? Math.round(spent / months) : 0,
    incomeCents: income,
    savedCents: income - spent,
    savingsRate: income > 0 ? (income - spent) / income : null,
    top: m.cats.slice(0, 5).map((c) => ({ name: c.name, cents: c.total })),
    biggestMonth: spent > 0 ? { month: m.months[bigIdx], cents: m.spent[bigIdx] } : null,
  };

  const employee = t((y) => y.contributions.k401Pretax + y.contributions.k401Roth);
  const employer = t((y) => y.contributions.employerMatch);
  const hsaC = t((y) => y.contributions.hsa + y.contributions.employerHsa);
  const retirement = { employeeCents: employee, employerCents: employer, hsaCents: hsaC, totalCents: employee + employer + hsaC };

  const h = i.household;
  const payroll = h ? h.ficaTotal + h.pfmlTotal : 0;
  const fed = h ? h.federal.totalLiability : 0;
  const ma = h ? h.ma.totalLiability : 0;
  const totalTax = fed + ma + payroll;
  const taxes = { federalCents: fed, maCents: ma, payrollCents: payroll, totalCents: totalTax, effectiveRate: gross > 0 && h ? totalTax / gross : null, refundCents: h ? h.federal.balance + h.ma.balance : null };

  const investing = { shortTermCents: i.realized.shortTermCents, longTermCents: i.realized.longTermCents, netCents: i.realized.netCents, sales: i.realized.count };
  const debt = { principalCents: sum(i.loans.map((l) => l.principalCents)), interestCents: sum(i.loans.map((l) => l.interestCents)) };

  const hl: string[] = [];
  if (netWorth) hl.push(`Your net worth ${netWorth.changeCents >= 0 ? 'grew' : 'fell'} by ${fmt(Math.abs(netWorth.changeCents))}${netWorth.changePct !== null ? ` (${Math.abs(Math.round(netWorth.changePct * 100))}%)` : ''}, from ${fmt(netWorth.startCents)} to ${fmt(netWorth.endCents)}.`);
  if (spending.savingsRate !== null) hl.push(spending.savedCents >= 0 ? `You saved ${Math.round(spending.savingsRate * 100)}% of the income in your accounts (${fmt(spending.savedCents)}).` : `You spent ${fmt(-spending.savedCents)} more than came into your accounts.`);
  if (spending.top[0]) hl.push(`${spending.top[0].name} was your biggest expense at ${fmt(spending.top[0].cents)}${spending.totalCents > 0 ? `, ${Math.round((spending.top[0].cents / spending.totalCents) * 100)}% of your spending` : ''}.`);
  if (spending.biggestMonth) hl.push(`Your highest-spending month was ${monthLabel(spending.biggestMonth.month)} (${fmt(spending.biggestMonth.cents)}).`);
  if (retirement.totalCents > 0) hl.push(`You and your employers put ${fmt(retirement.totalCents)} into retirement and health savings accounts.`);
  if (taxes.effectiveRate !== null && gross > 0) hl.push(`Taxes took about ${(taxes.effectiveRate * 100).toFixed(1)}% of your pay (${fmt(totalTax)} including Social Security and Medicare).`);
  if (investing.sales > 0) hl.push(`You realized ${fmt(investing.netCents)} of ${investing.netCents >= 0 ? 'gains' : 'losses'} on ${investing.sales} sale${investing.sales === 1 ? '' : 's'}.`);
  if (debt.principalCents > 0) hl.push(`You paid down ${fmt(debt.principalCents)} of loan principal and paid ${fmt(debt.interestCents)} in interest.`);
  if (pay.rsuCents > 0) hl.push(`Stock awards vested for ${fmt(pay.rsuCents)} before tax.`);

  return { year: i.year, netWorth, pay, spending, retirement, taxes, investing, debt, hsa: i.hsaWithdrawals, highlights: hl };
}
