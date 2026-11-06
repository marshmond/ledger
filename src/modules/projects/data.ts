/**
 * Reading and writing projects and their budget lines. Writes go through the shared store's `repo` (id, createdAt, updatedAt, soft
 * delete), reads are plain queries so screens can wrap them in `useLiveQuery`. Projects never write transactions; the Finance layer
 * (src/lib/txnProject.ts) owns tagging and the spending numbers.
 */
import { db, type FinanceDB } from '../../db';
import type { ModuleRecord } from '../../core/entities';
import { findOrCreateContact, type ContactInput } from '../../core/contacts';
import { isLive, repo } from '../../core/store';
import {
  asBudgetLine, asProject, MODULE, sortLines, type BudgetLineRecord, type ProjectData, type ProjectRecord, type ProjectStatus,
} from './model';
import {
  asCommitment, checkStatusChange, changeOrdersOf, validateCommitment, type CommitmentData, type CommitmentRecord, type CommitmentStatus,
} from './commitmentModel';
import { todayISO } from '../../lib/money';

const rows = (d: FinanceDB) => repo<ModuleRecord>(d.moduleRecords);

// ---- projects ----

export async function loadProjects(d: FinanceDB = db): Promise<ProjectRecord[]> {
  return (await d.moduleRecords.where('[module+kind]').equals([MODULE, 'project']).toArray()).filter(isLive).map(asProject)
    .sort((a, b) => a.data.name.localeCompare(b.data.name) || a.id - b.id);
}

export async function getProject(id: number, d: FinanceDB = db): Promise<ProjectRecord | undefined> {
  const r = await d.moduleRecords.get(id);
  return r && r.module === MODULE && r.kind === 'project' && isLive(r) ? asProject(r) : undefined;
}

export async function createProject(data: ProjectData, d: FinanceDB = db): Promise<number> {
  return rows(d).put({ module: MODULE, kind: 'project', data: { ...data } });
}

/** Saves a whole project (pass what `getProject` gave you, changed). Fields this code does not know travel inside `data` and are kept. */
export async function saveProject(id: number, data: ProjectData, d: FinanceDB = db): Promise<void> {
  if (!(await getProject(id, d))) throw new Error('That project no longer exists.');
  await rows(d).put({ id, module: MODULE, kind: 'project', data: { ...data } });
}

async function change(id: number, patch: (p: ProjectData) => ProjectData, d: FinanceDB) {
  await d.transaction('rw', d.moduleRecords, async () => {
    const p = await getProject(id, d);
    if (!p) throw new Error('That project no longer exists.');
    await rows(d).put({ id, module: MODULE, kind: 'project', data: { ...patch(p.data) } });
  });
}

export const setProjectStatus = (id: number, status: ProjectStatus, d: FinanceDB = db) => change(id, (p) => ({ ...p, status }), d);
/** Hides a project from the normal list without losing anything. Restoring brings it back as it was. */
export const archiveProject = (id: number, d: FinanceDB = db) => change(id, (p) => ({ ...p, archived: true }), d);
export const restoreProject = (id: number, d: FinanceDB = db) => change(id, (p) => ({ ...p, archived: false }), d);

/**
 * Takes away a project record altogether. Only for undoing a project the Add box just made (it has no lines, vendors or spending).
 * Projects you have worked on are archived, never deleted.
 */
export async function removeProjectRecord(id: number, d: FinanceDB = db): Promise<void> {
  if (await getProject(id, d)) await rows(d).remove(id);
}

// ---- vendors (shared contacts) ----

/** Adds a contact to the project. Adding the same one twice does nothing. A contact can be on any number of projects. */
export const addVendor = (projectId: number, contactId: number, d: FinanceDB = db) =>
  change(projectId, (p) => (p.vendorContactIds.includes(contactId) ? p : { ...p, vendorContactIds: [...p.vendorContactIds, contactId] }), d);

/** Takes the contact off this project only. The contact itself, and its other projects, are untouched. */
export const removeVendor = (projectId: number, contactId: number, d: FinanceDB = db) =>
  change(projectId, (p) => ({ ...p, vendorContactIds: p.vendorContactIds.filter((x) => x !== contactId) }), d);

/** Finds or makes the contact (an existing contact with the same name is reused, not duplicated) and puts it on the project. */
export async function addNewVendor(projectId: number, input: ContactInput, d: FinanceDB = db): Promise<{ contactId: number; created: boolean }> {
  const { id, created } = await findOrCreateContact(d, input);
  await addVendor(projectId, id, d);
  return { contactId: id, created };
}

/** The projects a contact is on. */
export async function projectsUsingContact(contactId: number, d: FinanceDB = db): Promise<ProjectRecord[]> {
  return (await loadProjects(d)).filter((p) => p.data.vendorContactIds.includes(contactId));
}

// ---- budget lines ----

export async function loadBudgetLines(projectId: number, d: FinanceDB = db): Promise<BudgetLineRecord[]> {
  return sortLines((await d.moduleRecords.where('[module+kind]').equals([MODULE, 'budgetLine']).toArray()).filter(isLive).map(asBudgetLine).filter((l) => l.data.projectId === projectId));
}

/** Every live line of every project (for the project list). */
export async function loadAllBudgetLines(d: FinanceDB = db): Promise<BudgetLineRecord[]> {
  return (await d.moduleRecords.where('[module+kind]').equals([MODULE, 'budgetLine']).toArray()).filter(isLive).map(asBudgetLine);
}

export async function createLine(projectId: number, name: string, plannedCents: number, d: FinanceDB = db): Promise<number> {
  return d.transaction('rw', d.moduleRecords, async () => {
    if (!(await getProject(projectId, d))) throw new Error('That project no longer exists.');
    const sort = (await loadBudgetLines(projectId, d)).reduce((m, l) => Math.max(m, l.data.sort), 0) + 10;
    return rows(d).put({ module: MODULE, kind: 'budgetLine', data: { projectId, name: name.trim(), plannedCents: Math.round(plannedCents), sort } });
  });
}

export async function getLine(id: number, d: FinanceDB = db): Promise<BudgetLineRecord | undefined> {
  const r = await d.moduleRecords.get(id);
  return r && r.module === MODULE && r.kind === 'budgetLine' && isLive(r) ? asBudgetLine(r) : undefined;
}

export async function saveLine(id: number, patch: { name?: string; plannedCents?: number }, d: FinanceDB = db): Promise<void> {
  await d.transaction('rw', d.moduleRecords, async () => {
    const l = await getLine(id, d);
    if (!l) throw new Error('That budget line no longer exists.');
    await rows(d).put({
      id, module: MODULE, kind: 'budgetLine',
      data: { ...l.data, ...(patch.name !== undefined ? { name: patch.name.trim() } : {}), ...(patch.plannedCents !== undefined ? { plannedCents: Math.round(patch.plannedCents) } : {}) },
    });
  });
}

/**
 * Takes a budget line away. A line that transactions have been tagged to is kept: removing it would leave that spending pointing at
 * nothing. (Nothing tags transactions yet, but the Finance layer already allows it, so the check is here from the start.)
 */
export async function removeLine(id: number, d: FinanceDB = db): Promise<void> {
  await d.transaction('rw', d.moduleRecords, d.txns, async () => {
    const l = await getLine(id, d);
    if (!l) return;
    const commitments = (await loadCommitments(l.data.projectId, d)).filter((c) => c.data.budgetLineId === id).length;
    if (commitments) throw new Error(`${commitments} commitment${commitments === 1 ? ' is' : 's are'} filed under this line, so it cannot be removed. Move them to another line first.`);
    const used = await d.txns.filter((t) => t.project?.budgetLineId === id || (t.splits ?? []).some((s) => s.project?.budgetLineId === id)).count();
    if (used) throw new Error(`${used} transaction${used === 1 ? ' is' : 's are'} tagged to this line, so it cannot be removed. Untag them first.`);
    await rows(d).remove(id);
  });
}

/**
 * Moves a line one place up (-1) or down (+1). Only the lines whose numbers change are written, so two devices reordering different
 * lines do not collide.
 */
export async function moveLine(projectId: number, id: number, dir: -1 | 1, d: FinanceDB = db): Promise<void> {
  await d.transaction('rw', d.moduleRecords, async () => {
    const lines = await loadBudgetLines(projectId, d);
    const from = lines.findIndex((l) => l.id === id);
    const to = from + dir;
    if (from < 0 || to < 0 || to >= lines.length) return;
    const order = [...lines];
    [order[from], order[to]] = [order[to], order[from]];
    for (const [i, l] of order.entries()) {
      const sort = (i + 1) * 10;
      if (l.data.sort !== sort) await rows(d).put({ id: l.id, module: MODULE, kind: 'budgetLine', data: { ...l.data, sort } });
    }
  });
}

// ---- commitments ----

export async function loadCommitments(projectId: number, d: FinanceDB = db): Promise<CommitmentRecord[]> {
  return (await d.moduleRecords.where('[module+kind]').equals([MODULE, 'commitment']).toArray()).filter(isLive).map(asCommitment)
    .filter((c) => c.data.projectId === projectId)
    .sort((a, b) => a.createdAt - b.createdAt || a.id - b.id);
}

export async function getCommitment(id: number, d: FinanceDB = db): Promise<CommitmentRecord | undefined> {
  const r = await d.moduleRecords.get(id);
  return r && r.module === MODULE && r.kind === 'commitment' && isLive(r) ? asCommitment(r) : undefined;
}

/** What a screen can change on a commitment. `amountCents` is signed (a change order may be negative). */
export interface CommitmentFields {
  title: string;
  amountCents: number;
  status: CommitmentStatus;
  /** The agreement a change order changes; null for an agreement or quote. */
  parentId: number | null;
  budgetLineId: number | null;
  vendorContactId: number | null;
  acceptedDate: string | null;
  notes: string;
}

const amountText = (cents: number) => (cents / 100).toFixed(2);

async function checkFields(projectId: number, f: CommitmentFields, editingId: number | undefined, d: FinanceDB) {
  if (!(await getProject(projectId, d))) throw new Error('That project no longer exists.');
  const lines = await loadBudgetLines(projectId, d);
  const all = await loadCommitments(projectId, d);
  const problem = validateCommitment(
    { title: f.title, amount: amountText(f.amountCents), status: f.status, parentId: f.parentId, budgetLineId: f.budgetLineId, acceptedDate: f.acceptedDate ?? '' },
    { lineIds: lines.map((l) => l.id), all, editingId },
  );
  if (problem) throw new Error(problem);
  if (f.vendorContactId !== null) {
    const c = await d.contacts.get(f.vendorContactId);
    if (!c || !isLive(c)) throw new Error('That vendor is not in your contacts any more.');
  }
}

/** The vendor goes on the project's vendor list too (once, no second copy of the contact). Returns true if it was newly added. */
async function ensureProjectVendor(projectId: number, contactId: number | null, d: FinanceDB): Promise<boolean> {
  if (contactId === null) return false;
  const p = await getProject(projectId, d);
  if (!p || p.data.vendorContactIds.includes(contactId)) return false;
  await addVendor(projectId, contactId, d);
  return true;
}

/** Adds a quote, an accepted agreement or a change order. Throws the plain-words problem if it does not hold together. */
export async function createCommitment(projectId: number, f: CommitmentFields, d: FinanceDB = db): Promise<{ id: number; vendorAdded: boolean }> {
  return d.transaction('rw', d.moduleRecords, d.contacts, async () => {
    await checkFields(projectId, f, undefined, d);
    const data: CommitmentData = {
      projectId, budgetLineId: f.budgetLineId, vendorContactId: f.vendorContactId, title: f.title.trim(), status: f.status,
      amountCents: Math.round(f.amountCents), parentId: f.parentId, notes: f.notes,
      acceptedDate: f.status === 'accepted' ? f.acceptedDate || todayISO() : null,
    };
    const id = await rows(d).put({ module: MODULE, kind: 'commitment', data: { ...data } });
    return { id, vendorAdded: await ensureProjectVendor(projectId, f.vendorContactId, d) };
  });
}

/** Saves changes to a commitment. Fields this code does not know travel with the record and are kept. */
export async function saveCommitment(id: number, f: CommitmentFields, d: FinanceDB = db): Promise<{ vendorAdded: boolean }> {
  return d.transaction('rw', d.moduleRecords, d.contacts, async () => {
    const c = await getCommitment(id, d);
    if (!c) throw new Error('That commitment no longer exists.');
    await checkFields(c.data.projectId, f, id, d);
    const data: CommitmentData = {
      ...c.data, budgetLineId: f.budgetLineId, vendorContactId: f.vendorContactId, title: f.title.trim(), status: f.status,
      amountCents: Math.round(f.amountCents), parentId: f.parentId, notes: f.notes,
      acceptedDate: f.status === 'accepted' ? f.acceptedDate || c.data.acceptedDate || todayISO() : c.data.acceptedDate,
    };
    await rows(d).put({ id, module: MODULE, kind: 'commitment', data: { ...data } });
    return { vendorAdded: await ensureProjectVendor(c.data.projectId, f.vendorContactId, d) };
  });
}

/**
 * Moves a commitment between quote, accepted, declined and cancelled. Nothing is deleted: a declined or cancelled one stays on the
 * project, and anything already paid on it stays visible in the totals.
 */
export async function setCommitmentStatus(id: number, status: CommitmentStatus, d: FinanceDB = db): Promise<void> {
  await d.transaction('rw', d.moduleRecords, async () => {
    const c = await getCommitment(id, d);
    if (!c) throw new Error('That commitment no longer exists.');
    const problem = checkStatusChange(c, status, await loadCommitments(c.data.projectId, d));
    if (problem) throw new Error(problem);
    await rows(d).put({ id, module: MODULE, kind: 'commitment', data: { ...c.data, status, acceptedDate: status === 'accepted' ? c.data.acceptedDate ?? todayISO() : c.data.acceptedDate } });
  });
}

/** How many transactions (or splits) are tagged to a commitment. */
export async function transactionsOnCommitment(id: number, d: FinanceDB = db): Promise<number> {
  return d.txns.filter((t) => t.project?.commitmentId === id || (t.splits ?? []).some((s) => s.project?.commitmentId === id)).count();
}

/**
 * Takes a commitment away (it is soft-deleted, so the removal syncs). Refused when money is tagged to it or it has change orders:
 * cancel it instead, which keeps it and the payments visible.
 */
export async function removeCommitment(id: number, d: FinanceDB = db): Promise<void> {
  await d.transaction('rw', d.moduleRecords, d.txns, async () => {
    const c = await getCommitment(id, d);
    if (!c) return;
    const all = await loadCommitments(c.data.projectId, d);
    const changes = changeOrdersOf(c, all).length;
    if (changes) throw new Error(`This has ${changes} change order${changes === 1 ? '' : 's'}. Cancel it instead, or remove the change orders first.`);
    const used = await transactionsOnCommitment(id, d);
    if (used) throw new Error(`${used} transaction${used === 1 ? ' is' : 's are'} tagged to this. Cancel it instead, so what was paid stays visible.`);
    await rows(d).remove(id);
  });
}

/** How many live commitments name this contact as their vendor (for the warning before taking a vendor off a project). */
export async function commitmentsWithVendor(projectId: number, contactId: number, d: FinanceDB = db): Promise<number> {
  return (await loadCommitments(projectId, d)).filter((c) => c.data.vendorContactId === contactId).length;
}
