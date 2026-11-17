/**
 * R4.3: the richer Calendar file (.ics). PURE: no database, no React, no storage, no clock (the caller passes `today` and `nowIso`). It decides WHAT goes
 * into one downloaded snapshot and then asks the existing `buildIcs` to write it, so there is no second calendar writer and no second repeat engine.
 *
 * WHERE EVERYTHING COMES FROM (nothing is copied or stored):
 *  - the owner's own calendars: the stored events, written with their repeat rules, skipped dates and one-date changes exactly as the Calendar export always did;
 *  - every other layer: the dates its owning module's `DueProvider` already works out (today through 12 months ahead), passed in by the caller.
 *
 * PRIVACY. The file is an ordinary, readable file outside Ledger's encrypted storage, so the text of every derived item is chosen on purpose:
 *  - Amounts OFF (the default): a provider that can carry a money figure (Finance) must give `icsPlainTitle` / `icsPlainDetail`; the export uses those and never
 *    its screen text. A Finance item without them is written with a generic title (fail closed), never with its raw title. Nothing strips digits from text.
 *  - Amounts ON: the provider's own full text (`icsTitle ?? title`, `icsDetail ?? detail`). No money field is ever invented.
 *  - Task notes are not exported (they are free text and other modules write into them); a Task is written as its title and date.
 *  - Free text the owner typed into an event title or notes is written as typed. Ledger cannot know whether it is private.
 *
 * ALARMS. A stored event keeps its own reminders. A derived item uses its provider's `icsAlarmMinutes`; with none, only an item that has a clock time gets one
 * (an hour before). Each event carries at most one alarm. "Alarms off" removes every alarm, stored ones included.
 *
 * NO DUPLICATES. After the layers are chosen, the existing `coveredBy` rule (`markerCoordination.dropCovered`) is applied to exactly the entries that are in
 * the file, so a covered marker is left out only while the entry that covers it is also in the file (never by title or amount). Everything else is written.
 */
import type { DerivedItem } from '../../core/dueProvider';
import { addMonths } from '../../lib/dates';
import { buildIcs } from './ics';
import { dropCovered, storedItemKey } from './markerCoordination';
import type { CalendarLayer, EventRecord } from './model';
import { occurrencesOf } from './occurrences';

/** The derived layers cover today through the same day 12 months later (the convention Bills and Household Services already use). */
export const EXPORT_MONTHS = 12;
export const exportEnd = (today: string): string => addMonths(today, EXPORT_MONTHS);

/** An alarm for an item that has a clock time and whose provider named none. */
export const TIMED_DEFAULT_ALARM_MINUTES = 60;

/** The order the layers are listed in. A provider not named here is listed after these. */
export const PROVIDER_ORDER = ['family', 'tasks', 'bills', 'services', 'assets', 'projects', 'ledger'] as const;
/** Modules whose item `detail` is free text written by the owner or by other modules, so it is not exported. */
const NO_DETAIL = new Set(['tasks']);
/** Modules whose screen text can carry a money figure, so without amounts they must supply approved plain text. */
const MONEY_TEXT = new Set(['ledger']);
const GENERIC_MONEY_TITLE = 'Finance date';

export interface ExportChoice {
  /** Ids of the owner's own (local) calendars. */
  localIds: readonly number[];
  /** Ids of the due providers (derived layers). */
  providerIds: readonly string[];
  /** Include financial amounts. Off unless the owner turned it on. */
  amounts: boolean;
  /** Include reminders (alarms). */
  alarms: boolean;
}

export interface ExportInput {
  layers: readonly CalendarLayer[];
  events: readonly EventRecord[];
  /** Provider id -> its items for today..exportEnd. Only the chosen providers are needed. */
  derived: Readonly<Record<string, readonly DerivedItem[]>>;
  choice: ExportChoice;
  today: string;
  nowIso: string;
  tagName?: (id: number) => string | undefined;
}

export interface ExportEntry { date: string; layer: string; providerId: string | null; title: string; timed: boolean }
export interface LayerCount { key: string; name: string; count: number }
export interface ExportResult {
  text: string;
  /** The calendar name inside the file. */
  name: string;
  from: string;
  to: string;
  storedEvents: number;
  layers: LayerCount[];
  derivedCount: number;
  /** Entries left out because another entry that is also in the file already stands for them (`coveredBy`). */
  coveredCount: number;
  alarmCount: number;
  amounts: boolean;
  alarms: boolean;
  /** A small spread of what is in the file, soonest first. */
  preview: ExportEntry[];
}

const isTimed = (it: DerivedItem) => !it.allDay && !!it.time;

/** The title and description an item is written with, for this amounts choice. */
export function exportText(it: DerivedItem, amounts: boolean): { title: string; detail: string } {
  const title = amounts ? (it.icsTitle ?? it.title) : (it.icsPlainTitle ?? (MONEY_TEXT.has(it.sourceModule) ? GENERIC_MONEY_TITLE : it.title));
  const detail = NO_DETAIL.has(it.sourceModule) ? '' : amounts ? (it.icsDetail ?? it.detail ?? '') : (it.icsPlainDetail ?? (MONEY_TEXT.has(it.sourceModule) ? '' : (it.detail ?? '')));
  return { title, detail };
}

/** The alarm an item is written with: the provider's, else an hour before for a timed item, else none. */
export const exportAlarm = (it: DerivedItem, alarms: boolean): number | undefined => (!alarms ? undefined : (it.icsAlarmMinutes ?? (isTimed(it) ? TIMED_DEFAULT_ALARM_MINUTES : undefined)));

/** The stored events with their reminders removed (for "no alarms"). Everything else about them is untouched. */
const withoutAlarms = (ev: EventRecord): EventRecord => ({
  ...ev,
  data: { ...ev.data, reminders: [], overrides: Object.fromEntries(Object.entries(ev.data.overrides).map(([k, o]) => [k, o.reminders ? { ...o, reminders: [] } : o])) },
});

const layerOfProvider = (layers: readonly CalendarLayer[], providerId: string) => layers.find((l) => l.providerId === providerId);

export function buildExport(input: ExportInput): ExportResult {
  const { layers, choice, today } = input;
  const to = exportEnd(today);
  const local = new Set(choice.localIds);
  const byId = new Map(layers.map((l) => [l.id, l]));

  // ---- the owner's own events (kept whole: repeats, skipped dates and one-date changes are the Calendar export's, not cut to the 12 months) ----
  const stored = input.events.filter((e) => !e.data.retired && local.has(e.data.calendarId)).map((e) => (choice.alarms ? e : withoutAlarms(e)));

  // ---- the derived layers, in a stable order ----
  const chosen = new Set(choice.providerIds);
  const wanted = [...chosen].sort((a, b) => order(a) - order(b) || a.localeCompare(b));
  const wrapped: { source?: DerivedItem; key?: string; occ?: unknown; done?: boolean }[] = [];
  for (const p of wanted) for (const it of input.derived[p] ?? []) if (it.date >= today && it.date <= to) wrapped.push({ source: it });
  // The stored occurrences that can cover a marker (a Birthday event covers the Family birthday on the same day), exactly as the Calendar names them.
  for (const ev of stored) for (const o of occurrencesOf(ev, today, to)) wrapped.push({ key: storedItemKey(ev.id, o.key), occ: o, done: false });
  const kept = dropCovered(wrapped).flatMap((w) => (w.source ? [w.source] : []));
  const coveredCount = wrapped.filter((w) => w.source).length - kept.length;

  // ---- the words and alarm of each derived item, and a UID that is never shared between two entries ----
  const seen = new Set<string>();
  let alarmCount = 0;
  const derived: DerivedItem[] = [...kept].sort((a, b) => order(a.sourceModule) - order(b.sourceModule) || a.date.localeCompare(b.date) || a.id.localeCompare(b.id)).map((it) => {
    const { title, detail } = exportText(it, choice.amounts);
    const alarm = exportAlarm(it, choice.alarms);
    let uid = it.icsUid ?? `${it.id}@ledger.local`;
    if (seen.has(uid)) uid = `${it.id}@ledger.local`; // two different entries must never share an id; the item's own id is stable
    seen.add(uid);
    if (alarm !== undefined) alarmCount += 1;
    return { ...it, icsUid: uid, icsTitle: title, icsDetail: detail, icsAlarmMinutes: alarm };
  });
  if (choice.alarms) for (const ev of stored) { if (ev.data.reminders.length || Object.values(ev.data.overrides).some((o) => o.reminders?.length)) alarmCount += 1; }

  const onlyLocalLayer = choice.providerIds.length === 0 && choice.localIds.length === 1 ? byId.get(choice.localIds[0]) : undefined;
  const name = onlyLocalLayer?.name ?? (chosen.size === 1 && local.size === 0 ? layerOfProvider(layers, [...chosen][0])?.name : undefined) ?? (chosen.size > 0 ? 'Ledger household calendar' : 'Calendar');
  const text = buildIcs({ name, events: stored as EventRecord[], derived, nowIso: input.nowIso, tagName: input.tagName });

  // ---- counts and a small preview ----
  const layerName = (p: string) => layerOfProvider(layers, p)?.name ?? p;
  const counts = new Map<string, LayerCount>();
  for (const it of derived) {
    const c = counts.get(it.sourceModule) ?? { key: it.sourceModule, name: layerName(it.sourceModule), count: 0 };
    c.count += 1; counts.set(it.sourceModule, c);
  }
  const layerCounts: LayerCount[] = [
    ...local.size ? [{ key: 'local', name: 'Your calendars', count: stored.length }] : [],
    ...wanted.map((p) => counts.get(p) ?? { key: p, name: layerName(p), count: 0 }),
  ];
  const entries: ExportEntry[] = [
    ...derived.map((it) => ({ date: it.date, layer: layerName(it.sourceModule), providerId: it.sourceModule, title: it.icsTitle ?? it.title, timed: isTimed(it) })),
    ...stored.flatMap((ev) => { const o = occurrencesOf(ev, today, to)[0]; return o ? [{ date: o.firstDay, layer: byId.get(ev.data.calendarId)?.name ?? 'Personal', providerId: null, title: o.title || '(no title)', timed: !o.allDay }] : []; }),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
  return {
    text, name, from: today, to, storedEvents: stored.length, layers: layerCounts, derivedCount: derived.length, coveredCount, alarmCount,
    amounts: choice.amounts, alarms: choice.alarms, preview: spread(entries, 8),
  };
}

/** The 'unknown provider' sorts after the named ones. */
function order(id: string): number {
  const i = (PROVIDER_ORDER as readonly string[]).indexOf(id);
  return i < 0 ? PROVIDER_ORDER.length : i;
}

/** Up to `n` entries, taking the soonest of each layer in turn so every selected layer shows up, then ordered by date. */
export function spread(entries: readonly ExportEntry[], n: number): ExportEntry[] {
  const groups = new Map<string, ExportEntry[]>();
  for (const e of entries) { const g = groups.get(e.layer) ?? []; g.push(e); groups.set(e.layer, g); }
  const out: ExportEntry[] = [];
  for (let round = 0; out.length < n; round += 1) {
    let any = false;
    for (const g of groups.values()) { if (round < g.length && out.length < n) { out.push(g[round]); any = true; } }
    if (!any) break;
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
}

// ---- which layers can be offered, and which start ticked ----

export interface OfferedLayer { key: string; name: string; color: string; kind: 'local' | 'provider'; id: number; providerId?: string }

/**
 * The layers the dialog offers: the owner's own calendars, then each derived layer whose provider is registered (a layer with no provider is not offered, so
 * nothing is promised that cannot be read). Order: own calendars, then Family, Tasks, Bills, Services, Home & Assets, Projects, Finance, then any other.
 */
export function offeredLayers(layers: readonly CalendarLayer[], registeredProviderIds: readonly string[]): OfferedLayer[] {
  const own = layers.filter((l) => l.sourceType === 'local').map<OfferedLayer>((l) => ({ key: `l:${l.id}`, name: l.name, color: l.color, kind: 'local', id: l.id }));
  const derived = layers
    .filter((l) => l.sourceType === 'derived' && l.providerId && registeredProviderIds.includes(l.providerId))
    .sort((a, b) => order(a.providerId!) - order(b.providerId!) || a.name.localeCompare(b.name))
    .map<OfferedLayer>((l) => ({ key: `p:${l.providerId}`, name: l.name, color: l.color, kind: 'provider', id: l.id, providerId: l.providerId }));
  return [...own, ...derived];
}

/** The layer keys that start ticked: the ones the Calendar is showing right now (the export's own ticks are separate and never write this back). */
export const defaultKeys = (offered: readonly OfferedLayer[], isVisible: (layerId: number) => boolean): string[] => offered.filter((l) => isVisible(l.id)).map((l) => l.key);

/** The choice for a set of ticked keys. */
export function choiceOf(keys: readonly string[], offered: readonly OfferedLayer[], amounts: boolean, alarms: boolean): ExportChoice {
  const on = new Set(keys);
  return {
    localIds: offered.filter((l) => l.kind === 'local' && on.has(l.key)).map((l) => l.id),
    providerIds: offered.filter((l) => l.kind === 'provider' && on.has(l.key)).map((l) => l.providerId!),
    amounts, alarms,
  };
}
