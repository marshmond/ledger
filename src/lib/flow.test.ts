import { describe, expect, it } from 'vitest';
import type { Account, Category, CategoryGroup, Txn } from '../types';
import { buildFlow, filterTree, flowRows, summarizePay, catKey, LOAN_PRINCIPAL, UNCATEGORIZED, type FlowInput } from './flow';
import { layoutFlow } from './flowLayout';
import { RANGE_LABELS, rangeText, resolveRange, yearsIn } from './flowRange';
import type { PayEvent, PersonYear } from './payroll';

const $ = (n: number) => Math.round(n * 100);
let nextId = 1;
const acct = (id: number, kind: Account['kind'], name = `A${id}`): Account => ({ id, name, kind, openingBalanceCents: 0, openingDate: '2026-01-01' });
const accounts = [acct(1, 'checking', 'Checking'), acct(2, 'credit_card', 'Card'), acct(3, 'loan', 'Mortgage'), acct(4, 'savings', 'Savings')];
const groups: CategoryGroup[] = [{ id: 1, name: 'Housing' }, { id: 2, name: 'Food' }, { id: 3, name: 'Income' }];
const cat = (id: number, name: string, groupId: number, kind: Category['kind'] = 'expense'): Category => ({ id, name, groupId, kind });
const categories = [cat(10, 'Utilities', 1), cat(11, 'Rent / Mortgage', 1), cat(20, 'Groceries', 2), cat(21, 'Dining Out', 2), cat(30, 'Paycheck', 3, 'income'), cat(31, 'Interest', 3, 'income')];
const t = (date: string, amount: number, categoryId: number | null, accountId = 1, extra: Partial<Txn> = {}): Txn => ({
  id: nextId++, accountId, date, amountCents: $(amount), payee: 'x', memo: '', status: 'cleared', categoryId, ...extra,
});
const base: Omit<FlowInput, 'txns'> = { accounts, categories, groups, start: '2026-09-01', end: '2026-09-30', detail: 'groups' };
const value = (g: ReturnType<typeof buildFlow>, id: string) => g.links.filter((l) => l.target === id).reduce((a, l) => a + l.value, 0);

describe('flow: net view', () => {
  const txns = [
    t('2026-09-02', 5000, 30), t('2026-09-15', 40, 31),
    t('2026-09-03', -1500, 11), t('2026-09-05', -200, 10), t('2026-09-06', -300, 20), t('2026-09-07', -100, 21),
    t('2026-08-30', -999, 20), // before the range
  ];
  it('income categories feed Income, which feeds spending groups and what was saved', () => {
    const g = buildFlow({ ...base, txns });
    expect(g.mode).toBe('net');
    expect(g.income).toBe($(5040));
    expect(g.spending).toBe($(2100));
    expect(g.left).toBe($(2940));
    expect(value(g, 'income')).toBe($(5040));
    expect(value(g, 'g-g1')).toBe($(1700));
    expect(value(g, 'g-g2')).toBe($(400));
    expect(g.nodes.find((n) => n.id === 'left')!.label).toBe('Saved');
    expect(g.nodes.filter((n) => n.col === 0).map((n) => n.label)).toEqual(['Paycheck', 'Interest']);
    expect(g.nodes.map((n) => n.col).filter((c) => c === 3)).toEqual([]);
  });
  it('every node in the middle passes on what it takes in', () => {
    const g = buildFlow({ ...base, txns, detail: 'categories' });
    for (const n of g.nodes.filter((x) => x.col > 0 && x.col < 3 && x.id !== 'left')) {
      const into = g.links.filter((l) => l.target === n.id).reduce((a, l) => a + l.value, 0);
      const out = g.links.filter((l) => l.source === n.id).reduce((a, l) => a + l.value, 0);
      expect(out).toBe(into);
    }
    expect(g.nodes.filter((n) => n.col === 3).map((n) => n.label)).toEqual(['Rent / Mortgage', 'Utilities', 'Groceries', 'Dining Out']);
  });
  it('leaves out transfers and credit card payments, but counts loan principal', () => {
    const pairs: Txn[] = [
      { ...t('2026-09-10', -400, null, 1), id: 501, transferTxnId: 502 },
      { ...t('2026-09-10', 400, null, 2), id: 502, transferTxnId: 501 },
      { ...t('2026-09-11', -1000, null, 1), id: 503, transferTxnId: 504 },
      { ...t('2026-09-11', 1000, null, 3), id: 504, transferTxnId: 503 },
      { ...t('2026-09-12', -250, null, 1), id: 505, transferTxnId: 506 },
      { ...t('2026-09-12', 250, null, 4), id: 506, transferTxnId: 505 },
    ];
    const g = buildFlow({ ...base, txns: [...txns, ...pairs] });
    expect(g.spending).toBe($(2100 + 1000));
    expect(value(g, 'g-loan')).toBe($(1000));
    expect(g.income).toBe($(5040));
  });
  it('spending on a card counts; refunds reduce a category; uncategorized shows apart', () => {
    const g = buildFlow({ ...base, txns: [t('2026-09-02', 100, 30), t('2026-09-03', -60, 21, 2), t('2026-09-04', 15, 21, 2), t('2026-09-05', -20, null)] });
    expect(value(g, 'g-g2')).toBe($(45));
    expect(value(g, `g-${UNCATEGORIZED}`)).toBe($(20));
  });
  it('more out than in is drawn from savings', () => {
    const g = buildFlow({ ...base, txns: [t('2026-09-02', 100, 30), t('2026-09-03', -300, 20)] });
    expect(g.left).toBe(-$(200));
    const short = g.nodes.find((n) => n.id === 'short')!;
    expect(short).toMatchObject({ label: 'Drawn from savings', col: 0 });
    expect(g.links.find((l) => l.source === 'short')!.value).toBe($(200));
    expect(g.nodes.find((n) => n.id === 'left')).toBeUndefined();
  });
  it('switching categories off removes them, and the rest is called left over', () => {
    const off = new Set([catKey(11), catKey(31)]);
    const g = buildFlow({ ...base, txns, off });
    expect(g.income).toBe($(5000));
    expect(g.spending).toBe($(600));
    expect(g.filtered).toBe(true);
    expect(g.nodes.find((n) => n.id === 'left')!.label).toBe('Left over');
    expect(g.nodes.some((n) => n.label === 'Interest')).toBe(false);
    expect(buildFlow({ ...base, txns, off: new Set([LOAN_PRINCIPAL]) }).filtered).toBe(true);
  });
  it('only the chosen accounts count', () => {
    const mixed = [t('2026-09-02', 100, 30, 1), t('2026-09-03', -30, 20, 1), t('2026-09-03', -50, 20, 2)];
    expect(buildFlow({ ...base, txns: mixed, accountIds: new Set([2]) }).spending).toBe($(50));
    expect(buildFlow({ ...base, txns: mixed, accountIds: new Set([1]) }).spending).toBe($(30));
    expect(buildFlow({ ...base, txns: mixed, accountIds: new Set([1, 2, 3, 4]) }).filtered).toBe(false);
    expect(buildFlow({ ...base, txns: mixed, accountIds: new Set([1]) }).filtered).toBe(true);
  });
  it('splits go to their own categories', () => {
    const s = t('2026-09-03', -100, null, 1, { splits: [{ categoryId: 20, amountCents: -$(70) }, { categoryId: 10, amountCents: -$(30) }] });
    const g = buildFlow({ ...base, txns: [t('2026-09-02', 500, 30), s] });
    expect(value(g, 'g-g2')).toBe($(70));
    expect(value(g, 'g-g1')).toBe($(30));
  });
  it('is empty when nothing happened in the range', () => {
    const g = buildFlow({ ...base, txns: [t('2026-01-02', 100, 30)] });
    expect(g.empty).toBe(true);
    expect(g.nodes).toEqual([]);
  });
  it('lists the flows as a table', () => {
    const rows = flowRows(buildFlow({ ...base, txns: [t('2026-09-02', 1000, 30), t('2026-09-03', -250, 20)] }));
    expect(rows).toContainEqual({ from: 'Income', to: 'Food', cents: $(250), share: 0.25 });
    expect(rows).toContainEqual({ from: 'Income', to: 'Saved', cents: $(750), share: 0.75 });
  });
});

const ev = (date: string, kind: PayEvent['kind'], gross: number, over: Partial<PayEvent> = {}): PayEvent => ({
  date, kind, label: '', gross: $(gross), deductions: { k: $(gross * 0.1) }, employerMatch: 0, fedTaxable: 0, ficaTaxable: 0, stateTaxable: 0,
  fedWithholding: $(gross * 0.2), socialSecurity: $(gross * 0.062), medicare: $(gross * 0.0145), addlMedicare: 0, stateWithholding: $(gross * 0.05), pfml: 0, net: 0, notes: [], ...over,
});
const year = (events: PayEvent[]) => ({ personId: 1, year: 2026, events } as PersonYear);

describe('flow: gross view', () => {
  it('adds up pay in the range by source, tax, and deduction', () => {
    const y = year([ev('2026-09-05', 'regular', 1000), ev('2026-09-19', 'regular', 1000), ev('2026-09-20', 'bonus', 500), ev('2026-10-03', 'regular', 1000)]);
    const p = summarizePay([y], '2026-09-01', '2026-09-30', (id) => (id === 'k' ? '401(k)' : id));
    expect(p.sources).toEqual([{ label: 'Salary', cents: $(2000) }, { label: 'Bonus', cents: $(500) }]);
    expect(p.fed).toBe($(500));
    expect(p.deductions).toEqual([{ label: '401(k)', cents: $(250) }]);
  });
  it('flows gross pay to taxes, deductions and take-home, then take-home to spending', () => {
    const pay = summarizePay([year([ev('2026-09-05', 'regular', 10000)])], '2026-09-01', '2026-09-30', () => '401(k)');
    const g = buildFlow({ ...base, txns: [t('2026-09-03', -2000, 11), t('2026-09-04', -500, 20)], pay });
    expect(g.mode).toBe('gross');
    const takeHome = 10000 - 2000 - 620 - 145 - 500 - 1000;
    expect(g.income).toBe($(takeHome));
    expect(value(g, 'take')).toBe($(takeHome));
    expect(g.spending).toBe($(2500));
    expect(g.left).toBe($(takeHome - 2500));
    expect(g.nodes.find((n) => n.id === 'gross')!.col).toBe(1);
    expect(g.nodes.find((n) => n.id === 'take')!.col).toBe(2);
    expect(g.nodes.find((n) => n.label === '401(k)')!.col).toBe(2);
    expect(g.nodes.find((n) => n.label === 'Housing')!.col).toBe(3);
    const grossNode = value(g, 'gross');
    expect(g.links.filter((l) => l.source === 'gross').reduce((a, l) => a + l.value, 0)).toBe(grossNode);
  });
  it('spending above take-home is drawn from savings, feeding take-home', () => {
    const pay = summarizePay([year([ev('2026-09-05', 'regular', 1000)])], '2026-09-01', '2026-09-30', () => 'x');
    const g = buildFlow({ ...base, txns: [t('2026-09-03', -2000, 11)], pay });
    expect(g.nodes.find((n) => n.id === 'short')!.col).toBe(1);
    expect(g.links.find((l) => l.source === 'short')!.target).toBe('take');
  });
});

describe('the filter list', () => {
  it('groups categories like the budget, income apart, plus the special entries', () => {
    const f = filterTree(categories, groups);
    expect(f.income.map((x) => x.label)).toEqual(['Paycheck', 'Interest', 'Other income (uncategorized)']);
    expect(f.groups.map((g) => g.label)).toEqual(['Housing', 'Food', 'Other spending']);
    expect(f.groups[0].items.map((x) => x.label)).toEqual(['Utilities', 'Rent / Mortgage']);
    expect(f.groups.at(-1)!.items.map((x) => x.key)).toEqual([LOAN_PRINCIPAL, UNCATEGORIZED]);
  });
});

describe('time periods', () => {
  const today = '2026-10-19';
  it('presets', () => {
    expect(resolveRange('this_month', today)).toEqual({ start: '2026-10-01', end: today });
    expect(resolveRange('last_month', today)).toEqual({ start: '2026-09-01', end: '2026-09-30' });
    expect(resolveRange('last3', today)).toEqual({ start: '2026-07-01', end: '2026-09-30' });
    expect(resolveRange('last12', today)).toEqual({ start: '2025-10-01', end: '2026-09-30' });
    expect(resolveRange('ytd', today)).toEqual({ start: '2026-01-01', end: today });
    expect(resolveRange('last_year', today)).toEqual({ start: '2025-01-01', end: '2025-12-31' });
    expect(resolveRange('all', today, undefined, '2016-03-04')).toEqual({ start: '2016-03-04', end: today });
    expect(resolveRange('all', today)).toEqual({ start: today, end: today });
  });
  it('custom dates, in either order, with blanks filled in', () => {
    expect(resolveRange('custom', today, { start: '2026-02-01', end: '2026-03-15' })).toEqual({ start: '2026-02-01', end: '2026-03-15' });
    expect(resolveRange('custom', today, { start: '2026-05-01', end: '2026-03-15' })).toEqual({ start: '2026-03-15', end: '2026-05-01' });
    expect(resolveRange('custom', today, {})).toEqual({ start: '2026-10-01', end: today });
  });
  it('January wraps to last year', () => {
    expect(resolveRange('last_month', '2026-01-10')).toEqual({ start: '2025-12-01', end: '2025-12-31' });
  });
  it('words and years', () => {
    expect(rangeText({ start: '2026-07-01', end: '2026-09-30' })).toBe('Jul 1 to Sep 30, 2026');
    expect(rangeText({ start: '2025-10-01', end: '2026-09-30' })).toBe('Oct 1, 2025 to Sep 30, 2026');
    expect(yearsIn({ start: '2024-11-01', end: '2026-02-01' })).toEqual([2024, 2025, 2026]);
    expect(Object.keys(RANGE_LABELS)).toHaveLength(9);
  });
});

describe('layout', () => {
  const g = buildFlow({ ...base, txns: [t('2026-09-02', 5000, 30), t('2026-09-03', -1500, 11), t('2026-09-05', -200, 10), t('2026-09-06', -300, 20)], detail: 'categories' });
  const L = layoutFlow(g, { width: 800 });
  it('places every node inside the picture, without overlap in a column', () => {
    expect(L.nodes).toHaveLength(g.nodes.length);
    for (const n of L.nodes) {
      expect(n.y).toBeGreaterThanOrEqual(0);
      expect(n.y + n.h).toBeLessThanOrEqual(L.height);
      expect(n.x + L.nodeW).toBeLessThanOrEqual(L.width);
    }
    for (let c = 0; c < L.cols; c++) {
      const col = L.nodes.filter((n) => n.col === c).sort((a, b) => a.y - b.y);
      for (let i = 1; i < col.length; i++) expect(col[i].y).toBeGreaterThanOrEqual(col[i - 1].y + col[i - 1].h - 0.001);
    }
  });
  it('draws bands in proportion to their amounts', () => {
    const rent = L.links.find((l) => l.target === 'k-c11')!;
    const util = L.links.find((l) => l.target === 'k-c10')!;
    expect(rent.width / util.width).toBeCloseTo(1500 / 200, 5);
    expect(rent.path.startsWith('M')).toBe(true);
  });
  it('columns are the same height scale, so the hub is as tall as its flows', () => {
    const hub = L.nodes.find((n) => n.id === 'income')!;
    const into = L.links.filter((l) => l.target === 'income').reduce((a, l) => a + l.width, 0);
    expect(hub.h).toBeCloseTo(into, 5);
  });
  it('copes with nothing to draw', () => {
    const empty = layoutFlow(buildFlow({ ...base, txns: [] }), { width: 600 });
    expect(empty.nodes).toEqual([]);
    expect(empty.links).toEqual([]);
  });
});
