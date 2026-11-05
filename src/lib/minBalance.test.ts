import { describe, expect, it } from 'vitest';
import type { Account, Txn } from '../types';
import { computeAlerts, alertPeriod, type AlertInput } from './alerts';
import { belowMinimum, effectiveThreshold, forecastFloor } from './minBalance';
import { runForecast } from './forecast';

const $ = (n: number) => Math.round(n * 100);
const acct = (id: number, kind: Account['kind'], opening: number, min?: number, extra: Partial<Account> = {}): Account => ({ id, name: `Acct ${id}`, kind, openingBalanceCents: $(opening), openingDate: '2026-01-01', minBalanceCents: min === undefined ? undefined : $(min), ...extra });
const txn = (accountId: number, dollars: number): Txn => ({ accountId, date: '2026-11-01', payee: 'x', amountCents: $(dollars) } as Txn);

describe('accounts under their own minimum', () => {
  it('flags only checking or savings under the minimum, using the real balance', () => {
    const accounts = [acct(1, 'checking', 2500, 2000), acct(2, 'savings', 500, 1000), acct(3, 'credit_card', -50, 100), acct(4, 'checking', 10)];
    const out = belowMinimum(accounts, [txn(1, -700), txn(2, 100)]);
    expect(out.map((b) => [b.accountId, b.balanceCents, b.minCents])).toEqual([[1, $(1800), $(2000)], [2, $(600), $(1000)]].sort((a, b) => (b[2] as number) - (b[1] as number) - ((a[2] as number) - (a[1] as number))));
  });
  it('lists the biggest shortfall first', () => {
    const out = belowMinimum([acct(1, 'checking', 1900, 2000), acct(2, 'savings', 100, 5000)], []);
    expect(out.map((b) => b.accountId)).toEqual([2, 1]);
  });
  it('an account exactly at its minimum is fine, and no minimum means no check', () => {
    expect(belowMinimum([acct(1, 'checking', 2000, 2000), acct(2, 'checking', 0)], [])).toEqual([]);
    expect(belowMinimum([acct(1, 'checking', 5, 0)], [])).toEqual([]);
  });
  it('ignores closed accounts and junk minimums', () => {
    expect(belowMinimum([acct(1, 'checking', 0, 2000, { closed: true })], [])).toEqual([]);
    expect(belowMinimum([acct(1, 'checking', 0, -5)], [])).toEqual([]);
  });
});

describe('the forecast warning level', () => {
  const accounts = [acct(1, 'checking', 0, 2000), acct(2, 'savings', 0, 500), acct(3, 'savings', 0, 300, { closed: true })];
  it('is the total of the minimums of the accounts the forecast counts', () => {
    expect(forecastFloor(accounts, true)).toBe($(2500));
    expect(forecastFloor(accounts, false)).toBe($(2000));
  });
  it('falls back to the single level when no minimum is set', () => {
    expect(effectiveThreshold(0, $(1000))).toBe($(1000));
    expect(effectiveThreshold($(2500), $(1000))).toBe($(2500));
  });
  it('a balance between the old level and the minimums now warns', () => {
    const input = { today: '2026-11-04', months: 1, startCents: $(1800), pay: [], scheduled: [], loans: [], taxes: [], oneOffs: [], everydayMonthlyCents: 0, otherIncomeMonthlyCents: 0 };
    expect(runForecast(input, effectiveThreshold(0, $(1000))).firstBelow).toBeNull();
    expect(runForecast(input, effectiveThreshold($(2000), $(1000))).firstBelow).toEqual({ date: '2026-11-04', balanceCents: $(1800) });
  });
});

describe('alerts for a minimum balance', () => {
  const base: AlertInput = { today: '2026-11-04', hasData: true, lastBackup: '2026-11-01T00:00:00Z', scheduledDue: 0, overspent: [], invAccounts: [], holdings: [], securities: [], lots: [], vests: [], people: [] };
  it('adds a warning that names the account, the balance and the minimum', () => {
    const a = computeAlerts({ ...base, belowMinimum: [{ accountId: 7, name: 'Checking', balanceCents: $(1650), minCents: $(2000) }] });
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ id: 'mincash:7', level: 'warn', to: '/account/7' });
    expect(a[0].title).toBe('Checking is $1,650.00, under your $2,000.00 minimum');
    expect(a[0].detail).toContain('$350.00');
  });
  it('shows nothing when no account is under its minimum', () => {
    expect(computeAlerts({ ...base, belowMinimum: [] })).toEqual([]);
    expect(computeAlerts(base)).toEqual([]);
  });
});

describe('alert periods (so a dismissed alert returns when the situation changes)', () => {
  const base: AlertInput = { today: '2026-11-04', hasData: true, scheduledDue: 2, overspent: ['Dining'], invAccounts: [], holdings: [], securities: [], lots: [], vests: [], people: [] };
  it('monthly alerts change with the month, the cash dip with its date, scheduled with the day', () => {
    expect(alertPeriod('backup', base)).toBe('2026-11');
    expect(alertPeriod('backup', { ...base, today: '2026-12-01' })).toBe('2026-12');
    expect(alertPeriod('scheduled', base)).toBe('2026-11-04');
    expect(alertPeriod('forecast', { ...base, forecastLow: { date: '2026-11-20', balanceCents: 0, thresholdCents: 1 } })).toBe('2026-11-20');
    expect(alertPeriod('forecast', { ...base, forecastLow: { date: '2026-12-02', balanceCents: 0, thresholdCents: 1 } })).toBe('2026-12-02');
  });
  it('overspent returns when a different category goes over', () => {
    expect(alertPeriod('overspent', base)).not.toBe(alertPeriod('overspent', { ...base, overspent: ['Dining', 'Gas'] }));
  });
  it('every alert computeAlerts returns carries a period', () => {
    const a = computeAlerts({ ...base, lastBackup: undefined });
    expect(a.length).toBeGreaterThan(1);
    expect(a.every((x) => typeof x.period === 'string' && x.period.length > 0)).toBe(true);
  });
});
