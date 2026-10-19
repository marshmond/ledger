import { addDays, addMonths, endOfMonth, monthOf } from './dates';

export type RangePreset = 'this_month' | 'last_month' | 'last3' | 'last6' | 'last12' | 'ytd' | 'last_year' | 'all' | 'custom';

export const RANGE_LABELS: Record<RangePreset, string> = {
  this_month: 'This month',
  last_month: 'Last month',
  last3: 'Last 3 months',
  last6: 'Last 6 months',
  last12: 'Last 12 months',
  ytd: 'This year so far',
  last_year: 'Last year',
  all: 'All time',
  custom: 'Custom dates',
};

export interface DateRange {
  start: string;
  end: string;
}

/**
 * The dates a period covers (both ends inclusive). "Last N months" means the N whole months before this one, so partial months
 * never skew the picture; "This month" and "This year so far" run through today.
 */
export function resolveRange(preset: RangePreset, today: string, custom?: Partial<DateRange>, earliest?: string): DateRange {
  const thisMonth = monthOf(today);
  const lastMonthEnd = addDays(`${thisMonth}-01`, -1);
  const wholeMonths = (n: number): DateRange => ({ start: addMonths(`${thisMonth}-01`, -n), end: lastMonthEnd });
  switch (preset) {
    case 'this_month':
      return { start: `${thisMonth}-01`, end: today };
    case 'last_month':
      return wholeMonths(1);
    case 'last3':
      return wholeMonths(3);
    case 'last6':
      return wholeMonths(6);
    case 'last12':
      return wholeMonths(12);
    case 'ytd':
      return { start: `${today.slice(0, 4)}-01-01`, end: today };
    case 'last_year': {
      const y = Number(today.slice(0, 4)) - 1;
      return { start: `${y}-01-01`, end: `${y}-12-31` };
    }
    case 'all':
      return { start: earliest && earliest <= today ? earliest : today, end: today };
    case 'custom': {
      const start = custom?.start || `${thisMonth}-01`;
      const end = custom?.end || today;
      return start <= end ? { start, end } : { start: end, end: start };
    }
  }
}

/** "Jul 1 to Sep 30, 2026". */
export function rangeText(r: DateRange): string {
  const fmt = (iso: string, year: boolean) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(year ? { year: 'numeric' } : {}), timeZone: 'UTC' });
  const sameYear = r.start.slice(0, 4) === r.end.slice(0, 4);
  return `${fmt(r.start, !sameYear)} to ${fmt(r.end, true)}`;
}

/** Every calendar year a range touches. */
export function yearsIn(r: DateRange): number[] {
  const out: number[] = [];
  for (let y = Number(r.start.slice(0, 4)); y <= Number(r.end.slice(0, 4)); y++) out.push(y);
  return out;
}

export { endOfMonth };
