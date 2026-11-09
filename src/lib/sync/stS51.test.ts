import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Table } from 'dexie';
import { FinanceDB } from '../../db';
import { decodeSnapshot } from './codec';
import { addConflicts, conflictKey, readConflicts, removeConflicts } from './conflicts';
import { dexieMeta, RemoteConflict, SyncEngine, snapshotOf, type RemoteFile, type RemoteStore } from './engine';
import { installTracking } from './track';
import type { Conflict } from './merge';

/**
 * ST-S5.1. ST5-F1: an older build must carry a newer build's tables through sync untouched. ST5-F2: the saved conflict list must survive two
 * browser tabs saving at once. The real SyncEngine, merge and encryption run over disposable fake-indexeddb databases and an in-memory remote.
 * All data is invented. "Newer build" = a FinanceDB with one extra table that the current app does not have (nothing is added to the real schema).
 */
let n = 0;
const uniq = () => `s51-${Date.now()}-${n++}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const PASS = 'a test passphrase';

interface FutureRow { id: number; note: string; updatedAt?: number; extra?: string }
class FutureDB extends FinanceDB {
  declare futureThings: Table<FutureRow, number>;
  constructor(name: string) {
    super(name);
    this.version(16).stores({ futureThings: 'id' });
  }
}

interface Remote extends RemoteStore { puts: number; file: RemoteFile | null; failNextPut: boolean }
function memoryRemote(): Remote {
  const r: Remote = {
    puts: 0,
    file: null,
    failNextPut: false,
    async getFile() { return r.file ? { sha: r.file.sha, bytes: r.file.bytes.slice() } : null; },
    async putFile(bytes, sha) {
      if (r.failNextPut) { r.failNextPut = false; throw new Error('network down'); }
      if ((r.file?.sha ?? undefined) !== sha) throw new RemoteConflict('stale');
      r.puts++;
      r.file = { sha: `sha${r.puts}`, bytes: bytes.slice() };
      return r.file.sha;
    },
  };
  return r;
}
function older(remote: RemoteStore) {
  const d = new FinanceDB(uniq());
  installTracking(d);
  return { d, engine: new SyncEngine(d, dexieMeta(uniq()), remote, PASS) };
}
function newer(remote: RemoteStore) {
  const d = new FutureDB(uniq());
  installTracking(d);
  return { d, engine: new SyncEngine(d, dexieMeta(uniq()), remote, PASS) };
}
const remoteTables = async (r: Remote) => decodeSnapshot(r.file!.bytes, PASS);
const future = async (r: Remote) => Object.values((await remoteTables(r)).tables.futureThings ?? {}).map((x) => (x as unknown as FutureRow).note).sort();

afterEach(() => vi.restoreAllMocks());

describe('ST5-F1 an older build never erases a newer build\'s tables', () => {
  it('1. a newer device adds records to an unknown table; the older device syncs twice; the records survive everywhere and no deletion is recorded', async () => {
    const remote = memoryRemote();
    const O = older(remote);
    const N = newer(remote);
    await O.d.contacts.add({ name: 'Seed' } as never);
    await O.engine.initialUpload();
    await N.engine.replaceFromRemote();
    await N.d.futureThings.bulkAdd([{ id: 1, note: 'one' }, { id: 2, note: 'two' }, { id: 3, note: 'three' }]);
    await N.engine.sync();
    expect(await future(remote)).toEqual(['one', 'three', 'two']);
    await O.engine.sync(); // first older-device sync
    await O.d.contacts.add({ name: 'Older device edit' } as never); // so the second one uploads
    await O.engine.sync(); // second older-device sync (this is where the S5 reproduction lost them)
    await O.engine.sync();
    expect(await future(remote)).toEqual(['one', 'three', 'two']);
    const file = await remoteTables(remote);
    expect(Object.keys(file.tombstones.futureThings ?? {})).toEqual([]); // the older device never marks an unknown record deleted
    await N.engine.sync();
    expect((await N.d.futureThings.toArray()).map((x) => x.note).sort()).toEqual(['one', 'three', 'two']); // the newer device still has its own copy
    expect((await N.d.contacts.toArray()).map((c) => c.name).sort()).toEqual(['Older device edit', 'Seed']); // and the older device's normal edit arrived
  });

  it('2. an older device that JOINS an existing newer remote keeps the unknown records through repeated syncs', async () => {
    const remote = memoryRemote();
    const N = newer(remote);
    await N.d.contacts.add({ name: 'Seed' } as never);
    await N.d.futureThings.bulkAdd([{ id: 1, note: 'one' }, { id: 2, note: 'two' }]);
    await N.engine.initialUpload();
    const O = older(remote);
    await O.engine.replaceFromRemote(); // joins from the shared copy
    for (let i = 0; i < 3; i++) { await O.d.contacts.add({ name: `O${i}` } as never); await O.engine.sync(); }
    expect(await future(remote)).toEqual(['one', 'two']);
    await N.engine.sync();
    expect(await N.d.futureThings.count()).toBe(2);
    const O2 = older(remote); // and a second older device joining later
    await O2.engine.replaceFromRemote();
    await O2.engine.sync();
    await O2.engine.sync();
    expect(await future(remote)).toEqual(['one', 'two']);
  });

  it('3. normal edits and legitimate deletions of KNOWN tables still flow both ways, and a legitimate deletion in the unknown table is carried through', async () => {
    const remote = memoryRemote();
    const N = newer(remote);
    const N2 = newer(remote);
    const O = older(remote);
    const ids = (await N.d.contacts.bulkAdd([{ name: 'Keep' }, { name: 'Remove' }, { name: 'Rename' }] as never, { allKeys: true })) as number[];
    await N.d.futureThings.bulkAdd([{ id: 1, note: 'one' }, { id: 2, note: 'two' }]);
    await N.engine.initialUpload();
    await N2.engine.replaceFromRemote();
    await O.engine.replaceFromRemote();
    await sleep(5);
    await O.d.contacts.delete(ids[1]); // a real deletion on the older device
    await O.d.contacts.update(ids[2], { name: 'Renamed on older' });
    await O.engine.sync();
    await N.engine.sync();
    expect((await N.d.contacts.toArray()).map((c) => c.name).sort()).toEqual(['Keep', 'Renamed on older']);
    await sleep(5);
    await N.d.futureThings.delete(2); // a real deletion in the table only newer builds know
    await N.engine.sync();
    await O.engine.sync(); // the older device sits in the middle
    await O.engine.sync();
    await N2.engine.sync();
    expect((await N2.d.futureThings.toArray()).map((x) => x.note)).toEqual(['one']); // record 2 is gone, record 1 stayed
    expect((await N2.d.contacts.toArray()).map((c) => c.name).sort()).toEqual(['Keep', 'Renamed on older']);
    expect(await future(remote)).toEqual(['one']);
  });

  it('4. unknown fields on known records survive an older device', async () => {
    const remote = memoryRemote();
    const N = newer(remote);
    const O = older(remote);
    const id = (await N.d.contacts.add({ name: 'Plan', futureField: { deep: [1, 2, 3] } } as never)) as number;
    await N.engine.initialUpload();
    await O.engine.replaceFromRemote();
    await O.d.contacts.add({ name: 'Other' } as never);
    await O.engine.sync();
    await O.engine.sync();
    expect(await O.d.contacts.get(id)).toMatchObject({ futureField: { deep: [1, 2, 3] } });
    const N2 = newer(remote);
    await N2.engine.replaceFromRemote();
    expect(await N2.d.contacts.get(id)).toMatchObject({ name: 'Plan', futureField: { deep: [1, 2, 3] } });
  });

  it('5. an upload failure followed by a retry keeps the unknown records, and the failed run changed nothing remotely', async () => {
    const remote = memoryRemote();
    const N = newer(remote);
    const O = older(remote);
    await N.d.futureThings.bulkAdd([{ id: 1, note: 'one' }, { id: 2, note: 'two' }]);
    await N.engine.initialUpload();
    await O.engine.replaceFromRemote();
    await O.engine.sync();
    await O.d.contacts.add({ name: 'Needs upload' } as never);
    remote.failNextPut = true;
    const before = remote.file!.sha;
    await expect(O.engine.sync()).rejects.toThrow(/network down/);
    expect(remote.file!.sha).toBe(before);
    expect(await future(remote)).toEqual(['one', 'two']);
    await O.engine.sync(); // retry
    expect(remote.file!.sha).not.toBe(before);
    expect(await future(remote)).toEqual(['one', 'two']);
    await O.engine.sync();
    expect(await future(remote)).toEqual(['one', 'two']);
  });

  it('6. a newer device updates the unknown table between the older device\'s failed run and its retry: the newer content is not overwritten', async () => {
    const remote = memoryRemote();
    const N = newer(remote);
    const O = older(remote);
    await N.d.futureThings.bulkAdd([{ id: 1, note: 'one' }, { id: 2, note: 'two' }]);
    await N.engine.initialUpload();
    await O.engine.replaceFromRemote();
    await O.d.contacts.add({ name: 'Needs upload' } as never);
    remote.failNextPut = true;
    await expect(O.engine.sync()).rejects.toThrow(/network down/);
    await sleep(5);
    await N.d.futureThings.update(1, { note: 'one (newer)' });
    await N.d.futureThings.add({ id: 3, note: 'three' });
    await N.engine.sync();
    await O.engine.sync(); // retry reads the newer remote
    expect(await future(remote)).toEqual(['one (newer)', 'three', 'two']);
  });

  it('6b. the same, when the newer device uploads at the very moment the older device uploads (stale-version race, merged again)', async () => {
    const remote = memoryRemote();
    const N = newer(remote);
    const O = older(remote);
    await N.d.futureThings.bulkAdd([{ id: 1, note: 'one' }]);
    await N.engine.initialUpload();
    await O.engine.replaceFromRemote();
    await O.d.contacts.add({ name: 'Needs upload' } as never);
    const realPut = remote.putFile.bind(remote);
    let raced = false;
    remote.putFile = async (bytes, sha, msg) => {
      if (!raced) { raced = true; await N.d.futureThings.add({ id: 9, note: 'arrived during the race' }); await N.engine.sync(); }
      return realPut(bytes, sha, msg); // `sha` is now stale, so this is refused and the older device merges again
    };
    await O.engine.sync();
    expect(raced).toBe(true);
    expect(await future(remote)).toEqual(['arrived during the race', 'one']);
  });

  it('7. a device that later UPGRADES to the build that has the table receives the records instead of deleting them', async () => {
    const remote = memoryRemote();
    const N = newer(remote);
    await N.d.futureThings.bulkAdd([{ id: 1, note: 'one' }, { id: 2, note: 'two' }]);
    await N.engine.initialUpload();
    const name = uniq();
    const meta = uniq();
    const d1 = new FinanceDB(name);
    installTracking(d1);
    const e1 = new SyncEngine(d1, dexieMeta(meta), remote, PASS);
    await e1.replaceFromRemote();
    await e1.sync();
    await e1.sync();
    d1.close();
    const d2 = new FutureDB(name); // same database, now opened by the newer build
    installTracking(d2);
    const e2 = new SyncEngine(d2, dexieMeta(meta), remote, PASS);
    await e2.sync();
    await e2.sync();
    expect((await d2.futureThings.toArray()).map((x) => x.note).sort()).toEqual(['one', 'two']);
    expect(await future(remote)).toEqual(['one', 'two']);
  });

  it('8. a device that already remembered unknown ids from before this fix does not turn them into deletions', async () => {
    const remote = memoryRemote();
    const N = newer(remote);
    await N.d.futureThings.bulkAdd([{ id: 1, note: 'one' }, { id: 2, note: 'two' }]);
    await N.engine.initialUpload();
    const O = older(remote);
    await O.engine.replaceFromRemote();
    const metaName = uniq();
    const meta = dexieMeta(metaName);
    await meta.set('base', { futureThings: ['1', '2'], contacts: [] }); // what the previous build stored
    await meta.set('lastSync', Date.now() - 1000);
    const engine = new SyncEngine(O.d, meta, remote, PASS);
    await engine.sync();
    await engine.sync();
    expect(await future(remote)).toEqual(['one', 'two']);
    expect(Object.keys((await meta.get<Record<string, string[]>>('base')) ?? {})).not.toContain('futureThings'); // and it forgets them
  });

  it('9. a sync file in a format this build cannot interpret is refused, and nothing here or in the shared copy changes', async () => {
    const remote = memoryRemote();
    const O = older(remote);
    await O.d.contacts.add({ name: 'Mine' } as never);
    await O.engine.initialUpload();
    const N = newer(remote);
    await N.engine.replaceFromRemote();
    const real = JSON.stringify;
    const spy = vi.spyOn(JSON, 'stringify').mockImplementation(((val: unknown, ...rest: unknown[]) => {
      const v = val as { app?: string } | null;
      return (real as (...a: unknown[]) => string)(v && v.app === 'ledger-sync' ? { ...v, v: 2 } : val, ...rest);
    }) as typeof JSON.stringify);
    await N.d.contacts.add({ name: 'Writes a version 2 file' } as never);
    const out = await N.engine.sync();
    expect(out.pushed).toBe(true);
    spy.mockRestore();
    const shared = remote.file!;
    const localBefore = JSON.stringify(await snapshotOf(O.d));
    await expect(O.engine.sync()).rejects.toThrow(/newer or different version of Ledger/);
    await expect(O.engine.replaceFromRemote()).rejects.toThrow(/newer or different version of Ledger/);
    expect(JSON.stringify(await snapshotOf(O.d))).toBe(localBefore);
    expect(remote.file).toBe(shared);
  });
});

describe('ST5-F2 the saved conflict list survives two browser tabs saving at once', () => {
  /** Two independent connections to the same database, like two tabs: no JavaScript state is shared between them. */
  const twoTabs = () => {
    const name = uniq();
    return { tab1: dexieMeta(name), tab2: dexieMeta(name) };
  };
  const mk = (id: number, stamp: number): Conflict => ({ table: 'contacts', id: String(id), label: `P${id}`, kept: 'other device', at: 1, lost: { id, updatedAt: stamp, name: `v${stamp}` } });

  it('control: a plain read-then-write from two tabs DOES lose a version (the problem this fixes)', async () => {
    const { tab1, tab2 } = twoTabs();
    const a = (await tab1.get<Conflict[]>('conflicts')) ?? [];
    const b = (await tab2.get<Conflict[]>('conflicts')) ?? [];
    await tab1.set('conflicts', [mk(1, 1), ...a]);
    await tab2.set('conflicts', [mk(2, 1), ...b]);
    expect(await tab1.get<Conflict[]>('conflicts')).toHaveLength(1); // tab 1's version is gone
  });

  it('1. concurrent additions from independent tabs keep both', async () => {
    const { tab1, tab2 } = twoTabs();
    await Promise.all([addConflicts(tab1, [mk(1, 1)]), addConflicts(tab2, [mk(2, 1)])]);
    expect((await readConflicts(tab1)).map((c) => c.id).sort()).toEqual(['1', '2']);
    // and many at once, from both
    const { tab1: t1, tab2: t2 } = twoTabs();
    await Promise.all(Array.from({ length: 40 }, (_, i) => addConflicts(i % 2 ? t1 : t2, [mk(i, 5)])));
    expect(await readConflicts(t1)).toHaveLength(40);
  });

  it('2. an addition in one tab and a removal in the other keep the unrelated entries', async () => {
    const { tab1, tab2 } = twoTabs();
    await addConflicts(tab1, [mk(1, 1), mk(2, 1), mk(3, 1)]);
    const [added, removed] = await Promise.all([addConflicts(tab1, [mk(4, 2), mk(5, 2)]), removeConflicts(tab2, [conflictKey(mk(2, 1))])]);
    expect(added).toBe(2);
    expect(removed).toBe(1);
    expect((await readConflicts(tab2)).map((c) => c.id).sort()).toEqual(['1', '3', '4', '5']);
  });

  it('3. clearing an older selection in one tab never removes entries another tab added afterwards', async () => {
    const { tab1, tab2 } = twoTabs();
    await addConflicts(tab1, [mk(1, 1), mk(2, 1), mk(3, 1)]);
    const shown = (await readConflicts(tab1)).map(conflictKey); // what the owner was looking at when they confirmed
    await addConflicts(tab2, [mk(7, 9), mk(8, 9)]); // a sync in the other tab finished meanwhile
    expect(await removeConflicts(tab1, shown)).toBe(3);
    expect((await readConflicts(tab1)).map((c) => c.id).sort()).toEqual(['7', '8']);
  });

  it('4. repeating the same save (a retry), even from both tabs at once, does not duplicate entries', async () => {
    const { tab1, tab2 } = twoTabs();
    const batch = [mk(1, 3), mk(2, 3), mk(3, 3)];
    const counts = await Promise.all([addConflicts(tab1, batch), addConflicts(tab2, batch), addConflicts(tab1, batch), addConflicts(tab2, batch)]);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(3); // exactly one of them added them
    expect(await readConflicts(tab1)).toHaveLength(3);
    expect(await addConflicts(tab2, batch)).toBe(0);
  });

  it('5. a failed save leaves the existing list exactly as it was, and says so', async () => {
    const { tab1, tab2 } = twoTabs();
    await addConflicts(tab1, [mk(1, 1), mk(2, 1)]);
    const before = JSON.stringify(await readConflicts(tab1));
    await expect(tab2.update('conflicts', () => { throw new Error('boom'); })).rejects.toThrow('boom'); // the change itself fails
    await expect(tab2.update('conflicts', () => [() => 1] as never)).rejects.toThrow(); // the browser refuses to store it
    await expect(addConflicts(tab2, [{ ...mk(3, 1), lost: { id: 3, updatedAt: 1, bad: () => 1 } as never }])).rejects.toThrow();
    expect(JSON.stringify(await readConflicts(tab1))).toBe(before);
    expect(await addConflicts(tab2, [mk(3, 1)])).toBe(1); // and the store still works afterwards
  });

  it('6. a sync whose list cannot be saved changes nothing (the sync stops before it overwrites anything)', async () => {
    const remote = memoryRemote();
    const A = older(remote);
    const d = new FinanceDB(uniq());
    installTracking(d);
    const meta = dexieMeta(uniq());
    const failing = { ...meta, update: async () => { throw new Error('storage unavailable'); } } as typeof meta;
    const B = { d, engine: new SyncEngine(d, failing, remote, PASS) };
    const id = (await A.d.contacts.add({ name: 'P' } as never)) as number;
    await A.engine.initialUpload();
    await meta.set('base', {});
    await meta.set('lastSync', 0);
    await B.engine.replaceFromRemote();
    await sleep(5);
    await d.contacts.update(id, { name: 'B edit' });
    await sleep(5);
    await A.d.contacts.update(id, { name: 'A edit' });
    await A.engine.sync();
    const sha = remote.file!.sha;
    await expect(B.engine.sync()).rejects.toThrow(/storage unavailable/);
    expect((await d.contacts.get(id))?.name).toBe('B edit');
    expect(remote.file!.sha).toBe(sha);
  });
});
