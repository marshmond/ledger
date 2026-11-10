import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { allDueProviders } from '../core/dueProvider';
import { allModules, allQuickAdds, allSearchSources, allTodayCards, allTxnReferenceProviders } from '../core/registry';
import { registerModules } from './index';
import { LEDGER_ROUTES } from './ledger/LedgerModule';
import { LEDGER_ROUTE_PATHS } from './ledger/routePaths';

/**
 * ST-S4. A module's SCREENS load on demand, but everything the rest of the app needs from a module before it is opened (its Today cards, search
 * source, Add-box destinations, Calendar due provider, record source, Finance reference reader, address list) is registered at start-up.
 * These tests pin both halves: the registration is complete without opening any module, and no start-up code can drag the screens back in.
 */

const SRC = resolve('src');
const FILE_EXT = ['.ts', '.tsx', '/index.ts', '/index.tsx'];

/** The files a file imports STATICALLY (import ... from, export ... from, import 'x'), not `import('x')`, which is the on-demand kind. */
function staticImports(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  const out: string[] = [];
  for (const m of text.matchAll(/(?:^|\n)\s*(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\sfrom\s+)?['"](\.{1,2}\/[^'"]+)['"]/g)) {
    const base = resolve(dirname(file), m[1]);
    const hit = [base, ...FILE_EXT.map((e) => base + e)].find((p) => existsSync(p) && /\.(ts|tsx)$/.test(p));
    if (hit && !/\.(css)$/.test(m[1])) out.push(hit);
  }
  return out;
}
function closure(entry: string): Set<string> {
  const seen = new Set<string>();
  const todo = [entry];
  while (todo.length) {
    const f = todo.pop()!;
    if (seen.has(f)) continue;
    seen.add(f);
    todo.push(...staticImports(f));
  }
  return seen;
}
const rel = (f: string) => f.slice(SRC.length + 1).replace(/\\/g, '/');

describe('what the first download is allowed to contain', () => {
  const start = closure(join(SRC, 'main.tsx'));
  const files = [...start].map(rel);

  it('the start-up code reaches the registrations of every module', () => {
    for (const m of ['today', 'ledger', 'calendar', 'tasks', 'projects', 'assets', 'services', 'bills', 'household', 'family', 'contacts']) {
      expect(files, m).toContain(`modules/${m}/index.tsx`);
    }
  });

  it('but not the screens of any module that loads on demand, nor Settings', () => {
    const screens = files.filter((f) => /^modules\/[a-z]+\/[A-Za-z]+Module\.tsx$/.test(f) && f !== 'modules/today/TodayModule.tsx');
    expect(screens).toEqual([]);
    expect(files).not.toContain('pages/SettingsPage.tsx');
  });

  it('and none of Ledger\'s own pages, which are most of the weight', () => {
    const pages = files.filter((f) => /^pages\/[A-Za-z]+Page\.tsx$/.test(f));
    expect(pages).toEqual([]);
  });

  it('Today stays in the first download: it is where the app opens, and it needs no second request', () => {
    expect(files).toContain('modules/today/TodayModule.tsx');
  });
});

describe('every module is registered, with its background contributions, without any screen being opened', () => {
  registerModules();

  it('all eleven modules, Today first, each with the address list the old-bookmark redirect needs', () => {
    expect(allModules().map((m) => m.id)).toEqual(['today', 'ledger', 'calendar', 'tasks', 'projects', 'assets', 'services', 'bills', 'household', 'family', 'contacts']);
    for (const m of allModules()) expect(m.routePaths.length, m.id).toBeGreaterThan(0);
  });

  it('Ledger\'s address list is exactly the pages its screens serve (so a bookmark such as #/budget still finds Ledger)', () => {
    expect([...LEDGER_ROUTE_PATHS]).toEqual(LEDGER_ROUTES.map(([p]) => p));
    expect(allModules().find((m) => m.id === 'ledger')!.routePaths).toEqual([...LEDGER_ROUTE_PATHS]);
  });

  it('Today cards from every module that offers one', () => {
    const ids = allTodayCards().map((c) => c.id);
    for (const id of ['today.agenda', 'ledger.attention', 'projects.attention', 'assets.attention', 'services.attention', 'bills.attention', 'household.attention']) expect(ids).toContain(id);
  });

  it('search sources, so search answers before any module is visited', () => {
    expect(allSearchSources().map((s) => s.moduleId).sort()).toEqual(['assets', 'bills', 'calendar', 'contacts', 'family', 'household', 'ledger', 'projects', 'services', 'tasks', 'today']);
  });

  it('Add-box destinations, so the Add box works before any module is visited', () => {
    const ids = allQuickAdds().map((q) => q.id);
    for (const id of ['task', 'event', 'transaction', 'scheduled', 'asset', 'bills-obligation', 'household-service']) expect(ids).toContain(id);
  });

  it('Calendar due providers, so Today and the Calendar show every module\'s dated items on the first draw', () => {
    expect(allDueProviders().map((p) => p.id).sort()).toEqual(['assets', 'bills', 'family', 'ledger', 'projects', 'services', 'tasks']);
  });

  it('Finance\'s reference readers, so deleting a payment checks Bills, Services, Assets and Projects before any of them is opened', () => {
    expect(allTxnReferenceProviders().length).toBe(5); // Ledger, Projects, Home & Assets, Household Services, Bills
  });

  it('record sources, so a Task can link to a bill or an asset before that module is opened', () => {
    for (const id of ['ledger', 'calendar', 'tasks', 'projects', 'assets', 'services', 'bills']) expect(allModules().find((m) => m.id === id)!.contributes?.records, id).toBeTruthy();
  });

  it('registering twice does nothing (the lazy wrapper cannot cause a second registration)', () => {
    const before = allModules().length;
    registerModules();
    expect(allModules().length).toBe(before);
  });
});
