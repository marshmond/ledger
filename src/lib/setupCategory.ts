import type { FinanceDB } from '../db';
import type { Split, Txn } from '../types';

/**
 * "Initial setup": a category for the entries you make to bring an account to its real current balance (instead of using the opening
 * balance). Those entries change the account's balance, and so net worth and Ready to Assign, but they are not income or spending, so
 * reports, the budget, the forecast, and the flow diagram leave them out.
 *
 * It lives in its own "System" group with fixed ids, so every device creates the very same records (nothing doubles up when you sync).
 */

export const SETUP_GROUP_ID = 9_000_000_000_000_001;
export const SETUP_CATEGORY_ID = 9_000_000_000_000_002;
export const SETUP_GROUP_NAME = 'System';
export const SETUP_CATEGORY_NAME = 'Initial setup';

/** One part of a transaction (or a whole transaction) filed under Initial setup. */
export const isSetupAlloc = (s: Pick<Split, 'categoryId'>): boolean => s.categoryId === SETUP_CATEGORY_ID;

/** A transaction that is wholly an initial setup entry. */
export const isSetupTxn = (t: Pick<Txn, 'categoryId' | 'splits'>): boolean => !t.splits?.length && t.categoryId === SETUP_CATEGORY_ID;

/** Creates the group and category if they are missing. Safe to run any time. */
export async function ensureSetupCategory(d: FinanceDB): Promise<void> {
  await d.transaction('rw', d.categoryGroups, d.categories, async () => {
    if (!(await d.categoryGroups.get(SETUP_GROUP_ID))) await d.categoryGroups.add({ id: SETUP_GROUP_ID, name: SETUP_GROUP_NAME });
    if (!(await d.categories.get(SETUP_CATEGORY_ID))) await d.categories.add({ id: SETUP_CATEGORY_ID, groupId: SETUP_GROUP_ID, name: SETUP_CATEGORY_NAME, kind: 'expense' });
  });
}
