import type { FinanceDB } from '../db';

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
