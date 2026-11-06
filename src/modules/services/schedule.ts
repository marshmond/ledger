/**
 * Pure scheduling helpers for Household Services. Nothing here reads or writes the database.
 *
 * Authority (S0 plan, section 6.6): the ARRANGEMENT owns the intended cadence; the Task is the working copy of "the next visit". Dates come
 * only from the existing `generateDates` / `normalizeRule`; there is no second recurrence engine. The Task carries two markers in its
 * carried-through unknown fields: `servicesArrangement` (the arrangement id) and `servicesOccurrence` (the cadence date this Task stands for).
 */
import { addDays as addDaysSafe, dayOfWeek } from '../../lib/dates';
import { daysBetween } from '../../lib/money';
import { generateDates, type Recurrence } from '../../core/recurrence';
import { dayLabel } from '../../core/time';
import type { TaskData, TaskRecord, TaskRepeat } from '../tasks/model';
import { cadenceText, isCadenceDate, isDate, type ArrangementRecord, type Cadence } from './model';

export const OCCURRENCE_KEY = 'servicesOccurrence';
export const ARRANGEMENT_KEY = 'servicesArrangement';

export interface Markers { occurrence: string | null; arrangement: number | null }
export function markersOf(t: { data: TaskData }): Markers {
  const d = t.data as unknown as Record<string, unknown>;
  const occ = d[OCCURRENCE_KEY];
  const arr = d[ARRANGEMENT_KEY];
  return { occurrence: isDate(occ) ? occ : null, arrangement: typeof arr === 'number' && Number.isFinite(arr) ? arr : null };
}
/** A copy of the task data with the markers set (only the ones given). */
export function withMarkers(data: TaskData, m: { occurrence?: string | null; arrangement?: number | null }): TaskData {
  const out = { ...data } as unknown as Record<string, unknown>;
  if (m.occurrence !== undefined) { if (m.occurrence === null) delete out[OCCURRENCE_KEY]; else out[OCCURRENCE_KEY] = m.occurrence; }
  if (m.arrangement !== undefined) { if (m.arrangement === null) delete out[ARRANGEMENT_KEY]; else out[ARRANGEMENT_KEY] = m.arrangement; }
  return out as unknown as TaskData;
}

/** The repeat to write on the Task for a cadence (a copy). */
export const taskRepeatOf = (c: Cadence): TaskRepeat => ({ mode: c.mode, rule: { ...c.rule, ...(c.rule.byWeekday ? { byWeekday: [...c.rule.byWeekday] } : {}) } });

/** Everything about a repeat that matters for "do these agree?", as one string. A weekly repeat with no weekday means the date's own weekday. */
export function repeatSignature(r: TaskRepeat | null, dateForDefaults: string | null): string {
  if (!r) return 'none';
  const x: Recurrence = r.rule;
  const end = x.end.type === 'until' ? `until:${x.end.date}` : x.end.type === 'count' ? `count:${x.end.count}` : 'never';
  const days = x.freq === 'weekly' ? (x.byWeekday?.length ? [...x.byWeekday].sort((a, b) => a - b) : dateForDefaults ? [dayOfWeek(dateForDefaults)] : []).join(',') : '';
  const monthly = x.freq === 'monthly' ? (x.monthly ?? 'date') : '';
  return r.mode === 'after' ? `after|${x.freq}|${x.interval}|${end}` : `fixed|${x.freq}|${x.interval}|${days}|${monthly}|${end}`;
}
/** The cadence's signature, comparable with `repeatSignature` of its Task. */
export const cadenceSignature = (c: Cadence | null) => (c ? repeatSignature(taskRepeatOf(c), c.anchorDate) : 'none');

/** Plain words for a repeat, for "the task repeats X but the arrangement says Y". */
export function repeatWords(r: TaskRepeat | null, dateForDefaults: string | null): string {
  if (!r) return 'does not repeat';
  return cadenceText({ mode: r.mode, rule: r.rule, anchorDate: dateForDefaults ?? '2000-01-03' }).replace(/^On demand.*/, 'does not repeat');
}

export type HealthState = 'ok' | 'not-applicable' | 'no-task' | 'duplicate-open' | 'rule-differs' | 'stale-marker' | 'off-cadence' | 'moved-once';
export interface Health {
  state: HealthState;
  /** True for the states that belong under "Needs attention". `off-cadence` and `moved-once` are informational. */
  needsAttention: boolean;
  /** Plain-words headline. */
  message: string;
  /** Extra plain-words lines (both rules in words, the list of tasks, ...). */
  detail: string[];
  /** The open tasks involved. */
  taskIds: number[];
  /** The owner chose to leave this as it is, and nothing about it has changed since. */
  acknowledged: boolean;
  /** What "leave as is" is remembered as. */
  ackKey: string | null;
}

const OK: Health = { state: 'ok', needsAttention: false, message: '', detail: [], taskIds: [], acknowledged: false, ackKey: null };

/** Tasks that count as this arrangement's "next visit": live, not done, linked to it. */
export const openOf = (tasks: TaskRecord[]) => tasks.filter((t) => t.data.status !== 'done');

/**
 * Read-only detector (S0 6.7). `tasks` are the live tasks linked to the arrangement (any status). States, in priority order:
 * no-task, duplicate-open, rule-differs, stale-marker, off-cadence, moved-once, ok. (stale-marker comes before moved-once on purpose: a task
 * finished in Tasks and respawned inherits the old marker and a later date, which would otherwise look like a harmless move.)
 * It never writes. A paused or ended arrangement is not checked for a missing task.
 */
export function scheduleHealth(a: ArrangementRecord, tasks: TaskRecord[]): Health {
  const open = openOf(tasks).sort((x, y) => (x.data.dueDate ?? '9999').localeCompare(y.data.dueDate ?? '9999') || x.id - y.id);
  const done = tasks.filter((t) => t.data.status === 'done');
  const c = a.data.cadence;
  const ack = new Set(a.data.acknowledged);
  const mk = (state: HealthState, needsAttention: boolean, message: string, detail: string[], taskIds: number[], ackKey: string | null): Health => ({
    state, needsAttention: needsAttention && !(ackKey && ack.has(ackKey)), message, detail, taskIds, acknowledged: !!ackKey && ack.has(ackKey), ackKey,
  });

  if (a.data.status !== 'active') {
    return open.length > 1 ? mk('duplicate-open', false, `${open.length} upcoming-visit tasks are still linked to this ${a.data.status} arrangement`, open.map(label), open.map((t) => t.id), null) : { ...OK, state: 'not-applicable' };
  }
  if (open.length === 0) {
    return c ? mk('no-task', true, 'Nothing is scheduled', ['The arrangement has a schedule but no upcoming visit task.'], [], null) : { ...OK, state: 'ok' };
  }
  if (open.length > 1) {
    const key = `dup:${open.map((t) => t.id).sort((x, y) => x - y).join(',')}`;
    return mk('duplicate-open', true, `${open.length} upcoming-visit tasks are linked to this arrangement`, open.map(label), open.map((t) => t.id), key);
  }
  const t = open[0];
  const m = markersOf(t);
  const due = t.data.dueDate;
  const taskSig = repeatSignature(t.data.repeat, due ?? m.occurrence);
  if (taskSig !== cadenceSignature(c)) {
    const key = `rule:${t.id}:${taskSig}`;
    return mk('rule-differs', true, 'The task repeats differently from the arrangement',
      [`The arrangement says: ${cadenceText(c)}.`, `The task says: ${repeatWords(t.data.repeat, due ?? m.occurrence)}.`], [t.id], key);
  }
  if (m.occurrence && done.some((x) => { const dm = markersOf(x).occurrence; return !!dm && dm >= m.occurrence!; })) {
    return mk('stale-marker', true, 'This visit task looks like a copy made when the previous visit was finished in Tasks',
      ['Its "stands for" date is not later than a visit already finished. Re-align it to the arrangement to fix the date.'], [t.id], `stale:${t.id}:${m.occurrence}`);
  }
  if (c && c.mode === 'fixed') {
    if (!due) return mk('off-cadence', false, 'The visit task has no date', ['Give it a date, or re-align it to the arrangement.'], [t.id], `off:${t.id}:none`);
    if (!m.occurrence && !isCadenceDate(c, due)) {
      return mk('off-cadence', false, 'The visit is due on a date outside the usual pattern',
        [`It is due ${dayLabel(due, { year: true })}, which is not one of the arrangement's dates.`], [t.id], `off:${t.id}:${due}`);
    }
  }
  if (m.occurrence && due && m.occurrence !== due) {
    return mk('moved-once', false, `Moved from ${dayLabel(m.occurrence, { year: true })}`, ['Only this visit moved. The usual pattern is unchanged.'], [t.id], null);
  }
  return { ...OK };
}

const label = (t: TaskRecord) => `${t.data.title}${t.data.dueDate ? `, due ${dayLabel(t.data.dueDate, { year: true })}` : ', no date'}${t.data.repeat ? ', repeats' : ''}`;

/** The cadence date nearest to `date` (earlier one wins a tie), or null. Used to stamp a one-time move. */
export function nearestCadenceDate(c: Cadence, date: string): string | null {
  if (c.mode === 'after') return date;
  const back = generateDates(c.anchorDate, c.rule, c.anchorDate > addDaysSafe(date, -400) ? c.anchorDate : addDaysSafe(date, -400), date);
  const before = back.length ? back[back.length - 1] : null;
  const ahead = generateDates(c.anchorDate, c.rule, date, addDaysSafe(date, 400))[0] ?? null;
  if (before && ahead) return daysApart(before, date) <= daysApart(date, ahead) ? before : ahead;
  return before ?? ahead;
}
const daysApart = (a: string, b: string) => Math.abs(daysBetween(a, b));
