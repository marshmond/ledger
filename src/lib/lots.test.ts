import { beforeEach, describe, expect, it } from 'vitest';
import { FinanceDB } from '../db';
import { exportAll, importAll } from './backup';
import { addLot, allocateSale, deleteLot, ensureLots, isLongTerm, netForTax, previewSale, realizedFor, recordBuy, recordSale, undoSale, updateLot } from './lots';
import type { InvAccount, TaxLot } from '../types';

const $ = (n: number) => Math.round(n * 100);
const lot = (id: number, date: string | null, shares: number, cost: number): TaxLot => ({ id, holdingId: 1, accountId: 1, securityId: 1, acquiredDate: date, shares, costBasisCents: $(cost), source: 'buy' });

describe('holding period', () => {
  it('long-term only after the first anniversary', () => {
    expect(isLongTerm('2025-03-10', '2026-03-10')).toBe(false);
    expect(isLongTerm('2025-03-10', '2026-03-11')).toBe(true);
    expect(isLongTerm('2025-03-10', '2025-12-31')).toBe(false);
  });
  it('leap-day purchases and unknown dates', () => {
    expect(isLongTerm('2024-02-29', '2025-02-28')).toBe(false);
    expect(isLongTerm('2024-02-29', '2025-03-01')).toBe(false);
    expect(isLongTerm('2024-02-29', '2025-03-02')).toBe(true);
    expect(isLongTerm(null, '2026-01-02')).toBe(true);
  });
});

describe('choosing lots', () => {
  const lots = [lot(1, '2023-01-10', 10, 1000), lot(2, '2024-06-01', 10, 2000), lot(3, '2025-11-01', 10, 1500)];
  it('FIFO takes the oldest first', () => {
    const { allocs } = allocateSale(lots, 15, 'fifo');
    expect(allocs.map((a) => [a.lot.id, a.shares])).toEqual([[1, 10], [2, 5]]);
    expect(allocs[1].basisCents).toBe($(1000));
  });
  it('LIFO takes the newest first', () => {
    expect(allocateSale(lots, 12, 'lifo').allocs.map((a) => [a.lot.id, a.shares])).toEqual([[3, 10], [2, 2]]);
  });
  it('highest cost takes the most expensive shares first', () => {
    expect(allocateSale(lots, 12, 'hifo').allocs.map((a) => [a.lot.id, a.shares])).toEqual([[2, 10], [3, 2]]);
  });
  it('average cost spreads the sale over every lot in proportion', () => {
    const { allocs } = allocateSale(lots, 15, 'average');
    expect(allocs.map((a) => a.shares)).toEqual([5, 5, 5]);
    expect(allocs.reduce((a, x) => a + x.basisCents, 0)).toBe($(4500) / 2);
  });
  it('specific lots use exactly what you pick', () => {
    const r = allocateSale(lots, 8, 'specific', { 2: 5, 3: 3 });
    expect(r.allocs.map((a) => [a.lot.id, a.shares])).toEqual([[2, 5], [3, 3]]);
    expect(r.shortfall).toBe(0);
    expect(allocateSale(lots, 8, 'specific', { 2: 5 }).shortfall).toBe(3);
  });
  it('reports a shortfall when there are not enough shares', () => {
    expect(allocateSale(lots, 40, 'fifo').shortfall).toBe(10);
  });
  it('an unknown purchase date is treated as the oldest', () => {
    const mixed = [lot(1, '2020-01-01', 5, 100), lot(2, null, 5, 100)];
    expect(allocateSale(mixed, 5, 'fifo').allocs[0].lot.id).toBe(2);
  });
});

describe('gain and loss', () => {
  const lots = [lot(1, '2023-01-10', 10, 1000), lot(2, '2025-11-01', 10, 1500)];
  it('splits the gain between long and short term by lot', () => {
    const p = previewSale(lots, { shares: 20, pricePerShareCents: $(200), feesCents: 0, date: '2026-03-01', method: 'fifo' });
    expect(p.proceedsCents).toBe($(4000));
    expect(p.basisCents).toBe($(2500));
    expect(p.gainCents).toBe($(1500));
    expect(p.longTermCents).toBe($(2000) - $(1000));
    expect(p.shortTermCents).toBe($(2000) - $(1500));
    expect(p.longTermCents + p.shortTermCents).toBe(p.gainCents);
  });
  it('fees reduce proceeds and so the gain', () => {
    const p = previewSale(lots, { shares: 10, pricePerShareCents: $(200), feesCents: $(10), date: '2026-03-01', method: 'fifo' });
    expect(p.proceedsCents).toBe($(1990));
    expect(p.gainCents).toBe($(990));
  });
  it('a loss is negative', () => {
    const p = previewSale(lots, { shares: 10, pricePerShareCents: $(100), feesCents: 0, date: '2026-03-01', method: 'lifo' });
    expect(p.gainCents).toBe($(1000) - $(1500));
    expect(p.shortTermCents).toBe(p.gainCents);
  });
  it('choosing lots changes the tax result', () => {
    const base = { shares: 10, pricePerShareCents: $(200), feesCents: 0, date: '2026-03-01' };
    const fifo = previewSale(lots, { ...base, method: 'fifo' });
    const hifo = previewSale(lots, { ...base, method: 'hifo' });
    expect(hifo.gainCents).toBeLessThan(fifo.gainCents);
  });
});

describe('tax netting', () => {
  it('a short-term loss offsets a long-term gain', () => {
    expect(netForTax({ shortTermCents: -$(2000), longTermCents: $(5000), netCents: 0, proceedsCents: 0, count: 2 })).toEqual({ stcgCents: 0, ltcgCents: $(3000), lossDeductionCents: 0 });
  });
  it('a long-term loss offsets a short-term gain', () => {
    expect(netForTax({ shortTermCents: $(1000), longTermCents: -$(400), netCents: 0, proceedsCents: 0, count: 2 })).toEqual({ stcgCents: $(600), ltcgCents: 0, lossDeductionCents: 0 });
  });
  it('a net loss is deductible up to $3,000', () => {
    expect(netForTax({ shortTermCents: -$(2000), longTermCents: -$(5000), netCents: 0, proceedsCents: 0, count: 2 }).lossDeductionCents).toBe($(3000));
    expect(netForTax({ shortTermCents: -$(1000), longTermCents: $(400), netCents: 0, proceedsCents: 0, count: 2 }).lossDeductionCents).toBe($(600));
  });
});

describe('recording lots, buys, and sales', () => {
  let d: FinanceDB;
  let n = 0;
  let taxable: number;
  let ira: number;
  const acct = (name: string, kind: InvAccount['kind'], taxType: InvAccount['taxType']): InvAccount => ({
    name, kind, taxType, cashCents: $(1000), annualContributionCents: 0, contributionGrowthPct: 0, linkToIncome: false,
  });
  beforeEach(async () => {
    d = new FinanceDB(`lots-${n++}`);
    taxable = await d.invAccounts.add(acct('Brokerage', 'brokerage', 'taxable'));
    ira = await d.invAccounts.add(acct('IRA', 'ira', 'traditional'));
    await d.assetClasses.add({ name: 'x', kind: 'equity', expectedReturnPct: 7, volatilityPct: 15 });
    await d.securities.add({ ticker: 'AAA', name: 'A', assetClassId: 1, priceCents: $(100), priceDate: null, priceSource: null });
  });
  const holding = async (accountId: number) => d.holdings.where('accountId').equals(accountId).first();

  it('an existing holding becomes one opening lot that you can then edit', async () => {
    const hid = await d.holdings.add({ accountId: taxable, securityId: 1, shares: 30, costBasisCents: $(2400) });
    await ensureLots(d, hid);
    await ensureLots(d, hid); // idempotent
    const lots = await d.taxLots.toArray();
    expect(lots).toHaveLength(1);
    expect(lots[0]).toMatchObject({ shares: 30, costBasisCents: $(2400), acquiredDate: null, source: 'opening' });
    await updateLot(d, lots[0].id!, { costBasisCents: $(2600), acquiredDate: '2022-05-01' });
    expect((await holding(taxable))!.costBasisCents).toBe($(2600));
  });

  it('buys add lots with fees in the basis, and the holding follows the lots', async () => {
    await recordBuy(d, { accountId: taxable, securityId: 1, date: '2026-01-05', shares: 10, pricePerShareCents: $(50), feesCents: $(5) });
    await recordBuy(d, { accountId: taxable, securityId: 1, date: '2026-02-05', shares: 5, pricePerShareCents: $(60), reinvested: true });
    const h = (await holding(taxable))!;
    expect(h.shares).toBe(15);
    expect(h.costBasisCents).toBe($(505) + $(300));
    expect((await d.taxLots.toArray()).map((l) => l.source)).toEqual(['buy', 'reinvest']);
  });

  it('a buy can take its cost from the account’s cash, never below zero', async () => {
    await recordBuy(d, { accountId: taxable, securityId: 1, date: '2026-01-05', shares: 10, pricePerShareCents: $(50), takeFromCash: true });
    expect((await d.invAccounts.get(taxable))!.cashCents).toBe($(500));
    await recordBuy(d, { accountId: taxable, securityId: 1, date: '2026-01-06', shares: 100, pricePerShareCents: $(50), takeFromCash: true });
    expect((await d.invAccounts.get(taxable))!.cashCents).toBe(0);
  });

  it('a sale in a taxable account takes the chosen lots and records the gain', async () => {
    await recordBuy(d, { accountId: taxable, securityId: 1, date: '2024-01-05', shares: 10, pricePerShareCents: $(50) });
    await recordBuy(d, { accountId: taxable, securityId: 1, date: '2026-02-05', shares: 10, pricePerShareCents: $(80) });
    const r = await recordSale(d, { accountId: taxable, securityId: 1, date: '2026-06-01', shares: 15, pricePerShareCents: $(100), method: 'fifo' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.sale.proceedsCents).toBe($(1500));
    expect(r.sale.basisCents).toBe($(500) + $(400));
    expect(r.sale.longTermCents).toBe($(1000) - $(500));
    expect(r.sale.shortTermCents).toBe($(500) - $(400));
    const lots = await d.taxLots.toArray();
    expect(lots).toHaveLength(1);
    expect(lots[0]).toMatchObject({ shares: 5, costBasisCents: $(400) });
    const h = (await holding(taxable))!;
    expect(h.shares).toBe(5);
    expect(h.costBasisCents).toBe($(400));
  });

  it('selling everything removes the holding', async () => {
    await recordBuy(d, { accountId: taxable, securityId: 1, date: '2024-01-05', shares: 10, pricePerShareCents: $(50) });
    await recordSale(d, { accountId: taxable, securityId: 1, date: '2026-06-01', shares: 10, pricePerShareCents: $(100), method: 'fifo' });
    expect(await d.holdings.count()).toBe(0);
    expect(await d.taxLots.count()).toBe(0);
    expect(await d.sales.count()).toBe(1);
  });

  it('proceeds can be added to cash', async () => {
    await recordBuy(d, { accountId: taxable, securityId: 1, date: '2024-01-05', shares: 10, pricePerShareCents: $(50) });
    const r = await recordSale(d, { accountId: taxable, securityId: 1, date: '2026-06-01', shares: 4, pricePerShareCents: $(100), feesCents: $(2), method: 'fifo', addToCash: true });
    expect(r.ok && r.sale.toCashCents).toBe($(398));
    expect((await d.invAccounts.get(taxable))!.cashCents).toBe($(1000) + $(398));
  });

  it('refuses to sell more than is held or to leave a specific sale short', async () => {
    await recordBuy(d, { accountId: taxable, securityId: 1, date: '2024-01-05', shares: 10, pricePerShareCents: $(50) });
    expect(await recordSale(d, { accountId: taxable, securityId: 1, date: '2026-06-01', shares: 11, pricePerShareCents: $(100), method: 'fifo' })).toMatchObject({ ok: false });
    const lotId = (await d.taxLots.toArray())[0].id!;
    expect(await recordSale(d, { accountId: taxable, securityId: 1, date: '2026-06-01', shares: 5, pricePerShareCents: $(100), method: 'specific', specific: { [lotId]: 2 } })).toMatchObject({ ok: false });
    expect(await d.sales.count()).toBe(0);
    expect((await holding(taxable))!.shares).toBe(10);
  });

  it('a sale in a retirement account only reduces the holding: no gain, no tax', async () => {
    await d.holdings.add({ accountId: ira, securityId: 1, shares: 20, costBasisCents: $(1000) });
    const r = await recordSale(d, { accountId: ira, securityId: 1, date: '2026-06-01', shares: 5, pricePerShareCents: $(100), method: 'fifo' });
    expect(r.ok && r.sale.taxable).toBe(false);
    expect(r.ok && r.sale.gainCents).toBe(0);
    const h = (await holding(ira))!;
    expect(h.shares).toBe(15);
    expect(h.costBasisCents).toBe($(750));
    expect(await d.taxLots.count()).toBe(0);
    expect(realizedFor(await d.sales.toArray(), 2026).count).toBe(0);
  });

  it('undoing a sale puts the shares back in their lots, even a lot that was used up', async () => {
    await recordBuy(d, { accountId: taxable, securityId: 1, date: '2024-01-05', shares: 10, pricePerShareCents: $(50) });
    await recordBuy(d, { accountId: taxable, securityId: 1, date: '2026-02-05', shares: 10, pricePerShareCents: $(80) });
    const before = (await holding(taxable))!;
    const r = await recordSale(d, { accountId: taxable, securityId: 1, date: '2026-06-01', shares: 15, pricePerShareCents: $(100), method: 'fifo', addToCash: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(await undoSale(d, r.sale.id!)).toBe(true);
    const after = (await holding(taxable))!;
    expect(after.shares).toBe(before.shares);
    expect(after.costBasisCents).toBe(before.costBasisCents);
    expect(await d.sales.count()).toBe(0);
    expect((await d.invAccounts.get(taxable))!.cashCents).toBe($(1000));
    const dates = (await d.taxLots.toArray()).map((l) => l.acquiredDate).sort();
    expect(dates).toEqual(['2024-01-05', '2026-02-05']);
  });

  it('deleting a lot lowers the holding', async () => {
    await recordBuy(d, { accountId: taxable, securityId: 1, date: '2024-01-05', shares: 10, pricePerShareCents: $(50) });
    await recordBuy(d, { accountId: taxable, securityId: 1, date: '2026-02-05', shares: 10, pricePerShareCents: $(80) });
    await deleteLot(d, (await d.taxLots.toArray())[0].id!);
    expect((await holding(taxable))!.shares).toBe(10);
  });

  it('added shares in a retirement account just add to the holding', async () => {
    await addLot(d, { accountId: ira, securityId: 1, acquiredDate: '2026-01-01', shares: 3, costBasisCents: $(300), source: 'buy' });
    await addLot(d, { accountId: ira, securityId: 1, acquiredDate: '2026-02-01', shares: 2, costBasisCents: $(200), source: 'buy' });
    expect(await d.taxLots.count()).toBe(0);
    expect((await holding(ira))).toMatchObject({ shares: 5, costBasisCents: $(500) });
  });

  it('year totals count only taxable sales in that year', async () => {
    await recordBuy(d, { accountId: taxable, securityId: 1, date: '2020-01-05', shares: 20, pricePerShareCents: $(50) });
    await recordSale(d, { accountId: taxable, securityId: 1, date: '2025-12-30', shares: 2, pricePerShareCents: $(100), method: 'fifo' });
    await recordSale(d, { accountId: taxable, securityId: 1, date: '2026-01-30', shares: 4, pricePerShareCents: $(100), method: 'fifo' });
    await recordSale(d, { accountId: taxable, securityId: 1, date: '2026-05-30', shares: 4, pricePerShareCents: $(40), method: 'fifo' });
    const r = realizedFor(await d.sales.toArray(), 2026);
    expect(r.count).toBe(2);
    expect(r.longTermCents).toBe($(200) + -$(40));
    expect(r.netCents).toBe(r.longTermCents);
  });

  it('lots and sales survive a backup', async () => {
    await recordBuy(d, { accountId: taxable, securityId: 1, date: '2024-01-05', shares: 10, pricePerShareCents: $(50) });
    await recordSale(d, { accountId: taxable, securityId: 1, date: '2026-06-01', shares: 4, pricePerShareCents: $(100), method: 'fifo' });
    const file = await exportAll(d);
    await d.taxLots.clear();
    await d.sales.clear();
    await importAll(d, file);
    expect(await d.taxLots.count()).toBe(1);
    expect(await d.sales.count()).toBe(1);
  });
});
