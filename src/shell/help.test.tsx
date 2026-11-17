import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { allModules } from '../core/registry';
import { SHELL_PATHS, withBasePath } from '../core/paths';
import { registerModules } from '../modules';
import { LEDGER_ROUTE_PATHS } from '../modules/ledger/routePaths';
import ModuleBar, { ModuleFoot } from '../core/ModuleBar';
import { accessibleName, all, headingSkips, headings, parseHtml, textOf, unnamedButtons } from '../lib/a11yTestkit';
import HelpPage from './HelpPage';
import { CONNECT, EXAMPLES, HOUSEHOLD_AREAS, STEPS, WELCOME, WHERE_TO, allHelpLinks } from './helpContent';

/**
 * Getting Started & Help. The page is read-only product documentation, so these tests pin the things that could quietly go wrong:
 * a link to a screen that does not exist, a sentence that promises more than Ledger does (automatic backups, sync, QFX import),
 * an internal phase name leaking into the words, the page writing something, and the entry points disappearing.
 */

// The header reads live sync state and the Add button needs the database; both are replaced by small stand-ins (as the header tests do).
vi.mock('../lib/sync/auto', () => ({ useSyncStatus: () => ({ configured: false, state: 'idle', conflicts: 0, auto: false }), syncNow: () => Promise.resolve() }));
vi.mock('./QuickAdd', () => ({ default: () => createElement('button', { className: 'qa-btn', 'aria-label': 'Quick add' }, '+') }));

const read = (f: string) => readFileSync(f, 'utf8');
const page = () => parseHtml(renderToStaticMarkup(createElement(MemoryRouter, null, createElement(HelpPage))));
const pageText = () => textOf(page());
registerModules();

describe('the Help route', () => {
  it('is a shell page like Settings, Answers and Records: not a module, never given a module prefix, loaded on demand', () => {
    expect(allModules().map((m) => m.id)).not.toContain('help');
    expect(SHELL_PATHS).toContain('/help');
    expect(withBasePath('/ledger', '/help')).toBe('/help');
    expect(withBasePath('/bills', '/help')).toBe('/help');
    const app = read('src/App.tsx');
    expect(app).toMatch(/lazyModule\(\(\) => import\('\.\/shell\/HelpPage'\)\)/);
    expect(app).toMatch(/path="\/help\/\*"/);
    expect(app).toMatch(/first === 'help'\) return preloadLazyModule\(HelpPage\)/);
  });

  it('draws one h1, no skipped heading levels, one main landmark and a skip target', () => {
    const d = page();
    const hs = headings(d);
    expect(hs.filter((h) => h.level === 1).map((h) => h.text)).toEqual(['Getting Started & Help']);
    expect(hs.filter((h) => h.level === 2).map((h) => h.text)).toEqual(['Welcome to Ledger', 'Getting started', 'How everything connects', 'Where do I go when…?']);
    expect(headingSkips(d)).toEqual([]);
    expect(all(d, (e) => e.tag === 'main').map((m) => m.attrs.id)).toEqual(['main-content']);
    expect(unnamedButtons(d)).toEqual([]);
  });

  it('keeps the examples in a closed details element', () => {
    const det = all(page(), (e) => e.tag === 'details');
    expect(det).toHaveLength(1);
    expect('open' in det[0].attrs).toBe(false);
    expect(all(page(), (e) => e.tag === 'summary').map((s) => textOf(s).trim())).toEqual(['Show me an example']);
  });
});

describe('every link goes to a screen that exists', () => {
  const settingsPages = [...read('src/pages/SettingsPage.tsx').matchAll(/<Route path="([a-z-]+)"/g)].map((m) => m[1]);
  const known = (to: string): boolean => {
    const [, first, second] = to.split('/');
    if (first === 'settings') return settingsPages.includes(second);
    const mod = allModules().find((m) => m.id === first);
    if (!mod) return false;
    if (!second) return true;
    if (first === 'ledger') return LEDGER_ROUTE_PATHS.includes(`/${second}`);
    return false; // the guide links to a module's front screen only (other modules have routes with ids or no sub-pages)
  };

  it('the Settings page list was read (so the check below is not vacuous)', () => {
    expect(settingsPages).toEqual(expect.arrayContaining(['backup', 'sync']));
  });

  it('every address in the content is a registered module, a Ledger page or a Settings page', () => {
    const bad = allHelpLinks().filter((to) => !known(to));
    expect(bad).toEqual([]);
    expect(allHelpLinks().length).toBeGreaterThanOrEqual(24);
  });

  it('every link drawn on the page is a hash address from the content, and none is empty', () => {
    const hrefs = all(page(), (e) => e.tag === 'a').map((a) => a.attrs.href);
    expect(hrefs.sort()).toEqual(allHelpLinks().map((to) => `#${to}`).sort());
    expect(hrefs.every((h) => /^#\/[a-z]/.test(h))).toBe(true);
    for (const a of all(page(), (e) => e.tag === 'a')) expect(textOf(a).trim().length, a.attrs.href).toBeGreaterThan(1);
  });

  it('the household areas in step 4 are exactly the six household modules, and Where do I go has the ten asked-for entries', () => {
    expect(HOUSEHOLD_AREAS.map((a) => a.path)).toEqual(['/family', '/contacts', '/bills', '/services', '/assets', '/projects']);
    expect(WHERE_TO).toHaveLength(10);
    expect(STEPS.map((s) => s.id)).toEqual(['today', 'add', 'finances', 'household', 'data']);
  });
});

describe('the words are accurate and plain', () => {
  const all_ = () => [
    pageText(),
    JSON.stringify([WELCOME, STEPS, CONNECT, EXAMPLES]),
  ].join('\n');

  it('never says backups or sync happen on their own by default', () => {
    const t = pageText();
    expect(t).toMatch(/does not copy anything to another browser or device unless you set up sync/);
    expect(t).toMatch(/Automatic weekly backups are optional too\. They are off until you turn them on, and they need sync to be set up first/);
    expect(t).toMatch(/Backups and sync do different jobs/);
    expect(t).toMatch(/If you clear this browser’s data[^.]*no backup or synced copy, your information cannot be recovered/);
    expect(t).not.toMatch(/automatically (back|sync|synchron)/i);
    expect(t).not.toMatch(/always (backed up|synced)/i);
  });

  it('says CSV import exists and that other bank file types do not, and does not call finance a prerequisite', () => {
    const t = pageText();
    expect(t).toMatch(/Ledger reads CSV files\. It does not read other bank file types such as QFX or QIF/);
    expect(t).toMatch(/Money is one part of Ledger, not a requirement/);
    expect(t).toMatch(/Set up your finances \(optional\)/);
  });

  it('separates what shows up on its own from what needs a link, and says names alone never connect records', () => {
    const kinds = new Set(CONNECT.items.map((i) => i.kind));
    expect([...kinds].sort()).toEqual(['auto', 'link']);
    expect(CONNECT.lead).toBe('Enter information where it belongs. Ledger helps show it where it’s useful.');
    expect(pageText()).toMatch(/does not connect records just because their names match/);
    expect(pageText()).toMatch(/Shows up on its own/);
    expect(pageText()).toMatch(/You choose the link/);
    // A bill never claims to create or pay a transaction, and its reminder Task is something you turn on.
    expect(pageText()).toMatch(/Entering a bill does not create or pay a transaction/);
    expect(pageText()).toMatch(/Adding a subscription does not create a transaction and does not pay anything/);
    expect(pageText()).toMatch(/one Task for the next visit/);
  });

  it('does not describe anything deferred or owner-configured as working: no Gmail, calendar subscription, command station or external calendar sync', () => {
    expect(all_()).not.toMatch(/gmail|family command|command station|tablet|subscribe to|google calendar|apple calendar|outlook/i);
  });

  it('keeps internal phase names and jargon out of the words', () => {
    const t = all_();
    expect(t).not.toMatch(/\b(GS|CAL|CS|ST|RS|AI)-\d|\b[DRSBFHCPGLT]\d(\.\d)?\b|\bphase\b|\bmigration\b|\bIndexedDB\b|\bAPI\b|\bJSON\b/);
  });

  it('uses American spelling', () => {
    expect(all_()).not.toMatch(/\b(organis|colour|favour|behaviour|centre|catalogue|cancelled|licence|programme)/i);
  });
});

describe('the page changes nothing', () => {
  it('imports no database, storage or settings code, and has no saved "seen it" state', () => {
    for (const f of ['src/shell/HelpPage.tsx', 'src/shell/helpContent.ts']) {
      const src = read(f);
      expect(src, f).not.toMatch(/from '\.\.\/db'|dexie|localStorage|sessionStorage|indexedDB|useLiveQuery|loadShellSettings|saveShellSettings|\bfetch\(/);
    }
  });

  it('draws one button, and it only opens the ordinary Add box (nothing is saved by it)', () => {
    const buttons = all(page(), (e) => e.tag === 'button');
    expect(buttons.map((b) => accessibleName(page(), b))).toEqual(['Open the Add box']);
    const src = read('src/shell/HelpPage.tsx');
    expect(src.match(/onClick=/g)).toHaveLength(1);
    expect(src).toMatch(/onClick=\{\(\) => openAddBox\(\)\}/);
  });
});

describe('how people reach it', () => {
  it('the header has a Help link with a name, and the phone list carries one too', () => {
    const bar = parseHtml(renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: ['/today'] }, createElement(ModuleBar))));
    const help = all(bar, (e) => e.tag === 'a' && e.attrs.href === '/help');
    expect(help).toHaveLength(1);
    expect(accessibleName(bar, help[0])).toBe('Help');
    const foot = parseHtml(renderToStaticMarkup(createElement(MemoryRouter, null, createElement(ModuleFoot, { inSettings: false, inHelp: true }))));
    const f = all(foot, (e) => e.tag === 'a' && e.attrs.href === '/help');
    expect(f).toHaveLength(1);
    expect(f[0].attrs['aria-current']).toBe('page');
    expect(accessibleName(foot, f[0])).toBe('Help');
  });

  it('the header link is hidden on a phone (the list carries it) and keeps a 44 px target on touch screens', () => {
    const css = read('src/styles.css');
    expect(css).toMatch(/\.modulebar > \.modhelp \{ display: none; \}|\.modulebar > \.modsettings, \.modulebar > \.modhelp \{ display: none; \}/);
    expect(css).toMatch(/\.modsettings, \.modhelp, \.modmenu a \{ min-height: 44px; \}/);
    expect(css).toMatch(/\.modhelp \{ min-width: 44px; \}/);
  });

  it('the Finance Home checklist is unchanged apart from one added link: same key, same four steps, same dismissal', () => {
    const src = read('src/pages/HomePage.tsx');
    expect(src).toMatch(/const ONBOARD_KEY = 'ledger\.onboarding\.dismissed';/);
    for (const to of ["'/accounts'", "'/income'", "'/investments'", "'/backup'"]) expect(src).toContain(`to: ${to}`);
    expect(src).toMatch(/const showOnboard = !onboardOff && stepsDone < steps\.length;/);
    expect(src).toMatch(/localStorage\.setItem\(ONBOARD_KEY, '1'\)/);
    expect(src).toMatch(/<Link className="link" to="\/help">Read the guide<\/Link>/);
    expect(src.match(/to="\/help"/g)).toHaveLength(1);
  });
});

describe('the stylesheet follows the shared rules', () => {
  it('help.css uses tokens only: no hex colour, no inline style in the page, no priority override', () => {
    const css = read('src/shell/help.css');
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/!important/);
    expect(css).not.toMatch(/\brgba?\(/);
    expect(read('src/shell/HelpPage.tsx')).not.toMatch(/style=\{/);
  });
});
