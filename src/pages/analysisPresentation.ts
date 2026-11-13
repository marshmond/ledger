/**
 * D17: words and small groupings for the analysis, Invest and debt pages. Pure presentation:
 *  - nothing here adds, subtracts, rounds or converts an amount to make a NEW figure. The one exception is the difference the Reports "Delta" tile always printed
 *    (this month minus another month), which moved here unchanged from ReportsPage;
 *  - nothing decides a financial rule. A value arrives already worked out by the page's own reader or engine and leaves unchanged;
 *  - nothing reads the clock or storage.
 * A source test (d17Analysis.test.tsx) keeps this file free of storage access and engine imports.
 */
import { formatCents } from '../lib/money';

const pct = (f: number) => `${f >= 0 ? '+' : '−'}${Math.abs(Math.round(f * 100))}%`;

/** "up $120.00 (+8%)", "down $40.00 (−3%)" or "same": which way this month moved against another, in words (no color is tied to the direction). */
export function deltaWords(now: number, then: number): string {
  const diff = now - then;
  if (diff === 0) return 'same';
  return `${diff > 0 ? 'up' : 'down'} ${formatCents(Math.abs(diff))}${then > 0 ? ` (${pct(diff / then)})` : ''}`;
}

/** A year-month list ("2026-07") of the months with no saved net worth point between the first and last saved point. Dates are compared as text, as the page always did. */
export function missingMonths(dates: string[]): string[] {
  const months = [...new Set(dates.map((d) => d.slice(0, 7)))].sort();
  if (months.length < 2) return [];
  const have = new Set(months);
  const out: string[] = [];
  let [y, m] = months[0].split('-').map(Number);
  const last = months[months.length - 1];
  for (let guard = 0; guard < 1200; guard++) {
    m += 1;
    if (m > 12) { m = 1; y += 1; }
    const key = `${y}-${String(m).padStart(2, '0')}`;
    if (key >= last) break;
    if (!have.has(key)) out.push(key);
  }
  return out;
}

/** What kind of price a security carries, from its stored source. A missing price is "none" (it is never shown as zero). */
export type PriceKind = 'none' | 'manual' | 'service';
export const priceKind = (s: { priceCents: number | null; priceSource: 'manual' | 'api' | null }): PriceKind => (s.priceCents === null ? 'none' : s.priceSource === 'api' ? 'service' : 'manual');
export const PRICE_KIND_WORD: Record<PriceKind, string> = { none: 'No price', manual: 'Entered by hand', service: 'From market data' };

/** "+$1,234.00" or "−$12.00" or "$0.00": an amount with its sign in the text, not in a color. */
export function signedWords(cents: number): string {
  const body = formatCents(Math.abs(cents));
  return cents > 0 ? `+${body}` : cents < 0 ? `−${body}` : body;
}
