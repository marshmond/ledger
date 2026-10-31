import { describe, expect, it } from 'vitest';
import { makeTarget, monthsBetween, nextDueMonth, nextRepeatDue, planFunding, targetNeed } from './budgetTargets';
import type { BudgetTarget } from '../types';

const $ = (n: number) => Math.round(n * 100);
const row = (carry: number, assigned: number) => ({ carry: $(carry), assigned: $(assigned), available: $(carry + assigned) });
const monthly = (amt: number, id = 1): BudgetTarget => ({ id, categoryId: id, kind: 'monthly', amountCents: $(amt) });
const byDate = (amt: number, due: string, id = 2): BudgetTarget => ({ id, categoryId: id, kind: 'by_date', amountCents: $(amt), dueMonth: due });
const yearly = (amt: number, moy: number, id = 3): BudgetTarget => ({ id, categoryId: id, kind: 'yearly', amountCents: $(amt), dueMonthOfYear: moy });

describe('month math', () => {
  it('counts months between and finds the next occurrence of a month of the year', () => {
    expect(monthsBetween('2026-10', '2026-10')).toBe(0);
    expect(monthsBetween('2026-10', '2027-03')).toBe(5);
    expect(monthsBetween('2026-10', '2026-08')).toBe(-2);
    expect(nextDueMonth('2026-10', 12)).toBe('2026-12');
    expect(nextDueMonth('2026-12', 12)).toBe('2026-12');
    expect(nextDueMonth('2026-10', 3)).toBe('2027-03');
  });
});

describe('monthly targets', () => {
  it('need whatever has not been assigned yet this month', () => {
    expect(targetNeed(monthly(200), row(0, 0), '2026-10')).toMatchObject({ needCents: $(200), perMonthCents: $(200), funded: false, dueMonth: null });
    expect(targetNeed(monthly(200), row(50, 120), '2026-10').needCents).toBe($(80));
    expect(targetNeed(monthly(200), row(0, 250), '2026-10')).toMatchObject({ needCents: 0, funded: true });
  });
});

describe('save-up-by-a-date targets', () => {
  it('spread what is still missing over the months left, counting this month and the due month', () => {
    // $1,200 by Dec; it is October: Oct, Nov, Dec = 3 months, nothing saved yet
    const n = targetNeed(byDate(1200, '2026-12'), row(0, 0), '2026-10');
    expect(n).toMatchObject({ monthsLeft: 3, perMonthCents: $(400), needCents: $(400), overdue: false, dueMonth: '2026-12' });
  });
  it('count money already set aside, and assignments already made this month', () => {
    const n = targetNeed(byDate(1200, '2026-12'), row(600, 100), '2026-10');
    expect(n.perMonthCents).toBe($(200));
    expect(n.needCents).toBe($(100));
    expect(targetNeed(byDate(1200, '2026-12'), row(1200, 0), '2026-10')).toMatchObject({ needCents: 0, funded: true, perMonthCents: 0 });
  });
  it('round up so the last cent is not missed', () => {
    const n = targetNeed(byDate(100, '2026-12'), row(0, 0), '2026-10');
    expect(n.perMonthCents * 3).toBeGreaterThanOrEqual($(100));
    expect(n.perMonthCents).toBe(3334);
  });
  it('in the due month, everything still missing is needed now; past due is the same', () => {
    expect(targetNeed(byDate(1200, '2026-10'), row(800, 0), '2026-10')).toMatchObject({ monthsLeft: 1, needCents: $(400) });
    const late = targetNeed(byDate(1200, '2026-08'), row(300, 0), '2026-10');
    expect(late).toMatchObject({ overdue: true, needCents: $(900), monthsLeft: 1 });
    expect(late.description).toMatch(/past due/);
  });
});

describe('yearly bills', () => {
  it('save toward the next time the bill comes due', () => {
    // $1,800 due in December, in October: 3 months
    const n = targetNeed(yearly(1800, 12), row(0, 0), '2026-10');
    expect(n).toMatchObject({ dueMonth: '2026-12', perMonthCents: $(600) });
    // right after it was paid (January), the next one is 12 months away
    const after = targetNeed(yearly(1800, 12), row(0, 0), '2027-01');
    expect(after).toMatchObject({ dueMonth: '2027-12', monthsLeft: 12, perMonthCents: $(150) });
    expect(n.description).toMatch(/every year, next in 2026-12/);
  });
});

describe('bills that repeat every few months', () => {
  const repeating = (amt: number, next: string, every: number, id = 4): BudgetTarget => ({ id, categoryId: id, kind: 'repeating', amountCents: $(amt), dueMonth: next, everyMonths: every });

  it('finds the next due month, counting forward from the one entered', () => {
    expect(nextRepeatDue('2026-10', '2026-12', 3)).toBe('2026-12');
    expect(nextRepeatDue('2026-12', '2026-12', 3)).toBe('2026-12');
    expect(nextRepeatDue('2027-01', '2026-12', 3)).toBe('2027-03');
    expect(nextRepeatDue('2027-03', '2026-12', 3)).toBe('2027-03');
    expect(nextRepeatDue('2027-04', '2026-12', 3)).toBe('2027-06');
    // an old date entered long ago: Feb, Aug, Feb... so after October it is next February
    expect(nextRepeatDue('2026-10', '2026-02', 6)).toBe('2027-02');
    expect(nextRepeatDue('2026-08', '2026-02', 6)).toBe('2026-08');
  });
  it('spreads a quarterly bill over the months until it is due', () => {
    // $300 due in December, it is October: Oct, Nov, Dec
    const n = targetNeed(repeating(300, '2026-12', 3), row(0, 0), '2026-10');
    expect(n).toMatchObject({ dueMonth: '2026-12', monthsLeft: 3, perMonthCents: $(100), needCents: $(100) });
    expect(n.description).toMatch(/every 3 months, next in 2026-12/);
  });
  it('rolls to the following due date once the month has passed, with no need to edit it', () => {
    const n = targetNeed(repeating(300, '2026-12', 3), row(0, 0), '2027-01');
    expect(n).toMatchObject({ dueMonth: '2027-03', monthsLeft: 3, perMonthCents: $(100) });
  });
  it('a twice-a-year bill spreads over six months, and money already set aside counts', () => {
    const fresh = targetNeed(repeating(600, '2026-12', 6), row(0, 0), '2027-01');
    expect(fresh).toMatchObject({ dueMonth: '2027-06', monthsLeft: 6, perMonthCents: $(100) });
    // March: March, April, May, June = 4 months left, $300 still missing
    expect(targetNeed(repeating(600, '2026-12', 6), row(300, 0), '2027-03')).toMatchObject({ monthsLeft: 4, perMonthCents: $(75) });
  });
  it('is described plainly for twice a year and every year', () => {
    expect(targetNeed(repeating(600, '2026-12', 6), row(0, 0), '2026-10').description).toMatch(/twice a year, next in/);
    expect(targetNeed(repeating(600, '2026-12', 12), row(0, 0), '2026-10').description).toMatch(/every year, next in/);
  });
  it('the form keeps the repeat fields only for this kind and explains what is missing', () => {
    expect(makeTarget({ categoryId: 5, kind: 'repeating', amountCents: 30000, dueMonth: '2026-12', everyMonths: 3 })).toEqual({ target: { categoryId: 5, kind: 'repeating', amountCents: 30000, dueMonth: '2026-12', everyMonths: 3 } });
    expect(makeTarget({ categoryId: 5, kind: 'repeating', amountCents: 30000, everyMonths: 3 })).toEqual({ error: 'Choose the next month the bill comes due.' });
    expect(makeTarget({ categoryId: 5, kind: 'repeating', amountCents: 30000, dueMonth: '2026-12', everyMonths: 5 })).toEqual({ error: 'Choose how often the bill comes: every 3, 6 or 12 months.' });
  });
});

describe('funding the targets', () => {
  const needs = [
    targetNeed(monthly(200, 1), row(0, 0), '2026-10'),
    targetNeed(byDate(1200, '2026-12', 2), row(0, 0), '2026-10'),
    targetNeed(yearly(1800, 11, 3), row(0, 0), '2026-10'),
    targetNeed(monthly(50, 4), row(0, 50), '2026-10'),
  ];
  it('funds everything when there is enough money', () => {
    const p = planFunding(needs, $(5000));
    expect(p.totalNeedCents).toBe($(200) + $(400) + $(900));
    expect(p.adds.map((a) => [a.categoryId, a.addCents, a.fullyFunded])).toEqual([[3, $(900), true], [2, $(400), true], [1, $(200), true]]);
    expect(p.shortCents).toBe(0);
  });
  it('runs out of money in priority order: soonest due first, then monthly', () => {
    const p = planFunding(needs, $(1000));
    expect(p.adds.map((a) => [a.categoryId, a.addCents, a.fullyFunded])).toEqual([[3, $(900), true], [2, $(100), false]]);
    expect(p.totalAddCents).toBe($(1000));
    expect(p.shortCents).toBe($(500));
  });
  it('adds nothing with no money, or when everything is funded', () => {
    expect(planFunding(needs, 0).adds).toEqual([]);
    expect(planFunding(needs, -500).totalAddCents).toBe(0);
    expect(planFunding([targetNeed(monthly(10), row(0, 10), '2026-10')], $(100)).adds).toEqual([]);
  });
});

describe('building a target from the form', () => {
  it('keeps only what the kind needs', () => {
    expect(makeTarget({ categoryId: 5, kind: 'monthly', amountCents: 240000, dueMonth: '2026-12', monthOfYear: 4 })).toEqual({ target: { categoryId: 5, kind: 'monthly', amountCents: 240000 } });
    expect(makeTarget({ categoryId: 5, kind: 'by_date', amountCents: 120000, dueMonth: '2026-12' })).toEqual({ target: { categoryId: 5, kind: 'by_date', amountCents: 120000, dueMonth: '2026-12' } });
    expect(makeTarget({ id: 9, categoryId: 5, kind: 'yearly', amountCents: 90000, monthOfYear: 4.4 })).toEqual({ target: { id: 9, categoryId: 5, kind: 'yearly', amountCents: 90000, dueMonthOfYear: 4 } });
  });
  it('says what is missing', () => {
    expect(makeTarget({ categoryId: 5, kind: 'monthly', amountCents: 0 })).toEqual({ error: 'Enter the amount.' });
    expect(makeTarget({ categoryId: 5, kind: 'monthly', amountCents: -5 })).toEqual({ error: 'Enter the amount.' });
    expect(makeTarget({ categoryId: 5, kind: 'by_date', amountCents: 100 })).toEqual({ error: 'Choose the month the money is needed by.' });
    expect(makeTarget({ categoryId: 5, kind: 'by_date', amountCents: 100, dueMonth: '2026-13' })).toEqual({ error: 'Choose the month the money is needed by.' });
    expect(makeTarget({ categoryId: 5, kind: 'yearly', amountCents: 100, monthOfYear: 13 })).toEqual({ error: 'Choose the month of the year the bill comes due.' });
    expect(makeTarget({ categoryId: 5, kind: 'yearly', amountCents: 100 })).toEqual({ error: 'Choose the month of the year the bill comes due.' });
  });
});
