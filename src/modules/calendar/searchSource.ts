import { db } from '../../db';
import type { SearchResult, SearchSource } from '../../core/registry';
import { addDays } from '../../lib/dates';
import { norm, score } from '../../lib/search';
import { todayISO } from '../../lib/money';
import { loadEvents } from './data';
import type { EventRecord } from './model';
import { occurrencesOf } from './occurrences';
import { dayLabel, localISO } from './time';

/** The occurrence a hit should open: the next one from today, else the first one the event has. */
export function occurrenceToOpen(ev: EventRecord, today: string) {
  const soon = occurrencesOf(ev, today, addDays(today, 400))[0];
  if (soon) return soon;
  const first = ev.data.allDay ? ev.data.startDate : localISO(ev.data.startAt);
  return occurrencesOf(ev, addDays(first, -1), addDays(first, 400))[0] ?? null;
}

/** Pure: the Calendar hits for a typed query from already-loaded events. Events are found by title, notes and location. */
export function searchEventsData(raw: string, events: EventRecord[], today: string, cap = 8): SearchResult[] {
  const query = norm(raw).split(/\s+/).filter(Boolean);
  if (query.length === 0) return [];
  const out: SearchResult[] = [];
  const s0 = score(query, 'Calendar', 'calendar events agenda month week schedule');
  if (s0 > 0) out.push({ id: 'page:/calendar', title: 'Calendar', subtitle: 'Go to this page', kind: 'Page', score: s0, path: '/calendar' });

  const ranked = events
    .filter((e) => !e.data.retired)
    .map((e) => ({ e, s: score(query, e.data.title, `${e.data.notes} ${e.data.location}`) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.e.data.title.localeCompare(b.e.data.title))
    .slice(0, cap);
  for (const { e, s } of ranked) {
    const occ = occurrenceToOpen(e, today);
    const date = occ?.firstDay ?? e.data.startDate;
    const bits = [dayLabel(date, { year: true })];
    if (e.data.recurrence) bits.push('repeats');
    if (e.data.location) bits.push(e.data.location);
    const path = occ ? `/calendar?v=agenda&d=${date}&open=${encodeURIComponent(`e:${e.id}:${occ.key}`)}` : `/calendar?v=agenda&d=${date}`;
    out.push({ id: `event:${e.id}`, title: e.data.title, subtitle: bits.join(' · '), kind: 'Event', score: s, path });
  }
  return out;
}

/** What global search finds in the Calendar: the page and your events (title, notes, location). */
export const calendarSearchSource: SearchSource = {
  group: 'Calendar',
  async search(query, limit) {
    return searchEventsData(query, await loadEvents(db), todayISO()).slice(0, limit);
  },
};
