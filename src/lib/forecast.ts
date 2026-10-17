import { addDays, addMonths } from './dates';

/**
 * Cash-flow forecast: starting from the cash you have, apply every paycheck, scheduled bill, loan payment, tax payment or refund,
 * one-off item, and an estimate of everyday spending, day by day for the next several months. Pure functions. Money in cents.
 * It is a projection built from your own data and assumptions; it does not know about things you have not entered.
 */

export type ForecastKind = 'income' | 'bill' | 'loan' | 'tax' | 'spending' | 'oneoff';

export interface ForecastEvent {
  date: string;
  label: string;
  /** Signed: money in is positive. */
  cents: number;
  kind: ForecastKind;
}

export interface ForecastInput {
  today: string;
  months: number;
  startCents: number;
  pay: { date: string; label: string; netCents: number }[];
  scheduled: { date: string; label: string; cents: number }[];
  loans: { date: string; label: string; paymentCents: number }[];
  taxes: { date: string; label: string; cents: number }[];
  oneOffs: { date: string; label: string; cents: number }[];
  /** Typical spending per month that is not a scheduled bill or loan payment (positive number). */
  everydayMonthlyCents: number;
  /** Money that arrives on the first of each month and is not a paycheck (rent from a tenant, a pension, ...). */
  otherIncomeMonthlyCents: number;
}

export interface ForecastMonth {
  month: string;
  startCents: number;
  incomeCents: number;
  billsCents: number;
  loansCents: number;
  taxesCents: number;
  spendingCents: number;
  oneOffCents: number;
  endCents: number;
  lowCents: number;
  lowDate: string;
}

export interface RunningEvent extends ForecastEvent {
  balanceCents: number;
}

export interface ForecastResult {
  months: ForecastMonth[];
  events: RunningEvent[];
  low: { date: string; balanceCents: number };
  endCents: number;
  /** The first day the balance is below the threshold, if it ever is. */
  firstBelow: { date: string; balanceCents: number } | null;
  /** Every dollar in and out over the whole period. */
  totalIn: number;
  totalOut: number;
}

/** The dated events a forecast is made of, in order (everyday spending is spread over the weeks). */
export function expandEvents(i: ForecastInput): ForecastEvent[] {
  const end = addMonths(`${i.today.slice(0, 7)}-01`, i.months);
  const inRange = (d: string) => d > i.today && d < end;
  const out: ForecastEvent[] = [];
  for (const p of i.pay) if (inRange(p.date) && p.netCents !== 0) out.push({ date: p.date, label: p.label, cents: p.netCents, kind: 'income' });
  for (const s of i.scheduled) if (inRange(s.date) && s.cents !== 0) out.push({ date: s.date, label: s.label, cents: s.cents, kind: 'bill' });
  for (const l of i.loans) if (inRange(l.date) && l.paymentCents !== 0) out.push({ date: l.date, label: l.label, cents: -Math.abs(l.paymentCents), kind: 'loan' });
  for (const t of i.taxes) if (inRange(t.date) && t.cents !== 0) out.push({ date: t.date, label: t.label, cents: t.cents, kind: 'tax' });
  for (const o of i.oneOffs) if (inRange(o.date) && o.cents !== 0) out.push({ date: o.date, label: o.label, cents: o.cents, kind: 'oneoff' });
  if (i.otherIncomeMonthlyCents !== 0) {
    for (let k = 0; k <= i.months; k++) {
      const d = addMonths(`${i.today.slice(0, 7)}-01`, k);
      if (inRange(d)) out.push({ date: d, label: 'Other monthly income', cents: i.otherIncomeMonthlyCents, kind: 'income' });
    }
  }
  if (i.everydayMonthlyCents > 0) {
    const weekly = Math.round((i.everydayMonthlyCents * 12) / 52);
    for (let d = addDays(i.today, 7); d < end; d = addDays(d, 7)) out.push({ date: d, label: 'Everyday spending', cents: -weekly, kind: 'spending' });
  }
  const order: Record<ForecastKind, number> = { income: 0, oneoff: 1, tax: 2, loan: 3, bill: 4, spending: 5 };
  return out.sort((a, b) => a.date.localeCompare(b.date) || order[a.kind] - order[b.kind] || a.label.localeCompare(b.label));
}

export function runForecast(i: ForecastInput, thresholdCents = 0): ForecastResult {
  const events = expandEvents(i);
  const months: ForecastMonth[] = [];
  const running: RunningEvent[] = [];
  let bal = i.startCents;
  let low = { date: i.today, balanceCents: bal };
  let firstBelow: ForecastResult['firstBelow'] = bal < thresholdCents ? { date: i.today, balanceCents: bal } : null;
  let totalIn = 0;
  let totalOut = 0;

  for (let k = 0; k < i.months; k++) {
    const month = addMonths(`${i.today.slice(0, 7)}-01`, k).slice(0, 7);
    months.push({ month, startCents: 0, incomeCents: 0, billsCents: 0, loansCents: 0, taxesCents: 0, spendingCents: 0, oneOffCents: 0, endCents: 0, lowCents: Infinity, lowDate: '' });
  }
  const byMonth = new Map(months.map((m) => [m.month, m]));
  let prevEnd = i.startCents;
  months.forEach((m) => { m.startCents = 0; });

  let mi = 0;
  const closeMonth = (m: ForecastMonth) => {
    m.endCents = bal;
    if (m.lowCents === Infinity) {
      m.lowCents = m.startCents;
      m.lowDate = `${m.month}-01`;
    }
  };
  let cur = months[0];
  cur.startCents = prevEnd;
  cur.lowCents = bal;
  cur.lowDate = i.today;

  for (const e of events) {
    const em = e.date.slice(0, 7);
    while (cur && cur.month < em && mi < months.length - 1) {
      closeMonth(cur);
      prevEnd = bal;
      mi++;
      cur = months[mi];
      cur.startCents = prevEnd;
      cur.lowCents = bal;
      cur.lowDate = `${cur.month}-01`;
    }
    const m = byMonth.get(em);
    bal += e.cents;
    running.push({ ...e, balanceCents: bal });
    if (e.cents > 0) totalIn += e.cents;
    else totalOut += -e.cents;
    if (m) {
      if (e.kind === 'income') m.incomeCents += e.cents;
      else if (e.kind === 'bill') m.billsCents += e.cents;
      else if (e.kind === 'loan') m.loansCents += e.cents;
      else if (e.kind === 'tax') m.taxesCents += e.cents;
      else if (e.kind === 'spending') m.spendingCents += e.cents;
      else m.oneOffCents += e.cents;
      if (bal < m.lowCents) {
        m.lowCents = bal;
        m.lowDate = e.date;
      }
    }
    if (bal < low.balanceCents) low = { date: e.date, balanceCents: bal };
    if (!firstBelow && bal < thresholdCents) firstBelow = { date: e.date, balanceCents: bal };
  }
  while (mi < months.length) {
    closeMonth(months[mi]);
    mi++;
    if (mi < months.length) {
      months[mi].startCents = bal;
      months[mi].lowCents = bal;
      months[mi].lowDate = `${months[mi].month}-01`;
    }
  }
  return { months, events: running, low, endCents: bal, firstBelow, totalIn, totalOut };
}
