import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../../db';
import { allWeekReaders } from '../../../core/registry';
import { loadForecast } from '../../../lib/forecastLive';
import { useCalendarData, useNow } from '../../calendar/useCalendarData';
import { useNeedsYou } from '../useNeedsYou';
import { ready, weekWindow, type Part, type WeekInputs } from './weekModel';

/**
 * One independent, READ-ONLY live read. A read that throws becomes `failed` (the review then says it is incomplete), never "nothing": one source failing
 * leaves every other section working. The read re-runs by itself when the data it touched changes, like every other live screen in Ledger.
 */
function usePart<T>(read: () => Promise<T>, deps: unknown[]): Part<T> {
  const r = useLiveQuery(async () => {
    try { return { ok: true as const, value: await read() }; } catch { return { ok: false as const }; }
  }, deps);
  return !r ? { state: 'loading' } : r.ok ? ready(r.value) : { state: 'failed' };
}

const missing = () => Promise.reject(new Error('This part of the review is not offered by any module.'));

/**
 * Everything the weekly review reads, each part on its own, as the same readers the rest of Ledger uses. The module readers (payments, family, maintenance,
 * projects over budget) come from the registry (`contributes.weekReview`), so this screen imports no module. NOTHING is written: the Calendar hook, the
 * Needs-you hook (whose Ledger alerts run read-only, so the monthly check-in is not saved by looking), and the readers below are all reads. Call it inside
 * `AttentionProviders` (Needs you needs Ledger's shared alerts).
 */
export function useWeekInputs(today: string, opts: { cash?: boolean } = {}): WeekInputs {
  const readers = useMemo(() => allWeekReaders(), []);
  const needs = useNeedsYou(today);
  const now = useNow();
  const calendar = useCalendarData(today, weekWindow(today).to, false, now);
  const money = usePart(() => (readers.money ?? missing)(today), [today]);
  // `cash: false` (Quick Answers) skips the Forecast read, which the short answer does not show; the review page always reads it.
  const cash = usePart(() => (opts.cash === false ? Promise.resolve(null) : loadForecast(db, today)), [today, opts.cash]);
  const assets = usePart(() => (readers.maintenance ?? missing)(today), [today]);
  const overBudget = usePart(() => (readers.overBudget ?? missing)(), []);
  const family = usePart(() => (readers.family ?? missing)(today), [today]);
  return {
    today,
    needs: needs.ready ? ready({ ranked: needs.ranked, failed: needs.failed }) : { state: 'loading' },
    calendar: calendar ? ready(calendar.items) : { state: 'loading' },
    money, cash, assets, overBudget, family,
  };
}
