import type { RetirementModel } from './retirement';

export type ScenarioKey = 'p10' | 'p50' | 'p90';
export const SCENARIO_LABELS: Record<ScenarioKey, string> = { p10: '10th percentile', p50: 'Median', p90: '90th percentile' };

export type RowStatus = 'ok' | 'ran-out-this-year' | 'ran-out';

/** One year of a scenario. Money columns are cents; null means "not shown" (the money had already run out). */
export interface ScenarioRow {
  year: number;
  /** 1-based year of retirement, or null while still working. */
  retirementYear: number | null;
  status: RowStatus;
  contributions: number | null;
  otherIncome: number | null;
  windfallIn: number | null;
  spending: number | null;
  loanPayments: number | null;
  tax: number | null;
  windfallOut: number | null;
  /** Everything in minus everything out for the year. */
  netFlow: number | null;
  /** What the balance changed by beyond the flows (investment growth; in today's dollars, growth after inflation). */
  growth: number | null;
  startBalance: number;
  endBalance: number;
  /** Money taken out of savings as a percent of the start balance (retirement years only). */
  withdrawalPct: number | null;
}

/**
 * Year-by-year detail for one percentile line of the savings chart. The yearly flows are the plan's, the same in every
 * simulated future; growth is whatever bridges one year's line to the next, so every row adds up:
 * start + net flow + growth = end. In today's dollars each year is divided by the inflation factor, with the start
 * balance at last year's factor (as on the chart), so growth there is growth after inflation.
 */
export function scenarioRows(model: RetirementModel, line: number[], year0: number, inflation: number, todaysDollars: boolean): ScenarioRow[] {
  const rows: ScenarioRow[] = [];
  let ranOut = false;
  for (let t = 1; t <= model.horizon; t++) {
    const retired = t > model.retireIdx;
    const f = todaysDollars ? 1 / Math.pow(1 + inflation, t) : 1;
    const fPrev = todaysDollars ? 1 / Math.pow(1 + inflation, t - 1) : 1;
    const p = model.parts(t);
    const startBalance = line[t - 1] * fPrev;
    const endBalance = line[t] * f;
    const base = { year: year0 + t, retirementYear: retired ? t - model.retireIdx : null, startBalance, endBalance };
    if (ranOut) {
      rows.push({ ...base, status: 'ran-out', contributions: null, otherIncome: null, windfallIn: null, spending: null, loanPayments: null, tax: null, windfallOut: null, netFlow: null, growth: null, withdrawalPct: null });
      continue;
    }
    const withdrawal = retired ? model.withdrawal(t) : 0;
    const failsNow = retired && withdrawal > 0 && line[t] <= 0;
    const shown = {
      contributions: p.contributions * f, otherIncome: p.otherIncome * f, windfallIn: p.windfallIn * f,
      spending: p.spending * f, loanPayments: p.loanPayments * f, tax: p.tax * f, windfallOut: p.windfallOut * f,
    };
    const net = shown.contributions + shown.otherIncome + shown.windfallIn - shown.spending - shown.loanPayments - shown.tax - shown.windfallOut;
    if (failsNow) {
      ranOut = true;
      // The planned figures are shown, but they were not fully paid, so growth cannot be separated out.
      rows.push({ ...base, status: 'ran-out-this-year', ...shown, netFlow: net, growth: null, withdrawalPct: startBalance > 0 ? (withdrawal * f / startBalance) * 100 : null });
      continue;
    }
    rows.push({
      ...base, status: 'ok', ...shown, netFlow: net,
      growth: endBalance - startBalance - net,
      withdrawalPct: retired && startBalance > 0 ? (withdrawal * f / startBalance) * 100 : null,
    });
  }
  return rows;
}

const HEAD = ['Year', 'Year of retirement', 'Status', 'Contributions', 'Other income', 'Windfalls in', 'Spending', 'Loan payments', 'Tax on withdrawals', 'Windfalls out', 'Net flow', 'Growth', 'Start balance', 'End balance', 'Withdrawal rate %'];
const STATUS_TEXT: Record<RowStatus, string> = { ok: '', 'ran-out-this-year': 'Money ran out', 'ran-out': 'Money ran out earlier' };

/** The table as CSV: dollars to the cent, blank where the money had already run out. */
export function scenarioCsv(rows: ScenarioRow[]): string {
  const d = (c: number | null) => (c === null ? '' : (c / 100).toFixed(2));
  const lines = [HEAD.join(',')];
  for (const r of rows) {
    lines.push([
      r.year, r.retirementYear ?? '', STATUS_TEXT[r.status], d(r.contributions), d(r.otherIncome), d(r.windfallIn), d(r.spending), d(r.loanPayments),
      d(r.tax), d(r.windfallOut), d(r.netFlow), d(r.growth), d(r.startBalance), d(r.endBalance), r.withdrawalPct === null ? '' : r.withdrawalPct.toFixed(1),
    ].join(','));
  }
  return lines.join('\n');
}
