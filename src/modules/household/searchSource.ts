import type { SearchSource } from '../../core/registry';
import { norm, score } from '../../lib/search';
import { householdPath } from './model';

/**
 * Household finances has no records of its own, so global search finds the PAGE only (ST-S2, NV-01): typing "household finances", "household spending" or "combined
 * spending" offers "Household finances" and opens `#/household`. No amount, count, bill, visit or asset name is ever searched or shown here, so Hide Amounts has nothing to leak.
 * The keywords deliberately leave out "bills", "services" and "subscriptions" so a search for those still finds only their own pages.
 */
export const HOUSEHOLD_SEARCH_WORDS = 'household finances overview combined recorded spending cross-module totals review';

export const householdSearchSource: SearchSource = {
  group: 'Household finances',
  search(raw) {
    const query = norm(raw).split(/\s+/).filter(Boolean);
    if (query.length === 0) return [];
    const s = score(query, 'Household finances', HOUSEHOLD_SEARCH_WORDS);
    return s > 0 ? [{ id: 'page:/household', title: 'Household finances', subtitle: 'Go to this page', kind: 'Page', score: s, path: householdPath() }] : [];
  },
};
