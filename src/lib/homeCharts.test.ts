import { describe, expect, it } from 'vitest';
import type { Category, Txn } from '../types';
import type { BudgetRow } from './budget';
import { budgetBars, monthlyFlow, spendingSlices } from './homeCharts';

const cats: Category[] = [
  { id: 1, groupId: null, name: 'Pay', kind: 'income' },
  ...['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((name, i) => ({ id: 10 + i, groupId: null, name })),
];
const tx = (date: string, amountCents: number, categoryId: number | null): Txn => ({ accountId: 1, date, amountCents, payee: '', memo: '', status: 'cleared', categoryId });

describe('spendingSlices', () => {
  const txns = [tx('2026-10-02', -700, 10), tx('2026-10-03', -600, 11), tx('2026-10-04', -500, 12), tx('2026-10-05', -400, 13), tx('2026-10-06', -300, 14), tx('2026-10-07', -200, 15), tx('2026-10-08', -100, 16)];
  it('keeps the biggest and lumps the rest into Other', () => {
    const s = spendingSlices(txns, cats, '2026-10', 5);
    expect(s.map((x) => x.name)).toEqual(['A', 'B', 'C', 'D', 'E', 'Other']);
    expect(s[5].cents).toBe(300);
  });
  it('does not make an Other of a single leftover', () => {
    expect(spendingSlices(txns.slice(0, 6), cats, '2026-10', 5)).toHaveLength(6);
    expect(spendingSlices(txns.slice(0, 6), cats, '2026-10', 5)[5].name).toBe('F');
  });
});

describe('monthlyFlow', () => {
  it('returns the months oldest first across a year boundary', () => {
    const txns = [tx('2026-01-05', 5000, 1), tx('2026-01-06', -1200, 10), tx('2025-12-09', -300, 10)];
    const f = monthlyFlow(txns, cats, '2026-01', 3);
    expect(f.map((m) => m.month)).toEqual(['2025-11', '2025-12', '2026-01']);
    expect(f.map((m) => m.spentCents)).toEqual([0, 300, 1200]);
    expect(f[2].incomeCents).toBe(5000);
  });
});

describe('budgetBars', () => {
  const row = (name: string, carry: number, assigned: number, activity: number): BudgetRow => ({ key: name, kind: 'category', name, groupId: null, carry, assigned, activity, available: carry + assigned + activity });
  it('orders by how used up each category is and flags overspending', () => {
    const bars = budgetBars([row('Low', 0, 10000, -1000), row('Over', 0, 5000, -7000), row('Unset', 0, 0, -500), row('Idle', 0, 0, 0), { ...row('Pay', 0, 0, -100), kind: 'payment' }]);
    expect(bars.map((b) => b.name)).toEqual(['Unset', 'Over', 'Low']);
    expect(bars.find((b) => b.name === 'Over')).toMatchObject({ over: true, spentCents: 7000, fundsCents: 5000 });
    expect(bars.find((b) => b.name === 'Low')?.over).toBe(false);
  });
});
