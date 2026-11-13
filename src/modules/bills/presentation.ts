import type { StatusTone } from '../../ui/StatusChip';
import type { Certainty } from '../../ui/figureModel';
import type { LabelId } from './labels';
import type { Attention, AttentionCategory } from './readModel';
import type { ExpectedAmount, Status } from './model';

/**
 * D15. Presentation helpers for the Bills & Subscriptions screens. Nothing here works out a due date, an amount, a payment state or a total, and nothing
 * reads or writes a record: the label of a period comes from `primaryLabel`, the amounts from `derivePeriod`, the dates from the schedule. These helpers
 * only choose how an answer that already exists is DRAWN, and the words always travel with the colour.
 */

/**
 * The chip tone for a period label. Five different situations that must never look alike:
 *  - settled (paid, payment recorded, marked paid): done
 *  - still to come (upcoming, scheduled for automatic payment): neutral / info
 *  - needs a look soon (due soon, due today, partly paid, not confirmed paid, autopay not seen, date unclear, needs review): warning
 *  - billed and no payment recorded: overdue (the only label that uses the overdue tone)
 *  - nothing expected (skipped, no payment due): neutral
 */
export const LABEL_TONE: Record<LabelId, StatusTone> = {
  skipped: 'neutral', 'no-payment-due': 'neutral', 'no-payment-expected': 'neutral',
  paid: 'done', 'partly-paid': 'warning', 'payment-recorded': 'done', 'marked-paid': 'info', 'marked-paid-short': 'warning', 'needs-review': 'warning',
  'scheduled-auto': 'info', 'autopay-check': 'warning',
  upcoming: 'neutral', 'due-soon': 'warning', 'due-today': 'warning', overdue: 'overdue', 'not-confirmed': 'warning', 'date-unclear': 'warning',
};

/** The chip tone for a bill's own status. */
export const STATUS_TONE: Record<Status | 'unsupported', StatusTone> = { active: 'active', paused: 'warning', ended: 'neutral', unsupported: 'warning' };

/**
 * How certain an expected amount is, in the shared figure's terms: a fixed amount is KNOWN, an amount that varies is an ESTIMATE, and no amount is NOT KNOWN
 * (never zero). This is the same split the Overview already makes ("Known (fixed amounts)" and "Estimated (amounts that vary)").
 */
export function amountCertainty(a: ExpectedAmount): Certainty {
  if (a.basis === 'unknown' || a.cents === null) return 'unknown';
  return a.basis === 'variable' ? 'estimated' : 'known';
}

/** Entries grouped under their date, in the order given (they arrive sorted by date). */
export function groupByDate<T>(entries: T[], dateOf: (e: T) => string): { date: string; entries: T[] }[] {
  const out: { date: string; entries: T[] }[] = [];
  for (const e of entries) {
    const d = dateOf(e);
    const last = out[out.length - 1];
    if (last && last.date === d) last.entries.push(e);
    else out.push({ date: d, entries: [e] });
  }
  return out;
}

/** "3 bills", "1 bill". */
export const billCount = (n: number) => `${n} bill${n === 1 ? '' : 's'}`;

/** How many populated due dates the phone overview shows before "View all upcoming". */
export const PREVIEW_DATES = 3;

export interface DatePreview<T> {
  /** The first `limit` populated dates, each with EVERY entry that falls on it (a date is never cut part-way through). */
  groups: { date: string; entries: T[] }[];
  /** Entries drawn, and entries in the list given. */
  shown: number;
  total: number;
  /** Populated dates that are not drawn. */
  hiddenDates: number;
}

/**
 * The compact phone preview of the expected dates: the first populated dates, complete. It only chooses WHICH of the entries it is given to draw; nothing is
 * counted, summed or recalculated, and every entry not drawn is still on the Upcoming page.
 */
export function previewByDate<T>(entries: T[], dateOf: (e: T) => string, limit = PREVIEW_DATES): DatePreview<T> {
  const all = groupByDate(entries, dateOf);
  const groups = all.slice(0, Math.max(0, limit));
  return { groups, shown: groups.reduce((n, g) => n + g.entries.length, 0), total: entries.length, hiddenDates: all.length - groups.length };
}

/**
 * The tone of a Needs review group, by its first category. Every group still prints its own title and count, so tone is never the only cue. A group about
 * money that is recorded but disputed, missing or short is a warning; a group that only reminds (a reminder Task, a date that passed, a record Ledger kept
 * as found, a cancellation that is still treated as active) is informational. Nothing here decides whether an item is in the list.
 */
export const REVIEW_TONE: Record<AttentionCategory, StatusTone> = {
  dueSoon: 'info', trials: 'info', notices: 'info', renewals: 'info',
  conflicts: 'warning', typedFinance: 'warning', ruleShared: 'warning', duplicatePieces: 'warning', paymentReview: 'warning', paymentChanged: 'warning', declaredShort: 'warning', partlyPaid: 'warning',
  notConfirmed: 'warning', autopayCheck: 'warning', unconfirmedTasks: 'info', records: 'info', lifecycleConflict: 'warning', cancelAwaiting: 'info', afterCancel: 'info', scheduledAfterEnd: 'info',
  passedDates: 'info', taskProblems: 'info',
};

/**
 * How many items the Needs review page lists: every attention item except the four "coming up" kinds that the Upcoming page owns. This is the SAME subtraction
 * the Overview prints on its "Needs review" button (and the page's own empty check), written once so the two cannot drift.
 */
export const reviewTotal = (a: Pick<Attention, 'total' | 'dueSoon' | 'trials' | 'notices' | 'renewals'>) => a.total - a.dueSoon - a.trials - a.notices - a.renewals;
