/**
 * D13: small decisions the redesigned Calendar screens make, as PURE functions (no React, no clock, no storage, no database).
 *
 * Nothing here decides WHICH records appear or WHEN they fall: that stays with `useCalendarData`, the providers, `occurrences.ts` and the
 * recurrence code. This file only works out how the month grid is cut into weeks, which day is "selected" (the `d` value of the address, which
 * the Calendar has always had), what arrow keys do on the grid, and the words a screen reader hears for a day and for one item.
 * Dates are 'YYYY-MM-DD' strings, as everywhere in Ledger; the weekday comes from UTC arithmetic on the date alone, so the result is the same
 * in every time zone (it never builds a local-time Date).
 */
import { addDays, addMonths, dayOfWeek } from '../../lib/dates';
import { dateTileModel } from '../../ui/dateTileModel';
import { PRIORITY_LABEL } from './model';
import { timeLabel, WEEKDAYS_LONG, WEEKDAYS_SHORT } from './time';
import { onDay, type CalItem } from './useCalendarData';

/** How many items one month cell lists before "+N more" (the rest are one tap away in the selected-day list, never dropped). */
export const MAX_CELL_ITEMS = 3;

/** The 42 days (six weeks) a month grid shows, as six rows of seven. Same cut the grid has always used. */
export function gridWeeks(start: string): string[][] {
  return Array.from({ length: 6 }, (_, w) => Array.from({ length: 7 }, (_, d) => addDays(start, w * 7 + d)));
}

/** Short weekday names in the order of the week the owner chose (0 = Sunday). */
export const weekdayHeads = (weekStart: number): { short: string; long: string }[] =>
  Array.from({ length: 7 }, (_, i) => ({ short: WEEKDAYS_SHORT[(weekStart + i) % 7], long: WEEKDAYS_LONG[(weekStart + i) % 7] }));

/** 'Thursday, November 12, 2026' (the shared date-tile model's own wording, so every date in the app reads the same). */
export const fullDate = (iso: string): string => dateTileModel(iso, iso)?.fullLabel ?? iso;

/** The words for the number of items on a day: 'no items', '1 item', '3 items'. */
export const itemCountWords = (n: number): string => (n === 0 ? 'no items' : n === 1 ? '1 item' : `${n} items`);

/** What assistive technology says for one day number button. Today is spelled out; the grid cell itself carries "selected". */
export function dayButtonName(iso: string, today: string, count: number): string {
  return `${fullDate(iso)}${iso === today ? ', today' : ''}, ${itemCountWords(count)}`;
}

/** How one month cell is described. `shown` are the items drawn in the cell, `more` the number left for the selected-day list. */
export interface CellModel {
  date: string;
  day: number;
  isToday: boolean;
  isSelected: boolean;
  /** Outside the month being viewed (the grey leading and trailing days). */
  isOut: boolean;
  isWeekend: boolean;
  count: number;
  shown: CalItem[];
  more: number;
  /** The first four items, for the dots a phone draws instead of titles. */
  dots: CalItem[];
}

export function cellModel(date: string, opts: { month: string; today: string; selected: string; items: CalItem[]; max?: number }): CellModel {
  const list = onDay(opts.items, date);
  const max = opts.max ?? MAX_CELL_ITEMS;
  // The first `max` items in the day's own order (all-day first, then time); the rest are counted, never dropped.
  const shown = list.slice(0, max);
  const dow = dayOfWeek(date);
  return {
    date, day: Number(date.slice(8, 10)), isToday: date === opts.today, isSelected: date === opts.selected, isOut: date.slice(0, 7) !== opts.month,
    isWeekend: dow === 0 || dow === 6, count: list.length, shown, more: list.length - shown.length, dots: list.slice(0, 4),
  };
}

/**
 * The day an arrow key (or Home, End, PageUp, PageDown) moves the selection to, or null if the key is not one of ours.
 *   Left/Right = one day, Up/Down = one week, Home/End = first/last day of that week (per the first-day-of-week setting),
 *   PageUp/PageDown = the same day of the previous/next month (clamped to that month's length), Shift+PageUp/PageDown = a year.
 */
export function moveSelection(from: string, key: string, weekStart: number, shift = false): string | null {
  switch (key) {
    case 'ArrowLeft': return addDays(from, -1);
    case 'ArrowRight': return addDays(from, 1);
    case 'ArrowUp': return addDays(from, -7);
    case 'ArrowDown': return addDays(from, 7);
    case 'Home': return addDays(from, -((dayOfWeek(from) - weekStart + 7) % 7));
    case 'End': return addDays(from, 6 - ((dayOfWeek(from) - weekStart + 7) % 7));
    case 'PageUp': return addMonths(from, shift ? -12 : -1);
    case 'PageDown': return addMonths(from, shift ? 12 : 1);
    default: return null;
  }
}

/** Where the month's selection goes when the owner steps to the previous or next month: the same day of the month, clamped (Jan 31 + 1 month = Feb 28 or 29). */
export const stepMonth = (anchor: string, dir: 1 | -1): string => addMonths(anchor, dir);

/** The tone a day gets in the grid, in words (also used as a class): today beats weekend; selected is separate (both can be true). */
export const dayTone = (c: Pick<CellModel, 'isToday' | 'isWeekend' | 'isOut'>): 'today' | 'weekend' | 'out' | 'plain' =>
  c.isToday ? 'today' : c.isOut ? 'out' : c.isWeekend ? 'weekend' : 'plain';

/** 'All day' or the start time, as the item is listed. */
export const whenWords = (i: Pick<CalItem, 'allDay' | 'startMs'>): string => (i.allDay ? 'All day' : timeLabel(i.startMs));

/**
 * The accessible name of one item (a chip, an agenda row, a block): its title first, then when, which calendar it comes from, and the flags
 * that colour alone cannot carry. Automatic items (worked out from another part of Ledger) say so.
 */
export function itemAccessibleName(i: CalItem): string {
  const parts = [i.title, whenWords(i), `${i.layerName} calendar${i.derived ? ' (automatic, read-only)' : ''}`];
  if (i.priority !== 'medium') parts.push(`${PRIORITY_LABEL[i.priority]} priority`);
  if (i.recurring) parts.push('repeats');
  if (i.overdue) parts.push('overdue');
  if (i.soon) parts.push('due soon');
  if (i.done && !i.derived) parts.push('done');
  if (i.project) parts.push(`project ${i.project.label}`);
  return parts.join(', ');
}

/** The line under the page title: today's date with the weekday first, e.g. 'Thursday · November 12, 2026'. */
export function contextLine(today: string): { weekday: string; rest: string } {
  const full = fullDate(today);
  const i = full.indexOf(', ');
  return { weekday: full.slice(0, i), rest: full.slice(i + 2) };
}

/** The words after the selected date in the side list: 'Today', 'Tomorrow', 'Yesterday' or nothing. */
export function relativeWord(iso: string, today: string): 'Today' | 'Tomorrow' | 'Yesterday' | null {
  return iso === today ? 'Today' : iso === addDays(today, 1) ? 'Tomorrow' : iso === addDays(today, -1) ? 'Yesterday' : null;
}
