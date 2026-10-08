import { describe, expect, it } from 'vitest';
import { TAX_2026 } from '../data/taxYears';
import { buildIncomeModel, newProfile, parseTablesJson, resolveTables, rollForward } from './income';
import { FinanceDB } from '../db';
import { exportAll, importAll } from './backup';

describe('tax table resolution', () => {
  it('uses built-in tables for 2026, and none (never a guess) for years without tables', () => {
    expect(resolveTables(2026).source).toBe('built-in');
    const r = resolveTables(2027);
    expect(r.tables).toBeNull();
    expect(r.source).toBe('none');
  });

  it('computes nothing for a year without tables', () => {
    const p = { ...newProfile(1, 2027), salary: [{ effectiveDate: '2027-01-01', annualCents: 10000000 }] };
    const m = buildIncomeModel(2027, [{ id: 1, name: 'A' }], [p], []);
    expect(m.tableSource).toBe('none');
    expect(m.years).toEqual([]);
    expect(m.household).toBeNull();
  });

  it('accepts an edited copy for a new year and validates it', () => {
    const text = JSON.stringify({ ...TAX_2026, year: 2027, ssWageBase: 19000000 });
    const ok = parseTablesJson(text, 2027);
    expect(ok.tables?.ssWageBase).toBe(19000000);
    expect(parseTablesJson(text, 2026).error).toContain('2026');
    expect(parseTablesJson('{nope', 2027).error).toBeTruthy();
    expect(parseTablesJson(JSON.stringify({ year: 2027 }), 2027).error).toBeTruthy();

    const r = resolveTables(2027, { year: 2027, itemizedDeductionCents: 0, otherIncomeCents: 0, federalCreditsCents: 0, maDependents: 0, maCreditsCents: 0, tablesOverride: text });
    expect(r.source).toBe('custom');
  });

  it('an invalid saved override falls back to built-in, not to nothing silently wrong', () => {
    const r = resolveTables(2026, { year: 2026, itemizedDeductionCents: 0, otherIncomeCents: 0, federalCreditsCents: 0, maDependents: 0, maCreditsCents: 0, tablesOverride: '{broken' });
    expect(r.source).toBe('built-in');
  });
});

describe('rollForward', () => {
  it('moves dates to the new year and keeps the latest salary', () => {
    const p = {
      ...newProfile(1, 2026),
      firstPayDate: '2026-03-13',
      salary: [
        { effectiveDate: '2026-01-01', annualCents: 10000000 },
        { effectiveDate: '2026-07-01', annualCents: 11000000 },
      ],
      id: 7,
    };
    const n = rollForward(p, 2027);
    expect(n.year).toBe(2027);
    expect(n.id).toBeUndefined();
    expect(n.firstPayDate).toBe('2027-03-13');
    expect(n.salary).toEqual([{ effectiveDate: '2027-01-01', annualCents: 11000000 }]);
  });
});

describe('backup includes income data', () => {
  it('round-trips people, profiles, bonuses and settings; old backups still restore', async () => {
    const d = new FinanceDB('inc-backup-1');
    const pid = await d.people.add({ name: 'A', birthYear: 1985 });
    await d.incomeProfiles.add(newProfile(pid, 2026));
    await d.bonuses.add({ personId: pid, year: 2026, month: 3, grossCents: 100000, label: 'b' });
    await d.taxSettings.add({ year: 2026, itemizedDeductionCents: 0, otherIncomeCents: 5, federalCreditsCents: 0, maDependents: 1, maCreditsCents: 0 });
    const data = JSON.parse(JSON.stringify(await exportAll(d)));

    const d2 = new FinanceDB('inc-backup-2');
    await importAll(d2, data);
    expect(await d2.people.count()).toBe(1);
    expect(await d2.incomeProfiles.count()).toBe(1);
    expect(await d2.bonuses.count()).toBe(1);
    expect((await d2.taxSettings.toArray())[0].maDependents).toBe(1);

    const old = { version: 1 as const, exportedAt: '', accounts: [], categoryGroups: [], categories: [], txns: [], importBatches: [] };
    await importAll(d2, old);
    expect(await d2.people.count()).toBe(0);
  });
});
