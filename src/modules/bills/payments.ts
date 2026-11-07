/**
 * FINANCE PAYMENTS of one billing period (B3, B0 4.1a and 6.4). PURE: no database, no clock, nothing written. Finance stays the sole authority for
 * Finance transactions: a `payment-link` fact holds only a REFERENCE (the shared `TxnRef`), and everything below is worked out from the LIVE
 * transaction each time it is read, so there is no stored "paid" bit that can go stale.
 *
 * The money rules are not re-implemented here. They are Home & Assets' `spend()` (unchanged), called with one record that holds the period's
 * references, so a whole transaction and its parts, a piece linked twice, a stale split, a deleted transaction and a refund all behave exactly as
 * they do for Home & Assets and Household Services:
 *   - each transaction piece (`pieceKey`) counts ONCE; a whole transaction that counts covers its parts;
 *   - a reference that is missing, whose split changed, or that is no longer spending contributes 0, is KEPT, and is listed for review;
 *   - a whole transaction uses the live amount (and is flagged when it changed since linking); the snapshot is explanation only;
 *   - spend = minus the Finance amount, so a refund (money back) lowers the total.
 * What `spend()` does not say is said here: the role of every link (counted, duplicate, covered, needs review), Finance's own status of each
 * counted piece (pending, cleared or reconciled: owner-maintained words, never "settled"), and whether the net shows a reversal.
 */
import { spend, type CostRecord } from '../assets/spending';
import { pieceKey, resolveRef, type ResolvedRef, type TxnLookup, type TxnRef } from '../../lib/txnRef';
import type { TxnStatus } from '../../types';

/** A lookup that finds nothing: used by pure callers that have no Finance data. Every reference then reads as missing (it is never invented as paid). */
export const NO_FINANCE: TxnLookup = () => undefined;

export type LinkRole = 'counted' | 'duplicate' | 'covered' | 'review';
export interface LinkFact { factId: number; createdAt: number; ref: TxnRef }

export interface PaymentPiece {
  factId: number;
  ref: TxnRef;
  key: string;
  role: LinkRole;
  resolved: ResolvedRef;
  /** What this link adds to the period's net, in cents (positive = money out, negative = money back). 0 unless it is the counted one. */
  spendCents: number;
  /** Finance's own word for the live transaction (owner-maintained; not bank settlement). Null when the transaction is not found. */
  status: TxnStatus | null;
  /** The live transaction came from, or was matched to, an imported bank file. Shown as extra detail only. */
  imported: boolean;
}

export interface FinancePayments {
  /** At least one `payment-link` fact is in force. Even if every one is stale this is true: Finance is the source and typed amounts are left out. */
  linked: boolean;
  /** Every link of the period, oldest first, each with its role. */
  pieces: PaymentPiece[];
  /** Net money recorded as paid: counted pieces only, money out minus money back. May be zero or negative (a refund larger than the payments). */
  netCents: number;
  /** What the period's amounts use: the net, never below zero. */
  paidCents: number;
  /** Counted money out and counted money back, kept apart so a reversal can be told from "nothing paid". */
  outCents: number;
  backCents: number;
  /** Something was counted and the net is zero or less because of money coming back: a reversal or refund. */
  reversed: boolean;
  counts: { counted: number; duplicate: number; covered: number; review: number; changed: number };
  /** Counted pieces by Finance's own status. */
  statuses: Record<TxnStatus, number>;
}

export const EMPTY_PAYMENTS: FinancePayments = {
  linked: false, pieces: [], netCents: 0, paidCents: 0, outCents: 0, backCents: 0, reversed: false,
  counts: { counted: 0, duplicate: 0, covered: 0, review: 0, changed: 0 }, statuses: { pending: 0, cleared: 0, reconciled: 0 },
};

/** Oldest first, then lowest id: the one order every figure and every "first record wins" decision uses. */
const byAge = (a: LinkFact, b: LinkFact) => a.createdAt - b.createdAt || a.factId - b.factId;

export function financePayments(links: LinkFact[], lookup: TxnLookup): FinancePayments {
  if (links.length === 0) return EMPTY_PAYMENTS;
  const ordered = [...links].sort(byAge);
  const record: CostRecord<'paid'> = { id: 'period', assetId: 0, group: 'paid', title: 'period', manualCents: null, refs: ordered.map((l) => l.ref) };
  const s = spend<'paid'>([record], lookup, ['paid']);
  const reviewKeys = new Set(s.review.map((r) => r.resolved.key));
  const coveredKeys = new Set(s.coveredParts.map((r) => r.resolved.key));
  const counted = new Map(s.pieces.map((p) => [p.key, p]));
  const seen = new Set<string>();
  const pieces: PaymentPiece[] = ordered.map((l) => {
    const resolved = resolveRef(l.ref, lookup);
    const key = pieceKey(l.ref);
    let role: LinkRole;
    if (reviewKeys.has(key)) role = 'review';
    else if (coveredKeys.has(key)) role = 'covered';
    else if (seen.has(key)) role = 'duplicate';
    else role = 'counted';
    if (role === 'counted') seen.add(key);
    const t = resolved.txn;
    return { factId: l.factId, ref: l.ref, key, role, resolved, spendCents: role === 'counted' ? counted.get(key)?.spendCents ?? 0 : 0, status: t ? t.status : null, imported: !!t && (!!t.externalId || !!t.fingerprint) };
  });
  const live = pieces.filter((p) => p.role === 'counted');
  const outCents = live.reduce((n, p) => n + Math.max(0, p.spendCents), 0);
  const backCents = live.reduce((n, p) => n + Math.max(0, -p.spendCents), 0);
  const netCents = s.totalCents;
  const statuses: Record<TxnStatus, number> = { pending: 0, cleared: 0, reconciled: 0 };
  for (const p of live) if (p.status) statuses[p.status]++;
  return {
    linked: true, pieces, netCents, paidCents: Math.max(0, netCents), outCents, backCents, reversed: live.length > 0 && netCents <= 0 && backCents > 0,
    counts: { counted: live.length, duplicate: pieces.filter((p) => p.role === 'duplicate').length, covered: pieces.filter((p) => p.role === 'covered').length, review: pieces.filter((p) => p.role === 'review').length, changed: live.filter((p) => p.resolved.state === 'changed').length },
    statuses,
  };
}

/** Finance's own words for a counted piece's status: never a settlement claim. Pending is "entered, not marked cleared"; cleared is "marked cleared by you or a bank file". */
export const STATUS_WORDS: Record<TxnStatus, string> = {
  pending: 'Recorded in Finance: pending',
  cleared: 'Recorded in Finance: cleared',
  reconciled: 'Recorded in Finance: reconciled',
};
export const STATUS_DETAIL: Record<TxnStatus, string> = {
  pending: 'It is entered in Finance but not marked cleared. That is your own entry; it does not show that the provider has been paid.',
  cleared: 'It was marked cleared in Finance (by you or from an imported bank file). That does not by itself show that the provider received it.',
  reconciled: 'It is included in an account reconciliation you completed in Ledger.',
};

/** One line saying what Finance says about the counted pieces together ("Recorded in Finance: pending", or "Recorded in Finance: 2 cleared, 1 pending"). Null when nothing is counted. */
export function statusSummary(f: FinancePayments): string | null {
  const parts = (['pending', 'cleared', 'reconciled'] as const).filter((k) => f.statuses[k] > 0);
  if (parts.length === 0) return null;
  if (parts.length === 1) return STATUS_WORDS[parts[0]];
  return `Recorded in Finance: ${parts.map((k) => `${f.statuses[k]} ${k}`).join(', ')}`;
}
