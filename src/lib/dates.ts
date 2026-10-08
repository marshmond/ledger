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
