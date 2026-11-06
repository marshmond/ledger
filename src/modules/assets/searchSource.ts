import { db } from '../../db';
import type { SearchResult, SearchSource } from '../../core/registry';
import { norm, score } from '../../lib/search';
import { loadAssets, whereIs } from './data';
import { STATUS_LABEL, TYPE_LABEL, type AssetRecord } from './model';

/** Letters and digits only, lower case: how serial numbers and plates are compared. */
const compact = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Pure: the Home & Assets hits for a typed query. Serial number and plate match only by exact or prefix match and only for 4+ characters;
 * their value is NEVER shown in a result. Address is not searchable. Active assets rank above stored, past and archived ones.
 */
export function searchAssetsData(raw: string, assets: AssetRecord[], cap = 8): SearchResult[] {
  const query = norm(raw).split(/\s+/).filter(Boolean);
  if (query.length === 0) return [];
  const out: SearchResult[] = [];
  const s0 = score(query, 'Home & Assets', 'home assets appliances vehicles maintenance warranty');
  if (s0 > 0) out.push({ id: 'page:/assets', title: 'Home & Assets', subtitle: 'Go to this page', kind: 'Page', score: s0, path: '/assets' });
  const idText = compact(raw);
  const hits = assets
    .map((a) => {
      const d = a.data;
      const extra = [d.manufacturer, d.model, TYPE_LABEL[d.type], d.notes, ...d.specs.flatMap((s) => [s.label, s.value])].join(' ');
      let s = score(query, d.name, extra);
      if (s === 0 && idText.length >= 4 && ((d.serialNumber && compact(d.serialNumber).startsWith(idText)) || (d.plate && compact(d.plate).startsWith(idText)))) s = 14;
      if (s > 0) s -= (d.archived ? 12 : 0) + (d.status === 'sold' || d.status === 'disposed' || d.status === 'replaced' ? 6 : d.status === 'stored' ? 2 : 0);
      return { a, s };
    })
    .filter((x) => x.s > 0)
    .sort((x, y) => y.s - x.s || x.a.data.name.localeCompare(y.a.data.name))
    .slice(0, cap);
  for (const { a, s } of hits) {
    const where = whereIs(assets, a.id);
    const bits = [where, TYPE_LABEL[a.data.type], a.data.status !== 'active' ? STATUS_LABEL[a.data.status] : '', a.data.archived ? 'Archived' : ''].filter(Boolean);
    out.push({ id: `asset:${a.id}`, title: a.data.name, subtitle: bits.join(' · '), kind: 'Asset', score: s, path: `/assets/${a.id}` });
  }
  return out;
}

export const assetsSearchSource: SearchSource = {
  group: 'Home & Assets',
  async search(query, limit) {
    return searchAssetsData(query, await loadAssets(db)).slice(0, limit);
  },
};
