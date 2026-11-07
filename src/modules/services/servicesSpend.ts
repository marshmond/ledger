/**
 * What was PAID for household services (S3-B). Pure and read-only: computed on read from the arrangement and visit records and the live Finance
 * transactions; nothing is stored, nothing is written to Finance, Projects or Home & Assets, and there is no second accounting system.
 *
 * It reuses Home & Assets' H3 attribution unchanged: `resolveRef` (live Finance amount, needs-review states, refunds, transfers excluded),
 * `pieceKey`, and `spend()` (a transaction piece counts ONCE however many records reach it; a whole transaction covers its parts; a typed amount
 * is never merged with a Finance piece by value). Only the group labels are Services' own: completed visits / fees / other.
 *
 * Four money ideas stay apart and are never added together: Expected (estimate), Quoted, Charged (information), PAID (this file).
 * A payment never says a service happened, and a service never says a payment happened.
 *
 * A shared payment (one invoice linked on several visits) is counted once at arrangement, provider and module level and is NOT divided among the
 * visits. A visit row therefore shows it as "shared", and per-visit figures are not an allocation.
 */
import { formatCents } from '../../lib/money';
import { pieceKey, resolveRef, type ResolvedRef, type TxnLookup, type TxnRef } from '../../lib/txnRef';
import { spend, type CostRecord, type SpendSummary } from '../assets/spending';
import type { ArrangementRecord } from './model';
import { UNSUPPORTED, hasPaymentConflict, type VisitRecord } from './visitModel';

export type PayClass = 'completed' | 'fees' | 'other';
export const PAY_CLASSES: readonly PayClass[] = ['completed', 'fees', 'other'];
/** The mutually exclusive lines a total is split into: the three outcome classes, plus payments shared between different outcomes (not allocated). */
export type PayBucket = PayClass | 'shared';
export const PAY_BUCKETS: readonly PayBucket[] = ['completed', 'fees', 'other', 'shared'];
export const CLASS_LABEL: Record<PayBucket, string> = {
  completed: 'Paid for completed visits', fees: 'Paid as fees for cancelled or skipped visits', other: 'Other payments (arrangement-level, or a visit that needs review)',
  shared: 'Shared payments covering different kinds of visit (not allocated)',
};
const RANK: Record<PayClass, number> = { completed: 0, fees: 1, other: 2 };

/** One thing that carries a payment: a visit, or an arrangement as a whole. */
export interface PayRecord {
  id: string;
  level: 'visit' | 'arrangement';
  arrangementId: number | null;
  /** Who the payment is for: the contact id, or the lower-cased name when there is no contact. Replacing a provider never moves old payments. */
  providerKey: string;
  cls: PayClass;
  refs: TxnRef[];
  manualCents: number | null;
  date: string;
  title: string;
  visitId: number | null;
  /** Typed amount AND Finance references on one record (an older device, a hand edit). References are used. */
  conflict: boolean;
}

export const providerKeyOf = (contactId: number | null, name: string) => (contactId !== null ? `c:${contactId}` : `n:${name.trim().toLowerCase()}`);
const classOf = (v: VisitRecord): PayClass => (v.data.status === 'completed' ? 'completed' : v.data.status === UNSUPPORTED ? 'other' : 'fees');

/**
 * Every record that carries a payment, in a FIXED order (completed, then fees, then other; by date, then id) so a shared piece is always
 * credited the same way. Records with no payment are not listed (they contribute nothing and are never "unpaid").
 */
export function payRecords(arrangements: ArrangementRecord[], visits: VisitRecord[]): PayRecord[] {
  const out: PayRecord[] = [];
  for (const v of visits) {
    if (!v.data.txnRefs.length && v.data.paidManualCents === null) continue;
    out.push({
      id: `visit:${v.id}`, level: 'visit', arrangementId: v.data.arrangementId, providerKey: providerKeyOf(v.data.providerContactId, v.data.providerNameSnapshot), cls: classOf(v),
      refs: v.data.txnRefs, manualCents: v.data.paidManualCents, date: v.data.date, title: v.data.title, visitId: v.id, conflict: hasPaymentConflict(v.data),
    });
  }
  for (const a of arrangements) {
    if (!a.data.txnRefs.length) continue;
    out.push({
      id: `arrangement:${a.id}`, level: 'arrangement', arrangementId: a.id, providerKey: providerKeyOf(a.data.providerContactId, a.data.providerNameSnapshot), cls: 'other',
      refs: a.data.txnRefs, manualCents: null, date: a.data.startDate ?? '', title: a.data.title, visitId: null, conflict: false,
    });
  }
  return out.sort((x, y) => RANK[x.cls] - RANK[y.cls] || x.date.localeCompare(y.date) || x.id.localeCompare(y.id));
}

export interface Period { from?: string; to?: string }
const inPeriod = (date: string, p?: Period) => !p || ((!p.from || date >= p.from) && (!p.to || date <= p.to));

/** Narrows records to a period: a Finance piece by its LIVE transaction date (the snapshot date if it is missing), a typed amount by the visit date. */
function inRange(records: PayRecord[], lookup: TxnLookup, p?: Period): PayRecord[] {
  if (!p || (!p.from && !p.to)) return records;
  return records
    .map((r) => ({ ...r, refs: r.refs.filter((x) => inPeriod(lookup(x.txnId)?.date ?? x.snapshot.date, p)) }))
    .filter((r) => (r.refs.length > 0 ? true : r.manualCents !== null && inPeriod(r.date, p)));
}

const toCost = (r: PayRecord): CostRecord<PayClass> => ({ id: r.id, assetId: r.arrangementId ?? 0, group: r.cls, title: r.title, manualCents: r.refs.length ? null : r.manualCents, refs: r.refs });

export interface ServicesSpend {
  summary: SpendSummary<PayClass>;
  /** Everything counted, once each: Finance pieces plus typed amounts. */
  totalCents: number;
  financeCents: number;
  manualCents: number;
  /**
   * The total split into mutually exclusive lines that ALWAYS add up to `totalCents`. A Finance piece goes to a class only when every record that
   * reaches it has that same outcome class; a piece reached by records of different classes (a completed visit and a cancelled one, say) goes to
   * `shared`, because dividing it between them would invent an allocation Finance does not contain. A typed amount belongs to its own record.
   */
  byClass: Record<PayBucket, number>;
  /** How many counted pieces are in `shared`. */
  mixedPieces: number;
  /** Records that hold both a typed amount and references. */
  conflicts: string[];
}

/** Paid totals for the given records. Each Finance piece counts once; refunds lower the total; needs-review references count 0 and are listed. */
/**
 * `universe` is every record in the module (default: `records`). A piece is classified by ALL the records that reach it, not only those in this view, so a
 * payment shared by a completed visit and a cancelled one is `shared` on an arrangement or provider page too, never credited whole to one outcome.
 */
export function servicesSpend(records: PayRecord[], lookup: TxnLookup, period?: Period, universe: PayRecord[] = records): ServicesSpend {
  const rs = inRange(records, lookup, period);
  const summary = spend<PayClass>(rs.map(toCost), lookup, PAY_CLASSES);
  const reach = new Map<number, { key: string; whole: boolean; cls: PayClass }[]>();
  for (const r of universe) for (const x of r.refs) reach.set(x.txnId, [...(reach.get(x.txnId) ?? []), { key: pieceKey(x), whole: x.splitIndex === undefined, cls: r.cls }]);
  const byClass: Record<PayBucket, number> = { completed: summary.manualByGroup.completed, fees: summary.manualByGroup.fees, other: summary.manualByGroup.other, shared: 0 };
  let mixedPieces = 0;
  for (const piece of summary.pieces) {
    // every record that reaches the same money: the same piece, or (for a whole transaction and its parts) the other side of that overlap
    const whole = piece.resolved.ref.splitIndex === undefined;
    const classes = new Set((reach.get(piece.resolved.ref.txnId) ?? []).filter((x) => x.key === piece.key || x.whole || whole).map((x) => x.cls));
    if (classes.size === 1) byClass[[...classes][0]] += piece.spendCents;
    else { byClass.shared += piece.spendCents; mixedPieces++; }
  }
  return { summary, totalCents: summary.totalCents, financeCents: summary.financeCents, manualCents: summary.manualCents, byClass, mixedPieces, conflicts: rs.filter((r) => r.conflict).map((r) => r.id) };
}

export const forArrangement = (rs: PayRecord[], arrangementId: number) => rs.filter((r) => r.arrangementId === arrangementId);
export const forProvider = (rs: PayRecord[], providerKey: string) => rs.filter((r) => r.providerKey === providerKey);

// ---- one visit ----

export interface VisitPaymentView {
  source: 'none' | 'finance' | 'manual';
  /** What this visit's own payment comes to, from the live transactions (refunds negative). Null when no payment is recorded. NOT an allocation when shared. */
  paidCents: number | null;
  resolved: ResolvedRef[];
  needsReview: ResolvedRef[];
  /** How many OTHER records (visits or the arrangement as a whole) link one of the same pieces. */
  sharedWith: number;
  conflict: boolean;
}

export function visitPayment(v: VisitRecord, all: PayRecord[], lookup: TxnLookup): VisitPaymentView {
  const refs = v.data.txnRefs;
  const me = `visit:${v.id}`;
  const resolved = refs.map((r) => resolveRef(r, lookup));
  const keys = new Set(refs.map(pieceKey));
  const wholeIds = new Set(refs.filter((r) => r.splitIndex === undefined).map((r) => r.txnId));
  const sharedWith = all.filter((o) => o.id !== me && o.refs.some((x) => keys.has(pieceKey(x)) || (x.splitIndex === undefined ? refs.some((y) => y.txnId === x.txnId) : wholeIds.has(x.txnId)))).length;
  const source = refs.length ? 'finance' : v.data.paidManualCents !== null ? 'manual' : 'none';
  const paidCents = source === 'finance' ? resolved.reduce((t, x) => t + x.spendCents, 0) : source === 'manual' ? v.data.paidManualCents : null;
  return { source, paidCents, resolved, needsReview: resolved.filter((x) => x.needsReview), sharedWith, conflict: hasPaymentConflict(v.data) };
}

// ---- review messages (informational; never infer an error, fraud or "unpaid") ----

export interface ReviewNote { kind: 'difference' | 'missing' | 'changed' | 'split' | 'duplicate' | 'overlap' | 'shared' | 'conflict' | 'project'; text: string }

/**
 * Plain, neutral messages about one visit's payment. A difference between what was charged and what was paid is information and may be
 * perfectly legitimate (a deposit, a tip, a discount, a part payment); it is never called an error or "unpaid".
 */
export function visitReview(v: VisitRecord, all: PayRecord[], lookup: TxnLookup, money: (c: number) => string = formatCents, projectName?: (projectId: number) => string | undefined): ReviewNote[] {
  const view = visitPayment(v, all, lookup);
  const out: ReviewNote[] = [];
  if (view.conflict) out.push({ kind: 'conflict', text: 'This visit has both a Finance link and an amount paid outside Finance. Only the Finance link is counted. Choose one source to clear this.' });
  for (const x of view.resolved) {
    if (x.state === 'missing' || x.state === 'not-spending') out.push({ kind: 'missing', text: x.note });
    else if (x.state === 'split-changed') out.push({ kind: 'split', text: x.note });
    else if (x.state === 'changed') out.push({ kind: 'changed', text: x.note });
  }
  const ownKeys = new Set(v.data.txnRefs.map(pieceKey));
  const wholeIds = new Set(v.data.txnRefs.filter((r) => r.splitIndex === undefined).map((r) => r.txnId));
  const partIds = new Set(v.data.txnRefs.filter((r) => r.splitIndex !== undefined).map((r) => r.txnId));
  const others = all.filter((o) => o.id !== `visit:${v.id}`);
  const samePiece = others.filter((o) => o.refs.some((x) => ownKeys.has(pieceKey(x))));
  const arrangementLevel = samePiece.filter((o) => o.level === 'arrangement');
  if (arrangementLevel.length) out.push({ kind: 'duplicate', text: 'This payment is also linked on the arrangement as a whole. Each payment should be linked in one place only; it is counted once in the totals either way.' });
  const visitLevel = samePiece.filter((o) => o.level === 'visit');
  if (visitLevel.length) out.push({ kind: 'shared', text: `Shared payment: the same Finance payment is linked on ${visitLevel.length} other visit${visitLevel.length === 1 ? '' : 's'}. It is counted once in the totals and is not divided among the visits, so this visit's own figure is not a share.` });
  if (others.some((o) => o.refs.some((x) => (x.splitIndex === undefined && partIds.has(x.txnId)) || (x.splitIndex !== undefined && wholeIds.has(x.txnId))))) {
    out.push({ kind: 'overlap', text: 'A whole transaction and one of its parts are both linked (on this or another record). The whole counts and the part is not added again.' });
  }
  if (view.source !== 'none' && view.paidCents !== null && v.data.chargedCents !== null && view.paidCents !== v.data.chargedCents && !view.needsReview.length) {
    out.push({ kind: 'difference', text: `Charged ${money(v.data.chargedCents)}; ${view.source === 'finance' ? 'linked payment' : 'payment recorded outside Finance'} ${money(Math.abs(view.paidCents))}${view.paidCents < 0 ? ' (money back)' : ''}. Review the difference. It may be perfectly fine.` });
  }
  if (projectName) {
    for (const x of view.resolved) {
      const t = x.txn;
      const pid = x.ref.splitIndex !== undefined ? t?.splits?.[x.ref.splitIndex]?.project?.projectId ?? t?.project?.projectId : t?.project?.projectId;
      const name = pid !== undefined ? projectName(pid) : undefined;
      if (name) out.push({ kind: 'project', text: `This payment is also attributed to the project "${name}" in Finance. Project spending is separate and is not added to Services spending.` });
    }
  }
  return out;
}

// ---- typical paid cost (completed visits only) ----

export const TYPICAL_MIN_SAMPLE = 3;
export interface TypicalCost {
  /** Median of the sample, whole cents. Null when there are too few reliable visits. */
  medianCents: number | null;
  sample: number;
  fromFinance: number;
  typed: number;
  /** Completed visits left out, with the reason, so the figure is never presented as more certain than it is. */
  excluded: { noPayment: number; unreliable: number; shared: number; notPositive: number };
  enough: boolean;
}

/**
 * The MEDIAN amount paid per completed visit, from reliably attributable, UNSHARED payments only. Left out: cancelled and skipped visits (never
 * service), visits with no payment recorded, any visit with a missing, changed or no-longer-spending reference, any payment shared with another
 * visit or the arrangement (it cannot be allocated), and payments that net to zero or less (a refund is not a price). Fewer than
 * TYPICAL_MIN_SAMPLE usable visits gives no figure. Typed (outside Finance) amounts are the owner's own entries and are included, counted separately.
 */
export function typicalCost(visits: VisitRecord[], all: PayRecord[], lookup: TxnLookup): TypicalCost {
  const amounts: number[] = [];
  const t: TypicalCost = { medianCents: null, sample: 0, fromFinance: 0, typed: 0, excluded: { noPayment: 0, unreliable: 0, shared: 0, notPositive: 0 }, enough: false };
  for (const v of visits.filter((x) => x.data.status === 'completed')) {
    const p = visitPayment(v, all, lookup);
    if (p.source === 'none') { t.excluded.noPayment++; continue; }
    if (p.needsReview.length) { t.excluded.unreliable++; continue; }
    if (p.sharedWith > 0) { t.excluded.shared++; continue; }
    const cents = p.paidCents ?? 0;
    if (cents <= 0) { t.excluded.notPositive++; continue; }
    amounts.push(cents);
    if (p.source === 'finance') t.fromFinance++; else t.typed++;
  }
  t.sample = amounts.length;
  t.enough = amounts.length >= TYPICAL_MIN_SAMPLE;
  if (t.enough) {
    const s = [...amounts].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    t.medianCents = s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
  }
  return t;
}
