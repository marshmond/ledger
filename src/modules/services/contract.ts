/**
 * Contract dates on an arrangement (S4): `renewalDate` (when the agreement renews) and `noticeByDate` (the last day to act or give notice if the
 * household wants to change or cancel it). Pure and read-only: the Calendar layer, the Today counts and the arrangement page all read the SAME
 * `contractDeadlines`, so they cannot disagree about which dates count.
 *
 * What this is NOT: there is no renewal engine. Nothing repeats a date yearly, works out a notice date from a term, renews or cancels anything, or
 * reads a contract. The owner types the dates for each agreement period.
 *
 * An ENDED arrangement produces no deadlines (it is not an active obligation); its dates stay stored and shown on its own page as history. A paused
 * arrangement keeps its deadlines: pausing visits does not end the agreement.
 */
import { addDays } from '../../lib/dates';
import { isDate, type ArrangementData, type ArrangementRecord } from './model';

export interface ContractDates { renewalDate: string | null; noticeByDate: string | null }
export const datesOf = (d: Pick<ArrangementData, 'renewalDate' | 'noticeByDate'>): ContractDates => ({ renewalDate: d.renewalDate ?? null, noticeByDate: d.noticeByDate ?? null });

export type DeadlineKind = 'renewal' | 'notice';
export const DEADLINE_LABEL: Record<DeadlineKind, string> = { renewal: 'Renewal', notice: 'Notice deadline' };

/** Blocks saving: a date that is not a real calendar date. Empty (null) is fine. */
export function contractProblem(c: ContractDates): string | null {
  if (c.renewalDate !== null && !isDate(c.renewalDate)) return 'The renewal date is not a real date.';
  if (c.noticeByDate !== null && !isDate(c.noticeByDate)) return 'The notice-by date is not a real date.';
  return null;
}

/** Soft notices that never block saving. Plain words, no blame. */
export function contractWarnings(c: ContractDates, status: ArrangementData['status'], today: string): string[] {
  const out: string[] = [];
  const r = c.renewalDate && isDate(c.renewalDate) ? c.renewalDate : null;
  const n = c.noticeByDate && isDate(c.noticeByDate) ? c.noticeByDate : null;
  if (r && n && n > r) out.push('The notice-by date is after the renewal date. Notice is normally due before an agreement renews. Check both dates.');
  if (status === 'ended') {
    if (r || n) out.push('This arrangement has ended. Its dates are kept as history. They no longer appear on the Calendar or Today.');
    return out;
  }
  if (n && n < today) out.push('The notice-by date has already passed.');
  if (r && r < today) out.push('The renewal date is in the past. If the agreement renewed, enter the new renewal date. Ledger never assumes a yearly renewal.');
  return out;
}

export interface Deadline { arrangementId: number; kind: DeadlineKind; date: string; title: string }

/** Stable identity of one deadline: the same arrangement and kind always give the same key, whatever the date. */
export const deadlineKey = (kind: DeadlineKind, arrangementId: number) => `${kind}-${arrangementId}`;

/**
 * Every renewal and notice date of the arrangements that are not ended, sorted by date, then kind, then arrangement. Invalid or missing dates are
 * skipped, never thrown on. A renewal and a notice on the same day are two separate deadlines. The title is the arrangement's title only.
 */
export function contractDeadlines(arrangements: ArrangementRecord[]): Deadline[] {
  const out: Deadline[] = [];
  for (const a of arrangements) {
    if (a.data.status === 'ended') continue;
    const { renewalDate, noticeByDate } = datesOf(a.data);
    if (noticeByDate && isDate(noticeByDate)) out.push({ arrangementId: a.id, kind: 'notice', date: noticeByDate, title: a.data.title });
    if (renewalDate && isDate(renewalDate)) out.push({ arrangementId: a.id, kind: 'renewal', date: renewalDate, title: a.data.title });
  }
  const rank = { notice: 0, renewal: 1 } as const;
  return out.sort((x, y) => x.date.localeCompare(y.date) || rank[x.kind] - rank[y.kind] || x.arrangementId - y.arrangementId);
}

export interface ContractCounts { renewals: number; notices: number }
/** How many deadlines fall from today through `days` days ahead, both ends included. Counts only. Each deadline is counted once. */
export function upcomingContractCounts(arrangements: ArrangementRecord[], today: string, days = 30): ContractCounts {
  const last = addDays(today, days);
  const c: ContractCounts = { renewals: 0, notices: 0 };
  for (const x of contractDeadlines(arrangements)) {
    if (x.date < today || x.date > last) continue;
    if (x.kind === 'renewal') c.renewals++; else c.notices++;
  }
  return c;
}

/** "Jan 1" style text is the page's job; this is only the plain description of what a date means. */
export const deadlineMeaning = (kind: DeadlineKind) => (kind === 'renewal' ? 'The day this service agreement renews.' : 'The last day to act or give notice if you want to change or cancel this agreement.');
