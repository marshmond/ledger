import { describe, expect, it } from 'vitest';
import type { Loan, LoanEvent, LoanRateChange } from '../types';
import { balanceAt, buildSchedule, loanView, monthlyTotal, nextRow, paymentsInYear, pmt, scheduleToCsv, yearlySummary, type Schedule } from './loanSchedule';

const $ = (n: number) => Math.round(n * 100);

const mortgage = (p: Partial<Loan> = {}): Loan => ({
  name: 'Mortgage', kind: 'mortgage', setup: 'original', originalAmountCents: $(300000), termMonths: 360,
  firstPaymentDate: '2026-02-01', annualRatePct: 6, extraMode: 'shorten', ...p,
});
const heloc = (p: Partial<Loan> = {}): Loan => ({
  name: 'HELOC', kind: 'heloc', setup: 'current', balanceCents: $(100000), asOfDate: '2026-10-09', nextPaymentDate: '2026-11-01',
  annualRatePct: 7, extraMode: 'shorten',
  heloc: { drawStartDate: '2025-11-01', drawMonths: 120, repayMonths: 180 }, ...p,
});
const ev = (p: Partial<LoanEvent> & Pick<LoanEvent, 'type' | 'date' | 'amountCents'>): LoanEvent => ({ loanId: 0, ...p });
const rc = (date: string, annualRatePct: number): LoanRateChange => ({ loanId: 0, date, annualRatePct });
const build = (loan: Loan, rates: LoanRateChange[] = [], events: LoanEvent[] = [], opts = {}) =>
  buildSchedule({ ...loan, id: 0 }, rates, events, opts);

/** Every schedule must obey these identities. */
function checkInvariants(s: Schedule) {
  let prev = s.startBalance;
  for (const r of s.rows) {
    expect(r.startBalance).toBe(prev);
    expect(r.payment).toBe(r.interest + r.principal);
    expect(r.endBalance).toBe(r.startBalance - r.principal - r.extra + r.draw);
    expect(r.endBalance).toBeGreaterThanOrEqual(0);
    expect(r.interest).toBeGreaterThanOrEqual(0);
    prev = r.endBalance;
  }
  if (s.paidOff) expect(s.rows.at(-1)!.endBalance).toBe(0);
  expect(s.totalPaid).toBe(s.totalInterest + s.totalPrincipal + s.totalExtra);
  if (s.paidOff) expect(s.totalPrincipal + s.totalExtra - s.totalDraws).toBe(s.startBalance);
}

describe('payment formula', () => {
  it('matches published values', () => {
    expect(Math.round(pmt($(300000), 0.06 / 12, 360))).toBe(179865);
    expect(Math.round(pmt($(100000), 0.07 / 12, 180))).toBe(89883);
    expect(pmt(1200, 0, 12)).toBe(100);
    expect(pmt(500, 0.01, 0)).toBe(500);
  });
});

describe('standard loan', () => {
  it('30-year fixed at 6% on $300,000: $1,798.65 a month and about $347,515 of interest', () => {
    const s = build(mortgage());
    expect(s.rows).toHaveLength(360);
    expect(s.rows[0].payment).toBe(179865);
    expect(s.rows[0].interest).toBe(150000);
    expect(s.rows[0].principal).toBe(29865);
    expect(s.totalInterest).toBeGreaterThan($(347500));
    expect(s.totalInterest).toBeLessThan($(347530));
    expect(s.rows[0].date).toBe('2026-02-01');
    expect(s.payoffDate).toBe('2056-01-01');
    expect(s.paidOff).toBe(true);
    checkInvariants(s);
  });

  it('a zero-rate loan is a straight line', () => {
    const s = build(mortgage({ originalAmountCents: $(12000), termMonths: 12, annualRatePct: 0 }));
    expect(s.rows.every((r) => r.payment === 100000 && r.interest === 0)).toBe(true);
    expect(s.totalInterest).toBe(0);
    checkInvariants(s);
  });

  it('payment dates keep their day of month, clamped in short months and leap years', () => {
    const a = build(mortgage({ firstPaymentDate: '2026-01-31', termMonths: 4 }));
    expect(a.rows.map((r) => r.date)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
    expect(build(mortgage({ firstPaymentDate: '2028-01-31', termMonths: 3 })).rows[1].date).toBe('2028-02-29');
  });

  it('"current balance + months remaining" reproduces the original schedule from any point', () => {
    const orig = build(mortgage());
    const i = 59;
    const cur = build(
      mortgage({ setup: 'current', balanceCents: orig.rows[i].endBalance, asOfDate: orig.rows[i].date, nextPaymentDate: orig.rows[i + 1].date, remainingMonths: 300 }),
    );
    expect(cur.rows).toHaveLength(300);
    expect(Math.abs(cur.rows[0].payment - orig.rows[i + 1].payment)).toBeLessThanOrEqual(1);
    const restInterest = orig.rows.slice(i + 1).reduce((a, r) => a + r.interest, 0);
    expect(Math.abs(cur.totalInterest - restInterest)).toBeLessThanOrEqual(150);
    checkInvariants(cur);
  });

  it('a one-month loan pays balance plus interest once', () => {
    const s = build(mortgage({ setup: 'current', balanceCents: $(1000), asOfDate: '2026-01-01', nextPaymentDate: '2026-02-01', remainingMonths: 1 }));
    expect(s.rows).toHaveLength(1);
    expect(s.rows[0].payment).toBe($(1000) + Math.round($(1000) * 0.005));
    checkInvariants(s);
  });

  it('a stated payment overrides the calculated one; a payment below the interest warns and balloons at the end', () => {
    const higher = build(mortgage({ originalAmountCents: $(100000), annualRatePct: 5, paymentOverrideCents: $(600) }));
    expect(higher.rows[0].payment).toBe($(600));
    expect(higher.rows.length).toBeLessThan(360);
    expect(higher.paidOff).toBe(true);
    checkInvariants(higher);

    const low = build(mortgage({ originalAmountCents: $(100000), annualRatePct: 6, paymentOverrideCents: $(300) }));
    expect(low.warnings.join(' ')).toContain('smaller than the monthly interest');
    expect(low.rows).toHaveLength(360);
    expect(low.rows.at(-1)!.payment).toBeGreaterThan($(100000)); // the remainder comes due at the end
    checkInvariants(low);
  });

  it('missing setup details give an empty schedule with a plain explanation', () => {
    expect(build(mortgage({ originalAmountCents: 0 })).warnings).toContain('Enter the original loan amount.');
    expect(build(mortgage({ termMonths: 0 })).warnings).toContain('Enter the term in months.');
    expect(build(mortgage({ firstPaymentDate: '' })).warnings).toContain('Enter the date of the first payment.');
    const cur = build(mortgage({ setup: 'current', balanceCents: undefined, nextPaymentDate: undefined, asOfDate: undefined, remainingMonths: 0 }));
    expect(cur.rows).toEqual([]);
    expect(cur.warnings.length).toBe(4);
  });
});

describe('extra principal on a standard loan', () => {
  const monthly200 = ev({ type: 'extra', date: '2026-02-01', amountCents: $(200), monthly: true });

  it('keeping the payment finishes early and saves interest', () => {
    const view = loanView({ ...mortgage(), id: 0 }, [], [monthly200]);
    const s = view.schedule;
    expect(s.rows.length).toBeLessThan(300);
    expect(view.baseline.rows).toHaveLength(360);
    expect(s.rows[0].extra).toBe($(200));
    expect(s.rows[5].payment).toBe(s.rows[0].payment); // payment unchanged
    expect(view.interestSaved).toBe(view.baseline.totalInterest - s.totalInterest);
    expect(view.interestSaved).toBeGreaterThan($(50000));
    expect(view.monthsSaved).toBe(360 - s.rows.length);
    checkInvariants(s);
  });

  it('"lower the payment" recalculates a smaller payment and never runs past the original end date', () => {
    const s = build(mortgage({ extraMode: 'lower' }), [], [monthly200]);
    expect(s.rows.length).toBeLessThanOrEqual(360);
    expect(s.rows.length).toBeGreaterThan(300); // far closer to the original term than "keep the payment" (about 279)
    expect(s.rows[12].payment).toBeLessThan(s.rows[0].payment);
    for (let i = 2; i < s.rows.length - 1; i++) expect(s.rows[i].payment).toBeLessThanOrEqual(s.rows[i - 1].payment + 1);
    expect(s.totalInterest).toBeLessThan(build(mortgage()).totalInterest);
    checkInvariants(s);
  });

  it('a one-time lump sum lands in the right payment and cuts the balance', () => {
    const base = build(mortgage());
    // D(23) = 2027-12-01, D(24) = 2028-01-01: a payment on Dec 15 belongs to the January payment (n = 24)
    const s = build(mortgage(), [], [ev({ type: 'extra', date: '2027-12-15', amountCents: $(20000) })]);
    expect(s.rows.filter((r) => r.extra > 0).map((r) => [r.n, r.extra])).toEqual([[24, $(20000)]]);
    expect(s.rows[23].endBalance).toBe(base.rows[23].endBalance - $(20000));
    expect(s.rows.length).toBeLessThan(360);
    checkInvariants(s);
  });

  it('a payment dated exactly on a payment date belongs to that payment', () => {
    const s = build(mortgage(), [], [ev({ type: 'extra', date: '2026-04-01', amountCents: $(1000) })]);
    expect(s.rows.find((r) => r.extra > 0)!.n).toBe(3);
  });

  it('a recurring extra can have an end date', () => {
    const s = build(mortgage(), [], [ev({ type: 'extra', date: '2026-02-01', amountCents: $(100), monthly: true, endDate: '2026-12-01' })]);
    expect(s.rows.filter((r) => r.extra > 0)).toHaveLength(11); // Feb through Dec
  });

  it('extra principal dated before the balance date is ignored (it is already in the balance), but a recurring one still applies', () => {
    const loan = mortgage({ setup: 'current', balanceCents: $(200000), asOfDate: '2026-10-09', nextPaymentDate: '2026-11-01', remainingMonths: 240 });
    const past = build(loan, [], [ev({ type: 'extra', date: '2026-09-15', amountCents: $(5000) })]);
    expect(past.totalExtra).toBe(0);
    const recurring = build(loan, [], [ev({ type: 'extra', date: '2025-01-01', amountCents: $(100), monthly: true })]);
    expect(recurring.rows[0].extra).toBe($(100));
  });

  it('extra can never exceed what is owed', () => {
    const s = build(mortgage({ originalAmountCents: $(1000), termMonths: 12 }), [], [ev({ type: 'extra', date: '2026-02-01', amountCents: $(5000) })]);
    expect(s.rows).toHaveLength(1);
    expect(s.rows[0].extra + s.rows[0].principal).toBe($(1000));
    checkInvariants(s);
  });
});

describe('rate changes', () => {
  it('the payment is recalculated over the remaining term at the new rate, and the loan still ends at zero', () => {
    const s = build(mortgage({ annualRatePct: 4 }), [rc('2027-02-01', 5)]);
    // payments 1..12 are at 4%; the 13th (2027-02-01) is the first at 5%
    expect(s.rows[0].payment).toBe(Math.round(pmt($(300000), 0.04 / 12, 360)));
    expect(s.rows[11].payment).toBe(s.rows[0].payment);
    expect(s.rows[12].ratePct).toBe(5);
    expect(s.rows[12].payment).toBe(Math.round(pmt(s.rows[12].startBalance, 0.05 / 12, 348)));
    expect(s.rows[12].payment).toBeGreaterThan(s.rows[11].payment);
    expect(s.rows).toHaveLength(360);
    checkInvariants(s);
  });

  it('a change dated mid-month takes effect at the next payment on or after it', () => {
    const s = build(mortgage(), [rc('2027-01-15', 7)]);
    expect(s.rows[11].ratePct).toBe(6); // 2027-01-01
    expect(s.rows[12].ratePct).toBe(7); // 2027-02-01
  });

  it('several changes apply in date order, and rates never go below zero', () => {
    const s = build(mortgage(), [rc('2030-01-01', 3), rc('2027-01-01', 8)]);
    expect(s.rows.find((r) => r.date === '2027-01-01')!.ratePct).toBe(8);
    expect(s.rows.find((r) => r.date === '2030-01-01')!.ratePct).toBe(3);
    const negative = build(mortgage(), [], [], { shockPct: -10 });
    expect(negative.rows.every((r) => r.ratePct === 0)).toBe(true);
    checkInvariants(negative);
  });

  it('a what-if shock raises payments and interest from its start date only', () => {
    const base = build(mortgage({ annualRatePct: 4 }));
    const shock = build(mortgage({ annualRatePct: 4 }), [], [], { shockPct: 2, shockFrom: '2028-02-01' });
    expect(shock.rows[0].payment).toBe(base.rows[0].payment);
    expect(shock.rows.find((r) => r.date === '2028-02-01')!.ratePct).toBe(6);
    expect(shock.totalInterest).toBeGreaterThan(base.totalInterest);
    checkInvariants(shock);
  });
});

describe('HELOC: interest-only draw period, then payback', () => {
  it('10 years interest-only, then 15 years of payback, ending at exactly zero', () => {
    const s = build(heloc());
    const drawRows = s.rows.filter((r) => r.phase === 'draw');
    const repayRows = s.rows.filter((r) => r.phase === 'repay');
    expect(drawRows).toHaveLength(108); // 2026-11 through 2035-10: 12 of the 120 draw months are already behind you
    expect(repayRows).toHaveLength(180);
    expect(drawRows.every((r) => r.payment === 58333 && r.principal === 0)).toBe(true);
    expect(s.rows[108].date).toBe('2035-11-01');
    expect(s.rows[108].payment).toBe(89883);
    expect(s.conversion).toEqual({ date: '2035-11-01', payment: 89883, balance: $(100000) });
    expect(s.payoffDate).toBe('2050-10-01');
    const repayInterest = repayRows.reduce((a, r) => a + r.interest, 0);
    expect(Math.abs(repayInterest - $(61789))).toBeLessThan($(60));
    checkInvariants(s);
  });

  it('extra principal during the interest-only period lowers the balance, the interest-only payment, and the later payback', () => {
    const view = loanView({ ...heloc(), id: 0 }, [], [ev({ type: 'extra', date: '2026-11-01', amountCents: $(500), monthly: true, endDate: '2035-10-01' })]);
    const s = view.schedule;
    expect(s.rows[0].payment).toBe(58333); // interest on the balance before this month's extra
    expect(s.rows[1].startBalance).toBe($(100000) - $(500));
    expect(s.rows[1].payment).toBe(Math.round($(99500) * 0.07 / 12));
    expect(s.rows[1].payment).toBeLessThan(s.rows[0].payment);
    expect(s.conversion!.balance).toBe($(100000) - 108 * $(500));
    expect(s.conversion!.payment).toBeLessThan(89883);
    expect(view.interestSaved).toBeGreaterThan($(5000));
    checkInvariants(s);
  });

  it('extra principal during the payback period: keep the payment and finish early, or lower the payment', () => {
    const extra = [ev({ type: 'extra', date: '2035-11-01', amountCents: $(300), monthly: true })];
    const shorten = build(heloc(), [], extra);
    expect(shorten.rows.length).toBeLessThan(288);
    expect(shorten.rows.find((r) => r.phase === 'repay' && r.extra > 0)!.payment).toBe(89883);
    expect(shorten.paidOff).toBe(true);
    checkInvariants(shorten);

    const lower = build(heloc({ extraMode: 'lower' }), [], extra);
    expect(lower.rows.length).toBeLessThanOrEqual(288); // never past the original end; a large recurring extra can still finish a bit early
    expect(lower.rows.length).toBeGreaterThan(shorten.rows.length);
    const repay = lower.rows.filter((r) => r.phase === 'repay');
    expect(repay[20].payment).toBeLessThan(repay[0].payment);
    checkInvariants(lower);
  });

  it('a draw adds to the balance and to the interest from the next payment on', () => {
    const s = build(heloc(), [], [ev({ type: 'draw', date: '2027-06-15', amountCents: $(20000) })]);
    const row = s.rows.find((r) => r.draw > 0)!;
    expect(row.date).toBe('2027-07-01');
    expect(row.draw).toBe($(20000));
    expect(row.endBalance).toBe(row.startBalance + $(20000));
    const next = s.rows[s.rows.indexOf(row) + 1];
    expect(next.interest).toBe(Math.round(next.startBalance * 0.07 / 12));
    expect(next.startBalance).toBe($(120000));
    expect(s.conversion!.balance).toBe($(120000));
    expect(s.conversion!.payment).toBe(Math.round(pmt($(120000), 0.07 / 12, 180)));
    checkInvariants(s);
  });

  it('draws stay within the credit limit, and are not allowed during payback', () => {
    const limited = build(heloc({ heloc: { drawStartDate: '2025-11-01', drawMonths: 120, repayMonths: 180, creditLimitCents: $(110000) } }), [], [ev({ type: 'draw', date: '2027-06-15', amountCents: $(20000) })]);
    expect(limited.rows.find((r) => r.draw > 0)!.draw).toBe($(10000));
    expect(limited.warnings.join(' ')).toContain('credit limit');

    const late = build(heloc(), [], [ev({ type: 'draw', date: '2036-03-10', amountCents: $(5000) })]);
    expect(late.totalDraws).toBe(0);
    expect(late.warnings.join(' ')).toContain('Draws are not allowed during the repayment period');
    checkInvariants(late);
  });

  it('a rate change during the draw period moves the interest-only payment and sets the payback payment at the then-current rate', () => {
    const s = build(heloc(), [rc('2028-01-01', 8)]);
    expect(s.rows.find((r) => r.date === '2027-12-01')!.payment).toBe(58333);
    expect(s.rows.find((r) => r.date === '2028-01-01')!.payment).toBe(66667);
    expect(s.conversion!.payment).toBe(Math.round(pmt($(100000), 0.08 / 12, 180)));
    checkInvariants(s);
  });

  it('a rate change during payback re-amortizes over the remaining months and still ends at zero', () => {
    const s = build(heloc(), [rc('2040-01-01', 9)]);
    const row = s.rows.find((r) => r.date === '2040-01-01')!;
    // payback payment #51 (2035-11 to 2040-01 is 50 months), so 180 - 50 = 130 months remain
    expect(row.payment).toBe(Math.round(pmt(row.startBalance, 0.09 / 12, 130)));
    expect(row.payment).toBeGreaterThan(89883);
    expect(s.rows).toHaveLength(288);
    expect(s.payoffDate).toBe('2050-10-01');
    checkInvariants(s);
  });

  it('a +2% what-if shock raises the payback payment and total interest', () => {
    const view = loanView({ ...heloc(), id: 0, shockPct: 2, shockFrom: '2026-11-01' }, [], []);
    expect(view.shocked).not.toBeNull();
    expect(view.shocked!.conversion!.payment).toBe(Math.round(pmt($(100000), 0.09 / 12, 180)));
    expect(view.shocked!.peakPayment).toBeGreaterThan(view.schedule.peakPayment);
    expect(view.shocked!.totalInterest).toBeGreaterThan(view.schedule.totalInterest);
    expect(loanView({ ...heloc(), id: 0 }, [], []).shocked).toBeNull();
  });

  it('a HELOC that is already in the payback period starts mid-repayment', () => {
    const s = build(heloc({ balanceCents: $(80000), heloc: { drawStartDate: '2016-01-01', drawMonths: 120, repayMonths: 180 } }));
    expect(s.rows).toHaveLength(170); // payments 11..180 of the payback remain
    expect(s.rows.every((r) => r.phase === 'repay')).toBe(true);
    expect(s.rows[0].payment).toBe(Math.round(pmt($(80000), 0.07 / 12, 170)));
    checkInvariants(s);
  });

  it('a HELOC whose payback period is over, or with missing details, explains why there is no schedule', () => {
    const over = build(heloc({ heloc: { drawStartDate: '2000-01-01', drawMonths: 120, repayMonths: 180 } }));
    expect(over.rows).toEqual([]);
    expect(over.warnings.join(' ')).toContain('already ended');
    expect(build(heloc({ heloc: undefined })).warnings.join(' ')).toContain('draw start date');
    expect(build(heloc({ balanceCents: 0 })).warnings).toContain('Enter the current balance.');
  });

  it('paying the balance off in the draw period ends the schedule unless a later draw is planned', () => {
    const once = [ev({ type: 'extra', date: '2026-11-01', amountCents: $(100000) })];
    const done = build(heloc(), [], once);
    expect(done.rows).toHaveLength(1);
    expect(done.paidOff).toBe(true);
    const later = build(heloc(), [], [...once, ev({ type: 'draw', date: '2028-03-10', amountCents: $(10000) })]);
    expect(later.rows.length).toBeGreaterThan(10);
    expect(later.totalDraws).toBe($(10000));
    checkInvariants(later);
  });
});

describe('helpers for the screens', () => {
  const s = build(mortgage({ originalAmountCents: $(12000), termMonths: 24, annualRatePct: 0, firstPaymentDate: '2026-01-15' }));

  it('balance on a date, and the next payment', () => {
    expect(balanceAt(s, '2025-12-31')).toBe($(12000));
    expect(balanceAt(s, '2026-01-15')).toBe($(11500));
    expect(balanceAt(s, '2026-03-20')).toBe($(10500)); // three payments made (Jan, Feb, Mar 15)
    expect(balanceAt(s, '2099-01-01')).toBe(0);
    expect(nextRow(s, '2026-02-16')!.n).toBe(3);
    expect(nextRow(s, '2099-01-01')).toBeUndefined();
  });

  it('yearly summaries add up to the whole schedule', () => {
    const y = yearlySummary(s.rows);
    expect(y.map((r) => r.year)).toEqual([2026, 2027]); // 24 payments, Jan 2026 through Dec 2027
    expect(y.reduce((a, r) => a + r.payments, 0)).toBe(s.totalPrincipal + s.totalInterest);
    expect(y.at(-1)!.endBalance).toBe(0);
    expect(paymentsInYear(s, 2026)).toBe(12 * $(500));
    expect(paymentsInYear(s, 2030)).toBe(0);
  });

  it('escrow and PMI are added to the displayed monthly total only', () => {
    expect(monthlyTotal({ ...mortgage(), escrowMonthlyCents: $(450), pmiMonthlyCents: $(75) }, 179865)).toBe(179865 + 45000 + 7500);
    expect(monthlyTotal(mortgage(), 100)).toBe(100);
  });

  it('CSV has a header and one line per payment with plain dollar amounts', () => {
    const lines = scheduleToCsv(s).trim().split('\r\n');
    expect(lines[0]).toContain('Payment #,Date,Phase');
    expect(lines).toHaveLength(25);
    expect(lines[1]).toBe('1,2026-01-15,amortizing,0.000,12000.00,0.00,500.00,0.00,0.00,500.00,11500.00');
  });
});
