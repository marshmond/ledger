/**
 * R1.3 "Finish the loop", Home & Assets side. READ ONLY. When a Task linked to an asset has just been marked done, this says whether it can still be saved to that
 * asset's service history. It uses only existing readers: the Task (`getTask`), the asset (`getAsset`) and the Task-to-asset links, and the same "is there already a
 * live service record for this Task" test that `logTaskService` refuses on (`loadServices`). The saving is the existing `ServiceForm` ("Save to service history"),
 * which writes through `logTaskService`. Nothing is created here, and no Finance record is touched.
 */
import { db, type FinanceDB } from '../../db';
import { createStore } from '../../core/store';
import type { TaskFollowUpOffer } from '../../core/taskFollowUp';
import { getTask } from '../tasks/data';
import { getAsset } from './data';
import { parseAssetRef, type AssetRecord } from './model';
import { loadServices } from './serviceData';

import { ASSETS_FOLLOW_LABEL } from './followUpText';
export { ASSETS_FOLLOW_LABEL };

/** Every asset id the Task is linked to (either direction of the link), lowest first. */
export async function assetIdsOfTask(taskId: number, d: FinanceDB = db): Promise<number[]> {
  const links = await createStore(d).shared.links.linkedTo({ module: 'tasks', id: taskId });
  const ids = links.flatMap((l) => {
    const other = l.fromModule === 'tasks' && String(l.fromId) === String(taskId) ? (l.toModule === 'assets' ? l.toId : null) : l.toModule === 'tasks' && String(l.toId) === String(taskId) && l.fromModule === 'assets' ? l.fromId : null;
    return other === null ? [] : [parseAssetRef(other)];
  });
  return [...new Set(ids.filter((x): x is number => x !== null))].sort((a, b) => a - b);
}

export type AssetsFollowCheck =
  | { ok: true; asset: AssetRecord }
  | { ok: false; reason: string; /** The asset and service record that already cover this Task, when that is the reason. */ saved?: { assetId: number; serviceId: number } };

/** Whether a finished Task can still be saved to an asset's history, and if not, why in plain words. The same answer drives the button and the dialog. */
export async function checkAssetsFollowUp(taskId: number, preferAssetId?: number, d: FinanceDB = db): Promise<AssetsFollowCheck> {
  const task = await getTask(taskId, d);
  if (!task) return { ok: false, reason: 'That task is not here any more, so there is nothing to save.' };
  if (task.data.status !== 'done') return { ok: false, reason: 'That task is not finished any more (it was reopened), so there is nothing to save yet. Nothing was changed.' };
  const linked = await assetIdsOfTask(taskId, d);
  if (linked.length === 0) return { ok: false, reason: 'That task is not linked to an asset, so there is no service history to add it to.' };
  const saved = (await loadServices(d)).find((s) => s.data.taskId === taskId);
  if (saved) return { ok: false, reason: 'This task was already saved to service history. Nothing new was saved.', saved: { assetId: saved.data.assetId, serviceId: saved.id } };
  const live: AssetRecord[] = [];
  for (const id of linked) { const a = await getAsset(id, d); if (a) live.push(a); }
  if (live.length === 0) return { ok: false, reason: 'The asset this task was about no longer exists, so nothing was saved.' };
  const usable = live.filter((a) => !a.data.archived);
  if (usable.length === 0) return { ok: false, reason: `${live[0].data.name} is archived. Restore it from the Archived tab in Home & Assets first, then save the work to its history.` };
  // One eligible asset: that is the target. Several: nothing in the Task says which one the work was done on, and the lowest id is only database order, so the offer is
  // withheld (the asset pages' own manual Save to history stays available). A caller may name the asset only if it is one of the eligible ones.
  if (usable.length > 1) {
    const named = preferAssetId !== undefined ? usable.find((a) => a.id === preferAssetId) : undefined;
    if (!named) return { ok: false, reason: 'This task is linked to more than one asset, so Ledger cannot tell which one the work was done on. Open the right asset in Home & Assets and use Save to history there. Nothing was saved.' };
    return { ok: true, asset: named };
  }
  return { ok: true, asset: usable[0] };
}

/** The offer for the "Done" message, or null (an ordinary task, work already saved, an asset that is gone or archived). */
export async function readAssetsFollowUp(taskId: number): Promise<TaskFollowUpOffer | null> {
  return (await checkAssetsFollowUp(taskId)).ok ? { label: ASSETS_FOLLOW_LABEL } : null;
}
