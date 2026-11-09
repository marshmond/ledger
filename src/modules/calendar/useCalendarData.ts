/**
 * Everything the Calendar draws for a range of days: the user's own events (expanded into occurrences) and whatever the registered
 * due providers report for that range, each tagged with its calendar layer. Re-runs by itself when any of the data changes.
 */
import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { allDueProviders, queryProviders, type DerivedItem } from '../../core/dueProvider';
import { loadProjectChoices, projectLabel, readProjectId } from '../../core/projectLink';
import { loadCalendarSettings, type CalendarSettings } from '../../core/calendarSettings';
import type { Priority } from '../../core/entities';
import { addDays } from '../../lib/dates';
import { todayISO } from '../../lib/money';
import { loadEvents, loadLayers } from './data';
import { msAt, parseHM } from './time';
import { PERSONAL_ID, type CalendarLayer, type EventRecord } from './model';
import { occurrencesOf, statusOf, type Occurrence } from './occurrences';
import { storedItemKey } from './markerCoordination';
import { loadHideAmounts } from '../../core/hideAmounts';
import {
  ALL_ON, deselectAll, isLayerVisible, parseVisibility, selectAll, serializeVisibility, toggleLayer, VISIBILITY_KEY, visibleCount, type Visibility,
} from './layerVisibility';

export interface CalItem {
  /** Unique for React lists. */
  key: string;
  title: string;
  layerId: number;
  layerName: string;
  color: string;
  derived: boolean;
  allDay: boolean;
  firstDay: string;
  lastDay: string;
  startMs: number;
  endMs: number;
  priority: Priority;
  location: string;
  done: boolean;
  /** Needs attention and is past due. */
  overdue: boolean;
  /** A reminder time has passed and it has not started yet. */
  soon: boolean;
  recurring: boolean;
  occ?: Occurrence;
  source?: DerivedItem;
  /** The project this event or task belongs to, with the words to show for it. Absent when it has none. */
  project?: { id: number; label: string };
}

export function readVisibility(): Visibility {
  try { return parseVisibility(localStorage.getItem(VISIBILITY_KEY)); } catch { return ALL_ON; }
}

/**
 * Which calendars are switched on (B3.0B). Kept on this device only (a convenience, not data); the rules are in `layerVisibility.ts`.
 * `available` is the ids of the layers that exist right now. Changing a switch writes only this one preference: no event, Task, record or
 * network request is touched.
 */
export function useLayerVisibility(available: number[]) {
  const [vis, setVis] = useState<Visibility>(readVisibility);
  const apply = (change: (cur: Visibility) => Visibility) => setVis((cur) => {
    const next = change(cur);
    try { localStorage.setItem(VISIBILITY_KEY, serializeVisibility(next)); } catch { /* storage unavailable: the choice lasts until the page closes */ }
    return next;
  });
  return {
    vis,
    isVisible: (layerId: number) => isLayerVisible(vis, layerId),
    count: visibleCount(vis, available),
    toggle: (id: number) => apply((cur) => toggleLayer(cur, id, available)),
    selectAll: () => apply(() => selectAll()),
    deselectAll: () => apply(() => deselectAll()),
  };
}

/** The current time, refreshed every 30 seconds (for the "now" line and reminder indicators). */
export function useNow(everyMs = 30_000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), everyMs); return () => clearInterval(t); }, [everyMs]);
  return now;
}

export interface CalendarData {
  layers: CalendarLayer[];
  settings: CalendarSettings;
  events: EventRecord[];
  items: CalItem[];
}

export function useCalendarData(from: string, to: string, includeOverdue: boolean, now: number): CalendarData | undefined {
  const today = todayISO();
  // The Finance layer words its titles by the Hide Amounts switch, so a change of that switch must redraw (B3.0B).
  const hide = loadHideAmounts();
  const raw = useLiveQuery(async () => {
    const settings = await loadCalendarSettings();
    const overdueDays = includeOverdue ? settings.overdueDays : 0;
    const [layers, events, derived, projects] = await Promise.all([
      loadLayers(),
      loadEvents(),
      queryProviders({ from, to, today, overdueDays }),
      loadProjectChoices(),
    ]);
    return { layers, events, derived, settings, projects };
  }, [from, to, includeOverdue, today, hide]);

  return useMemo(() => {
    if (!raw) return undefined;
    const { layers, events, derived, settings, projects } = raw;
    const projectOf = (id: number | undefined) => (id === undefined ? undefined : { id, label: projectLabel(projects, id) });
    const byId = new Map(layers.map((l) => [l.id, l]));
    const fallback = byId.get(PERSONAL_ID) ?? { id: PERSONAL_ID, name: 'Personal', color: '#4a7bd0', sourceType: 'local' as const };
    const items: CalItem[] = [];
    // Stored events (the range is widened so overdue "keep until done" events can be listed)
    const evFrom = includeOverdue ? addDays(today, -settings.overdueDays) < from ? addDays(today, -settings.overdueDays) : from : from;
    for (const ev of events) {
      const layer = byId.get(ev.data.calendarId) ?? fallback;
      for (const o of occurrencesOf(ev, evFrom, to)) {
        const st = statusOf(o, now);
        items.push({
          key: storedItemKey(o.eventId, o.key), title: o.title || '(no title)', layerId: layer.id, layerName: layer.name, color: layer.color,
          derived: false, allDay: o.allDay, firstDay: o.firstDay, lastDay: o.lastDay, startMs: o.startMs, endMs: o.endMs,
          priority: o.priority, location: o.location, done: o.done, overdue: st.overdue, soon: st.soon, recurring: o.recurring, occ: o,
          project: projectOf(readProjectId(o.event.data)),
        });
      }
    }
    // Derived items from each provider, on that provider's layer
    for (const p of allDueProviders()) {
      const layer = layers.find((l) => l.providerId === p.id);
      for (const it of derived[p.id] ?? []) {
        // All-day unless the provider gave a clock time (a task due at 2:30pm); a timed item is shown as a half hour.
        const mins = !it.allDay && it.time ? parseHM(it.time) : null;
        const startMs = msAt(it.date, mins ?? 0);
        const open = it.status === 'open';
        items.push({
          key: `d:${it.id}`, title: it.title, layerId: layer?.id ?? -1, layerName: layer?.name ?? p.layerName, color: layer?.color ?? p.color,
          derived: true, allDay: mins === null, firstDay: it.date, lastDay: it.endDate ?? it.date, startMs, endMs: mins === null ? msAt(addDays(it.endDate ?? it.date, 1)) : startMs + 30 * 60_000,
          priority: it.priority, location: '', done: !open, overdue: open && it.date < today, soon: false, recurring: false, source: it,
          project: projectOf(it.projectId),
        });
      }
    }
    return { layers, settings, events, items };
  }, [raw, now, from, to, includeOverdue, today]);
}

export const PRIORITY_ORDER: Record<Priority, number> = { high: 0, medium: 1, low: 2, reminder: 3 };

/** Order within a day: all-day first, then by start time, then priority, then title. */
export function sortItems(a: CalItem, b: CalItem) {
  return Number(b.allDay) - Number(a.allDay) || a.startMs - b.startMs || PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || a.title.localeCompare(b.title);
}

export const onDay = (items: CalItem[], date: string) => items.filter((i) => i.firstDay <= date && i.lastDay >= date).sort(sortItems);
