import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FinanceDB } from '../../db';
import { createDistinctContact, StaleContactError, updateContactDetails } from '../../core/contacts';
import { readContactUsage } from '../../core/contactUsage';
import { createStore } from '../../core/store';
import { encryptText, exportAll, importAll } from '../../lib/backup';
import { buildBackup, checkBackupText, prepareEncryptedRestore, restoreWithSafetyCopy } from '../../lib/backupFile';
import { dexieMeta, RemoteConflict, SyncEngine, type RemoteFile, type RemoteStore } from '../../lib/sync/engine';
import { installTracking } from '../../lib/sync/track';

/** Contacts C1: editing through Ledger's real backup (plain and encrypted), restore and two-device sync engine. Invented data only. */
vi.mock('../../lib/download', () => ({ downloadText: () => undefined }));
let n = 0;
const fresh = () => { const d = new FinanceDB(`test-contacts-c1-${n++}`); installTracking(d); return d; };
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
  const mk = () => { const d = fresh(); return { d, engine: new SyncEngine(d, dexieMeta(`contacts-c1-meta-${n++}`), remote, 'a good passphrase') }; };
  return { A: mk(), B: mk() };
};
type Dev = ReturnType<typeof devices>['A'];
const settle = async (A: Dev, B: Dev) => { for (let i = 0; i < 2; i++) { await A.engine.sync(); await B.engine.sync(); } await A.engine.sync(); };

async function seeded() {
  const { A, B } = devices();
  const id = await createDistinctContact(A.d, { name: 'Jordan Miller', relationship: 'coach', phone: '555-0100' });
  await A.d.contacts.update(id, { notes: 'kept as is', futureField: { a: [1] } } as never);
  await A.engine.initialUpload();
  await B.engine.replaceFromRemote();
  return { A, B, id };
}

describe('Contact edits across two devices (real sync engine)', () => {
  it('different fields edited on each device: ONE whole version wins on both, the other edit is kept in the conflict list and can be read back; unknown fields survive', async () => {
    const { A, B, id } = await seeded();
    await updateContactDetails(A.d, id, { name: 'Jordan Miller', relationship: 'coach', phone: '555-0199' });
    await sleep(5);
    await updateContactDetails(B.d, id, { name: 'Jordan Miller', relationship: 'head coach', phone: '555-0100', email: 'jm@example.com' });
    await settle(A, B);
    const a = (await A.d.contacts.get(id))!;
    const b = (await B.d.contacts.get(id))!;
    expect(JSON.stringify(a)).toBe(JSON.stringify(b)); // converged
    expect(a).toMatchObject({ id, relationship: 'head coach', notes: 'kept as is', futureField: { a: [1] } }); // the later edit won as a whole record
    expect(a.phone).toBe('555-0100'); // A's different-field edit lost with the rest of its version (whole-record last writer wins; Ledger does not merge fields)
    const kept = [...await A.engine.conflicts(), ...await B.engine.conflicts()].filter((c) => c.table === 'contacts' && c.id === String(id));
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.some((c) => (c.lost as { phone?: string } | undefined)?.phone === '555-0199')).toBe(true); // the overwritten version stays recoverable
  });

  it('an UNCHANGED save writes nothing, so it cannot overwrite the other device\'s real edit', async () => {
    const { A, B, id } = await seeded();
    await sleep(5);
    await updateContactDetails(A.d, id, { name: 'Jordan Miller', relationship: 'coach', phone: '555-0199' }); // real edit on A
    await sleep(5);
    // B opens the form and presses Save without changing anything. It is later than A's edit.
    expect(await updateContactDetails(B.d, id, { name: 'Jordan Miller', relationship: 'coach', phone: '555-0100' })).toEqual({ changed: false });
    await settle(A, B);
    for (const x of [A, B]) expect((await x.d.contacts.get(id))!.phone).toBe('555-0199');
    expect([...await A.engine.conflicts(), ...await B.engine.conflicts()].filter((c) => c.table === 'contacts')).toEqual([]);
  });

  it('a stale edit is refused after a sync brings the other device\'s change (the form had been opened before)', async () => {
    const { A, B, id } = await seeded();
    const opened = (await B.d.contacts.get(id))!; // B opens the edit form
    await sleep(5);
    await updateContactDetails(A.d, id, { name: 'Jordan Miller', relationship: 'coach', phone: '555-0199' });
    await settle(A, B); // the change arrives on B while the form is open
    await expect(updateContactDetails(B.d, id, { name: 'Jordan M.', relationship: 'coach', phone: '555-0100' }, { expected: opened })).rejects.toBeInstanceOf(StaleContactError);
    expect((await B.d.contacts.get(id))).toMatchObject({ name: 'Jordan Miller', phone: '555-0199' });
  });

  it('two devices each create a contact with the SAME name: both are kept (never merged), both flagged by the directory rule, and each keeps its own references', async () => {
    const { A, B } = devices();
    await A.engine.initialUpload();
    await B.engine.replaceFromRemote();
    const a = await createDistinctContact(A.d, { name: 'Maria Test', relationship: 'aunt' });
    const b = await createDistinctContact(B.d, { name: 'maria  test', relationship: 'colleague' });
    await A.d.moduleRecords.add({ module: 'tasks', kind: 'task', createdAt: 1, updatedAt: 1, deletedAt: null, data: { contactIds: [a] } } as never);
    await settle(A, B);
    for (const x of [A, B]) {
      const rows = (await x.d.contacts.toArray()).filter((c) => c.name.toLowerCase().replace(/\s+/g, ' ') === 'maria test');
      expect(rows.map((c) => c.id).sort()).toEqual([a, b].sort());
      expect(rows.map((c) => c.relationship).sort()).toEqual(['aunt', 'colleague']);
      const u = await readContactUsage(x.d);
      expect(u.byContact.get(a)?.map((e) => e.module)).toEqual(['tasks']);
      expect(u.byContact.get(b)).toBeUndefined();
    }
  });

  it('a rename keeps the id, so a Task, a Calendar event and a Family record still point at the same Contact on both devices', async () => {
    const { A, B, id } = await seeded();
    await A.d.moduleRecords.bulkAdd([
      { module: 'tasks', kind: 'task', createdAt: 1, updatedAt: 1, deletedAt: null, data: { contactIds: [id] } },
      { module: 'calendar', kind: 'event', createdAt: 1, updatedAt: 1, deletedAt: null, data: { contactIds: [id] } },
      { module: 'family', kind: 'member', createdAt: 1, updatedAt: 1, deletedAt: null, data: { contactId: id, role: 'parent', status: 'active' } },
    ] as never);
    await settle(A, B);
    await updateContactDetails(A.d, id, { name: 'Jordan Millar', relationship: 'coach', phone: '555-0100' });
    await settle(A, B);
    for (const x of [A, B]) {
      expect((await x.d.contacts.get(id))!.name).toBe('Jordan Millar');
      const u = await readContactUsage(x.d);
      expect(u.byContact.get(id)!.map((e) => `${e.module}/${e.kind}`)).toEqual(['family/member', 'tasks/task', 'calendar/event']);
      expect(await x.d.contacts.count()).toBe(1);
    }
  });
});

describe('Contact edits in backups', () => {
  it('a plain backup restores an edited Contact exactly: same id, created time, unknown fields and notes', async () => {
    const { A, id } = await seeded();
    await updateContactDetails(A.d, id, { name: 'Jordan Millar', relationship: 'coach', phone: '555-0100', email: 'jm@example.com' });
    const strip = (c: unknown) => { const { updatedAt, ...rest } = c as Record<string, unknown>; void updatedAt; return JSON.stringify(rest); }; // a restore re-stamps every record so it wins over older copies elsewhere
    const before = strip(await A.d.contacts.get(id));
    const { file } = checkBackupText(JSON.stringify(await exportAll(A.d)));
    const C = fresh();
    await importAll(C, file);
    expect(strip(await C.contacts.get(id))).toBe(before);
    expect(await C.contacts.get(id)).toMatchObject({ notes: 'kept as is', futureField: { a: [1] } });
  });

  it('an encrypted backup does not show the names, and restores through the real safety sequence', async () => {
    const { A, id } = await seeded();
    await updateContactDetails(A.d, id, { name: 'Jordan Millar', relationship: 'coach', phone: '555-0100' });
    const text = await encryptText(JSON.stringify(await buildBackup(A.d, mem())), 'a good passphrase');
    expect(text).not.toContain('Jordan');
    const target = fresh();
    await createStore(target).shared.contacts.put({ name: 'Existing before restore' } as never);
    const { file } = await prepareEncryptedRestore(text, 'a good passphrase');
    await restoreWithSafetyCopy(target, file, { saveCopy: async () => 'copy', storage: mem() });
    expect(await target.contacts.get(id)).toMatchObject({ name: 'Jordan Millar', notes: 'kept as is' });
  }, 30000);

  it('still no new table: Dexie is v15 and the module added no store', () => {
    const d = fresh();
    expect(d.verno).toBe(15);
    expect(d.tables.map((t) => t.name)).not.toContain('contactDirectory');
  });
});
