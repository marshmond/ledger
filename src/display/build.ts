/**
 * CS-1: the display projection builder. It takes ONLY the narrow, already-authorized source types defined below and writes the version-1
 * contract field by field. It never receives a Ledger record: these types have no field for notes, places, contact details, amounts, accounts,
 * links, birth years, ages, project names or provider names, so it cannot leak what it cannot hold.
 *
 * The builder decides nothing about eligibility (that is `grants.ts`, applied by the readers in `readState.ts`) and reads nothing: it is pure
 * apart from the keyed hash that makes ids opaque. Nothing is truncated silently: over a limit it throws.
 */
import {
  canonicalJson, contentDigest, deriveId, LIMITS, FORMAT, MIN_READER, VERSION, SOURCE_IDS,
  type ColorId, type DatePoint, type DisplayEntry, type DisplayPerson, type DisplayProjection, type DisplayTask, type EntrySource, type Group,
  type IdKey, type SourceId, type TaskStatus,
} from './contract';

export class ProjectionLimitError extends Error {}

/** A household person, identity only. */
export interface PersonSource { memberId: number; name: string; colorId: ColorId | null; group: Group }
export interface EventOccurrenceSource { key: string; title: string; allDay: boolean; start: DatePoint; end: DatePoint; recurring: boolean; done: boolean }
export interface EventSource { eventId: number; level: 'details' | 'busy'; busyLabel: string | null; memberIds: number[]; occurrences: EventOccurrenceSource[] }
/** A name and the dates it falls on. Never an age or a year. */
export interface DateSource { key: string; title: string; dates: string[]; memberIds: number[] }
/** A visit or reminder: the owner's own label and nothing but the schedule. */
export interface ScheduleSource { id: number; label: string; memberIds: number[]; when: { date: string; time: string | null }[] }
export interface TaskSource { taskId: number; title: string; due: DatePoint | null; status: TaskStatus; memberIds: number[]; repeat: boolean }

export interface BuildInput {
  today: string;
  tz: string;
  publishedAt: string;
  revision: number;
  window: { from: string; to: string };
  household: string;
  weekStart: 0 | 1 | 6;
  idKey: IdKey;
  people: PersonSource[];
  events: EventSource[];
  dates: DateSource[];
  visits: ScheduleSource[];
  reminders: ScheduleSource[];
  tasks: TaskSource[];
  /** The record id of EVERY display decision this device holds (readable or not, superseded or not). */
  grantRecordIds: number[];
}

const SOURCE_LABEL: Record<SourceId, string> = { events: 'Calendar events', dates: 'Family dates', tasks: 'Tasks', visits: 'Visits', reminders: 'Reminders' };
const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`);
const tidy = (s: string) => s.trim().replace(/\s+/g, ' ');
const byPoint = (a: { date: string; time: string | null }, b: { date: string; time: string | null }) => a.date.localeCompare(b.date) || (a.time ?? '').localeCompare(b.time ?? '');

/** Opaque id of a grant record (for `grantsSeen`). */
export const grantOpaqueId = (key: IdKey, recordId: number) => deriveId(key, 'grant', recordId);

export async function buildProjection(i: BuildInput): Promise<DisplayProjection> {
  const used = new Set<number>();
  const known = new Map(i.people.map((p) => [p.memberId, p]));
  const personIds = new Map<number, string>();
  for (const p of i.people) personIds.set(p.memberId, await deriveId(i.idKey, 'person', p.memberId));
  const idsOf = (members: readonly number[]) => {
    const out = new Set<string>();
    for (const m of members) { const id = personIds.get(m); if (id) { out.add(id); used.add(m); } }
    return [...out].sort();
  };
  const inWindow = (d: string) => d >= i.window.from && d <= i.window.to;
  const entries: DisplayEntry[] = [];
  const push = async (source: EntrySource, kind: string, rec: string | number, occ: string, e: Omit<DisplayEntry, 'id' | 'source'>) =>
    entries.push({ id: await deriveId(i.idKey, kind, rec, occ), source, ...e });

  for (const ev of i.events) {
    const people = idsOf(ev.memberIds);
    for (const o of ev.occurrences) {
      if (o.end.date < i.window.from || o.start.date > i.window.to) continue;
      const title = ev.level === 'busy' ? clip(tidy(ev.busyLabel ?? '') || 'Busy', LIMITS.title) : clip(tidy(o.title) || '(no title)', LIMITS.title);
      await push('events', 'event', ev.eventId, o.key, {
        title, allDay: o.allDay, start: { date: o.start.date, time: o.allDay ? null : o.start.time }, end: { date: o.end.date, time: o.allDay ? null : o.end.time },
        people, repeat: o.recurring, status: o.done ? 'done' : 'scheduled',
      });
    }
  }
  for (const d of i.dates) {
    const people = idsOf(d.memberIds);
    for (const date of d.dates) {
      if (!inWindow(date)) continue;
      await push('dates', 'date', d.key, date, { title: clip(tidy(d.title), LIMITS.title), allDay: true, start: { date, time: null }, end: { date, time: null }, people, repeat: true, status: 'scheduled' });
    }
  }
  for (const [list, source, kind] of [[i.visits, 'visits', 'visit'], [i.reminders, 'reminders', 'reminder']] as const) {
    for (const v of list) {
      const people = idsOf(v.memberIds);
      for (const w of v.when) {
        if (!inWindow(w.date)) continue;
        await push(source, kind, v.id, w.date, {
          title: clip(tidy(v.label), LIMITS.title), allDay: w.time === null, start: { date: w.date, time: w.time }, end: { date: w.date, time: w.time }, people, repeat: true, status: 'scheduled',
        });
      }
    }
  }
  entries.sort((a, b) => byPoint(a.start, b.start) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id));

  const tasks: DisplayTask[] = [];
  for (const t of i.tasks) {
    tasks.push({ id: await deriveId(i.idKey, 'task', t.taskId), title: clip(tidy(t.title) || '(no title)', LIMITS.title), due: t.due ? { date: t.due.date, time: t.due.time } : null, status: t.status, people: idsOf(t.memberIds), repeat: t.repeat });
  }
  tasks.sort((a, b) => (a.due ? 0 : 1) - (b.due ? 0 : 1) || (a.due && b.due ? byPoint(a.due, b.due) : 0) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id));

  if (entries.length > LIMITS.entries) throw new ProjectionLimitError(`Too many items for the display: ${entries.length} (the limit is ${LIMITS.entries}). Nothing was cut; hide some items or shrink what is shared.`);
  if (tasks.length > LIMITS.tasks) throw new ProjectionLimitError(`Too many Tasks for the display: ${tasks.length} (the limit is ${LIMITS.tasks}). Nothing was cut; hide some Tasks.`);

  const people: DisplayPerson[] = [];
  for (const m of [...used].sort((a, b) => a - b)) {
    const p = known.get(m)!;
    people.push({ id: personIds.get(m)!, name: clip(tidy(p.name) || 'Person', LIMITS.name), color: p.colorId, group: p.group });
  }
  people.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));

  const present = new Set<SourceId>();
  for (const e of entries) present.add(e.source);
  if (tasks.length) present.add('tasks');
  const sources = SOURCE_IDS.filter((s) => present.has(s)).map((id) => ({ id, label: SOURCE_LABEL[id] }));

  const grantsSeen = [...new Set(await Promise.all([...new Set(i.grantRecordIds)].map((id) => grantOpaqueId(i.idKey, id))))].sort();
  if (grantsSeen.length > LIMITS.grantsSeen) throw new ProjectionLimitError(`Too many privacy decisions to track (${grantsSeen.length}; the limit is ${LIMITS.grantsSeen}).`);

  const body = { people, entries, tasks };
  const projection: DisplayProjection = {
    format: FORMAT, version: VERSION, minReader: MIN_READER, revision: i.revision, publishedAt: i.publishedAt,
    generatedFor: { tz: i.tz, today: i.today }, window: { from: i.window.from, to: i.window.to },
    household: { label: clip(tidy(i.household) || 'Family', LIMITS.label) }, prefs: { weekStart: i.weekStart },
    people, sources, entries, tasks, grantsSeen, counts: { entries: entries.length, tasks: tasks.length }, digest: await contentDigest(body),
  };
  if (new TextEncoder().encode(canonicalJson(projection)).byteLength > LIMITS.bytes) throw new ProjectionLimitError(`The display data is larger than ${LIMITS.bytes} bytes. Nothing was cut; hide some items.`);
  return projection;
}
