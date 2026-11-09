import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { allDueProviders } from '../../core/dueProvider';
import { allModules, allQuickAdds, allSearchSources, allTodayCards, allTxnReferenceProviders } from '../../core/registry';
import { registerModules } from '../index';
import { FAMILY_BASE } from './model';

/** F1 guard tests: the module is registered once and loaded on demand, stays out of Finance, adds nothing beyond its one record kind, and keeps notes out of logs. */
const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
const src = (dir: string, test = false) => walk(dir).filter((f) => /\.(ts|tsx)$/.test(f) && /\.test\./.test(f) === test).map((f) => ({ f: f.replace(/\\/g, '/'), text: readFileSync(f, 'utf8') }));
const family = src('src/modules/family');

describe('registration', () => {
  registerModules();
  it('Family is registered exactly once, with its address and screens on demand', () => {
    const mods = allModules().filter((m) => m.id === 'family');
    expect(mods).toHaveLength(1);
    expect(mods[0]).toMatchObject({ id: 'family', name: 'Family', routePaths: ['/'] });
    expect(FAMILY_BASE).toBe('/family');
    const index = readFileSync('src/modules/family/index.tsx', 'utf8');
    expect(index).toMatch(/lazyModule\(\(\) => import\('\.\/FamilyModule'\)\)/);
    expect(index).not.toMatch(/import\s+[^;]*from\s+'\.\/(FamilyModule|OverviewPage|MemberPage|MemberForm)'/);
  });
  it('registering twice does not duplicate it', () => {
    registerModules(); registerModules();
    expect(allModules().filter((m) => m.id === 'family')).toHaveLength(1);
  });
  it('F1 contributes nothing else: no Calendar layer, Today card, search source, Add-box destination or Finance reference', () => {
    const mod = allModules().find((m) => m.id === 'family')!;
    expect(mod.contributes).toBeUndefined();
    expect(allDueProviders().map((p) => p.id)).not.toContain('family');
    expect(allTodayCards().filter((c) => c.id.startsWith('family'))).toEqual([]);
    expect(allSearchSources().length).toBe(allModules().filter((m) => m.contributes?.searchSource).length);
    expect(allQuickAdds().filter((q) => /family|fam/i.test(q.id) || /^fam/.test(q.prefix))).toEqual([]);
    expect(allTxnReferenceProviders().map((p) => p.label.toLowerCase())).not.toContain('family');
  });
  it('its stylesheet is loaded with the others', () => {
    expect(readFileSync('src/modules/moduleStyles.ts', 'utf8')).toContain("import './family/family.css';");
  });
});

describe('boundaries', () => {
  it('no Family file reaches Finance (its pages, engines, types or tables)', () => {
    const bad = family.filter(({ text }) => /from '\.\.\/\.\.\/(pages|lib\/(forecast|ledger|budget|schedule|postings|networth|txn)|types)|from '\.\.\/ledger|d\.(txns|accounts|budgets|recurring|holdings)\b/.test(text));
    expect(bad.map((x) => x.f)).toEqual([]);
  });
  it('no other module imports Family, except the module list', () => {
    const importers = src('src').filter(({ f, text }) => !f.startsWith('src/modules/family/') && /from '(\.\.?\/)+(modules\/)?family(\/|')/.test(text)).map((x) => x.f);
    expect(importers.filter((f) => !f.endsWith('src/modules/index.ts'))).toEqual([]);
  });
  it('the Family files write only through moduleRecords and the one distinct-contact helper; Tasks, Calendar and Projects are never written', () => {
    const writers = family.filter(({ text }) => /\.(add|put|bulkAdd|bulkPut|update|delete|clear)\(/.test(text)).map((x) => x.f);
    expect(writers.sort()).toEqual(['src/modules/family/data.ts']);
    const data = family.find((x) => x.f.endsWith('/data.ts'))!.text;
    expect(data).not.toMatch(/tasks\/data|calendar\/data|projects\/data|findOrCreateContact|updateContactDetails/);
  });
  it('the dependency reader has no writes, no transaction, no storage and no network', () => {
    const text = family.find((x) => x.f.endsWith('/references.ts'))!.text;
    expect(text).not.toMatch(/\.(add|put|bulkAdd|bulkPut|update|delete|clear|modify)\(|\.transaction\(|localStorage|sessionStorage|fetch\(|XMLHttpRequest|createStore/);
  });
  it('the model is pure: no database, clock, storage or network', () => {
    const text = family.find((x) => x.f.endsWith('/model.ts'))!.text;
    expect(text.replace(/import type[^\n]*\n/g, '')).not.toMatch(/from '\.\.\/\.\.\/db'|Date\.now|localStorage|fetch\(/);
  });
  it('nothing logs, and nothing stores or sends a note: no console calls, no local storage, no network in any Family file', () => {
    const bad = family.filter(({ text }) => /console\.|localStorage|sessionStorage|fetch\(|XMLHttpRequest|navigator\.sendBeacon/.test(text)).map((x) => x.f);
    expect(bad).toEqual([]);
  });
  it('the note is only ever drawn behind the Show button, and never in a label, title or summary', () => {
    const page = family.find((x) => x.f.endsWith('/MemberPage.tsx'))!.text;
    expect(page.match(/\.note\b/g)).toHaveLength(2); // `d.note ?` and `note={d.note}`
    expect(page).toMatch(/shown \? note :/);
    for (const { f, text } of family.filter((x) => !x.f.endsWith('/MemberPage.tsx') && !x.f.endsWith('/MemberForm.tsx') && !x.f.endsWith('/data.ts') && !x.f.endsWith('/model.ts'))) expect(text, f).not.toMatch(/\.note\b/);
    const model = family.find((x) => x.f.endsWith('/model.ts'))!.text;
    expect(model.slice(model.indexOf('export function memberSummary'))).not.toMatch(/note/);
  });
});
