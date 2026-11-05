import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FinanceDB } from '../db';
import { importAll } from '../lib/backup';
import { buildBackup, checkBackupText } from '../lib/backupFile';
import { GROUPS } from '../shell/nav';
import { listDueItems, publishDueItem, retractDueItem, syncDueItems } from './dueItems';
import type { DueItemInput } from './entities';
import { legacyTarget } from './legacy';
import { stripBasePath, withBasePath } from './paths';
import { getModule, lastModuleId, registerModule, rememberModule } from './registry';
import { createStore } from './store';

let n = 0;
const fresh = () => new FinanceDB(`test-core-${n++}`);
const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};

// ---- the Ledger page list, read straight from the source so the tests cannot drift from the app ----
const ledgerSrc = readFileSync('src/modules/ledger/LedgerModule.tsx', 'utf8');
const ROUTES = [...ledgerSrc.matchAll(/\['(\/[^']*)', </g)].map((m) => m[1]);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const sources = walk('src').filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f));
const matches = (pattern: string, path: string) => {
  const a = pattern.split('/'), b = path.split('/');
  return a.length === b.length && a.every((s, i) => s.startsWith(':') || s === b[i]);
};

describe('page addresses', () => {
  it('adds and removes the module prefix', () => {
    expect(withBasePath('/ledger', '/budget')).toBe('/ledger/budget');
    expect(withBasePath('/ledger', '/')).toBe('/ledger');
    expect(withBasePath('/ledger', '/transactions?q=abc')).toBe('/ledger/transactions?q=abc');
    expect(withBasePath('/ledger', '/ledger/budget')).toBe('/ledger/budget');
    expect(withBasePath('/ledger', '/settings')).toBe('/settings');
    expect(withBasePath('', '/budget')).toBe('/budget');
    expect(withBasePath('/ledger', 'https://example.com')).toBe('https://example.com');
    expect(stripBasePath('/ledger', '/ledger/budget')).toBe('/budget');
    expect(stripBasePath('/ledger', '/ledger')).toBe('/');
    expect(stripBasePath('/ledger', '/ledgerx')).toBe('/ledgerx');
  });

  it('finds every Ledger page in the source (32 pages)', () => {
    expect(ROUTES).toHaveLength(32);
    expect(ROUTES[0]).toBe('/');
  });

  it('every OLD address (all 32 pages, plus an account) redirects to the same page under /ledger, keeping ?search', () => {
    const mods = [{ id: 'ledger', routePaths: ROUTES }];
    for (const r of ROUTES.filter((x) => x !== '/')) {
      const concrete = r.replace(':id', '42');
      expect(legacyTarget(concrete, '', mods, 'ledger')).toBe(`/ledger${concrete}`);
      expect(legacyTarget(`${concrete}/`, '?q=a', mods, 'ledger')).toBe(`/ledger${concrete}?q=a`);
    }
    expect(legacyTarget('/', '', mods, 'ledger')).toBe('/ledger');
    expect(legacyTarget('/nowhere', '', mods, 'ledger')).toBe('/ledger');
  });

  it('every sidebar item points at a real page', () => {
    for (const g of GROUPS) for (const i of [...g.items, { to: g.to }]) expect(ROUTES.some((r) => matches(r, i.to.split('?')[0])), i.to).toBe(true);
  });

  it('every address written inside Ledger code (to: "/budget", Link to=...) points at a real page', () => {
    const bad: string[] = [];
    for (const f of sources) {
      if (f.includes('core') || f.endsWith('nav.ts') || f.endsWith('SettingsPage.tsx')) continue;
      const text = readFileSync(f, 'utf8');
      for (const m of text.matchAll(/\bto[:=]\s*\{?[`'"](\/[a-z][^`'"?$]*)/g)) {
        const path = m[1].endsWith('/') ? `${m[1]}1` : m[1]; // `/account/${id}` is read as /account/1
        if (path === '/settings') continue;
        if (!ROUTES.some((r) => matches(r, path))) bad.push(`${f}: ${m[1]}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('pages only get Link / NavLink / useNavigate / useLocation from the module router, never from react-router-dom', () => {
    const bad: string[] = [];
    for (const f of sources) {
      if (/src[\\/](core|main|App)/.test(f) || f.endsWith('LedgerModule.tsx') || f.endsWith('SettingsPage.tsx') || /shell[\\/](QuickAdd|SearchDialog|GlobalFrame)\.tsx$/.test(f)) continue; // Settings and the app-wide search and quick add are the shell's own, and live outside any module
      const text = readFileSync(f, 'utf8');
      for (const m of text.matchAll(/import\s*\{([^}]*)\}\s*from\s*'react-router-dom'/g)) {
        const names = m[1].split(',').map((s) => s.trim());
        for (const bannedName of ['Link', 'NavLink', 'useNavigate', 'useLocation', 'Navigate']) if (names.includes(bannedName)) bad.push(`${f}: ${bannedName}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe('module registry', () => {
  it('opens to the last module used, and ignores a module that no longer exists', () => {
    registerModule({ id: 'a-test', name: 'A', icon: null, Component: () => null, routePaths: ['/'], nav: [] });
    registerModule({ id: 'b-test', name: 'B', icon: null, Component: () => null, routePaths: ['/'], nav: [] });
    expect(() => registerModule({ id: 'a-test', name: 'dup', icon: null, Component: () => null, routePaths: [], nav: [] })).toThrow(/twice/);
    const s = mem();
    expect(lastModuleId(s)).toBe('a-test');
    rememberModule('b-test', s);
    expect(lastModuleId(s)).toBe('b-test');
    rememberModule('gone', s);
    expect(lastModuleId(s)).toBe('a-test');
    expect(getModule('b-test')?.name).toBe('B');
  });
});

describe('shared data store', () => {
  it('gives every record an id, createdAt and updatedAt, and edits keep createdAt', async () => {
    const s = createStore(fresh());
    const id = await s.shared.contacts.put({ name: 'Test Person', relationship: 'friend' });
    const a = (await s.shared.contacts.get(id))!;
    expect(a.id).toBe(id);
    expect(a.createdAt).toBeGreaterThan(0);
    expect(a.updatedAt).toBeGreaterThanOrEqual(a.createdAt);
    await new Promise((r) => setTimeout(r, 5));
    await s.shared.contacts.put({ id, name: 'Test Person', notes: 'hello' });
    const b = (await s.shared.contacts.get(id))!;
    expect(b.createdAt).toBe(a.createdAt);
    expect(b.updatedAt).toBeGreaterThan(a.updatedAt);
    expect(b.relationship).toBe('friend');
    expect(b.notes).toBe('hello');
  });

  it('soft-deletes: hidden from reads, kept in the table, and can be restored', async () => {
    const d = fresh();
    const s = createStore(d);
    const id = await s.shared.tags.put({ name: 'urgent' });
    await s.shared.tags.remove(id);
    expect(await s.shared.tags.get(id)).toBeUndefined();
    expect(await s.shared.tags.query()).toEqual([]);
    const raw = await d.tags.get(id);
    expect(raw?.deletedAt).toBeGreaterThan(0);
    await s.shared.tags.restore(id);
    expect((await s.shared.tags.get(id))?.name).toBe('urgent');
  });

  it('queries and tells you when something changes', async () => {
    const s = createStore(fresh());
    await s.shared.tags.put({ name: 'a' });
    await s.shared.tags.put({ name: 'b' });
    expect((await s.shared.tags.query((t) => t.name === 'b')).map((t) => t.name)).toEqual(['b']);
    const seen: number[] = [];
    const stop = s.shared.tags.watch((rows) => seen.push(rows.length));
    await new Promise((r) => setTimeout(r, 50));
    await s.shared.tags.put({ name: 'c' });
    await new Promise((r) => setTimeout(r, 100));
    stop();
    expect(seen[0]).toBe(2);
    expect(seen[seen.length - 1]).toBe(3);
  });

  it('links records across modules and finds everything linked to one, in either direction', async () => {
    const s = createStore(fresh());
    const txn = { module: 'ledger', id: 123 };
    const person = { module: 'shared', id: 7 };
    const task = { module: 'tasks', id: 'task-9' };
    await s.shared.links.add(txn, person, 'paid-to');
    const again = await s.shared.links.add(txn, person, 'paid-to');
    await s.shared.links.add(task, txn, 'about');
    const forTxn = await s.shared.links.linkedTo(txn);
    expect(forTxn).toHaveLength(2);
    expect((await s.shared.links.linkedTo(person)).map((l) => l.id)).toEqual([again]);
    expect(await s.shared.links.linkedTo({ module: 'ledger', id: 999 })).toEqual([]);
    await s.shared.links.remove(again);
    expect(await s.shared.links.linkedTo(person)).toEqual([]);
  });

  it('keeps each module’s records in its own namespace', async () => {
    const s = createStore(fresh());
    const cal = s.moduleStore('calendar');
    const tasks = s.moduleStore('tasks');
    const id = await cal.put('event', { title: 'Dentist' });
    expect((await cal.query('event')).map((r) => r.data.title)).toEqual(['Dentist']);
    expect(await tasks.query()).toEqual([]);
    expect(await tasks.get(id)).toBeUndefined();
    await tasks.remove(id); // not its record: ignored
    expect(await cal.get(id)).toBeDefined();
    await cal.remove(id);
    expect(await cal.get(id)).toBeUndefined();
  });
});

describe('due items', () => {
  const item = (over: Partial<DueItemInput> = {}): DueItemInput => ({
    sourceModule: 'ledger', sourceRecordId: 5, title: 'Rent', date: '2026-12-01', allDay: true, priority: 'high', status: 'open', tagIds: [], ...over,
  });

  it('publishing twice updates one item; retracting removes it', async () => {
    const d = fresh();
    const a = await publishDueItem(item(), d);
    const b = await publishDueItem(item({ title: 'Rent (new)', date: '2026-12-02' }), d);
    expect(b).toBe(a);
    const all = await listDueItems({}, d);
    expect(all).toHaveLength(1);
    expect(all[0].title).toBe('Rent (new)');
    expect(await retractDueItem('ledger', 5, d)).toBe(true);
    expect(await listDueItems({}, d)).toEqual([]);
    expect(await retractDueItem('ledger', 5, d)).toBe(false);
    expect((await d.dueItems.get(a))?.deletedAt).toBeGreaterThan(0); // kept as a marker so the removal can sync
  });

  it('lists by date range and module, soonest first, and rejects bad input', async () => {
    const d = fresh();
    await publishDueItem(item({ sourceRecordId: 1, date: '2026-12-10' }), d);
    await publishDueItem(item({ sourceRecordId: 2, date: '2026-12-01' }), d);
    await publishDueItem(item({ sourceModule: 'tasks', sourceRecordId: 'x', date: '2026-12-05', priority: 'reminder' }), d);
    expect((await listDueItems({}, d)).map((i) => i.date)).toEqual(['2026-12-01', '2026-12-05', '2026-12-10']);
    expect((await listDueItems({ from: '2026-12-02', to: '2026-12-09' }, d)).map((i) => i.sourceModule)).toEqual(['tasks']);
    expect(await listDueItems({ sourceModule: 'ledger' }, d)).toHaveLength(2);
    await expect(publishDueItem(item({ date: 'tomorrow' }), d)).rejects.toThrow(/due item needs/);
  });

  it('syncDueItems retracts what a module no longer lists and refuses another module’s items', async () => {
    const d = fresh();
    await syncDueItems('ledger', [item({ sourceRecordId: 1 }), item({ sourceRecordId: 2 })], d);
    await syncDueItems('ledger', [item({ sourceRecordId: 2 })], d);
    expect((await listDueItems({}, d)).map((i) => i.sourceRecordId)).toEqual([2]);
    await expect(syncDueItems('ledger', [item({ sourceModule: 'tasks' })], d)).rejects.toThrow(/own due items/);
  });
});

describe('backup includes the shared data', () => {
  it('round-trips contacts, tags, links, due items and module records', async () => {
    const d = fresh();
    const s = createStore(d);
    await s.shared.contacts.put({ name: 'Test Person' });
    const tag = await s.shared.tags.put({ name: 'x' });
    await s.shared.tags.remove(tag); // deleted markers travel too
    await s.shared.links.add({ module: 'ledger', id: 1 }, { module: 'shared', id: 2 }, 'about');
    await publishDueItem({ sourceModule: 'ledger', sourceRecordId: 1, title: 'T', date: '2026-01-01', allDay: true, priority: 'low', status: 'open', tagIds: [] }, d);
    await s.moduleStore('calendar').put('event', { title: 'E' });
    const { file } = checkBackupText(JSON.stringify(await buildBackup(d, mem() as never)));
    const d2 = fresh();
    await importAll(d2, file);
    expect(await d2.contacts.count()).toBe(1);
    expect(await d2.tags.count()).toBe(1);
    expect((await d2.tags.toArray())[0].deletedAt).toBeGreaterThan(0);
    expect(await d2.links.count()).toBe(1);
    expect(await d2.dueItems.count()).toBe(1);
    expect(await d2.moduleRecords.count()).toBe(1);
  });

  it('an older (data version 14) file still restores, with the new tables empty', async () => {
    const old = { version: 14, exportedAt: '2026-11-01T00:00:00Z', accounts: [{ id: 1, name: 'Test', kind: 'checking' }], categoryGroups: [], categories: [], txns: [], importBatches: [] };
    const { file, summary } = checkBackupText(JSON.stringify(old));
    expect(summary.fromVersion).toBe(14);
    const d = fresh();
    await importAll(d, file);
    expect(await d.accounts.count()).toBe(1);
    expect(await d.contacts.count()).toBe(0);
  });
});
