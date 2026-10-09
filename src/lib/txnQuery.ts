import type { Account, Category, Txn, TxnStatus } from '../types';
import { allocations } from './ledger';
import { addDays, endOfMonth, monthOf, prevMonth } from './dates';

/** Filtering, sorting, totals, and CSV export for the All Transactions screen. Pure functions over plain arrays. */

export type CatSel = number | 'uncategorized' | 'transfer';
export type SortKey = 'date' | 'account' | 'category' | 'payee' | 'amount';
export interface Sort { key: SortKey; dir: 'asc' | 'desc' }
export type AmountOp = 'any' | 'gt' | 'lt' | 'eq' | 'between';

export interface TxnFilter {
  accountIds: number[]; // empty = all accounts
  from: string; // 'YYYY-MM-DD' or ''
  to: string;
  categories: CatSel[]; // empty = all
  text: string; // matches payee or memo
  amountOp: AmountOp;
  /** 'absolute' ignores the sign (size of the amount); 'signed' compares money in (+) and out (-) as they are. */
  amountMode: 'absolute' | 'signed';
  amountA: number; // cents
  amountB: number; // cents (upper bound for 'between')
  statuses: TxnStatus[]; // empty = all
  hideTransfers: boolean;
  uncategorizedOnly: boolean;
  pendingOnly: boolean;
}

export const EMPTY_FILTER: TxnFilter = {
  accountIds: [], from: '', to: '', categories: [], text: '', amountOp: 'any', amountMode: 'absolute', amountA: 0, amountB: 0,
  statuses: [], hideTransfers: false, uncategorizedOnly: false, pendingOnly: false,
};
export const DEFAULT_SORT: Sort = { key: 'date', dir: 'desc' };

export interface Row {
  txn: Txn;
  accountName: string;
  /** What to show in the Category column. */
  categoryLabel: string;
  /** Category ids of the parts (null = uncategorized); empty for transfers. */
  categoryIds: (number | null)[];
  transferWith?: string;
}

export function buildRows(txns: Txn[], accounts: Account[], categories: Category[]): Row[] {
  const acct = new Map(accounts.map((a) => [a.id!, a.name]));
  const cat = new Map(categories.map((c) => [c.id!, c.name]));
  const byId = new Map(txns.map((t) => [t.id!, t]));
  const name = (id: number | null) => (id === null ? 'Uncategorized' : cat.get(id) ?? 'Unknown');
  return txns.map((txn) => {
    const accountName = acct.get(txn.accountId) ?? 'Unknown account';
    if (txn.transferTxnId) {
      const other = byId.get(txn.transferTxnId);
      const transferWith = other ? acct.get(other.accountId) ?? 'Unknown account' : 'another account';
      return { txn, accountName, categoryLabel: `↔ ${transferWith}`, categoryIds: [], transferWith };
    }
    const parts = allocations(txn);
    return {
      txn,
      accountName,
      categoryIds: parts.map((p) => p.categoryId),
      categoryLabel: txn.splits?.length ? `Split: ${parts.map((p) => name(p.categoryId)).join(', ')}` : name(txn.categoryId),
    };
  });
}

export function matches(r: Row, f: TxnFilter): boolean {
  const t = r.txn;
  if (f.accountIds.length && !f.accountIds.includes(t.accountId)) return false;
  if (f.from && t.date < f.from) return false;
  if (f.to && t.date > f.to) return false;

  if (f.categories.length) {
    const ok = f.categories.some((c) => {
      if (c === 'transfer') return !!t.transferTxnId;
      if (c === 'uncategorized') return !t.transferTxnId && r.categoryIds.includes(null);
      return r.categoryIds.includes(c);
    });
    if (!ok) return false;
  }

  const q = f.text.trim().toLowerCase();
  if (q && !t.payee.toLowerCase().includes(q) && !t.memo.toLowerCase().includes(q)) return false;

  if (f.amountOp !== 'any') {
    const v = f.amountMode === 'absolute' ? Math.abs(t.amountCents) : t.amountCents;
    if (f.amountOp === 'gt' && !(v > f.amountA)) return false;
    if (f.amountOp === 'lt' && !(v < f.amountA)) return false;
    if (f.amountOp === 'eq' && v !== f.amountA) return false;
    if (f.amountOp === 'between' && !(v >= Math.min(f.amountA, f.amountB) && v <= Math.max(f.amountA, f.amountB))) return false;
  }

  if (f.statuses.length && !f.statuses.includes(t.status)) return false;
  if (f.hideTransfers && t.transferTxnId) return false;
  if (f.uncategorizedOnly && (t.transferTxnId || !r.categoryIds.includes(null))) return false;
  if (f.pendingOnly && t.status !== 'pending') return false;
  return true;
}

export const applyFilter = (rows: Row[], f: TxnFilter): Row[] => rows.filter((r) => matches(r, f));

const text = (s: string) => s.toLowerCase();

export function sortRows(rows: Row[], sort: Sort): Row[] {
  const dir = sort.dir === 'asc' ? 1 : -1;
  const cmp = (a: Row, b: Row): number => {
    switch (sort.key) {
      case 'date': return a.txn.date.localeCompare(b.txn.date);
      case 'account': return text(a.accountName).localeCompare(text(b.accountName));
      case 'category': return text(a.categoryLabel).localeCompare(text(b.categoryLabel));
      case 'payee': return text(a.txn.payee).localeCompare(text(b.txn.payee));
      case 'amount': return a.txn.amountCents - b.txn.amountCents;
    }
  };
  // Ties: newest date first, then newest entry first, so the order never jumps around between renders.
  return [...rows].sort((a, b) => cmp(a, b) * dir || b.txn.date.localeCompare(a.txn.date) || (b.txn.id ?? 0) - (a.txn.id ?? 0));
}

export interface Totals { count: number; outCents: number; inCents: number; netCents: number; transfers: number }

export function totals(rows: Row[]): Totals {
  let out = 0;
  let inn = 0;
  let transfers = 0;
  for (const r of rows) {
    const a = r.txn.amountCents;
    if (a < 0) out += -a;
    else inn += a;
    if (r.txn.transferTxnId) transfers++;
  }
  return { count: rows.length, outCents: out, inCents: inn, netCents: inn - out, transfers };
}

// ---- date presets ----

export type DatePreset = 'all' | 'thisMonth' | 'lastMonth' | 'last30' | 'last90' | 'thisYear' | 'lastYear';

export function presetRange(p: DatePreset, today: string): { from: string; to: string } {
  const year = Number(today.slice(0, 4));
  switch (p) {
    case 'all': return { from: '', to: '' };
    case 'thisMonth': return { from: `${monthOf(today)}-01`, to: endOfMonth(monthOf(today)) };
    case 'lastMonth': { const m = prevMonth(monthOf(today)); return { from: `${m}-01`, to: endOfMonth(m) }; }
    case 'last30': return { from: addDays(today, -29), to: today };
    case 'last90': return { from: addDays(today, -89), to: today };
    case 'thisYear': return { from: `${year}-01-01`, to: `${year}-12-31` };
    case 'lastYear': return { from: `${year - 1}-01-01`, to: `${year - 1}-12-31` };
  }
}

// ---- CSV export ----

/** Text that starts with = + - @ (or a tab/return) can be run as a formula by spreadsheets; a leading apostrophe defuses it. */
export function safeText(s: string): string {
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

export function csvCell(s: string): string {
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const dollars = (cents: number) => (cents / 100).toFixed(2);

export function toCsv(rows: Row[], categories: Category[]): string {
  const cat = new Map(categories.map((c) => [c.id!, c.name]));
  const head = ['Date', 'Account', 'Payee', 'Category', 'Memo', 'Status', 'Amount', 'Transfer with'];
  const lines = [head.join(',')];
  for (const r of rows) {
    const t = r.txn;
    const category = t.splits?.length
      ? `Split: ${t.splits.map((s) => `${s.categoryId === null ? 'Uncategorized' : cat.get(s.categoryId) ?? 'Unknown'} ${dollars(s.amountCents)}`).join('; ')}`
      : r.transferWith
        ? 'Transfer'
        : r.categoryLabel;
    lines.push(
      [
        t.date,
        csvCell(safeText(r.accountName)),
        csvCell(safeText(t.payee)),
        csvCell(safeText(category)),
        csvCell(safeText(t.memo)),
        t.status,
        dollars(t.amountCents), // numeric: a leading minus here is a number, not a formula
        csvCell(safeText(r.transferWith ?? '')),
      ].join(','),
    );
  }
  return lines.join('\r\n') + '\r\n';
}

/** True if any filter is active (used to show a "Clear" button and a count). */
export function activeFilterCount(f: TxnFilter): number {
  return [
    f.accountIds.length > 0,
    !!f.from || !!f.to,
    f.categories.length > 0,
    f.text.trim() !== '',
    f.amountOp !== 'any',
    f.statuses.length > 0,
    f.hideTransfers,
    f.uncategorizedOnly,
    f.pendingOnly,
  ].filter(Boolean).length;
}

/**
 * The selected ids that are still inside the current filtered results. Rows hidden by a filter change are never acted on,
 * so a bulk delete cannot hit something you can no longer see.
 */
export function visibleSelection(selected: Iterable<number>, rows: Row[]): number[] {
  const inView = new Set(rows.map((r) => r.txn.id!));
  return [...new Set(selected)].filter((id) => inView.has(id));
}
