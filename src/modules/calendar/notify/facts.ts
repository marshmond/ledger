/**
 * CAL-N1: turns a stored event into the facts a message may use, and tells which changes matter to other people.
 * Pure: no database, clock or network. It reads the Calendar's own helpers and never changes the recurrence engine.
 */
import { canonicalJson } from '../../../display/contract';
import { normalizeRule, type Recurrence } from '../../../core/recurrence';
import type { EventData, EventFields } from '../model';
import { geometry, pickFields, placeOn, seriesStart } from '../occurrences';
import { minutesOfDay } from '../time';
import type { ChangeKind, EventFacts, NoticeScope } from './types';

/** The stored fields of one date of an event: the series' own, or the one-date change, exactly as the Calendar shows it. */
export function fieldsOnKey(d: EventData, key: string): EventFields {
  const base = pickFields(d);
  if (!d.recurrence) return base;
  const over = d.overrides[key];
  return over ? { ...placeOn(base, key), ...over } : placeOn(base, key);
}

/** The facts for an event (`key` null = the series itself, or a one-off event). `people` are Contact names the caller already looked up. */
export function factsOf(d: EventData, key: string | null, people: string[]): EventFacts {
  const f = key && d.recurrence ? fieldsOnKey(d, key) : pickFields(d);
  const g = geometry(f);
  return {
    title: f.title,
    allDay: f.allDay,
    firstDay: g.firstDay,
    lastDay: g.lastDay,
    startMs: g.startMs,
    endMs: g.endMs,
    location: f.location,
    people,
    recurrence: d.recurrence,
    seriesStart: seriesStart(pickFields(d)),
  };
}

/** Facts built straight from the fields a form holds (used for the "before" side of an update). */
export function factsOfFields(f: EventFields, rule: Recurrence | null, people: string[], start: string): EventFacts {
  const g = geometry(f);
  return { title: f.title, allDay: f.allDay, firstDay: g.firstDay, lastDay: g.lastDay, startMs: g.startMs, endMs: g.endMs, location: f.location, people, recurrence: rule, seriesStart: start };
}

const sameRule = (a: Recurrence | null, b: Recurrence | null) => canonicalJson(normalizeRule(a)) === canonicalJson(normalizeRule(b));
const sameSet = (a: number[], b: number[]) => a.length === b.length && [...a].sort().join(',') === [...b].sort().join(',');

export interface ChangeSide {
  fields: EventFields;
  recurrence: Recurrence | null;
  /** Contact ids of the people involved. */
  people: number[];
}

/**
 * Which meaningful things differ between two versions of the same occurrence (or event). `one` changes only that date's own details, so the repeat
 * rule and the people (which belong to the whole series) are not compared. Notes, tags, priority, reminders, project and calendar are never looked at.
 */
export function detectChanges(before: ChangeSide, after: ChangeSide, scope: NoticeScope): ChangeKind[] {
  const out: ChangeKind[] = [];
  const a = before.fields, b = after.fields;
  const ga = geometry(a), gb = geometry(b);
  if (a.title.trim() !== b.title.trim()) out.push('title');
  if (a.allDay !== b.allDay) out.push('allDay');
  if (ga.firstDay !== gb.firstDay || (a.allDay && b.allDay && ga.lastDay !== gb.lastDay)) out.push('date');
  if (!a.allDay && !b.allDay) {
    // Start time, end time and length all count as "the time".
    const lenA = Math.max(0, a.endAt - a.startAt), lenB = Math.max(0, b.endAt - b.startAt);
    if (minutesOfDay(a.startAt) !== minutesOfDay(b.startAt) || lenA !== lenB) out.push('time');
    else if (ga.lastDay !== gb.lastDay && !out.includes('date')) out.push('time');
  }
  if (a.location.trim() !== b.location.trim()) out.push('location');
  if (scope !== 'one') {
    if (!sameRule(before.recurrence, after.recurrence)) out.push('recurrence');
    if (!sameSet(before.people, after.people)) out.push('people');
  }
  return out;
}

/**
 * The text the message depends on, as one string. Two states with the same string say the same thing to a reader. Only what the owner chose to
 * disclose is in it, so a change to a hidden place does not make an approved message look out of date.
 */
export function stateText(f: EventFacts, flags: { includeLocation: boolean; includePeople: boolean }, series: boolean): string {
  // A message about a whole series (or the rest of one) says the time of day, the repeat and when it starts, not one occurrence's date, so the date
  // the owner happened to open is left out: that way the form and the stored event always give the same text.
  const minutes = (ms: number) => minutesOfDay(ms);
  return canonicalJson({
    title: f.title, allDay: f.allDay, series,
    day: series ? null : [f.firstDay, f.lastDay],
    start: f.allDay ? null : series ? minutes(f.startMs) : f.startMs,
    length: f.allDay || !series ? null : Math.max(0, f.endMs - f.startMs),
    end: f.allDay || series ? null : f.endMs,
    recurrence: normalizeRule(f.recurrence), seriesStart: series ? f.seriesStart : null,
    location: flags.includeLocation ? f.location.trim() : null,
    people: flags.includePeople ? f.people : null,
  });
}

/**
 * A message about a repeating event is "series mode" when it covers the whole series or the rest of it (and for a brand-new repeating event): it
 * then speaks of the time of day and the repeat rule. A single date, or an event that does not repeat, speaks of that date.
 */
export const isSeriesMode = (s: { kind: string; scope: NoticeScope; facts: Pick<EventFacts, 'recurrence'> }): boolean =>
  !!s.facts.recurrence && (s.scope === 'all' || s.scope === 'following' || (s.kind === 'created' && s.scope !== 'one'));
