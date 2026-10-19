import type { Donation, HsaWithdrawal, InvAccount, Loan, Person, Sale, Security } from '../types';
import type { HouseholdTax, PersonYear } from './payroll';
import type { ResolvedVest } from './rsu';
import type { LoanView } from './loanSchedule';
import { csvCell, safeText } from './txnQuery';
import { hsaYearImpact } from './hsa';
import { formatCents } from './money';

/**
 * Everything a tax preparer usually asks for, for one year, from what is already in the app: pay and withholding, RSU income,
 * sales by lot (like Form 8949), HSA activity, mortgage interest, and the app's own tax estimate. Each section is a table that can be
 * printed or saved as CSV. Official figures come from your W-2, 1099-B, 1099-SA, and 1098; this is a worksheet to check them against.
 */

export type Cell = string | number;

export interface Section {
  id: string;
  title: string;
  note?: string;
  headers: string[];
  rows: Cell[][];
  /** Columns holding cents (shown as dollars; exported as plain numbers). */
  moneyCols: number[];
}

export interface PackageInput {
  year: number;
  people: Person[];
  years: PersonYear[];
  household: HouseholdTax | null;
  vests: ResolvedVest[];
  sales: Sale[];
  securities: Security[];
  invAccounts: InvAccount[];
  hsaWithdrawals: HsaWithdrawal[];
  loans: { loan: Loan; view: LoanView }[];
  donations?: Donation[];
}

const nameOf = (people: Person[], id: number) => people.find((p) => p.id === id)?.name ?? 'Person';

export function buildTaxPackage(i: PackageInput): Section[] {
  const out: Section[] = [];

  out.push({
    id: 'wages',
    title: 'Pay and withholding (compare with each W-2)',
    note: 'Projected from the Income tab for the whole year; use W-2 amounts when you have them.',
    headers: ['Person', 'Gross pay', 'Bonuses', 'RSU income', 'Pre-tax 401(k)', 'Roth 401(k)', 'HSA (payroll)', 'Employer 401(k) match', 'Federal tax withheld', 'Social Security', 'Medicare (incl. additional)', 'MA tax withheld', 'MA PFML'],
    rows: i.years.map((y) => [
      nameOf(i.people, y.personId), y.totals.gross, y.totals.bonusGross, y.totals.rsuGross, y.contributions.k401Pretax, y.contributions.k401Roth, y.contributions.hsa,
      y.contributions.employerMatch, y.totals.fedWithholding, y.totals.socialSecurity, y.totals.medicare + y.totals.addlMedicare, y.totals.stateWithholding, y.totals.pfml,
    ]),
    moneyCols: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  });

  const vestsThisYear = i.vests.filter((v) => v.vest.date.startsWith(`${i.year}-`)).sort((a, b) => a.vest.date.localeCompare(b.vest.date));
  out.push({
    id: 'rsu',
    title: 'RSU vests',
    note: 'Cash vests are paid through payroll. Stock vests are reported on the W-2; shares you keep have the vest-date price as cost basis.',
    headers: ['Date', 'Person', 'Award', 'Type', 'Shares', 'Price per share', 'Value', 'After vest'],
    rows: vestsThisYear.map((v) => [
      v.vest.date, nameOf(i.people, v.vest.personId), v.vest.grant || '', v.vest.kind === 'cash' ? 'Cash' : `Stock ${i.securities.find((s) => s.id === v.vest.securityId)?.ticker ?? ''}`.trim(),
      v.vest.shares, v.priceCents ?? 0, v.grossCents, v.vest.kind === 'cash' ? 'Paid in cash' : v.vest.afterVest === 'held' ? 'Held' : 'Sold',
    ]),
    moneyCols: [5, 6],
  });

  const rows8949: Cell[][] = [];
  const salesThisYear = i.sales.filter((s) => s.taxable && s.date.startsWith(`${i.year}-`)).sort((a, b) => a.date.localeCompare(b.date) || (a.id ?? 0) - (b.id ?? 0));
  for (const s of salesThisYear) {
    const ticker = i.securities.find((x) => x.id === s.securityId)?.ticker ?? '?';
    const acct = i.invAccounts.find((a) => a.id === s.accountId)?.name ?? '';
    let given = 0;
    s.lots.forEach((l, idx) => {
      const proceeds = idx === s.lots.length - 1 ? s.proceedsCents - given : Math.round((s.proceedsCents * l.shares) / s.shares);
      given += proceeds;
      rows8949.push([`${Math.round(l.shares * 1e4) / 1e4} sh ${ticker}`, acct, l.acquiredDate ?? 'Various', s.date, proceeds, l.basisCents, proceeds - l.basisCents, l.longTerm ? 'Long-term' : 'Short-term']);
    });
  }
  out.push({
    id: 'sales',
    title: 'Sales of investments, by lot (like Form 8949)',
    note: 'Taxable accounts only. Sales inside IRAs, 401(k)s, Roths, HSAs, and 529s are not reported. Fees are subtracted from proceeds. Wash sales are not tracked: check your 1099-B.',
    headers: ['Description', 'Account', 'Date acquired', 'Date sold', 'Proceeds', 'Cost basis', 'Gain or loss', 'Term'],
    rows: rows8949,
    moneyCols: [4, 5, 6],
  });

  const impact = hsaYearImpact(i.hsaWithdrawals, i.invAccounts, i.people, i.year);
  const hsaRows: Cell[][] = i.years
    .filter((y) => y.contributions.hsa + y.contributions.employerHsa > 0)
    .map((y) => [nameOf(i.people, y.personId), 'Contributions (payroll)', y.contributions.hsa]);
  for (const y of i.years) if (y.contributions.employerHsa > 0) hsaRows.push([nameOf(i.people, y.personId), 'Contributions (employer)', y.contributions.employerHsa]);
  for (const w of i.hsaWithdrawals.filter((x) => x.date.startsWith(`${i.year}-`)).sort((a, b) => a.date.localeCompare(b.date))) {
    const acct = i.invAccounts.find((a) => a.id === w.accountId);
    hsaRows.push([acct?.name ?? 'HSA', `${w.date} withdrawal (${w.qualified ? 'qualified medical' : 'not medical: taxable'})${w.note ? `, ${w.note}` : ''}`, w.amountCents]);
  }
  if (impact.penaltyCents > 0) hsaRows.push(['Estimate', '20% penalty on non-qualified withdrawals', impact.penaltyCents]);
  out.push({ id: 'hsa', title: 'HSA activity (compare with Form 1099-SA and 5498-SA)', headers: ['Who or account', 'Item', 'Amount'], rows: hsaRows, moneyCols: [2] });

  const loanRows: Cell[][] = i.loans
    .filter((l) => !l.loan.scenario && l.view.schedule.rows.length > 0)
    .map((l) => {
      const rows = l.view.schedule.rows.filter((r) => r.date.startsWith(`${i.year}-`));
      return [l.loan.name, rows.reduce((a, r) => a + r.interest, 0), rows.reduce((a, r) => a + r.principal, 0), rows.length];
    })
    .filter((r) => (r[3] as number) > 0);
  out.push({
    id: 'loans',
    title: 'Mortgage and HELOC interest (compare with Form 1098)',
    note: 'From each loan’s schedule in the app (simple monthly interest). Your lender’s 1098 is the official figure; HELOC interest is only deductible when the money was used to buy, build, or improve the home.',
    headers: ['Loan', 'Interest', 'Principal', 'Payments'],
    rows: loanRows,
    moneyCols: [1, 2],
  });

  const gifts = (i.donations ?? []).filter((d) => d.date.startsWith(`${i.year}-`)).sort((a, b) => a.date.localeCompare(b.date));
  out.push({
    id: 'gifts',
    title: 'Charitable gifts (Schedule A, Form 8283)',
    note: 'Keep the charity’s written acknowledgment for any gift of $250 or more. Property over $500 in total goes on Form 8283.',
    headers: ['Date', 'Charity', 'Type', 'Value', 'Cost basis', 'Holding period', 'Receipt on file'],
    rows: gifts.map((d) => [d.date, d.charity, d.kind === 'cash' ? 'Cash' : d.kind === 'stock' ? 'Stock' : 'Other property', d.amountCents, d.basisCents ?? 0, d.kind === 'cash' ? '' : d.longTerm === false ? 'Short-term' : 'Long-term', d.receipt ? 'Yes' : 'No']),
    moneyCols: [3, 4],
  });

  const h = i.household;
  out.push({
    id: 'estimate',
    title: 'The app’s tax estimate',
    note: 'A planning estimate using the Income tab’s settings and the figures above. It is not a tax return.',
    headers: ['Item', 'Federal', 'Massachusetts'],
    rows: h
      ? [
          ['Taxable income', h.federal.taxableIncome, h.ma.taxableIncome],
          ['Tax before credits', h.federal.taxBeforeCredits + h.federal.niit + h.federal.hsaPenalty, h.ma.baseTax + h.ma.surtax],
          ['Total owed', h.federal.totalLiability, h.ma.totalLiability],
          ['Withheld', h.federal.withheld, h.ma.withheld],
          [h.federal.balance >= 0 ? 'Expected refund' : 'Expected amount due', Math.abs(h.federal.balance), Math.abs(h.ma.balance)],
        ]
      : [],
    moneyCols: [1, 2],
  });
  return out;
}

const dollars = (c: number) => (c / 100).toFixed(2);

/** A section as CSV: money columns are plain dollar numbers, and text that could run as a spreadsheet formula is neutralized. */
export function sectionCsv(s: Section): string {
  const money = new Set(s.moneyCols);
  const lines = [s.headers.map((h) => csvCell(h)).join(',')];
  for (const r of s.rows) lines.push(r.map((c, k) => (typeof c === 'number' ? (money.has(k) ? dollars(c) : String(c)) : csvCell(safeText(c)))).join(','));
  return lines.join('\r\n') + '\r\n';
}

/** A cell as text for the screen: money columns in dollars. */
export const displayCell = (s: Section, row: Cell[], k: number): string => {
  const c = row[k];
  return typeof c === 'number' && s.moneyCols.includes(k) ? formatCents(c) : String(c);
};
