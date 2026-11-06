/**
 * Editing a repeating event: this occurrence / this and following / all. These functions take the stored event and return what
 * should be stored; they write nothing themselves (data.ts does that), so they are easy to test.
 */
import { addDays } from '../../lib/dates';
import { daysBetween } from '../../lib/money';
import type { EventData, EventFields } from './model';
import { occurrencesBefore, type Recurrence } from './recurrence';
import { pickFields, placeOn, seriesStart, type Occurrence } from './occurrences';

/** The parts of an event that belong to the whole series (a single occurrence cannot change these on its own). */
export interface SeriesExtras {
  calendarId: number;
  tagIds: number[];
  contactIds: number[];
  recurrence: Recurrence | null;
  trackDone: boolean;
  type?: string;
  /**
   * Leave the key out to keep whatever project the event has. Pass a number to set it, or `undefined` to take the event off its project.
   * (A spread of an object with `projectId: undefined` replaces the old value, which is what "remove" needs.)
   */
  projectId?: number;
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const startDayOf = (f: EventFields) => seriesStart(f);
const before = <T,>(rec: Record<string, T>, key: string) => Object.fromEntries(Object.entries(rec).filter(([k]) => k < key));
const from = <T,>(rec: Record<string, T>, key: string) => Object.fromEntries(Object.entries(rec).filter(([k]) => k >= key));

/** "All events": applies the edit to the whole series. Moving the date moves the whole series by the same number of days. */
export function editAll(master: EventData, original: Occurrence, edited: EventFields, extras: SeriesExtras): EventData {
  const delta = daysBetween(startDayOf(edited), original.firstDay);
  const newStart = addDays(seriesStart(pickFields(master)), delta);
  const placed = placeOn(edited, newStart);
  const sameShape = delta === 0 && sameJson(master.recurrence, extras.recurrence);
  return {
    ...master,
    ...placed,
    ...extras,
    skipped: sameShape ? master.skipped : [],
    overrides: sameShape ? master.overrides : {},
    doneKeys: sameShape ? master.doneKeys : [],
  };
}

/** "This occurrence": stores only what differs from the series for that one date. */
export function editOccurrence(master: EventData, key: string, edited: EventFields): EventData {
  const baseline = placeOn(pickFields(master), key);
  const diff: Partial<EventFields> = {};
  for (const k of Object.keys(baseline) as (keyof EventFields)[]) {
    // Compare only what is relevant for the kind of item (a timed item's all-day dates are leftovers).
    if (!sameJson(baseline[k], edited[k])) (diff as Record<string, unknown>)[k] = edited[k];
  }
  const overrides = { ...master.overrides };
  if (Object.keys(diff).length) overrides[key] = diff;
  else delete overrides[key];
  return { ...master, overrides };
}

/** "Delete this occurrence": the series carries on without it. */
export function skipOccurrence(master: EventData, key: string): EventData {
  const overrides = { ...master.overrides };
  delete overrides[key];
  return { ...master, skipped: [...new Set([...master.skipped, key])].sort(), overrides };
}

function endBefore(master: EventData, key: string): EventData {
  return {
    ...master,
    recurrence: master.recurrence ? { ...master.recurrence, end: { type: 'until', date: addDays(key, -1) } } : null,
    skipped: master.skipped.filter((k) => k < key),
    overrides: before(master.overrides, key),
    doneKeys: master.doneKeys.filter((k) => k < key),
  };
}

/**
 * "This and following": the old series ends the day before `key`, and a new series starts from the edit.
 * Returns null when `key` is the very first occurrence (then it is the same as editing all events).
 */
export function splitFollowing(master: EventData, key: string, edited: EventFields, extras: SeriesExtras): { old: EventData; next: EventData } | null {
  const rule = master.recurrence;
  if (!rule || key <= seriesStart(pickFields(master))) return null;
  let newRule = extras.recurrence;
  // "Repeat 10 times" that you did not touch means 10 in total, so the new series gets what is left.
  if (newRule && rule.end.type === 'count' && sameJson(newRule.end, rule.end)) {
    const left = Math.max(1, rule.end.count - occurrencesBefore(seriesStart(pickFields(master)), rule, key));
    newRule = { ...newRule, end: { type: 'count', count: left } };
  }
  const keep = startDayOf(edited) === key;
  const next: EventData = {
    ...master,
    ...edited,
    ...extras,
    recurrence: newRule,
    skipped: keep ? master.skipped.filter((k) => k >= key) : [],
    overrides: keep ? from(master.overrides, key) : {},
    doneKeys: keep ? master.doneKeys.filter((k) => k >= key) : [],
  };
  return { old: endBefore(master, key), next };
}

/** "Delete this and following". Returns null when `key` is the first occurrence (the whole series goes). */
export function endSeriesBefore(master: EventData, key: string): EventData | null {
  if (!master.recurrence || key <= seriesStart(pickFields(master))) return null;
  return endBefore(master, key);
}

export function setDone(master: EventData, key: string, done: boolean): EventData {
  const set = new Set(master.doneKeys);
  if (done) set.add(key); else set.delete(key);
  return { ...master, doneKeys: [...set].sort() };
}
