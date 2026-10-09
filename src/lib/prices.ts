import type { FinanceDB } from '../db';
import { parseAmountToCents, todayISO } from './money';

/**
 * Market-data prices via Twelve Data's /price endpoint (free key; limits at time of writing: 8 requests/minute,
 * 800/day). One request per symbol. The key is stored only in this browser and is never exported in backups.
 * Anything the free tier cannot price (some mutual funds) can be entered manually on the Investments page.
 */

export const PER_MINUTE = 8;

export interface PriceResult {
  ticker: string;
  cents?: number;
  error?: string;
}

type FetchLike = (url: string) => Promise<{ status: number; json: () => Promise<unknown> }>;

export async function fetchPrice(ticker: string, apiKey: string, f: FetchLike = fetch as unknown as FetchLike): Promise<PriceResult> {
  try {
    const url = `https://api.twelvedata.com/price?symbol=${encodeURIComponent(ticker)}&apikey=${encodeURIComponent(apiKey)}`;
    const res = await f(url);
    const body = (await res.json()) as { price?: string; message?: string; status?: string; code?: number };
    if (body && body.status === 'error') {
      const msg = body.code === 401 ? 'API key rejected' : body.code === 429 ? 'Rate limit reached; try again in a minute' : body.message ?? 'Lookup failed';
      return { ticker, error: msg };
    }
    const price = Number(body?.price);
    if (!Number.isFinite(price) || price <= 0) return { ticker, error: 'No price returned for this symbol' };
    return { ticker, cents: Math.round(price * 100) };
  } catch (e) {
    return { ticker, error: e instanceof Error ? `Network error: ${e.message}` : 'Network error' };
  }
}

export async function fetchPrices(
  tickers: string[],
  apiKey: string,
  opts: {
    fetchImpl?: FetchLike;
    sleep?: (ms: number) => Promise<void>;
    onProgress?: (done: number, total: number, waiting: boolean) => void;
  } = {},
): Promise<PriceResult[]> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const out: PriceResult[] = [];
  const unique = [...new Set(tickers.map((t) => t.trim().toUpperCase()).filter(Boolean))];
  for (let i = 0; i < unique.length; i++) {
    // Stay under the per-minute limit: after every block of 8 requests, wait for the window to reset.
    if (i > 0 && i % PER_MINUTE === 0) {
      opts.onProgress?.(i, unique.length, true);
      await sleep(61000);
    }
    const r = await fetchPrice(unique[i], apiKey, opts.fetchImpl);
    out.push(r);
    opts.onProgress?.(i + 1, unique.length, false);
    if (r.error === 'API key rejected') break; // no point continuing
  }
  return out;
}

/** Stores fetched prices on the matching securities. Returns how many were updated. */
export async function applyPrices(d: FinanceDB, results: PriceResult[]): Promise<number> {
  let n = 0;
  const secs = await d.securities.toArray();
  for (const r of results) {
    if (r.cents === undefined) continue;
    for (const s of secs.filter((x) => x.ticker.toUpperCase() === r.ticker)) {
      await d.securities.update(s.id!, { priceCents: r.cents, priceDate: todayISO(), priceSource: 'api' });
      n++;
    }
  }
  return n;
}

export type PriceEntry = { ok: true; cents: number | null } | { ok: false; error: string };

/** Parses a typed price. Empty clears the price; anything that is not a positive amount is rejected (never silently cleared). */
export function parsePriceInput(text: string): PriceEntry {
  const t = text.trim();
  if (t === '') return { ok: true, cents: null };
  const cents = parseAmountToCents(t);
  if (cents === null) return { ok: false, error: `"${t}" is not a valid price` };
  if (cents <= 0) return { ok: false, error: 'A price must be greater than zero' };
  return { ok: true, cents };
}

/**
 * Stores a manually typed price on a security (it then applies to every account holding that ticker).
 * A later price refresh overwrites it; a ticker the API cannot price keeps the manual value.
 */
export async function setManualPrice(d: FinanceDB, securityId: number, text: string): Promise<PriceEntry> {
  const r = parsePriceInput(text);
  if (!r.ok) return r;
  await d.securities.update(securityId, {
    priceCents: r.cents,
    priceDate: r.cents === null ? null : todayISO(),
    priceSource: r.cents === null ? null : 'manual',
  });
  return r;
}
