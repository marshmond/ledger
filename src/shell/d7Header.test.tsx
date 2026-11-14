import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { accessibleName, all, parseHtml, textOf, unnamedButtons, type El } from '../lib/a11yTestkit';
import { groupModules } from '../core/moduleGroups';
import ModuleBar, { ModuleFoot, ModuleList } from '../core/ModuleBar';
import { allModules } from '../core/registry';
import { PRESETS } from '../palette';

/**
 * D7: the global header and the grouped module switcher. These are the parts that can be checked without a browser: what the header is made of,
 * its keyboard order and names, that every registered module is reachable from the list, and that the stylesheet keeps the rules the sticky
 * layers below the header depend on. Opening, Escape, focus return, and the measured sizes were checked in a real browser (see the D7 report).
 */

// The sync status reads live app state and the Add box needs the database; both are replaced by small stand-ins that keep the markup that matters here
// (the sync chip's "Sync off" link, and the Add button's name). The real Add button's attributes are checked from its source, in the last test.
vi.mock('../lib/sync/auto', () => ({ useSyncStatus: () => ({ configured: false, state: 'idle', conflicts: 0, auto: false }), syncNow: () => Promise.resolve() }));
vi.mock('./QuickAdd', () => ({ default: () => createElement('button', { className: 'qa-btn', 'aria-label': 'Quick add' }, '+') }));

const css = readFileSync('src/styles.css', 'utf8');
const tokens = readFileSync('src/ui/tokens.css', 'utf8');
const bar = readFileSync('src/core/ModuleBar.tsx', 'utf8');

async function registered() {
  const { registerModules } = await import('../modules');
  registerModules();
  return allModules();
}
const header = async (path: string): Promise<El> => {
  await registered();
  return parseHtml(renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: [path] }, createElement(ModuleBar))));
};
/** Everything a person can Tab to, in document order. */
const tabStops = (d: El) => all(d, (e) => (e.tag === 'a' && e.attrs.href !== undefined) || (e.tag === 'button' && e.attrs.disabled === undefined));
/** The rules of one `@media (…) { … }` block, found by its opening line (blocks here are not nested). */
const block = (opening: string, from = 0) => {
  const start = css.indexOf(opening, from);
  expect(start, `${opening} is in styles.css`).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf('\n}\n', start) + 3);
};

describe('D7 header: structure and names', () => {
  it('is one named navigation landmark; the switcher is a disclosure button, not a menu or dialog', async () => {
    const d = await header('/today');
    const nav = all(d, (e) => e.tag === 'nav');
    expect(nav).toHaveLength(1);
    expect(nav[0].attrs['aria-label']).toBe('Modules and tools');
    const btn = all(d, (e) => e.tag === 'button' && e.attrs['aria-controls'] === 'module-list')[0];
    expect(btn.attrs['aria-expanded']).toBe('false');
    expect(btn.attrs['aria-haspopup']).toBeUndefined();
    expect(all(d, (e) => ['menu', 'menuitem', 'dialog'].includes(e.attrs.role ?? '') || e.attrs['aria-modal'] !== undefined)).toHaveLength(0);
    expect(unnamedButtons(d)).toHaveLength(0);
  });

  it('the switcher keeps its spoken name, "Switch module. Current module: <name>", for short and long module names', async () => {
    for (const [path, name] of [['/today', 'Today'], ['/household', 'Household Finances'], ['/bills', 'Bills & Subscriptions'], ['/contacts', 'Contacts & Relationships'], ['/services', 'Household Services']] as const) {
      const d = await header(path);
      const btn = all(d, (e) => e.tag === 'button' && e.attrs['aria-controls'] === 'module-list')[0];
      // The "All modules" caption is hidden from assistive technology, so the name is the sentence and the module's own name, nothing more.
      expect(accessibleName(d, btn), path).toBe(`Switch module. Current module: ${name}`);
    }
  });

  it('the decorations (brand mark, "All modules" caption, shortcut hint, icons) are hidden from assistive technology', async () => {
    const d = await header('/today');
    const hidden = (cls: string) => all(d, (e) => e.attrs.class?.split(' ').includes(cls))[0];
    expect(hidden('modbrand').attrs['aria-hidden']).toBe('true');
    expect(hidden('modall').attrs['aria-hidden']).toBe('true');
    expect(hidden('modkbd').attrs['aria-hidden']).toBe('true');
    expect(all(d, (e) => e.tag === 'svg').every((s) => s.attrs['aria-hidden'] === 'true')).toBe(true);
  });

  it('Tab order follows the picture, left to right: switcher, Search, Sync, Settings, Add', async () => {
    const d = await header('/ledger/budget');
    const names = tabStops(d).map((e) => accessibleName(d, e));
    expect(names).toHaveLength(5);
    expect(names[0]).toMatch(/^Switch module\. Current module: Ledger/);
    expect(names.slice(1)).toEqual(['Search', 'Sync off', 'Settings', 'Quick add']);
  });

  it('Search and Add keep their names and shortcut hints; Settings is a plain link to /settings', async () => {
    const d = await header('/today');
    const search = all(d, (e) => e.tag === 'button' && e.attrs['aria-label'] === 'Search')[0];
    expect(search.attrs['aria-keyshortcuts']).toBe('Control+K Meta+K');
    expect(search.attrs.title).toMatch(/^Search \((Ctrl K|⌘K)\)$/);
    expect(readFileSync('src/shell/QuickAdd.tsx', 'utf8')).toMatch(/aria-label="Quick add" title="Add \(N\)" aria-haspopup="dialog"/);
    const settings = all(d, (e) => e.tag === 'a' && e.attrs.href === '/settings');
    expect(settings).toHaveLength(1);
    expect(accessibleName(d, settings[0])).toBe('Settings');
  });

  it('Settings is marked as the current page while inside Settings', async () => {
    const d = await header('/settings/backup');
    expect(all(d, (e) => e.tag === 'a' && e.attrs.href === '/settings')[0].attrs['aria-current']).toBe('page');
  });

  it('the header file holds no keyboard-menu code, no portal, and imports no module screen', () => {
    expect(bar).not.toMatch(/role="(menu|dialog)"|aria-modal|onKeyDown|createPortal/);
    expect(bar).not.toMatch(/from '\.\.\/modules/);
    expect(bar).toMatch(/e\.key !== 'Escape'/);
    expect(bar).toMatch(/\[loc\.pathname\]/); // closes when the route changes
  });
});

describe('D7 module switcher: every module, grouped, from the registry', () => {
  it('every registered module is in exactly one group, and each link goes to /<id> with the module\'s own name', async () => {
    const mods = await registered();
    const groups = groupModules(mods);
    expect(groups.flatMap((g) => g.modules.map((m) => m.id)).sort()).toEqual(mods.map((m) => m.id).sort());
    const d = parseHtml(renderToStaticMarkup(createElement(MemoryRouter, null, createElement(ModuleList, { mods }))));
    const links = all(d, (e) => e.tag === 'a');
    expect(links.map((a) => [a.attrs.href, textOf(a)])).toEqual(mods.length ? groups.flatMap((g) => g.modules).map((m) => [`/${m.id}`, m.name]) : []);
  });

  it('the three groups are Productivity, Household and Finances, with Today alone above them', async () => {
    const g = groupModules(await registered());
    expect(g.map((x) => x.label)).toEqual([null, 'Productivity', 'Household', 'Finances']);
    expect(g.map((x) => x.modules.length)).toEqual([1, 3, 5, 2]);
  });

  it('the longest names are present in full (they wrap in the list; nothing is shortened in the markup)', async () => {
    const names = (await registered()).map((m) => m.name);
    for (const n of ['Household Finances', 'Bills & Subscriptions', 'Contacts & Relationships', 'Household Services', 'Home & Assets']) expect(names).toContain(n);
  });

  it('only the current module is marked, with aria-current="page"', async () => {
    const mods = await registered();
    const d = parseHtml(renderToStaticMarkup(createElement(MemoryRouter, null, createElement(ModuleList, { mods, currentId: 'household' }))));
    const cur = all(d, (e) => e.tag === 'a' && e.attrs['aria-current'] === 'page');
    expect(cur.map((a) => a.attrs.href)).toEqual(['/household']);
  });

  it('Home & Assets and Household Finances no longer share one icon, and no two modules do', async () => {
    const mods = await registered();
    const icon = (id: string) => renderToStaticMarkup(mods.find((m) => m.id === id)!.icon as never);
    expect(icon('assets')).not.toBe(icon('household'));
    expect(new Set(mods.map((m) => renderToStaticMarkup(m.icon as never))).size).toBe(mods.length);
  });

  it('the phone footer offers Settings and the sync status inside the list, and says where you are', () => {
    const html = (inSettings: boolean) => parseHtml(renderToStaticMarkup(createElement(MemoryRouter, null, createElement(ModuleFoot, { inSettings }))));
    const d = html(false);
    const a = all(d, (e) => e.tag === 'a');
    expect(a.map((e) => [e.attrs.href, accessibleName(d, e)])).toEqual([['/settings', 'Settings'], ['/settings/sync', 'Sync off']]);
    expect(all(d, (e) => e.tag === 'a' && e.attrs.href === '/settings')[0].attrs['aria-current']).toBeUndefined();
    expect(all(html(true), (e) => e.tag === 'a' && e.attrs.href === '/settings')[0].attrs['aria-current']).toBe('page');
  });
});

describe('D7 stylesheet: the sticky layers still hang from one number, and the layout rules are in place', () => {
  it('--bar-h is built from the header tokens (computer, touch screen, phone), and every sticky layer still reads --bar-h', () => {
    expect(css).toMatch(/:root \{ --bar-h: calc\(var\(--hdr-h\) \+ env\(safe-area-inset-top\)\); \}/);
    expect(block('@media (max-width: 640px), (pointer: coarse) {')).toMatch(/--bar-h: calc\(var\(--hdr-h-touch\) \+ env\(safe-area-inset-top\)\)/);
    expect(block('@media (max-width: 640px) {', css.indexOf('D7: the header on a phone'))).toMatch(/--bar-h: calc\(var\(--hdr-h-phone\) \+ env\(safe-area-inset-top\)\)/);
    // D8: the Ledger bar (--sub-h, 0 on a phone) sits between the header and these layers, so each adds it after --bar-h. The old `.sidebar { top: var(--bar-h) }` rule is gone with the sidebar.
    expect(css).toMatch(/\.topbar \{ top: calc\(var\(--bar-h\) \+ var\(--sub-h\)\)/);
    expect(css).toMatch(/\.txn-table thead th, \.budget-table thead th \{ top: calc\(var\(--topbar-h\) \+ var\(--bar-h\) \+ var\(--sub-h\)\)/);
    expect(css).toMatch(/\.txn-table thead tr\.col-filters th \{ top: calc\(var\(--topbar-h\) \+ var\(--bar-h\) \+ var\(--sub-h\) \+ var\(--txn-head-h\)\)/); // D8 correction: the filter row sticks at the heading row's fixed height, not a 36px guess
    expect(css).toMatch(/\.lnav \{ display: block; position: sticky; top: var\(--bar-h\);/);
    expect(readFileSync('src/modules/tasks/tasks.css', 'utf8')).toMatch(/\.tk-bulk \{ position: sticky; top: calc\(var\(--bar-h, 36px\) \+ 4px\)/);
  });

  it('the bar and its list print as nothing, and the bar stays above the floating Add button and the sticky page layers', () => {
    expect(css).toMatch(/@media print \{ \.modulebar \{ display: none; \} \}/);
    expect(css).toMatch(/\.modulebar \{ position: sticky; top: 0; z-index: 50;/);
    expect(css).toMatch(/\.qa \{ position: fixed;[^}]*z-index: 40;/);
  });

  it('the list is a grid under the bar: three columns, Today across the top, then two columns on a phone', () => {
    const rule = css.split('\n').find((l) => l.startsWith('.modmenu {')) ?? '';
    expect(rule).toMatch(/display: grid; grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
    expect(rule).toMatch(/width: min\(700px, calc\(100vw - 32px\)\)/); // never wider than the screen
    expect(css).toMatch(/\.modgroup-top \{ grid-column: 1 \/ -1; \}/);
    const phone = block('@media (max-width: 640px) {', css.indexOf('D7: the header on a phone'));
    expect(phone).toMatch(/\.modgroup \{ display: grid; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
    expect(phone).toMatch(/\.modmenu \{[^}]*left: var\(--sp-2\); right: var\(--sp-2\)/);
  });

  it('on a phone the bar keeps the switcher and Search; Settings and the sync chip move into the list foot, which is hidden everywhere else', () => {
    const phone = block('@media (max-width: 640px) {', css.indexOf('D7: the header on a phone'));
    expect(phone).toMatch(/\.modulebar > \.syncwrap:not\(\.attn\), \.modulebar > \.syncchip, \.modulebar > \.modsettings \{ display: none; \}/);
    expect(phone).toMatch(/\.modfoot \{ display: grid;/);
    expect(css).toMatch(/^\.modfoot \{ display: none; \}$/m);
  });

  it('a long module name wraps on a phone instead of being cut off, and at 320px the brand mark gives way', () => {
    const phone = block('@media (max-width: 640px) {', css.indexOf('D7: the header on a phone'));
    expect(phone).toMatch(/\.modname \{[^}]*line-height: 1\.15/);
    expect(css).toMatch(/\.modname \{ min-width: 0; overflow-wrap: anywhere; \}/);
    expect(css).not.toMatch(/text-overflow: ellipsis[^}]*\n?[^}]*\.modbtn|\.modbtn[^}]*text-overflow: ellipsis/);
    expect(css).toMatch(/@media \(max-width: 359px\) \{ \.modbrand \{ display: none; \} \}/);
  });

  it('controls in the bar are at least 44px tall on a phone or touch screen', () => {
    expect(block('@media (max-width: 640px), (pointer: coarse) {')).toMatch(/\.modbtn, \.modsearch, \.syncchip, \.modsettings, \.modmenu a \{ min-height: 44px; \}/);
  });

  it('the header uses theme tokens only: no hex or rgb colour in the header rules', () => {
    const rules = css.split('\n').filter((l) => /^\.(modulebar|modbrand|modbtn|modname|modall|modmenu|modgroup|modfoot|modsearch|modkbd|modsettings|syncwrap\.inline)/.test(l)).join('\n');
    expect(rules.length).toBeGreaterThan(500);
    // The one allowed literal is the white fallback inside var(--on-accent, #fff), the same fallback the skip link and primary buttons already use.
    expect(rules.replace(/var\(--on-accent, #fff\)/g, '')).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgb\(|rgba\(/);
  });
});

// D21.1 SUPERSEDED RULE: "only Signature changes the header; every other palette keeps the thin bar" (36px bar, 28px controls, no brand mark). The approved requirement is that the
// Signature header is the header for every palette. Replacement guard: the Signature header tokens are the stylesheet defaults, and no palette may set one (also pinned in d211Palettes.test.ts).
describe('D7 tokens: the Signature header is the header for every palette (D21.1)', () => {
  const decl = (k: string) => tokens.match(new RegExp(`${k}:\s*([^;]+);`))?.[1].trim();
  it('the defaults are the Signature header: 62px (60px on a phone), 40px controls, the brand mark, All modules caption and Ctrl K hint', () => {
    expect(decl('--hdr-h')).toBe('62px');
    expect(decl('--hdr-h-touch')).toBe('62px');
    expect(decl('--hdr-h-phone')).toBe('60px');
    expect(decl('--hdr-ctl-h')).toBe('40px');
    expect([decl('--ui-brand'), decl('--ui-modall'), decl('--ui-kbd')]).toEqual(['flex', 'inline', 'inline-block']);
    expect(decl('--hdr-shadow')).toBe('var(--shadow-1)');
  });

  it('no palette sets any header token', () => {
    for (const p of PRESETS) {
      for (const mode of ['light', 'dark'] as const) expect(Object.keys(p.extras[mode]).filter((k) => /^--(hdr|ui-brand|ui-modall|ui-kbd)/.test(k)), `${p.id} ${mode}`).toEqual([]);
    }
  });
});

describe('D7 what did not change', () => {
  it('Search, Add and the shortcuts are still handled in GlobalFrame, untouched by the header', () => {
    const frame = readFileSync('src/shell/GlobalFrame.tsx', 'utf8');
    expect(frame).toMatch(/e\.key === 'k' \|\| e\.key === 'K'\) && \(e\.ctrlKey \|\| e\.metaKey\)/);
    expect(frame).toMatch(/e\.key === '\/' && !typing/);
    expect(frame).toMatch(/wantsAddShortcut\(e, typing\)/);
    expect(bar).toMatch(/onClick=\{openSearch\}/);
    expect(bar).toMatch(/<QuickAdd \/>/);
    expect(readFileSync('src/shell/QuickAdd.tsx', 'utf8')).toMatch(/onClick=\{\(\) => openAddBox\(\)\}/);
  });
});
