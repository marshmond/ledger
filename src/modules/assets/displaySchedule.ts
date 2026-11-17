/**
 * CS-1: the schedule-only reader that lets a shared family display show a home-maintenance REMINDER without exposing any asset.
 *
 * A maintenance plan in Ledger is an ordinary repeating Task that is linked to an asset (Tasks owns its dates and repeat; see `maintenance.ts`).
 * This reader finds those plans by the Task's repeat chain (the root of the chain names the plan, so finishing one and getting the next does not
 * change which plan it is) and returns, for a plan, ONLY `{ date, time }` of the next due date. It never reads or returns an asset record, name,
 * serial number, address, warranty, cost, service history or note, and it does not return the Task's own title either: the display text is a label
 * the owner types on the family-display decision. `listMaintenancePlans` is for the OWNER's settings page only (it names the Task so the owner can
 * recognize it) and is never used to build what the display receives.
 */
import type { FinanceDB } from '../../db';
import { isLive } from '../../core/store';
import { asTask, MODULE as TASKS, type TaskRecord } from '../tasks/model';
import { taskRootId } from '../tasks/chain';
import { MODULE as ASSETS } from './model';

export interface DisplayReminder { date: string; time: string | null }
export interface MaintenancePlan { rootId: number; title: string; nextDate: string | null }

/** Open plan tasks (repeating, linked to an asset), grouped by the root of their repeat chain. */
async function openPlans(d: FinanceDB): Promise<Map<number, TaskRecord>> {
  const [rows, links] = await Promise.all([d.moduleRecords.where('[module+kind]').equals([TASKS, 'task']).toArray(), d.links.toArray()]);
  const all = rows.map((r) => ({ rec: asTask(r), live: isLive(r) }));
  const chain = new Map(all.map((x) => [x.rec.id, { id: x.rec.id, recurFrom: x.rec.data.recurFrom }]));
  const toAsset = new Set(links.filter((l) => isLive(l) && l.fromModule === TASKS && l.toModule === ASSETS).map((l) => Number(l.fromId)));
  const out = new Map<number, TaskRecord>();
  for (const { rec, live } of all) {
    if (!live || rec.data.status === 'done' || !rec.data.repeat || !toAsset.has(rec.id)) continue;
    const root = taskRootId(rec.id, chain);
    if (root === null) continue; // an ambiguous chain is left out, never guessed
    const cur = out.get(root);
    if (!cur || (rec.data.dueDate ?? '9999').localeCompare(cur.data.dueDate ?? '9999') < 0) out.set(root, rec);
  }
  return out;
}

/** For the owner's settings page: the plans that could be shown, named by their Task so the owner recognizes them. */
export async function listMaintenancePlans(d: FinanceDB): Promise<MaintenancePlan[]> {
  return [...(await openPlans(d)).entries()]
    .map(([rootId, t]) => ({ rootId, title: t.data.title, nextDate: t.data.dueDate }))
    .sort((a, b) => a.title.localeCompare(b.title) || a.rootId - b.rootId);
}

/** For each requested plan root, the next due date and time inside `from..to`, or an empty list. Nothing else leaves this function. */
export async function readDisplayReminders(d: FinanceDB, rootIds: readonly number[], from: string, to: string): Promise<Map<number, DisplayReminder[]>> {
  const out = new Map<number, DisplayReminder[]>(rootIds.map((id) => [id, []]));
  if (rootIds.length === 0) return out;
  const plans = await openPlans(d);
  for (const id of rootIds) {
    const t = plans.get(id);
    const date = t?.data.dueDate;
    if (t && date && date >= from && date <= to) out.set(id, [{ date, time: t.data.dueTime }]);
  }
  return out;
}
