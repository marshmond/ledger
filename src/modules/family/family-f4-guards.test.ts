import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FinanceDB } from '../../db';
import { registerModules } from '../index';
import { allDueProviders } from '../../core/dueProvider';
import { allModules, allQuickAdds, allSearchSources, allTodayCards } from '../../core/registry';

/** F4 guard tests: the overview is a read-only aggregation. It writes nothing, stores nothing, reads no Finance table and no Contact detail beyond a name. */
const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
const files = (dir: string) => walk(dir).filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f)).map((f) => ({ f: f.replace(/\\/g, '/'), text: readFileSync(f, 'utf8') }));
const family = files('src/modules/family');
const one = (name: string) => family.find((x) => x.f.endsWith(`/${name}`))!.text;
const code = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const WRITES = /\.(add|put|bulkAdd|bulkPut|update|delete|bulkDelete|clear|modify|remove|restore)\(|\.transaction\(|createStore|repo\(|localStorage|sessionStorage|fetch\(|XMLHttpRequest|console\./;
const NEW = ['householdOverview.ts', 'HouseholdSections.tsx'];

describe('the overview reads and never writes', () => {
  it.each(NEW)('%s has no write, transaction, storage, network or logging', (name) => {
    expect(code(one(name))).not.toMatch(WRITES);
  });
  it('the overview page itself writes only through the existing add-member form; it stores nothing (the filter lives in the page, not in storage)', () => {
    const t = code(one('OverviewPage.tsx'));
    expect(t).not.toMatch(WRITES);
    expect(t).toMatch(/useState<number \| null>\(null\)/);
    expect(t).not.toMatch(/setMe|setMemberStatus|setBirthdayOnCalendar|createMember|completeTask|saveTask/);
  });
  it('the aggregation takes no clock: today is always passed in', () => {
    expect(code(one('householdOverview.ts'))).not.toMatch(/Date\.now|new Date|todayISO/);
  });
  it('the section screen offers no completion or edit of a Task, event or Contact', () => {
    const t = code(one('HouseholdSections.tsx'));
    expect(t).not.toMatch(/completeTask|saveTask|createTask|createEvent|saveEdit|removeOccurrence|findOrCreateContact|updateContactDetails/);
    expect(t).not.toMatch(/<input|<textarea|type="checkbox"/);
  });
});

describe('what it may read', () => {
  it('reaches Calendar and Tasks only through their own parsers, expander and ordering rules', () => {
    const imports = (name: string) => [...code(one(name)).matchAll(/from '(\.\.\/(?:calendar|tasks|projects)\/[^']+)'/g)].map((m) => m[1]).sort();
    expect(imports('householdOverview.ts')).toEqual(['../calendar/data', '../calendar/layerVisibility', '../calendar/model', '../calendar/occurrences', '../tasks/model', '../tasks/views']);
    expect(imports('HouseholdSections.tsx')).toEqual(['../calendar/time']);
    expect(code(one('OverviewPage.tsx')).match(/import \{[^}]*\} from '..\/calendar\/useCalendarData'/)![0]).toMatch(/\{ readVisibility \}/);
  });
  it('no new file reaches Finance (its pages, engines, types or tables)', () => {
    for (const n of NEW) expect(code(one(n)), n).not.toMatch(/from '\.\.\/\.\.\/(pages|lib\/(forecast|ledger|budget|schedule|postings|networth|txn)|types)|from '\.\.\/ledger|d\.(txns|accounts|budgets|recurring|holdings)\b/);
  });
  it('of a Contact it reads the name and nothing else; it never reads a member\'s private note', () => {
    const t = code(one('householdOverview.ts'));
    expect(t).toMatch(/d\.contacts\.bulkGet\(ids\)/);
    expect(t).not.toMatch(/\.(phone|email|notes|relationship)\b/);
    for (const n of [...NEW, 'OverviewPage.tsx']) expect(code(one(n)), n).not.toMatch(/\.note\b/);
  });
  it('the Contact\'s phone, email and notes would not appear even if present: nothing in the overview types carries them', () => {
    const t = code(one('householdOverview.ts'));
    const iface = /export interface PersonRef \{[^}]*\}/.exec(t)![0] + /export interface HouseholdPerson \{[^}]*\}/.exec(t)![0];
    expect(iface).not.toMatch(/phone|email|notes?\b/);
  });
});

describe('nothing structural changed', () => {
  registerModules();
  it('no new table or migration: the database is still version 15, and F4 adds no table named for Family', () => {
    const db = new FinanceDB('test-family-f4-guard');
    expect(db.verno).toBe(15);
    expect(db.tables.map((t) => t.name).filter((n) => /family|household/i.test(n))).toEqual([]);
  });
  it('registration: the due provider, the contact reader and (F5) the search source and two Add-box destinations; still no Today card', () => {
    const mod = allModules().find((m) => m.id === 'family')!;
    expect(Object.keys(mod.contributes ?? {})).toEqual(['dueProvider', 'contactReferences', 'searchSource', 'quickAdd']);
    expect(allDueProviders().filter((p) => p.id === 'family')).toHaveLength(1);
    expect(allTodayCards().filter((c) => c.id.startsWith('family'))).toEqual([]);
    expect(allSearchSources().filter((s) => s.moduleId === 'family')).toHaveLength(1);
    expect(allQuickAdds().filter((q) => q.moduleId === 'family').map((q) => q.id)).toEqual(['family-member', 'family-date']);
  });
  it('the overview code is reached only from the lazily loaded page, never from the registration or the due provider', () => {
    const users = family.filter(({ text }) => /from '\.\/(householdOverview|HouseholdSections)'/.test(code(text))).map((x) => x.f).sort();
    expect(users).toEqual(['src/modules/family/HouseholdSections.tsx', 'src/modules/family/OverviewPage.tsx']);
    expect(code(one('index.tsx')) + code(one('dueProvider.ts'))).not.toMatch(/householdOverview|HouseholdSections/);
  });
  it('the only edits to F3\'s readers are exports: no write path, no new import', () => {
    const sched = code(one('memberSchedule.ts'));
    const work = code(one('memberWork.ts'));
    expect(sched).toMatch(/export async function readEvents/);
    expect(sched).toMatch(/export function scheduleItemOf/);
    expect(work).toMatch(/export async function readTasks/);
    expect(sched).not.toMatch(WRITES);
    expect(work).not.toMatch(WRITES);
  });
  it('Calendar, Tasks, Today and Projects still do not import Family', () => {
    for (const dir of ['calendar', 'tasks', 'today', 'projects']) {
      const bad = files(`src/modules/${dir}`).filter(({ text }) => /from '(\.\.\/)+(modules\/)?family(\/|')/.test(text) || /from '\.\.\/family(\/|')/.test(text));
      expect(bad.map((x) => x.f), dir).toEqual([]);
    }
  });
});
