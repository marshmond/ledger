import type { FinanceDB } from '../db';
import type { Holding, TaxLot } from '../types';

/**
 * D20.1B. Two deletes that used to sit inside screen handlers behind the browser's confirm box (NC-10 and NC-14). The code is MOVED here unchanged so the
 * confirmation dialogs can call it and a test can drive it on a disposable database. Nothing about what they write has changed.
 */

/** How many transactions use this category, on the transaction itself or on one of its splits. */
export const countCategoryUse = (d: FinanceDB, categoryId: number): Promise<number> =>
  d.txns.filter((t) => t.categoryId === categoryId || !!t.splits?.some((s) => s.categoryId === categoryId)).count();

/** Deletes a category: its transactions and splits become uncategorized, then the category goes. One transaction over categories and transactions. */
export async function deleteCategoryUncategorizing(d: FinanceDB, categoryId: number): Promise<void> {
  await d.transaction('rw', d.categories, d.txns, async () => {
    await d.txns.filter((t) => t.categoryId === categoryId).modify({ categoryId: null });
    await d.txns.filter((t) => !!t.splits?.some((s) => s.categoryId === categoryId)).modify((t) => {
      t.splits = t.splits!.map((s) => (s.categoryId === categoryId ? { ...s, categoryId: null } : s));
    });
    await d.categories.delete(categoryId);
  });
}

/**
 * Deletes an HSA withdrawal and gives the cash it took back to the account, in one transaction. The withdrawal is read INSIDE the transaction, so a withdrawal
 * that is already gone (deleted on another device while a dialog was open) gives nothing back a second time. Returns true if it deleted one.
 */
export async function deleteHsaWithdrawal(d: FinanceDB, accountId: number, withdrawalId: number): Promise<boolean> {
  return d.transaction('rw', d.hsaWithdrawals, d.invAccounts, async () => {
    const w = await d.hsaWithdrawals.get(withdrawalId);
    if (!w) return false;
    await d.hsaWithdrawals.delete(withdrawalId);
    const cur = await d.invAccounts.get(accountId);
    if (cur && w.fromCashCents > 0) await d.invAccounts.update(accountId, { cashCents: cur.cashCents + w.fromCashCents });
    return true;
  });
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// RS-1A (NC-18, NC-19, NC-22). Three deletes that used to be separate awaits in a screen handler. Each is now ONE database transaction: it re-reads its target
// INSIDE the transaction, refuses (writing nothing) when the target is gone, belongs elsewhere, or still has something the owner has not authorized deleting, and
// otherwise deletes everything or nothing. A thrown error rolls the whole transaction back. No React state, timers or network calls happen inside them.
// ---------------------------------------------------------------------------------------------------------------------------------------------------

export type DeleteRefusal = { ok: false; reason: 'missing' | 'moved' | 'taxLots' | 'sales'; message: string };

/**
 * NC-18. Removes a holding and its tax lots together. It does not record a sale. `expectedAccountId` (the account the owner was looking at) makes a holding that now
 * sits in a different account, or was already removed, a refusal instead of a surprise.
 */
export async function deleteHoldingWithLots(d: FinanceDB, holdingId: number, expectedAccountId?: number): Promise<{ ok: true; lotsDeleted: number } | DeleteRefusal> {
  return d.transaction('rw', d.holdings, d.taxLots, async () => {
    const h = await d.holdings.get(holdingId);
    if (!h) return { ok: false as const, reason: 'missing' as const, message: 'That holding was already removed. Nothing was changed.' };
    if (expectedAccountId !== undefined && h.accountId !== expectedAccountId) return { ok: false as const, reason: 'moved' as const, message: 'That holding is no longer in this account. Nothing was changed.' };
    const lotIds = await d.taxLots.where('holdingId').equals(holdingId).primaryKeys();
    await d.taxLots.bulkDelete(lotIds);
    await d.holdings.delete(holdingId);
    return { ok: true as const, lotsDeleted: lotIds.length };
  });
}

/** What an investment account holds that matters for deleting it. READ ONLY. */
export interface InvAccountContents {
  holdings: Holding[];
  /** Every tax lot that names the account, or names one of its holdings. */
  lots: TaxLot[];
  /** How many of the holdings have at least one lot. */
  holdingsWithLots: number;
  /** Lots that name the account but belong to none of its current holdings (not expected; kept as their own count so the message is honest). */
  strayLots: number;
}

export async function readInvAccountContents(d: FinanceDB, accountId: number): Promise<InvAccountContents> {
  const holdings = await d.holdings.where('accountId').equals(accountId).toArray();
  const ids = new Set(holdings.map((h) => h.id!));
  const byAccount = await d.taxLots.where('accountId').equals(accountId).toArray();
  const byHolding = ids.size ? await d.taxLots.where('holdingId').anyOf([...ids]).toArray() : [];
  const lots = [...new Map([...byAccount, ...byHolding].map((l) => [l.id!, l])).values()];
  const withLots = new Set(lots.filter((l) => ids.has(l.holdingId)).map((l) => l.holdingId));
  return { holdings, lots, holdingsWithLots: withLots.size, strayLots: lots.filter((l) => !ids.has(l.holdingId)).length };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The plain-language reason an account cannot be deleted yet, or null when its contents do not block it. */
export function invAccountBlockMessage(accountName: string, c: Pick<InvAccountContents, 'lots' | 'holdingsWithLots' | 'strayLots'>): string | null {
  if (c.lots.length === 0) return null;
  const where = c.holdingsWithLots > 0 ? ` in ${plural(c.holdingsWithLots, 'holding', 'holdings')}` : '';
  const stray = c.strayLots > 0 ? ` ${plural(c.strayLots, 'lot is', 'lots are')} not attached to any holding in the account, so Ledger cannot tell what ${c.strayLots === 1 ? 'it is' : 'they are'}.` : '';
  return `"${accountName}" still has ${plural(c.lots.length, 'tax lot', 'tax lots')}${where}. Ledger does not delete tax lots along with an account, so nothing was deleted. Remove the holdings first (removing a holding also removes its lots and does not record a sale), then delete the account.${stray}`;
}

/** Why an account with recorded sales cannot be deleted (RS-1A F-1: Undo on a surviving sale would recreate holdings and lots under a deleted account). */
export const invAccountSalesMessage = (accountName: string, n: number): string =>
  `"${accountName}" has ${plural(n, 'recorded sale', 'recorded sales')}, so it cannot be deleted while ${n === 1 ? 'that record remains' : 'those records remain'}. Nothing was deleted. Sales are kept as tax history.`;

/**
 * NC-19. Deletes an investment account and its holdings, all or nothing, and ONLY when none of them has a tax lot. If the account (or any of its holdings) still has tax
 * lots, or any recorded sale names the account, the whole delete is refused before any write (tax lots: deleting them with an account has not been approved; sales: they are history and Undo would recreate records under a deleted account).
 * Sales already recorded, HSA withdrawals, RSU vests and goals that name the account are history or plans and are not touched (as before).
 */
export async function deleteInvestmentAccount(d: FinanceDB, accountId: number): Promise<{ ok: true; holdingsDeleted: number } | DeleteRefusal> {
  return d.transaction('rw', d.invAccounts, d.holdings, d.taxLots, d.sales, async () => {
    const acct = await d.invAccounts.get(accountId);
    if (!acct) return { ok: false as const, reason: 'missing' as const, message: 'That account was already deleted. Nothing was changed.' };
    const c = await readInvAccountContents(d, accountId);
    const blocked = invAccountBlockMessage(acct.name, c);
    if (blocked) return { ok: false as const, reason: 'taxLots' as const, message: blocked };
    const saleCount = await d.sales.where('accountId').equals(accountId).count();
    if (saleCount > 0) return { ok: false as const, reason: 'sales' as const, message: invAccountSalesMessage(acct.name, saleCount) };
    await d.holdings.bulkDelete(c.holdings.map((h) => h.id!));
    await d.invAccounts.delete(accountId);
    return { ok: true as const, holdingsDeleted: c.holdings.length };
  });
}

/** NC-22. Deletes a property and its whole value history together. Loans, Home & Assets records and net worth points are not touched. */
export async function deletePropertyWithValues(d: FinanceDB, propertyId: number): Promise<{ ok: true; valuesDeleted: number } | DeleteRefusal> {
  return d.transaction('rw', d.properties, d.propertyValues, async () => {
    const p = await d.properties.get(propertyId);
    if (!p) return { ok: false as const, reason: 'missing' as const, message: 'That property was already deleted. Nothing was changed.' };
    const valueIds = await d.propertyValues.where('propertyId').equals(propertyId).primaryKeys();
    await d.propertyValues.bulkDelete(valueIds);
    await d.properties.delete(propertyId);
    return { ok: true as const, valuesDeleted: valueIds.length };
  });
}
