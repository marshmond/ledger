import { beforeEach, describe, expect, it } from 'vitest';
import { FinanceDB } from '../db';
import { classifyRows, commitImport, normalizeRows, detectMapping } from './csvImport';
import { exportAll, importAll } from './backup';
import { applyRulesToExisting, detectRecurring, matchRule, normPayee, recentPayees, recurringFromGuess, suggestCategory, suggestRules } from './rules';
import type { PayeeRule, RecurringRule, Txn } from '../types';

const $ = (n: number) => Math.round(n * 100);
let id = 1;
const t = (payee: string, date: string, amt: number, extra: Partial<Txn> = {}): Txn => ({ id: id++, accountId: 1, date, amountCents: $(amt), payee, memo: '', status: 'cleared', categoryId: null, ...extra });
const rule = (pattern: string, categoryId: number | null, extra: Partial<PayeeRule> = {}): PayeeRule => ({ id: id++, pattern, categoryId, ...extra });

describe('payee matching', () => {
  it('ignores case, punctuation, and reference numbers', () => {
    expect(normPayee('WHOLEFDS #1234 BOSTON')).toBe('wholefds boston');
    expect(normPayee('  Whole  Foods!! ')).toBe('whole foods');
  });
  it('a rule matches when its text appears in the payee', () => {
    const rules = [rule('whole foods', 5), rule('shell', 6)];
    expect(matchRule(rules, 'WHOLE FOODS MARKET #123')?.categoryId).toBe(5);
    expect(matchRule(rules, 'Shell Oil 5555')?.categoryId).toBe(6);
    expect(matchRule(rules, 'Trader Joes')).toBeNull();
    expect(matchRule([rule('', 1)], 'anything')).toBeNull();
  });
  it('the longest matching text wins, then the oldest rule', () => {
    const rules = [rule('amazon', 1), rule('amazon prime', 2)];
    expect(matchRule(rules, 'Amazon Prime Video')?.categoryId).toBe(2);
    expect(matchRule(rules, 'Amazon Mktp')?.categoryId).toBe(1);
  });
  it('a rule limited to one account only applies there', () => {
    const rules = [rule('transfer', 9, { accountId: 2 })];
    expect(matchRule(rules, 'Transfer', 1)).toBeNull();
    expect(matchRule(rules, 'Transfer', 2)?.categoryId).toBe(9);
  });
});

describe('category suggestions', () => {
  const hist = [t('Whole Foods', '2026-01-01', -50, { categoryId: 5 }), t('WHOLE FOODS #22', '2026-02-01', -60, { categoryId: 5 }), t('Whole Foods', '2026-03-01', -70, { categoryId: 5 })];
  it('prefers a rule', () => {
    expect(suggestCategory(hist, [rule('whole foods', 8, { rename: 'Whole Foods Market' })], 'whole foods')).toEqual({ categoryId: 8, source: 'rule', rename: 'Whole Foods Market' });
  });
  it('otherwise uses how you categorized it before', () => {
    expect(suggestCategory(hist, [], 'Whole Foods')).toEqual({ categoryId: 5, source: 'history' });
  });
  it('needs at least two past examples and a clear majority', () => {
    expect(suggestCategory([hist[0]], [], 'Whole Foods')).toBeNull();
    const mixed = [t('X', '2026-01-01', -1, { categoryId: 1 }), t('X', '2026-01-02', -1, { categoryId: 2 }), t('X', '2026-01-03', -1, { categoryId: 3 })];
    expect(suggestCategory(mixed, [], 'X')).toBeNull();
    expect(suggestCategory(hist, [], '   ')).toBeNull();
  });
  it('ignores transfers and split transactions in history', () => {
    const odd = [t('Y', '2026-01-01', -1, { categoryId: 1, transferTxnId: 5 }), t('Y', '2026-01-02', -1, { categoryId: 1, splits: [{ categoryId: 1, amountCents: -100 }] }), t('Y', '2026-01-03', -1, { categoryId: 1 })];
    expect(suggestCategory(odd, [], 'Y')).toBeNull();
  });
  it('lists payees by how often you use them', () => {
    const all = [t('Coffee', '2026-01-01', -3), t('Coffee', '2026-01-02', -3), t('Gas', '2026-01-03', -30), t('Coffee', '2026-01-04', -3), t('Rent', '2026-01-05', -1000, { transferTxnId: 1 })];
    expect(recentPayees(all)).toEqual(['Coffee', 'Gas']);
  });
});

describe('suggested rules', () => {
  it('suggests payees categorized the same way at least three times, with no rule yet', () => {
    const txns = [
      ...[1, 2, 3, 4].map((d) => t('Shell Oil', `2026-01-0${d}`, -40, { categoryId: 6 })),
      ...[1, 2].map((d) => t('Rare Shop', `2026-01-0${d}`, -10, { categoryId: 1 })),
      ...[1, 2, 3].map((d) => t('Mixed', `2026-02-0${d}`, -10, { categoryId: d === 3 ? 2 : 1 })),
      ...[1, 2, 3].map((d) => t('Covered', `2026-03-0${d}`, -10, { categoryId: 4 })),
    ];
    const s = suggestRules(txns, [rule('covered', 4)]);
    expect(s).toEqual([{ pattern: 'shell oil', categoryId: 6, count: 4 }]);
  });
});

describe('repeating charges', () => {
  const monthly = (payee: string, amt: number, start = '2026-04-05', n = 6, extra: Partial<Txn> = {}) =>
    Array.from({ length: n }, (_, i) => {
      const d = new Date(Date.UTC(2026, 3 + i, Number(start.slice(8, 10))));
      return t(payee, d.toISOString().slice(0, 10), amt, extra);
    });
  const today = '2026-10-17';

  it('finds a monthly charge and predicts the next one', () => {
    const g = detectRecurring(monthly('Netflix', -15.99, '2026-04-05', 7, { categoryId: 3 }), [], today);
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ payee: 'Netflix', frequency: 'monthly', amountCents: -$(15.99), lastDate: '2026-10-05', nextDate: '2026-11-05', count: 7, categoryId: 3, varies: false });
  });
  it('finds weekly and yearly patterns', () => {
    const weekly = Array.from({ length: 5 }, (_, i) => t('Gym', `2026-09-${String(1 + i * 7).padStart(2, '0')}`, -12));
    expect(detectRecurring(weekly, [], today)[0].frequency).toBe('weekly');
    const yearly = [t('Insurance', '2023-11-01', -900), t('Insurance', '2024-11-01', -920), t('Insurance', '2025-11-03', -910)];
    expect(detectRecurring(yearly, [], '2026-10-17')[0]).toMatchObject({ frequency: 'yearly', nextDate: '2026-11-03' });
  });
  it('tolerates a few days of drift and a varying amount', () => {
    const drift = [t('Electric', '2026-05-03', -80), t('Electric', '2026-06-05', -92), t('Electric', '2026-07-02', -75), t('Electric', '2026-08-04', -120), t('Electric', '2026-09-03', -88)];
    const g = detectRecurring(drift, [], today)[0];
    expect(g.frequency).toBe('monthly');
    expect(g.varies).toBe(true);
  });
  it('needs three occurrences, regular spacing, and a consistent sign', () => {
    expect(detectRecurring(monthly('Two', -10, '2026-08-05', 2), [], today)).toEqual([]);
    const random = [t('R', '2026-01-01', -10), t('R', '2026-01-09', -10), t('R', '2026-03-20', -10), t('R', '2026-04-02', -10)];
    expect(detectRecurring(random, [], today)).toEqual([]);
    const refunds = [t('Mixed', '2026-07-05', -10), t('Mixed', '2026-08-05', 10), t('Mixed', '2026-09-05', -10)];
    expect(detectRecurring(refunds, [], today)).toEqual([]);
  });
  it('skips ones that stopped, transfers, and ones already scheduled', () => {
    expect(detectRecurring(monthly('Old', -10, '2026-01-05', 4), [], today)).toEqual([]);
    expect(detectRecurring(monthly('Move', -10, '2026-06-05', 5, { transferTxnId: 1 }), [], today)).toEqual([]);
    const sched: RecurringRule = { accountId: 1, payee: 'Netflix', amountCents: -1599, categoryId: null, memo: '', frequency: 'monthly', startDate: '2026-01-05', active: true };
    expect(detectRecurring(monthly('NETFLIX.COM', -15.99, '2026-04-05', 7), [sched], today)).toEqual([]);
    expect(detectRecurring(monthly('Netflix', -15.99, '2026-04-05', 7), [{ ...sched, active: false }], today)).toHaveLength(1);
  });
  it('turns a guess into a scheduled item starting at the next date', () => {
    const g = detectRecurring(monthly('Netflix', -15.99, '2026-04-05', 7, { categoryId: 3 }), [], today)[0];
    expect(recurringFromGuess(g)).toEqual({ accountId: 1, payee: 'Netflix', amountCents: -$(15.99), categoryId: 3, memo: '', frequency: 'monthly', startDate: '2026-11-05', active: true });
  });
});

describe('rules in the database', () => {
  let d: FinanceDB;
  let n = 0;
  beforeEach(async () => {
    d = new FinanceDB(`rules-${n++}`);
    await d.accounts.add({ name: 'Checking', kind: 'checking', openingBalanceCents: 0, openingDate: '2026-01-01' });
    await d.payeeRules.bulkAdd([{ pattern: 'whole foods', categoryId: 5 }, { pattern: 'amzn', categoryId: 7, rename: 'Amazon' }]);
  });

  it('categorizes existing uncategorized transactions, leaving the rest alone', async () => {
    await d.txns.bulkAdd([
      { accountId: 1, date: '2026-01-01', amountCents: -100, payee: 'WHOLE FOODS #1', memo: '', status: 'cleared', categoryId: null },
      { accountId: 1, date: '2026-01-02', amountCents: -100, payee: 'Whole Foods', memo: '', status: 'cleared', categoryId: 99 },
      { accountId: 1, date: '2026-01-03', amountCents: -100, payee: 'Whole Foods', memo: '', status: 'cleared', categoryId: null, splits: [{ categoryId: 1, amountCents: -100 }] },
      { accountId: 1, date: '2026-01-04', amountCents: -100, payee: 'Whole Foods', memo: '', status: 'cleared', categoryId: null, transferTxnId: 4 },
      { accountId: 1, date: '2026-01-05', amountCents: -100, payee: 'Unknown', memo: '', status: 'cleared', categoryId: null },
    ]);
    expect(await applyRulesToExisting(d)).toBe(1);
    expect((await d.txns.toArray()).map((x) => x.categoryId)).toEqual([5, 99, null, null, null]);
  });

  it('categorizes and renames rows as they are imported', async () => {
    const csv = 'Date,Description,Amount\n2026-02-01,WHOLE FOODS #9,-25.00\n2026-02-02,AMZN Mktp US*2K4,-12.50\n2026-02-03,Mystery,-3.00\n';
    const parsed = (await import('./csvImport')).parseCsv(csv);
    const rows = normalizeRows(parsed.rows, detectMapping(parsed.headers)).rows;
    const classified = await classifyRows(d, 1, rows);
    await commitImport(d, 1, 'x.csv', classified);
    const saved = (await d.txns.toArray()).sort((a, b) => a.date.localeCompare(b.date));
    expect(saved.map((x) => [x.payee, x.categoryId])).toEqual([['WHOLE FOODS #9', 5], ['Amazon', 7], ['Mystery', null]]);
  });

  it('rules survive a backup', async () => {
    const file = await exportAll(d);
    expect(file.version).toBe(13);
    await d.payeeRules.clear();
    await importAll(d, file);
    expect(await d.payeeRules.count()).toBe(2);
  });
});
