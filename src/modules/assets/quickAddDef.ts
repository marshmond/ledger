import { liveQuery } from 'dexie';
import type { QuickAddDef } from '../../core/registry';
import { createAsset, loadAssets, publicLabel, removeNewAsset } from './data';
import { blankAsset, nameKey, tidy, TYPE_LABEL, type AssetRecord, type AssetType } from './model';

let known: AssetRecord[] = [];

export interface AssetQuick { name: string; parentId: number | null; type: AssetType; where: string; note?: string }

/**
 * Pure. `Dishwasher in Kitchen`: if the words after the LAST " in " are exactly one live, non-archived asset's name (case, accents and spaces
 * ignored), that asset is the parent. Otherwise the whole text is the name, with a visible note. No fuzzy or prefix matching.
 * `plain` turns the shorthand off (the whole text is the name).
 */
export function parseAssetQuick(text: string, assets: AssetRecord[], plain = false): AssetQuick | null {
  const whole = tidy(text);
  if (!whole || whole.length > 120) return null;
  const at = plain ? -1 : whole.toLowerCase().lastIndexOf(' in ');
  let name = whole, parent: AssetRecord | undefined, note: string | undefined;
  if (at > 0) {
    const head = tidy(whole.slice(0, at)), tail = tidy(whole.slice(at + 4));
    if (head && tail) {
      const hits = assets.filter((a) => !a.data.archived && nameKey(a.data.name) === nameKey(tail));
      if (hits.length === 1) { parent = hits[0]; name = head; }
      else if (hits.length === 0) note = `No asset is named "${tail}", so "in ${tail}" stays in the name`;
      else note = `Two assets are named "${tail}", so "in ${tail}" stays in the name`;
    }
  }
  const type: AssetType = parent ? 'appliance' : 'other';
  return { name, parentId: parent?.id ?? null, type, where: parent ? publicLabel(assets, parent.id) : '', note };
}

/** The Add box's Asset destination: a name, optionally "in <existing asset>". Everything else is filled in on the asset's own page. */
export const assetQuickAdd: QuickAddDef = {
  id: 'asset',
  label: 'Asset',
  prefix: 'a',
  aliases: ['asset', 'item'],
  start() {
    const sub = liveQuery(() => loadAssets()).subscribe({ next: (v) => { known = v; }, error: () => undefined });
    return () => sub.unsubscribe();
  },
  parse(text, opts) {
    const p = parseAssetQuick(text, known, opts?.plain);
    if (!p) return null;
    return {
      summary: `${p.name}${p.where ? `, in ${p.where}` : ''}, ${TYPE_LABEL[p.type]}${p.note ? ` (${p.note})` : ''}`,
      fields: [{ label: 'Name', value: p.name }, ...(p.where ? [{ label: 'Where', value: p.where }] : []), { label: 'Type', value: TYPE_LABEL[p.type] }, ...(p.note ? [{ label: 'Note', value: p.note }] : [])],
      payload: p,
    };
  },
  async commit(preview) {
    const p = preview.payload as AssetQuick;
    const id = await createAsset(blankAsset({ name: p.name, type: p.type, parentId: p.parentId }));
    return async () => { await removeNewAsset(id); };
  },
};
