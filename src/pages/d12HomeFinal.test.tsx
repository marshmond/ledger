import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { ModuleBase } from '../core/router';
import { computeBudget } from '../lib/budget';
import { budgetBars, spendingSlices } from '../lib/homeCharts';
import { spendingSnapshot } from '../lib/spending';
import type { Account, Category, Txn } from '../types';
import HomeHero, { type HeroProps } from './HomeHero';
import { CheckinSteps, OwnOweBars, type CheckinStepLike } from './HomeParts';

/**
 * D12 final visual pass, Ledger Home. Four presentation changes (Assets and Owed in the hero, two bars for what you own and owe, a segmented check-in bar, a divider
 * between the spending and budget panels) and one decision NOT to build something (a category-keyed join of spending and budget). Static markup and source checks:
 * structure and text, not a look. Every figure drawn here is one the page already had.
 */
const src = (f: string) => readFileSync(f, 'utf8');
const code = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/ \/\/ .*$/gm, '');
const wrap = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(createElement(MemoryRouter, null, createElement(ModuleBase, { value: '/ledger' }, el)));

describe('D12 final: Assets and Owed in the hero', () => {
  const base: HeroProps = { netCents: 3125804, change: null, nwBars: [], monthName: 'November 2026', incomeCents: 320000, spentCents: 238200, readyCents: 1905604 };
  const render = (over: Partial<HeroProps>) => wrap(createElement(HomeHero, { ...base, ...over }));

  it('names each figure for what it is: "Assets (positive balances)" and "Owed (cards and loans)", as a label and an amount in one list', () => {
    const h = render({ assetsCents: 3183004, owedCents: 57200 });
    expect(h).toMatch(/<dt>Assets \(positive balances\)<\/dt><dd>\$31,830\.04<\/dd>/);
    expect(h).toMatch(/<dt>Owed \(cards and loans\)<\/dt><dd>\$572\.00<\/dd>/);
    expect(h).toContain('<dl class="hh-pair">');
    expect(h).toContain('$31,258.04'); // the net worth is still the page's own figure
  });

  it('draws nothing when there is nothing to show, and never adds, subtracts or equates the two figures with the net worth', () => {
    expect(render({})).not.toContain('hh-pair');
    expect(render({ assetsCents: null, owedCents: null })).not.toContain('Assets (positive balances)');
    const hero = code(src('src/pages/HomeHero.tsx'));
    expect(hero).not.toMatch(/assetsCents\s*-|owedCents\s*-|-\s*owedCents|assetsCents\s*\+|\+\s*owedCents|=\s*net|net worth\s*=/i);
    expect(render({ assetsCents: 3183004, owedCents: 57200 })).not.toMatch(/ minus |less owed|=\s*\$/);
  });

  it('the page gives it the same values as its "What you own and owe" section and shows them only when at least one is more than nothing', () => {
    const p = code(src('src/pages/HomePage.tsx'));
    expect(p).toContain('assetsCents={net && (assetTotal > 0 || owed > 0) ? assetTotal : null}');
    expect(p).toContain('owedCents={net && (assetTotal > 0 || owed > 0) ? owed : null}');
    expect(p).toContain('<OwnOweBars assetsCents={assetTotal} owedCents={owed} parts={assets}');
  });

  it('a seven-digit amount renders whole (the stylesheet lets it wrap by character, never clip)', () => {
    const h = render({ netCents: 1234567890, assetsCents: 1234567890, owedCents: 987654321 });
    expect(h).toContain('$12,345,678.90');
    expect(h).toContain('$9,876,543.21');
    expect(src('src/pages/home.css')).toMatch(/\.hh-chip2 dd \{[^}]*overflow-wrap: anywhere;/);
  });
});

describe('D12 final: what you own and owe, as two bars', () => {
  const parts = [{ name: 'Cash', cents: 3183004 }, { name: 'Investments', cents: 120000 }];
  const empty = createElement('p', { className: 'muted' }, 'Add accounts, investments or property to see the mix.');
  const widths = (h: string) => [...h.matchAll(/class="bar-fill[^"]*" style="width:([\d.]+)%"/g)].map((m) => Number(m[1]));
  const render = (a: number, o: number, p = parts) => renderToStaticMarkup(createElement(OwnOweBars, { assetsCents: a, owedCents: o, parts: p, empty }));

  it('assets greater than owed: the assets bar fills the track, the owed bar is the same scale, no warning words, the labels and amounts are the page\'s', () => {
    const h = render(3303004, 57200);
    expect(h).toContain('Assets (positive balances)');
    expect(h).toContain('Owed (cards and loans)');
    expect(h).toContain('$33,030.04');
    expect(h).toContain('$572.00');
    const [a, o] = widths(h);
    expect(a).toBe(100);
    expect(o).toBeGreaterThan(0);
    expect(o).toBeLessThan(5);
    expect(h).not.toContain('More than assets');
    expect(h).not.toContain('bar-fill over');
  });

  it('owed greater than assets: the owed bar fills the track and says "More than assets" in words; the assets bar is the shorter one on the same scale', () => {
    const h = render(100000, 400000);
    const [a, o] = widths(h);
    expect(o).toBe(100);
    expect(a).toBe(25);
    expect(h).toContain('<span class="bar-flag">More than assets</span>$4,000.00');
    expect(h).toContain('bar-fill over');
  });

  it('absent values: no assets shows the page\'s own empty words and no bars; no debts is a real $0.00 bar of no width; equal amounts are both full', () => {
    const none = renderToStaticMarkup(createElement(OwnOweBars, { assetsCents: 0, owedCents: 50000, parts: [], empty }));
    expect(none).toContain('Add accounts, investments or property to see the mix.');
    expect(none).not.toContain('bar-track');
    expect(none).not.toContain('$500.00'); // ids-ok: an amount, never an id. An owed figure is not drawn alone, as before
    const zero = render(250000, 0);
    expect(zero).toContain('$0.00');
    expect(widths(zero)).toEqual([100, 0]);
    expect(widths(render(70000, 70000))).toEqual([100, 100]);
    expect(render(70000, 70000)).not.toContain('More than assets');
  });

  it('shows no ratio and works out no difference: the bars are hidden from assistive technology, the amounts are text, the parts list keeps each asset and its amount', () => {
    const h = render(3303004, 57200);
    expect(h).not.toMatch(/%</);
    expect(h).not.toMatch(/role="progressbar"|aria-valuenow/);
    expect((h.match(/class="bar-track" aria-hidden="true"/g) ?? []).length).toBe(2);
    expect(h).toContain('aria-label="What the assets are made of"');
    expect(h).toMatch(/<li><span>Cash<\/span><span class="home-parts-val">\$31,830\.04<\/span><\/li>/);
    expect(h).toMatch(/<li><span>Investments<\/span><span class="home-parts-val">\$1,200\.00<\/span><\/li>/);
    const c = code(src('src/pages/HomeParts.tsx'));
    expect(c).not.toMatch(/assetsCents\s*-\s*owedCents|owedCents\s*-\s*assetsCents|netWorth|net worth/i);
  });

  it('the shared chart file is not touched by this change (the bars here are plain markup, not a new use of BarList)', () => {
    expect(code(src('src/pages/HomeParts.tsx'))).not.toContain('BarList');
    expect(code(src('src/pages/HomePage.tsx'))).not.toContain('<Donut slices={assets}');
  });
});

describe('D12 final: the monthly check-in as a segmented bar', () => {
  const steps: CheckinStepLike[] = [{ id: 'a', status: 'done' }, { id: 'b', status: 'todo' }, { id: 'c', status: 'na' }, { id: 'd', status: 'done' }, { id: 'e', status: 'todo' }];
  const render = (over: Partial<Parameters<typeof CheckinSteps>[0]> = {}) => renderToStaticMarkup(createElement(CheckinSteps, { steps, done: 2, total: 4, complete: false, nextTitle: 'Compare balances with your bank', streak: 0, ...over }));

  it('draws one segment for each step that applies (not-applicable steps are not drawn) and fills the ones that are done', () => {
    const h = render();
    expect((h.match(/<span class="on"><\/span>/g) ?? []).length).toBe(2);
    expect((h.match(/<span class=""><\/span>/g) ?? []).length).toBe(2);
    expect((h.match(/<span class="(on)?"><\/span>/g) ?? []).length).toBe(4);
  });

  it('is a named progress bar that says "N of M steps done", and the text beside it repeats the count and names the next step', () => {
    const h = render();
    expect(h).toContain('role="progressbar" aria-label="Monthly check-in progress" aria-valuemin="0" aria-valuemax="4" aria-valuenow="2" aria-valuetext="2 of 4 steps done"');
    expect(h).toContain('<strong>2 of 4</strong> steps done this month');
    expect(h).toContain('Next</span> Compare balances with your bank');
  });

  it('the complete state and the streak: "All steps done." with every segment filled; a streak shows only above one month; no steps at all draws no segments and does not fail', () => {
    const all: CheckinStepLike[] = [{ id: 'a', status: 'done' }, { id: 'b', status: 'done' }];
    const h = render({ steps: all, done: 2, total: 2, complete: true, nextTitle: undefined, streak: 3 });
    expect(h).toContain('All steps done.');
    expect(h).not.toContain('Next</span>');
    expect(h).toContain('3 months in a row');
    expect((h.match(/<span class="on"><\/span>/g) ?? []).length).toBe(2);
    expect(render({ streak: 1 })).not.toContain('in a row');
    const none = render({ steps: [], done: 0, total: 0, complete: false, nextTitle: undefined });
    expect(none).not.toContain('<span class=""');
    expect(none).toContain('<strong>0 of 0</strong>');
  });

  it('only draws what the check-in already decided: the page passes its steps, counts, completion and next step straight through, and no rule is written here', () => {
    const p = code(src('src/pages/HomePage.tsx'));
    expect(p).toContain('<CheckinSteps steps={checkin.steps} done={checkin.progress.done} total={checkin.progress.total} complete={checkin.progress.complete} nextTitle={nextStep?.title} streak={checkin.streak} />');
    expect(p).toContain("const checkinOn = checkin.ready && checkin.progress.total > 0;"); // when it shows is unchanged
    expect(p).toContain("checkin.steps.find((s) => s.status === 'todo')");
    const c = code(src('src/pages/HomeParts.tsx'));
    expect(c).not.toMatch(/useCheckin|buildCheckin|withMarks|setMark|complete\s*=\s*|done\s*===\s*total/);
  });
});

describe('D12 final: why spending and budget stay two panels (the evidence for not joining them by category)', () => {
  const checking: Account = { id: 1, name: 'Checking', kind: 'checking', openingBalanceCents: 100000, openingDate: '2026-01-01' };
  const savings: Account = { id: 2, name: 'Long-term savings', kind: 'savings', openingBalanceCents: 100000, openingDate: '2026-01-01', budgetExcluded: true };
  const groceries: Category = { id: 10, groupId: 1, name: 'Groceries', kind: 'expense' };
  const groceries2: Category = { id: 20, groupId: 2, name: 'Groceries', kind: 'expense' };
  let n = 1;
  const tx = (accountId: number, amountCents: number, categoryId: number): Txn => ({ id: n++, accountId, date: '2026-11-05', amountCents, payee: '', memo: '', status: 'cleared', categoryId });

  it('the spending side is keyed by category NAME: two different categories with one name become one slice, and a slice carries no category id', () => {
    const snap = spendingSnapshot([tx(1, -4000, 10), tx(1, -2500, 20)], [groceries, groceries2], '2026-11', 10);
    expect(snap.top).toEqual([{ name: 'Groceries', cents: 6500 }]);
    expect(Object.keys(snap.top[0]).sort()).toEqual(['cents', 'name']);
    expect(spendingSlices([tx(1, -4000, 10)], [groceries], '2026-11')[0]).toEqual({ name: 'Groceries', cents: 4000 });
  });

  it('the budget side counts a different set of accounts: money spent from an account the owner left out of the budget is in the spending slice but not in the budget row', () => {
    const txns = [tx(1, -4000, 10), tx(2, -10000, 10)];
    const spent = spendingSnapshot(txns, [groceries], '2026-11', 10).top[0].cents;
    const budget = computeBudget({ accounts: [checking, savings], categories: [groceries], txns, assignments: [{ month: '2026-11', key: 'c10', amountCents: 30000 }], month: '2026-11' });
    const row = budget.rows.find((r) => r.categoryId === 10)!;
    const bar = budgetBars(budget.rows)[0];
    expect(spent).toBe(14000);
    expect(bar.spentCents).toBe(4000);
    expect(spent).not.toBe(bar.spentCents); // one category, two different "spent" figures, both correct by their own definitions
    expect(row.categoryId).toBe(10);
    expect(Object.keys(bar)).not.toContain('categoryId'); // the budget bar carries a name, not an id
  });

  it('the two lists are cut differently (5 plus "Other" against 6 bars), so a category missing from one is not proof that it has no spending or no budget there', () => {
    const cats: Category[] = Array.from({ length: 8 }, (_, i) => ({ id: 100 + i, groupId: 1, name: `Cat ${i}`, kind: 'expense' as const }));
    const txns = cats.map((c, i) => tx(1, -(1000 + i * 100), c.id!));
    const slices = spendingSlices(txns, cats, '2026-11');
    expect(slices).toHaveLength(6);
    expect(slices[5].name).toBe('Other'); // three categories are lumped under a label that is no category
    const budget = computeBudget({ accounts: [checking], categories: cats, txns, assignments: [], month: '2026-11' });
    expect(budgetBars(budget.rows)).toHaveLength(6);
  });

  it('so the page still draws two panels in one card, with no join in the source', () => {
    const p = code(src('src/pages/HomePage.tsx'));
    const a = p.slice(p.indexOf('analysis: {'), p.indexOf('cashflow: {'));
    expect(a).toContain('<h3>Spending by category</h3>');
    expect(a).toContain('<h3>Budget progress</h3>');
    expect(a).not.toMatch(/categoryId|\.find\(\(b\) => b\.name|\.find\(\(s\) => s\.name|new Map\(slices|new Map\(bars/);
    expect(src('src/pages/home.css')).toMatch(/\.home-split > \.home-panel \+ \.home-panel \{ padding-left: var\(--sp-5\); border-left: 1px solid var\(--line\); \}/);
  });
});

describe('D12 final: the approved structure and customization are untouched', () => {
  it('still the fixed top, two columns, and the section model with its reorder, hide, reset and earlier-layout controls', () => {
    const p = code(src('src/pages/HomePage.tsx'));
    for (const f of ['<HomeHero', 'className="home-cols"', 'className="home-primary"', 'className="home-side"', 'moveSection(sections, id, -1)', 'moveSection(sections, id, 1)', 'hideSection(sections, id)', 'showSection(sections, id)', 'forgetSections()', 'readCustomLegacy()', 'resetToDefault']) expect(p, f).toContain(f);
    expect(p).not.toMatch(/LAYOUT_KEY|ledger\.home\.layout\.v1/);
  });
});
