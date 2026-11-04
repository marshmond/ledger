/**
 * Turns stored events into the things that appear on a given range of days (one entry per occurrence). Pure; nothing is stored.
 * A repeating event is expanded on LOCAL dates: "every Monday at 10:00" stays 10:00 on this device's clock through clock changes.
 */
import { addDays } from '../../lib/dates';
import { daysBetween } from '../../lib/money';
import type { EventFields, EventRecord } from './model';
import { generateDates } from './recurrence';
import { localISO, minutesOfDay, msAt } from './time';

export interface Occurrence extends EventFields {
  eventId: number;
  /** The occurrence's original date; with eventId it names this occurrence even after it was moved. */
  key: string;
  /** Local first/last day it appears on (both inclusive). */
  firstDay: string;
  lastDay: string;
  /** Absolute start/end. All-day items use local midnight to midnight so ordering and "now" checks work the same. */
  startMs: number;
  endMs: number;
  recurring: boolean;
  done: boolean;
  calendarId: number;
  trackDone: boolean;
  event: EventRecord;
}

/** First and last local day and the absolute start/end for a set of fields. */
export function geometry(f: EventFields): { firstDay: string; lastDay: string; startMs: number; endMs: number } {
  if (f.allDay) {
    const lastDay = f.endDate >= f.startDate ? f.endDate : f.startDate;
    return { firstDay: f.startDate, lastDay, startMs: msAt(f.startDate), endMs: msAt(addDays(lastDay, 1)) };
  }
  const endAt = Math.max(f.endAt, f.startAt);
  // A timed item that ends exactly at midnight belongs to the day before.
  const lastDay = localISO(endAt > f.startAt ? endAt - 1 : endAt);
  return { firstDay: localISO(f.startAt), lastDay, startMs: f.startAt, endMs: endAt };
}

const FIELD_KEYS: (keyof EventFields)[] = ['title', 'allDay', 'startDate', 'endDate', 'startAt', 'endAt', 'location', 'notes', 'priority', 'reminders'];
export const pickFields = (d: EventFields): EventFields => Object.fromEntries(FIELD_KEYS.map((k) => [k, d[k]])) as unknown as EventFields;

/** The date the series starts on (local). */
export function seriesStart(d: EventFields): string {
  return d.allDay ? d.startDate : localISO(d.startAt);
}

/** The same fields moved so they start on `date` (keeping time of day and length). */
export function placeOn(f: EventFields, date: string): EventFields {
  if (f.allDay) {
    const span = Math.max(0, daysBetween(f.endDate, f.startDate));
    return { ...f, startDate: date, endDate: addDays(date, span) };
  }
  const len = Math.max(0, f.endAt - f.startAt);
  const startAt = msAt(date, minutesOfDay(f.startAt));
  return { ...f, startAt, endAt: startAt + len, startDate: date, endDate: localISO(startAt + len > startAt ? startAt + len - 1 : startAt) };
}

/** Everything of `rec` that touches the days from..to (inclusive), soonest first. */
export function occurrencesOf(rec: EventRecord, from: string, to: string): Occurrence[] {
  const d = rec.data;
  const base = pickFields(d);
  const make = (key: string, f: EventFields): Occurrence => ({
    ...f, ...geometry(f), eventId: rec.id, key, recurring: !!d.recurrence, done: d.doneKeys.includes(key),
    calendarId: d.calendarId, trackDone: d.trackDone, event: rec,
  });
  const touches = (o: Occurrence) => o.firstDay <= to && o.lastDay >= from;

  if (!d.recurrence) {
    const o = make(seriesStart(base), base);
    return touches(o) ? [o] : [];
  }
  const start = seriesStart(base);
  const g = geometry(base);
  const spanDays = Math.max(0, daysBetween(g.lastDay, g.firstDay)) + 1;
  const dates = generateDates(start, d.recurrence, addDays(from, -spanDays), to);
  const keys = new Set([...dates, ...Object.keys(d.overrides)]);
  const out: Occurrence[] = [];
  for (const key of [...keys].sort()) {
    if (d.skipped.includes(key)) continue;
    const over = d.overrides[key];
    const f: EventFields = over ? { ...placeOn(base, key), ...over } : placeOn(base, key);
    const o = make(key, f);
    if (touches(o)) out.push(o);
  }
  return out.sort((a, b) => a.startMs - b.startMs || a.title.localeCompare(b.title));
}

export interface OccurrenceStatus {
  /** A reminder time has passed but the item has not started yet. */
  soon: boolean;
  /** Marked "keep until done", not done, and already over. */
  overdue: boolean;
}

export function statusOf(o: Pick<Occurrence, 'reminders' | 'startMs' | 'endMs' | 'trackDone' | 'done'>, now: number): OccurrenceStatus {
  const soon = !o.done && now < o.startMs && o.reminders.some((m) => now >= o.startMs - m * 60000);
  const overdue = o.trackDone && !o.done && now >= o.endMs;
  return { soon, overdue };
}

export const REMINDER_CHOICES: { minutes: number; label: string }[] = [
  { minutes: 0, label: 'At the time' },
  { minutes: 5, label: '5 minutes before' },
  { minutes: 15, label: '15 minutes before' },
  { minutes: 30, label: '30 minutes before' },
  { minutes: 60, label: '1 hour before' },
  { minutes: 1440, label: '1 day before' },
  { minutes: 2880, label: '2 days before' },
  { minutes: 10080, label: '1 week before' },
];
export const reminderLabel = (m: number) => REMINDER_CHOICES.find((c) => c.minutes === m)?.label ?? `${m} minutes before`;
