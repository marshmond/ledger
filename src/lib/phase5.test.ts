import { describe, expect, it } from 'vitest';
import { bisectMax, bisectMin, runPool, steadyPool, type PoolInput } from './pool';
import { steadyPath, runMonteCarlo, type ClassAssumption, type ProjAccount } from './projection';
import {
  annualToMonthlyCents,
  monthlyToAnnualCents,
  blendMix,
  buildRetirementModel,
  DEFAULT_RETIREMENT,
  mixWithEquity,
  planRetirement,
  sustainableSpending,
  trailingAnnualSpending,
  windfallFlow,
  type RetirementInput,
} from './retirement';
import { buildGoalModel, solveGoal, type GoalContext } from './goals';
import { FinanceDB } from '../db';
import { exportAll, importAll } from './backup';
import type { Account, Category, Goal, Txn, Windfall } from '../types';

const $ = (n: number) => Math.round(n * 100);

const flatClass = (mu: number, sigma = 0): ClassAssumption[] => [{ id: 1, name: 'A', kind: 'equity', mu, sigma }];
const mix1 = new Map([[1, 1]]);
const pool = (p: Partial<PoolInput> & { classes: ClassAssumption[] }): PoolInput => ({
  start: $(1000000),
  years: 10,
  weightsAt: () => mix1,
  flowAt: () => 0,
  ...p,
});

describe('pool simulation', () => {
  it('with zero volatility matches the steady path exactly', () => {
    const inp = pool({ classes: flatClass(0.05), flowAt: (t) => (t <= 5 ? $(10000) : -$(20000)) });
    const st = steadyPool(inp);
    const mc = runPool(inp, 100, 3);
    for (let t = 0; t <= 10; t++) {
      expect(mc.p10[t]).toBeCloseTo(st.values[t], 3);
      expect(mc.p90[t]).toBeCloseTo(st.values[t], 3);
    }
  });

  it('detects when a withdrawal can no longer be paid', () => {
    const inp = pool({ classes: flatClass(0), flowAt: () => -$(120000) });
    expect(steadyPool(inp).ruinYear).toBe(9); // 1M - 8*120k = 40k left, then year 9 cannot be paid
    const mc = runPool(inp, 50, 1);
    expect(mc.successRate).toBe(0);
    expect(mc.ruinYears.every((y) => y === 9)).toBe(true);
    expect(mc.ruinedByYear[8]).toBe(0);
    expect(mc.ruinedByYear[9]).toBe(1);
    expect(mc.ruinedByYear[10]).toBe(1);
  });

  it('success falls as withdrawals rise and is certain when well funded', () => {
    const cls = flatClass(0.06, 0.15);
    const rate = (w: number) => runPool(pool({ classes: cls, years: 30, flowAt: () => -$(w) }), 3000, 5, false).successRate;
    expect(rate(10000)).toBe(1);
    expect(rate(40000)).toBeGreaterThan(rate(70000));
    expect(rate(70000)).toBeGreaterThan(rate(120000));
    expect(rate(500000)).toBe(0);
  });

  it('runs are reproducible from the seed', () => {
    const inp = pool({ classes: flatClass(0.06, 0.15), years: 30, flowAt: () => -$(60000) });
    expect(runPool(inp, 1000, 4, false).successRate).toBe(runPool(inp, 1000, 4, false).successRate);
  });

  it('bisection finds the threshold of a monotone test', () => {
    expect(bisectMax((x) => x <= 37.5, 0, 100)).toBeCloseTo(37.5, 3);
    expect(bisectMin((x) => x >= 62.25, 0, 100)).toBeCloseTo(62.25, 3);
    expect(bisectMax((x) => x < 0, 0, 100)).toBe(0); // never ok -> lo
    expect(bisectMin((x) => x > 1000, 0, 100)).toBe(100); // never ok -> hi
  });
});

describe('windfalls', () => {
  const w = (p: Partial<Windfall>): Windfall => ({ label: 'x', year: 2030, amountCents: $(100000), todaysDollars: false, include: true, ...p });

  it('maps calendar years to periods and inflates today-dollar amounts', () => {
    const f = windfallFlow([w({ year: 2030 }), w({ year: 2030, amountCents: $(5000) }), w({ year: 2028, todaysDollars: true }), w({ year: 2020 })], 2026, 0.025);
    expect(f(4)).toBe($(105000));
    expect(f(2)).toBeCloseTo($(100000) * 1.025 ** 2, 2);
    expect(f(1)).toBe($(100000)); // a past year counts in the first period
    expect(f(3)).toBe(0);
  });

  it('can be switched off', () => {
    expect(windfallFlow([w({ include: false })], 2026, 0.02)(4)).toBe(0);
  });

  it('adds to the projection at the right time; outflows cannot push balances below zero', () => {
    const account: ProjAccount = { id: 1, name: 'A', kind: 'brokerage', startCents: $(100000), weights: mix1, contribution: () => 0 };
    const inp = { accounts: [account], classes: flatClass(0), years: 5, inflation: 0.02, extraFlow: (t: number) => (t === 3 ? $(50000) : t === 5 ? -$(1e9) : 0) };
    const st = steadyPath(inp);
    expect(st.total[2]).toBe($(100000));
    expect(st.total[3]).toBe($(150000));
    expect(st.total[5]).toBe(0);
    const mc = runMonteCarlo(inp, 50, 1);
    expect(mc.p50[3]).toBeCloseTo($(150000), 0);
    expect(mc.p50[5]).toBe(0);
  });
});

describe('retirement planning', () => {
  const classes: ClassAssumption[] = [
    { id: 1, name: 'Stocks', kind: 'equity', mu: 0.07, sigma: 0.16 },
    { id: 2, name: 'Bonds', kind: 'bond', mu: 0.04, sigma: 0.06 },
  ];
  const acct = (start: number, contrib = 0, weights = new Map([[1, 0.6], [2, 0.4]])): ProjAccount => ({
    id: 1, name: 'Portfolio', kind: 'brokerage', startCents: $(start), weights, contribution: () => $(contrib),
  });
  const input = (over: Partial<RetirementInput> = {}): RetirementInput => ({
    year0: 2026,
    accounts: [acct(1_000_000)],
    classes,
    windfalls: [],
    inflation: 0.025,
    settings: { ...DEFAULT_RETIREMENT(2026), retireYear: 2026, planYears: 30, spendingCents: $(40000), taxRatePct: 0, sims: 3000 },
    ...over,
  });

  it('withdrawals: spending less income streams, grossed up for tax, all inflated', () => {
    const inp = input({
      settings: { ...DEFAULT_RETIREMENT(2026), retireYear: 2030, planYears: 20, spendingCents: $(100000), taxRatePct: 20, sims: 100,
        streams: [{ id: 's', label: 'Social Security', annualCents: $(30000), startYear: 2034 }] },
    });
    const m = buildRetirementModel(inp);
    expect(m.retireIdx).toBe(4);
    expect(m.horizon).toBe(24);
    expect(m.withdrawal(5)).toBeCloseTo(($(100000) * 1.025 ** 5) / 0.8, 2); // before the stream starts
    expect(m.withdrawal(9)).toBeCloseTo((($(100000) - $(30000)) * 1.025 ** 9) / 0.8, 2); // 2035 includes the stream
  });

  it('a monthly benefit entered as $2,500 reduces withdrawals by $30,000 a year', () => {
    expect(monthlyToAnnualCents($(2500))).toBe($(30000));
    expect(annualToMonthlyCents($(30000))).toBe($(2500));
    const inp = input({
      settings: { ...DEFAULT_RETIREMENT(2026), retireYear: 2030, planYears: 20, spendingCents: $(100000), taxRatePct: 0, sims: 100,
        streams: [{ id: 's', label: 'Social Security', annualCents: monthlyToAnnualCents($(2500)), startYear: 2034 }] },
    });
    expect(buildRetirementModel(inp).withdrawal(9)).toBeCloseTo(($(100000) - $(30000)) * 1.025 ** 9, 2);
  });

  it('before retirement the flow is contributions; after, it is negative', () => {
    const inp = input({ accounts: [acct(500_000, 20_000)], settings: { ...DEFAULT_RETIREMENT(2026), retireYear: 2036, planYears: 25, spendingCents: $(60000), taxRatePct: 0, sims: 100 } });
    const m = buildRetirementModel(inp);
    expect(m.pool.flowAt(3)).toBe($(20000));
    expect(m.pool.flowAt(10)).toBe($(20000));
    expect(m.pool.flowAt(11)).toBeLessThan(0);
  });

  it('a windfall during retirement offsets withdrawals', () => {
    const base = buildRetirementModel(input()).pool.flowAt(6);
    const withW = buildRetirementModel(input({ windfalls: [{ label: 'Inheritance', year: 2032, amountCents: $(200000), todaysDollars: false, include: true }] })).pool.flowAt(6);
    expect(withW - base).toBe($(200000));
  });

  it('first-year withdrawal rate is withdrawal over the balance at retirement', () => {
    const flat = [{ id: 1, name: 'F', kind: 'equity' as const, mu: 0.05, sigma: 0 }];
    const r = planRetirement(input({ classes: flat, accounts: [acct(1_000_000, 0, mix1)], inflation: 0, settings: { ...DEFAULT_RETIREMENT(2026), retireYear: 2026, planYears: 30, spendingCents: $(40000), taxRatePct: 0, sims: 100 } }));
    expect(r.firstYearWithdrawalPct).toBeCloseTo(4, 6);
    expect(r.mc.successRate).toBe(1);
  });

  it('a very high spending level fails and reports when money runs out', () => {
    const r = planRetirement(input({ settings: { ...DEFAULT_RETIREMENT(2026), retireYear: 2026, planYears: 30, spendingCents: $(200000), taxRatePct: 0, sims: 2000 } }));
    expect(r.mc.successRate).toBeLessThan(0.05);
    expect(r.medianRuinYear).not.toBeNull();
    expect(r.steady.ruinYear).not.toBeNull();
  });

  it('sustainable spending: grows with the portfolio, shrinks with confidence, and is consistent with the success rate', () => {
    const small = sustainableSpending(input(), 90, 2000);
    const big = sustainableSpending(input({ accounts: [acct(2_000_000)] }), 90, 2000);
    const lowConf = sustainableSpending(input(), 60, 2000);
    expect(big).toBeGreaterThan(small * 1.7);
    expect(lowConf).toBeGreaterThan(small);
    // spending a little under the answer passes at that confidence, well over it does not
    const okAt = (s: number) => planRetirement({ ...input(), settings: { ...input().settings, spendingCents: s, sims: 2000 } }).mc.successRate;
    expect(okAt(small * 0.9)).toBeGreaterThanOrEqual(0.9);
    expect(okAt(small * 1.4)).toBeLessThan(0.9);
    expect(small / 100).toBeGreaterThan(25000); // about 2.5-4% of $1M, in dollars/yr
    expect(small / 100).toBeLessThan(55000);
  });

  it('equity override and blending', () => {
    expect(mixWithEquity(classes, 40)).toEqual(new Map([[1, 0.4], [2, 0.6]]));
    expect(mixWithEquity([classes[0]], 40)).toBeNull();
    const blended = blendMix([acct(100, 0, new Map([[1, 1]])), acct(300, 0, new Map([[2, 1]]))]);
    expect(blended.get(1)).toBeCloseTo(0.25, 6);
    expect(blended.get(2)).toBeCloseTo(0.75, 6);
  });
});

describe('trailing spending from the ledger', () => {
  const accounts: Account[] = [{ id: 1, name: 'C', kind: 'checking', openingBalanceCents: 0, openingDate: '2026-01-01' }];
  const cats: Category[] = [
    { id: 1, groupId: 1, name: 'Groceries', kind: 'expense' },
    { id: 2, groupId: 2, name: 'Paycheck', kind: 'income' },
  ];
  let id = 1;
  const t = (date: string, amountCents: number, categoryId: number | null, extra: Partial<Txn> = {}): Txn => ({ id: id++, accountId: 1, date, amountCents, payee: '', memo: '', status: 'cleared', categoryId, ...extra });

  it('averages the last full months, ignoring income, transfers, and uncategorized deposits', () => {
    const txns = [
      t('2026-07-05', -$(1000), 1), t('2026-08-05', -$(1200), 1), t('2026-09-05', -$(800), 1),
      t('2026-09-06', -$(300), null), // uncategorized outflow counts
      t('2026-09-07', $(5000), 2), t('2026-09-08', $(40), null), // income and uncategorized deposit ignored
      t('2026-09-09', -$(900), null, { transferTxnId: 99 }), // transfer ignored
      t('2026-10-02', -$(777), 1), // current month is excluded
    ];
    const r = trailingAnnualSpending(txns, cats, accounts, '2026-10-08', 3);
    expect(r.monthsUsed).toBe(3);
    expect(r.annualCents).toBe(Math.round(((1000 + 1200 + 800 + 300) / 3) * 12) * 100);
  });

  it('uses fewer months when the ledger is new, and returns zero with no history', () => {
    const young: Account[] = [{ ...accounts[0], openingDate: '2026-08-20' }];
    const r = trailingAnnualSpending([t('2026-09-05', -$(600), 1)], cats, young, '2026-10-08', 3);
    expect(r.monthsUsed).toBe(1);
    expect(r.annualCents).toBe($(7200));
    expect(trailingAnnualSpending([], cats, [{ ...accounts[0], openingDate: '2026-10-01' }], '2026-10-08').annualCents).toBe(0);
  });
});

describe('goal solver', () => {
  const cls: ClassAssumption[] = [{ id: 1, name: 'Mix', kind: 'balanced', mu: 0.06, sigma: 0.1 }];
  const flat: ClassAssumption[] = [{ id: 1, name: 'Mix', kind: 'balanced', mu: 0.06, sigma: 0 }];
  const ctx = (classes: ClassAssumption[], start = 0): GoalContext => ({
    year0: 2026,
    inflation: 0.025,
    classes,
    account: { id: 1, name: '529', kind: '529', startCents: $(start), weights: new Map([[1, 1]]), contribution: () => 0 },
    fallbackWeights: new Map([[1, 1]]),
  });
  const goal = (over: Partial<Goal> = {}): Goal => ({
    name: 'College', accountId: 1, startYear: 2041, years: 4, annualCostCents: $(30000), costInflationPct: 4, fundingPct: 100,
    contributionGrowthPct: 0, confidencePct: 80, ...over,
  });

  it('costs are inflated from today and only paid in the cost years', () => {
    const m = buildGoalModel(goal(), ctx(flat));
    expect(m.startIdx).toBe(15);
    expect(m.horizon).toBe(18);
    expect(m.costs[14]).toBe(0);
    expect(m.costs[15]).toBeCloseTo($(30000) * 1.04 ** 15, 2);
    expect(m.costs[18]).toBeCloseTo($(30000) * 1.04 ** 18, 2);
    expect(buildGoalModel(goal({ fundingPct: 50 }), ctx(flat)).totalCost).toBeCloseTo(m.totalCost / 2, 2);
  });

  it('steady solution funds every year, and slightly less does not', () => {
    const s = solveGoal(goal(), ctx(flat), 0, 500);
    const model = s.model;
    expect(steadyPool(model.pool(s.steadyAnnual)).ruinYear).toBeNull();
    expect(steadyPool(model.pool(s.steadyAnnual * 0.97)).ruinYear).not.toBeNull();
    expect(s.steadyAnnual).toBeGreaterThan(0);
  });

  it('a confidence target needs more than the steady path when returns are uncertain', () => {
    const s = solveGoal(goal(), ctx(cls), 0, 2000);
    expect(s.confidenceAnnual).toBeGreaterThan(s.steadyAnnual);
    const model = s.model;
    expect(runPool(model.pool(s.confidenceAnnual), 2000, 1, false).successRate).toBeGreaterThanOrEqual(0.8);
    expect(runPool(model.pool(s.confidenceAnnual * 0.9), 2000, 1, false).successRate).toBeLessThan(0.8);
  });

  it('higher confidence needs more; a head start needs less; none needed when overfunded', () => {
    const c80 = solveGoal(goal({ confidencePct: 80 }), ctx(cls), 0, 1500).confidenceAnnual;
    const c95 = solveGoal(goal({ confidencePct: 95 }), ctx(cls), 0, 1500).confidenceAnnual;
    const headStart = solveGoal(goal({ confidencePct: 80 }), ctx(cls, 40000), 0, 1500).confidenceAnnual;
    expect(c95).toBeGreaterThan(c80);
    expect(headStart).toBeLessThan(c80);
    expect(solveGoal(goal(), ctx(cls, 5_000_000), 0, 1000).confidenceAnnual).toBe(0);
  });

  it('contribution growth lowers the first-year amount', () => {
    const flatGrowth = solveGoal(goal({ contributionGrowthPct: 0 }), ctx(flat), 0, 200).steadyAnnual;
    const growing = solveGoal(goal({ contributionGrowthPct: 4 }), ctx(flat), 0, 200).steadyAnnual;
    expect(growing).toBeLessThan(flatGrowth);
  });

  it('reports the funded status of the current contribution and a shortfall year', () => {
    const none = solveGoal(goal(), ctx(flat), 0, 500);
    expect(none.currentSuccessPct).toBe(0);
    expect(none.currentShortfallYear).toBe(2041);
    const enough = solveGoal(goal(), ctx(flat), none.steadyAnnual * 1.02, 500);
    expect(enough.currentShortfallYear).toBeNull();
  });

  it('flags a goal that starts too soon for contributions to help', () => {
    const s = solveGoal(goal({ startYear: 2026 }), ctx(flat), 0, 200);
    expect(s.noTimeToSave).toBe(true);
    expect(s.confidenceAnnual).toBeGreaterThan(0); // reported as the gap, not as a contribution that works
  });
});

describe('backup includes goals and windfalls', () => {
  it('round-trips', async () => {
    const d = new FinanceDB('p5-backup-1');
    await d.windfalls.add({ label: 'Inheritance', year: 2035, amountCents: 1, todaysDollars: true, include: true });
    await d.goals.add({ name: 'College', accountId: null, startYear: 2040, years: 4, annualCostCents: 1, costInflationPct: 4, fundingPct: 100, contributionGrowthPct: 0, confidencePct: 80 });
    const data = JSON.parse(JSON.stringify(await exportAll(d)));
    const d2 = new FinanceDB('p5-backup-2');
    await importAll(d2, data);
    expect(await d2.windfalls.count()).toBe(1);
    expect(await d2.goals.count()).toBe(1);
  });
});

describe('loan payments in retirement', () => {
  const classes: ClassAssumption[] = [{ id: 1, name: 'Stocks', kind: 'equity', mu: 0.07, sigma: 0.16 }];
  const acct: ProjAccount = { id: 1, name: 'P', kind: 'brokerage', startCents: $(1_000_000), weights: new Map([[1, 1]]), contribution: () => 0 };
  const base = (over: Partial<RetirementInput['settings']> = {}, debt?: (t: number) => number): RetirementInput => ({
    year0: 2026, accounts: [acct], classes, windfalls: [], inflation: 0.025, debtPaymentsAt: debt,
    settings: { ...DEFAULT_RETIREMENT(2026), retireYear: 2026, planYears: 20, spendingCents: $(40000), taxRatePct: 20, sims: 100, ...over },
  });

  it('is off by default: the payments are ignored even if supplied', () => {
    const m = buildRetirementModel(base({}, () => $(12000)));
    expect(m.withdrawal(3)).toBeCloseTo(($(40000) * 1.025 ** 3) / 0.8, 2);
  });

  it('when on, scheduled loan payments are added to what the portfolio must cover, grossed up for tax', () => {
    const m = buildRetirementModel(base({ includeDebtPayments: true }, (t) => (t <= 5 ? $(12000) : 0)));
    expect(m.withdrawal(3)).toBeCloseTo((($(40000) * 1.025 ** 3) + $(12000)) / 0.8, 2);
    expect(m.withdrawal(6)).toBeCloseTo(($(40000) * 1.025 ** 6) / 0.8, 2); // the loan is paid off
  });

  it('more debt means a lower chance the money lasts', () => {
    const without = planRetirement(base({ includeDebtPayments: true, sims: 1500 }, () => 0)).mc.successRate;
    const withDebt = planRetirement(base({ includeDebtPayments: true, sims: 1500 }, () => $(25000))).mc.successRate;
    expect(withDebt).toBeLessThan(without);
  });
});
