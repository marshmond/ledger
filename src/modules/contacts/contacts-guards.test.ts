import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { allDueProviders } from '../../core/dueProvider';
import { allModules, allQuickAdds, allSearchSources, allTodayCards, allTxnReferenceProviders } from '../../core/registry';
import { registerModules } from '../index';
import { CONTACTS_BASE } from './model';

/** Contacts C1 guard tests: registered once, loaded on demand, stays out of Finance, writes only through the safe Contact helpers, adds no field and shares nothing. */
const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
const src = (dir: string, test = false) => walk(dir).filter((f) => /\.(ts|tsx)$/.test(f) && /\.test\./.test(f) === test).map((f) => ({ f: f.replace(/\\/g, '/'), text: readFileSync(f, 'utf8') }));
const contacts = src('src/modules/contacts');

describe('registration', () => {
  registerModules();
  it('is registered exactly once, last, with its address and screens on demand', () => {
    const mods = allModules().filter((m) => m.id === 'contacts');
    expect(mods).toHaveLength(1);
    expect(mods[0]).toMatchObject({ id: 'contacts', name: 'Contacts & Relationships', routePaths: ['/'] });
    expect(CONTACTS_BASE).toBe('/contacts');
    expect(allModules().map((m) => m.id).slice(-2)).toEqual(['family', 'contacts']);
    const index = readFileSync('src/modules/contacts/index.tsx', 'utf8');
    expect(index).toMatch(/lazyModule\(\(\) => import\('\.\/ContactsModule'\)\)/);
    expect(index).not.toMatch(/import\s+[^;]*from\s+'\.\/(ContactsModule|DirectoryPage|ContactPage|ContactForm)'/);
  });
  it('registering twice does nothing; no other module has the same id or address', () => {
    registerModules(); registerModules();
    expect(allModules().filter((m) => m.id === 'contacts')).toHaveLength(1);
    expect(new Set(allModules().map((m) => m.id)).size).toBe(allModules().length);
    expect(allModules().map((m) => m.name)).toContain('Contacts & Relationships');
  });
  it('contributes exactly one thing, a search source: no Today card, due provider, Add-box destination, record source or Finance reference', () => {
    const mod = allModules().find((m) => m.id === 'contacts')!;
    expect(Object.keys(mod.contributes ?? {})).toEqual(['searchSource']);
    expect(allSearchSources().filter((s) => s.moduleId === 'contacts')).toHaveLength(1);
    expect(allTodayCards().filter((c) => c.id.startsWith('contacts'))).toEqual([]);
    expect(allDueProviders().filter((p) => p.id === 'contacts')).toEqual([]);
    expect(allQuickAdds().filter((q) => q.moduleId === 'contacts')).toEqual([]);
    expect(allTxnReferenceProviders().map((p) => p.label.toLowerCase())).not.toContain('contacts');
  });
  it('has a stylesheet loaded with the others, and an icon', () => {
    expect(readFileSync('src/modules/moduleStyles.ts', 'utf8')).toContain("import './contacts/contacts.css';");
    expect(allModules().find((m) => m.id === 'contacts')!.icon).toBeTruthy();
  });
});

describe('boundaries', () => {
  it('no Contacts file reaches Finance (its pages, engines, types or tables)', () => {
    const bad = contacts.filter(({ text }) => /from '\.\.\/\.\.\/(pages|lib\/(forecast|ledger|budget|schedule|postings|networth|txn)|types)|from '\.\.\/ledger|d\.(txns|accounts|budgets|recurring|holdings|loans|invAccounts)\b|db\.(txns|accounts|budgets|recurring|holdings|loans|invAccounts)\b/.test(text));
    expect(bad.map((x) => x.f)).toEqual([]);
  });
  it('no other module imports Contacts, except the module list; Contacts imports no other module', () => {
    const importers = src('src').filter(({ f, text }) => !f.startsWith('src/modules/contacts/') && /from '(\.\.?\/)+(modules\/)?contacts(\/|')/.test(text) && !/core\/contacts'|\.\/contacts'/.test(text.match(/from '[^']*contacts[^']*'/)?.[0] ?? '')).map((x) => x.f);
    expect(importers.filter((f) => !f.endsWith('src/modules/index.ts'))).toEqual([]);
    const outward = contacts.filter(({ text }) => /from '\.\.\/(?!\.\.\/)(?!contacts)[a-z]+(\/|')/.test(text) && !/from '\.\.\/bases'/.test(text));
    expect(outward.map((x) => x.f)).toEqual([]);
  });
  it('creates only through createDistinctContact and edits only through updateContactDetails: findOrCreateContact and the pickers are never used', () => {
    const all = contacts.map((x) => x.text).join('\n');
    expect(all).not.toMatch(/findOrCreateContact|ContactPicker|ui\/pickers/);
    expect(all).toMatch(/createDistinctContact\(db,/);
    expect(all).toMatch(/updateContactDetails\(db,/);
  });
  it('the only writes in the module are those two helpers: no direct table write, and the unused notes field is never read, shown or written', () => {
    const writers = contacts.filter(({ text }) => /\.(add|put|bulkAdd|bulkPut|update|delete|clear|modify|remove)\(/.test(text)).map((x) => x.f);
    expect(writers).toEqual([]);
    expect(contacts.filter(({ text }) => /\.notes\b|notes:/.test(text)).map((x) => x.f)).toEqual([]);
  });
  it('adds no field, publishes nothing and shares nothing: no storage, network, console, display or share field, no deletion or archive', () => {
    const bad = contacts.filter(({ text }) => /console\.|localStorage|sessionStorage|fetch\(|XMLHttpRequest|sendBeacon|navigator\.share|archivedAt|deletedAt:\s*[^n]|\.remove\(|display(Name|On)|shareWith|publish/.test(text)).map((x) => x.f);
    expect(bad).toEqual([]);
  });
  it('the usage reader is read only: no write, no transaction, no storage, no network', () => {
    const text = readFileSync('src/core/contactUsage.ts', 'utf8');
    // (`found.add(id)` on an in-memory Set is fine; what must never appear is a write on a database table.)
    expect(text).not.toMatch(/\bd\.\w+\.(add|put|bulkAdd|bulkPut|update|delete|clear|modify|remove)\(|\.transaction\(|localStorage|sessionStorage|fetch\(|XMLHttpRequest|createStore/);
    expect(text).not.toMatch(/from '\.\.\/modules\//);
  });
  it('phone and email links come only from the safe helpers (no raw href built from stored text)', () => {
    const page = readFileSync('src/modules/contacts/ContactPage.tsx', 'utf8');
    expect(page.match(/href=\{/g)).toHaveLength(2);
    expect(page).toMatch(/href=\{tel\}/);
    expect(page).toMatch(/href=\{mail\}/);
    expect(page).not.toMatch(/dangerouslySetInnerHTML/);
  });
});

describe('module list overflow (the eleventh module)', () => {
  const css = readFileSync('src/styles.css', 'utf8');
  const rule = css.split('\n').find((l) => l.startsWith('.modmenu {')) ?? '';
  it('the open module list fits the screen height and scrolls inside itself', () => {
    expect(rule).toMatch(/max-height:\s*calc\(100dvh - \d+px\)/);
    expect(rule).toMatch(/max-height:\s*calc\(100vh - \d+px\)/); // the older-browser fallback, declared first
    expect(rule.indexOf('100vh')).toBeLessThan(rule.indexOf('100dvh'));
    expect(rule).toMatch(/overflow-y:\s*auto/);
  });
  it('nothing else about the list changed: still one flat list of links in registration order, no nested menu', () => {
    const bar = readFileSync('src/core/ModuleBar.tsx', 'utf8');
    expect(bar).toMatch(/mods\.map\(\(m\) =>/);
    expect(bar).not.toMatch(/role="menu"|aria-haspopup/);
    expect(css).toMatch(/\.modmenu a \{ display: flex/);
  });
});
