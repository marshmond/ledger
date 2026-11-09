import { describe, expect, it } from 'vitest';
import { FinanceDB } from '../db';
import { createDistinctContact, findOrCreateContact, sameNameMatches, StaleContactError, updateContactDetails } from './contacts';
import { createStore } from './store';
import { installTracking } from '../lib/sync/track';

/** Contacts C1: safe editing of the shared Contact. Invented data only. */
let n = 0;
const fresh = () => { const d = new FinanceDB(`test-contact-edit-${n++}`); installTracking(d); return d; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const snapshot = async (d: FinanceDB) => JSON.stringify(await Promise.all(d.tables.map(async (t) => [t.name, await t.toArray()])));

describe('updateContactDetails: identity and unknown fields', () => {
  it('keeps the id, created time, references, unknown fields and the unused notes; only the four details change', async () => {
    const d = fresh();
    const id = await createDistinctContact(d, { name: 'Jordan Miller', phone: '555-0100', relationship: 'coach' });
    await d.contacts.update(id, { notes: 'kept as is', futureField: { a: [1, 2] } } as never);
    const refRow = await d.moduleRecords.add({ module: 'tasks', kind: 'task', createdAt: 1, updatedAt: 1, deletedAt: null, data: { title: 'Call', contactIds: [id] } } as never);
    const other = await createDistinctContact(d, { name: 'Someone Else' });
    const beforeOther = JSON.stringify(await d.contacts.get(other));
    const beforeRef = JSON.stringify(await d.moduleRecords.get(refRow as number));
    const before = (await d.contacts.get(id))!;
    await sleep(3);
    const r = await updateContactDetails(d, id, { name: 'Jordan Millar', phone: '', email: 'jm@example.com', relationship: 'soccer coach' });
    expect(r).toEqual({ changed: true });
    const after = (await d.contacts.get(id))! as unknown as Record<string, unknown>;
    expect(after).toMatchObject({ id, name: 'Jordan Millar', email: 'jm@example.com', relationship: 'soccer coach', createdAt: before.createdAt, notes: 'kept as is', futureField: { a: [1, 2] } });
    expect(after.phone).toBeUndefined();
    expect(after.updatedAt as number).toBeGreaterThan(before.updatedAt);
    expect(await d.contacts.count()).toBe(2);
    expect(JSON.stringify(await d.contacts.get(other))).toBe(beforeOther); // an unrelated Contact is byte-identical
    expect(JSON.stringify(await d.moduleRecords.get(refRow as number))).toBe(beforeRef); // the reference still points at the same id, untouched
  });

  it('a save that changes nothing writes nothing: the version, updatedAt and the whole database stay identical', async () => {
    const d = fresh();
    const id = await createDistinctContact(d, { name: 'Jordan Miller', phone: ' 555-0100 ', relationship: 'coach' });
    const before = await snapshot(d);
    await sleep(3);
    // extra spaces and an empty optional field are the same thing once tidied
    expect(await updateContactDetails(d, id, { name: '  Jordan   Miller', phone: '555-0100', email: '', relationship: 'coach' })).toEqual({ changed: false });
    expect(await snapshot(d)).toBe(before);
  });

  it('a change of letter case or accents only IS a change (the name is rewritten as typed)', async () => {
    const d = fresh();
    const id = await createDistinctContact(d, { name: 'jordan miller' });
    expect((await updateContactDetails(d, id, { name: 'Jordan Miller' })).changed).toBe(true);
    expect((await d.contacts.get(id))!.name).toBe('Jordan Miller');
  });

  it('refuses invalid details and a missing or removed contact, writing nothing (the old callers\' rules)', async () => {
    const d = fresh();
    const id = await createDistinctContact(d, { name: 'Dana' });
    const before = await snapshot(d);
    await expect(updateContactDetails(d, id, { name: 'Dana', email: 'bad' })).rejects.toThrow(/email/);
    await expect(updateContactDetails(d, id, { name: '   ' })).rejects.toThrow(/name/);
    await expect(updateContactDetails(d, 987654, { name: 'x' })).rejects.toThrow(/no longer exists/);
    await createStore(d).shared.contacts.remove(id);
    await expect(updateContactDetails(d, id, { name: 'Dana 2' })).rejects.toThrow(/no longer exists/);
    expect(JSON.stringify((await d.contacts.get(id))!.name)).toBe('"Dana"');
    void before;
  });

  it('called the old way (no expected version) it still saves, as the Projects and Services screens do', async () => {
    const d = fresh();
    const id = await createDistinctContact(d, { name: 'Dana Smith' });
    await d.contacts.update(id, { name: 'Dana Smith' }); // some other write happened meanwhile
    await expect(updateContactDetails(d, id, { name: 'Dana Smyth' })).resolves.toEqual({ changed: true });
    expect((await d.contacts.get(id))!.name).toBe('Dana Smyth');
  });
});

describe('stale-edit protection', () => {
  it('a save made on an older version is refused, the newer record is preserved and nothing is written', async () => {
    const d = fresh();
    const id = await createDistinctContact(d, { name: 'Jordan Miller' });
    const opened = (await d.contacts.get(id))!; // the form loads this version
    await sleep(3);
    await updateContactDetails(d, id, { name: 'Jordan Miller', phone: '555-0199' }); // another tab or a sync changes it
    const newer = JSON.stringify(await d.contacts.get(id));
    await expect(updateContactDetails(d, id, { name: 'Jordan M.' }, { expected: opened })).rejects.toBeInstanceOf(StaleContactError);
    expect(JSON.stringify(await d.contacts.get(id))).toBe(newer);
  });

  it('with the current version it saves; and two edits from the same opened version cannot both win', async () => {
    const d = fresh();
    const id = await createDistinctContact(d, { name: 'Jordan Miller' });
    const opened = (await d.contacts.get(id))!;
    await sleep(3);
    await expect(updateContactDetails(d, id, { name: 'First' }, { expected: opened })).resolves.toEqual({ changed: true });
    await expect(updateContactDetails(d, id, { name: 'Second' }, { expected: opened })).rejects.toBeInstanceOf(StaleContactError);
    expect((await d.contacts.get(id))!.name).toBe('First');
  });

  it('the check is atomic with the write: two simultaneous saves from one opened version leave exactly one winner', async () => {
    const d = fresh();
    const id = await createDistinctContact(d, { name: 'Jordan Miller' });
    const opened = (await d.contacts.get(id))!;
    await sleep(3);
    const results = await Promise.allSettled([
      updateContactDetails(d, id, { name: 'Tab A' }, { expected: opened }),
      updateContactDetails(d, id, { name: 'Tab B' }, { expected: opened }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(['Tab A', 'Tab B']).toContain((await d.contacts.get(id))!.name);
  });

  it('a change made in the SAME millisecond is still noticed, because the details are compared as well as the time', async () => {
    const d = fresh();
    const id = await createDistinctContact(d, { name: 'Jordan Miller', phone: '555-0100' });
    const stored = (await d.contacts.get(id))!;
    const openedOnOlder = { ...stored, phone: '555-0000' }; // same updatedAt as now, different details
    await expect(updateContactDetails(d, id, { name: 'Jordan M.' }, { expected: openedOnOlder })).rejects.toBeInstanceOf(StaleContactError);
    expect((await d.contacts.get(id))!.name).toBe('Jordan Miller');
    await expect(updateContactDetails(d, id, { name: 'Jordan M.' }, { expected: stored })).resolves.toEqual({ changed: true });
  });

  it('a removed contact is refused rather than revived', async () => {
    const d = fresh();
    const id = await createDistinctContact(d, { name: 'Gone' });
    const opened = (await d.contacts.get(id))!;
    await createStore(d).shared.contacts.remove(id);
    await expect(updateContactDetails(d, id, { name: 'Back' }, { expected: opened })).rejects.toThrow(/no longer exists/);
  });
});

describe('same-name matching', () => {
  it('matches by the established nameKey (case, accents, spacing), only live contacts, optionally leaving one out; never fuzzy', async () => {
    const d = fresh();
    const s = createStore(d).shared.contacts;
    const a = await s.put({ name: 'José  García' } as never);
    const b = await s.put({ name: 'jose garcia' } as never);
    const gone = await s.put({ name: 'Jose Garcia' } as never);
    await s.remove(gone);
    await s.put({ name: 'Jose Garcia Jr' } as never);
    const all = await d.contacts.toArray();
    expect(sameNameMatches(all, 'JOSE GARCIA').map((c) => c.id).sort()).toEqual([a, b].sort());
    expect(sameNameMatches(all, 'Jose Garcia', a).map((c) => c.id)).toEqual([b]);
    expect(sameNameMatches(all, '   ')).toEqual([]);
    expect(sameNameMatches(all, 'Jose')).toEqual([]);
  });
});

describe('creating through the Contacts rules', () => {
  it('createDistinctContact twice with one name makes two Contacts and never touches the first; findOrCreateContact would have merged', async () => {
    const d = fresh();
    const first = await createDistinctContact(d, { name: 'Maria Test', phone: '555-0100' });
    const firstJson = JSON.stringify(await d.contacts.get(first));
    const second = await createDistinctContact(d, { name: 'maria  test', email: 'm@example.com' });
    expect(second).not.toBe(first);
    expect(await d.contacts.count()).toBe(2);
    expect(JSON.stringify(await d.contacts.get(first))).toBe(firstJson);
    expect((await findOrCreateContact(d, { name: 'Maria Test' })).created).toBe(false); // the merging helper, for contrast: not used by the Contacts module
  });
});
