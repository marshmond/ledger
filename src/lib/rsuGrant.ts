import type { FinanceDB } from '../db';
import type { RsuGrant, RsuVest, Security, VestFrequency } from '../types';
import { fetchPrice } from './prices';
import { todayISO } from './money';

export const FREQUENCY_MONTHS: Record<VestFrequency, number> = { monthly: 1, quarterly: 3, semiannual: 6, annual: 12 };
export const FREQUENCY_LABELS: Record<VestFrequency, string> = { monthly: 'Monthly', quarterly: 'Quarterly', semiannual: 'Semi-annually', annual: 'Annually' };

const pad = (n: number) => String(n).padStart(2, '0');
const daysInMonth = (y: number, m1: number) => new Date(Date.UTC(y, m1, 0)).getUTCDate();

/** The date `months` after `start`, on the same day of the month (the month's last day if it has no such day: Jan 31 + 1 month = Feb 28). */
export function addMonths(start: string, months: number): string {
  const [y, m, d] = start.split('-').map(Number);
  const idx = y * 12 + (m - 1) + months;
  const ny = Math.floor(idx / 12);
  const nm = (idx % 12) + 1;
  return `${ny}-${pad(nm)}-${pad(Math.min(d, daysInMonth(ny, nm)))}`;
}

/** Why a grant cannot be saved yet, or null when it is complete. */
export function grantProblem(g: Partial<RsuGrant>): string | null {
  if (!g.personId) return 'Choose a person';
  if (!(g.name ?? '').trim()) return 'Give the grant a name';
  if (!g.startDate || !/^\d{4}-\d{2}-\d{2}$/.test(g.startDate) || Number.isNaN(Date.parse(g.startDate))) return 'Enter the start date';
  if (!g.frequency || !(g.frequency in FREQUENCY_MONTHS)) return 'Choose how often it vests';
  if (!(Number.isInteger(g.years) && g.years! >= 1 && g.years! <= 10)) return 'Enter the length in whole years (1 to 10)';
  if (g.cliffMonths != null && !(Number.isInteger(g.cliffMonths) && g.cliffMonths >= 1 && g.cliffMonths < g.years! * 12)) return 'The cliff must be a whole number of months, shorter than the whole agreement';
  if (g.kind === 'cash') {
    if (!(g.priceCents != null && g.priceCents > 0)) return 'Enter the price per share this cash award pays at';
  } else {
    if (!g.securityId) return 'Enter the stock ticker';
    if (g.afterVest === 'held' && !g.accountId) return 'Choose the brokerage account that will hold the shares';
  }
  return null;
}

/**
 * The vest dates of a grant: one every period after the start date until the agreement ends. With a cliff, nothing vests before it;
 * the first vest is on the cliff date, and the regular dates continue after that.
 */
export function vestDates(g: Pick<RsuGrant, 'startDate' | 'frequency' | 'years' | 'cliffMonths'>): string[] {
  const step = FREQUENCY_MONTHS[g.frequency];
  const total = g.years * 12;
  const offsets: number[] = [];
  for (let m = step; m <= total; m += step) offsets.push(m);
  const cliff = g.cliffMonths && g.cliffMonths > 0 ? g.cliffMonths : 0;
  if (cliff) {
    const after = offsets.filter((m) => m > cliff);
    offsets.length = 0;
    offsets.push(cliff, ...after);
  }
  return offsets.map((m) => addMonths(g.startDate, m));
}

/**
 * Splits `total` shares across `n` vests. Whole totals split into whole shares (the extra ones go to the earliest vests);
 * a fractional total splits to four decimals with the remainder on the last vest.
 */
export function evenSplit(total: number, n: number): number[] {
  if (n <= 0 || !(total > 0)) return [];
  if (Number.isInteger(total)) {
    const base = Math.floor(total / n);
    const extra = total - base * n;
    return Array.from({ length: n }, (_, i) => base + (i < extra ? 1 : 0));
  }
  const each = Math.floor((total / n) * 10000) / 10000;
  const out = Array.from({ length: n }, () => each);
  out[n - 1] = Math.round((total - each * (n - 1)) * 10000) / 10000;
  return out;
}

/** What a change to a grant's schedule does to the vests already entered. */
export function scheduleChange(grant: RsuGrant, vests: RsuVest[]): { dates: string[]; orphaned: RsuVest[] } {
  const dates = vestDates(grant);
  const set = new Set(dates);
  return { dates, orphaned: vests.filter((v) => v.grantId === grant.id && !set.has(v.date)) };
}

/** The fields a vest takes from its grant (everything except shares, date, and a price entered on that vest). */
export function vestFromGrant(g: RsuGrant): Pick<RsuVest, 'personId' | 'grant' | 'grantId' | 'kind' | 'securityId' | 'afterVest' | 'accountId'> {
  const stock = g.kind === 'stock';
  return {
    personId: g.personId,
    grant: g.name.trim(),
    grantId: g.id!,
    kind: g.kind,
    securityId: stock ? g.securityId ?? null : null,
    afterVest: stock ? g.afterVest ?? 'sold' : undefined,
    accountId: stock && g.afterVest === 'held' ? g.accountId ?? null : null,
  };
}

/**
 * Sets the shares on one vest date of a grant: adds the vest, changes it, or (zero shares) removes it. A vest whose shares were
 * already added to holdings is left alone.
 */
export async function setVestShares(d: FinanceDB, grant: RsuGrant, date: string, shares: number): Promise<'added' | 'changed' | 'removed' | 'locked' | 'none'> {
  return d.transaction('rw', d.rsuVests, async () => {
    const existing = (await d.rsuVests.where('grantId').equals(grant.id!).toArray()).find((v) => v.date === date);
    if (existing?.recorded) return 'locked';
    if (!(shares > 0)) {
      if (!existing) return 'none';
      await d.rsuVests.delete(existing.id!);
      return 'removed';
    }
    if (existing) {
      await d.rsuVests.update(existing.id!, { shares });
      return 'changed';
    }
    await d.rsuVests.add({
      ...vestFromGrant(grant),
      date,
      shares,
      priceCents: grant.kind === 'cash' ? grant.priceCents ?? null : null,
      recorded: false,
    });
    return 'added';
  });
}

/** Fills every vest date with an even split of `total` shares (replacing shares already typed; vests already in holdings are kept). */
export async function fillEvenly(d: FinanceDB, grant: RsuGrant, total: number): Promise<number> {
  const dates = vestDates(grant);
  const parts = evenSplit(total, dates.length);
  let n = 0;
  for (let i = 0; i < dates.length; i++) {
    const r = await setVestShares(d, grant, dates[i], parts[i] ?? 0);
    if (r !== 'locked' && r !== 'none') n++;
  }
  return n;
}

/**
 * Saves a grant and carries the changes to its vests. New schedule dates need nothing (a vest exists once it has shares); vests
 * that no longer fall on a schedule date are removed (unless already in holdings, which are kept and unlinked).
 * Cash price changes reach the vests that still use the old grant price, so a price typed on one vest is kept.
 */
export async function saveGrant(d: FinanceDB, grant: RsuGrant): Promise<number> {
  return d.transaction('rw', d.rsuGrants, d.rsuVests, async () => {
    const clean: RsuGrant = { ...grant, name: grant.name.trim(), cliffMonths: grant.cliffMonths || null };
    const before = grant.id ? await d.rsuGrants.get(grant.id) : undefined;
    if (!before) return d.rsuGrants.add(clean);
    const id = before.id!;
    const saved: RsuGrant = { ...clean, id };
    await d.rsuGrants.put(saved);

    const vests = await d.rsuVests.where('grantId').equals(id).toArray();
    const { orphaned } = scheduleChange(saved, vests);
    for (const v of orphaned) {
      if (v.recorded) await d.rsuVests.update(v.id!, { grantId: null });
      else await d.rsuVests.delete(v.id!);
    }
    const gone = new Set(orphaned.map((v) => v.id));
    for (const v of vests) {
      if (gone.has(v.id)) continue;
      const patch: Partial<RsuVest> = { ...vestFromGrant(saved) };
      if (v.recorded) {
        // Shares already in holdings keep where they went; only the name and link follow the grant.
        delete patch.kind; delete patch.securityId; delete patch.afterVest; delete patch.accountId;
      }
      if (!v.recorded && before.kind !== saved.kind) patch.priceCents = saved.kind === 'cash' ? saved.priceCents ?? null : null;
      else if (!v.recorded && saved.kind === 'cash' && (v.priceCents == null || v.priceCents === before.priceCents)) patch.priceCents = saved.priceCents ?? null;
      await d.rsuVests.update(v.id!, patch);
    }
    return id;
  });
}

/** Deletes a grant and its vests; vests already added to holdings stay as ordinary vests. Returns how many vests were removed. */
export async function deleteGrant(d: FinanceDB, grantId: number): Promise<number> {
  return d.transaction('rw', d.rsuGrants, d.rsuVests, async () => {
    const vests = await d.rsuVests.where('grantId').equals(grantId).toArray();
    let removed = 0;
    for (const v of vests) {
      if (v.recorded) await d.rsuVests.update(v.id!, { grantId: null });
      else { await d.rsuVests.delete(v.id!); removed++; }
    }
    await d.rsuGrants.delete(grantId);
    return removed;
  });
}

/** Finds the security for a ticker (any case) or creates it in the given asset class. */
export async function securityForTicker(d: FinanceDB, ticker: string, assetClassId: number): Promise<Security> {
  const t = ticker.trim().toUpperCase();
  return d.transaction('rw', d.securities, async () => {
    const found = (await d.securities.toArray()).find((s) => s.ticker.toUpperCase() === t);
    if (found) return found;
    const id = await d.securities.add({ ticker: t, name: t, assetClassId, priceCents: null, priceDate: null, priceSource: null });
    return (await d.securities.get(id))!;
  });
}

/** Looks up today's price for a security with the price key stored on this device and saves it. Returns a message for the screen. */
export async function refreshSecurityPrice(d: FinanceDB, security: Security, fetchImpl?: Parameters<typeof fetchPrice>[2]): Promise<{ ok: boolean; message: string }> {
  const key = ((await d.settings.get('priceApiKey')) as { value?: string } | undefined)?.value;
  if (!key) return { ok: false, message: 'No price key on this device, so enter the price for this stock on the Investments tab.' };
  const r = await fetchPrice(security.ticker, key, fetchImpl);
  if (r.cents === undefined) return { ok: false, message: `${security.ticker}: ${r.error ?? 'no price returned'}` };
  await d.securities.update(security.id!, { priceCents: r.cents, priceDate: todayISO(), priceSource: 'api' });
  return { ok: true, message: `${security.ticker} is $${(r.cents / 100).toFixed(2)}` };
}
