/**
 * Logging, editing and finding visits (S2). The one place that writes visit records.
 *
 * "Done, log it", Skip and Cancel each run in ONE transaction: the Task is finished through the ordinary `completeTask`, the next visit
 * Task is brought back to the arrangement's own cadence, and the durable visit is written. If any step fails, Dexie rolls the whole
 * transaction back, so there is never a finished Task without a visit or the other way round.
 *
 * Authority (S0 6.6): the ARRANGEMENT's cadence and anchor date decide later dates. A visit Task that was moved once never shifts them.
 * Dates come only from the existing `generateDates` (through `nextCadenceDate`) and, for "repeat after each visit", Tasks' own
 * `nextDueDate`. There is no second recurrence engine.
 *
 * Nothing here touches Finance. The amount charged is information only.
 */
import { db, type FinanceDB } from '../../db';
import type { Link } from '../../core/entities';
import { createStore, isLive } from '../../core/store';
import { dayLabel } from '../../core/time';
import { addDays } from '../../lib/dates';
import { daysBetween } from '../../lib/money';
import { completeTask, createTask, getTask, removeTasks, saveTask } from '../tasks/data';
import { nextDueDate } from '../tasks/recur';
import { blankTask, type TaskRecord } from '../tasks/model';
import { parseAssetRef } from '../assets/model';
import { Recorder, STALE, type Undo } from './changes';
import {
  assetExists, bookingTasksOf, ensureNextVisitTaskIn, getArrangement, linkedAssetIds, resolveProvider, rows, tables, tasksOfArrangement, type ProviderInput,
} from './data';
import { arrangementRef, ASSET_LINK, MODULE, nextCadenceDate, tidy, type ArrangementData, type ArrangementRecord, type DocRef } from './model';
import { isBooking, markersOf, withMarkers, withPurpose } from './schedule';
import {
  asVisit, blankVisit, byDateDesc, normalizeVisit, statusWords, UNSUPPORTED, validateVisit, visitRef, VISIT_KIND, type CancelledBy, type ChargeKind, type VisitData, type VisitRecord, type VisitStatus,
} from './visitModel';

const dl = (s: string | null) => (s ? dayLabel(s, { weekday: 'short', year: true }) : 'no date');
const p2 = (n: number) => String(n).padStart(2, '0');
/** The local calendar date of a moment (when a Task was finished). */
export const isoOfMs = (ms: number) => { const x = new Date(ms); return `${x.getFullYear()}-${p2(x.getMonth() + 1)}-${p2(x.getDate())}`; };

// ---- reading ----

export async function loadVisits(d: FinanceDB = db): Promise<VisitRecord[]> {
  return (await d.moduleRecords.where('[module+kind]').equals([MODULE, VISIT_KIND]).toArray()).filter(isLive).map(asVisit).sort(byDateDesc);
}
export async function getVisit(id: number, d: FinanceDB = db): Promise<VisitRecord | undefined> {
  const r = await d.moduleRecords.get(id);
  return r && r.module === MODULE && r.kind === VISIT_KIND && isLive(r) ? asVisit(r) : undefined;
}

// ---- visit -> asset links ----

const isAssetLink = (l: Link) => l.type === ASSET_LINK && l.toModule === 'assets';
export async function visitAssetIds(visitId: number, d: FinanceDB = db): Promise<number[]> {
  const links = await createStore(d).shared.links.linkedTo(visitRef(visitId));
  return [...new Set(links.filter((l) => isAssetLink(l) && l.fromModule === MODULE && l.fromId === `visit:${visitId}`).map((l) => parseAssetRef(l.toId)).filter((x): x is number => x !== null))];
}
/** Makes the visit's `serves` links match `want`. `strict`: an asset that no longer exists is an error; otherwise it is skipped. */
export async function syncVisitAssetLinks(visitId: number, want: number[], strict: boolean, d: FinanceDB): Promise<void> {
  const store = createStore(d);
  const wanted = new Set(want);
  for (const l of await store.shared.links.linkedTo(visitRef(visitId))) {
    if (!isAssetLink(l) || l.fromId !== `visit:${visitId}`) continue;
    const a = parseAssetRef(l.toId);
    if (a !== null && !wanted.has(a)) await store.shared.links.remove(l.id as number);
  }
  for (const id of wanted) {
    if (!(await assetExists(id, d))) { if (strict) throw new Error('An asset you picked no longer exists. Nothing was changed.'); continue; }
    await store.shared.links.add(visitRef(visitId), { module: 'assets', id: `asset:${id}` }, ASSET_LINK);
  }
}

// ---- the next visit, anchored to the arrangement's cadence (pure) ----

/**
 * The date of the next visit after one is finished, skipped or cancelled. Pure.
 *  - fixed cadence: the first cadence date AFTER both the occurrence just dealt with and the day it was dealt with, and not before today.
 *    So moving one visit never shifts later ones, finishing early does not repeat the same date, and finishing late does not create a
 *    backlog of missed visits.
 *  - repeat-after-each-visit ("N months after each visit"): counted from the visit's OWN date, with Tasks' own `nextDueDate`.
 *      completed: the service date (never later than today, which validation guarantees), so a visit done early or late re-bases the cycle.
 *      skipped or cancelled: nothing was serviced, so the day it was RECORDED must not stand in for a service date. The intended
 *      occurrence (the visit's date, past or future) is the anchor instead: a visit due on 23 Nov and cancelled on 6 Nov counts from 23 Nov.
 *      If that already lies in the past (a missed visit recorded late) the next one is due today, never earlier (no backlog).
 * Returns null when there is no schedule, the arrangement is not active, or the schedule has ended.
 */
export function nextAfterVisit(a: ArrangementData, v: { status?: VisitStatus; occurrence: string | null; taskDue: string | null; visitDate: string; today: string }): string | null {
  const c = a.cadence;
  if (!c || a.status !== 'active') return null;
  const base = v.visitDate < v.today ? v.visitDate : v.today;
  if (c.mode === 'after') {
    const next = nextDueDate(null, { mode: 'after', rule: c.rule }, v.visitDate);
    return next && v.status && v.status !== 'completed' && next < v.today ? v.today : next;
  }
  // The occurrence just dealt with; a skipped or cancelled visit dated in the future also passes over that later date.
  const occ = v.occurrence ?? v.taskDue ?? base;
  const after = [occ, v.visitDate, base].reduce((x, y) => (y > x ? y : x));
  const from = addDays(after, 1) > v.today ? addDays(after, 1) : v.today;
  return nextCadenceDate(c, from);
}

// ---- input and planning ----

export interface VisitInput {
  title?: string;
  status: VisitStatus;
  cancelledBy: CancelledBy | null;
  date: string;
  endDate?: string | null;
  notes?: string;
  chargedCents: number | null;
  chargeKind: ChargeKind | null;
  refs?: DocRef[];
}
export interface LogExpect { taskUpdatedAt: number; arrangementUpdatedAt: number }

export interface LogPlan {
  /** Why this cannot be done, in plain words, or null. */
  problem: string | null;
  /** `complete`: the Task is open and will be finished. `late`: it was finished elsewhere and is only being recorded. */
  mode: 'complete' | 'late';
  nextDate: string | null;
  /** The Task that stands for the next visit after this, if Tasks already made one that needs fixing. */
  staleCopyId: number | null;
  lines: string[];
  expect: LogExpect;
  /** The Task's own due date (where Skip and Cancel start the date). */
  taskDue: string | null;
  /** Where a "late" visit's date starts: the day the Task was finished. */
  suggestedDate: string;
}

function buildVisit(a: ArrangementRecord, task: TaskRecord, input: VisitInput): VisitData {
  const m = markersOf(task);
  return normalizeVisit(blankVisit({
    arrangementId: a.id, providerContactId: a.data.providerContactId, providerNameSnapshot: a.data.providerNameSnapshot,
    title: input.title?.trim() || a.data.title, status: input.status, cancelledBy: input.status === 'cancelled' ? input.cancelledBy : null,
    date: input.date, endDate: input.endDate ?? null, notes: input.notes ?? '', chargedCents: input.chargedCents, chargeKind: input.chargedCents === null ? null : input.chargeKind,
    taskId: task.id, occurrence: m.occurrence ?? task.data.dueDate, taskTitleSnapshot: task.data.title, refs: input.refs ?? [],
  }));
}

/** A Tasks-made copy of a finished visit Task that still carries the old "stands for" date. */
function staleCopies(task: TaskRecord, siblings: TaskRecord[]): TaskRecord[] {
  const occ = markersOf(task).occurrence ?? task.data.dueDate;
  return siblings.filter((t) => t.id !== task.id && t.data.status !== 'done' && t.data.recurFrom === task.id && (!occ || !markersOf(t).occurrence || markersOf(t).occurrence! <= occ));
}

/**
 * Works out, from records already read, what logging a visit from a Task would do. Pure, so the preview and the write cannot disagree.
 * `visits` are the live visits (to find one already logged for this Task).
 */
export function planLog(a: ArrangementRecord, task: TaskRecord | undefined, siblings: TaskRecord[], visits: VisitRecord[], input: VisitInput, today: string): Omit<LogPlan, 'expect'> {
  const none = (problem: string): Omit<LogPlan, 'expect'> => ({ problem, mode: 'complete', nextDate: null, staleCopyId: null, lines: [], suggestedDate: today, taskDue: task?.data.dueDate ?? null });
  if (!task) return none('That task is not here any more, or it is not one of this arrangement\'s visit tasks.');
  if (isBooking(task)) return none('That is a reminder to book a visit, not a visit. Finishing it does not log anything.');
  const mode = task.data.status === 'done' ? 'late' : 'complete';
  const suggestedDate = task.data.completedAt ? isoOfMs(task.data.completedAt) : task.data.dueDate ?? today;
  const already = visits.find((v) => v.data.taskId === task.id);
  if (already) return { ...none(`This visit was already logged (${statusWords(already.data).toLowerCase()}, ${dl(already.data.date)}).`), mode, suggestedDate };
  const problem = validateVisit(buildVisit(a, task, input), today);
  if (problem) return { ...none(problem), mode, suggestedDate };
  const m = markersOf(task);
  const nextDate = nextAfterVisit(a.data, { status: input.status, occurrence: m.occurrence, taskDue: task.data.dueDate, visitDate: input.date, today });
  const stale = mode === 'late' ? staleCopies(task, siblings)[0] ?? null : null;
  const lines: string[] = [];
  const word = input.status === 'completed' ? 'completed' : input.status === 'skipped' ? 'skipped' : 'cancelled';
  lines.push(mode === 'complete' ? `"${task.data.title}" will be marked done in Tasks.` : `"${task.data.title}" is already finished in Tasks. It will not be finished again.`);
  lines.push(`A ${word} visit dated ${dl(input.date)} will be saved to the history${input.status === 'completed' ? '' : '. It does not count as service delivered'}.`);
  if (a.data.status !== 'active') lines.push(`The arrangement is ${a.data.status}, so no further visit is scheduled.`);
  else if (!a.data.cadence) lines.push('This arrangement has no regular schedule, so no next visit is scheduled.');
  else if (nextDate === null) lines.push('The schedule has ended, so no further visit is scheduled.');
  else if (mode === 'complete') lines.push(`The next visit will be ${dl(nextDate)}${a.data.visitTime ? ` at ${a.data.visitTime}` : ''}${a.data.cadence.mode === 'after' ? (input.status === 'completed' ? `, counted from the day of this visit` : `, counted from the date this visit was due (${dl(input.date)}), not from today, because nothing was serviced`) : `, from the arrangement's usual pattern`}.`);
  else if (stale) lines.push(`Tasks made a copy for the next visit (${dl(stale.data.dueDate)}). It will move to ${dl(nextDate)}, the arrangement's next usual date.`);
  else lines.push('Nothing else is changed.');
  if (input.chargedCents !== null) lines.push('The amount charged is for your information. It is not recorded as a payment.');
  return { problem: null, mode, nextDate, staleCopyId: stale?.id ?? null, lines, suggestedDate, taskDue: task.data.dueDate };
}

export async function planLogVisit(arrangementId: number, taskId: number, input: VisitInput, today: string, d: FinanceDB = db): Promise<LogPlan> {
  const a = await getArrangement(arrangementId, d);
  if (!a) throw new Error('That arrangement no longer exists.');
  const siblings = await tasksOfArrangement(arrangementId, d);
  const task = siblings.find((t) => t.id === taskId) ?? (await bookingTasksOf(arrangementId, d)).find((t) => t.id === taskId);
  const visits = await loadVisits(d);
  return { ...planLog(a, task, siblings, visits, input, today), expect: { taskUpdatedAt: task?.updatedAt ?? 0, arrangementUpdatedAt: a.updatedAt } };
}

// ---- the write ----

export interface LogRequest { arrangementId: number; taskId: number; input: VisitInput; today: string; expect: LogExpect; assetIds?: number[] }
export interface LogResult { visitId: number; nextTaskId: number | null; nextDate: string | null; mode: 'complete' | 'late'; undo: Undo }

/** Moves a Tasks-made copy (or a task Tasks just spawned) onto the arrangement's own next date. Keeps its id and links. */
async function realign(t: TaskRecord, a: ArrangementRecord, next: string, rec: Recorder, d: FinanceDB): Promise<void> {
  if (!rec.undo.created.includes(t.id)) rec.task(t); // a Task made in this same change is removed by Undo, not restored
  const gap = t.data.startDate && t.data.dueDate ? daysBetween(t.data.startDate, t.data.dueDate) : null;
  const startDate = t.data.startDate ? (gap !== null ? addDays(next, gap) : next) : null;
  await saveTask(t.id, withMarkers({ ...t.data, dueDate: next, startDate, dueTime: a.data.visitTime }, { arrangement: a.id, occurrence: next }), d);
}

/**
 * "Done, log it", "Skip this visit", "Cancel this visit", and logging a Task that was finished elsewhere. ONE transaction, all or nothing.
 * It refuses (changing nothing) if the Task or the arrangement changed since the preview, if the Task is already logged, or if the visit is invalid.
 * Two overlapping calls for the same Task cannot both succeed: the second finds the first's visit and stops.
 */
export function logVisitFromTask(req: LogRequest, d: FinanceDB = db): Promise<LogResult> {
  return d.transaction('rw', ...tables(d), async () => {
    const a = await getArrangement(req.arrangementId, d);
    if (!a) throw new Error('That arrangement no longer exists. Nothing was changed.');
    const siblings = await tasksOfArrangement(a.id, d);
    const task = siblings.find((t) => t.id === req.taskId) ?? (await bookingTasksOf(a.id, d)).find((t) => t.id === req.taskId);
    const visits = await loadVisits(d);
    const plan = planLog(a, task, siblings, visits, req.input, req.today);
    if (plan.problem) throw new Error(`${plan.problem} Nothing was changed.`);
    if (task!.updatedAt !== req.expect.taskUpdatedAt || a.updatedAt !== req.expect.arrangementUpdatedAt) throw new Error(STALE);
    const rec = new Recorder();
    const t0 = task!;
    const data = buildVisit(a, t0, req.input);
    let nextTaskId: number | null = null;
    rec.task(t0);

    if (plan.mode === 'complete') {
      const base = req.input.date < req.today ? req.input.date : req.today;
      const { spawnedId } = await completeTask(t0.id, base, d);
      if (spawnedId !== undefined) {
        rec.made(spawnedId);
        const sp = (await getTask(spawnedId, d))!;
        if (plan.nextDate) { await realign(sp, a, plan.nextDate, rec, d); nextTaskId = spawnedId; }
        else await removeTasks([spawnedId], d); // nothing further is due: the copy Tasks made would only be noise
      } else if (plan.nextDate) {
        const others = siblings.filter((t) => t.id !== t0.id && t.data.status !== 'done');
        if (others.length === 0) {
          const r = await ensureNextVisitTaskIn(a.id, { today: req.today, date: plan.nextDate }, d);
          if (r.kind === 'created') { rec.made(r.taskId); nextTaskId = r.taskId; }
        }
      }
    } else if (plan.staleCopyId !== null) {
      const sp = siblings.find((t) => t.id === plan.staleCopyId)!;
      if (plan.nextDate) { await realign(sp, a, plan.nextDate, rec, d); nextTaskId = sp.id; }
      else { rec.task(sp); await removeTasks([sp.id], d); }
    }

    const visitId = await rows(d).put({ module: MODULE, kind: VISIT_KIND, data: { ...data } });
    rec.made(visitId);
    await syncVisitAssetLinks(visitId, req.assetIds ?? (await linkedAssetIds(a.id, d)), false, d);
    await rec.seal(d);
    return { visitId, nextTaskId, nextDate: plan.nextDate, mode: plan.mode, undo: rec.undo };
  });
}

// ---- a visit with no Task: a one-off job, or a late entry on an ended arrangement ----

export interface StandaloneRequest {
  /** An existing arrangement (even an ended one), or null for a one-off job. */
  arrangementId?: number | null;
  /** The provider, for a one-off job. For an arrangement, its own provider is used. */
  provider?: ProviderInput | null;
  input: VisitInput;
  assetIds?: number[];
  today: string;
  /**
   * Identifies ONE press of the save button (made when the form opens, or when a Quick Add preview is made). Saving twice with the same id
   * saves one visit, so a double click or a repeated submit is harmless. Two separate entries that merely look alike have different ids and
   * are both saved: provider, title and date are not an identity (a cleaner can really come twice in a day).
   */
  operationId?: string;
}
export interface StandaloneResult {
  visitId: number; contactCreated: boolean; contactId: number | null; undo: Undo;
  /** This operation had already been saved: nothing new was written and `visitId` is the earlier one. */
  repeated: boolean;
  /** Another visit with the same provider, title, date and outcome already exists. A warning only: this one was saved too. */
  similarVisitId: number | null;
}

/** Logs a visit without touching any Task and without creating an arrangement or a recurring Task. One transaction. */
export function logStandaloneVisit(req: StandaloneRequest, d: FinanceDB = db): Promise<StandaloneResult> {
  return d.transaction('rw', ...tables(d), async () => {
    const existing = await loadVisits(d);
    if (req.operationId) {
      const same = existing.find((v) => (v.data as unknown as Record<string, unknown>).operationId === req.operationId);
      if (same) return { visitId: same.id, contactCreated: false, contactId: same.data.providerContactId, undo: { arrangements: [], tasks: [], created: [] }, repeated: true, similarVisitId: null };
    }
    let providerId: number | null = null, providerName = '', contactCreated = false, arrangementId: number | null = null, defaultTitle = '';
    let assetIds = req.assetIds;
    if (req.arrangementId != null) {
      const a = await getArrangement(req.arrangementId, d);
      if (!a) throw new Error('That arrangement no longer exists. Nothing was changed.');
      arrangementId = a.id; providerId = a.data.providerContactId; providerName = a.data.providerNameSnapshot; defaultTitle = a.data.title;
      assetIds = assetIds ?? (await linkedAssetIds(a.id, d));
    } else {
      if (!req.provider || (req.provider.contactId == null && !tidy(req.provider.name ?? ''))) throw new Error('Choose or enter the provider. Nothing was changed.');
      const p = await resolveProvider(req.provider, d);
      providerId = p.id; providerName = p.name; contactCreated = p.created;
    }
    const data = normalizeVisit(blankVisit({
      arrangementId, providerContactId: providerId, providerNameSnapshot: providerName, title: req.input.title?.trim() || defaultTitle, status: req.input.status,
      cancelledBy: req.input.status === 'cancelled' ? req.input.cancelledBy : null, date: req.input.date, endDate: req.input.endDate ?? null, notes: req.input.notes ?? '',
      chargedCents: req.input.chargedCents, chargeKind: req.input.chargedCents === null ? null : req.input.chargeKind, refs: req.input.refs ?? [],
    }));
    const problem = validateVisit(data, req.today);
    if (problem) throw new Error(`${problem} Nothing was changed.`);
    const similar = existing.find((v) => v.data.taskId === null && v.data.arrangementId === arrangementId && v.data.providerContactId === providerId
      && v.data.date === data.date && v.data.status === data.status && v.data.title.toLowerCase() === data.title.toLowerCase());
    const rec = new Recorder();
    const visitId = await rows(d).put({ module: MODULE, kind: VISIT_KIND, data: { ...data, ...(req.operationId ? { operationId: req.operationId } : {}) } });
    rec.made(visitId);
    await syncVisitAssetLinks(visitId, assetIds ?? [], req.arrangementId == null, d);
    await rec.seal(d, contactCreated ? providerId : null);
    return { visitId, contactCreated, contactId: providerId, undo: rec.undo, repeated: false, similarVisitId: similar?.id ?? null };
  });
}

// ---- editing history ----

export interface VisitEdit {
  title: string; status: VisitStatus | typeof UNSUPPORTED; cancelledBy: CancelledBy | null; date: string; endDate: string | null; notes: string;
  chargedCents: number | null; chargeKind: ChargeKind | null; refs: DocRef[]; assetIds: number[];
}
/**
 * Saves the descriptive details of a past visit. The provider, the arrangement, the Task and the occurrence it came from are NOT editable
 * (they are history), and unknown fields are kept. Refuses if the record changed since `expectUpdatedAt`.
 * A visit whose stored status this version does not understand can be edited only if `edit.status` stays `unsupported`: then the stored status
 * (and who cancelled) are written back exactly as found. Choosing a real outcome is the only way to convert it, and it is an explicit choice.
 */
export function updateVisit(id: number, edit: VisitEdit, today: string, expectUpdatedAt: number | null = null, d: FinanceDB = db): Promise<void> {
  return d.transaction('rw', ...tables(d), async () => {
    const v = await getVisit(id, d);
    if (!v) throw new Error('That visit no longer exists. Nothing was changed.');
    if (expectUpdatedAt !== null && v.updatedAt !== expectUpdatedAt) throw new Error('This visit was changed (maybe on another device) since you opened it. Close this, look again and redo your change. Nothing was changed.');
    const keepRaw = edit.status === UNSUPPORTED;
    if (keepRaw && v.data.status !== UNSUPPORTED) throw new Error('Pick whether it was completed, skipped or cancelled. Nothing was changed.');
    const { statusRaw: _raw, ...base } = v.data;
    void _raw;
    const next = normalizeVisit({
      ...base, title: edit.title, status: keepRaw ? 'skipped' : edit.status, cancelledBy: edit.status === 'cancelled' ? edit.cancelledBy : null, date: edit.date, endDate: edit.endDate,
      notes: edit.notes, chargedCents: edit.chargedCents, chargeKind: edit.chargedCents === null ? null : edit.chargeKind, refs: edit.refs,
    });
    const problem = validateVisit(next, today);
    if (problem) throw new Error(problem);
    const stored = (await d.moduleRecords.get(id))!.data as Record<string, unknown>;
    if (keepRaw) {
      // write ONLY the descriptive fields over the stored record, so the unknown status and everything else stay exactly as found
      const { title, date, endDate, notes, chargedCents, chargeKind, refs } = next;
      await rows(d).put({ id, module: MODULE, kind: VISIT_KIND, data: { ...stored, title, date, endDate, notes, chargedCents, chargeKind, refs } });
    } else {
      await rows(d).put({ id, module: MODULE, kind: VISIT_KIND, data: { ...stored, ...next } });
    }
    await syncVisitAssetLinks(id, edit.assetIds, false, d);
  });
}

// ---- finished but not logged (read-only) ----

export interface UnloggedItem { arrangementId: number; task: TaskRecord; /** Where the date starts when logging: the day it was finished. */ finishedOn: string; /** Tasks made a copy that still carries the old date marker. */ staleCopy: boolean }

/**
 * Visit Tasks that are finished but have no visit. Read-only: nothing is created or changed. A booking reminder is never listed. A Task is
 * "logged" if ANY live visit names it, so a deleted Task or a visit on another device does not make a false item.
 */
export function unloggedVisits(arrangements: ArrangementRecord[], tasksBy: Map<number, TaskRecord[]>, visits: VisitRecord[]): UnloggedItem[] {
  const logged = new Set(visits.map((v) => v.data.taskId).filter((x): x is number => x !== null));
  const out: UnloggedItem[] = [];
  for (const a of arrangements) {
    const tasks = tasksBy.get(a.id) ?? [];
    for (const t of tasks) {
      if (t.data.status !== 'done' || isBooking(t) || logged.has(t.id)) continue;
      out.push({ arrangementId: a.id, task: t, finishedOn: t.data.completedAt ? isoOfMs(t.data.completedAt) : t.data.dueDate ?? '', staleCopy: staleCopies(t, tasks).length > 0 });
    }
  }
  return out.sort((x, y) => y.finishedOn.localeCompare(x.finishedOn) || x.task.id - y.task.id);
}

// ---- booking reminders ----


/** Makes a "remind me to book" Task for an arrangement. Marked so that finishing it never offers or makes a visit. */
export function addBookingReminder(arrangementId: number, date: string | null, d: FinanceDB = db): Promise<number> {
  return d.transaction('rw', ...tables(d), async () => {
    const a = await getArrangement(arrangementId, d);
    if (!a) throw new Error('That arrangement no longer exists. Nothing was changed.');
    const title = `Book: ${a.data.title}${a.data.providerNameSnapshot ? ` with ${a.data.providerNameSnapshot}` : ''}`;
    const data = withPurpose(withMarkers(blankTask({ title, dueDate: date, contactIds: a.data.providerContactId !== null ? [a.data.providerContactId] : [] }), { arrangement: a.id }), 'book');
    return createTask(data, [arrangementRef(a.id)], d);
  });
}
