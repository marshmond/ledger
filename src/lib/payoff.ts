import { pmt } from './loanSchedule';

/**
 * Debt payoff planning: how fast you get out of debt with the minimum payments, the avalanche (highest rate first) or the snowball
 * (smallest balance first), plus a refinance break-even and a comparison of paying extra on a loan against investing the money.
 * Interest is simple monthly (balance x rate / 12). Money in cents.
 */

export interface Debt {
  id: string;
  name: string;
  balanceCents: number;
  aprPct: number;
  minPaymentCents: number;
}

export type PayoffStrategy = 'minimum' | 'avalanche' | 'snowball';

export interface PayoffResult {
  strategy: PayoffStrategy;
  /** Months until every debt is paid off, or null if the payments never cover the interest. */
  months: number | null;
  totalInterestCents: number;
  totalPaidCents: number;
  /** The month (1 = next month) each debt is paid off, in the order they finish. */
  order: { id: string; name: string; month: number }[];
  /** Total balance at the end of each month, starting with now (month 0). */
  balances: number[];
  /** Debts whose minimum does not cover the interest (they only shrink once extra money reaches them). */
  notCovering: string[];
}

const MAX_MONTHS = 720;

export function simulatePayoff(debts: Debt[], extraCents: number, strategy: PayoffStrategy): PayoffResult {
  const live = debts.filter((d) => d.balanceCents > 0).map((d) => ({ ...d, bal: d.balanceCents, rate: d.aprPct / 1200, done: false }));
  const notCovering = live.filter((d) => d.minPaymentCents < Math.round(d.balanceCents * (d.aprPct / 1200))).map((d) => d.name);
  const budget = live.reduce((a, d) => a + d.minPaymentCents, 0) + (strategy === 'minimum' ? 0 : Math.max(0, extraCents));
  const priority = [...live].sort((a, b) => (strategy === 'snowball' ? a.bal - b.bal || b.rate - a.rate : b.rate - a.rate || a.bal - b.bal));
  const order: PayoffResult['order'] = [];
  const balances = [live.reduce((a, d) => a + d.bal, 0)];
  let interest = 0;
  let paid = 0;
  let month = 0;

  while (live.some((d) => !d.done) && month < MAX_MONTHS) {
    month++;
    for (const d of live) {
      if (d.done) continue;
      const i = Math.round(d.bal * d.rate);
      d.bal += i;
      interest += i;
    }
    let pool = budget;
    // minimums first (a minimum never pays more than what is owed)
    for (const d of live) {
      if (d.done) continue;
      const p = Math.min(d.minPaymentCents, d.bal);
      d.bal -= p;
      pool -= p;
      paid += p;
    }
    // money freed by finished debts, plus the extra, goes to the priority debt (not for minimum-only)
    if (strategy !== 'minimum') {
      for (const d of priority) {
        if (pool <= 0) break;
        if (d.done || d.bal <= 0) continue;
        const p = Math.min(pool, d.bal);
        d.bal -= p;
        pool -= p;
        paid += p;
      }
    }
    for (const d of live) {
      if (!d.done && d.bal <= 0) {
        d.done = true;
        d.bal = 0;
        order.push({ id: d.id, name: d.name, month });
      }
    }
    balances.push(live.reduce((a, d) => a + d.bal, 0));
  }
  const finished = live.every((d) => d.done);
  return { strategy, months: finished ? month : null, totalInterestCents: interest, totalPaidCents: paid, order, balances, notCovering };
}

export interface PayoffComparison {
  minimum: PayoffResult;
  avalanche: PayoffResult;
  snowball: PayoffResult;
  /** Interest saved and months saved by each strategy against paying only the minimums (null if the minimum never pays off). */
  savings: Record<'avalanche' | 'snowball', { interestCents: number; months: number | null }>;
}

export function comparePayoff(debts: Debt[], extraCents: number): PayoffComparison {
  const minimum = simulatePayoff(debts, 0, 'minimum');
  const avalanche = simulatePayoff(debts, extraCents, 'avalanche');
  const snowball = simulatePayoff(debts, extraCents, 'snowball');
  const s = (r: PayoffResult) => ({ interestCents: minimum.totalInterestCents - r.totalInterestCents, months: minimum.months !== null && r.months !== null ? minimum.months - r.months : null });
  return { minimum, avalanche, snowball, savings: { avalanche: s(avalanche), snowball: s(snowball) } };
}

// ---------- refinance ----------

export interface RefinanceInput {
  balanceCents: number;
  aprPct: number;
  remainingMonths: number;
  newAprPct: number;
  newTermMonths: number;
  closingCostsCents: number;
  /** Roll the closing costs into the new loan instead of paying them up front. */
  rollCosts: boolean;
}

export interface RefinanceResult {
  currentPaymentCents: number;
  newPaymentCents: number;
  monthlySavingsCents: number;
  /** Months of savings needed to earn back the closing costs, or null if it never does. */
  breakEvenMonths: number | null;
  currentInterestCents: number;
  newInterestCents: number;
  /** Positive = the refinance costs less over the rest of the life of both loans (interest plus closing costs). */
  lifetimeSavingsCents: number;
  /** The new loan lasts longer than what is left on the current one. */
  extendsTerm: boolean;
}

export function refinance(i: RefinanceInput): RefinanceResult {
  const r0 = i.aprPct / 1200;
  const r1 = i.newAprPct / 1200;
  const cur = Math.round(pmt(i.balanceCents, r0, i.remainingMonths));
  const principal = i.balanceCents + (i.rollCosts ? i.closingCostsCents : 0);
  const nw = Math.round(pmt(principal, r1, i.newTermMonths));
  const upfront = i.rollCosts ? 0 : i.closingCostsCents;
  const savings = cur - nw;
  const curInt = cur * i.remainingMonths - i.balanceCents;
  const newInt = nw * i.newTermMonths - principal;
  return {
    currentPaymentCents: cur,
    newPaymentCents: nw,
    monthlySavingsCents: savings,
    breakEvenMonths: upfront === 0 ? 0 : savings > 0 ? Math.ceil(upfront / savings) : null,
    currentInterestCents: curInt,
    newInterestCents: newInt,
    lifetimeSavingsCents: curInt - (newInt + i.closingCostsCents),
    extendsTerm: i.newTermMonths > i.remainingMonths,
  };
}

// ---------- extra payments vs investing ----------

export interface ExtraVsInvestInput {
  balanceCents: number;
  aprPct: number;
  remainingMonths: number;
  extraMonthlyCents: number;
  /** Expected yearly return on investments, in percent. */
  returnPct: number;
  /** Yearly tax drag on a taxable account, in percent of the return (0 for a Roth or tax-deferred account). */
  taxDragPct: number;
}

export interface ExtraVsInvestResult {
  paymentCents: number;
  /** Months until the loan is gone if you add the extra every month. */
  payoffMonths: number;
  interestSavedCents: number;
  monthsSaved: number;
  /** Money you would have at the end of the original term (loan gone either way). */
  wealthIfPrepayCents: number;
  wealthIfInvestCents: number;
  better: 'prepay' | 'invest' | 'even';
  /** Investment return after tax drag, per year in percent: the rate prepaying has to beat. */
  afterTaxReturnPct: number;
}

export function extraVsInvest(i: ExtraVsInvestInput): ExtraVsInvestResult {
  const r = i.aprPct / 1200;
  const n = i.remainingMonths;
  const pay = pmt(i.balanceCents, r, n);
  const g = Math.pow(1 + (i.returnPct * (1 - i.taxDragPct / 100)) / 100, 1 / 12) - 1;
  const extra = Math.max(0, i.extraMonthlyCents);

  // Prepay: pay the payment plus the extra until the loan is gone, then invest that whole amount for the rest of the term.
  let bal = i.balanceCents;
  let interestA = 0;
  let k = 0;
  let wealthA = 0;
  for (; k < n && bal > 0; k++) {
    const intr = bal * r;
    interestA += intr;
    bal = Math.max(0, bal + intr - (pay + extra));
  }
  const payoff = k;
  for (let m = payoff; m < n; m++) wealthA = wealthA * (1 + g) + pay + extra;

  // Invest: pay the loan normally and invest the extra every month.
  let wealthB = 0;
  let interestB = 0;
  bal = i.balanceCents;
  for (let m = 0; m < n; m++) {
    interestB += bal * r;
    bal = Math.max(0, bal + bal * r - pay);
    wealthB = wealthB * (1 + g) + extra;
  }
  const diff = wealthA - wealthB;
  return {
    paymentCents: Math.round(pay),
    payoffMonths: payoff,
    interestSavedCents: Math.round(interestB - interestA),
    monthsSaved: n - payoff,
    wealthIfPrepayCents: Math.round(wealthA),
    wealthIfInvestCents: Math.round(wealthB),
    better: Math.abs(diff) < 100 ? 'even' : diff > 0 ? 'prepay' : 'invest',
    afterTaxReturnPct: i.returnPct * (1 - i.taxDragPct / 100),
  };
}
