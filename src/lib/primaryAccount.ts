import type { FinanceDB } from '../db';
import type { Account } from '../types';

/**
 * The account suggested first when you add a transaction with the quick "+" button. It is stored in settings, so it is the same on
 * every synced device and is part of backups. Loans cannot be primary; a closed or deleted account is simply not used.
 */
export const PRIMARY_KEY = 'primaryAccountId';

export const canBePrimary = (a: Account): boolean => !a.closed && a.kind !== 'loan';

export async function getPrimaryAccountId(d: FinanceDB): Promise<number | null> {
  const row = (await d.settings.get(PRIMARY_KEY)) as { value?: unknown } | undefined;
  return typeof row?.value === 'number' ? row.value : null;
}

/** Sets (or, with null, clears) the primary account. */
export async function setPrimaryAccountId(d: FinanceDB, id: number | null): Promise<void> {
  if (id === null) {
    await d.settings.delete(PRIMARY_KEY);
    return;
  }
  const a = await d.accounts.get(id);
  if (!a || !canBePrimary(a)) throw new Error('This account cannot be the primary payment account');
  await d.settings.put({ key: PRIMARY_KEY, value: id });
}

/** The primary account among those on offer, or undefined when none is set or it is no longer usable. */
export const pickPrimary = (accounts: Account[], primaryId: number | null | undefined): Account | undefined =>
  primaryId == null ? undefined : accounts.find((a) => a.id === primaryId && canBePrimary(a));
