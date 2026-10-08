import Dexie, { type Table } from 'dexie';
import type {
  Account,
  Assignment,
  Bonus,
  Category,
  CategoryGroup,
  ImportBatch,
  IncomeProfile,
  Person,
  RecurringLog,
  RecurringRule,
  TaxSettings,
  Txn,
} from './types';

export class FinanceDB extends Dexie {
  accounts!: Table<Account, number>;
  categoryGroups!: Table<CategoryGroup, number>;
  categories!: Table<Category, number>;
  txns!: Table<Txn, number>;
  importBatches!: Table<ImportBatch, number>;
  assignments!: Table<Assignment, number>;
  recurring!: Table<RecurringRule, number>;
  recurringLog!: Table<RecurringLog, number>;
  people!: Table<Person, number>;
  incomeProfiles!: Table<IncomeProfile, number>;
  bonuses!: Table<Bonus, number>;
  taxSettings!: Table<TaxSettings, number>;

  constructor(name = 'ledger') {
    super(name);
    this.version(1).stores({
      accounts: '++id, kind',
      categoryGroups: '++id',
      categories: '++id, groupId',
      txns: '++id, accountId, date, [accountId+date], fingerprint, externalId, transferTxnId, importBatchId',
      importBatches: '++id, accountId',
    });
    this.version(2)
      .stores({
        assignments: '++id, month, [month+key]',
        recurring: '++id, accountId',
        recurringLog: '++id, [ruleId+date]',
      })
      .upgrade(async (tx) => {
        // Categories seeded under "Income" in v1 become income categories.
        const groups = await tx.table('categoryGroups').toArray();
        const incomeIds = groups.filter((g) => g.name === 'Income').map((g) => g.id);
        await tx
          .table('categories')
          .toCollection()
          .modify((c) => {
            if (incomeIds.includes(c.groupId)) c.kind = 'income';
          });
      });
    this.version(3).stores({
      people: '++id',
      incomeProfiles: '++id, [personId+year]',
      bonuses: '++id, [personId+year]',
      taxSettings: '++id, year',
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
    for (const name of cats) {
      await d.categories.add({ groupId, name, kind: group === 'Income' ? 'income' : 'expense' });
    }
  }
}
