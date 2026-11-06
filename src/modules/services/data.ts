/**
 * Reading and writing arrangements, and the ONE function that creates a "next visit" Task (`ensureNextVisitTask`).
 * Writes go through the shared store's `repo` (id, createdAt, updatedAt, soft delete). This module writes arrangements, its own shared links
 * (task -> arrangement `about`, arrangement -> asset `serves`) and Tasks through the ordinary Tasks functions. It never writes to Home & Assets,
 * Finance, Projects or Contacts' structure (a provider is made or found with the existing `findOrCreateContact`).
 */
import { db, type FinanceDB } from '../../db';
import type { Link, ModuleRecord } from '../../core/entities';
import { findOrCreateContact, validEmail, nameKey } from '../../core/contacts';
import { createStore, isLive, repo } from '../../core/store';
import { addDays } from '../../lib/dates';
import { createTask, getTask, saveTask } from '../tasks/data';
import { asTask, blankTask, type TaskRecord } from '../tasks/model';
import { parseAssetRef } from '../assets/model';
import {
  arrangementRef, asArrangement, ASSET_LINK, KIND, MODULE, nextCadenceDate, normalizeArrangement, parseArrangementRef, TASK_LINK, tidy,
  validateArrangement, type ArrangementData, type ArrangementRecord,
} from './model';
import { isBooking, markersOf, nearestCadenceDate, openOf, taskRepeatOf, withMarkers } from './schedule';

export const rows = (d: FinanceDB) => repo<ModuleRecord>(d.moduleRecords);
/** Every table an arrangement operation may touch. Operations that can create a provider also include `d.contacts`. */
export const tables = (d: FinanceDB) => [d.moduleRecords, d.links, d.contacts] as const;

export async function loadArrangements(d: FinanceDB = db): Promise<ArrangementRecord[]> {
  return (await d.moduleRecords.where('[module+kind]').equals([MODULE, KIND]).toArray()).filter(isLive).map(asArrangement)
    .sort((a, b) => a.data.title.localeCompare(b.data.title) || a.id - b.id);
}
export async function getArrangement(id: number, d: FinanceDB = db): Promise<ArrangementRecord | undefined> {
  const r = await d.moduleRecords.get(id);
  return r && r.module === MODULE && r.kind === KIND && isLive(r) ? asArrangement(r) : undefined;
}

/** Writes an arrangement record (keeps fields this code does not know). Validates strictly. */
export async function writeArrangement(id: number | undefined, data: ArrangementData, d: FinanceDB = db): Promise<number> {
  const clean = normalizeArrangement(data);
  const problem = validateArrangement(clean);
  if (problem) throw new Error(problem);
  return rows(d).put({ ...(id !== undefined ? { id } : {}), module: MODULE, kind: KIND, data: { ...clean } });
}

// ---- links ----

const isTaskEnd = (l: Link, arrId: number) => l.type === TASK_LINK && l.fromModule === 'tasks' && l.toModule === MODULE && l.toId === `arrangement:${arrId}`;

/** The live VISIT Tasks linked to an arrangement (any status). A task deleted since is not returned. Booking reminders are not visit tasks. */
export async function tasksOfArrangement(arrId: number, d: FinanceDB = db): Promise<TaskRecord[]> {
  return (await linkedTasks(arrId, d)).filter((t) => !isBooking(t));
}
/** The "remind me to book" Tasks linked to an arrangement. Finishing one is not a visit. */
export async function bookingTasksOf(arrId: number, d: FinanceDB = db): Promise<TaskRecord[]> {
  return (await linkedTasks(arrId, d)).filter(isBooking);
}
/** Every live Task linked to an arrangement (any status, any purpose). */
async function linkedTasks(arrId: number, d: FinanceDB): Promise<TaskRecord[]> {
  const links = await createStore(d).shared.links.linkedTo(arrangementRef(arrId));
  const out: TaskRecord[] = [];
  const seen = new Set<number>();
  for (const l of links) {
    if (!isTaskEnd(l, arrId)) continue;
    const id = Number(l.fromId);
    if (seen.has(id)) continue;
    seen.add(id);
    const t = await getTask(id, d);
    if (t) out.push(t);
  }
  return out.sort((a, b) => (a.data.dueDate ?? '9999').localeCompare(b.data.dueDate ?? '9999') || a.id - b.id);
}
export async function linkedAssetIds(arrId: number, d: FinanceDB = db): Promise<number[]> {
  const links = await createStore(d).shared.links.linkedTo(arrangementRef(arrId));
  return [...new Set(links.flatMap((l) => (l.type === ASSET_LINK && l.fromModule === MODULE && l.toModule === 'assets' ? [parseAssetRef(l.toId)] : [])).filter((x): x is number => x !== null))];
}
export async function assetExists(id: number, d: FinanceDB): Promise<boolean> {
  const r = await d.moduleRecords.get(id);
  return !!r && r.module === 'assets' && r.kind === 'asset' && isLive(r);
}
/** Makes the arrangement's `serves` links match exactly `want`. Links to assets that are gone are left alone unless unticked. Idempotent. */
export async function syncAssetLinks(arrId: number, want: number[], d: FinanceDB = db): Promise<void> {
  const store = createStore(d);
  const wanted = new Set(want);
  const links = (await store.shared.links.linkedTo(arrangementRef(arrId))).filter((l) => l.type === ASSET_LINK && l.fromModule === MODULE && l.toModule === 'assets');
  for (const l of links) { const a = parseAssetRef(l.toId); if (a !== null && !wanted.has(a)) await store.shared.links.remove(l.id as number); }
  for (const id of wanted) {
    if (!(await assetExists(id, d))) throw new Error('An asset you picked no longer exists. Nothing was changed.');
    await store.shared.links.add(arrangementRef(arrId), { module: 'assets', id: `asset:${id}` }, ASSET_LINK);
  }
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

/** Does a live contact with this name already exist? (For the form's "existing contact" hint.) */
export const sameName = nameKey;

// ---- the one function that makes a "next visit" Task ----

export type EnsureKind = 'created' | 'reused' | 'none';
export interface EnsureResult { kind: EnsureKind; taskId: number | null; /** other open visit tasks found (never touched) */ duplicates: number[]; date: string | null; reason?: string }
export interface EnsureOptions {
  today: string;
  /** For an arrangement with no regular schedule: the date of the one visit to schedule. With a schedule, a date other than a cadence date is recorded as a one-time move. */
  date?: string | null;
  time?: string | null;
}

export const visitTaskTitle = (a: ArrangementData) => (a.providerNameSnapshot ? `${a.title}: ${a.providerNameSnapshot}` : a.title);

/** The date (and the cadence date it stands for) the next visit Task would get. Pure. Never on or before a visit already finished. */
export function planNextVisit(a: ArrangementData, tasks: TaskRecord[], opts: { today: string; date?: string | null }): { due: string | null; occurrence: string | null; reason?: string } {
  const c = a.cadence;
  if (!c && !opts.date) return { due: null, occurrence: null, reason: 'There is no schedule and no date to schedule.' };
  const doneMarks = tasks.filter((t) => t.data.status === 'done').map((t) => markersOf(t).occurrence).filter((x): x is string => !!x).sort();
  const lastDone = doneMarks.length ? doneMarks[doneMarks.length - 1] : null;
  const from = lastDone && addDays(lastDone, 1) > opts.today ? addDays(lastDone, 1) : opts.today;
  if (!c) return { due: opts.date ?? null, occurrence: opts.date ?? null };
  if (opts.date) return { due: opts.date, occurrence: nearestCadenceDate(c, opts.date) };
  const next = nextCadenceDate(c, from);
  return next ? { due: next, occurrence: next } : { due: null, occurrence: null, reason: 'The schedule has ended.' };
}

/**
 * Creates the ONE open Task that stands for an arrangement's next visit, unless one already exists. Must run inside a transaction on
 * moduleRecords + links: it first RE-READS the live linked Tasks, so two overlapping calls (a double click, React running an effect twice)
 * cannot both create one. It never deletes or edits an existing Task; if more than one is already open it reports the extras.
 */
export async function ensureNextVisitTaskIn(arrId: number, opts: EnsureOptions, d: FinanceDB): Promise<EnsureResult> {
  const a = await getArrangement(arrId, d);
  if (!a) throw new Error('That arrangement no longer exists.');
  const tasks = await tasksOfArrangement(arrId, d);
  const open = openOf(tasks);
  if (open.length > 0) return { kind: 'reused', taskId: open[0].id, duplicates: open.slice(1).map((t) => t.id), date: open[0].data.dueDate };
  if (a.data.status !== 'active') return { kind: 'none', taskId: null, duplicates: [], date: null, reason: `The arrangement is ${a.data.status}.` };
  const c = a.data.cadence;
  const plan = planNextVisit(a.data, tasks, opts);
  if (!plan.due) return { kind: 'none', taskId: null, duplicates: [], date: null, reason: plan.reason };
  const { due, occurrence } = plan;
  const time = opts.time !== undefined ? opts.time : a.data.visitTime;
  const data = withMarkers(
    blankTask({
      title: visitTaskTitle(a.data), dueDate: due, dueTime: time && due ? time : null,
      repeat: c ? taskRepeatOf(c) : null, contactIds: a.data.providerContactId !== null ? [a.data.providerContactId] : [],
    }),
    { arrangement: arrId, ...(occurrence ? { occurrence } : {}) },
  );
  const taskId = await createTask(data, [arrangementRef(arrId)], d);
  await rows(d).put({ id: arrId, module: MODULE, kind: KIND, data: { ...a.data, openTaskId: taskId } });
  return { kind: 'created', taskId, duplicates: [], date: due };
}
/** `ensureNextVisitTaskIn` in its own transaction. */
export function ensureNextVisitTask(arrId: number, opts: EnsureOptions, d: FinanceDB = db): Promise<EnsureResult> {
  return d.transaction('rw', ...tables(d), async () => ensureNextVisitTaskIn(arrId, opts, d));
}

// ---- creating and editing ----

export interface NewArrangement {
  data: ArrangementData;
  /** The provider: an existing contact, or a name to find/create. Omit for "no provider yet". */
  provider?: ProviderInput | null;
  assetIds?: number[];
  /** Create the first visit Task now (only when there is a schedule). */
  scheduleFirstVisit?: boolean;
  today: string;
}
export interface Created { id: number; taskId: number | null; contactCreated: boolean; contactId: number | null }

/** Adds an arrangement (and, when asked and it has a schedule, its one visit Task) in one transaction: all or nothing. */
export function createArrangement(input: NewArrangement, d: FinanceDB = db): Promise<Created> {
  return d.transaction('rw', ...tables(d), async () => {
    let data = input.data;
    let contact: ResolvedProvider | null = null;
    if (input.provider && (input.provider.contactId != null || tidy(input.provider.name ?? ''))) {
      contact = await resolveProvider(input.provider, d);
      data = { ...data, providerContactId: contact.id, providerNameSnapshot: contact.name };
    }
    const id = await writeArrangement(undefined, { ...data, openTaskId: null }, d);
    await syncAssetLinks(id, input.assetIds ?? [], d);
    let taskId: number | null = null;
    if (input.scheduleFirstVisit !== false && data.cadence && data.status === 'active') taskId = (await ensureNextVisitTaskIn(id, { today: input.today }, d)).taskId;
    return { id, taskId, contactCreated: contact?.created ?? false, contactId: contact?.id ?? null };
  });
}

export interface ArrangementEdit {
  title: string;
  startDate: string | null;
  extraContactIds: number[];
  expected: ArrangementData['expected'];
  refs: ArrangementData['refs'];
  notes: string;
  /** Only used when the arrangement has no provider yet. Changing an existing provider is "Replace provider". */
  assignProvider?: ProviderInput | null;
  assetIds: number[];
}
/** Saves the descriptive fields. The schedule, status and provider are changed only by their own dialogs. Refuses if the record changed since `expectUpdatedAt`. */
export function updateArrangement(id: number, edit: ArrangementEdit, expectUpdatedAt: number | null = null, d: FinanceDB = db): Promise<void> {
  return d.transaction('rw', ...tables(d), async () => {
    const a = await getArrangement(id, d);
    if (!a) throw new Error('That arrangement no longer exists. Nothing was changed.');
    if (expectUpdatedAt !== null && a.updatedAt !== expectUpdatedAt) throw new Error('This arrangement was changed (maybe on another device) since you opened it. Close this, look again and redo your change. Nothing was changed.');
    let data: ArrangementData = { ...a.data, title: edit.title, startDate: edit.startDate, extraContactIds: edit.extraContactIds, expected: edit.expected, refs: edit.refs, notes: edit.notes };
    if (a.data.providerContactId === null && edit.assignProvider && (edit.assignProvider.contactId != null || tidy(edit.assignProvider.name ?? ''))) {
      const p = await resolveProvider(edit.assignProvider, d);
      data = { ...data, providerContactId: p.id, providerNameSnapshot: p.name };
    }
    await writeArrangement(id, data, d);
    await syncAssetLinks(id, edit.assetIds, d);
  });
}

/** Saves a changed Task and keeps the markers it already had (a helper for fixes that rewrite parts of a Task). */
export async function saveTaskKeepingMarkers(taskId: number, change: (t: TaskRecord) => TaskRecord['data'], d: FinanceDB): Promise<void> {
  const t = await getTask(taskId, d);
  if (!t) throw new Error('A visit task was deleted since you opened this. Nothing was changed.');
  await saveTask(taskId, change(t), d);
}

/** Re-reads one stored record as a Task (for tests and fixes). */
export const taskFromRecord = asTask;
export { parseArrangementRef };
