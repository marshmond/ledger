/**
 * What a date tile shows, as plain data (D6). Pure: no clock, no time zone, no Intl. Dates are 'YYYY-MM-DD' strings, as everywhere in Ledger, and the
 * weekday is worked out in UTC from the year, month and day alone, so the result is the same in every time zone and on every device.
 *
 * It decides only how a date LOOKS. It never decides whether something is overdue or special: the caller passes `overdue` and `special` from the
 * module's own rules (a Task's overdue test, a Family important date), and this function only uses what it is told. Today, tomorrow and weekend are
 * calendar facts worked out here from `today`, which the caller also passes (use the app's own `todayISO`).
 */
import { addDays, dayOfWeek } from '../lib/dates';

export type DateTone = 'default' | 'weekend' | 'tomorrow' | 'today' | 'special' | 'overdue';

export interface DateTileModel {
  iso: string;
  /** 'WED' */
  weekday: string;
  /** 'Wednesday' */
  weekdayLong: string;
  /** '11' (no leading zero) */
  day: string;
  /** 'NOV' */
  month: string;
  /** 'November' */
  monthLong: string;
  year: number;
  /** 'Wednesday, November 11, 2026': the date in full, for assistive technology and tooltips */
  fullLabel: string;
  /** The words for a relative day, or null. Used in the full label so the meaning of a tone is also in text. */
  relative: 'Today' | 'Tomorrow' | 'Yesterday' | null;
  tone: DateTone;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** True for a real calendar date written 'YYYY-MM-DD'. */
export function isIsoDate(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/**
 * Null when `iso` or `today` is not a real date (the component then draws nothing rather than a wrong date).
 * Precedence of tone: overdue, special, today, tomorrow, weekend, default. A passed-in `overdue` or `special` always wins over the calendar facts.
 */
export function dateTileModel(iso: string, today: string, opts: { overdue?: boolean; special?: boolean } = {}): DateTileModel | null {
  if (!isIsoDate(iso) || !isIsoDate(today)) return null;
  const [y, m, d] = iso.split('-').map(Number);
  const dow = dayOfWeek(iso);
  const relative = iso === today ? 'Today' : iso === addDays(today, 1) ? 'Tomorrow' : iso === addDays(today, -1) ? 'Yesterday' : null;
  const tone: DateTone = opts.overdue ? 'overdue' : opts.special ? 'special' : iso === today ? 'today' : iso === addDays(today, 1) ? 'tomorrow' : dow === 0 || dow === 6 ? 'weekend' : 'default';
  return {
    iso,
    weekday: WEEKDAYS[dow].slice(0, 3).toUpperCase(),
    weekdayLong: WEEKDAYS[dow],
    day: String(d),
    month: MONTHS[m - 1].slice(0, 3).toUpperCase(),
    monthLong: MONTHS[m - 1],
    year: y,
    fullLabel: `${WEEKDAYS[dow]}, ${MONTHS[m - 1]} ${d}, ${y}`,
    relative,
    tone,
  };
}

/** The compact form for dense lists: 'Wed, Nov 11', or 'Wed, Nov 11, 2027' when the year is not the year of `today`. */
export function inlineDateText(iso: string, today: string): string | null {
  const m = dateTileModel(iso, today);
  if (!m) return null;
  const same = m.iso.slice(0, 4) === today.slice(0, 4);
  return `${m.weekday[0]}${m.weekday.slice(1).toLowerCase()}, ${m.monthLong.slice(0, 3)} ${m.day}${same ? '' : `, ${m.year}`}`;
}
