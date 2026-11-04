/**
 * What happens when a repeating task is completed: the next one is created. Pure; nothing is stored here.
 *  - fixed schedule: the next date comes from the repeat rule, after the later of the due date and the day you finished it
 *    (finish a weekly task two weeks late and the next one is next week, not a pile of missed ones).
 *  - repeat after completion: the next date is the day you finished plus the interval.
 */
import { addDays, addMonths } from '../../lib/dates';
import { daysBetween } from '../../lib/money';
import { generateDates, type Recurrence } from '../calendar/recurrence';
import type { TaskData } from './model';

/** The next due date, or null if the repeat has run out. `completedOn` is today's local date. */
export function nextDueDate(due: string | null, repeat: NonNullable<TaskData['repeat']>, completedOn: string): string | null {
  const r = repeat.rule;
  if (r.end.type === 'count' && r.end.count <= 1) return null;
  const n = Math.max(1, r.interval);
  let next: string | null;
  if (repeat.mode === 'after') {
    next = r.freq === 'daily' ? addDays(completedOn, n) : r.freq === 'weekly' ? addDays(completedOn, 7 * n) : r.freq === 'monthly' ? addMonths(completedOn, n) : addMonths(completedOn, 12 * n);
  } else {
    const anchor = due ?? completedOn;
    const after = completedOn > anchor ? completedOn : anchor;
    next = generateDates(anchor, { ...r, end: { type: 'never' } }, addDays(after, 1), addDays(after, 1500))[0] ?? null;
  }
  if (next && r.end.type === 'until' && next > r.end.date) return null;
  return next;
}

/** The task to create after `t` is completed on `completedOn`, or null when it does not repeat (or has finished repeating). */
export function spawnNext(t: TaskData, completedOn: string): TaskData | null {
  if (!t.repeat) return null;
  const next = nextDueDate(t.dueDate, t.repeat, completedOn);
  if (!next) return null;
  const rule: Recurrence = t.repeat.rule.end.type === 'count' ? { ...t.repeat.rule, end: { type: 'count', count: t.repeat.rule.end.count - 1 } } : t.repeat.rule;
  // Keep the same gap between "do on" and due.
  const startDate = t.startDate && t.dueDate ? addDays(next, daysBetween(t.startDate, t.dueDate)) : t.startDate ? next : null;
  return {
    ...t,
    status: 'todo',
    dueDate: next,
    startDate,
    completedAt: null,
    repeat: { mode: t.repeat.mode, rule },
    checklist: t.checklist.map((c) => ({ ...c, done: false })),
  };
}
