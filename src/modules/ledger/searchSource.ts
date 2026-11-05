import { liveQuery } from 'dexie';
import { db } from '../../db';
import type { SearchResult, SearchSource } from '../../core/registry';
import { KIND_LABEL, searchAll, type SearchData } from '../../lib/search';

/**
 * What global search finds in Ledger: its pages, accounts, investment accounts, holdings, loans, paycheck scenarios, scheduled items (by
 * payee) and transactions (with "See all N"). The matching is the same as before (`lib/search.ts`); this only reads the tables and turns
 * each hit into a full address (`/ledger/...`).
 *
 * Part C measured it: scanning 20,000 transactions takes about 8 ms, but reading them out of the database takes about 90 ms. So while the
 * search dialog is open (`start`) a live snapshot is kept in memory, and each keystroke only scans it. Nothing is stored or indexed.
 */
async function loadData(): Promise<SearchData> {
  const [accounts, invAccounts, securities, holdings, loans, scenarios, txns, rules] = await Promise.all([
    db.accounts.toArray(), db.invAccounts.toArray(), db.securities.toArray(), db.holdings.toArray(), db.loans.toArray(), db.payScenarios.toArray(), db.txns.toArray(), db.recurring.toArray(),
  ]);
  return { accounts, invAccounts, securities, holdings, loans, scenarios, txns, rules };
}

let snapshot: SearchData | null = null;

export const ledgerSearchSource: SearchSource = {
  group: 'Ledger',
  start() {
    const sub = liveQuery(loadData).subscribe({ next: (v) => { snapshot = v; }, error: () => { snapshot = null; } });
    return () => { sub.unsubscribe(); snapshot = null; };
  },
  async search(query, limit) {
    const data = snapshot ?? (await loadData());
    return searchAll(query, data, limit).map<SearchResult>((h, i) => ({
      id: `${h.kind}:${h.to}:${i}`,
      title: h.title,
      subtitle: h.subtitle,
      kind: KIND_LABEL[h.kind],
      score: h.score,
      path: `/ledger${h.to}`,
    }));
  },
};
