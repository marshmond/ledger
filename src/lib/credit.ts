import { parseAmountToCents } from './money';

/**
 * Credit cards with an optional limit: how much is left before you hit it. A card's balance is negative when you owe money (positive
 * means the card is in credit, for example after an overpayment, which adds to what you can spend).
 */

export interface CreditStatus {
  limit: number;
  /** What you owe (negative when the card is in credit). */
  owed: number;
  /** Credit left before the limit (negative when over it). */
  available: number;
  /** Share of the limit in use, 0 or more. */
  usedPct: number;
  level: 'ok' | 'high' | 'over';
}

/** Null when no limit is set. */
export function creditStatus(balanceCents: number, limitCents: number | null | undefined): CreditStatus | null {
  if (!limitCents || limitCents <= 0) return null;
  const owed = -balanceCents;
  const available = limitCents - owed;
  const usedPct = (Math.max(0, owed) / limitCents) * 100;
  return { limit: limitCents, owed, available, usedPct, level: available < 0 ? 'over' : usedPct >= 75 ? 'high' : 'ok' };
}

/** What you typed for a limit: blank clears it, otherwise a positive amount. */
export function parseLimit(text: string): { cents: number | undefined } | { error: string } {
  if (!text.trim()) return { cents: undefined };
  const c = parseAmountToCents(text);
  if (c === null) return { error: 'That is not a valid amount.' };
  if (c <= 0) return { error: 'A credit limit must be more than zero. Leave it blank for none.' };
  return { cents: c };
}

/** A plain sentence about utilization, since keeping it low is commonly advised. */
export function utilizationNote(s: CreditStatus): string {
  if (s.level === 'over') return 'Over the limit.';
  if (s.usedPct >= 75) return 'High use of the limit; lenders and credit scores usually prefer under 30%.';
  if (s.usedPct > 30) return 'Above 30% of the limit, which credit scores usually prefer to stay under.';
  return 'Under 30% of the limit.';
}
