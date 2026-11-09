import { describe, expect, it, vi } from 'vitest';
import { FinanceDB } from '../../db';
import { createStore } from '../../core/store';
import { findOrCreateContact } from '../../core/contacts';
import { installTracking } from '../../lib/sync/track';
import { createTask } from '../tasks/data';
import { blankTask } from '../tasks/model';
import { createEvent } from '../calendar/data';
import { blankFields } from '../calendar/model';
import { createProject } from '../projects/data';
import { blankProject } from '../projects/model';
import { createMember, getMember, loadMembers, setMemberStatus, updateMember } from './data';
import { duplicateGroups, MODULE } from './model';
import { countReferences, readContactReferences, referenceLines } from './references';

/** F1: creating, linking, editing and archiving members against a real (in-memory) database. All names are invented. */
let n = 0;
const fresh = () => { const d = new FinanceDB(`test-family-${n++}`); installTracking(d); return d; };
const YEAR = 2026;
const kid = { role: 'child' as const, status: 'active' as const };
const contactsOf = async (d: FinanceDB) => (await d.contacts.toArray()).filter((c) => c.deletedAt == null);
const addContact = (d: FinanceDB, name: string, extra: object = {}) => createStore(d).shared.contacts.put({ name, ...extra } as never);

describe('create and read', () => {
  it('links an EXISTING contact without changing it by a single byte', async () => {
    const d = fresh();
    const cid = await addContact(d, 'Sam Example', { phone: '555-0100', relationship: 'son', futureField: { keep: 1 } });
    const before = JSON.stringify(await d.contacts.get(cid));
    const r = await createMember({ contact: { mode: 'existing', contactId: cid }, fields: { ...kid, birthMonthDay: '05-14', birthYear: 2016, color: '#4a7bd0', note: 'Allergic to nothing we know of.' } }, d, YEAR);
    expect(r).toMatchObject({ contactId: cid, createdContact: false });
    expect(JSON.stringify(await d.contacts.get(cid))).toBe(before);
    expect(await d.contacts.count()).toBe(1);
    const m = (await getMember(r.id, d))!;
    expect(m.data).toEqual({ contactId: cid, role: 'child', status: 'active', birthMonthDay: '05-14', birthYear: 2016, color: '#4a7bd0', note: 'Allergic to nothing we know of.' });
    const stored = await d.moduleRecords.get(r.id);
    expect(stored).toMatchObject({ module: MODULE, kind: 'member' });
    expect(Object.keys(stored!.data).sort()).toEqual(['birthMonthDay', 'birthYear', 'color', 'contactId', 'note', 'role', 'status']); // no copied name, phone or email
  });

  it('creates a NEW contact only when asked, and the member points at it', async () => {
    const d = fresh();
    const r = await createMember({ contact: { mode: 'new', name: '  Robin   Example ' }, fields: kid }, d, YEAR);
    expect(r.createdContact).toBe(true);
    const cs = await contactsOf(d);
    expect(cs).toHaveLength(1);
    expect(cs[0]).toMatchObject({ id: r.contactId, name: 'Robin Example' });
    expect((await getMember(r.id, d))!.data!.contactId).toBe(r.contactId);
  });

  it('a new contact with the SAME NAME as an existing one is a separate person: nothing is reused, merged or overwritten', async () => {
    const d = fresh();
    const existing = await addContact(d, 'Alex Example', { phone: '555-0111', relationship: 'uncle' });
    const before = JSON.stringify(await d.contacts.get(existing));
    const r = await createMember({ contact: { mode: 'new', name: 'alex example' }, fields: kid }, d, YEAR);
    expect(r.contactId).not.toBe(existing);
    expect(await contactsOf(d)).toHaveLength(2);
    expect(JSON.stringify(await d.contacts.get(existing))).toBe(before);
    // contrast: the existing name-matching helper WOULD have merged them, which is exactly why Family does not use it
    const merged = await findOrCreateContact(d, { name: 'alex example' });
    expect(merged.created).toBe(false);
  });

  it('refuses a contact that is missing or removed, and a blank new name, creating nothing', async () => {
    const d = fresh();
    await expect(createMember({ contact: { mode: 'existing', contactId: 999 }, fields: kid }, d, YEAR)).rejects.toThrow(/no longer exists/);
    const gone = await addContact(d, 'Gone');
    await createStore(d).shared.contacts.remove(gone);
    await expect(createMember({ contact: { mode: 'existing', contactId: gone }, fields: kid }, d, YEAR)).rejects.toThrow(/no longer exists/);
    await expect(createMember({ contact: { mode: 'new', name: '   ' }, fields: kid }, d, YEAR)).rejects.toThrow(/name/i);
    expect(await d.moduleRecords.count()).toBe(0);
    expect(await d.contacts.count()).toBe(1);
  });

  it('refuses invalid fields before touching anything', async () => {
    const d = fresh();
    await expect(createMember({ contact: { mode: 'new', name: 'Pat' }, fields: { ...kid, birthMonthDay: '02-30' } }, d, YEAR)).rejects.toThrow(/real date/);
    await expect(createMember({ contact: { mode: 'new', name: 'Pat' }, fields: { ...kid, birthYear: 3000 } }, d, YEAR)).rejects.toThrow(/birth year/);
    expect(await d.contacts.count()).toBe(0);
    expect(await d.moduleRecords.count()).toBe(0);
  });
});

describe('atomic create', () => {
  it('if the member cannot be written, the new contact made with it is rolled back (no orphan)', async () => {
    const d = fresh();
    const existing = await addContact(d, 'Pre-existing');
    const spy = vi.spyOn(d.moduleRecords, 'add').mockRejectedValue(new Error('disk full (injected)'));
    await expect(createMember({ contact: { mode: 'new', name: 'Orphan Candidate' }, fields: kid }, d, YEAR)).rejects.toThrow(/injected/);
    spy.mockRestore();
    const cs = await contactsOf(d);
    expect(cs.map((c) => c.name)).toEqual(['Pre-existing']); // the new contact is gone, the existing one was never touched
    expect(cs[0].id).toBe(existing);
    expect(await d.moduleRecords.count()).toBe(0);
  });
});

describe('one member per contact', () => {
  it('a second ACTIVE member for the same contact is refused, however it is asked', async () => {
    const d = fresh();
    const cid = await addContact(d, 'Sam');
    await createMember({ contact: { mode: 'existing', contactId: cid }, fields: kid }, d, YEAR);
    await expect(createMember({ contact: { mode: 'existing', contactId: cid }, fields: { ...kid, role: 'parent' } }, d, YEAR)).rejects.toThrow(/already a member/);
    expect(await loadMembers(d)).toHaveLength(1);
  });
  it('repeated saves (a double click) create one member', async () => {
    const d = fresh();
    const cid = await addContact(d, 'Sam');
    const results = await Promise.allSettled([1, 2, 3].map(() => createMember({ contact: { mode: 'existing', contactId: cid }, fields: kid }, d, YEAR)));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await loadMembers(d)).toHaveLength(1);
  });
  it('a contact that is already a PAST member is not added a second time: the message points at reactivating the first record', async () => {
    const d = fresh();
    const cid = await addContact(d, 'Gran');
    const { id } = await createMember({ contact: { mode: 'existing', contactId: cid }, fields: { ...kid, role: 'grandparent' } }, d, YEAR);
    await setMemberStatus(id, 'past', d);
    await expect(createMember({ contact: { mode: 'existing', contactId: cid }, fields: kid }, d, YEAR)).rejects.toThrow(/past member/);
    await setMemberStatus(id, 'active', d);
    expect((await getMember(id, d))!.data!.status).toBe('active');
    expect(await loadMembers(d)).toHaveLength(1);
  });
  it('a past member cannot be made active while another active member points at the same contact', async () => {
    const d = fresh();
    const cid = await addContact(d, 'Sam');
    const { id: first } = await createMember({ contact: { mode: 'existing', contactId: cid }, fields: kid }, d, YEAR);
    await setMemberStatus(first, 'past', d);
    // a second device's active record for the same contact (written straight into the table, as sync would)
    const second = await d.moduleRecords.add({ module: 'family', kind: 'member', createdAt: 5, updatedAt: 5, deletedAt: null, data: { contactId: cid, role: 'child', status: 'active' } } as never) as number;
    await expect(setMemberStatus(first, 'active', d)).rejects.toThrow(/Another active member/);
    await expect(updateMember(first, { ...kid, status: 'active' }, d, YEAR)).rejects.toThrow(/Another active member/);
    expect(await getMember(second, d)).toBeDefined();
  });
});

describe('editing and the fixed contact link', () => {
  it('edits the profile, keeps unknown fields, and never changes the contact link', async () => {
    const d = fresh();
    const cid = await addContact(d, 'Sam');
    const { id } = await createMember({ contact: { mode: 'existing', contactId: cid }, fields: { ...kid, note: 'old' } }, d, YEAR);
    await d.moduleRecords.update(id, { 'data.futureField': { from: 'a newer build', list: [1, 2, 3] }, 'data.contactId': cid });
    await updateMember(id, { role: 'other', status: 'active', birthMonthDay: '12-31', color: '#2f8f6b' }, d, YEAR);
    const row = (await d.moduleRecords.get(id))!;
    expect(row.data).toEqual({ futureField: { from: 'a newer build', list: [1, 2, 3] }, contactId: cid, role: 'other', status: 'active', birthMonthDay: '12-31', color: '#2f8f6b' });
  });
  it('the edit function has no way to name another contact (the fields do not carry one)', async () => {
    const d = fresh();
    const a = await addContact(d, 'A'); const b = await addContact(d, 'B');
    const { id } = await createMember({ contact: { mode: 'existing', contactId: a }, fields: kid }, d, YEAR);
    await updateMember(id, { ...kid, contactId: b } as never, d, YEAR);
    expect((await getMember(id, d))!.data!.contactId).toBe(a);
  });
  it('a row this version cannot read is refused for editing and left byte-identical', async () => {
    const d = fresh();
    const id = await d.moduleRecords.add({ module: 'family', kind: 'member', createdAt: 1, updatedAt: 1, deletedAt: null, data: { contactId: 4, role: 'sibling-from-the-future', status: 'active', extra: [1] } } as never) as number;
    const before = JSON.stringify(await d.moduleRecords.get(id));
    await expect(updateMember(id, kid, d, YEAR)).rejects.toThrow(/could not be read/);
    await expect(setMemberStatus(id, 'past', d)).rejects.toThrow(/could not be read/);
    expect(JSON.stringify(await d.moduleRecords.get(id))).toBe(before);
    const listed = await loadMembers(d);
    expect(listed).toHaveLength(1);
    expect(listed[0].data).toBeNull(); // still listed, for review
  });
  it('a stored field this version cannot read survives a status change exactly', async () => {
    const d = fresh();
    const cid = await addContact(d, 'Sam');
    const id = await d.moduleRecords.add({ module: 'family', kind: 'member', createdAt: 1, updatedAt: 1, deletedAt: null, data: { contactId: cid, role: 'child', status: 'active', color: 'chartreuse', note: 'n', unknown: true } } as never) as number;
    await setMemberStatus(id, 'past', d);
    expect((await d.moduleRecords.get(id))!.data).toEqual({ contactId: cid, role: 'child', status: 'past', color: 'chartreuse', note: 'n', unknown: true });
  });
});

describe('archive = past, never delete', () => {
  it('keeps the member, the contact, and every Task, event and project that names the contact', async () => {
    const d = fresh();
    const cid = await addContact(d, 'Sam');
    const { id } = await createMember({ contact: { mode: 'existing', contactId: cid }, fields: kid }, d, YEAR);
    await createTask(blankTask({ title: 'Sign the form', contactIds: [cid] }), [], d);
    await createEvent({ ...blankFields('2026-11-12'), title: 'Practice', contactIds: [cid] } as never, d);
    await createProject(blankProject({ name: 'Summer plan', vendorContactIds: [cid] }), d);
    const others = async () => JSON.stringify([(await d.moduleRecords.toArray()).filter((r) => r.module !== 'family'), await d.contacts.toArray(), await d.links.toArray()]);
    const before = await others();
    await setMemberStatus(id, 'past', d);
    expect(await others()).toBe(before); // not one other record changed
    const m = (await getMember(id, d))!;
    expect(m.data!.status).toBe('past');
    expect((await loadMembers(d))).toHaveLength(1); // still listed
    expect(await d.moduleRecords.get(id)).toMatchObject({ deletedAt: null });
    await setMemberStatus(id, 'past', d); // idempotent
    expect((await getMember(id, d))!.data!.status).toBe('past');
  });
});

describe('cross-device duplicate members', () => {
  it('two offline devices adding the same contact are both kept, and flagged, never merged', async () => {
    const d = fresh();
    const cid = await addContact(d, 'Sam');
    for (const createdAt of [10, 20]) await d.moduleRecords.add({ module: 'family', kind: 'member', createdAt, updatedAt: createdAt, deletedAt: null, data: { contactId: cid, role: 'child', status: 'active' } } as never);
    const all = await loadMembers(d);
    expect(all).toHaveLength(2);
    expect(duplicateGroups(all)).toHaveLength(1);
    expect(await d.moduleRecords.count()).toBe(2); // loading and grouping delete nothing
  });
});

describe('the "who points at this person" reader', () => {
  it('counts Tasks, events, projects, saved links and other members for one contact, ignoring removed ones', async () => {
    const d = fresh();
    const cid = await addContact(d, 'Sam'); const other = await addContact(d, 'Other');
    const { id } = await createMember({ contact: { mode: 'existing', contactId: cid }, fields: kid }, d, YEAR);
    await createTask(blankTask({ title: 'T1', contactIds: [cid] }), [], d);
    await createTask(blankTask({ title: 'T2', contactIds: [cid, other] }), [], d);
    await createTask(blankTask({ title: 'T3', contactIds: [other] }), [], d);
    await createEvent({ ...blankFields('2026-11-12'), title: 'E1', contactIds: [cid] } as never, d);
    await createProject(blankProject({ name: 'P1', vendorContactIds: [cid] }), d);
    await createStore(d).shared.links.add({ module: 'contacts', id: cid }, { module: 'tasks', id: 9 }, 'about');
    const dup = await d.moduleRecords.add({ module: 'family', kind: 'member', createdAt: 1, updatedAt: 1, deletedAt: null, data: { contactId: cid, role: 'child', status: 'past' } } as never) as number;
    const removedTask = await createTask(blankTask({ title: 'Gone', contactIds: [cid] }), [], d);
    await d.moduleRecords.update(removedTask, { deletedAt: Date.now() });
    const r = await readContactReferences(cid, d, id);
    expect(r).toEqual({ tasks: 2, events: 1, projects: 1, links: 1, otherMembers: 1, total: 6 });
    expect(referenceLines(r)).toEqual(['2 tasks', '1 calendar event', '1 project', '1 saved link']);
    expect(dup).toBeGreaterThan(0);
  });
  it('is read-only: every table is identical before and after, and nothing is deleted', async () => {
    const d = fresh();
    const cid = await addContact(d, 'Sam');
    const { id } = await createMember({ contact: { mode: 'existing', contactId: cid }, fields: kid }, d, YEAR);
    await createTask(blankTask({ title: 'T1', contactIds: [cid] }), [], d);
    await createStore(d).shared.links.add({ module: 'contacts', id: `contact:${cid}` }, { module: 'tasks', id: 9 }, 'about');
    const snap = async () => JSON.stringify(await Promise.all(d.tables.map(async (t) => [t.name, await t.toArray()])));
    const before = await snap();
    await readContactReferences(cid, d, id);
    await readContactReferences(cid, d);
    expect(await snap()).toBe(before);
  });
  it('the pure counter tolerates damaged rows', () => {
    const bad = { id: 1, module: 'tasks', kind: 'task', data: null, createdAt: 1, updatedAt: 1, deletedAt: null } as never;
    const weird = { id: 2, module: 'tasks', kind: 'task', data: { contactIds: 'nope' }, createdAt: 1, updatedAt: 1, deletedAt: null } as never;
    expect(countReferences(5, { tasks: [bad, weird], events: [], projects: [], links: [], members: [bad] })).toMatchObject({ total: 0 });
  });
});
