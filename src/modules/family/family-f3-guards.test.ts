import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { registerModules } from '../index';
import { allDueProviders } from '../../core/dueProvider';
import { allModules, allQuickAdds, allSearchSources, allTodayCards } from '../../core/registry';

/** F3 guard tests: the new readers write nothing; the only writer is the association file, which touches Family rows (and a Contact only when asked); Finance, Calendar, Tasks and Projects are never written. */
const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
const read = (f: string) => readFileSync(f, 'utf8');
const files = (dir: string) => walk(dir).filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f)).map((f) => ({ f: f.replace(/\\/g, '/'), text: read(f) }));
const family = files('src/modules/family');
const one = (name: string) => family.find((x) => x.f.endsWith(`/${name}`))!.text;
const code = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const WRITES = /\.(add|put|bulkAdd|bulkPut|update|delete|bulkDelete|clear|modify|remove|restore)\(|\.transaction\(|createStore|repo\(|localStorage|sessionStorage|fetch\(|XMLHttpRequest|console\./;

describe('the readers are read-only', () => {
  it.each(['memberSchedule.ts', 'memberWork.ts', 'importantContactModel.ts'])('%s has no write, transaction, storage, network or logging', (name) => {
    expect(code(one(name))).not.toMatch(WRITES);
  });
  it('the member-page sections do not write either: the only writes on the page go through the association functions', () => {
    expect(code(one('MemberSections.tsx'))).not.toMatch(WRITES);
    const ic = code(one('ImportantContacts.tsx'));
    expect(ic).not.toMatch(/\.(add|put|bulkAdd|bulkPut|update|delete|remove|restore)\(|localStorage|fetch\(/);
    expect(ic).toMatch(/addImportantContact|setImportantContactStatus|updateImportantContactPurpose/);
  });
  it('the pure schedule/model files use no clock: today is always passed in', () => {
    for (const name of ['memberSchedule.ts', 'memberWork.ts', 'importantContactModel.ts']) expect(code(one(name)), name).not.toMatch(/Date\.now|new Date|todayISO/);
  });
  it('the Family screens read the other modules only through their own parsers, loaders and expander', () => {
    const imports = (name: string) => [...code(one(name)).matchAll(/from '(\.\.\/(?:calendar|tasks|projects)\/[^']+)'/g)].map((m) => m[1]).sort();
    expect(imports('memberSchedule.ts')).toEqual(['../calendar/data', '../calendar/layerVisibility', '../calendar/markerCoordination', '../calendar/model', '../calendar/occurrences', '../calendar/time']);
    expect(imports('memberWork.ts')).toEqual(['../projects/data', '../projects/model', '../tasks/model', '../tasks/model', '../tasks/views']);
    expect(imports('MemberSections.tsx')).toEqual(['../calendar/time', '../calendar/useCalendarData']);
    expect(code(one('MemberSections.tsx')).match(/import \{[^}]*\} from '..\/calendar\/useCalendarData'/)![0]).toMatch(/\{ readVisibility \}/);
  });
});

describe('what may be written', () => {
  it('the association writer touches moduleRecords and (for a new contact) contacts, and nothing else', () => {
    const t = code(one('importantContactData.ts'));
    expect(t).not.toMatch(/d\.(txns|accounts|budgets|recurring|holdings|links|attachments|dueItems|tags)\b|calendar\/data|tasks\/data|projects\/data|findOrCreateContact|updateContactDetails/);
    expect(t).toMatch(/createDistinctContact/);
  });
  it('no new Family file reaches Finance (its pages, engines, types or tables)', () => {
    const names = ['importantContactData.ts', 'importantContactModel.ts', 'memberSchedule.ts', 'memberWork.ts', 'MemberSections.tsx', 'ImportantContacts.tsx'];
    for (const n of names) expect(code(one(n)), n).not.toMatch(/from '\.\.\/\.\.\/(pages|lib\/(forecast|ledger|budget|schedule|postings|networth|txn)|types)|from '\.\.\/ledger|d\.(txns|accounts|budgets|recurring|holdings)\b/);
  });
  it('the stored association fields are exactly the documented ones; there is no display or sharing field', () => {
    const known = /const KNOWN = new Set\(\[([^\]]+)\]\)/.exec(code(one('importantContactModel.ts')))![1].replace(/'/g, '').split(',').map((x) => x.trim()).sort();
    expect(known).toEqual(['contactId', 'memberId', 'purpose', 'status']);
  });
  it('the Contact name, phone and email are never part of what is stored', () => {
    const t = code(one('importantContactModel.ts'));
    expect(t).not.toMatch(/\b(phone|email|name)\b\s*[:?]/);
  });
});

describe('registration and boundaries are unchanged', () => {
  registerModules();
  it('Family still contributes only its due provider and (C2) its read-only contact reader: no Today card, search source or Add-box destination', () => {
    const mod = allModules().find((m) => m.id === 'family')!;
    expect(Object.keys(mod.contributes ?? {})).toEqual(['dueProvider', 'contactReferences']);
    expect(allDueProviders().filter((p) => p.id === 'family')).toHaveLength(1);
    expect(allTodayCards().filter((c) => c.id.startsWith('family'))).toEqual([]);
    expect(allSearchSources().length).toBe(allModules().filter((m) => m.contributes?.searchSource).length);
    expect(allQuickAdds().filter((q) => /family|fam/i.test(q.id) || /^fam/.test(q.prefix))).toEqual([]);
  });
  it('the new screens are reached only from the lazily loaded member page, never from the registration', () => {
    const users = family.filter(({ text }) => /from '\.\/(MemberSections|ImportantContacts|memberSchedule|memberWork|importantContactData)'/.test(code(text))).map((x) => x.f).sort();
    // F4 adds the household overview (also lazily loaded, through OverviewPage), which reuses the same read-only readers.
    expect(users).toEqual(['src/modules/family/HouseholdSections.tsx', 'src/modules/family/ImportantContacts.tsx', 'src/modules/family/MemberPage.tsx', 'src/modules/family/MemberSections.tsx', 'src/modules/family/householdOverview.ts']);
    const idx = code(one('index.tsx')) + code(one('dueProvider.ts'));
    expect(idx).not.toMatch(/MemberSections|ImportantContacts|memberSchedule|memberWork|importantContact/);
  });
  it('Calendar, Tasks, Today and Projects still do not import Family', () => {
    for (const dir of ['calendar', 'tasks', 'today', 'projects']) {
      const bad = files(`src/modules/${dir}`).filter(({ text }) => /from '(\.\.\/)+(modules\/)?family(\/|')/.test(text) || /from '\.\.\/family(\/|')/.test(text));
      expect(bad.map((x) => x.f), dir).toEqual([]);
    }
  });
  it('the only change to the Calendar is exporting the preference reader it already had', () => {
    expect(read('src/modules/calendar/useCalendarData.ts')).toMatch(/export function readVisibility\(\): Visibility \{/);
  });
});
