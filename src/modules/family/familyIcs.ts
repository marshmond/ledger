/**
 * R4.2: the Family-only calendar file (.ics). A SNAPSHOT the owner downloads on purpose: it does not update itself, it is sent nowhere, and nothing is stored.
 *
 * WHAT IS IN IT (an allow-list; there is no path from any other source into this file):
 *  - Calendar events that name at least one household member and fall in the next 12 months. A repeating event is written ONCE with its repeat rule (the
 *    Calendar export's own convention and the same event id, `cal-<id>@ledger.local`, so a calendar that later imports the full Calendar export shows no duplicate).
 *    Only the title and the date and time are kept: location, notes, reminders, tags, project and priority are removed, and the description says who it is for.
 *  - Member birthdays and important dates, from the Family layer's own builder (so its all-day dates, leap-day rule and "leave off my Calendar" switches
 *    apply, and a birthday that a stored Birthday event already covers is written once). Titles are names and labels only: no birth year, age or note.
 *  EXCLUDED by construction: Finance, Bills, Services, Home & Assets, Projects and every other Calendar layer, and Tasks (the Calendar's own export has no
 *    convention for dated Tasks, and none is invented here). Hide Amounts is not what keeps money out: the money sources are never read.
 *  The owner's calendar switches are respected: an event on a calendar switched off on this device is left out.
 * Free text the owner typed into an event title is written as typed; Ledger cannot know whether it is private, which is why the owner chooses to download.
 */
import { db, type FinanceDB } from '../../db';
import type { DerivedItem } from '../../core/dueProvider';
import { isLive } from '../../core/store';
import { loadLayers } from '../calendar/data';
import { loadMembers } from './data';
import { loadDates } from './dateData';
import { readEvents } from './memberSchedule';
import { nameList, lensMatches } from '../../core/householdPeople';
import { addDays } from '../../lib/dates';
import { isLayerVisible, type Visibility } from '../calendar/layerVisibility';
import { buildIcs } from '../calendar/ics';
import type { CalendarLayer, EventFields, EventRecord } from '../calendar/model';
import { occurrencesOf } from '../calendar/occurrences';
import { buildFamilyItems } from './dueProvider';
import { householdPeople } from './householdOverview';
import type { DateRecord } from './dateModel';
import type { MemberRecord } from './model';

/** How far ahead the file looks. */
export const EXPORT_DAYS = 365;

export interface FamilyIcsInput {
  members: readonly MemberRecord[];
  dates: readonly DateRecord[];
  names: ReadonlyMap<number, string>;
  events: readonly EventRecord[];
  layers: readonly CalendarLayer[];
  visibility: Visibility;
  today: string;
  /** Chosen people's Contact ids (empty = the whole household). */
  selected?: readonly number[];
  nowIso: string;
}
export interface FamilyIcs { text: string; eventCount: number; dateCount: number }

const stripped = (f: Partial<EventFields>, who: string): Partial<EventFields> => ({ ...f, location: '', notes: who, reminders: [] });

/** Pure: the file text and what went into it. */
export function buildFamilyIcs(input: FamilyIcsInput): FamilyIcs {
  const to = addDays(input.today, EXPORT_DAYS);
  const selected = input.selected ?? [];
  const people = householdPeople(input.members, input.names);
  const byContact = new Map(people.map((p) => [p.contactId, p]));
  const layer = new Map(input.layers.map((l) => [l.id, l]));

  const events: EventRecord[] = [];
  for (const ev of input.events) {
    const d = ev.data;
    if (d.retired) continue;
    const who = [...new Set(d.contactIds)].flatMap((c) => (byContact.has(c) ? [byContact.get(c)!] : [])).sort((a, b) => a.name.localeCompare(b.name) || a.memberId - b.memberId);
    if (!who.length || !lensMatches(d.contactIds, selected)) continue;
    const cal = layer.get(d.calendarId);
    if (cal && !isLayerVisible(input.visibility, cal.id)) continue;
    if (occurrencesOf(ev, input.today, to).length === 0) continue;
    const text = `For: ${nameList(who.map((p) => p.name))}`;
    events.push({
      ...ev,
      data: {
        ...ev.data, ...stripped(d, text), tagIds: [], contactIds: [], projectId: undefined,
        overrides: Object.fromEntries(Object.entries(d.overrides).map(([k, o]) => [k, stripped(o, text)])),
      },
    });
  }
  const exportedEvents = new Set(events.map((e) => e.id));

  const dates: DerivedItem[] = buildFamilyItems({ members: input.members, dates: input.dates, names: input.names, events: () => input.events }, { from: input.today, to, today: input.today })
    // A birthday that a stored Birthday event covers is that event's, written once (only when that event is itself in this file).
    .filter((i) => !i.coveredBy || !exportedEvents.has(Number(i.coveredBy.split(':')[1])))
    .filter((i) => lensMatches(i.contactIds, selected))
    .map((i) => ({ ...i, icsAlarmMinutes: undefined, icsTitle: undefined, icsDetail: i.detail ?? '' }));

  return { text: buildIcs({ name: 'Family', events, derived: dates, nowIso: input.nowIso }), eventCount: events.length, dateCount: dates.length };
}

/** Reads (never writes) what the file needs and builds it. Called only when the owner presses Download. */
export async function readFamilyIcs(q: { today: string; visibility: Visibility; selected?: readonly number[] }, d: FinanceDB = db): Promise<FamilyIcs> {
  const [members, dates] = await Promise.all([loadMembers(d), loadDates(d)]);
  const ids = [...new Set(members.flatMap((m) => (m.data ? [m.data.contactId] : [])))];
  const found = ids.length ? await d.contacts.bulkGet(ids) : [];
  const names = new Map<number, string>();
  found.forEach((c, i) => { if (c && isLive(c) && typeof c.name === 'string') names.set(ids[i], c.name); });
  const anyone = members.some((m) => m.data?.status === 'active');
  const [events, layers] = anyone ? await Promise.all([readEvents(d), loadLayers(d)]) : [[], []];
  return buildFamilyIcs({ members, dates, names, events, layers, visibility: q.visibility, today: q.today, selected: q.selected, nowIso: new Date().toISOString() });
}
