/**
 * Maintenance on an asset page, worked out from what already exists. Pure: nothing is stored here and there is no recurrence, overdue or
 * reminder logic of its own. Plans are ordinary Tasks (Tasks owns their dates and repeats); history is service records.
 *  - Overdue = Tasks' own rule (`isOverdue`).
 *  - "Completed task, not yet saved to service history" = a done task linked to the asset that has no live service record with its id.
 */
import { describeRule, type Recurrence } from '../../core/recurrence';
import type { TaskRecord } from '../tasks/model';
import { isOverdue } from '../tasks/views';
import type { ServiceRecord } from './service';

/** The local calendar day of a time stamp ('YYYY-MM-DD'). */
export function localDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** The day a completed task was finished. A done task with no completion time (an odd or old record) falls back to its last change. */
export const completedOn = (t: TaskRecord): string => localDate(t.data.completedAt ?? t.updatedAt);

/** Completed linked tasks that no live service record points at (matched by task id). */
export function unsavedTasks(completed: TaskRecord[], services: ServiceRecord[]): TaskRecord[] {
  const saved = new Set(services.map((s) => s.data.taskId).filter((x): x is number => x !== null));
  return completed.filter((t) => t.data.status === 'done' && !saved.has(t.id));
}

export type HistoryEntry =
  | { type: 'service'; key: string; date: string; service: ServiceRecord }
  | { type: 'task'; key: string; date: string; task: TaskRecord };

/** The timeline, newest first: saved service records and, until they are saved, the completed tasks. Each task appears once. */
export function buildHistory(services: ServiceRecord[], completed: TaskRecord[]): HistoryEntry[] {
  const entries: HistoryEntry[] = [
    ...services.map<HistoryEntry>((s) => ({ type: 'service', key: `s${s.id}`, date: s.data.date, service: s })),
    ...unsavedTasks(completed, services).map<HistoryEntry>((t) => ({ type: 'task', key: `t${t.id}`, date: completedOn(t), task: t })),
  ];
  return entries.sort((a, b) => b.date.localeCompare(a.date) || (a.type === b.type ? 0 : a.type === 'service' ? -1 : 1) || b.key.localeCompare(a.key));
}

/** "Every 3 months" for a repeat counted from when you finish (a fixed day would mislead), or the usual schedule wording for a fixed repeat. */
export function repeatText(repeat: NonNullable<TaskRecord['data']['repeat']>, start: string): string {
  if (repeat.mode === 'fixed') return describeRule(repeat.rule, start);
  const n = Math.max(1, repeat.rule.interval);
  const unit = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' }[repeat.rule.freq];
  return `Every ${n === 1 ? unit : `${n} ${unit}s`}, counted from when you finish`;
}

export interface MaintenanceSummary {
  /** Most recent finished work: a saved service record (not an improvement) or an unsaved completed task. */
  lastServiced: { date: string; source: 'service' | 'task'; title: string } | null;
  /** The earliest due date among open linked tasks. */
  nextDue: { date: string; task: TaskRecord; overdue: boolean } | null;
  overdueCount: number;
  /** Completed linked tasks not yet saved to service history. */
  needsAttention: number;
}

export function summarize(open: TaskRecord[], completed: TaskRecord[], services: ServiceRecord[], today: string): MaintenanceSummary {
  const unsaved = unsavedTasks(completed, services);
  const last: NonNullable<MaintenanceSummary['lastServiced']>[] = [
    ...services.filter((s) => s.data.kind !== 'improvement').map((s) => ({ date: s.data.date, source: 'service' as const, title: s.data.title })),
    ...unsaved.map((t) => ({ date: completedOn(t), source: 'task' as const, title: t.data.title })),
  ].sort((a, b) => b.date.localeCompare(a.date) || (a.source === b.source ? 0 : a.source === 'service' ? -1 : 1));
  const dated = open.filter((t) => t.data.dueDate).sort((a, b) => (a.data.dueDate as string).localeCompare(b.data.dueDate as string) || a.id - b.id);
  const first = dated[0];
  return {
    lastServiced: last[0] ?? null,
    nextDue: first ? { date: first.data.dueDate as string, task: first, overdue: isOverdue(first, today) } : null,
    overdueCount: open.filter((t) => isOverdue(t, today)).length,
    needsAttention: unsaved.length,
  };
}

// ---- suggestions ----

export interface MaintenanceSuggestion {
  id: string;
  /** The task title (the asset's name is put in front of it by the form). */
  title: string;
  rule: Recurrence;
  mode: 'fixed' | 'after';
  /** Plain words shown next to it. */
  hint: string;
}

/**
 * Generic starting points. The intervals come from common household practice, NOT from any manual or standard, and are UNVERIFIED:
 * the form says so and every field stays editable. They are offered, never created automatically.
 */
export const MAINTENANCE_SUGGESTIONS: MaintenanceSuggestion[] = [
  { id: 'hvac-filter', title: 'Replace HVAC filter', rule: { freq: 'monthly', interval: 3, monthly: 'date', end: { type: 'never' } }, mode: 'after', hint: 'every 3 months, counted from when you do it' },
  { id: 'heating-service', title: 'Annual heating-system service', rule: { freq: 'yearly', interval: 1, end: { type: 'never' } }, mode: 'fixed', hint: 'every year' },
  { id: 'smoke-detectors', title: 'Test smoke detectors', rule: { freq: 'monthly', interval: 1, monthly: 'date', end: { type: 'never' } }, mode: 'fixed', hint: 'every month' },
  { id: 'water-heater', title: 'Flush water heater', rule: { freq: 'yearly', interval: 1, end: { type: 'never' } }, mode: 'after', hint: 'every year, counted from when you do it' },
  { id: 'roof', title: 'Inspect roof', rule: { freq: 'yearly', interval: 1, end: { type: 'never' } }, mode: 'fixed', hint: 'every year' },
  { id: 'registration', title: 'Renew vehicle registration', rule: { freq: 'yearly', interval: 1, end: { type: 'never' } }, mode: 'fixed', hint: 'every year (check your own renewal date)' },
];

export const SUGGESTION_NOTE = 'These are generic starting points, not manufacturer guidance. Check your equipment manual or any local requirement, and change the title and schedule to match.';

// ---- duplicate history for one task ----

/**
 * Groups of two or more LIVE service records that carry the same originating task id. This happens when two devices each saved the same
 * completed task while offline: both records are kept (nothing is merged or dropped), and the owner decides which to delete.
 * Only the task id counts. Records with matching titles or dates but no shared task are separate work and are never grouped.
 */
export function duplicateTaskGroups(services: ServiceRecord[]): ServiceRecord[][] {
  const by = new Map<number, ServiceRecord[]>();
  for (const s of services) if (s.data.taskId !== null) by.set(s.data.taskId, [...(by.get(s.data.taskId) ?? []), s]);
  return [...by.values()].filter((g) => g.length > 1).map((g) => [...g].sort((a, b) => a.createdAt - b.createdAt || a.id - b.id));
}

/**
 * The date given to Tasks' `completeTask` as "the day it was finished" when "Done, log it" is used.
 *  - repeat AFTER completion: the service date (the repeat is counted from when the work was really done);
 *  - fixed schedule, or no repeat: today, exactly what pressing Done in Tasks does (a late fixed task skips the missed dates).
 * The service date is never in the future (validated), so this never moves a due date forward by accident.
 */
export const completionBasis = (task: TaskRecord, serviceDate: string, today: string): string =>
  task.data.repeat?.mode === 'after' && serviceDate && serviceDate <= today ? serviceDate : today;
