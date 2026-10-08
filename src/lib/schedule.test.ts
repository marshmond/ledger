import { beforeEach, describe, expect, it } from 'vitest';
import { FinanceDB } from '../db';
import { deleteRule, dueInstances, occurrencesBetween, postInstance, skipInstance } from './schedule';
import { accountBalance } from './ledger';
import type { RecurringRule } from '../types';

const rule = (p: Partial<RecurringRule>): RecurringRule => ({
  id: 1,
  accountId: 1,
  payee: 'x',
  amountCents: -1000,
  categoryId: null,
  memo: '',
  frequency: 'monthly',
  startDate: '2026-01-15',
  active: true,
  ...p,
});

describe('occurrences', () => {
  it('monthly keeps the anchor day and clamps to short months', () => {
    expect(occurrencesBetween(rule({ startDate: '2026-01-31' }), '2026-01-01', '2026-04-30')).toEqual([
      '2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30',
    ]);
  });

  it('semimonthly defaults to 1st and 15th and supports last-day', () => {
    expect(occurrencesBetween(rule({ frequency: 'semimonthly', startDate: '2026-01-01' }), '2026-01-01', '2026-02-28')).toEqual([
      '2026-01-01', '2026-01-15', '2026-02-01', '2026-02-15',
    ]);
    expect(
      occurrencesBetween(rule({ frequency: 'semimonthly', startDate: '2026-01-01', semiDays: [15, 31] }), '2026-02-01', '2026-03-31'),
    ).toEqual(['2026-02-15', '2026-02-28', '2026-03-15', '2026-03-31']);
  });

  it('semimonthly does not emit days before the start date', () => {
    expect(occurrencesBetween(rule({ frequency: 'semimonthly', startDate: '2026-01-10' }), '2026-01-01', '2026-01-31')).toEqual([
      '2026-01-15',
    ]);
  });

  it('weekly, biweekly, quarterly, yearly', () => {
    expect(occurrencesBetween(rule({ frequency: 'weekly', startDate: '2026-01-05' }), '2026-01-01', '2026-01-26')).toHaveLength(4);
    expect(occurrencesBetween(rule({ frequency: 'biweekly', startDate: '2026-01-05' }), '2026-01-01', '2026-02-28')).toEqual([
      '2026-01-05', '2026-01-19', '2026-02-02', '2026-02-16',
    ]);
    expect(occurrencesBetween(rule({ frequency: 'quarterly', startDate: '2026-01-15' }), '2026-01-01', '2026-12-31')).toHaveLength(4);
    expect(occurrencesBetween(rule({ frequency: 'yearly', startDate: '2026-03-01' }), '2026-01-01', '2028-12-31')).toEqual([
      '2026-03-01', '2027-03-01', '2028-03-01',
    ]);
  });

  it('respects end date and window', () => {
    expect(occurrencesBetween(rule({ endDate: '2026-02-20' }), '2026-01-01', '2026-12-31')).toEqual(['2026-01-15', '2026-02-15']);
    expect(occurrencesBetween(rule({}), '2026-02-01', '2026-03-31')).toEqual(['2026-02-15', '2026-03-15']);
  });
});

describe('due and posting', () => {
  let d: FinanceDB;
  let n = 0;
  beforeEach(async () => {
    d = new FinanceDB(`sched-${n++}`);
    await d.accounts.add({ name: 'Checking', kind: 'checking', openingBalanceCents: 100000, openingDate: '2026-01-01' });
    await d.accounts.add({ name: 'Card', kind: 'credit_card', openingBalanceCents: -20000, openingDate: '2026-01-01' });
  });

  it('lists due items within lookahead, and posting/skipping removes them', async () => {
    const id = await d.recurring.add({ ...rule({ id: undefined }), startDate: '2026-02-01', payee: 'Rent' });
    const r = (await d.recurring.get(id))!;
    let due = await dueInstances(d, '2026-02-10', 7);
    expect(due.map((x) => x.date)).toEqual(['2026-02-01']);

    const txnId = await postInstance(d, r, '2026-02-01', { amountCents: -123456, date: '2026-02-02' });
    const t = await d.txns.get(txnId);
    expect(t).toMatchObject({ amountCents: -123456, date: '2026-02-02', status: 'pending', recurringId: id });

    due = await dueInstances(d, '2026-03-05', 7);
    expect(due.map((x) => x.date)).toEqual(['2026-03-01']); // Feb handled; edited date doesn't resurrect it
    await skipInstance(d, r, '2026-03-01');
    expect(await dueInstances(d, '2026-03-05', 7)).toEqual([]);
  });

  it('a recurring card payment posts as a linked transfer', async () => {
    const id = await d.recurring.add({ ...rule({ id: undefined }), startDate: '2026-02-05', amountCents: -5000, transferAccountId: 2, payee: 'Card payment' });
    const r = (await d.recurring.get(id))!;
    await postInstance(d, r, '2026-02-05');
    expect(await accountBalance(d, 1)).toBe(95000);
    expect(await accountBalance(d, 2)).toBe(-15000);
    const [a, b] = await d.txns.toArray();
    expect(a.transferTxnId).toBe(b.id);
    expect(a.recurringId).toBe(id);
  });

  it('ignores paused rules and cleans up on delete', async () => {
    const id = await d.recurring.add({ ...rule({ id: undefined }), startDate: '2026-02-01', active: false });
    expect(await dueInstances(d, '2026-02-10')).toEqual([]);
    await deleteRule(d, id);
    expect(await d.recurring.count()).toBe(0);
  });
});
