import { describe, expect, it } from 'vitest';
import { searchAll, type SearchData } from './search';

const $ = (n: number) => Math.round(n * 100);
const data: SearchData = {
  accounts: [
    { id: 1, name: 'Everyday Checking', kind: 'checking', openingBalanceCents: 0, openingDate: '2026-01-01' },
    { id: 2, name: 'Visa Rewards', kind: 'credit_card', openingBalanceCents: 0, openingDate: '2026-01-01' },
  ],
  invAccounts: [{ id: 1, name: 'Fidelity Brokerage', kind: 'brokerage', taxType: 'taxable', cashCents: 0, annualContributionCents: 0, contributionGrowthPct: 0, linkToIncome: false }],
  securities: [{ id: 1, ticker: 'VTI', name: 'Vanguard Total Stock Market', assetClassId: 1, priceCents: 1, priceDate: null, priceSource: null }],
  holdings: [{ id: 1, accountId: 1, securityId: 1, shares: 1, costBasisCents: null }],
  loans: [{ id: 1, name: 'Home mortgage', kind: 'mortgage', setup: 'current', annualRatePct: 6, extraMode: 'shorten' }],
  scenarios: [],
  txns: [
    { id: 1, accountId: 1, date: '2026-09-01', amountCents: -$(45.2), payee: 'Whole Foods', memo: 'groceries', status: 'cleared', categoryId: null },
    { id: 2, accountId: 2, date: '2026-09-05', amountCents: -$(12), payee: 'Whole Foods Market', memo: '', status: 'pending', categoryId: null },
    ...Array.from({ length: 8 }, (_, i) => ({ id: 10 + i, accountId: 1, date: `2026-08-0${i + 1}`, amountCents: -$(5), payee: 'Coffee Shop', memo: '', status: 'cleared' as const, categoryId: null })),
  ],
};

describe('global search', () => {
  it('finds pages by name and by keyword', () => {
    expect(searchAll('budget', data)[0]).toMatchObject({ kind: 'page', to: '/budget' });
    expect(searchAll('mortgage', data).map((h) => h.to)).toContain('/debt');
    expect(searchAll('cost basis', data)[0]).toMatchObject({ kind: 'page', to: '/investments' });
  });
  it('finds accounts, investment accounts, holdings, and loans', () => {
    expect(searchAll('checking', data)[0]).toMatchObject({ kind: 'account', to: '/account/1' });
    expect(searchAll('fidelity', data)[0]).toMatchObject({ kind: 'investment', to: '/investments' });
    expect(searchAll('vti', data)[0]).toMatchObject({ kind: 'holding', title: 'VTI' });
    expect(searchAll('vanguard', data)[0].kind).toBe('holding');
    expect(searchAll('home', data).find((h) => h.kind === 'loan')).toBeTruthy();
  });
  it('finds transactions by payee, memo, or amount, newest first, linking to the ledger', () => {
    const r = searchAll('whole foods', data).filter((h) => h.kind === 'transaction');
    expect(r.map((h) => h.to)).toEqual(['/account/2', '/account/1']);
    expect(searchAll('groceries', data).some((h) => h.kind === 'transaction')).toBe(true);
    expect(searchAll('45.20', data).some((h) => h.kind === 'transaction' && h.title === 'Whole Foods')).toBe(true);
  });
  it('caps transaction results and offers the full list', () => {
    const r = searchAll('coffee', data, 30);
    expect(r.filter((h) => h.kind === 'transaction')).toHaveLength(6);
    const more = r.find((h) => h.kind === 'transactions')!;
    expect(more.title).toMatch(/8 matching/);
    expect(more.to).toBe('/transactions?q=coffee');
  });
  it('needs every word, ignores case, and returns nothing for blank or unknown text', () => {
    expect(searchAll('WHOLE market', data).some((h) => h.kind === 'transaction' && h.to === '/account/2')).toBe(true);
    expect(searchAll('whole nonsense', data)).toEqual([]);
    expect(searchAll('   ', data)).toEqual([]);
  });
  it('ranks a title that starts with the query above a loose match', () => {
    const r = searchAll('in', data);
    expect(r[0].title.toLowerCase().startsWith('in')).toBe(true);
  });
});
