/**
 * CS-1: reads what the owner has authorized and turns it into the narrow source types the projection builder accepts, plus a report for the
 * owner's management page. Nothing is written. Nothing leaves this device.
 *
 * Order of work, and why a leak is structurally unlikely:
 *  1. read the privacy decisions, and work out each subject's effective state (`grants.ts`);
 *  2. ask each SOURCE for only the subjects that are shown. A source that has nothing shown is not read at all (Household Services and Home &
 *     Assets are untouched unless the owner has approved a visit or reminder; Finance, Bills and Projects are never read);
 *  3. each source returns its own narrow type, assembled field by field here. No record is serialized and trimmed afterwards.
 * A source that cannot be read is left out and named in `limitations`; it never makes the rest fail open.
 */
import type { FinanceDB } from '../db';
import { isLive } from '../core/store';
import { addDays } from '../lib/dates';
import { fmtHM, localISO, minutesOfDay } from '../core/time';
import { loadCalendarSettings } from '../core/calendarSettings';
import { asEvent, asLayer, MODULE as CAL, type CalendarLayer, type EventRecord } from '../modules/calendar/model';
import { occurrencesOf } from '../modules/calendar/occurrences';
import { asTask, MODULE as TASKS, type TaskRecord } from '../modules/tasks/model';
import { taskRootId } from '../modules/tasks/chain';
import { familyDisplayReader, type DisplayFamily } from '../core/displaySources';
import { readDisplayVisits } from '../modules/services/displaySchedule';
import { readDisplayReminders } from '../modules/assets/displaySchedule';
import {
  effectiveForDate, effectiveForEvent, effectiveForSimple, effectiveForTask, resolveGrants, subjectOf, parseSubject, BUSY_TITLE,
  type Effective, type GrantIndex, type HiddenReason,
} from './grants';
import { loadGrantRows } from './grantStore';
import { eventRejection, taskRejection, type Rejection } from './eligibility';
import { linkModules } from './linkModules';
import { loadBaseline, needsReview } from './compat';
import type { BuildInput, DateSource, EventSource, PersonSource, ScheduleSource, TaskSource } from './build';
import type { IdKey } from './contract';

/** Design F.6: 14 days back, 120 days ahead. */
export const WINDOW_BEHIND = 14;
export const WINDOW_AHEAD = 120;
export const RECENT_DAYS = 14;

export interface ReadOptions { today: string; tz: string; nowMs: number; idKey: IdKey; revision?: number; publishedAt?: string; household?: string }

export interface EventRow {
  eventId: number; title: string; calendarId: number; calendarName: string; show: 'details' | 'busy'; via: 'event' | 'calendar';
  recurring: boolean; occurrences: number; nextDate: string | null; updatedAt: number; titleChanged: boolean; conflict: boolean;
}
export interface RejectedRow { id: number; title: string; where: string; rejection: Rejection }
export interface PrivateRow { eventId: number; title: string; calendarName: string }
export interface TaskRow { rootId: number; taskId: number; title: string; due: string | null; status: string; updatedAt: number; titleChanged: boolean; conflict: boolean }
export interface DateRow { key: string; title: string; subject: string; via: string; count: number }
export interface ScheduleRow { id: number; label: string; people: number[]; count: number }
/** An event that would be shown only because its calendar is shared, made after the first publication by a build that does not stamp events. Held back until the owner chooses. */
export interface WithheldRow { eventId: number; title: string; calendarName: string; createdAt: number; nextDate: string | null }
export interface DecisionRow { id: number; subject: string; decision: string; level: string; createdAt: number }

export interface DisplayReport {
  killed: boolean;
  window: { from: string; to: string };
  sharedCalendars: { id: number; name: string; level: 'details' | 'busy' }[];
  events: EventRow[];
  rejected: RejectedRow[];
  keptPrivate: PrivateRow[];
  /** CS-2: held back for review (see compat.ts). Never in the projection. */
  withheld: WithheldRow[];
  tasks: TaskRow[];
  ambiguousTasks: number;
  dates: DateRow[];
  visits: ScheduleRow[];
  reminders: ScheduleRow[];
  recentEvents: EventRow[];
  recentTasks: TaskRow[];
  recentDecisions: DecisionRow[];
  /** Subjects with conflicting or unreadable decisions: the owner should choose again. */
  conflicts: { subject: string; reason: HiddenReason | null }[];
  /** A plain-words name for each subject that appears in `conflicts` or `recentDecisions` (for the owner's page only; never published). */
  subjectNames: Record<string, string>;
  unattributable: number;
  limitations: string[];
}

export interface DisplayState { input: BuildInput; report: DisplayReport; grants: GrantIndex; family: DisplayFamily }

const weekStartOf = (n: number): 0 | 1 | 6 => (n === 1 ? 1 : n === 6 ? 6 : 0);
const recent = (ms: number, nowMs: number) => ms >= nowMs - RECENT_DAYS * 86400_000;

/** Works out one event's occurrences as the narrow display type. Only these fields leave: no notes, place, priority, reminders, tags or links. */
function narrowEvent(ev: EventRecord, eff: Effective, memberIds: number[], from: string, to: string): EventSource {
  return {
    eventId: ev.id, level: eff.show === 'busy' ? 'busy' : 'details', busyLabel: eff.show === 'busy' ? (eff.label ?? BUSY_TITLE) : null, memberIds,
    occurrences: occurrencesOf(ev, from, to).map((o) => ({
      key: o.key, title: o.title, allDay: o.allDay, recurring: o.recurring, done: o.done && o.trackDone,
      start: o.allDay ? { date: o.firstDay, time: null } : { date: localISO(o.startAt), time: fmtHM(minutesOfDay(o.startAt)) },
      end: o.allDay ? { date: o.lastDay, time: null } : { date: localISO(Math.max(o.endAt, o.startAt)), time: fmtHM(minutesOfDay(Math.max(o.endAt, o.startAt))) },
    })),
  };
}

export async function readDisplayState(d: FinanceDB, o: ReadOptions): Promise<DisplayState> {
  const window = { from: addDays(o.today, -WINDOW_BEHIND), to: addDays(o.today, WINDOW_AHEAD) };
  const rows = await loadGrantRows(d);
  const grants = resolveGrants(rows);
  // Lists for the owner show what a resume would show, even while the global switch is on; the projection itself is empty while it is on.
  const listing: GrantIndex = { ...grants, killed: false };
  const limitations: string[] = [];

  let family: DisplayFamily = { people: [], birthdays: [], dates: [] };
  try {
    const read = familyDisplayReader();
    if (!read) throw new Error('not registered');
    family = await read(d, window.from, window.to);
  } catch { limitations.push('Family members could not be read, so no people, birthdays or dates are included.'); }
  const peopleSources: PersonSource[] = family.people.map((p) => ({ memberId: p.memberId, name: p.name, colorId: p.colorId, group: p.group }));
  const memberSet = new Set(family.people.map((p) => p.memberId));
  // contact id -> household member, through Family's own reader, so a Contact who is not a household member never appears
  const memberOfContact = new Map(family.people.map((p) => [p.contactId, p.memberId]));
  const membersOf = (contactIds: readonly number[]) => [...new Set(contactIds.map((c) => memberOfContact.get(c)).filter((m): m is number => m !== undefined))].sort((a, b) => a - b);

  const report: DisplayReport = {
    killed: grants.killed, window, sharedCalendars: [], events: [], rejected: [], keptPrivate: [], withheld: [], tasks: [], ambiguousTasks: 0, dates: [], visits: [], reminders: [],
    recentEvents: [], recentTasks: [], recentDecisions: [], conflicts: grants.conflicts.map((c) => ({ subject: c.subject, reason: c.reason })), unattributable: grants.unattributable.length, subjectNames: {}, limitations,
  };
  const events: EventSource[] = [];
  const tasks: TaskSource[] = [];
  const dates: DateSource[] = [];
  const visits: ScheduleSource[] = [];
  const reminders: ScheduleSource[] = [];

  // ---- Calendar events ----
  try {
    const [layerRows, eventRows, linked] = await Promise.all([
      d.moduleRecords.where('[module+kind]').equals([CAL, 'calendar']).toArray(),
      d.moduleRecords.where('[module+kind]').equals([CAL, 'event']).toArray(),
      linkModules(d, CAL),
    ]);
    const baseline = await loadBaseline(d); // not caught on purpose: if it cannot be read, nothing is published
    const layers = new Map<number, CalendarLayer>(layerRows.filter(isLive).map((r) => [r.id as number, asLayer(r)]));
    for (const l of layers.values()) {
      const s = listing.get(subjectOf('calendar', l.id));
      if (s.state === 'show' && l.sourceType === 'local') report.sharedCalendars.push({ id: l.id, name: l.name, level: s.level });
    }
    for (const r of eventRows.filter(isLive)) {
      const ev = asEvent(r);
      const layer = layers.get(ev.data.calendarId);
      const eff = effectiveForEvent(listing, ev.id, ev.data.calendarId, layer ? layer.sourceType === 'local' : false);
      const calendarName = layer?.name ?? 'Calendar';
      if (eff.show === 'hidden') {
        // an explicit "keep this one private" on a shared calendar is worth listing
        const own = listing.get(subjectOf('event', ev.id));
        const cal = layer ? listing.get(subjectOf('calendar', layer.id)) : null;
        if (own.state === 'hide' && cal?.state === 'show') report.keptPrivate.push({ eventId: ev.id, title: ev.data.title, calendarName });
        continue;
      }
      const rejection = eventRejection({
        type: ev.data.type, retired: !!ev.data.retired, projectId: ev.data.projectId, linkedModules: linked.get(ev.id) ?? [], calendarSource: layer?.sourceType,
      });
      if (rejection) { report.rejected.push({ id: ev.id, title: ev.data.title, where: calendarName, rejection }); continue; }
      const memberIds = membersOf(ev.data.contactIds);
      const src = narrowEvent(ev, eff, memberIds, window.from, window.to);
      if (eff.via === 'calendar' && needsReview(ev, baseline)) {
        report.withheld.push({ eventId: ev.id, title: ev.data.title, calendarName, createdAt: ev.createdAt, nextDate: src.occurrences.map((x) => x.start.date).filter((x) => x >= o.today).sort()[0] ?? null });
        continue;
      }
      const first = src.occurrences.map((x) => x.start.date).filter((x) => x >= o.today).sort()[0] ?? null;
      const stateOwn = eff.via === 'event' ? listing.get(subjectOf('event', ev.id)) : null;
      const row: EventRow = {
        eventId: ev.id, title: ev.data.title, calendarId: ev.data.calendarId, calendarName, show: eff.show, via: eff.via as 'event' | 'calendar',
        recurring: !!ev.data.recurrence, occurrences: src.occurrences.length, nextDate: first, updatedAt: ev.updatedAt, conflict: eff.conflict,
        titleChanged: !!stateOwn?.titleAtGrant && stateOwn.titleAtGrant !== ev.data.title,
      };
      report.events.push(row);
      if (recent(ev.updatedAt, o.nowMs) || row.titleChanged) report.recentEvents.push(row);
      if (!grants.killed) events.push(src);
    }
    report.events.sort((a, b) => (a.nextDate ?? '9999').localeCompare(b.nextDate ?? '9999') || a.title.localeCompare(b.title) || a.eventId - b.eventId);
  } catch { limitations.push('The Calendar could not be read, so no events are included.'); }

  // ---- Tasks ----
  try {
    const [taskRows, linked] = await Promise.all([d.moduleRecords.where('[module+kind]').equals([TASKS, 'task']).toArray(), linkModules(d, TASKS)]);
    const all: { rec: TaskRecord; live: boolean }[] = taskRows.map((r) => ({ rec: asTask(r), live: isLive(r) }));
    const chain = new Map(all.map((x) => [x.rec.id, { id: x.rec.id, recurFrom: x.rec.data.recurFrom }]));
    for (const { rec, live } of all) {
      if (!live || rec.data.status === 'done') continue;
      const root = taskRootId(rec.id, chain);
      if (root === null) { if (listing.subjects.some((s) => s.state === 'show' && parseSubject(s.subject)?.kind === 'task')) report.ambiguousTasks++; continue; }
      const eff = effectiveForTask(listing, root);
      if (eff.show === 'hidden') continue;
      const rejection = taskRejection({ createdFromModule: rec.data.createdFrom?.module, linkedModules: linked.get(rec.id) ?? [] });
      if (rejection) { report.rejected.push({ id: rec.id, title: rec.data.title, where: 'Tasks', rejection }); continue; }
      const own = listing.get(subjectOf('task', root));
      const memberIds = membersOf(rec.data.contactIds);
      const status = rec.data.status === 'doing' ? 'doing' : rec.data.status === 'waiting' ? 'waiting' : 'todo';
      const row: TaskRow = { rootId: root, taskId: rec.id, title: rec.data.title, due: rec.data.dueDate, status, updatedAt: rec.updatedAt, titleChanged: !!own.titleAtGrant && own.titleAtGrant !== rec.data.title, conflict: eff.conflict };
      report.tasks.push(row);
      if (recent(rec.updatedAt, o.nowMs) || row.titleChanged) report.recentTasks.push(row);
      if (!grants.killed) {
        tasks.push({ taskId: rec.id, title: rec.data.title, due: rec.data.dueDate ? { date: rec.data.dueDate, time: rec.data.dueTime } : null, status, memberIds, repeat: !!rec.data.repeat });
      }
    }
    report.tasks.sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999') || a.title.localeCompare(b.title) || a.taskId - b.taskId);
  } catch { limitations.push('Tasks could not be read, so no Tasks are included.'); }

  // ---- Family dates ----
  try {
    const nameOf = new Map(family.people.map((p) => [p.memberId, p.name]));
    for (const b of family.birthdays) {
      const eff = effectiveForDate(listing, null, b.memberId);
      if (eff.show === 'hidden') continue;
      const when = b.dates;
      const title = `${nameOf.get(b.memberId) ?? 'Someone'}'s birthday`;
      report.dates.push({ key: `birthday:${b.memberId}`, title, subject: `dates:${b.memberId}`, via: eff.via, count: when.length });
      if (!grants.killed) dates.push({ key: `birthday:${b.memberId}`, title, dates: when, memberIds: [b.memberId] });
    }
    for (const x of family.dates) {
      const eff = effectiveForDate(listing, x.id, x.memberId);
      if (eff.show === 'hidden') continue;
      const when = x.dates;
      report.dates.push({ key: `date:${x.id}`, title: x.label, subject: `date:${x.id}`, via: eff.via, count: when.length });
      if (!grants.killed) dates.push({ key: `date:${x.id}`, title: x.label, dates: when, memberIds: x.memberId !== null ? [x.memberId] : [] });
    }
  } catch { limitations.push('Family dates could not be read, so none are included.'); }

  // ---- Household Services visits and Home & Assets reminders: read ONLY for subjects the owner has approved ----
  const approved = (kind: 'visit' | 'reminder') => listing.subjects.filter((s) => s.state === 'show' && parseSubject(s.subject)?.kind === kind && effectiveForSimple(listing, kind, parseSubject(s.subject)!.id!).show !== 'hidden');
  const members = (ids: number[]) => ids.filter((m) => memberSet.has(m));
  const visitSubjects = approved('visit');
  if (visitSubjects.length) {
    try {
      const ids = visitSubjects.map((s) => parseSubject(s.subject)!.id!);
      const found = await readDisplayVisits(d, ids, o.today, window.from, window.to);
      for (const s of visitSubjects) {
        const id = parseSubject(s.subject)!.id!;
        const when = found.get(id) ?? [];
        report.visits.push({ id, label: s.label ?? '', people: members(s.people), count: when.length });
        if (!grants.killed) visits.push({ id, label: s.label ?? '', memberIds: members(s.people), when });
      }
    } catch { limitations.push('Household Services could not be read, so no visits are included.'); }
  }
  const reminderSubjects = approved('reminder');
  if (reminderSubjects.length) {
    try {
      const ids = reminderSubjects.map((s) => parseSubject(s.subject)!.id!);
      const found = await readDisplayReminders(d, ids, window.from, window.to);
      for (const s of reminderSubjects) {
        const id = parseSubject(s.subject)!.id!;
        const when = found.get(id) ?? [];
        report.reminders.push({ id, label: s.label ?? '', people: members(s.people), count: when.length });
        if (!grants.killed) reminders.push({ id, label: s.label ?? '', memberIds: members(s.people), when });
      }
    } catch { limitations.push('Home & Assets could not be read, so no maintenance reminders are included.'); }
  }

  report.recentDecisions = rows
    .filter((r) => recent(r.createdAt, o.nowMs))
    .map((r) => { const x = (r.data ?? {}) as { subject?: unknown; decision?: unknown; level?: unknown }; return { id: r.id as number, subject: String(x.subject ?? ''), decision: String(x.decision ?? ''), level: x.level === 'busy' ? 'busy' : 'details', createdAt: r.createdAt }; })
    .sort((a, b) => b.createdAt - a.createdAt || b.id - a.id);

  // plain-words names for the subjects the owner may need to recognize (conflicts and recent decisions)
  const wanted = new Set([...report.conflicts.map((c) => c.subject), ...report.recentDecisions.map((r) => r.subject)]);
  for (const subject of wanted) {
    const p = parseSubject(subject);
    if (!p) { report.subjectNames[subject] = 'An unreadable choice'; continue; }
    const st = grants.get(subject);
    if (p.kind === 'all') report.subjectNames[subject] = 'Hide everything';
    else if (p.kind === 'dates') report.subjectNames[subject] = p.id === null ? 'All birthdays and important dates' : `${family.people.find((x) => x.memberId === p.id)?.name ?? 'A family member'}'s birthday and dates`;
    else if (p.kind === 'date') report.subjectNames[subject] = family.dates.find((x) => x.id === p.id)?.label ?? 'An important date';
    else if (p.kind === 'visit') report.subjectNames[subject] = `Visit: ${st.label ?? 'no name'}`;
    else if (p.kind === 'reminder') report.subjectNames[subject] = `Reminder: ${st.label ?? 'no name'}`;
    else {
      // only the Calendar's or Tasks' own rows are looked at: a decision that names some other module's record number reads nothing of it
      const [mod, kind] = p.kind === 'task' ? [TASKS, 'task'] : p.kind === 'calendar' ? [CAL, 'calendar'] : [CAL, 'event'];
      const rec = await d.moduleRecords.where('[module+kind]').equals([mod, kind]).filter((r) => r.id === p.id).first().catch(() => undefined);
      const data = (rec?.data ?? {}) as { title?: unknown; name?: unknown };
      const t = typeof data.title === 'string' ? data.title : typeof data.name === 'string' ? data.name : '';
      report.subjectNames[subject] = t ? `${p.kind === 'calendar' ? 'Calendar' : p.kind === 'task' ? 'Task' : 'Event'}: ${t}` : `A ${p.kind} that is no longer here`;
    }
  }

  const settings = await loadCalendarSettings(d).catch(() => null);
  const input: BuildInput = {
    today: o.today, tz: o.tz, publishedAt: o.publishedAt ?? new Date(o.nowMs).toISOString(), revision: o.revision ?? 0, window,
    household: o.household ?? 'Family', weekStart: weekStartOf(settings?.weekStart ?? 0), idKey: o.idKey,
    people: grants.killed ? [] : peopleSources, events, dates, visits, reminders, tasks, grantRecordIds: grants.recordIds,
  };
  return { input, report, grants, family };
}

// ---------------- calendar-level sharing preview ----------------

export interface CalendarPreview {
  layerId: number;
  layerName: string;
  /** Events that WOULD become eligible (shown by the calendar, not kept private, not rejected). */
  eligible: { eventId: number; title: string; nextDate: string | null; occurrences: number; recurring: boolean }[];
  rejected: RejectedRow[];
  keptPrivate: PrivateRow[];
  /** Events that already have their own explicit `show` (they stay shown if the calendar is later switched off). */
  alreadyShown: number;
}

/** What switching a calendar on would make eligible. Changes nothing. */
export async function previewCalendarShare(d: FinanceDB, layerId: number, o: { today: string }): Promise<CalendarPreview> {
  const window = { from: addDays(o.today, -WINDOW_BEHIND), to: addDays(o.today, WINDOW_AHEAD) };
  const [layerRows, eventRows, linked, rows] = await Promise.all([
    d.moduleRecords.where('[module+kind]').equals([CAL, 'calendar']).toArray(),
    d.moduleRecords.where('[module+kind]').equals([CAL, 'event']).toArray(),
    linkModules(d, CAL),
    loadGrantRows(d),
  ]);
  const grants = resolveGrants(rows);
  const layer = layerRows.filter(isLive).map(asLayer).find((l) => l.id === layerId);
  const out: CalendarPreview = { layerId, layerName: layer?.name ?? 'Calendar', eligible: [], rejected: [], keptPrivate: [], alreadyShown: 0 };
  if (!layer || layer.sourceType !== 'local') return out;
  for (const r of eventRows.filter(isLive)) {
    const ev = asEvent(r);
    if (ev.data.calendarId !== layerId) continue;
    const own = grants.get(subjectOf('event', ev.id));
    if (own.state === 'hide') { out.keptPrivate.push({ eventId: ev.id, title: ev.data.title, calendarName: layer.name }); continue; }
    if (own.state === 'show') out.alreadyShown++;
    const rejection = eventRejection({ type: ev.data.type, retired: !!ev.data.retired, projectId: ev.data.projectId, linkedModules: linked.get(ev.id) ?? [], calendarSource: layer.sourceType });
    if (rejection) { out.rejected.push({ id: ev.id, title: ev.data.title, where: layer.name, rejection }); continue; }
    const occ = occurrencesOf(ev, window.from, window.to);
    out.eligible.push({ eventId: ev.id, title: ev.data.title, nextDate: occ.map((x) => x.firstDay).filter((x) => x >= o.today).sort()[0] ?? null, occurrences: occ.length, recurring: !!ev.data.recurrence });
  }
  out.eligible.sort((a, b) => (a.nextDate ?? '9999').localeCompare(b.nextDate ?? '9999') || a.title.localeCompare(b.title) || a.eventId - b.eventId);
  return out;
}
