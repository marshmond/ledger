import { beforeEach, describe, expect, it } from 'vitest';
import { FinanceDB } from '../db';
import type { Account, Category, Txn } from '../types';
import { createTransfer } from './transfers';
import {
  EMPTY_FILTER, activeFilterCount, applyFilter, buildRows, csvCell, presetRange, safeText, sortRows, toCsv, totals, visibleSelection, type TxnFilter,
} from './txnQuery';
import { bulkDelete, bulkSetCategory, bulkSetStatus, deleteSavedFilter, listSavedFilters, saveFilter } from './txnBulk';

const $ = (n: number) => Math.round(n * 100);
const accounts: Account[] = [
  { id: 1, name: 'Checking', kind: 'checking', openingBalanceCents: 0, openingDate: '2026-01-01' },
  { id: 2, name: 'Capital One', kind: 'credit_card', openingBalanceCents: 0, openingDate: '2026-01-01' },
];
const categories: Category[] = [
  { id: 1, groupId: 1, name: 'Groceries', kind: 'expense' },
  { id: 2, groupId: 1, name: 'Dining Out', kind: 'expense' },
  { id: 3, groupId: 2, name: 'Paycheck', kind: 'income' },
];

let n = 1;
const t = (p: Partial<Txn> & Pick<Txn, 'accountId' | 'date' | 'amountCents'>): Txn => ({
  id: n++, payee: '', memo: '', status: 'cleared', categoryId: null, ...p,
});

function dataset(): Txn[] {
  n = 1;
  return [
    t({ accountId: 1, date: '2026-03-01', amountCents: -$(100), payee: 'Whole Foods', categoryId: 1 }),                 // 1
    t({ accountId: 1, date: '2026-03-15', amountCents: -$(45.5), payee: 'Chipotle', categoryId: 2, memo: 'team lunch' }), // 2
    t({ accountId: 2, date: '2026-03-15', amountCents: -$(60), payee: 'Trader Joes', categoryId: 1, status: 'pending' }), // 3
    t({ accountId: 1, date: '2026-04-01', amountCents: $(2500), payee: 'ACME Payroll', categoryId: 3 }),               // 4
    t({ accountId: 2, date: '2026-04-02', amountCents: -$(80), payee: 'Costco' }),                                      // 5 uncategorized
    t({ accountId: 1, date: '2026-04-10', amountCents: -$(100), payee: 'Mixed basket', splits: [{ categoryId: 1, amountCents: -$(60) }, { categoryId: 2, amountCents: -$(40) }] }), // 6 split
    t({ accountId: 1, date: '2026-05-05', amountCents: -$(0.5), payee: 'Parking', categoryId: 2 }),                     // 7
    t({ accountId: 2, date: '2026-05-06', amountCents: $(12.25), payee: 'Refund', categoryId: 1 }),                     // 8 inflow on expense category
    t({ accountId: 1, date: '2026-05-20', amountCents: -$(250), payee: 'Capital One payment', transferTxnId: 10 }),     // 9
    t({ accountId: 2, date: '2026-05-20', amountCents: $(250), payee: 'Payment', transferTxnId: 9 }),                   // 10
  ];
}

const rows = () => buildRows(dataset(), accounts, categories);
const ids = (f: Partial<TxnFilter>, r = rows()) => applyFilter(r, { ...EMPTY_FILTER, ...f }).map((x) => x.txn.id);

describe('building rows', () => {
  it('labels single categories, splits, transfers, and uncategorized', () => {
    const r = rows();
    const label = (id: number) => r.find((x) => x.txn.id === id)!.categoryLabel;
    expect(label(1)).toBe('Groceries');
    expect(label(5)).toBe('Uncategorized');
    expect(label(6)).toBe('Split: Groceries, Dining Out');
    expect(label(9)).toBe('↔ Capital One');
    expect(label(10)).toBe('↔ Checking');
    expect(r.find((x) => x.txn.id === 9)!.accountName).toBe('Checking');
  });
});

describe('filters, one at a time', () => {
  it('account (one or several)', () => {
    expect(ids({ accountIds: [2] })).toEqual([3, 5, 8, 10]);
    expect(ids({ accountIds: [1, 2] })).toHaveLength(10);
  });

  it('date range is inclusive at both ends, and either end can be open', () => {
    expect(ids({ from: '2026-03-15', to: '2026-04-02' })).toEqual([2, 3, 4, 5]);
    expect(ids({ from: '2026-05-06' })).toEqual([8, 9, 10]);
    expect(ids({ to: '2026-03-01' })).toEqual([1]);
    expect(ids({ from: '2026-03-02', to: '2026-03-14' })).toEqual([]);
  });

  it('category: a split matches any of its parts; uncategorized and transfers are choosable', () => {
    expect(ids({ categories: [1] })).toEqual([1, 3, 6, 8]);
    expect(ids({ categories: [2] })).toEqual([2, 6, 7]);
    expect(ids({ categories: [1, 2] })).toEqual([1, 2, 3, 6, 7, 8]);
    expect(ids({ categories: ['uncategorized'] })).toEqual([5]);
    expect(ids({ categories: ['transfer'] })).toEqual([9, 10]);
    expect(ids({ categories: [3] })).toEqual([4]);
  });

  it('payee text matches payee or memo, ignoring case', () => {
    expect(ids({ text: 'costco' })).toEqual([5]);
    expect(ids({ text: 'TEAM LUNCH' })).toEqual([2]); // memo
    expect(ids({ text: ' joes ' })).toEqual([3]);
    expect(ids({ text: 'zzz' })).toEqual([]);
  });

  it('amount, ignoring sign: greater than, less than, equal, between (strict vs inclusive)', () => {
    const abs = { amountMode: 'absolute' as const };
    expect(ids({ ...abs, amountOp: 'gt', amountA: $(100) })).toEqual([4, 9, 10]); // 100.00 itself is not greater
    expect(ids({ ...abs, amountOp: 'lt', amountA: $(1) })).toEqual([7]);
    expect(ids({ ...abs, amountOp: 'eq', amountA: $(100) })).toEqual([1, 6]);
    expect(ids({ ...abs, amountOp: 'between', amountA: $(45.5), amountB: $(80) })).toEqual([2, 3, 5]); // inclusive
    expect(ids({ ...abs, amountOp: 'between', amountA: $(80), amountB: $(45.5) })).toEqual([2, 3, 5]); // order does not matter
  });

  it('amount, signed: money in (+) and money out (-) are different', () => {
    const sg = { amountMode: 'signed' as const };
    expect(ids({ ...sg, amountOp: 'gt', amountA: 0 })).toEqual([4, 8, 10]); // all inflows
    expect(ids({ ...sg, amountOp: 'lt', amountA: -$(100) })).toEqual([9]); // out by more than $100
    expect(ids({ ...sg, amountOp: 'lt', amountA: 0 })).toEqual([1, 2, 3, 5, 6, 7, 9]);
    expect(ids({ ...sg, amountOp: 'between', amountA: -$(60), amountB: -$(45.5) })).toEqual([2, 3]);
  });

  it('status and the quick filters', () => {
    expect(ids({ statuses: ['pending'] })).toEqual([3]);
    expect(ids({ pendingOnly: true })).toEqual([3]);
    expect(ids({ hideTransfers: true })).toHaveLength(8);
    expect(ids({ uncategorizedOnly: true })).toEqual([5]); // transfers are not "uncategorized"
  });
});

describe('filters combined', () => {
  it('all of them must hold', () => {
    expect(ids({ accountIds: [1], categories: [2], from: '2026-03-01', to: '2026-04-30' })).toEqual([2, 6]);
    expect(ids({ accountIds: [2], categories: [1], amountOp: 'lt', amountA: $(70), amountMode: 'absolute' })).toEqual([3, 8]);
    expect(ids({ text: 'o', accountIds: [2], hideTransfers: true, amountOp: 'gt', amountA: $(70), amountMode: 'absolute' })).toEqual([5]);
  });

  it('counts active filters', () => {
    expect(activeFilterCount(EMPTY_FILTER)).toBe(0);
    expect(activeFilterCount({ ...EMPTY_FILTER, from: '2026-01-01', to: '2026-02-01', text: 'x', pendingOnly: true })).toBe(3);
  });
});

describe('sorting', () => {
  const order = (key: Parameters<typeof sortRows>[1]['key'], dir: 'asc' | 'desc') => sortRows(rows(), { key, dir }).map((r) => r.txn.id);

  it('by amount (signed), both directions', () => {
    expect(order('amount', 'asc').slice(0, 3)).toEqual([9, 6, 1]); // -250, then the two -100s (tie: the newer date, id 6, comes first)
    expect(order('amount', 'desc').slice(0, 2)).toEqual([4, 10]);
  });

  it('by date; ties fall back to the newest entry first', () => {
    expect(order('date', 'desc').slice(0, 3)).toEqual([10, 9, 8]);
    expect(order('date', 'asc').slice(0, 3)).toEqual([1, 3, 2]); // Mar 1, then the two on Mar 15 (newest id first)
  });

  it('by account name, payee, and category (case-insensitive)', () => {
    const acctOrder = sortRows(rows(), { key: 'account', dir: 'asc' }).map((r) => r.accountName);
    expect(acctOrder.slice(0, 4)).toEqual(['Capital One', 'Capital One', 'Capital One', 'Capital One']);
    expect(order('payee', 'asc')[0]).toBe(4); // ACME Payroll
    expect(order('payee', 'desc')[0]).toBe(1); // Whole Foods sorts last
    const cats = sortRows(rows(), { key: 'category', dir: 'asc' }).map((r) => r.categoryLabel);
    expect(cats[0]).toBe('↔ Capital One');
    expect([...cats].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))).toEqual(cats);
  });

  it('does not change the input array', () => {
    const r = rows();
    const before = r.map((x) => x.txn.id);
    sortRows(r, { key: 'amount', dir: 'asc' });
    expect(r.map((x) => x.txn.id)).toEqual(before);
  });
});

describe('totals', () => {
  it('count, money out, money in, net, and how many transfer rows are included', () => {
    const tt = totals(rows());
    expect(tt.count).toBe(10);
    expect(tt.outCents).toBe($(100 + 45.5 + 60 + 80 + 100 + 0.5 + 250));
    expect(tt.inCents).toBe($(2500 + 12.25 + 250));
    expect(tt.netCents).toBe(tt.inCents - tt.outCents);
    expect(tt.transfers).toBe(2);
    expect(totals([])).toEqual({ count: 0, outCents: 0, inCents: 0, netCents: 0, transfers: 0 });
  });
});

describe('date presets', () => {
  it('computes ranges from a given today', () => {
    expect(presetRange('thisMonth', '2026-10-08')).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(presetRange('lastMonth', '2026-10-08')).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(presetRange('lastMonth', '2026-01-15')).toEqual({ from: '2025-12-01', to: '2025-12-31' });
    expect(presetRange('lastMonth', '2028-03-01')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(presetRange('last30', '2026-10-08')).toEqual({ from: '2026-09-09', to: '2026-10-08' });
    expect(presetRange('last90', '2026-10-08')).toEqual({ from: '2026-07-11', to: '2026-10-08' });
    expect(presetRange('thisYear', '2026-10-08')).toEqual({ from: '2026-01-01', to: '2026-12-31' });
    expect(presetRange('lastYear', '2026-10-08')).toEqual({ from: '2025-01-01', to: '2025-12-31' });
    expect(presetRange('all', '2026-10-08')).toEqual({ from: '', to: '' });
  });
});

describe('CSV export', () => {
  it('quotes commas, quotes, and line breaks', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
  });

  it('defuses text that a spreadsheet could run as a formula, but leaves real numbers alone', () => {
    expect(safeText('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(safeText('+1555')).toBe("'+1555");
    expect(safeText('-cmd')).toBe("'-cmd");
    expect(safeText('@home')).toBe("'@home");
    expect(safeText('Whole Foods')).toBe('Whole Foods');
    const txns = [t({ accountId: 1, date: '2026-01-02', amountCents: -$(12.5), payee: '=HYPERLINK("http://x")', memo: 'a,b' })];
    const csv = toCsv(buildRows(txns, accounts, categories), categories);
    const line = csv.split('\r\n')[1];
    expect(line).toContain(`"'=HYPERLINK(""http://x"")"`);
    expect(line).toContain('"a,b"');
    expect(line.split(',').includes('-12.50') || line.includes(',-12.50,')).toBe(true); // amount stays a plain number
  });

  it('has a header, one line per row in the given order, signed plain amounts, split detail and transfer partner', () => {
    const r = sortRows(rows(), { key: 'date', dir: 'asc' });
    const csv = toCsv(r, categories);
    const lines = csv.trim().split('\r\n');
    expect(lines[0]).toBe('Date,Account,Payee,Category,Memo,Status,Amount,Transfer with');
    expect(lines).toHaveLength(11);
    expect(lines[1]).toBe('2026-03-01,Checking,Whole Foods,Groceries,,cleared,-100.00,');
    expect(csv).toContain('Split: Groceries -60.00; Dining Out -40.00');
    expect(csv).toContain('2026-05-20,Checking,Capital One payment,Transfer,,cleared,-250.00,Capital One');
    expect(csv.endsWith('\r\n')).toBe(true);
  });

  it('exports only the filtered rows', () => {
    const csv = toCsv(applyFilter(rows(), { ...EMPTY_FILTER, categories: [2] }), categories);
    expect(csv.trim().split('\r\n')).toHaveLength(4); // header + 3
  });
});

describe('bulk actions and saved filters', () => {
  let d: FinanceDB;
  let k = 0;
  beforeEach(async () => {
    d = new FinanceDB(`txn-bulk-${k++}`);
    await d.accounts.bulkAdd(accounts.map(({ id, ...a }) => ({ ...a, id })));
    n = 1;
    await d.txns.bulkAdd([
      t({ accountId: 1, date: '2026-03-01', amountCents: -$(10), payee: 'a', categoryId: 1 }),
      t({ accountId: 1, date: '2026-03-02', amountCents: -$(20), payee: 'b', splits: [{ categoryId: 1, amountCents: -$(12) }, { categoryId: 2, amountCents: -$(8) }] }),
      t({ accountId: 1, date: '2026-03-03', amountCents: -$(30), payee: 'c', status: 'pending' }),
    ]);
  });

  it('bulk category: updates plain rows, replaces splits, skips transfers, reports what happened', async () => {
    const { fromTxnId } = await createTransfer(d, { fromAccountId: 1, toAccountId: 2, date: '2026-03-04', amountCents: $(50) });
    const r = await bulkSetCategory(d, [1, 2, 3, fromTxnId], 2);
    expect(r).toEqual({ updated: 3, skippedTransfers: 1, splitsCleared: 1 });
    const all = await d.txns.toArray();
    expect(all.filter((x) => !x.transferTxnId).every((x) => x.categoryId === 2 && !x.splits)).toBe(true);
    expect((await d.txns.get(fromTxnId))!.categoryId).toBeNull();
    await bulkSetCategory(d, [1], null);
    expect((await d.txns.get(1))!.categoryId).toBeNull();
  });

  it('bulk status: the other half of a transfer follows', async () => {
    const { fromTxnId, toTxnId } = await createTransfer(d, { fromAccountId: 1, toAccountId: 2, date: '2026-03-04', amountCents: $(50) });
    expect(await bulkSetStatus(d, [3, fromTxnId], 'cleared')).toBe(2);
    expect((await d.txns.get(3))!.status).toBe('cleared');
    expect((await d.txns.get(toTxnId))!.status).toBe('cleared');
    expect(await bulkSetStatus(d, [9999], 'cleared')).toBe(0);
  });

  it('bulk delete: counts both halves of a transfer once, even if both are selected', async () => {
    const { fromTxnId, toTxnId } = await createTransfer(d, { fromAccountId: 1, toAccountId: 2, date: '2026-03-04', amountCents: $(50) });
    expect(await bulkDelete(d, [1, fromTxnId, toTxnId, 1])).toBe(3); // txn 1 + the transfer pair
    expect(await d.txns.count()).toBe(2);
  });

  it('saved filters: save, replace by name, list sorted, delete, and survive older saved shapes', async () => {
    expect(await listSavedFilters(d)).toEqual([]);
    await saveFilter(d, 'Last quarter groceries', { ...EMPTY_FILTER, categories: [1] }, { key: 'amount', dir: 'asc' });
    await saveFilter(d, 'Big spends', { ...EMPTY_FILTER, amountOp: 'gt', amountA: 10000 }, { key: 'date', dir: 'desc' });
    await saveFilter(d, 'big SPENDS', { ...EMPTY_FILTER, amountOp: 'gt', amountA: 99999 }, { key: 'date', dir: 'desc' });
    const all = await listSavedFilters(d);
    expect(all.map((f) => f.name)).toEqual(['big SPENDS', 'Last quarter groceries']);
    expect(all[0].filter.amountA).toBe(99999);
    await expect(saveFilter(d, '  ', EMPTY_FILTER, { key: 'date', dir: 'asc' })).rejects.toThrow();

    // an older saved filter without newer fields still loads with defaults
    await d.settings.put({ key: 'savedFilters', value: [{ id: 'x', name: 'Old', filter: { text: 'abc' }, sort: { key: 'payee' } }] });
    const old = (await listSavedFilters(d))[0];
    expect(old.filter).toMatchObject({ text: 'abc', accountIds: [], pendingOnly: false });
    expect(old.sort).toEqual({ key: 'payee', dir: 'desc' });

    const left = await deleteSavedFilter(d, old.id);
    expect(left).toEqual([]);
  });
});

describe('selection only counts visible rows', () => {
  it('ignores selected ids that a filter change has hidden, and duplicates', () => {
    const all = rows();
    const visible = applyFilter(all, { ...EMPTY_FILTER, accountIds: [2] }); // ids 3, 5, 8, 10
    expect(visibleSelection([1, 3, 5, 99, 3], visible)).toEqual([3, 5]);
    expect(visibleSelection([1, 2], visible)).toEqual([]);
    expect(visibleSelection([], visible)).toEqual([]);
  });
});
