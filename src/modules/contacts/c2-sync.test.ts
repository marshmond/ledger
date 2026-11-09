import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FinanceDB } from '../../db';
import { applyContactRemoval, findRemovedButReferenced, planContactRemoval, restoreContact, undoContactRemoval } from '../../core/contactRemoval';
import { readContactReferences } from '../../core/contactReferences';
import { createDistinctContact } from '../../core/contacts';
import { isLive } from '../../core/store';
import { encryptText, exportAll, importAll } from '../../lib/backup';
import { buildBackup, checkBackupText, prepareEncryptedRestore, restoreWithSafetyCopy } from '../../lib/backupFile';
import { dexieMeta, RemoteConflict, SyncEngine, type RemoteFile, type RemoteStore } from '../../lib/sync/engine';
import { installTracking } from '../../lib/sync/track';
import { createTask, getTask, saveTask } from '../tasks/data';
import { blankTask } from '../tasks/model';
import { PROVIDERS, row, seedEverywhere, TODAY } from './c2-testkit';

/** Contacts C2: cross-module references, same-name Contacts and guarded removal through Ledger's real backup and two-device sync engine. Invented data only. */
vi.mock('../../lib/download', () => ({ downloadText: () => undefined }));
let n = 0;
const fresh = () => { const d = new FinanceDB(`test-contacts-c2-${n++}`); installTracking(d); return d; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }; };
beforeEach(() => { vi.stubGlobal('localStorage', mem()); });

function remoteStore() {
  const r = {
    puts: 0, file: null as RemoteFile | null,
    async getFile() { return r.file ? { sha: r.file.sha, bytes: r.file.bytes.slice() } : null; },
    async putFile(bytes: Uint8Array, sha: string | undefined) {
      if ((r.file?.sha ?? undefined) !== sha) throw new RemoteConflict('stale');
      r.puts++;
      r.file = { sha: `sha${r.puts}`, bytes: bytes.slice() };
      return r.file.sha;
    },
  };
  return r satisfies RemoteStore;
}
const devices = () => {
  const remote = remoteStore();
  const mk = () => { const d = fresh(); return { d, engine: new SyncEngine(d, dexieMeta(`contacts-c2-meta-${n++}`), remote, 'a good passphrase') }; };
  return { A: mk(), B: mk() };
};
type Dev = ReturnType<typeof devices>['A'];
const settle = async (A: Dev, B: Dev) => { for (let i = 0; i < 2; i++) { await A.engine.sync(); await B.engine.sync(); } await A.engine.sync(); };
const refs = async (d: FinanceDB, ids: number[]) => (await readContactReferences(ids, d, PROVIDERS, TODAY)).byContact;
const lines = (xs: { module: string; kind: string; recordId: string; role: string }[] | undefined) => (xs ?? []).map((x) => `${x.module}/${x.kind}:${x.recordId}:${x.role}`).sort();

describe('cross-module references through backup and restore', () => {
  it('a plain backup restores every record that names the Contact: same Contact id, same named references, no duplicate Contacts, unknown fields kept', async () => {
    const A = fresh();
    const { c } = await seedEverywhere(A);
    await A.contacts.update(c, { futureField: { a: [1] } } as never);
    const before = lines((await refs(A, [c])).get(c));
    expect(before.length).toBe(13);
    const { file } = checkBackupText(JSON.stringify(await exportAll(A)));
    const B = fresh();
    await importAll(B, file);
    expect(await B.contacts.count()).toBe(await A.contacts.count());
    expect(await B.contacts.get(c)).toMatchObject({ id: c, name: 'Pat Example', futureField: { a: [1] } });
    expect(lines((await refs(B, [c])).get(c))).toEqual(before);
  });

  it('an encrypted backup does not show the names, and restores the same references', async () => {
    const A = fresh();
    const { c } = await seedEverywhere(A);
    const before = lines((await refs(A, [c])).get(c));
    const text = await encryptText(JSON.stringify(await buildBackup(A, mem())), 'a good passphrase');
    expect(text).not.toContain('Pat Example');
    const target = fresh();
    const { file } = await prepareEncryptedRestore(text, 'a good passphrase');
    await restoreWithSafetyCopy(target, file, { saveCopy: async () => 'copy', storage: mem() });
    expect(lines((await refs(target, [c])).get(c))).toEqual(before);
  }, 30000);

  it('a removed Contact and its restoration survive a backup: the removed row is kept, and restoring it brings back the same id', async () => {
    const A = fresh();
    const c = await createDistinctContact(A, { name: 'Spare Person' });
    await applyContactRemoval(A, await planContactRemoval(A, c, PROVIDERS, TODAY), PROVIDERS, TODAY);
    const { file } = checkBackupText(JSON.stringify(await exportAll(A)));
    const B = fresh();
    await importAll(B, file);
    expect(isLive((await B.contacts.get(c))!)).toBe(false);
    expect(await restoreContact(B, c)).toBe(true);
    expect(await B.contacts.get(c)).toMatchObject({ id: c, name: 'Spare Person', deletedAt: null });
  });

  it('still no new table or version (Dexie v15)', () => {
    expect(fresh().verno).toBe(15);
  });
});

describe('same-name Contacts and their references across two devices (real sync engine)', () => {
  it('two Contacts with one name made on different devices stay two; each keeps its own Task and Calendar links; nothing merges', async () => {
    const { A, B } = devices();
    await A.engine.initialUpload();
    await B.engine.replaceFromRemote();
    const a = await createDistinctContact(A.d, { name: 'Sam Example', relationship: 'plumber' });
    await sleep(3);
    const b = await createDistinctContact(B.d, { name: 'Sam Example', relationship: 'school coach' });
    await createTask(blankTask({ title: 'Call the plumber', contactIds: [a] }), [], A.d);
    await row(B.d, 'calendar', 'event', { title: 'Coaching', allDay: true, startDate: '2026-12-03', endDate: '2026-12-03', contactIds: [b], tagIds: [], calendarId: 1 });
    await settle(A, B);
    for (const x of [A, B]) {
      expect((await x.d.contacts.toArray()).filter((c) => c.name === 'Sam Example').map((c) => c.id).sort()).toEqual([a, b].sort());
      const r = await refs(x.d, [a, b]);
      expect(lines(r.get(a))).toEqual([expect.stringMatching(/^tasks\/task:/)]);
      expect(lines(r.get(b))).toEqual([expect.stringMatching(/^calendar\/event:/)]);
    }
  });

  it('editing a Task on one device keeps its Contact id on both devices (no re-matching by name)', async () => {
    const { A, B } = devices();
    await A.engine.initialUpload();
    await B.engine.replaceFromRemote();
    const first = await createDistinctContact(A.d, { name: 'Sam Example', relationship: 'plumber' });
    const second = await createDistinctContact(A.d, { name: 'Sam Example', relationship: 'school coach' });
    const id = await createTask(blankTask({ title: 'Call the coach', contactIds: [second] }), [], A.d);
    await settle(A, B);
    const t = (await getTask(id, B.d))!;
    await saveTask(id, { ...t.data, notes: 'edited on B' }, B.d);
    await settle(A, B);
    for (const x of [A, B]) {
      expect((await getTask(id, x.d))!.data.contactIds).toEqual([second]);
      expect(await x.d.contacts.count()).toBe(2);
    }
    expect(first).not.toBe(second);
  });
});

describe('guarded removal across two devices (real sync engine)', () => {
  async function seededPair() {
    const { A, B } = devices();
    const c = await createDistinctContact(A.d, { name: 'Spare Person', relationship: 'acquaintance' });
    await A.d.contacts.update(c, { futureField: 'kept' } as never);
    await A.engine.initialUpload();
    await B.engine.replaceFromRemote();
    return { A, B, c };
  }

  it('a removal syncs: the other device sees the Contact removed, the row and its unknown fields intact', async () => {
    const { A, B, c } = await seededPair();
    await applyContactRemoval(A.d, await planContactRemoval(A.d, c, PROVIDERS, TODAY), PROVIDERS, TODAY);
    await settle(A, B);
    for (const x of [A, B]) {
      const r = (await x.d.contacts.get(c))!;
      expect(isLive(r)).toBe(false);
      expect(r).toMatchObject({ id: c, name: 'Spare Person', futureField: 'kept' });
    }
  });

  it('Undo on the first device syncs back: the SAME Contact id is live on both, with no duplicate', async () => {
    const { A, B, c } = await seededPair();
    const u = await applyContactRemoval(A.d, await planContactRemoval(A.d, c, PROVIDERS, TODAY), PROVIDERS, TODAY);
    await settle(A, B);
    await sleep(3);
    expect(await undoContactRemoval(A.d, u)).toBe('restored');
    await settle(A, B);
    for (const x of [A, B]) {
      expect(await x.d.contacts.count()).toBe(1);
      expect(await x.d.contacts.get(c)).toMatchObject({ id: c, name: 'Spare Person', deletedAt: null, futureField: 'kept' });
    }
  });

  it('a reference added on another device before the removal reached it is KEPT, shown as "removed but still in use", and restorable with the same id', async () => {
    const { A, B, c } = await seededPair();
    // A removes the (then) unused Contact; B, which has not synced, adds a Task that uses it.
    await applyContactRemoval(A.d, await planContactRemoval(A.d, c, PROVIDERS, TODAY), PROVIDERS, TODAY);
    const taskId = await createTask(blankTask({ title: 'Added on the other device', contactIds: [c] }), [], B.d);
    await settle(A, B);
    for (const x of [A, B]) {
      expect(isLive((await x.d.contacts.get(c))!)).toBe(false); // the removal won for the Contact
      expect((await getTask(taskId, x.d))!.data.contactIds).toEqual([c]); // the Task and its reference are not destroyed
      const found = await findRemovedButReferenced(x.d);
      expect(found.map((f) => f.contact.id)).toEqual([c]);
      expect(found[0].mentions[0]).toMatchObject({ module: 'tasks', kind: 'task' });
    }
    // Restore on either device, sync, and both agree on the same live Contact.
    await sleep(3);
    expect(await restoreContact(B.d, c)).toBe(true);
    await settle(A, B);
    for (const x of [A, B]) {
      expect(isLive((await x.d.contacts.get(c))!)).toBe(true);
      expect(await findRemovedButReferenced(x.d)).toEqual([]);
      expect(lines((await refs(x.d, [c])).get(c))).toEqual([expect.stringMatching(/^tasks\/task:/)]);
    }
  });

  it('a Contact that already has a reference cannot be removed on either device, and nothing is written', async () => {
    const { A, B, c } = await seededPair();
    await createTask(blankTask({ title: 'Uses the contact', contactIds: [c] }), [], A.d);
    await settle(A, B);
    for (const x of [A, B]) {
      const p = await planContactRemoval(x.d, c, PROVIDERS, TODAY);
      expect(p.eligible).toBe(false);
    }
  });
});
