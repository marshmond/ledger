/**
 * Family Management F3: a member's upcoming Calendar events. READ-ONLY: nothing is stored, copied or written, and no Calendar or Task record is made.
 *
 * An event "is for" a member when its `contactIds` contains the member's Contact id (the field the Calendar's own "People" box writes). The
 * occurrences come from the Calendar's own expander (`occurrencesOf`), so repeating series, skipped dates, one-date overrides and multi-day events
 * follow exactly the Calendar's rules, and one occurrence appears once however many people the event names.
 *
 * VISIBILITY: the Calendar lets the owner switch calendars off on this device. A switched-off calendar's events are not listed here either
 * (they are counted, so the owner can see why something is missing). Nothing here changes that preference.
 */
import { db, type FinanceDB } from '../../db';
import { addDays } from '../../lib/dates';
import { isLive } from '../../core/store';
import { loadLayers } from '../calendar/data';
import { isLayerVisible, type Visibility } from '../calendar/layerVisibility';
import { storedItemKey } from '../calendar/markerCoordination';
import { asEvent, MODULE as CALENDAR_MODULE, type CalendarLayer, type EventRecord } from '../calendar/model';
import { occurrencesOf } from '../calendar/occurrences';
import { dayLabel, timeLabel } from '../calendar/time';
import { loadMembers } from './data';
import type { MemberRecord } from './model';

/** How far ahead the member page looks. */
export const SCHEDULE_DAYS = 30;
/** Used when an event's calendar no longer exists. */
export const FALLBACK_COLOR = '#6b7280';

export interface ScheduleItem {
  /** `<eventId>:<original date>`: stable, one per occurrence. */
  key: string;
  eventId: number;
  /** The occurrence's original date (the Calendar's name for it, even after it is moved). */
  occKey: string;
  title: string;
  allDay: boolean;
  firstDay: string;
  lastDay: string;
  startMs: number;
  endMs: number;
  location: string;
  recurring: boolean;
  done: boolean;
  trackDone: boolean;
  calendarId: number;
  calendarName: string;
  color: string;
  /** The Calendar's own name for this item, for a link that opens it there. */
  openKey: string;
  /** OTHER active household members this event is also for (by member record id and Contact id). */
  also: { memberId: number; contactId: number }[];
}

export interface MemberSchedule {
  items: ScheduleItem[];
  /** Occurrences left out because their calendar is switched off on this device. */
  hiddenCount: number;
}

/** The oldest ACTIVE, readable member for each Contact (a duplicate record for one person is one person). */
function activeByContact(members: readonly MemberRecord[]): Map<number, MemberRecord> {
  const out = new Map<number, MemberRecord>();
  for (const m of [...members].sort((a, b) => a.id - b.id)) if (m.data?.status === 'active' && !out.has(m.data.contactId)) out.set(m.data.contactId, m);
  return out;
}

/** Pure: the member's occurrences from `from` to `to` (inclusive local dates), soonest first. */
export function buildMemberSchedule(input: {
  events: readonly EventRecord[];
  layers: readonly CalendarLayer[];
  members: readonly MemberRecord[];
  contactId: number;
  visibility: Visibility;
  from: string;
  to: string;
}): MemberSchedule {
  const layer = new Map(input.layers.map((l) => [l.id, l]));
  const people = activeByContact(input.members);
  const seen: Record<string, true> = {};
  const items: ScheduleItem[] = [];
  let hiddenCount = 0;
  for (const ev of input.events) {
    if (ev.data.retired || !ev.data.contactIds.includes(input.contactId)) continue;
    const cal = layer.get(ev.data.calendarId);
    const shown = !cal || isLayerVisible(input.visibility, cal.id);
    const also = [...new Set(ev.data.contactIds)].filter((c) => c !== input.contactId && people.has(c)).map((c) => ({ memberId: people.get(c)!.id, contactId: c }));
    for (const o of occurrencesOf(ev, input.from, input.to)) {
      const key = `${o.eventId}:${o.key}`;
      if (seen[key]) continue;
      seen[key] = true;
      if (!shown) { hiddenCount++; continue; }
      items.push({
        key, eventId: o.eventId, occKey: o.key, title: o.title, allDay: o.allDay, firstDay: o.firstDay, lastDay: o.lastDay, startMs: o.startMs, endMs: o.endMs,
        location: o.location, recurring: o.recurring, done: o.done, trackDone: o.trackDone, calendarId: o.calendarId,
        calendarName: cal?.name ?? 'Calendar', color: cal?.color ?? FALLBACK_COLOR, openKey: storedItemKey(o.eventId, o.key), also,
      });
    }
  }
  items.sort((a, b) => a.startMs - b.startMs || a.title.localeCompare(b.title) || a.eventId - b.eventId || a.occKey.localeCompare(b.occKey));
  return { items, hiddenCount };
}

/**
 * The live Calendar events, read one row at a time with the Calendar's own parser (`asEvent`): a row that cannot be parsed (a null or foreign value
 * written by another version) is skipped instead of stopping the whole page. Same index as the Calendar's `loadEvents`; nothing is written.
 */
async function readEvents(d: FinanceDB): Promise<EventRecord[]> {
  const out: EventRecord[] = [];
  for (const r of await d.moduleRecords.where('[module+kind]').equals([CALENDAR_MODULE, 'event']).toArray()) {
    if (!isLive(r)) continue;
    try { out.push(asEvent(r)); } catch { /* unreadable row: not listed */ }
  }
  return out;
}

/** Reads (never writes) the events, calendars and members it needs, then builds the schedule for `today` and the next `SCHEDULE_DAYS` days. */
export async function readMemberSchedule(contactId: number, today: string, visibility: Visibility, d: FinanceDB = db): Promise<MemberSchedule> {
  const [events, layers, members] = await Promise.all([readEvents(d), loadLayers(d), loadMembers(d)]);
  return buildMemberSchedule({ events, layers, members, contactId, visibility, from: today, to: addDays(today, SCHEDULE_DAYS) });
}

/** "Wed, Nov 11 · 4:00 PM – 5:00 PM", "Wed, Nov 11 · All day", or a range across days. The Calendar's own day and time words. */
export function scheduleWhen(it: Pick<ScheduleItem, 'allDay' | 'firstDay' | 'lastDay' | 'startMs' | 'endMs'>): string {
  const day = dayLabel(it.firstDay);
  if (it.allDay) return it.lastDay > it.firstDay ? `${day} – ${dayLabel(it.lastDay)} · All day` : `${day} · All day`;
  if (it.endMs <= it.startMs) return `${day} · ${timeLabel(it.startMs)}`;
  return it.lastDay > it.firstDay ? `${day}, ${timeLabel(it.startMs)} – ${dayLabel(it.lastDay)}, ${timeLabel(it.endMs)}` : `${day} · ${timeLabel(it.startMs)} – ${timeLabel(it.endMs)}`;
}

/** The address that opens this occurrence on the Calendar (the Calendar's own `open` link). */
export const calendarLink = (it: Pick<ScheduleItem, 'openKey' | 'firstDay'>) => `#/calendar?v=agenda&d=${it.firstDay}&open=${encodeURIComponent(it.openKey)}`;
