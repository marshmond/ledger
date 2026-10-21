import { beforeEach, describe, expect, it } from 'vitest';
import { TAX_2026 as T } from '../data/taxYears';
import { FinanceDB } from '../db';
import { buildIncomeModel, newProfile } from './income';
import { simulatePerson } from './payroll';
import { exportAll, importAll } from './backup';
import { recordHeldVest, resolveVest, vestOutcome, vestProblem, vestsFor } from './rsu';
import type { IncomeProfile, RsuVest, Security } from '../types';

const $ = (n: number) => Math.round(n * 100);
const person = { id: 1, name: 'A', birthYear: 1985 };
const sec = (p: Partial<Security> = {}): Security => ({ id: 7, ticker: 'ACME', name: 'Acme', assetClassId: 1, priceCents: $(50), priceDate: '2026-10-01', priceSource: 'manual', ...p });
const vest = (p: Partial<RsuVest> = {}): RsuVest => ({ id: 1, personId: 1, date: '2026-03-15', grant: '2024 grant', kind: 'stock', shares: 100, securityId: 7, afterVest: 'sold', ...p });
const profile = (p: Partial<IncomeProfile> = {}): IncomeProfile => ({ ...newProfile(1, 2026), salary: [{ effectiveDate: '2026-01-01', annualCents: $(100000) }], ...p });

describe('valuing a vest', () => {
  it('cash vests use the synthetic price and never need a ticker', () => {
    const r = resolveVest(vest({ kind: 'cash', securityId: null, priceCents: $(12.5), shares: 200 }), []);
    expect(r.grossCents).toBe($(2500));
    expect(r.source).toBe('deal');
  });

  it('a cash vest with no price is worth nothing and says why', () => {
    const r = resolveVest(vest({ kind: 'cash', securityId: null, priceCents: null }), []);
    expect(r.grossCents).toBe(0);
    expect(r.warning).toMatch(/no price per share/);
  });

  it('stock vests use the current price until the actual vest price is entered', () => {
    expect(resolveVest(vest(), [sec()]).grossCents).toBe($(5000));
    expect(resolveVest(vest(), [sec()]).source).toBe('current');
    const actual = resolveVest(vest({ priceCents: $(61.25) }), [sec()]);
    expect(actual.grossCents).toBe($(6125));
    expect(actual.source).toBe('actual');
  });

  it('a stock vest with no price anywhere warns instead of guessing', () => {
    const r = resolveVest(vest(), [sec({ priceCents: null })]);
    expect(r.grossCents).toBe(0);
    expect(r.warning).toMatch(/ACME/);
  });

  it('fractional shares round to the cent', () => {
    expect(resolveVest(vest({ shares: 33.333, priceCents: 1001 }), []).grossCents).toBe(Math.round(33.333 * 1001));
  });
});

describe('vests in the payroll model', () => {
  const run = (vests: RsuVest[], p = profile()) => simulatePerson(p, person, [], T, vests.map((v) => resolveVest(v, [sec()])));

  it('a vest is a wage event on its own date, taxed like a bonus by default', () => {
    const y = run([vest()]);
    const e = y.events.find((x) => x.kind === 'rsu')!;
    expect(e.date).toBe('2026-03-15');
    expect(e.gross).toBe($(5000));
    expect(e.fedWithholding).toBe(Math.round($(5000) * T.supplementalFedRate));
    expect(e.stateWithholding).toBe(Math.round($(5000) * T.ma.withholdingRate));
    expect(e.socialSecurity).toBe(Math.round($(5000) * T.ssRate));
    expect(y.totals.rsuGross).toBe($(5000));
    expect(y.totals.bonusGross).toBe(0);
  });

  it('uses the withholding rates you set for the person', () => {
    const y = run([vest()], profile({ rsuWithholding: { fedPct: 30, statePct: 4 } }));
    const e = y.events.find((x) => x.kind === 'rsu')!;
    expect(e.fedWithholding).toBe($(1500));
    expect(e.stateWithholding).toBe($(200));
  });

  it('vests take no 401(k)/ESPP deductions and earn no employer match', () => {
    const p = profile({
      deductions: [{ id: 'k', type: 'k401_pretax', name: '401k', mode: 'percent', value: 10, fedExempt: true, ficaExempt: false, stateExempt: true, appliesToBonus: true }],
      match: { ratePct: 100, upToPctOfPay: 10, trueUp: false, appliesToBonus: true },
    });
    const without = run([], p);
    const withVest = run([vest()], p);
    const e = withVest.events.find((x) => x.kind === 'rsu')!;
    expect(Object.values(e.deductions).reduce((a, b) => a + b, 0)).toBe(0);
    expect(e.employerMatch).toBe(0);
    expect(withVest.contributions.k401Pretax).toBe(without.contributions.k401Pretax);
  });

  it('vests push wages to the Social Security cap (a $100K salary alone never reaches it)', () => {
    const base = run([]);
    const big = run([vest({ priceCents: $(1000), shares: 100 })]); // $100,000 of vest in March
    expect(base.milestones.ssCapDate).toBeNull();
    expect(big.milestones.ssCapDate).not.toBeNull();
    expect(big.totals.socialSecurity).toBeLessThanOrEqual(Math.round(T.ssWageBase * T.ssRate) + 1);
  });

  it('ignores another person, another year, and unpriced vests (with a warning)', () => {
    const y = run([vest({ personId: 2 }), vest({ id: 2, date: '2027-03-15' }), vest({ id: 3, kind: 'cash', securityId: null, priceCents: null })]);
    expect(y.events.some((e) => e.kind === 'rsu')).toBe(false);
    expect(y.warnings.some((w) => /no price per share/.test(w))).toBe(true);
  });

  it('raises the household tax owed', () => {
    const none = buildIncomeModel(2026, [person], [profile()], [], undefined, { vests: [], securities: [sec()] });
    const some = buildIncomeModel(2026, [person], [profile()], [], undefined, { vests: [vest({ shares: 1000 })], securities: [sec()] });
    expect(some.household!.federal.totalLiability).toBeGreaterThan(none.household!.federal.totalLiability);
    expect(some.household!.federal.wages - none.household!.federal.wages).toBe($(50000));
  });

  it('vestsFor filters by person and year', () => {
    const rs = [vest(), vest({ id: 2, personId: 2 }), vest({ id: 3, date: '2027-01-02' })].map((v) => resolveVest(v, [sec()]));
    expect(vestsFor(rs, 1, 2026)).toHaveLength(1);
  });
});

describe('what a vest turns into', () => {
  const outcome = (v: RsuVest) => {
    const r = resolveVest(v, [sec()]);
    const y = simulatePerson(profile(), person, [], T, [r]);
    return { r, o: vestOutcome(r, y), y };
  };

  it('sold stock and cash vests pay out the net amount as cash', () => {
    const { o, y } = outcome(vest({ afterVest: 'sold' }));
    const e = y.events.find((x) => x.kind === 'rsu')!;
    expect(o.netCashCents).toBe(e.net);
    expect(o.netCashCents + o.taxWithheldCents).toBe(o.grossCents);
    expect(o.sharesKept).toBe(0);
  });

  it('held stock is not spendable cash: the event nets to zero and a note says so', () => {
    const { y } = outcome(vest({ afterVest: 'held', accountId: 3 }));
    const e = y.events.find((x) => x.kind === 'rsu')!;
    expect(e.net).toBe(0);
    expect(e.notes.join(' ')).toMatch(/kept as shares/);
  });

  it('held stock keeps the net shares (tax covered by selling shares) with the net value as basis', () => {
    const { o } = outcome(vest({ afterVest: 'held', accountId: 3 }));
    expect(o.netCashCents).toBe(0);
    expect(o.sharesKept).toBeGreaterThan(0);
    expect(o.sharesKept).toBeLessThan(100);
    expect(o.basisCents).toBe(o.grossCents - o.taxWithheldCents);
    expect(Math.round(o.sharesKept * $(50))).toBeCloseTo(o.basisCents, -1);
  });
});

describe('recording held shares', () => {
  let d: FinanceDB;
  let n = 0;
  beforeEach(async () => {
    d = new FinanceDB(`rsu-${n++}`);
    await d.securities.add(sec({ id: undefined }));
    await d.invAccounts.add({ name: 'Brokerage', kind: 'brokerage', taxType: 'taxable', cashCents: 0, annualContributionCents: 0, contributionGrowthPct: 0, linkToIncome: false });
  });
  const held = (p: Partial<RsuVest> = {}) => vest({ id: undefined, securityId: 1, afterVest: 'held', accountId: 1, ...p });
  const out = (v: RsuVest): ReturnType<typeof vestOutcome> => ({ vest: v, grossCents: $(5000), taxWithheldCents: $(1500), netCashCents: 0, sharesKept: 70, basisCents: $(3500) });

  it('creates a holding, then adds to it, and never records the same vest twice', async () => {
    const a = await d.rsuVests.add(held());
    expect(await recordHeldVest(d, a, out(held()))).toBe('recorded');
    expect(await recordHeldVest(d, a, out(held()))).toBe('already');
    let hs = await d.holdings.toArray();
    expect(hs).toHaveLength(1);
    expect(hs[0].shares).toBe(70);
    expect(hs[0].costBasisCents).toBe($(3500));

    const b = await d.rsuVests.add(held({ date: '2026-06-15' }));
    await recordHeldVest(d, b, out(held()));
    hs = await d.holdings.toArray();
    expect(hs).toHaveLength(1);
    expect(hs[0].shares).toBe(140);
    expect(hs[0].costBasisCents).toBe($(7000));
    expect((await d.rsuVests.get(b))!.recorded).toBe(true);
  });

  it('only held stock can be recorded', async () => {
    const id = await d.rsuVests.add(held({ afterVest: 'sold' }));
    expect(await recordHeldVest(d, id, out(held()))).toBe('not-held');
    expect(await d.holdings.count()).toBe(0);
  });

  it('vests survive a backup round trip', async () => {
    await d.rsuVests.add(held());
    const file = await exportAll(d);
    expect(file.version).toBe(14);
    await d.rsuVests.clear();
    await importAll(d, file);
    expect(await d.rsuVests.count()).toBe(1);
  });
});

describe('entry validation', () => {
  it('names what is missing', () => {
    expect(vestProblem({})).toMatch(/person/);
    expect(vestProblem({ personId: 1, date: '2026-03-15', kind: 'cash', shares: 10 })).toMatch(/price per share/);
    expect(vestProblem({ personId: 1, date: '2026-03-15', kind: 'cash', shares: 10, priceCents: 500 })).toBeNull();
    expect(vestProblem({ personId: 1, date: '2026-03-15', kind: 'stock', shares: 10 })).toMatch(/stock/);
    expect(vestProblem({ personId: 1, date: '2026-03-15', kind: 'stock', shares: 10, securityId: 7, afterVest: 'held' })).toMatch(/account/);
    expect(vestProblem({ personId: 1, date: '2026-03-15', kind: 'stock', shares: 10, securityId: 7, afterVest: 'sold' })).toBeNull();
  });
});
