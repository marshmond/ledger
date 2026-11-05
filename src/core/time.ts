/**
 * Local-time helpers. Two kinds of moment exist in the Calendar:
 *  - an all-day item is a plain date 'YYYY-MM-DD' with no time zone (it can never shift a day), and
 *  - a timed item is an absolute instant (milliseconds), shown in this device's local time zone.
 * These helpers convert between a local date + minutes-after-midnight and an instant, using the device's zone.
 */

const p2 = (n: number) => String(n).padStart(2, '0');

/** The local calendar date of an instant, 'YYYY-MM-DD'. */
export function localISO(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}

/** The instant for a local date at `minutes` after midnight (clock changes are handled by the browser). */
export function msAt(date: string, minutes = 0): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d, 0, minutes).getTime();
}

export function minutesOfDay(ms: number): number {
  const d = new Date(ms);
  return d.getHours() * 60 + d.getMinutes();
}

/** '09:30' -> 570. Returns null for anything that is not a time. */
export function parseHM(text: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2]);
  return h > 23 || mi > 59 ? null : h * 60 + mi;
}
export const fmtHM = (minutes: number) => `${p2(Math.floor(minutes / 60) % 24)}:${p2(minutes % 60)}`;

/** '9:30 AM' in the device's usual style. */
export const timeLabel = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/** A date such as 'Wed, Nov 4' (and the year when it is not this year). */
export function dayLabel(date: string, opts: { weekday?: 'short' | 'long'; year?: boolean } = {}): string {
  const d = new Date(date + 'T00:00:00Z');
  return d.toLocaleDateString('en-US', { weekday: opts.weekday ?? 'short', month: 'short', day: 'numeric', ...(opts.year ? { year: 'numeric' } : {}), timeZone: 'UTC' });
}

export const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
