/**
 * Ordinary TASKS made by Bills & Subscriptions (B2). They are normal Task records written only through the existing Tasks API (`createTask`,
 * `saveTask`, `completeTask`), carrying markers in the Task's carried-through unknown fields (the Tasks editor already preserves them, the same
 * recipe Household Services uses):
 *   billsObligation  the bill's id          billsPurpose  'pay' | 'notice' | 'trial'
 *   billsCycle       the period's slot (pay Tasks only), never a date, so a moved due date does not change which period the Task stands for
 *   billsDue         the due date the Task's own date was worked out from (pay Tasks)
 *   billsDeadline    the contract date the Task is about (notice and trial Tasks)
 *   billsDoOn        the "do it on" date Bills gave the Task: while the Task still has that date nobody has moved it, so it may follow a corrected due date
 * plus a shared link `task -> obligation:<id>` ('about').
 *
 * RULES (tested):
 *  - A Task exists only when the owner turned reminders on for the bill (a bill with no reminders setting gets none), only for a bill that is
 *    active, and never for a loan-related bill. Autopay bills get a pay Task only if the owner asked for one.
 *  - At most ONE open pay Task per bill: it stands for the earliest still-open period (looking back 30 days, so an old unrecorded month never
 *    becomes a pile of reminders). Nothing is created for future periods, and none is created twice: creation re-reads the live Tasks inside the
 *    transaction.
 *  - The Task's date ("do it on") is a REMINDER date, usually a few days before the DUE date. Both dates are kept and shown; neither replaces the other.
 *  - Finishing a Task is NOT payment. A pay Task that is done while its period has no payment, declaration or skip is reported as "Finished, not yet
 *    confirmed" until the owner says what happened ("Done, mark paid" in Bills does both in one step).
 *  - Duplicates and stale Tasks (for a period already dealt with, or an earlier deadline date) are reported and never deleted. An open Task that this
 *    module made and nobody touched follows a corrected due date; one the owner moved is left alone.
 *  - A PAUSED or ENDED bill never gets a new Task. An open Task that this module made, that nobody has touched in any way, and that stands for a
 *    period or deadline the bill no longer expects, is REMOVED (a soft delete through the Tasks API: it can be restored, and the action has a guarded
 *    Undo). A Task the owner touched (moved, renamed, started, annotated, put on a list ...) is NEVER removed: it stays open and is reported for a look.
 *    A finished Task is history and is never touched. A period that holds recorded information (a bill, a payment note) keeps its reminder.
 */
import { db, type FinanceDB } from '../../db';
import { isLive } from '../../core/store';
import { addDays } from '../../lib/dates';
import { completeTask, createTask, loadTasks, removeTasks, saveTask } from '../tasks/data';
import { blankTask, type TaskData, type TaskRecord } from '../tasks/model';
import { CYCLE_KIND, readCycle, type CycleRecord } from './cycleModel';
import { asObligation, isLoanExcluded, KIND, MODULE, obligationRef, type ObligationRecord } from './model';
import { periodsOf, type Period } from './periods';
import { deadlinesOf, isActionDeadline, DEADLINE_SHORT, readTerms, type DeadlineKind } from './terms';
import type { Recorder } from './undo';

export const OB_KEY = 'billsObligation';
export const CYCLE_KEY = 'billsCycle';
export const PURPOSE_KEY = 'billsPurpose';
export const DUE_KEY = 'billsDue';
export const DEADLINE_KEY = 'billsDeadline';
export const DOON_KEY = 'billsDoOn';
export const TASK_LINK = 'about';
export const PAY_LOOKBACK_DAYS = 30;
export const PAY_LOOKAHEAD_DAYS = 400;

export type TaskPurpose = 'pay' | 'notice' | 'trial';
export interface BillMarkers { obligation: number; purpose: TaskPurpose; cycle: string | null; due: string | null; deadline: string | null; doOn: string | null }

const dateText = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

/** The Bills markers of a Task, or null when it is not a Bills Task. */
export function markersOf(t: { data: TaskData }): BillMarkers | null {
  const d = t.data as unknown as Record<string, unknown>;
  const ob = d[OB_KEY];
  const purpose = d[PURPOSE_KEY];
  if (typeof ob !== 'number' || !Number.isFinite(ob) || (purpose !== 'pay' && purpose !== 'notice' && purpose !== 'trial')) return null;
  return { obligation: ob, purpose, cycle: typeof d[CYCLE_KEY] === 'string' ? (d[CYCLE_KEY] as string) : null, due: dateText(d[DUE_KEY]), deadline: dateText(d[DEADLINE_KEY]), doOn: dateText(d[DOON_KEY]) };
}
export function withMarkers(data: TaskData, m: { obligation: number; purpose: TaskPurpose; cycle?: string | null; due?: string | null; deadline?: string | null; doOn?: string | null }): TaskData {
  const out = { ...data } as unknown as Record<string, unknown>;
  out[OB_KEY] = m.obligation; out[PURPOSE_KEY] = m.purpose;
  for (const [k, v] of [[CYCLE_KEY, m.cycle], [DUE_KEY, m.due], [DEADLINE_KEY, m.deadline], [DOON_KEY, m.doOn]] as const) { if (v) out[k] = v; else delete out[k]; }
  return out as unknown as TaskData;
}

export interface EffectiveReminders { payTask: boolean; leadDays: number; deadlineTasks: boolean }
/** The bill's reminder settings with the defaults: nothing unless the owner turned it on; a 3-day lead; deadline Tasks on once a date is set. */
export const effectiveReminders = (ob: ObligationRecord['data']): EffectiveReminders => ({ payTask: ob.reminders?.payTask === true, leadDays: ob.reminders?.leadDays ?? 3, deadlineTasks: !ob.noDeadlineTasks });

/** The date a Task for `due` is for: `leadDays` before it, but never before today. */
export const doOnDate = (due: string, leadDays: number, today: string) => { const d = addDays(due, -leadDays); return d < today ? today : d; };

/** What "leave as is" on a finished-but-unconfirmed pay Task is remembered as (it changes if the Task changes). */
export const taskAckKey = (t: TaskRecord) => `bt|${t.id}.${t.updatedAt}`;

export const payTaskTitle = (title: string) => `Pay ${title}`;
export const deadlineTaskTitle = (kind: DeadlineKind, title: string) => (kind === 'notice' ? `Cancel or give notice by the deadline: ${title}` : `${DEADLINE_SHORT[kind]}: ${title}`);
const payNotes = (due: string | null) => `From Bills & Subscriptions.${due ? ` The bill is due ${due}.` : ''} Finishing this Task does not record a payment. Open the bill and choose "Done, mark paid".`;
const deadlineNotes = (kind: DeadlineKind, date: string) => `From Bills & Subscriptions. ${kind === 'notice' ? 'The last day to cancel or give notice' : 'The trial ends'} on ${date}. Ledger does not cancel or change anything.`;

// ---- the plan (pure) ----

export interface TaskWant { purpose: TaskPurpose; cycle: string | null; due: string | null; deadline: string | null; doOn: string; title: string; notes: string }
export interface TaskPlan {
  create: TaskWant[];
  /** Open Tasks this module made and nobody changed, whose due date was corrected: they follow it. */
  reschedule: { taskId: number; doOn: string; due: string | null; deadline: string | null }[];
  reused: number[];
  /** Groups of open Tasks for the same bill, purpose and period. Never touched. */
  duplicates: number[][];
  /** Open Tasks that stand for a period already dealt with, an earlier deadline date, or a period an inactive bill no longer expects (and that the owner changed). Never touched. */
  stale: number[];
  /** Paused or ended bill: untouched Bills-made Tasks for a period or deadline that is no longer expected. Removed (soft delete). */
  retire: number[];
}
const open = (t: TaskRecord) => t.data.status !== 'done';

/**
 * What Tasks this bill needs now. Pure. `periods` are the bill's periods around today (see `PAY_LOOKBACK_DAYS`); `tasks` are its live Bills Tasks.
 */
export function planBillTasks(ob: ObligationRecord, periods: Period[], tasks: TaskRecord[], today: string): TaskPlan {
  const plan: TaskPlan = { create: [], reschedule: [], reused: [], duplicates: [], stale: [], retire: [] };
  const d = ob.data;
  if (isLoanExcluded(d) || d.status === 'unsupported') return plan;
  const rem = effectiveReminders(d);
  const mine = tasks.filter((t) => markersOf(t)?.obligation === ob.id && open(t));

  if (d.status !== 'active') {
    // never creates anything for an inactive bill; decides only which open Tasks are no longer wanted
    const wanted = new Set(periods.filter((p) => p.open && (p.expected || p.records.length > 0)).map((p) => p.slot));
    for (const t of mine) {
      const m = markersOf(t)!;
      const keep = m.purpose === 'pay' ? m.cycle !== null && wanted.has(m.cycle) : d.status === 'paused' && m.deadline !== null && m.deadline >= today;
      if (keep) { plan.reused.push(t.id); continue; }
      (untouched(t, d, m) ? plan.retire : plan.stale).push(t.id);
    }
    return plan;
  }

  if (rem.payTask) {
    const target = periods.filter((p) => p.open && p.timing.date !== null && p.timing.date >= addDays(today, -PAY_LOOKBACK_DAYS)).sort((a, b) => a.timing.date!.localeCompare(b.timing.date!) || a.slot.localeCompare(b.slot))[0];
    const pay = mine.filter((t) => markersOf(t)!.purpose === 'pay');
    if (target) {
      const here = pay.filter((t) => markersOf(t)!.cycle === target.slot);
      if (here.length > 0) {
        plan.reused.push(here[0].id);
        if (here.length > 1) plan.duplicates.push(here.map((t) => t.id));
        const m = markersOf(here[0])!;
        const due = target.timing.date!;
        if (m.due !== due && m.doOn !== null && here[0].data.dueDate === m.doOn) plan.reschedule.push({ taskId: here[0].id, doOn: doOnDate(due, rem.leadDays, today), due, deadline: null });
      } else plan.create.push({ purpose: 'pay', cycle: target.slot, due: target.timing.date, deadline: null, doOn: doOnDate(target.timing.date!, rem.leadDays, today), title: payTaskTitle(d.title), notes: payNotes(target.timing.date) });
      for (const t of pay) if (markersOf(t)!.cycle !== target.slot) plan.stale.push(t.id);
    } else for (const t of pay) plan.stale.push(t.id);
  }

  if (rem.deadlineTasks) {
    const terms = readTerms(d.terms);
    for (const dl of deadlinesOf(terms)) {
      if (!isActionDeadline(dl.kind) || dl.date < today) continue;
      const kind = dl.kind as 'notice' | 'trial';
      const same = mine.filter((t) => markersOf(t)!.purpose === kind);
      const exact = same.filter((t) => markersOf(t)!.deadline === dl.date);
      if (exact.length > 0) { plan.reused.push(exact[0].id); if (exact.length > 1) plan.duplicates.push(exact.map((t) => t.id)); continue; }
      const stale = same.find((t) => { const m = markersOf(t)!; return m.deadline !== null && m.doOn !== null && t.data.dueDate === m.doOn; });
      if (stale) { plan.reschedule.push({ taskId: stale.id, doOn: doOnDate(dl.date, rem.leadDays, today), due: null, deadline: dl.date }); plan.reused.push(stale.id); continue; }
      if (same.length > 0) { for (const t of same) plan.stale.push(t.id); continue; }
      plan.create.push({ purpose: kind, cycle: null, due: null, deadline: dl.date, doOn: doOnDate(dl.date, rem.leadDays, today), title: deadlineTaskTitle(kind, d.title), notes: deadlineNotes(kind, dl.date) });
    }
  }
  return plan;
}

/** True only when this Task is exactly what Bills made and nobody has changed anything about it (the owner's own edits make it "touched"). */
export function untouched(t: TaskRecord, d: ObligationRecord['data'], m: BillMarkers): boolean {
  const x = t.data;
  const pay = m.purpose === 'pay';
  const title = pay ? payTaskTitle(d.title) : deadlineTaskTitle(m.purpose as DeadlineKind, d.title);
  const notes = pay ? payNotes(m.due) : deadlineNotes(m.purpose as DeadlineKind, m.deadline ?? '');
  const contacts = d.providerContactId !== null ? [d.providerContactId] : [];
  return x.status === 'todo' && m.doOn !== null && x.dueDate === m.doOn && x.title === title && x.notes === notes && x.dueTime === null && x.startDate === null && !x.repeat
    && x.checklist.length === 0 && x.tagIds.length === 0 && x.listId === null && x.projectId === undefined && x.recurFrom === undefined && !x.createdFrom && x.completedAt === null
    && x.priority === (pay ? 'medium' : 'high') && JSON.stringify(x.contactIds) === JSON.stringify(contacts);
}

// ---- reading ----

/** Every live Task that carries Bills markers. */
export async function loadBillTasks(d: FinanceDB = db): Promise<TaskRecord[]> {
  return (await loadTasks(d)).filter((t) => markersOf(t) !== null);
}
/** Live cycle records of one bill (readable or not). */
export async function cycleRecordsOf(obligationId: number, d: FinanceDB): Promise<CycleRecord[]> {
  return (await d.moduleRecords.where('[module+kind]').equals([MODULE, CYCLE_KIND]).toArray()).filter(isLive).map(readCycle).filter((c) => c.obligationId === obligationId);
}
/** The periods the Task planner looks at: from `PAY_LOOKBACK_DAYS` ago to the horizon, plus every period that holds records. */
export const planningPeriods = (ob: ObligationRecord, cycles: CycleRecord[], today: string) =>
  periodsOf(ob, cycles, today, { from: addDays(today, -PAY_LOOKBACK_DAYS), to: addDays(today, PAY_LOOKAHEAD_DAYS) }, { allRecorded: true });

// ---- writing ----

export interface EnsureResult { created: number[]; rescheduled: number[]; reused: number[]; duplicates: number[][]; stale: number[]; retired: number[] }

/**
 * Makes or updates the bill's Tasks so the plan holds. MUST run inside a transaction on moduleRecords and links: it re-reads the live Tasks first,
 * so a double press or an effect run twice cannot create a second Task. It never completes a Task and never removes one the owner touched; the only
 * removal is an untouched Bills-made Task of a paused or ended bill that stands for something no longer expected (see the file header). Records every
 * row it touches in `rec` so a surrounding Undo can take them back.
 */
export async function ensureBillTasksIn(obligationId: number, today: string, d: FinanceDB, rec?: Recorder): Promise<EnsureResult> {
  const row = await d.moduleRecords.get(obligationId);
  const ob = row && row.module === MODULE && row.kind === KIND && isLive(row) ? asObligation(row) : undefined;
  const none: EnsureResult = { created: [], rescheduled: [], reused: [], duplicates: [], stale: [], retired: [] };
  if (!ob) return none;
  const cycles = await cycleRecordsOf(obligationId, d);
  const plan = planBillTasks(ob, planningPeriods(ob, cycles, today), (await loadBillTasks(d)).filter((t) => markersOf(t)?.obligation === obligationId), today);
  const out: EnsureResult = { ...none, reused: plan.reused, duplicates: plan.duplicates, stale: plan.stale };
  for (const id of plan.retire) await rec?.capture(id, d);
  if (plan.retire.length) { await removeTasks(plan.retire, d); out.retired = plan.retire; }
  for (const r of plan.reschedule) {
    const t = (await loadTasks(d)).find((x) => x.id === r.taskId);
    if (!t) continue;
    await rec?.capture(r.taskId, d);
    const m = markersOf(t)!;
    await saveTask(r.taskId, withMarkers({ ...t.data, dueDate: r.doOn }, { obligation: m.obligation, purpose: m.purpose, cycle: m.cycle, due: r.due ?? m.due, deadline: r.deadline ?? m.deadline, doOn: r.doOn }), d);
    out.rescheduled.push(r.taskId);
  }
  for (const w of plan.create) {
    const data = withMarkers(blankTask({ title: w.title, notes: w.notes, dueDate: w.doOn, priority: w.purpose === 'pay' ? 'medium' : 'high', contactIds: ob.data.providerContactId !== null ? [ob.data.providerContactId] : [] }), { obligation: obligationId, purpose: w.purpose, cycle: w.cycle, due: w.due, deadline: w.deadline, doOn: w.doOn });
    const id = await createTask(data, [obligationRef(obligationId)], d);
    rec?.made(id);
    rec?.linkAdded((await d.links.where('[fromModule+fromId]').equals(['tasks', id]).toArray()).filter(isLive).map((l) => l.id as number));
    out.created.push(id);
  }
  return out;
}
export function ensureBillTasks(obligationId: number, today: string, d: FinanceDB = db): Promise<EnsureResult> {
  return d.transaction('rw', d.moduleRecords, d.links, d.contacts, async () => ensureBillTasksIn(obligationId, today, d));
}

/** Finishes an open Bills pay Task through the existing Tasks API (it is a plain Task: no repeat, so nothing else is made). Records it for Undo. */
export async function finishTaskIn(taskId: number, today: string, d: FinanceDB, rec?: Recorder): Promise<boolean> {
  const t = (await loadTasks(d)).find((x) => x.id === taskId);
  if (!t || t.data.status === 'done') return false;
  await rec?.capture(taskId, d);
  await completeTask(taskId, today, d);
  return true;
}

/** The open pay Tasks that stand for one period (normally one). */
export const openPayTasksFor = (tasks: TaskRecord[], obligationId: number, slot: string) =>
  tasks.filter((t) => { const m = markersOf(t); return !!m && m.obligation === obligationId && m.purpose === 'pay' && m.cycle === slot && open(t); });

