/**
 * The schedule as the form edits it (pure; no screen code). One draft becomes one `Schedule`, so the add form, the edit form and Quick Add
 * cannot disagree about what "every 2 months" or "the last business day" means. The person picks a pattern and the date of the NEXT bill; the
 * weekday, the day of the month and the anchor month all come from that one date.
 */
import { addMonths, dayOfWeek, endOfMonth, lastBusinessDay, monthOf, daysInMonth } from '../../lib/dates';
import type { Adjust, Semimonthly, Slot } from '../../lib/semimonthly';
import { isDate, isInt } from './util';
import { nextExpected, scheduleProblem, type ExpectedDate, type Schedule } from './schedule';

export type Pattern = 'weekly' | 'every2weeks' | 'every4weeks' | 'everyNweeks' | 'monthly' | 'every2months' | 'quarterly' | 'every6months' | 'yearly' | 'everyNmonths' | 'twice' | 'ondemand';
export const PATTERN_LABEL: Record<Pattern, string> = {
  monthly: 'Monthly', weekly: 'Every week', every2weeks: 'Every 2 weeks', every4weeks: 'Every 4 weeks', everyNweeks: 'Every N weeks…', every2months: 'Every 2 months', quarterly: 'Every 3 months (quarterly)',
  every6months: 'Every 6 months', yearly: 'Once a year', everyNmonths: 'Every N months…', twice: 'Twice a month (two set days)', ondemand: 'No regular schedule (on demand)',
};
export const PATTERN_ORDER: Pattern[] = ['monthly', 'weekly', 'every2weeks', 'every4weeks', 'everyNweeks', 'every2months', 'quarterly', 'every6months', 'yearly', 'everyNmonths', 'twice', 'ondemand'];
export type DayKind = 'day' | 'lastDay' | 'lastBusinessDay';

export interface ScheduleDraft {
  pattern: Pattern;
  /** The N of "every N weeks" or "every N months". */
  n: number;
  /** The date of the next bill (weekly and monthly patterns) or any date in the first month (twice a month). */
  first: string;
  /** Monthly patterns: a day of the month, the last day, or the last business day. */
  dayKind: DayKind;
  adjust: Adjust;
  semi: Semimonthly;
}

export const DEFAULT_SEMI: Semimonthly = { a: { kind: 'day', day: 1, adjust: 'none' }, b: { kind: 'day', day: 15, adjust: 'none' } };
export const blankDraft = (today: string): ScheduleDraft => ({ pattern: 'monthly', n: 2, first: today, dayKind: 'day', adjust: 'none', semi: DEFAULT_SEMI });

const WEEK_N: Record<number, Pattern> = { 1: 'weekly', 2: 'every2weeks', 4: 'every4weeks' };
const MONTH_N: Record<number, Pattern> = { 1: 'monthly', 2: 'every2months', 3: 'quarterly', 6: 'every6months', 12: 'yearly' };
const pad = (n: number) => String(n).padStart(2, '0');

export function draftOfSchedule(s: Schedule | null, today: string): ScheduleDraft {
  const base = blankDraft(today);
  if (!s) return { ...base, pattern: 'ondemand' };
  if (s.kind === 'weeks') return { ...base, pattern: WEEK_N[s.every] ?? 'everyNweeks', n: s.every, first: s.anchorDate };
  if (s.kind === 'twice-monthly') return { ...base, pattern: 'twice', semi: s.semi, first: `${s.anchorMonth}-01` };
  const [y, m] = s.anchorMonth.split('-').map(Number);
  const first = s.slot.kind === 'lastDay' ? endOfMonth(s.anchorMonth) : s.slot.kind === 'lastBusinessDay' ? lastBusinessDay(s.anchorMonth) : `${s.anchorMonth}-${pad(Math.min(s.slot.day ?? 1, daysInMonth(y, m)))}`;
  return { ...base, pattern: MONTH_N[s.every] ?? 'everyNmonths', n: s.every, first, dayKind: s.slot.kind, adjust: s.slot.adjust ?? 'none' };
}

const weeksOf = (d: ScheduleDraft) => (d.pattern === 'weekly' ? 1 : d.pattern === 'every2weeks' ? 2 : d.pattern === 'every4weeks' ? 4 : d.n);
const monthsOf = (d: ScheduleDraft) => (d.pattern === 'monthly' ? 1 : d.pattern === 'every2months' ? 2 : d.pattern === 'quarterly' ? 3 : d.pattern === 'every6months' ? 6 : d.pattern === 'yearly' ? 12 : d.n);
export const isWeekly = (p: Pattern) => p === 'weekly' || p === 'every2weeks' || p === 'every4weeks' || p === 'everyNweeks';
export const isMonthly = (p: Pattern) => p === 'monthly' || p === 'every2months' || p === 'quarterly' || p === 'every6months' || p === 'yearly' || p === 'everyNmonths';

/** The schedule a draft means, or null for "no regular schedule". Does not check that it is valid (see `draftProblem`). */
export function scheduleOfDraft(d: ScheduleDraft): Schedule | null {
  if (d.pattern === 'ondemand') return null;
  if (isWeekly(d.pattern)) return { kind: 'weeks', every: weeksOf(d), weekday: isDate(d.first) ? dayOfWeek(d.first) : 0, anchorDate: d.first };
  const anchorMonth = isDate(d.first) ? monthOf(d.first) : '';
  if (d.pattern === 'twice') return { kind: 'twice-monthly', semi: d.semi, anchorMonth };
  const slot: Slot = d.dayKind === 'day' ? { kind: 'day', day: isDate(d.first) ? Number(d.first.slice(8, 10)) : 1, adjust: d.adjust } : { kind: d.dayKind };
  return { kind: 'months', every: monthsOf(d), slot, anchorMonth };
}

/** A plain-words problem with the schedule as drafted, or null. The same strict check that runs when it is saved. */
export function draftProblem(d: ScheduleDraft): string | null {
  if (d.pattern === 'ondemand') return null;
  if (!isDate(d.first)) return d.pattern === 'twice' ? 'Pick the month the schedule starts in.' : 'Pick the date of the next bill.';
  if ((d.pattern === 'everyNweeks' || d.pattern === 'everyNmonths') && !isInt(d.n)) return 'Enter a whole number.';
  const s = scheduleOfDraft(d);
  return s ? scheduleProblem(s) : null;
}

/** The next few expected dates a draft gives, from the tracking start date (or today if later). Empty when the draft has a problem. */
export function previewDraft(d: ScheduleDraft, trackingSince: string, today: string, n = 3): ExpectedDate[] {
  if (draftProblem(d)) return [];
  const s = scheduleOfDraft(d);
  if (!s) return [];
  return nextExpected({ schedule: s, scheduleHistory: [], trackingSince, pauses: [], status: 'active', endedOn: null }, today, n);
}

/** The first date on or after `today` that falls on day `day` of the month, `step` months at a time (day past a short month's end clamps). */
export function firstDayOnOrAfter(today: string, day: number, step = 1): string {
  const month = today.slice(0, 7);
  const [y, m] = month.split('-').map(Number);
  const here = `${month}-${pad(Math.min(day, daysInMonth(y, m)))}`;
  return here >= today ? here : addMonths(`${month}-01`, step, day);
}
