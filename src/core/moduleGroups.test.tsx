import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { all, parseHtml, textOf, type El } from '../lib/a11yTestkit';
import { groupModules } from './moduleGroups';
import { ModuleList } from './ModuleBar';
import { allModules, type ModuleDef } from './registry';

const IDS = ['today', 'calendar', 'tasks', 'projects', 'assets', 'services', 'bills', 'family', 'contacts', 'ledger', 'household'];
const fake = (id: string, name = id): ModuleDef => ({ id, name, icon: '•', Component: () => null, routePaths: [], nav: [] });

async function real(): Promise<readonly ModuleDef[]> {
  const { registerModules } = await import('../modules');
  registerModules();
  return allModules();
}
function render(mods: readonly ModuleDef[], currentId?: string): El {
  return parseHtml(renderToStaticMarkup(createElement(MemoryRouter, null, createElement(ModuleList, { mods, currentId }))));
}
const links = (d: El) => all(d, (e) => e.tag === 'a');

describe('N1: grouped module list', () => {
  it('all eleven registered modules appear exactly once, with their original ids', async () => {
    const mods = await real();
    expect(mods.map((m) => m.id).sort()).toEqual([...IDS].sort());
    const placed = groupModules(mods).flatMap((g) => g.modules.map((m) => m.id));
    expect([...placed].sort()).toEqual([...IDS].sort());
    expect(new Set(placed).size).toBe(11);
  });

  it('groups and order are as approved, with display names unchanged', async () => {
    const g = groupModules(await real());
    expect(g.map((x) => [x.label, x.modules.map((m) => m.name)])).toEqual([
      [null, ['Today']],
      ['Productivity', ['Calendar', 'Tasks', 'Projects']],
      ['Household', ['Home & Assets', 'Household Services', 'Bills & Subscriptions', 'Family', 'Contacts & Relationships']],
      ['Finances', ['Ledger', 'Household Finances']],
    ]);
  });

  it('keeps each module\'s own icon and links to /<id> in the rendered list', async () => {
    const mods = await real();
    const d = render(mods);
    const a = links(d);
    expect(a.map((e) => e.attrs.href)).toEqual(['today', 'calendar', 'tasks', 'projects', 'assets', 'services', 'bills', 'family', 'contacts', 'ledger', 'household'].map((i) => `/${i}`));
    expect(all(d, (e) => e.attrs.class === 'modicon').length).toBe(11);
  });

  it('marks only the current module (aria-current and the active class)', async () => {
    const d = render(await real(), 'family');
    const cur = links(d).filter((e) => e.attrs['aria-current'] === 'page');
    expect(cur).toHaveLength(1);
    expect(cur[0].attrs.href).toBe('/family');
    expect(cur[0].attrs.class).toBe('active');
    expect(links(d).filter((e) => e.attrs.class === 'active')).toHaveLength(1);
  });

  it('group headings are labels for a group, not links, buttons or menu items', async () => {
    const d = render(await real());
    const groups = all(d, (e) => e.attrs.role === 'group');
    expect(groups.map((g) => textOf(all(g, (e) => e.attrs.class === 'modgroup-label')[0]))).toEqual(['Productivity', 'Household', 'Finances']);
    for (const g of groups) {
      const label = all(g, (e) => e.attrs.class === 'modgroup-label')[0];
      expect(g.attrs['aria-labelledby']).toBe(label.attrs.id);
      expect(label.tag).toBe('div');
    }
    expect(all(d, (e) => e.tag === 'button' || e.attrs.tabindex !== undefined || e.attrs.role === 'menu' || e.attrs.role === 'menuitem')).toHaveLength(0);
    expect(all(d, (e) => /^h[1-6]$/.test(e.tag))).toHaveLength(0); // does not disturb the page's heading outline
    // no nesting: the groups sit directly in the list, and links are the only focusable things
    expect(all(d, (e) => e.attrs.role === 'group').every((g) => g.parent?.tag === '#root')).toBe(true);
  });

  it('an unknown future module is shown last under "Other"; known modules are unaffected', async () => {
    const mods = [...(await real()), fake('newthing', 'New Thing')];
    const g = groupModules(mods);
    expect(g[g.length - 1]).toMatchObject({ key: 'other', label: 'Other' });
    expect(g[g.length - 1].modules.map((m) => m.id)).toEqual(['newthing']);
    const d = render(mods);
    expect(links(d)).toHaveLength(12);
    expect(links(d).at(-1)?.attrs.href).toBe('/newthing');
  });

  it('no "Other" group when everything is classified; a missing module leaves no empty heading', () => {
    expect(groupModules([fake('today'), fake('tasks')]).map((g) => g.label)).toEqual([null, 'Productivity']);
    expect(groupModules([])).toEqual([]);
  });

  it('a duplicate id in the input cannot make a module appear twice', () => {
    const g = groupModules([fake('tasks'), fake('tasks')]);
    expect(g.flatMap((x) => x.modules)).toHaveLength(1);
  });
});

describe('N1: source guards (no browser needed)', () => {
  const css = readFileSync('src/styles.css', 'utf8');
  const bar = readFileSync('src/core/ModuleBar.tsx', 'utf8');
  const groupsSrc = readFileSync('src/core/moduleGroups.ts', 'utf8');

  it('keeps the disclosure semantics: expanded state, controlled list, Escape, no ARIA menu', () => {
    expect(bar).toMatch(/aria-expanded=\{open\}/);
    expect(bar).toMatch(/aria-controls="module-list"/);
    expect(bar).toMatch(/e\.key !== 'Escape'/);
    expect(bar).not.toMatch(/role="menu"|aria-haspopup|onKeyDown/);
  });

  it('does not import any module screen (lazy loading intact) and adds no routes', () => {
    expect(groupsSrc).not.toMatch(/from '\.\.\/modules|from '\.\/lazyModule|React\.lazy|import\(/);
    expect(groupsSrc).not.toMatch(/\bto=|href|navigate/);
    expect(bar).not.toMatch(/from '\.\.\/modules/);
  });

  it('the list still fits the screen height and scrolls inside itself; long labels wrap instead of overflowing', () => {
    const rule = css.split('\n').find((l) => l.startsWith('.modmenu {')) ?? '';
    expect(rule).toMatch(/max-height:\s*calc\(100dvh - var\(--bar-h\) - \d+px/); // D7: measured from the bottom of the header, whatever height the palette gives it
    expect(rule).toMatch(/overflow-y:\s*auto/);
    expect(rule).toMatch(/overscroll-behavior:\s*contain/);
    expect(css).toMatch(/\.modmenu a \{ overflow-wrap: anywhere; \}/);
    expect(css).toMatch(/\.modgroup-label \{[^}]*overflow-wrap: anywhere/);
  });

  it('group styling uses theme tokens only (works in light and dark), looks non-clickable, and phone rows stay 44px', () => {
    const rules = css.split('\n').filter((l) => /^\.modgroup/.test(l)).join('\n');
    expect(rules).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgb\(/);
    expect(rules).toMatch(/text-transform: uppercase/);
    expect(rules).toMatch(/cursor: default/);
    expect(rules).not.toMatch(/cursor: pointer/);
    expect(css).toMatch(/\.modmenu a \{ min-height: 44px; \}|\.modmenu a \{ min-height: 44px/);
  });
});
