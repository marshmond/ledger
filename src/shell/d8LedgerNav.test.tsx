import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { accessibleName, all, parseHtml, textOf, unnamedButtons, type El } from '../lib/a11yTestkit';
import { ModuleBase } from '../core/router';
import { LEDGER_ROUTE_PATHS } from '../modules/ledger/routePaths';
import { ALL_ITEMS, GROUPS, crumbsFor, groupForPath } from './nav';
import { activePageFor, currentKind, ledgerNavSections } from './ledgerNavModel';
import LedgerNav, { SectionMenu } from './LedgerNav';
import { PRESETS } from '../palette';

/**
 * D8: Ledger's desktop navigation bar (replacing the 248px sidebar). Checked here without a browser: the pure model (every page reachable, defaults,
 * active section and page, the account page, the due count), the markup the bar and its lists produce (landmark, links, disclosure attributes, theme
 * toggle), and the stylesheet rules (breakpoint shared with the phone bars, sticky layers, print, palette roles). Opening, Escape, focus return and
 * measured sizes were checked in a real browser (see the D8 report).
 */
const css = readFileSync('src/styles.css', 'utf8');
const tokens = readFileSync('src/ui/tokens.css', 'utf8');
const shell = readFileSync('src/shell/Shell.tsx', 'utf8');
const navSrc = readFileSync('src/shell/LedgerNav.tsx', 'utf8');
const modelSrc = readFileSync('src/shell/ledgerNavModel.ts', 'utf8');

const wrap = (node: ReturnType<typeof createElement>, path = '/ledger') =>
  parseHtml(renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: [path] }, createElement(ModuleBase, { value: '/ledger' }, node))));
const bar = (pathname: string, dueCount = 0): El => wrap(createElement(LedgerNav, { pathname, dueCount }));
const menuOf = (id: string, pathname: string, dueCount = 0): El =>
  wrap(createElement(SectionMenu, { section: ledgerNavSections(pathname, dueCount).find((s) => s.id === id)! }));
const links = (d: El) => all(d, (e) => e.tag === 'a');
/** The rules of one `@media (…) { … }` block, found by its opening line. */
const block = (opening: string, from = 0) => {
  const start = css.indexOf(opening, from);
  expect(start, `${opening} is in styles.css`).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf('\n}\n', start) + 3);
};
const D8 = css.slice(css.indexOf('D8: Ledger\'s desktop navigation'), css.indexOf('/* Sync status in the module bar. */'));

describe('D8 model: every page is still reachable, from the one list in nav.ts', () => {
  const sections = ledgerNavSections('/', 0);
  it('five sections with the production labels, in order', () => {
    expect(sections.map((s) => s.label)).toEqual(['Home', 'Money', 'Invest', 'Plan', 'More']);
    expect(sections.map((s) => s.id)).toEqual(['home', 'money', 'invest', 'plan', 'more']);
  });
  it('a section opens its default page (read from nav.ts: Money Accounts, Invest Net worth, Plan Income, More Settings)', () => {
    expect(sections.map((s) => s.to)).toEqual(['/', '/accounts', '/networth', '/income', '/more']);
  });
  it('31 destinations: 1 + 10 + 4 + 10 + 6, each listed once', () => {
    expect(sections.map((s) => s.items.length)).toEqual([1, 10, 4, 10, 6]);
    const all31 = sections.flatMap((s) => s.items.map((i) => i.to));
    expect(all31).toHaveLength(31);
    expect(new Set(all31).size).toBe(31);
    expect(all31).toEqual(ALL_ITEMS.map((i) => i.to)); // the model adds and drops nothing
  });
  it('no lost routes: every Ledger route is a listed page, except the individual account page, which Accounts leads to; /backup is still listed (it redirects to Settings)', () => {
    const listed = new Set(sections.flatMap((s) => s.items.map((i) => i.to)));
    expect([...LEDGER_ROUTE_PATHS].filter((p) => !listed.has(p))).toEqual(['/account/:id']);
    for (const p of listed) expect(LEDGER_ROUTE_PATHS).toContain(p);
    expect(listed.has('/backup')).toBe(true);
    expect(readFileSync('src/modules/ledger/LedgerModule.tsx', 'utf8')).toMatch(/\['\/backup', <Navigate to="\/settings\/backup" replace \/>\]/);
  });
  it('only Home has no list; the other four carry one, two columns for the long sections', () => {
    expect(sections.map((s) => s.hasMenu)).toEqual([false, true, true, true, true]);
    expect(sections.map((s) => s.columns)).toEqual([1, 2, 1, 2, 1]);
  });
  it('the model has no pages, addresses or storage of its own', () => {
    expect(modelSrc).not.toMatch(/to: '\//);
    expect(modelSrc).not.toMatch(/localStorage|from '\.\.\/db'|dueInstances/);
  });
});

describe('D8 model: active section and page', () => {
  it('every page lights exactly its own section and itself, and only the default page counts as the section link\'s own page', () => {
    for (const g of GROUPS) {
      for (const item of g.items) {
        const s = ledgerNavSections(item.to, 0);
        expect(s.filter((x) => x.active).map((x) => x.id), item.to).toEqual([g.id]);
        const mine = s.find((x) => x.id === g.id)!;
        expect(mine.items.find((i) => i.to === item.to)!.current, item.to).toBe('page');
        expect(mine.items.filter((i) => i.current).length, item.to).toBe(1);
        expect(mine.current, item.to).toBe(item.to === g.to ? 'page' : 'true');
        for (const other of s.filter((x) => x.id !== g.id)) expect(other.current, `${item.to} vs ${other.id}`).toBeUndefined();
      }
    }
  });
  it('an individual account is Money > Accounts: Money active, Accounts marked as the page it belongs to (not as the page itself)', () => {
    const s = ledgerNavSections('/account/17', 0);
    expect(s.filter((x) => x.active).map((x) => x.id)).toEqual(['money']);
    expect(s.find((x) => x.id === 'money')!.items.find((i) => i.to === '/accounts')!.current).toBe('true');
    expect(s.find((x) => x.id === 'money')!.current).toBe('true');
    expect(activePageFor('/account/17')).toBe('/accounts');
    expect(activePageFor('/account/17/')).toBe('/accounts');
    expect(currentKind('/account/17', '/accounts')).toBe('true');
    expect(groupForPath('/account/17').id).toBe('money'); // the same answer the breadcrumbs and phone tabs use
  });
  it('a trailing slash changes nothing, and an unknown address lights Home (the router shows Home for it)', () => {
    expect(activePageFor('/budget/')).toBe('/budget');
    expect(ledgerNavSections('/budget/', 0).find((x) => x.active)!.id).toBe('money');
    expect(activePageFor('/nowhere')).toBeNull();
    expect(ledgerNavSections('/nowhere', 0).find((x) => x.active)!.id).toBe('home');
  });
  it('Home is the current page only at /', () => {
    expect(ledgerNavSections('/', 0)[0].current).toBe('page');
    expect(ledgerNavSections('/budget', 0)[0].current).toBeUndefined();
  });
  it('breadcrumbs are unchanged: the account page still reads Money > Accounts > name', () => {
    expect(crumbsFor('/account/3', 'Demo Checking')).toEqual([{ label: 'Money', to: '/accounts' }, { label: 'Accounts', to: '/accounts' }, { label: 'Demo Checking' }]);
    expect(shell).toContain('aria-label="Breadcrumb"');
    expect(shell).toContain("crumbsFor(loc.pathname, account?.name)");
  });
});

describe('D8 due count: passed in, shown on Money and on Scheduled, never computed in the bar', () => {
  it('shows the number on Money and Scheduled only', () => {
    const s = ledgerNavSections('/', 3);
    expect(s.map((x) => x.badge)).toEqual([0, 3, 0, 0, 0]);
    expect(s.flatMap((x) => x.items).filter((i) => i.badge).map((i) => [i.to, i.badge])).toEqual([['/scheduled', 3]]);
  });
  it('shows nothing for none (or a nonsense negative)', () => {
    for (const n of [0, -2]) expect(ledgerNavSections('/', n).flatMap((x) => [x.badge, ...x.items.map((i) => i.badge)]).every((b) => b === 0)).toBe(true);
  });
  it('the number is the one Shell already read from dueInstances for the next 7 days, and the bar does no date or amount work', () => {
    expect(shell).toMatch(/const dueCount = useLiveQuery\(async \(\) => \(await dueInstances\(db, today, 7\)\)\.length, \[today\]\) \?\? 0;/);
    expect(shell).toMatch(/<LedgerNav pathname=\{loc\.pathname\} dueCount=\{dueCount\} \/>/);
    expect(navSrc).not.toMatch(/dueInstances|from '\.\.\/db'|useLiveQuery|new Date|Date\.now/);
  });
  it('rendered: a visible number on Money, with the word "due" kept for assistive technology', () => {
    const d = bar('/ledger/transactions'.replace('/ledger', ''), 4);
    const money = links(d).find((a) => a.attrs.href === '/ledger/accounts')!;
    expect(textOf(money)).toBe('Money4 due');
    expect(all(money, (e) => e.attrs.class === 'count')).toHaveLength(1);
    expect(all(money, (e) => e.attrs.class === 'sr-only')).toHaveLength(1);
    const menu = menuOf('money', '/transactions', 4);
    expect(textOf(links(menu).find((a) => a.attrs.href === '/ledger/scheduled')!)).toBe('Scheduled4 due');
    expect(textOf(links(menu).find((a) => a.attrs.href === '/ledger/budget')!)).toBe('Budget');
  });
});

describe('D8 bar: landmark, links and disclosure controls', () => {
  const d = bar('/budget', 0);
  it('one named navigation landmark, distinct from the global header\'s "Modules and tools" and the phone bars', () => {
    const navs = all(d, (e) => e.tag === 'nav');
    expect(navs).toHaveLength(1);
    expect(navs[0].attrs['aria-label']).toBe('Ledger sections');
    expect(all(navs[0], (e) => e.tag === 'nav')).toHaveLength(0); // nothing nested inside it
    expect(shell).toContain('aria-label={`${group.label} pages`}');
    expect(shell).toContain('aria-label="Sections"');
  });
  it('five links to the default pages, in the Ledger address space', () => {
    const primary = all(d, (e) => e.tag === 'a' && (e.attrs.class ?? '') === 'lnav-link');
    expect(primary.map((a) => [textOf(a).trim(), a.attrs.href])).toEqual([['Home', '/ledger'], ['Money', '/ledger/accounts'], ['Invest', '/ledger/networth'], ['Plan', '/ledger/income'], ['More', '/ledger/more']]);
  });
  it('the section on the current page is marked, by name and by aria-current, and no other', () => {
    const cur = all(d, (e) => e.attrs['aria-current'] !== undefined).map((e) => [textOf(e).trim(), e.attrs['aria-current']]);
    expect(cur).toEqual([['Money', 'true']]); // /budget is inside Money, not the Money link's own page
    const home = bar('/', 0);
    expect(all(home, (e) => e.attrs['aria-current'] !== undefined).map((e) => [textOf(e).trim(), e.attrs['aria-current']])).toEqual([['Home', 'page']]);
    const accounts = bar('/accounts', 0);
    expect(all(accounts, (e) => e.attrs['aria-current'] !== undefined).map((e) => e.attrs['aria-current'])).toEqual(['page']);
    expect(all(accounts, (e) => (e.attrs.class ?? '').includes('active')).map((e) => e.attrs.class)).toEqual(['lnav-item active ']);
  });
  it('four disclosure buttons (not Home), closed, each named for its section and tied to its list', () => {
    const toggles = all(d, (e) => e.tag === 'button' && e.attrs.class === 'lnav-tog');
    expect(toggles.map((t) => accessibleName(d, t))).toEqual(['Money pages', 'Invest pages', 'Plan pages', 'More pages']);
    for (const t of toggles) {
      expect(t.attrs['aria-expanded']).toBe('false');
      expect(t.attrs['aria-controls']).toMatch(/^lnav-menu-(money|invest|plan|more)$/);
      expect(t.attrs.type).toBe('button');
      expect(all(t, (e) => e.tag === 'svg')[0].attrs['aria-hidden']).toBe('true');
    }
    expect(all(d, (e) => (e.attrs.class ?? '').startsWith('lnav-menu'))).toHaveLength(0); // closed: no list in the page
  });
  it('plain links and buttons, no ARIA menu, no hover-only opening, no dialog', () => {
    expect(all(d, (e) => ['menu', 'menubar', 'menuitem', 'dialog'].includes(e.attrs.role ?? ''))).toHaveLength(0);
    expect(navSrc).not.toMatch(/role=|aria-haspopup|onMouseEnter|onMouseOver|onPointerEnter|:hover/);
  });
  it('every control has a name', () => {
    expect(unnamedButtons(d)).toEqual([]);
  });
  it('the theme switch (Device, Light, Dark) is in the bar, the same component and settings as before', () => {
    const theme = all(d, (e) => e.tag === 'button' && e.attrs.class === 'themebtn');
    expect(theme).toHaveLength(1);
    expect(accessibleName(d, theme[0])).toMatch(/^Theme: .+\. Activate to switch to .+\.$/);
    expect(navSrc).toContain("import ThemeToggle from '../pages/ThemeToggle'");
    expect(readFileSync('src/pages/ThemeToggle.tsx', 'utf8')).toContain('saveTheme(t)');
  });
});

describe('D8 lists: every page of a section, with the current one marked', () => {
  it('Money: ten links in the production order, two columns, Accounts marked on /accounts', () => {
    const d = menuOf('money', '/accounts');
    expect(links(d).map((a) => [textOf(a).trim(), a.attrs.href])).toEqual([
      ['Check-in', '/ledger/checkin'], ['Accounts', '/ledger/accounts'], ['Transactions', '/ledger/transactions'], ['Budget', '/ledger/budget'], ['Scheduled', '/ledger/scheduled'],
      ['Forecast', '/ledger/forecast'], ['Reports', '/ledger/reports'], ['Rules', '/ledger/rules'], ['Import', '/ledger/import'], ['Categories', '/ledger/categories'],
    ]);
    expect(all(d, (e) => (e.attrs.class ?? '').startsWith('lnav-menu'))[0].attrs.class).toBe('lnav-menu cols-2');
    expect(all(d, (e) => e.attrs['aria-current'] !== undefined).map((a) => [textOf(a), a.attrs['aria-current']])).toEqual([['Accounts', 'page']]);
  });
  it('an account page marks Accounts as the page it sits under', () => {
    const d = menuOf('money', '/account/9');
    expect(all(d, (e) => e.attrs['aria-current'] !== undefined).map((a) => [textOf(a), a.attrs['aria-current']])).toEqual([['Accounts', 'true']]);
  });
  it('Invest has four, Plan ten, More six (Settings & about is listed first; Data & Backups is still listed)', () => {
    expect(links(menuOf('invest', '/debt')).map((a) => a.attrs.href)).toEqual(['/ledger/networth', '/ledger/investments', '/ledger/payoff', '/ledger/debt']);
    expect(links(menuOf('plan', '/roth')).map((a) => a.attrs.href)).toEqual(['/ledger/income', '/ledger/taxplan', '/ledger/giving', '/ledger/afford', '/ledger/paycheck', '/ledger/projections', '/ledger/retirement', '/ledger/goals', '/ledger/protection', '/ledger/roth']);
    const more = menuOf('more', '/review');
    expect(links(more).map((a) => [textOf(a).trim(), a.attrs.href])).toEqual([
      ['Settings & about', '/ledger/more'], ['Year in review', '/ledger/review'], ['If something happens', '/ledger/guide'], ['Tax package', '/ledger/taxpackage'], ['Sync devices', '/ledger/sync'], ['Data & Backups', '/ledger/backup'],
    ]);
    expect(all(more, (e) => e.attrs['aria-current'] !== undefined).map((a) => textOf(a))).toEqual(['Year in review']);
  });
  it('keeps the phone and search labels from nav.ts (only the desktop list says "Settings & about")', () => {
    expect(ALL_ITEMS.find((i) => i.to === '/more')!.label).toBe('Settings');
  });
});

describe('D8 behaviour in the component source (open, Escape, focus return, outside press, navigation)', () => {
  it('one list open at a time; the chevron toggles it; the name link always navigates', () => {
    expect(navSrc).toMatch(/useState<GroupId \| null>\(null\)/);
    expect(navSrc).toMatch(/setOpen\(\(cur\) => \(cur === s\.id \? null : s\.id\)\)/);
  });
  it('closes on a page change, on Escape (returning focus to the button), on a press outside the open section, and when focus leaves it', () => {
    expect(navSrc).toMatch(/useEffect\(\(\) => \{ setOpen\(null\); \}, \[pathname\]\)/);
    expect(navSrc).toMatch(/e\.key !== 'Escape'/);
    expect(navSrc).toMatch(/querySelector<HTMLButtonElement>\('\.lnav-tog'\)\?\.focus\(\)/);
    expect(navSrc).toMatch(/addEventListener\('pointerdown', onDown\)/);
    expect(navSrc).toMatch(/removeEventListener\('pointerdown', onDown\)/);
    expect(navSrc).toMatch(/onBlur=\{\(e\) => \{ if \(open === s\.id && e\.relatedTarget/);
  });
  it('does not trap focus (no Tab handler, no autofocus)', () => {
    expect(navSrc).not.toMatch(/'Tab'|autoFocus/);
    expect(navSrc.match(/\.focus\(\)/g)).toHaveLength(1); // only the Escape return
  });
});

describe('D8 Shell: the sidebar is gone, the phone bars are untouched', () => {
  it('no sidebar markup, search button, side-group or sidebar memory remains in Shell', () => {
    expect(shell).not.toMatch(/sidebar|side-link|side-head|side-foot|searchbtn|loadOpenGroup|saveOpenGroup|toggleGroup|openSearch|ThemeToggle/);
    expect(shell).toContain('<LedgerNav ');
  });
  it('the phone keeps its section tabs and five-tab bottom bar, drawn from the same GROUPS', () => {
    expect(shell).toContain('<nav className="tabbar" aria-label="Sections">');
    expect(shell).toContain('<nav className="sectiontabs" aria-label={`${group.label} pages`} ref={fade.ref}>');
    expect(shell).toMatch(/GROUPS\.map\(\(g\) => \(\s*<NavLink key=\{g\.id\} to=\{g\.to\} end=\{g\.id === 'home'\} className=\{g\.id === group\.id \? 'active' : ''\}>/);
    expect(shell).toContain("g.id === 'money' && dueCount > 0 && <span className=\"count tabcount\">{dueCount}</span>");
    expect(shell).toContain("{ICONS[g.id]}");
    expect(GROUPS.map((g) => [g.id, g.to])).toEqual([['home', '/'], ['money', '/accounts'], ['invest', '/networth'], ['plan', '/income'], ['more', '/more']]);
  });
  it('Search, Settings and Add stay in the global header (D7), so nothing was lost with the sidebar', () => {
    const header = readFileSync('src/core/ModuleBar.tsx', 'utf8');
    expect(header).toMatch(/openSearch/);
    expect(header).toContain('to="/settings"');
    expect(header).toMatch(/QuickAdd/);
    expect(readFileSync('src/pages/MorePage.tsx', 'utf8').length).toBeGreaterThan(0);
  });
});

describe('D8 stylesheet', () => {
  it('the old sidebar rules are gone (no 248px column, no .sidebar, .side-*)', () => {
    const rules = css.replace(/\/\*[\s\S]*?\*\//g, ''); // the comments say what was replaced
    expect(rules).not.toMatch(/\.sidebar|\.side-link|\.side-head|\.side-foot|\.side-items|\.side-group|248px/);
    expect(rules).not.toMatch(/\.shell \{ display: grid/);
  });
  it('the bar exists from 900px, the same breakpoint at which the phone bars stop (never both, never neither)', () => {
    expect(css).toMatch(/\.lnav \{ display: none; \}/);
    const at900 = block('@media (min-width: 900px) {\n  .tabbar, .sectiontabs-wrap { display: none; }');
    expect(at900).toContain('.tabbar, .sectiontabs-wrap { display: none; }');
    const bar900 = block('@media (min-width: 900px) {\n  :root { --sub-h: var(--lnav-h)');
    expect(bar900).toMatch(/\.lnav \{ display: block; position: sticky; top: var\(--bar-h\); z-index: 45; height: var\(--sub-h\);/);
  });
  it('sticky layers: header (50) over the bar (45) over the top bar (20); --sub-h is 0 on a phone and the bar height on a computer', () => {
    expect(css).toMatch(/:root \{ --sub-h: 0px; \}/);
    expect(css).toMatch(/\.modulebar \{ position: sticky; top: 0; z-index: 50;/);
    expect(css).toMatch(/\.topbar \{ position: sticky; top: 0; z-index: 20;/);
    expect(css).toMatch(/:root \{ --sub-h: var\(--lnav-h\); --ledger-w:/);
    expect(css).toMatch(/\.lnav-menu \{[^}]*z-index: 46;/);
    expect(css).toMatch(/:root\[data-tabbar='yes'\] \{ --tab-h: 57px; \}/); // the phone's bottom-bar rule is untouched
  });
  it('touch screens wider than 900px keep 44px targets', () => {
    expect(css).toMatch(/@media \(min-width: 900px\) and \(pointer: coarse\) \{\s*:root \{ --sub-h: max\(var\(--lnav-h\), 44px\); \}\s*\.lnav-tog \{ min-width: 44px; \}\s*\.lnav \.themebtn \{ min-height: 44px; \}/);
  });
  it('the recovered width goes to the page, still capped; the page top bar lines up with it', () => {
    expect(css).toMatch(/--ledger-w: clamp\(1120px, 88vw, 1760px\)/);
    expect(css).toMatch(/\.shell-main \.main \{ max-width: var\(--ledger-w\); \}/);
    expect(css).toMatch(/\.shell-main \.topbar \{ padding-inline: max\(var\(--sp-5\), calc\(\(100% - var\(--ledger-w\)\) \/ 2 \+ var\(--sp-5\)\)\); \}/);
  });
  it('print shows no bar', () => {
    expect(css).toMatch(/@media print \{ \.lnav, \.tabbar, \.topbar, \.sectiontabs-wrap, \.qa \{ display: none !important; \} \}/);
  });
  it('colours come from the palette\'s menu roles and shared tokens, with no colour literals', () => {
    expect(D8).toMatch(/background: var\(--side-bg, var\(--card\)\); color: var\(--side-fg, var\(--fg\)\)/);
    expect(D8).toMatch(/var\(--side-active, var\(--accent\)\)/);
    expect(D8.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
  });
  it('the current page is not told by colour alone: weight, an underline on the section and a bar on the listed page', () => {
    expect(D8).toMatch(/\.lnav-item\.active \.lnav-tab \{ border-bottom-color:/);
    expect(D8).toMatch(/\.lnav-item\.active \.lnav-link \{ font-weight: 650;/);
    expect(D8).toMatch(/\.lnav-menu a\.active \{[^}]*font-weight: 650; box-shadow: inset 3px 0 0 var\(--accent\);/);
  });
  it('the chevron has a visible keyboard focus ring from the app\'s global focus rule (not removed here)', () => {
    expect(D8).not.toMatch(/outline: none|outline:none/);
  });
});

describe('D8 correction: the Transactions filter row sticks directly under the heading row', () => {
  it('the heading row has one fixed height and the filter row offset is that same variable (no separate guess that can drift)', () => {
    expect(css).toMatch(/\.txn-table \{ --txn-head-h: \d+px; \}/);
    expect(css).toMatch(/\.txn-table thead tr:first-child th \{ height: var\(--txn-head-h\);/);
    expect(css).toMatch(/\.txn-table thead tr\.col-filters th \{ top: calc\(var\(--topbar-h\) \+ var\(--bar-h\) \+ var\(--sub-h\) \+ var\(--txn-head-h\)\); \}/);
    expect(css).not.toMatch(/--sub-h\) \+ 36px/);
  });
});

// D21.1 SUPERSEDED RULE: "only Signature changes the bar's size and icons" (40px bar, no icons for everyone else). The approved requirement is that the Signature bar is the
// bar for every palette. Replacement guard: the 46px bar with icons is the stylesheet default and no palette may set either token.
describe('D8 tokens: the Signature navigation bar is the bar for every palette (D21.1)', () => {
  it('defaults: 46px bar with line icons', () => {
    expect(tokens).toMatch(/--lnav-h: 46px;/);
    expect(tokens).toMatch(/--ui-lnav-ic: inline-flex;/);
  });
  it('no palette sets either token', () => {
    for (const p of PRESETS) expect(JSON.stringify(p)).not.toMatch(/lnav/);
    expect(readFileSync('src/palette.ts', 'utf8')).not.toMatch(/'--lnav-h'|'--ui-lnav-ic'/);
  });
});
