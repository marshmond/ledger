import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FinanceDB } from '../../db';
import { createStore } from '../../core/store';
import { exportAll, importAll } from '../../lib/backup';
import { checkBackupText } from '../../lib/backupFile';
import { dexieMeta, RemoteConflict, SyncEngine, type RemoteFile, type RemoteStore } from '../../lib/sync/engine';
import { installTracking } from '../../lib/sync/track';
import { createMember, getMember, loadMembers, setMe, setMemberStatus, updateMember } from './data';
import { asMember, cleanFields, effectiveMe, ROLES, ROLE_LABEL, validateFields } from './model';

/** Contacts C1: the Spouse role and the "This is me" designation, including two real devices. Invented data only. */
vi.mock('../../lib/download', () => ({ downloadText: () => undefined }));
let n = 0;
const fresh = () => { const d = new FinanceDB(`test-family-c1-${n++}`); installTracking(d); return d; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }; };
beforeEach(() => { vi.stubGlobal('localStorage', mem()); });
const YEAR = 2026;
const adult = { role: 'parent' as const, status: 'active' as const };

async function household(d: FinanceDB) {
  const s = createStore(d).shared.contacts;
  const ids = [await s.put({ name: 'Alex Example', phone: '555-0101' } as never), await s.put({ name: 'Sam Example' } as never), await s.put({ name: 'Riley Example' } as never)];
  const members: number[] = [];
  for (const [i, c] of ids.entries()) members.push((await createMember({ contact: { mode: 'existing', contactId: c }, fields: i === 2 ? { role: 'child', status: 'active' } : adult }, d, YEAR)).id);
  return { contacts: ids, members };
}
const snapshotContacts = async (d: FinanceDB) => JSON.stringify(await d.contacts.toArray());
const flags = async (d: FinanceDB) => (await loadMembers(d)).map((m) => [m.id, m.data?.isMe === true] as const);

describe('Spouse role', () => {
  it('is a standard role, labelled, valid in the model, and the older roles are unchanged', () => {
    expect(ROLES).toEqual(['parent', 'spouse', 'child', 'grandparent', 'other']);
    expect(ROLE_LABEL.spouse).toBe('Spouse');
    expect(validateFields({ role: 'spouse', status: 'active' }, YEAR)).toBeNull();
    for (const r of ['parent', 'child', 'grandparent', 'other'] as const) expect(validateFields({ role: r, status: 'active' }, YEAR)).toBeNull();
    expect(validateFields({ role: 'partner' as never, status: 'active' }, YEAR)).toMatch(/role/);
  });

  it('can be chosen when adding and when editing; the Contact (id and relationship text) is not touched', async () => {
    const d = fresh();
    const c = await createStore(d).shared.contacts.put({ name: 'Sam Example', relationship: 'friend' } as never);
    const before = await snapshotContacts(d);
    const { id } = await createMember({ contact: { mode: 'existing', contactId: c }, fields: { role: 'other', status: 'active' } }, d, YEAR);
    await updateMember(id, { role: 'spouse', status: 'active' }, d, YEAR);
    const m = (await getMember(id, d))!;
    expect(m.data).toMatchObject({ role: 'spouse', contactId: c });
    expect(await snapshotContacts(d)).toBe(before);
  });

  it('existing records keep their role; a spouse record keeps unknown fields through an edit', async () => {
    const d = fresh();
    const { members } = await household(d);
    expect((await loadMembers(d)).map((m) => m.data!.role)).toEqual(['parent', 'parent', 'child']); // nothing was re-roled
    await d.moduleRecords.update(members[1], { 'data.role': 'spouse', 'data.futureField': { keep: [1, 2] } });
    await updateMember(members[1], { role: 'spouse', status: 'active', note: 'hello' }, d, YEAR);
    expect((await d.moduleRecords.get(members[1]))!.data).toMatchObject({ role: 'spouse', note: 'hello', futureField: { keep: [1, 2] } });
  });
});

describe('"This is me": the model', () => {
  it('is stored only when true, ignored when false or damaged, and never kept for a past member', () => {
    const base = { id: 1, module: 'family', kind: 'member', createdAt: 1, updatedAt: 1, deletedAt: null };
    expect(asMember({ ...base, data: { contactId: 5, role: 'parent', status: 'active', isMe: true } } as never, YEAR).data!.isMe).toBe(true);
    expect(asMember({ ...base, data: { contactId: 5, role: 'parent', status: 'active', isMe: false } } as never, YEAR).data!.isMe).toBeUndefined();
    const bad = asMember({ ...base, data: { contactId: 5, role: 'parent', status: 'active', isMe: 'yes' } } as never, YEAR);
    expect(bad.data!.isMe).toBeUndefined();
    expect(bad.problems.join(' ')).toMatch(/This is me/);
    expect(cleanFields({ role: 'parent', status: 'past', isMe: true })).not.toHaveProperty('isMe');
    expect(cleanFields({ role: 'parent', status: 'active', isMe: true })).toMatchObject({ isMe: true });
    expect(cleanFields({ role: 'parent', status: 'active' })).not.toHaveProperty('isMe');
  });

  it('effectiveMe: none marked = nobody; one active marked = that member; a past member is never me; two marked = a conflict and nobody is me', () => {
    const m = (id: number, status: 'active' | 'past', isMe?: boolean) => asMember({ id, module: 'family', kind: 'member', createdAt: id, updatedAt: 1, deletedAt: null, data: { contactId: id, role: 'parent', status, ...(isMe ? { isMe } : {}) } } as never, YEAR);
    expect(effectiveMe([m(1, 'active'), m(2, 'active')])).toEqual({ me: null, conflict: [] });
    expect(effectiveMe([m(1, 'active', true), m(2, 'active')]).me?.id).toBe(1);
    expect(effectiveMe([m(1, 'past', true), m(2, 'active')])).toEqual({ me: null, conflict: [] });
    const two = effectiveMe([m(2, 'active', true), m(1, 'active', true), m(3, 'active')]);
    expect(two.me).toBeNull();
    expect(two.conflict.map((x) => x.id)).toEqual([1, 2]);
  });
});

describe('"This is me": choosing, switching and clearing on one device', () => {
  it('nobody is chosen automatically, not even the first or the only member', async () => {
    const d = fresh();
    const c = await createStore(d).shared.contacts.put({ name: 'Alex Example' } as never);
    await createMember({ contact: { mode: 'existing', contactId: c }, fields: adult }, d, YEAR);
    expect(effectiveMe(await loadMembers(d)).me).toBeNull();
  });

  it('assign, switch (the old mark is cleared in the same step) and clear; unrelated fields and every Contact are untouched', async () => {
    const d = fresh();
    const { members } = await household(d);
    await updateMember(members[0], { ...adult, note: 'Private text', color: '#4a7bd0' }, d, YEAR);
    const contactsBefore = await snapshotContacts(d);
    const otherBefore = JSON.stringify(await d.moduleRecords.get(members[2]));

    expect(await setMe(members[0], d)).toEqual({ written: 1 });
    expect(await flags(d)).toEqual([[members[0], true], [members[1], false], [members[2], false]]);
    expect((await getMember(members[0], d))!.data).toMatchObject({ note: 'Private text', color: '#4a7bd0', role: 'parent' });

    expect(await setMe(members[1], d)).toEqual({ written: 2 }); // the new one set, the old one cleared
    expect(await flags(d)).toEqual([[members[0], false], [members[1], true], [members[2], false]]);
    expect(effectiveMe(await loadMembers(d)).me?.id).toBe(members[1]);
    expect((await getMember(members[0], d))!.data).toMatchObject({ note: 'Private text', color: '#4a7bd0' });

    expect(await setMe(members[1], d)).toEqual({ written: 0 }); // already the case: no write
    expect(await setMe(null, d)).toEqual({ written: 1 });
    expect(await flags(d)).toEqual([[members[0], false], [members[1], false], [members[2], false]]);
    expect(await setMe(null, d)).toEqual({ written: 0 });

    expect(await snapshotContacts(d)).toBe(contactsBefore);
    expect(JSON.stringify(await d.moduleRecords.get(members[2]))).toBe(otherBefore);
  });

  it('there is never a moment with two marks on one device: a concurrent switch ends with exactly one', async () => {
    const d = fresh();
    const { members } = await household(d);
    await Promise.all([setMe(members[0], d), setMe(members[1], d), setMe(members[2], d)]);
    expect((await flags(d)).filter(([, me]) => me)).toHaveLength(1);
    expect(effectiveMe(await loadMembers(d)).conflict).toEqual([]);
  });

  it('refuses a past, unreadable or missing member without writing; a past member loses the mark when made past, and does not regain it when brought back', async () => {
    const d = fresh();
    const { members } = await household(d);
    await setMe(members[0], d);
    const bad = await d.moduleRecords.add({ module: 'family', kind: 'member', createdAt: 1, updatedAt: 1, deletedAt: null, data: { contactId: 'x', role: 'wizard', isMe: true, keep: 1 } } as never) as number;
    await expect(setMe(bad, d)).rejects.toThrow(/could not be read/);
    await expect(setMe(987, d)).rejects.toThrow(/no longer exists/);
    await setMemberStatus(members[0], 'past', d);
    expect((await d.moduleRecords.get(members[0]))!.data).not.toHaveProperty('isMe');
    expect(effectiveMe(await loadMembers(d)).me).toBeNull();
    await expect(setMe(members[0], d)).rejects.toThrow(/in the household/);
    await setMemberStatus(members[0], 'active', d);
    expect(effectiveMe(await loadMembers(d)).me).toBeNull(); // not silently me again
    // an unreadable row is never rewritten, even by a switch
    await setMe(members[1], d);
    expect((await d.moduleRecords.get(bad))!.data).toEqual({ contactId: 'x', role: 'wizard', isMe: true, keep: 1 });
  });

  it('editing the profile keeps the mark; unknown fields stay', async () => {
    const d = fresh();
    const { members } = await household(d);
    await setMe(members[0], d);
    await d.moduleRecords.update(members[0], { 'data.futureField': 'x' });
    await updateMember(members[0], { ...adult, note: 'edited' }, d, YEAR);
    expect((await d.moduleRecords.get(members[0]))!.data).toMatchObject({ isMe: true, note: 'edited', futureField: 'x' });
  });

  it('a mark left on a past member by an older build is ignored on read and never rewritten by reading', async () => {
    const d = fresh();
    const { members } = await household(d);
    await d.moduleRecords.update(members[0], { 'data.status': 'past', 'data.isMe': true });
    const before = JSON.stringify(await d.moduleRecords.toArray());
    expect(effectiveMe(await loadMembers(d)).me).toBeNull();
    expect(JSON.stringify(await d.moduleRecords.toArray())).toBe(before);
  });
});

// ---- two devices ----
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
  const mk = () => { const d = fresh(); return { d, engine: new SyncEngine(d, dexieMeta(`family-c1-meta-${n++}`), remote, 'a good passphrase') }; };
  return { A: mk(), B: mk() };
};
type Dev = ReturnType<typeof devices>['A'];
const settle = async (A: Dev, B: Dev) => { for (let i = 0; i < 2; i++) { await A.engine.sync(); await B.engine.sync(); } await A.engine.sync(); };
async function twoDevices() {
  const { A, B } = devices();
  const h = await household(A.d);
  await A.engine.initialUpload();
  await B.engine.replaceFromRemote();
  return { A, B, ...h };
}

describe('"This is me" across two devices (real sync engine)', () => {
  it('one device chooses: the other sees it, with no conflict', async () => {
    const { A, B, members } = await twoDevices();
    await setMe(members[0], A.d);
    await settle(A, B);
    for (const x of [A, B]) expect(effectiveMe(await loadMembers(x.d)).me?.id).toBe(members[0]);
  });

  it('two devices each choose a DIFFERENT member while offline: both records survive, both devices see the same conflict, nobody is treated as me, nothing is rewritten by reading', async () => {
    const { A, B, members } = await twoDevices();
    await setMe(members[0], A.d);
    await sleep(5);
    await setMe(members[1], B.d);
    await settle(A, B);
    const seenBefore = await Promise.all([A, B].map(async (x) => JSON.stringify(await d_all(x.d))));
    for (const x of [A, B]) {
      const st = effectiveMe(await loadMembers(x.d));
      expect(st.me).toBeNull();
      expect(st.conflict.map((m) => m.id)).toEqual([members[0], members[1]]);
      expect(await x.d.moduleRecords.where('module').equals('family').count()).toBe(3); // no member lost
      expect(await x.d.contacts.count()).toBe(3); // no Contact lost
    }
    expect(seenBefore[0]).toBe(seenBefore[1]); // both devices converge to the same data
    // looking at the conflict wrote nothing
    expect(JSON.stringify(await d_all(A.d))).toBe(seenBefore[0]);
  });

  it('the owner resolves it by choosing again: exactly one mark remains on both devices, and it stays resolved', async () => {
    const { A, B, members } = await twoDevices();
    await setMe(members[0], A.d);
    await sleep(5);
    await setMe(members[1], B.d);
    await settle(A, B);
    await sleep(5);
    expect((await setMe(members[1], A.d)).written).toBe(1); // only the other mark is removed; the chosen one already has it
    await settle(A, B);
    for (const x of [A, B]) {
      const st = effectiveMe(await loadMembers(x.d));
      expect(st.conflict).toEqual([]);
      expect(st.me?.id).toBe(members[1]);
      expect((await flags(x.d)).filter(([, me]) => me)).toHaveLength(1);
    }
  });

  it('a stale profile edit on one device against a switch on the other is flagged, not silently resolved', async () => {
    const { A, B, members } = await twoDevices();
    await setMe(members[0], A.d);
    await settle(A, B);
    await sleep(5);
    await setMe(members[1], A.d); // A moves the mark to member 1 (member 0 is cleared)
    await sleep(5);
    await updateMember(members[0], { ...adult, note: 'edited later on B' }, B.d, YEAR); // B edits member 0 while still seeing it marked, later than A
    await settle(A, B);
    for (const x of [A, B]) {
      const st = effectiveMe(await loadMembers(x.d));
      expect(st.me).toBeNull();
      expect(st.conflict.map((m) => m.id)).toEqual([members[0], members[1]]);
    }
  });

  it('Spouse and the mark pass through sync, and a record from a newer build keeps its unknown fields', async () => {
    const { A, B, members } = await twoDevices();
    await updateMember(members[1], { role: 'spouse', status: 'active' }, A.d, YEAR);
    await A.d.moduleRecords.update(members[1], { 'data.futureField': { n: [1] } });
    await setMe(members[1], A.d);
    await settle(A, B);
    expect((await B.d.moduleRecords.get(members[1]))!.data).toMatchObject({ role: 'spouse', isMe: true, futureField: { n: [1] } });
    await setMe(members[0], B.d);
    await settle(A, B);
    expect((await A.d.moduleRecords.get(members[1]))!.data).toMatchObject({ role: 'spouse', futureField: { n: [1] } });
    expect((await A.d.moduleRecords.get(members[1]))!.data).not.toHaveProperty('isMe');
  });
});
const d_all = async (d: FinanceDB) => ({ members: await d.moduleRecords.toArray(), contacts: await d.contacts.toArray() });

describe('"This is me" and Spouse in backups', () => {
  it('a plain backup restores them exactly (same keys, same values)', async () => {
    const d = fresh();
    const { members } = await household(d);
    await updateMember(members[1], { role: 'spouse', status: 'active' }, d, YEAR);
    await setMe(members[1], d);
    await d.moduleRecords.update(members[1], { 'data.futureField': 7 });
    const { file } = checkBackupText(JSON.stringify(await exportAll(d)));
    const C = fresh();
    await importAll(C, file);
    expect((await C.moduleRecords.get(members[1]))!.data).toMatchObject({ role: 'spouse', isMe: true, futureField: 7 });
    expect(effectiveMe(await loadMembers(C)).me?.id).toBe(members[1]);
  });
});
