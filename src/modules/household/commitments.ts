/**
 * HOUSEHOLD COMMITMENTS AND EXPECTED PAYMENTS (B5). PURE: no database, no clock, nothing stored, no Finance read, no forecast.
 *
 * What this is NOT: recorded spending (see `unionSpend.ts`), a Finance cash forecast, a Finance Scheduled amount, or proof that anything was paid. Finance Scheduled stays the
 * authority for a payment INSTRUCTION; a Bills bill that links a Scheduled rule is counted ONCE, here, as the bill, and the rule is never added beside it. Nothing here invents
 * an obligation: every row comes from a reader that already exists.
 *
 * SOURCES (each reused, none rewritten):
 *   - Bills, expected payments in a window: the same billing periods the Bills Overview, Upcoming page and Today use (`derive`), counting what REMAINS to pay on each open period,
 *     exactly as `cashTiming` does (a test pins that the sums agree). A fixed or billed amount is KNOWN, a "varies" amount is ESTIMATED, no amount is UNKNOWN, a price or amount that
 *     records disagree about is DISPUTED. Unknown and disputed are counted, never added as zero.
 *   - Bills, twelve-month commitments: `buildCommitments`, which already follows B4's effective prices and stops expecting bills after a CONFIRMED, undisputed cancellation date
 *     (a request alone changes nothing; two different confirmed dates change nothing until the owner chooses).
 *   - Household Services: `expectedWindow` (S3), the per-visit estimate on the arrangement's own cadence, counted from the real open visit. A per-month, per-season, per-year or quoted
 *     estimate is NOT converted into a window figure (there is no approved rule for part months); it is listed as not converted and counted as an unknown. An arrangement with a
 *     schedule and no estimate gives dated rows with no amount (unknown).
 *   - Home & Assets: nothing. Its maintenance plans are Tasks with no expected cost, and its only money is recorded cost. It contributes no commitments (stated on screen).
 *
 * LINKED BILLS AND SERVICES. B4's `bills-for` link says only that a bill and an arrangement are related. A related pair is folded into ONE commitment only when the evidence for
 * "the same charge" is complete: the bill has exactly one linked arrangement and the arrangement exactly one linked bill, both have rows in the window, no amount on either side is
 * unknown or disputed, and the two totals over the window are EQUAL to the cent. Anything else keeps BOTH sets of rows (nothing is hidden, so a genuine extra charge such as a deep
 * clean is never dropped) and raises an overlap notice with the most that could be double-counted. The Services rows folded in are kept and labelled, never deleted.
 */
import { addDays } from '../../lib/dates';
import { daysBetween } from '../../lib/money';
import { buildCommitments, type Commitments } from '../bills/commitments';
import { isLoanExcluded, priceOn, type ObligationRecord } from '../bills/model';
import type { Derived } from '../bills/readModel';
import { daysUntil } from '../bills/timing';
import { expectedWindow, type ExpectedWindow, type ScheduleState } from '../services/expectedCharges';
import type { ArrangementRecord } from '../services/model';
import type { Certainty } from './model';

export const WINDOW_DAYS = [7, 30, 90] as const;

export interface CommitmentRow {
  id: string;
  module: 'bills' | 'services';
  /** The bill id or the arrangement id. */
  sourceId: number;
  title: string;
  date: string;
  /** Whole cents, or null when no amount is known (never zero). */
  cents: number | null;
  certainty: Certainty;
  /** Plain words, no amounts. */
  note: string;
  href: string;
  /** Set on a Household Services row that is folded into the linked bill's row: it is kept and shown, but not added. */
  foldedInto: string | null;
}
export interface Totals { known: { cents: number; count: number }; estimated: { cents: number; count: number }; unknown: { count: number }; disputed: { count: number } }
export interface Consolidation {
  billId: number; billTitle: string; arrangementId: number; arrangementTitle: string;
  /** `folded`: the evidence is complete, counted once (as the bill). `uncertain`: related, but not provably the same charge: both counted, overlap noticed. `ambiguous`: more than one link, nothing folded. */
  status: 'folded' | 'uncertain' | 'ambiguous';
  billsCents: number; servicesCents: number;
  /** The most that could be counted twice. 0 when folded; unknown amounts make it a floor, `exposureIsFloor`. */
  exposureCents: number; exposureIsFloor: boolean;
  reason: string;
}
export interface WindowFigures {
  days: number; from: string; to: string;
  rows: CommitmentRow[];
  totals: Totals;
  /** Services arrangements whose estimate is not per visit: listed, counted as unknown, never turned into a figure. */
  notConverted: { arrangementId: number; title: string; reason: string }[];
  consolidations: Consolidation[];
  mayOverlap: boolean;
  overlapExposureCents: number;
}
export interface HouseholdCommitments {
  today: string;
  windows: WindowFigures[];
  twelve: {
    from: string; to: string; bills: Commitments; services: ExpectedWindow;
    /** Active arrangements with a schedule and no estimate (their visits are expected, the amount is not known). */
    servicesNoEstimate: number;
    totals: Totals;
    consolidations: Consolidation[]; mayOverlap: boolean; overlapExposureCents: number;
    /** Bills whose recorded prices disagree (read as unknown until the owner chooses). */
    disputedBills: number;
  };
  /** Home & Assets keeps no expected cost, so it adds no commitment. Said on screen. */
  homeAssets: { contributes: false; why: string };
  loansExcluded: number;
}

const emptyTotals = (): Totals => ({ known: { cents: 0, count: 0 }, estimated: { cents: 0, count: 0 }, unknown: { count: 0 }, disputed: { count: 0 } });
export function addRow(t: Totals, cents: number | null, certainty: Certainty) {
  if (certainty === 'known' && cents !== null) { t.known.cents += cents; t.known.count++; }
  else if (certainty === 'estimated' && cents !== null) { t.estimated.cents += cents; t.estimated.count++; }
  else if (certainty === 'disputed') t.disputed.count++;
  else t.unknown.count++;
}

const PRICE_CONFLICTS = new Set(['price-same-date', 'price-overlap']);
const hasPriceDispute = (o: ObligationRecord) => !!o.data.lc?.conflicts.some((c) => PRICE_CONFLICTS.has(c.kind));
const priceDisputedOn = (o: ObligationRecord, date: string) => !!o.data.lc && priceOn(o.data.lc.prices, date)?.conflict === true;

/** What a bill's lifecycle says that a reader of the amount should know, in words. */
function billNote(o: ObligationRecord, date: string): string {
  const lc = o.data.lc;
  const notes: string[] = [];
  if (lc) {
    if (lc.cancel.request && !lc.cancel.confirm && o.data.status === 'active') notes.push('A cancellation was requested but is not confirmed, so this is still expected.');
    if (lc.conflicts.some((c) => c.kind === 'confirm-dates')) notes.push('The cancellation date is in dispute, so this is still expected until it is agreed.');
    const first = o.data.prices[0]?.from ?? '';
    const step = priceOn(lc.prices, date);
    if (step && step.from > first && step.cents !== null) notes.push('Includes a recorded price change.');
  }
  return notes.join(' ');
}

/** Bills rows for one window: the open billing periods dated today through `days` ahead, with what REMAINS to pay (the same rule as the Bills cash timing). */
export function billsRows(x: Derived, days: number): CommitmentRow[] {
  const out: CommitmentRow[] = [];
  for (const ob of x.snap.obligations) {
    if (isLoanExcluded(ob.data)) continue;
    for (const p of x.periods.get(ob.id) ?? []) {
      if (!p.open || p.timing.date === null) continue;
      const d = daysUntil(p.timing.date, x.today);
      if (d < 0 || d > days) continue;
      const remaining = p.amounts.remaining;
      if (remaining === 0) continue;
      const disputed = p.amounts.basis === 'disagree' || priceDisputedOn(ob, p.timing.date);
      const certainty: Certainty = remaining === null ? (disputed ? 'disputed' : 'unknown') : p.amounts.basis === 'estimate' ? 'estimated' : 'known';
      out.push({ id: `bill:${ob.id}:${p.slot}`, module: 'bills', sourceId: ob.id, title: ob.data.title, date: p.timing.date, cents: remaining, certainty, note: billNote(ob, p.timing.date), href: `#/bills/o/${ob.id}`, foldedInto: null });
    }
  }
  return out;
}

/** The arrangement with its estimate swapped for a placeholder, used ONLY to ask `expectedWindow` which dates an estimate-less arrangement expects (the amount is discarded). */
const withPlaceholder = (a: ArrangementRecord): ArrangementRecord => ({ ...a, data: { ...a.data, expected: { basis: 'perVisit', cents: 0 } } });

export interface ServicesInput { arrangements: ArrangementRecord[]; state: Map<number, ScheduleState> }

/** Services rows for one window: estimates on the real cadence (estimated), dates with no estimate (unknown). */
export function servicesRows(s: ServicesInput, today: string, days: number): { rows: CommitmentRow[]; notConverted: WindowFigures['notConverted'] } {
  const rows: CommitmentRow[] = [];
  const w = expectedWindow(s.arrangements, s.state, today, days);
  const title = new Map(s.arrangements.map((a) => [a.id, a.data.title]));
  for (const it of w.items) for (const date of it.dates) rows.push({ id: `visit:${it.arrangementId}:${date}`, module: 'services', sourceId: it.arrangementId, title: it.title, date, cents: it.centsEach, certainty: 'estimated', note: 'A visit estimate, not a bill.', href: `#/services/a/${it.arrangementId}`, foldedInto: null });
  const bare = s.arrangements.filter((a) => !a.data.expected && a.data.cadence && a.data.status === 'active');
  const wb = expectedWindow(bare.map(withPlaceholder), s.state, today, days);
  for (const it of wb.items) for (const date of it.dates) rows.push({ id: `visit:${it.arrangementId}:${date}`, module: 'services', sourceId: it.arrangementId, title: title.get(it.arrangementId) ?? it.title, date, cents: null, certainty: 'unknown', note: 'A visit is expected; no estimate is recorded.', href: `#/services/a/${it.arrangementId}`, foldedInto: null });
  return { rows, notConverted: w.notConverted };
}

interface Side { cents: number; rows: number; uncertain: boolean }
function decide(bill: Side, svc: Side): { status: Consolidation['status']; exposure: number; floor: boolean; reason: string } {
  if (bill.uncertain || svc.uncertain) return { status: 'uncertain', exposure: Math.min(bill.cents, svc.cents), floor: true, reason: 'The two records are linked, but an amount on one side is not known or is in dispute, so Ledger cannot tell whether they are the same charge. Both are counted.' };
  if (bill.cents === svc.cents) return { status: 'folded', exposure: 0, floor: false, reason: 'The two records are linked and their totals for this period are equal, so they are treated as one charge and counted once (as the bill). The service rows are kept below and not added.' };
  return { status: 'uncertain', exposure: Math.min(bill.cents, svc.cents), floor: false, reason: 'The two records are linked, but their totals for this period differ, so part of one may be a separate charge (for example an extra visit). Both are counted; check them.' };
}

/** The link structure: which bill and arrangement may be folded (exactly one each way) and which are ambiguous. */
function pairsOf(links: Map<number, number[]>, bills: ObligationRecord[], arrangements: ArrangementRecord[]) {
  const liveBill = new Set(bills.filter((b) => !isLoanExcluded(b.data)).map((b) => b.id));
  const liveArr = new Set(arrangements.map((a) => a.id));
  const byArr = new Map<number, number[]>();
  const clean = new Map<number, number[]>();
  for (const [b, arrs] of [...links].sort((p, q) => p[0] - q[0])) {
    if (!liveBill.has(b)) continue;
    const a = [...new Set(arrs)].filter((x) => liveArr.has(x)).sort((p, q) => p - q);
    if (a.length) clean.set(b, a);
    for (const x of a) byArr.set(x, [...(byArr.get(x) ?? []), b]);
  }
  return { clean, byArr };
}

/** Folds linked pairs inside a set of rows, deciding each pair on the window's own totals. Mutates the rows' `foldedInto` and returns the notices. */
function consolidate(rows: CommitmentRow[], notConvertedIds: Set<number>, links: Map<number, number[]>, bills: ObligationRecord[], arrangements: ArrangementRecord[]): Consolidation[] {
  const { clean, byArr } = pairsOf(links, bills, arrangements);
  const out: Consolidation[] = [];
  const billTitle = new Map(bills.map((b) => [b.id, b.data.title]));
  const arrTitle = new Map(arrangements.map((a) => [a.id, a.data.title]));
  const side = (module: 'bills' | 'services', id: number, extraUnknown: boolean): Side => {
    const rs = rows.filter((r) => r.module === module && r.sourceId === id);
    return { cents: rs.reduce((n, r) => n + (r.cents ?? 0), 0), rows: rs.length, uncertain: extraUnknown || rs.some((r) => r.cents === null || r.certainty === 'unknown' || r.certainty === 'disputed') };
  };
  for (const [b, arrs] of clean) {
    for (const a of arrs) {
      const bs = side('bills', b, false), ss = side('services', a, notConvertedIds.has(a));
      if (bs.rows === 0 || (ss.rows === 0 && !notConvertedIds.has(a))) continue; // nothing on one side in this window: nothing could be counted twice
      const ambiguous = arrs.length > 1 || (byArr.get(a) ?? []).length > 1;
      const base = { billId: b, billTitle: billTitle.get(b) ?? 'A bill', arrangementId: a, arrangementTitle: arrTitle.get(a) ?? 'An arrangement', billsCents: bs.cents, servicesCents: ss.cents };
      if (ambiguous) { out.push({ ...base, status: 'ambiguous', exposureCents: Math.min(bs.cents, ss.cents), exposureIsFloor: true, reason: 'More than one bill or arrangement is linked here, so Ledger cannot tell which charge belongs to which. Nothing is folded and both are counted.' }); continue; }
      const d = decide(bs, ss);
      out.push({ ...base, status: d.status, exposureCents: d.exposure, exposureIsFloor: d.floor, reason: d.reason });
      if (d.status === 'folded') for (const r of rows) if (r.module === 'services' && r.sourceId === a) r.foldedInto = `bill:${b}`;
    }
  }
  return out;
}

function tally(rows: CommitmentRow[], extraUnknown: number): Totals {
  const t = emptyTotals();
  for (const r of rows) if (r.foldedInto === null) addRow(t, r.cents, r.certainty);
  t.unknown.count += extraUnknown;
  return t;
}

export interface CommitmentsInput {
  today: string;
  bills: Derived;
  services: ServicesInput;
  /** The live `bills-for` links, by bill id. */
  serviceLinks: Map<number, number[]>;
}

export function householdCommitments(i: CommitmentsInput): HouseholdCommitments {
  const { today } = i;
  const obligations = i.bills.snap.obligations;
  const arrangements = i.services.arrangements;
  const windows: WindowFigures[] = WINDOW_DAYS.map((days) => {
    const b = billsRows(i.bills, days);
    const s = servicesRows(i.services, today, days);
    const rows = [...b, ...s.rows].sort((p, q) => p.date.localeCompare(q.date) || p.module.localeCompare(q.module) || p.title.localeCompare(q.title) || p.id.localeCompare(q.id, 'en', { numeric: true }));
    const consolidations = consolidate(rows, new Set(s.notConverted.map((n) => n.arrangementId)), i.serviceLinks, obligations, arrangements);
    const notConverted = s.notConverted;
    const totals = tally(rows, notConverted.length);
    const uncertain = consolidations.filter((c) => c.status !== 'folded');
    return { days, from: today, to: addDays(today, days), rows, totals, notConverted, consolidations, mayOverlap: uncertain.length > 0, overlapExposureCents: uncertain.reduce((n, c) => n + c.exposureCents, 0) };
  });

  // ---- twelve months: Bills' own commitments reader and Services' own twelve-month estimate ----
  const bills = buildCommitments(obligations, today);
  // ONE window for both readers: Bills' own twelve months. (Services' Calendar horizon runs one day longer; using it here would mix two window ends in one figure.)
  const twelveEnd = bills.window.to;
  const horizonDays = daysBetween(twelveEnd, today);
  const services = expectedWindow(arrangements, i.services.state, today, horizonDays);
  const bare = servicesRows({ arrangements: arrangements.filter((a) => !a.data.expected), state: i.services.state }, today, horizonDays);
  // rows at line level, so the same fold rule decides the pair
  const rows: CommitmentRow[] = [];
  for (const l of bills.lines) {
    if (l.kind === 'on-demand' || l.kind === 'none') continue;
    // a line with ANY period that has no amount is not a complete figure, so it reads as unknown for the fold decision; a mix of fixed and estimated reads as estimated (the weaker word)
    const certainty: Certainty = l.unknownPeriods > 0 ? 'unknown' : l.kind === 'known' ? 'known' : 'estimated';
    rows.push({ id: `bill:${l.id}`, module: 'bills', sourceId: l.id, title: l.title, date: today, cents: l.knownCents + l.estimatedCents, certainty, note: '', href: `#/bills/o/${l.id}`, foldedInto: null });
  }
  for (const it of services.items) rows.push({ id: `arrangement:${it.arrangementId}`, module: 'services', sourceId: it.arrangementId, title: it.title, date: today, cents: it.cents, certainty: 'estimated', note: '', href: `#/services/a/${it.arrangementId}`, foldedInto: null });
  const bareIds = new Set(bare.rows.map((r) => r.sourceId));
  for (const id of bareIds) rows.push({ id: `arrangement:${id}`, module: 'services', sourceId: id, title: arrangements.find((a) => a.id === id)?.data.title ?? '', date: today, cents: null, certainty: 'unknown', note: '', href: `#/services/a/${id}`, foldedInto: null });
  const notConvertedIds = new Set(services.notConverted.map((n) => n.arrangementId));
  const consolidations = consolidate(rows, notConvertedIds, i.serviceLinks, obligations, arrangements);
  const folded = new Set(rows.filter((r) => r.foldedInto !== null).map((r) => r.sourceId));
  // counts are PAYMENTS (billing periods and visits), the same unit as the shorter windows
  const totals = emptyTotals();
  totals.known.cents = bills.known.cents; totals.known.count = bills.known.periods;
  totals.estimated.cents = bills.estimated.cents; totals.estimated.count = bills.estimated.periods;
  totals.unknown.count = bills.unknown.periods;
  for (const it of services.items) if (!folded.has(it.arrangementId)) { totals.estimated.cents += it.cents; totals.estimated.count += it.visits; }
  totals.unknown.count += bareIds.size + services.notConverted.length;
  const disputedBills = obligations.filter((o) => !isLoanExcluded(o.data) && hasPriceDispute(o)).length;
  totals.disputed.count = disputedBills;
  const uncertain = consolidations.filter((c) => c.status !== 'folded');

  return {
    today, windows,
    twelve: { from: today, to: twelveEnd, bills, services, servicesNoEstimate: bareIds.size, totals, consolidations, mayOverlap: uncertain.length > 0, overlapExposureCents: uncertain.reduce((n, c) => n + c.exposureCents, 0), disputedBills },
    homeAssets: { contributes: false, why: 'Home & Assets keeps maintenance as Tasks with no expected cost, and its only money is recorded cost, so it adds no commitment here.' },
    loansExcluded: bills.loanExcluded,
  };
}
