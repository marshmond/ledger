/**
 * References from an asset purchase or a service record to Finance transactions (Home & Assets H3). PURE: reading, checking and working
 * out what a reference currently means. Nothing here writes to Finance, and nothing stores an amount that a transaction already holds.
 *
 * A reference points at a whole transaction, or at ONE part (split) of it:
 *   { txnId, splitIndex?, snapshot: { date, payee, amountCents }, fp?: { splitCount, amountCents, categoryId } }
 *
 * Finance splits have no ids of their own, only a position. So a split reference also stores a FINGERPRINT of the part when it was linked
 * (how many parts there were, this part's amount and its category). Reading it later compares the fingerprint with the live transaction:
 *   - same fingerprint at that position  -> still the same part, the LIVE amount is used;
 *   - anything else (part removed, reordered, amount or category changed, no longer split) -> "needs review": it contributes NOTHING to
 *     totals, and the owner must pick the part again. We never move a reference to a different part that happens to sit at that position.
 * Limit (stated in the report): two parts with the same amount AND the same category are interchangeable to this check. Swapping them
 * changes no figure, so it is not flagged.
 *
 * The snapshot is explanatory text only ("was $45.00 at Hardware Co on 2026-03-02 when linked"). It is never added to a total.
 * Spending is shown as a positive number; Finance outflows are negative, so spend = minus the piece amount and a refund (positive piece)
 * lowers it. Transfers and initial-setup entries are never spending.
 */
import { formatCents } from './money';
import { isSetupTxn } from './setupCategory';
import type { Txn } from '../types';

export interface TxnSnapshot { date: string; payee: string; amountCents: number }
export interface SplitFingerprint { splitCount: number; amountCents: number; categoryId: number | null }
export interface TxnRef {
  txnId: number;
  /** Position of the part in the transaction's splits. Absent = the whole transaction. */
  splitIndex?: number;
  snapshot: TxnSnapshot;
  /** Present on split references only. */
  fp?: SplitFingerprint;
}

export const MAX_TXN_REFS = 20;

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const isDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** Reads stored references defensively. Junk entries are dropped; never throws. A same-piece repeat inside one list is dropped too. */
export function readTxnRefs(v: unknown): TxnRef[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const out: TxnRef[] = [];
  for (const x of v) {
    if (!x || typeof x !== 'object') continue;
    const o = x as Record<string, unknown>;
    if (!isInt(o.txnId)) continue;
    const s = (o.snapshot && typeof o.snapshot === 'object' ? o.snapshot : {}) as Record<string, unknown>;
    const snapshot: TxnSnapshot = { date: isDay(s.date) ? s.date : '', payee: typeof s.payee === 'string' ? s.payee : '', amountCents: isInt(s.amountCents) ? s.amountCents : 0 };
    const ref: TxnRef = { txnId: o.txnId, snapshot };
    if (o.splitIndex !== undefined && o.splitIndex !== null) {
      if (!isInt(o.splitIndex) || o.splitIndex < 0) continue;
      ref.splitIndex = o.splitIndex;
      const f = o.fp && typeof o.fp === 'object' ? (o.fp as Record<string, unknown>) : null;
      if (f && isInt(f.splitCount) && isInt(f.amountCents)) ref.fp = { splitCount: f.splitCount, amountCents: f.amountCents, categoryId: isInt(f.categoryId) ? f.categoryId : null };
    }
    const k = pieceKey(ref);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(ref);
  }
  return out;
}

/** Identifies a piece: the transaction plus the part (or "w" for the whole). Two references with the same key are the same piece. */
export const pieceKey = (r: Pick<TxnRef, 'txnId' | 'splitIndex'>): string => `${r.txnId}:${r.splitIndex === undefined ? 'w' : r.splitIndex}`;

/** Can this transaction ever count as spending? Transfers and initial-setup entries cannot. */
export const isSpendingTxn = (t: Txn): boolean => !t.transferTxnId && !isSetupTxn(t);

/** Builds a reference to the whole transaction or to one part, recording the snapshot (and the fingerprint for a part). */
export function makeTxnRef(t: Txn, splitIndex?: number): TxnRef {
  if (t.id === undefined) throw new Error('That transaction has no id.');
  if (splitIndex === undefined) return { txnId: t.id, snapshot: { date: t.date, payee: t.payee, amountCents: t.amountCents } };
  const s = t.splits?.[splitIndex];
  if (!s) throw new Error('That part of the transaction does not exist.');
  return { txnId: t.id, splitIndex, snapshot: { date: t.date, payee: t.payee, amountCents: s.amountCents }, fp: { splitCount: t.splits!.length, amountCents: s.amountCents, categoryId: s.categoryId } };
}

// ---- what a reference means right now ----

export type RefState =
  /** Found and unchanged since it was linked. */
  | 'ok'
  /** Whole transaction found; its date, payee or amount differs from the snapshot. The LIVE amount is used. */
  | 'changed'
  /** The transaction no longer exists. */
  | 'missing'
  /** The part is not the one that was linked (removed, reordered, changed, or the transaction is no longer split), or there is no fingerprint to check. */
  | 'split-changed'
  /** The transaction is now a transfer or an initial-setup entry, which is not spending. */
  | 'not-spending';

export interface ResolvedRef {
  ref: TxnRef;
  key: string;
  state: RefState;
  /** Spending in cents (positive = money out, negative = money back) from the LIVE transaction. 0 when the reference needs review. */
  spendCents: number;
  /** True when the reference cannot be trusted and is left OUT of totals. */
  needsReview: boolean;
  /** The live transaction, when found. */
  txn?: Txn;
  /** Plain-words explanation for states other than 'ok'. */
  note: string;
}

export type TxnLookup = (txnId: number) => Txn | undefined;

const money = (c: number) => formatCents(Math.abs(c));
export const snapshotText = (r: TxnRef) => `${r.snapshot.payee || 'a transaction'}${r.snapshot.date ? ` on ${r.snapshot.date}` : ''}, ${r.snapshot.amountCents > 0 ? 'money back ' : 'paid '}${money(r.snapshot.amountCents)} when linked`;

export function resolveRef(ref: TxnRef, lookup: TxnLookup): ResolvedRef {
  const key = pieceKey(ref);
  const t = lookup(ref.txnId);
  const review = (state: RefState, note: string): ResolvedRef => ({ ref, key, state, spendCents: 0, needsReview: true, txn: t, note });
  if (!t) return review('missing', `The transaction was deleted or is not on this device (${snapshotText(ref)}). It is not counted. Pick another or remove this reference.`);
  if (!isSpendingTxn(t)) return review('not-spending', 'This transaction is now a transfer or a setup entry, which is not spending. It is not counted. Remove this reference or pick another.');
  if (ref.splitIndex === undefined) {
    const differs = t.amountCents !== ref.snapshot.amountCents || t.date !== ref.snapshot.date || t.payee !== ref.snapshot.payee;
    return {
      ref, key, txn: t, needsReview: false, spendCents: -t.amountCents,
      state: differs ? 'changed' : 'ok',
      note: differs ? `Changed in Finance since it was linked (was ${snapshotText(ref)}). The current amount is used.` : '',
    };
  }
  const parts = t.splits;
  const idx = ref.splitIndex;
  const part = parts?.[idx];
  if (!parts?.length || !part) return review('split-changed', `The part you linked (${snapshotText(ref)}) is no longer in that transaction. It is not counted. Pick the part again.`);
  if (!ref.fp) return review('split-changed', 'This reference cannot be checked against the transaction. It is not counted. Pick the part again.');
  const same = ref.fp.splitCount === parts.length && ref.fp.amountCents === part.amountCents && ref.fp.categoryId === part.categoryId;
  if (!same) return review('split-changed', `The parts of this transaction were changed after you linked it (${snapshotText(ref)}). It is not counted, because the part in that position may now be a different one. Pick the part again.`);
  return {
    ref, key, txn: t, needsReview: false, spendCents: -part.amountCents,
    state: t.date !== ref.snapshot.date || t.payee !== ref.snapshot.payee ? 'changed' : 'ok',
    note: t.date !== ref.snapshot.date || t.payee !== ref.snapshot.payee ? `The date or payee changed in Finance since it was linked (was ${snapshotText(ref)}). The part itself is unchanged.` : '',
  };
}

// ---- checks before saving ----

/** The plain-words problem with a list of references on ONE record, or null. Only the structure and repeats: whether a transaction exists is checked for NEW references by `checkNewRefs`. */
export function validateTxnRefs(refs: TxnRef[]): string | null {
  if (refs.length > MAX_TXN_REFS) return `That is too many linked transactions (${MAX_TXN_REFS} at most).`;
  const seen = new Set<string>();
  const whole = new Set<number>();
  const parts = new Set<number>();
  for (const r of refs) {
    if (!isInt(r.txnId)) return 'A linked transaction is not valid.';
    if (r.splitIndex !== undefined && (!isInt(r.splitIndex) || r.splitIndex < 0 || !r.fp)) return 'A linked part of a transaction is not valid. Pick it again.';
    const k = pieceKey(r);
    if (seen.has(k)) return 'The same transaction is linked twice on this record.';
    seen.add(k);
    (r.splitIndex === undefined ? whole : parts).add(r.txnId);
  }
  for (const id of whole) if (parts.has(id)) return 'You linked a whole transaction and also one of its parts. That would count it twice. Keep one.';
  return null;
}

/**
 * Checks references that are NEW on a record (not already stored on it) against the live transactions: they must exist, be spending, and
 * (for a part) match what was just picked. References already on the record are left alone, so a record with a stale reference can still
 * be edited and saved.
 */
export function checkNewRefs(refs: TxnRef[], existing: TxnRef[], lookup: TxnLookup): string | null {
  const had = new Set(existing.map(pieceKey));
  for (const r of refs) {
    if (had.has(pieceKey(r))) continue;
    const res = resolveRef(r, lookup);
    if (res.state === 'missing') return 'A transaction you picked no longer exists.';
    if (res.state === 'not-spending') return 'A transfer or setup entry cannot be linked as spending.';
    if (res.needsReview) return 'A part of a transaction you picked has changed. Pick it again.';
  }
  return null;
}
