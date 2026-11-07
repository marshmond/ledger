/**
 * Reading and writing billing-period FACTS (B2). Every write runs in ONE transaction, validates strictly, can be taken back by a guarded Undo
 * that refuses (writing nothing) if anything it touched has changed since, and is safe against a double press.
 *
 * It writes ONLY Bills `cycle` records, and (when asked, through the existing Tasks API) the Bills Tasks for the same bill. It never reads or
 * writes Finance, never creates a payment, and never pre-creates a future period: a fact exists only because the owner recorded it.
 *
 * IDEMPOTENCE (B0 N11): each form carries an operation id made when it opened (`newOp`). Submitting the same operation twice writes one record.
 * Opening a form for a period that already has that kind of record edits it instead of adding a second one.
 */
import { db, type FinanceDB } from '../../db';
import { isLive, repo } from '../../core/store';
import type { ModuleRecord } from '../../core/entities';
import { newId } from '../../lib/sync/track';
import { extraSlot } from './slots';
import {
  CYCLE_KIND, isEffective, readCycle, storedCycle, validateBody, type CycleRecord, type FactBody,
} from './cycleModel';
import { asObligation, isLoanExcluded, KIND, MODULE, scheduleSource, type ObligationRecord } from './model';
import { parseSlot, slotWords2 } from './schedule';
import { scheduleProduces } from './slots';
import { cycleRecordsOf, ensureBillTasksIn, finishTaskIn, loadBillTasks, markersOf, openPayTasksFor, planBillTasks, planningPeriods } from './tasks';
import { Recorder, type Undo } from './undo';

export const rows = (d: FinanceDB) => repo<ModuleRecord>(d.moduleRecords);
export const cycleTables = (d: FinanceDB) => [d.moduleRecords, d.links, d.contacts] as const;
const STALE = 'This record was changed (maybe on another device) since you opened it. Close this, look again and redo your change. Nothing was changed.';

/** A fresh operation id for one open form. */
export const newOp = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

export async function loadCycles(d: FinanceDB = db): Promise<CycleRecord[]> {
  return (await d.moduleRecords.where('[module+kind]').equals([MODULE, CYCLE_KIND]).toArray()).filter(isLive).map(readCycle);
}
export async function getCycle(id: number, d: FinanceDB = db): Promise<CycleRecord | undefined> {
  const r = await d.moduleRecords.get(id);
  return r && r.module === MODULE && r.kind === CYCLE_KIND && isLive(r) ? readCycle(r) : undefined;
}
async function obligationIn(id: number, d: FinanceDB): Promise<ObligationRecord | undefined> {
  const r = await d.moduleRecords.get(id);
  return r && r.module === MODULE && r.kind === KIND && isLive(r) ? asObligation(r) : undefined;
}

const SINGULAR: FactBody['fact'][] = ['invoice', 'due-date', 'paid-outside', 'paid-in-full', 'skip'];
const PAYMENT: FactBody['fact'][] = ['paid-outside', 'paid-in-full'];

export interface RecordInput {
  obligationId: number;
  slot: string;
  body: FactBody;
  /** One per open form. A second submission with the same one writes nothing. */
  op: string;
  today: string;
  /** An open pay Task for this period to finish in the same step (chosen from the preview). */
  finishTaskId?: number | null;
}
export interface RecordResult { id: number; reused: boolean; finishedTask: number | null; createdTasks: number[]; undo: Undo }

/** Checks a new record against the bill and its schedule. Plain-words problem or null. */
export function recordProblem(ob: ObligationRecord, slot: string, body: FactBody): string | null {
  const bad = validateBody(body);
  if (bad) return bad;
  if (!parseSlot(slot)) return 'That is not a billing period this version understands.';
  if (isLoanExcluded(ob.data) && PAYMENT.includes(body.fact)) return 'Loan payments are tracked on the Loans page, so a payment cannot be recorded here.';
  if (!slot.startsWith('x') && scheduleProduces(scheduleSource(ob.data), slot) === null) return `${slotWords2(slot)} is not a billing period of this bill's schedule. Record an extra bill instead.`;
  return null;
}

/**
 * Adds one fact. In ONE transaction: re-reads the bill, refuses a second record of a single-record kind for the period, writes the fact, optionally
 * finishes the chosen open pay Task, and keeps the bill's Tasks in step. Returns an Undo.
 */
export function recordFact(input: RecordInput, d: FinanceDB = db): Promise<RecordResult> {
  return d.transaction('rw', ...cycleTables(d), async () => {
    const ob = await obligationIn(input.obligationId, d);
    if (!ob) throw new Error('That bill no longer exists. Nothing was changed.');
    const problem = recordProblem(ob, input.slot, input.body);
    if (problem) throw new Error(problem);
    const mine = await cycleRecordsOf(input.obligationId, d);
    const again = mine.find((c) => c.op !== null && c.op === input.op);
    if (again) return { id: again.id, reused: true, finishedTask: null, createdTasks: [], undo: { rows: [], sealed: {} } };
    if (SINGULAR.includes(input.body.fact) && mine.some((c) => c.slot === input.slot && isEffective(c) && c.body.fact === input.body.fact)) {
      throw new Error('This period already has one of these. Open it to change it instead of adding a second. Nothing was changed.');
    }
    const rec = new Recorder();
    const id = await rows(d).put({ module: MODULE, kind: CYCLE_KIND, data: storedCycle({ raw: {}, obligationId: input.obligationId, slot: input.slot, op: input.op, supersededBy: null, movedFrom: null }, input.body) });
    rec.made(id);
    let finished: number | null = null;
    if (input.finishTaskId != null) {
      const open = openPayTasksFor(await loadBillTasks(d), input.obligationId, input.slot);
      if (!open.some((t) => t.id === input.finishTaskId)) throw new Error('The reminder Task for this period changed since you opened this. Close it, look again and redo your change. Nothing was changed.');
      if (await finishTaskIn(input.finishTaskId, input.today, d, rec)) finished = input.finishTaskId;
    }
    const ens = await ensureBillTasksIn(input.obligationId, input.today, d, rec);
    return { id, reused: false, finishedTask: finished, createdTasks: ens.created, undo: await rec.seal(d) };
  });
}

/** Edits one existing fact (same type). Refuses if it changed since `expectUpdatedAt`. The bill's Tasks follow a corrected due date. */
export function editFact(id: number, body: FactBody, expectUpdatedAt: number, today: string, d: FinanceDB = db): Promise<{ undo: Undo }> {
  return d.transaction('rw', ...cycleTables(d), async () => {
    const c = await getCycle(id, d);
    if (!c || c.body === null || c.obligationId === null || c.slot === null) throw new Error('That record can no longer be edited here. Nothing was changed.');
    if (c.updatedAt !== expectUpdatedAt) throw new Error(STALE);
    if (body.fact !== c.body.fact) throw new Error('A record cannot change its type. Remove it and add a new one. Nothing was changed.');
    const ob = await obligationIn(c.obligationId, d);
    if (!ob) throw new Error('That bill no longer exists. Nothing was changed.');
    const bad = validateBody(body);
    if (bad) throw new Error(bad);
    const rec = new Recorder();
    await rec.capture(id, d);
    await rows(d).put({ id, module: MODULE, kind: CYCLE_KIND, data: storedCycle({ raw: c.raw, obligationId: c.obligationId, slot: c.slot, op: c.op, supersededBy: c.supersededBy, movedFrom: c.movedFrom }, body) });
    await ensureBillTasksIn(c.obligationId, today, d, rec);
    return { undo: await rec.seal(d) };
  });
}

/** Removes one fact the owner recorded by mistake (a soft delete: Undo brings it back). It never removes a record this version cannot read. */
export function removeFact(id: number, expectUpdatedAt: number, today: string, d: FinanceDB = db): Promise<{ undo: Undo }> {
  return d.transaction('rw', ...cycleTables(d), async () => {
    const c = await getCycle(id, d);
    if (!c || c.body === null) throw new Error('That record can no longer be removed here. Nothing was changed.');
    if (c.updatedAt !== expectUpdatedAt) throw new Error(STALE);
    const rec = new Recorder();
    await rec.capture(id, d);
    await rows(d).remove(id);
    if (c.obligationId !== null) await ensureBillTasksIn(c.obligationId, today, d, rec);
    return { undo: await rec.seal(d) };
  });
}

// ---- the preview of a new record ----

export interface FactPlan { problem: string | null; lines: string[]; /** The open pay Task for this period, if one exists. */ taskId: number | null; taskTitle: string | null }

/** What recording this fact would do, in plain words. Reads only; nothing is written. */
export async function planFact(input: Omit<RecordInput, 'op'>, d: FinanceDB = db): Promise<FactPlan> {
  const ob = await obligationIn(input.obligationId, d);
  if (!ob) return { problem: 'That bill no longer exists.', lines: [], taskId: null, taskTitle: null };
  const problem = recordProblem(ob, input.slot, input.body);
  if (problem) return { problem, lines: [], taskId: null, taskTitle: null };
  const cycles = await cycleRecordsOf(input.obligationId, d);
  if (SINGULAR.includes(input.body.fact) && cycles.some((c) => c.slot === input.slot && isEffective(c) && c.body.fact === input.body.fact)) {
    return { problem: 'This period already has one of these. Open it to change it.', lines: [], taskId: null, taskTitle: null };
  }
  const tasks = await loadBillTasks(d);
  const open = openPayTasksFor(tasks, input.obligationId, input.slot);
  const words = slotWords2(input.slot);
  const lines: string[] = [];
  const b = input.body;
  const settles = b.fact === 'paid-outside' || b.fact === 'paid-in-full' || b.fact === 'skip';
  if (b.fact === 'paid-outside') lines.push(`Record that ${words} was paid outside Finance on ${b.paidOn}${b.cents !== null ? '' : ', with no amount'}.`);
  else if (b.fact === 'paid-in-full') lines.push(`Record that you declare ${words} paid in full. No amount is recorded, so nothing is counted as money paid.`);
  else if (b.fact === 'skip') lines.push(`Record that ${words} was not billed. It stops appearing as an expected bill.`);
  else if (b.fact === 'invoice') lines.push(`Record the bill for ${words}${b.dueDate ? `, due ${b.dueDate}` : ''}. A bill is not a payment.`);
  else if (b.fact === 'due-date') lines.push(`Record that ${words} is due on ${b.dueDate}. The billing period itself does not change.`);
  else lines.push(`Record a provider credit for ${words}. It lowers what is owed and is never counted as a payment.`);
  if (b.fact === 'paid-outside' || b.fact === 'paid-in-full') lines.push('Nothing is paid, posted or created in Finance. This is only your own note.');
  // the Tasks: simulate the period with the new fact to say what the reminder will do
  const sim = readCycle({ id: -1, module: MODULE, kind: CYCLE_KIND, data: storedCycle({ raw: {}, obligationId: input.obligationId, slot: input.slot, op: null, supersededBy: null, movedFrom: null }, b), createdAt: Date.now(), updatedAt: Date.now(), deletedAt: null } as ModuleRecord);
  const after = planningPeriods(ob, [...cycles, sim], input.today);
  const stillOpenTasks = tasks.filter((t) => markersOf(t)?.obligation === input.obligationId);
  if (settles && open.length > 0) lines.push(`The reminder Task "${open[0].data.title}" will be finished.`);
  const next = planBillTasks(ob, after, stillOpenTasks.map((t) => (settles && open.some((o) => o.id === t.id) ? { ...t, data: { ...t.data, status: 'done' as const } } : t)), input.today);
  for (const w of next.create) lines.push(`A reminder Task will be made: "${w.title}", for ${w.doOn}${w.due ? ` (the bill is due ${w.due})` : ''}.`);
  if (next.reschedule.length > 0) lines.push('The bill\'s reminder Task will move to follow the new due date (only because you have not moved it yourself).');
  return { problem: null, lines, taskId: settles && open[0] ? open[0].id : null, taskTitle: settles && open[0] ? open[0].data.title : null };
}

/** A new extra-bill slot (a bill no schedule produced). */
export const newExtraSlot = () => extraSlot(newId());
