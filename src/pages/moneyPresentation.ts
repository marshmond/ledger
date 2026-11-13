/**
 * D16: how the Money pages WORD and GROUP what they already know. Pure presentation:
 *  - nothing here adds, subtracts, rounds or converts an amount; a value arrives already worked out by the page's own reader or engine and leaves unchanged;
 *  - nothing here decides a financial rule (what is reconciled, overspent, due or a duplicate). The caller passes the stored fact and gets words or a group back;
 *  - nothing here reads the clock: the caller passes `today` (the app's `todayISO()`), and a date is only ever compared as text, as the pages always did.
 * A source test (moneyPresentation.test.ts) keeps this file free of money maths and storage writes.
 */
import type { AccountKind, TxnStatus } from '../types';

export const KIND_LABEL: Record<AccountKind, string> = {
  checking: 'Checking',
  savings: 'Savings',
  credit_card: 'Credit Card',
  loan: 'Loan',
};

/** The order the Accounts page lists the types in (unchanged from before the redesign). */
export const KIND_ORDER: AccountKind[] = ['checking', 'savings', 'credit_card', 'loan'];

/** A card or a loan shows what you OWE. Its stored balance is negative; the page prints the same number as before and adds this word beside it. */
export const isDebtKind = (k: AccountKind): boolean => k === 'credit_card' || k === 'loan';

/** The short word printed beside an account's balance so a negative card balance is read as debt, not as a shortfall. */
export const balanceWord = (k: AccountKind): string => (isDebtKind(k) ? 'Owed' : 'Balance');

export type ReconTone = 'done' | 'neutral' | 'warning';
export interface ReconView { tone: ReconTone; label: string; title: string }

/**
 * The account's own reconciliation line. It reads ONLY the stored `lastReconciledDate` (the day a balanced reconcile was locked), exactly as the Accounts page
 * always did. Having reconciled transactions inside the account does not make it "reconciled": that is a different fact, and this never looks at transactions.
 */
export function reconView(lastReconciledDate: string | undefined, today: string): ReconView {
  if (lastReconciledDate === today) return { tone: 'done', label: 'Reconciled today', title: 'You locked a balanced reconcile for this account today' };
  if (lastReconciledDate) return { tone: 'neutral', label: `Last reconciled ${lastReconciledDate}`, title: 'The last day a balanced reconcile was locked for this account' };
  return { tone: 'warning', label: 'Never reconciled', title: 'No balanced reconcile has been locked for this account yet' };
}

/** What a transaction's status means in words (the stored values are pending, cleared and reconciled). */
export const STATUS_WORD: Record<TxnStatus, string> = {
  pending: 'Pending',
  cleared: 'Cleared',
  reconciled: 'Reconciled',
};
export const STATUS_HELP: Record<TxnStatus, string> = {
  pending: 'Not yet confirmed by the bank',
  cleared: 'Confirmed by the bank, not yet locked by a reconcile',
  reconciled: 'Locked by a balanced reconcile',
};
export const statusTone = (s: TxnStatus): 'warning' | 'neutral' | 'done' => (s === 'pending' ? 'warning' : s === 'reconciled' ? 'done' : 'neutral');

// ---------- check-in ----------

export interface SegStep { id: string; title: string; status: 'done' | 'todo' | 'na' }

/** One segment per step the check-in actually shows (steps that do not apply yet are left out, as the page always did). */
export const checkinSegments = (steps: SegStep[]): SegStep[] => steps.filter((s) => s.status !== 'na');

/** Steps that need you first, then the finished ones; each group keeps the check-in's own order. */
export function splitCheckin<T extends { status: 'done' | 'todo' | 'na' }>(steps: T[]): { todo: T[]; done: T[]; na: T[] } {
  return { todo: steps.filter((s) => s.status === 'todo'), done: steps.filter((s) => s.status === 'done'), na: steps.filter((s) => s.status === 'na') };
}

// ---------- scheduled ----------

/** A scheduled date is overdue when it is before today, compared as text, as the page always did. */
export const isOverdueDate = (date: string, today: string): boolean => date < today;

export function splitRules<T extends { active: boolean }>(rules: T[]): { active: T[]; paused: T[] } {
  return { active: rules.filter((r) => r.active), paused: rules.filter((r) => !r.active) };
}

// ---------- import ----------

export type ImportStage = 'file' | 'map' | 'review';

/**
 * Which of the three import steps the screen is on, read from what the page already holds: no file chosen yet, a file chosen but its date and description
 * columns not both mapped, or a mapped file with a preview. It never advances anything; choosing a file or a column does that, as before.
 */
export function importStage(s: { hasFile: boolean; hasPreview: boolean }): ImportStage {
  if (!s.hasFile) return 'file';
  return s.hasPreview ? 'review' : 'map';
}

export const IMPORT_STEPS: { id: ImportStage; title: string }[] = [
  { id: 'file', title: 'Choose account and file' },
  { id: 'map', title: 'Match the columns' },
  { id: 'review', title: 'Review and import' },
];

// ---------- budget ----------

export type CreditTone = 'ok' | 'high' | 'over';

/** The cover wording on an overspent row uses the same stored numbers as before; this only names the state for a word chip. */
export const budgetStateWord = (available: number): 'Overspent' | null => (available < 0 ? 'Overspent' : null);

/** "2 accounts", "1 category": counts only. */
export const countWord = (n: number, one: string, many = `${one}s`): string => `${n.toLocaleString()} ${n === 1 ? one : many}`;
