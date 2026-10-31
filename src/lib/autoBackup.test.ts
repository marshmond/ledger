import { describe, expect, it } from 'vitest';
import { FinanceDB } from '../db';
import { backupFileDay, backupFileName, runAutoBackup } from './autoBackup';
import { decryptText } from './backup';
import { githubBackups, type BackupStore } from './sync/github';

/** An in-memory stand-in for the repository's backups folder. */
function fakeStore(initial: string[] = []) {
  const files = new Map<string, string>(initial.map((n) => [n, 'old']));
  const store: BackupStore = {
    list: async () => [...files.keys()].map((name) => ({ name, sha: `sha-${name}` })),
    add: async (name, text) => {
      if (files.has(name)) return false;
      files.set(name, text);
      return true;
    },
    remove: async (name) => {
      files.delete(name);
    },
  };
  return { store, files };
}

const named = (day: string) => backupFileName(day);

describe('automatic weekly backup', () => {
  it('names files by day and ignores anything else in the folder', () => {
    expect(backupFileDay('ledger-2026-10-30.ledgerbackup')).toBe('2026-10-30');
    expect(backupFileDay('README.md')).toBeNull();
  });

  it('makes the first backup, encrypted so only the passphrase opens it', async () => {
    const d = new FinanceDB('autobackup-first');
    await d.accounts.add({ name: 'Invented Checking', kind: 'checking', openingBalanceCents: 4200, openingDate: '2026-01-01' });
    const { store, files } = fakeStore();
    const r = await runAutoBackup(d, store, 'a long test passphrase', new Date('2026-10-30T12:00:00Z'));
    expect(r).toMatchObject({ outcome: 'made', newestDay: '2026-10-30', deleted: [] });
    const text = files.get(named('2026-10-30'))!;
    expect(text).not.toContain('Invented Checking');
    expect(JSON.parse(await decryptText(text, 'a long test passphrase')).accounts[0].name).toBe('Invented Checking');
    await expect(decryptText(text, 'some other passphrase')).rejects.toThrow(/Wrong passphrase/);
  });

  it('does nothing while the newest copy is under a week old, and backs up again after', async () => {
    const d = new FinanceDB('autobackup-weekly');
    const { store, files } = fakeStore([named('2026-10-24')]);
    expect((await runAutoBackup(d, store, 'a long test passphrase', new Date('2026-10-30T09:00:00Z'))).outcome).toBe('not-due');
    expect(files.size).toBe(1);
    expect((await runAutoBackup(d, store, 'a long test passphrase', new Date('2026-10-31T09:00:00Z'))).outcome).toBe('made');
    expect(files.size).toBe(2);
  });

  it('"back up now" works at any time, and twice in a day does not duplicate or fail', async () => {
    const d = new FinanceDB('autobackup-force');
    const { store, files } = fakeStore([named('2026-10-30')]);
    const r = await runAutoBackup(d, store, 'a long test passphrase', new Date('2026-10-30T20:00:00Z'), { force: true });
    expect(r.outcome).toBe('made');
    expect(files.size).toBe(1);
  });

  it('keeps the newest eight and removes older ones, leaving other files alone', async () => {
    const d = new FinanceDB('autobackup-trim');
    const days = ['2026-08-01', '2026-08-08', '2026-08-15', '2026-08-22', '2026-08-29', '2026-09-05', '2026-09-12', '2026-09-19', '2026-09-26'];
    const { store, files } = fakeStore([...days.map(named), 'notes.txt']);
    const r = await runAutoBackup(d, store, 'a long test passphrase', new Date('2026-10-30T12:00:00Z'));
    // nine old copies plus today's makes ten; the two oldest go
    expect(r.deleted).toEqual([named('2026-08-01'), named('2026-08-08')]);
    expect([...files.keys()].filter((n) => backupFileDay(n))).toHaveLength(8);
    expect(files.has(named('2026-10-30'))).toBe(true);
    expect(files.has('notes.txt')).toBe(true);
  });

  it('a failed upload throws, so the caller can show the reason', async () => {
    const d = new FinanceDB('autobackup-fail');
    const { store } = fakeStore();
    store.add = async () => {
      throw new Error('GitHub did not accept the token.');
    };
    await expect(runAutoBackup(d, store, 'a long test passphrase')).rejects.toThrow(/token/);
  });
});

describe('the GitHub backups folder', () => {
  const cfg = { owner: 'o', repo: 'r', token: 't' };
  const reply = (status: number, body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status }));

  it('treats a missing folder as empty, and ignores sub-folders', async () => {
    expect(await githubBackups(cfg, (() => reply(404, { message: 'Not Found' })) as typeof fetch).list()).toEqual([]);
    const list = await githubBackups(cfg, (() => reply(200, [{ name: 'a.ledgerbackup', sha: 's1', type: 'file' }, { name: 'old', sha: 's2', type: 'dir' }])) as typeof fetch).list();
    expect(list).toEqual([{ name: 'a.ledgerbackup', sha: 's1' }]);
  });

  it('uploads into the backups folder (never the sync file) and reports a name clash as false', async () => {
    const seen: { url: string; method?: string }[] = [];
    const ok = (async (url: string, init?: RequestInit) => {
      seen.push({ url, method: init?.method });
      return new Response('{}', { status: 201 });
    }) as unknown as typeof fetch;
    expect(await githubBackups(cfg, ok).add('ledger-2026-10-30.ledgerbackup', 'x', 'm')).toBe(true);
    expect(seen[0]).toEqual({ url: 'https://api.github.com/repos/o/r/contents/backups/ledger-2026-10-30.ledgerbackup', method: 'PUT' });
    expect(await githubBackups(cfg, (() => reply(422, { message: 'sha wasn\'t supplied' })) as typeof fetch).add('n', 'x', 'm')).toBe(false);
  });

  it('a refused token is an error with a plain explanation', async () => {
    await expect(githubBackups(cfg, (() => reply(401, {})) as typeof fetch).add('n', 'x', 'm')).rejects.toThrow(/did not accept the token/);
  });
});
