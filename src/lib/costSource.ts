/**
 * The either/or choice on a form: a cost is a TYPED amount or taken from Finance transactions, never both. Pure.
 * Switching never happens silently: if saving would drop what the other source held, `dropped` says what, and the form makes the owner
 * tick a box that names it before it saves.
 */
import { formatCents } from './money';
import type { TxnRef } from './txnRef';

export type CostChoice = 'manual' | 'finance';

/** The choice a record starts with: references win when it has any (also for a record that arrived with both). */
export const initialChoice = (_typedCents: number | null, refs: TxnRef[]): CostChoice => (refs.length ? 'finance' : 'manual');

export interface ChosenCost {
  /** What to save. Exactly one of these is non-empty, or neither (unknown). */
  cents: number | null;
  refs: TxnRef[];
  /** What saving would remove from the other source, in plain words, or null. */
  dropped: string | null;
  /** The typed text is not an amount. */
  badAmount: boolean;
}

/** `parse` is the form's own text-to-cents (blank = null, not an amount = undefined). */
export function chooseCost(choice: CostChoice, text: string, refs: TxnRef[], parse: (t: string) => number | null | undefined): ChosenCost {
  const typed = parse(text);
  if (choice === 'finance') {
    const hadTyped = text.trim() !== '' && typed !== null;
    return { cents: null, refs, badAmount: false, dropped: hadTyped ? `the typed amount${typed !== undefined ? ` (${formatCents(typed)})` : ''}` : null };
  }
  return {
    cents: typed === undefined ? null : typed, refs: [], badAmount: typed === undefined,
    dropped: refs.length ? `the ${refs.length === 1 ? 'link to 1 Finance transaction' : `links to ${refs.length} Finance transactions`} (the transactions themselves are not touched)` : null,
  };
}
