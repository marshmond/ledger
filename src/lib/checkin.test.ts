import { describe, expect, it } from 'vitest';
import { buildCheckin, progress, streak, withMarks, type CheckinInput } from './checkin';

const $ = (n: number) => Math.round(n * 100);
const clean: CheckinInput = {
  today: '2026-10-28', dueScheduled: 0, uncategorized: 0, pendingOld: 0, overspentCategories: 0, readyToAssignCents: 0, targetsCount: 0, targetsNeedCents: 0,
  holdings: 0, noPriceCount: 0, oldestPriceDays: null, propertyCount: 0, propertyStale: 0, forecastBelow: null, hasCashAccounts: true, lastBackup: '2026-10-20T10:00:00Z', hasData: true,
};
const by = (i: CheckinInput) => Object.fromEntries(buildCheckin(i).map((s) => [s.id, s]));

describe('check-in steps', () => {
  it('a tidy month leaves only the step you tick yourself', () => {
    const s = buildCheckin(clean);
    expect(s.filter((x) => x.status === 'todo').map((x) => x.id)).toEqual(['reconcile']);
    expect(s.filter((x) => x.status === 'na').map((x) => x.id)).toEqual(['targets', 'prices', 'property']);
    expect(s.find((x) => x.id === 'reconcile')!.manual).toBe(true);
  });
  it('scheduled items, categorizing, and pending items', () => {
    const s = by({ ...clean, dueScheduled: 3, uncategorized: 1, pendingOld: 2 });
    expect(s.scheduled).toMatchObject({ status: 'todo', detail: '3 scheduled items due. Approving posts it to your ledger.' });
    expect(s.categorize.detail).toBe('1 transaction still uncategorized. Rules can do this for you.');
    expect(s.pending.status).toBe('todo');
  });
  it('the budget step wants no overspending, no negative Ready to Assign, and little left unassigned', () => {
    expect(by(clean).budget.status).toBe('done');
    expect(by({ ...clean, readyToAssignCents: $(30) }).budget.status).toBe('done');
    expect(by({ ...clean, readyToAssignCents: $(500) }).budget).toMatchObject({ status: 'todo', detail: '$500.00 is unassigned.' });
    expect(by({ ...clean, readyToAssignCents: -$(20) }).budget.status).toBe('todo');
    expect(by({ ...clean, overspentCategories: 2 }).budget.detail).toBe('2 categories overspent.');
  });
  it('targets apply only when you have them', () => {
    expect(by({ ...clean, targetsCount: 2, targetsNeedCents: 0 }).targets.status).toBe('done');
    expect(by({ ...clean, targetsCount: 2, targetsNeedCents: $(150) }).targets).toMatchObject({ status: 'todo', detail: '$150.00 still needed this month to stay on track.' });
  });
  it('prices: missing or older than ten days', () => {
    expect(by({ ...clean, holdings: 3, oldestPriceDays: 3 }).prices.status).toBe('done');
    expect(by({ ...clean, holdings: 3, oldestPriceDays: 11 }).prices).toMatchObject({ status: 'todo', detail: 'Prices are 11 days old.' });
    expect(by({ ...clean, holdings: 3, noPriceCount: 1, oldestPriceDays: 1 }).prices.detail).toBe('1 holding with no price.');
  });
  it('property, forecast, and backup', () => {
    expect(by({ ...clean, propertyCount: 1, propertyStale: 1 }).property.status).toBe('todo');
    expect(by({ ...clean, propertyCount: 1 }).property.status).toBe('done');
    expect(by({ ...clean, forecastBelow: { date: '2026-12-02' } }).forecast.detail).toMatch(/2026-12-02/);
    expect(by({ ...clean, hasCashAccounts: false }).forecast.status).toBe('na');
    expect(by({ ...clean, lastBackup: '2026-08-01T00:00:00Z' }).backup).toMatchObject({ status: 'todo', detail: 'Last backup was 88 days ago.' });
    expect(by({ ...clean, lastBackup: undefined }).backup.detail).toBe('No backup yet.');
    expect(by({ ...clean, hasData: false, lastBackup: undefined }).backup.status).toBe('na');
    expect(by(clean).backup.detail).toBe('Last backup 8 days ago.');
  });
});

describe('your own ticks and progress', () => {
  it('a tick finishes a todo step and never changes one that is already done or not applicable', () => {
    const steps = withMarks(buildCheckin({ ...clean, dueScheduled: 2 }), { reconcile: true, scheduled: true, targets: true });
    const m = Object.fromEntries(steps.map((s) => [s.id, s]));
    expect(m.reconcile).toMatchObject({ status: 'done', detail: 'You checked this off.' });
    expect(m.scheduled.status).toBe('done');
    expect(m.scheduled.detail).toMatch(/checked off by you/);
    expect(m.targets.status).toBe('na');
  });
  it('counts steps that apply', () => {
    expect(progress(buildCheckin(clean))).toEqual({ done: 6, total: 7, left: 1, complete: false });
    const all = withMarks(buildCheckin(clean), { reconcile: true });
    expect(progress(all)).toEqual({ done: 7, total: 7, left: 0, complete: true });
    expect(progress([])).toEqual({ done: 0, total: 0, left: 0, complete: false });
  });
});

describe('streak', () => {
  it('counts months in a row, ending now or last month', () => {
    expect(streak(['2026-08', '2026-09', '2026-10'], '2026-10')).toBe(3);
    expect(streak(['2026-08', '2026-09'], '2026-10')).toBe(2); // this month not done yet
    expect(streak(['2026-07', '2026-09', '2026-10'], '2026-10')).toBe(2);
    expect(streak(['2025-11', '2025-12', '2026-01'], '2026-01')).toBe(3);
    expect(streak([], '2026-10')).toBe(0);
    expect(streak(['2026-06'], '2026-10')).toBe(0);
  });
});
