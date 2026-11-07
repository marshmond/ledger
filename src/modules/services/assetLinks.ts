/**
 * Household Services and Home & Assets, linked without copying (S4).
 *
 *  1. The reverse view: which arrangements serve an asset (through the existing shared `serves` links). A read model only; the asset keeps no copy.
 *  2. "Move to replacement": when an asset was replaced, the owner may point an arrangement's CURRENT `serves` link at the replacement. Only that one
 *     link changes (all or nothing, in one transaction that re-reads everything and refuses stale data). Visits keep their own links to the old asset
 *     forever: history is never rewritten to look as if it served newer equipment. Nothing moves or ends by itself.
 */
import { db, type FinanceDB } from '../../db';
import type { Link, ModuleRecord } from '../../core/entities';
import { createStore, isLive, repo } from '../../core/store';
import { getAsset, publicLabel, loadAssets } from '../assets/data';
import { parseAssetRef, assetRefId } from '../assets/model';
import { getArrangement, tasksOfArrangement } from './data';
import { arrangementRef, ASSET_LINK, cadenceText, MODULE, STATUS_LABEL, toStored, KIND, type ArrangementRecord } from './model';
import { openOf } from './schedule';
import { Recorder, type Undo } from './undo';

// ---- the reverse view ----

export interface AssetServiceRow {
  arrangementId: number;
  title: string;
  /** The provider's name as saved on the arrangement (never a phone number or email). */
  providerName: string;
  /** The provider's Contact is gone from this device: the saved name is shown. */
  contactGone: boolean;
  status: ArrangementRecord['data']['status'];
  statusLabel: string;
  cadence: string;
  /** The date of the one open visit Task, only for an active arrangement. */
  nextVisit: string | null;
}

/**
 * The live arrangements that `serve` this asset, active first. A link to an arrangement that is deleted or not on this device is skipped; the count of
 * those is returned so the page can say so without crashing. Reads only.
 */
export async function loadAssetServices(assetId: number, d: FinanceDB = db): Promise<{ rows: AssetServiceRow[]; unavailable: number }> {
  const links = (await createStore(d).shared.links.linkedTo({ module: 'assets', id: assetRefId(assetId) })).filter((l) => l.type === ASSET_LINK && l.fromModule === MODULE && l.toModule === 'assets' && l.toId === assetRefId(assetId));
  const seen = new Set<number>();
  const contacts = new Set((await d.contacts.toArray()).filter(isLive).map((c) => c.id as number));
  const rows: AssetServiceRow[] = [];
  let unavailable = 0;
  for (const l of links) {
    const m = /^arrangement:(\d+)$/.exec(String(l.fromId));
    if (!m || seen.has(Number(m[1]))) continue;
    seen.add(Number(m[1]));
    const a = await getArrangement(Number(m[1]), d);
    if (!a) { unavailable++; continue; }
    const open = a.data.status === 'active' ? openOf(await tasksOfArrangement(a.id, d)).sort((x, y) => (x.data.dueDate ?? '9999').localeCompare(y.data.dueDate ?? '9999'))[0] : undefined;
    rows.push({
      arrangementId: a.id, title: a.data.title, providerName: a.data.providerNameSnapshot, contactGone: a.data.providerContactId !== null && !contacts.has(a.data.providerContactId),
      status: a.data.status, statusLabel: STATUS_LABEL[a.data.status], cadence: cadenceText(a.data.cadence), nextVisit: open?.data.dueDate ?? null,
    });
  }
  const rank = { active: 0, paused: 1, ended: 2 } as const;
  return { rows: rows.sort((x, y) => rank[x.status] - rank[y.status] || x.title.localeCompare(y.title) || x.arrangementId - y.arrangementId), unavailable };
}

// ---- Move to replacement ----

export interface MoveExpect { arrangementUpdatedAt: number; oldAssetId: number; replacementId: number; /** the arrangement's `serves` links as they were when the preview was made */ serves: string[] }
export interface MovePlan {
  problem: string | null;
  arrangement: ArrangementRecord;
  old: { id: number; name: string } | null;
  replacement: { id: number; name: string } | null;
  /** The arrangement already serves the replacement, so only the old link goes. */
  alreadyServesReplacement: boolean;
  lines: string[];
  expect: MoveExpect | null;
}

const servesLinks = async (arrId: number, d: FinanceDB): Promise<Link[]> =>
  (await createStore(d).shared.links.linkedTo(arrangementRef(arrId))).filter((l) => l.type === ASSET_LINK && l.fromModule === MODULE && l.toModule === 'assets' && l.fromId === `arrangement:${arrId}`);
const sig = (l: Link) => `${l.id}|${l.toId}`;
const endsAt = (l: Link, assetId: number) => parseAssetRef(l.toId) === assetId;

/** Read-only preview of moving one arrangement's `serves` link from a replaced asset to its replacement. Never writes. */
export async function planMoveToReplacement(arrangementId: number, oldAssetId: number, d: FinanceDB = db): Promise<MovePlan> {
  const a = await getArrangement(arrangementId, d);
  const none = (problem: string): MovePlan => ({ problem, arrangement: a as ArrangementRecord, old: null, replacement: null, alreadyServesReplacement: false, lines: [], expect: null });
  if (!a) throw new Error('That arrangement no longer exists.');
  if (a.data.status === 'ended') return none('This arrangement has ended, so there is no future service to move. Its history stays as it is.');
  const assets = await loadAssets(d);
  const old = assets.find((x) => x.id === oldAssetId);
  if (!old) return none('The original asset is no longer on this device, so there is nothing to move from. Review the links with Edit.');
  const links = await servesLinks(arrangementId, d);
  if (!links.some((l) => endsAt(l, oldAssetId))) return none('This arrangement no longer serves that asset (it may have been moved a moment ago or on another device).');
  if (old.data.status !== 'replaced') return none('That asset is not marked as replaced any more.');
  const rid = old.data.replacedById;
  const repl = rid === null ? undefined : assets.find((x) => x.id === rid);
  if (!repl || repl.id === old.id) return none('The replacement is not a live asset on this device (it may have been deleted, or it has not synced yet). Ledger will not invent one: fix the replacement in Home & Assets, or choose another asset with Edit.');
  if (repl.data.archived) return none('The replacement asset is archived. Restore it first, or choose another asset with Edit.');
  const already = links.some((l) => endsAt(l, repl.id));
  const oldName = publicLabel(assets, old.id), newName = publicLabel(assets, repl.id);
  const lines = [
    `"${a.data.title}" will serve ${newName} instead of ${oldName}. Future service coverage points at the replacement.`,
    already ? `It already serves ${newName}, so only the link to ${oldName} is removed.` : `A link to ${newName} is added and the link to ${oldName} is removed.`,
    `Past visits keep their own links to ${oldName}: they are history and are not rewritten. The provider, schedule, payments and earlier outcomes do not change.`,
    'You can undo this right afterwards, as long as nothing it touched has been changed since.',
  ];
  return {
    problem: null, arrangement: a, old: { id: old.id, name: oldName }, replacement: { id: repl.id, name: newName }, alreadyServesReplacement: already, lines,
    expect: { arrangementUpdatedAt: a.updatedAt, oldAssetId, replacementId: repl.id, serves: links.map(sig).sort() },
  };
}

export interface MoveRequest { arrangementId: number; expect: MoveExpect }
export const MOVE_STALE = 'This changed (maybe on another device) since you opened it, so nothing was changed. Close this, look at the arrangement again, and choose again.';

/**
 * Moves the arrangement's `serves` link from the old asset to the replacement, atomically. Re-reads everything inside the transaction and refuses
 * (writing nothing) when the arrangement, its links, the old asset's replacement choice or the replacement itself differ from the preview.
 * Returns a sealed Undo: it is refused if anything it touched has changed since.
 */
export function applyMoveToReplacement(req: MoveRequest, d: FinanceDB = db): Promise<{ undo: Undo }> {
  return d.transaction('rw', d.moduleRecords, d.links, d.contacts, async () => {
    const e = req.expect;
    const a = await getArrangement(req.arrangementId, d);
    if (!a) throw new Error('That arrangement no longer exists. Nothing was changed.');
    if (a.data.status === 'ended') throw new Error('This arrangement has ended. Nothing was changed.');
    if (a.updatedAt !== e.arrangementUpdatedAt) throw new Error(MOVE_STALE);
    const links = await servesLinks(a.id, d);
    if (links.map(sig).sort().join(',') !== e.serves.join(',')) throw new Error(MOVE_STALE);
    const old = await getAsset(e.oldAssetId, d);
    if (!old || old.data.status !== 'replaced' || old.data.replacedById !== e.replacementId) throw new Error(MOVE_STALE);
    const repl = await getAsset(e.replacementId, d);
    if (!repl || repl.data.archived || repl.id === old.id) throw new Error(MOVE_STALE);
    const store = createStore(d);
    const rec = new Recorder();
    rec.watch(a);
    for (const l of links.filter((x) => endsAt(x, e.oldAssetId))) { rec.linkRemoved(l); await store.shared.links.remove(l.id as number); }
    if (!links.some((l) => endsAt(l, e.replacementId))) rec.linkAdded(await store.shared.links.add(arrangementRef(a.id), { module: 'assets', id: assetRefId(e.replacementId) }, ASSET_LINK));
    // A harmless touch of the arrangement itself: it makes any edit form another device still has open for it stale, so that edit cannot quietly re-link the old asset.
    await repo<ModuleRecord>(d.moduleRecords).put({ id: a.id, module: MODULE, kind: KIND, data: toStored(a.data) as never });
    await rec.seal(d);
    return { undo: rec.undo };
  });
}
