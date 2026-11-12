import type { StatusTone } from '../../ui/StatusChip';
import type { AssetRecord } from './model';

/**
 * D14. Presentation helpers for the Home & Assets screens. Nothing here reads or writes a record or works out a date: the warranty label and tone come from
 * `warrantyState` (unchanged), and the places and counts come from the asset records exactly as stored.
 */

/** The chip tone for a warranty badge. The label always carries the words, so colour is never the only cue. */
export const WARRANTY_TONE: Record<'ok' | 'soon' | 'past', StatusTone> = { ok: 'active', soon: 'warning', past: 'overdue' };

export interface PlaceRow { asset: AssetRecord; inside: number }

/**
 * The top-level assets (the ones with no place above them: houses, vehicles and anything not placed), each with how many live assets sit directly inside
 * it. This is the grouping the module already has (an asset's own parent), shown at a glance. Nothing is inferred from names or addresses. Archived and
 * past assets are left out, as they are on the "In use" list.
 */
export function topLevelPlaces(assets: AssetRecord[]): PlaceRow[] {
  const live = assets.filter((a) => !a.data.archived && a.data.status === 'active');
  const ids = new Set(assets.map((a) => a.id));
  const inside = new Map<number, number>();
  for (const a of live) if (a.data.parentId !== null) inside.set(a.data.parentId, (inside.get(a.data.parentId) ?? 0) + 1);
  return live
    .filter((a) => a.data.parentId === null || !ids.has(a.data.parentId))
    .map((asset) => ({ asset, inside: inside.get(asset.id) ?? 0 }));
}
