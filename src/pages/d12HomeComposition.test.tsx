import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { ModuleBase } from '../core/router';
import { PRESETS, extrasOf } from '../palette';
import HomeHero, { type HeroProps } from './HomeHero';
import HomePage from './HomePage';

/**
 * D12 refinement, Ledger Home. The page is now a fixed top (a full-width panel, Needs attention, Get started) above two columns of sections. These tests pin that
 * composition, the top panel (every figure given, none worked out), the honest empty and missing states, and the net-worth chart inside the dark panel.
 * Static markup: structure and text, not a look. The look, the keyboard reading of the chart and the saved-layout behavior were run in a real browser.
 */
const src = (f: string) => readFileSync(f, 'utf8');
const code = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/ \/\/ .*$/gm, '');
const wrap = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(createElement(MemoryRouter, null, createElement(ModuleBase, { value: '/ledger' }, el)));
const page = wrap(createElement(HomePage));

describe('D12 refinement: the composition', () => {
  const at = (s: string) => page.indexOf(s);

  it('a fixed top (full-width panel, Needs attention, Get started) sits above two columns: analysis first, then the supporting sections, in that order in the markup', () => {
    expect(at('class="card home-hero"')).toBeGreaterThan(0);
    expect(at('home-hero')).toBeLessThan(at('home-attn'));
    expect(at('home-attn')).toBeLessThan(at('home-start'));
    expect(at('home-start')).toBeLessThan(at('home-cols'));
    expect(at('home-primary')).toBeLessThan(at('home-side'));
    const order = [...page.matchAll(/data-section="(\w+)"/g)].map((m) => m[1]);
    expect(order.filter((x) => ['analysis', 'cashflow', 'breakdown'].includes(x))).toEqual(['analysis', 'cashflow', 'breakdown']);
    expect(order.filter((x) => ['recent', 'comingup', 'goals'].includes(x))).toEqual(['recent', 'comingup', 'goals']); // the check-in is hidden until one is ready
    expect(page).toContain('aria-label="Where you stand"');
  });

  it('the stylesheet gives the panel the whole width, puts the analysis column beside a narrower supporting column from 1000px, and stacks everything below that', () => {
    const css = src('src/pages/home.css');
    expect(css).toMatch(/\.home-page \.home-hero \{ display: grid; grid-template-columns: minmax\(0, 5fr\) minmax\(0, 7fr\);/);
    expect(css).toMatch(/@media \(min-width: 1000px\) \{ \.home-cols \{ grid-template-columns: minmax\(0, 5fr\) minmax\(0, 3fr\); \} \}/);
    expect(css).toMatch(/\.home-cols \{ display: grid; grid-template-columns: minmax\(0, 1fr\);/);
    expect(css).toMatch(/@media \(max-width: 960px\) \{\s*\.home-page \.home-hero \{ grid-template-columns: minmax\(0, 1fr\); \}/);
  });

  it('Spending and budget is one card with the spending ring and the budget bars as two panels, each keeping its own heading, link and empty words', () => {
    const p = code(src('src/pages/HomePage.tsx'));
    const a = p.slice(p.indexOf('analysis: {'), p.indexOf('cashflow: {'));
    expect(a).toContain('<h3>Spending by category</h3>');
    expect(a).toContain('<h3>Budget progress</h3>');
    expect(a).toContain('to="/reports"');
    expect(a).toContain('to="/budget"');
    expect(a).toContain('<Donut slices={slices}');
    expect(a).toContain('<BarList bars={bars.map(');
    expect(page).toContain('Spending &amp; budget');
    expect(page).toContain('No spending recorded in');
    expect(page).toContain('Assign money to categories on the Budget page to track it here.');
  });

  it('the month figures are drawn once, in the top panel; the readers feeding them are the ones the page always used', () => {
    const hero = code(src('src/pages/HomeHero.tsx'));
    expect((hero.match(/formatCents\(incomeCents\)/g) ?? []).length).toBe(1);
    expect((hero.match(/formatCents\(spentCents\)/g) ?? []).length).toBe(1);
    expect((hero.match(/formatCents\(readyCents\)/g) ?? []).length).toBe(1);
    const p = code(src('src/pages/HomePage.tsx'));
    for (const f of ['spendingSnapshot(txns, categories, month)', 'loadNetWorth(db, today)', 'changeOver(snaps)', 'readyCents={budget ? budget.readyToAssign : null}']) expect(p, f).toContain(f);
  });

  it('the supporting column is quieter than the analysis column (smaller card padding and titles)', () => {
    const css = src('src/pages/home.css');
    expect(css).toMatch(/\.home-side \.card \{ padding: var\(--sp-4\); \}/);
    expect(css).toMatch(/\.home-side \.card-title \{ font-size: var\(--fs-base\); \}/);
  });
});

describe('D12 refinement: the top panel', () => {
  const base: HeroProps = { netCents: 3125804, change: null, nwBars: [], monthName: 'November 2026', incomeCents: 320000, spentCents: 238200, readyCents: 1905604 };
  const render = (over: Partial<HeroProps>) => wrap(createElement(HomeHero, { ...base, ...over }));
  const bars = (months: number) => Array.from({ length: months }, (_, i) => ({ date: `2026-0${i + 1}-01`, label: `M${i + 1}`, cashCents: 100000 * (i + 1), investmentsCents: 0, propertyCents: 0, cardsOwedCents: 5000, loansOwedCents: 0, upCents: 100000 * (i + 1), downCents: 5000, netCents: 100000 * (i + 1) - 5000, hasParts: true }));

  it('shows net worth, income, spent and ready to assign as given, with their labels, and two bars that carry their own names and values', () => {
    const h = render({});
    expect(h).toContain('$31,258.04');
    expect(h).toMatch(/<dt>Income<\/dt><dd>\$3,200\.00<\/dd>/);
    expect(h).toMatch(/<dt>Spent<\/dt><dd>\$2,382\.00<\/dd>/);
    expect(h).toMatch(/<dt>Ready to assign<\/dt><dd>\$19,056\.04<\/dd>/);
    expect(h).toMatch(/role="progressbar" aria-label="Income"[^>]*aria-valuenow="100"/);
    expect(h).toMatch(/role="progressbar" aria-label="Spent"[^>]*aria-valuenow="74"/);
    expect(h).toContain('November 2026');
    expect(h).toContain('href="/ledger/networth"');
    expect(h).toContain('href="/ledger/budget"');
  });

  it('works out nothing: no difference and no percentage (the Assets and Owed figures are only drawn; see d12HomeFinal)', () => {
    const hero = code(src('src/pages/HomeHero.tsx'));
    expect(hero).not.toMatch(/incomeCents\s*-|spentCents\s*-|-\s*spentCents|-\s*incomeCents|%\s*of income/);
    expect(render({})).not.toMatch(/of income|Income less spending/);
  });

  it('without a budget there is no "Ready to assign" figure (never shown as zero); negative figures are marked; spending above income says so in words', () => {
    expect(render({ readyCents: null })).not.toContain('Ready to assign');
    expect(render({ readyCents: -4200 })).toMatch(/hh-fig--ready neg/);
    expect(render({ netCents: -150000 })).toMatch(/class="hero neg"/);
    expect(render({ incomeCents: 100000, spentCents: 150000 })).toContain('More than income');
    expect(render({})).not.toContain('More than income');
    expect(render({ incomeCents: 0, spentCents: 5000 })).not.toContain('More than income');
  });

  it('with fewer than two saved months it shows the trend note and no chart; with two or more it draws the chart, keyboard-focusable, with its accessible description', () => {
    for (const n of [0, 1]) {
      const h = render({ nwBars: bars(n) });
      expect(h).toContain('A trend line appears once a couple of months of history have been saved.');
      expect(h).not.toContain('nwchart');
    }
    const h = render({ nwBars: bars(3), change: { sinceCents: 250000, since: '2026-01-01' } });
    expect(h).not.toContain('A trend line appears');
    expect(h).toContain('aria-label="Assets and amounts owed by month, with net worth as a line. Latest M3: assets $3,000.00, owed $50.00, net worth $2,950.00."');
    expect(h).toContain('tabindex="0"');
    expect(h).toContain('Up <strong class="pos">+$2,500.00</strong> since 2026-01-01');
  });

  it('inside the dark panel the chart reads the panel colors through local variables and a light ramp; the other presets have no such ramp', () => {
    const css = src('src/pages/home.css');
    expect(css).toMatch(/\.home-hero \.nwchart \{ --fg: var\(--hero-ink\); --muted: var\(--hero-ink-2\); --line: var\(--hero-line\); --card: var\(--hero-bg\);/);
    expect(css).toMatch(/--nw-1: var\(--viz-hc1, var\(--chart-1\)\)/);
    expect(src('src/ui/charts.tsx')).toContain("color: 'var(--nw-1, var(--chart-1))'");
    for (const dark of [false, true]) {
      const e = extrasOf({ id: 'signature' }, dark);
      expect(['--viz-hc1', '--viz-hc2', '--viz-hc3', '--viz-hc4', '--viz-hc5'].every((k) => /^#[0-9A-F]{6}$/i.test(e[k]))).toBe(true);
    }
    for (const p of PRESETS.filter((x) => x.id !== 'signature')) expect(Object.keys(extrasOf({ id: p.id }, false)).filter((k) => k.startsWith('--viz-hc'))).toEqual([]);
  });
});
