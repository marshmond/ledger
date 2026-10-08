import Dexie, { type Table } from 'dexie';
import type { Account, Category, CategoryGroup, ImportBatch, Txn } from './types';

export class FinanceDB extends Dexie {
  accounts!: Table<Account, number>;
  categoryGroups!: Table<CategoryGroup, number>;
  categories!: Table<Category, number>;
  txns!: Table<Txn, number>;
  importBatches!: Table<ImportBatch, number>;

  constructor(name = 'ledger') {
    super(name);
    this.version(1).stores({
      accounts: '++id, kind',
      categoryGroups: '++id',
      categories: '++id, groupId',
      txns: '++id, accountId, date, [accountId+date], fingerprint, externalId, transferTxnId, importBatchId',
      importBatches: '++id, accountId',
    });
  }
}

export const db = new FinanceDB();

const STARTER: Record<string, string[]> = {
  Housing: ['Rent / Mortgage', 'Utilities'],
  Food: ['Groceries', 'Dining Out'],
  Transportation: ['Gas', 'Auto Maintenance'],
  Health: ['Medical', 'Pharmacy'],
  Lifestyle: ['Entertainment', 'Shopping'],
  Income: ['Paycheck', 'Other Income'],
};

/** Seeds an editable starter set of categories on first run only. */
export async function seedIfEmpty(d: FinanceDB = db) {
  if ((await d.categoryGroups.count()) > 0) return;
  for (const [group, cats] of Object.entries(STARTER)) {
    const groupId = await d.categoryGroups.add({ name: group });
    for (const name of cats) await d.categories.add({ groupId, name });
  }
}
