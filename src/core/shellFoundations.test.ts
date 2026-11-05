import { describe, expect, it } from 'vitest';
import { FinanceDB } from '../db';
import { forecastLowForAlert } from '../lib/alerts';
import { PREFERENCE_KEYS, applyPreferences, collectPreferences } from '../lib/backupFile';
import { filterActions } from '../shell/searchActions';
import { legacyTarget } from './legacy';
import { allQuickAdds, allSearchSources, allTodayCards, registerModule, type ModuleDef, type TodayCardDef } from './registry';
import { DEFAULT_SHELL_SETTINGS, loadShellSettings, normalizeShellSettings, resolveLanding, saveShellSettings } from './shellSettings';

const Nothing = () => null;
const mod = (id: string, contributes?: ModuleDef['contributes']): ModuleDef => ({ id, name: id, icon: null, Component: Nothing, routePaths: ['/'], nav: [], contributes });
const card = (id: string, priority: number): TodayCardDef => ({ id, title: id, defaultWidth: 'half', priority, Component: Nothing });

describe('landing setting', () => {
  it('defaults to Today and survives junk', () => {
    expect(normalizeShellSettings(undefined)).toEqual(DEFAULT_SHELL_SETTINGS);
    expect(normalizeShellSettings({ landing: 42 })).toEqual(DEFAULT_SHELL_SETTINGS);
    expect(normalizeShellSettings({ landing: '../x' })).toEqual(DEFAULT_SHELL_SETTINGS);
    expect(normalizeShellSettings({ landing: 'tasks' }).landing).toBe('tasks');
  });
  it('saves and loads from the settings table', async () => {
    const d = new FinanceDB('test-shell-settings');
    expect((await loadShellSettings(d)).landing).toBe('today');
    await saveShellSettings({ landing: 'last' }, d);
    expect((await loadShellSettings(d)).landing).toBe('last');
  });
  const ids = ['today', 'ledger', 'calendar', 'tasks'];
  it('picks today, the last-used module, or a named module', () => {
    expect(resolveLanding('today', 'tasks', ids)).toBe('today');
    expect(resolveLanding('last', 'tasks', ids)).toBe('tasks');
    expect(resolveLanding('calendar', 'tasks', ids)).toBe('calendar');
  });
  it('never returns a module that does not exist', () => {
    expect(resolveLanding('gone', 'tasks', ids)).toBe('tasks');
    expect(resolveLanding('gone', 'also-gone', ids)).toBe('today');
    expect(resolveLanding('last', 'gone', ids)).toBe('today');
  });
});

describe('addresses with no module follow the landing module', () => {
  const mods = [
    { id: 'today', routePaths: ['/'] },
    { id: 'ledger', routePaths: ['/', '/budget', '/account/:id'] },
    { id: 'tasks', routePaths: ['/'] },
  ];
  it('opens the landing module for / and unknown addresses, keeping ?search', () => {
    expect(legacyTarget('/', '', mods, 'today')).toBe('/today');
    expect(legacyTarget('/', '?x=1', mods, 'tasks')).toBe('/tasks?x=1');
    expect(legacyTarget('/nowhere', '', mods, 'today')).toBe('/today');
    expect(legacyTarget('/nowhere/deep', '?q=a', mods, 'ledger')).toBe('/ledger?q=a');
  });
  it('old Ledger addresses still reach Ledger whatever the landing is', () => {
    expect(legacyTarget('/budget', '', mods, 'today')).toBe('/ledger/budget');
    expect(legacyTarget('/account/7/', '?a=1', mods, 'tasks')).toBe('/ledger/account/7?a=1');
  });
  it('a module whose only route is / never claims an old address', () => {
    expect(legacyTarget('/tasks-old', '', mods, 'ledger')).toBe('/ledger');
  });
  it('a landing module that is not registered falls back to the first one', () => {
    expect(legacyTarget('/', '', mods, 'removed')).toBe('/today');
  });
});

describe('module hooks', () => {
  it('collects Today cards in default-layout order', () => {
    const a = mod('hk-a', { todayCards: [card('hk-a.late', 20), card('hk-a.first', 5)] });
    const b = mod('hk-b', { todayCards: [card('hk-b.mid', 10)] });
    expect(allTodayCards([a, b]).map((c) => c.id)).toEqual(['hk-a.first', 'hk-b.mid', 'hk-a.late']);
    expect(allTodayCards([a, b])[0].moduleId).toBe('hk-a');
  });
  it('rejects a card id that does not start with its module id', () => {
    expect(() => registerModule(mod('hk-c', { todayCards: [card('other.card', 1)] }))).toThrow(/must start with/);
  });
  it('rejects a repeated card id', () => {
    registerModule(mod('hk-d', { todayCards: [card('hk-d.x', 1)] }));
    expect(() => registerModule(mod('hk-d2', { todayCards: [card('hk-d.x', 1)] }))).toThrow();
  });
  it('rejects two quick-add destinations with the same prefix', () => {
    const q = (id: string, prefix: string) => ({ id, label: id, prefix, parse: () => null, commit: async () => undefined });
    registerModule(mod('hk-e', { quickAdd: q('hk-task', 'ht') }));
    expect(() => registerModule(mod('hk-f', { quickAdd: q('hk-event', 'HT') }))).toThrow(/clashes/);
    expect(allQuickAdds().some((x) => x.id === 'hk-task' && x.moduleId === 'hk-e')).toBe(true);
  });
  it('a module can offer several quick-add destinations, and a whole-word alias counts as taken too', () => {
    const q = (id: string, prefix: string, aliases: string[] = []) => ({ id, label: id, prefix, aliases });
    registerModule(mod('hk-m', { quickAdd: [q('hk-m1', 'mm', ['mmword']), q('hk-m2', 'mn')] }));
    expect(allQuickAdds().filter((x) => x.moduleId === 'hk-m').map((x) => x.id)).toEqual(['hk-m1', 'hk-m2']);
    expect(() => registerModule(mod('hk-n', { quickAdd: q('hk-n1', 'nn', ['MMWORD']) }))).toThrow(/clashes/);
    expect(() => registerModule(mod('hk-o', { quickAdd: [q('hk-o1', 'oo'), q('hk-o2', 'oo')] }))).toThrow(/clashes/);
  });
  it('lists search sources with the module name', () => {
    const s = mod('hk-g', { searchSource: { search: () => [] } });
    expect(allSearchSources([s])).toEqual([{ moduleId: 'hk-g', moduleName: 'hk-g', source: s.contributes!.searchSource }]);
  });
  it('modules without hooks contribute nothing', () => {
    expect(allTodayCards([mod('hk-h')])).toEqual([]);
    expect(allSearchSources([mod('hk-h')])).toEqual([]);
    expect(allQuickAdds([mod('hk-h')])).toEqual([]);
  });
});

describe('search palette actions', () => {
  const actions = [
    { title: 'Add a transaction', words: 'add new transaction expense income spend log' },
    { title: 'Add a scheduled item', words: 'add new scheduled recurring bill' },
    { title: 'Import transactions', words: 'import csv bank upload' },
  ];
  it('splits the typed words on whitespace (not on the letter s)', () => {
    expect(filterActions('add sched', actions).map((a) => a.title)).toEqual(['Add a scheduled item']);
    expect(filterActions('new   transaction', actions).map((a) => a.title)).toEqual(['Add a transaction']);
    expect(filterActions('import\tcsv', actions).map((a) => a.title)).toEqual(['Import transactions']);
  });
  it('a word containing an s is no longer cut into pieces', () => {
    // Before the fix, "swordfish" was cut at every "s" into "word" + "fi" + "h", which matched by accident.
    expect(filterActions('swordfish', [{ title: 'Add a word', words: 'fi h' }])).toEqual([]);
  });
  it('empty text shows every action', () => {
    expect(filterActions('  ', actions)).toHaveLength(3);
  });
});

describe('the cash-may-drop alert', () => {
  const base = { today: '2026-11-04', thresholdCents: 100000, cashAccounts: 1, cashTxnCount: 0, forecastEventCount: 0 };
  it('does not fire for a cash account that is empty with no history and nothing scheduled', () => {
    expect(forecastLowForAlert({ ...base, firstBelow: { date: '2026-11-04', balanceCents: 0 } })).toBeNull();
  });
  it('does not fire without a cash account', () => {
    expect(forecastLowForAlert({ ...base, cashAccounts: 0, cashTxnCount: 9, firstBelow: { date: '2026-11-10', balanceCents: 0 } })).toBeNull();
  });
  it('still fires for a real shortfall from recorded history', () => {
    expect(forecastLowForAlert({ ...base, cashTxnCount: 12, firstBelow: { date: '2026-11-20', balanceCents: 30000 } }))
      .toEqual({ date: '2026-11-20', balanceCents: 30000, thresholdCents: 100000 });
  });
  it('still fires when scheduled items drive the balance under the level', () => {
    expect(forecastLowForAlert({ ...base, forecastEventCount: 3, firstBelow: { date: '2026-11-12', balanceCents: 50000 } })).not.toBeNull();
  });
  it('ignores a dip further than 90 days away, and no dip at all', () => {
    expect(forecastLowForAlert({ ...base, cashTxnCount: 5, firstBelow: { date: '2027-03-01', balanceCents: 0 } })).toBeNull();
    expect(forecastLowForAlert({ ...base, cashTxnCount: 5, firstBelow: null })).toBeNull();
    expect(forecastLowForAlert({ ...base, cashTxnCount: 5, firstBelow: { date: '2027-02-02', balanceCents: 0 } })).not.toBeNull(); // exactly day 90
  });
});

describe('Today preferences in the backup', () => {
  it('the per-device Today layout keys are backed up and restored', () => {
    expect(PREFERENCE_KEYS).toContain('today.layout.v1');
    expect(PREFERENCE_KEYS).toContain('today.hideAmounts.v1');
    const m = new Map<string, string>([['today.layout.v1', '{"order":["a"]}'], ['today.hideAmounts.v1', '1']]);
    const saved = collectPreferences({ getItem: (k: string) => m.get(k) ?? null });
    expect(saved).toEqual({ 'today.layout.v1': '{"order":["a"]}', 'today.hideAmounts.v1': '1' });
    const out = new Map<string, string>();
    applyPreferences(saved, { getItem: (k: string) => out.get(k) ?? null, setItem: (k: string, v: string) => void out.set(k, v) } as never);
    expect(out.get('today.layout.v1')).toBe('{"order":["a"]}');
  });
});
