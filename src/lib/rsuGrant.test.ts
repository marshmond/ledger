import { beforeEach, describe, expect, it } from 'vitest';
import { FinanceDB } from '../db';
import { exportAll, importAll } from './backup';
import { resolveVest } from './rsu';
import { installTracking } from './sync/track';
import {
  addMonths, deleteGrant, evenSplit, fillEvenly, grantProblem, refreshSecurityPrice, saveGrant, scheduleChange,
  securityForTicker, setVestShares, vestDates,
} from './rsuGrant';
import type { RsuGrant } from '../types';

const $ = (n: number) => Math.round(n * 100);
let n = 0;
const grant = (p: Partial<RsuGrant> = {}): RsuGrant => ({
  personId: 1, name: '2026 new hire', startDate: '2026-02-02', frequency: 'quarterly', years: 4, kind: 'cash', priceCents: $(10), ...p,
});

describe('vest dates', () => {
  it("quarterly from 2/2/26 is 5/2, 8/2, 11/2, 2/2 ... (the owner's example)", () => {
    const d = vestDates(grant());
    expect(d.slice(0, 5)).toEqual(['2026-05-02', '2026-08-02', '2026-11-02', '2027-02-02', '2027-05-02']);
    expect(d).toHaveLength(16);
    expect(d.at(-1)).toBe('2030-02-02'); // the agreement ends 4 years after the start
  });

  it('counts per schedule', () => {
    expect(vestDates(grant({ frequency: 'monthly' }))).toHaveLength(48);
    expect(vestDates(grant({ frequency: 'semiannual' }))).toEqual(['2026-08-02', '2027-02-02', '2027-08-02', '2028-02-02', '2028-08-02', '2029-02-02', '2029-08-02', '2030-02-02']);
    expect(vestDates(grant({ frequency: 'annual' }))).toEqual(['2027-02-02', '2028-02-02', '2029-02-02', '2030-02-02']);
    expect(vestDates(grant({ years: 1 }))).toHaveLength(4);
  });

  it("a day that a month does not have falls on that month's last day, without drifting", () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-01-31', 2)).toBe('2026-03-31'); // not the 28th: each date counts from the start date
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29'); // leap year
    expect(addMonths('2026-11-15', 3)).toBe('2027-02-15'); // across a year end
    expect(vestDates(grant({ startDate: '2026-01-31', frequency: 'monthly', years: 1 })).slice(0, 3)).toEqual(['2026-02-28', '2026-03-31', '2026-04-30']);
  });

  it('a cliff makes the first vest the cliff date and the regular dates continue after it', () => {
    const d = vestDates(grant({ cliffMonths: 12 }));
    expect(d[0]).toBe('2027-02-02'); // 12 months, which is also a regular quarterly date
    expect(d[1]).toBe('2027-05-02');
    expect(d).toHaveLength(13); // 16 regular dates, minus the 3 before the cliff
    // a cliff that is not on a regular date still starts the schedule
    const odd = vestDates(grant({ cliffMonths: 10 }));
    expect(odd[0]).toBe('2026-12-02');
    expect(odd[1]).toBe('2027-02-02');
    expect(new Set(odd).size).toBe(odd.length);
  });
});

describe('even split', () => {
  it('whole shares: the extra ones go to the earliest vests and everything adds up', () => {
    expect(evenSplit(100, 16)).toEqual([7, 7, 7, 7, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6]);
    expect(evenSplit(100, 16).reduce((a, b) => a + b, 0)).toBe(100);
    expect(evenSplit(160, 16).every((x) => x === 10)).toBe(true);
  });
  it('fractional totals split to four decimals with the remainder on the last vest', () => {
    const s = evenSplit(10.5, 4);
    expect(s.reduce((a, b) => a + b, 0)).toBeCloseTo(10.5, 6);
    expect(s[0]).toBe(2.625);
  });
  it('nothing to split', () => {
    expect(evenSplit(0, 4)).toEqual([]);
    expect(evenSplit(10, 0)).toEqual([]);
  });
});

describe('validation', () => {
  it('names what is missing', () => {
    expect(grantProblem({})).toMatch(/person/);
    expect(grantProblem({ personId: 1 })).toMatch(/name/);
    expect(grantProblem({ ...grant(), startDate: '' })).toMatch(/start date/);
    expect(grantProblem({ ...grant(), years: 0 })).toMatch(/whole years/);
    expect(grantProblem({ ...grant(), years: 2.5 })).toMatch(/whole years/);
    expect(grantProblem({ ...grant(), cliffMonths: 48 })).toMatch(/cliff/);
    expect(grantProblem({ ...grant(), priceCents: null })).toMatch(/price/);
    expect(grantProblem({ ...grant(), kind: 'stock', securityId: null })).toMatch(/ticker/);
    expect(grantProblem({ ...grant(), kind: 'stock', securityId: 3, afterVest: 'held' })).toMatch(/account/);
    expect(grantProblem(grant())).toBeNull();
    expect(grantProblem(grant({ cliffMonths: 12 }))).toBeNull();
    expect(grantProblem({ ...grant(), kind: 'stock', securityId: 3, afterVest: 'sold' })).toBeNull();
  });
});

describe('grants and their vests', () => {
  let d: FinanceDB;
  beforeEach(() => { d = new FinanceDB(`grant-${n++}`); });

  it('a vest exists once shares are typed: added, changed, removed', async () => {
    const id = await saveGrant(d, grant());
    const g = (await d.rsuGrants.get(id))!;
    expect(await setVestShares(d, g, '2026-05-02', 0)).toBe('none');
    expect(await d.rsuVests.count()).toBe(0);
    expect(await setVestShares(d, g, '2026-05-02', 25)).toBe('added');
    expect(await setVestShares(d, g, '2026-05-02', 30)).toBe('changed');
    const v = (await d.rsuVests.toArray())[0];
    expect(v).toMatchObject({ grantId: id, grant: '2026 new hire', kind: 'cash', shares: 30, priceCents: $(10), date: '2026-05-02', personId: 1 });
    expect(resolveVest(v, []).grossCents).toBe($(300)); // downstream code sees an ordinary cash vest
    expect(await setVestShares(d, g, '2026-05-02', 0)).toBe('removed');
    expect(await d.rsuVests.count()).toBe(0);
  });

  it('a stock grant makes stock vests with its security and what happens after', async () => {
    const sec = await securityForTicker(d, 'acme', 1);
    const acct = await d.invAccounts.add({ name: 'Brokerage', kind: 'brokerage', taxType: 'taxable', cashCents: 0, annualContributionCents: 0, contributionGrowthPct: 0, linkToIncome: false });
    const id = await saveGrant(d, grant({ kind: 'stock', priceCents: null, securityId: sec.id!, afterVest: 'held', accountId: acct }));
    await setVestShares(d, (await d.rsuGrants.get(id))!, '2026-05-02', 40);
    expect((await d.rsuVests.toArray())[0]).toMatchObject({ kind: 'stock', securityId: sec.id, afterVest: 'held', accountId: acct, priceCents: null });
  });

  it('even fill sets every date, replacing what was there', async () => {
    const id = await saveGrant(d, grant());
    const g = (await d.rsuGrants.get(id))!;
    await setVestShares(d, g, '2026-05-02', 3);
    expect(await fillEvenly(d, g, 160)).toBe(16);
    const vs = await d.rsuVests.toArray();
    expect(vs).toHaveLength(16);
    expect(vs.every((v) => v.shares === 10)).toBe(true);
  });

  it('shares already added to holdings are never changed or removed by the worksheet', async () => {
    const id = await saveGrant(d, grant());
    const g = (await d.rsuGrants.get(id))!;
    await setVestShares(d, g, '2026-05-02', 25);
    const v = (await d.rsuVests.toArray())[0];
    await d.rsuVests.update(v.id!, { recorded: true });
    expect(await setVestShares(d, g, '2026-05-02', 99)).toBe('locked');
    expect(await setVestShares(d, g, '2026-05-02', 0)).toBe('locked');
    expect((await d.rsuVests.get(v.id!))!.shares).toBe(25);
  });

  it('changing the schedule keeps shares and prices on dates that still exist, and drops the rest', async () => {
    const id = await saveGrant(d, grant());
    const g = (await d.rsuGrants.get(id))!;
    await setVestShares(d, g, '2026-05-02', 10);
    await setVestShares(d, g, '2026-08-02', 10);
    await setVestShares(d, g, '2026-11-02', 10);
    const own = (await d.rsuVests.toArray()).find((v) => v.date === '2026-08-02')!;
    await d.rsuVests.update(own.id!, { priceCents: $(11) }); // a price typed on one vest
    // semi-annual keeps 8/2 only (5/2 and 11/2 fall off the schedule)
    const change = scheduleChange({ ...g, frequency: 'semiannual' }, await d.rsuVests.toArray());
    expect(change.orphaned.map((v) => v.date).sort()).toEqual(['2026-05-02', '2026-11-02']);
    await saveGrant(d, { ...g, frequency: 'semiannual' });
    const left = await d.rsuVests.toArray();
    expect(left.map((v) => v.date)).toEqual(['2026-08-02']);
    expect(left[0]).toMatchObject({ shares: 10, priceCents: $(11) });
  });

  it('a new cash price reaches vests that used the old one, not a vest with its own price', async () => {
    const id = await saveGrant(d, grant());
    const g = (await d.rsuGrants.get(id))!;
    await setVestShares(d, g, '2026-05-02', 10);
    await setVestShares(d, g, '2026-08-02', 10);
    const vs = await d.rsuVests.toArray();
    await d.rsuVests.update(vs.find((v) => v.date === '2026-08-02')!.id!, { priceCents: $(12) });
    await saveGrant(d, { ...g, priceCents: $(15), name: 'Renamed' });
    const after = await d.rsuVests.toArray();
    expect(after.find((v) => v.date === '2026-05-02')).toMatchObject({ priceCents: $(15), grant: 'Renamed' });
    expect(after.find((v) => v.date === '2026-08-02')).toMatchObject({ priceCents: $(12), grant: 'Renamed' });
  });

  it('deleting a grant removes its vests, but vests already in holdings stay as ordinary vests', async () => {
    const id = await saveGrant(d, grant());
    const g = (await d.rsuGrants.get(id))!;
    await setVestShares(d, g, '2026-05-02', 10);
    await setVestShares(d, g, '2026-08-02', 10);
    const kept = (await d.rsuVests.toArray()).find((v) => v.date === '2026-05-02')!;
    await d.rsuVests.update(kept.id!, { recorded: true });
    expect(await deleteGrant(d, id)).toBe(1);
    expect(await d.rsuGrants.count()).toBe(0);
    const left = await d.rsuVests.toArray();
    expect(left).toHaveLength(1);
    expect(left[0].grantId).toBeNull();
  });

  it('vests of other grants and one-off vests are untouched', async () => {
    const a = await saveGrant(d, grant());
    const b = await saveGrant(d, grant({ name: 'Other' }));
    await setVestShares(d, (await d.rsuGrants.get(a))!, '2026-05-02', 5);
    await setVestShares(d, (await d.rsuGrants.get(b))!, '2026-05-02', 7);
    await d.rsuVests.add({ personId: 1, date: '2020-01-01', grant: 'old', kind: 'cash', shares: 1, priceCents: 100 });
    await deleteGrant(d, a);
    expect((await d.rsuVests.toArray()).map((v) => v.shares).sort()).toEqual([1, 7]);
  });

  it('survives a backup round trip and tracked (synced) writes', async () => {
    installTracking(d);
    const id = await saveGrant(d, grant({ cliffMonths: 12 }));
    await setVestShares(d, (await d.rsuGrants.get(id))!, '2027-02-02', 25);
    expect(((await d.rsuGrants.get(id)) as { updatedAt?: number }).updatedAt).toBeGreaterThan(0);
    expect(id).toBeGreaterThan(1e15); // a time-based id, so two devices cannot collide
    const file = await exportAll(d);
    expect(file.version).toBe(14);
    expect(file.rsuGrants).toHaveLength(1);
    await d.rsuGrants.clear();
    await d.rsuVests.clear();
    await importAll(d, file);
    expect((await d.rsuGrants.toArray())[0]).toMatchObject({ name: '2026 new hire', cliffMonths: 12 });
    expect(await d.rsuVests.count()).toBe(1);
    // an older backup (no grants) still restores
    await importAll(d, { ...file, version: 13, rsuGrants: undefined });
    expect(await d.rsuGrants.count()).toBe(0);
  });
});

describe('ticker and price', () => {
  let d: FinanceDB;
  beforeEach(() => { d = new FinanceDB(`grantpx-${n++}`); });

  it('finds a ticker in any case and only creates it once', async () => {
    const a = await securityForTicker(d, ' acme ', 3);
    const b = await securityForTicker(d, 'ACME', 3);
    expect(a.ticker).toBe('ACME');
    expect(b.id).toBe(a.id);
    expect(await d.securities.count()).toBe(1);
    expect(a.assetClassId).toBe(3);
  });

  it('looks up the price with the key on this device and stores it', async () => {
    const sec = await securityForTicker(d, 'ACME', 1);
    const calls: string[] = [];
    const fake = async (url: string) => { calls.push(url); return { status: 200, json: async () => ({ price: '123.45' }) }; };
    expect(await refreshSecurityPrice(d, sec, fake)).toMatchObject({ ok: false }); // no key yet
    expect(calls).toHaveLength(0);
    await d.settings.put({ key: 'priceApiKey', value: 'k' });
    const r = await refreshSecurityPrice(d, sec, fake);
    expect(r.ok).toBe(true);
    expect(calls[0]).toContain('symbol=ACME');
    const s = (await d.securities.get(sec.id!))!;
    expect(s).toMatchObject({ priceCents: $(123.45), priceSource: 'api' });
    // a stock vest on that security is valued at the looked-up price
    expect(resolveVest({ personId: 1, date: '2027-01-01', grant: 'g', kind: 'stock', shares: 10, securityId: s.id }, [s]).grossCents).toBe($(1234.5));
  });

  it('a failed lookup says why and keeps the old price', async () => {
    const sec = await securityForTicker(d, 'ACME', 1);
    await d.securities.update(sec.id!, { priceCents: $(50), priceSource: 'manual' });
    await d.settings.put({ key: 'priceApiKey', value: 'k' });
    const r = await refreshSecurityPrice(d, sec, async () => ({ status: 200, json: async () => ({ status: 'error', code: 429 }) }));
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/Rate limit/);
    expect((await d.securities.get(sec.id!))!.priceCents).toBe($(50));
  });
});
