/**
 * Family Management F2: where a yearly `MM-DD` falls in a given year, and which of those dates lie inside a Calendar window. PURE: plain
 * `YYYY-MM-DD` strings only, no clock, no time zone, no `Date` object. An all-day date is a calendar date, so daylight-saving changes and
 * UTC+14 / UTC-11 devices cannot move it.
 *
 * FEBRUARY 29 (the documented policy). The Calendar's own yearly repeat steps 12 months at a time with month-end clamping (`addMonths`, see
 * `core/recurrence.ts`), so a series that starts on 29 February lands on 28 February in a year without one and on 29 February in a leap year.
 * Family uses exactly that rule, so a leap-day birthday and a stored yearly Birthday event started on 29 February fall on the same day every year
 * (a test compares the two). 1 March is NOT used.
 *
 * Nothing here is stored: the dates are worked out for the requested window every time.
 */
import { daysInMonth } from '../../lib/dates';
import { validMonthDay } from './model';

const ISO = /^\d{4}-\d{2}-\d{2}$/;
/** A real `YYYY-MM-DD` (month and day exist). */
export const isIsoDate = (s: unknown): s is string => {
  if (typeof s !== 'string' || !ISO.test(s)) return false;
  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(5, 7));
  const d = Number(s.slice(8, 10));
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
};

/** The date `monthDay` falls on in `year`: 29 February becomes 28 February in a year that has no 29 February. Empty string for an invalid month-day. */
export function dateInYear(monthDay: string, year: number): string {
  if (!validMonthDay(monthDay) || !Number.isInteger(year) || year < 1 || year > 9999) return '';
  const month = Number(monthDay.slice(0, 2));
  const day = Math.min(Number(monthDay.slice(3)), daysInMonth(year, month));
  return `${String(year).padStart(4, '0')}-${monthDay.slice(0, 2)}-${String(day).padStart(2, '0')}`;
}

/** The widest window ever expanded (in years), so a damaged or hostile range cannot make a provider loop for long. */
export const MAX_SPAN_YEARS = 60;

/** Every date `monthDay` falls on from `from` to `to` (both inclusive), oldest first. Empty for an invalid month-day or range. */
export function datesInRange(monthDay: string, from: string, to: string): string[] {
  if (!validMonthDay(monthDay) || !isIsoDate(from) || !isIsoDate(to) || from > to) return [];
  const y0 = Number(from.slice(0, 4));
  const y1 = Number(to.slice(0, 4));
  if (y1 - y0 > MAX_SPAN_YEARS) return [];
  const out: string[] = [];
  for (let y = y0; y <= y1; y++) {
    const d = dateInYear(monthDay, y);
    if (d && d >= from && d <= to) out.push(d);
  }
  return out;
}

/** The first date on or after `today` that `monthDay` falls on (this year's, or next year's if it has passed). Empty for an invalid input. */
export function nextOccurrence(monthDay: string, today: string): string {
  if (!isIsoDate(today)) return '';
  const y = Number(today.slice(0, 4));
  const thisYear = dateInYear(monthDay, y);
  if (thisYear && thisYear >= today) return thisYear;
  return dateInYear(monthDay, y + 1);
}
