import { describe, expect, it } from 'vitest';
import { FinanceDB, seedAssetClassesIfEmpty } from '../db';
import type { AssetClass, Holding, InvAccount, Security } from '../types';
import { allocationFor, gainLoss, holdingValue, summarize } from './investments';
import { applyPrices, fetchPrice, fetchPrices } from './prices';
import {
  choleskyWithFallback,
  cholesky,
  lognormalFromGeometric,
  mulberry32,
  probAtLeast,
  realTargetToNominal,
  runMonteCarlo,
  steadyPath,
  toReal,
  type ClassAssumption,
  type ProjAccount,
  type ProjInput,
} from './projection';
import { buildProjection, DEFAULT_PROJECTION } from './projectionInput';
import { exportAll, importAll } from './backup';

const $ = (n: number) => Math.round(n * 100);

const classes: AssetClass[] = [
  { id: 1, name: 'US stocks', kind: 'equity', expectedReturnPct: 7, volatilityPct: 16 },
  { id: 2, name: 'Bonds', kind: 'bond', expectedReturnPct: 4, volatilityPct: 6 },
  { id: 3, name: 'Cash', kind: 'cash', expectedReturnPct: 3, volatilityPct: 1 },
];
const acct = (p: Partial<InvAccount> & Pick<InvAccount, 'id' | 'name'>): InvAccount => ({
  kind: 'brokerage',
  taxType: 'taxable',
  cashCents: 0,
  annualContributionCents: 0,
  contributionGrowthPct: 0,
  linkToIncome: false,
  ...p,
});
const sec = (p: Partial<Security> & Pick<Security, 'id' | 'ticker' | 'assetClassId'>): Security => ({
  name: p.ticker,
  priceCents: $(100),
  priceDate: '2026-10-01',
  priceSource: 'manual',
  ...p,
});
const hold = (accountId: number, securityId: number, shares: number, costBasisCents: number | null = null): Holding => ({ accountId, securityId, shares, costBasisCents });

describe('valuation and allocation', () => {
  const accounts = [acct({ id: 1, name: 'Brokerage', cashCents: $(1000) }), acct({ id: 2, name: '401k', kind: '401k', taxType: 'traditional' })];
  const securities = [sec({ id: 1, ticker: 'VTI', assetClassId: 1 }), sec({ id: 2, ticker: 'BND', assetClassId: 2, priceCents: $(50) }), sec({ id: 3, ticker: 'NOPRICE', assetClassId: 1, priceCents: null })];
  const holdings = [hold(1, 1, 10.5), hold(1, 2, 20), hold(2, 1, 100), hold(2, 3, 5)];
  const p = { accounts, holdings, securities, assetClasses: classes };

  it('values fractional shares, and a missing price counts as zero', () => {
    expect(holdingValue(holdings[0], securities[0])).toBe($(1050));
    expect(holdingValue(holdings[3], securities[2])).toBe(0);
  });

  it('allocates by asset class including uninvested cash', () => {
    const a = allocationFor([1], p);
    const byName = Object.fromEntries(a.map((s) => [s.name, s.cents]));
    expect(byName['US stocks']).toBe($(1050));
    expect(byName['Bonds']).toBe($(1000));
    expect(byName['Cash']).toBe($(1000));
    expect(a.reduce((s, x) => s + x.pct, 0)).toBeCloseTo(100, 6);
  });

  it('all-account allocation and summary totals, with missing prices reported', () => {
    const s = summarize(p);
    expect(s.total).toBe($(1050) + $(1000) + $(1000) + $(10000));
    expect(s.byKind['401k']).toBe($(10000));
    expect(s.missing).toEqual(['NOPRICE']);
    expect(allocationFor('all', p).find((x) => x.name === 'US stocks')!.cents).toBe($(1050) + $(10000));
  });

  it('closed accounts are excluded from totals', () => {
    const s = summarize({ ...p, accounts: [accounts[0], { ...accounts[1], closed: true }] });
    expect(s.total).toBe($(1050) + $(1000) + $(1000));
  });

  it('gain/loss needs cost basis and a price', () => {
    expect(gainLoss(hold(1, 1, 10, $(800)), securities[0])).toBe($(1000) - $(800));
    expect(gainLoss(hold(1, 1, 10), securities[0])).toBeNull();
    expect(gainLoss(hold(1, 3, 10, $(800)), securities[2])).toBeNull();
  });
});

describe('prices', () => {
  const ok = (body: unknown) => async () => ({ status: 200, json: async () => body });

  it('parses a price and rejects bad responses', async () => {
    expect(await fetchPrice('AAPL', 'k', ok({ price: '339.09' }))).toEqual({ ticker: 'AAPL', cents: 33909 });
    expect((await fetchPrice('X', 'k', ok({ code: 401, status: 'error', message: 'bad' }))).error).toBe('API key rejected');
    expect((await fetchPrice('X', 'k', ok({ code: 429, status: 'error', message: 'slow' }))).error).toContain('Rate limit');
    expect((await fetchPrice('X', 'k', ok({ code: 400, status: 'error', message: 'symbol not found' }))).error).toBe('symbol not found');
    expect((await fetchPrice('X', 'k', ok({ price: 'abc' }))).error).toBeTruthy();
    expect((await fetchPrice('X', 'k', async () => { throw new Error('offline'); })).error).toContain('offline');
  });

  it('puts the key in the request and encodes the symbol', async () => {
    let seen = '';
    await fetchPrice('BRK.B', 'my key', async (u) => { seen = u; return { status: 200, json: async () => ({ price: '1' }) }; });
    expect(seen).toContain('symbol=BRK.B');
    expect(seen).toContain('apikey=my%20key');
  });

  it('waits out the per-minute limit after every 8 requests, and stops on a rejected key', async () => {
    const sleeps: number[] = [];
    const tickers = Array.from({ length: 10 }, (_, i) => `T${i}`);
    const res = await fetchPrices(tickers, 'k', { fetchImpl: ok({ price: '1' }), sleep: async (ms) => void sleeps.push(ms) });
    expect(res).toHaveLength(10);
    expect(sleeps).toEqual([61000]);

    const bad = await fetchPrices(tickers, 'k', { fetchImpl: ok({ code: 401, status: 'error', message: '' }), sleep: async () => {} });
    expect(bad).toHaveLength(1);
  });

  it('dedupes tickers and writes prices onto matching securities', async () => {
    const d = new FinanceDB('prices-1');
    await d.securities.bulkAdd([
      { ticker: 'vti', name: 'a', assetClassId: 1, priceCents: null, priceDate: null, priceSource: null },
      { ticker: 'VTI', name: 'b', assetClassId: 1, priceCents: null, priceDate: null, priceSource: null },
    ]);
    const res = await fetchPrices(['vti', 'VTI'], 'k', { fetchImpl: ok({ price: '250.5' }) });
    expect(res).toHaveLength(1);
    expect(await applyPrices(d, res)).toBe(2);
    expect((await d.securities.toArray()).every((s) => s.priceCents === 25050 && s.priceSource === 'api')).toBe(true);
  });
});

describe('projection engine', () => {
  const cls: ClassAssumption[] = [
    { id: 1, name: 'Stocks', kind: 'equity', mu: 0.07, sigma: 0.16 },
    { id: 2, name: 'Bonds', kind: 'bond', mu: 0.04, sigma: 0.06 },
  ];
  const account = (p: Partial<ProjAccount> = {}): ProjAccount => ({
    id: 1,
    name: 'A',
    kind: 'brokerage',
    startCents: $(100000),
    weights: new Map([[1, 1]]),
    contribution: () => 0,
    ...p,
  });
  const input = (accounts: ProjAccount[], years = 10, c = cls): ProjInput => ({ accounts, classes: c, years, inflation: 0.025 });

  it('steady path compounds the average return', () => {
    const s = steadyPath(input([account()]));
    expect(s.total[0]).toBe($(100000));
    expect(s.total[10]).toBeCloseTo($(100000) * Math.pow(1.07, 10), 0);
  });

  it('contributions arrive mid-year', () => {
    const s = steadyPath(input([account({ startCents: 0, contribution: () => $(10000) })], 1));
    expect(s.total[1]).toBeCloseTo((0 + $(5000)) * 1.07 + $(5000), 4);
  });

  it('blends account returns by weight', () => {
    const s = steadyPath(input([account({ weights: new Map([[1, 0.5], [2, 0.5]]) })], 1));
    expect(s.total[1]).toBeCloseTo($(100000) * 1.055, 4);
  });

  it('with zero volatility the simulation equals the steady path', () => {
    const flat = cls.map((c) => ({ ...c, sigma: 0 }));
    const inp = input([account({ contribution: (t) => $(5000) * t })], 12, flat);
    const mc = runMonteCarlo(inp, 200, 7);
    const st = steadyPath(inp);
    for (let t = 0; t <= 12; t++) {
      expect(mc.p10[t]).toBeCloseTo(st.total[t], 3);
      expect(mc.p90[t]).toBeCloseTo(st.total[t], 3);
    }
  });

  it('is reproducible from its seed and differs between seeds', () => {
    const inp = input([account()], 15);
    const a = runMonteCarlo(inp, 500, 42);
    const b = runMonteCarlo(inp, 500, 42);
    const c = runMonteCarlo(inp, 500, 43);
    expect(a.p50).toEqual(b.p50);
    expect(a.p50).not.toEqual(c.p50);
  });

  it('percentiles are ordered, the range widens over time, and the median sits below the mean (volatility drag)', () => {
    const mc = runMonteCarlo(input([account()], 25), 4000, 3);
    for (let t = 1; t <= 25; t++) {
      expect(mc.p10[t]).toBeLessThanOrEqual(mc.p25[t]);
      expect(mc.p25[t]).toBeLessThanOrEqual(mc.p50[t]);
      expect(mc.p50[t]).toBeLessThanOrEqual(mc.p75[t]);
      expect(mc.p75[t]).toBeLessThanOrEqual(mc.p90[t]);
    }
    expect(mc.p90[25] - mc.p10[25]).toBeGreaterThan(mc.p90[5] - mc.p10[5]);
    expect(mc.p50[25]).toBeLessThan(mc.mean[25]);
  });

  it('the typical (median) simulated outcome tracks the steady path, since the input is a compound return', () => {
    const inp = input([account()], 10);
    const mc = runMonteCarlo(inp, 30000, 11);
    const st = steadyPath(inp);
    expect(Math.abs(mc.p50[10] / st.total[10] - 1)).toBeLessThan(0.03);
    // The average outcome is pulled above the typical one by the lucky futures.
    expect(mc.mean[10]).toBeGreaterThan(st.total[10]);
  });

  it('lognormalFromGeometric: median growth is the compound return, and the yearly spread is the stated volatility', () => {
    for (const [g, sd] of [[0.0882, 0.1792], [0.0372, 0.0472], [0.0887, 0.2769], [0, 0], [0.03, 0.01]]) {
      const { lnMu, lnS } = lognormalFromGeometric(g, sd);
      expect(Math.exp(lnMu) - 1).toBeCloseTo(g, 10);
      const mean = Math.exp(lnMu + (lnS * lnS) / 2);
      const sdOut = Math.sqrt((Math.exp(lnS * lnS) - 1) * Math.exp(2 * lnMu + lnS * lnS));
      expect(sdOut).toBeCloseTo(sd, 8);
      expect(mean - 1).toBeGreaterThanOrEqual(g - 1e-12); // arithmetic average is never below the compound return
    }
  });

  it('losses are bounded: a portfolio can never go below zero', () => {
    const wild: ClassAssumption[] = [{ id: 1, name: 'W', kind: 'other', mu: 0.05, sigma: 0.9 }];
    const mc = runMonteCarlo(input([account()], 20, wild), 2000, 5);
    expect(Math.min(...mc.paths)).toBeGreaterThan(0);
  });

  it('probability of reaching a target falls as the target rises', () => {
    const mc = runMonteCarlo(input([account()], 20), 3000, 9);
    expect(probAtLeast(mc, 20, 0)).toBe(1);
    const lo = probAtLeast(mc, 20, $(150000));
    const hi = probAtLeast(mc, 20, $(600000));
    expect(lo).toBeGreaterThan(hi);
    expect(probAtLeast(mc, 20, $(1e12))).toBe(0);
  });

  it('more diversification lowers dispersion (same total return, imperfect correlation)', () => {
    const equalMu: ClassAssumption[] = [
      { id: 1, name: 'A', kind: 'equity', mu: 0.07, sigma: 0.16 },
      { id: 2, name: 'B', kind: 'bond', mu: 0.07, sigma: 0.16 },
    ];
    const concentrated = runMonteCarlo(input([account()], 15, equalMu), 4000, 2);
    const mixed = runMonteCarlo(input([account({ weights: new Map([[1, 0.5], [2, 0.5]]) })], 15, equalMu), 4000, 2);
    const spread = (r: typeof mixed) => r.p90[15] - r.p10[15];
    expect(spread(mixed)).toBeLessThan(spread(concentrated));
  });

  it('real conversion and real targets', () => {
    const real = toReal([100, 102.5], 0.025);
    expect(real[0]).toBe(100);
    expect(real[1]).toBeCloseTo(100, 9);
    expect(realTargetToNominal(1000, 0.025, 2)).toBeCloseTo(1050.625, 6);
  });

  it('Cholesky handles the defaults and recovers from an invalid matrix', () => {
    const all: ClassAssumption[] = (['equity', 'bond', 'cash', 'real_estate', 'balanced', 'other'] as const).map((k, i) => ({ id: i, name: k, kind: k, mu: 0.05, sigma: 0.1 }));
    expect(choleskyWithFallback(all)).toHaveLength(6);
    expect(cholesky([[1, 0.99, -0.99], [0.99, 1, 0.99], [-0.99, 0.99, 1]])).toBeNull();
    const rnd = mulberry32(1);
    expect(rnd()).toBeGreaterThanOrEqual(0);
  });

  it('empty or zero-value portfolios do not break the simulation', () => {
    const mc = runMonteCarlo(input([account({ startCents: 0 })], 5), 100, 1);
    expect(mc.p50.every((v) => v === 0)).toBe(true);
  });
});

describe('projection input from holdings', () => {
  const accounts = [
    acct({ id: 1, name: 'Brokerage', annualContributionCents: $(12000), contributionGrowthPct: 3 }),
    acct({ id: 2, name: 'Empty IRA', kind: 'ira', taxType: 'roth', annualContributionCents: $(7000) }),
    acct({ id: 3, name: '401k', kind: '401k', taxType: 'traditional', linkToIncome: true, personId: 9 }),
  ];
  const securities = [sec({ id: 1, ticker: 'VTI', assetClassId: 1 }), sec({ id: 2, ticker: 'BND', assetClassId: 2 })];
  const holdings = [hold(1, 1, 80), hold(1, 2, 20)]; // 80/20 by value at $100 each
  const incomeYears = [
    { personId: 9, contributions: { k401Pretax: $(20000), k401Roth: $(2000), employerMatch: $(5000), hsa: 0, employerHsa: 0, espp: 0 } },
  ] as never[];

  it('derives weights from holdings, grows contributions, links 401k to income, and warns about gaps', () => {
    const b = buildProjection({ accounts, holdings, securities, assetClasses: classes }, incomeYears, DEFAULT_PROJECTION);
    const brokerage = b.input.accounts.find((a) => a.id === 1)!;
    expect(brokerage.weights.get(1)).toBeCloseTo(0.8, 6);
    expect(brokerage.contribution(1)).toBe($(12000));
    expect(brokerage.contribution(3)).toBeCloseTo($(12000) * 1.03 ** 2, 4);
    const ira = b.input.accounts.find((a) => a.id === 2)!;
    expect(ira.weights.get(1)).toBeCloseTo(0.8, 6); // empty account follows the portfolio mix
    expect(b.input.accounts.find((a) => a.id === 3)!.contribution(1)).toBe($(27000));
    expect(b.warnings.join(' ')).toContain('Empty IRA');
  });

  it('warns when a linked 401(k) has no income model', () => {
    const b = buildProjection({ accounts, holdings, securities, assetClasses: classes }, [], DEFAULT_PROJECTION);
    expect(b.warnings.join(' ')).toContain('no income model');
  });
});

describe('investments persistence', () => {
  it('seeds default asset classes once, and backup round-trips investments but never the API key', async () => {
    const d = new FinanceDB('inv-1');
    await seedAssetClassesIfEmpty(d);
    await seedAssetClassesIfEmpty(d);
    expect(await d.assetClasses.count()).toBe(10);
    await d.invAccounts.add(acct({ name: 'B' }));
    await d.settings.put({ key: 'priceApiKey', value: 'SECRET' });
    await d.settings.put({ key: 'projection', value: { years: 20 } });

    const data = await exportAll(d);
    expect(JSON.stringify(data)).not.toContain('SECRET');

    const d2 = new FinanceDB('inv-2');
    await d2.settings.put({ key: 'priceApiKey', value: 'LOCAL-KEY' });
    await importAll(d2, JSON.parse(JSON.stringify(data)));
    expect(await d2.invAccounts.count()).toBe(1);
    expect(await d2.assetClasses.count()).toBe(10);
    expect((await d2.settings.get('projection'))?.value).toEqual({ years: 20 });
    expect((await d2.settings.get('priceApiKey'))?.value).toBe('LOCAL-KEY'); // restore keeps this device's key
  });
});

describe('manual price override', () => {
  const setup = async () => {
    const d = new FinanceDB(`manual-price-${Math.random()}`);
    const id = await d.securities.add({ ticker: 'VTSAX', name: 'Total Market', assetClassId: 1, priceCents: null, priceDate: null, priceSource: null });
    return { d, id };
  };
  const ok = (body: unknown) => async () => ({ status: 200, json: async () => body });

  it('parses typed prices, rejects junk, and treats empty as a clear', async () => {
    const { parsePriceInput } = await import('./prices');
    expect(parsePriceInput('123.45')).toEqual({ ok: true, cents: 12345 });
    expect(parsePriceInput(' $1,234.5 ')).toEqual({ ok: true, cents: 123450 });
    expect(parsePriceInput('')).toEqual({ ok: true, cents: null });
    expect(parsePriceInput('abc').ok).toBe(false);
    expect(parsePriceInput('0').ok).toBe(false);
    expect(parsePriceInput('-5').ok).toBe(false);
  });

  it('stores a manual price with its source and date', async () => {
    const { d, id } = await setup();
    const { setManualPrice } = await import('./prices');
    expect(await setManualPrice(d, id, '98.76')).toEqual({ ok: true, cents: 9876 });
    const s = (await d.securities.get(id))!;
    expect(s).toMatchObject({ priceCents: 9876, priceSource: 'manual' });
    expect(s.priceDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('invalid text is rejected and leaves the stored price alone (regression: it used to clear it)', async () => {
    const { d, id } = await setup();
    const { setManualPrice } = await import('./prices');
    await setManualPrice(d, id, '50');
    const r = await setManualPrice(d, id, 'fifty');
    expect(r.ok).toBe(false);
    expect((await d.securities.get(id))!.priceCents).toBe(5000);
  });

  it('an empty box clears the price on purpose', async () => {
    const { d, id } = await setup();
    const { setManualPrice } = await import('./prices');
    await setManualPrice(d, id, '50');
    await setManualPrice(d, id, '');
    expect(await d.securities.get(id)).toMatchObject({ priceCents: null, priceSource: null, priceDate: null });
  });

  it('a later refresh overwrites the manual price, but a ticker the API cannot price keeps it', async () => {
    const { d, id } = await setup();
    const { setManualPrice } = await import('./prices');
    await setManualPrice(d, id, '50');

    const failed = await fetchPrices(['VTSAX'], 'k', { fetchImpl: ok({ code: 400, status: 'error', message: 'symbol not found' }) });
    await applyPrices(d, failed);
    expect(await d.securities.get(id)).toMatchObject({ priceCents: 5000, priceSource: 'manual' });

    const good = await fetchPrices(['VTSAX'], 'k', { fetchImpl: ok({ price: '120.10' }) });
    await applyPrices(d, good);
    expect(await d.securities.get(id)).toMatchObject({ priceCents: 12010, priceSource: 'api' });
  });
});
