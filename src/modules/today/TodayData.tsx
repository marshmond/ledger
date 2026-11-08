/**
 * The one place Today reads its dated items. A single aggregation (the Calendar's own data hook: your events plus every due provider)
 * covers the overdue window, today and the look-ahead, and the cards below just slice that list. It re-runs by itself when anything
 * it read changes. Cards from other modules (Ledger's alerts) do not need it; they use their own queries.
 */
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { allDueProviders } from '../../core/dueProvider';
import { loadCalendarSettings } from '../../core/calendarSettings';
import { useSharedLive } from '../../core/sharedLive';
import { getModule } from '../../core/registry';
import { addDays } from '../../lib/dates';
import { useCalendarData, useNow, type CalItem } from '../calendar/useCalendarData';
import { dropCovered } from '../calendar/markerCoordination';
import { loadTodaySettings } from './settings';

export interface OlderLink {
  moduleId: string;
  moduleName: string;
  count: number;
  /** A full address such as `/tasks?v=overdue`. */
  path: string;
}

export interface TodayData {
  today: string;
  /** undefined while loading */
  items: CalItem[] | undefined;
  overdueDays: number;
  lookAheadDays: number;
  overdueRows: number;
  older: OlderLink[];
}

const Ctx = createContext<TodayData>({ today: '', items: undefined, overdueDays: 30, lookAheadDays: 7, overdueRows: 25, older: [] });
export const useTodayData = () => useContext(Ctx);

export const moduleName = (id: string) => (id === 'calendar' ? 'Calendar' : getModule(id)?.name ?? id);

export function TodayDataProvider({ today, children }: { today: string; children: ReactNode }) {
  const now = useNow();
  const settings = useLiveQuery(() => loadTodaySettings(), []);
  const calSettings = useLiveQuery(() => loadCalendarSettings(), []);
  const lookAheadDays = settings?.lookAheadDays ?? 7;
  const overdueRows = settings?.overdueRows ?? 25;
  const overdueDays = calSettings?.overdueDays ?? 30;
  const data = useCalendarData(today, addDays(today, lookAheadDays), true, now);

  // "N older items": open things dated before the overdue window, which the Overdue card leaves out. One query for all modules.
  const olderRaw = useSharedLive(`today.older:${today}:${overdueDays}`, async () => {
    const cutoff = addDays(today, -overdueDays);
    const out: OlderLink[] = [];
    for (const p of allDueProviders()) {
      if (!p.olderThan) continue;
      try {
        const r = await p.olderThan(cutoff, today);
        if (r && r.count > 0) out.push({ moduleId: p.id, moduleName: moduleName(p.id), count: r.count, path: r.path });
      } catch { /* one module failing must not hide the others */ }
    }
    return out;
  });

  const value = useMemo<TodayData>(
    () => ({ today, items: data?.items ? dropCovered(data.items) : undefined, overdueDays, lookAheadDays, overdueRows, older: olderRaw ?? [] }),
    [today, data, overdueDays, lookAheadDays, overdueRows, olderRaw],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
