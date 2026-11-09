import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { all, headingSkips, headings, parseHtml, textOf } from '../lib/a11yTestkit';
import { ClaimList } from '../modules/services/OverviewParts';
import type { Claim } from '../modules/services/householdSpend';

// The sync chip and the Add button read live app state; only the module list matters here.
vi.mock('../core/SyncChip', () => ({ default: () => null }));
vi.mock('./QuickAdd', () => ({ default: () => null }));

/** ST-S5.1: the three small presentation corrections. */
describe('ST5-F3 Household Services: the spending claims use h3 under the h2 card title', () => {
  const claim = (status: Claim['status'], i: number): Claim => ({ recordId: `r${i}`, module: 'services', title: `Invented job ${i}`, source: { type: 'visit', id: i }, kind: 'finance', cents: 1000, status, reason: '' });
  it('no heading level is skipped after "Recorded spending"', () => {
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement('section', null, createElement('h2', null, 'Recorded spending'), createElement(ClaimList, { claims: [claim('included', 1), claim('merged', 2), claim('covered', 3), claim('excluded', 4)] }))));
    const d = parseHtml(html);
    expect(headings(d).map((h) => h.level)).toEqual([2, 3, 3, 3, 3]);
    expect(headingSkips(d)).toEqual([]);
    expect(textOf(all(d, (e) => e.tag === 'h3')[0])).toContain('Counted (1)');
  });
  it('the heading keeps its look (same class, bold) and no h4 remains in the overview', () => {
    expect(readFileSync('src/modules/services/services.css', 'utf8')).toMatch(/\.sv-h3 \{[^}]*font-weight: bold/);
    expect(readFileSync('src/modules/services/OverviewParts.tsx', 'utf8')).not.toMatch(/<h4/);
  });
});

describe('ST5-F4 Ledger Home: small links on phones are at least 24 px wide', () => {
  it('the phone/touch rules give .card-link a minimum width of 44 px (so "All" is not 20 px wide), and only inside the phone block', () => {
    const css = readFileSync('src/styles.css', 'utf8');
    const m = css.match(/@media \(max-width: 640px\), \(pointer: coarse\) \{[\s\S]*?\n\}\n/);
    expect(m).not.toBeNull();
    expect(m![0]).toMatch(/\.card-link \{[^}]*min-width: 44px/);
    expect(css.replace(m![0], '')).not.toMatch(/\.card-link \{[^}]*min-width/); // desktop look untouched
  });
});

describe('Owner request: the module dropdown says "Household Finances"', () => {
  it('the label is capitalised in the rendered list; the id, route and other modules are unchanged', async () => {
    const { householdModule } = await import('../modules/household');
    expect(householdModule.name).toBe('Household Finances');
    expect(householdModule.id).toBe('household');
    const { default: ModuleBar } = await import('../core/ModuleBar');
    const { registerModules } = await import('../modules');
    registerModules();
    const bar = parseHtml(renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: ['/household'] }, createElement(ModuleBar))));
    expect(textOf(all(bar, (e) => e.tag === 'button' && e.attrs['aria-controls'] === 'module-list')[0])).toContain('Household Finances'); // the current-module button
  });
});
