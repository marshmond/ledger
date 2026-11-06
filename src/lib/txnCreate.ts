import type { FinanceDB } from '../db';
import type { ProjectRef, Split, Txn, TxnStatus } from '../types';
import { validateSplits } from './ledger';
import { checkTxnProjects } from './txnProject';
import { updateTxn } from './transfers';

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
    await checkTxnProjects(d, { amountCents: input.amountCents, project: input.project, splits });
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

/**
 * The one way to change an ordinary transaction from a screen. If the change touches the amount, the splits or the project tag, the
 * project checks run first (the same ones as for a new transaction), so an edit can never leave a tag that Finance would have refused.
 * An edit that touches none of those (a memo, a date) is never held up by an old tag.
 */
export async function editTxn(d: FinanceDB, id: number, patch: Partial<Txn>): Promise<void> {
  await d.transaction('rw', d.txns, d.moduleRecords, async () => {
    const t = await d.txns.get(id);
    if (!t) throw new Error('Transaction not found');
    const touches = 'project' in patch || 'splits' in patch || (patch.amountCents !== undefined && patch.amountCents !== t.amountCents);
    if (touches && !t.transferTxnId) {
      const m = { ...t, ...patch };
      await checkTxnProjects(d, { amountCents: m.amountCents, project: m.project, splits: m.splits, excludeTxnId: id });
    }
    await updateTxn(d, id, patch);
  });
}
