/**
 * Calendar-file (.ics) export. Export only: nothing is imported and no outside calendar is contacted.
 *  - All-day items are written as plain dates, so a phone calendar never moves them to another day.
 *  - One-off timed items are written as absolute (UTC) times; repeating timed items are written as "floating" local times, which
 *    matches how this app repeats them ("every Monday at 10:00" stays 10:00 on the clock).
 *  - Finance items (derived) keep the event ids Ledger's own "Add to my calendar" file uses (`bill-<ruleId>-<date>@ledger.local`),
 *    so a calendar that already has them does not show duplicates.
 */
import type { DerivedItem } from '../../core/dueProvider';
import { addDays, dayOfWeek } from '../../lib/dates';
import type { EventRecord } from './model';
import { geometry, pickFields, placeOn, seriesStart } from './occurrences';
import { nthOfMonth, type Recurrence } from './recurrence';
import { localISO, minutesOfDay } from './time';

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const compact = (d: string) => d.replace(/-/g, '');
const p2 = (n: number) => String(n).padStart(2, '0');
const DAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

/** Lines longer than 75 bytes are folded onto continuation lines that start with a space (RFC 5545). */
function fold(line: string): string[] {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return [line];
  const out: string[] = [];
  let cur = '';
  for (const ch of line) {
    const limit = out.length === 0 ? 75 : 74;
    if (enc.encode(cur + ch).length > limit) { out.push(out.length === 0 ? cur : ' ' + cur); cur = ch; } else cur += ch;
  }
  out.push(out.length === 0 ? cur : ' ' + cur);
  return out;
}

const utc = (ms: number) => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}${p2(d.getUTCMonth() + 1)}${p2(d.getUTCDate())}T${p2(d.getUTCHours())}${p2(d.getUTCMinutes())}${p2(d.getUTCSeconds())}Z`;
};
const floating = (ms: number) => `${compact(localISO(ms))}T${p2(Math.floor(minutesOfDay(ms) / 60))}${p2(minutesOfDay(ms) % 60)}00`;

/** RRULE text for a repeat rule starting on `start` (a local date). */
export function rruleOf(r: Recurrence, start: string, allDay: boolean): string {
  const parts = [`FREQ=${r.freq.toUpperCase()}`];
  if (r.interval > 1) parts.push(`INTERVAL=${r.interval}`);
  if (r.freq === 'weekly') parts.push(`BYDAY=${(r.byWeekday?.length ? r.byWeekday : [dayOfWeek(start)]).map((d) => DAY[d]).join(',')}`);
  if (r.freq === 'monthly') {
    const mode = r.monthly ?? 'date';
    const { nth, weekday } = nthOfMonth(start);
    if (mode === 'date') {
      const day = Number(start.slice(8, 10));
      // "the 31st" means the last day of shorter months, as in Ledger: pick the last of the days that exist.
      if (day > 28) parts.push(`BYMONTHDAY=${Array.from({ length: day - 27 }, (_, i) => 28 + i).join(',')}`, 'BYSETPOS=-1');
      else parts.push(`BYMONTHDAY=${day}`);
    } else parts.push(`BYDAY=${mode === 'last' ? -1 : nth}${DAY[weekday]}`);
  }
  if (r.end.type === 'count') parts.push(`COUNT=${r.end.count}`);
  if (r.end.type === 'until') parts.push(`UNTIL=${allDay ? compact(r.end.date) : compact(r.end.date) + 'T235959'}`);
  return parts.join(';');
}

const alarm = (minutes: number, title: string) => [
  'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(title)}`,
  `TRIGGER:${minutes === 0 ? 'PT0S' : minutes % 1440 === 0 ? `-P${minutes / 1440}D` : `-PT${minutes}M`}`, 'END:VALARM',
];
const PRIO = { high: 1, medium: 5, low: 9, reminder: 9 } as const;

export interface IcsOptions {
  name: string;
  events: EventRecord[];
  /** Finance (or other derived) items to include, if the user asked for them. */
  derived?: DerivedItem[];
  nowIso: string;
  tagName?: (id: number) => string | undefined;
}

export function buildIcs(o: IcsOptions): string {
  const stamp = o.nowIso.replace(/[-:]/g, '').replace(/\.\d+/, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Ledger//Calendar//EN', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${esc(o.name)}`];

  for (const ev of o.events) {
    const d = ev.data;
    if (d.retired) continue; // another module owns it now
    const base = pickFields(d);
    const uid = `cal-${ev.id}@ledger.local`;
    const cats = d.tagIds.map((t) => o.tagName?.(t)).filter((x): x is string => !!x);
    /** The event's own lines: properties first, alarms last (the order the format requires). */
    const body = (f: typeof base) => {
      const g = geometry(f);
      const props: string[] = [];
      if (f.allDay) props.push(`DTSTART;VALUE=DATE:${compact(g.firstDay)}`, `DTEND;VALUE=DATE:${compact(addDays(g.lastDay, 1))}`);
      else if (d.recurrence) props.push(`DTSTART:${floating(g.startMs)}`, `DTEND:${floating(g.endMs)}`);
      else props.push(`DTSTART:${utc(g.startMs)}`, `DTEND:${utc(g.endMs)}`);
      props.push(`SUMMARY:${esc(f.title)}`);
      if (f.location) props.push(`LOCATION:${esc(f.location)}`);
      if (f.notes) props.push(`DESCRIPTION:${esc(f.notes)}`);
      props.push(`PRIORITY:${PRIO[f.priority]}`);
      if (f.priority === 'reminder') props.push('TRANSP:TRANSPARENT');
      if (cats.length) props.push(`CATEGORIES:${cats.map(esc).join(',')}`);
      return { props, alarms: f.reminders.flatMap((m) => alarm(m, f.title)) };
    };
    /** How the original date of an occurrence is written after EXDATE / RECURRENCE-ID. */
    const keyValue = (key: string) => (base.allDay ? `;VALUE=DATE:${compact(key)}` : `:${floating(geometry(placeOn(base, key)).startMs)}`);

    const master = body(base);
    lines.push('BEGIN:VEVENT', `UID:${uid}`, `DTSTAMP:${stamp}`, ...master.props);
    if (d.recurrence) {
      lines.push(`RRULE:${rruleOf(d.recurrence, seriesStart(base), base.allDay)}`);
      for (const k of d.skipped) lines.push(`EXDATE${keyValue(k)}`);
      // Occurrences edited on their own are written as separate entries below, so they must not also come from the rule.
      for (const k of Object.keys(d.overrides)) if (!d.skipped.includes(k)) lines.push(`EXDATE${keyValue(k)}`);
    }
    lines.push(...master.alarms, 'END:VEVENT');

    // One entry per occurrence that was edited on its own (same id + the original date it replaces)
    for (const [key, over] of Object.entries(d.overrides)) {
      if (d.skipped.includes(key) || !d.recurrence) continue;
      const one = body({ ...placeOn(base, key), ...over });
      lines.push('BEGIN:VEVENT', `UID:${uid}`, `DTSTAMP:${stamp}`, `RECURRENCE-ID${keyValue(key)}`, ...one.props, ...one.alarms, 'END:VEVENT');
    }
  }

  for (const it of o.derived ?? []) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${it.icsUid ?? `${it.id}@ledger.local`}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${compact(it.date)}`,
      `DTEND;VALUE=DATE:${compact(addDays(it.endDate ?? it.date, 1))}`,
      `SUMMARY:${esc(it.title)}`,
      `DESCRIPTION:${esc(it.detail ?? '')}`,
    );
    if (it.icsAlarmMinutes !== undefined) lines.push(...alarm(it.icsAlarmMinutes, it.title));
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.flatMap(fold).join('\r\n') + '\r\n';
}

