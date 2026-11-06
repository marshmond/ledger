/**
 * The operational side of a project: its tasks, milestones and events. Nothing here is stored separately. A project's task is an
 * ordinary Task record with a `projectId`; a milestone is a Task with `isMilestone: true`; a project event is an ordinary Calendar
 * event with a `projectId`. This file only reads them (pure helpers, tested without a screen) and calls the Tasks and Calendar
 * command layers to change them, so completing, repeating, undoing and syncing all behave exactly as they do in those modules.
 */
import { db, type FinanceDB } from '../../db';
import type { ModuleRecord } from '../../core/entities';
import { isLive, repo } from '../../core/store';
import { addDays } from '../../lib/dates';
import { loadTasks, saveTask, createTask } from '../tasks/data';
import { blankTask, MODULE as TASKS_MODULE, type TaskRecord } from '../tasks/model';
import { isOpen, isOverdue, sortTasks } from '../tasks/views';
import { occurrencesOf } from '../calendar/occurrences';
import type { EventRecord } from '../calendar/model';
import { pathFor as eventPath } from '../calendar/records';
import { getProject } from './data';

// ---- reading (pure) ----

/** Ordinary tasks and milestones of one project. A milestone is never in `tasks`, so nothing is counted twice. */
export function workOf(all: TaskRecord[], projectId: number): { tasks: TaskRecord[]; milestones: TaskRecord[] } {
  const mine = all.filter((t) => t.data.projectId === projectId);
  return { tasks: mine.filter((t) => !t.data.isMilestone), milestones: mine.filter((t) => t.data.isMilestone) };
}

export interface Tally {
  total: number;
  done: number;
  open: number;
  overdue: number;
  /** Whole percent done, 0 when there is nothing yet. */
  percent: number;
}
export function tally(list: TaskRecord[], today: string): Tally {
  const done = list.filter((t) => !isOpen(t)).length;
  const open = list.length - done;
  return { total: list.length, done, open, overdue: list.filter((t) => isOverdue(t, today)).length, percent: list.length ? Math.round((done / list.length) * 100) : 0 };
}

export interface WorkSummary {
  tasks: Tally;
  milestones: Tally;
  /** The next open milestone by due date (undated ones last), or undefined. */
  nextMilestone?: TaskRecord;
}
export function summarizeWork(all: TaskRecord[], projectId: number, today: string): WorkSummary {
  const { tasks, milestones } = workOf(all, projectId);
  const next = sortTasks(milestones.filter(isOpen), 'due')[0];
  return { tasks: tally(tasks, today), milestones: tally(milestones, today), nextMilestone: next };
}

/** Which group of the project's task list a task is in. */
export type TaskGroup = 'overdue' | 'open' | 'done';
export function groupOf(t: TaskRecord, today: string): TaskGroup {
  return !isOpen(t) ? 'done' : isOverdue(t, today) ? 'overdue' : 'open';
}

export type ActivityKind = 'task' | 'milestone' | 'event';
export interface Activity {
  key: string;
  kind: ActivityKind;
  title: string;
  /** The date it falls on (a task's due date, or its do-on date when it has no due date). */
  date: string;
  overdue: boolean;
  /** Where to open it: a full address such as `/tasks?task=3`. */
  path: string;
}

/**
 * One list of what is coming up on a project: open tasks and milestones (past due ones first, marked overdue) and the project's
 * events in the next `days` days. A repeating event shows its next dates, not the whole series. Events already past are left out.
 */
export function upcomingActivity(all: TaskRecord[], events: EventRecord[], projectId: number, today: string, days = 30): Activity[] {
  const end = addDays(today, days);
  const out: Activity[] = [];
  for (const t of all) {
    if (t.data.projectId !== projectId || !isOpen(t)) continue;
    const date = t.data.dueDate ?? t.data.startDate;
    if (!date || date > end) continue;
    out.push({ key: `t${t.id}`, kind: t.data.isMilestone ? 'milestone' : 'task', title: t.data.title, date, overdue: isOverdue(t, today), path: `/tasks?task=${t.id}` });
  }
  for (const e of events) {
    if (e.data.projectId !== projectId) continue;
    for (const o of occurrencesOf(e, today, end)) out.push({ key: `e${e.id}:${o.key}`, kind: 'event', title: o.title || '(no title)', date: o.firstDay, overdue: false, path: eventPath(e) });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind) || a.title.localeCompare(b.title));
}

// ---- writing (through the Tasks and Calendar command layers) ----

async function requireLiveProject(projectId: number, d: FinanceDB) {
  const p = await getProject(projectId, d);
  if (!p) throw new Error('That project no longer exists.');
  return p;
}

/** Every live task of the project (ordinary and milestones). */
export async function loadProjectTasks(projectId: number, d: FinanceDB = db): Promise<TaskRecord[]> {
  return (await loadTasks(d)).filter((t) => t.data.projectId === projectId);
}

/**
 * Puts an existing task on a project, or takes it off with `null`. The task is never deleted and nothing else on it changes.
 * Taking a milestone off its project makes it an ordinary task (a milestone needs a project). A task that repeats cannot become a
 * milestone: use `makeMilestone`, which refuses it.
 */
export async function setTaskProject(taskId: number, projectId: number | null, d: FinanceDB = db): Promise<void> {
  await d.transaction('rw', d.moduleRecords, async () => {
    if (projectId !== null) await requireLiveProject(projectId, d);
    const r = await d.moduleRecords.get(taskId);
    if (!r || r.module !== TASKS_MODULE || r.kind !== 'task' || !isLive(r)) throw new Error('That task no longer exists.');
    const { projectId: _p, isMilestone: _m, ...rest } = (r.data ?? {}) as Record<string, unknown>;
    const keepMilestone = projectId !== null && _m === true;
    await repo<ModuleRecord>(d.moduleRecords).put({ id: taskId, module: TASKS_MODULE, kind: 'task', data: { ...rest, ...(projectId !== null ? { projectId } : {}), ...(keepMilestone ? { isMilestone: true } : {}) } });
  });
}

/** Turns a project task into a milestone (or back). A repeating task cannot be a milestone. */
export async function setMilestone(taskId: number, on: boolean, d: FinanceDB = db): Promise<void> {
  await d.transaction('rw', d.moduleRecords, async () => {
    const r = await d.moduleRecords.get(taskId);
    if (!r || r.module !== TASKS_MODULE || r.kind !== 'task' || !isLive(r)) throw new Error('That task no longer exists.');
    const data = (r.data ?? {}) as Record<string, unknown>;
    if (typeof data.projectId !== 'number') throw new Error('Put the task on a project first. A milestone belongs to a project.');
    if (on && data.repeat) throw new Error('A task that repeats cannot be a milestone. Turn off the repeat first.');
    const { isMilestone: _m, ...rest } = data;
    await repo<ModuleRecord>(d.moduleRecords).put({ id: taskId, module: TASKS_MODULE, kind: 'task', data: { ...rest, ...(on ? { isMilestone: true } : {}) } });
  });
}

export interface NewWork {
  title: string;
  dueDate?: string | null;
  milestone?: boolean;
}
/** Creates a task (or milestone) directly on a project, through the normal Tasks command. Returns the new task's id. */
export async function createProjectTask(projectId: number, input: NewWork, d: FinanceDB = db): Promise<number> {
  const title = input.title.trim();
  if (!title) throw new Error('Give it a title.');
  await requireLiveProject(projectId, d);
  return createTask({ ...blankTask({ title, dueDate: input.dueDate || null }), projectId, ...(input.milestone ? { isMilestone: true } : {}) }, [], d);
}

/** Saves a changed due date on a project task or milestone, through the normal Tasks save. */
export async function setTaskDue(task: TaskRecord, dueDate: string | null, d: FinanceDB = db): Promise<void> {
  await saveTask(task.id, { ...task.data, dueDate, dueTime: dueDate ? task.data.dueTime : null }, d);
}
