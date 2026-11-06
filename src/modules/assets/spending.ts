/**
 * What was spent on an asset (Home & Assets H3). ONE pure helper, computed on read from the source records; nothing is stored and nothing
 * here touches Finance. It is NOT a financial engine: Finance stays the source of truth for transactions, Projects for project money.
 *
 * Rules (see docs/HOME-ASSETS-H0-PLAN section 6.4 and 6.8):
 *  1. A cost-bearing item (an asset's purchase, or a service record) gets its cost from ONE source:
 *       - linked Finance transaction pieces ("finance"), using the LIVE transaction; or
 *       - a typed amount ("manual"), counted as typed; or
 *       - nothing ("unknown"). Unknown is never shown as $0.
 *     If a record arrives with both (an older device, a hand edit) the references win and it is flagged.
 *  2. A transaction piece (`pieceKey`: transaction + part, or whole) counts ONCE in an aggregate, however many records, assets or
 *     hierarchy levels reach it. Typed amounts have no key and are never merged because the numbers happen to match.
 *  3. A whole transaction and one of its parts are the same money: when the whole counts, its parts are left out of that aggregate.
 *  4. A reference that is missing, changed or no longer spending ("needs review") contributes 0 and is listed apart. The snapshot is never
 *     used as an amount.
 *  5. Refunds lower the total (spend = minus the piece amount). Transfers and setup entries never count.
 *  6. A project's money is NOT part of this. It is shown next to it, from the Projects summary.
 */
import type { AssetRecord } from './model';
import type { ServiceKind, ServiceRecord } from './service';
import { pieceKey, resolveRef, type ResolvedRef, type TxnLookup, type TxnRef } from './txnRef';

export type CostGroup = 'acquisition' | 'maintenance' | 'other';
export const GROUP_LABEL: Record<CostGroup, string> = { acquisition: 'Buying it', maintenance: 'Maintenance, repairs and inspections', other: 'Improvements, replacements and other work' };
export const serviceGroup = (k: ServiceKind): CostGroup => (k === 'maintenance' || k === 'repair' || k === 'inspection' ? 'maintenance' : 'other');

/** One thing that can carry a cost. `id` is `asset:<n>` for a purchase or `service:<n>`. */
export interface CostRecord { id: string; assetId: number; group: CostGroup; title: string; manualCents: number | null; refs: TxnRef[] }
export type CostSource = 'finance' | 'manual' | 'unknown';
export const sourceOf = (r: Pick<CostRecord, 'manualCents' | 'refs'>): CostSource => (r.refs.length ? 'finance' : r.manualCents !== null ? 'manual' : 'unknown');

/** The cost-bearing records of the given assets and their service history, in a fixed order (purchase first, then work by date) so a shared piece is always credited the same way. */
export function costRecords(assets: AssetRecord[], services: ServiceRecord[]): CostRecord[] {
  const out: CostRecord[] = [];
  const ids = new Set(assets.map((a) => a.id));
  for (const a of [...assets].sort((x, y) => x.id - y.id)) {
    const refs = a.data.purchaseTxnRefs;
    if (a.data.purchaseCents !== null || refs.length) out.push({ id: `asset:${a.id}`, assetId: a.id, group: 'acquisition', title: 'Purchase', manualCents: a.data.purchaseCents, refs });
  }
  for (const s of [...services].filter((x) => ids.has(x.data.assetId)).sort((x, y) => x.data.date.localeCompare(y.data.date) || x.id - y.id)) {
    out.push({ id: `service:${s.id}`, assetId: s.data.assetId, group: serviceGroup(s.data.kind), title: s.data.title, manualCents: s.data.costCents, refs: s.data.txnRefs });
  }
  return out;
}

export interface CountedPiece {
  key: string;
  resolved: ResolvedRef;
  group: CostGroup;
  spendCents: number;
  /** Every record in this aggregate that reaches the piece (the first is the one it is credited to). */
  recordIds: string[];
  assetIds: number[];
}
export interface ReviewItem { recordId: string; assetId: number; title: string; resolved: ResolvedRef }
export interface SpendSummary {
  /** Verified spending (typed + from Finance), by kind of work. */
  byGroup: Record<CostGroup, number>;
  /** The same, split by where the amount came from. */
  manualByGroup: Record<CostGroup, number>;
  financeByGroup: Record<CostGroup, number>;
  manualCents: number;
  financeCents: number;
  totalCents: number;
  /** Distinct transaction pieces that are counted. */
  pieces: CountedPiece[];
  /** Pieces reached by more than one record or asset. Counted once. */
  sharedPieces: CountedPiece[];
  /** References left OUT of the totals because they need review. */
  review: ReviewItem[];
  /** Counted references whose transaction changed since linking (live amount used). */
  changed: ReviewItem[];
  /** Parts left out because the whole transaction is also counted. */
  coveredParts: ReviewItem[];
  /** Service records with no cost recorded at all. */
  unknown: { recordId: string; assetId: number; title: string }[];
  /** Records that carry both a typed amount and references (references used). */
  both: string[];
  /** How many records contributed a typed amount. */
  manualRecords: number;
}

const emptyGroups = (): Record<CostGroup, number> => ({ acquisition: 0, maintenance: 0, other: 0 });

export function spend(records: CostRecord[], lookup: TxnLookup): SpendSummary {
  const resolved = new Map<CostRecord, ResolvedRef[]>(records.map((r) => [r, r.refs.map((x) => resolveRef(x, lookup))]));
  // Rule 3: a whole transaction that counts covers its parts, whatever order the records come in.
  const wholeCounted = new Set<number>();
  for (const list of resolved.values()) for (const x of list) if (!x.needsReview && x.ref.splitIndex === undefined) wholeCounted.add(x.ref.txnId);

  const s: SpendSummary = { byGroup: emptyGroups(), manualByGroup: emptyGroups(), financeByGroup: emptyGroups(), manualCents: 0, financeCents: 0, totalCents: 0, pieces: [], sharedPieces: [], review: [], changed: [], coveredParts: [], unknown: [], both: [], manualRecords: 0 };
  const byKey = new Map<string, CountedPiece>();
  const reviewSeen = new Set<string>();
  for (const r of records) {
    const src = sourceOf(r);
    if (src === 'unknown') { if (r.group !== 'acquisition') s.unknown.push({ recordId: r.id, assetId: r.assetId, title: r.title }); continue; }
    if (src === 'manual') { s.byGroup[r.group] += r.manualCents!; s.manualByGroup[r.group] += r.manualCents!; s.manualCents += r.manualCents!; s.manualRecords++; continue; }
    if (r.manualCents !== null) s.both.push(r.id);
    for (const x of resolved.get(r)!) {
      const item: ReviewItem = { recordId: r.id, assetId: r.assetId, title: r.title, resolved: x };
      if (x.needsReview) { const k = `${r.id}|${x.key}`; if (!reviewSeen.has(k)) { reviewSeen.add(k); s.review.push(item); } continue; }
      if (x.ref.splitIndex !== undefined && wholeCounted.has(x.ref.txnId)) { s.coveredParts.push(item); continue; }
      const had = byKey.get(x.key);
      if (had) { if (!had.recordIds.includes(r.id)) had.recordIds.push(r.id); if (!had.assetIds.includes(r.assetId)) had.assetIds.push(r.assetId); continue; }
      const piece: CountedPiece = { key: x.key, resolved: x, group: r.group, spendCents: x.spendCents, recordIds: [r.id], assetIds: [r.assetId] };
      byKey.set(x.key, piece);
      s.pieces.push(piece);
      s.byGroup[r.group] += x.spendCents;
      s.financeByGroup[r.group] += x.spendCents;
      s.financeCents += x.spendCents;
      if (x.state === 'changed') s.changed.push(item);
    }
  }
  s.totalCents = s.manualCents + s.financeCents;
  s.sharedPieces = s.pieces.filter((p) => p.recordIds.length > 1 || p.assetIds.length > 1);
  return s;
}

/** Ids of an asset and everything inside it. Cycle-proof and bounded: a loop that arrived through sync cannot hang or repeat an asset. */
export function subtreeIds(assets: { id: number; data: { parentId: number | null } }[], rootId: number): Set<number> {
  const kids = new Map<number, number[]>();
  for (const a of assets) if (a.data.parentId !== null && a.data.parentId !== a.id) kids.set(a.data.parentId, [...(kids.get(a.data.parentId) ?? []), a.id]);
  const out = new Set<number>([rootId]);
  const queue = [rootId];
  while (queue.length) for (const k of kids.get(queue.shift()!) ?? []) if (!out.has(k)) { out.add(k); queue.push(k); }
  return out;
}

export interface AssetSpend {
  /** The asset's own purchase and work. */
  own: SpendSummary;
  /** The asset plus everything inside it, each piece once. Equal to `own` when nothing is inside. */
  combined: SpendSummary;
  hasInside: boolean;
  /** What is attributed to things inside it and not already counted on the asset itself. */
  insideCents: number;
  insideFinanceCents: number;
  insideManualCents: number;
}

export function assetSpend(assets: AssetRecord[], services: ServiceRecord[], assetId: number, lookup: TxnLookup): AssetSpend {
  const ids = subtreeIds(assets, assetId);
  const mine = assets.filter((a) => ids.has(a.id));
  const all = costRecords(mine, services);
  const own = spend(all.filter((r) => r.assetId === assetId), lookup);
  const hasInside = ids.size > 1;
  const combined = hasInside ? spend(all, lookup) : own;
  return {
    own, combined, hasInside,
    insideCents: combined.totalCents - own.totalCents,
    insideFinanceCents: combined.financeCents - own.financeCents,
    insideManualCents: combined.manualCents - own.manualCents,
  };
}

/** Who else (any asset, any record) references each piece, by key. Used to show reuse that the current aggregate does not include. */
export function pieceUsers(records: CostRecord[]): Map<string, { recordId: string; assetId: number }[]> {
  const m = new Map<string, { recordId: string; assetId: number }[]>();
  for (const r of records) for (const x of r.refs) { const k = pieceKey(x); m.set(k, [...(m.get(k) ?? []), { recordId: r.id, assetId: r.assetId }]); }
  return m;
}
