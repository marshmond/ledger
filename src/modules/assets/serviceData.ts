/**
 * Reading and writing service records. Writes go through the shared store's `repo` (id, createdAt, updatedAt, soft delete).
 * Home & Assets is the only writer of service records. This file never writes to Finance, Projects or Contacts, and touches a Task only
 * through Tasks' own `completeTask` (inside one transaction, see `logTaskService`).
 */
import { db, type FinanceDB } from '../../db';
import type { ModuleRecord } from '../../core/entities';
import { createStore, isLive, repo } from '../../core/store';
import { todayISO } from '../../lib/money';
import { completeTask, getTask } from '../tasks/data';
import { getAsset, linksToAsset } from './data';
import { completionBasis } from './maintenance';
import { MODULE } from './model';
import { newRefsProblem } from './txnLookup';
import { asService, normalizeService, SERVICE_KIND, serviceRefId, validateService, type ServiceData, type ServiceRecord } from './service';

const rows = (d: FinanceDB) => repo<ModuleRecord>(d.moduleRecords);

/** Thrown when a task already has its service record. `existingId` lets the screen offer to open it. */
export class DuplicateServiceError extends Error {
  constructor(public existingId: number) { super('That task was already saved to service history.'); this.name = 'DuplicateServiceError'; }
}

const newestFirst = (a: ServiceRecord, b: ServiceRecord) => b.data.date.localeCompare(a.data.date) || b.createdAt - a.createdAt || b.id - a.id;

export async function loadServices(d: FinanceDB = db): Promise<ServiceRecord[]> {
  return (await d.moduleRecords.where('[module+kind]').equals([MODULE, SERVICE_KIND]).toArray()).filter(isLive).map(asService).sort(newestFirst);
}
export async function loadServicesFor(assetId: number, d: FinanceDB = db): Promise<ServiceRecord[]> {
  return (await loadServices(d)).filter((s) => s.data.assetId === assetId);
}
export async function getService(id: number, d: FinanceDB = db): Promise<ServiceRecord | undefined> {
  const r = await d.moduleRecords.get(id);
  return r && r.module === MODULE && r.kind === SERVICE_KIND && isLive(r) ? asService(r) : undefined;
}

async function liveContactIds(d: FinanceDB): Promise<Set<number>> {
  return new Set((await d.contacts.toArray()).filter(isLive).map((c) => c.id as number));
}

/** Checks and stores a new record. Must run inside a transaction over moduleRecords, links and contacts. */
async function insertService(input: ServiceData, d: FinanceDB, today: string, refProblem: string | null = null): Promise<number> {
  if (refProblem) throw new Error(refProblem);
  const asset = await getAsset(input.assetId, d);
  if (!asset) throw new Error('That asset no longer exists.');
  if (asset.data.archived) throw new Error('That asset is archived. Restore it from the Archived tab before adding service history.');
  const data = normalizeService(input);
  const contacts = await liveContactIds(d);
  const problem = validateService(data, { today, contactExists: (id) => contacts.has(id) });
  if (problem) throw new Error(problem);
  if (data.taskId !== null) {
    const dup = (await loadServices(d)).find((s) => s.data.taskId === data.taskId);
    if (dup) throw new DuplicateServiceError(dup.id);
  }
  return rows(d).put({ module: MODULE, kind: SERVICE_KIND, data: { ...data } });
}

/** Creates a service record (any work done, with or without a task). Returns the new id. */
export async function createService(data: ServiceData, d: FinanceDB = db, today: string = todayISO()): Promise<number> {
  const refProblem = await newRefsProblem(data.txnRefs, [], d);
  return d.transaction('rw', d.moduleRecords, d.links, d.contacts, () => insertService(data, d, today, refProblem));
}

/**
 * Saves changes to a record. The asset, the task it came from and the task-title snapshot cannot be changed here. Unknown fields are kept.
 * A provider that was removed from Contacts is not an error if you leave it as it was.
 */
export async function updateService(id: number, data: ServiceData, d: FinanceDB = db, today: string = todayISO()): Promise<void> {
  const refProblem = await newRefsProblem(data.txnRefs, (await getService(id, d))?.data.txnRefs ?? [], d);
  if (refProblem) throw new Error(refProblem);
  await d.transaction('rw', d.moduleRecords, d.contacts, async () => {
    const cur = await getService(id, d);
    if (!cur) throw new Error('That service record no longer exists.');
    const next = normalizeService({ ...data, assetId: cur.data.assetId, taskId: cur.data.taskId, taskTitleSnapshot: cur.data.taskTitleSnapshot });
    const contacts = await liveContactIds(d);
    const problem = validateService(next, { today, contactExists: (c) => contacts.has(c), keepContactId: cur.data.providerContactId });
    if (problem) throw new Error(problem);
    await rows(d).put({ id, module: MODULE, kind: SERVICE_KIND, data: { ...next } });
  });
}

/** Deletes one service record (soft delete; the toast's Undo uses `restoreService`). A task it came from shows as "not yet saved" again. */
export async function deleteService(id: number, d: FinanceDB = db): Promise<void> { await rows(d).remove(id); }
export async function restoreService(id: number, d: FinanceDB = db): Promise<void> {
  await d.transaction('rw', d.moduleRecords, async () => {
    const r = await d.moduleRecords.get(id);
    if (!r || r.module !== MODULE || r.kind !== SERVICE_KIND) return;
    // If another record for the same task was saved meanwhile, restoring gives two; the asset page then shows the duplicate warning.
    await rows(d).restore(id);
  });
}

/**
 * Takes away a record the Add box just made (Undo). Refuses (returns the reason) when anything is linked to it. Only ever touches this one record.
 */
export async function removeNewService(id: number, d: FinanceDB = db): Promise<string | null> {
  return d.transaction('rw', d.moduleRecords, d.links, async () => {
    if (!(await getService(id, d))) return null;
    if ((await createStore(d).shared.links.linkedTo({ module: MODULE, id: serviceRefId(id) })).length) return 'Something is linked to it, so it was kept.';
    await rows(d).remove(id);
    return null;
  });
}

export interface LogTaskInput {
  taskId: number;
  /** What to save. `taskId` and the task-title snapshot are filled in from the task itself, whatever is passed. */
  data: ServiceData;
  /** true: "Done, log it" (complete the task AND save). false: "Save to history" for a task that is already done. */
  complete: boolean;
  /** Today's local date (for the future-date check). */
  today?: string;
}

const taskLinkedToAsset = async (taskId: number, assetId: number, d: FinanceDB) =>
  (await linksToAsset(assetId, d)).some((l) => (l.fromModule === 'tasks' && Number(l.fromId) === taskId) || (l.toModule === 'tasks' && Number(l.toId) === taskId));

/**
 * Saves a service record for a task linked to the asset. ONE database transaction:
 *  - complete = true: re-reads the task, refuses if it is gone or already done, completes it with Tasks' own `completeTask` (which makes the
 *    next repeat and re-adds its links), then writes the service record. If either step fails, neither happened.
 *  - complete = false: the task must still be done (not reopened or deleted); only the service record is written.
 * Either way it refuses if this task already has a service record, so a double click or a second device cannot make two.
 * The repeat basis is `completionBasis` (maintenance.ts): the service date for repeat-after-completion, otherwise today (Tasks' usual behaviour).
 */
export async function logTaskService(input: LogTaskInput, d: FinanceDB = db): Promise<{ serviceId: number; spawnedId?: number }> {
  const today = input.today ?? todayISO();
  const refProblem = await newRefsProblem(input.data.txnRefs, [], d);
  return d.transaction('rw', d.moduleRecords, d.links, d.contacts, async () => {
    const t = await getTask(input.taskId, d);
    if (!t) throw new Error('That task no longer exists, so nothing was saved.');
    if (!(await taskLinkedToAsset(t.id, input.data.assetId, d))) throw new Error('That task is not linked to this asset, so nothing was saved.');
    const dup = (await loadServices(d)).find((s) => s.data.taskId === t.id);
    if (dup) throw new DuplicateServiceError(dup.id);
    let spawnedId: number | undefined;
    if (input.complete) {
      if (t.data.status === 'done') throw new Error('That task is already done (maybe on another screen). Nothing was changed. Use "Save to history" on it instead.');
      ({ spawnedId } = await completeTask(t.id, completionBasis(t, input.data.date, today), d));
    } else if (t.data.status !== 'done') {
      throw new Error('That task is not completed any more (it may have been reopened), so there is nothing to save. Nothing was changed.');
    }
    const serviceId = await insertService({ ...input.data, taskId: t.id, taskTitleSnapshot: t.data.title }, d, today, refProblem);
    return { serviceId, spawnedId };
  });
}
