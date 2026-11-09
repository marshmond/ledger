import { describe, expect, it } from 'vitest';
import { applyContactRemoval, findRemovedButReferenced, planContactRemoval, RemovalRefused, restoreContact, undoContactRemoval } from '../../core/contactRemoval';
import type { ContactReferenceProvider } from '../../core/contactReferences';
import { createDistinctContact, updateContactDetails } from '../../core/contacts';
import { isLive } from '../../core/store';
import { freshDb, PROVIDERS, row, seedEverywhere, snapshot, TODAY } from './c2-testkit';

/** Contacts C2: guarded removal of a Contact nothing uses (soft delete, re-check in one transaction, Undo). Invented data only. */
const plan = (d: ReturnType<typeof freshDb>, id: number, providers: readonly ContactReferenceProvider[] = PROVIDERS) => planContactRemoval(d, id, providers, TODAY);
const apply = (d: ReturnType<typeof freshDb>, p: Awaited<ReturnType<typeof plan>>, providers: readonly ContactReferenceProvider[] = PROVIDERS) => applyContactRemoval(d, p, providers, TODAY);

describe('eligibility', () => {
  it('a live Contact nothing mentions is eligible', async () => {
    const d = freshDb();
    const c = await createDistinctContact(d, { name: 'Spare Person' });
    const p = await plan(d, c);
    expect(p).toMatchObject({ eligible: true, reasons: [], verified: true, named: 0, textHit: false, mentions: [] });
    expect(p.contact?.name).toBe('Spare Person');
  });

  it('EVERY kind of stored reference refuses removal (one Contact per field)', async () => {
    const fields: [string, string, (c: number) => unknown][] = [
      ['family', 'member', (c) => ({ contactId: c, role: 'parent', status: 'active' })],
      ['family', 'contact', (c) => ({ memberId: 5, contactId: c, purpose: 'x', status: 'active' })],
      ['tasks', 'task', (c) => ({ title: 't', status: 'todo', contactIds: [c] })],
      ['calendar', 'event', (c) => ({ title: 'e', allDay: true, startDate: '2026-12-01', contactIds: [c] })],
      ['projects', 'project', (c) => ({ name: 'p', status: 'active', vendorContactIds: [c] })],
      ['projects', 'commitment', (c) => ({ projectId: 1, vendorContactId: c, title: 'q', status: 'quoted', amountCents: 1 })],
      ['assets', 'asset', (c) => ({ name: 'a', contacts: [{ contactId: c, role: 'x' }] })],
      ['assets', 'service', (c) => ({ assetId: 1, providerContactId: c, title: 's', date: '2026-01-01' })],
      ['assets', 'warranty', (c) => ({ assetId: 1, providerContactId: c, title: 'w' })],
      ['services', 'arrangement', (c) => ({ title: 'a', status: 'active', providerContactId: c, extraContactIds: [] })],
      ['services', 'arrangement', (c) => ({ title: 'a', status: 'active', providerContactId: null, extraContactIds: [c] })],
      ['services', 'visit', (c) => ({ title: 'v', providerContactId: c, date: '2026-01-01', status: 'completed' })],
      ['bills', 'obligation', (c) => ({ title: 'b', type: 'utility', providerContactId: c, status: 'active' })],
      ['futuremodule', 'thing', (c) => ({ deep: { somewhere: [c] } })],
    ];
    for (const [m, k, data] of fields) {
      const d = freshDb();
      const c = await createDistinctContact(d, { name: 'Used Person' });
      await row(d, m, k, data(c));
      const p = await plan(d, c);
      expect(p.eligible, `${m}/${k}`).toBe(false);
      await expect(apply(d, { ...p, eligible: true }), `${m}/${k} apply`).rejects.toBeInstanceOf(RemovalRefused);
      expect(isLive((await d.contacts.get(c))!)).toBe(true);
    }
  });

  it('a shared link, an attachment and a due item that name the Contact also refuse removal', async () => {
    for (const add of [
      (d: ReturnType<typeof freshDb>, c: number) => d.links.add({ fromModule: 'contacts', fromId: c, toModule: 'tasks', toId: 'task:1', type: 'about', createdAt: 1, updatedAt: 1, deletedAt: null } as never),
      (d: ReturnType<typeof freshDb>, c: number) => d.attachments.add({ ownerModule: 'tasks', ownerId: 1, label: 'x', who: c, createdAt: 1, updatedAt: 1, deletedAt: null } as never),
      (d: ReturnType<typeof freshDb>, c: number) => d.dueItems.add({ sourceModule: 'x', sourceRecordId: '1', date: '2026-01-01', title: 't', who: c, createdAt: 1, updatedAt: 1, deletedAt: null } as never),
    ]) {
      const d = freshDb();
      const c = await createDistinctContact(d, { name: 'Used Person' });
      await add(d, c);
      expect((await plan(d, c)).eligible).toBe(false);
    }
  });

  it('the identifier as TEXT inside stored data (not a number) still refuses removal (the older conservative rule)', async () => {
    const d = freshDb();
    const c = await createDistinctContact(d, { name: 'Used Person' });
    await row(d, 'tasks', 'task', 'broken but mentions ' + c);
    const p = await plan(d, c);
    expect(p.eligible).toBe(false);
    expect(p.textHit).toBe(true);
  });

  it('deleted records do not block removal, and neither does another Contact being used', async () => {
    const d = freshDb();
    const c = await createDistinctContact(d, { name: 'Spare Person' });
    const other = await createDistinctContact(d, { name: 'Busy Person' });
    await row(d, 'tasks', 'task', { title: 'old', status: 'todo', contactIds: [c] }, true);
    await row(d, 'tasks', 'task', { title: 'new', status: 'todo', contactIds: [other] });
    expect((await plan(d, c)).eligible).toBe(true);
  });

  it('a missing, already-removed Contact is not eligible', async () => {
    const d = freshDb();
    const c = await createDistinctContact(d, { name: 'Spare Person' });
    await applyContactRemoval(d, await plan(d, c), PROVIDERS, TODAY);
    const p = await plan(d, c);
    expect(p).toMatchObject({ eligible: false, contact: null });
    expect((await plan(d, 424242)).eligible).toBe(false);
  });

  it('a reader that cannot run, or reports something unreadable, BLOCKS removal ("could not check" is never "nothing found")', async () => {
    const d = freshDb();
    const c = await createDistinctContact(d, { name: 'Spare Person' });
    const boom: ContactReferenceProvider = { label: 'Broken', find: async () => { throw new Error('unreadable'); } };
    const junk: ContactReferenceProvider = { label: 'Junk', find: async () => [{ nonsense: 1 } as never] };
    for (const providers of [[...PROVIDERS, boom], [...PROVIDERS, junk], []]) {
      const p = await plan(d, c, providers);
      expect(p.eligible).toBe(false);
      expect(p.verified).toBe(false);
      await expect(apply(d, { ...p, eligible: true }, providers)).rejects.toBeInstanceOf(RemovalRefused);
      expect(isLive((await d.contacts.get(c))!)).toBe(true);
    }
  });

  it('a reader that names a record the scans cannot see still blocks removal (belt and braces)', async () => {
    const d = freshDb();
    const c = await createDistinctContact(d, { name: 'Spare Person' });
    const named: ContactReferenceProvider = { label: 'Odd', find: async () => [{ contactId: c, module: 'odd', kind: 'thing', recordId: '1', role: 'x', title: 'T', relation: 'R' }] };
    const p = await plan(d, c, [...PROVIDERS, named]);
    expect(p).toMatchObject({ eligible: false, named: 1 });
  });
});

describe('the removal itself', () => {
  it('soft-deletes the SAME row: id, created time and unknown fields stay; nothing else changes', async () => {
    const d = freshDb();
    const c = await createDistinctContact(d, { name: 'Spare Person', phone: '555-0100' });
    await d.contacts.update(c, { notes: 'kept', futureField: { a: [1] } } as never);
    const other = await createDistinctContact(d, { name: 'Other' });
    await row(d, 'tasks', 'task', { title: 'unrelated', status: 'todo', contactIds: [other] });
    const beforeContact = (await d.contacts.get(c))!;
    const beforeOthers = JSON.stringify([await d.contacts.get(other), await d.moduleRecords.toArray()]);
    const u = await apply(d, await plan(d, c));
    const after = (await d.contacts.get(c))!;
    expect(after).toMatchObject({ id: c, name: 'Spare Person', phone: '555-0100', notes: 'kept', futureField: { a: [1] }, createdAt: beforeContact.createdAt });
    expect(after.deletedAt).not.toBeNull();
    expect(isLive(after)).toBe(false);
    expect(await d.contacts.count()).toBe(2); // never hard-deleted
    expect(JSON.stringify([await d.contacts.get(other), await d.moduleRecords.toArray()])).toBe(beforeOthers);
    expect(u).toMatchObject({ contactId: c, deletedAt: after.deletedAt, updatedAt: after.updatedAt });
  });

  it('refuses when a reference appeared between the preview and the confirmation, and writes nothing', async () => {
    const d = freshDb();
    const c = await createDistinctContact(d, { name: 'Spare Person' });
    const p = await plan(d, c);
    expect(p.eligible).toBe(true);
    await row(d, 'tasks', 'task', { title: 'just added', status: 'todo', contactIds: [c] });
    const before = await snapshot(d);
    await expect(apply(d, p)).rejects.toMatchObject({ name: 'RemovalRefused', reason: 'referenced' });
    expect(await snapshot(d)).toBe(before);
  });

  it('refuses when the Contact itself changed after the preview (the owner saw something else)', async () => {
    const d = freshDb();
    const c = await createDistinctContact(d, { name: 'Spare Person' });
    const p = await plan(d, c);
    await updateContactDetails(d, c, { name: 'Spare Person', phone: '555-0199' });
    await expect(apply(d, p)).rejects.toMatchObject({ reason: 'stale' });
    expect(isLive((await d.contacts.get(c))!)).toBe(true);
  });

  it('refuses when the Contact was removed elsewhere first, and an ineligible plan is refused up front', async () => {
    const d = freshDb();
    const c = await createDistinctContact(d, { name: 'Spare Person' });
    const p = await plan(d, c);
    await apply(d, p);
    await expect(apply(d, p)).rejects.toMatchObject({ reason: 'gone' });
    const used = await createDistinctContact(d, { name: 'Used' });
    await row(d, 'tasks', 'task', { title: 't', status: 'todo', contactIds: [used] });
    await expect(apply(d, await plan(d, used))).rejects.toBeInstanceOf(RemovalRefused);
  });

  it('is atomic: a failure after the check leaves the Contact live (all or nothing)', async () => {
    const d = freshDb();
    const c = await createDistinctContact(d, { name: 'Spare Person' });
    const p = await plan(d, c);
    const fail = () => { throw new Error('disk full'); };
    d.contacts.hook('updating', fail);
    try { await expect(apply(d, p)).rejects.toThrow(); } finally { d.contacts.hook('updating').unsubscribe(fail); }
    expect(isLive((await d.contacts.get(c))!)).toBe(true);
    expect((await d.contacts.get(c))!.updatedAt).toBe(p.contact!.updatedAt);
  });

  it('the seeded Contact in every module cannot be removed', async () => {
    const d = freshDb();
    const { c } = await seedEverywhere(d);
    const p = await plan(d, c);
    expect(p.eligible).toBe(false);
    expect(p.mentions.length).toBeGreaterThan(5);
  });
});

describe('Undo', () => {
  it('restores the same Contact (same id, same row), and nothing else', async () => {
    const d = freshDb();
    const c = await createDistinctContact(d, { name: 'Spare Person' });
    await d.contacts.update(c, { futureField: 7 } as never);
    const created = (await d.contacts.get(c))!.createdAt;
    const u = await apply(d, await plan(d, c));
    expect(await undoContactRemoval(d, u)).toBe('restored');
    const back = (await d.contacts.get(c))!;
    expect(back).toMatchObject({ id: c, name: 'Spare Person', futureField: 7, createdAt: created, deletedAt: null });
    expect(await d.contacts.count()).toBe(1);
    expect(await undoContactRemoval(d, u)).toBe('already-live');
  });

  it('is refused, writing nothing, if the removed Contact was changed since', async () => {
    const d = freshDb();
    const c = await createDistinctContact(d, { name: 'Spare Person' });
    const u = await apply(d, await plan(d, c));
    await d.contacts.update(c, { name: 'Changed elsewhere' } as never);
    const before = await snapshot(d);
    await expect(undoContactRemoval(d, u)).rejects.toMatchObject({ reason: 'stale' });
    expect(await snapshot(d)).toBe(before);
  });
});

describe('removed Contacts that are still referenced (the cross-device limit made visible)', () => {
  it('lists a removed Contact that something now mentions, and restoring it brings back the same id', async () => {
    const d = freshDb();
    const c = await createDistinctContact(d, { name: 'Spare Person' });
    const quiet = await createDistinctContact(d, { name: 'Quiet Removed' });
    await apply(d, await plan(d, c));
    await apply(d, await plan(d, quiet));
    expect(await findRemovedButReferenced(d)).toEqual([]);
    await row(d, 'tasks', 'task', { title: 'added on another device', status: 'todo', contactIds: [c] });
    const found = await findRemovedButReferenced(d);
    expect(found.map((x) => x.contact.id)).toEqual([c]);
    expect(found[0].mentions[0]).toMatchObject({ module: 'tasks', kind: 'task', count: 1 });
    expect(await restoreContact(d, c)).toBe(true);
    expect(isLive((await d.contacts.get(c))!)).toBe(true);
    expect(await findRemovedButReferenced(d)).toEqual([]);
    expect(await restoreContact(d, c)).toBe(false);
  });

  it('reading is read-only', async () => {
    const d = freshDb();
    const c = await createDistinctContact(d, { name: 'Spare Person' });
    await apply(d, await plan(d, c));
    await row(d, 'tasks', 'task', { title: 't', status: 'todo', contactIds: [c] });
    const before = await snapshot(d);
    await findRemovedButReferenced(d);
    expect(await snapshot(d)).toBe(before);
  });
});

describe('what the removal code may touch', () => {
  it('writes only the Contacts table (soft delete and restore through the shared store), never hard-deletes, and imports no module or Finance code', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync('src/core/contactRemoval.ts', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(src).not.toMatch(/\bd\.(moduleRecords|links|attachments|dueItems|txns|accounts)\.(add|put|update|delete|bulkAdd|bulkPut|bulkDelete|clear|modify)\(/);
    expect(src).not.toMatch(/d\.contacts\.(add|put|update|delete|bulkDelete|clear|modify)\(/); // only the shared store's remove / restore
    expect(src).toMatch(/shared\.contacts\.remove\(/);
    expect(src).toMatch(/shared\.contacts\.restore\(/);
    expect(src).not.toMatch(/from '\.\.\/modules\/|localStorage|sessionStorage|fetch\(/);
  });
});

describe('final verification probes (transaction boundary and token scope)', () => {
  it('a token for one removal cannot restore a different Contact, and a refused Undo leaves everything as it was', async () => {
    const d = freshDb();
    const a = await createDistinctContact(d, { name: 'First Spare' });
    const b = await createDistinctContact(d, { name: 'Second Spare' });
    const ua = await apply(d, await plan(d, a));
    await apply(d, await plan(d, b));
    const before = await snapshot(d);
    await expect(undoContactRemoval(d, { ...ua, contactId: b })).rejects.toMatchObject({ reason: 'stale' });
    await expect(undoContactRemoval(d, { ...ua, contactId: 987654321 })).rejects.toMatchObject({ reason: 'gone' });
    expect(await snapshot(d)).toBe(before);
    expect(isLive((await d.contacts.get(b))!)).toBe(false);
    expect(await undoContactRemoval(d, ua)).toBe('restored'); // its own token still works
  });

  it('a reader that touches a table outside the removal transaction cannot authorize removal: the check fails and nothing is written', async () => {
    const d = freshDb();
    const c = await createDistinctContact(d, { name: 'Spare Person' });
    const p = await plan(d, c); // eligible with the real readers
    const outside: ContactReferenceProvider = { label: 'Outside', find: async () => { await d.txns.toArray(); return []; } };
    const providers = [...PROVIDERS, outside];
    const before = await snapshot(d);
    await expect(apply(d, p, providers)).rejects.toBeInstanceOf(RemovalRefused);
    expect(await snapshot(d)).toBe(before);
    expect(isLive((await d.contacts.get(c))!)).toBe(true);
  });

  it('a reader that waits on something that is not a database call (which would end the transaction) cannot lead to a write', async () => {
    const d = freshDb();
    const c = await createDistinctContact(d, { name: 'Spare Person' });
    const p = await plan(d, c);
    const slow: ContactReferenceProvider = { label: 'Slow', find: async () => { await new Promise((r) => setTimeout(r, 20)); return []; } };
    const before = await snapshot(d);
    await expect(apply(d, p, [...PROVIDERS, slow])).rejects.toThrow();
    expect(await snapshot(d)).toBe(before);
    expect(isLive((await d.contacts.get(c))!)).toBe(true);
  });

  it('a Contact removed elsewhere and an unknown record kind are both left exactly as they are by a refused removal', async () => {
    const d = freshDb();
    const c = await createDistinctContact(d, { name: 'Used Person' });
    await row(d, 'futuremodule', 'thing', { deep: [{ who: c }], keep: 'me' });
    const before = await snapshot(d);
    const p = await plan(d, c);
    expect(p.eligible).toBe(false);
    await expect(apply(d, { ...p, eligible: true })).rejects.toBeInstanceOf(RemovalRefused);
    expect(await snapshot(d)).toBe(before);
  });
});
