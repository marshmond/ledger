import { db } from '../../db';
import type { RecordChoice, RecordSource } from '../../core/registry';
import { goTo } from '../../core/dueProvider';
import { loadAssets, publicLabel } from './data';
import { assetRefId, parseAssetRef, STATUS_LABEL, type AssetRecord } from './model';

/**
 * Lets Tasks, Calendar events and others link to an asset and show it by name. Ids are text, `asset:<n>`. Labels carry the place
 * ("Home > Kitchen > Dishwasher") and "(archived)" / "(sold)" etc.; they never contain a serial number, plate or address.
 */
export const assetLabel = (assets: AssetRecord[], a: AssetRecord): string => {
  const tags = [a.data.archived ? 'archived' : '', a.data.status !== 'active' && a.data.status !== 'stored' ? STATUS_LABEL[a.data.status].toLowerCase() : ''].filter(Boolean);
  return publicLabel(assets, a.id) + (tags.length ? ` (${tags.join(', ')})` : '');
};

export const assetRecords: RecordSource = {
  async search(text) {
    const q = text.trim().toLowerCase();
    const all = await loadAssets(db);
    const rows = all.filter((a) => !q || publicLabel(all, a.id).toLowerCase().includes(q));
    rows.sort((a, b) => Number(a.data.archived) - Number(b.data.archived) || a.data.name.localeCompare(b.data.name));
    return rows.slice(0, 30).map<RecordChoice>((a) => ({ id: assetRefId(a.id), label: assetLabel(all, a), kind: 'Asset' }));
  },
  async describe(id) {
    const n = parseAssetRef(id);
    if (n === null) return null;
    const all = await loadAssets(db);
    const a = all.find((x) => x.id === n);
    return a ? { label: assetLabel(all, a), kind: 'Asset', path: `/assets/${a.id}` } : null;
  },
  async openSource(id) {
    const info = await assetRecords.describe(id);
    if (!info) return false;
    goTo(info.path);
    return true;
  },
};
