/**
 * How far ahead the Household Services Overview lists upcoming visits (B3.0A). PURE helpers plus one tiny device-local preference.
 *
 * It only decides what the OVERVIEW LIST shows. It is not the Calendar's rolling 12-month horizon, it does not change any arrangement, schedule,
 * visit or payment, and it never creates or edits a Task or an event. The one open visit Task per arrangement is unchanged.
 *
 * The window is "from today up to AND INCLUDING the date N days from today" (so a visit exactly 7 days away is in the 7-day window and one 8 days
 * away is not). "Today" is the device's calendar date. A visit Task whose date has already passed is still listed, marked overdue, because it
 * needs action; it is not "upcoming" but it is never hidden by a narrow window.
 */
export const UPCOMING_WINDOWS = [7, 14, 30, 90] as const;
export type UpcomingDays = (typeof UPCOMING_WINDOWS)[number];
export const DEFAULT_UPCOMING_DAYS: UpcomingDays = 30;
/** How many rows the card shows before "Show all". Every matching visit is still available behind that button. */
export const UPCOMING_ROWS = 10;

export const UPCOMING_KEY = 'services-upcoming-days';

/** Reads a saved or typed value. Anything other than exactly one of the four windows (text or number) is the default, never an error. */
export function parseUpcomingDays(raw: unknown): UpcomingDays {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\d{1,3}$/.test(raw.trim()) ? Number(raw.trim()) : NaN;
  return (UPCOMING_WINDOWS as readonly number[]).includes(n) ? (n as UpcomingDays) : DEFAULT_UPCOMING_DAYS;
}

export const upcomingLabel = (days: number) => `${days} days`;

type Reader = Pick<Storage, 'getItem'>;
type Writer = Pick<Storage, 'setItem'>;
/** The saved choice on this device (a convenience, not data). Missing, unreadable or unavailable storage gives the default. */
export function loadUpcomingDays(store?: Reader): UpcomingDays {
  try { return parseUpcomingDays((store ?? localStorage).getItem(UPCOMING_KEY)); } catch { return DEFAULT_UPCOMING_DAYS; }
}
export function saveUpcomingDays(days: UpcomingDays, store?: Writer): void {
  try { (store ?? localStorage).setItem(UPCOMING_KEY, String(days)); } catch { /* storage unavailable: the choice lasts until the page closes */ }
}

/** Keeps the rows for one provider ('all' keeps every row). The window is applied first and the row limit after, so a provider is never starved by a cut. */
export function filterUpcomingByProvider<T extends { providerContactId: number | null }>(rows: T[], provider: string): T[] {
  return provider === 'all' ? rows : rows.filter((u) => String(u.providerContactId) === provider);
}

/** The rows the card draws: the first `UPCOMING_ROWS` until the owner chooses "Show all", then every one. `more` is how many are not drawn (so the card can say so). */
export function visibleUpcoming<T>(rows: T[], all: boolean): { shown: T[]; more: number } {
  const shown = all ? rows : rows.slice(0, UPCOMING_ROWS);
  return { shown, more: rows.length - shown.length };
}
