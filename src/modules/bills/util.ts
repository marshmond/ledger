/** Tiny shared helpers for the Bills & Subscriptions module (pure). Same shapes the other modules use (each keeps its own copy). */

export const str = (v: unknown, d = '') => (typeof v === 'string' ? v : d);
export const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
export const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
export const tidy = (s: string) => s.trim().replace(/\s+/g, ' ');
/** A real calendar date written YYYY-MM-DD (so 2026-02-30 is not one). */
export const isDate = (v: unknown): v is string => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
};
/** A real month written YYYY-MM. */
export const isMonth = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
export function isSafeUrl(u: string): boolean {
  try { const p = new URL(u); return p.protocol === 'http:' || p.protocol === 'https:'; } catch { return false; }
}
/** Largest amount accepted anywhere in this module (whole cents). */
export const MAX_CENTS = 1e11;
export const isCents = (v: unknown): v is number => isInt(v) && v >= 0 && v <= MAX_CENTS;

/** A soft hint, never a security control: notes must not hold codes, passwords or account numbers. */
export function notesWarning(notes: string): string | null {
  return /\b(password|passcode|pin|code|combination|account\s*(number|no)|iban|routing)\b/i.test(notes) || /\d{6,}/.test(notes.replace(/[\s-]/g, ''))
    ? 'This looks like it may contain a code, password or account number. Plain backups and exports are not encrypted, so keep those in a password manager instead.'
    : null;
}

export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const ord = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`;

/** Removes the listed keys from an object (a new object). */
export const without = <T extends object>(o: T, keys: string[]): T => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k))) as T;
