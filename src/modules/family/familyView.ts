/**
 * R4.2: THE shared Family view reader. One pure function (and its reader) that assembles "what is on for the household between two dates" from the sources
 * that already own it, so the Family Week screen, its printed page and its calendar file all come from the same list and cannot disagree. Promised by the
 * Family plan (F0, item 7); built now with the OWNER audience only.
 *
 * SOURCES (nothing is copied or stored; every one is the module's own reader or rule):
 *  - EVENTS: Calendar events whose `contactIds` name a household member, expanded by the Calendar's own `occurrencesOf` (repeats, skipped dates, one-date
 *    changes). An event naming several members is ONE entry that lists all of them. Calendars the owner switched off on this device are counted, not listed.
 *  - TASKS: open Tasks that name a household member, with a due date (or "do on" date) in the window; open ones due earlier are carried over when the window
 *    includes today. A finished Task is never listed as something still to do. Tasks only "name" a person: Ledger does not record who has to do it.
 *  - DATES: member birthdays and important dates, by Family's own date rules (`datesInWindow`).
 *  Events and Tasks that name nobody are not Family items and stay in the Calendar and Tasks. The Overview's rule is the same, and a test reconciles the two.
 *
 * AUDIENCE. The contract takes an explicit audience. ONLY `owner` is built. `display` (a future shared tablet) is reserved for a separate, approved design
 * (CS-0): asking for it, or for anything else, FAILS CLOSED with `UnsupportedAudienceError` and returns nothing; it never falls back to the owner view. A
 * person being associated with an item does NOT make the item safe for a shared display; that needs its own explicit, revocable permission, which does not exist.
 *
 * OUTPUT. A narrow, explicit view model. Every field of `FamilyEntry` and `FamilyViewPerson` is listed below and nothing else can ride along: no raw record, no
 * `raw`/`metadata` bag, no notes, location, contact details, birth year, amounts, account or tax field. A test pins the exact key list and walks a built view.
 * The `link` is an in-app address for the signed-in owner and is not part of any export.
 */
import { db, type FinanceDB } from '../../db';
import { addDays } from '../../lib/dates';
import { isLive } from '../../core/store';
import type { HouseholdPerson as Person } from '../../core/householdPeople';
import { lensMatches } from '../../core/householdPeople';
import { loadLayers } from '../calendar/data';
import type { Visibility } from '../calendar/layerVisibility';
import type { CalendarLayer, EventRecord } from '../calendar/model';
import { fmtHM, minutesOfDay } from '../calendar/time';
import type { TaskRecord } from '../tasks/model';
import { loadMembers } from './data';
import { loadDates } from './dateData';
import type { DateRecord } from './dateModel';
import { buildHouseholdActivities, buildHouseholdTasks, householdPeople, type HouseholdPerson as FamilyPerson, type PersonRef } from './householdOverview';
import { memberColorId } from './memberIdentity';
import { calendarLink, readEvents } from './memberSchedule';
import { readTasks } from './memberWork';
import { DATES_ROUTE, FAMILY_BASE, memberRoute, type MemberRecord } from './model';
import { datesInWindow } from './upcoming';

export const FAMILY_AUDIENCES = ['owner'] as const;
export type SupportedAudience = (typeof FAMILY_AUDIENCES)[number];
/** `display` is named only so the type can say it exists later. It is NEVER served in R4.2. */
export type FamilyAudience = SupportedAudience | 'display';

export class UnsupportedAudienceError extends Error {
  constructor(audience: unknown) {
    super(`The Family view is not available for the "${String(audience)}" audience. Only the owner's view exists.`);
    this.name = 'UnsupportedAudienceError';
  }
}
/** Throws for every audience except `owner`: an unknown, missing or future one is refused, never treated as the owner. */
export function assertOwnerAudience(audience: unknown): asserts audience is SupportedAudience {
  if (audience !== 'owner') throw new UnsupportedAudienceError(audience);
}

export type FamilyEntryKind = 'event' | 'task' | 'birthday' | 'date';
export type FamilyEntryStatus = 'scheduled' | 'done' | 'overdue' | 'in-progress' | 'waiting';

/** One person, identity only. */
export type FamilyViewPerson = Person;

/** One thing on the family's schedule. EVERY field is listed here; adding a field is a deliberate change that a test will notice. */
export interface FamilyEntry {
  /** Stable: the same after a reload, a restore and a sync. */
  key: string;
  kind: FamilyEntryKind;
  title: string;
  /** First and last local day it falls on (`YYYY-MM-DD`). Equal for a one-day item. */
  firstDay: string;
  lastDay: string;
  allDay: boolean;
  /** `HH:MM` local, or null (all-day items, dates, and Tasks with no time). */
  startTime: string | null;
  endTime: string | null;
  recurring: boolean;
  status: FamilyEntryStatus;
  /** EVERY household member it concerns, in name order. Empty only for a household-wide important date. */
  people: FamilyViewPerson[];
  /** Where it opens, for the signed-in owner. Navigation only. */
  link: string;
  source: 'Calendar' | 'Tasks' | 'Family';
}

export interface FamilyDay { date: string; entries: FamilyEntry[] }

export interface FamilyView {
  audience: SupportedAudience;
  from: string;
  to: string;
  /** The household's people (for choosing who to show). Never narrowed by the filter. */
  people: FamilyViewPerson[];
  /** Every day from `from` to `to`, in order, each with its entries (possibly none). */
  days: FamilyDay[];
  /** Open dated Tasks that were due before `from`, only when the window includes today. Overdue first. */
  carriedOver: FamilyEntry[];
  /** Occurrences left out because their calendar is switched off on this device. Counted, never listed. */
  hiddenCount: number;
}

/** The keys a built entry may have: the golden list the privacy test compares. */
export const FAMILY_ENTRY_KEYS: readonly (keyof FamilyEntry)[] = ['key', 'kind', 'title', 'firstDay', 'lastDay', 'allDay', 'startTime', 'endTime', 'recurring', 'status', 'people', 'link', 'source'];
export const FAMILY_PERSON_KEYS: readonly (keyof FamilyViewPerson)[] = ['memberId', 'contactId', 'name', 'colorId'];

const toPerson = (p: PersonRef | FamilyPerson): FamilyViewPerson => ({ memberId: p.memberId, contactId: p.contactId, name: p.name, colorId: memberColorId(p.color) });
const timeOf = (ms: number): string => fmtHM(minutesOfDay(ms));
const hash = (route: string) => `#${FAMILY_BASE}${route}`;

/** Within one day: dates first, then all-day events, then anything with a time (events and Tasks together, by time), then Tasks with no time. */
const rank = (e: FamilyEntry) => (e.kind === 'birthday' || e.kind === 'date' ? 0 : e.startTime === null && e.kind === 'event' ? 1 : e.startTime !== null ? 2 : 3);
export const order = (a: FamilyEntry, b: FamilyEntry) => rank(a) - rank(b) || (a.startTime ?? '').localeCompare(b.startTime ?? '') || a.title.localeCompare(b.title) || a.key.localeCompare(b.key);

export interface FamilyViewInput {
  members: readonly MemberRecord[];
  dates: readonly DateRecord[];
  names: ReadonlyMap<number, string>;
  events: readonly EventRecord[];
  layers: readonly CalendarLayer[];
  tasks: readonly TaskRecord[];
  visibility: Visibility;
  today: string;
  from: string;
  to: string;
}

/**
 * Pure: every entry for `from`..`to` as one flat list (each once, multi-day items too), the carried-over Tasks and the household's people. `selected` is the chosen
 * people's Contact ids (empty = everyone). The screen, the printed page and the calendar file all start from this.
 */
export function buildFamilyEntries(audience: unknown, input: FamilyViewInput, selected: readonly number[] = []): { people: FamilyViewPerson[]; entries: FamilyEntry[]; carriedOver: FamilyEntry[]; hiddenCount: number } {
  assertOwnerAudience(audience);
  const { from, to, today } = input;
  const people = householdPeople(input.members, input.names);
  const all: FamilyEntry[] = [];
  let hiddenCount = 0;

  if (people.length) {
    // Dates first: the same birthdays the "Birthdays and dates" list shows. A stored Birthday event on the same day is the same fact and is shown once.
    const rows = datesInWindow(input.members, input.dates, input.names, from, to);
    const memberById = new Map(input.members.map((m) => [m.id, m]));
    const byContact = new Map(people.map((p) => [p.contactId, toPerson(p)]));
    const recordOf = new Map(input.dates.map((r) => [r.id, r]));
    const birthdays: { contactId: number; date: string }[] = [];
    for (const r of rows) {
      let who: FamilyViewPerson | undefined;
      if (r.type === 'birthday' && r.memberId !== undefined) {
        const cid = memberById.get(r.memberId)?.data?.contactId;
        who = cid !== undefined ? byContact.get(cid) : undefined;
        if (who) birthdays.push({ contactId: who.contactId, date: r.date });
      } else if (r.recordId !== undefined) {
        const about = recordOf.get(r.recordId)?.data?.memberId;
        const cid = about !== undefined ? memberById.get(about)?.data?.contactId : undefined;
        who = cid !== undefined ? byContact.get(cid) : undefined;
      }
      const isBirthday = r.type === 'birthday';
      const about = recordOf.get(r.recordId ?? -1)?.data?.memberId;
      const route = isBirthday && r.memberId !== undefined ? memberRoute(r.memberId) : about !== undefined && memberById.has(about) ? memberRoute(about) : DATES_ROUTE;
      all.push({
        key: `${isBirthday ? 'b' : 'd'}:${isBirthday ? r.memberId : r.recordId}:${r.date}`, kind: isBirthday ? 'birthday' : 'date', title: r.title, firstDay: r.date, lastDay: r.date,
        allDay: true, startTime: null, endTime: null, recurring: true, status: 'scheduled', people: who ? [who] : [],
        link: hash(route),
        source: 'Family',
      });
    }

    const acts = buildHouseholdActivities({ events: input.events, layers: input.layers, people, visibility: input.visibility, from, to, birthdays });
    hiddenCount = acts.hidden.length;
    for (const a of acts.items) {
      all.push({
        key: `e:${a.eventId}:${a.occKey}`, kind: 'event', title: a.title, firstDay: a.firstDay, lastDay: a.lastDay, allDay: a.allDay,
        startTime: a.allDay ? null : timeOf(a.startMs), endTime: a.allDay || a.endMs <= a.startMs ? null : timeOf(a.endMs), recurring: a.recurring,
        status: a.trackDone && a.done ? 'done' : 'scheduled', people: a.people.map(toPerson), link: calendarLink(a), source: 'Calendar',
      });
    }
  }

  const tasks = people.length ? buildHouseholdTasks(input.tasks, people, today) : [];
  const taskEntry = (t: (typeof tasks)[number]): FamilyEntry => ({
    key: `t:${t.id}`, kind: 'task', title: t.title, firstDay: t.when!.date, lastDay: t.when!.date, allDay: !t.when!.time, startTime: t.when!.time, endTime: null, recurring: t.repeats,
    status: t.overdue ? 'overdue' : t.status === 'doing' ? 'in-progress' : t.status === 'waiting' ? 'waiting' : 'scheduled', people: t.people.map(toPerson), link: `#/tasks?task=${t.id}`, source: 'Tasks',
  });
  const dated = tasks.filter((t) => t.when);
  for (const t of dated) if (t.when!.date >= from && t.when!.date <= to) all.push(taskEntry(t));
  const carriedOver = today >= from && today <= to ? dated.filter((t) => t.when!.date < from).map(taskEntry) : [];

  const keep = (e: FamilyEntry) => lensMatches(e.people.map((p) => p.contactId), selected);
  return { people: people.map(toPerson), entries: all.filter(keep).sort((a, b) => a.firstDay.localeCompare(b.firstDay) || order(a, b)), carriedOver: carriedOver.filter(keep), hiddenCount };
}

/** Pure: the household's view for `from`..`to`, one bucket per day (at most 62 days). */
export function buildFamilyView(audience: unknown, input: FamilyViewInput, selected: readonly number[] = []): FamilyView {
  const { people, entries, carriedOver, hiddenCount } = buildFamilyEntries(audience, input, selected);
  const days: FamilyDay[] = [];
  for (let d = input.from; d <= input.to && days.length < 62; d = addDays(d, 1)) days.push({ date: d, entries: entries.filter((e) => e.firstDay <= d && e.lastDay >= d).sort(order) });
  return { audience: 'owner', from: input.from, to: input.to, people, days, carriedOver, hiddenCount };
}

/** Pure: the same view narrowed to the chosen people's Contact ids (empty = everyone). A shared item stays one entry with everyone it names. The screen narrows in memory, so choosing a person is instant. */
export function narrowFamilyView(view: FamilyView, selected: readonly number[]): FamilyView {
  if (selected.length === 0) return view;
  const keep = (e: FamilyEntry) => lensMatches(e.people.map((p) => p.contactId), selected);
  return { ...view, days: view.days.map((d) => ({ ...d, entries: d.entries.filter(keep) })), carriedOver: view.carriedOver.filter(keep) };
}

/**
 * Reads (never writes) what the view needs and builds it. The audience is checked FIRST, before any record is read, so a refused audience reads nothing.
 * Contacts are read only for the member names; Tasks and Calendar events only when someone is in the household.
 */
export async function readFamilyView(audience: unknown, q: { from: string; to: string; today: string; visibility: Visibility; selected?: readonly number[] }, d: FinanceDB = db): Promise<FamilyView> {
  assertOwnerAudience(audience);
  const [members, dates] = await Promise.all([loadMembers(d), loadDates(d)]);
  const ids = [...new Set(members.flatMap((m) => (m.data ? [m.data.contactId] : [])))];
  const found = ids.length ? await d.contacts.bulkGet(ids) : [];
  const names = new Map<number, string>();
  found.forEach((c, i) => { if (c && isLive(c) && typeof c.name === 'string') names.set(ids[i], c.name); });
  const anyone = members.some((m) => m.data?.status === 'active');
  const [events, layers, tasks] = anyone ? await Promise.all([readEvents(d), loadLayers(d), readTasks(d)]) : [[], [], []];
  return buildFamilyView(audience, { members, dates, names, events, layers, tasks, visibility: q.visibility, today: q.today, from: q.from, to: q.to }, q.selected ?? []);
}

/** Every entry in a view once (a multi-day item is listed on each day it covers, but is one entry): carried-over first, then by day. For counts and the export. */
export function entriesOf(view: FamilyView): FamilyEntry[] {
  const seen: Record<string, true> = {};
  const out: FamilyEntry[] = [];
  for (const e of [...view.carriedOver, ...view.days.flatMap((d) => d.entries)]) if (!seen[e.key]) { seen[e.key] = true; out.push(e); }
  return out;
}

