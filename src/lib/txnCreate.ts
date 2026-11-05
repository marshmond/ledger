import type { FinanceDB } from '../db';
import type { ProjectRef, Split, Txn, TxnStatus } from '../types';
import { validateSplits } from './ledger';
import { checkProjectRef, checkRefEffect, checkRefundAmount } from './txnProject';

/**
 * The one way to add an ordinary (non-transfer) transaction. The Add form, the quick-add box and, later, an assistant all call this, so
 * the same checks apply everywhere. Transfers are made with `createTransfer`.
 */
export interface NewTxn {
  accountId: number;
  /** YYYY-MM-DD */
  date: string;
  /** Whole cents; spending is negative. */
  amountCents: number;
  payee?: string;
  memo?: string;
  status?: TxnStatus;
  categoryId?: number | null;
  /** If given, must add up to the amount and the category is ignored. */
  splits?: Split[];
  project?: ProjectRef;
}

export async function createTxn(d: FinanceDB, input: NewTxn): Promise<number> {
  if (!Number.isInteger(input.amountCents)) throw new Error('The amount must be a whole number of cents.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new Error('The date must look like 2026-11-04.');
  const splits = input.splits?.length ? input.splits : undefined;
  if (splits) {
    const err = validateSplits(input.amountCents, splits);
    if (err) throw new Error(err);
  }
  return d.transaction('rw', d.txns, d.accounts, d.moduleRecords, async () => {
    if (!(await d.accounts.get(input.accountId))) throw new Error('Account not found');
    if (input.project) {
      await checkProjectRef(d, input.project);
      const amounts = splits ? splits.filter((s) => !s.project).map((s) => s.amountCents) : [input.amountCents];
      checkRefEffect(input.project, amounts);
      await checkRefundAmount(d, input.project, amounts);
    }
    const row: Txn = {
      accountId: input.accountId,
      date: input.date,
      amountCents: input.amountCents,
      payee: input.payee ?? '',
      memo: input.memo ?? '',
      status: input.status ?? 'pending',
      categoryId: splits ? null : input.categoryId ?? null,
      splits,
      ...(input.project ? { project: input.project } : {}),
    };
    return (await d.txns.add(row)) as number;
  });
}
