/**
 * Everything that changes an arrangement AND its Task together: Pause, Resume, End, Replace provider, Change schedule, and the schedule
 * fixes. Each one has a read-only PLAN (what the owner is shown first) and an APPLY that runs in ONE transaction, re-reads the live records,
 * refuses if anything changed since the plan (`Expect`), and returns what is needed for Undo. A failed write leaves everything as it was
 * (Dexie rolls the whole transaction back). Tasks are changed only through the ordinary Tasks functions.
 */
import { db, type FinanceDB } from '../../db';
import type { RecordRef } from '../../core/entities';
import { recordSource } from '../../core/registry';
import { createStore } from '../../core/store';
import { dayLabel } from '../../core/time';
import { removeTasks, restoreTasks, saveTask } from '../tasks/data';
import type { TaskData, TaskRecord } from '../tasks/model';
import {
  ensureNextVisitTaskIn, getArrangement, loadArrangements, planNextVisit, resolveProvider, rows, syncAssetLinks, tables, tasksOfArrangement, writeArrangement,
  linkedAssetIds, type ProviderInput,
} from './data';
import {
  arrangementRef, arrangementRefId, blankArrangement, normalizeArrangement, validateArrangement, cadenceText, END_REASON_LABEL, KIND, MODULE, STATUS_LABEL,
  withExplicitWeekday, type ArrangementData, type ArrangementRecord, type Cadence, type EndReason,
} from './model';
import { visitRef } from './visitModel';
import { markersOf, nearestCadenceDate, openOf, scheduleHealth, taskRepeatOf, withMarkers, type Health } from './schedule';
import { normalizeRule } from '../../core/recurrence';

// ---- stale-write guard and Undo ----

/** What the plan was based on. If any of it differs when the owner presses the button, nothing is written. */
export interface Expect { arrangementUpdatedAt: number; tasks: Record<number, number> }
export const expectOf = (a: ArrangementRecord, tasks: TaskRecord[]): Expect => ({ arrangementUpdatedAt: a.updatedAt, tasks: Object.fromEntries(openOf(tasks).map((t) => [t.id, t.updatedAt])) });
export const STALE = 'This changed (maybe on another device) since you opened it, so nothing was changed. Close this, look at the arrangement again, and choose again.';
function checkExpect(e: Expect, a: ArrangementRecord, tasks: TaskRecord[]) {
  const now = expectOf(a, tasks);
  const ids = Object.keys(e.tasks).sort().join();
  if (e.arrangementUpdatedAt !== now.arrangementUpdatedAt || ids !== Object.keys(now.tasks).sort().join() || Object.entries(e.tasks).some(([id, u]) => now.tasks[Number(id)] !== u)) throw new Error(STALE);
}

/** What to restore to take a change back. */
export interface Undo {
  arrangements: { id: number; data: ArrangementData }[];
  tasks: { id: number; data: TaskData; wasDeleted: boolean }[];
  /** Records this change created (tasks, arrangements): removed again by Undo. */
  created: number[];
  /**
   * When present (visit logging), each record this change touched with its `updatedAt` as the change left it. Undo refuses, and writes nothing,
   * if any of them is different now (edited here or on another device, or acted upon since).
   */
  after?: Record<number, number>;
}
export const UNDO_REFUSED = 'This can no longer be undone, because something it changed has been changed since (maybe on another device). Nothing was changed. Edit the records yourself if you still want to.';
export class Recorder {
  undo: Undo = { arrangements: [], tasks: [], created: [] };
  arr(a: ArrangementRecord) { if (!this.undo.arrangements.some((x) => x.id === a.id)) this.undo.arrangements.push({ id: a.id, data: structuredClone(a.data) }); }
  task(t: TaskRecord) { if (!this.undo.tasks.some((x) => x.id === t.id)) this.undo.tasks.push({ id: t.id, data: structuredClone(t.data), wasDeleted: false }); }
  made(id: number | null | undefined) { if (id != null) this.undo.created.push(id); }
  /** Call last, inside the same transaction: remembers how every touched record looks now, so a later Undo can tell if it changed. */
  async seal(d: FinanceDB): Promise<void> {
    const after: Record<number, number> = {};
    for (const id of [...this.undo.created, ...this.undo.tasks.map((t) => t.id)]) { const r = await d.moduleRecords.get(id); if (r) after[id] = r.updatedAt; }
    this.undo.after = after;
  }
}
/** Takes a change back. Records deleted since are skipped; nothing here can fail half way. */
export function applyUndo(u: Undo, d: FinanceDB = db): Promise<void> {
  return d.transaction('rw', d.moduleRecords, d.links, async () => {
    for (const [id, at] of Object.entries(u.after ?? {})) {
      const r = await d.moduleRecords.get(Number(id));
      if (!r || r.updatedAt !== at) throw new Error(UNDO_REFUSED);
    }
    const links = createStore(d).shared.links;
    for (const id of u.created) {
      const r = await d.moduleRecords.get(id);
      if (!r) continue;
      await rows(d).remove(id);
      if (r.module === MODULE) {
        for (const l of await links.linkedTo(arrangementRef(id))) await links.remove(l.id as number);
        for (const l of await links.linkedTo(visitRef(id))) await links.remove(l.id as number);
      }
    }
    for (const t of u.tasks) {
      const r = await d.moduleRecords.get(t.id);
      if (!r) continue;
      if (r.deletedAt != null && !t.wasDeleted) await restoreTasks([t.id], d);
      await saveTask(t.id, t.data, d);
    }
    for (const a of u.arrangements) if (await d.moduleRecords.get(a.id)) await rows(d).put({ id: a.id, module: MODULE, kind: KIND, data: { ...a.data } });
  });
}

// ---- Task handling choices ----

export type TaskChoice = 'remove' | 'keep' | 'stop';
export const TASK_CHOICE_LABEL: Record<TaskChoice, string> = { remove: 'Remove it (you can undo)', stop: 'Keep this one visit, stop it repeating', keep: 'Keep it exactly as it is' };
export interface PlanTask { id: number; title: string; dueDate: string | null; repeats: boolean; /** other records this task is linked to: deleting it affects them too */ sharedWith: string[] }

async function sharedLabels(t: TaskRecord, arrId: number, d: FinanceDB): Promise<string[]> {
  const out: string[] = [];
  for (const l of await createStore(d).shared.links.linkedTo({ module: 'tasks', id: t.id })) {
    const other: RecordRef = l.fromModule === 'tasks' && Number(l.fromId) === t.id ? { module: l.toModule, id: l.toId } : { module: l.fromModule, id: l.fromId };
    if (other.module === MODULE && other.id === arrangementRefId(arrId)) continue;
    const info = await recordSource(other.module)?.describe(other.id).catch(() => null);
    const label = info ? info.label : recordSource(other.module) ? '' : `a ${other.module} record`;
    if (label && !out.includes(label)) out.push(label);
  }
  if (typeof t.data.projectId === 'number') out.push('a Project');
  return out;
}
async function planTasks(tasks: TaskRecord[], arrId: number, d: FinanceDB): Promise<PlanTask[]> {
  return Promise.all(openOf(tasks).map(async (t) => ({ id: t.id, title: t.data.title, dueDate: t.data.dueDate, repeats: !!t.data.repeat, sharedWith: await sharedLabels(t, arrId, d) })));
}
const dl = (s: string | null) => (s ? dayLabel(s, { weekday: 'short', year: true }) : 'no date');

// ---- Pause, Resume, End, Replace ----

export type LifecycleAction = 'pause' | 'resume' | 'end' | 'replace';
export interface LifecyclePlan {
  arrangement: ArrangementRecord;
  action: LifecycleAction;
  tasks: PlanTask[];
  expect: Expect;
  /** Why this cannot be done right now, in plain words, or null. */
  problem: string | null;
  defaultChoice: TaskChoice;
  /** Resume: a kept task exists whose repeat differs from the schedule. */
  reusedDiffers: boolean;
  /** Where Resume would put the new visit (when no task exists). */
  resumeDate: string | null;
}

async function successorOf(id: number, d: FinanceDB): Promise<ArrangementRecord | undefined> {
  return (await loadArrangements(d)).find((x) => x.data.predecessorId === id);
}
function statusProblem(a: ArrangementRecord, action: LifecycleAction): string | null {
  const s = a.data.status;
  if (action === 'pause' && s !== 'active') return `It is already ${STATUS_LABEL[s].toLowerCase()}.`;
  if (action === 'resume' && s !== 'paused') return s === 'active' ? 'It is already active.' : 'An ended arrangement cannot be resumed. Add a new one instead.';
  if ((action === 'end' || action === 'replace') && s === 'ended') return 'It has already ended.';
  return null;
}

/** Read-only. What Pause / Resume / End / Replace would involve for this arrangement right now. */
export async function planLifecycle(arrangementId: number, action: LifecycleAction, today: string, d: FinanceDB = db): Promise<LifecyclePlan> {
  const a = await getArrangement(arrangementId, d);
  if (!a) throw new Error('That arrangement no longer exists.');
  const tasks = await tasksOfArrangement(arrangementId, d);
  let problem = statusProblem(a, action);
  if (!problem && action === 'replace') {
    const succ = await successorOf(arrangementId, d);
    if (succ) problem = `It was already replaced by "${succ.data.title}" (maybe a moment ago or on another device), so no second replacement is made.`;
  }
  const open = openOf(tasks);
  const reusedDiffers = action === 'resume' && open.length > 0 && scheduleHealth({ ...a, data: { ...a.data, status: 'active' } }, [open[0]]).state === 'rule-differs';
  return {
    arrangement: a, action, tasks: await planTasks(tasks, arrangementId, d), expect: expectOf(a, tasks), problem,
    defaultChoice: action === 'replace' ? 'stop' : 'remove', reusedDiffers,
    resumeDate: action === 'resume' && open.length === 0 ? planNextVisit(a.data, tasks, { today }).due : null,
  };
}

export interface LifecycleRequest {
  action: LifecycleAction;
  arrangementId: number;
  expect: Expect;
  today: string;
  /** Pause / End / Replace: what to do with the open visit task(s). Default: remove (replace: stop repeating). */
  taskChoice?: TaskChoice;
  /** Resume: when a kept task is reused and repeats differently, make it follow the schedule. */
  alignReused?: boolean;
  endReason?: EndReason;
  endDate?: string;
  replace?: { provider: ProviderInput; /** the first visit's date; default: the next date in the schedule */ firstDate?: string | null; copyNotes?: boolean };
}
export interface LifecycleResult { arrangementId: number; successorId: number | null; taskId: number | null; removed: number; stopped: number; undo: Undo; contactCreated: boolean }

/** Pause / Resume / End / Replace provider: ONE transaction, all or nothing. Throws (changing nothing) if anything changed since the plan. */
export function applyLifecycle(req: LifecycleRequest, d: FinanceDB = db): Promise<LifecycleResult> {
  return d.transaction('rw', ...tables(d), async () => {
    const a = await getArrangement(req.arrangementId, d);
    if (!a) throw new Error('That arrangement no longer exists. Nothing was changed.');
    const tasks = await tasksOfArrangement(req.arrangementId, d);
    checkExpect(req.expect, a, tasks);
    const bad = statusProblem(a, req.action);
    if (bad) throw new Error(`${bad} Nothing was changed.`);
    const rec = new Recorder();
    const choice: TaskChoice = req.taskChoice ?? (req.action === 'replace' ? 'stop' : 'remove');
    const today = req.today;
    let removed = 0, stopped = 0, successorId: number | null = null, taskId: number | null = null, contactCreated = false;

    const handleOpenTasks = async () => {
      for (const t of openOf(tasks)) {
        if (choice === 'remove') { rec.task(t); await removeTasks([t.id], d); removed++; }
        else if (choice === 'stop' && t.data.repeat) { rec.task(t); await saveTask(t.id, { ...t.data, repeat: null }, d); stopped++; }
      }
    };
    const endData = (reason: EndReason, endDate: string): ArrangementData => ({
      ...a.data, status: 'ended', endReason: reason, endDate, openTaskId: choice === 'remove' ? null : a.data.openTaskId, acknowledged: [],
    });

    if (req.action === 'pause') {
      rec.arr(a);
      await handleOpenTasks();
      await writeArrangement(a.id, { ...a.data, status: 'paused', openTaskId: choice === 'remove' ? null : a.data.openTaskId, acknowledged: [] }, d);
    } else if (req.action === 'end') {
      rec.arr(a);
      await handleOpenTasks();
      await writeArrangement(a.id, endData(req.endReason ?? 'cancelled', req.endDate ?? today), d);
    } else if (req.action === 'resume') {
      rec.arr(a);
      await writeArrangement(a.id, { ...a.data, status: 'active', endReason: null, acknowledged: [] }, d);
      const before = openOf(tasks);
      const r = await ensureNextVisitTaskIn(a.id, { today }, d);
      taskId = r.taskId;
      if (r.kind === 'created') rec.made(r.taskId);
      if (r.kind === 'reused' && req.alignReused && a.data.cadence && before[0]) {
        const t = before[0];
        rec.task(t);
        await saveTask(t.id, withMarkers({ ...t.data, repeat: taskRepeatOf(a.data.cadence) }, { arrangement: a.id }), d);
      }
    } else {
      if (!req.replace) throw new Error('Choose the new provider. Nothing was changed.');
      if (await successorOf(a.id, d)) throw new Error('This was already replaced (maybe a moment ago or on another device), so no second replacement was made. Nothing was changed.');
      const provider = await resolveProvider(req.replace.provider, d);
      if (provider.id === a.data.providerContactId) throw new Error('That is the same provider. To change who does this, pick a different one. Nothing was changed.');
      contactCreated = provider.created;
      const endDate = req.endDate ?? today;
      if (a.data.startDate && endDate < a.data.startDate) throw new Error('The end date is before this arrangement started. Nothing was changed.');
      rec.arr(a);
      await handleOpenTasks();
      await writeArrangement(a.id, endData('replaced', endDate), d);
      // The successor inherits the schedule, the cost estimate and the title. NOT inherited: notes (unless ticked), document links and the
      // extra contacts, because those can hold private details that belong to the old provider.
      successorId = await writeArrangement(undefined, blankArrangement({
        title: a.data.title, providerContactId: provider.id, providerNameSnapshot: provider.name, status: 'active', startDate: today,
        cadence: a.data.cadence, visitTime: a.data.visitTime, expected: a.data.expected, notes: req.replace.copyNotes ? a.data.notes : '', predecessorId: a.id,
      }), d);
      rec.made(successorId);
      await syncAssetLinks(successorId, await linkedAssetIds(a.id, d), d);
      const r = await ensureNextVisitTaskIn(successorId, { today, date: req.replace.firstDate ?? null }, d);
      taskId = r.taskId;
      if (r.kind === 'created') rec.made(r.taskId);
    }
    return { arrangementId: a.id, successorId, taskId, removed, stopped, undo: rec.undo, contactCreated };
  });
}

/** The plain-words preview shown before the owner confirms. Pure. */
export function describeLifecycle(plan: LifecyclePlan, req: Pick<LifecycleRequest, 'taskChoice' | 'alignReused' | 'endDate' | 'endReason'> & { providerName?: string; copyNotes?: boolean }): string[] {
  const a = plan.arrangement.data;
  const choice = req.taskChoice ?? plan.defaultChoice;
  const out: string[] = [];
  const taskLines = () => {
    for (const t of plan.tasks) {
      const what = `"${t.title}" (${dl(t.dueDate)}${t.repeats ? ', repeats' : ''})`;
      if (choice === 'remove') {
        out.push(`The visit task ${what} will be removed. You can undo this.`);
        if (t.sharedWith.length) out.push(`WARNING: that task is also linked to ${t.sharedWith.join(', ')}. Removing it removes it for all of them, not only for this arrangement. Choose "Keep" instead if the others still need it.`);
      } else if (choice === 'stop') out.push(t.repeats ? `The visit task ${what} stays as a single visit and stops repeating.` : `The visit task ${what} stays as it is.`);
      else out.push(`The visit task ${what} stays exactly as it is.`);
    }
    if (!plan.tasks.length) out.push('There is no upcoming visit task to deal with.');
  };
  if (plan.action === 'pause') {
    out.push(`"${a.title}" will be paused. Its schedule (${cadenceText(a.cadence)}) is kept for when you resume.`);
    taskLines();
  } else if (plan.action === 'end') {
    out.push(`"${a.title}" will end${req.endReason ? ` (${END_REASON_LABEL[req.endReason].toLowerCase()})` : ''}${req.endDate ? ` on ${dl(req.endDate)}` : ''}. Its history stays.`);
    taskLines();
  } else if (plan.action === 'resume') {
    out.push(`"${a.title}" will be active again.`);
    if (plan.tasks.length) {
      out.push(`The existing visit task "${plan.tasks[0].title}" (${dl(plan.tasks[0].dueDate)}) will be reused. No new task is made.`);
      if (plan.reusedDiffers) out.push(req.alignReused ? `It will be set to repeat ${cadenceText(a.cadence)}.` : 'It repeats differently from the schedule. It will not be changed unless you tick the box.');
    } else out.push(plan.resumeDate ? `A new visit task will be made for ${dl(plan.resumeDate)} (no catching up on missed visits).` : 'No visit task will be made (no schedule or date).');
  } else {
    out.push(`"${a.title}" with ${a.providerNameSnapshot || 'its current provider'} will end (replaced). It keeps its original provider and its history.`);
    out.push(`A new arrangement "${a.title}" with ${req.providerName || 'the new provider'} will start. It copies the schedule (${cadenceText(a.cadence)}), the cost estimate, the title and the linked assets.${req.copyNotes ? ' Your notes will be copied too.' : ' Notes, document links and other contacts are not copied.'}`);
    taskLines();
    out.push('The new arrangement gets its own visit task.');
  }
  return out;
}

// ---- Change schedule ----

export type CurrentVisit = 'move' | 'keep';
export interface SchedulePlan {
  arrangement: ArrangementRecord;
  tasks: PlanTask[];
  expect: Expect;
  problem: string | null;
  /** Where "move" would put the current visit (null when there is none or the new schedule has ended). */
  moveTo: string | null;
  keepDate: string | null;
  lines: string[];
}

/** Read-only preview of changing the standing schedule (or its time). `cadence` null = no regular schedule. */
export async function planScheduleChange(arrangementId: number, cadence: Cadence | null, visitTime: string | null, today: string, d: FinanceDB = db): Promise<SchedulePlan> {
  const a = await getArrangement(arrangementId, d);
  if (!a) throw new Error('That arrangement no longer exists.');
  const tasks = await tasksOfArrangement(arrangementId, d);
  const open = openOf(tasks);
  const next = cadence ? { ...a.data, cadence } : a.data;
  const problem = open.length > 1 ? 'There is more than one upcoming-visit task. Sort that out first (the arrangement page shows how).' : cadence ? (await dryValidate({ ...a.data, cadence, visitTime })) : null;
  const moveTo = cadence && !problem ? planNextVisit({ ...next, status: 'active' }, tasks, { today }).due : null;
  const keepDate = open[0]?.data.dueDate ?? null;
  const lines: string[] = [`Future visits will follow this pattern: ${cadenceText(cadence)}${visitTime ? ` at ${visitTime}` : ''}.`];
  if (a.data.status === 'active' && open[0]) {
    if (cadence) lines.push(`Move the current visit: it changes from ${dl(keepDate)} to ${dl(moveTo)}.`, `Keep the current visit: it stays on ${dl(keepDate)}; the new pattern starts from the visit after it.`);
    else lines.push(`The current visit (${dl(keepDate)}) stays as a single visit and stops repeating.`);
  } else if (a.data.status === 'active' && cadence) lines.push(`There is no upcoming visit, so one will be made for ${dl(moveTo)}.`);
  else if (a.data.status !== 'active') lines.push(`The arrangement is ${a.data.status}. The new pattern is saved and used when you resume.`);
  return { arrangement: a, tasks: await planTasks(tasks, arrangementId, d), expect: expectOf(a, tasks), problem, moveTo, keepDate, lines };
}
function dryValidate(data: ArrangementData): string | null {
  // Reuses the strict save-time check without writing.
  return validateOnly(data);
}
const validateOnly = (data: ArrangementData) => validateArrangement(normalizeArrangement(data));

export interface ScheduleChangeRequest { arrangementId: number; expect: Expect; today: string; cadence: Cadence | null; visitTime: string | null; currentVisit: CurrentVisit }

/** Changes the standing schedule and the one open Task together, in one transaction. */
export function applyScheduleChange(req: ScheduleChangeRequest, d: FinanceDB = db): Promise<{ undo: Undo; taskId: number | null }> {
  return d.transaction('rw', ...tables(d), async () => {
    const a = await getArrangement(req.arrangementId, d);
    if (!a) throw new Error('That arrangement no longer exists. Nothing was changed.');
    const tasks = await tasksOfArrangement(req.arrangementId, d);
    checkExpect(req.expect, a, tasks);
    const open = openOf(tasks);
    if (open.length > 1) throw new Error('There is more than one upcoming-visit task. Sort that out first. Nothing was changed.');
    const cadence = req.cadence ? { ...req.cadence, rule: withExplicitWeekday(normalizeRule(req.cadence.rule) ?? req.cadence.rule, req.cadence.anchorDate) } : null;
    const rec = new Recorder();
    rec.arr(a);
    const nextData: ArrangementData = { ...a.data, cadence, visitTime: req.visitTime, acknowledged: [] };
    await writeArrangement(a.id, nextData, d);
    let taskId: number | null = open[0]?.id ?? null;
    if (a.data.status === 'active') {
      if (open[0]) {
        const t = open[0];
        rec.task(t);
        if (!cadence) await saveTask(t.id, { ...t.data, repeat: null }, d);
        else if (req.currentVisit === 'move') {
          const due = planNextVisit(nextData, tasks, { today: req.today }).due;
          if (!due) throw new Error('The new schedule has already ended, so the current visit cannot move to it. Nothing was changed.');
          await saveTask(t.id, withMarkers({ ...t.data, dueDate: due, dueTime: req.visitTime && due ? req.visitTime : null, repeat: taskRepeatOf(cadence) }, { arrangement: a.id, occurrence: due }), d);
        } else {
          const m = markersOf(t);
          await saveTask(t.id, withMarkers({ ...t.data, repeat: taskRepeatOf(cadence) }, { arrangement: a.id, occurrence: m.occurrence ?? t.data.dueDate }), d);
        }
      } else if (cadence) {
        const r = await ensureNextVisitTaskIn(a.id, { today: req.today }, d);
        taskId = r.taskId;
        if (r.kind === 'created') rec.made(r.taskId);
      }
    }
    return { undo: rec.undo, taskId };
  });
}

// ---- Fixing schedule drift (never automatic) ----

export type RepairKind = 'schedule-next' | 'keep-one' | 'task-follows' | 'arrangement-follows' | 'one-time-move' | 'realign' | 'leave';
export const REPAIR_LABEL: Record<RepairKind, string> = {
  'schedule-next': 'Schedule the next visit', 'keep-one': 'Keep this one, remove the others', 'task-follows': 'Make the task follow the arrangement',
  'arrangement-follows': 'Make the arrangement follow the task', 'one-time-move': 'Treat it as a one-time move', realign: 'Re-align it to the arrangement', leave: 'Leave it as it is',
};

interface Effect { lines: string[]; problem: string | null; taskChanges: { task: TaskRecord; data: TaskData }[]; removeIds: number[]; arrangement: ArrangementData | null; create: boolean }
const NO: Effect = { lines: [], problem: null, taskChanges: [], removeIds: [], arrangement: null, create: false };

/** What a fix would do, worked out from live records. Used for BOTH the preview and the write, so they cannot disagree. Pure. */
export function repairEffect(kind: RepairKind, a: ArrangementRecord, tasks: TaskRecord[], taskId: number | null, today: string): Effect {
  const open = openOf(tasks);
  const c = a.data.cadence;
  const t = taskId !== null ? open.find((x) => x.id === taskId) : open.length === 1 ? open[0] : undefined;
  const fail = (problem: string): Effect => ({ ...NO, problem });
  const needTask = () => (t ? null : 'That visit task is no longer there.');
  switch (kind) {
    case 'schedule-next': {
      if (open.length) return fail('A visit task already exists.');
      if (a.data.status !== 'active') return fail(`The arrangement is ${a.data.status}.`);
      const p = planNextVisit(a.data, tasks, { today });
      return p.due ? { ...NO, create: true, lines: [`A new visit task will be made for ${dl(p.due)}, repeating ${cadenceText(c)}.`] } : fail(p.reason ?? 'There is nothing to schedule.');
    }
    case 'keep-one': {
      if (!t) return fail('Pick the task to keep.');
      const others = open.filter((x) => x.id !== t.id);
      if (!others.length) return fail('There are no other tasks to remove.');
      return { ...NO, removeIds: others.map((x) => x.id), lines: [`Keep "${t.data.title}" (${dl(t.data.dueDate)}).`, ...others.map((x) => `Remove "${x.data.title}" (${dl(x.data.dueDate)}). You can undo this.`)] };
    }
    case 'task-follows': {
      const p = needTask(); if (p) return fail(p);
      return { ...NO, taskChanges: [{ task: t!, data: withMarkers({ ...t!.data, repeat: c ? taskRepeatOf(c) : null }, { arrangement: a.id }) }], lines: [c ? `The task will repeat ${cadenceText(c)}. Its date stays ${dl(t!.data.dueDate)}.` : `The task will stop repeating. Its date stays ${dl(t!.data.dueDate)}.`] };
    }
    case 'arrangement-follows': {
      const p = needTask(); if (p) return fail(p);
      const r = t!.data.repeat;
      if (!r) return { ...NO, arrangement: { ...a.data, cadence: null, acknowledged: [] }, lines: ['The arrangement will have no regular schedule (the task does not repeat).'] };
      if (!t!.data.dueDate) return fail('The task has no date, so a schedule cannot be taken from it.');
      if (r.rule.end.type === 'count') return fail('The task repeats a set number of times. Use an end date instead, then try again.');
      const next: Cadence = { mode: r.mode, rule: withExplicitWeekday(r.rule, t!.data.dueDate), anchorDate: t!.data.dueDate };
      return { ...NO, arrangement: { ...a.data, cadence: next, visitTime: t!.data.dueTime, acknowledged: [] }, taskChanges: [{ task: t!, data: withMarkers(t!.data, { arrangement: a.id, occurrence: t!.data.dueDate }) }],
        lines: [`The arrangement will follow the task: ${cadenceText(next)}, starting ${dl(next.anchorDate)}.`] };
    }
    case 'one-time-move': {
      const p = needTask(); if (p) return fail(p);
      if (!c || c.mode !== 'fixed' || !t!.data.dueDate) return fail('This only applies to a fixed schedule and a dated task.');
      const near = nearestCadenceDate(c, t!.data.dueDate);
      if (!near) return fail('No date in the schedule is near this one.');
      return { ...NO, taskChanges: [{ task: t!, data: withMarkers(t!.data, { arrangement: a.id, occurrence: near }) }], lines: [`The visit will be recorded as a one-time move from ${dl(near)} to ${dl(t!.data.dueDate)}. The usual pattern does not change.`] };
    }
    case 'realign': {
      const p = needTask(); if (p) return fail(p);
      if (!c) return fail('The arrangement has no regular schedule to align to.');
      const plan = planNextVisit(a.data, tasks, { today });
      if (!plan.due) return fail(plan.reason ?? 'The schedule has ended.');
      return { ...NO, taskChanges: [{ task: t!, data: withMarkers({ ...t!.data, dueDate: plan.due, dueTime: a.data.visitTime ?? t!.data.dueTime, repeat: taskRepeatOf(c) }, { arrangement: a.id, occurrence: plan.due }) }],
        lines: [`The task moves from ${dl(t!.data.dueDate)} to ${dl(plan.due)} and repeats ${cadenceText(c)}.`] };
    }
    case 'leave': {
      const h = scheduleHealth(a, tasks);
      if (!h.ackKey) return fail('There is nothing to leave as it is.');
      return { ...NO, arrangement: { ...a.data, acknowledged: [...new Set([...a.data.acknowledged, h.ackKey])] }, lines: ['The notice will be hidden until something about it changes. Nothing else changes.'] };
    }
  }
}

export interface RepairPlan { effect: Effect; expect: Expect; health: Health }
export async function planRepair(kind: RepairKind, arrangementId: number, taskId: number | null, today: string, d: FinanceDB = db): Promise<RepairPlan> {
  const a = await getArrangement(arrangementId, d);
  if (!a) throw new Error('That arrangement no longer exists.');
  const tasks = await tasksOfArrangement(arrangementId, d);
  return { effect: repairEffect(kind, a, tasks, taskId, today), expect: expectOf(a, tasks), health: scheduleHealth(a, tasks) };
}
export interface RepairRequest { kind: RepairKind; arrangementId: number; taskId: number | null; expect: Expect; today: string }

/** Applies one fix: ONE transaction, re-reads, refuses on stale data, and writes exactly what the preview said. */
export function applyRepair(req: RepairRequest, d: FinanceDB = db): Promise<{ undo: Undo; lines: string[] }> {
  return d.transaction('rw', ...tables(d), async () => {
    const a = await getArrangement(req.arrangementId, d);
    if (!a) throw new Error('That arrangement no longer exists. Nothing was changed.');
    const tasks = await tasksOfArrangement(req.arrangementId, d);
    checkExpect(req.expect, a, tasks);
    const e = repairEffect(req.kind, a, tasks, req.taskId, req.today);
    if (e.problem) throw new Error(`${e.problem} Nothing was changed.`);
    const rec = new Recorder();
    if (e.arrangement || e.create) rec.arr(a);
    if (e.arrangement) await writeArrangement(a.id, e.arrangement, d);
    for (const ch of e.taskChanges) { rec.task(ch.task); await saveTask(ch.task.id, ch.data, d); }
    for (const id of e.removeIds) { const t = tasks.find((x) => x.id === id); if (t) rec.task(t); }
    if (e.removeIds.length) await removeTasks(e.removeIds, d);
    if (e.create) { const r = await ensureNextVisitTaskIn(a.id, { today: req.today }, d); if (r.kind === 'created') rec.made(r.taskId); }
    return { undo: rec.undo, lines: e.lines };
  });
}

