import Dexie, { type Table } from 'dexie';
import type {
  Account,
  AppSetting,
  AssetClass,
  Assignment,
  Bonus,
  Category,
  CategoryGroup,
  Goal,
  Holding,
  ImportBatch,
  IncomeProfile,
  InvAccount,
  Loan,
  LoanEvent,
  LoanRateChange,
  Person,
  RecurringLog,
  RecurringRule,
  Security,
  TaxSettings,
  Txn,
  Windfall,
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
  invAccounts!: Table<InvAccount, number>;
  assetClasses!: Table<AssetClass, number>;
  securities!: Table<Security, number>;
  holdings!: Table<Holding, number>;
  settings!: Table<AppSetting, string>;
  windfalls!: Table<Windfall, number>;
  goals!: Table<Goal, number>;
  loans!: Table<Loan, number>;
  loanRates!: Table<LoanRateChange, number>;
  loanEvents!: Table<LoanEvent, number>;

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
    this.version(4).stores({
      invAccounts: '++id, kind',
      assetClasses: '++id',
      securities: '++id, ticker',
      holdings: '++id, accountId, securityId',
      settings: 'key',
    });
    this.version(5).stores({
      windfalls: '++id',
      goals: '++id',
    });
    this.version(6).stores({
      loans: '++id',
      loanRates: '++id, loanId',
      loanEvents: '++id, loanId',
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

/** Default asset classes. Return/volatility are editable ASSUMPTIONS, not predictions. */
const DEFAULT_CLASSES: Omit<AssetClass, 'id'>[] = [
  { name: 'US stocks', kind: 'equity', expectedReturnPct: 7, volatilityPct: 16 },
  { name: 'International stocks', kind: 'equity', expectedReturnPct: 7, volatilityPct: 18 },
  { name: 'Bonds', kind: 'bond', expectedReturnPct: 4, volatilityPct: 6 },
  { name: 'Real estate (REITs)', kind: 'real_estate', expectedReturnPct: 6.5, volatilityPct: 17 },
  { name: 'Balanced / target-date', kind: 'balanced', expectedReturnPct: 6, volatilityPct: 11 },
  { name: 'Cash', kind: 'cash', expectedReturnPct: 3, volatilityPct: 1 },
  { name: 'Other', kind: 'other', expectedReturnPct: 5, volatilityPct: 15 },
];

export async function seedAssetClassesIfEmpty(d: FinanceDB = db) {
  if ((await d.assetClasses.count()) > 0) return;
  await d.assetClasses.bulkAdd(DEFAULT_CLASSES);
}
