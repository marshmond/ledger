import Dexie, { type Table } from 'dexie';
import { DEFAULT_CLASSES } from './lib/assetClassUpdate';
import type {
  Account,
  AppSetting,
  AssetClass,
  Assignment,
  Bonus,
  BudgetTarget,
  Category,
  CategoryGroup,
  Donation,
  Goal,
  Holding,
  HsaWithdrawal,
  ImportBatch,
  IncomeProfile,
  InvAccount,
  Loan,
  LoanEvent,
  LoanRateChange,
  NetWorthSnapshot,
  PayScenario,
  PayeeRule,
  Person,
  Property,
  PropertyValue,
  RsuVest,
  RecurringLog,
  RecurringRule,
  Sale,
  Security,
  TaxLot,
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
  rsuVests!: Table<RsuVest, number>;
  payScenarios!: Table<PayScenario, number>;
  hsaWithdrawals!: Table<HsaWithdrawal, number>;
  taxLots!: Table<TaxLot, number>;
  sales!: Table<Sale, number>;
  properties!: Table<Property, number>;
  propertyValues!: Table<PropertyValue, number>;
  netWorthSnapshots!: Table<NetWorthSnapshot, number>;
  payeeRules!: Table<PayeeRule, number>;
  budgetTargets!: Table<BudgetTarget, number>;
  donations!: Table<Donation, number>;

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
    this.version(7).stores({
      rsuVests: '++id, personId, date',
    });
    this.version(8).stores({
      payScenarios: '++id, personId',
    });
    this.version(9).stores({
      hsaWithdrawals: '++id, accountId, date',
    });
    this.version(10).stores({
      taxLots: '++id, holdingId, accountId',
      sales: '++id, accountId, date',
    });
    this.version(11).stores({
      properties: '++id',
      propertyValues: '++id, propertyId, date',
      netWorthSnapshots: '++id, date',
    });
    this.version(12).stores({
      payeeRules: '++id',
    });
    this.version(13).stores({
      budgetTargets: '++id, categoryId',
      donations: '++id, date',
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

/** Default asset classes (compound nominal returns; see lib/assetClassUpdate). Return/volatility are editable ASSUMPTIONS, not predictions. */
export async function seedAssetClassesIfEmpty(d: FinanceDB = db) {
  // One transaction for the check and the insert, so two callers at once (React's dev mode runs effects twice) cannot both seed.
  await d.transaction('rw', d.assetClasses, async () => {
    if ((await d.assetClasses.count()) > 0) return;
    // Classes with a fixed id go in last: inserting one first would push the automatic ids up into the fixed ones.
    await d.assetClasses.bulkAdd(DEFAULT_CLASSES.filter((c) => c.id === undefined) as AssetClass[]);
    await d.assetClasses.bulkAdd(DEFAULT_CLASSES.filter((c) => c.id !== undefined) as AssetClass[]);
  });
}
