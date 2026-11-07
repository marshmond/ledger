/**
 * The schedule as the forms edit it (pure; no screen code). One draft becomes one `Cadence`, so the arrangement form and the Change
 * schedule dialog cannot disagree about what "every 2 weeks" or "twice a month" means.
 *   biweekly    = the existing weekly rule with interval 2 and ONE named weekday (the weekday of the first date). Exactly 14 days apart.
 *   semimonthly = two day-rules kept on the cadence (see `semimonthly.ts`); the visit Task has no repeat.
 *   other       = the existing Repeat controls (weekly, monthly, every 3 months, after each visit ...), unchanged.
 */
import type { Recurrence } from '../../core/recurrence';
import { addDays, dayOfWeek } from '../../lib/dates';
import { cadenceBetween, validateArrangement, normalizeArrangement, blankArrangement, withExplicitWeekday, type Cadence } from './model';
import { canonicalSemi, semiNext, type Semimonthly } from './semimonthly';

export type CadenceKind = 'none' | 'biweekly' | 'semimonthly' | 'other';
export const KIND_LABEL: Record<CadenceKind, string> = {
  none: 'No regular schedule (on demand)', biweekly: 'Every 2 weeks (exactly 14 days apart)', semimonthly: 'Twice a month (two set days each month)', other: 'Another pattern (weekly, monthly, every 3 months...)',
};

export interface CadenceDraft {
  kind: CadenceKind;
  /** Used by `other`. */
  rule: Recurrence | null;
  mode: 'fixed' | 'after';
  semi: Semimonthly;
  /** The first visit date (biweekly, other) or the date to start looking from (semimonthly). */
  first: string;
  /** Optional last date, for biweekly and semimonthly. '' = never ends. */
  until: string;
}

export const DEFAULT_SEMI: Semimonthly = { a: { kind: 'day', day: 1, adjust: 'none' }, b: { kind: 'day', day: 15, adjust: 'none' } };

export function draftOf(c: Cadence | null, today: string): CadenceDraft {
  const base = { rule: null as Recurrence | null, mode: 'fixed' as const, semi: DEFAULT_SEMI, first: today, until: '' };
  if (!c) return { ...base, kind: 'none' };
  const until = c.rule.end.type === 'until' ? c.rule.end.date : '';
  if (c.semi) return { ...base, kind: 'semimonthly', semi: c.semi, first: c.anchorDate, until };
  if (c.mode === 'fixed' && c.rule.freq === 'weekly' && c.rule.interval === 2 && (c.rule.byWeekday?.length ?? 0) <= 1 && c.rule.end.type !== 'count') return { ...base, kind: 'biweekly', first: c.anchorDate, until, rule: c.rule };
  return { ...base, kind: 'other', rule: c.rule, mode: c.mode, first: c.anchorDate };
}

/** The cadence a draft means, or null for "no regular schedule". Does not check that it is valid (see `draftProblem`). */
export function cadenceOfDraft(d: CadenceDraft): Cadence | null {
  const end: Recurrence['end'] = d.until ? { type: 'until', date: d.until } : { type: 'never' };
  if (d.kind === 'none') return null;
  if (d.kind === 'biweekly') return { mode: 'fixed', anchorDate: d.first, rule: { freq: 'weekly', interval: 2, byWeekday: [dayOfWeek(d.first)], end } };
  if (d.kind === 'semimonthly') {
    const semi = canonicalSemi(d.semi);
    return { mode: 'fixed', anchorDate: semiNext(semi, d.first, d.first, d.until || null) ?? d.first, rule: { freq: 'monthly', interval: 1, monthly: 'date', end }, semi };
  }
  return d.rule ? { mode: d.mode, rule: withExplicitWeekday(d.rule, d.first), anchorDate: d.first } : null;
}

/** A plain-words problem with the schedule as drafted, or null. The same strict check that runs when it is saved. */
export function draftProblem(d: CadenceDraft): string | null {
  if (d.kind === 'none') return null;
  if (d.kind === 'other' && !d.rule) return 'Pick how often.';
  if (!d.first) return 'Pick the first visit date.';
  if (d.until && d.until < d.first) return 'The end date is before the first visit.';
  const c = cadenceOfDraft(d);
  if (d.kind === 'semimonthly' && c && d.until && !semiNext(c.semi!, d.first, d.first, d.until)) return 'There is no visit between the first date and the end date.';
  return validateArrangement(normalizeArrangement(blankArrangement({ title: 'x', cadence: c })));
}

/** The next few visit dates the schedule gives, from the first date (or today if later). Empty for "after each visit". */
export function previewDates(c: Cadence | null, today: string, n = 6): string[] {
  if (!c || c.mode === 'after') return [];
  const from = c.anchorDate > today ? c.anchorDate : today;
  return cadenceBetween(c, from, addDays(from, 500)).slice(0, n);
}
