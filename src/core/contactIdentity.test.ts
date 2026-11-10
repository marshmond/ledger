import { describe, expect, it } from 'vitest';
import { FinanceDB } from '../db';
import { installTracking } from '../lib/sync/track';
import { createDistinctContact } from './contacts';
import { findSameNameContacts, hasContactChoice, resolveContactChoice, SameNameContactError } from './contactIdentity';
import { providerNamed } from './contactTestkit';

/** Contacts U2: the ONE shared boundary that turns the owner's choice into a Contact id. Invented data only. */
let n = 0;
const fresh = () => { const d = new FinanceDB(`test-u2-identity-${n++}`); installTracking(d); return d; };
const all = (d: FinanceDB) => d.contacts.toArray();
const live = async (d: FinanceDB) => (await all(d)).filter((c) => c.deletedAt == null);
const raw = async (d: FinanceDB, id: number) => JSON.stringify(await d.contacts.get(id));

describe('an existing Contact is chosen by its stable id', () => {
  it('returns that Contact and writes nothing', async () => {
    const d = fresh();
    const a = await createDistinctContact(d, { name: 'Sam Example', phone: '555-0100' });
    const before = await raw(d, a);
    expect(await resolveContactChoice(d, { contactId: a })).toEqual({ id: a, name: 'Sam Example', created: false });
    expect(await raw(d, a)).toBe(before);
    expect(await d.contacts.count()).toBe(1);
  });

  it('two Contacts with ONE name are two separate choices: each id gives back its own Contact, never the other', async () => {
    const d = fresh();
    const a = await createDistinctContact(d, { name: 'Sam Example', relationship: 'plumber' });
    const b = await createDistinctContact(d, { name: 'sam  example', relationship: 'school coach' });
    expect((await resolveContactChoice(d, { contactId: a })).id).toBe(a);
    expect((await resolveContactChoice(d, { contactId: b })).id).toBe(b);
    expect(a).not.toBe(b);
  });

  it('an id is never overridden by a name beside it', async () => {
    const d = fresh();
    const a = await createDistinctContact(d, { name: 'Sam Example' });
    const b = await createDistinctContact(d, { name: 'Jo Example' });
    expect((await resolveContactChoice(d, { contactId: a, name: 'Jo Example' })).id).toBe(a);
    expect((await resolveContactChoice(d, { contactId: b, name: 'Sam Example', confirmedDifferent: true })).id).toBe(b);
    expect(await d.contacts.count()).toBe(2);
  });

  it('a missing or removed Contact is an error in words; it is never replaced by a same-name one', async () => {
    const d = fresh();
    const gone = await createDistinctContact(d, { name: 'Sam Example' });
    await d.contacts.update(gone, { deletedAt: Date.now() });
    const twin = await createDistinctContact(d, { name: 'Sam Example' });
    await expect(resolveContactChoice(d, { contactId: gone })).rejects.toThrow(/no longer exists/);
    await expect(resolveContactChoice(d, { contactId: 99999 })).rejects.toThrow(/no longer exists/);
    expect((await live(d)).map((c) => c.id)).toEqual([twin]); // nothing was created or re-pointed
  });
});

describe('a NEW Contact is created on purpose, and a taken name is never reused', () => {
  it('a free name makes one new Contact with the optional details', async () => {
    const d = fresh();
    const r = await resolveContactChoice(d, { name: '  Pat   Example ', phone: ' 555-0100 ', email: 'pat@example.com', relationship: 'electrician' });
    expect(r).toMatchObject({ name: 'Pat Example', created: true });
    expect(await d.contacts.get(r.id)).toMatchObject({ name: 'Pat Example', phone: '555-0100', email: 'pat@example.com', relationship: 'electrician' });
  });

  it('a taken name (any case, accents, spacing) creates NOTHING and lists every live match; the existing Contact is byte-identical', async () => {
    const d = fresh();
    const a = await createDistinctContact(d, { name: 'José Example', phone: '555-0100' });
    const b = await createDistinctContact(d, { name: 'JOSE  example' });
    const before = [await raw(d, a), await raw(d, b)];
    for (const typed of ['jose example', ' JOSÉ   EXAMPLE ', 'José Example']) {
      const e = await resolveContactChoice(d, { name: typed, phone: '555-9999', email: 'new@example.com' }).catch((x) => x);
      expect(e).toBeInstanceOf(SameNameContactError);
      expect((e as SameNameContactError).matches.map((m) => m.id).sort()).toEqual([a, b].sort());
      expect((e as SameNameContactError).message).toMatch(/Nothing was saved/);
    }
    expect(await d.contacts.count()).toBe(2);
    expect([await raw(d, a), await raw(d, b)]).toEqual(before); // phone/email/relationship are NOT filled into the existing Contact
  });

  it('with the owner\'s confirmation it makes a SEPARATE Contact; the earlier ones keep their ids and are not edited', async () => {
    const d = fresh();
    const a = await createDistinctContact(d, { name: 'Sam Example', relationship: 'plumber' });
    const before = await raw(d, a);
    const r = await resolveContactChoice(d, { name: 'Sam Example', relationship: 'school coach', confirmedDifferent: true });
    expect(r.created).toBe(true);
    expect(r.id).not.toBe(a);
    expect(await raw(d, a)).toBe(before);
    expect((await live(d)).map((c) => c.name)).toEqual(['Sam Example', 'Sam Example']);
  });

  it('confirming when no Contact has the name changes nothing (it just creates)', async () => {
    const d = fresh();
    expect((await resolveContactChoice(d, { name: 'Unique Person', confirmedDifferent: true })).created).toBe(true);
    expect(await d.contacts.count()).toBe(1);
  });

  it('a REMOVED same-name Contact does not count as a match', async () => {
    const d = fresh();
    const old = await createDistinctContact(d, { name: 'Sam Example' });
    await d.contacts.update(old, { deletedAt: Date.now() });
    expect((await resolveContactChoice(d, { name: 'Sam Example' })).created).toBe(true);
  });

  it('a name that matches only loosely (a different word) is a different name: never fuzzy', async () => {
    const d = fresh();
    await createDistinctContact(d, { name: 'Sam Example' });
    expect((await resolveContactChoice(d, { name: 'Sam Examples' })).created).toBe(true);
    expect((await resolveContactChoice(d, { name: 'Samuel Example' })).created).toBe(true);
  });

  it('refuses unusable input in words and writes nothing', async () => {
    const d = fresh();
    await expect(resolveContactChoice(d, { name: '   ' })).rejects.toThrow(/name/);
    await expect(resolveContactChoice(d, { name: 'X', email: 'nope' })).rejects.toThrow(/email/);
    await expect(resolveContactChoice(d, { name: 'X'.repeat(121) })).rejects.toThrow(/too long/);
    await expect(resolveContactChoice(d, {})).rejects.toThrow(/name/);
    expect(await d.contacts.count()).toBe(0);
  });

  it('two overlapping requests for one new name cannot make two: the second sees the first', async () => {
    const d = fresh();
    const results = await Promise.allSettled([resolveContactChoice(d, { name: 'Race Example' }), resolveContactChoice(d, { name: 'Race Example' })]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const lost = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(lost.reason).toBeInstanceOf(SameNameContactError);
    expect((await live(d)).length).toBe(1);
  });
});

describe('inside a larger transaction', () => {
  it('a new Contact joins the caller\'s transaction: if the caller then fails, the Contact is taken back too', async () => {
    const d = fresh();
    await expect(d.transaction('rw', d.contacts, d.moduleRecords, async () => {
      await resolveContactChoice(d, { name: 'Rolled Back' });
      throw new Error('the owning record failed');
    })).rejects.toThrow(/owning record failed/);
    expect(await d.contacts.count()).toBe(0);
  });

  it('a refused same-name request inside a larger transaction rolls the whole thing back', async () => {
    const d = fresh();
    await createDistinctContact(d, { name: 'Sam Example' });
    await expect(d.transaction('rw', d.contacts, d.moduleRecords, async () => {
      await d.moduleRecords.add({ module: 'x', kind: 'y', data: {}, createdAt: 1, updatedAt: 1, deletedAt: null } as never);
      await resolveContactChoice(d, { name: 'sam example' });
    })).rejects.toBeInstanceOf(SameNameContactError);
    expect(await d.moduleRecords.count()).toBe(0);
  });
});

describe('small helpers', () => {
  it('findSameNameContacts is read only, live only, and never fuzzy', async () => {
    const d = fresh();
    const a = await createDistinctContact(d, { name: 'Sam Example' });
    const gone = await createDistinctContact(d, { name: 'Sam Example' });
    await d.contacts.update(gone, { deletedAt: 5 });
    const snap = JSON.stringify(await all(d));
    expect((await findSameNameContacts(d, ' sam  EXAMPLE ')).map((c) => c.id)).toEqual([a]);
    expect(await findSameNameContacts(d, 'Sam')).toEqual([]);
    expect(await findSameNameContacts(d, '   ')).toEqual([]);
    expect(JSON.stringify(await all(d))).toBe(snap);
  });

  it('hasContactChoice: an id or a non-blank name, otherwise nobody', () => {
    expect(hasContactChoice({ contactId: 3 })).toBe(true);
    expect(hasContactChoice({ name: ' Pat ' })).toBe(true);
    expect(hasContactChoice({ name: '   ' })).toBe(false);
    expect(hasContactChoice({ contactId: null })).toBe(false);
    expect(hasContactChoice(null)).toBe(false);
    expect(hasContactChoice(undefined)).toBe(false);
  });

  it('the test helper finds or makes ONE Contact per name in a test database, and nothing else imports it', async () => {
    const d = fresh();
    const a = await providerNamed(d, 'Pat Pools');
    const b = await providerNamed(d, '  pat   pools ');
    expect(b.contactId).toBe(a.contactId);
    expect(await d.contacts.count()).toBe(1);
    const fs = await import('node:fs');
    const path = await import('node:path');
    const users: string[] = [];
    const walk = (dir: string) => { for (const f of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, f.name); if (f.isDirectory()) walk(p); else if (/\.tsx?$/.test(f.name) && !/\.test\.tsx?$/.test(f.name) && /contactTestkit/.test(fs.readFileSync(p, 'utf8'))) users.push(p.replace(/\\/g, '/')); } };
    walk('src');
    expect(users.sort()).toEqual(['src/modules/household/householdSeed.ts']); // a test-only seed; no screen or data layer
  });
});
