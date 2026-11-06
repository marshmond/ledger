/**
 * Retiring, storing, selling, disposing of and REPLACING an asset (Home & Assets H4), with the open-task choices and the previewed
 * "include everything inside" option. It uses the status fields H1 already stores (`status`, `statusDate`, `statusNote`, `replacedById`);
 * there is no second lifecycle model.
 *
 * `planRetirement` only READS (it is what the preview shows). `applyRetirement` is ONE database transaction: everything chosen happens, or,
 * if anything is wrong or stale, nothing does.
 *
 * What it never does: touch Finance, Projects or Contacts; delete a service record, warranty or completed task; copy a serial number, VIN,
 * plate, address, warranty or history to a replacement; retire anything inside the asset unless it was ticked; change a task unless it was chosen.
 * Tasks stay Tasks' business: "Stop repeating" uses Tasks' own `saveTask`, "Delete" uses Tasks' own `removeTasks`, and "Move" only changes the
 * shared link between the task and the asset (the task record itself is not written, so its completions and repeat are untouched).
 */
import { db, type FinanceDB } from '../../db';
import type { Link, ModuleRecord } from '../../core/entities';
import { createStore, repo } from '../../core/store';
import { getTask, removeTasks, saveTask } from '../tasks/data';
import type { TaskRecord } from '../tasks/model';
import { blankAsset, MODULE, STATUS_LABEL, tidy, type AssetData, type AssetRecord, type AssetStatus } from './model';
import { descendantIds, getAsset, linksToAsset, loadAssets, loadLinkedWork, lookupOf, normalizeAsset, publicLabel } from './data';
import { validateAsset } from './validate';

/** What can be set from the retire / replace dialog. Returning to "In use" goes through `setAssetStatus`, which clears the fields. */
export const RETIRE_STATUSES = ['stored', 'sold', 'disposed', 'replaced'] as const satisfies readonly AssetStatus[];
export type RetireStatus = (typeof RETIRE_STATUSES)[number];
/** Statuses for which "include everything inside" is offered. A replaced asset's contents are never retired along with it (they have no replacement). */
export const BULK_STATUSES: readonly AssetStatus[] = ['stored', 'sold', 'disposed'];

export type TaskAction = 'keep' | 'move' | 'stop' | 'delete';
export const TASK_ACTION_LABEL: Record<TaskAction, string> = { keep: 'Keep linked', move: 'Move to the replacement', stop: 'Stop repeating', delete: 'Delete task' };

export type ReplacementChoice = { kind: 'none' } | { kind: 'existing'; id: number } | { kind: 'new'; data: AssetData };

export interface RetireRequest {
  assetId: number;
  status: RetireStatus;
  statusDate: string | null;
  statusNote: string;
  /** Only used when status is 'replaced'. */
  replacement: ReplacementChoice;
  /** Assets inside it to retire with it (must be real descendants, not already out of use). Empty = only this asset. */
  descendantIds: number[];
  /** Task id -> what to do. A task not listed is kept exactly as it is. */
  taskActions: Record<number, TaskAction>;
}

export interface DescendantInfo { asset: AssetRecord; label: string; depth: number; /** sold, disposed of or replaced already */ alreadyOut: boolean }
export interface RetirementPlan {
  asset: AssetRecord;
  /** Everything inside it, nearest first. */
  descendants: DescendantInfo[];
  /** Open linked tasks per asset id (the asset itself and every descendant). */
  openTasks: Record<number, TaskRecord[]>;
  /** Completed linked tasks and service/warranty records stay with the asset: only counts, for the preview. */
  /** For an open task that is also linked to OTHER assets (not the one being retired): their names. Deleting such a task removes it for all of them. */
  sharedWith: Record<number, string[]>;
  keptHistory: { completedTasks: number; serviceRecords: number; warranties: number };
}

const rows = (d: FinanceDB) => repo<ModuleRecord>(d.moduleRecords);
const isOut = (a: AssetRecord) => a.data.status === 'sold' || a.data.status === 'disposed' || a.data.status === 'replaced';

/** Read-only. What retiring this asset would involve: what is inside it, which open tasks are linked, what history stays. */
export async function planRetirement(assetId: number, d: FinanceDB = db): Promise<RetirementPlan> {
  const asset = await getAsset(assetId, d);
  if (!asset) throw new Error('That asset no longer exists.');
  const all = await loadAssets(d);
  const ids = descendantIds(all, assetId);
  ids.delete(assetId);
  const depth = (a: AssetRecord) => { let n = 0; for (let cur: AssetRecord | undefined = a; cur && cur.data.parentId !== null && cur.data.parentId !== assetId && n < 12; n++) cur = all.find((x) => x.id === cur!.data.parentId); return n + 1; };
  const descendants = all.filter((a) => ids.has(a.id)).map<DescendantInfo>((a) => ({ asset: a, label: publicLabel(all, a.id), depth: depth(a), alreadyOut: isOut(a) }))
    .sort((x, y) => x.depth - y.depth || x.label.localeCompare(y.label));
  const openTasks: Record<number, TaskRecord[]> = {};
  let completedTasks = 0;
  for (const id of [assetId, ...descendants.map((x) => x.asset.id)]) {
    const w = await loadLinkedWork(id, d);
    openTasks[id] = w.openTasks;
    if (id === assetId) completedTasks = w.completedTasks.length;
  }
  const taskIds = new Set(Object.values(openTasks).flat().map((t) => t.id));
  const sharedWith: Record<number, string[]> = {};
  for (const l of (await d.links.toArray()).filter((x) => x.deletedAt == null)) {
    const [tEnd, aEnd] = l.fromModule === 'tasks' && l.toModule === MODULE ? [l.fromId, l.toId] : l.toModule === 'tasks' && l.fromModule === MODULE ? [l.toId, l.fromId] : [null, null];
    const tid = tEnd === null ? NaN : Number(tEnd);
    const aid = /^asset:(\d+)$/.exec(String(aEnd))?.[1];
    if (!taskIds.has(tid) || !aid || Number(aid) === assetId || !all.some((a) => a.id === Number(aid))) continue;
    const name = publicLabel(all, Number(aid));
    if (!(sharedWith[tid] ??= []).includes(name)) sharedWith[tid].push(name);
  }
  const mine = (await d.moduleRecords.where('module').equals(MODULE).toArray()).filter((r) => r.deletedAt == null && (r.data as { assetId?: unknown } | null)?.assetId === assetId);
  return { asset, descendants, openTasks, sharedWith, keptHistory: { completedTasks, serviceRecords: mine.filter((r) => r.kind === 'service').length, warranties: mine.filter((r) => r.kind === 'warranty').length } };
}

/** What a replacement starts as: the same name, type and place. Nothing else is copied (no serial number, VIN, plate, address, warranty, dates, price or history). */
export const replacementDraft = (old: AssetData): AssetData => blankAsset({ name: old.name, type: old.type, parentId: old.type === 'property' ? null : old.parentId });

export interface RetireResult { retired: number[]; newAssetId?: number; moved: number; stopped: number; deleted: number }

/**
 * Applies a retirement / replacement. ONE transaction. Throws (and changes nothing) when the asset, the replacement, an included asset or a
 * chosen task is missing or has changed since the preview, when a replacement would loop, or when the old asset was already replaced and a
 * second NEW replacement is asked for (so a double submit cannot make two).
 */
export async function applyRetirement(req: RetireRequest, d: FinanceDB = db): Promise<RetireResult> {
  return d.transaction('rw', d.moduleRecords, d.links, async () => {
    const old = await getAsset(req.assetId, d);
    if (!old) throw new Error('That asset no longer exists. Nothing was changed.');
    if (!(RETIRE_STATUSES as readonly string[]).includes(req.status)) throw new Error('Pick how it left use.');
    let all = await loadAssets(d);

    // 1. The replacement.
    let replacementId: number | null = null;
    let newAssetId: number | undefined;
    if (req.status === 'replaced') {
      if (req.replacement.kind === 'existing') {
        if (req.replacement.id === req.assetId) throw new Error('Pick the asset that replaced it, not itself.');
        const wanted = req.replacement.id;
        if (!all.some((a) => a.id === wanted)) throw new Error('The replacement you chose no longer exists. Nothing was changed.');
        replacementId = req.replacement.id;
      } else if (req.replacement.kind === 'new') {
        const prior = old.data.status === 'replaced' && old.data.replacedById !== null ? all.find((a) => a.id === old.data.replacedById) : undefined;
        if (prior) throw new Error(`This was already replaced by "${prior.data.name}" (maybe a moment ago or on another device), so no second replacement was created. Nothing was changed.`);
        // Only what the owner typed for the new asset, as a fresh active asset. Identifiers and history are never inherited.
        const fresh = normalizeAsset({ ...blankAsset(), name: req.replacement.data.name, type: req.replacement.data.type, parentId: req.replacement.data.parentId, installDate: req.replacement.data.installDate, manufacturer: req.replacement.data.manufacturer, model: req.replacement.data.model });
        const problem = validateAsset(fresh, undefined, lookupOf(all));
        if (problem) throw new Error(problem);
        newAssetId = await rows(d).put({ module: MODULE, kind: 'asset', data: { ...fresh } });
        replacementId = newAssetId;
        all = await loadAssets(d);
      }
    }

    // 2. The asset itself.
    const patch = (a: AssetRecord, replacedById: number | null): AssetData => ({ ...a.data, status: req.status, statusDate: req.statusDate, statusNote: req.statusNote, replacedById: req.status === 'replaced' ? replacedById : null });
    const write = async (a: AssetRecord, next: AssetData) => {
      const clean = normalizeAsset(next);
      const problem = validateAsset(clean, a.id, lookupOf(all));
      if (problem) throw new Error(`${a.data.name}: ${problem}`);
      await rows(d).put({ id: a.id, module: MODULE, kind: 'asset', data: { ...clean } });
    };
    await write(old, patch(old, replacementId));

    // 3. Things inside it, only the ones ticked.
    const inside = descendantIds(all, req.assetId);
    const retired = [req.assetId];
    if (req.descendantIds.length) {
      if (!BULK_STATUSES.includes(req.status)) throw new Error('Things inside it can only be included when it is stored, sold or disposed of. Nothing was changed.');
      for (const id of new Set(req.descendantIds)) {
        const a = all.find((x) => x.id === id);
        if (!a || id === req.assetId || !inside.has(id)) throw new Error('Something you ticked is no longer inside this asset. Nothing was changed.');
        if (isOut(a)) throw new Error(`"${a.data.name}" has already left use. Nothing was changed.`);
        await write(a, patch(a, null));
        retired.push(id);
      }
    }

    // 4. Open tasks, only the ones the owner chose to change.
    const scope = new Set(retired);
    let moved = 0, stopped = 0, deleted = 0;
    const links = createStore(d).shared.links;
    for (const [rawId, action] of Object.entries(req.taskActions)) {
      if (action === 'keep') continue;
      const taskId = Number(rawId);
      const t = await getTask(taskId, d);
      if (!t) throw new Error('A task you chose has been deleted since you opened this. Nothing was changed.');
      if (t.data.status === 'done') throw new Error(`"${t.data.title}" was completed since you opened this. Nothing was changed.`);
      const mine: Link[] = [];
      for (const aid of scope) for (const l of await linksToAsset(aid, d)) if (isTaskLink(l, taskId) && !mine.some((m) => m.id === l.id)) mine.push(l);
      if (!mine.length) throw new Error(`"${t.data.title}" is no longer linked to this asset. Nothing was changed.`);
      if (action === 'move') {
        if (replacementId === null) throw new Error('There is no replacement to move the task to. Nothing was changed.');
        const oldRef = `asset:${req.assetId}`;
        const target = { module: MODULE, id: `asset:${replacementId}` };
        const toMove = mine.filter((l) => (l.toModule === MODULE && String(l.toId) === oldRef) || (l.fromModule === MODULE && String(l.fromId) === oldRef));
        if (!toMove.length) throw new Error(`"${t.data.title}" is linked to something inside the asset, not to the asset itself, so it cannot move to the replacement. Nothing was changed.`);
        for (const l of toMove) {
          if (l.toModule === MODULE && String(l.toId) === oldRef) await links.add({ module: l.fromModule, id: l.fromId }, target, l.type);
          else await links.add(target, { module: l.toModule, id: l.toId }, l.type);
          await links.remove(l.id as number);
        }
        moved++;
      } else if (action === 'stop') {
        if (t.data.repeat) { await saveTask(taskId, { ...t.data, repeat: null }, d); stopped++; }
      } else if (action === 'delete') {
        await removeTasks([taskId], d);
        deleted++;
      }
    }
    return { retired, newAssetId, moved, stopped, deleted };
  });
}

const isTaskLink = (l: Link, taskId: number) => (l.fromModule === 'tasks' && Number(l.fromId) === taskId) || (l.toModule === 'tasks' && Number(l.toId) === taskId);

/** The plain-words summary shown before the owner confirms. Pure. */
export function describeRetirement(plan: RetirementPlan, req: RetireRequest, replacementName: string): string[] {
  const out: string[] = [];
  const name = plan.asset.data.name;
  const when = req.statusDate ? ` on ${req.statusDate}` : '';
  out.push(`"${name}" will be marked ${STATUS_LABEL[req.status].toLowerCase()}${when}.`);
  if (req.status === 'replaced') {
    out.push(req.replacement.kind === 'new' ? `A new asset "${tidy(req.replacement.data.name)}" will be created as its replacement. Nothing is copied from the old one except the name, type and place you confirmed.`
      : req.replacement.kind === 'existing' ? `"${replacementName}" will be recorded as its replacement.` : 'No replacement will be recorded.');
  }
  const picked = plan.descendants.filter((x) => req.descendantIds.includes(x.asset.id));
  if (picked.length) out.push(`${picked.length} ${picked.length === 1 ? 'item' : 'items'} inside it will be marked ${STATUS_LABEL[req.status].toLowerCase()} too: ${picked.slice(0, 6).map((x) => x.asset.data.name).join(', ')}${picked.length > 6 ? ', ...' : ''}.`);
  const left = plan.descendants.length - picked.length;
  if (left > 0) out.push(`${left} ${left === 1 ? 'item' : 'items'} inside it will stay as they are.`);
  const scope = new Set([plan.asset.id, ...picked.map((x) => x.asset.id)]);
  const open = Object.entries(plan.openTasks).filter(([id]) => scope.has(Number(id))).flatMap(([, ts]) => ts);
  const counts = { keep: 0, move: 0, stop: 0, delete: 0 } as Record<TaskAction, number>;
  for (const t of new Map(open.map((x) => [x.id, x])).values()) counts[req.taskActions[t.id] ?? 'keep']++;
  if (counts.move) out.push(`${counts.move} open ${counts.move === 1 ? 'task' : 'tasks'} will move to "${replacementName}".`);
  if (counts.stop) out.push(`${counts.stop} repeating ${counts.stop === 1 ? 'task' : 'tasks'} will stop repeating.`);
  if (counts.delete) out.push(`${counts.delete} open ${counts.delete === 1 ? 'task' : 'tasks'} will be deleted.`);
  const shared = open.filter((t) => req.taskActions[t.id] === 'delete' && plan.sharedWith[t.id]?.length);
  for (const t of new Map(shared.map((x) => [x.id, x])).values()) out.push(`WARNING: deleting "${t.data.title}" removes it for every asset it is linked to, also ${plan.sharedWith[t.id].join(', ')}, not only for "${name}".`);
  if (counts.keep) out.push(`${counts.keep} open ${counts.keep === 1 ? 'task' : 'tasks'} will stay linked and unchanged.`);
  const leftTasks = new Set(plan.descendants.filter((x) => !picked.includes(x)).flatMap((x) => plan.openTasks[x.asset.id] ?? []).map((t) => t.id));
  if (leftTasks.size) out.push(`${leftTasks.size} open ${leftTasks.size === 1 ? 'task' : 'tasks'} linked to things inside it that you did not tick will stay as they are. They need separate handling.`);
  const h = plan.keptHistory;
  out.push(`Kept exactly as they are: ${h.serviceRecords} service ${h.serviceRecords === 1 ? 'record' : 'records'}, ${h.warranties} ${h.warranties === 1 ? 'warranty' : 'warranties'}, ${h.completedTasks} completed ${h.completedTasks === 1 ? 'task' : 'tasks'}, and every linked Finance payment and Project.`);
  return out;
}
