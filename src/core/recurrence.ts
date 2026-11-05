/**
 * Repeat rules, worked out on plain dates ('YYYY-MM-DD') so nothing depends on a time zone.
 * Month-end clamping matches Ledger's scheduled items: a rule on the 31st lands on the last day of shorter months
 * (it uses the same `addMonths` Ledger uses). Yearly repeats step by 12 months the same way (Feb 29 -> Feb 28 in other years).
 */
import { addDays, addMonths, daysInMonth, dayOfWeek } from '../lib/dates';
import { daysBetween } from '../lib/money';
import { WEEKDAYS_LONG, WEEKDAYS_SHORT } from './time';

export type RecurrenceEnd = { type: 'never' } | { type: 'until'; date: string } | { type: 'count'; count: number };

export interface Recurrence {
  freq: 'daily' | 'weekly' | 'monthly' | 'yearly';
  /** Every N days/weeks/months/years. At least 1. */
  interval: number;
  /** Weekly: which days (0 = Sunday). Empty/missing = the start date's weekday. */
  byWeekday?: number[];
  /** Monthly: on the same date (clamped), on the same "2nd Tuesday", or on the last such weekday. */
  monthly?: 'date' | 'nth' | 'last';
  end: RecurrenceEnd;
}

const CAP = 20000;

/** "2nd Tuesday" of the month a date is in: [2, 2]. The 5th counts as 4 (use 'last' for "last Tuesday"). */
export function nthOfMonth(date: string): { nth: number; weekday: number } {
  const day = Number(date.slice(8, 10));
  return { nth: Math.min(4, Math.ceil(day / 7)), weekday: dayOfWeek(date) };
}

/** The date of the nth (1-4) or last (-1) given weekday in a month. */
export function nthWeekdayDate(year: number, month1: number, weekday: number, nth: number): string {
  const mm = String(month1).padStart(2, '0');
  const dim = daysInMonth(year, month1);
  let day: number;
  if (nth < 0) {
    const lastDow = dayOfWeek(`${year}-${mm}-${String(dim).padStart(2, '0')}`);
    day = dim - ((lastDow - weekday + 7) % 7);
  } else {
    const firstDow = dayOfWeek(`${year}-${mm}-01`);
    day = 1 + ((weekday - firstDow + 7) % 7) + (nth - 1) * 7;
  }
  return `${year}-${mm}-${String(day).padStart(2, '0')}`;
}

/** Candidate dates in order, starting no earlier than needed to reach `from` (never yields before `start`). */
function* candidates(start: string, r: Recurrence, from: string, skipAhead: boolean): Generator<string> {
  const n = Math.max(1, Math.floor(r.interval) || 1);
  const startDay = Number(start.slice(8, 10));
  switch (r.freq) {
    case 'daily': {
      const k0 = skipAhead ? Math.max(0, Math.floor(daysBetween(from, start) / n)) : 0;
      for (let k = k0; k < CAP; k++) yield addDays(start, k * n);
      return;
    }
    case 'weekly': {
      const days = [...new Set(r.byWeekday?.length ? r.byWeekday : [dayOfWeek(start)])].sort((a, b) => a - b);
      const anchor = addDays(start, -dayOfWeek(start));
      const k0 = skipAhead ? Math.max(0, Math.floor(daysBetween(from, anchor) / (7 * n)) - 1) : 0;
      for (let k = k0; k < CAP; k++) {
        const weekStart = addDays(anchor, 7 * n * k);
        for (const wd of days) {
          const d = addDays(weekStart, wd);
          if (d >= start) yield d;
        }
      }
      return;
    }
    case 'monthly': {
      const monthsBetween = (Number(from.slice(0, 4)) - Number(start.slice(0, 4))) * 12 + Number(from.slice(5, 7)) - Number(start.slice(5, 7));
      const k0 = skipAhead ? Math.max(0, Math.floor(monthsBetween / n) - 1) : 0;
      const mode = r.monthly ?? 'date';
      const { nth, weekday } = nthOfMonth(start);
      for (let k = k0; k < CAP; k++) {
        if (mode === 'date') yield addMonths(start, k * n, startDay);
        else {
          const first = addMonths(`${start.slice(0, 7)}-01`, k * n, 1);
          const d = nthWeekdayDate(Number(first.slice(0, 4)), Number(first.slice(5, 7)), weekday, mode === 'last' ? -1 : nth);
          if (d >= start) yield d;
        }
      }
      return;
    }
    case 'yearly': {
      const k0 = skipAhead ? Math.max(0, Math.floor((Number(from.slice(0, 4)) - Number(start.slice(0, 4))) / n) - 1) : 0;
      for (let k = k0; k < CAP; k++) yield addMonths(start, 12 * k * n, startDay);
      return;
    }
  }
}

/** Every date in [from, to] on which the series starting on `start` has an occurrence, honouring how it ends. */
export function generateDates(start: string, r: Recurrence, from: string, to: string): string[] {
  const last = r.end.type === 'until' && r.end.date < to ? r.end.date : to;
  const out: string[] = [];
  const counted = r.end.type === 'count';
  let seen = 0;
  for (const d of candidates(start, r, from, !counted)) {
    if (d > last) break;
    if (counted && ++seen > (r.end as { count: number }).count) break;
    if (d >= from) out.push(d);
  }
  return out;
}

/** How many occurrences come strictly before `key` (counted from the start). */
export function occurrencesBefore(start: string, r: Recurrence, key: string): number {
  return generateDates(start, { ...r, end: r.end.type === 'count' ? r.end : { type: 'never' } }, start, addDays(key, -1)).length;
}

/** The last occurrence strictly before `key`, or null. */
export function previousOccurrence(start: string, r: Recurrence, key: string): string | null {
  const all = generateDates(start, r, start, addDays(key, -1));
  return all.length ? all[all.length - 1] : null;
}

const ordinal = (n: number) => (n === -1 ? 'last' : ['', '1st', '2nd', '3rd', '4th'][n] ?? `${n}th`);

/** A plain-language summary such as "Every 2 weeks on Mon, Wed, until Dec 31, 2027". */
export function describeRule(r: Recurrence, start: string): string {
  const n = Math.max(1, r.interval || 1);
  let s: string;
  switch (r.freq) {
    case 'daily': s = n === 1 ? 'Every day' : `Every ${n} days`; break;
    case 'weekly': {
      const days = (r.byWeekday?.length ? [...r.byWeekday].sort((a, b) => a - b) : [dayOfWeek(start)]).map((d) => WEEKDAYS_SHORT[d]).join(', ');
      s = `${n === 1 ? 'Every week' : `Every ${n} weeks`} on ${days}`;
      break;
    }
    case 'monthly': {
      const { nth, weekday } = nthOfMonth(start);
      const mode = r.monthly ?? 'date';
      const where = mode === 'date' ? `on day ${Number(start.slice(8, 10))}` : `on the ${ordinal(mode === 'last' ? -1 : nth)} ${WEEKDAYS_LONG[weekday]}`;
      s = `${n === 1 ? 'Every month' : `Every ${n} months`} ${where}`;
      break;
    }
    case 'yearly': s = n === 1 ? 'Every year' : `Every ${n} years`; break;
  }
  if (r.end.type === 'until') s += `, until ${r.end.date}`;
  else if (r.end.type === 'count') s += `, ${r.end.count} time${r.end.count === 1 ? '' : 's'}`;
  return s;
}

/** Clean copy of a rule with sane values (used when reading stored data and when saving). */
export function normalizeRule(r: Partial<Recurrence> | null | undefined): Recurrence | null {
  if (!r || !r.freq || !['daily', 'weekly', 'monthly', 'yearly'].includes(r.freq)) return null;
  const end: RecurrenceEnd =
    r.end?.type === 'until' && /^\d{4}-\d{2}-\d{2}$/.test(r.end.date) ? { type: 'until', date: r.end.date }
    : r.end?.type === 'count' && r.end.count >= 1 ? { type: 'count', count: Math.min(1000, Math.floor(r.end.count)) }
    : { type: 'never' };
  return {
    freq: r.freq,
    interval: Math.min(999, Math.max(1, Math.floor(r.interval ?? 1) || 1)),
    ...(r.freq === 'weekly' && r.byWeekday?.length ? { byWeekday: [...new Set(r.byWeekday.filter((d) => d >= 0 && d <= 6))].sort((a, b) => a - b) } : {}),
    ...(r.freq === 'monthly' ? { monthly: r.monthly === 'nth' || r.monthly === 'last' ? r.monthly : 'date' } : {}),
    end,
  };
}
