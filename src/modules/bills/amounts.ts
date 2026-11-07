/**
 * AMOUNTS of one billing period (B2, B0 6.3). PURE. Three independent figures: what is OWED, what is PAID, what REMAINS. Independent of timing and
 * of any label. Expected amounts are not payments, an invoice is not proof of payment, a credit is not a payment, and an unknown amount is
 * never zero.
 *
 *   owed basis   billed (exactly one distinct invoice amount, a confirmed 0 included) > expected (fixed price step) > estimate (variable price)
 *                > unknown. Two different invoice amounts give `disagree`: owed is UNKNOWN, never one of them picked.
 *   credit       the sum of effective credits (a credit recorded twice with the same amount and note counts once)
 *   owed         max(0, basis - credit); unknown when the basis is unknown or the invoices disagree
 *   paid         ONLY an amount the owner typed as paid outside Finance. A declaration with no amount adds nothing. Two DIFFERENT typed amounts
 *                count as 0 and are listed for review (identical ones count once). Finance payments arrive in B3; this is only the typed side.
 *   remaining    max(0, owed - paid) when owed is known, else unknown; overpaid = max(0, paid - owed)
 */
import type { ExpectedAmount } from './model';
import type { CycleRecord, FactBody } from './cycleModel';

export type OwedBasis = 'billed' | 'expected' | 'estimate' | 'unknown' | 'disagree';
export interface Amounts {
  basis: OwedBasis;
  basisCents: number | null;
  creditCents: number;
  owed: number | null;
  paid: number;
  /** Whole-cent amounts typed as paid outside Finance, after de-duplication (two different ones => counted as 0). */
  paidConflict: boolean;
  remaining: number | null;
  overpaid: number;
  /** An invoice is recorded (whether or not the invoices agree). */
  invoiceRecorded: boolean;
}

type Eff = CycleRecord & { body: FactBody };
const bodies = <F extends FactBody['fact']>(facts: Eff[], f: F) => facts.filter((x) => x.body.fact === f).map((x) => x.body as Extract<FactBody, { fact: F }>);

/** Distinct values by a key, keeping the first. */
const distinct = <T,>(xs: T[], key: (x: T) => string) => { const keys = xs.map(key); return xs.filter((_, i) => keys.indexOf(keys[i]) === i); };

/** The credits that count: identical ones (same amount and note) count once. */
export const effectiveCredits = (facts: Eff[]) => distinct(bodies(facts, 'credit'), (c) => `${c.cents}|${c.note.trim().toLowerCase()}`);

export function deriveAmounts(effective: Eff[], expected: ExpectedAmount | null): Amounts {
  const invoices = bodies(effective, 'invoice');
  const invoiceAmounts = [...new Set(invoices.map((i) => i.invoicedCents))];
  let basis: OwedBasis;
  let basisCents: number | null;
  if (invoiceAmounts.length > 1) { basis = 'disagree'; basisCents = null; }
  else if (invoiceAmounts.length === 1) { basis = 'billed'; basisCents = invoiceAmounts[0]; }
  else if (expected && expected.cents !== null && expected.basis === 'fixed') { basis = 'expected'; basisCents = expected.cents; }
  else if (expected && expected.cents !== null && expected.basis === 'variable') { basis = 'estimate'; basisCents = expected.cents; }
  else { basis = 'unknown'; basisCents = null; }

  const creditCents = effectiveCredits(effective).reduce((s, c) => s + c.cents, 0);
  const owed = basisCents === null ? null : Math.max(0, basisCents - creditCents);

  const typed = [...new Set(bodies(effective, 'paid-outside').flatMap((p) => (p.cents !== null && p.cents > 0 ? [p.cents] : [])))];
  const paidConflict = typed.length > 1;
  const paid = typed.length === 1 ? typed[0] : 0;

  return {
    basis, basisCents, creditCents, owed, paid, paidConflict,
    remaining: owed === null ? null : Math.max(0, owed - paid),
    overpaid: owed === null ? 0 : Math.max(0, paid - owed),
    invoiceRecorded: invoices.length > 0,
  };
}

/** Is a payment declared (paid in full, or paid outside with no amount)? Never an amount. */
export function declared(effective: Eff[]): boolean {
  return effective.some((x) => x.body.fact === 'paid-in-full' || (x.body.fact === 'paid-outside' && (x.body.cents === null || x.body.cents === 0)));
}
/** Does any effective record say a payment happened (typed amount or declaration)? */
export const paymentEvidence = (effective: Eff[]) => effective.some((x) => x.body.fact === 'paid-outside' || x.body.fact === 'paid-in-full');
