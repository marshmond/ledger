/**
 * TIMING of one billing period (B2, B0 6.2). PURE. One of five MUTUALLY EXCLUSIVE classes, worked out from days only, never from amounts or
 * payment: a late date cannot change an amount and a payment cannot change timing.
 *
 *   d = days from today to the period's TIMING DATE (positive = in the future)
 *   unclear   two or more different due dates are recorded for the period, or there is no date at all  (checked first)
 *   upcoming  d >= 8        soon  1 <= d <= 7        today  d == 0        past  d <= -1
 *
 * The classes partition every whole number, so "due today" is never hidden by "due soon" (B0 found the earlier draft tested "within 7 days" first).
 */
import { daysBetween } from '../../lib/money';

export const SOON_DAYS = 7;
/** How long after its date an automatic payment may stay unconfirmed before the label asks the owner to check (B0 6.5 P9). */
export const AUTOPAY_GRACE_DAYS = 3;

export type TimingClass = 'unclear' | 'upcoming' | 'soon' | 'today' | 'past';

/** Whole days from `today` to `date` (positive = future). */
export const daysUntil = (date: string, today: string) => daysBetween(date, today);

export function timingClass(days: number | null, unclear: boolean): TimingClass {
  if (unclear || days === null) return 'unclear';
  if (days >= SOON_DAYS + 1) return 'upcoming';
  if (days >= 1) return 'soon';
  if (days === 0) return 'today';
  return 'past';
}

export interface TimingDate {
  date: string | null;
  /** `due`: exactly one recorded due date. `nominal`: the schedule's date. `none`: nothing to go on. `conflict`: different due dates are recorded. */
  source: 'due' | 'nominal' | 'none' | 'conflict';
}

/**
 * The single date timing uses (B0 N7): the one recorded due date if exactly one distinct date exists among the period's effective records,
 * else the nominal date of the period. Different recorded dates are NOT resolved here: the period reads "Due date unclear".
 */
export function timingDate(dueDates: string[], nominal: string | null): TimingDate {
  const distinct = [...new Set(dueDates)].sort();
  if (distinct.length === 1) return { date: distinct[0], source: 'due' };
  if (distinct.length > 1) return { date: nominal, source: 'conflict' };
  return nominal ? { date: nominal, source: 'nominal' } : { date: null, source: 'none' };
}

export interface Timing { class: TimingClass; days: number | null; date: string | null; source: TimingDate['source'] }
export function deriveTiming(dueDates: string[], nominal: string | null, today: string): Timing {
  const t = timingDate(dueDates, nominal);
  const unclear = t.source === 'conflict' || t.source === 'none';
  const days = t.date ? daysUntil(t.date, today) : null;
  return { class: timingClass(days, unclear), days, date: t.date, source: t.source };
}
