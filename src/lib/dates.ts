// All dates are 'YYYY-MM-DD'; months are 'YYYY-MM'. Computation is done in UTC to avoid DST drift.

const toDate = (iso: string) => new Date(iso + 'T00:00:00Z');
const toISO = (d: Date) => d.toISOString().slice(0, 10);

export const monthOf = (iso: string) => iso.slice(0, 7);

export function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

export function addDays(iso: string, n: number): string {
  const d = toDate(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return toISO(d);
}

/** Adds whole months, keeping `day` (default: the start date's day) and clamping to month length. */
export function addMonths(iso: string, n: number, day?: number): string {
  const [y, m, dd] = iso.split('-').map(Number);
  const idx = y * 12 + (m - 1) + n;
  const ny = Math.floor(idx / 12);
  const nm = (idx % 12) + 1;
  const d = Math.min(day ?? dd, daysInMonth(ny, nm));
  return `${ny}-${String(nm).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function nextMonth(month: string): string {
  return monthOf(addMonths(month + '-01', 1));
}

export function prevMonth(month: string): string {
  return monthOf(addMonths(month + '-01', -1));
}

export function endOfMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${month}-${String(daysInMonth(y, m)).padStart(2, '0')}`;
}

/** Inclusive list of months from a to b ('YYYY-MM'). */
export function monthRange(a: string, b: string): string[] {
  const out: string[] = [];
  for (let m = a; m <= b && out.length < 1200; m = nextMonth(m)) out.push(m);
  return out;
}

export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

// ---- business days (weekends only; public holidays are NOT considered) ----

/** 0 = Sunday ... 6 = Saturday. */
export function dayOfWeek(iso: string): number {
  return new Date(iso + 'T00:00:00Z').getUTCDay();
}

export const isWeekend = (iso: string) => {
  const d = dayOfWeek(iso);
  return d === 0 || d === 6;
};

/** The date itself if it is a weekday, otherwise the Friday before. */
export function priorBusinessDay(iso: string): string {
  const d = dayOfWeek(iso);
  if (d === 6) return addDays(iso, -1);
  if (d === 0) return addDays(iso, -2);
  return iso;
}

/** Last weekday of a month ('YYYY-MM'). */
export function lastBusinessDay(month: string): string {
  return priorBusinessDay(endOfMonth(month));
}

/**
 * A pay day within a month. `spec` is a day number (1-31; a day past the end of a short month means the last day of that
 * month, so 31 is safe everywhere) or 'lastBusiness'. With `weekendAdjust`, a day that lands on a weekend moves to the
 * Friday before (which can be in the previous month for the 1st).
 */
export function monthPayDate(month: string, spec: number | 'lastBusiness', weekendAdjust: boolean): string {
  if (spec === 'lastBusiness') return lastBusinessDay(month);
  const [y, m] = month.split('-').map(Number);
  const day = Math.min(Math.max(1, Math.floor(spec)), daysInMonth(y, m));
  const date = `${month}-${String(day).padStart(2, '0')}`;
  return weekendAdjust ? priorBusinessDay(date) : date;
}
