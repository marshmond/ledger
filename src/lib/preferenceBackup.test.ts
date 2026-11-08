import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FinanceDB } from '../db';
import { PREFERENCE_KEYS, applyPreferences, buildBackup, checkBackupText, collectPreferences } from './backupFile';
import { allModules, getModule, lastModuleId, registerModule } from '../core/registry';
import { DEFAULT_UPCOMING_DAYS, loadUpcomingDays } from '../modules/services/upcomingWindow';

/** ST-S1 / BK-01: three more device preferences travel in a backup. They are choices (a window, a view, the last module), not financial records. All values invented. */

const memory = (init: Record<string, string> = {}) => {
  const m = new Map(Object.entries(init));
  return { map: m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};
const NEW_KEYS = ['services-upcoming-days', 'tasks-last-view', 'ledger-last-module'];

describe('BK-01 the three preferences are part of the backup', () => {
  it('they are on the approved list, and the list still holds no secret', () => {
    for (const k of NEW_KEYS) expect(PREFERENCE_KEYS).toContain(k);
    expect(PREFERENCE_KEYS.some((k) => /sync|passphrase|autobackup|token|apikey/i.test(k))).toBe(false);
    expect(new Set(PREFERENCE_KEYS).size).toBe(PREFERENCE_KEYS.length); // no duplicate entries
  });

  it('export carries them, and restore puts them back exactly, leaving unrelated keys alone', async () => {
    const d = new FinanceDB(`bk01-${Date.now()}`);
    await d.open();
    const here = memory({ 'services-upcoming-days': '90', 'tasks-last-view': 'upcoming', 'ledger-last-module': 'bills', 'ledger-theme': 'dark', 'some-other-site-key': 'keep out' });
    const built = await buildBackup(d, here);
    expect(built.preferences).toMatchObject({ 'services-upcoming-days': '90', 'tasks-last-view': 'upcoming', 'ledger-last-module': 'bills', 'ledger-theme': 'dark' });
    expect(built.preferences).not.toHaveProperty('some-other-site-key');
    const { file } = checkBackupText(JSON.stringify(built));
    const fresh = memory({ 'unrelated-setting': 'stays', 'ledger-theme': 'light' });
    applyPreferences((file as unknown as { preferences: unknown }).preferences, fresh);
    expect(fresh.map.get('services-upcoming-days')).toBe('90');
    expect(fresh.map.get('tasks-last-view')).toBe('upcoming');
    expect(fresh.map.get('ledger-last-module')).toBe('bills');
    expect(fresh.map.get('ledger-theme')).toBe('dark'); // an existing listed preference is replaced by the backup's, as before
    expect(fresh.map.get('unrelated-setting')).toBe('stays'); // anything not on the list is untouched
    expect(fresh.map.has('some-other-site-key')).toBe(false);
  });

  it('missing keys: a backup (or device) without them restores and collects cleanly, with nothing invented', () => {
    expect(collectPreferences(memory({ 'ledger-theme': 'dark' }))).toEqual({ 'ledger-theme': 'dark' });
    const s = memory({ 'services-upcoming-days': '14' });
    applyPreferences({ 'ledger-theme': 'light' }, s); // an older backup that never had the new keys
    expect(s.map.get('services-upcoming-days')).toBe('14'); // the device's own value is not wiped
    expect(s.map.get('ledger-theme')).toBe('light');
    applyPreferences(undefined, s);
    applyPreferences('nonsense', s);
    applyPreferences(null, s);
    expect(s.map.get('services-upcoming-days')).toBe('14');
  });

  it('invalid values (hand-edited file, or a value from another version) are restored as text but every reader falls back to its default', () => {
    const s = memory();
    applyPreferences({ 'services-upcoming-days': '9999', 'tasks-last-view': 'not-a-view', 'ledger-last-module': 'no-such-module', 'ledger-theme': 'dark', 'today.layout.v1': 5 }, s);
    expect(s.map.get('services-upcoming-days')).toBe('9999'); // stored as given: restore does not judge
    expect(s.map.has('today.layout.v1')).toBe(false); // non-text values are skipped
    expect(loadUpcomingDays(s)).toBe(DEFAULT_UPCOMING_DAYS); // the reader accepts only 7, 14, 30 or 90
    expect(loadUpcomingDays(memory({ 'services-upcoming-days': '14' }))).toBe(14);
    const first = allModules()[0] ?? (registerModule({ id: 'probe', name: 'Probe', icon: '?', routePaths: ['/probe'], nav: [], Component: () => null } as never), allModules()[0]);
    expect(getModule('no-such-module')).toBeUndefined();
    expect(lastModuleId(s)).toBe(first.id); // an unknown module id falls back to the first registered module, never an error
  });

  it('Tasks reads its saved view only through its own check (source guard: the page is not rendered in tests)', () => {
    const src = readFileSync('src/modules/tasks/TasksPage.tsx', 'utf8');
    expect(src).toMatch(/const isView = \(v: unknown\): v is ViewId => VIEWS\.some\(\(x\) => x\.id === v\);/);
    expect(src).toMatch(/return isView\(v\) \? v : 'today'/);
  });

  it('these are device choices, not synchronized data: the backup file carries them under "preferences", never inside a database table', async () => {
    const d = new FinanceDB(`bk01b-${Date.now()}`);
    await d.open();
    const built = await buildBackup(d, memory({ 'tasks-last-view': 'upcoming' }));
    expect(JSON.stringify(built.settings)).not.toMatch(/tasks-last-view/);
    expect(await d.settings.get('tasks-last-view')).toBeUndefined();
  });
});
