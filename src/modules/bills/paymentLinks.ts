/**
 * Rules for CONFIRMING a Finance payment against a billing period (B3). PURE: no database, no clock. The write itself is in cycleData.ts; the words the
 * owner sees are built here so the preview and the refusal say the same thing.
 *
 *  - A link is added only when the owner confirms it. Nothing is matched or suggested here, and an amount or date that merely looks right is never a link.
 *  - The piece must exist, be spending (not a transfer or a setup entry) and, for a part, match what was just picked (the shared `checkNewRefs`).
 *  - The same piece cannot be linked twice to one period (visibly refused), and a whole transaction cannot sit beside one of its parts (the shared rule:
 *    it would count the same money twice). Different pieces add up, which is how two real payments are represented.
 *  - ONE money source per period: while a typed outside-Finance amount is in force, linking needs the owner's explicit confirmation to set that typed
 *    evidence aside (it stays in History, is not counted, is not erased). The reverse is refused: a typed amount cannot be added while Finance links
 *    are in force (remove the links first, or leave the amount empty).
 */
import { checkNewRefs, pieceKey, validateTxnRefs, type TxnLookup, type TxnRef } from '../../lib/txnRef';
import type { CycleRecord, FactBody } from './cycleModel';

type Eff = CycleRecord & { body: FactBody };

/** The payment links in force for a period (readable, not set aside), as `{ id, ref }`. */
export const effectiveLinks = (facts: Eff[]): { id: number; ref: TxnRef }[] => facts.flatMap((f) => (f.body.fact === 'payment-link' ? [{ id: f.id, ref: f.body.ref }] : []));

/** The typed outside-Finance payments in force that carry an amount (these are the ones that would be counted, so these are the ones a switch sets aside). */
export const typedPayments = (facts: Eff[]) => facts.filter((f) => f.body.fact === 'paid-outside' && f.body.cents !== null && f.body.cents > 0);

export const SAME_PIECE = 'This payment is already linked to this billing period. Nothing was changed.';
export const SWITCH_NEEDED = 'This billing period already has a payment you typed as paid outside Finance. Ledger counts one source at a time, so linking a Finance payment needs your confirmation that the typed payment is set aside (it stays in the history and is not counted). Nothing was changed.';
export const TYPED_WHILE_LINKED = 'A Finance payment is linked to this billing period, and Ledger counts one source at a time. Remove the linked payment first, or record this without an amount. Nothing was changed.';

export interface LinkCheck {
  ref: TxnRef;
  /** The links already in force for the period. When replacing one, leave that one out. */
  existing: { id: number; ref: TxnRef }[];
  /** Typed outside-Finance payments (with an amount) in force for the period. */
  typed: CycleRecord[];
  /** The owner confirmed that the typed payment(s) are set aside. */
  switchTyped: boolean;
  lookup: TxnLookup;
}

/** The plain-words reason this link cannot be saved, or null. Order matters: the most useful message first. */
export function linkProblem(c: LinkCheck): string | null {
  const bad = validateTxnRefs([c.ref]);
  if (bad) return bad;
  const key = pieceKey(c.ref);
  if (c.existing.some((x) => pieceKey(x.ref) === key)) return SAME_PIECE;
  const missing = checkNewRefs([c.ref], [], c.lookup);
  if (missing) return missing;
  const overlap = validateTxnRefs([...c.existing.map((x) => x.ref), c.ref]);
  if (overlap) return `${overlap} Nothing was changed.`;
  if (c.typed.length > 0 && !c.switchTyped) return SWITCH_NEEDED;
  return null;
}

/** The sentence describing what a link replaces, for the preview. */
export const switchLines = (typedCount: number): string[] => (typedCount === 0 ? [] : [
  `${typedCount === 1 ? 'The payment you typed as paid outside Finance' : `The ${typedCount} payments you typed as paid outside Finance`} will be set aside. ${typedCount === 1 ? 'It stays' : 'They stay'} visible under History and ${typedCount === 1 ? 'is' : 'are'} not counted.`,
  'A Finance transaction now represents the payment. Ledger will not count both. No Finance transaction is changed.',
]);
