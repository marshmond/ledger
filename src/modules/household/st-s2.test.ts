import { readFileSync } from 'node:fs';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { allSearchSources } from '../../core/registry';
import { registerModules } from '..';
import { searchBillsData } from '../bills/searchSource';
import { householdSearchSource } from './searchSource';
import { loadHouseholdOverview } from './overview';
import { SpendingCard } from './Parts';
import { TODAY, seed } from './householdSeed';
import { fresh } from '../bills/billsTestkit';

/** ST-S2: Household finances is findable in Search (page only, no figures), and the household notice no longer borrows Finance's word "reconciled". */
const shown = (c: number) => `$${(c / 100).toFixed(2)}`;
const run = async (q: string) => Promise.resolve(householdSearchSource.search(q, 8));

describe('Search finds the Household finances page', () => {
  it('by name and by what people would type, opening #/household', async () => {
    for (const q of ['household finances', 'Household Finances', 'household', 'finances', 'household spending', 'combined spending']) {
      const r = await run(q);
      expect(r, q).toHaveLength(1);
      expect(r[0]).toMatchObject({ id: 'page:/household', title: 'Household finances', kind: 'Page', path: '/household' });
    }
    expect(await run('')).toEqual([]);
    expect(await run('   ')).toEqual([]);
    expect(await run('zebra')).toEqual([]);
  });
  it('shows no amount, count or record name: the result is the same fixed page whatever the data', async () => {
    const r = await run('household');
    expect(`${r[0].title} ${r[0].subtitle}`).not.toMatch(/\$|\d/);
    expect(r[0].subtitle).toBe('Go to this page');
  });
  it('is registered once, as a page destination, and does not duplicate the Bills or Services entries', async () => {
    registerModules();
    const sources = allSearchSources();
    expect(sources.filter((s) => s.moduleId === 'household')).toHaveLength(1);
    const all = (await Promise.all(sources.map(async (s) => (await Promise.resolve(s.source.search('household', 20))).map((r) => ({ module: s.moduleId, ...r }))))).flat();
    const ids = all.map((r) => `${r.module}:${r.id}`);
    expect(new Set(ids).size).toBe(ids.length);
    expect(all.filter((r) => r.path === '/household')).toHaveLength(1);
    // a search for "bills" still finds only Bills' own page, not Household finances
    const bills = (await Promise.all(sources.map(async (s) => (await Promise.resolve(s.source.search('bills', 20))).map((r) => r.path)))).flat();
    expect(bills).not.toContain('/household');
    expect(searchBillsData('household', [])).toEqual([]);
  });
  it('adds no Quick Add prefix and no new navigation framework (the module declares only a search source and a Today card)', async () => {
    registerModules();
    const m = (await import('./index')).householdModule;
    expect(Object.keys(m.contributes ?? {}).sort()).toEqual(['searchSource', 'todayCards']);
  });
});

describe('household notice wording (UX-02)', () => {
  const card = (s: Awaited<ReturnType<typeof loadHouseholdOverview>>['spending']) => renderToStaticMarkup(h(SpendingCard, { s, periodLabel: 'All time', periodOptions: [], period: 'all', onPeriod: () => undefined, money: shown }));
  it('says "Cross-module totals verified" when nothing is unresolved, and says it is not a bank-statement check', async () => {
    const d = fresh('wording'); await seed(d);
    const html = card((await loadHouseholdOverview('all', TODAY, d)).spending);
    expect(html).toMatch(/Cross-module totals verified/);
    expect(html).toMatch(/not a check against a bank statement/);
    expect(html).not.toMatch(/Some spending relationships need review/);
    expect(html).not.toMatch(/Not fully reconciled/);
  });
  it('says "Some spending relationships need review" when a linked payment is missing, and does not claim verification', async () => {
    const d = fresh('wording'); const s = await seed(d);
    await d.txns.delete(s.T4.id!);
    const html = card((await loadHouseholdOverview('all', TODAY, d)).spending);
    expect(html).toMatch(/Some spending relationships need review/);
    expect(html).not.toMatch(/Cross-module totals verified/);
    expect(html).not.toMatch(/Not fully reconciled/);
  });
  it("Finance's own statement status is untouched: the word 'reconciled' is still a Finance status and still labelled as Finance's mark", () => {
    expect(readFileSync('src/types.ts', 'utf8')).toMatch(/TxnStatus = 'pending' \| 'cleared' \| 'reconciled'/);
    expect(readFileSync('src/modules/household/Parts.tsx', 'utf8')).toMatch(/reconciled: 'marked reconciled in Finance'/);
    expect(readFileSync('src/modules/bills/payments.ts', 'utf8')).toMatch(/reconciled: 'Recorded in Finance: reconciled'/);
    expect(readFileSync('src/lib/ledger.ts', 'utf8')).toMatch(/reconciled/);
  });
});
