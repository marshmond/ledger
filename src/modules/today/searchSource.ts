import type { SearchSource } from '../../core/registry';
import { norm, score } from '../../lib/search';

/** Today has nothing of its own to search: only the page itself, so "today" or "agenda" gets you here. */
export const todaySearchSource: SearchSource = {
  group: 'Today',
  search(raw) {
    const query = norm(raw).split(/\s+/).filter(Boolean);
    if (query.length === 0) return [];
    const s = score(query, 'Today', 'home overview agenda what is due alerts overdue coming up');
    return s > 0 ? [{ id: 'page:/today', title: 'Today', subtitle: 'Go to this page', kind: 'Page', score: s, path: '/today' }] : [];
  },
};
