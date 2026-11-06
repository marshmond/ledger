/**
 * Permanent deletion of a project, with the dependency rules in plain words.
 *
 *  - BLOCKS (financial): a live commitment or change order, or a transaction (whole, or one of its splits) tagged to the project. Nothing
 *    here ever removes or edits a transaction, a commitment or an account; the owner has to deal with those first (see `reasons`).
 *  - UNLINKS (kept): tasks, milestones and Calendar events that sit on the project, and shared links that point at it. They are never
 *    deleted. Each goes through the module that owns it (`setTaskProject`, `setEventProject`), so a milestone becomes an ordinary
 *    task (P3 rule) and recurrence and every other field are kept.
 *  - DELETES (owned): the project's budget lines and the project record. Soft delete (a `deletedAt` tombstone), the same as every other
 *    delete, so the deletion syncs to other devices and does not reappear.
 *
 * Everything happens in ONE database transaction: if anything throws, nothing at all is changed.
 *
 * Conflict policy (a narrow exception to last-writer-wins, only for a project deleted with this function; see
 * src/lib/sync/projectDeletion.ts): the deletion WINS over any copy of the project edited on another device, before or after, and its
 * budget lines follow it. The only things that keep a project alive are money that still points at it (a commitment or tagged
 * transaction made on a stale device) and an intentional backup restore.
 * Old backups and Git history keep their copies; this removes the project from the app and from synced devices, not from old files.
 */
import { db, type FinanceDB } from '../../db';
import type { Link, ModuleRecord } from '../../core/entities';
import { repo } from '../../core/store';
import { PERMANENT_DELETE_KEY } from '../../lib/sync/projectDeletion';
import { loadEvents, setEventProject } from '../calendar/data';
import { loadTasks } from '../tasks/data';
import { loadBudgetLines, loadCommitments, getProject } from './data';
import { setTaskProject } from './work';
import type { ProjectRecord } from './model';

export interface DeletionPlan {
  project: ProjectRecord;
  /** Money that stops the deletion. */
  commitments: number;
  wholeTransactions: number;
  splitTransactions: number;
  /** Ids of the transactions tagged to the project (for a link to Finance). */
  transactionIds: number[];
  /** Plain-words reasons the project cannot be deleted yet. Empty = it can be. */
  reasons: string[];
  canDelete: boolean;
  /** What deleting would remove. */
  budgetLines: number;
  /** What deleting would keep and unlink. */
  tasks: number;
  milestones: number;
  events: number;
  links: number;
}

const sameId = (a: unknown, b: number) => a === b || String(a) === String(b);

async function linksTo(projectId: number, d: FinanceDB): Promise<Link[]> {
  const all = await d.links.toArray();
  return all.filter((l) => l.deletedAt == null && ((l.toModule === 'projects' && sameId(l.toId, projectId)) || (l.fromModule === 'projects' && sameId(l.fromId, projectId))));
}

/** What a deletion would do, without changing anything. */
export async function planProjectDeletion(projectId: number, d: FinanceDB = db): Promise<DeletionPlan> {
  const project = await getProject(projectId, d);
  if (!project) throw new Error('That project no longer exists.');
  const commitments = (await loadCommitments(projectId, d)).length;
  const txns = await d.txns.toArray();
  let whole = 0, splits = 0;
  const ids: number[] = [];
  for (const t of txns) {
    const w = t.project?.projectId === projectId;
    const s = (t.splits ?? []).some((x) => x.project?.projectId === projectId);
    if (w) whole++;
    else if (s) splits++;
    if ((w || s) && t.id !== undefined) ids.push(t.id);
  }
  const reasons: string[] = [];
  const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
  if (commitments) reasons.push(`${n(commitments, 'commitment or change order is', 'commitments and change orders are')} still on this project. Cancel or remove ${commitments === 1 ? 'it' : 'them'} first (a commitment with payments on it can only be cancelled, which keeps it).`);
  if (whole) reasons.push(`${n(whole, 'transaction is', 'transactions are')} tagged to this project. Open them in Finance and take the project tag off, or change it, before deleting.`);
  if (splits) reasons.push(`${n(splits, 'split transaction has a part', 'split transactions have parts')} tagged to this project. Edit ${splits === 1 ? 'it' : 'each'} and take the tag off that part.`);
  const tasks = (await loadTasks(d)).filter((t) => t.data.projectId === projectId);
  const events = (await loadEvents(d)).filter((e) => e.data.projectId === projectId);
  return {
    project, commitments, wholeTransactions: whole, splitTransactions: splits, transactionIds: ids, reasons, canDelete: reasons.length === 0,
    budgetLines: (await loadBudgetLines(projectId, d)).length,
    tasks: tasks.filter((t) => !t.data.isMilestone).length,
    milestones: tasks.filter((t) => t.data.isMilestone).length,
    events: events.filter((e) => !e.data.retired).length,
    links: (await linksTo(projectId, d)).length,
  };
}

export interface DeletionResult { budgetLines: number; tasksUnlinked: number; milestonesUnlinked: number; eventsUnlinked: number; linksRemoved: number }

/**
 * Deletes the project for good (soft-deleted so it syncs). Refuses, changing nothing, while a commitment or tagged transaction remains.
 * Tasks, milestones and events are unlinked, never deleted. All in one transaction.
 */
export async function deleteProjectPermanently(projectId: number, d: FinanceDB = db): Promise<DeletionResult> {
  return d.transaction('rw', d.moduleRecords, d.links, d.txns, async () => {
    const plan = await planProjectDeletion(projectId, d);
    if (!plan.canDelete) throw new Error(`This project cannot be deleted yet. ${plan.reasons.join(' ')}`);
    const tasks = (await loadTasks(d)).filter((t) => t.data.projectId === projectId);
    for (const t of tasks) await setTaskProject(t.id, null, d);
    // Every event of the project, including a replaced (retired) copy of a repeating series, so nothing keeps pointing at it.
    const events = (await loadEvents(d)).filter((e) => e.data.projectId === projectId);
    for (const e of events) await setEventProject(e.id, null, d);
    const links = await linksTo(projectId, d);
    const linkRepo = repo<Link>(d.links);
    for (const l of links) await linkRepo.remove(l.id as number);
    const lines = await loadBudgetLines(projectId, d);
    const rows = repo<ModuleRecord>(d.moduleRecords);
    for (const l of lines) await rows.remove(l.id);
    // The marker is what makes the deletion hold across devices (see src/lib/sync/projectDeletion.ts). It lives inside the record's own
    // data, so the stored format is unchanged and an older app version simply carries it as an unknown field.
    const rec = await d.moduleRecords.get(projectId);
    await rows.put({ id: projectId, module: 'projects', kind: 'project', data: { ...((rec?.data ?? {}) as Record<string, unknown>), [PERMANENT_DELETE_KEY]: Date.now() } });
    await rows.remove(projectId);
    return {
      budgetLines: lines.length,
      tasksUnlinked: tasks.filter((t) => !t.data.isMilestone).length,
      milestonesUnlinked: tasks.filter((t) => t.data.isMilestone).length,
      eventsUnlinked: events.filter((e) => !e.data.retired).length,
      linksRemoved: links.length,
    };
  });
}
