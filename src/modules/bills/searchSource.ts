import { db } from '../../db';
import type { SearchResult, SearchSource } from '../../core/registry';
import { norm, score } from '../../lib/search';
import { isSubscriptionType, STATUS_LABEL, TYPE_LABEL, type ObligationRecord } from './model';
import { loadObligations } from './data';
import { billsPath, obligationPath } from './paths';

/**
 * Pure: the Bills & Subscriptions hits for a typed query. Matches the title, the provider's name and the type label ONLY. A result line shows
 * the provider, the type and a non-active status. It NEVER shows or matches amounts, notes, document links, references or contact details.
 * Ended items rank last.
 */
export function searchBillsData(raw: string, obligations: ObligationRecord[], cap = 8): SearchResult[] {
  const query = norm(raw).split(/\s+/).filter(Boolean);
  if (query.length === 0) return [];
  const out: SearchResult[] = [];
  const s0 = score(query, 'Bills & Subscriptions', 'bills subscriptions recurring commitments renewals');
  if (s0 > 0) out.push({ id: 'page:/bills', title: 'Bills & Subscriptions', subtitle: 'Go to this page', kind: 'Page', score: s0, path: billsPath() });
  const hits = obligations
    .map((r) => ({ r, s: score(query, r.data.title, `${r.data.providerNameSnapshot} ${TYPE_LABEL[r.data.type]}`) - (r.data.status === 'ended' ? 6 : r.data.status === 'paused' ? 2 : 0) }))
    .filter((x) => x.s > 0)
    .sort((x, y) => y.s - x.s || x.r.data.title.localeCompare(y.r.data.title) || x.r.id - y.r.id)
    .slice(0, cap);
  for (const { r, s } of hits) {
    out.push({
      id: `obligation:${r.id}`, title: r.data.title, kind: isSubscriptionType(r.data.type) ? 'Subscription' : 'Bill', score: s, path: obligationPath(r.id),
      subtitle: [r.data.providerNameSnapshot, TYPE_LABEL[r.data.type], r.data.status !== 'active' ? STATUS_LABEL[r.data.status] : ''].filter(Boolean).join(' · '),
    });
  }
  return out;
}

export const billsSearchSource: SearchSource = {
  group: 'Bills & Subscriptions',
  async search(query, limit) {
    return searchBillsData(query, await loadObligations(db), 8).slice(0, limit);
  },
};
