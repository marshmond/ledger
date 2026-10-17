import { beforeEach, describe, expect, it } from 'vitest';
import { FinanceDB } from '../db';
import { exportAll, importAll } from './backup';
import { computeNetWorth } from './netWorth';
import { loadNetWorth, loanOwedById } from './netWorthLive';
import { equityOf, latestValue, propertyTotal, valueAgeDays } from './property';
import { changeOver, saveMonthlySnapshot, snapshotNow } from './snapshots';
import type { Property, PropertyValue } from '../types';

const $ = (n: number) => Math.round(n * 100);
const pv = (propertyId: number, date: string, v: number, id?: number): PropertyValue => ({ id, propertyId, date, valueCents: $(v), note: '' });

describe('property values', () => {
  const values = [pv(1, '2024-01-01', 400000, 1), pv(1, '2025-06-01', 450000, 2), pv(1, '2026-03-01', 480000, 3), pv(2, '2026-01-01', 20000, 4)];
  it('uses the latest value on or before the date', () => {
    expect(latestValue(values, 1)).toEqual({ valueCents: $(480000), date: '2026-03-01' });
    expect(latestValue(values, 1, '2025-12-31')?.valueCents).toBe($(450000));
    expect(latestValue(values, 1, '2023-12-31')).toBeNull();
    expect(latestValue(values, 9)).toBeNull();
  });
  it('totals the properties that are counted', () => {
    const props: Property[] = [{ id: 1, name: 'Home', kind: 'home', loanIds: [] }, { id: 2, name: 'Car', kind: 'vehicle', loanIds: [] }];
    expect(propertyTotal(props, values)).toBe($(500000));
    expect(propertyTotal([props[0], { ...props[1], excluded: true }], values)).toBe($(480000));
    expect(propertyTotal(props, values, '2025-01-01')).toBe($(400000));
  });
  it('equity is value less the loans secured by it', () => {
    const home: Property = { id: 1, name: 'Home', kind: 'home', loanIds: [7, 8] };
    const e = equityOf(home, values, new Map([[7, $(250000)], [8, $(40000)], [9, $(1)]]));
    expect(e).toEqual({ valueCents: $(480000), owedCents: $(290000), equityCents: $(190000) });
    expect(equityOf({ ...home, id: 5 }, values, new Map())).toBeNull();
  });
  it('knows how old a value is', () => {
    expect(valueAgeDays(values, 1, '2026-10-17')).toBe(230);
    expect(valueAgeDays(values, 9, '2026-10-17')).toBeNull();
  });
});

describe('net worth with property', () => {
  it('adds property and still subtracts loans', () => {
    const accounts = [{ id: 1, name: 'c', kind: 'checking' as const, openingBalanceCents: $(1000), openingDate: '2026-01-01' }];
    const n = computeNetWorth(accounts, [], $(5000), [{ owedCents: $(200000) }], $(450000));
    expect(n.property).toBe($(450000));
    expect(n.total).toBe($(1000) + $(5000) + $(450000) - $(200000));
  });
});

describe('net worth history', () => {
  let d: FinanceDB;
  let n = 0;
  beforeEach(async () => {
    d = new FinanceDB(`nw-${n++}`);
    await d.accounts.add({ name: 'Checking', kind: 'checking', openingBalanceCents: $(2000), openingDate: '2026-01-01' });
  });

  it('loads from the database, including property and loans', async () => {
    const pid = await d.properties.add({ name: 'Home', kind: 'home', loanIds: [] });
    await d.propertyValues.add(pv(pid, '2026-05-01', 300000));
    await d.loans.add({ name: 'Mortgage', kind: 'mortgage', setup: 'current', balanceCents: $(200000), asOfDate: '2026-10-01', nextPaymentDate: '2026-11-01', remainingMonths: 300, annualRatePct: 6, extraMode: 'shorten' });
    const nw = await loadNetWorth(d, '2026-10-17');
    expect(nw.cash).toBe($(2000));
    expect(nw.property).toBe($(300000));
    expect(nw.loans).toBeLessThan(-$(190000));
    expect(nw.loans).toBeGreaterThan(-$(210000));
    expect(nw.total).toBe(nw.cash + nw.property + nw.loans);
    const owed = await loanOwedById(d, '2026-10-17');
    expect([...owed.values()][0]).toBe(-nw.loans);
  });

  it('keeps one point a month and updates it as the month goes on', async () => {
    const nw = await loadNetWorth(d, '2026-10-03');
    expect(await saveMonthlySnapshot(d, '2026-10-03', nw)).toBe('created');
    await d.accounts.add({ name: 'Savings', kind: 'savings', openingBalanceCents: $(1000), openingDate: '2026-01-01' });
    expect(await snapshotNow(d, '2026-10-20')).toBe('updated');
    const all = await d.netWorthSnapshots.toArray();
    expect(all).toHaveLength(1);
    expect(all[0].date).toBe('2026-10-20');
    expect(all[0].totalCents).toBe($(3000));
    expect(await snapshotNow(d, '2026-11-02')).toBe('created');
    expect(await d.netWorthSnapshots.count()).toBe(2);
  });

  it('does not save an empty app', async () => {
    const empty = new FinanceDB(`nw-empty-${n++}`);
    expect(await snapshotNow(empty, '2026-10-17')).toBe('skipped');
    expect(await empty.netWorthSnapshots.count()).toBe(0);
  });

  it('reports the change over the last year', () => {
    const snap = (date: string, total: number) => ({ date, cashCents: 0, investmentsCents: 0, propertyCents: 0, cardsCents: 0, loansCents: 0, totalCents: $(total) });
    expect(changeOver([snap('2026-01-01', 1)])).toBeNull();
    const c = changeOver([snap('2025-09-01', 100), snap('2025-11-01', 120), snap('2026-10-01', 150)])!;
    expect(c).toEqual({ total: $(150), sinceCents: $(50), since: '2025-09-01' });
    expect(changeOver([snap('2026-05-01', 100), snap('2026-10-01', 130)])!.since).toBe('2026-05-01');
  });

  it('property and history survive a backup', async () => {
    const pid = await d.properties.add({ name: 'Home', kind: 'home', loanIds: [] });
    await d.propertyValues.add(pv(pid, '2026-05-01', 300000));
    await snapshotNow(d, '2026-10-17');
    const file = await exportAll(d);
    expect(file.version).toBe(12);
    await Promise.all([d.properties.clear(), d.propertyValues.clear(), d.netWorthSnapshots.clear()]);
    await importAll(d, file);
    expect(await d.properties.count()).toBe(1);
    expect(await d.propertyValues.count()).toBe(1);
    expect(await d.netWorthSnapshots.count()).toBe(1);
  });
});
