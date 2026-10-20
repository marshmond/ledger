import { describe, expect, it } from 'vitest';
import { FinanceDB, seedAssetClassesIfEmpty } from '../db';

describe('seeding asset classes twice at once (React dev mode runs effects twice)', () => {
  it('ends with exactly one set of classes and does not throw', async () => {
    const d = new FinanceDB('ac-race');
    const results = await Promise.allSettled([seedAssetClassesIfEmpty(d), seedAssetClassesIfEmpty(d)]);
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    expect(await d.assetClasses.count()).toBe(10);
  });
});
