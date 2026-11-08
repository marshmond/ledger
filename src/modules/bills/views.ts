/**
 * Pure read models for the Bills pages (B1): list rows with filters, and the Overview. Reads obligations only. Nothing is stored or written.
 * Every figure here is an EXPECTED amount from the obligation's own terms. None is money that moved.
 */
import { addDays } from '../../lib/dates';
import { buildCommitments, type Commitments } from './commitments';
import { expectedAmountOn, firstAmountCents, isLoanExcluded, needsReview, priceOn, scheduleSource, type BillType, type ExpectedAmount, type ObligationData, type ObligationRecord } from './model';
import { expectedDates, nextExpected, slotCollisions, type ExpectedDate } from './schedule';

export type StatusFilter = 'active' | 'paused' | 'ended' | 'all';
export const STATUS_FILTERS: { id: StatusFilter; label: string }[] = [{ id: 'active', label: 'Active' }, { id: 'paused', label: 'Paused' }, { id: 'ended', label: 'Ended' }, { id: 'all', label: 'All' }];

export interface BillRow { ob: ObligationRecord; /** The next three expected dates from today. */ next: ExpectedDate[] }
const statusRank = { active: 0, paused: 1, ended: 2, unsupported: 3 } as const;

export function buildRows(obligations: ObligationRecord[], today: string): BillRow[] {
  return obligations
    .map((ob) => ({ ob, next: nextExpected(scheduleSource(ob.data), today, 3) }))
    .sort((a, b) =>
      statusRank[a.ob.data.status] - statusRank[b.ob.data.status]
      || (a.next[0]?.nominal ?? '9999').localeCompare(b.next[0]?.nominal ?? '9999')
      || a.ob.data.title.localeCompare(b.ob.data.title) || a.ob.id - b.ob.id);
}

export interface RowFilter { status: StatusFilter; type: BillType | 'all'; /** a Contact id, 'none' (no provider) or 'all' */ provider: number | 'none' | 'all' }
export function filterRows(rows: BillRow[], f: RowFilter): BillRow[] {
  return rows.filter((r) => {
    const d = r.ob.data;
    if (f.status !== 'all' && (f.status !== d.status)) return false;
    if (f.type !== 'all' && d.type !== f.type) return false;
    if (f.provider === 'none') return d.providerContactId === null;
    if (f.provider !== 'all' && d.providerContactId !== f.provider) return false;
    return true;
  });
}
export const countByStatus = (rows: BillRow[], s: StatusFilter) => (s === 'all' ? rows.length : rows.filter((r) => r.ob.data.status === s).length);

/** The distinct providers (by Contact id) that have at least one obligation, for the filter. */
export function providersOf(obligations: ObligationRecord[]): { contactId: number; name: string; total: number }[] {
  const by = new Map<number, { contactId: number; name: string; total: number }>();
  for (const r of obligations) {
    const id = r.data.providerContactId;
    if (id === null) continue;
    const hit = by.get(id);
    if (hit) hit.total++; else by.set(id, { contactId: id, name: r.data.providerNameSnapshot || 'Provider', total: 1 });
  }
  return [...by.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** What the person sees as "the amount" today: the price in force today, else the first price entered. Null when it is not known. */
export function currentAmount(d: ObligationData, today: string): ExpectedAmount {
  if (d.amountKind === 'unknown') return { cents: null, basis: 'unknown' };
  // B4: recorded price steps count. A step in force wins even when its amount is unknown or in dispute (that reads as unknown, never as the first price); the
  // first price entered is only the fallback when no step is in force yet.
  if (!d.lc || d.lc.prices.length === 0) return { cents: priceOn(d.prices, today)?.cents ?? firstAmountCents(d), basis: d.amountKind };
  const step = priceOn(d.lc.prices, today);
  return { cents: step ? step.cents : firstAmountCents(d), basis: step?.estimated && d.amountKind === 'fixed' ? 'variable' : d.amountKind };
}

export interface UpcomingRow { ob: ObligationRecord; slot: string; nominal: string; amount: ExpectedAmount }
export interface BillsOverview {
  counts: { active: number; paused: number; ended: number; total: number; needsReview: number };
  commitments: Commitments;
  /** Read-only previews of expected dates, soonest first. NOT payments. */
  upcoming: UpcomingRow[];
  upcomingDays: number;
  /** The owner's own cost-review list, ended items last. */
  review: BillRow[];
  /** Things worth a look, in plain words. Counts and titles only. */
  notes: { id: string; text: string; obligationId?: number }[];
}
export const UPCOMING_DAYS = 45;

export function buildOverview(obligations: ObligationRecord[], today: string): BillsOverview {
  const counts = { active: 0, paused: 0, ended: 0, total: obligations.length, needsReview: 0 };
  const upcoming: UpcomingRow[] = [];
  const notes: BillsOverview['notes'] = [];
  for (const r of obligations) {
    const d = r.data;
    if (d.status === 'active' || d.status === 'paused' || d.status === 'ended') counts[d.status]++;
    if (needsReview(d).length) { counts.needsReview++; notes.push({ id: `review-${r.id}`, text: `${d.title}: some saved details could not be read by this version and are kept as they are.`, obligationId: r.id }); }
    const list = expectedDates(scheduleSource(d), today, addDays(today, UPCOMING_DAYS));
    const collide = slotCollisions(expectedDates(scheduleSource(d), addDays(today, -62), addDays(today, 400)));
    if (collide.length) notes.push({ id: `overlap-${r.id}`, text: `${d.title}: two schedules claim the same billing period. Edit the schedule to clear this.`, obligationId: r.id });
    if (isLoanExcluded(d)) continue; // loans are left out of the expected-date lists too: Loans owns those payments
    for (const e of list) upcoming.push({ ob: r, slot: e.slot, nominal: e.nominal, amount: expectedAmountOn(d, e.nominal) });
  }
  upcoming.sort((a, b) => a.nominal.localeCompare(b.nominal) || a.ob.data.title.localeCompare(b.ob.data.title) || a.ob.id - b.ob.id);
  const review = buildRows(obligations.filter((r) => r.data.review.on), today);
  return { counts, commitments: buildCommitments(obligations, today), upcoming: upcoming.slice(0, 15), upcomingDays: UPCOMING_DAYS, review, notes };
}
