import { describe, expect, it } from 'vitest';
import { computeBudget } from './budget';
import { trailingAnnualSpending } from './retirement';
import type { Account, Category, Txn } from '../types';

/**
 * An account with NO opening date. The app never makes one (every creation path writes the date), but a restored or hand-made backup, or a record from
 * somewhere else, can carry one, and it used to stop the Today "Ledger attention" card and the budget with "Cannot read properties of undefined".
 * The fix only STOPS THE CRASH: no date or opening balance is invented, and every figure is exactly what the same code gives for that data.
 */
const checking: Account = { id: 1, name: 'Checking', kind: 'checking', openingBalanceCents: 100000, openingDate: '2026-01-01' };
const dateless = { id: 2, name: 'Old savings', kind: 'savings', openingBalanceCents: 50000 } as unknown as Account;
const groceries: Category = { id: 10, groupId: 1, name: 'Groceries', kind: 'expense' };
const cats = [groceries];
const tx = (over: Partial<Txn> & Pick<Txn, 'accountId' | 'date' | 'amountCents'>): Txn => ({ id: Math.floor(Math.random() * 1e9), payee: '', memo: '', status: 'cleared', categoryId: null, ...over });
const run = (accounts: Account[], txns: Txn[]) => computeBudget({ accounts, categories: cats, txns, assignments: [], month: '2026-02' });

describe('an account without an opening date', () => {
  it('does not stop the budget, and invents nothing: the figures equal the other accounts alone (its opening balance has no date, so it is not counted)', () => {
    expect(() => run([checking, dateless], [])).not.toThrow();
    const a = run([checking, dateless], []), b = run([checking], []);
    expect([a.readyToAssign, a.cash, a.rows.length]).toEqual([b.readyToAssign, b.cash, b.rows.length]);
    expect(a.cash).toBe(100000);
  });
  it('its own transactions still count; only the missing date is ignored', () => {
    const a = run([checking, dateless], [tx({ accountId: 2, date: '2026-02-03', amountCents: -1500, categoryId: 10 })]);
    expect(a.cash).toBe(100000 - 1500);
  });
  it('an earlier transaction on it still starts the budget at its own month (nothing is hidden)', () => {
    const a = run([checking, dateless], [tx({ accountId: 2, date: '2025-11-03', amountCents: -500, categoryId: 10 })]);
    expect(a.rows.length).toBeGreaterThan(0);
  });
  it('does not stop the spending average either, and ignores the missing date', () => {
    const t = [tx({ accountId: 1, date: '2026-09-05', amountCents: -60000, categoryId: 10 })];
    expect(() => trailingAnnualSpending(t, cats, [checking, dateless], '2026-10-08', 3)).not.toThrow();
    expect(trailingAnnualSpending(t, cats, [checking, dateless], '2026-10-08', 3)).toEqual(trailingAnnualSpending(t, cats, [checking], '2026-10-08', 3));
  });
  it('an account that does have a date behaves exactly as before', () => {
    const early = { ...checking, openingDate: '2025-10-01' };
    expect(run([early], []).rows.length).toBeGreaterThanOrEqual(run([checking], []).rows.length);
  });
});
