/**
 * D11: what the new top of Today (the "Next up" bar, the status band and the phone day strip) shows, as plain data.
 *
 * NOTHING HERE DECIDES WHAT IS OVERDUE, TODAY OR COMING UP. Every number and every item is read from the same functions the cards use
 * (`todayList`, `overdueGroups`, `upcomingDays` in logic.ts), so the band can never disagree with the cards below it. This file only
 * counts and picks the first row of lists that already exist. It has no clock, no time zone and no storage: the caller passes `today`.
 *
 * "Next up" has no rule of its own. It is the FIRST ROW of the existing Coming up list (the days after today, in that list's own order:
 * all-day items first, then by time). The prototype's choice (a timed event ahead of an earlier all-day task) is a new urgency rule and
 * was not built; see docs/LEDGER-SIGNATURE-D11-REPORT.md, "Unresolved decisions".
 */
import { addDays } from '../../lib/dates';
import { dateTileModel, inlineDateText } from '../../ui/dateTileModel';
import type { CalItem } from '../calendar/useCalendarData';
import { overdueGroups, todayList, upcomingDays, type UpcomingDay } from './logic';

export interface TodaySummary {
  /** The same number the Overdue card's badge shows (older items outside the overdue window are not counted, as in the card). */
  overdueTotal: number;
  /** How many of those each module holds, in the Overdue card's own group order. */
  overdueParts: { moduleId: string; count: number }[];
  /** How many rows the Today card lists. */
  todayCount: number;
  /** How many rows the Coming up card lists. */
  upcomingCount: number;
  /** The first and last day Coming up looks at (tomorrow, and today plus the look-ahead setting). */
  upcomingFrom: string;
  upcomingTo: string;
  /** The first row of Coming up, or null when it is empty. */
  next: CalItem | null;
  /** Coming up, grouped by day (the same value the card draws). */
  days: UpcomingDay[];
}

export function summarizeToday(items: CalItem[], today: string, overdueDays: number, lookAheadDays: number): TodaySummary {
  const groups = overdueGroups(items, today, overdueDays);
  const days = upcomingDays(items, today, lookAheadDays);
  return {
    overdueTotal: groups.reduce((n, g) => n + g.items.length, 0),
    overdueParts: groups.map((g) => ({ moduleId: g.moduleId, count: g.items.length })),
    todayCount: todayList(items, today).length,
    upcomingCount: days.reduce((n, d) => n + d.items.length, 0),
    upcomingFrom: addDays(today, 1),
    upcomingTo: addDays(today, Math.max(0, lookAheadDays)),
    next: days[0]?.items[0] ?? null,
    days,
  };
}

/** One cell of the phone day strip: a day after today and how many Coming up rows it has (a dot each, up to three, in the picture only). */
export interface StripCell {
  date: string;
  weekday: string;
  day: string;
  count: number;
  tone: 'default' | 'weekend' | 'tomorrow';
}

/** The next `min(lookAheadDays, 7)` days, starting tomorrow. A day past the look-ahead setting is never drawn, so an empty cell never hides a real item. */
export function stripCells(days: UpcomingDay[], today: string, lookAheadDays: number): StripCell[] {
  const n = Math.max(0, Math.min(7, lookAheadDays));
  const out: StripCell[] = [];
  for (let k = 1; k <= n; k++) {
    const date = addDays(today, k);
    const m = dateTileModel(date, today);
    if (!m) continue;
    out.push({ date, weekday: m.weekday, day: m.day, count: days.find((d) => d.date === date)?.items.length ?? 0, tone: m.tone === 'tomorrow' || m.tone === 'weekend' ? m.tone : 'default' });
  }
  return out;
}

/** The page's date line: a bold weekday and the rest ("November 12, 2026"). Null when `today` is not a real date (the caller then prints it as given). */
export function headingDate(today: string): { weekday: string; rest: string } | null {
  const m = dateTileModel(today, today);
  return m ? { weekday: m.weekdayLong, rest: `${m.monthLong} ${m.day}, ${m.year}` } : null;
}

/** "Tomorrow" or "Wed, Nov 18" for an item's day, from calendar facts only. */
export function nextWhen(date: string, today: string): string {
  const m = dateTileModel(date, today);
  if (!m) return date;
  return m.relative === 'Tomorrow' ? 'Tomorrow' : inlineDateText(date, today) ?? date;
}

/** "Nov 13 to Nov 19" (the years are added only when the two dates are in different years). */
export function rangeText(from: string, to: string): string {
  const a = dateTileModel(from, from);
  const b = dateTileModel(to, from);
  if (!a || !b) return `${from} to ${to}`;
  const part = (x: NonNullable<typeof a>) => `${x.monthLong.slice(0, 3)} ${x.day}`;
  return a.year === b.year ? `${part(a)} to ${part(b)}` : `${part(a)}, ${a.year} to ${part(b)}, ${b.year}`;
}
