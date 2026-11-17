/**
 * R4.3: reads (never writes) what the richer Calendar file needs. Unlike the Calendar screen, which shows an empty layer when its provider fails, the export
 * must NOT turn a failure into "nothing scheduled": each provider's result says whether it was read, so the dialog can name the source it could not read and
 * let the owner try again or leave that layer out.
 */
import { allDueProviders, type DerivedItem } from '../../core/dueProvider';
import { createStore } from '../../core/store';
import type { FinanceDB } from '../../db';
import { db } from '../../db';
import { exportEnd } from './exportPlan';
import { loadEvents, loadLayers } from './data';
import type { CalendarLayer, EventRecord } from './model';

export interface ProviderRead { providerId: string; ok: boolean; items: DerivedItem[]; error?: string }

/** Asks each named provider for today..12 months ahead. A provider that throws (or is not registered) is reported as not read, never as empty. */
export async function readProviders(ids: readonly string[], today: string): Promise<ProviderRead[]> {
  const to = exportEnd(today);
  const q = { from: today, to, today, overdueDays: 0 };
  return Promise.all(ids.map(async (providerId): Promise<ProviderRead> => {
    const p = allDueProviders().find((x) => x.id === providerId);
    if (!p) return { providerId, ok: false, items: [], error: 'This source is not available.' };
    try {
      const rows = await p.getDueItems(q);
      return { providerId, ok: true, items: rows.filter((r) => r.date >= today && r.date <= to) };
    } catch (e) {
      return { providerId, ok: false, items: [], error: e instanceof Error && e.message ? e.message : 'It could not be read.' };
    }
  }));
}

export interface ExportStored { layers: CalendarLayer[]; events: EventRecord[]; tags: Map<number, string> }

/** The owner's own calendars, events and tag names (read only). */
export async function readStored(d: FinanceDB = db): Promise<ExportStored> {
  const [layers, events, tags] = await Promise.all([loadLayers(d), loadEvents(d), createStore(d).shared.tags.query()]);
  return { layers, events, tags: new Map(tags.map((t) => [t.id as number, t.name])) };
}
