import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { ModuleBase } from '../core/router';
import { NetWorthChart } from '../ui/charts';
import HomeHero, { type HeroProps } from './HomeHero';
import HomePage from './HomePage';

/**
 * D12 final mobile correction. On a phone the one top panel is drawn as TWO cards (net worth, then the month), as in the approved mobile design; on a computer it is
 * still one panel. These tests pin that it is ONE set of data and ONE stored section either way, that the desktop rules are untouched, that the chart keeps its data
 * and description at a shorter phone height, that long amounts stack instead of splitting, and that the phone colors read. Static markup and source checks: structure and
 * text. The phone behavior (two cards, the shorter chart, the bottom bar, the Add button) was run in a real browser at 375 and 320 px.
 */
const src = (f: string) => readFileSync(f, 'utf8');
const code = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/ \/\/ .*$/gm, '');
const wrap = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(createElement(MemoryRouter, null, createElement(ModuleBase, { value: '/ledger' }, el)));
const base: HeroProps = { netCents: 3125804, change: { sinceCents: 1736804, since: '2026-06-01' }, nwBars: [], monthName: 'November 2026', incomeCents: 320000, spentCents: 238200, readyCents: 1905604, assetsCents: 3183004, owedCents: 57200 };
const render = (over: Partial<HeroProps> = {}) => wrap(createElement(HomeHero, { ...base, ...over }));
const bars = (months: number) => Array.from({ length: months }, (_, i) => ({ date: `2026-0${i + 1}-01`, label: `M${i + 1}`, cashCents: 100000 * (i + 1), investmentsCents: 0, propertyCents: 0, cardsOwedCents: 5000, loansOwedCents: 0, upCents: 100000 * (i + 1), downCents: 5000, netCents: 100000 * (i + 1) - 5000, hasParts: true }));
const css = src('src/pages/home.css');
const phoneBlock = (() => {
  const i = css.indexOf('/* A phone (640px and narrower)');
  const j = css.indexOf('@media (max-width: 640px) {', i);
  let depth = 0; let k = css.indexOf('{', j);
  for (; k < css.length; k++) { if (css[k] === '{') depth++; if (css[k] === '}') { depth--; if (depth === 0) break; } }
  return css.slice(css.indexOf('{', j) + 1, k);
})();

describe('D12 mobile: one set of data, one section, two surfaces on a phone', () => {
  it('the markup is one section with the net-worth pane and the month pane; each figure is drawn exactly once (so both phone cards and the desktop panel show the same values)', () => {
    const h = render();
    expect((h.match(/class="card home-hero"/g) ?? []).length).toBe(1);
    expect((h.match(/class="hh-nw"/g) ?? []).length).toBe(1);
    expect((h.match(/class="hh-month"/g) ?? []).length).toBe(1);
    expect(h.indexOf('hh-nw')).toBeLessThan(h.indexOf('hh-month'));
    for (const v of ['$31,258.04', '$3,200.00', '$2,382.00', '$19,056.04', '$31,830.04', '$572.00']) expect((h.match(new RegExp(v.replace(/[$.]/g, '\\$&'), 'g')) ?? []).length, v).toBe(1);
    expect(h).toMatch(/<dt>Income<\/dt><dd>\$3,200\.00<\/dd>/);
    expect(h).toMatch(/<dt>Ready to assign<\/dt><dd>\$19,056\.04<\/dd>/);
    expect(h).toMatch(/<dt>Assets \(positive balances\)<\/dt><dd>\$31,830\.04<\/dd>/);
  });

  it('the hero is not one of the stored sections: it is drawn outside the two columns, so a phone cannot store a second copy of it', () => {
    const p = code(src('src/pages/HomePage.tsx'));
    expect(p.indexOf('<HomeHero')).toBeLessThan(p.indexOf('className="home-cols"'));
    expect(code(src('src/pages/HomeHero.tsx'))).not.toMatch(/homeSections|localStorage|loadSections|saveSections/);
    expect(src('src/lib/homeSections.ts')).not.toMatch(/hero|networth-card|month-card/i);
  });
});

describe('D12 mobile: the desktop panel is untouched', () => {
  it('the desktop rules are still there exactly as approved (two panes on one dark surface, a single column from 960px down)', () => {
    expect(css).toMatch(/\.home-page \.home-hero \{ display: grid; grid-template-columns: minmax\(0, 5fr\) minmax\(0, 7fr\); padding: 0; overflow: hidden; border-radius: var\(--r-xl\); background: var\(--hero-bg\); border-color: var\(--hero-line\); color: var\(--hero-ink\); \}/);
    expect(css).toMatch(/\.hh-month \{ display: flex; flex-direction: column; justify-content: flex-start; gap: var\(--sp-5\); border-left: 1px solid var\(--hero-line\); \}/);
    expect(css).toMatch(/@media \(max-width: 960px\) \{\s*\.home-page \.home-hero \{ grid-template-columns: minmax\(0, 1fr\); \}/);
  });

  it('every phone rule sits inside the 640px media query; none leaks to wider screens', () => {
    expect(phoneBlock).toContain('.hh-nw {');
    expect(phoneBlock).toContain('.hh-month {');
    const outside = css.replace(phoneBlock, '');
    expect(outside).not.toMatch(/\.hh-nw \{ background/);
    expect(outside).not.toMatch(/\.hh-month \{ --hero-ink/);
  });

  it('the chart is 240px tall by default (the Net worth page does not pass a height and is unchanged); only the Home hero asks for 176px, and only on a phone', () => {
    const c = src('src/ui/charts.tsx');
    expect(c).toContain('export function NetWorthChart({ bars, label, height = 240 }');
    expect(src('src/pages/NetWorthPage.tsx')).not.toMatch(/NetWorthChart[^>]*height=/);
    expect(code(src('src/pages/HomeHero.tsx'))).toContain("height={phone ? 176 : 240}");
    expect(code(src('src/pages/HomeHero.tsx'))).toContain("useMediaQuery('(max-width: 640px)')");
    const def = renderToStaticMarkup(createElement(NetWorthChart, { bars: bars(3), label: 'x' }));
    expect(def).toMatch(/viewBox="0 0 \d+ 240"/);
    expect(def).toContain('style="height:240px"');
  });
});

describe('D12 mobile: the chart keeps its data, description and states at the phone height', () => {
  it('a 176px chart has the same bars, the same accessible description and keyboard focus as the 240px one, and nothing is cropped from its own box', () => {
    const tall = renderToStaticMarkup(createElement(NetWorthChart, { bars: bars(6), label: 'Assets and amounts owed by month, with net worth as a line' }));
    const short = renderToStaticMarkup(createElement(NetWorthChart, { bars: bars(6), label: 'Assets and amounts owed by month, with net worth as a line', height: 176 }));
    expect(short).toMatch(/viewBox="0 0 \d+ 176"/);
    expect(short).toContain('style="height:176px"');
    for (const h of [tall, short]) {
      expect(h).toContain('aria-label="Assets and amounts owed by month, with net worth as a line. Latest M6: assets $6,000.00, owed $50.00, net worth $5,950.00."');
      expect(h).toContain('tabindex="0"');
      expect((h.match(/<rect /g) ?? []).length).toBe((tall.match(/<rect /g) ?? []).length);
      for (const l of ['M1', 'M6']) expect(h).toContain(`>${l}</text>`);
    }
    expect(short).toContain('Cash');
    expect(short).toContain('Net worth');
  });

  it('no history and one month show the note and no chart; two or more show the chart; the History link is always there', () => {
    for (const n of [0, 1]) {
      const h = render({ nwBars: bars(n) });
      expect(h).toContain('A trend line appears once a couple of months of history have been saved.');
      expect(h).not.toContain('nwchart');
      expect(h).toContain('href="/ledger/networth"');
    }
    const h = render({ nwBars: bars(2) });
    expect(h).toContain('nwchart');
    expect(h).not.toContain('A trend line appears');
    expect(h).toContain('href="/ledger/networth"');
    expect(h).toContain('href="/ledger/budget"');
  });
});

describe('D12 mobile: long amounts and readability', () => {
  it('the two small figures stack, rather than split, when either is a seven-digit amount (12 characters or more); ordinary amounts sit two across', () => {
    expect(render({ assetsCents: 100000000, owedCents: 0 })).toContain('hh-pair hh-pair--stack'); // $1,000,000.00
    expect(render({ assetsCents: 12345, owedCents: 987654321 })).toContain('hh-pair hh-pair--stack'); // one long amount is enough ($9,876,543.21)
    expect(render({ assetsCents: 99999999, owedCents: 5 })).toContain('<dl class="hh-pair">'); // $999,999.99 is 11 characters
    expect(render({ assetsCents: 3183004, owedCents: 57200 })).toContain('<dl class="hh-pair">');
    const h = render({ netCents: 1234567890, assetsCents: 1234567890, owedCents: 987654321 });
    for (const v of ['$12,345,678.90', '$9,876,543.21']) expect(h).toContain(v);
    expect(phoneBlock).toContain('.hh-pair--stack .hh-chip2 { flex-basis: 100%; }');
    expect(phoneBlock).toMatch(/\.hh-pair--stack \.hh-chip2 dd \{ font-size: 1rem; \}/);
  });

  it('the net-worth figure scales with the screen and wraps only as a last resort; the month figures become label and amount rows on a narrow phone', () => {
    expect(css).toMatch(/\.home-hero \.hero \{[^}]*font-size: clamp\(2rem, 9vw, var\(--fs-display\)\);[^}]*overflow-wrap: anywhere;/);
    expect(css).toMatch(/@media \(max-width: 520px\) \{\s*\.hh-figs \{ grid-template-columns: minmax\(0, 1fr\);/);
  });

  it('the new phone styles use tokens only: no hex color, no priority override', () => {
    expect(phoneBlock).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(phoneBlock).not.toMatch(/!important/);
  });
});

describe('D12 mobile: nothing about the customization changed', () => {
  it('the section model, both storage keys and the reorder, hide, reset and earlier-layout controls are as before', () => {
    const p = code(src('src/pages/HomePage.tsx'));
    for (const f of ['moveSection(sections, id, -1)', 'hideSection(sections, id)', 'showSection(sections, id)', 'forgetSections()', 'readCustomLegacy()', 'resetToDefault']) expect(p, f).toContain(f);
    const lib = code(src('src/lib/homeSections.ts'));
    expect(lib).toContain("'ledger.home.layout.v2'");
    expect(lib).not.toMatch(/(setItem|removeItem)\(\s*LAYOUT_KEY/);
  });
});

describe('D12 mobile header: a compact Home heading on a phone', () => {
  const page = wrap(createElement(HomePage));
  const headBlock = css.slice(css.indexOf('/* The Home heading on a phone'));
  it('Home passes its own class; the shared PageHeader is not changed', () => {
    expect(code(src('src/pages/HomePage.tsx'))).toContain('className="home-head"');
    expect(src('src/ui/components.tsx')).not.toMatch(/home-head/);
    expect(page).toContain('class="page-head home-head"');
  });
  it('nothing is removed: the heading, the description and all three actions are still in the page', () => {
    expect(page).toMatch(/<h1>Home<\/h1>/);
    expect(page).toContain('Where you stand today, and what needs a look.');
    expect(page).toContain('Refresh prices');
    expect(page).toContain('Edit Home');
  });
  it('on a phone the title block is visually hidden (kept for screen readers) and the actions share one compact row, inside the 640px query only', () => {
    expect(headBlock).toMatch(/@media \(max-width: 640px\) \{/);
    expect(headBlock).toMatch(/\.home-head \.page-head-text \{ position: absolute; width: 1px; height: 1px;[^}]*clip: rect\(0, 0, 0, 0\);/);
    expect(headBlock).not.toMatch(/display: none/);
    expect(headBlock).toMatch(/\.home-head \.page-actions \{ flex: 1 1 100%; flex-wrap: wrap;/);
    expect(css.slice(0, css.indexOf('/* The Home heading on a phone'))).not.toContain('.home-head');
    expect(headBlock).not.toMatch(/#[0-9a-fA-F]{3,8}\b|!important/);
  });
});
