import { describe, expect, it } from 'vitest';
import { buildRetirementModel, DEFAULT_RETIREMENT, planRetirement, type RetirementInput } from './retirement';
import { scenarioCsv, scenarioRows } from './retirementTable';
import type { ClassAssumption, ProjAccount } from './projection';

const $ = (d: number) => Math.round(d * 100);
const classes: ClassAssumption[] = [
  { id: 1, name: 'Stocks', kind: 'equity', mu: 0.07, sigma: 0.16 },
  { id: 2, name: 'Bonds', kind: 'bond', mu: 0.04, sigma: 0.06 },
];
const acct = (start: number, contrib: number): ProjAccount => ({
  id: 1, name: 'Portfolio', kind: 'brokerage', startCents: $(start), weights: new Map([[1, 0.6], [2, 0.4]]), contribution: () => $(contrib),
});
const input = (start: number, over: Partial<RetirementInput['settings']> = {}): RetirementInput => ({
  year0: 2026,
  accounts: [acct(start, 20000)],
  classes,
  windfalls: [
    { label: 'Inheritance', year: 2033, amountCents: $(50000), todaysDollars: true, include: true },
    { label: 'Roof', year: 2036, amountCents: -$(20000), todaysDollars: false, include: true },
  ],
  inflation: 0.025,
  settings: {
    ...DEFAULT_RETIREMENT(2026), retireYear: 2031, planYears: 20, spendingCents: $(90000), taxRatePct: 20, sims: 500,
    streams: [{ id: 's', label: 'Social Security', annualCents: $(30000), startYear: 2035 }], ...over,
  },
});

describe('scenario tables', () => {
  it('the flow pieces add up to the pool cash flow every year', () => {
    const inp = input(1_000_000);
    const m = buildRetirementModel(inp);
    for (let t = 1; t <= m.horizon; t++) {
      const p = m.parts(t);
      const net = p.contributions + p.otherIncome + p.windfallIn - p.spending - p.loanPayments - p.tax - p.windfallOut;
      expect(net).toBeCloseTo(m.pool.flowAt(t), 4);
    }
  });

  it('splits spending, other income and tax as the withdrawal model does', () => {
    const m = buildRetirementModel(input(1_000_000));
    const p = m.parts(m.retireIdx + 6); // 2037: Social Security has started
    const spend = $(90000) * 1.025 ** 11;
    expect(p.spending).toBeCloseTo(spend, 2);
    expect(p.otherIncome).toBeCloseTo($(30000) * 1.025 ** 11, 2);
    expect(p.tax).toBeCloseTo(((spend - p.otherIncome) / 0.8) * 0.2, 2);
    expect(m.parts(3).contributions).toBe($(20000)); // still working in 2029
    expect(m.parts(3).spending).toBe(0);
  });

  it('other income above spending is capped at spending', () => {
    const m = buildRetirementModel(input(1_000_000, { streams: [{ id: 's', label: 'Big', annualCents: $(500000), startYear: 2031 }] }));
    const p = m.parts(m.retireIdx + 1);
    expect(p.otherIncome).toBeCloseTo(p.spending, 2);
    expect(p.tax).toBeCloseTo(0, 6);
  });

  for (const todays of [false, true]) {
    it(`every row adds up: start + net flow + growth = end (${todays ? "today's" : 'future'} dollars)`, () => {
      const inp = input(1_000_000);
      const r = planRetirement(inp, 7);
      for (const line of [r.mc.p10, r.mc.p50, r.mc.p90]) {
        const rows = scenarioRows(r.model, line, 2026, 0.025, todays);
        expect(rows).toHaveLength(r.model.horizon);
        for (const row of rows.filter((x) => x.status === 'ok')) {
          expect(row.startBalance + row.netFlow! + row.growth!).toBeCloseTo(row.endBalance, 2);
        }
      }
    });
  }

  it('start of each row is the end of the previous row (nominal), and the first start is today', () => {
    const inp = input(1_000_000);
    const r = planRetirement(inp, 7);
    const rows = scenarioRows(r.model, r.mc.p50, 2026, 0.025, false);
    expect(rows[0].startBalance).toBe($(1_000_000));
    for (let i = 1; i < rows.length; i++) expect(rows[i].startBalance).toBe(rows[i - 1].endBalance);
    expect(rows[0].retirementYear).toBeNull();
    expect(rows[4].retirementYear).toBeNull(); // 2031 is the last working year
    expect(rows[5].retirementYear).toBe(1); // 2032
  });

  it('marks the year the money runs out and blanks the years after', () => {
    const inp = input(50_000, { spendingCents: $(150000) });
    const r = planRetirement(inp, 3);
    const rows = scenarioRows(r.model, r.mc.p10, 2026, 0.025, false);
    const first = rows.findIndex((x) => x.status === 'ran-out-this-year');
    expect(first).toBeGreaterThan(-1);
    expect(rows[first].endBalance).toBe(0);
    expect(rows[first].growth).toBeNull();
    expect(rows[first].spending).toBeGreaterThan(0);
    for (const row of rows.slice(first + 1)) {
      expect(row.status).toBe('ran-out');
      expect(row.spending).toBeNull();
      expect(row.endBalance).toBe(0);
    }
    expect(rows.slice(0, first).every((x) => x.status === 'ok')).toBe(true);
  });

  it('a plan that never runs out has no ran-out rows in the median', () => {
    const r = planRetirement(input(3_000_000), 3);
    expect(scenarioRows(r.model, r.mc.p50, 2026, 0.025, true).every((x) => x.status === 'ok')).toBe(true);
  });

  it('csv has a header, one line per year, whole cents, and blanks after the money runs out', () => {
    const r = planRetirement(input(50_000, { spendingCents: $(150000) }), 3);
    const rows = scenarioRows(r.model, r.mc.p10, 2026, 0.025, false);
    const lines = scenarioCsv(rows).split('\n');
    expect(lines).toHaveLength(rows.length + 1);
    expect(lines[0].startsWith('Year,Year of retirement,Status,Contributions')).toBe(true);
    expect(lines[1].split(',')).toHaveLength(15);
    expect(lines.at(-1)).toContain('Money ran out earlier');
    expect(lines[1].split(',')[3]).toBe('20000.00'); // first-year contributions
  });
});
