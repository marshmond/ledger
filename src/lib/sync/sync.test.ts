import { describe, expect, it } from 'vitest';
import { FinanceDB } from '../../db';
import { decodeSnapshot, encodeSnapshot } from './codec';
import { dexieMeta, RemoteConflict, SyncEngine, type RemoteFile, type RemoteStore } from './engine';
import { GhError, githubRemote, parseRepo } from './github';
import { emptySnapshot, mergeSnapshots, type Snapshot } from './merge';
import { installTracking, newId, touchAll } from './track';

let n = 0;
const uniq = () => `t${Date.now()}-${n++}`;
const snap = (tables: Snapshot['tables'], tombstones: Snapshot['tombstones'] = {}): Snapshot => ({ tables, tombstones });
const NOW = 1_000_000;

describe('merging records', () => {
  const base = {};
  it('adds records that are new on either side', () => {
    const m = mergeSnapshots({
      local: snap({ txns: { 1: { id: 1, updatedAt: 5 } } }),
      remote: snap({ txns: { 2: { id: 2, updatedAt: 6 } } }),
      base, lastSync: 0, now: NOW,
    });
    expect(Object.keys(m.merged.tables.txns)).toEqual(['1', '2']);
    expect(m.put.txns.map((r) => r.id)).toEqual([2]);
    expect(m.remoteChanged).toBe(true);
  });
  it('the later edit wins, and an edit on both sides since the last sync is reported', () => {
    const m = mergeSnapshots({
      local: snap({ accounts: { 1: { id: 1, name: 'Mine', updatedAt: 200 } } }),
      remote: snap({ accounts: { 1: { id: 1, name: 'Theirs', updatedAt: 300 } } }),
      base: { accounts: ['1'] }, lastSync: 100, now: NOW,
    });
    expect(m.merged.tables.accounts[1].name).toBe('Theirs');
    expect(m.conflicts).toEqual([{ table: 'accounts', id: '1', label: 'Mine', kept: 'other device', at: NOW, lost: { id: 1, name: 'Mine', updatedAt: 200 } }]);
    // only one side changed: no conflict
    const q = mergeSnapshots({
      local: snap({ accounts: { 1: { id: 1, name: 'Old', updatedAt: 50 } } }),
      remote: snap({ accounts: { 1: { id: 1, name: 'New', updatedAt: 300 } } }),
      base: { accounts: ['1'] }, lastSync: 100, now: NOW,
    });
    expect(q.conflicts).toEqual([]);
    expect(q.put.accounts[0].name).toBe('New');
  });
  it('a record deleted here is deleted there, and one deleted there is deleted here', () => {
    const a = mergeSnapshots({
      local: snap({ txns: {} }),
      remote: snap({ txns: { 1: { id: 1, updatedAt: 5 } } }),
      base: { txns: ['1'] }, lastSync: 10, now: NOW,
    });
    expect(a.merged.tables.txns).toEqual({});
    expect(a.merged.tombstones.txns[1]).toBe(NOW);
    expect(a.remoteChanged).toBe(true);
    const b = mergeSnapshots({
      local: snap({ txns: { 1: { id: 1, updatedAt: 5 } } }),
      remote: snap({ txns: {} }, { txns: { 1: 900_000 } }),
      base: { txns: ['1'] }, lastSync: 10, now: NOW,
    });
    expect(b.del.txns).toEqual(['1']);
  });
  it('an edit made after the deletion brings the record back', () => {
    const m = mergeSnapshots({
      local: snap({ txns: { 1: { id: 1, updatedAt: 950_000 } } }),
      remote: snap({ txns: {} }, { txns: { 1: 900_000 } }),
      base: { txns: ['1'] }, lastSync: 10, now: NOW,
    });
    expect(Object.keys(m.merged.tables.txns)).toEqual(['1']);
    expect(m.merged.tombstones.txns[1]).toBeUndefined();
  });
  it('a record with the same natural key made on two devices is collapsed to the newest', () => {
    const m = mergeSnapshots({
      local: snap({ netWorthSnapshots: { 11: { id: 11, date: '2026-10-01', updatedAt: 5 } } }),
      remote: snap({ netWorthSnapshots: { 22: { id: 22, date: '2026-10-01', updatedAt: 9 } } }),
      base: {}, lastSync: 0, now: NOW,
    });
    expect(Object.keys(m.merged.tables.netWorthSnapshots)).toEqual(['22']);
    expect(m.del.netWorthSnapshots).toEqual(['11']);
  });
  it('nothing to do when both sides are the same', () => {
    const s = snap({ txns: { 1: { id: 1, updatedAt: 5, memo: 'x' } } });
    const m = mergeSnapshots({ local: s, remote: structuredClone(s), base: { txns: ['1'] }, lastSync: 10, now: NOW });
    expect(m.remoteChanged).toBe(false);
    expect(m.put).toEqual({});
    expect(m.del).toEqual({});
  });
  it('forgets very old deletion markers', () => {
    const m = mergeSnapshots({ local: emptySnapshot(), remote: snap({}, { txns: { 1: 1 } }), base: {}, lastSync: 0, now: 400 * 86400000 });
    expect(m.merged.tombstones.txns).toEqual({});
  });
});

describe('change tracking', () => {
  it('stamps new and changed records, and gives new records ids that will not collide with another device', async () => {
    const d = new FinanceDB(uniq());
    installTracking(d);
    const a = await d.accounts.add({ name: 'A', kind: 'checking' } as never);
    const b = await d.accounts.add({ name: 'B', kind: 'checking' } as never);
    expect(a).toBeGreaterThan(1e15);
    expect(b).toBeGreaterThan(a);
    const stampOf = async () => ((await d.accounts.get(a)) as { updatedAt?: number }).updatedAt as number;
    const before = await stampOf();
    expect(before).toBeGreaterThan(0);
    await new Promise((r) => setTimeout(r, 5));
    await d.accounts.update(a, { name: 'A2' });
    expect(await stampOf()).toBeGreaterThan(before);
    await d.accounts.put({ ...(await d.accounts.get(a))!, name: 'A3' });
    expect((await d.accounts.get(a))!.name).toBe('A3');
    await d.settings.put({ key: 'x', value: 1 });
    expect(((await d.settings.get('x')) as { updatedAt?: number }).updatedAt).toBeGreaterThan(0);
    expect(newId()).toBeGreaterThan(b as number);
  });
  it('touchAll marks everything as changed now', async () => {
    const d = new FinanceDB(uniq());
    await d.accounts.add({ name: 'A', kind: 'checking' } as never);
    await touchAll(d);
    expect(((await d.accounts.toArray())[0] as { updatedAt?: number }).updatedAt).toBeGreaterThan(0);
  });
});

describe('the synced file', () => {
  it('round-trips and rejects a wrong passphrase', async () => {
    const s = snap({ txns: { 1: { id: 1, memo: 'café ☕', updatedAt: 3 } } }, { txns: { 2: 4 } });
    const bytes = await encodeSnapshot(s, 'correct horse');
    expect(new TextDecoder().decode(bytes)).not.toContain('café');
    expect(await decodeSnapshot(bytes, 'correct horse')).toEqual(s);
    await expect(decodeSnapshot(bytes, 'wrong')).rejects.toThrow(/Wrong sync passphrase/);
    await expect(decodeSnapshot(new Uint8Array(100), 'x')).rejects.toThrow(/not a Ledger sync file/);
  }, 30000);
});

function memoryRemote(): RemoteStore & { puts: number; file: RemoteFile | null } {
  const r = {
    puts: 0,
    file: null as RemoteFile | null,
    async getFile() {
      return r.file ? { sha: r.file.sha, bytes: r.file.bytes.slice() } : null;
    },
    async putFile(bytes: Uint8Array, sha: string | undefined, _msg: string) {
      if ((r.file?.sha ?? undefined) !== sha) throw new RemoteConflict('stale');
      r.puts++;
      r.file = { sha: `sha${r.puts}`, bytes: bytes.slice() };
      return r.file.sha;
    },
  };
  return r;
}

function device(remote: RemoteStore, pass = 'a good passphrase') {
  const d = new FinanceDB(uniq());
  installTracking(d);
  return { d, engine: new SyncEngine(d, dexieMeta(uniq()), remote, pass) };
}

describe('two devices', () => {
  it('start from one device, bring the second in, then changes flow both ways', async () => {
    const remote = memoryRemote();
    const A = device(remote);
    const B = device(remote);
    const acct = (await A.d.accounts.add({ name: 'Checking', kind: 'checking' } as never)) as number;
    await A.d.txns.add({ accountId: acct, date: '2026-10-01', amountCents: -500, payee: 'Coffee' } as never);
    await A.d.settings.put({ key: 'priceApiKey', value: 'secret' });
    await A.d.settings.put({ key: 'lastBackup', value: 'yesterday' });

    await A.engine.initialUpload();
    expect(remote.puts).toBe(1);
    await B.d.accounts.add({ name: 'Stale local', kind: 'savings' } as never);
    await B.d.settings.put({ key: 'priceApiKey', value: 'bs-own' });
    await B.engine.replaceFromRemote();
    expect((await B.d.accounts.toArray()).map((a) => a.name)).toEqual(['Checking']);
    expect(await B.d.settings.get('priceApiKey')).toMatchObject({ value: 'bs-own' }); // device-only setting kept, never sent
    expect(await B.d.settings.get('lastBackup')).toMatchObject({ value: 'yesterday' });
    expect(await A.d.settings.get('priceApiKey')).toMatchObject({ value: 'secret' });

    // B adds a transaction; A renames the account
    await B.d.txns.add({ accountId: acct, date: '2026-10-02', amountCents: -900, payee: 'Lunch' } as never);
    await A.d.accounts.update(acct, { name: 'Main checking' });
    const s1 = await B.engine.sync();
    expect(s1.pushed).toBe(true);
    const s2 = await A.engine.sync();
    expect(s2.pulled).toBe(1);
    await B.engine.sync();
    for (const x of [A, B]) {
      expect((await x.d.txns.toArray()).map((t) => t.payee).sort()).toEqual(['Coffee', 'Lunch']);
      expect((await x.d.accounts.get(acct))!.name).toBe('Main checking');
    }

    // a delete on A reaches B; a sync with nothing new sends nothing
    const coffee = (await A.d.txns.toArray()).find((t) => t.payee === 'Coffee')!;
    await A.d.txns.delete(coffee.id!);
    await A.engine.sync();
    const puts = remote.puts;
    const s3 = await B.engine.sync();
    expect(s3.removedHere).toBe(1);
    expect((await B.d.txns.toArray()).map((t) => t.payee)).toEqual(['Lunch']);
    await B.engine.sync();
    expect(remote.puts).toBe(puts);
    expect(await remote.getFile().then((f) => decodeSnapshot(f!.bytes, 'a good passphrase').then((s) => Object.keys(s.tables.settings)))).not.toContain('priceApiKey');
  }, 60000);

  it('when both change the same record, the later edit wins and it is reported', async () => {
    const remote = memoryRemote();
    const A = device(remote);
    const B = device(remote);
    const id = (await A.d.accounts.add({ name: 'Joint', kind: 'checking' } as never)) as number;
    await A.engine.initialUpload();
    await B.engine.replaceFromRemote();
    await B.d.accounts.update(id, { name: 'From phone' });
    await new Promise((r) => setTimeout(r, 5));
    await A.d.accounts.update(id, { name: 'From desktop' });
    await B.engine.sync();
    const sA = await A.engine.sync();
    expect((await A.d.accounts.get(id))!.name).toBe('From desktop');
    expect(sA.conflicts).toMatchObject([{ table: 'accounts', label: 'From phone', kept: 'this device' }]); // B's edit was overwritten, and A is told
    await B.engine.sync();
    expect((await B.d.accounts.get(id))!.name).toBe('From desktop');
    expect(await B.engine.conflicts()).toHaveLength(0);
    expect(await A.engine.conflicts()).toHaveLength(1);
  }, 60000);

  it('retries when another device syncs at the same moment', async () => {
    const remote = memoryRemote();
    const A = device(remote);
    const B = device(remote);
    await A.d.accounts.add({ name: 'One', kind: 'checking' } as never);
    await A.engine.initialUpload();
    await B.engine.replaceFromRemote();
    await A.d.accounts.add({ name: 'FromA', kind: 'checking' } as never);
    await B.d.accounts.add({ name: 'FromB', kind: 'checking' } as never);
    // B's write goes in between A reading and A writing
    const real = remote.putFile.bind(remote);
    let first = true;
    remote.putFile = async (bytes, sha, msg) => {
      if (first) {
        first = false;
        await B.engine.sync();
      }
      return real(bytes, sha, msg);
    };
    await A.engine.sync();
    await B.engine.sync();
    for (const x of [A, B]) expect((await x.d.accounts.toArray()).map((a) => a.name).sort()).toEqual(['FromA', 'FromB', 'One']);
  }, 90000);

  it('refuses a first upload when a copy exists, and a wrong passphrase on another device', async () => {
    const remote = memoryRemote();
    const A = device(remote);
    await A.d.accounts.add({ name: 'One', kind: 'checking' } as never);
    await A.engine.initialUpload();
    await expect(device(remote).engine.initialUpload()).rejects.toThrow(/already exists/);
    await expect(device(remote, 'not the passphrase').engine.replaceFromRemote()).rejects.toThrow(/Wrong sync passphrase/);
    await expect(device(remote).engine.sync()).rejects.toThrow(/not set up/);
  }, 60000);
});

describe('GitHub client', () => {
  const cfg = { owner: 'me', repo: 'ledger-data', token: 'tok' };
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

  it('reads the exact version it listed, and writes with that version', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const f = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.endsWith('/contents')) return json([{ name: 'README.md', sha: 'r' }, { name: 'ledger-sync.bin', sha: 'abc' }]);
      if (url.endsWith('/git/blobs/abc')) return new Response(new Uint8Array([1, 2, 3]));
      if (url.endsWith('/contents/ledger-sync.bin')) return json({ content: { sha: 'def' } });
      return json({ message: 'unexpected' }, 500);
    }) as unknown as typeof fetch;
    const gh = githubRemote(cfg, f);
    const file = await gh.getFile();
    expect(file).toEqual({ sha: 'abc', bytes: new Uint8Array([1, 2, 3]) });
    expect((calls[1].init!.headers as Record<string, string>).Accept).toBe('application/vnd.github.raw+json');
    expect((calls[0].init!.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    expect(calls[0].init!.cache).toBe('no-store');
    expect(await gh.putFile(new Uint8Array([9]), 'abc', 'm')).toBe('def');
    expect(JSON.parse(calls[2].init!.body as string)).toEqual({ message: 'm', content: 'CQ==', sha: 'abc' });
  });
  it('an empty repository has no file yet; a missing one is an error', async () => {
    const empty = (async (url: string) => (url.endsWith('/contents') ? json({ message: 'This repository is empty.' }, 404) : json({ private: true }))) as unknown as typeof fetch;
    expect(await githubRemote(cfg, empty).getFile()).toBeNull();
    const missing = (async () => json({ message: 'Not Found' }, 404)) as unknown as typeof fetch;
    await expect(githubRemote(cfg, missing).getFile()).rejects.toThrow(/could not find that repository/);
  });
  it('a stale version becomes a conflict to retry, and a rejected token reads plainly', async () => {
    const stale = (async () => json({ message: 'sha does not match' }, 409)) as unknown as typeof fetch;
    await expect(githubRemote(cfg, stale).putFile(new Uint8Array([1]), 'old', 'm')).rejects.toBeInstanceOf(RemoteConflict);
    const bad = (async () => json({ message: 'Bad credentials' }, 401)) as unknown as typeof fetch;
    await expect(githubRemote(cfg, bad).checkRepo()).rejects.toThrow(/did not accept the token/);
    await expect(githubRemote(cfg, bad).checkRepo()).rejects.toBeInstanceOf(GhError);
  });
  it('reports whether the repository is private', async () => {
    const f = (async () => json({ private: false })) as unknown as typeof fetch;
    expect(await githubRemote(cfg, f).checkRepo()).toEqual({ private: false });
  });
  it('understands the ways people write a repository name', () => {
    expect(parseRepo('me/ledger-data')).toEqual({ owner: 'me', repo: 'ledger-data' });
    expect(parseRepo(' https://github.com/me/ledger-data.git/ ')).toEqual({ owner: 'me', repo: 'ledger-data' });
    expect(parseRepo('nonsense')).toBeNull();
  });
});

describe('shared tables ride along with device sync', () => {
  it('contacts, links, due items and delete markers reach the other device with no change to the sync engine', async () => {
    const { createStore } = await import('../../core/store');
    const { publishDueItem, listDueItems } = await import('../../core/dueItems');
    const remote = memoryRemote();
    const A = device(remote);
    const B = device(remote);
    const sa = createStore(A.d);
    const sb = createStore(B.d);
    const pid = await sa.shared.contacts.put({ name: 'Test Person' });
    const tid = await sa.shared.tags.put({ name: 'temp' });
    await sa.shared.links.add({ module: 'ledger', id: 1 }, { module: 'shared', id: pid }, 'about');
    await publishDueItem({ sourceModule: 'ledger', sourceRecordId: 1, title: 'Bill', date: '2026-12-01', allDay: true, priority: 'high', status: 'open', tagIds: [] }, A.d);
    await A.engine.initialUpload();
    await B.engine.replaceFromRemote();
    expect((await sb.shared.contacts.query()).map((c) => c.name)).toEqual(['Test Person']);
    expect((await sb.shared.links.linkedTo({ module: 'ledger', id: 1 })).length).toBe(1);
    expect((await listDueItems({}, B.d)).map((i) => i.title)).toEqual(['Bill']);
    // a soft delete on B reaches A
    await sb.shared.tags.remove(tid);
    await B.engine.sync();
    await A.engine.sync();
    expect(await sa.shared.tags.get(tid)).toBeUndefined();
    expect((await A.d.tags.get(tid))?.deletedAt).toBeGreaterThan(0);
  });
});

const pause = (ms = 8) => new Promise((r) => setTimeout(r, ms));

describe('keeping both sides when two devices disagree', () => {
  async function pair() {
    const { createStore } = await import('../../core/store');
    const remote = memoryRemote();
    const A = device(remote);
    const B = device(remote);
    return { A, B, sa: createStore(A.d), sb: createStore(B.d) };
  }

  it('same record edited on both: the later edit wins, the other is saved, and "put back" brings it to both devices', async () => {
    const { restoreLostVersion } = await import('./safety');
    const { A, B, sa, sb } = await pair();
    const id = await sa.shared.contacts.put({ name: 'Test Person' });
    await A.engine.initialUpload();
    await B.engine.replaceFromRemote();
    await pause();
    await sa.shared.contacts.put({ id, name: 'Test Person (A edit)' });
    await pause();
    await sb.shared.contacts.put({ id, name: 'Test Person (B edit)' });
    await B.engine.sync();
    const run = await A.engine.sync();
    expect((await sa.shared.contacts.get(id))?.name).toBe('Test Person (B edit)');
    expect(run.conflicts).toHaveLength(1);
    const c = (await A.engine.conflicts())[0];
    expect(c.kept).toBe('other device');
    expect((c.lost as { name: string }).name).toBe('Test Person (A edit)');
    await pause();
    await restoreLostVersion(A.d, c);
    await A.engine.sync();
    await B.engine.sync();
    for (const s of [sa, sb]) expect((await s.shared.contacts.get(id))?.name).toBe('Test Person (A edit)');
  });

  it('deleted on one device, edited on the other: the deletion stands, the edit is saved and can be put back', async () => {
    const { restoreLostVersion } = await import('./safety');
    const { A, B } = await pair();
    const acct = (await A.d.accounts.add({ name: 'Checking', kind: 'checking' } as never)) as number;
    const t = (await A.d.txns.add({ accountId: acct, date: '2026-10-01', amountCents: -500, payee: 'Coffee' } as never)) as number;
    await A.engine.initialUpload();
    await B.engine.replaceFromRemote();
    await pause();
    await A.d.txns.delete(t);
    await B.d.txns.update(t, { payee: 'Coffee (edited)' });
    await B.engine.sync();
    const run = await A.engine.sync();
    expect(await A.d.txns.get(t)).toBeUndefined();
    expect(run.conflicts.map((c) => c.kept)).toEqual(['this device']);
    const c = (await A.engine.conflicts())[0];
    expect((c.lost as { payee: string }).payee).toBe('Coffee (edited)');
    await B.engine.sync();
    expect(await B.d.txns.get(t)).toBeUndefined();
    await pause();
    await restoreLostVersion(A.d, c);
    await A.engine.sync();
    await B.engine.sync();
    expect((await B.d.txns.get(t))?.payee).toBe('Coffee (edited)');
  });

  it('different records edited on each device while apart: both changes survive, in Ledger and in the shared store', async () => {
    const { A, B, sa, sb } = await pair();
    const acct = (await A.d.accounts.add({ name: 'Checking', kind: 'checking' } as never)) as number;
    const p1 = await sa.shared.contacts.put({ name: 'One' });
    const p2 = await sa.shared.contacts.put({ name: 'Two' });
    await A.engine.initialUpload();
    await B.engine.replaceFromRemote();
    await pause();
    await A.d.accounts.update(acct, { name: 'Main checking' });
    await sa.shared.contacts.put({ id: p1, name: 'One (A)' });
    await sb.shared.contacts.put({ id: p2, name: 'Two (B)' });
    const added = await sb.shared.contacts.put({ name: 'Three (B, new)' });
    await A.engine.sync();
    await B.engine.sync();
    await A.engine.sync();
    for (const [d, s] of [[A.d, sa], [B.d, sb]] as const) {
      expect((await d.accounts.get(acct))?.name).toBe('Main checking');
      expect((await s.shared.contacts.query()).map((c) => c.name).sort()).toEqual(['One (A)', 'Three (B, new)', 'Two (B)']);
      expect(await s.shared.contacts.get(added)).toBeDefined();
    }
    expect((await A.engine.conflicts()).length).toBe(0);
  });
});

describe('restoring a backup while sync is on', () => {
  it('the restored data replaces what the other device has at its next sync (extras are removed, nothing is duplicated)', async () => {
    const { exportAll, importAll } = await import('../backup');
    const remote = memoryRemote();
    const A = device(remote);
    const B = device(remote);
    const acct = (await A.d.accounts.add({ name: 'Keep', kind: 'checking' } as never)) as number;
    await A.d.txns.add({ accountId: acct, date: '2026-10-01', amountCents: -500, payee: 'Old one' } as never);
    await A.engine.initialUpload();
    await B.engine.replaceFromRemote();
    const backup = await exportAll(A.d);
    await pause();
    await A.d.txns.add({ accountId: acct, date: '2026-10-05', amountCents: -900, payee: 'Added after the backup' } as never);
    await A.engine.sync();
    await B.engine.sync();
    expect(await B.d.txns.count()).toBe(2);
    await pause();
    await importAll(A.d, backup);
    await touchAll(A.d);
    await A.engine.sync();
    await B.engine.sync();
    for (const x of [A, B]) expect((await x.d.txns.toArray()).map((t) => t.payee)).toEqual(['Old one']);
  });
});

describe('first sync on a new device, and the safety copy', () => {
  it('a new device that already created its starter categories ends with exactly the synced copy (no wipe of the copy, no doubles)', async () => {
    const { seedIfEmpty } = await import('../../db');
    const remote = memoryRemote();
    const A = device(remote);
    const B = device(remote);
    await seedIfEmpty(A.d);
    await A.d.accounts.add({ name: 'Checking', kind: 'checking' } as never);
    await A.engine.initialUpload();
    await seedIfEmpty(B.d); // a fresh device makes its own starter categories before sync is set up
    await B.engine.replaceFromRemote();
    await B.engine.sync();
    await A.engine.sync();
    for (const t of ['categoryGroups', 'categories', 'accounts'] as const) {
      expect(await B.d[t].count()).toBe(await A.d[t].count());
      expect((await B.d[t].toArray()).map((r) => r.id).sort()).toEqual((await A.d[t].toArray()).map((r) => r.id).sort());
    }
  });

  it('the one-time safety copy is a full, restorable backup and is only taken once', async () => {
    const { ensureFirstSyncSnapshot, listSnapshots, readSnapshot, FIRST_SYNC_KEY } = await import('./safety');
    const { checkBackupText } = await import('../backupFile');
    const d = new FinanceDB(uniq());
    const meta = dexieMeta(uniq());
    await d.accounts.add({ name: 'Checking', kind: 'checking' } as never);
    expect(await ensureFirstSyncSnapshot(d, meta)).toBe(true);
    await d.accounts.add({ name: 'Savings', kind: 'savings' } as never);
    expect(await ensureFirstSyncSnapshot(d, meta)).toBe(false); // already have one: not overwritten by a later state
    const list = await listSnapshots(meta);
    expect(list.map((s) => s.key)).toEqual([FIRST_SYNC_KEY]);
    const snap = (await readSnapshot(meta, FIRST_SYNC_KEY))!;
    const { file } = checkBackupText(snap.text);
    expect((file.accounts as unknown[]).length).toBe(1);
  });
});

describe('calendar data rides along with device sync', () => {
  it('an event made on one device appears on the other, and both devices seeding the built-in calendars never doubles them', async () => {
    const { ensureCalendarSeed, createEvent, newEventData, loadEvents, loadLayers } = await import('../../modules/calendar/data');
    const { blankFields, PERSONAL_ID } = await import('../../modules/calendar/model');
    const remote = memoryRemote();
    const A = device(remote);
    const B = device(remote);
    await ensureCalendarSeed(A.d);
    await ensureCalendarSeed(B.d); // both devices create the built-in calendars on their own
    await createEvent(newEventData({ ...blankFields('2026-11-04'), title: 'Test dentist' }, { calendarId: PERSONAL_ID, tagIds: [], contactIds: [], recurrence: { freq: 'weekly', interval: 1, end: { type: 'never' } }, trackDone: false }), A.d);
    await A.engine.initialUpload();
    await B.engine.replaceFromRemote();
    await ensureCalendarSeed(B.d); // opening the Calendar on B again must not add a second set
    await B.engine.sync();
    await A.engine.sync();
    for (const x of [A, B]) {
      expect((await loadEvents(x.d)).map((e) => e.data.title)).toEqual(['Test dentist']);
      expect((await loadLayers(x.d)).map((l) => l.name).sort()).toEqual(['Bills & Subscriptions', 'Finance', 'Home & Assets', 'Household Services', 'Personal', 'Projects', 'Tasks']);
    }
    expect((await B.d.moduleRecords.toArray()).filter((r) => r.kind === 'calendar')).toHaveLength(7);
  });
});

describe('tasks ride along with device sync', () => {
  it('a task made on one device, and a completion on the other, both arrive; completing a repeating task makes exactly one next task', async () => {
    const { createTask, completeTask, loadTasks } = await import('../../modules/tasks/data');
    const { blankTask } = await import('../../modules/tasks/model');
    const remote = memoryRemote();
    const A = device(remote);
    const B = device(remote);
    const id = await createTask(blankTask({ title: 'Test filter', dueDate: '2026-11-02', repeat: { mode: 'fixed', rule: { freq: 'weekly', interval: 1, end: { type: 'never' } } } }), [], A.d);
    await A.engine.initialUpload();
    await B.engine.replaceFromRemote();
    expect((await loadTasks(B.d)).map((t) => t.data.title)).toEqual(['Test filter']);
    await completeTask(id, '2026-11-04', B.d);
    await B.engine.sync();
    await A.engine.sync();
    for (const x of [A, B]) expect((await loadTasks(x.d)).map((t) => [t.data.status, t.data.dueDate]).sort()).toEqual([['done', '2026-11-02'], ['todo', '2026-11-09']]);
  });
});
