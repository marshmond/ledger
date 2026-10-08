import type { FinanceDB } from '../db';
import type { Txn, TxnStatus } from '../types';
import { daysBetween } from './money';

const MATCH_WINDOW_DAYS = 5;

export interface TransferInput {
  fromAccountId: number;
  toAccountId: number;
  date: string;
  /** Positive amount moving from `from` to `to`. */
  amountCents: number;
  memo?: string;
  status?: TxnStatus;
}

async function name(d: FinanceDB, id: number) {
  return (await d.accounts.get(id))?.name ?? 'account';
}

/**
 * Creates both halves of a transfer. Entering "checking -> card" or "card <- checking"
 * is the same call: the from side is debited, the to side is credited.
 */
export async function createTransfer(d: FinanceDB, t: TransferInput): Promise<{ fromTxnId: number; toTxnId: number }> {
  if (t.fromAccountId === t.toAccountId) throw new Error('Transfer accounts must differ');
  if (!(t.amountCents > 0)) throw new Error('Transfer amount must be positive');
  return d.transaction('rw', d.txns, d.accounts, async () => {
    const base = { date: t.date, memo: t.memo ?? '', status: t.status ?? 'pending', categoryId: null } as const;
    const fromTxnId = await d.txns.add({
      ...base,
      accountId: t.fromAccountId,
      amountCents: -t.amountCents,
      payee: `Transfer to ${await name(d, t.toAccountId)}`,
    });
    const toTxnId = await d.txns.add({
      ...base,
      accountId: t.toAccountId,
      amountCents: t.amountCents,
      payee: `Transfer from ${await name(d, t.fromAccountId)}`,
      transferTxnId: fromTxnId,
    });
    await d.txns.update(fromTxnId, { transferTxnId: toTxnId });
    return { fromTxnId, toTxnId };
  });
}

function isMatch(a: Txn, b: Txn): boolean {
  return (
    a.id !== b.id &&
    a.accountId !== b.accountId &&
    !a.transferTxnId &&
    !b.transferTxnId &&
    a.amountCents === -b.amountCents &&
    Math.abs(daysBetween(a.date, b.date)) <= MATCH_WINDOW_DAYS
  );
}

async function link(d: FinanceDB, a: Txn, b: Txn) {
  const patch = (other: Txn): Partial<Txn> => ({
    transferTxnId: other.id,
    categoryId: null,
    splits: undefined,
  });
  await d.txns.update(a.id!, { ...patch(b), payee: `Transfer ${a.amountCents < 0 ? 'to' : 'from'} ${await name(d, b.accountId)}` });
  await d.txns.update(b.id!, { ...patch(a), payee: `Transfer ${b.amountCents < 0 ? 'to' : 'from'} ${await name(d, a.accountId)}` });
}

/**
 * Marks an existing transaction as a transfer with `otherAccountId`.
 * If the other account already has the matching opposite entry, they are linked
 * (no duplicate is posted); otherwise the paired transaction is created automatically.
 */
export async function convertToTransfer(
  d: FinanceDB,
  txnId: number,
  otherAccountId: number,
): Promise<{ linkedExisting: boolean; otherTxnId: number }> {
  return d.transaction('rw', d.txns, d.accounts, async () => {
    const t = await d.txns.get(txnId);
    if (!t) throw new Error('Transaction not found');
    if (t.transferTxnId) throw new Error('Already a transfer');
    if (t.accountId === otherAccountId) throw new Error('Transfer accounts must differ');

    const candidates = (await d.txns.where('accountId').equals(otherAccountId).toArray())
      .filter((c) => isMatch(t, c))
      .sort((x, y) => Math.abs(daysBetween(x.date, t.date)) - Math.abs(daysBetween(y.date, t.date)));
    if (candidates.length) {
      await link(d, t, candidates[0]);
      return { linkedExisting: true, otherTxnId: candidates[0].id! };
    }
    const otherId = await d.txns.add({
      accountId: otherAccountId,
      date: t.date,
      amountCents: -t.amountCents,
      payee: `Transfer ${t.amountCents < 0 ? 'from' : 'to'} ${await name(d, t.accountId)}`,
      memo: t.memo,
      status: 'pending',
      categoryId: null,
      transferTxnId: t.id,
    });
    await d.txns.update(t.id!, {
      transferTxnId: otherId,
      categoryId: null,
      splits: undefined,
      payee: `Transfer ${t.amountCents < 0 ? 'to' : 'from'} ${await name(d, otherAccountId)}`,
    });
    return { linkedExisting: false, otherTxnId: otherId };
  });
}

/** Unlinked transactions that look like two halves of the same transfer (for the user to confirm). */
export async function findTransferCandidates(d: FinanceDB): Promise<[Txn, Txn][]> {
  const open = (await d.txns.toArray()).filter((t) => !t.transferTxnId);
  const used = new Set<number>();
  const pairs: [Txn, Txn][] = [];
  const outflows = open.filter((t) => t.amountCents < 0);
  for (const out of outflows) {
    const best = open
      .filter((c) => c.amountCents > 0 && !used.has(c.id!) && isMatch(out, c))
      .sort((x, y) => Math.abs(daysBetween(x.date, out.date)) - Math.abs(daysBetween(y.date, out.date)))[0];
    if (best && !used.has(out.id!)) {
      used.add(out.id!);
      used.add(best.id!);
      pairs.push([out, best]);
    }
  }
  return pairs;
}

export async function linkPair(d: FinanceDB, aId: number, bId: number) {
  await d.transaction('rw', d.txns, d.accounts, async () => {
    const [a, b] = await Promise.all([d.txns.get(aId), d.txns.get(bId)]);
    if (!a || !b || !isMatch(a, b)) throw new Error('These transactions do not match');
    await link(d, a, b);
  });
}

/** Edits a transaction. For transfers, the other half is kept in sync (date, amount, memo, status). */
export async function updateTxn(d: FinanceDB, id: number, patch: Partial<Txn>) {
  await d.transaction('rw', d.txns, async () => {
    const t = await d.txns.get(id);
    if (!t) throw new Error('Transaction not found');
    const { id: _ignored, transferTxnId: _t, ...safe } = patch;
    void _ignored;
    void _t;
    await d.txns.update(id, safe);
    if (t.transferTxnId) {
      const mirror: Partial<Txn> = {};
      if (safe.date !== undefined) mirror.date = safe.date;
      if (safe.memo !== undefined) mirror.memo = safe.memo;
      if (safe.status !== undefined) mirror.status = safe.status;
      if (safe.amountCents !== undefined) mirror.amountCents = -safe.amountCents;
      if (Object.keys(mirror).length) await d.txns.update(t.transferTxnId, mirror);
    }
  });
}

/** Deletes a transaction; deleting one half of a transfer deletes the other. */
export async function deleteTxn(d: FinanceDB, id: number) {
  await d.transaction('rw', d.txns, async () => {
    const t = await d.txns.get(id);
    if (!t) return;
    await d.txns.delete(id);
    if (t.transferTxnId) await d.txns.delete(t.transferTxnId);
  });
}

/** Turns a transfer back into two ordinary transactions. */
export async function unlinkTransfer(d: FinanceDB, id: number) {
  await d.transaction('rw', d.txns, async () => {
    const t = await d.txns.get(id);
    if (!t?.transferTxnId) return;
    await d.txns.update(t.transferTxnId, { transferTxnId: null });
    await d.txns.update(id, { transferTxnId: null });
  });
}
