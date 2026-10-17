import type { FinanceDB } from '../db';
import type { NetWorthSnapshot } from '../types';
import type { NetWorth } from './netWorth';
import { loadNetWorth } from './netWorthLive';

/**
 * Net worth history. One point is kept per month: opening the app updates this month's point with the latest figures, so the
 * month's last view is what the chart shows. A past month cannot be recomputed, so earlier points can be added by hand.
 */

export const snapshotOf = (date: string, nw: NetWorth): NetWorthSnapshot => ({
  date,
  cashCents: nw.cash,
  investmentsCents: nw.investments,
  propertyCents: nw.property,
  cardsCents: nw.cards,
  loansCents: nw.loans,
  totalCents: nw.total,
});

const isEmpty = (nw: NetWorth) => nw.cash === 0 && nw.investments === 0 && nw.property === 0 && nw.cards === 0 && nw.loans === 0;

export async function saveMonthlySnapshot(d: FinanceDB, today: string, nw: NetWorth): Promise<'created' | 'updated' | 'skipped'> {
  if (isEmpty(nw)) return 'skipped';
  const month = today.slice(0, 7);
  return d.transaction('rw', d.netWorthSnapshots, async () => {
    const existing = (await d.netWorthSnapshots.toArray()).filter((s) => s.date.startsWith(month));
    const snap = snapshotOf(today, nw);
    if (existing.length === 0) {
      await d.netWorthSnapshots.add(snap);
      return 'created' as const;
    }
    // Keep a hand-entered point for this month only if it is later than today (cannot happen normally).
    const [keep, ...extra] = existing.sort((a, b) => b.date.localeCompare(a.date));
    for (const e of extra) await d.netWorthSnapshots.delete(e.id!);
    await d.netWorthSnapshots.put({ ...snap, id: keep.id });
    return 'updated' as const;
  });
}

/** Updates this month's point from the current data. */
export async function snapshotNow(d: FinanceDB, today: string) {
  return saveMonthlySnapshot(d, today, await loadNetWorth(d, today));
}

export const sortedSnapshots = (s: NetWorthSnapshot[]) => [...s].sort((a, b) => a.date.localeCompare(b.date));

/** Change between the first and last point, and over the most recent year if there is enough history. */
export function changeOver(s: NetWorthSnapshot[]): { total: number; sinceCents: number; since: string } | null {
  const sorted = sortedSnapshots(s);
  if (sorted.length < 2) return null;
  const last = sorted[sorted.length - 1];
  const yearAgo = `${Number(last.date.slice(0, 4)) - 1}${last.date.slice(4)}`;
  const base = [...sorted].reverse().find((x) => x.date <= yearAgo) ?? sorted[0];
  return { total: last.totalCents, sinceCents: last.totalCents - base.totalCents, since: base.date };
}
