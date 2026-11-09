import { describe, expect, it } from 'vitest';
import { FinanceDB } from '../../db';
import { createStore } from '../../core/store';
import { createMember, setMemberStatus } from './data';
import { addImportantContact, getImportantContact, loadImportantContacts, setImportantContactStatus, updateImportantContactPurpose } from './importantContactData';
import { activeFor, asImportantContact, associationKey, duplicateAssociations, PURPOSE_MAX, toStoredImportantContact, validateImportantContact } from './importantContactModel';

/** F3 important contacts: association records between a household member and a shared Contact. Invented names only. */
let n = 0;
const fresh = () => new FinanceDB(`test-family-f3-contacts-${n++}`);
const kid = { role: 'child' as const, status: 'active' as const };
const addContact = (d: FinanceDB, name: string, extra: object = {}) => createStore(d).shared.contacts.put({ name, ...extra } as never);
const rawRow = (d: FinanceDB, id: number) => d.moduleRecords.get(id);

async function household() {
  const d = fresh();
  const sam = await addContact(d, 'Sam Example');
  const robin = await addContact(d, 'Robin Example');
  const school = await addContact(d, 'Example Elementary Office', { phone: '555-0100' });
  const coach = await addContact(d, 'Coach Example');
  const samId = (await createMember({ contact: { mode: 'existing', contactId: sam }, fields: kid }, d, 2026)).id;
  const robinId = (await createMember({ contact: { mode: 'existing', contactId: robin }, fields: kid }, d, 2026)).id;
  return { d, sam, robin, school, coach, samId, robinId };
}
const add = (d: FinanceDB, memberId: number, contactId: number, purpose: string) => addImportantContact({ memberId, contact: { mode: 'existing', contactId }, purpose }, d);

describe('add, show, change, remove', () => {
  it('stores exactly the member, the Contact, the purpose and a status: no name, phone or email is copied', async () => {
    const { d, school, samId } = await household();
    const { id, createdContact } = await add(d, samId, school, '  School   office ');
    expect(createdContact).toBe(false);
    const row = await rawRow(d, id);
    expect([row!.module, row!.kind]).toEqual(['family', 'contact']);
    expect(row!.data).toEqual({ memberId: samId, contactId: school, purpose: 'School office', status: 'active' });
    expect(JSON.stringify(row)).not.toContain('Example Elementary');
    expect(JSON.stringify(row)).not.toContain('555-0100');
  });

  it('adding links an existing Contact without changing it', async () => {
    const { d, school, samId } = await household();
    const before = JSON.stringify(await d.contacts.get(school));
    await add(d, samId, school, 'School office');
    expect(JSON.stringify(await d.contacts.get(school))).toBe(before);
    expect(await d.contacts.count()).toBe(4);
  });

  it('changing the purpose changes only the purpose; removing is an archive that can be undone, and the Contact is never touched', async () => {
    const { d, school, samId } = await household();
    const { id } = await add(d, samId, school, 'School office');
    const contactBefore = JSON.stringify(await d.contacts.get(school));
    await updateImportantContactPurpose(id, 'Front desk', d);
    expect((await rawRow(d, id))!.data).toEqual({ memberId: samId, contactId: school, purpose: 'Front desk', status: 'active' });
    await setImportantContactStatus(id, 'archived', d);
    expect(activeFor(await loadImportantContacts(d), samId)).toEqual([]);
    expect((await loadImportantContacts(d)).map((r) => r.data?.status)).toEqual(['archived']); // kept, listed as removed
    await setImportantContactStatus(id, 'active', d);
    expect(activeFor(await loadImportantContacts(d), samId).map((r) => r.id)).toEqual([id]);
    expect(JSON.stringify(await d.contacts.get(school))).toBe(contactBefore);
    expect(await d.contacts.count()).toBe(4);
  });

  it('a Contact can be important to several members, and to one member for several purposes', async () => {
    const { d, school, coach, samId, robinId } = await household();
    await add(d, samId, school, 'School office');
    await add(d, robinId, school, 'School office');
    await add(d, samId, coach, 'Soccer coach');
    await add(d, samId, coach, 'Emergency pickup');
    const all = await loadImportantContacts(d);
    expect(activeFor(all, samId)).toHaveLength(3);
    expect(activeFor(all, robinId)).toHaveLength(1);
  });

  it('removing an association leaves the Contact, the member, and every other member\'s association alone', async () => {
    const { d, school, samId, robinId } = await household();
    const a = await add(d, samId, school, 'School office');
    const b = await add(d, robinId, school, 'School office');
    await setImportantContactStatus(a.id, 'archived', d);
    expect((await getImportantContact(b.id, d))!.data!.status).toBe('active');
    expect(await d.contacts.get(school)).toBeDefined();
  });

  it('a past member keeps their associations (marking someone past does not remove them)', async () => {
    const { d, school, samId } = await household();
    const { id } = await add(d, samId, school, 'School office');
    await setMemberStatus(samId, 'past', d);
    expect((await getImportantContact(id, d))!.data!.status).toBe('active');
  });
});

describe('what is refused', () => {
  it('no purpose, a purpose that is too long, and no Contact chosen', async () => {
    const { d, school, samId } = await household();
    await expect(add(d, samId, school, '   ')).rejects.toThrow(/what this contact is for/);
    await expect(add(d, samId, school, 'x'.repeat(PURPOSE_MAX + 1))).rejects.toThrow(/at most 60/);
    await expect(addImportantContact({ memberId: samId, contact: { mode: 'new', name: '  ' }, purpose: 'Coach' }, d)).rejects.toThrow(/Enter a name/);
    expect(await loadImportantContacts(d)).toEqual([]);
  });

  it('the person themselves, a missing member, a missing or deleted Contact, an unreadable member', async () => {
    const { d, sam, school, samId } = await household();
    await expect(add(d, samId, sam, 'Self')).rejects.toThrow(/person themselves/);
    await expect(add(d, 999999, school, 'Ghost')).rejects.toThrow(/no longer exists/);
    await expect(add(d, samId, 424242, 'Ghost')).rejects.toThrow(/contact no longer exists/);
    await d.contacts.update(school, { deletedAt: Date.now() } as never);
    await expect(add(d, samId, school, 'Gone')).rejects.toThrow(/contact no longer exists/);
    const bad = await d.moduleRecords.add({ module: 'family', kind: 'member', createdAt: 1, updatedAt: 1, deletedAt: null, data: { contactId: 'x', role: 'wizard' } } as never) as number;
    await expect(add(d, bad, (await addContact(d, 'Other')), 'x')).rejects.toThrow(/could not be read/);
    expect(await loadImportantContacts(d)).toEqual([]);
  });

  it('a refusal creates no stray Contact', async () => {
    const { d, samId } = await household();
    const before = await d.contacts.count();
    await expect(addImportantContact({ memberId: 999999, contact: { mode: 'new', name: 'New Place' }, purpose: 'Office' }, d)).rejects.toThrow();
    await expect(addImportantContact({ memberId: samId, contact: { mode: 'new', name: 'New Place' }, purpose: '' }, d)).rejects.toThrow();
    expect(await d.contacts.count()).toBe(before);
  });
});

describe('creating a new Contact from this flow keeps F1\'s explicit, safe same-name behaviour', () => {
  it('a new Contact is always separate, even when another has the same name; the existing one is not changed or reused', async () => {
    const { d, school, samId } = await household();
    const before = JSON.stringify(await d.contacts.get(school));
    const { contactId, createdContact } = await addImportantContact({ memberId: samId, contact: { mode: 'new', name: 'Example Elementary Office' }, purpose: 'Second office' }, d);
    expect(createdContact).toBe(true);
    expect(contactId).not.toBe(school);
    expect((await d.contacts.toArray()).filter((c) => c.name === 'Example Elementary Office')).toHaveLength(2);
    expect(JSON.stringify(await d.contacts.get(school))).toBe(before);
  });
});

describe('duplicate prevention', () => {
  it('the same member, Contact and purpose (ignoring case and spacing) is refused while the first is active', async () => {
    const { d, school, samId } = await household();
    await add(d, samId, school, 'School office');
    await expect(add(d, samId, school, '  school   OFFICE ')).rejects.toThrow(/already listed/);
    expect(activeFor(await loadImportantContacts(d), samId)).toHaveLength(1);
  });

  it('after removing it the same association can be added again; putting the removed one back is then refused', async () => {
    const { d, school, samId } = await household();
    const first = await add(d, samId, school, 'School office');
    await setImportantContactStatus(first.id, 'archived', d);
    const second = await add(d, samId, school, 'School office');
    await expect(setImportantContactStatus(first.id, 'active', d)).rejects.toThrow(/already listed/);
    expect((await getImportantContact(first.id, d))!.data!.status).toBe('archived');
    expect(second.id).not.toBe(first.id);
  });

  it('changing a purpose so it repeats another active one is refused', async () => {
    const { d, school, samId } = await household();
    await add(d, samId, school, 'School office');
    const b = await add(d, samId, school, 'Front desk');
    await expect(updateImportantContactPurpose(b.id, 'school office', d)).rejects.toThrow(/already listed/);
    await updateImportantContactPurpose(b.id, 'Front desk', d); // unchanged text is fine (it is not a duplicate of itself)
  });

  it('two records that say the same thing (made on two devices) are reported as a group, never merged', async () => {
    const { d, school, samId, robinId } = await household();
    const row = (data: object) => d.moduleRecords.add({ module: 'family', kind: 'contact', createdAt: 1, updatedAt: 1, deletedAt: null, data } as never) as Promise<number>;
    const a = await row({ memberId: samId, contactId: school, purpose: 'School office', status: 'active' });
    const b = await row({ memberId: samId, contactId: school, purpose: 'school office', status: 'active' });
    await row({ memberId: robinId, contactId: school, purpose: 'School office', status: 'active' });
    const groups = duplicateAssociations(await loadImportantContacts(d));
    expect(groups.map((g) => g.map((r) => r.id))).toEqual([[a, b]]);
    expect(await loadImportantContacts(d)).toHaveLength(3);
  });
});

describe('defensive reading', () => {
  it('unknown fields on a record survive a purpose change and a removal exactly', async () => {
    const { d, school, samId } = await household();
    const { id } = await add(d, samId, school, 'School office');
    await d.moduleRecords.update(id, { 'data.futureField': { keep: [1, 2] } });
    await updateImportantContactPurpose(id, 'Front desk', d);
    await setImportantContactStatus(id, 'archived', d);
    expect((await rawRow(d, id))!.data).toEqual({ memberId: samId, contactId: school, purpose: 'Front desk', status: 'archived', futureField: { keep: [1, 2] } });
  });

  it('an unreadable row is listed for review, not hidden, not editable, not part of any member\'s list', async () => {
    const { d, samId } = await household();
    const bad = await d.moduleRecords.add({ module: 'family', kind: 'contact', createdAt: 1, updatedAt: 1, deletedAt: null, data: { memberId: samId, contactId: 'x', purpose: 5, status: 'wow', keep: true } } as never) as number;
    const all = await loadImportantContacts(d);
    expect(all.map((r) => [r.id, r.data])).toEqual([[bad, null]]);
    expect(all[0].problems).toHaveLength(3);
    expect(activeFor(all, samId)).toEqual([]);
    await expect(setImportantContactStatus(bad, 'archived', d)).rejects.toThrow(/could not be read/);
    await expect(updateImportantContactPurpose(bad, 'Fix', d)).rejects.toThrow(/could not be read/);
    expect((await rawRow(d, bad))!.data).toMatchObject({ keep: true, purpose: 5 });
  });

  it('records of other Family kinds and other modules are not read as associations', async () => {
    const { d } = await household();
    await d.moduleRecords.add({ module: 'family', kind: 'school', createdAt: 1, updatedAt: 1, deletedAt: null, data: { memberId: 1, contactId: 2, purpose: 'x', status: 'active' } } as never);
    await d.moduleRecords.add({ module: 'tasks', kind: 'contact', createdAt: 1, updatedAt: 1, deletedAt: null, data: { memberId: 1, contactId: 2, purpose: 'x', status: 'active' } } as never);
    expect(await loadImportantContacts(d)).toEqual([]);
  });

  it('a Contact that is later deleted leaves the association in place (it reads as active; the page says the Contact is gone)', async () => {
    const { d, school, samId } = await household();
    const { id } = await add(d, samId, school, 'School office');
    await d.contacts.update(school, { deletedAt: Date.now() } as never);
    expect((await getImportantContact(id, d))!.data!.status).toBe('active');
  });

  it('the model: validation words, the stored shape, and keys that ignore case/accents', () => {
    expect(validateImportantContact({ memberId: 1, contactId: 2, purpose: 'Coach', status: 'active' })).toBeNull();
    expect(validateImportantContact({ memberId: 1.5, contactId: 2, purpose: 'Coach', status: 'active' })).toMatch(/family member/);
    expect(associationKey({ memberId: 1, contactId: 2, purpose: 'Médecin' })).toBe(associationKey({ memberId: 1, contactId: 2, purpose: ' medecin ' }));
    const r = asImportantContact({ id: 7, module: 'family', kind: 'contact', createdAt: 1, updatedAt: 2, deletedAt: null, data: { memberId: 1, contactId: 2, purpose: 'Coach', status: 'active', extra: 1 } } as never);
    expect(toStoredImportantContact(r.raw, { ...r.data!, purpose: 'Head coach' })).toEqual({ extra: 1, memberId: 1, contactId: 2, purpose: 'Head coach', status: 'active' });
  });
});

describe('no writes outside Family\'s own rows', () => {
  it('adding, changing and removing touch only the family contact rows (and a new Contact when asked): Calendar, Tasks, Projects and Finance tables are byte-identical', async () => {
    const { d, school, samId } = await household();
    const acct = (await d.accounts.add({ name: 'Test checking', kind: 'checking', openingBalanceCents: 100000, openingDate: '2026-01-01' } as never)) as number;
    await d.txns.add({ accountId: acct, date: '2026-11-02', amountCents: -1800, payee: 'Shop', memo: '', status: 'cleared', categoryId: null } as never);
    const tables = d.tables.map((t) => t.name).filter((t) => !['moduleRecords', 'contacts'].includes(t)); // every other table, Finance included
    const other = async () => JSON.stringify(await Promise.all(tables.map((t) => d.table(t).toArray())));
    const modsBefore = JSON.stringify((await d.moduleRecords.toArray()).filter((r) => r.module !== 'family'));
    const before = await other();
    const { id } = await add(d, samId, school, 'School office');
    await updateImportantContactPurpose(id, 'Front desk', d);
    await setImportantContactStatus(id, 'archived', d);
    await setImportantContactStatus(id, 'active', d);
    expect(await other()).toBe(before);
    expect(JSON.stringify((await d.moduleRecords.toArray()).filter((r) => r.module !== 'family'))).toBe(modsBefore);
    expect((await d.moduleRecords.toArray()).filter((r) => r.module === 'family' && r.kind !== 'member')).toHaveLength(1);
  });
});
