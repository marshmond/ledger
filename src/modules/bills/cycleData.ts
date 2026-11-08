/**
 * Reading and writing billing-period FACTS (B2). Every write runs in ONE transaction, validates strictly, can be taken back by a guarded Undo
 * that refuses (writing nothing) if anything it touched has changed since, and is safe against a double press.
 *
 * It writes ONLY Bills `cycle` records, and (when asked, through the existing Tasks API) the Bills Tasks for the same bill. It never writes Finance,
 * never creates a payment, and never pre-creates a future period: a fact exists only because the owner recorded it. B3: a `payment-link` fact holds
 * a REFERENCE to a Finance transaction piece; Finance is only READ, through the shared bulk loader, before the write transaction opens.
 *
 * IDEMPOTENCE (B0 N11): each form carries an operation id made when it opened (`newOp`). Submitting the same operation twice writes one record.
 * Opening a form for a period that already has that kind of record edits it instead of adding a second one.
 */
import { db, type FinanceDB } from '../../db';
import { isLive, repo } from '../../core/store';
import type { ModuleRecord } from '../../core/entities';
import { newId } from '../../lib/sync/track';
import { extraSlot } from './slots';
import { effectiveLinks, linkProblem, switchLines, TYPED_WHILE_LINKED, typedPayments } from './paymentLinks';
import { financeLookupFor, inBillsTx } from './tasks';
import { pieceKey, type TxnRef } from '../../lib/txnRef';
import type { LabelId } from './labels';
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
const PAYMENT: FactBody['fact'][] = ['paid-outside', 'paid-in-full', 'payment-link'];

export interface RecordInput {
  obligationId: number;
  slot: string;
  body: FactBody;
  /** One per open form. A second submission with the same one writes nothing. */
  op: string;
  today: string;
  /** An open pay Task for this period to finish in the same step (chosen from the preview). */
  finishTaskId?: number | null;
  /** B3 payment-link only: the owner confirmed that the typed outside-Finance payment(s) of this period are set aside (kept in History, not counted). */
  switchTyped?: boolean;
  /** B3 payment-link only: replace this one link of the period (it is removed and the new one added, in the same step). */
  replaceFactId?: number | null;
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
  const extra: TxnRef[] = input.body.fact === 'payment-link' ? [input.body.ref] : [];
  return inBillsTx(d, cycleTables(d), [input.obligationId], async (lookup) => {
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
    const inPeriod = mine.filter((c) => c.slot === input.slot && isEffective(c)) as (CycleRecord & { body: FactBody })[];
    // B3: one money source per period, and a visibly refused repeat
    let typedToSetAside: CycleRecord[] = [];
    let replaced: CycleRecord | null = null;
    if (input.body.fact === 'payment-link') {
      const links = effectiveLinks(inPeriod);
      if (input.replaceFactId != null) {
        replaced = inPeriod.find((c) => c.id === input.replaceFactId && c.body.fact === 'payment-link') ?? null;
        if (!replaced) throw new Error('The payment you meant to replace changed or is gone since you opened this. Close this, look again and redo your change. Nothing was changed.');
      }
      typedToSetAside = typedPayments(inPeriod);
      const why = linkProblem({ ref: input.body.ref, existing: links.filter((l) => l.id !== input.replaceFactId), typed: typedToSetAside, switchTyped: !!input.switchTyped, lookup });
      if (why) throw new Error(why);
      if (!input.switchTyped) typedToSetAside = [];
    } else if (input.body.fact === 'paid-outside' && input.body.cents !== null && effectiveLinks(inPeriod).length > 0) {
      throw new Error(TYPED_WHILE_LINKED);
    }
    const rec = new Recorder();
    const id = await rows(d).put({ module: MODULE, kind: CYCLE_KIND, data: storedCycle({ raw: {}, obligationId: input.obligationId, slot: input.slot, op: input.op, supersededBy: null, movedFrom: null }, input.body) });
    rec.made(id);
    // the switch: the typed payment is set aside, never erased (it stays under History); a replaced link is removed (a soft delete that Undo can bring back)
    for (const t of typedToSetAside) {
      await rec.capture(t.id, d);
      await rows(d).put({ id: t.id, module: MODULE, kind: CYCLE_KIND, data: storedCycle({ raw: t.raw, obligationId: t.obligationId!, slot: t.slot!, op: t.op, supersededBy: id, movedFrom: t.movedFrom }, t.body!) });
    }
    if (replaced) { await rec.capture(replaced.id, d); await rows(d).remove(replaced.id); }
    let finished: number | null = null;
    if (input.finishTaskId != null) {
      const open = openPayTasksFor(await loadBillTasks(d), input.obligationId, input.slot);
      if (!open.some((t) => t.id === input.finishTaskId)) throw new Error('The reminder Task for this period changed since you opened this. Close it, look again and redo your change. Nothing was changed.');
      if (await finishTaskIn(input.finishTaskId, input.today, d, rec)) finished = input.finishTaskId;
    }
    const ens = await ensureBillTasksIn(input.obligationId, input.today, d, lookup, rec);
    return { id, reused: false, finishedTask: finished, createdTasks: ens.created, undo: await rec.seal(d) };
  }, extra);
}

/** Edits one existing fact (same type). Refuses if it changed since `expectUpdatedAt`. The bill's Tasks follow a corrected due date. */
export async function editFact(id: number, body: FactBody, expectUpdatedAt: number, today: string, d: FinanceDB = db): Promise<{ undo: Undo }> {
  const before = await getCycle(id, d);
  return inBillsTx(d, cycleTables(d), before?.obligationId != null ? [before.obligationId] : [], async (lookup) => {
    const c = await getCycle(id, d);
    if (!c || c.body === null || c.obligationId === null || c.slot === null) throw new Error('That record can no longer be edited here. Nothing was changed.');
    if (c.updatedAt !== expectUpdatedAt) throw new Error(STALE);
    if (body.fact !== c.body.fact) throw new Error('A record cannot change its type. Remove it and add a new one. Nothing was changed.');
    if (c.body.fact === 'payment-link') throw new Error('A linked payment cannot be edited. Remove the link and link another payment. Nothing was changed.');
    if (c.body.fact === 'suggestion-reject') throw new Error('A rejection cannot be edited. Reconsider it and reject another payment instead. Nothing was changed.');
    const ob = await obligationIn(c.obligationId, d);
    if (!ob) throw new Error('That bill no longer exists. Nothing was changed.');
    const bad = validateBody(body);
    if (bad) throw new Error(bad);
    // one money source per period: a typed amount cannot be put on a period whose payment comes from Finance links
    if (body.fact === 'paid-outside' && body.cents !== null && c.supersededBy === null) {
      const sib = (await cycleRecordsOf(c.obligationId, d)).filter((x) => x.slot === c.slot && isEffective(x)) as (CycleRecord & { body: FactBody })[];
      if (effectiveLinks(sib).length > 0) throw new Error(TYPED_WHILE_LINKED);
    }
    const rec = new Recorder();
    await rec.capture(id, d);
    await rows(d).put({ id, module: MODULE, kind: CYCLE_KIND, data: storedCycle({ raw: c.raw, obligationId: c.obligationId, slot: c.slot, op: c.op, supersededBy: c.supersededBy, movedFrom: c.movedFrom }, body) });
    await ensureBillTasksIn(c.obligationId, today, d, lookup, rec);
    return { undo: await rec.seal(d) };
  });
}

/** Removes one fact the owner recorded by mistake (a soft delete: Undo brings it back). It never removes a record this version cannot read. */
export async function removeFact(id: number, expectUpdatedAt: number, today: string, d: FinanceDB = db): Promise<{ undo: Undo }> {
  const before = await getCycle(id, d);
  return inBillsTx(d, cycleTables(d), before?.obligationId != null ? [before.obligationId] : [], async (lookup) => {
    const c = await getCycle(id, d);
    if (!c || c.body === null) throw new Error('That record can no longer be removed here. Nothing was changed.');
    if (c.updatedAt !== expectUpdatedAt) throw new Error(STALE);
    const rec = new Recorder();
    await rec.capture(id, d);
    await rows(d).remove(id);
    if (c.obligationId !== null) await ensureBillTasksIn(c.obligationId, today, d, lookup, rec);
    return { undo: await rec.seal(d) };
  });
}

// ---- B3.1: "Not this payment" ----

export interface RejectInput {
  obligationId: number;
  slot: string;
  /** The ONE Finance piece (a whole transaction or one part) that is not a payment for this period. */
  ref: TxnRef;
  /** One per open dialog or press: a second submission with the same one writes nothing. */
  op: string;
}
export interface RejectResult { id: number; reused: boolean; undo: Undo }

/**
 * Records that ONE Finance piece is NOT a payment for ONE billing period, so Ledger stops suggesting it for that period. It is a fact, added and
 * never edited (B0 3.4), so two devices that each reject something add two separate records and neither overwrites the other. Its scope is the period:
 * rejecting November's payment says nothing about December. It touches nothing but a Bills record: no Finance transaction, no payment, no status, no Task
 * (a rejection changes no period's money, so it never plans or makes a reminder). Rejecting the same piece again for the same period is a no-op that
 * returns the existing record. One transaction; guarded Undo.
 */
export function rejectSuggestion(input: RejectInput, d: FinanceDB = db): Promise<RejectResult> {
  return d.transaction('rw', cycleTables(d), async () => {
    const ob = await obligationIn(input.obligationId, d);
    if (!ob) throw new Error('That bill no longer exists. Nothing was changed.');
    const body: FactBody = { fact: 'suggestion-reject', ref: input.ref };
    const bad = validateBody(body);
    if (bad) throw new Error(bad);
    if (!parseSlot(input.slot)) throw new Error('That is not a billing period this version understands.');
    const mine = await cycleRecordsOf(input.obligationId, d);
    const again = mine.find((c) => c.op !== null && c.op === input.op);
    if (again) return { id: again.id, reused: true, undo: { rows: [], sealed: {} } };
    const same = mine.find((c) => c.slot === input.slot && isEffective(c) && c.body.fact === 'suggestion-reject' && pieceKey(c.body.ref) === pieceKey(input.ref));
    if (same) return { id: same.id, reused: true, undo: { rows: [], sealed: {} } };
    const rec = new Recorder();
    const id = await rows(d).put({ module: MODULE, kind: CYCLE_KIND, data: storedCycle({ raw: {}, obligationId: input.obligationId, slot: input.slot, op: input.op, supersededBy: null, movedFrom: null }, body) });
    rec.made(id);
    return { id, reused: false, undo: await rec.seal(d) };
  });
}

/**
 * Takes a rejection back ("look at this payment again"): a soft delete, so the record stays in the database as history and Undo can bring it back.
 * Refuses if the record changed since the owner opened it. Never touches Finance or any other record.
 */
export function reconsiderRejection(id: number, expectUpdatedAt: number, d: FinanceDB = db): Promise<{ undo: Undo }> {
  return d.transaction('rw', cycleTables(d), async () => {
    const c = await getCycle(id, d);
    if (!c || c.body === null || c.body.fact !== 'suggestion-reject') throw new Error('That rejection can no longer be changed here. Nothing was changed.');
    if (c.updatedAt !== expectUpdatedAt) throw new Error(STALE);
    const rec = new Recorder();
    await rec.capture(id, d);
    await rows(d).remove(id);
    return { undo: await rec.seal(d) };
  });
}

// ---- the preview of a new record ----

/** What a payment link would leave the period looking like: numbers only (the dialog words them, with Hide Amounts). */
export interface PlanResult { label: LabelId; paidCents: number; owedCents: number | null; remainingCents: number | null; netCents: number; reversed: boolean; settled: boolean }
export interface FactPlan { problem: string | null; lines: string[]; /** The open pay Task for this period, if one exists. */ taskId: number | null; taskTitle: string | null; /** B3 payment links: how the period would look afterwards. */ result: PlanResult | null; /** B3: how many typed outside-Finance payments the link would set aside. */ typedSetAside: number }

const SIM_ID = 2 ** 40;
const noPlan = (problem: string): FactPlan => ({ problem, lines: [], taskId: null, taskTitle: null, result: null, typedSetAside: 0 });
const asRow = (c: CycleRecord, data: Record<string, unknown>) => readCycle({ id: c.id, module: MODULE, kind: CYCLE_KIND, data, createdAt: c.createdAt, updatedAt: c.updatedAt, deletedAt: null } as ModuleRecord);

/** What recording this fact would do, in plain words. Reads only; nothing is written. */
export async function planFact(input: Omit<RecordInput, 'op'>, d: FinanceDB = db): Promise<FactPlan> {
  const ob = await obligationIn(input.obligationId, d);
  if (!ob) return noPlan('That bill no longer exists.');
  const problem = recordProblem(ob, input.slot, input.body);
  if (problem) return noPlan(problem);
  const cycles = await cycleRecordsOf(input.obligationId, d);
  if (SINGULAR.includes(input.body.fact) && cycles.some((c) => c.slot === input.slot && isEffective(c) && c.body.fact === input.body.fact)) return noPlan('This period already has one of these. Open it to change it.');
  const b = input.body;
  const lookup = await financeLookupFor(d, [input.obligationId], b.fact === 'payment-link' ? [b.ref] : []);
  const inPeriod = cycles.filter((c) => c.slot === input.slot && isEffective(c)) as (CycleRecord & { body: FactBody })[];
  // B3: the same checks the write makes, so the preview refuses exactly what saving would refuse
  let typed: CycleRecord[] = [];
  if (b.fact === 'payment-link') {
    typed = typedPayments(inPeriod);
    const why = linkProblem({ ref: b.ref, existing: effectiveLinks(inPeriod).filter((l) => l.id !== input.replaceFactId), typed, switchTyped: !!input.switchTyped, lookup });
    if (why) return noPlan(why);
    if (input.replaceFactId != null && !effectiveLinks(inPeriod).some((l) => l.id === input.replaceFactId)) return noPlan('The payment you meant to replace changed or is gone. Close this and look again.');
    if (!input.switchTyped) typed = [];
  } else if (b.fact === 'paid-outside' && b.cents !== null && effectiveLinks(inPeriod).length > 0) return noPlan(TYPED_WHILE_LINKED);
  const tasks = await loadBillTasks(d);
  const open = openPayTasksFor(tasks, input.obligationId, input.slot);
  const words = slotWords2(input.slot);
  const lines: string[] = [];
  if (b.fact === 'paid-outside') lines.push(`Record that ${words} was paid outside Finance on ${b.paidOn}${b.cents !== null ? '' : ', with no amount'}.`);
  else if (b.fact === 'paid-in-full') lines.push(`Record that you declare ${words} paid in full. No amount is recorded, so nothing is counted as money paid.`);
  else if (b.fact === 'skip') lines.push(`Record that ${words} was not billed. It stops appearing as an expected bill.`);
  else if (b.fact === 'invoice') lines.push(`Record the bill for ${words}${b.dueDate ? `, due ${b.dueDate}` : ''}. A bill is not a payment.`);
  else if (b.fact === 'due-date') lines.push(`Record that ${words} is due on ${b.dueDate}. The billing period itself does not change.`);
  else if (b.fact === 'payment-link') lines.push(`${input.replaceFactId != null ? 'Replace the linked payment with' : 'Confirm'} this Finance payment as a payment toward ${words}. Ledger keeps a reference to the transaction, not a copy of it.`);
  else lines.push(`Record a provider credit for ${words}. It lowers what is owed and is never counted as a payment.`);
  if (b.fact === 'paid-outside' || b.fact === 'paid-in-full') lines.push('Nothing is paid, posted or created in Finance. This is only your own note.');
  if (b.fact === 'payment-link') lines.push(...switchLines(typed.length), 'The amount, date and status shown for it are read live from Finance every time. Nothing in Finance is created, changed, cleared or reconciled, and nothing is linked just because it looks alike.');
  // the Tasks: simulate the period with the new fact to say what the reminder will do
  const sim = readCycle({ id: SIM_ID, module: MODULE, kind: CYCLE_KIND, data: storedCycle({ raw: {}, obligationId: input.obligationId, slot: input.slot, op: null, supersededBy: null, movedFrom: null }, b), createdAt: Date.now(), updatedAt: Date.now(), deletedAt: null } as ModuleRecord);
  const typedIds = new Set(typed.map((t) => t.id));
  const simCycles = [...cycles.filter((c) => c.id !== input.replaceFactId).map((c) => (typedIds.has(c.id) ? asRow(c, { ...c.raw, supersededBy: SIM_ID }) : c)), sim];
  const after = planningPeriods(ob, simCycles, input.today, lookup);
  const before = planningPeriods(ob, cycles, input.today, lookup).find((p) => p.slot === input.slot);
  const afterP = after.find((p) => p.slot === input.slot);
  const settles = b.fact === 'payment-link' ? !!afterP && !afterP.open && !!before?.open : b.fact === 'paid-outside' || b.fact === 'paid-in-full' || b.fact === 'skip';
  const stillOpenTasks = tasks.filter((t) => markersOf(t)?.obligation === input.obligationId);
  if (settles && open.length > 0) lines.push(`The reminder Task "${open[0].data.title}" will be finished.`);
  const next = planBillTasks(ob, after, stillOpenTasks.map((t) => (settles && open.some((o) => o.id === t.id) ? { ...t, data: { ...t.data, status: 'done' as const } } : t)), input.today);
  for (const w of next.create) lines.push(`A reminder Task will be made: "${w.title}", for ${w.doOn}${w.due ? ` (the bill is due ${w.due})` : ''}.`);
  if (next.reschedule.length > 0) lines.push('The bill\'s reminder Task will move to follow the new due date (only because you have not moved it yourself).');
  const result: PlanResult | null = b.fact === 'payment-link' && afterP ? { label: afterP.label, paidCents: afterP.amounts.paid, owedCents: afterP.amounts.owed, remainingCents: afterP.amounts.remaining, netCents: afterP.amounts.finance?.netCents ?? 0, reversed: !!afterP.amounts.finance?.reversed, settled: !afterP.open } : null;
  return { problem: null, lines, taskId: settles && open[0] ? open[0].id : null, taskTitle: settles && open[0] ? open[0].data.title : null, result, typedSetAside: typed.length };
}

/** A new extra-bill slot (a bill no schedule produced). */
export const newExtraSlot = () => extraSlot(newId());
