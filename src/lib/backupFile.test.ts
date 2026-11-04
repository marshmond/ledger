import { describe, expect, it } from 'vitest';
import { FinanceDB } from '../db';
import { importAll } from './backup';
import {
  APP_VERSION, BackupFileError, CURRENT_SCHEMA_VERSION, applyPreferences, buildBackup, checkBackupText, collectPreferences, daysBetween, fileName,
  localDay, nextFileName, readMeta, recordBackup, writeMeta,
} from './backupFile';

const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
};
let n = 0;
const fresh = () => new FinanceDB(`test-backupfile-${n++}`);

describe('plain backup files', () => {
  it('schema version matches the newest database version', () => {
    expect(new FinanceDB(`test-ver-${n++}`).verno).toBe(CURRENT_SCHEMA_VERSION);
  });

  it('names files MM-DD-YY with _2, _3 for the same day, and starts over on a new day', () => {
    const s = mem();
    const day1 = new Date(2026, 10, 4, 9, 0);
    expect(nextFileName('backup', day1, s).name).toBe('Ledger Backup 11-04-26.json');
    writeMeta({ counts: { backup: { day: '2026-11-04', n: 1 } } }, s);
    expect(nextFileName('backup', day1, s).name).toBe('Ledger Backup 11-04-26_2.json');
    writeMeta({ counts: { backup: { day: '2026-11-04', n: 2 } } }, s);
    expect(nextFileName('backup', day1, s).name).toBe('Ledger Backup 11-04-26_3.json');
    expect(nextFileName('backup', new Date(2026, 10, 5, 0, 5), s).name).toBe('Ledger Backup 11-05-26.json');
    // pre-import copies are counted separately
    expect(nextFileName('preimport', day1, s).name).toBe('Ledger Pre-Import 11-04-26.json');
    expect(fileName('preimport', '2026-01-02', 2)).toBe('Ledger Pre-Import 01-02-26_2.json');
  });

  it('uses the local date, not UTC', () => {
    expect(localDay(new Date(2026, 10, 4, 23, 30))).toBe('2026-11-04');
  });

  it('counts calendar days', () => {
    expect(daysBetween('2026-10-24', '2026-11-04')).toBe(11);
    expect(daysBetween('2026-10-25', '2026-11-04')).toBe(10);
    expect(daysBetween('2026-12-28', '2027-01-02')).toBe(5);
  });

  it('records the last backup', () => {
    const s = mem();
    expect(readMeta(s).lastBackupAt).toBeUndefined();
    recordBackup(new Date('2026-11-04T10:00:00Z'), s);
    expect(readMeta(s).lastBackupAt).toBe('2026-11-04T10:00:00.000Z');
  });

  it('exports with version fields and preferences, never secrets', async () => {
    const d = fresh();
    await d.accounts.add({ name: 'Test checking', kind: 'checking' } as never);
    await d.settings.put({ key: 'priceApiKey', value: 'SECRET' });
    const s = mem();
    s.setItem('ledger-theme', 'dark');
    s.setItem('ledger-sync-config', '{"token":"SECRET"}');
    s.setItem('ledger-autobackup', '{"passphrase":"SECRET"}');
    const b = await buildBackup(d, s);
    expect(b.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(b.appVersion).toBe(APP_VERSION);
    expect(Date.parse(b.exportedAt)).not.toBeNaN();
    expect(b.preferences).toEqual({ 'ledger-theme': 'dark' });
    expect(JSON.stringify(b)).not.toContain('SECRET');
  });

  it('round-trips through the checker and a restore, and restores preferences', async () => {
    const d = fresh();
    await d.accounts.add({ name: 'Test checking', kind: 'checking' } as never);
    const s = mem();
    s.setItem('ledger-theme', 'dark');
    const text = JSON.stringify(await buildBackup(d, s));
    const { file, summary } = checkBackupText(text);
    expect(summary.counts.find((c) => c.label === 'Accounts')?.n).toBe(1);
    const d2 = fresh();
    await importAll(d2, file);
    expect(await d2.accounts.count()).toBe(1);
    const t = mem();
    applyPreferences((file as unknown as { preferences: unknown }).preferences, t);
    expect(t.getItem('ledger-theme')).toBe('dark');
    expect(collectPreferences(t)).toEqual({ 'ledger-theme': 'dark' });
  });

  it('upgrades an older file (no schemaVersion, missing sections)', () => {
    const old = { version: 3, exportedAt: '2025-01-01T00:00:00Z', accounts: [], categoryGroups: [], categories: [], txns: [], importBatches: [] };
    const { file, summary } = checkBackupText(JSON.stringify(old));
    expect(summary.fromVersion).toBe(3);
    expect(file.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(file.rsuGrants).toEqual([]);
  });

  it('refuses newer, non-Ledger, damaged and encrypted files with a clear message', () => {
    const base = { exportedAt: 'x', accounts: [], categoryGroups: [], categories: [], txns: [], importBatches: [] };
    expect(() => checkBackupText(JSON.stringify({ ...base, schemaVersion: 99 }))).toThrow(/newer version/);
    expect(() => checkBackupText('not json {')).toThrow(/not valid JSON/);
    expect(() => checkBackupText('[1,2]')).toThrow(BackupFileError);
    expect(() => checkBackupText(JSON.stringify({ hello: 'world' }))).toThrow(/does not look like a Ledger backup/);
    expect(() => checkBackupText(JSON.stringify({ ...base, version: 14, txns: 'oops' }))).toThrow(/missing: txns/);
    expect(() => checkBackupText(JSON.stringify({ ...base, version: 14, goals: 5 }))).toThrow(/damaged/);
    expect(() => checkBackupText(JSON.stringify({ v: 1, salt: 'a', iv: 'b', data: 'c' }))).toThrow(/ENCRYPTED/);
  });

  it('a failed restore leaves existing data untouched', async () => {
    const d = fresh();
    await d.accounts.add({ id: 1, name: 'Keep me', kind: 'checking' } as never);
    const bad = { version: 14, exportedAt: 'x', accounts: [{ id: 5, name: 'A' }, { id: 5, name: 'dup' }], categoryGroups: [], categories: [], txns: [], importBatches: [] };
    await expect(importAll(d, checkBackupText(JSON.stringify(bad)).file)).rejects.toThrow();
    expect((await d.accounts.toArray()).map((a) => a.name)).toEqual(['Keep me']);
  });
});
