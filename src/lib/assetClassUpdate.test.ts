import { describe, expect, it } from 'vitest';
import { FinanceDB, seedAssetClassesIfEmpty } from '../db';
import { ASSET_UPDATE_KEY, EMERGING_ID, HIGH_YIELD_ID, OLD_TO_NEW, SMALL_CAP_ID, updateAssetClasses } from './assetClassUpdate';

const OLD_DEFAULTS = [
  { name: 'US stocks', kind: 'equity', expectedReturnPct: 7, volatilityPct: 16 },
  { name: 'International stocks', kind: 'equity', expectedReturnPct: 7, volatilityPct: 18 },
  { name: 'Bonds', kind: 'bond', expectedReturnPct: 4, volatilityPct: 6 },
  { name: 'Real estate (REITs)', kind: 'real_estate', expectedReturnPct: 6.5, volatilityPct: 17 },
  { name: 'Balanced / target-date', kind: 'balanced', expectedReturnPct: 6, volatilityPct: 11 },
  { name: 'Cash', kind: 'cash', expectedReturnPct: 3, volatilityPct: 1 },
  { name: 'Other', kind: 'other', expectedReturnPct: 5, volatilityPct: 15 },
] as const;

const byName = async (d: FinanceDB) => new Map((await d.assetClasses.toArray()).map((c) => [c.name, c]));

describe('asset class update', () => {
  it('a fresh install is seeded with the new table (once), and the update changes nothing', async () => {
    const d = new FinanceDB('ac-fresh');
    await seedAssetClassesIfEmpty(d);
    await seedAssetClassesIfEmpty(d);
    const rows = await d.assetClasses.toArray();
    expect(rows.map((r) => r.name).sort()).toEqual([
      'Balanced / target-date', 'Cash', 'Emerging markets (MSCI EM)', 'High-yield bonds (BofA HY)', 'Intl developed (MSCI EAFE)', 'Other',
      'US aggregate bonds (Bloomberg US Agg)', 'US large cap (S&P 500)', 'US REITs (FTSE Nareit All Equity)', 'US small cap (Russell 2000)',
    ].sort());
    expect(new Set(rows.map((r) => r.id)).size).toBe(10);
    const before = JSON.stringify(rows);
    await updateAssetClasses(d);
    expect(JSON.stringify(await d.assetClasses.toArray())).toBe(before);
  });

  it('the figures are the compound returns and volatilities supplied', async () => {
    const d = new FinanceDB('ac-figures');
    await seedAssetClassesIfEmpty(d);
    const m = await byName(d);
    const want: [string, number, number][] = [
      ['US large cap (S&P 500)', 8.82, 17.92], ['US small cap (Russell 2000)', 8.21, 18.73], ['Intl developed (MSCI EAFE)', 5.85, 19.71],
      ['Emerging markets (MSCI EM)', 8.87, 27.69], ['US REITs (FTSE Nareit All Equity)', 9, 19.37],
      ['US aggregate bonds (Bloomberg US Agg)', 3.72, 4.72], ['High-yield bonds (BofA HY)', 7.03, 14.71],
    ];
    for (const [name, ret, vol] of want) {
      expect(m.get(name)?.expectedReturnPct).toBe(ret);
      expect(m.get(name)?.volatilityPct).toBe(vol);
    }
  });

  it('existing untouched classes are renamed and updated in place (holdings keep pointing at them); three are added; the rest stay', async () => {
    const d = new FinanceDB('ac-migrate');
    const ids = await d.assetClasses.bulkAdd(OLD_DEFAULTS.map((c) => ({ ...c })), { allKeys: true });
    await d.securities.add({ ticker: 'VTI', name: 'Total market', assetClassId: ids[0], priceCents: null, priceDate: null, priceSource: null });
    await updateAssetClasses(d);
    const rows = await d.assetClasses.toArray();
    expect(rows).toHaveLength(10);
    expect((await d.assetClasses.get(ids[0]))?.name).toBe('US large cap (S&P 500)');
    expect((await d.assetClasses.get(ids[0]))?.expectedReturnPct).toBe(8.82);
    expect((await d.securities.toArray())[0].assetClassId).toBe(ids[0]);
    for (const id of [SMALL_CAP_ID, EMERGING_ID, HIGH_YIELD_ID]) expect(await d.assetClasses.get(id)).toBeTruthy();
    const m = await byName(d);
    for (const kept of ['Balanced / target-date', 'Cash', 'Other']) {
      const old = OLD_DEFAULTS.find((o) => o.name === kept)!;
      expect(m.get(kept)).toMatchObject({ expectedReturnPct: old.expectedReturnPct, volatilityPct: old.volatilityPct });
    }
    expect((await d.settings.get(ASSET_UPDATE_KEY))?.value).toBe(true);
  });

  it('a class you already edited is left exactly as you set it', async () => {
    const d = new FinanceDB('ac-edited');
    const rows = OLD_DEFAULTS.map((c) => (c.name === 'US stocks' ? { ...c, expectedReturnPct: 9.5 } : { ...c }));
    const ids = await d.assetClasses.bulkAdd(rows, { allKeys: true });
    await updateAssetClasses(d);
    expect(await d.assetClasses.get(ids[0])).toMatchObject({ name: 'US stocks', expectedReturnPct: 9.5, volatilityPct: 16 });
    expect((await d.assetClasses.get(ids[1]))?.name).toBe('Intl developed (MSCI EAFE)'); // the others still update
  });

  it('runs once: a class you delete afterwards does not come back, and a later edit is not overwritten', async () => {
    const d = new FinanceDB('ac-once');
    await d.assetClasses.bulkAdd(OLD_DEFAULTS.map((c) => ({ ...c })));
    await updateAssetClasses(d);
    await d.assetClasses.delete(EMERGING_ID);
    await d.assetClasses.update(SMALL_CAP_ID, { expectedReturnPct: 6 });
    await updateAssetClasses(d);
    expect(await d.assetClasses.get(EMERGING_ID)).toBeUndefined();
    expect((await d.assetClasses.get(SMALL_CAP_ID))?.expectedReturnPct).toBe(6);
    expect(await d.assetClasses.count()).toBe(9);
  });

  it('does nothing (and does not mark itself done) while there are no classes yet', async () => {
    const d = new FinanceDB('ac-empty');
    await updateAssetClasses(d);
    expect(await d.assetClasses.count()).toBe(0);
    expect(await d.settings.get(ASSET_UPDATE_KEY)).toBeUndefined();
  });

  it('a class that already has a new name is not duplicated', async () => {
    const d = new FinanceDB('ac-dup');
    await d.assetClasses.bulkAdd([{ name: 'Emerging markets (MSCI EM)', kind: 'equity', expectedReturnPct: 10, volatilityPct: 25 }]);
    await updateAssetClasses(d);
    expect((await d.assetClasses.toArray()).filter((c) => c.name === 'Emerging markets (MSCI EM)')).toHaveLength(1);
  });

  it('every mapped class keeps its kind', () => {
    for (const m of OLD_TO_NEW) expect(m.next.kind).toBe(m.old.kind);
  });
});
