import { localISO } from '../core/time';

export function formatCents(cents: number): string {
  cents = Math.round(cents); // callers sometimes pass computed (fractional) cents
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100).toLocaleString('en-US');
  return `${sign}$${dollars}.${String(abs % 100).padStart(2, '0')}`;
}

/** Parses "$1,234.56", "(12.34)", "-12.34", "12.34-" into cents. Returns null if unparseable. */
export function parseAmountToCents(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  let s = String(input).trim();
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.endsWith('-')) {
    negative = true;
    s = s.slice(0, -1);
  }
  s = s.replace(/[$,\s]/g, '');
  if (s.startsWith('-')) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.startsWith('+')) {
    s = s.slice(1);
  }
  if (!/^\d*\.?\d+$|^\d+\.$/.test(s)) return null;
  const cents = Math.round(Number(s) * 100);
  return negative ? -cents : cents;
}

const NUM = String.raw`(?:\d*\.?\d+|\d+\.)`;
const SUM = new RegExp(`^[+-]?${NUM}(?:[+-]${NUM})+$`);

/** True when the text is a sum or difference of amounts such as "15.37+123.86" (a lone amount, or a trailing sign, is not). */
export function isAmountSum(input: string): boolean {
  return SUM.test(input.replace(/[$,\s]/g, ''));
}

/**
 * Like parseAmountToCents, but also adds and subtracts: "15.37+123.86" is 13923, "200-15.50" is 18450. Returns null when the
 * text is not an amount or a sum of amounts (for example "15.37+" while it is still being typed).
 */
export function parseAmountMath(input: string | number | null | undefined): number | null {
  if (typeof input === 'string' && isAmountSum(input)) {
    const parts = input.replace(/[$,\s]/g, '').match(new RegExp(`[+-]?${NUM}`, 'g')) ?? [];
    return parts.reduce((sum, p) => sum + Math.round(Number(p) * 100), 0);
  }
  return parseAmountToCents(input);
}

/**
 * What an Assigned box means: "100+50" is 150; text that starts with a sign changes what is already there ("+25" adds
 * $25, "-10" takes $10 off). Empty is zero. Returns null when the text is not an amount.
 */
export function assignedFromEntry(raw: string, currentCents: number): number | null {
  const text = raw.trim();
  if (text === '') return 0;
  const n = parseAmountMath(text);
  if (n === null) return null;
  return /^[+-]/.test(text) ? currentCents + n : n;
}

/** Today's date on this device's calendar, 'YYYY-MM-DD' (not UTC). The same rule as every other local-date helper: see `localISO` in core/time.ts. */
export function todayISO(): string {
  return localISO(Date.now());
}

export function daysBetween(a: string, b: string): number {
  const ms = Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z');
  return Math.round(ms / 86400000);
}
