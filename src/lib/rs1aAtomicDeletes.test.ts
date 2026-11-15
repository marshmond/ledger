import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Table } from 'dexie';
import { FinanceDB } from '../db';
import { installTracking, setChangeListener } from './sync/track';
import { deleteHoldingWithLots, deleteInvestmentAccount, deletePropertyWithValues, invAccountBlockMessage, readInvAccountContents } from './confirmedDeletes';

/**
 * RS-1A (NC-18, NC-19, NC-22): holding, investment account and property deletes are all-or-nothing.
 * Every scenario runs on a disposable fake-IndexedDB database with INVENTED data. A failure is injected deterministically with a Dexie "deleting" hook that throws on the
 * Nth delete of a table; a rejected transaction must leave EVERY table exactly as it was (compared row by row, not by count).
 */
let d: FinanceDB;
let k = 0;
beforeEach(async () => { d = new FinanceDB(`rs1a-${k++}`); await d.open(); });

type Dump = Record<string, unknown[]>;
const dump = async (db: FinanceDB): Promise<Dump> => { const out: Dump = {}; for (const t of db.tables) out[t.name] = await t.toArray(); return out; };

/** Makes the Nth delete on `table` throw. Returns a function that removes the injection. */
function failOnDelete(table: Table<never, number>, nth = 1): () => void {
  let n = 0;
  const fn = () => { n += 1; if (n === nth) throw new Error('injected failure'); };
  (table as unknown as { hook: (e: string, f: () => void) => void }).hook('deleting', fn);
  return () => (table as unknown as { hook: (e: string) => { unsubscribe: (f: () => void) => void } }).hook('deleting').unsubscribe(fn);
}

interface World { brokerage: number; otherBrokerage: number; ira: number; h1: number; h2: number; h3: number; iraHolding: number; lotsH1: number[]; lotsH2: number[]; lotsH3: number[]; prop: number; otherProp: number }

async function world(): Promise<World> {
  const cls = (await d.assetClasses.add({ name: 'Invented stocks', expectedReturnPct: 6, volatilityPct: 15 } as never)) as number;
  const sec = (await d.securities.add({ ticker: 'INV1', name: 'Invented Fund', assetClassId: cls, priceCents: 5000 } as never)) as number;
  const sec2 = (await d.securities.add({ ticker: 'INV2', name: 'Another Fund', assetClassId: cls, priceCents: 2000 } as never)) as number;
  const mkAcct = async (name: string, kind: string) => (await d.invAccounts.add({ name, kind, taxType: 'traditional', cashCents: 1000, annualContributionCents: 0, contributionGrowthPct: 0, linkToIncome: false } as never)) as number;
  const brokerage = await mkAcct('Invented Brokerage', 'brokerage');
  const otherBrokerage = await mkAcct('Other Brokerage', 'brokerage');
  const ira = await mkAcct('Invented IRA', 'ira');
  const hold = async (accountId: number, securityId: number, shares: number, costBasisCents: number | null) => (await d.holdings.add({ accountId, securityId, shares, costBasisCents } as never)) as number;
  const h1 = await hold(brokerage, sec, 10, 40000);
  const h2 = await hold(brokerage, sec2, 5, 9000);
  const h3 = await hold(otherBrokerage, sec, 7, 30000);
  const iraHolding = await hold(ira, sec, 3, null);
  const lot = async (holdingId: number, accountId: number, securityId: number, shares: number, costBasisCents: number) => (await d.taxLots.add({ holdingId, accountId, securityId, acquiredDate: '2025-01-15', shares, costBasisCents, source: 'buy' } as never)) as number;
  const lotsH1 = [await lot(h1, brokerage, sec, 4, 16000), await lot(h1, brokerage, sec, 6, 24000)];
  const lotsH2 = [await lot(h2, brokerage, sec2, 5, 9000)];
  const lotsH3 = [await lot(h3, otherBrokerage, sec, 7, 30000)];
  // history and plans that name the account and are NOT deleted by any of these operations
  await d.sales.add({ accountId: brokerage, securityId: sec, date: '2026-03-01', shares: 1, proceedsCents: 5000, feesCents: 0, method: 'fifo', taxable: true, lots: [], basisCents: 4000, gainCents: 1000, shortTermCents: 1000, longTermCents: 0, toCashCents: 0, note: '' } as never);
  await d.hsaWithdrawals.add({ accountId: ira, date: '2026-02-01', amountCents: 100, qualified: true, note: '', fromCashCents: 0 } as never);
  await d.goals.add({ name: 'Invented goal', accountId: brokerage, startYear: 2040, years: 4, annualCostCents: 100000, costInflationPct: 5, fundingPct: 100, contributionGrowthPct: 0, confidencePct: 80 } as never);
  const loan = (await d.loans.add({ name: 'Invented mortgage' } as never)) as number;
  const prop = (await d.properties.add({ name: 'Invented House', kind: 'home', loanIds: [loan] } as never)) as number;
  const otherProp = (await d.properties.add({ name: 'Invented Car', kind: 'vehicle', loanIds: [] } as never)) as number;
  for (const [pid, date, v] of [[prop, '2024-01-01', 30000000], [prop, '2025-01-01', 31000000], [prop, '2026-01-01', 32000000], [otherProp, '2025-06-01', 1500000], [otherProp, '2026-06-01', 1400000]] as const) {
    await d.propertyValues.add({ propertyId: pid, date, valueCents: v, note: '' } as never);
  }
  await d.netWorthSnapshots.add({ date: '2026-06-30', assetsCents: 1, liabilitiesCents: 0, netCents: 1 } as never);
  return { brokerage, otherBrokerage, ira, h1, h2, h3, iraHolding, lotsH1, lotsH2, lotsH3, prop, otherProp };
}

// ======================================================================================================== the injection itself
describe('control: the failure injection is real (the OLD two-step sequences lose data under it)', () => {
  it('old NC-18 sequence (lots, then holding, no transaction): a failure on the holding leaves a holding with no lots', async () => {
    const w = await world();
    const off = failOnDelete(d.holdings as never, 1);
    await expect((async () => { await d.taxLots.where('holdingId').equals(w.h1).delete(); await d.holdings.delete(w.h1); })()).rejects.toThrow('injected failure');
    off();
    expect(await d.holdings.get(w.h1)).toBeDefined();
    expect(await d.taxLots.where('holdingId').equals(w.h1).count()).toBe(0); // the partial state RS-1A removes
  });
  it('old NC-22 sequence: a failure on the property leaves a property with no value history', async () => {
    const w = await world();
    const off = failOnDelete(d.properties as never, 1);
    await expect((async () => { await d.propertyValues.where('propertyId').equals(w.prop).delete(); await d.properties.delete(w.prop); })()).rejects.toThrow('injected failure');
    off();
    expect(await d.properties.get(w.prop)).toBeDefined();
    expect(await d.propertyValues.where('propertyId').equals(w.prop).count()).toBe(0);
  });
  it('old NC-19 sequence: the account\'s lots were never deleted, so deleting it orphaned them', async () => {
    const w = await world();
    await d.holdings.where('accountId').equals(w.brokerage).delete();
    await d.invAccounts.delete(w.brokerage);
    expect(await d.taxLots.where('accountId').equals(w.brokerage).count()).toBe(3); // orphan lots: the data-loss shape RS-1A now refuses
  });
});

// ======================================================================================================== NC-18
describe('NC-18: removing a holding removes it and its lots in one transaction', () => {
  it('normal success: the holding and all its lots go; every other row is untouched', async () => {
    const w = await world();
    const before = await dump(d);
    const r = await deleteHoldingWithLots(d, w.h1, w.brokerage);
    expect(r).toEqual({ ok: true, lotsDeleted: 2 });
    const after = await dump(d);
    expect(after.holdings).toEqual((before.holdings as { id: number }[]).filter((h) => h.id !== w.h1));
    expect(after.taxLots).toEqual((before.taxLots as { holdingId: number }[]).filter((l) => l.holdingId !== w.h1));
    for (const t of Object.keys(before)) if (t !== 'holdings' && t !== 'taxLots') expect(after[t], t).toEqual(before[t]);
    expect(await d.taxLots.where('holdingId').equals(w.h1).count()).toBe(0); // no orphan lots
  });

  it('a holding with no lots (an IRA holding) is removed too, with zero lots reported', async () => {
    const w = await world();
    expect(await deleteHoldingWithLots(d, w.iraHolding, w.ira)).toEqual({ ok: true, lotsDeleted: 0 });
    expect(await d.holdings.get(w.iraHolding)).toBeUndefined();
  });

  it('failure before the first write (the first lot delete throws): nothing changes at all', async () => {
    const w = await world();
    const before = await dump(d);
    const off = failOnDelete(d.taxLots as never, 1);
    await expect(deleteHoldingWithLots(d, w.h1, w.brokerage)).rejects.toThrow('injected failure');
    off();
    expect(await dump(d)).toEqual(before);
  });

  it('failure after the first lot is gone (the second lot delete throws): both lots and the holding come back', async () => {
    const w = await world();
    const before = await dump(d);
    const off = failOnDelete(d.taxLots as never, 2);
    await expect(deleteHoldingWithLots(d, w.h1, w.brokerage)).rejects.toThrow('injected failure');
    off();
    expect(await dump(d)).toEqual(before);
    expect(await d.taxLots.where('holdingId').equals(w.h1).count()).toBe(2);
  });

  it('failure during the final delete (the holding itself): the lots that were already deleted are restored', async () => {
    const w = await world();
    const before = await dump(d);
    const off = failOnDelete(d.holdings as never, 1);
    await expect(deleteHoldingWithLots(d, w.h1, w.brokerage)).rejects.toThrow('injected failure');
    off();
    expect(await dump(d)).toEqual(before);
  });

  it('a failure while reading (before any write) also leaves everything as it was', async () => {
    const w = await world();
    const before = await dump(d);
    const spy = vi.spyOn(d.taxLots, 'where').mockImplementation(() => { throw new Error('read failed'); });
    await expect(deleteHoldingWithLots(d, w.h1, w.brokerage)).rejects.toThrow('read failed');
    spy.mockRestore();
    expect(await dump(d)).toEqual(before);
  });

  it('a missing (already removed) holding is refused with a message and writes nothing', async () => {
    const w = await world();
    expect((await deleteHoldingWithLots(d, w.h1, w.brokerage)).ok).toBe(true);
    const before = await dump(d);
    const r = await deleteHoldingWithLots(d, w.h1, w.brokerage);
    expect(r).toMatchObject({ ok: false, reason: 'missing' });
    expect(await dump(d)).toEqual(before);
    expect((await deleteHoldingWithLots(d, 987654321, w.brokerage)).ok).toBe(false);
  });

  it('a holding that now belongs to a different account than the screen showed is refused (stale dialog)', async () => {
    const w = await world();
    const before = await dump(d);
    const r = await deleteHoldingWithLots(d, w.h3, w.brokerage); // h3 is in the OTHER brokerage
    expect(r).toMatchObject({ ok: false, reason: 'moved' });
    expect(await dump(d)).toEqual(before);
  });

  it('pressing it twice at once removes the holding once and never touches a neighbour', async () => {
    const w = await world();
    const [a, b] = await Promise.all([deleteHoldingWithLots(d, w.h1, w.brokerage), deleteHoldingWithLots(d, w.h1, w.brokerage)]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    expect(await d.holdings.get(w.h2)).toBeDefined();
    expect(await d.taxLots.where('holdingId').equals(w.h2).count()).toBe(1);
    expect(await d.taxLots.where('holdingId').equals(w.h3).count()).toBe(1);
  });
});

// ======================================================================================================== NC-19
describe('NC-19: deleting an investment account is all-or-nothing and refuses while tax lots exist', () => {
  it('Option B in action: an account whose holdings have tax lots is refused before any write, and nothing at all changes', async () => {
    const w = await world();
    const before = await dump(d);
    const r = await deleteInvestmentAccount(d, w.brokerage);
    expect(r).toMatchObject({ ok: false, reason: 'taxLots' });
    expect((r as { message: string }).message).toContain('3 tax lots in 2 holdings');
    expect((r as { message: string }).message).toContain('nothing was deleted');
    expect(await dump(d)).toEqual(before);
  });

  it('no orphan lots can be created: the refusal leaves holdings AND lots both in place', async () => {
    const w = await world();
    await deleteInvestmentAccount(d, w.brokerage);
    expect(await d.holdings.where('accountId').equals(w.brokerage).count()).toBe(2);
    expect(await d.taxLots.where('accountId').equals(w.brokerage).count()).toBe(3);
  });

  it('the way forward works: remove each holding (its lots go with it), then the account deletes cleanly with no orphan', async () => {
    const w = await world();
    expect((await deleteHoldingWithLots(d, w.h1, w.brokerage)).ok).toBe(true);
    expect((await deleteHoldingWithLots(d, w.h2, w.brokerage)).ok).toBe(true);
    // the world's brokerage also has a recorded sale (F-1), which blocks deletion; the test removes it directly to show the lots path is otherwise clear
    expect(await deleteInvestmentAccount(d, w.brokerage)).toMatchObject({ ok: false, reason: 'sales' });
    await d.sales.where('accountId').equals(w.brokerage).delete();
    const r = await deleteInvestmentAccount(d, w.brokerage);
    expect(r).toEqual({ ok: true, holdingsDeleted: 0 });
    expect(await d.invAccounts.get(w.brokerage)).toBeUndefined();
    expect(await d.taxLots.where('accountId').equals(w.brokerage).count()).toBe(0);
    expect(await d.holdings.where('accountId').equals(w.brokerage).count()).toBe(0);
  });

  it('an account whose holdings have NO lots (an IRA) is deleted with its holdings in one transaction; unrelated rows are untouched', async () => {
    const w = await world();
    const before = await dump(d);
    const r = await deleteInvestmentAccount(d, w.ira);
    expect(r).toEqual({ ok: true, holdingsDeleted: 1 });
    const after = await dump(d);
    expect(after.invAccounts).toEqual((before.invAccounts as { id: number }[]).filter((a) => a.id !== w.ira));
    expect(after.holdings).toEqual((before.holdings as { id: number }[]).filter((h) => h.id !== w.iraHolding));
    for (const t of Object.keys(before)) if (t !== 'invAccounts' && t !== 'holdings') expect(after[t], t).toEqual(before[t]); // HSA history, sales, goals, lots, loans: untouched
  });

  it('a failure before the first write: nothing changes (IRA with two holdings)', async () => {
    const w = await world();
    await d.holdings.add({ accountId: w.ira, securityId: 1, shares: 2, costBasisCents: null } as never);
    const before = await dump(d);
    const off = failOnDelete(d.holdings as never, 1);
    await expect(deleteInvestmentAccount(d, w.ira)).rejects.toThrow('injected failure');
    off();
    expect(await dump(d)).toEqual(before);
  });

  it('a failure after the first holding is deleted (second holding delete throws): both holdings and the account come back', async () => {
    const w = await world();
    await d.holdings.add({ accountId: w.ira, securityId: 1, shares: 2, costBasisCents: null } as never);
    const before = await dump(d);
    const off = failOnDelete(d.holdings as never, 2);
    await expect(deleteInvestmentAccount(d, w.ira)).rejects.toThrow('injected failure');
    off();
    expect(await dump(d)).toEqual(before);
  });

  it('a failure during the final delete (the account itself): the holdings already deleted are restored', async () => {
    const w = await world();
    const before = await dump(d);
    const off = failOnDelete(d.invAccounts as never, 1);
    await expect(deleteInvestmentAccount(d, w.ira)).rejects.toThrow('injected failure');
    off();
    expect(await dump(d)).toEqual(before);
    expect(await d.holdings.get(w.iraHolding)).toBeDefined();
  });

  it('a lot that appears after the dialog opened is seen: the check is repeated inside the transaction', async () => {
    const w = await world();
    // the owner opened "delete" on the IRA when it had no lots; another device then added one
    await d.taxLots.add({ holdingId: w.iraHolding, accountId: w.ira, securityId: 1, acquiredDate: null, shares: 3, costBasisCents: 0, source: 'opening' } as never);
    const before = await dump(d);
    const r = await deleteInvestmentAccount(d, w.ira);
    expect(r).toMatchObject({ ok: false, reason: 'taxLots' });
    expect(await dump(d)).toEqual(before);
  });

  it('a lot that names the account but belongs to no holding of it is also a refusal (Ledger cannot tell what it is)', async () => {
    const w = await world();
    await d.taxLots.add({ holdingId: 424242, accountId: w.ira, securityId: 1, acquiredDate: null, shares: 1, costBasisCents: 0, source: 'manual' } as never);
    const before = await dump(d);
    const r = await deleteInvestmentAccount(d, w.ira);
    expect(r).toMatchObject({ ok: false, reason: 'taxLots' });
    expect((r as { message: string }).message).toContain('not attached to any holding');
    expect(await dump(d)).toEqual(before);
  });

  it('a missing (already deleted) account is refused and writes nothing; repeated or concurrent presses delete once', async () => {
    const w = await world();
    const [a, b] = await Promise.all([deleteInvestmentAccount(d, w.ira), deleteInvestmentAccount(d, w.ira)]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    const before = await dump(d);
    expect(await deleteInvestmentAccount(d, w.ira)).toMatchObject({ ok: false, reason: 'missing' });
    expect(await deleteInvestmentAccount(d, 777777)).toMatchObject({ ok: false, reason: 'missing' });
    expect(await dump(d)).toEqual(before);
    expect(await d.invAccounts.get(w.brokerage)).toBeDefined(); // neighbours survive
    expect(await d.invAccounts.get(w.otherBrokerage)).toBeDefined();
  });

  it('reading what blocks an account writes nothing (opening or cancelling the dialog is read-only)', async () => {
    const w = await world();
    const before = await dump(d);
    let writes = 0;
    for (const t of d.tables) { t.hook('creating', () => { writes++; }); t.hook('updating', () => { writes++; }); t.hook('deleting', () => { writes++; }); }
    const c = await readInvAccountContents(d, w.brokerage);
    expect(c.lots).toHaveLength(3);
    expect(c.holdingsWithLots).toBe(2);
    expect(c.strayLots).toBe(0);
    expect(invAccountBlockMessage('Invented Brokerage', c)).toContain('3 tax lots in 2 holdings');
    expect(invAccountBlockMessage('Invented IRA', await readInvAccountContents(d, w.ira))).toBeNull();
    expect(writes).toBe(0);
    expect(await dump(d)).toEqual(before);
  });

  it('F-1: an account with recorded sales (and no lots) is refused, and every table is unchanged', async () => {
    const w = await world();
    await d.sales.add({ accountId: w.ira, securityId: 1, date: '2026-04-01', shares: 1, proceedsCents: 100, feesCents: 0, method: 'fifo', taxable: false, lots: [], basisCents: 0, gainCents: 0, shortTermCents: 0, longTermCents: 0, toCashCents: 0, note: '' } as never);
    const before = await dump(d);
    const r = await deleteInvestmentAccount(d, w.ira);
    expect(r).toMatchObject({ ok: false, reason: 'sales' });
    expect((r as { message: string }).message).toContain('1 recorded sale');
    expect(await dump(d)).toEqual(before);
  });

  it('F-1: a sale recorded after the dialog opened is caught inside the transaction; the account without sales or lots still deletes; tax-lot refusal still wins first', async () => {
    const w = await world();
    expect(await deleteInvestmentAccount(d, w.otherBrokerage)).toMatchObject({ ok: false, reason: 'taxLots' });
    await d.sales.add({ accountId: w.ira, securityId: 1, date: '2026-04-01', shares: 1, proceedsCents: 100, feesCents: 0, method: 'fifo', taxable: false, lots: [], basisCents: 0, gainCents: 0, shortTermCents: 0, longTermCents: 0, toCashCents: 0, note: '' } as never);
    const before = await dump(d);
    expect(await deleteInvestmentAccount(d, w.ira)).toMatchObject({ ok: false, reason: 'sales' });
    expect(await dump(d)).toEqual(before);
    const ira2 = (await d.invAccounts.add({ name: 'Clean IRA', kind: 'ira', taxType: 'traditional', cashCents: 0, annualContributionCents: 0, contributionGrowthPct: 0, linkToIncome: false } as never)) as number;
    expect(await deleteInvestmentAccount(d, ira2)).toEqual({ ok: true, holdingsDeleted: 0 });
    expect(await d.sales.count()).toBe(2); // the world's brokerage sale and the new one: never deleted by the function
  });

  it('wording is singular when there is one lot in one holding', () => {
    expect(invAccountBlockMessage('X', { lots: [{} as never], holdingsWithLots: 1, strayLots: 0 })).toContain('1 tax lot in 1 holding.');
  });
});

// ======================================================================================================== NC-22
describe('NC-22: deleting a property removes it and its value history in one transaction', () => {
  it('normal success: the property and all its values go; another property, its values, loans and net worth points are untouched', async () => {
    const w = await world();
    const before = await dump(d);
    expect(await deletePropertyWithValues(d, w.prop)).toEqual({ ok: true, valuesDeleted: 3 });
    const after = await dump(d);
    expect(after.properties).toEqual((before.properties as { id: number }[]).filter((p) => p.id !== w.prop));
    expect(after.propertyValues).toEqual((before.propertyValues as { propertyId: number }[]).filter((v) => v.propertyId !== w.prop));
    for (const t of Object.keys(before)) if (t !== 'properties' && t !== 'propertyValues') expect(after[t], t).toEqual(before[t]);
    expect(await d.propertyValues.where('propertyId').equals(w.prop).count()).toBe(0);
  });

  it('a property with no values is deleted too', async () => {
    const pid = (await d.properties.add({ name: 'Empty', kind: 'other', loanIds: [] } as never)) as number;
    expect(await deletePropertyWithValues(d, pid)).toEqual({ ok: true, valuesDeleted: 0 });
    expect(await d.properties.get(pid)).toBeUndefined();
  });

  it('failure before the first write (the first value delete throws): nothing changes', async () => {
    const w = await world();
    const before = await dump(d);
    const off = failOnDelete(d.propertyValues as never, 1);
    await expect(deletePropertyWithValues(d, w.prop)).rejects.toThrow('injected failure');
    off();
    expect(await dump(d)).toEqual(before);
  });

  it('failure after the first value is gone (the second throws): the whole value history and the property are intact', async () => {
    const w = await world();
    const before = await dump(d);
    const off = failOnDelete(d.propertyValues as never, 2);
    await expect(deletePropertyWithValues(d, w.prop)).rejects.toThrow('injected failure');
    off();
    expect(await dump(d)).toEqual(before);
    expect(await d.propertyValues.where('propertyId').equals(w.prop).count()).toBe(3);
  });

  it('failure during the final delete (the property): every value already deleted is restored', async () => {
    const w = await world();
    const before = await dump(d);
    const off = failOnDelete(d.properties as never, 1);
    await expect(deletePropertyWithValues(d, w.prop)).rejects.toThrow('injected failure');
    off();
    expect(await dump(d)).toEqual(before);
  });

  it('a missing property is refused and writes nothing; two presses at once delete once; the other property is never touched', async () => {
    const w = await world();
    const [a, b] = await Promise.all([deletePropertyWithValues(d, w.prop), deletePropertyWithValues(d, w.prop)]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    const before = await dump(d);
    expect(await deletePropertyWithValues(d, w.prop)).toMatchObject({ ok: false, reason: 'missing' });
    expect(await dump(d)).toEqual(before);
    expect(await d.propertyValues.where('propertyId').equals(w.otherProp).count()).toBe(2);
  });

  it('values that belong to a property id that does not exist (a pre-existing orphan) are left alone when another property is deleted', async () => {
    const w = await world();
    await d.propertyValues.add({ propertyId: 31337, date: '2020-01-01', valueCents: 1, note: '' } as never);
    await deletePropertyWithValues(d, w.prop);
    expect(await d.propertyValues.where('propertyId').equals(31337).count()).toBe(1);
  });
});

// ======================================================================================================== sync, wiring
describe('RS-1A: sync tracking and the screens', () => {
  it('with change tracking installed, a transactional delete still tells sync something changed', async () => {
    const d2 = new FinanceDB(`rs1a-sync-${k++}`);
    installTracking(d2);
    await d2.open();
    const pid = (await d2.properties.add({ name: 'Invented', kind: 'other', loanIds: [] } as never)) as number;
    await d2.propertyValues.add({ propertyId: pid, date: '2026-01-01', valueCents: 5, note: '' } as never);
    const changed = vi.fn();
    setChangeListener(changed);
    await deletePropertyWithValues(d2, pid);
    setChangeListener(null);
    expect(changed).toHaveBeenCalled();
    expect(await d2.properties.count()).toBe(0);
  });

  const src = (f: string) => readFileSync(`src/${f}`, 'utf8');
  it('the three screens call the transactional functions and no longer do two separate awaits', () => {
    const inv = src('pages/InvestmentsPage.tsx');
    const nw = src('pages/NetWorthPage.tsx');
    expect(inv).toContain('deleteHoldingWithLots(db, askHoldingRow.id!, a.id!)');
    expect(inv).toContain('deleteInvestmentAccount(db, a.id!)');
    expect(nw).toContain('deletePropertyWithValues(db, p.id!)');
    expect(inv).not.toMatch(/taxLots\.where\('holdingId'\)\.equals\(askHoldingRow\.id!\)\.delete\(\)/);
    expect(inv).not.toMatch(/db\.holdings\.where\('accountId'\)\.equals\(a\.id!\)\.delete\(\)/);
    expect(nw).not.toMatch(/db\.propertyValues\.where\('propertyId'\)\.equals\(p\.id!\)\.delete\(\)/);
  });

  it('cancelling any of the three dialogs only clears the remembered id: no database call in onCancel', () => {
    const inv = src('pages/InvestmentsPage.tsx');
    const nw = src('pages/NetWorthPage.tsx');
    expect(inv).toContain('onCancel={() => setAskHolding(null)}');
    expect(inv).toContain('onCancel={() => setAskAccount(false)}');
    expect(nw).toContain('onCancel={() => setAskProperty(false)}');
  });

  it('a refusal comes back as a message, so the dialog stays open and shows it (no silent success)', () => {
    for (const f of ['pages/InvestmentsPage.tsx', 'pages/NetWorthPage.tsx']) expect(src(f)).toContain('if (!r.ok) return r.message;');
  });

  it('the helper functions contain no timers, network calls or React state (nothing that could end a transaction early)', () => {
    const t = src('lib/confirmedDeletes.ts');
    const part = t.slice(t.indexOf('RS-1A (NC-18'));
    expect(part).not.toMatch(/setTimeout|setInterval|fetch\(|useState|window\.|alert\(|confirm\(/);
  });
});
