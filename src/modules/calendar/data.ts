/**
 * Reading and writing Calendar records. Writes go through the shared store's `repo`, so every record has an id, createdAt and
 * updatedAt, and deleting is soft (the record stays as a marker so the deletion reaches other devices). Reads are plain database
 * queries so screens can wrap them in `useLiveQuery` and redraw on any change.
 */
import { db, type FinanceDB } from '../../db';
import type { ModuleRecord } from '../../core/entities';
import { allDueProviders } from '../../core/dueProvider';
import { loadCalendarSettings } from '../../core/calendarSettings';
import { createStore, isLive, repo } from '../../core/store';
import {
  ASSETS_ID, asEvent, asLayer, BILLS_ID, FAMILY_ID, FINANCE_ID, MODULE, PERSONAL_ID, PROJECTS_ID, SERVICES_ID, SWATCHES, TASKS_ID,
  type CalendarLayer, type EventData, type EventFields, type EventRecord, type LayerData,
} from './model';
import { endSeriesBefore, editAll, editOccurrence, setDone, skipOccurrence, splitFollowing, type SeriesExtras } from './series';
import type { Occurrence } from './occurrences';

const rows = (d: FinanceDB) => repo<ModuleRecord>(d.moduleRecords);

export async function loadLayers(d: FinanceDB = db): Promise<CalendarLayer[]> {
  const all = await d.moduleRecords.where('[module+kind]').equals([MODULE, 'calendar']).toArray();
  return all.filter(isLive).map(asLayer).sort((a, b) => Number(!!b.builtin) - Number(!!a.builtin) || a.name.localeCompare(b.name));
}

export async function loadEvents(d: FinanceDB = db): Promise<EventRecord[]> {
  const all = await d.moduleRecords.where('[module+kind]').equals([MODULE, 'event']).toArray();
  return all.filter(isLive).map(asEvent);
}

/**
 * Makes sure the built-in calendars exist: Personal (local), Finance (fed by Ledger's provider), Tasks (fed by the Tasks provider) and Projects (project start and target dates, fed by the Projects provider) and Home & Assets (warranty end dates, fed by the Home & Assets provider).
 * Check-then-insert happens inside one transaction (React's dev mode runs effects twice). Built-ins use fixed ids so two devices
 * that each create them end up with one.
 */
export async function ensureCalendarSeed(d: FinanceDB = db): Promise<void> {
  await d.transaction('rw', d.moduleRecords, async () => {
    const have = new Set((await d.moduleRecords.where('[module+kind]').equals([MODULE, 'calendar']).toArray()).map((r) => r.id));
    const now = Date.now();
    const builtins: [number, LayerData][] = [
      [PERSONAL_ID, { name: 'Personal', color: SWATCHES[0], sourceType: 'local', builtin: true }],
      [FINANCE_ID, { name: 'Finance', color: allDueProviders().find((p) => p.id === 'ledger')?.color ?? '#2f8f6b', sourceType: 'derived', providerId: 'ledger', builtin: true }],
      [TASKS_ID, { name: 'Tasks', color: '#c0562f', sourceType: 'derived', providerId: 'tasks', builtin: true }],
      [PROJECTS_ID, { name: 'Projects', color: allDueProviders().find((p) => p.id === 'projects')?.color ?? '#8a5cc7', sourceType: 'derived', providerId: 'projects', builtin: true }],
      [ASSETS_ID, { name: 'Home & Assets', color: allDueProviders().find((p) => p.id === 'assets')?.color ?? '#b07a1f', sourceType: 'derived', providerId: 'assets', builtin: true }],
      [SERVICES_ID, { name: 'Household Services', color: allDueProviders().find((p) => p.id === 'services')?.color ?? '#2f7f9a', sourceType: 'derived', providerId: 'services', builtin: true }],
      [BILLS_ID, { name: 'Bills & Subscriptions', color: allDueProviders().find((p) => p.id === 'bills')?.color ?? '#b94a7c', sourceType: 'derived', providerId: 'bills', builtin: true }],
      [FAMILY_ID, { name: 'Family', color: allDueProviders().find((p) => p.id === 'family')?.color ?? '#c4398a', sourceType: 'derived', providerId: 'family', builtin: true }],
    ];
    for (const [id, data] of builtins) {
      if (!have.has(id)) await d.moduleRecords.add({ id, module: MODULE, kind: 'calendar', data: { ...data }, createdAt: now, updatedAt: now, deletedAt: null });
    }
  });
}

/** Where new events go: the default calendar from Settings if it still exists, otherwise Personal. */
export async function defaultCalendarId(d: FinanceDB = db): Promise<number> {
  const s = await loadCalendarSettings(d);
  const layers = await loadLayers(d);
  const ok = layers.find((l) => l.id === s.defaultCalendarId && l.sourceType === 'local');
  return ok?.id ?? PERSONAL_ID;
}

// ---- calendars ----

export async function createCalendar(name: string, color: string, d: FinanceDB = db): Promise<number> {
  const data: LayerData = { name: name.trim() || 'New calendar', color, sourceType: 'local' };
  return rows(d).put({ module: MODULE, kind: 'calendar', data: { ...data } });
}

export async function updateCalendar(id: number, patch: Partial<Pick<LayerData, 'name' | 'color'>>, d: FinanceDB = db): Promise<void> {
  const r = await rows(d).get(id);
  if (!r) return;
  await rows(d).put({ id, module: MODULE, kind: 'calendar', data: { ...r.data, ...patch } });
}

/**
 * Deletes a local calendar. Its events are either moved to another calendar or deleted with it (soft: they can be restored).
 * The built-in calendars cannot be deleted.
 */
export async function deleteCalendar(id: number, events: 'move' | 'delete', moveTo: number = PERSONAL_ID, d: FinanceDB = db): Promise<number> {
  return d.transaction('rw', d.moduleRecords, async () => {
    const layer = asLayerMaybe(await rows(d).get(id));
    if (!layer || layer.builtin || layer.sourceType !== 'local') return 0;
    const mine = (await loadEvents(d)).filter((e) => e.data.calendarId === id);
    for (const e of mine) {
      if (events === 'move') await rows(d).put({ id: e.id, module: MODULE, kind: 'event', data: { ...e.data, calendarId: moveTo } });
      else await rows(d).remove(e.id);
    }
    await rows(d).remove(id);
    return mine.length;
  });
}
const asLayerMaybe = (r: ModuleRecord | undefined) => (r ? asLayer(r) : undefined);

// ---- events ----

export const newEventData = (f: EventFields, extras: SeriesExtras): EventData => ({ ...f, ...extras, skipped: [], overrides: {}, doneKeys: [] });

export async function createEvent(data: EventData, d: FinanceDB = db): Promise<number> {
  return rows(d).put({ module: MODULE, kind: 'event', data: { ...data } });
}

/** Deletes a whole event by id (soft, like every delete). Used by Undo after the Add box creates one. */
/**
 * Puts a whole event (every date of a repeating one) on a project, or takes it off with `null`. Nothing else about the event changes,
 * and fields this code does not know are kept. Throws if the event is gone or the project does not exist.
 */
export async function setEventProject(id: number, projectId: number | null, d: FinanceDB = db): Promise<void> {
  await d.transaction('rw', d.moduleRecords, async () => {
    const ev = await current(id, d);
    if (projectId !== null) {
      const p = await d.moduleRecords.get(projectId);
      if (!p || p.module !== 'projects' || p.kind !== 'project' || !isLive(p)) throw new Error('That project no longer exists.');
    }
    const { projectId: _old, ...rest } = ev.data;
    await save(id, projectId === null ? (rest as EventData) : { ...rest, projectId }, d);
  });
}

/** The live events that belong to a project (a repeating event counts once). */
export async function loadProjectEvents(projectId: number, d: FinanceDB = db): Promise<EventRecord[]> {
  return (await loadEvents(d)).filter((e) => !e.data.retired && e.data.projectId === projectId);
}

export async function removeEventById(id: number, d: FinanceDB = db): Promise<void> {
  await rows(d).remove(id);
}

async function save(id: number, data: EventData, d: FinanceDB) {
  await rows(d).put({ id, module: MODULE, kind: 'event', data: { ...data } });
}
async function current(id: number, d: FinanceDB): Promise<EventRecord> {
  const r = await rows(d).get(id);
  if (!r || r.module !== MODULE || r.kind !== 'event') throw new Error('That event no longer exists.');
  return asEvent(r);
}

export type Scope = 'one' | 'following' | 'all';

/** Saves an edit made to one occurrence (or a one-off event). Returns the id of the event now holding the edited occurrence. */
export async function saveEdit(occ: Occurrence, edited: EventFields, extras: SeriesExtras, scope: Scope, d: FinanceDB = db): Promise<number> {
  return d.transaction('rw', d.moduleRecords, d.links, async () => {
    const ev = await current(occ.eventId, d);
    if (!ev.data.recurrence) {
      await save(ev.id, { ...ev.data, ...edited, ...extras, recurrence: extras.recurrence }, d);
      return ev.id;
    }
    if (scope === 'one') {
      // Calendar, tags, contacts and the repeat rule belong to the whole series; a single occurrence changes its own details only.
      await save(ev.id, editOccurrence(ev.data, occ.key, edited), d);
      return ev.id;
    }
    if (scope === 'following') {
      const split = splitFollowing(ev.data, occ.key, edited, extras);
      if (split) {
        await save(ev.id, split.old, d);
        const newId = await rows(d).put({ module: MODULE, kind: 'event', data: { ...split.next } });
        await copyLinks(ev.id, newId, d);
        return newId;
      }
    }
    await save(ev.id, editAll(ev.data, occ, edited, extras), d);
    return ev.id;
  });
}

/** Deletes a one-off event, one occurrence, this-and-following, or the whole series. Everything is soft, so Undo can bring it back. */
export async function removeOccurrence(occ: Occurrence, scope: Scope, d: FinanceDB = db): Promise<void> {
  await d.transaction('rw', d.moduleRecords, async () => {
    const ev = await current(occ.eventId, d);
    if (!ev.data.recurrence || scope === 'all') return void (await rows(d).remove(ev.id));
    if (scope === 'one') return save(ev.id, skipOccurrence(ev.data, occ.key), d);
    const ended = endSeriesBefore(ev.data, occ.key);
    if (ended) await save(ev.id, ended, d);
    else await rows(d).remove(ev.id);
  });
}

/**
 * Retires an event because another module (Ledger) took it over: the event is soft-deleted, with a note saying where it went, so it
 * is no longer on the calendar (the other module's own item is) but nothing is lost. Returns false if the event is already gone.
 */
export async function retireEvent(id: number, to: { module: string; recordId: string | number; note: string }, d: FinanceDB = db): Promise<boolean> {
  return d.transaction('rw', d.moduleRecords, async () => {
    const r = await rows(d).get(id);
    if (!r || r.module !== MODULE || r.kind !== 'event') return false;
    await save(id, { ...asEvent(r).data, retired: to }, d);
    await rows(d).remove(id);
    return true;
  });
}

/** Puts back exactly what an earlier change replaced (used by Undo). */
export async function restoreEventData(id: number, data: EventData | null, d: FinanceDB = db): Promise<void> {
  await d.transaction('rw', d.moduleRecords, async () => {
    const r = await d.moduleRecords.get(id);
    if (!r) return;
    if (data) await d.moduleRecords.put({ ...r, data: { ...data }, deletedAt: null, updatedAt: Date.now() });
    else await rows(d).restore(id);
  });
}
export async function snapshotEvent(id: number, d: FinanceDB = db): Promise<EventData | null> {
  const r = await d.moduleRecords.get(id);
  return r ? asEvent(r).data : null;
}

export async function markOccurrenceDone(occ: Occurrence, done: boolean, d: FinanceDB = db): Promise<void> {
  await d.transaction('rw', d.moduleRecords, async () => {
    const ev = await current(occ.eventId, d);
    await save(ev.id, setDone(ev.data, occ.key, done), d);
  });
}

// ---- links (records an event is connected to) ----

async function copyLinks(fromId: number, toId: number, d: FinanceDB) {
  const s = createStore(d);
  for (const l of await s.shared.links.linkedTo({ module: MODULE, id: fromId })) {
    if (l.fromModule === MODULE && l.fromId === fromId) await s.shared.links.add({ module: MODULE, id: toId }, { module: l.toModule, id: l.toId }, l.type);
  }
}
