import { describe, expect, it } from 'vitest';
import { TAX_2026 as T } from '../data/taxYears';
import { buildIncomeModel, newProfile } from './income';
import { buildTaxPackage, displayCell, sectionCsv, type PackageInput } from './taxPackage';
import { loanView } from './loanSchedule';
import { resolveVests } from './rsu';
import type { HsaWithdrawal, InvAccount, Loan, Person, RsuVest, Sale, Security } from '../types';

const $ = (n: number) => Math.round(n * 100);
const people: Person[] = [{ id: 1, name: 'Alex', birthYear: 1985 }];
const prof = { ...newProfile(1, 2026), salary: [{ effectiveDate: '2026-01-01', annualCents: $(150000) }], employerHsaAnnualCents: $(1000),
  deductions: [{ id: 'h', type: 'hsa' as const, name: 'HSA', mode: 'fixed' as const, value: $(100), appliesToBonus: false, fedExempt: true, ficaExempt: true, stateExempt: true }] };
const sec: Security = { id: 1, ticker: 'VTI', name: 'x', assetClassId: 1, priceCents: $(300), priceDate: null, priceSource: null };
const vests: RsuVest[] = [
  { id: 1, personId: 1, date: '2026-03-15', grant: 'Cash grant', kind: 'cash', shares: 100, priceCents: $(12.5) },
  { id: 2, personId: 1, date: '2025-03-15', grant: 'Old', kind: 'cash', shares: 1, priceCents: $(1) },
];
const resolved = resolveVests(vests, [sec]);
const model = buildIncomeModel(2026, people, [prof], [], undefined, { vests, securities: [sec] });
const sale = (over: Partial<Sale>): Sale => ({
  id: 1, accountId: 1, securityId: 1, date: '2026-06-01', shares: 15, proceedsCents: $(4500), feesCents: 0, method: 'fifo', taxable: true,
  lots: [
    { lotId: 1, shares: 10, basisCents: $(2000), acquiredDate: '2024-01-10', longTerm: true },
    { lotId: 2, shares: 5, basisCents: $(1250), acquiredDate: '2026-02-01', longTerm: false },
  ],
  basisCents: $(3250), gainCents: $(1250), shortTermCents: $(0), longTermCents: $(0), toCashCents: 0, note: '', ...over,
});
const accounts: InvAccount[] = [
  { id: 1, name: 'Brokerage', kind: 'brokerage', taxType: 'taxable', cashCents: 0, annualContributionCents: 0, contributionGrowthPct: 0, linkToIncome: false },
  { id: 2, name: 'HSA', kind: 'hsa', taxType: 'hsa', personId: 1, cashCents: 0, annualContributionCents: 0, contributionGrowthPct: 0, linkToIncome: false },
];
const hsaW: HsaWithdrawal[] = [
  { id: 1, accountId: 2, date: '2026-04-01', amountCents: $(300), qualified: true, note: 'dentist', fromCashCents: 0 },
  { id: 2, accountId: 2, date: '2026-05-01', amountCents: $(500), qualified: false, note: '', fromCashCents: 0 },
];
const loan: Loan = { id: 1, name: 'Mortgage', kind: 'mortgage', setup: 'current', balanceCents: $(200000), asOfDate: '2026-01-01', nextPaymentDate: '2026-02-01', remainingMonths: 300, annualRatePct: 6, extraMode: 'shorten' };

const input: PackageInput = {
  year: 2026, people, years: model.years, household: model.household, vests: resolved, sales: [sale({}), sale({ id: 2, date: '2025-12-30' }), sale({ id: 3, taxable: false })],
  securities: [sec], invAccounts: accounts, hsaWithdrawals: hsaW, loans: [{ loan, view: loanView(loan, [], []) }],
};
const sections = buildTaxPackage(input);
const get = (id: string) => sections.find((s) => s.id === id)!;

describe('tax package', () => {
  it('has the sections a preparer asks for', () => {
    expect(sections.map((s) => s.id)).toEqual(['wages', 'rsu', 'sales', 'hsa', 'loans', 'gifts', 'estimate']);
  });
  it('pay and withholding match the payroll projection', () => {
    const row = get('wages').rows[0];
    const y = model.years[0];
    expect(row[0]).toBe('Alex');
    expect(row[1]).toBe(y.totals.gross);
    expect(row[3]).toBe($(1250));
    expect(row[8]).toBe(y.totals.fedWithholding);
    expect(row[10]).toBe(y.totals.medicare + y.totals.addlMedicare);
  });
  it('lists only this year’s vests', () => {
    const r = get('rsu').rows;
    expect(r).toHaveLength(1);
    expect(r[0].slice(0, 4)).toEqual(['2026-03-15', 'Alex', 'Cash grant', 'Cash']);
    expect(r[0][6]).toBe($(1250));
  });
  it('lists sales one row per lot, only taxable sales in the year, with proceeds split across lots', () => {
    const rows = get('sales').rows;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual(['10 sh VTI', 'Brokerage', '2024-01-10', '2026-06-01', $(3000), $(2000), $(1000), 'Long-term']);
    expect(rows[1]).toEqual(['5 sh VTI', 'Brokerage', '2026-02-01', '2026-06-01', $(1500), $(1250), $(250), 'Short-term']);
    expect(rows.reduce((s, r) => s + (r[4] as number), 0)).toBe($(4500));
  });
  it('shows HSA contributions and withdrawals', () => {
    const rows = get('hsa').rows;
    expect(rows.map((r) => r[1])).toEqual(expect.arrayContaining(['Contributions (payroll)', 'Contributions (employer)']));
    expect(rows.some((r) => String(r[1]).includes('qualified medical') && r[2] === $(300))).toBe(true);
    expect(rows.some((r) => String(r[1]).includes('not medical') && r[2] === $(500))).toBe(true);
    expect(rows.some((r) => r[0] === 'Estimate' && r[2] === $(100))).toBe(true);
  });
  it('sums a year of loan interest and principal from the schedule', () => {
    const r = get('loans').rows[0];
    expect(r[0]).toBe('Mortgage');
    expect(r[3]).toBe(11); // first payment is in February
    expect((r[1] as number) + (r[2] as number)).toBeGreaterThan($(11 * 1200));
    expect(r[1]).toBeGreaterThan($(10000));
  });
  it('includes the estimate with refund or amount due', () => {
    const rows = get('estimate').rows;
    expect(rows).toHaveLength(5);
    expect(rows[2][1]).toBe(model.household!.federal.totalLiability);
    expect(rows[4][0]).toMatch(/refund|due/);
  });
});

describe('CSV and display', () => {
  it('writes money columns as plain dollar numbers and quotes text', () => {
    const csv = sectionCsv(get('sales'));
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('Description,Account,Date acquired,Date sold,Proceeds,Cost basis,Gain or loss,Term');
    expect(lines[1]).toBe('10 sh VTI,Brokerage,2024-01-10,2026-06-01,3000.00,2000.00,1000.00,Long-term');
    expect(csv.endsWith('\r\n')).toBe(true);
  });
  it('defuses text that spreadsheets would run as a formula', () => {
    const s = { id: 'x', title: 'x', headers: ['A', 'B'], rows: [['=SUM(A1)', 5], ['hello, "world"', 6]], moneyCols: [] };
    expect(sectionCsv(s).split('\r\n').slice(1, 3)).toEqual(["'=SUM(A1),5", '"hello, ""world""",6']);
  });
  it('formats money for the screen only in money columns', () => {
    const s = get('sales');
    expect(displayCell(s, s.rows[0], 4)).toBe('$3,000.00');
    expect(displayCell(s, s.rows[0], 0)).toBe('10 sh VTI');
    expect(T.year).toBe(2026);
  });
});
