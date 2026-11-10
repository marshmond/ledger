/**
 * Family Management F4: the household overview. READ-ONLY aggregation over what Ledger already stores; it creates, copies, completes and edits NOTHING.
 *
 * It answers four questions for the people who are IN THE HOUSEHOLD (active, readable Family members; one person per Contact):
 *  1. ACTIVITIES: the next 7 days of Calendar events whose `contactIds` name one of them. The occurrences come from the Calendar's own expander
 *     (`occurrencesOf`, through F3's `scheduleItemOf`), so repeating series, skipped dates and one-date changes follow the Calendar's rules. An event
 *     that names several members is ONE row (identity = event id + the occurrence's original date) that lists every member. The owner's device-local
 *     "calendars switched off" preference is respected: those events are counted, never listed.
 *  2. RESPONSIBILITIES: open Tasks whose `contactIds` name one of them, one row per Task however many members it names. Tasks has no "assigned to"
 *     field, so this is "associated with" and nothing stronger. Overdue first, then dated, then undated, using Tasks' own `isOpen` / `isOverdue` / `sortTasks`.
 *  3. DATES: member birthdays and important dates from F2's own `upcomingRows` (leap day and past-member rules are F2's), for the next 30 days.
 *  4. a stored Calendar "Birthday" event for the same person on the same day is the same fact as the birthday row, so it is shown once (as the date).
 *
 * Nothing here reads a Finance table, a Contact's phone, email or notes, or a member's private note. It stores nothing and takes no clock: `today` is passed in.
 */
import { db, type FinanceDB } from '../../db';
import { addDays } from '../../lib/dates';
import { isLive } from '../../core/store';
import { loadLayers } from '../calendar/data';
import { isLayerVisible, type Visibility } from '../calendar/layerVisibility';
import type { CalendarLayer, EventRecord } from '../calendar/model';
import { occurrencesOf } from '../calendar/occurrences';
import { isOpen, isOverdue, sortTasks } from '../tasks/views';
import type { TaskRecord, TaskStatus } from '../tasks/model';
import { loadMembers } from './data';
import { loadDates } from './dateData';
import type { DateRecord } from './dateModel';
import { activeByContact, readEvents, scheduleItemOf, type ScheduleItem } from './memberSchedule';
import { readTasks, taskWhen } from './memberWork';
import { effectiveMe, type MemberRecord, type Role } from './model';
import { upcomingRows, type UpcomingRow } from './upcoming';

/** Activities: today and the six days after it (seven days). */
export const ACTIVITY_DAYS = 7;
/** Birthdays and important dates: today through the 30th day after it (the same reach as a member's Schedule). */
export const DATE_DAYS = 30;
export const NO_CONTACT_NAME = 'Contact no longer exists';

/** One household member as the overview shows them. The name always comes from the shared Contact. */
export interface HouseholdPerson { memberId: number; contactId: number; name: string; role: Role; color?: string; isMe: boolean }
/** The small piece of a person that a row carries: enough to show a coloured, named link. */
export interface PersonRef { memberId: number; contactId: number; name: string; color?: string }

export interface HouseholdActivity extends ScheduleItem {
  /** EVERY active household member the event names, in name order. Never empty. */
  people: PersonRef[];
}
export interface HiddenActivity { key: string; memberIds: number[] }

export interface HouseholdTask {
  id: number;
  title: string;
  when: ReturnType<typeof taskWhen>;
  overdue: boolean;
  high: boolean;
  repeats: boolean;
  status: TaskStatus;
  /** EVERY active household member the Task names ("associated with"), in name order. Never empty. */
  people: PersonRef[];
}

export interface HouseholdDate extends UpcomingRow {
  /** The active household person this date is about (a birthday's owner, or the member a date record names), when there is one. Household-wide dates have none. */
  person?: PersonRef;
  /** The member record a date record names, even if that member is past or gone (for the name and the link). */
  aboutMemberId?: number;
  aboutName?: string;
}

export interface HouseholdOverview {
  people: HouseholdPerson[];
  activities: { items: HouseholdActivity[]; hidden: HiddenActivity[] };
  tasks: { items: HouseholdTask[] };
  dates: HouseholdDate[];
}

const byName = (a: { name: string; memberId: number }, b: { name: string; memberId: number }) => a.name.localeCompare(b.name) || a.memberId - b.memberId;

/** Pure: the active, readable members (one per Contact, the oldest record), with their names, colours and the effective "me". */
export function householdPeople(members: readonly MemberRecord[], names: ReadonlyMap<number, string>): HouseholdPerson[] {
  const me = effectiveMe(members).me;
  return [...activeByContact(members).values()]
    .map((m) => ({ memberId: m.id, contactId: m.data!.contactId, name: names.get(m.data!.contactId)?.trim() || NO_CONTACT_NAME, role: m.data!.role, ...(m.data!.color ? { color: m.data!.color } : {}), isMe: me?.id === m.id }))
    .sort(byName);
}

const refOf = (p: HouseholdPerson): PersonRef => ({ memberId: p.memberId, contactId: p.contactId, name: p.name, ...(p.color ? { color: p.color } : {}) });
/** The people a record's `contactIds` name, once each, in name order. */
function peopleFor(contactIds: readonly number[], byContact: ReadonlyMap<number, PersonRef>): PersonRef[] {
  return [...new Set(contactIds)].flatMap((c) => (byContact.has(c) ? [byContact.get(c)!] : [])).sort(byName);
}

/**
 * Pure: the household's occurrences from `from` to `to` (inclusive local dates), soonest first. `birthdays` lists the (Contact, day) pairs that the
 * Birthdays and dates section already shows: a stored Birthday event on one of those days is the same fact, so it is left out here rather than shown twice.
 */
export function buildHouseholdActivities(input: {
  events: readonly EventRecord[];
  layers: readonly CalendarLayer[];
  people: readonly HouseholdPerson[];
  visibility: Visibility;
  from: string;
  to: string;
  birthdays: readonly { contactId: number; date: string }[];
}): { items: HouseholdActivity[]; hidden: HiddenActivity[] } {
  const byContact = new Map(input.people.map((p) => [p.contactId, refOf(p)]));
  const layer = new Map(input.layers.map((l) => [l.id, l]));
  const bday = new Set(input.birthdays.map((b) => `${b.contactId}|${b.date}`));
  const seen: Record<string, true> = {};
  const items: HouseholdActivity[] = [];
  const hidden: HiddenActivity[] = [];
  for (const ev of input.events) {
    if (ev.data.retired) continue;
    const people = peopleFor(ev.data.contactIds, byContact);
    if (!people.length) continue;
    const cal = layer.get(ev.data.calendarId);
    const shown = !cal || isLayerVisible(input.visibility, cal.id);
    for (const o of occurrencesOf(ev, input.from, input.to)) {
      const key = `${o.eventId}:${o.key}`;
      if (seen[key]) continue;
      seen[key] = true;
      if (ev.data.type === 'birthday' && people.some((p) => bday.has(`${p.contactId}|${o.firstDay}`))) continue;
      if (!shown) { hidden.push({ key, memberIds: people.map((p) => p.memberId) }); continue; }
      items.push({ ...scheduleItemOf(o, cal, []), people });
    }
  }
  items.sort((a, b) => a.startMs - b.startMs || a.title.localeCompare(b.title) || a.eventId - b.eventId || a.occKey.localeCompare(b.occKey));
  return { items, hidden };
}

/** Pure: the open Tasks that name a household member. Overdue first (earliest first), then everything else in Tasks' own order (dated, then undated). */
export function buildHouseholdTasks(all: readonly TaskRecord[], people: readonly HouseholdPerson[], today: string): HouseholdTask[] {
  const byContact = new Map(people.map((p) => [p.contactId, refOf(p)]));
  const mine = all.filter((t) => isOpen(t) && t.data.contactIds.some((c) => byContact.has(c)));
  const late = mine.filter((t) => isOverdue(t, today));
  const rest = mine.filter((t) => !isOverdue(t, today));
  return [...sortTasks(late, 'due'), ...sortTasks(rest, 'due')].map((t) => ({
    id: t.id, title: t.data.title, when: taskWhen(t), overdue: isOverdue(t, today), high: t.data.priority === 'high', repeats: !!t.data.repeat, status: t.data.status,
    people: peopleFor(t.data.contactIds, byContact),
  }));
}

/**
 * Pure: F2's own list of birthdays and important dates, cut to `to`, with the person each is about. Birthdays follow F2 exactly (active members only,
 * the leap-day rule); a date record about a past member stays listed until archived (F2's policy) and is named but not linked to a household person.
 */
export function buildHouseholdDates(input: {
  members: readonly MemberRecord[];
  dates: readonly DateRecord[];
  names: ReadonlyMap<number, string>;
  people: readonly HouseholdPerson[];
  today: string;
  to: string;
}): HouseholdDate[] {
  const personByContact = new Map(input.people.map((p) => [p.contactId, refOf(p)]));
  const memberById = new Map(input.members.map((m) => [m.id, m]));
  const recordOf = new Map(input.dates.map((r) => [r.id, r]));
  const out: HouseholdDate[] = [];
  for (const row of upcomingRows(input.members, input.dates, input.names, input.today)) {
    if (row.date > input.to) continue;
    let person: PersonRef | undefined;
    let aboutMemberId: number | undefined;
    let aboutName: string | undefined;
    if (row.type === 'birthday' && row.memberId !== undefined) {
      const m = memberById.get(row.memberId);
      person = m?.data ? personByContact.get(m.data.contactId) : undefined;
      aboutMemberId = row.memberId;
    } else if (row.recordId !== undefined) {
      aboutMemberId = recordOf.get(row.recordId)?.data?.memberId;
      const m = aboutMemberId !== undefined ? memberById.get(aboutMemberId) : undefined;
      if (m?.data) { person = personByContact.get(m.data.contactId); aboutName = input.names.get(m.data.contactId)?.trim() || undefined; }
    }
    out.push({ ...row, ...(person ? { person } : {}), ...(aboutMemberId !== undefined && memberById.get(aboutMemberId) ? { aboutMemberId } : {}), ...(aboutName ? { aboutName } : {}) });
  }
  return out;
}

/** Pure: the whole overview from already-read records. */
export function buildHouseholdOverview(input: {
  members: readonly MemberRecord[];
  dates: readonly DateRecord[];
  names: ReadonlyMap<number, string>;
  events: readonly EventRecord[];
  layers: readonly CalendarLayer[];
  tasks: readonly TaskRecord[];
  visibility: Visibility;
  today: string;
}): HouseholdOverview {
  const people = householdPeople(input.members, input.names);
  const dates = buildHouseholdDates({ members: input.members, dates: input.dates, names: input.names, people, today: input.today, to: addDays(input.today, DATE_DAYS) });
  const to = addDays(input.today, ACTIVITY_DAYS - 1);
  const birthdays = dates.flatMap((d) => (d.type === 'birthday' && d.person ? [{ contactId: d.person.contactId, date: d.date }] : []));
  return {
    people,
    activities: people.length ? buildHouseholdActivities({ events: input.events, layers: input.layers, people, visibility: input.visibility, from: input.today, to, birthdays }) : { items: [], hidden: [] },
    tasks: { items: people.length ? buildHouseholdTasks(input.tasks, people, input.today) : [] },
    dates,
  };
}

/** Pure: the overview narrowed to one household person (null = everyone). Every section is narrowed by the same person, so the sections always agree. */
export function forPerson(o: HouseholdOverview, memberId: number | null): HouseholdOverview {
  if (memberId === null) return o;
  const has = (ps: readonly PersonRef[]) => ps.some((p) => p.memberId === memberId);
  return {
    people: o.people,
    activities: { items: o.activities.items.filter((a) => has(a.people)), hidden: o.activities.hidden.filter((h) => h.memberIds.includes(memberId)) },
    tasks: { items: o.tasks.items.filter((t) => has(t.people)) },
    dates: o.dates.filter((d) => d.person?.memberId === memberId),
  };
}

/**
 * Reads (never writes) the Family records, the Contact NAMES the members need (nothing else of a Contact), and, only when someone is in the household, the
 * Calendar events and Tasks: each table once, one row at a time with its own module's parser, so one damaged row cannot hide the rest.
 */
export async function readHouseholdOverview(today: string, visibility: Visibility, d: FinanceDB = db): Promise<HouseholdOverview> {
  const [members, dates] = await Promise.all([loadMembers(d), loadDates(d)]);
  const ids = [...new Set(members.flatMap((m) => (m.data ? [m.data.contactId] : [])))];
  const found = ids.length ? await d.contacts.bulkGet(ids) : [];
  const names = new Map<number, string>();
  found.forEach((c, i) => { if (c && isLive(c) && typeof c.name === 'string') names.set(ids[i], c.name); });
  const anyone = members.some((m) => m.data?.status === 'active');
  const [events, layers, tasks] = anyone ? await Promise.all([readEvents(d), loadLayers(d), readTasks(d)]) : [[], [], []];
  return buildHouseholdOverview({ members, dates, names, events, layers, tasks, visibility, today });
}
