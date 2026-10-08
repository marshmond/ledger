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

// ---- Income / payroll model (Phase 3) ----

export interface Person {
  id?: number;
  name: string;
  /** Used for 401(k)/HSA catch-up eligibility. */
  birthYear?: number | null;
}

export type DeductionType =
  | 'k401_pretax'
  | 'k401_roth'
  | 'hsa'
  | 'health'
  | 'dental'
  | 'vision'
  | 'fsa'
  | 'espp'
  | 'custom';

export interface DeductionItem {
  id: string;
  type: DeductionType;
  name: string;
  /** percent: `value` is a percentage of gross (6 = 6%). fixed: `value` is cents per paycheck (per YEAR in annual mode). */
  mode: 'percent' | 'fixed';
  value: number;
  fedExempt: boolean;
  ficaExempt: boolean;
  stateExempt: boolean;
  /** Percent items only: also taken from bonuses. */
  appliesToBonus: boolean;
}

export interface MatchConfig {
  /** Employer contributes this % of your contribution... */
  ratePct: number;
  /** ...up to this % of your pay. (50% up to 6% => ratePct 50, upToPctOfPay 6) */
  upToPctOfPay: number;
  /** Year-end true-up: match is computed on annual totals, so it is not lost if you hit the 401(k) limit early. */
  trueUp: boolean;
  appliesToBonus: boolean;
}

export interface IncomeProfile {
  id?: number;
  personId: number;
  year: number;
  /** 'paycheck' follows your actual pay schedule; 'annual' spreads everything over 12 monthly pays. */
  mode: 'paycheck' | 'annual';
  frequency: 'weekly' | 'biweekly' | 'semimonthly' | 'monthly';
  /** Any real pay date; the schedule continues from it. */
  firstPayDate: string;
  semiDays?: [number, number];
  /** Raises: the last entry on or before a pay date applies. */
  salary: { effectiveDate: string; annualCents: number }[];
  deductions: DeductionItem[];
  match?: MatchConfig | null;
  employerHsaAnnualCents: number;
  hsaCoverage: 'self' | 'family';
  /** ESPP purchase discount, used for the IRS $25,000 limit. */
  esppDiscountPct: number;
  fedWithholding: { mode: 'estimate' | 'manual'; manualPerPaycheckCents: number; twoJobs: boolean; extraPerPaycheckCents: number };
  stateWithholding: { mode: 'estimate' | 'manual'; manualPerPaycheckCents: number };
}

/** A bonus, entered by month because the pay date is unpredictable. Assumed paid mid-month. */
export interface Bonus {
  id?: number;
  personId: number;
  year: number;
  month: number; // 1-12
  grossCents: number;
  label: string;
}

export interface TaxSettings {
  id?: number;
  year: number;
  /** If larger than the standard deduction, used instead. */
  itemizedDeductionCents: number;
  otherIncomeCents: number;
  /** e.g. child tax credit; entered by you. */
  federalCreditsCents: number;
  maDependents: number;
  maCreditsCents: number;
  /** JSON of an edited TaxTables for this year, if you changed the built-in one. */
  tablesOverride?: string;
}
