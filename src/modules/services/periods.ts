/**
 * The time periods the Services Overview offers for its money summary and insights (S5). Pure. A period is a range of calendar days, both ends
 * included. Each one (except "All time") also names the comparable PRIOR period, so a trend always compares like with like.
 *
 *   last30 / last90  the last 30 / 90 days including today; prior = the same number of days immediately before.
 *   last12           the last 12 calendar months including today; prior = the 12 months before that.
 *   ytd              1 January to today; prior = 1 January to the same day last year.
 *   <year>           a whole past calendar year; prior = the year before.
 *   all              everything, with no comparison.
 */
import { addDays, addMonths } from '../../lib/dates';
import type { Period } from './householdSpend';

export type PeriodId = 'all' | 'last30' | 'last90' | 'last12' | 'ytd' | string;
export interface ResolvedPeriod { id: PeriodId; label: string; range: Period; prior: { label: string; range: Period } | null }

const isYear = (id: string) => /^\d{4}$/.test(id);

export function resolvePeriod(id: PeriodId, today: string): ResolvedPeriod {
  const year = Number(today.slice(0, 4));
  switch (id) {
    case 'last30': return { id, label: 'Last 30 days', range: { from: addDays(today, -29), to: today }, prior: { label: 'the 30 days before that', range: { from: addDays(today, -59), to: addDays(today, -30) } } };
    case 'last90': return { id, label: 'Last 90 days', range: { from: addDays(today, -89), to: today }, prior: { label: 'the 90 days before that', range: { from: addDays(today, -179), to: addDays(today, -90) } } };
    case 'last12': {
      const from = addDays(addMonths(today, -12), 1);
      return { id, label: 'Last 12 months', range: { from, to: today }, prior: { label: 'the 12 months before that', range: { from: addDays(addMonths(today, -24), 1), to: addDays(from, -1) } } };
    }
    case 'ytd': return { id, label: `${year} so far`, range: { from: `${year}-01-01`, to: today }, prior: { label: `the same days of ${year - 1}`, range: { from: `${year - 1}-01-01`, to: addMonths(today, -12) } } };
    case 'all': return { id: 'all', label: 'All time', range: {}, prior: null };
    default:
      if (isYear(id)) { const y = Number(id); return { id, label: id, range: { from: `${y}-01-01`, to: `${y}-12-31` }, prior: { label: String(y - 1), range: { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` } } }; }
      return resolvePeriod('last12', today);
  }
}

/** The choices to offer: the fixed ones, then each past calendar year that has anything dated (newest first). */
export function periodChoices(today: string, years: string[]): { id: PeriodId; label: string }[] {
  const thisYear = today.slice(0, 4);
  const past = [...new Set(years)].filter((y) => isYear(y) && y < thisYear).sort().reverse();
  return [
    { id: 'last12', label: 'Last 12 months' }, { id: 'last90', label: 'Last 90 days' }, { id: 'last30', label: 'Last 30 days' }, { id: 'ytd', label: `${thisYear} so far` },
    ...past.map((y) => ({ id: y, label: y })), { id: 'all', label: 'All time' },
  ];
}
