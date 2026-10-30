import { describe, expect, it } from 'vitest';
import { comparePayoff, extraVsInvest, refinance, simulatePayoff, type Debt } from './payoff';

const $ = (n: number) => Math.round(n * 100);
const debt = (id: string, balance: number, apr: number, min: number): Debt => ({ id, name: id, balanceCents: $(balance), aprPct: apr, minPaymentCents: $(min) });

describe('paying off one debt', () => {
  it('matches the amortization formula with only the minimum', () => {
    // $10,000 at 12% with a $332.15 payment is 36 months
    const r = simulatePayoff([debt('card', 10000, 12, 332.15)], 0, 'minimum');
    expect(r.months).toBe(36);
    expect(r.totalInterestCents).toBeGreaterThan($(1900));
    expect(r.totalInterestCents).toBeLessThan($(2000));
    expect(r.totalPaidCents).toBe($(10000) + r.totalInterestCents);
    expect(r.balances[0]).toBe($(10000));
    expect(r.balances.at(-1)).toBe(0);
  });
  it('extra money shortens it and saves interest', () => {
    const none = simulatePayoff([debt('card', 10000, 12, 332.15)], 0, 'avalanche');
    const more = simulatePayoff([debt('card', 10000, 12, 332.15)], $(200), 'avalanche');
    expect(more.months!).toBeLessThan(none.months!);
    expect(more.totalInterestCents).toBeLessThan(none.totalInterestCents);
  });
  it('never pays more than is owed on the last month', () => {
    const r = simulatePayoff([debt('a', 100, 0, 60)], 0, 'minimum');
    expect(r.months).toBe(2);
    expect(r.totalPaidCents).toBe($(100));
    expect(r.totalInterestCents).toBe(0);
  });
  it('says so when the payment never covers the interest', () => {
    const r = simulatePayoff([debt('bad', 10000, 24, 100)], 0, 'minimum');
    expect(r.months).toBeNull();
    expect(r.notCovering).toEqual(['bad']);
  });
  it('ignores a debt that is already paid off', () => {
    const r = simulatePayoff([debt('zero', 0, 20, 25)], 0, 'avalanche');
    expect(r.months).toBe(0);
    expect(r.order).toEqual([]);
  });
});

describe('several debts: avalanche and snowball', () => {
  const debts = [debt('small low', 500, 5, 25), debt('big high', 8000, 24, 200), debt('mid', 2000, 12, 50)];
  const c = comparePayoff(debts, $(300));

  it('both beat the minimum-only plan, and the avalanche never pays more interest than the snowball', () => {
    expect(c.avalanche.months!).toBeLessThan(c.minimum.months!);
    expect(c.snowball.months!).toBeLessThan(c.minimum.months!);
    expect(c.avalanche.totalInterestCents).toBeLessThanOrEqual(c.snowball.totalInterestCents);
    expect(c.savings.avalanche.interestCents).toBeGreaterThanOrEqual(c.savings.snowball.interestCents);
    expect(c.savings.avalanche.interestCents).toBe(c.minimum.totalInterestCents - c.avalanche.totalInterestCents);
  });
  it('the snowball finishes the smallest balance first and the avalanche attacks the highest rate', () => {
    expect(c.snowball.order[0].id).toBe('small low');
    expect(c.avalanche.order.map((o) => o.id)).toContain('big high');
    expect(c.avalanche.order.at(-1)!.id).not.toBe('small low'); // the cheap 5% debt waits
  });
  it('freed-up minimums roll into the next debt, so every debt ends in order with growing speed', () => {
    const months = c.snowball.order.map((o) => o.month);
    expect(months).toEqual([...months].sort((a, b) => a - b));
    expect(c.snowball.months).toBe(months.at(-1));
  });
  it('all money is accounted for: paid = original balances + interest', () => {
    for (const r of [c.minimum, c.avalanche, c.snowball]) expect(r.totalPaidCents).toBe($(10500) + r.totalInterestCents);
  });
  it('total balance falls month by month to zero', () => {
    const b = c.avalanche.balances;
    expect(b[0]).toBe($(10500));
    expect(b.at(-1)).toBe(0);
    for (let i = 1; i < b.length; i++) expect(b[i]).toBeLessThanOrEqual(b[i - 1] + 1);
  });
  it('with no extra money the three plans differ only by rolling minimums', () => {
    const z = comparePayoff(debts, 0);
    expect(z.avalanche.months!).toBeLessThanOrEqual(z.minimum.months!);
  });
});

describe('refinance', () => {
  const base = { balanceCents: $(300000), aprPct: 7, remainingMonths: 300, newAprPct: 5.5, newTermMonths: 300, closingCostsCents: $(6000), rollCosts: false };
  it('finds the new payment, the monthly savings, and the break-even', () => {
    const r = refinance(base);
    expect(r.currentPaymentCents).toBeGreaterThan($(2100));
    expect(r.currentPaymentCents).toBeLessThan($(2200));
    expect(r.newPaymentCents).toBeLessThan(r.currentPaymentCents);
    expect(r.monthlySavingsCents).toBe(r.currentPaymentCents - r.newPaymentCents);
    expect(r.breakEvenMonths).toBe(Math.ceil($(6000) / r.monthlySavingsCents));
    expect(r.lifetimeSavingsCents).toBeGreaterThan(0);
    expect(r.extendsTerm).toBe(false);
  });
  it('rolling the costs in means no break-even wait but a bigger loan', () => {
    const rolled = refinance({ ...base, rollCosts: true });
    expect(rolled.breakEvenMonths).toBe(0);
    expect(rolled.newPaymentCents).toBeGreaterThan(refinance(base).newPaymentCents);
  });
  it('a higher rate never breaks even, and a longer term is flagged', () => {
    expect(refinance({ ...base, newAprPct: 8 }).breakEvenMonths).toBeNull();
    const longer = refinance({ ...base, newTermMonths: 360 });
    expect(longer.extendsTerm).toBe(true);
    expect(longer.monthlySavingsCents).toBeGreaterThan(refinance(base).monthlySavingsCents);
    expect(longer.newInterestCents).toBeGreaterThan(refinance(base).newInterestCents);
  });
  it('a loan with no interest works', () => {
    const r = refinance({ ...base, aprPct: 0, newAprPct: 0 });
    expect(r.currentPaymentCents).toBe(Math.round($(300000) / 300));
    expect(r.currentInterestCents).toBe(0);
  });
});

describe('extra payments versus investing', () => {
  const base = { balanceCents: $(250000), aprPct: 6.5, remainingMonths: 300, extraMonthlyCents: $(500), returnPct: 7, taxDragPct: 0 };
  it('prepaying pays the loan off sooner and saves interest', () => {
    const r = extraVsInvest(base);
    expect(r.payoffMonths).toBeLessThan(300);
    expect(r.monthsSaved).toBe(300 - r.payoffMonths);
    expect(r.interestSavedCents).toBeGreaterThan($(60000));
  });
  it('a return well above the loan rate favors investing, and well below favors prepaying', () => {
    expect(extraVsInvest({ ...base, returnPct: 10 }).better).toBe('invest');
    expect(extraVsInvest({ ...base, returnPct: 3 }).better).toBe('prepay');
  });
  it('tax drag lowers the investing side', () => {
    const none = extraVsInvest(base);
    const taxed = extraVsInvest({ ...base, taxDragPct: 25 });
    expect(taxed.afterTaxReturnPct).toBeCloseTo(5.25, 5);
    expect(taxed.wealthIfInvestCents).toBeLessThan(none.wealthIfInvestCents);
    expect(taxed.wealthIfPrepayCents).toBeLessThanOrEqual(none.wealthIfPrepayCents);
  });
  it('with no extra there is nothing to compare', () => {
    const r = extraVsInvest({ ...base, extraMonthlyCents: 0 });
    expect(r.monthsSaved).toBe(0);
    expect(r.interestSavedCents).toBe(0);
    expect(r.better).toBe('even');
  });
  it('is an even call when the return equals the loan rate', () => {
    const r = extraVsInvest({ ...base, returnPct: 6.5 });
    // monthly compounding of the return is a touch below the loan's nominal rate, so prepaying is not worse
    expect(['prepay', 'even']).toContain(r.better);
  });
});

describe('a mistyped, enormous interest rate', () => {
  it('is capped instead of overflowing the math', () => {
    const r = comparePayoff([debt('card', 5000, 1e9, 100)], 0);
    expect(Number.isFinite(r.minimum.totalInterestCents)).toBe(true);
    expect(r.minimum.balances.every(Number.isFinite)).toBe(true);
    expect(simulatePayoff([debt('card', 5000, Number.NaN, 100)], 0, 'minimum').months).not.toBeNull();
  });
});
