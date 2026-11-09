import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { allDueProviders } from '../../core/dueProvider';
import { registerModules } from '../index';
import { FAMILY_ID } from '../calendar/model';
import * as calendarModel from '../calendar/model';

/** F2 guard tests: the provider is read-only and pure, loads no screens, adds no table, field or control for any shared display, and the Calendar never imports Family. */
const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
const read = (f: string) => readFileSync(f, 'utf8');
const files = (dir: string) => walk(dir).filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f)).map((f) => ({ f: f.replace(/\\/g, '/'), text: read(f) }));
const family = files('src/modules/family');
const one = (name: string) => family.find((x) => x.f.endsWith(`/${name}`))!.text;
const code = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('read-only and pure', () => {
  const WRITES = /\.(add|put|bulkAdd|bulkPut|update|delete|bulkDelete|clear|modify)\(|\.transaction\(|createStore|repo\(|localStorage|sessionStorage|fetch\(|XMLHttpRequest|console\./;
  it.each(['dueProvider.ts', 'upcoming.ts', 'calendarDates.ts', 'dateModel.ts'])('%s has no write, transaction, storage, network or logging', (name) => {
    expect(code(one(name))).not.toMatch(WRITES);
  });
  it('the pure files use no database, clock or Date object', () => {
    for (const name of ['upcoming.ts', 'calendarDates.ts', 'dateModel.ts']) {
      // the record reader's DEFAULT year (`new Date().getFullYear()`, as in F1's model) is the only clock read
      expect(code(one(name)).replace(/new Date\(\)\.getFullYear\(\)/g, ''), name).not.toMatch(/from '\.\.\/\.\.\/db'|Date\.now|new Date|todayISO/);
    }
    expect(code(one('dueProvider.ts'))).not.toMatch(/Date\.now|new Date|todayISO/); // "today" is always the one the caller passes in
  });
  it('the date writer touches only moduleRecords, and creates no Calendar event, Task or Contact', () => {
    const t = code(one('dateData.ts'));
    expect(t).not.toMatch(/d\.(contacts|txns|accounts|events|links|attachments)\b|calendar\/data|tasks\/data|projects\/data|createEvent|createTask|findOrCreateContact/);
    expect(t.match(/d\.moduleRecords\b/g)!.length).toBeGreaterThan(0);
  });
  it('no Family file reaches Finance (the F1 rule still holds for the new files)', () => {
    const bad = family.filter(({ text }) => /from '\.\.\/\.\.\/(pages|lib\/(forecast|ledger|budget|schedule|postings|networth|txn)|types)|from '\.\.\/ledger|d\.(txns|accounts|budgets|recurring|holdings)\b/.test(code(text)));
    expect(bad.map((x) => x.f)).toEqual([]);
  });
  it('Family reads the Calendar only through its data loader, the occurrence expander and the coordination key', () => {
    const imports = code(one('dueProvider.ts')).match(/from '\.\.\/calendar\/[^']+'/g)!.sort();
    expect(imports).toEqual(["from '../calendar/data'", "from '../calendar/markerCoordination'", "from '../calendar/model'", "from '../calendar/occurrences'"]);
  });
});

describe('screens stay on demand', () => {
  it('nothing the registration reaches imports a Family screen', () => {
    const local = (text: string) => [...code(text).matchAll(/from '\.\/([A-Za-z]+)'/g)].map((m) => m[1]);
    const seen = new Set<string>();
    const walkFrom = (name: string) => {
      if (seen.has(name)) return;
      seen.add(name);
      const f = family.find((x) => x.f.endsWith(`/${name}.ts`) || x.f.endsWith(`/${name}.tsx`));
      if (f) local(f.text).forEach(walkFrom);
    };
    walkFrom('index');
    // `index` itself reaches FamilyModule only through the lazy import()
    expect([...seen].filter((n) => /Page$|Form$|Module$/.test(n) && n !== 'index')).toEqual([]);
    expect(seen.has('dueProvider')).toBe(true);
  });
  it('the new screens are used only by the lazily loaded module file', () => {
    const users = family.filter(({ text }) => /from '\.\/(DatesPage|DateForm)'/.test(text)).map((x) => x.f).sort();
    expect(users).toEqual(['src/modules/family/DatesPage.tsx', 'src/modules/family/FamilyModule.tsx']);
  });
});

describe('the Calendar does not know Family', () => {
  it('no Calendar, Tasks, Today or Projects file imports Family', () => {
    for (const dir of ['calendar', 'tasks', 'today', 'projects']) {
      const bad = files(`src/modules/${dir}`).filter(({ text }) => /from '(\.\.\/)+(modules\/)?family(\/|')/.test(text) || /from '\.\.\/family(\/|')/.test(text));
      expect(bad.map((x) => x.f), dir).toEqual([]);
    }
  });
  it('the Family layer id is unique among the built-in layer ids and is not a test placeholder', () => {
    const ids = Object.entries(calendarModel).filter(([k, v]) => /_ID$/.test(k) && typeof v === 'number').map(([, v]) => v as number);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain(FAMILY_ID);
    const tests = walk('src').filter((f) => /\.test\.(ts|tsx)$/.test(f) && !f.includes('family-f2')).map((f) => read(f));
    const usedAsMadeUp = tests.filter((t) => /9_000_000_000_000_108/.test(t) && !/FAMILY_ID/.test(t));
    expect(usedAsMadeUp).toEqual([]);
  });
  it('the Calendar builds a stored event\'s list key with the one shared helper, and gives derived items their `source`', () => {
    const t = read('src/modules/calendar/useCalendarData.ts');
    expect(t).toMatch(/key: storedItemKey\(o\.eventId, o\.key\)/);
    expect(t).toMatch(/source: it,/);
  });
  it('exactly one provider named family is registered, once', () => {
    registerModules();
    expect(allDueProviders().filter((p) => p.id === 'family')).toHaveLength(1);
  });
});

describe('private by default, and no shared-display control', () => {
  it('no Family file stores, names or draws a display, sharing, publishing or tablet setting', () => {
    const bad = family.filter(({ f, text }) => !f.endsWith('/references.ts') && /\b(publish|tablet|commandStation|displayOn|showOnDisplay|sharedDisplay|shareWith)\b/i.test(code(text)));
    expect(bad.map((x) => x.f)).toEqual([]);
  });
  it('the stored date fields are exactly the documented ones; there is no display field', () => {
    const t = code(one('dateModel.ts'));
    const known = /const KNOWN = new Set\(\[([^\]]+)\]\)/.exec(t)![1].replace(/'/g, '').split(',').map((x) => x.trim()).sort();
    expect(known).toEqual(['dateKind', 'label', 'memberId', 'monthDay', 'onCalendar', 'status', 'year']);
  });
  it('the words on the screens say the Calendar switches reach the owner\'s own Calendar only', () => {
    expect(one('DateForm.tsx')).toMatch(/Your own Calendar and Today only\. It does not share the date/);
    expect(one('MemberForm.tsx')).toMatch(/Your own Calendar and Today only\. It does not share the birthday/);
  });
});
