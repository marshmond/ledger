import { db } from '../../db';
import type { SearchResult, SearchSource } from '../../core/registry';
import { norm, score } from '../../lib/search';
import { cadenceText, STATUS_LABEL, type ArrangementRecord } from './model';
import { loadArrangements } from './data';
import { arrangementPath, providerPath } from './records';

/**
 * Pure: the Household Services hits for a typed query. Matches the arrangement title and the provider's name. A result line shows the
 * title, provider name, how often and the status. It NEVER shows phone, email, notes, document links, amounts or the provider's address.
 */
export function searchServicesData(raw: string, arrangements: ArrangementRecord[], cap = 8): SearchResult[] {
  const query = norm(raw).split(/\s+/).filter(Boolean);
  if (query.length === 0) return [];
  const out: SearchResult[] = [];
  const s0 = score(query, 'Household Services', 'household services providers cleaner lawn contractor arrangements');
  if (s0 > 0) out.push({ id: 'page:/services', title: 'Household Services', subtitle: 'Go to this page', kind: 'Page', score: s0, path: '/services' });
  const hits = arrangements
    .map((a) => ({ a, s: score(query, a.data.title, a.data.providerNameSnapshot) - (a.data.status === 'ended' ? 6 : a.data.status === 'paused' ? 2 : 0) }))
    .filter((x) => x.s > 0)
    .sort((x, y) => y.s - x.s || x.a.data.title.localeCompare(y.a.data.title) || x.a.id - y.a.id)
    .slice(0, cap);
  for (const { a, s } of hits) {
    out.push({
      id: `arrangement:${a.id}`, title: a.data.title, kind: 'Service', score: s, path: arrangementPath(a.id),
      subtitle: [a.data.providerNameSnapshot, cadenceText(a.data.cadence), a.data.status !== 'active' ? STATUS_LABEL[a.data.status] : ''].filter(Boolean).join(' · '),
    });
  }
  const seen = new Set<number>();
  for (const a of arrangements) {
    const id = a.data.providerContactId;
    if (id === null || seen.has(id) || !a.data.providerNameSnapshot) continue;
    seen.add(id);
    const s = score(query, a.data.providerNameSnapshot);
    if (s > 0) out.push({ id: `provider:${id}`, title: a.data.providerNameSnapshot, kind: 'Provider', score: s - 1, subtitle: 'Household service provider', path: providerPath(id) });
  }
  return out;
}

export const servicesSearchSource: SearchSource = {
  group: 'Household Services',
  async search(query, limit) {
    return searchServicesData(query, await loadArrangements(db), 8).slice(0, limit);
  },
};
