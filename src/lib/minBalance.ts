import type { Account, Txn } from '../types';
import type { BelowMinimum } from './alerts';

/**
 * Minimum balance per account ("never let checking go below $2,000").
 * Two uses, both pure here:
 *  1. Today's real balance: which open checking or savings accounts are under their own minimum right now.
 *  2. The cash forecast: it adds the accounts into one pool, so its warning level becomes the total of the minimums of the accounts
 *     it counts. With no minimum set anywhere, the forecast keeps using the single "Warn me below" level.
 */

const isCash = (a: Account) => !a.closed && (a.kind === 'checking' || a.kind === 'savings');
const minOf = (a: Account) => (typeof a.minBalanceCents === 'number' && a.minBalanceCents > 0 ? Math.round(a.minBalanceCents) : 0);

/** Accounts under their minimum right now, largest shortfall first. */
export function belowMinimum(accounts: Account[], txns: Txn[]): BelowMinimum[] {
  const watched = accounts.filter((a) => isCash(a) && minOf(a) > 0);
  if (watched.length === 0) return [];
  const sums = new Map<number, number>();
  for (const t of txns) sums.set(t.accountId, (sums.get(t.accountId) ?? 0) + t.amountCents);
  return watched
    .map((a) => ({ accountId: a.id!, name: a.name, balanceCents: a.openingBalanceCents + (sums.get(a.id!) ?? 0), minCents: minOf(a) }))
    .filter((b) => b.balanceCents < b.minCents)
    .sort((x, y) => (y.minCents - y.balanceCents) - (x.minCents - x.balanceCents) || x.name.localeCompare(y.name));
}

/** The total of the minimums of the accounts the forecast counts (checking, and savings when included). 0 = none set. */
export function forecastFloor(accounts: Account[], includeSavings: boolean): number {
  return accounts
    .filter((a) => isCash(a) && (a.kind === 'checking' || includeSavings))
    .reduce((s, a) => s + minOf(a), 0);
}

/** The level the forecast warns below: the sum of minimums if any are set, otherwise the single level from the forecast settings. */
export function effectiveThreshold(floorCents: number, settingsThresholdCents: number): number {
  return floorCents > 0 ? floorCents : settingsThresholdCents;
}
