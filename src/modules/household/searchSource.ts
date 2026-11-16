import type { SearchSource } from '../../core/registry';
import { norm, score } from '../../lib/search';
import { householdPath, yearAheadPath } from './model';

/**
 * Household finances has no records of its own, so global search finds its two PAGES only (ST-S2 NV-01, R3.1): "household finances" opens `#/household`, and
 * "year ahead" opens `#/household/year-ahead`. No amount, count, bill, visit or asset name is ever searched or shown here, so Hide Amounts has nothing to leak.
 * The keywords deliberately leave out "bills", "services" and "subscriptions" so a search for those still finds only their own pages.
 */
export const HOUSEHOLD_SEARCH_WORDS = 'household finances overview combined recorded spending cross-module totals review commitments expected payments';
export const YEAR_AHEAD_SEARCH_WORDS = 'year ahead next twelve months 12 months upcoming commitments planning annual yearly irregular expenses renewals deadlines';

export const householdSearchSource: SearchSource = {
  group: 'Household finances',
  search(raw) {
    const query = norm(raw).split(/\s+/).filter(Boolean);
    if (query.length === 0) return [];
    const out = [];
    const s = score(query, 'Household finances', HOUSEHOLD_SEARCH_WORDS);
    if (s > 0) out.push({ id: 'page:/household', title: 'Household finances', subtitle: 'Go to this page', kind: 'Page', score: s, path: householdPath() });
    const y = score(query, 'Year ahead', YEAR_AHEAD_SEARCH_WORDS);
    if (y > 0) out.push({ id: 'page:/household/year-ahead', title: 'Year ahead', subtitle: 'Upcoming commitments, expected payments and important dates', kind: 'Page', score: y, path: yearAheadPath() });
    return out;
  },
};
