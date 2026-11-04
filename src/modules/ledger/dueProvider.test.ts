import { describe, expect, it } from 'vitest';
import { FinanceDB } from '../../db';
import { saveCalendarSettings } from '../../core/calendarSettings';
import { dueInstances, deleteRule, skipInstance } from '../../lib/schedule';
import type { RecurringRule } from '../../types';
import { ledgerDueItems, financePriority } from './dueProvider';

let n = 0;
const fresh = () => new FinanceDB(`test-ledger-provider-${n++}`);
const TODAY = '2026-11-04';
const Q = { from: '2026-11-01', to: '2026-12-31', today: TODAY, overdueDays: 0 };

const bills = async (d: FinanceDB, q: Parameters<typeof ledgerDueItems>[1]) => (await ledgerDueItems(d, q)).filter((i) => String(i.sourceRecordId).startsWith('scheduled:'));

async function rule(d: FinanceDB, over: Partial<RecurringRule> = {}) {
  const accountId = (await d.accounts.add({ name: 'Test checking', kind: 'checking', openingBalanceCents: 0, openingDate: '2026-01-01' } as never)) as number;
  const id = (await d.recurring.add({
    accountId, payee: 'Test landlord', amountCents: -150000, categoryId: null, memo: '', frequency: 'monthly', startDate: '2026-10-01', active: true, ...over,
  } as RecurringRule)) as number;
  return { id, accountId };
}

describe('Ledger due provider', () => {
  it('shows the same scheduled dates as the Scheduled page logic, all-day, with the existing export ids', async () => {
    const d = fresh();
    const { id } = await rule(d, { startDate: '2026-11-15' });
    const items = await bills(d, Q);
    const same = (await dueInstances(d, TODAY, 60)).map((x) => x.date);
    expect(items.map((i) => i.date)).toEqual(same.filter((x) => x >= Q.from && x <= Q.to));
    expect(items[0]).toMatchObject({ allDay: true, status: 'open', sourceModule: 'ledger', sourceRecordId: `scheduled:${id}`, title: 'Test landlord $1,500.00' });
    expect(items[0].id).toBe(`ledger:scheduled-${id}:2026-11-15`);
    expect(items[0].icsUid).toBe(`bill-${id}-2026-11-15@ledger.local`);
    expect(items.every((i) => i.time === undefined)).toBe(true);
  });

  it('only unhandled occurrences: skipped ones disappear, and deleting the rule removes the rest', async () => {
    const d = fresh();
    const { id } = await rule(d, { startDate: '2026-11-15' });
    expect((await bills(d, Q)).map((i) => i.date)).toEqual(['2026-11-15', '2026-12-15']);
    const r = (await d.recurring.get(id))!;
    await skipInstance(d, r, '2026-11-15');
    expect((await bills(d, Q)).map((i) => i.date)).toEqual(['2026-12-15']);
    await deleteRule(d, id);
    expect(await bills(d, Q)).toEqual([]);
  });

  it('an inactive or ended rule contributes nothing past its end', async () => {
    const d = fresh();
    await rule(d, { startDate: '2026-11-15', endDate: '2026-11-30' });
    expect((await bills(d, Q)).map((i) => i.date)).toEqual(['2026-11-15']);
    const d2 = fresh();
    await rule(d2, { startDate: '2026-11-15', active: false });
    expect(await bills(d2, Q)).toEqual([]);
  });

  it('old unhandled items drop out after the overdue window (30 days by default); newer ones stay and are high priority', async () => {
    const d = fresh();
    await rule(d, { startDate: '2026-09-01' }); // Sep 1 and Oct 1 are old; Nov 1 is 3 days late
    const wide = { from: '2026-08-01', to: '2026-12-31', today: TODAY, overdueDays: 0 };
    const got = await bills(d, wide);
    expect(got.map((i) => i.date)).toEqual(['2026-11-01', '2026-12-01']); // Oct 1 is 34 days old
    expect(got[0].priority).toBe('high'); // overdue
    expect(got[1].priority).toBe('medium'); // 27 days away
    await saveCalendarSettings({ overdueDays: 60 }, d);
    expect((await bills(d, wide)).map((i) => i.date)).toEqual(['2026-10-01', '2026-11-01', '2026-12-01']);
  });

  it('overdue items outside the visible range come back when the Agenda asks for them', async () => {
    const d = fresh();
    await rule(d, { startDate: '2026-10-20' });
    const agenda = { from: '2026-11-04', to: '2026-11-30', today: TODAY, overdueDays: 30 };
    expect((await bills(d, agenda)).map((i) => i.date)).toEqual(['2026-10-20', '2026-11-20']);
    expect((await bills(d, { ...agenda, overdueDays: 0 })).map((i) => i.date)).toEqual(['2026-11-20']);
  });

  it('income and transfers are low priority; bills are medium, high within 3 days; class priorities are editable', async () => {
    const d = fresh();
    const { id } = await rule(d, { startDate: '2026-11-06', payee: 'Test bill' }); // 2 days away
    await rule(d, { startDate: '2026-11-20', amountCents: 300000, payee: 'Test pay' });
    const got = await ledgerDueItems(d, Q);
    expect(got.find((i) => i.title.startsWith('Test bill') && i.date === '2026-11-06')!.priority).toBe('high');
    expect(got.find((i) => i.title.startsWith('Test bill') && i.date === '2026-12-06')!.priority).toBe('medium');
    expect(got.find((i) => i.title.startsWith('Test pay'))!.priority).toBe('low');
    await saveCalendarSettings({ financePriorities: { bill: 'low', income: 'low', vest: 'reminder', tax: 'high', rmd: 'high', milestone: 'reminder', loan: 'medium' } }, d);
    expect((await ledgerDueItems(d, Q)).find((i) => i.title.startsWith('Test bill') && i.date === '2026-11-06')!.priority).toBe('low');
    expect(id).toBeGreaterThan(0);
  });

  it('priority escalation rule on its own', () => {
    expect(financePriority('bill', '2026-11-07', TODAY, 'medium')).toBe('high');
    expect(financePriority('bill', '2026-11-08', TODAY, 'medium')).toBe('medium');
    expect(financePriority('loan', '2026-11-01', TODAY, 'medium')).toBe('high');
    expect(financePriority('vest', '2026-11-05', TODAY, 'reminder')).toBe('reminder');
    expect(financePriority('tax', '2026-12-31', TODAY, 'high')).toBe('high');
  });

  it('a transfer rule counts as income/transfer (low), even though one side is negative', async () => {
    const d = fresh();
    const { accountId } = await rule(d, { startDate: '2026-12-20' });
    const other = (await d.accounts.add({ name: 'Test savings', kind: 'savings', openingBalanceCents: 0, openingDate: '2026-01-01' } as never)) as number;
    await d.recurring.add({ accountId, transferAccountId: other, payee: 'Test move', amountCents: -50000, categoryId: null, memo: '', frequency: 'monthly', startDate: '2026-12-10', active: true } as RecurringRule);
    expect((await ledgerDueItems(d, Q)).find((i) => i.title.startsWith('Test move'))!.priority).toBe('low');
  });
});

describe('Ledger due provider: the other dated items', () => {
  it('includes the year-end tax reminder from Home’s Coming up as a high-priority all-day item', async () => {
    const d = fresh();
    const got = await ledgerDueItems(d, Q);
    const ye = got.find((i) => i.sourceRecordId === 'ye-2026');
    expect(ye).toMatchObject({ date: '2026-12-31', allDay: true, priority: 'high', icsUid: 'ye-2026@ledger.local' });
    expect(ye!.id).toBe('ledger:ye-2026:2026-12-31');
  });
});
