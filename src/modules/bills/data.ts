/**
 * Reading and writing obligations (B1). Writes go through the shared store's `repo` (id, createdAt, updatedAt, soft delete). This module
 * writes ONLY its own `bills` records (and, when asked, a provider Contact through the existing `findOrCreateContact`). It never writes
 * Finance, Calendar, Projects, Home & Assets or Household Services. B2: when the owner has turned reminders on for a bill, saving it keeps the
 * bill's Tasks in step through the existing Tasks API (see `tasks.ts`); it creates no event.
 */
import { db, type FinanceDB } from '../../db';
import type { ModuleRecord } from '../../core/entities';
import { findOrCreateContact, validEmail } from '../../core/contacts';
import { createStore, isLive, repo } from '../../core/store';
import { addDays, addMonths } from '../../lib/dates';
import {
  applyEdit, asObligation, firstAmountCents, historyReasons, KIND, MODULE, normalizeObligation, obligationRef, scheduleSource, toStored, validateObligation, withLog,
  type AmountKind, type EndReason, type ObligationData, type ObligationRecord, type Payment, type DocRef, type PriceStep, type BillType, type Need,
} from './model';
import { expectedDates, planScheduleChange, type Schedule } from './schedule';
import { cycleRecordsOf, ensureBillTasksIn, financeLookupFor, inBillsTx, loadBillTasks, markersOf, planBillTasks, planningPeriods } from './tasks';
import { Recorder, type Undo } from './undo';
import { tidy } from './util';

export const rows = (d: FinanceDB) => repo<ModuleRecord>(d.moduleRecords);
/** Every table an obligation operation may touch. */
export const tables = (d: FinanceDB) => [d.moduleRecords, d.links, d.contacts] as const;

export async function loadObligations(d: FinanceDB = db): Promise<ObligationRecord[]> {
  return (await d.moduleRecords.where('[module+kind]').equals([MODULE, KIND]).toArray()).filter(isLive).map(asObligation)
    .sort((a, b) => a.data.title.localeCompare(b.data.title) || a.id - b.id);
}
export async function getObligation(id: number, d: FinanceDB = db): Promise<ObligationRecord | undefined> {
  const r = await d.moduleRecords.get(id);
  return r && r.module === MODULE && r.kind === KIND && isLive(r) ? asObligation(r) : undefined;
}

/** Writes an obligation record (keeps fields this code does not know). Validates strictly. */
export async function writeObligation(id: number | undefined, data: ObligationData, d: FinanceDB = db): Promise<number> {
  const clean = normalizeObligation(data);
  const problem = validateObligation(clean);
  if (problem) throw new Error(problem);
  return rows(d).put({ ...(id !== undefined ? { id } : {}), module: MODULE, kind: KIND, data: toStored(clean) });
}

// ---- providers (shared Contacts) ----

export interface ProviderInput { contactId?: number | null; name?: string; phone?: string; email?: string; relationship?: string }
export interface ResolvedProvider { id: number; name: string; created: boolean }

/** Finds the chosen contact, or finds/creates one by name (never a second contact for the same name). Runs inside the caller's transaction. */
export async function resolveProvider(input: ProviderInput, d: FinanceDB): Promise<ResolvedProvider> {
  if (input.contactId != null) {
    const c = await d.contacts.get(input.contactId);
    if (!c || !isLive(c)) throw new Error('That contact no longer exists.');
    return { id: c.id as number, name: c.name, created: false };
  }
  const name = tidy(input.name ?? '');
  if (!name) throw new Error('Enter the provider\'s name.');
  if (input.email && tidy(input.email) && !validEmail(tidy(input.email))) throw new Error('That email address does not look right.');
  const { id, created } = await findOrCreateContact(d, { name, phone: input.phone, email: input.email, relationship: input.relationship });
  return { id, name: (await d.contacts.get(id))?.name ?? name, created };
}
const hasProvider = (p: ProviderInput | null | undefined): p is ProviderInput => !!p && (p.contactId != null || !!tidy(p.name ?? ''));

// ---- creating ----

export interface NewObligation {
  data: ObligationData;
  /** Today, so a bill saved with reminders on gets its first reminder Task in the same step. */
  today?: string;
  /** An existing contact, or a name to find/create. Omit for "no provider yet". */
  provider?: ProviderInput | null;
  /** B3.1: runs FIRST inside the transaction. Returning a result stops everything (nothing is written): how a repeated press with the same operation id reuses the earlier bill. */
  before?: (d: FinanceDB) => Promise<Created | null>;
  /** B3.1: runs inside the same transaction right after the bill is written, so whatever it also writes (a review-choice record, a validated Scheduled link) commits or rolls back WITH the bill. Throwing undoes the whole addition. */
  also?: (ctx: { d: FinanceDB; id: number; rec: Recorder }) => Promise<void>;
}
export interface Created { id: number; contactCreated: boolean; contactId: number | null; taskIds: number[]; /** takes the whole addition back (refused if it was changed since); a made Contact is kept */ undo: Undo }

/** Adds an obligation in one transaction: all or nothing. */
export function createObligation(input: NewObligation, d: FinanceDB = db): Promise<Created> {
  return inBillsTx(d, tables(d), [], async (lookup) => {
    const earlier = input.before ? await input.before(d) : null;
    if (earlier) return earlier;
    let data = input.data;
    let contact: ResolvedProvider | null = null;
    if (hasProvider(input.provider)) {
      contact = await resolveProvider(input.provider, d);
      data = { ...data, providerContactId: contact.id, providerNameSnapshot: contact.name };
    }
    const id = await writeObligation(undefined, data, d);
    const rec = new Recorder();
    rec.made(id);
    if (input.also) await input.also({ d, id, rec });
    const ens = input.today ? await ensureBillTasksIn(id, input.today, d, lookup, rec) : null;
    return { id, contactCreated: contact?.created ?? false, contactId: contact?.id ?? null, taskIds: ens?.created ?? [], undo: await rec.seal(d) };
  });
}

// ---- editing ----

export interface ObligationEdit {
  title: string;
  type: BillType;
  need: Need;
  /** `undefined` = leave the provider as it is; `null` = no provider; otherwise the contact to use. */
  provider?: ProviderInput | null;
  amountKind: AmountKind;
  /** The first price in cents (null = not known). */
  amountCents: number | null;
  trackingSince: string;
  schedule: Schedule | null;
  /** From which date a changed schedule applies. Required (and used) only when the schedule differs. */
  scheduleFrom?: string | null;
  payment: Payment;
  paidThroughLoan: boolean;
  review: { on: boolean; note: string };
  refs: DocRef[];
  notes: string;
  /** B2: leave out to keep the reminder settings as they are. */
  reminders?: { payTask: boolean; leadDays: number };
}

/** The new price list: only the FIRST step is edited in B1 (full price-step editing is B4); later steps are kept. */
export function withFirstPrice(prices: PriceStep[], cents: number | null, trackingSince: string): PriceStep[] {
  if (prices.length === 0) return cents === null ? [] : [{ from: trackingSince, cents, label: '' }];
  const [first, ...rest] = prices;
  if (cents === null && rest.length === 0) return [];
  return [{ ...first, cents, from: first.from > trackingSince ? trackingSince : first.from }, ...rest];
}

/** Applies a form's values to a record. Pure; throws a plain message when the schedule change is refused. */
export function applyObligationEdit(cur: ObligationData, e: ObligationEdit, today: string, factSlots: string[] = []): ObligationData {
  const patch: Partial<ObligationData> = {
    title: e.title, type: e.type, need: e.need, amountKind: e.amountKind, trackingSince: e.trackingSince,
    prices: e.amountKind === 'unknown' ? cur.prices : withFirstPrice(cur.prices, e.amountCents, e.trackingSince),
    payment: e.payment, paidThroughLoan: e.paidThroughLoan, refs: e.refs, notes: e.notes,
    review: { on: e.review.on, note: e.review.note, since: e.review.on ? (cur.review.on ? cur.review.since ?? today : today) : cur.review.since },
  };
  const change = planScheduleChange(cur, e.schedule, e.scheduleFrom || today, factSlots);
  if (change.problem) throw new Error(change.problem);
  if (change.mode !== 'same') { patch.schedule = change.schedule; patch.scheduleHistory = change.history; }
  if (e.reminders) patch.reminders = { payTask: e.reminders.payTask, leadDays: e.reminders.leadDays };
  // an untouched unreadable schedule stays exactly as it was; a changed one replaces it
  return applyEdit(cur, patch);
}

/** Saves an edit. Refuses (writing nothing) if the record changed since `expectUpdatedAt`. Returns an Undo. */
export function editObligation(id: number, e: ObligationEdit, expectUpdatedAt: number | null, today: string, d: FinanceDB = db): Promise<{ undo: Undo; contactCreated: boolean }> {
  return inBillsTx(d, tables(d), [id], async (lookup) => {
    const cur = await getObligation(id, d);
    if (!cur) throw new Error('That bill no longer exists. Nothing was changed.');
    if (expectUpdatedAt !== null && cur.updatedAt !== expectUpdatedAt) throw new Error('This record was changed (maybe on another device) since you opened it. Close this, look again and redo your change. Nothing was changed.');
    // a period that already holds a recorded fact counts as an applied period when the schedule changes (B2)
    const factSlots = [...new Set((await cycleRecordsOf(id, d)).flatMap((c) => (c.body !== null && c.slot ? [c.slot] : [])))];
    let data = applyObligationEdit(cur.data, e, today, factSlots);
    let contactCreated = false;
    if (e.provider !== undefined) {
      if (hasProvider(e.provider)) {
        const p = await resolveProvider(e.provider, d);
        contactCreated = p.created;
        data = applyEdit(data, { providerContactId: p.id, providerNameSnapshot: p.name });
      } else data = applyEdit(data, { providerContactId: null, providerNameSnapshot: '' });
    }
    const rec = new Recorder();
    await rec.capture(id, d);
    await writeObligation(id, data, d);
    await ensureBillTasksIn(id, today, d, lookup, rec);
    return { undo: await rec.seal(d), contactCreated };
  });
}

/** Puts the obligation on, or takes it off, the owner's cost-review list. Never cancels or changes anything else. */
export function setReview(id: number, on: boolean, note: string, expectUpdatedAt: number | null, today: string, d: FinanceDB = db): Promise<{ undo: Undo }> {
  return d.transaction('rw', ...tables(d), async () => {
    const cur = await getObligation(id, d);
    if (!cur) throw new Error('That bill no longer exists. Nothing was changed.');
    if (expectUpdatedAt !== null && cur.updatedAt !== expectUpdatedAt) throw new Error('This record was changed (maybe on another device) since you opened it. Look again and redo your change. Nothing was changed.');
    const data = applyEdit(cur.data, { review: { on, note: note.trim(), since: on ? (cur.data.review.on ? cur.data.review.since ?? today : today) : cur.data.review.since } });
    const rec = new Recorder();
    await rec.capture(id, d);
    await writeObligation(id, data, d);
    return { undo: await rec.seal(d) };
  });
}

// ---- lifecycle: pause, resume, end, reopen ----

export type LifecycleAction = 'pause' | 'resume' | 'end' | 'reopen';
export interface LifecycleOptions { today: string; /** pause: the first paused day; resume and reopen: the day it is expected again; end: the last day */ date?: string; reason?: EndReason }
export interface LifecyclePlan { obligation: ObligationRecord; next: ObligationData | null; problem: string | null; lines: string[]; expect: number }

const dayWords = (iso: string) => iso;

/** Pure: what the action would do to a record, in plain words, and the record it would write. Nothing is written. */
export function buildLifecycle(ob: ObligationData, action: LifecycleAction, o: LifecycleOptions): { next: ObligationData | null; problem: string | null; lines: string[] } {
  const none = (problem: string) => ({ next: null, problem, lines: [] as string[] });
  if (ob.status === 'unsupported') return none('This record has a status this version of Ledger does not understand, so it cannot be paused, ended or reopened here. Edit its other details, or open it in a newer version.');
  const date = o.date ?? o.today;
  const upcoming = (from: string) => expectedDates(scheduleSource(ob), from, addDays(addMonths(from, 12), -1)).length; // the same 12-month window the figures use
  const keep = 'Nothing in Finance, Tasks or the Calendar is changed, and nothing is deleted.';

  if (action === 'pause') {
    if (ob.status !== 'active') return none(ob.status === 'paused' ? 'It is already paused.' : 'An ended bill cannot be paused. Reopen it first.');
    const n = upcoming(date);
    return {
      problem: null,
      next: withLog({ ...ob, status: 'paused', pauses: [...ob.pauses, { from: date, to: null }] }, o.today, 'paused'),
      lines: [
        `Pause "${ob.title}" from ${dayWords(date)}.`,
        n > 0 ? `${n} expected date${n === 1 ? '' : 's'} in the next 12 months will be left out of the previews and the commitment figures until you resume.` : 'It has no expected dates in the next 12 months, so no figure changes.',
        'Dates before the pause stay as they are.',
        keep,
      ],
    };
  }
  if (action === 'resume') {
    if (ob.status !== 'paused') return none('It is not paused.');
    const open = ob.pauses.findIndex((p) => p.to === null);
    const pauses = ob.pauses.map((p, i) => (i === open ? { ...p, to: date < p.from ? p.from : date } : p));
    return {
      problem: null,
      next: withLog({ ...ob, status: 'active', pauses }, o.today, 'resumed'),
      lines: [
        `Resume "${ob.title}". Expected dates return from ${dayWords(date)}.`,
        'The paused time stays without expected dates: nothing is caught up and no bills appear as missed.',
        keep,
      ],
    };
  }
  if (action === 'end') {
    if (ob.status === 'ended') return none('It has already ended.');
    if (date < ob.trackingSince) return none('The end date is before the tracking start date.');
    const reason = o.reason ?? 'cancelled';
    const pauses = ob.pauses.map((p) => (p.to === null ? { ...p, to: addDays(date, 1) < p.from ? p.from : addDays(date, 1) } : p));
    const n = upcoming(addDays(date, 1));
    return {
      problem: null,
      next: withLog({ ...ob, status: 'ended', endedOn: date, endReason: reason, pauses }, o.today, 'ended', reason),
      lines: [
        `End "${ob.title}" on ${dayWords(date)}. Reason: ${reason}.`,
        date > o.today ? `It is still expected until ${dayWords(date)}.` : 'No expected dates after that day.',
        n > 0 ? `${n} expected date${n === 1 ? '' : 's'} in the next 12 months will be left out.` : 'No expected date in the next 12 months is affected.',
        ob.status === 'paused' ? 'The open pause is closed at the end date.' : 'Everything recorded stays, and it appears under Ended. You can reopen it later.',
        keep,
      ],
    };
  }
  // reopen
  if (ob.status !== 'ended') return none('It has not ended.');
  const gapFrom = ob.endedOn ? addDays(ob.endedOn, 1) : date;
  const pauses = date > gapFrom ? [...ob.pauses, { from: gapFrom, to: date }] : ob.pauses;
  return {
    problem: null,
    next: withLog({ ...ob, status: 'active', endedOn: null, endReason: null, pauses }, o.today, 'reopened'),
    lines: [
      `Reopen "${ob.title}". It is active again and expected from ${dayWords(date)}.`,
      date > gapFrom ? `The time it was ended (${dayWords(gapFrom)} to ${dayWords(addDays(date, -1))}) stays without expected dates, so no bills appear as missed.` : 'It was ended only briefly, so no gap is kept.',
      keep,
    ],
  };
}

/** The preview for a lifecycle action. Reads only. */
export async function planLifecycle(id: number, action: LifecycleAction, o: LifecycleOptions, d: FinanceDB = db): Promise<LifecyclePlan> {
  const ob = await getObligation(id, d);
  if (!ob) throw new Error('That bill no longer exists.');
  const built = buildLifecycle(ob.data, action, o);
  const lines = [...built.lines];
  if (built.next) {
    // what the bill's reminder Tasks would do after this change (B2): said in words before anything is written
    const after: ObligationRecord = { ...ob, data: built.next };
    const tasks = (await loadBillTasks(d)).filter((t) => markersOf(t)?.obligation === id);
    const plan = planBillTasks(after, planningPeriods(after, await cycleRecordsOf(id, d), o.today, await financeLookupFor(d, [id])), tasks, o.today);
    const n = (c: number, one: string, many: string) => `${c} ${c === 1 ? one : many}`;
    if (plan.retire.length) lines.push(`${n(plan.retire.length, 'reminder Task that Bills made and you have not changed will be removed (it stands', 'reminder Tasks that Bills made and you have not changed will be removed (they stand')} for something no longer expected). It can be restored, and Undo brings it back.`);
    if (plan.stale.length) lines.push(`${n(plan.stale.length, 'reminder Task you changed stays open and will be listed for a look. It is not removed.', 'reminder Tasks you changed stay open and will be listed for a look. They are not removed.')}`);
    for (const w of plan.create) lines.push(`A reminder Task will be made: "${w.title}", for ${w.doOn}${w.due ? ` (the bill is due ${w.due})` : ''}.`);
    if (plan.retire.length === 0 && plan.stale.length === 0 && built.next.status !== 'active') lines.push('No reminder Task is made for a paused or ended bill, and finished Tasks are never touched.');
  }
  return { obligation: ob, expect: ob.updatedAt, ...built, lines };
}

/** Does the action in ONE transaction, refusing if the record changed since the preview (`expect`). Returns an Undo. */
export function applyLifecycle(input: { id: number; action: LifecycleAction; expect: number | null } & LifecycleOptions, d: FinanceDB = db): Promise<{ undo: Undo }> {
  return inBillsTx(d, tables(d), [input.id], async (lookup) => {
    const ob = await getObligation(input.id, d);
    if (!ob) throw new Error('That bill no longer exists. Nothing was changed.');
    if (input.expect !== null && ob.updatedAt !== input.expect) throw new Error('This record was changed (maybe on another device) since you opened this. Close it, look again and redo your change. Nothing was changed.');
    const plan = buildLifecycle(ob.data, input.action, input);
    if (!plan.next) throw new Error(plan.problem ?? 'Nothing to do.');
    const rec = new Recorder();
    await rec.capture(input.id, d);
    await writeObligation(input.id, plan.next, d);
    // resuming or reopening may bring back the bill's reminder Task (pausing and ending never touch existing Tasks)
    await ensureBillTasksIn(input.id, input.today, d, lookup, rec);
    return { undo: await rec.seal(d) };
  });
}

// ---- delete (only when it never had anything) ----

export interface DeletePlan { allowed: boolean; reasons: string[]; lines: string[]; expect: number }

/** Billing-period records (B2) that point at an obligation, readable or not. B1 writes none; a restore or another device may bring some. */
export async function cycleRowsOf(id: number, d: FinanceDB = db): Promise<ModuleRecord[]> {
  return (await d.moduleRecords.where('[module+kind]').equals([MODULE, 'cycle']).toArray()).filter((r) => isLive(r) && (r.data as { obligationId?: unknown } | undefined)?.obligationId === id);
}

export async function planDelete(id: number, d: FinanceDB = db): Promise<DeletePlan> {
  const ob = await getObligation(id, d);
  if (!ob) throw new Error('That bill no longer exists.');
  const reasons = historyReasons(ob.data);
  const cycles = await cycleRowsOf(id, d);
  if (cycles.length) reasons.push(`${cycles.length} billing-period record${cycles.length === 1 ? '' : 's'} refer to it`);
  const links = await createStore(d).shared.links.linkedTo(obligationRef(id));
  // a Task link counts only while its Task is still there: a Task the owner deleted leaves its link row behind, and that is not history
  let taskLinks = 0, deadTaskLinks = 0;
  for (const l of links) if (l.fromModule === 'tasks') { const t = await d.moduleRecords.get(Number(l.fromId)); if (t && isLive(t)) taskLinks++; else deadTaskLinks++; }
  const otherLinks = links.length - taskLinks - deadTaskLinks;
  if (taskLinks) reasons.push(`${taskLinks} reminder Task${taskLinks === 1 ? ' is' : 's are'} linked to it`);
  if (otherLinks > 0) reasons.push(`${otherLinks} link${otherLinks === 1 ? '' : 's'} to other records refer to it`);
  return {
    allowed: reasons.length === 0, reasons, expect: ob.updatedAt,
    lines: reasons.length === 0
      ? [`Delete "${ob.data.title}". It has no history, so only this record is removed. Its provider Contact is kept.`, 'Nothing in Finance, Tasks or the Calendar is changed.']
      : [`"${ob.data.title}" cannot be deleted because ${reasons.join('; ')}.`, 'End it instead: it stops appearing in expected dates and figures, and keeps its history.'],
  };
}

export function deleteObligation(id: number, expect: number | null, d: FinanceDB = db): Promise<{ undo: Undo }> {
  return d.transaction('rw', ...tables(d), async () => {
    const plan = await planDelete(id, d);
    if (!plan.allowed) throw new Error(plan.lines[0]);
    if (expect !== null && plan.expect !== expect) throw new Error('This record was changed (maybe on another device) since you opened it. Look again and redo your change. Nothing was deleted.');
    const rec = new Recorder();
    await rec.capture(id, d);
    await rows(d).remove(id);
    return { undo: await rec.seal(d) };
  });
}

export { firstAmountCents };
