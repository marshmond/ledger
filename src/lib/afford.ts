import { pmt } from './loanSchedule';

/**
 * Can I afford it? Checks a big purchase (a house, a car, anything else) against common lender and planner rules of thumb, your cash,
 * and your monthly saving, and compares renting with buying. Guidelines, not a loan approval. Money in cents.
 */

export type PurchaseKind = 'house' | 'car' | 'other';

export interface AffordInput {
  kind: PurchaseKind;
  priceCents: number;
  downPaymentCents: number;
  aprPct: number;
  termMonths: number;
  /** Other monthly costs of owning it: property tax, insurance, HOA, maintenance (house); insurance, fuel, upkeep (car). */
  monthlyExtraCents: number;
  /** One-time costs on top of the down payment: closing costs, moving, taxes, fees. */
  oneTimeCents: number;
  grossMonthlyIncomeCents: number;
  /** Monthly payments on debts you already have (loans, card minimums). */
  existingDebtMonthlyCents: number;
  /** Checking and savings you could use. */
  cashCents: number;
  /** What you spend each month on things you cannot skip. */
  monthlyEssentialCents: number;
  /** Take-home pay less your spending each month: what you save today. */
  monthlySavingsCents: number;
}

export interface Check {
  id: string;
  level: 'ok' | 'caution' | 'warn';
  title: string;
  detail: string;
}

export interface AffordResult {
  loanCents: number;
  /** Principal and interest each month. */
  paymentCents: number;
  /** Payment plus the other monthly costs. */
  monthlyCostCents: number;
  upfrontCents: number;
  /** Monthly cost as a share of gross income. */
  costRatio: number | null;
  /** All debt payments including the new ones, as a share of gross income. */
  dtiRatio: number | null;
  cashAfterCents: number;
  /** How many months of essential spending the cash left over would cover. */
  cushionMonths: number | null;
  /** What you would save each month after the purchase (negative = spending more than you earn). */
  savingsAfterCents: number;
  checks: Check[];
}

export function loanPayment(loanCents: number, aprPct: number, termMonths: number): number {
  if (loanCents <= 0 || termMonths <= 0) return 0;
  return Math.round(pmt(loanCents, aprPct / 1200, termMonths));
}

const pct = (r: number) => `${Math.round(r * 100)}%`;

export function evaluatePurchase(i: AffordInput, fmt: (c: number) => string = (c) => `$${(c / 100).toFixed(0)}`): AffordResult {
  const loan = Math.max(0, i.priceCents - i.downPaymentCents);
  const payment = loanPayment(loan, i.aprPct, i.termMonths);
  const monthly = payment + i.monthlyExtraCents;
  const upfront = i.downPaymentCents + i.oneTimeCents;
  const gross = i.grossMonthlyIncomeCents;
  const costRatio = gross > 0 ? monthly / gross : null;
  const dti = gross > 0 ? (i.existingDebtMonthlyCents + payment + (i.kind === 'house' ? i.monthlyExtraCents : 0)) / gross : null;
  const cashAfter = i.cashCents - upfront;
  const cushion = i.monthlyEssentialCents > 0 ? cashAfter / i.monthlyEssentialCents : null;
  const savingsAfter = i.monthlySavingsCents - monthly;
  const checks: Check[] = [];

  if (i.kind === 'house' && costRatio !== null) {
    checks.push(costRatio <= 0.28
      ? { id: 'housing', level: 'ok', title: `Housing cost is ${pct(costRatio)} of gross income`, detail: 'Lenders like to see 28% or less for payment, taxes, insurance, and upkeep.' }
      : { id: 'housing', level: costRatio <= 0.33 ? 'caution' : 'warn', title: `Housing cost is ${pct(costRatio)} of gross income`, detail: 'Above the usual 28% guideline, which leaves less room for everything else.' });
  }
  if (i.kind === 'car' && costRatio !== null) {
    checks.push(costRatio <= 0.15
      ? { id: 'carcost', level: 'ok', title: `Car costs are ${pct(costRatio)} of gross income`, detail: 'A common guideline is to keep total car costs under 15 to 20%.' }
      : { id: 'carcost', level: costRatio <= 0.2 ? 'caution' : 'warn', title: `Car costs are ${pct(costRatio)} of gross income`, detail: 'Above the common 15 to 20% guideline for all car costs together.' });
    if (gross > 0 && payment / gross > 0.1) checks.push({ id: 'carpay', level: 'caution', title: `The car payment alone is ${pct(payment / gross)} of gross income`, detail: 'Many planners suggest keeping the payment under 10%.' });
    if (i.termMonths > 72) checks.push({ id: 'carterm', level: 'warn', title: `A ${i.termMonths}-month loan runs long`, detail: 'Long car loans leave you owing more than the car is worth for years. 60 months or less is a common rule.' });
  }
  if (dti !== null && payment > 0) {
    checks.push(dti <= 0.36
      ? { id: 'dti', level: 'ok', title: `All debt payments would be ${pct(dti)} of gross income`, detail: 'Lenders usually want 36% or less (43% at most).' }
      : { id: 'dti', level: dti <= 0.43 ? 'caution' : 'warn', title: `All debt payments would be ${pct(dti)} of gross income`, detail: dti <= 0.43 ? 'Between 36% and 43%: lenders may approve it but it is tight.' : 'Above 43%, which many lenders will not approve.' });
  }
  if (i.kind === 'house' && loan > 0 && i.priceCents > 0 && i.downPaymentCents / i.priceCents < 0.2) {
    checks.push({ id: 'pmi', level: 'caution', title: `Down payment is ${pct(i.downPaymentCents / i.priceCents)}`, detail: 'Under 20% usually means paying private mortgage insurance (often 0.5% to 1% of the loan a year) until you reach 20% equity.' });
  }

  if (cashAfter < 0) checks.push({ id: 'cash', level: 'warn', title: `You are ${fmt(-cashAfter)} short on cash`, detail: `Up front you need ${fmt(upfront)} (down payment and one-time costs); you have ${fmt(i.cashCents)} in checking and savings.` });
  else if (cushion !== null && cushion < 3) checks.push({ id: 'cash', level: 'warn', title: `Cash left would cover only ${cushion.toFixed(1)} months`, detail: `After paying ${fmt(upfront)} up front you would have ${fmt(cashAfter)}. Keep at least 3 to 6 months of essential spending.` });
  else if (cushion !== null && cushion < 6) checks.push({ id: 'cash', level: 'caution', title: `Cash left would cover ${cushion.toFixed(1)} months`, detail: `A thinner cushion than the usual 6 months, with ${fmt(cashAfter)} left after the up-front costs.` });
  else checks.push({ id: 'cash', level: 'ok', title: `Cash left would cover ${cushion === null ? 'your' : cushion.toFixed(1)} months of essentials`, detail: `${fmt(cashAfter)} remains after the up-front costs.` });

  if (monthly > 0) {
    if (savingsAfter < 0) checks.push({ id: 'saving', level: 'warn', title: `You would spend ${fmt(-savingsAfter)} a month more than you earn`, detail: `The new ${fmt(monthly)} monthly cost is more than the ${fmt(Math.max(0, i.monthlySavingsCents))} you save now.` });
    else if (i.monthlySavingsCents > 0 && savingsAfter / i.monthlySavingsCents < 0.5) checks.push({ id: 'saving', level: 'caution', title: `Saving would drop to ${fmt(savingsAfter)} a month`, detail: `From ${fmt(i.monthlySavingsCents)} a month today.` });
    else checks.push({ id: 'saving', level: 'ok', title: `You would still save ${fmt(savingsAfter)} a month`, detail: `Down from ${fmt(Math.max(0, i.monthlySavingsCents))} today.` });
  }

  return { loanCents: loan, paymentCents: payment, monthlyCostCents: monthly, upfrontCents: upfront, costRatio, dtiRatio: dti, cashAfterCents: cashAfter, cushionMonths: cushion, savingsAfterCents: savingsAfter, checks };
}

export interface MaxPrice {
  priceCents: number;
  /** What limited it. */
  limit: 'housing' | 'dti' | 'car';
}

/**
 * The highest price that stays within the guidelines (28% housing and 36% total debt for a house; 15% total car cost for a car),
 * assuming the down payment and one-time costs scale with the price. `build` makes the input for a given price.
 */
export function maxAffordablePrice(build: (priceCents: number) => AffordInput): MaxPrice {
  const probe = build(100000);
  const ok = (price: number) => {
    const i = build(price);
    const r = evaluatePurchase(i);
    if (r.costRatio === null) return { ok: false, limit: 'housing' as const };
    if (i.kind === 'house') {
      if (r.costRatio > 0.28) return { ok: false, limit: 'housing' as const };
      if (r.dtiRatio !== null && r.dtiRatio > 0.36) return { ok: false, limit: 'dti' as const };
    } else if (i.kind === 'car') {
      if (r.costRatio > 0.15) return { ok: false, limit: 'car' as const };
      if (r.dtiRatio !== null && r.dtiRatio > 0.36) return { ok: false, limit: 'dti' as const };
    }
    return { ok: true, limit: 'housing' as const };
  };
  if (probe.grossMonthlyIncomeCents <= 0) return { priceCents: 0, limit: 'housing' };
  let lo = 0;
  let hi = 100000000000; // $1 billion
  let limit: MaxPrice['limit'] = probe.kind === 'car' ? 'car' : 'housing';
  for (let k = 0; k < 60 && hi - lo > 100; k++) {
    const mid = Math.floor((lo + hi) / 2);
    const r = ok(mid);
    if (r.ok) lo = mid;
    else {
      hi = mid;
      limit = r.limit;
    }
  }
  return { priceCents: Math.floor(lo / 10000) * 10000, limit };
}

// ---------- rent or buy ----------

export interface RentBuyInput {
  priceCents: number;
  downPaymentCents: number;
  aprPct: number;
  termMonths: number;
  closingPct: number;
  sellingPct: number;
  propertyTaxPct: number;
  insuranceMonthlyCents: number;
  maintenancePct: number;
  hoaMonthlyCents: number;
  appreciationPct: number;
  rentMonthlyCents: number;
  rentGrowthPct: number;
  /** Yearly return on investments, after tax, in percent. */
  investReturnPct: number;
  years: number;
}

export interface RentBuyYear {
  year: number;
  buyWealthCents: number;
  rentWealthCents: number;
}

export interface RentBuyResult {
  years: RentBuyYear[];
  buyWealthCents: number;
  rentWealthCents: number;
  /** Positive = buying leaves you better off. */
  advantageCents: number;
  /** The first year buying comes out ahead, or null within the horizon. */
  breakEvenYear: number | null;
  monthlyOwnCostCents: number;
  monthlyRentCents: number;
}

/**
 * Compares two paths over the same years. Buying: down payment and closing costs go into the house; each month you pay the mortgage, tax,
 * insurance, upkeep, and any HOA. Renting: you pay rent and invest the down payment and closing money. Whichever path costs less each
 * month invests the difference. At the end the house is sold (after selling costs) and everything is added up. Mortgage interest and
 * property tax deductions are not included.
 */
export function rentVsBuy(i: RentBuyInput): RentBuyResult {
  const loan = Math.max(0, i.priceCents - i.downPaymentCents);
  const r = i.aprPct / 1200;
  const pay = loan > 0 ? pmt(loan, r, i.termMonths) : 0;
  const g = Math.pow(1 + i.investReturnPct / 100, 1 / 12) - 1;
  const homeG = Math.pow(1 + i.appreciationPct / 100, 1 / 12) - 1;
  let bal = loan;
  let value = i.priceCents;
  let renter = i.downPaymentCents + (i.priceCents * i.closingPct) / 100;
  let owner = 0;
  const years: RentBuyYear[] = [];
  const months = Math.round(i.years * 12);
  let firstOwnCost = 0;

  for (let m = 1; m <= months; m++) {
    const rent = i.rentMonthlyCents * Math.pow(1 + i.rentGrowthPct / 100, Math.floor((m - 1) / 12));
    const interest = bal * r;
    const principal = bal > 0 ? Math.min(bal, pay - interest) : 0;
    bal = Math.max(0, bal - principal);
    const own = (bal > 0 || principal > 0 ? pay : 0) + (value * i.propertyTaxPct) / 1200 + i.insuranceMonthlyCents + (value * i.maintenancePct) / 1200 + i.hoaMonthlyCents;
    if (m === 1) firstOwnCost = own;
    renter *= 1 + g;
    owner *= 1 + g;
    const diff = own - rent;
    if (diff > 0) renter += diff;
    else owner += -diff;
    value *= 1 + homeG;
    if (m % 12 === 0 || m === months) {
      const buy = value - bal - (value * i.sellingPct) / 100 + owner;
      years.push({ year: Math.ceil(m / 12), buyWealthCents: Math.round(buy), rentWealthCents: Math.round(renter) });
    }
  }
  const last = years[years.length - 1] ?? { buyWealthCents: 0, rentWealthCents: 0 };
  const first = years.find((y) => y.buyWealthCents >= y.rentWealthCents);
  return {
    years,
    buyWealthCents: last.buyWealthCents,
    rentWealthCents: last.rentWealthCents,
    advantageCents: last.buyWealthCents - last.rentWealthCents,
    breakEvenYear: first ? first.year : null,
    monthlyOwnCostCents: Math.round(firstOwnCost),
    monthlyRentCents: i.rentMonthlyCents,
  };
}
