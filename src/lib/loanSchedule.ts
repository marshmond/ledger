import type { Loan, LoanEvent, LoanRateChange } from '../types';
import { addMonths } from './dates';

/**
 * Loan amortization engine (mortgage, HELOC, any installment loan). Pure functions; money in integer cents.
 *
 * Conventions (shown in the app too):
 *  - Interest each month = balance x annual rate / 12 (simple monthly accrual). Your lender may accrue daily or use a different day
 *    count, so schedules can differ from statements by a few dollars a year; reconcile against a statement balance.
 *  - A rate change takes effect for payments on or after its date. Whenever the rate changes the payment is recalculated to pay off the
 *    balance over the contractual months that remain, at the new rate.
 *  - Extra principal is applied on the payment date after the regular payment. Between rate changes it either keeps the payment and
 *    finishes the loan early ('shorten') or recalculates a lower payment over the remaining term ('lower').
 *  - HELOC: interest-only payments through the draw period (extra principal and draws allowed), then the balance amortizes over the
 *    repayment period. Draws made during repayment are not allowed and are ignored with a warning.
 *  - The final contractual payment always clears any remaining balance.
 */

export type Phase = 'draw' | 'repay' | 'amortizing';

export interface ScheduleRow {
  n: number;
  date: string;
  phase: Phase;
  ratePct: number;
  startBalance: number;
  interest: number;
  /** Scheduled principal (excludes extra). */
  principal: number;
  extra: number;
  draw: number;
  /** The regular payment: interest + scheduled principal (extra principal is separate). */
  payment: number;
  endBalance: number;
}

export interface Schedule {
  rows: ScheduleRow[];
  startBalance: number;
  totalInterest: number;
  totalPrincipal: number;
  totalExtra: number;
  totalDraws: number;
  /** Everything paid out: regular payments plus extra principal. */
  totalPaid: number;
  paidOff: boolean;
  payoffDate: string | null;
  firstPayment: number;
  peakPayment: number;
  /** HELOC only: the first repayment-period payment, which is usually a step up from interest-only. */
  conversion?: { date: string; payment: number; balance: number };
  warnings: string[];
}

export interface ScheduleOptions {
  /** Leave out extra principal (draws stay): the baseline for "interest saved by extra payments". */
  ignoreExtras?: boolean;
  /** Add this many percentage points to every rate from `shockFrom` (default: the first payment). */
  shockPct?: number;
  shockFrom?: string;
}

/** Level payment that pays `balance` off in `n` months at monthly rate `r`. */
export function pmt(balance: number, r: number, n: number): number {
  if (n <= 0) return balance;
  if (r === 0) return balance / n;
  return (balance * r) / (1 - Math.pow(1 + r, -n));
}

const isDate = (s: string | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

interface Setup {
  startBalance: number;
  first: string;
  /** Contractual months remaining at the first payment (standard loans). */
  n0: number;
  /** Events dated after this (and up to the first payment) belong to period 1. */
  asOf: string;
}

function resolveSetup(loan: Loan): { setup?: Setup; errors: string[] } {
  const errors: string[] = [];
  if (loan.kind === 'heloc' || loan.setup === 'current') {
    if (!(loan.balanceCents != null && loan.balanceCents > 0)) errors.push('Enter the current balance.');
    if (!isDate(loan.nextPaymentDate)) errors.push('Enter the date of the next payment.');
    if (!isDate(loan.asOfDate)) errors.push('Enter the date the balance is as of.');
    if (loan.kind !== 'heloc' && !(loan.remainingMonths && loan.remainingMonths > 0)) errors.push('Enter the months remaining.');
    if (errors.length) return { errors };
    return {
      errors,
      setup: {
        startBalance: loan.balanceCents!,
        first: loan.nextPaymentDate!,
        n0: loan.remainingMonths ?? 0,
        asOf: loan.asOfDate!,
      },
    };
  }
  if (!(loan.originalAmountCents && loan.originalAmountCents > 0)) errors.push('Enter the original loan amount.');
  if (!(loan.termMonths && loan.termMonths > 0)) errors.push('Enter the term in months.');
  if (!isDate(loan.firstPaymentDate)) errors.push('Enter the date of the first payment.');
  if (errors.length) return { errors };
  return {
    errors,
    setup: {
      startBalance: loan.originalAmountCents!,
      first: loan.firstPaymentDate!,
      n0: loan.termMonths!,
      asOf: addMonths(loan.firstPaymentDate!, -1),
    },
  };
}

const emptySchedule = (warnings: string[]): Schedule => ({
  rows: [], startBalance: 0, totalInterest: 0, totalPrincipal: 0, totalExtra: 0, totalDraws: 0, totalPaid: 0,
  paidOff: false, payoffDate: null, firstPayment: 0, peakPayment: 0, warnings,
});

const HARD_CAP = 1200;

export function buildSchedule(loan: Loan, rateChanges: LoanRateChange[], events: LoanEvent[], opts: ScheduleOptions = {}): Schedule {
  const { setup, errors } = resolveSetup(loan);
  if (!setup) return emptySchedule(errors);
  const warnings: string[] = [];
  const { startBalance, first, n0, asOf } = setup;
  const D = (t: number) => addMonths(first, t - 1);

  const changes = [...rateChanges].filter((c) => c.loanId === loan.id || loan.id === undefined).sort((a, b) => a.date.localeCompare(b.date));
  const shockFrom = opts.shockFrom || first;
  const rateAt = (date: string) => {
    let r = loan.annualRatePct;
    for (const c of changes) if (c.date <= date) r = c.annualRatePct;
    if (opts.shockPct && date >= shockFrom) r += opts.shockPct;
    return Math.max(0, r);
  };

  const mine = events.filter((e) => (e.loanId === loan.id || loan.id === undefined) && e.amountCents > 0);
  const amountFor = (type: 'extra' | 'draw', t: number): number => {
    const date = D(t);
    const prev = t === 1 ? asOf : D(t - 1);
    return mine
      .filter((e) => e.type === type)
      .reduce((sum, e) => {
        const hit = e.monthly ? date >= e.date && (!e.endDate || date <= e.endDate) : e.date > prev && e.date <= date;
        return hit ? sum + e.amountCents : sum;
      }, 0);
  };
  const laterDraw = (date: string) => mine.some((e) => e.type === 'draw' && (e.monthly ? !e.endDate || e.endDate > date : e.date > date));

  // ---- HELOC timeline ----
  const heloc = loan.kind === 'heloc' ? loan.heloc : undefined;
  if (loan.kind === 'heloc' && !heloc) return emptySchedule(['Enter the draw start date and the draw and repayment lengths.']);
  let conv = '';
  let tStar = 0; // index of the first repayment-period payment (can be <= 0 if repayment is already underway)
  let R = 0;
  let maxPeriods = n0;
  if (heloc) {
    if (!isDate(heloc.drawStartDate) || !(heloc.drawMonths >= 0) || !(heloc.repayMonths > 0)) {
      return emptySchedule(['Enter the draw start date and the draw and repayment lengths.']);
    }
    conv = addMonths(heloc.drawStartDate, heloc.drawMonths);
    R = heloc.repayMonths;
    tStar = 1;
    if (D(1) >= conv) while (D(tStar - 1) >= conv && tStar > -1200) tStar--;
    else while (D(tStar) < conv && tStar < HARD_CAP) tStar++;
    maxPeriods = tStar + R - 1;
    if (maxPeriods < 1) return emptySchedule(['The repayment period has already ended for this HELOC.']);
  }
  maxPeriods = Math.min(Math.max(maxPeriods, 1), HARD_CAP);

  const rows: ScheduleRow[] = [];
  let bal = startBalance;
  let payment = 0;
  let prevRate = Number.NaN;
  let recalc = true;
  let underpaid = false;
  let drawIgnored = false;
  let conversion: Schedule['conversion'];

  for (let t = 1; t <= maxPeriods; t++) {
    const date = D(t);
    const rate = rateAt(date);
    const r = rate / 1200;
    const inDraw = !!heloc && date < conv;
    const phase: Phase = heloc ? (inDraw ? 'draw' : 'repay') : 'amortizing';
    const remaining = heloc ? (inDraw ? Infinity : R - (t - tStar)) : n0 - (t - 1);
    const interest = Math.round(bal * r);
    let principal = 0;
    let extra = 0;
    let draw = 0;
    const extraWanted = opts.ignoreExtras ? 0 : amountFor('extra', t);

    if (inDraw) {
      extra = Math.min(extraWanted, bal);
      draw = amountFor('draw', t);
      const limit = heloc!.creditLimitCents;
      if (limit && bal - extra + draw > limit) {
        draw = Math.max(0, limit - (bal - extra));
        warnings.push(`A draw on ${date} was reduced to stay within the credit limit.`);
      }
    } else {
      if (heloc && amountFor('draw', t) > 0 && !drawIgnored) {
        drawIgnored = true;
        warnings.push('Draws are not allowed during the repayment period; draws dated then were ignored.');
      }
      if (recalc || rate !== prevRate) {
        payment = t === 1 && !heloc && loan.paymentOverrideCents ? loan.paymentOverrideCents : Math.round(pmt(bal, r, remaining));
        recalc = false;
        if (heloc && !conversion) conversion = { date, payment, balance: bal };
      }
      if (remaining <= 1) principal = bal; // the last contractual payment clears the loan
      else principal = Math.min(payment - interest, bal);
      if (principal < 0) {
        principal = 0;
        if (!underpaid) {
          underpaid = true;
          warnings.push('The payment is smaller than the monthly interest, so the balance is not shrinking until the final payment.');
        }
      }
      extra = Math.min(extraWanted, bal - principal);
      if (loan.extraMode === 'lower' && extra > 0) recalc = true;
    }

    const end = bal - principal - extra + draw;
    rows.push({
      n: t, date, phase, ratePct: rate, startBalance: bal, interest, principal, extra, draw,
      payment: interest + principal, endBalance: end,
    });
    prevRate = rate;
    bal = end;
    if (bal <= 0 && (!inDraw || !laterDraw(date))) break;
  }

  const sum = (f: (r: ScheduleRow) => number) => rows.reduce((a, r) => a + f(r), 0);
  const last = rows.at(-1);
  const paidOff = !!last && last.endBalance <= 0;
  return {
    rows,
    startBalance,
    totalInterest: sum((r) => r.interest),
    totalPrincipal: sum((r) => r.principal),
    totalExtra: sum((r) => r.extra),
    totalDraws: sum((r) => r.draw),
    totalPaid: sum((r) => r.payment + r.extra),
    paidOff,
    payoffDate: paidOff ? last!.date : null,
    firstPayment: rows[0]?.payment ?? 0,
    peakPayment: rows.reduce((m, r) => Math.max(m, r.payment), 0),
    conversion,
    warnings: [...new Set(warnings)],
  };
}

// ---- helpers for the screens ----

/** Balance after the last payment on or before `date` (the opening balance if none yet). */
export function balanceAt(s: Schedule, date: string): number {
  let b = s.startBalance;
  for (const r of s.rows) {
    if (r.date > date) break;
    b = r.endBalance;
  }
  return b;
}

/** The first payment on or after `date`, if any. */
export const nextRow = (s: Schedule, date: string): ScheduleRow | undefined => s.rows.find((r) => r.date >= date);

export interface YearSummary {
  year: number;
  payments: number;
  interest: number;
  principal: number;
  extra: number;
  draws: number;
  endBalance: number;
}

export function yearlySummary(rows: ScheduleRow[]): YearSummary[] {
  const out = new Map<number, YearSummary>();
  for (const r of rows) {
    const y = Number(r.date.slice(0, 4));
    const s = out.get(y) ?? { year: y, payments: 0, interest: 0, principal: 0, extra: 0, draws: 0, endBalance: 0 };
    s.payments += r.payment;
    s.interest += r.interest;
    s.principal += r.principal;
    s.extra += r.extra;
    s.draws += r.draw;
    s.endBalance = r.endBalance;
    out.set(y, s);
  }
  return [...out.values()].sort((a, b) => a.year - b.year);
}

/** Cash paid in a calendar year (regular payments + extra principal). */
export const paymentsInYear = (s: Schedule, year: number): number =>
  s.rows.filter((r) => r.date.startsWith(`${year}-`)).reduce((a, r) => a + r.payment + r.extra, 0);

export interface LoanView {
  schedule: Schedule;
  /** Same loan without extra principal (draws kept). */
  baseline: Schedule;
  /** With the what-if rate shock applied, if one is set. */
  shocked: Schedule | null;
  interestSaved: number;
  monthsSaved: number;
}

export function loanView(loan: Loan, rates: LoanRateChange[], events: LoanEvent[]): LoanView {
  const schedule = buildSchedule(loan, rates, events);
  const baseline = buildSchedule(loan, rates, events, { ignoreExtras: true });
  const shock = loan.shockPct && loan.shockPct !== 0 ? buildSchedule(loan, rates, events, { shockPct: loan.shockPct, shockFrom: loan.shockFrom }) : null;
  return {
    schedule,
    baseline,
    shocked: shock,
    interestSaved: Math.max(0, baseline.totalInterest - schedule.totalInterest),
    monthsSaved: Math.max(0, baseline.rows.length - schedule.rows.length),
  };
}

/** Escrow and PMI are shown with the payment but do not change the loan balance. */
export const monthlyTotal = (loan: Loan, payment: number): number => payment + (loan.escrowMonthlyCents ?? 0) + (loan.pmiMonthlyCents ?? 0);

const dollars = (c: number) => (c / 100).toFixed(2);

export function scheduleToCsv(s: Schedule): string {
  const head = ['Payment #', 'Date', 'Phase', 'Rate %', 'Start balance', 'Interest', 'Principal', 'Extra principal', 'Draw', 'Payment', 'End balance'];
  const lines = [head.join(',')];
  for (const r of s.rows) {
    lines.push([r.n, r.date, r.phase, r.ratePct.toFixed(3), dollars(r.startBalance), dollars(r.interest), dollars(r.principal), dollars(r.extra), dollars(r.draw), dollars(r.payment), dollars(r.endBalance)].join(','));
  }
  return lines.join('\r\n') + '\r\n';
}
