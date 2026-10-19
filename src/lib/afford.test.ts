import { describe, expect, it } from 'vitest';
import { evaluatePurchase, loanPayment, maxAffordablePrice, rentVsBuy, type AffordInput, type RentBuyInput } from './afford';

const $ = (n: number) => Math.round(n * 100);
const house = (p: Partial<AffordInput> = {}): AffordInput => ({
  kind: 'house', priceCents: $(500000), downPaymentCents: $(100000), aprPct: 6.5, termMonths: 360, monthlyExtraCents: $(900), oneTimeCents: $(15000),
  grossMonthlyIncomeCents: $(15000), existingDebtMonthlyCents: $(500), cashCents: $(150000), monthlyEssentialCents: $(6000), monthlySavingsCents: $(4000), ...p,
});
const car = (p: Partial<AffordInput> = {}): AffordInput => ({
  kind: 'car', priceCents: $(40000), downPaymentCents: $(8000), aprPct: 7, termMonths: 60, monthlyExtraCents: $(350), oneTimeCents: $(2500),
  grossMonthlyIncomeCents: $(8000), existingDebtMonthlyCents: 0, cashCents: $(30000), monthlyEssentialCents: $(4000), monthlySavingsCents: $(1500), ...p,
});
const level = (r: ReturnType<typeof evaluatePurchase>, id: string) => r.checks.find((c) => c.id === id)?.level;

describe('loan payment', () => {
  it('matches the standard formula', () => {
    expect(loanPayment($(400000), 6.5, 360)).toBe(252827);
    expect(loanPayment($(100000), 6, 360)).toBe(59955);
    expect(loanPayment($(10000), 0, 10)).toBe($(1000));
    expect(loanPayment(0, 6, 360)).toBe(0);
  });
});

describe('a house', () => {
  it('works out the loan, payment, monthly cost, and money up front', () => {
    const r = evaluatePurchase(house());
    expect(r.loanCents).toBe($(400000));
    expect(r.paymentCents).toBe(loanPayment($(400000), 6.5, 360));
    expect(r.monthlyCostCents).toBe(r.paymentCents + $(900));
    expect(r.upfrontCents).toBe($(115000));
    expect(r.cashAfterCents).toBe($(35000));
    expect(r.costRatio).toBeCloseTo(r.monthlyCostCents / $(15000), 6);
    expect(r.dtiRatio).toBeCloseTo(($(500) + r.paymentCents + $(900)) / $(15000), 6);
  });
  it('passes the 28% and 36% rules when it fits, and warns when it does not', () => {
    const ok = evaluatePurchase(house({ priceCents: $(400000), downPaymentCents: $(100000) }));
    expect(level(ok, 'housing')).toBe('ok');
    expect(level(ok, 'dti')).toBe('ok');
    const big = evaluatePurchase(house({ priceCents: $(900000), downPaymentCents: $(100000) }));
    expect(level(big, 'housing')).toBe('warn');
    expect(level(big, 'dti')).toBe('warn');
  });
  it('flags a small down payment (mortgage insurance)', () => {
    expect(level(evaluatePurchase(house({ downPaymentCents: $(25000) })), 'pmi')).toBe('caution');
    expect(level(evaluatePurchase(house({ downPaymentCents: $(100000) })), 'pmi')).toBeUndefined();
  });
  it('flags short cash and a thin cushion', () => {
    expect(level(evaluatePurchase(house({ cashCents: $(100000) })), 'cash')).toBe('warn');
    expect(evaluatePurchase(house({ cashCents: $(100000) })).checks.find((c) => c.id === 'cash')!.title).toMatch(/short on cash/);
    expect(level(evaluatePurchase(house({ cashCents: $(125000) })), 'cash')).toBe('warn'); // 10,000 left = 1.7 months
    expect(level(evaluatePurchase(house({ cashCents: $(145000) })), 'cash')).toBe('caution'); // 30,000 left = 5 months
    expect(level(evaluatePurchase(house({ cashCents: $(300000) })), 'cash')).toBe('ok');
  });
  it('shows what saving looks like afterwards', () => {
    const r = evaluatePurchase(house({ priceCents: $(500000), monthlySavingsCents: $(1000) }));
    expect(r.savingsAfterCents).toBe($(1000) - r.monthlyCostCents);
    expect(level(r, 'saving')).toBe('warn');
    expect(level(evaluatePurchase(house({ priceCents: $(300000), downPaymentCents: $(100000), monthlySavingsCents: $(9000) })), 'saving')).toBe('ok');
  });
});

describe('a car', () => {
  it('checks total car cost against income and the loan length', () => {
    const ok = evaluatePurchase(car());
    expect(level(ok, 'carcost')).toBe('ok');
    expect(level(evaluatePurchase(car({ priceCents: $(70000), downPaymentCents: $(5000) })), 'carcost')).toBe('warn');
    expect(level(evaluatePurchase(car({ termMonths: 84 })), 'carterm')).toBe('warn');
    expect(level(ok, 'carterm')).toBeUndefined();
  });
  it('a car with no loan has no payment or debt ratio check', () => {
    const r = evaluatePurchase(car({ downPaymentCents: $(40000) }));
    expect(r.paymentCents).toBe(0);
    expect(r.checks.some((c) => c.id === 'dti')).toBe(false);
  });
});

describe('the most you can afford', () => {
  const build = (price: number) => house({ priceCents: price, downPaymentCents: Math.round(price * 0.2), oneTimeCents: Math.round(price * 0.03), monthlyExtraCents: Math.round((price * 0.0135) / 12 + $(150)) });
  it('stays inside both guidelines and just over it fails', () => {
    const m = maxAffordablePrice(build);
    expect(m.priceCents).toBeGreaterThan($(300000));
    const at = evaluatePurchase(build(m.priceCents));
    expect(at.costRatio!).toBeLessThanOrEqual(0.28);
    expect(at.dtiRatio!).toBeLessThanOrEqual(0.36);
    const over = evaluatePurchase(build(m.priceCents + $(20000)));
    expect(over.costRatio! > 0.28 || over.dtiRatio! > 0.36).toBe(true);
  });
  it('more income or less debt raises it', () => {
    const base = maxAffordablePrice(build).priceCents;
    expect(maxAffordablePrice((p) => ({ ...build(p), grossMonthlyIncomeCents: $(20000) })).priceCents).toBeGreaterThan(base);
    expect(maxAffordablePrice((p) => ({ ...build(p), existingDebtMonthlyCents: $(3000) })).priceCents).toBeLessThan(base);
  });
  it('is zero with no income', () => {
    expect(maxAffordablePrice((p) => ({ ...build(p), grossMonthlyIncomeCents: 0 })).priceCents).toBe(0);
  });
  it('a car is limited by the 15% rule', () => {
    const m = maxAffordablePrice((p) => car({ priceCents: p, downPaymentCents: Math.round(p * 0.2), oneTimeCents: 0, monthlyExtraCents: $(350) }));
    expect(m.limit).toBe('car');
    expect(evaluatePurchase(car({ priceCents: m.priceCents, downPaymentCents: Math.round(m.priceCents * 0.2), oneTimeCents: 0 })).costRatio!).toBeLessThanOrEqual(0.15);
  });
});

describe('rent or buy', () => {
  const base: RentBuyInput = {
    priceCents: $(500000), downPaymentCents: $(100000), aprPct: 6.5, termMonths: 360, closingPct: 3, sellingPct: 6, propertyTaxPct: 1.2, insuranceMonthlyCents: $(150),
    maintenancePct: 1, hoaMonthlyCents: 0, appreciationPct: 3, rentMonthlyCents: $(2800), rentGrowthPct: 3, investReturnPct: 6, years: 10,
  };
  it('makes a wealth figure for each path for every year', () => {
    const r = rentVsBuy(base);
    expect(r.years).toHaveLength(10);
    expect(r.years[0].year).toBe(1);
    expect(r.advantageCents).toBe(r.buyWealthCents - r.rentWealthCents);
    expect(r.monthlyOwnCostCents).toBeGreaterThan($(3500));
  });
  it('renting wins early because of closing and selling costs, and buying can win with time and appreciation', () => {
    const short = rentVsBuy({ ...base, years: 2 });
    expect(short.advantageCents).toBeLessThan(0);
    const long = rentVsBuy({ ...base, years: 25, appreciationPct: 4 });
    expect(long.advantageCents).toBeGreaterThan(0);
    expect(long.breakEvenYear).not.toBeNull();
    expect(long.breakEvenYear!).toBeGreaterThan(2);
  });
  it('higher rent, faster appreciation, or a lower mortgage rate all favor buying', () => {
    const a = rentVsBuy(base).advantageCents;
    expect(rentVsBuy({ ...base, rentMonthlyCents: $(4000) }).advantageCents).toBeGreaterThan(a);
    expect(rentVsBuy({ ...base, appreciationPct: 5 }).advantageCents).toBeGreaterThan(a);
    expect(rentVsBuy({ ...base, aprPct: 4.5 }).advantageCents).toBeGreaterThan(a);
    expect(rentVsBuy({ ...base, investReturnPct: 9 }).advantageCents).toBeLessThan(a);
  });
  it('with no mortgage the loan costs disappear', () => {
    const cash = rentVsBuy({ ...base, downPaymentCents: base.priceCents });
    expect(cash.monthlyOwnCostCents).toBeLessThan($(1100));
  });
});
