// Money is always integer cents. Dates are 'YYYY-MM-DD' strings.
// Amounts are signed from the account's point of view: negative = money out / debt up.
// A credit card with a balance of -50000 means $500.00 owed.

export type AccountKind = 'checking' | 'savings' | 'credit_card';

export interface Account {
  id?: number;
  name: string;
  kind: AccountKind;
  openingBalanceCents: number;
  openingDate: string;
  closed?: boolean;
}

export interface CategoryGroup {
  id?: number;
  name: string;
}

export interface Category {
  id?: number;
  groupId: number | null;
  name: string;
  hidden?: boolean;
  /** Income categories feed Ready to Assign instead of being budgeted. Default: expense. */
  kind?: 'expense' | 'income';
}

/** Money given a job: one row per month per budget line. */
export interface Assignment {
  id?: number;
  month: string; // 'YYYY-MM'
  /** `c<categoryId>` for a category, `p<cardAccountId>` for a card's payment line. */
  key: string;
  amountCents: number;
}

export type Frequency = 'weekly' | 'biweekly' | 'semimonthly' | 'monthly' | 'quarterly' | 'yearly';

export interface RecurringRule {
  id?: number;
  accountId: number;
  payee: string;
  /** Signed from the account's point of view, like a transaction. */
  amountCents: number;
  categoryId: number | null;
  /** If set, posting creates a transfer with this account instead of a categorized transaction. */
  transferAccountId?: number | null;
  memo: string;
  frequency: Frequency;
  startDate: string;
  endDate?: string | null;
  /** For semimonthly: the two days of month (31 = last day). */
  semiDays?: [number, number];
  active: boolean;
}

export interface RecurringLog {
  id?: number;
  ruleId: number;
  /** The scheduled date this entry refers to (not the edited posting date). */
  date: string;
  action: 'posted' | 'skipped';
  txnId?: number;
}

export type TxnStatus = 'pending' | 'cleared' | 'reconciled';

export interface Split {
  categoryId: number | null;
  amountCents: number;
}

export interface Txn {
  id?: number;
  accountId: number;
  date: string;
  amountCents: number;
  payee: string;
  memo: string;
  status: TxnStatus;
  /** Single-category default. Ignored when `splits` is present. */
  categoryId: number | null;
  /** Optional split across categories; amounts must sum to amountCents. */
  splits?: Split[];
  /** Set on both halves of a transfer; points at the other half. */
  transferTxnId?: number | null;
  /** Bank-provided id from a CSV, if the file had one. */
  externalId?: string;
  /** Dedupe key for CSV-imported rows. */
  fingerprint?: string;
  /** Set only on rows created by an import batch. */
  importBatchId?: number | null;
  /** Set when approved from a scheduled (recurring) item. */
  recurringId?: number;
}

export interface ImportBatch {
  id?: number;
  accountId: number;
  filename: string;
  importedAt: string;
  createdCount: number;
  /** Manual transactions that were matched (marked cleared) rather than duplicated. */
  matched: { txnId: number; prevStatus: TxnStatus }[];
}
