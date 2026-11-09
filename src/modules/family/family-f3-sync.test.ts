import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FinanceDB } from '../../db';
import { createStore } from '../../core/store';
import { encryptText, exportAll, importAll } from '../../lib/backup';
import { buildBackup, checkBackupText, prepareEncryptedRestore, restoreWithSafetyCopy } from '../../lib/backupFile';
import { summarizeBackup } from '../../lib/backupSummary';
import { dexieMeta, RemoteConflict, SyncEngine, type RemoteFile, type RemoteStore } from '../../lib/sync/engine';
import { installTracking } from '../../lib/sync/track';
import { createMember, getMember } from './data';
import { addImportantContact, loadImportantContacts, setImportantContactStatus, updateImportantContactPurpose } from './importantContactData';
import { activeFor, duplicateAssociations } from './importantContactModel';

/** F3: important-contact associations through Ledger's real backup (plain and encrypted), restore and two-device sync engine. Invented data only. */
vi.mock('../../lib/download', () => ({ downloadText: () => undefined }));
let n = 0;
const fresh = () => { const d = new FinanceDB(`test-family-f3-sync-${n++}`); installTracking(d); return d; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const kid = { role: 'child' as const, status: 'active' as const };
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
  const mk = () => { const d = fresh(); return { d, engine: new SyncEngine(d, dexieMeta(`family-f3-meta-${n++}`), remote, 'a good passphrase') }; };
  return { A: mk(), B: mk() };
};
type Dev = ReturnType<typeof devices>['A'];
const settle = async (A: Dev, B: Dev) => { for (let i = 0; i < 2; i++) { await A.engine.sync(); await B.engine.sync(); } await A.engine.sync(); };
const everywhere = (xs: Dev[], check: (d: FinanceDB) => Promise<void>) => Promise.all(xs.map((x) => check(x.d)));
const add = (d: FinanceDB, memberId: number, contactId: number, purpose: string) => addImportantContact({ memberId, contact: { mode: 'existing', contactId }, purpose }, d);

/** Device A holds a member, and three plain contacts; both devices have them. */
async function seeded() {
  const { A, B } = devices();
  const s = createStore(A.d).shared.contacts;
  const sam = await s.put({ name: 'Sam Example' } as never);
  const school = await s.put({ name: 'Example Elementary Office', phone: '555-0100' } as never);
  const coach = await s.put({ name: 'Coach Example' } as never);
  const { id: memberId } = await createMember({ contact: { mode: 'existing', contactId: sam }, fields: { ...kid, note: 'Private note text.' } }, A.d, 2026);
  await A.engine.initialUpload();
  await B.engine.replaceFromRemote();
  return { A, B, sam, school, coach, memberId };
}

describe('important contacts across two devices (real sync engine)', () => {
  it('still no new table: Dexie is v15 and the association is an ordinary moduleRecords row', async () => {
    const d = fresh();
    expect(d.verno).toBe(15);
    expect(d.tables.map((t) => t.name)).not.toContain('family');
    expect(d.tables.map((t) => t.name)).not.toContain('importantContacts');
  });

  it('two devices each add a DIFFERENT contact for the same member while offline: after sync both associations are on both devices', async () => {
    const { A, B, school, coach, memberId } = await seeded();
    const a = await add(A.d, memberId, school, 'School office');
    const b = await add(B.d, memberId, coach, 'Soccer coach');
    expect(a.id).not.toBe(b.id);
    await settle(A, B);
    await everywhere([A, B], async (d) => {
      const mine = activeFor(await loadImportantContacts(d), memberId);
      expect(mine.map((r) => [r.data!.contactId, r.data!.purpose]).sort()).toEqual([[school, 'School office'], [coach, 'Soccer coach']].sort());
      expect(duplicateAssociations(mine)).toEqual([]);
      expect((await getMember(memberId, d))!.data!.note).toBe('Private note text.'); // the member is untouched
      expect(await d.contacts.count()).toBe(3); // no contact merged, added or lost
    });
  });

  it('two devices add the SAME association: both records are kept and flagged, nothing is merged or deleted; removing one is a plain archive', async () => {
    const { A, B, school, memberId } = await seeded();
    const a = await add(A.d, memberId, school, 'School office');
    const b = await add(B.d, memberId, school, 'School office');
    await settle(A, B);
    await everywhere([A, B], async (d) => {
      const all = await loadImportantContacts(d);
      expect(all.map((r) => r.id).sort()).toEqual([a.id, b.id].sort());
      expect(duplicateAssociations(all).map((g) => g.map((r) => r.id))).toEqual([[a.id, b.id].sort()]);
    });
    await setImportantContactStatus(Math.max(a.id, b.id), 'archived', A.d);
    await settle(A, B);
    await everywhere([A, B], async (d) => {
      expect(duplicateAssociations(await loadImportantContacts(d))).toEqual([]);
      expect(await loadImportantContacts(d)).toHaveLength(2);
      expect(await d.contacts.get(school)).toBeDefined();
    });
  });

  it('removing on A and changing the purpose on B converge to ONE record on both devices; the Contact is never lost', async () => {
    const { A, B, school, memberId } = await seeded();
    const { id } = await add(A.d, memberId, school, 'School office');
    await settle(A, B);
    await setImportantContactStatus(id, 'archived', A.d);
    await sleep(15);
    await updateImportantContactPurpose(id, 'Front desk', B.d);
    await settle(A, B);
    const seen = await Promise.all([A, B].map(async (x) => JSON.stringify((await loadImportantContacts(x.d)).map((r) => r.data))));
    expect(seen[0]).toBe(seen[1]);
    await everywhere([A, B], async (d) => { expect(await loadImportantContacts(d)).toHaveLength(1); expect(await d.contacts.get(school)).toBeDefined(); });
  });

  it('a new Contact made through the flow arrives with its association, as a separate Contact', async () => {
    const { A, B, memberId } = await seeded();
    const made = await addImportantContact({ memberId, contact: { mode: 'new', name: 'Example Elementary Office' }, purpose: 'Second office' }, A.d);
    await settle(A, B);
    await everywhere([A, B], async (d) => {
      expect((await d.contacts.get(made.contactId))!.name).toBe('Example Elementary Office');
      expect((await d.contacts.toArray()).filter((c) => c.name === 'Example Elementary Office')).toHaveLength(2); // never merged by name
      expect(activeFor(await loadImportantContacts(d), memberId).map((r) => r.data!.contactId)).toEqual([made.contactId]);
    });
  });

  it('a record from a newer build (unknown fields) passes through sync untouched and survives an edit here', async () => {
    const { A, B, school, memberId } = await seeded();
    const { id } = await add(A.d, memberId, school, 'School office');
    await A.d.moduleRecords.update(id, { 'data.futureField': { list: [1, 2] } });
    await settle(A, B);
    await updateImportantContactPurpose(id, 'Front desk', B.d);
    await settle(A, B);
    await everywhere([A, B], async (d) => {
      expect((await d.moduleRecords.get(id))!.data).toMatchObject({ futureField: { list: [1, 2] }, purpose: 'Front desk', status: 'active' });
    });
  });
});

describe('important contacts in backups', () => {
  it('a plain backup restores the association and the referenced Contacts exactly, and the summary names them', async () => {
    const { A, school, memberId } = await seeded();
    const { id } = await add(A.d, memberId, school, 'School office');
    const { file } = checkBackupText(JSON.stringify(await exportAll(A.d)));
    const family = summarizeBackup(file).find((g) => g.id === 'family')!;
    expect(family.items).toEqual([{ label: 'Family members', n: 1 }, { label: 'Important contacts', n: 1 }]);
    const C = fresh();
    await importAll(C, file);
    expect((await loadImportantContacts(C)).map((r) => [r.id, r.data])).toEqual([[id, { memberId, contactId: school, purpose: 'School office', status: 'active' }]]);
    expect((await C.contacts.get(school))).toMatchObject({ name: 'Example Elementary Office', phone: '555-0100' });
  });

  it('an encrypted backup shows neither the purpose nor the names in the file, and restores through the real safety sequence', async () => {
    const { A, school, memberId } = await seeded();
    const { id } = await add(A.d, memberId, school, 'Soccer coach');
    const text = await encryptText(JSON.stringify(await buildBackup(A.d, mem())), 'a good passphrase');
    expect(text).not.toContain('Soccer coach');
    expect(text).not.toContain('Example Elementary');
    const target = fresh();
    await createStore(target).shared.contacts.put({ name: 'Existing before restore' } as never);
    const { file } = await prepareEncryptedRestore(text, 'a good passphrase');
    await restoreWithSafetyCopy(target, file, { saveCopy: async () => 'copy', storage: mem() });
    expect((await loadImportantContacts(target)).map((r) => [r.id, r.data!.purpose, r.data!.contactId])).toEqual([[id, 'Soccer coach', school]]);
    expect((await target.contacts.get(school))!.name).toBe('Example Elementary Office');
  }, 30000);

  it('an unreadable association row survives a backup round trip unchanged and is listed, not dropped', async () => {
    const A = fresh();
    const bad = await A.moduleRecords.add({ module: 'family', kind: 'contact', createdAt: 1, updatedAt: 1, deletedAt: null, data: { memberId: 'x', purpose: 5, extra: { keep: true } } } as never) as number;
    const { file } = checkBackupText(JSON.stringify(await exportAll(A)));
    const C = fresh();
    await importAll(C, file);
    expect((await C.moduleRecords.get(bad))!.data).toEqual({ memberId: 'x', purpose: 5, extra: { keep: true } });
    expect((await loadImportantContacts(C)).map((r) => [r.id, r.data])).toEqual([[bad, null]]);
  });
});
