import { beforeEach, describe, expect, it } from 'vitest';
import { FinanceDB } from '../db';
import { accountBalance, reconcileCheck, finalizeReconcile, validateSplits } from './ledger';
import { parseAmountToCents, formatCents } from './money';
import {
  convertToTransfer,
  createTransfer,
  deleteTxn,
  findTransferCandidates,
  updateTxn,
} from './transfers';
import { classifyRows, commitImport, detectMapping, normalizeRows, parseCsv, undoBatch } from './csvImport';
import { decryptText, encryptText, exportAll, importAll } from './backup';

let d: FinanceDB;
let checking: number;
let card: number;
let n = 0;

beforeEach(async () => {
  d = new FinanceDB(`test-${n++}`);
  checking = await d.accounts.add({ name: 'Checking', kind: 'checking', openingBalanceCents: 100000, openingDate: '2026-01-01' });
  // $500 owed on the card at start.
  card = await d.accounts.add({ name: 'Capital One', kind: 'credit_card', openingBalanceCents: -50000, openingDate: '2026-01-01' });
});

describe('money', () => {
  it('parses common formats', () => {
    expect(parseAmountToCents('$1,234.56')).toBe(123456);
    expect(parseAmountToCents('(12.34)')).toBe(-1234);
    expect(parseAmountToCents('-0.05')).toBe(-5);
    expect(parseAmountToCents('12.34-')).toBe(-1234);
    expect(parseAmountToCents('abc')).toBeNull();
    expect(parseAmountToCents('')).toBeNull();
  });
  it('formats', () => {
    expect(formatCents(-123456)).toBe('-$1,234.56');
    expect(formatCents(5)).toBe('$0.05');
  });
});

describe('transfers', () => {
  it('posts both halves and moves both balances (checking -> card)', async () => {
    await createTransfer(d, { fromAccountId: checking, toAccountId: card, date: '2026-02-01', amountCents: 10000 });
    expect(await accountBalance(d, checking)).toBe(90000);
    expect(await accountBalance(d, card)).toBe(-40000); // debt reduced
  });

  it('entering a debit in checking and marking it a transfer auto-posts the card credit', async () => {
    const id = await d.txns.add({ accountId: checking, date: '2026-02-01', amountCents: -10000, payee: 'CAPITAL ONE PMT', memo: '', status: 'pending', categoryId: null });
    const r = await convertToTransfer(d, id, card);
    expect(r.linkedExisting).toBe(false);
    expect(await accountBalance(d, card)).toBe(-40000);
    const other = await d.txns.get(r.otherTxnId);
    expect(other?.amountCents).toBe(10000);
    expect(other?.transferTxnId).toBe(id);
  });

  it('entering the credit on the card side auto-posts the checking debit', async () => {
    const id = await d.txns.add({ accountId: card, date: '2026-02-01', amountCents: 10000, payee: 'Payment', memo: '', status: 'pending', categoryId: null });
    await convertToTransfer(d, id, checking);
    expect(await accountBalance(d, checking)).toBe(90000);
  });

  it('links to an existing matching entry instead of duplicating', async () => {
    const out = await d.txns.add({ accountId: checking, date: '2026-02-01', amountCents: -10000, payee: 'x', memo: '', status: 'pending', categoryId: null });
    await d.txns.add({ accountId: card, date: '2026-02-03', amountCents: 10000, payee: 'y', memo: '', status: 'pending', categoryId: null });
    const r = await convertToTransfer(d, out, card);
    expect(r.linkedExisting).toBe(true);
    expect(await d.txns.count()).toBe(2);
  });

  it('suggests unlinked matching pairs', async () => {
    await d.txns.add({ accountId: checking, date: '2026-02-01', amountCents: -7500, payee: 'a', memo: '', status: 'cleared', categoryId: null });
    await d.txns.add({ accountId: card, date: '2026-02-02', amountCents: 7500, payee: 'b', memo: '', status: 'cleared', categoryId: null });
    expect(await findTransferCandidates(d)).toHaveLength(1);
  });

  it('keeps halves in sync on edit and delete', async () => {
    const { fromTxnId, toTxnId } = await createTransfer(d, { fromAccountId: checking, toAccountId: card, date: '2026-02-01', amountCents: 10000 });
    await updateTxn(d, fromTxnId, { amountCents: -2500, date: '2026-02-05' });
    const to = await d.txns.get(toTxnId);
    expect(to?.amountCents).toBe(2500);
    expect(to?.date).toBe('2026-02-05');
    await deleteTxn(d, toTxnId);
    expect(await d.txns.count()).toBe(0);
  });

  it('rejects same-account and non-positive transfers', async () => {
    await expect(createTransfer(d, { fromAccountId: checking, toAccountId: checking, date: '2026-02-01', amountCents: 100 })).rejects.toThrow();
    await expect(createTransfer(d, { fromAccountId: checking, toAccountId: card, date: '2026-02-01', amountCents: 0 })).rejects.toThrow();
  });
});

describe('splits and reconcile', () => {
  it('validates split totals', () => {
    expect(validateSplits(-1000, [{ categoryId: 1, amountCents: -600 }, { categoryId: 2, amountCents: -400 }])).toBeNull();
    expect(validateSplits(-1000, [{ categoryId: 1, amountCents: -600 }, { categoryId: 2, amountCents: -300 }])).not.toBeNull();
    expect(validateSplits(-1000, [{ categoryId: 1, amountCents: -1000 }])).not.toBeNull();
  });

  it('reconciles against a statement balance', async () => {
    await d.txns.add({ accountId: checking, date: '2026-02-01', amountCents: -2000, payee: 'a', memo: '', status: 'cleared', categoryId: null });
    await d.txns.add({ accountId: checking, date: '2026-02-02', amountCents: -500, payee: 'pending', memo: '', status: 'pending', categoryId: null });
    const ok = await reconcileCheck(d, checking, '2026-02-28', 98000);
    expect(ok.differenceCents).toBe(0);
    await finalizeReconcile(d, ok.clearedTxnIds);
    const statuses = (await d.txns.toArray()).map((t) => t.status).sort();
    expect(statuses).toEqual(['pending', 'reconciled']);
    const bad = await reconcileCheck(d, checking, '2026-02-28', 97000);
    expect(bad.differenceCents).toBe(-1000);
  });
});

const CSV = `Date,Description,Amount
02/01/2026,Coffee Shop,-4.50
02/01/2026,Coffee Shop,-4.50
02/02/2026,Paycheck,2500.00
12/15/2025,Old thing,-10.00
`;

async function importCsv(text: string, accountId = checking) {
  const parsed = parseCsv(text);
  const { rows } = normalizeRows(parsed.rows, detectMapping(parsed.headers));
  const classified = await classifyRows(d, accountId, rows);
  return { classified, batch: await commitImport(d, accountId, 'f.csv', classified) };
}

describe('csv import', () => {
  it('imports once and never duplicates on re-import, even with repeated identical rows', async () => {
    const first = await importCsv(CSV);
    expect(first.batch.createdCount).toBe(3); // two coffees + paycheck; Dec row is before opening
    expect(first.classified.filter((r) => r.cls === 'before_opening')).toHaveLength(1);
    const second = await importCsv(CSV);
    expect(second.batch.createdCount).toBe(0);
    expect(second.classified.every((r) => r.cls === 'duplicate' || r.cls === 'before_opening')).toBe(true);
    expect(await accountBalance(d, checking)).toBe(100000 - 450 - 450 + 250000);
  });

  it('an overlapping later file only adds the new rows', async () => {
    await importCsv(CSV);
    const later = CSV + '02/03/2026,Grocery,-60.00\n';
    const r = await importCsv(later);
    expect(r.batch.createdCount).toBe(1);
  });

  it('matches a manual entry instead of duplicating it', async () => {
    const id = await d.txns.add({ accountId: checking, date: '2026-02-02', amountCents: 250000, payee: 'my paycheck', memo: '', status: 'pending', categoryId: null });
    const r = await importCsv(CSV);
    expect(r.classified.find((x) => x.payee === 'Paycheck')?.cls).toBe('match');
    expect((await d.txns.get(id))?.status).toBe('cleared');
    expect(await d.txns.where('accountId').equals(checking).count()).toBe(3);
  });

  it('uses bank transaction ids when present', async () => {
    const text = 'Date,Description,Amount,Transaction ID\n02/01/2026,A,-1.00,X1\n02/01/2026,A renamed,-1.00,X1\n';
    const r = await importCsv(text);
    expect(r.batch.createdCount).toBe(1);
  });

  it('undo removes created rows and restores matched ones', async () => {
    const id = await d.txns.add({ accountId: checking, date: '2026-02-02', amountCents: 250000, payee: 'p', memo: '', status: 'pending', categoryId: null });
    const { batch } = await importCsv(CSV);
    await undoBatch(d, batch.id!);
    expect(await d.txns.count()).toBe(1);
    expect((await d.txns.get(id))?.status).toBe('pending');
    // and a fresh import works again afterwards
    expect((await importCsv(CSV)).batch.createdCount).toBe(2);
  });

  it('handles separate debit/credit columns and inverted card exports', () => {
    const parsed = parseCsv('Transaction Date,Description,Debit,Credit\n2026-02-01,Store,25.00,\n2026-02-02,Refund,,5.00\n');
    const map = detectMapping(parsed.headers);
    const { rows } = normalizeRows(parsed.rows, map);
    expect(rows.map((r) => r.amountCents)).toEqual([-2500, 500]);
    const inv = normalizeRows(parsed.rows, { ...map, invertSign: true });
    expect(inv.rows.map((r) => r.amountCents)).toEqual([2500, -500]);
  });

  it('reports unreadable rows', () => {
    const parsed = parseCsv('Date,Description,Amount\nnot a date,x,1\n02/01/2026,y,abc\n');
    const { rows, errors } = normalizeRows(parsed.rows, detectMapping(parsed.headers));
    expect(rows).toHaveLength(0);
    expect(errors).toHaveLength(2);
  });
});

describe('backup', () => {
  it('round-trips data and encryption', async () => {
    await createTransfer(d, { fromAccountId: checking, toAccountId: card, date: '2026-02-01', amountCents: 10000 });
    const text = JSON.stringify(await exportAll(d));
    const enc = await encryptText(text, 'correct horse');
    expect(enc).not.toContain('Checking');
    await expect(decryptText(enc, 'wrong')).rejects.toThrow();
    const restored = JSON.parse(await decryptText(enc, 'correct horse'));

    const d2 = new FinanceDB(`test-restore-${n++}`);
    await importAll(d2, restored);
    expect(await d2.txns.count()).toBe(2);
    expect(await accountBalance(d2, card)).toBe(-40000);
  });
});
