import { describe, expect, it } from 'vitest';
import { DEFAULT_GUIDE, FIRST_STEPS, guideItems, itemKey } from './guide';
import type { Account, InvAccount, Loan, Person } from '../types';

const $ = (n: number) => Math.round(n * 100);
const acct = (id: number, kind: Account['kind'], extra: Partial<Account> = {}): Account => ({ id, name: `A${id}`, kind, openingBalanceCents: 0, openingDate: '2026-01-01', ...extra });
const inv = (id: number, kind: InvAccount['kind'], extra: Partial<InvAccount> = {}): InvAccount => ({ id, name: `I${id}`, kind, taxType: 'taxable', cashCents: 0, annualContributionCents: 0, contributionGrowthPct: 0, linkToIncome: false, ...extra });
const loan = (id: number, kind: Loan['kind'], extra: Partial<Loan> = {}): Loan => ({ id, name: `L${id}`, kind, setup: 'current', annualRatePct: 6, extraMode: 'shorten', ...extra });
const people: Person[] = [{ id: 1, name: 'Alex' }];

describe('guide items', () => {
  const items = guideItems({
    accounts: [acct(1, 'checking'), acct(2, 'credit_card'), acct(3, 'savings', { closed: true })],
    invAccounts: [inv(1, 'ira', { personId: 1 }), inv(2, 'brokerage'), inv(3, '401k', { closed: true })],
    invValue: () => $(1000),
    loans: [loan(1, 'mortgage'), loan(2, 'heloc', { scenario: true })],
    loanOwed: () => $(200000),
    properties: [{ id: 1, name: 'House', kind: 'home', loanIds: [] }, { id: 2, name: 'Sold car', kind: 'vehicle', loanIds: [], excluded: true }],
    propertyValue: () => $(450000),
    people,
    balance: (a) => (a.kind === 'credit_card' ? -$(300) : $(2500)),
  });
  it('lists open accounts, accounts with owners, real loans, and counted property', () => {
    expect(items.map((i) => i.key)).toEqual(['bank-1', 'card-2', 'investment-1', 'investment-2', 'loan-1', 'property-1']);
  });
  it('describes each one with its type and owner, and signs the balances', () => {
    const by = Object.fromEntries(items.map((i) => [i.key, i]));
    expect(by['investment-1'].detail).toBe('IRA, Alex');
    expect(by['investment-2'].detail).toBe('Brokerage');
    expect(by['loan-1']).toMatchObject({ detail: 'Mortgage', balanceCents: -$(200000) });
    expect(by['card-2'].balanceCents).toBe(-$(300));
    expect(by['property-1']).toMatchObject({ detail: 'Home', balanceCents: $(450000) });
  });
  it('item keys are stable', () => {
    expect(itemKey('bank', 7)).toBe('bank-7');
  });
});

describe('defaults', () => {
  it('start with the usual documents to locate, and balances hidden', () => {
    expect(DEFAULT_GUIDE.docs.length).toBeGreaterThanOrEqual(8);
    expect(DEFAULT_GUIDE.docs.every((d) => d.where === '')).toBe(true);
    expect(new Set(DEFAULT_GUIDE.docs.map((d) => d.id)).size).toBe(DEFAULT_GUIDE.docs.length);
    expect(DEFAULT_GUIDE.showBalances).toBe(false);
    expect(FIRST_STEPS.length).toBeGreaterThanOrEqual(8);
  });
});
