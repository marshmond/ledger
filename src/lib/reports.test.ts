import { describe, expect, it } from 'vitest';
import { categoryCsv, categoryStats, compareTotals, jumps, lastMonths, savingsRates, spendingMatrix, topPayees } from './reports';
import type { Category, Txn } from '../types';

const $ = (n: number) => Math.round(n * 100);
let id = 1;
const t = (date: string, amt: number, categoryId: number | null, payee = 'x', extra: Partial<Txn> = {}): Txn => ({ id: id++, accountId: 1, date, amountCents: $(amt), payee, memo: '', status: 'cleared', categoryId, ...extra });
const cats: Category[] = [
  { id: 1, groupId: 1, name: 'Groceries', kind: 'expense' },
  { id: 2, groupId: 1, name: 'Dining', kind: 'expense' },
  { id: 3, groupId: 2, name: 'Paycheck', kind: 'income' },
];

describe('months', () => {
  it('lists the months ending at a month, oldest first, across a year boundary', () => {
    expect(lastMonths('2026-02', 4)).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
    expect(lastMonths('2026-10', 1)).toEqual(['2026-10']);
  });
});

describe('spending matrix', () => {
  const months = lastMonths('2026-10', 4);
  const txns = [
    t('2026-07-05', -100, 1), t('2026-08-05', -100, 1), t('2026-09-05', -100, 1), t('2026-10-05', -250, 1),
    t('2026-10-06', -40, 2), t('2026-09-06', -40, 2), t('2026-10-01', 3000, 3), t('2026-09-01', 3000, 3),
    t('2026-10-07', -500, null, 'transfer', { transferTxnId: 99 }), t('2026-06-30', -999, 1),
  ];
  const m = spendingMatrix(txns, cats, months);

  it('totals spending and income by month, leaving out transfers and months outside the range', () => {
    expect(m.spent).toEqual([$(100), $(100), $(140), $(290)]);
    expect(m.income).toEqual([0, 0, $(3000), $(3000)]);
  });
  it('lists categories biggest first', () => {
    expect(m.cats.map((c) => [c.name, c.total])).toEqual([['Groceries', $(550)], ['Dining', $(80)]]);
  });
  it('splits go to their own categories and refunds reduce spending', () => {
    const x = spendingMatrix([t('2026-10-02', -100, null, 'x', { splits: [{ categoryId: 1, amountCents: -$(60) }, { categoryId: 2, amountCents: -$(40) }] }), t('2026-10-03', 25, 1)], cats, ['2026-10']);
    expect(x.spent).toEqual([$(75)]);
    expect(x.cats.find((c) => c.name === 'Groceries')!.total).toBe($(35));
  });

  it('compares each category with the months before', () => {
    const s = categoryStats(m);
    const g = s.find((x) => x.name === 'Groceries')!;
    expect(g).toMatchObject({ thisMonth: $(250), lastMonth: $(100), avg3: $(100), avg12: $(100) });
    expect(g.vsAvg3).toBeCloseTo(1.5, 5);
    expect(s[0].name).toBe('Groceries');
  });
  it('flags categories that jumped at least 30% and $50 over their average', () => {
    expect(jumps(categoryStats(m)).map((s) => s.name)).toEqual(['Groceries']);
    const small = spendingMatrix([t('2026-09-01', -10, 1), t('2026-10-01', -30, 1)], cats, ['2026-09', '2026-10']);
    expect(jumps(categoryStats(small))).toEqual([]); // tripled, but only $20 more
  });
  it('computes the saved share of income', () => {
    expect(savingsRates(m)).toEqual([null, null, (3000 - 140) / 3000, (3000 - 290) / 3000]);
  });
  it('compares the totals', () => {
    const c = compareTotals(m);
    expect(c).toMatchObject({ thisMonth: $(290), lastMonth: $(140), sameMonthLastYear: null });
    expect(c.avg3).toBe(Math.round(($(100) + $(100) + $(140)) / 3));
    const long = spendingMatrix([t('2025-10-05', -77, 1), t('2026-10-05', -90, 1)], cats, lastMonths('2026-10', 13));
    expect(compareTotals(long).sameMonthLastYear).toBe($(77));
  });
});

describe('top payees', () => {
  it('combines similar spellings, sums spending, skips income and transfers', () => {
    const txns = [
      t('2026-10-01', -50, 1, 'Whole Foods #12'), t('2026-10-08', -70, 1, 'WHOLE FOODS #99'), t('2026-10-09', -30, 2, 'Pizza Place'),
      t('2026-10-10', 3000, 3, 'Employer'), t('2026-10-11', -400, null, 'Card payment', { transferTxnId: 5 }), t('2026-09-01', -999, 1, 'Out of range'),
    ];
    const p = topPayees(txns, cats, '2026-10-01', '2026-10-31');
    expect(p.map((x) => [x.payee, x.cents, x.count])).toEqual([['Whole Foods #12', $(120), 2], ['Pizza Place', $(30), 1]]);
  });
});

describe('CSV', () => {
  it('has a column per month, then totals, with plain dollar numbers', () => {
    const m = spendingMatrix([t('2026-09-05', -12.5, 1), t('2026-10-05', -7.25, 1), t('2026-10-06', 100, 3)], cats, ['2026-09', '2026-10']);
    const csv = categoryCsv(m).split('\r\n');
    expect(csv[0]).toBe('Category,2026-09,2026-10,Total');
    expect(csv[1]).toBe('Groceries,12.50,7.25,19.75');
    expect(csv[2]).toBe('Total spending,12.50,7.25,19.75');
    expect(csv[3]).toBe('Income,0.00,100.00,100.00');
  });
});
