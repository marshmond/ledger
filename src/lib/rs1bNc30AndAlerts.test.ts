import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FinanceDB, db } from '../db';
import { billQuickAdd } from '../modules/bills/quickAddDef';
import { UNDO_REFUSED } from '../modules/bills/undo';
import { findSecurityForTicker, saveGrantWithStock } from './rsuGrant';
import type { RsuGrant } from '../types';

/** RS-1B: NC-30 (a stock's security row is created only when the grant save goes ahead) and the removal of native alert(). Invented data only. */
let n = 0;
const grant = (p: Partial<RsuGrant> = {}): RsuGrant => ({
  personId: 1, name: 'Invented stock grant', startDate: '2026-02-02', frequency: 'quarterly', years: 2, kind: 'stock', priceCents: null, securityId: null, afterVest: 'sold', accountId: null, ...p,
});

describe('NC-30: the security row for a new ticker', () => {
  it('looking a ticker up (what opening the question does) creates nothing, and cancelling leaves the database unchanged', async () => {
    const d = new FinanceDB(`rs1b-nc30-${n++}`);
    expect(await findSecurityForTicker(d, ' acme ')).toBeUndefined();
    // Cancel = nothing else is called.
    expect(await d.securities.count()).toBe(0);
    expect(await d.rsuGrants.count()).toBe(0);
    expect(await d.rsuVests.count()).toBe(0);
  });

  it('confirming creates the security once and the grant points at it; an existing ticker is reused, in any case', async () => {
    const d = new FinanceDB(`rs1b-nc30-${n++}`);
    const first = await saveGrantWithStock(d, grant(), { ticker: 'acme', assetClassId: 3 });
    expect(first.security).toMatchObject({ ticker: 'ACME', assetClassId: 3 });
    expect((await d.rsuGrants.get(first.id))!.securityId).toBe(first.security!.id);
    expect(await d.securities.count()).toBe(1);
    expect(await findSecurityForTicker(d, 'Acme')).toMatchObject({ id: first.security!.id });
    // A second grant on the same ticker, resolved without creating (the page passes no newStock for a known ticker).
    const known = await findSecurityForTicker(d, 'ACME');
    const second = await saveGrantWithStock(d, grant({ name: 'Second', securityId: known!.id! }));
    expect(second.security).toBeUndefined();
    expect(await d.securities.count()).toBe(1);
    expect((await d.rsuGrants.get(second.id))!.securityId).toBe(known!.id);
  });

  it('if the grant cannot be saved after the security was created, the new security is rolled back (no unused ticker left behind)', async () => {
    const d = new FinanceDB(`rs1b-nc30-${n++}`);
    d.rsuGrants.hook('creating', () => { throw new Error('simulated write failure'); });
    await expect(saveGrantWithStock(d, grant(), { ticker: 'ACME', assetClassId: 3 })).rejects.toThrow(/simulated write failure/);
    expect(await d.securities.count()).toBe(0);
    expect(await d.rsuGrants.count()).toBe(0);
  });

  it('the page no longer creates the security while the question is being asked', () => {
    const page = readFileSync('src/pages/RsuGrants.tsx', 'utf8');
    expect(page).not.toMatch(/securityForTicker/);
    expect(page).toMatch(/saveGrantWithStock/);
  });
});

describe('no native alert() in application code', () => {
  const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f) ? [p] : [];
  });
  const code = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');

  it('no production source calls alert() or window.alert', () => {
    const hits = files('src').filter((f) => /(^|[^\w.])(window\s*\.\s*)?alert\s*\(/.test(code(readFileSync(f, 'utf8'))));
    expect(hits).toEqual([]);
  });

  afterEach(async () => { vi.unstubAllGlobals(); await db.moduleRecords.clear(); await db.contacts.clear(); });

  it('Quick Add (Bills): a refused Undo throws its plain message for the Add box to show, and never pops up an alert', async () => {
    const alertSpy = vi.fn();
    vi.stubGlobal('window', { alert: alertSpy });
    const preview = billQuickAdd.parse!('Alertcheck Cable 79.99 monthly 3rd manual', {})!;
    const undo = await billQuickAdd.commit!(preview);
    const row = (await db.moduleRecords.toArray()).find((r) => r.module === 'bills')!;
    await db.moduleRecords.update(row.id as number, { updatedAt: row.updatedAt + 5 }); // something else changed it, so Undo must refuse
    await expect(undo!()).rejects.toThrow(UNDO_REFUSED);
    expect(alertSpy).not.toHaveBeenCalled();
    expect(await db.moduleRecords.get(row.id as number)).toBeDefined(); // refused: nothing was undone
  });
});
