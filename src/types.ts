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
