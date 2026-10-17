import { daysBetween } from './money';

/**
 * Key dates gathered from across the app (RSU vests, tax payment deadlines, RMDs, pay caps, scheduled bills, loan payments),
 * shown on Home and exportable as an iCalendar (.ics) file for a phone or computer calendar. Pure functions.
 */

export type CalKind = 'vest' | 'tax' | 'rmd' | 'cap' | 'bill' | 'loan' | 'year-end';

export interface CalEvent {
  id: string;
  date: string;
  title: string;
  detail: string;
  kind: CalKind;
  /** Where in the app to go about it. */
  to: string;
}

export interface CalendarInput {
  today: string;
  /** Only dates within this many days ahead are included. */
  horizonDays: number;
  vests: { id: string; date: string; label: string; grossCents: number; person: string }[];
  /** Pay caps reached during the year, from the payroll projection. */
  milestones: { id: string; date: string; label: string; person: string }[];
  /** A federal shortfall to pay by estimated payments: the due dates and the total. */
  estimated: { dueDates: string[]; amountCents: number } | null;
  rmds: { person: string; year: number }[];
  scheduled: { id: string; date: string; payee: string; amountCents: number }[];
  loans: { id: string; date: string; name: string; paymentCents: number }[];
  /** Add a December 31 reminder to review year-end tax moves. */
  yearEndYears: number[];
  fmt: (cents: number) => string;
}

export function buildCalendar(i: CalendarInput): CalEvent[] {
  const out: CalEvent[] = [];
  const inRange = (d: string) => d >= i.today && daysBetween(d, i.today) <= i.horizonDays;
  const add = (e: CalEvent) => inRange(e.date) && out.push(e);

  for (const v of i.vests) add({ id: `vest-${v.id}`, date: v.date, title: `RSU vest: ${v.label}`, detail: `${v.person}: about ${i.fmt(v.grossCents)} before tax. It counts as wages.`, kind: 'vest', to: '/income' });
  for (const m of i.milestones) add({ id: `cap-${m.id}`, date: m.date, title: `${m.person}: ${m.label}`, detail: 'Your take-home changes after this paycheck.', kind: 'cap', to: '/income' });
  if (i.estimated && i.estimated.amountCents > 0) {
    for (const d of i.estimated.dueDates) add({ id: `est-${d}`, date: d, title: 'Estimated tax payment due', detail: `You are on track to owe about ${i.fmt(i.estimated.amountCents)} in federal tax beyond withholding. Pay some or all, or add withholding.`, kind: 'tax', to: '/taxplan' });
  }
  for (const r of i.rmds) add({ id: `rmd-${r.person}-${r.year}`, date: `${r.year}-12-31`, title: `${r.person}: required minimum distribution due`, detail: 'Take the full amount from your IRA(s) by this date.', kind: 'rmd', to: '/taxplan' });
  for (const y of i.yearEndYears) add({ id: `ye-${y}`, date: `${y}-12-31`, title: 'Last day for year-end tax moves', detail: 'Retirement and HSA contributions, harvesting losses, Roth conversions, and charitable gifts for the year.', kind: 'year-end', to: '/taxplan' });
  for (const s of i.scheduled) add({ id: `bill-${s.id}-${s.date}`, date: s.date, title: `${s.payee} ${i.fmt(Math.abs(s.amountCents))}`, detail: 'Scheduled item to approve.', kind: 'bill', to: '/scheduled' });
  for (const l of i.loans) add({ id: `loan-${l.id}-${l.date}`, date: l.date, title: `${l.name} payment ${i.fmt(l.paymentCents)}`, detail: 'Loan payment due.', kind: 'loan', to: '/debt' });
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
}

// ---------- iCalendar export ----------

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const compact = (d: string) => d.replace(/-/g, '');

/** Lines longer than 75 bytes are folded onto continuation lines that start with a space (RFC 5545). */
function fold(line: string): string[] {
  const bytes = new TextEncoder();
  if (bytes.encode(line).length <= 75) return [line];
  const out: string[] = [];
  let cur = '';
  for (const ch of line) {
    const limit = out.length === 0 ? 75 : 74; // continuation lines start with a space
    if (bytes.encode(cur + ch).length > limit) {
      out.push(out.length === 0 ? cur : ' ' + cur);
      cur = ch;
    } else cur += ch;
  }
  out.push(out.length === 0 ? cur : ' ' + cur);
  return out;
}

const nextDay = (d: string) => {
  const t = new Date(d + 'T00:00:00Z');
  t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString().slice(0, 10);
};

/** An .ics file with one all-day event per item (money and tax items also get a reminder the day before). */
export function toIcs(events: CalEvent[], nowIso: string): string {
  const stamp = nowIso.replace(/[-:]/g, '').replace(/\.\d+/, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Ledger//Key dates//EN', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Ledger key dates'];
  for (const e of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.id}@ledger.local`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${compact(e.date)}`,
      `DTEND;VALUE=DATE:${compact(nextDay(e.date))}`,
      `SUMMARY:${esc(e.title)}`,
      `DESCRIPTION:${esc(e.detail)}`,
    );
    if (e.kind !== 'bill' && e.kind !== 'cap') lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(e.title)}`, 'TRIGGER:-P1D', 'END:VALARM');
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.flatMap(fold).join('\r\n') + '\r\n';
}
