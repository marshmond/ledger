import { describe, expect, it } from 'vitest';
import { FinanceDB } from '../../db';
import { dexieMeta, RemoteConflict, SyncEngine, type RemoteFile, type RemoteStore } from './engine';
import { installTracking } from './track';

/** Automatic runs skip the download when nothing changed; every doubtful case does a full run. Invented data. */
let n = 0;
const uniq = () => `skip${Date.now()}-${n++}`;

function remoteWithHead() {
  const r = {
    puts: 0, gets: 0, heads: 0,
    file: null as RemoteFile | null,
    async headSha() { r.heads++; return r.file?.sha ?? null; },
    async getFile() { r.gets++; return r.file ? { sha: r.file.sha, bytes: r.file.bytes.slice() } : null; },
    async putFile(bytes: Uint8Array, sha: string | undefined) {
      if ((r.file?.sha ?? undefined) !== sha) throw new RemoteConflict('stale');
      r.puts++;
      r.file = { sha: `sha${r.puts}`, bytes: bytes.slice() };
      return r.file.sha;
    },
  };
  return r satisfies RemoteStore;
}

function device(remote: RemoteStore) {
  const d = new FinanceDB(uniq());
  installTracking(d);
  const meta = dexieMeta(uniq());
  return { d, meta, engine: new SyncEngine(d, meta, remote, 'a good passphrase') };
}

async function twoDevices() {
  const remote = remoteWithHead();
  const A = device(remote);
  const B = device(remote);
  const acct = (await A.d.accounts.add({ name: 'Checking', kind: 'checking' } as never)) as number;
  await A.d.txns.add({ accountId: acct, date: '2026-10-01', amountCents: -500, payee: 'Coffee' } as never);
  await A.engine.initialUpload();
  await B.engine.replaceFromRemote();
  await B.engine.sync(); // settle
  await A.engine.sync();
  return { remote, A, B, acct };
}

describe('skipping a pointless download', () => {
  it('nothing changed anywhere: the automatic run does not download', async () => {
    const { remote, A } = await twoDevices();
    const gets = remote.gets;
    const r = await A.engine.sync({ allowSkip: true });
    expect(r.skipped).toBe(true);
    expect(remote.gets).toBe(gets);
    expect(remote.heads).toBeGreaterThan(0);
    expect(await A.engine.lastSyncedAt()).toBeGreaterThan(0);
  }, 60000);

  it('a run without allowSkip (the Sync now button) is always a full run', async () => {
    const { remote, A } = await twoDevices();
    const gets = remote.gets;
    const r = await A.engine.sync();
    expect(r.skipped).toBeUndefined();
    expect(remote.gets).toBe(gets + 1);
  }, 60000);

  it('a change made on this device is sent', async () => {
    const { remote, A, acct } = await twoDevices();
    await A.d.txns.add({ accountId: acct, date: '2026-10-02', amountCents: -100, payee: 'Tea' } as never);
    const puts = remote.puts;
    const r = await A.engine.sync({ allowSkip: true });
    expect(r.skipped).toBeUndefined();
    expect(r.pushed).toBe(true);
    expect(remote.puts).toBe(puts + 1);
  }, 60000);

  it('a deletion on this device is sent', async () => {
    const { remote, A } = await twoDevices();
    const t = (await A.d.txns.toArray())[0];
    await A.d.txns.delete(t.id!);
    const r = await A.engine.sync({ allowSkip: true });
    expect(r.skipped).toBeUndefined();
    expect(r.pushed).toBe(true);
    expect(remote.puts).toBeGreaterThan(1);
  }, 60000);

  it('a change made on the other device is picked up', async () => {
    const { A, B, acct } = await twoDevices();
    await B.d.txns.add({ accountId: acct, date: '2026-10-03', amountCents: -250, payee: 'Bus' } as never);
    await B.engine.sync({ allowSkip: true });
    const r = await A.engine.sync({ allowSkip: true });
    expect(r.skipped).toBeUndefined();
    expect(r.pulled).toBe(1);
    expect((await A.d.txns.toArray()).map((t) => t.payee).sort()).toEqual(['Bus', 'Coffee']);
  }, 60000);

  it('a device-only setting changing does not cause a skip to be wrong or a send', async () => {
    const { remote, A } = await twoDevices();
    await A.d.settings.put({ key: 'priceApiKey', value: 'secret' });
    const puts = remote.puts;
    const r = await A.engine.sync({ allowSkip: true });
    expect(r.skipped).toBe(true);
    expect(remote.puts).toBe(puts);
  }, 60000);

  it('a remote without a cheap check always runs fully', async () => {
    const remote = remoteWithHead() as RemoteStore & { gets: number };
    delete (remote as { headSha?: unknown }).headSha;
    const A = device(remote);
    await A.d.accounts.add({ name: 'X', kind: 'checking' } as never);
    await A.engine.initialUpload();
    const gets = remote.gets;
    const r = await A.engine.sync({ allowSkip: true });
    expect(r.skipped).toBeUndefined();
    expect(remote.gets).toBe(gets + 1);
  }, 60000);
});

describe('size and activity figures', () => {
  it('counts records, file size and uploads', async () => {
    const { A, acct } = await twoDevices();
    await A.d.txns.add({ accountId: acct, date: '2026-10-04', amountCents: -1, payee: 'Gum' } as never);
    await A.engine.sync();
    const s = await A.engine.stats();
    expect(s.fileBytes).toBeGreaterThan(100);
    expect(s.records).toBeGreaterThanOrEqual(3);
    expect(s.uploadsToday).toBeGreaterThanOrEqual(2);
    expect(s.uploads30d).toBe(s.uploadsToday);
    expect(s.lastUploadAt).toBeGreaterThan(0);
    expect((await A.engine.stats(Date.now() + 40 * 86400000)).uploads30d).toBe(0);
  }, 60000);
});
