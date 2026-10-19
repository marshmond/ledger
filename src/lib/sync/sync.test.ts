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
    expect(m.conflicts).toEqual([{ table: 'accounts', id: '1', label: 'Mine', kept: 'other device', at: NOW }]);
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
