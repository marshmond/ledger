import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FinanceDB } from '../../db';
import { createStore } from '../../core/store';
import { encryptText, exportAll, importAll } from '../../lib/backup';
import { buildBackup, checkBackupText, prepareEncryptedRestore, restoreWithSafetyCopy } from '../../lib/backupFile';
import { summarizeBackup } from '../../lib/backupSummary';
import { dexieMeta, RemoteConflict, SyncEngine, type RemoteFile, type RemoteStore } from '../../lib/sync/engine';
import { installTracking } from '../../lib/sync/track';
import { createMember, getMember, loadMembers, setMemberStatus, updateMember } from './data';
import { duplicateGroups } from './model';

/** F1: Family members through Ledger's real backup (plain and encrypted), restore and two-device sync engine. Invented data only. */
vi.mock('../../lib/download', () => ({ downloadText: () => undefined }));
let n = 0;
const fresh = () => { const d = new FinanceDB(`test-family-sync-${n++}`); installTracking(d); return d; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const YEAR = 2026;
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
  const mk = () => { const d = fresh(); return { d, engine: new SyncEngine(d, dexieMeta(`family-meta-${n++}`), remote, 'a good passphrase') }; };
  return { A: mk(), B: mk() };
};
type Dev = ReturnType<typeof devices>['A'];
const settle = async (A: Dev, B: Dev) => { for (let i = 0; i < 2; i++) { await A.engine.sync(); await B.engine.sync(); } await A.engine.sync(); };
const everywhere = (xs: Dev[], check: (d: FinanceDB) => Promise<void>) => Promise.all(xs.map((x) => check(x.d)));

async function seeded() {
  const { A, B } = devices();
  const cid = await createStore(A.d).shared.contacts.put({ name: 'Sam Example', relationship: 'son' } as never);
  const { id } = await createMember({ contact: { mode: 'existing', contactId: cid }, fields: { ...kid, birthMonthDay: '05-14', color: '#4a7bd0', note: 'Private note text.' } }, A.d, YEAR);
  await A.engine.initialUpload();
  await B.engine.replaceFromRemote();
  return { A, B, cid, id };
}

describe('Family members across two devices (real sync engine)', () => {
  it('no new table and no schema change: Dexie is still v15', () => {
    const d = fresh();
    expect(d.verno).toBe(15);
    expect(d.tables.map((t) => t.name)).not.toContain('family');
  });

  it('a member, its contact and its private note arrive on the second device', async () => {
    const { A, B, cid, id } = await seeded();
    await everywhere([A, B], async (d) => {
      expect((await getMember(id, d))!.data).toEqual({ contactId: cid, role: 'child', status: 'active', birthMonthDay: '05-14', color: '#4a7bd0', note: 'Private note text.' });
      expect((await d.contacts.get(cid))!.name).toBe('Sam Example');
    });
  });

  it('marking past on A and editing the profile on B converges to one record; nothing else is lost', async () => {
    const { A, B, id } = await seeded();
    await setMemberStatus(id, 'past', A.d);
    await sleep(15);
    await updateMember(id, { role: 'child', status: 'active', birthMonthDay: '05-15' }, B.d, YEAR);
    await settle(A, B);
    const seen = await Promise.all([A, B].map(async (x) => JSON.stringify((await getMember(id, x.d))!.data)));
    expect(seen[0]).toBe(seen[1]); // converged (whole-record, newest edit wins; the other edit is in Ledger's conflict list)
    await everywhere([A, B], async (d) => expect(await loadMembers(d)).toHaveLength(1));
  });

  it('two devices each add the SAME contact while offline: after sync BOTH records are kept and flagged, nothing is merged or deleted', async () => {
    const { A, B, cid } = await seeded();
    // B already has the first member from the seed; make the "other device" case from a contact that has none yet
    const cid2 = await createStore(A.d).shared.contacts.put({ name: 'Robin Example' } as never);
    await settle(A, B);
    const ra = await createMember({ contact: { mode: 'existing', contactId: cid2 }, fields: kid }, A.d, YEAR);
    const rb = await createMember({ contact: { mode: 'existing', contactId: cid2 }, fields: { ...kid, role: 'other' } }, B.d, YEAR);
    expect(ra.id).not.toBe(rb.id);
    await settle(A, B);
    await everywhere([A, B], async (d) => {
      const all = await loadMembers(d);
      const mine = all.filter((m) => m.data?.contactId === cid2);
      expect(mine.map((m) => m.id).sort()).toEqual([ra.id, rb.id].sort());
      const groups = duplicateGroups(all);
      expect(groups).toHaveLength(1);
      expect(groups[0].map((m) => m.id).sort()).toEqual([ra.id, rb.id].sort());
      expect(all.filter((m) => m.data?.contactId === cid)).toHaveLength(1); // the unrelated member is untouched
      expect(await d.contacts.count()).toBe(2); // no contact merged or removed
    });
    // the owner clears it by marking one past: no deletion anywhere
    await setMemberStatus(ra.id, 'past', A.d);
    await settle(A, B);
    await everywhere([A, B], async (d) => { expect(duplicateGroups(await loadMembers(d))).toEqual([]); expect(await loadMembers(d)).toHaveLength(3); });
  });

  it('a record from a newer build (unknown fields, an unknown kind) passes through sync untouched and survives an edit here', async () => {
    const { A, B, id } = await seeded();
    await A.d.moduleRecords.update(id, { 'data.futureField': { list: [1, 2] } });
    const futureKind = await A.d.moduleRecords.add({ module: 'family', kind: 'date', createdAt: 1, updatedAt: 1, deletedAt: null, data: { label: 'Anniversary', monthDay: '06-01' } } as never) as number;
    await settle(A, B);
    await updateMember(id, { role: 'parent', status: 'active' }, B.d, YEAR);
    await settle(A, B);
    await everywhere([A, B], async (d) => {
      expect((await d.moduleRecords.get(id))!.data).toMatchObject({ futureField: { list: [1, 2] }, role: 'parent' });
      expect((await d.moduleRecords.get(futureKind))!.data).toEqual({ label: 'Anniversary', monthDay: '06-01' });
      expect((await loadMembers(d)).map((m) => m.id)).toEqual([id]); // an unknown KIND is not listed as a member, and not dropped
    });
  });
});

describe('Family members in backups', () => {
  it('a plain backup restores members exactly, and the summary names them', async () => {
    const { A, cid, id } = await seeded();
    const text = JSON.stringify(await exportAll(A.d));
    const { file, summary } = checkBackupText(text);
    const family = summarizeBackup(file).find((g) => g.id === 'family')!;
    expect(family.items).toEqual([{ label: 'Family members', n: 1 }]);
    expect(summary).toBeDefined();
    const C = fresh();
    await importAll(C, file);
    expect((await getMember(id, C))!.data).toMatchObject({ contactId: cid, note: 'Private note text.' });
    expect((await C.contacts.get(cid))!.name).toBe('Sam Example');
  });

  it('an encrypted backup does not show the note or the name in the file, and restores it all through the real safety sequence', async () => {
    const { A, cid, id } = await seeded();
    const text = await encryptText(JSON.stringify(await buildBackup(A.d, mem())), 'a good passphrase');
    expect(text).not.toContain('Private note text.');
    expect(text).not.toContain('Sam Example');
    const target = fresh();
    await createStore(target).shared.contacts.put({ name: 'Existing before restore' } as never);
    const { file } = await prepareEncryptedRestore(text, 'a good passphrase');
    await restoreWithSafetyCopy(target, file, { saveCopy: async () => 'copy', storage: mem() });
    expect((await getMember(id, target))!.data).toMatchObject({ contactId: cid, role: 'child', note: 'Private note text.' });
    expect((await target.contacts.toArray()).map((c) => c.name)).toEqual(['Sam Example']);
  }, 30000);

  it('an unreadable member row and an unknown family kind survive a backup round trip unchanged', async () => {
    const A = fresh();
    const bad = await A.moduleRecords.add({ module: 'family', kind: 'member', createdAt: 1, updatedAt: 1, deletedAt: null, data: { contactId: 'x', role: 'wizard', extra: { keep: true } } } as never) as number;
    const other = await A.moduleRecords.add({ module: 'family', kind: 'school', createdAt: 1, updatedAt: 1, deletedAt: null, data: { name: 'Future thing' } } as never) as number;
    const { file } = checkBackupText(JSON.stringify(await exportAll(A)));
    const C = fresh();
    await importAll(C, file);
    expect((await C.moduleRecords.get(bad))!.data).toEqual({ contactId: 'x', role: 'wizard', extra: { keep: true } });
    expect((await C.moduleRecords.get(other))!.data).toEqual({ name: 'Future thing' });
    expect((await loadMembers(C)).map((m) => [m.id, m.data])).toEqual([[bad, null]]);
  });
});
