/**
 * CONTRACT DATES of an obligation (B2): when it renews, the last day to give notice, when a trial ends, and whether it renews by itself.
 * PURE. They are stored in the obligation's `terms` object (B1 kept that object untouched and unread). A DATE ONLY: when one passes,
 * nothing renews, cancels, repriced, posts or extends. A passed deadline becomes a review item ("did it renew?"), never an action.
 *
 *   autoRenews    true | false | unknown (null)
 *   renewalDate   the next expected renewal
 *   noticeByDate  the last day to cancel or give notice
 *   noticeDays    optional helper: notice is due this many days before the renewal (only prefills noticeByDate in the form)
 *   trialEndsOn   when a free or introductory trial ends
 *
 * Unknown keys inside `terms` (from a newer version) and unreadable values are preserved exactly (`readTerms` keeps `rest`; `toStoredTerms` writes it back).
 */
import { addDays } from '../../lib/dates';
import { daysUntil } from './timing';
import { isDate, isInt } from './util';

export interface Terms {
  autoRenews: boolean | null;
  renewalDate: string | null;
  noticeByDate: string | null;
  noticeDays: number | null;
  trialEndsOn: string | null;
  /** Everything else that was stored (unknown keys and unreadable values), written back unchanged. */
  rest: Record<string, unknown>;
}
const KEYS = new Set(['autoRenews', 'renewalDate', 'noticeByDate', 'noticeDays', 'trialEndsOn']);
export const blankTerms = (): Terms => ({ autoRenews: null, renewalDate: null, noticeByDate: null, noticeDays: null, trialEndsOn: null, rest: {} });

export function readTerms(v: Record<string, unknown> | null): Terms {
  if (!v) return blankTerms();
  const rest: Record<string, unknown> = Object.fromEntries(Object.entries(v).filter(([k]) => !KEYS.has(k)));
  const date = (k: string) => { const x = v[k]; if (isDate(x)) return x; if (x !== undefined && x !== null) rest[k] = x; return null; };
  let noticeDays: number | null = null;
  if (isInt(v.noticeDays) && v.noticeDays >= 0 && v.noticeDays <= 365) noticeDays = v.noticeDays; else if (v.noticeDays !== undefined && v.noticeDays !== null) rest.noticeDays = v.noticeDays;
  let autoRenews: boolean | null = null;
  if (typeof v.autoRenews === 'boolean') autoRenews = v.autoRenews; else if (v.autoRenews !== undefined && v.autoRenews !== null && v.autoRenews !== 'unknown') rest.autoRenews = v.autoRenews;
  return { autoRenews, renewalDate: date('renewalDate'), noticeByDate: date('noticeByDate'), noticeDays, trialEndsOn: date('trialEndsOn'), rest };
}

/** What is written to `terms` (null when nothing is set and nothing unknown is kept, so an unused feature leaves no trace). */
export function toStoredTerms(t: Terms): Record<string, unknown> | null {
  const out: Record<string, unknown> = { ...t.rest };
  if (t.autoRenews !== null) out.autoRenews = t.autoRenews;
  if (t.renewalDate) out.renewalDate = t.renewalDate;
  if (t.noticeByDate) out.noticeByDate = t.noticeByDate;
  if (t.noticeDays !== null) out.noticeDays = t.noticeDays;
  if (t.trialEndsOn) out.trialEndsOn = t.trialEndsOn;
  return Object.keys(out).length ? out : null;
}

/** A plain-words problem with edited terms, or null. Soft oddities (a notice date after the renewal) are warnings, not problems. */
export function termsProblem(t: Terms): string | null {
  for (const [k, v] of [['renewal date', t.renewalDate], ['notice-by date', t.noticeByDate], ['trial end date', t.trialEndsOn]] as const) if (v !== null && !isDate(v)) return `The ${k} is not a real date.`;
  if (t.noticeDays !== null && (!isInt(t.noticeDays) || t.noticeDays < 0 || t.noticeDays > 365)) return 'Notice days must be between 0 and 365.';
  return null;
}
export function termsWarnings(t: Terms): string[] {
  const w: string[] = [];
  if (t.renewalDate && t.noticeByDate && t.noticeByDate > t.renewalDate) w.push('The notice-by date is after the renewal date, which is unusual. Check it.');
  if (t.noticeDays !== null && t.renewalDate === null && t.noticeByDate === null) w.push('Notice days only help once there is a renewal date to count back from.');
  return w;
}
/** The notice-by date a renewal date and notice days give (the form's helper). */
export const noticeFromRenewal = (renewal: string, days: number) => addDays(renewal, -days);

export type DeadlineKind = 'notice' | 'trial' | 'renewal';
export const DEADLINE_LABEL: Record<DeadlineKind, string> = { notice: 'Cancel-by (notice) deadline', trial: 'Trial ends', renewal: 'Renewal' };
export const DEADLINE_SHORT: Record<DeadlineKind, string> = { notice: 'Cancel by', trial: 'Trial ends', renewal: 'Renewal' };
/** What a date does NOT mean (shown beside it so nobody expects Ledger to act). */
export const DEADLINE_MEANING: Record<DeadlineKind, string> = {
  notice: 'The last day to cancel or give notice. Ledger does not cancel anything.',
  trial: 'When the trial ends and the price may change. Ledger does not know whether it converts or cancels.',
  renewal: 'When it renews. Ledger does not renew anything, and a passed date is not extended.',
};
/** Whether an action Task is wanted for this kind of date (renewals are informational only). */
export const isActionDeadline = (k: DeadlineKind) => k !== 'renewal';

export interface Deadline { kind: DeadlineKind; date: string }
/** The contract dates that are set, soonest first. */
export function deadlinesOf(t: Terms): Deadline[] {
  const out: Deadline[] = [];
  if (t.noticeByDate) out.push({ kind: 'notice', date: t.noticeByDate });
  if (t.trialEndsOn) out.push({ kind: 'trial', date: t.trialEndsOn });
  if (t.renewalDate) out.push({ kind: 'renewal', date: t.renewalDate });
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind));
}

/** "In 12 days", "today", "3 days ago" (words for a deadline relative to today). */
export function relativeDay(date: string, today: string): string {
  const d = daysUntil(date, today);
  return d === 0 ? 'today' : d > 0 ? `in ${d} day${d === 1 ? '' : 's'}` : `${-d} day${d === -1 ? '' : 's'} ago`;
}
