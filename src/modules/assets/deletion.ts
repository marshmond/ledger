/**
 * Permanent deletion of an asset, with the dependency rules in plain words. Modelled on projects/deletion.ts.
 *
 *  - BLOCKS: a live child asset; another live asset marked as replaced by this one; a live record of a dependent kind (service, warranty;
 *    service records exist from H2, warranties come in H4; the check is written from ASSET_DEPENDENT_KINDS so later phases cannot forget it); a COMPLETED task linked to
 *    it (completed tasks are maintenance history: unlink them first).
 *  - UNLINKS (kept): open tasks and Calendar events, and every shared link that points at the asset. They are never deleted.
 *  - DELETES: the asset record only, as a soft delete with a marker (`permanentlyDeletedAt`) so the deletion also holds on other devices
 *    (src/lib/sync/assetDeletion.ts).
 * One database transaction: if anything throws, nothing changes. Old backups still contain the asset.
 */
import { db, type FinanceDB } from '../../db';
import type { Link, ModuleRecord } from '../../core/entities';
import { repo } from '../../core/store';
import { PERMANENT_DELETE_KEY } from '../../lib/sync/projectDeletion';
import { getAsset, loadAssets, loadLinkedWork, linksToAsset } from './data';
import { ASSET_DEPENDENT_KINDS, MODULE, type AssetRecord } from './model';

export interface AssetDeletionPlan {
  asset: AssetRecord;
  children: { id: number; name: string }[];
  replacedFrom: { id: number; name: string }[];
  dependents: number;
  completedTasks: number;
  openTasks: number;
  events: number;
  links: number;
  reasons: string[];
  canDelete: boolean;
}

const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;

export async function planAssetDeletion(id: number, d: FinanceDB = db): Promise<AssetDeletionPlan> {
  const asset = await getAsset(id, d);
  if (!asset) throw new Error('That asset no longer exists.');
  const all = await loadAssets(d);
  const children = all.filter((a) => a.data.parentId === id).map((a) => ({ id: a.id, name: a.data.name }));
  const replacedFrom = all.filter((a) => a.data.replacedById === id).map((a) => ({ id: a.id, name: a.data.name }));
  const dependents = (await d.moduleRecords.where('module').equals(MODULE).toArray())
    .filter((r) => r.deletedAt == null && (ASSET_DEPENDENT_KINDS as readonly string[]).includes(r.kind) && (r.data as { assetId?: unknown } | null)?.assetId === id).length;
  const work = await loadLinkedWork(id, d);
  const links = await linksToAsset(id, d);
  const reasons: string[] = [];
  if (children.length) reasons.push(`${n(children.length, 'asset is', 'assets are')} inside it (${children.map((c) => c.name).slice(0, 3).join(', ')}${children.length > 3 ? ', ...' : ''}). Move or delete ${children.length === 1 ? 'it' : 'them'} first.`);
  if (replacedFrom.length) reasons.push(`${n(replacedFrom.length, 'asset is', 'assets are')} marked as replaced by this one (${replacedFrom.map((c) => c.name).slice(0, 3).join(', ')}). Change that first.`);
  if (dependents) reasons.push(`${n(dependents, 'service or warranty record points', 'service or warranty records point')} at it. They are history, so they stop the deletion.`);
  if (work.completedTasks.length) reasons.push(`${n(work.completedTasks.length, 'completed task is', 'completed tasks are')} linked to it. Completed tasks are its maintenance history. Unlink ${work.completedTasks.length === 1 ? 'it' : 'them'} from the task first, or archive the asset instead.`);
  return { asset, children, replacedFrom, dependents, completedTasks: work.completedTasks.length, openTasks: work.openTasks.length, events: work.events.length, links: links.length, reasons, canDelete: reasons.length === 0 };
}

export async function deleteAssetPermanently(id: number, d: FinanceDB = db): Promise<{ linksRemoved: number }> {
  return d.transaction('rw', d.moduleRecords, d.links, async () => {
    const plan = await planAssetDeletion(id, d);
    if (!plan.canDelete) throw new Error(`This asset cannot be deleted yet. ${plan.reasons.join(' ')}`);
    const links = await linksToAsset(id, d);
    const linkRepo = repo<Link>(d.links);
    for (const l of links) await linkRepo.remove(l.id as number);
    const rows = repo<ModuleRecord>(d.moduleRecords);
    const rec = await d.moduleRecords.get(id);
    // The marker is what makes the deletion hold across devices. It lives inside the record's own data, so the stored format is unchanged.
    await rows.put({ id, module: MODULE, kind: 'asset', data: { ...((rec?.data ?? {}) as Record<string, unknown>), [PERMANENT_DELETE_KEY]: Date.now() } });
    await rows.remove(id);
    return { linksRemoved: links.length };
  });
}
