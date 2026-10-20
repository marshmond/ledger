import type { FinanceDB } from '../db';
import type { AssetClass } from '../types';

/**
 * Asset class assumptions (October 2026 update): compound (geometric, CAGR) nominal returns and volatilities by index, replacing the
 * first-draft round numbers. Three classes are new and have fixed ids so every synced device creates the very same records.
 *
 * Existing data is updated once, and only where the class still holds the old default numbers: a class you have edited is left alone.
 */

export const SMALL_CAP_ID = 9_000_000_000_000_011;
export const EMERGING_ID = 9_000_000_000_000_012;
export const HIGH_YIELD_ID = 9_000_000_000_000_013;
export const ASSET_UPDATE_KEY = 'assetClassesUpdate2026';

type Row = Omit<AssetClass, 'id'>;

/** The four old defaults that map onto a new class: what they were, and what they become. */
export const OLD_TO_NEW: { old: Row; next: Row }[] = [
  { old: { name: 'US stocks', kind: 'equity', expectedReturnPct: 7, volatilityPct: 16 }, next: { name: 'US large cap (S&P 500)', kind: 'equity', expectedReturnPct: 8.82, volatilityPct: 17.92 } },
  { old: { name: 'International stocks', kind: 'equity', expectedReturnPct: 7, volatilityPct: 18 }, next: { name: 'Intl developed (MSCI EAFE)', kind: 'equity', expectedReturnPct: 5.85, volatilityPct: 19.71 } },
  { old: { name: 'Bonds', kind: 'bond', expectedReturnPct: 4, volatilityPct: 6 }, next: { name: 'US aggregate bonds (Bloomberg US Agg)', kind: 'bond', expectedReturnPct: 3.72, volatilityPct: 4.72 } },
  { old: { name: 'Real estate (REITs)', kind: 'real_estate', expectedReturnPct: 6.5, volatilityPct: 17 }, next: { name: 'US REITs (FTSE Nareit All Equity)', kind: 'real_estate', expectedReturnPct: 9, volatilityPct: 19.37 } },
];

export const NEW_CLASSES: (Row & { id: number })[] = [
  { id: SMALL_CAP_ID, name: 'US small cap (Russell 2000)', kind: 'equity', expectedReturnPct: 8.21, volatilityPct: 18.73 },
  { id: EMERGING_ID, name: 'Emerging markets (MSCI EM)', kind: 'equity', expectedReturnPct: 8.87, volatilityPct: 27.69 },
  // Kind "bond" is the closest the app has; real high-yield bonds move more with stocks than the bond correlation assumes.
  { id: HIGH_YIELD_ID, name: 'High-yield bonds (BofA HY)', kind: 'bond', expectedReturnPct: 7.03, volatilityPct: 14.71 },
];

/** Classes kept exactly as they were: not in the new table, so they stay on their old numbers. */
export const KEPT_CLASSES: Row[] = [
  { name: 'Balanced / target-date', kind: 'balanced', expectedReturnPct: 6, volatilityPct: 11 },
  { name: 'Cash', kind: 'cash', expectedReturnPct: 3, volatilityPct: 1 },
  { name: 'Other', kind: 'other', expectedReturnPct: 5, volatilityPct: 15 },
];

/** What a fresh install starts with. */
export const DEFAULT_CLASSES: (Row & { id?: number })[] = [
  ...OLD_TO_NEW.slice(0, 1).map((m) => m.next),
  NEW_CLASSES[0],
  ...OLD_TO_NEW.slice(1, 2).map((m) => m.next),
  NEW_CLASSES[1],
  ...OLD_TO_NEW.slice(2, 3).map((m) => m.next),
  NEW_CLASSES[2],
  ...OLD_TO_NEW.slice(3, 4).map((m) => m.next),
  ...KEPT_CLASSES,
];

const same = (c: AssetClass, r: Row) => c.name === r.name && c.kind === r.kind && c.expectedReturnPct === r.expectedReturnPct && c.volatilityPct === r.volatilityPct;

/**
 * Runs once per database. Updates the four mapped classes if they still hold the old defaults (renaming them too), and adds the three
 * new classes unless they, or a class of the same name, already exist. Does nothing until classes exist (a fresh install is seeded
 * with the new numbers directly). Safe to run on several devices: the records and the result are the same.
 */
export async function updateAssetClasses(d: FinanceDB): Promise<void> {
  await d.transaction('rw', d.assetClasses, d.settings, async () => {
    if (await d.settings.get(ASSET_UPDATE_KEY)) return;
    const all = await d.assetClasses.toArray();
    if (all.length === 0) return;
    for (const m of OLD_TO_NEW) {
      for (const c of all) if (same(c, m.old)) await d.assetClasses.update(c.id!, { ...m.next });
    }
    const names = new Set(all.map((c) => c.name));
    for (const n of NEW_CLASSES) {
      if (names.has(n.name) || all.some((c) => c.id === n.id)) continue;
      await d.assetClasses.add({ ...n });
    }
    await d.settings.put({ key: ASSET_UPDATE_KEY, value: true });
  });
}
