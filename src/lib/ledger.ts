import type { FinanceDB } from '../db';
import type { Split, Txn } from '../types';

export async function accountBalance(d: FinanceDB, accountId: number): Promise<number> {
  const acct = await d.accounts.get(accountId);
  if (!acct) throw new Error('Account not found');
  const txns = await d.txns.where('accountId').equals(accountId).toArray();
  return acct.openingBalanceCents + txns.reduce((s, t) => s + t.amountCents, 0);
}

export function validateSplits(amountCents: number, splits: Split[]): string | null {
  if (splits.length < 2) return 'A split needs at least two categories';
  const total = splits.reduce((s, x) => s + x.amountCents, 0);
  if (total !== amountCents) return `Splits total ${total} cents but the transaction is ${amountCents}`;
  return null;
}

/** Effective category allocations for a transaction (used later by the budget). */
export function allocations(t: Txn): Split[] {
  if (t.transferTxnId) return [];
  return t.splits?.length ? t.splits : [{ categoryId: t.categoryId, amountCents: t.amountCents }];
}

export interface ReconcileResult {
  clearedBalanceCents: number;
  differenceCents: number; // statement - cleared; 0 means it reconciles
  clearedTxnIds: number[];
}

/** Compares a statement ending balance with cleared/reconciled activity through the statement date. */
export async function reconcileCheck(
  d: FinanceDB,
  accountId: number,
  statementDate: string,
  statementBalanceCents: number,
): Promise<ReconcileResult> {
  const acct = await d.accounts.get(accountId);
  if (!acct) throw new Error('Account not found');
  const txns = (await d.txns.where('accountId').equals(accountId).toArray()).filter(
    (t) => t.date <= statementDate && t.status !== 'pending',
  );
  const cleared = acct.openingBalanceCents + txns.reduce((s, t) => s + t.amountCents, 0);
  return {
    clearedBalanceCents: cleared,
    differenceCents: statementBalanceCents - cleared,
    clearedTxnIds: txns.filter((t) => t.status === 'cleared').map((t) => t.id!),
  };
}

export async function finalizeReconcile(d: FinanceDB, ids: number[]) {
  await d.txns.where('id').anyOf(ids).modify({ status: 'reconciled' });
}
