import { db } from '../../db';
import type { RecordChoice, RecordSource } from '../../core/registry';
import { goTo } from '../../core/dueProvider';
import { dayLabel } from '../../core/time';
import { loadAssets, publicLabel } from './data';
import { assetRefId, parseAssetRef, STATUS_LABEL, type AssetRecord } from './model';
import { parseServiceRef, serviceRefId, SERVICE_KIND_LABEL, type ServiceRecord } from './service';
import { getService, loadServices } from './serviceData';

/**
 * Lets Tasks, Calendar events and others link to an asset or a service record and show it by name. Ids are text: `asset:<n>`, `service:<n>`.
 * Labels carry the place ("Home > Kitchen > Dishwasher") and "(archived)" / "(sold)" etc.; they never contain a serial number, plate or address.
 */
export const assetLabel = (assets: AssetRecord[], a: AssetRecord): string => {
  const tags = [a.data.archived ? 'archived' : '', a.data.status !== 'active' && a.data.status !== 'stored' ? STATUS_LABEL[a.data.status].toLowerCase() : ''].filter(Boolean);
  return publicLabel(assets, a.id) + (tags.length ? ` (${tags.join(', ')})` : '');
};

/** "Replaced pump, Mar 3, 2026 (Home > Kitchen > Dishwasher)". Notes, cost and provider are not part of it. */
export const serviceLabel = (assets: AssetRecord[], s: ServiceRecord): string => {
  const on = assets.some((a) => a.id === s.data.assetId) ? publicLabel(assets, s.data.assetId) : 'asset removed';
  return `${s.data.title}${s.data.date ? `, ${dayLabel(s.data.date, { year: true })}` : ''} (${on})`;
};
/** Where a service record opens: its asset's page with the record expanded, or the list when the asset is gone. */
export const servicePath = (assets: AssetRecord[], s: ServiceRecord) =>
  assets.some((a) => a.id === s.data.assetId) ? `/assets/${s.data.assetId}?service=${s.id}` : '/assets';

export const assetRecords: RecordSource = {
  async search(text) {
    const q = text.trim().toLowerCase();
    const all = await loadAssets(db);
    const rows = all.filter((a) => !q || publicLabel(all, a.id).toLowerCase().includes(q));
    rows.sort((a, b) => Number(a.data.archived) - Number(b.data.archived) || a.data.name.localeCompare(b.data.name));
    const out = rows.slice(0, 30).map<RecordChoice>((a) => ({ id: assetRefId(a.id), label: assetLabel(all, a), kind: 'Asset' }));
    // Service records are offered only when something is typed, so the short default list stays a list of assets.
    if (q) {
      const svc = (await loadServices(db)).filter((s) => serviceLabel(all, s).toLowerCase().includes(q) || SERVICE_KIND_LABEL[s.data.kind].toLowerCase().includes(q));
      out.push(...svc.slice(0, Math.max(0, 30 - out.length)).map<RecordChoice>((s) => ({ id: serviceRefId(s.id), label: serviceLabel(all, s), kind: 'Service' })));
    }
    return out;
  },
  async describe(id) {
    const sn = parseServiceRef(id);
    if (sn !== null) {
      const [all, s] = await Promise.all([loadAssets(db), getService(sn, db)]);
      return s ?{ label: serviceLabel(all, s), kind: 'Service', path: servicePath(all, s) } : null;
    }
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
