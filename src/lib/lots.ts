import type { FinanceDB } from '../db';
import type { Holding, InvAccount, Sale, SaleLot, SaleMethod, TaxLot } from '../types';

/**
 * Cost basis by tax lot and realized gains.
 *  - In taxable accounts a holding is a set of lots (date, shares, cost). Its shares and basis are the sums of its lots.
 *  - Selling takes shares from lots by a method (FIFO, LIFO, highest cost, average cost, or lots you pick), and records the
 *    gain split into short term (held a year or less) and long term.
 *  - In IRAs, 401(k)s, Roths, HSAs, and 529s a sale just reduces the holding: no gain is calculated and nothing is taxed.
 * Wash sales are not modeled. Money in cents; shares may be fractional.
 */

const EPS = 1e-9;
const same = (a: number, b: number) => Math.abs(a - b) < EPS;

export const isTaxable = (a: InvAccount | undefined): boolean => a?.taxType === 'taxable';

/** Held more than one year: the sale date is after the first anniversary of the purchase. Unknown purchase dates count as long-term. */
export function isLongTerm(acquired: string | null, sold: string): boolean {
  if (!acquired) return true;
  const y = Number(acquired.slice(0, 4));
  const anniversary = `${String(y + 1).padStart(4, '0')}${acquired.slice(4)}`;
  // Feb 29 purchases: the anniversary falls on Mar 1 in non-leap years.
  const fixed = anniversary.endsWith('-02-29') && !isLeap(y + 1) ? `${y + 1}-03-01` : anniversary;
  return sold > fixed;
}
const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

export interface Allocation {
  lot: TaxLot;
  shares: number;
  basisCents: number;
}

/** Splits `shares` over lots by the method. Returns what could not be covered if there are not enough shares. */
export function allocateSale(
  lots: TaxLot[],
  shares: number,
  method: SaleMethod,
  specific: Record<number, number> = {},
): { allocs: Allocation[]; shortfall: number } {
  const take = (lot: TaxLot, n: number): Allocation => ({
    lot,
    shares: n,
    basisCents: same(n, lot.shares) ? lot.costBasisCents : Math.round((lot.costBasisCents * n) / lot.shares),
  });
  const total = lots.reduce((a, l) => a + l.shares, 0);
  if (method === 'specific') {
    const allocs: Allocation[] = [];
    let got = 0;
    for (const lot of lots) {
      const n = Math.min(specific[lot.id!] ?? 0, lot.shares);
      if (n > EPS) {
        allocs.push(take(lot, n));
        got += n;
      }
    }
    return { allocs, shortfall: Math.max(0, shares - got) };
  }
  if (method === 'average') {
    const n = Math.min(shares, total);
    const allocs: Allocation[] = [];
    let left = n;
    lots.forEach((lot, i) => {
      const part = i === lots.length - 1 ? left : (n * lot.shares) / total;
      const t = Math.min(part, lot.shares);
      left -= t;
      if (t > EPS) allocs.push(take(lot, t));
    });
    return { allocs, shortfall: Math.max(0, shares - total) };
  }
  const key = (l: TaxLot) => l.acquiredDate ?? '0000-00-00';
  const order = [...lots].sort((a, b) => {
    if (method === 'fifo') return key(a).localeCompare(key(b)) || (a.id ?? 0) - (b.id ?? 0);
    if (method === 'lifo') return key(b).localeCompare(key(a)) || (b.id ?? 0) - (a.id ?? 0);
    return b.costBasisCents / b.shares - a.costBasisCents / a.shares || key(a).localeCompare(key(b)); // hifo
  });
  const allocs: Allocation[] = [];
  let left = shares;
  for (const lot of order) {
    if (left <= EPS) break;
    const n = Math.min(left, lot.shares);
    allocs.push(take(lot, n));
    left -= n;
  }
  return { allocs, shortfall: Math.max(0, left) };
}

export interface SalePreview {
  allocs: Allocation[];
  shortfall: number;
  proceedsCents: number;
  basisCents: number;
  gainCents: number;
  shortTermCents: number;
  longTermCents: number;
  lots: SaleLot[];
}

/** What a sale would do, without saving anything. Proceeds are net of fees. */
export function previewSale(lots: TaxLot[], input: { shares: number; pricePerShareCents: number; feesCents: number; date: string; method: SaleMethod; specific?: Record<number, number> }): SalePreview {
  const { allocs, shortfall } = allocateSale(lots, input.shares, input.method, input.specific);
  const sold = allocs.reduce((a, x) => a + x.shares, 0);
  const proceeds = Math.round(sold * input.pricePerShareCents) - input.feesCents;
  const basis = allocs.reduce((a, x) => a + x.basisCents, 0);
  let short = 0;
  let long = 0;
  let given = 0;
  const out: SaleLot[] = [];
  allocs.forEach((x, i) => {
    const part = i === allocs.length - 1 ? proceeds - given : Math.round((proceeds * x.shares) / sold);
    given += part;
    const gain = part - x.basisCents;
    const lt = isLongTerm(x.lot.acquiredDate, input.date);
    if (lt) long += gain;
    else short += gain;
    out.push({ lotId: x.lot.id!, shares: x.shares, basisCents: x.basisCents, acquiredDate: x.lot.acquiredDate, longTerm: lt });
  });
  return { allocs, shortfall, proceedsCents: proceeds, basisCents: basis, gainCents: proceeds - basis, shortTermCents: short, longTermCents: long, lots: out };
}

// ---------- database operations ----------

async function findHolding(d: FinanceDB, accountId: number, securityId: number): Promise<Holding | undefined> {
  return d.holdings.where('accountId').equals(accountId).filter((h) => h.securityId === securityId).first();
}

/** Makes a taxable holding's shares and basis equal to the sum of its lots (deleting the holding when nothing is left). */
export async function syncHolding(d: FinanceDB, holdingId: number): Promise<void> {
  const lots = await d.taxLots.where('holdingId').equals(holdingId).toArray();
  const shares = lots.reduce((a, l) => a + l.shares, 0);
  if (shares <= EPS) {
    await d.holdings.delete(holdingId);
    return;
  }
  await d.holdings.update(holdingId, { shares, costBasisCents: lots.reduce((a, l) => a + l.costBasisCents, 0) });
}

/**
 * A taxable holding that has no lots yet gets one "opening" lot with its current shares and basis (purchase date unknown).
 * The basis is the holding's recorded cost basis; with none recorded it is $0 until you edit it.
 */
export async function ensureLots(d: FinanceDB, holdingId: number): Promise<void> {
  const h = await d.holdings.get(holdingId);
  if (!h || h.shares <= EPS) return;
  if ((await d.taxLots.where('holdingId').equals(holdingId).count()) > 0) return;
  await d.taxLots.add({ holdingId, accountId: h.accountId, securityId: h.securityId, acquiredDate: null, shares: h.shares, costBasisCents: h.costBasisCents ?? 0, source: 'opening' });
}

export interface NewLot {
  accountId: number;
  securityId: number;
  acquiredDate: string | null;
  shares: number;
  costBasisCents: number;
  source: TaxLot['source'];
}

/** Adds shares to an account: a new lot in a taxable account, or more shares and basis on the holding elsewhere. */
export async function addLot(d: FinanceDB, lot: NewLot): Promise<void> {
  await d.transaction('rw', d.holdings, d.taxLots, d.invAccounts, async () => {
    const acct = await d.invAccounts.get(lot.accountId);
    let h = await findHolding(d, lot.accountId, lot.securityId);
    if (!acct || !isTaxable(acct)) {
      // An unknown basis (entered as 0) stays unknown rather than becoming a $0 cost.
      const unknown = lot.costBasisCents === 0 && (!h || h.costBasisCents === null);
      if (h) await d.holdings.update(h.id!, { shares: h.shares + lot.shares, costBasisCents: unknown ? null : (h.costBasisCents ?? 0) + lot.costBasisCents });
      else await d.holdings.add({ accountId: lot.accountId, securityId: lot.securityId, shares: lot.shares, costBasisCents: unknown ? null : lot.costBasisCents });
      return;
    }
    if (!h) {
      const id = await d.holdings.add({ accountId: lot.accountId, securityId: lot.securityId, shares: 0, costBasisCents: 0 });
      h = await d.holdings.get(id);
    } else await ensureLots(d, h.id!);
    await d.taxLots.add({ holdingId: h!.id!, accountId: lot.accountId, securityId: lot.securityId, acquiredDate: lot.acquiredDate, shares: lot.shares, costBasisCents: lot.costBasisCents, source: lot.source });
    await syncHolding(d, h!.id!);
  });
}

export async function updateLot(d: FinanceDB, lotId: number, patch: Partial<Pick<TaxLot, 'acquiredDate' | 'shares' | 'costBasisCents'>>): Promise<void> {
  await d.transaction('rw', d.holdings, d.taxLots, async () => {
    const lot = await d.taxLots.get(lotId);
    if (!lot) return;
    await d.taxLots.update(lotId, patch);
    await syncHolding(d, lot.holdingId);
  });
}

export async function deleteLot(d: FinanceDB, lotId: number): Promise<void> {
  await d.transaction('rw', d.holdings, d.taxLots, async () => {
    const lot = await d.taxLots.get(lotId);
    if (!lot) return;
    await d.taxLots.delete(lotId);
    await syncHolding(d, lot.holdingId);
  });
}

/** Edits a holding's total cost basis (accounts without lots). */
export async function setHoldingBasis(d: FinanceDB, holdingId: number, basisCents: number | null): Promise<void> {
  await d.holdings.update(holdingId, { costBasisCents: basisCents });
}

export interface SaleInput {
  accountId: number;
  securityId: number;
  date: string;
  shares: number;
  pricePerShareCents: number;
  feesCents?: number;
  method: SaleMethod;
  specific?: Record<number, number>;
  note?: string;
  /** Add the net proceeds to the account's cash balance. */
  addToCash?: boolean;
}

export type SaleResult = { ok: true; sale: Sale } | { ok: false; error: string };

export async function recordSale(d: FinanceDB, inp: SaleInput): Promise<SaleResult> {
  if (!(inp.shares > 0)) return { ok: false, error: 'Enter how many shares were sold' };
  if (!(inp.pricePerShareCents > 0)) return { ok: false, error: 'Enter the sale price per share' };
  const fees = inp.feesCents ?? 0;
  return d.transaction('rw', [d.holdings, d.taxLots, d.sales, d.invAccounts], async (): Promise<SaleResult> => {
    const acct = await d.invAccounts.get(inp.accountId);
    const h = await findHolding(d, inp.accountId, inp.securityId);
    if (!acct || !h) return { ok: false, error: 'That holding was not found' };
    if (inp.shares > h.shares + EPS) return { ok: false, error: `Only ${h.shares} shares are held` };
    const proceeds = Math.round(inp.shares * inp.pricePerShareCents) - fees;
    const base = { accountId: inp.accountId, securityId: inp.securityId, date: inp.date, shares: inp.shares, proceedsCents: proceeds, feesCents: fees, method: inp.method, note: inp.note ?? '' };
    const cashAdd = inp.addToCash ? Math.max(0, proceeds) : 0;

    if (!isTaxable(acct)) {
      // No lots and no tax calculation: reduce the holding, scaling its basis if one is recorded.
      const left = h.shares - inp.shares;
      if (left <= EPS) await d.holdings.delete(h.id!);
      else await d.holdings.update(h.id!, { shares: left, costBasisCents: h.costBasisCents === null ? null : Math.round((h.costBasisCents * left) / h.shares) });
      const sale: Sale = { ...base, taxable: false, lots: [], basisCents: 0, gainCents: 0, shortTermCents: 0, longTermCents: 0, toCashCents: cashAdd };
      sale.id = await d.sales.add(sale);
      if (cashAdd) await d.invAccounts.update(acct.id!, { cashCents: acct.cashCents + cashAdd });
      return { ok: true, sale };
    }

    await ensureLots(d, h.id!);
    const lots = await d.taxLots.where('holdingId').equals(h.id!).toArray();
    const pv = previewSale(lots, { shares: inp.shares, pricePerShareCents: inp.pricePerShareCents, feesCents: fees, date: inp.date, method: inp.method, specific: inp.specific });
    if (pv.shortfall > EPS) return { ok: false, error: inp.method === 'specific' ? `Pick lots covering all ${inp.shares} shares (${pv.shortfall.toFixed(4)} still to pick)` : 'Not enough shares in the lots' };
    for (const a of pv.allocs) {
      if (same(a.shares, a.lot.shares)) await d.taxLots.delete(a.lot.id!);
      else await d.taxLots.update(a.lot.id!, { shares: a.lot.shares - a.shares, costBasisCents: a.lot.costBasisCents - a.basisCents });
    }
    await syncHolding(d, h.id!);
    const sale: Sale = { ...base, taxable: true, lots: pv.lots, basisCents: pv.basisCents, gainCents: pv.gainCents, shortTermCents: pv.shortTermCents, longTermCents: pv.longTermCents, toCashCents: cashAdd };
    sale.id = await d.sales.add(sale);
    if (cashAdd) await d.invAccounts.update(acct.id!, { cashCents: acct.cashCents + cashAdd });
    return { ok: true, sale };
  });
}

/** Undoes a logged sale: the shares go back into their lots (recreating a lot that was used up) and cash is restored. */
export async function undoSale(d: FinanceDB, saleId: number): Promise<boolean> {
  return d.transaction('rw', [d.holdings, d.taxLots, d.sales, d.invAccounts], async () => {
    const s = await d.sales.get(saleId);
    if (!s) return false;
    const acct = await d.invAccounts.get(s.accountId);
    let h = await findHolding(d, s.accountId, s.securityId);
    if (!s.taxable) {
      if (h) await d.holdings.update(h.id!, { shares: h.shares + s.shares });
      else await d.holdings.add({ accountId: s.accountId, securityId: s.securityId, shares: s.shares, costBasisCents: null });
    } else {
      if (!h) {
        const id = await d.holdings.add({ accountId: s.accountId, securityId: s.securityId, shares: 0, costBasisCents: 0 });
        h = await d.holdings.get(id);
      }
      for (const l of s.lots) {
        const lot = await d.taxLots.get(l.lotId);
        if (lot) await d.taxLots.update(l.lotId, { shares: lot.shares + l.shares, costBasisCents: lot.costBasisCents + l.basisCents });
        else await d.taxLots.add({ holdingId: h!.id!, accountId: s.accountId, securityId: s.securityId, acquiredDate: l.acquiredDate, shares: l.shares, costBasisCents: l.basisCents, source: 'manual' });
      }
      await syncHolding(d, h!.id!);
    }
    if (acct && s.toCashCents > 0) await d.invAccounts.update(acct.id!, { cashCents: Math.max(0, acct.cashCents - s.toCashCents) });
    await d.sales.delete(saleId);
    return true;
  });
}

export interface BuyInput {
  accountId: number;
  securityId: number;
  date: string;
  shares: number;
  pricePerShareCents: number;
  feesCents?: number;
  reinvested?: boolean;
  /** Take the cost out of the account's cash balance (not below zero). */
  takeFromCash?: boolean;
}

/** Logs a purchase: a new lot in a taxable account (fees add to basis), or more shares elsewhere. */
export async function recordBuy(d: FinanceDB, inp: BuyInput): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!(inp.shares > 0)) return { ok: false, error: 'Enter how many shares were bought' };
  if (!(inp.pricePerShareCents > 0)) return { ok: false, error: 'Enter the price per share' };
  const cost = Math.round(inp.shares * inp.pricePerShareCents) + (inp.feesCents ?? 0);
  await addLot(d, { accountId: inp.accountId, securityId: inp.securityId, acquiredDate: inp.date, shares: inp.shares, costBasisCents: cost, source: inp.reinvested ? 'reinvest' : 'buy' });
  if (inp.takeFromCash) {
    const a = await d.invAccounts.get(inp.accountId);
    if (a) await d.invAccounts.update(a.id!, { cashCents: Math.max(0, a.cashCents - cost) });
  }
  return { ok: true };
}

// ---------- realized gains ----------

export interface Realized {
  shortTermCents: number;
  longTermCents: number;
  netCents: number;
  proceedsCents: number;
  count: number;
}

/** Gains and losses realized in taxable accounts in a calendar year. */
export function realizedFor(sales: Sale[], year: number): Realized {
  const r: Realized = { shortTermCents: 0, longTermCents: 0, netCents: 0, proceedsCents: 0, count: 0 };
  for (const s of sales) {
    if (!s.taxable || !s.date.startsWith(`${year}-`)) continue;
    r.shortTermCents += s.shortTermCents;
    r.longTermCents += s.longTermCents;
    r.proceedsCents += s.proceedsCents;
    r.count++;
  }
  r.netCents = r.shortTermCents + r.longTermCents;
  return r;
}

/**
 * Short and long results net against each other for tax: a net loss in one offsets a gain in the other, and a total loss
 * is deductible against other income up to $3,000 a year (the rest carries forward, which is not tracked here).
 */
export function netForTax(r: Realized): { stcgCents: number; ltcgCents: number; lossDeductionCents: number } {
  let st = r.shortTermCents;
  let lt = r.longTermCents;
  if (st < 0 && lt > 0) {
    const off = Math.min(-st, lt);
    st += off;
    lt -= off;
  } else if (lt < 0 && st > 0) {
    const off = Math.min(-lt, st);
    lt += off;
    st -= off;
  }
  const net = st + lt;
  if (net < 0) return { stcgCents: 0, ltcgCents: 0, lossDeductionCents: Math.min(-net, 300000) };
  return { stcgCents: Math.max(0, st), ltcgCents: Math.max(0, lt), lossDeductionCents: 0 };
}
