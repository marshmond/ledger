/**
 * Deleting a Finance account (ST-S1, DI-01).
 *
 * The "Delete account" button removes the account and ALL of its transactions. Until ST-S1 it did not look at anything else that
 * names the account, so a Scheduled rule could be left pointing at a deleted account, and approving it then wrote a transaction to
 * an account that no longer existed.
 *
 * What counts here:
 *  - BLOCKS the deletion: a Scheduled rule that posts to the account, or transfers to or from it (active or paused), and a loan
 *    whose payments are linked to it. These are things that would act on the account later, so the owner must deal with them first.
 *  - Only MENTIONED (never blocks): payee rules limited to the account, import history, a bill that says it is paid from the account,
 *    and the "primary payment account" choice. These are read or ignored safely when the account is gone.
 *
 * Nothing here deletes, moves or edits any of those records. Reading is read-only; the one writer is `deleteAccountWithTransactions`,
 * which re-checks inside the same database transaction (another device may have changed things since the screen was drawn).
 * Investment accounts, holdings, HSA, RSU and goals use the separate `invAccounts` table and are not affected.
 */
import type { FinanceDB } from '../db';
import type { Loan, RecurringRule } from '../types';
import { deleteTxn } from './transfers';
import { PRIMARY_KEY } from './primaryAccount';

export interface AccountDependents {
  /** Scheduled rules that post to this account or transfer to or from it, active or not. */
  rules: RecurringRule[];
  /** Loans whose payments are linked to this account. */
  loans: Loan[];
  /** Payee rules limited to this account (they simply stop matching). */
  payeeRules: number;
  /** Earlier CSV imports into this account (history only). */
  importBatches: number;
  /** Titles of bills that say they are paid from this account (Bills reads the account live and never writes it). */
  billTitles: string[];
  /** The account is the "primary payment account" in settings (it is simply not used once gone). */
  isPrimary: boolean;
  /** Transactions that the deletion would remove. */
  transactions: number;
}

export const blocksDeletion = (d: AccountDependents): boolean => d.rules.length > 0 || d.loans.length > 0;

/** Reads what depends on the account. Read-only. */
export async function readAccountDependents(d: FinanceDB, accountId: number): Promise<AccountDependents> {
  const [rules, loans, payeeRules, importBatches, transactions, primary, bills] = await Promise.all([
    d.recurring.filter((r) => r.accountId === accountId || r.transferAccountId === accountId).toArray(),
    d.loans.filter((l) => l.ledgerAccountId === accountId).toArray(),
    d.payeeRules.filter((p) => p.accountId === accountId).count(),
    d.importBatches.where('accountId').equals(accountId).count(),
    d.txns.where('accountId').equals(accountId).count(),
    d.settings.get(PRIMARY_KEY),
    d.moduleRecords.where('[module+kind]').equals(['bills', 'obligation']).toArray(),
  ]);
  const billTitles = bills
    .filter((r) => r.deletedAt == null && (r.data as { payment?: { fundingAccountId?: unknown } } | undefined)?.payment?.fundingAccountId === accountId)
    .map((r) => String((r.data as { title?: unknown }).title ?? 'A bill'))
    .sort();
  return { rules, loans, payeeRules, importBatches, billTitles, isPrimary: (primary as { value?: unknown } | undefined)?.value === accountId, transactions };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const NAME_LIMIT = 6;
const names = (list: string[]) => (list.length <= NAME_LIMIT ? list : [...list.slice(0, NAME_LIMIT), `and ${list.length - NAME_LIMIT} more`]).join(', ');

/** Plain-language reasons the deletion is blocked, one sentence per reason. Empty when nothing blocks it. */
export function blockedReasons(accountName: string, dep: AccountDependents): string[] {
  const out: string[] = [];
  if (dep.rules.length > 0) {
    const active = dep.rules.filter((r) => r.active).length;
    const state = active === 0 ? 'all paused' : active === dep.rules.length ? 'all active' : `${active} active and ${dep.rules.length - active} paused`;
    out.push(
      `${plural(dep.rules.length, 'Scheduled item still uses', 'Scheduled items still use')} "${accountName}" (${state}): ${names(dep.rules.map((r) => r.payee))}. If the account were deleted, those items would keep coming due with nowhere to post.`,
    );
  }
  if (dep.loans.length > 0) {
    out.push(`${plural(dep.loans.length, 'loan is', 'loans are')} linked to "${accountName}" on the Debt page: ${names(dep.loans.map((l) => l.name))}. Unlink ${dep.loans.length === 1 ? 'it' : 'them'} there first.`);
  }
  return out;
}

/** Things worth knowing that do NOT block the deletion. */
export function noteLines(dep: AccountDependents): string[] {
  const out: string[] = [];
  if (dep.billTitles.length > 0) out.push(`${plural(dep.billTitles.length, 'bill says', 'bills say')} it is paid from this account (${names(dep.billTitles)}). Bills will show the account as missing; nothing is changed there.`);
  if (dep.payeeRules > 0) out.push(`${plural(dep.payeeRules, 'payee rule is', 'payee rules are')} limited to this account and will stop matching.`);
  if (dep.isPrimary) out.push('It is your primary payment account, so the quick "+" button will choose another.');
  if (dep.importBatches > 0) out.push(`${plural(dep.importBatches, 'earlier import', 'earlier imports')} into it stay in the import history.`);
  return out;
}

/** The sentence for the final confirmation. */
export function confirmText(accountName: string, dep: AccountDependents): string {
  const notes = noteLines(dep);
  return (
    `Delete "${accountName}" and all ${dep.transactions} of its transactions? Linked transfer entries on other accounts are removed too. This cannot be undone.` +
    (notes.length ? `\n\nAlso:\n- ${notes.join('\n- ')}` : '')
  );
}

export type DeleteAccountResult = { ok: true; transactionsDeleted: number } | { ok: false; dependents: AccountDependents };

/**
 * Deletes the account and its transactions, unless something still blocks it. The check and the deletion happen in ONE transaction, so
 * a Scheduled item added on another device (or this one) a moment ago is seen, and a refusal changes nothing.
 */
export async function deleteAccountWithTransactions(d: FinanceDB, accountId: number): Promise<DeleteAccountResult> {
  return d.transaction('rw', [d.accounts, d.txns, d.recurring, d.loans, d.payeeRules, d.importBatches, d.settings, d.moduleRecords], async () => {
    const dependents = await readAccountDependents(d, accountId);
    if (blocksDeletion(dependents)) return { ok: false as const, dependents };
    const txns = await d.txns.where('accountId').equals(accountId).toArray();
    for (const t of txns) await deleteTxn(d, t.id!);
    await d.accounts.delete(accountId);
    return { ok: true as const, transactionsDeleted: txns.length };
  });
}

/** Scheduled rules that name an account which no longer exists (as the posting account, or as the transfer account). */
export function orphanedRules(rules: RecurringRule[], accountIds: ReadonlySet<number>): RecurringRule[] {
  return rules.filter((r) => !accountIds.has(r.accountId) || (r.transferAccountId != null && !accountIds.has(r.transferAccountId)));
}
