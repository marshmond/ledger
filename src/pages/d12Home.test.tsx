import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { ModuleBase } from '../core/router';
import { CARD_IDS, DEFAULT_LAYOUT, LAYOUT_KEY, sanitizeLayout } from '../lib/homeLayout';
import { PRESETS, extrasOf } from '../palette';
import { BarList, Donut, PairedColumns } from '../ui/charts';
import HomePage from './HomePage';

/**
 * D12, Ledger Home. The screen was restyled; nothing it counts, stores or links to changed. These tests pin that: the same twelve cards in the same stored layout, the
 * same figures drawn by the same chart components, no new derived figure, and the empty page. Static markup, so they prove structure and text, not how it looks
 * (that was checked in a real browser) and not real devices.
 */
const src = (f: string) => readFileSync(f, 'utf8');
const code = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/ \/\/ .*$/gm, '');
const page = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(ModuleBase, { value: '/ledger' }, createElement(HomePage))));

describe('D12 Home: the twelve cards and the saved layout are untouched', () => {
  it('lists the same twelve card ids, and the default order and widths are unchanged', () => {
    expect([...CARD_IDS]).toEqual(['start', 'networth', 'attention', 'month', 'spending', 'budget', 'cashflow', 'breakdown', 'recent', 'comingup', 'checkin', 'goals']);
    expect(DEFAULT_LAYOUT.map((c) => `${c.id}:${c.size}`)).toEqual(['start:full', 'networth:half', 'attention:half', 'month:half', 'spending:half', 'budget:half', 'cashflow:half', 'breakdown:half', 'recent:half', 'comingup:half', 'checkin:half', 'goals:half']);
    expect(LAYOUT_KEY).toBe('ledger.home.layout.v1');
  });

  it('a saved layout is read exactly as before: order and widths kept, unknown and repeated cards dropped, nothing reset', () => {
    const saved = [{ id: 'goals', size: 'full' }, { id: 'networth', size: 'half' }, { id: 'goals', size: 'half' }, { id: 'nonsense', size: 'full' }, { id: 'month', size: 'weird' }];
    expect(sanitizeLayout(saved)).toEqual([{ id: 'goals', size: 'full' }, { id: 'networth', size: 'half' }, { id: 'month', size: 'half' }]);
    expect(sanitizeLayout(null)).toEqual(DEFAULT_LAYOUT);
  });

  it('the page never writes or removes the earlier layout key (it only reads it); its own keys are the onboarding flag, the new arrangement and the one-time note', () => {
    const c = code(src('src/pages/HomePage.tsx'));
    expect([...c.matchAll(/localStorage\.\w+\(\s*([A-Z_]+|'[^']+')/g)].map((m) => m[1])).toEqual(['ONBOARD_KEY', 'ONBOARD_KEY', 'NOTICE_KEY', 'NOTICE_KEY']);
    expect(c).not.toMatch(/LAYOUT_KEY|ledger\.home\.layout\.v1/);
    const lib = code(src('src/lib/homeSections.ts'));
    expect(lib).not.toMatch(/(setItem|removeItem)\(\s*LAYOUT_KEY/); // the earlier key is read, never changed
    expect(lib).toMatch(/removeItem\(SECTIONS_KEY\)/);
    expect(code(src('src/lib/homeLayout.ts'))).toContain("'ledger.home.layout.v1'");
  });

  it('every earlier card still has its title and its place on the page: the net-worth and month cards are the top panel, Needs attention and Get started are the strip under it, the rest are sections', () => {
    const s = src('src/pages/HomePage.tsx') + src('src/pages/HomeHero.tsx') + src('src/lib/homeSections.ts');
    for (const t of ['Get started', 'Net worth', 'Needs attention', 'Spending by category', 'Budget progress', 'Income vs spending', 'What you own and owe', 'Recent transactions', 'Coming up', 'Monthly check-in', 'Goals']) expect(s, t).toContain(t);
    expect(src('src/pages/HomePage.tsx')).toContain('data-section={id}');
    expect(page).toContain('Where you stand');
    expect(page).toContain('Needs attention');
  });
});

describe('D12 Home: the empty page', () => {
  it('draws the heading, the hero with its trend note, and every honest empty state (no spending, no budget, no chart data, no transactions, no goals)', () => {
    expect(page).toMatch(/<h1[^>]*>Home<\/h1>/);
    expect(page).toContain('Net worth');
    expect(page).toContain('A trend line appears once a couple of months of history have been saved.');
    expect(page).toContain('Assign money to categories on the Budget page to track it here.');
    expect(page).toContain('Income and spending for the last six months will chart here.');
    expect(page).toContain('Add accounts, investments or property to see the mix.');
    expect(page).toContain('No transactions yet');
    expect(page).toContain('No goals yet');
    expect(page).toMatch(/No spending recorded in [A-Z][a-z]+ \d{4} yet\./);
  });

  it('Get started is one slim row whose steps stay reachable behind "Show all steps"', () => {
    expect(page).toContain('Get started');
    expect(page).toMatch(/aria-expanded="false"[^>]*aria-controls="home-start-steps"|aria-controls="home-start-steps"[^>]*aria-expanded="false"/);
    expect(page).toContain('Show all steps');
    expect(page).toContain('Dismiss');
    expect(page).toContain('Add your checking, savings, and credit card accounts'); // the first step is the "Next" one
    expect(page).not.toContain('id="home-start-steps"'); // collapsed until asked for
  });

  it('shows no dollar figure it could not have read (an empty household shows the zero net worth only)', () => {
    const figures = [...page.matchAll(/\$[\d,]+\.\d\d/g)].map((m) => m[0]);
    expect(new Set(figures)).toEqual(new Set(['$0.00']));
  });
});

describe('D12 Home: the same data reaches the same charts', () => {
  const points = [{ label: 'Jul', a: 641200, b: 289799 }, { label: 'Aug', a: 641200, b: 284399 }, { label: 'Nov', a: 320000, b: 238200, partial: true }];
  const html = renderToStaticMarkup(createElement(PairedColumns, { points, aName: 'Income', bName: 'Spent', label: 'Income and spending by month: test' }));

  it('Income vs spending draws one pair of columns per month, with heights from the values and a tooltip that names each figure', () => {
    expect((html.match(/<rect /g) ?? []).length).toBe(6);
    for (const t of ['Jul: Income $6,412.00', 'Jul: Spent $2,897.99', 'Aug: Spent $2,843.99', 'Nov (so far): Income $3,200.00', 'Nov (so far): Spent $2,382.00']) expect(html, t).toContain(t);
    expect(html).toContain('aria-label="Income and spending by month: test"');
    expect(html).toContain('role="img"');
  });

  it('only the period marked in progress is drawn as "so far"; the others are plain', () => {
    expect((html.match(/col-a partial/g) ?? []).length).toBe(1);
    expect((html.match(/col-b partial/g) ?? []).length).toBe(1);
    expect(html).toContain('so far</text>');
    expect(renderToStaticMarkup(createElement(PairedColumns, { points: points.map((p) => ({ ...p, partial: undefined })), aName: 'Income', bName: 'Spent', label: 'x' }))).not.toContain('partial');
  });

  it('the axis shows only the largest drawn value rounded up to a tidy tick (nothing averaged or added)', () => {
    expect(html).toContain('$7.5K');
    expect(html).toContain('$0<');
  });

  it('the spending columns read the "spending" color token, the income columns the existing positive color', () => {
    const css = src('src/styles.css');
    expect(css).toMatch(/\.col-b \{ fill: var\(--chart-spend\); \}/);
    expect(css).toMatch(/\.col-a \{ fill: var\(--pos\); \}/);
    expect(src('src/pages/home.css')).toMatch(/\.col-b\.partial \{[^}]*var\(--chart-spend\)/);
  });

  it('a bar that is over its limit says so in words only when asked; the fill and the figure are unchanged', () => {
    const over = renderToStaticMarkup(createElement(BarList, { bars: [{ name: 'Shopping', ratio: 1.4, detail: '$78.00, none set aside', over: true, overLabel: 'Over budget' }, { name: 'Gas', ratio: 0.3, detail: '$54.00 of $150.00' }] }));
    expect(over).toContain('<span class="bar-flag">Over budget</span>$78.00, none set aside');
    expect((over.match(/bar-flag/g) ?? []).length).toBe(1);
    expect(over).toContain('aria-valuenow="100"');
    expect(over).toContain('aria-valuenow="30"');
    expect(renderToStaticMarkup(createElement(BarList, { bars: [{ name: 'A', ratio: 2, detail: 'x', over: true }] }))).not.toContain('bar-flag');
  });

  it('the donut keeps one slice per category in order, its legend amounts and its accessible name', () => {
    const slices = [{ name: 'Rent', cents: 185000 }, { name: 'Gas', cents: 5400 }];
    const d = renderToStaticMarkup(createElement(Donut, { slices, label: 'Spending by category: test' }));
    expect(d).toContain('aria-label="Spending by category: test"');
    expect(d.indexOf('Rent')).toBeLessThan(d.indexOf('Gas'));
    expect(d).toContain('$1,850.00');
    expect(d).toContain('$54.00');
    expect((d.match(/class="donut-seg"/g) ?? []).length).toBe(2);
  });
});

describe('D12 Home: no new derived figure', () => {
  const c = code(src('src/pages/HomePage.tsx'));
  it('does not work out income minus spending, spending as a share of income, a surplus, a savings rate or a score', () => {
    expect(c).not.toMatch(/incomeCents\s*-\s*spentCents|spentCents\s*-\s*incomeCents|spentCents\s*\/\s*(spending\.)?incomeCents|incomeCents\s*\/\s*spentCents/);
    expect(c).not.toMatch(/surplus|savings rate|savingsRate|health score|income less spending|of income so far/i);
    expect(c).not.toMatch(/toFixed\([0-9]\)\s*\+\s*'%'|Math\.round\([^)]*(spending|income)[^)]*\*\s*100/); // ids-ok: a source pattern, never an id
  });
  it('still reads every figure from the same providers and helpers', () => {
    for (const f of ["spendingSnapshot(txns, categories, month)", "spendingSlices(txns, categories, month)", "monthlyFlow(txns, categories, month, 6)", "budgetBars(budget?.rows ?? [])", "loadNetWorth(db, today)", "changeOver(snaps)"]) expect(c, f).toContain(f);
  });
  it('the top panel shows the existing net worth, its change since the first saved month, the income, spending and ready to assign of the month: no percentage, no difference', () => {
    const hero = code(src('src/pages/HomeHero.tsx'));
    for (const f of ['formatCents(netCents)', 'formatCents(incomeCents)', 'formatCents(spentCents)', 'formatCents(readyCents)', 'formatCents(Math.abs(change.sinceCents))']) expect(hero, f).toContain(f);
    expect(hero).not.toMatch(/incomeCents\s*-|spentCents\s*-|-\s*spentCents|-\s*incomeCents|%\s*of income/);
    const p = code(src('src/pages/HomePage.tsx'));
    for (const f of ['netCents={net?.total ?? 0}', 'incomeCents={spending.incomeCents}', 'spentCents={spending.spentCents}', 'readyCents={budget ? budget.readyToAssign : null}', 'change={change}']) expect(p, f).toContain(f);
  });
});

// D21.1 SUPERSEDED RULE: "the look is Signature-only and Classic is unchanged" (the hero, chart-spend and category tokens read the old Classic values for every palette that did not set them).
// The approved requirement is that the Signature Home is the Home for every palette. Replacement guard: every palette sets the whole hero and chart set (colors only), and the default colors
// file carries Signature Navy's.
describe('D12 Home: the Signature Home is the Home for every palette (D21.1)', () => {
  it('every palette sets the hero, chart-spend and category colors for light and dark; the default colors file has them too', () => {
    const base = src('src/ui/palette-base.css');
    for (const k of ['--hero-bg', '--hero-ink', '--chart-spend', '--viz-c1', '--viz-hc1']) expect(base, k).toContain(k + ':');
    for (const p of PRESETS) for (const dark of [false, true]) expect(Object.keys(extrasOf({ id: p.id }, dark)).filter((k) => /^--(hero|chart|viz-c)/.test(k)).length, p.id).toBeGreaterThanOrEqual(13);
  });
  it('the chart colors fall back to the values they always had', () => {
    expect(src('src/styles.css')).toContain('--chart-1: var(--viz-c1, #3f7fd9); --chart-2: var(--viz-c2, #e08a2b); --chart-3: var(--viz-c3, #3aa17e); --chart-4: var(--viz-c4, #9b6ad6); --chart-5: var(--viz-c5, #d65f7a); --chart-6: var(--viz-c6, #7a8794)');
  });
  it('Signature gives the hero a dark fill in both modes and a navy-to-teal category ramp with navy spending', () => {
    for (const dark of [false, true]) {
      const e = extrasOf({ id: 'signature-navy' }, dark);
      expect(e['--hero-bg']).toMatch(/^#[0-9A-F]{6}$/i);
      expect(e['--hero-ink']).toBe('#FFFFFF');
      expect(['--viz-c1', '--viz-c2', '--viz-c3', '--viz-c4', '--viz-c5', '--viz-c6'].every((k) => /^#[0-9A-F]{6}$/i.test(e[k]))).toBe(true);
      expect(e['--chart-spend']).toBe(e['--viz-c1']); // spending is the first (navy) step of the ramp in both modes
    }
  });
  it('the stylesheet uses tokens only (no hex color, no priority override, no new font)', () => {
    const css = src('src/pages/home.css').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/!important|@font-face|url\(/);
  });
});
