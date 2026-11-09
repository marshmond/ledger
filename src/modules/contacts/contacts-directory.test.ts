import { describe, expect, it } from 'vitest';
import type { Contact } from '../../core/entities';
import { filterContacts, mailHref, sameNameCounts, sortContacts, telHref, distinguish, contactPath, contactRoute } from './model';
import { searchContactsData } from './searchSource';
import { validEmail } from '../../core/contacts';
import { searchTasksData } from '../tasks/searchSource';
import { scanText } from '../../lib/leakTestkit';

/** Contacts C1: directory search, sort, duplicate markers and Global Search privacy. Invented data only. */
let id = 1_780_000_000_000_000;
const c = (name: string, extra: Partial<Contact> = {}): Contact => ({ id: id++, name, createdAt: 1_000, updatedAt: 1_000, deletedAt: null, ...extra });

const people = [
  c('Jordan Miller', { relationship: 'Soccer coach', phone: '555-0100', email: 'jordan@example.com', updatedAt: 3_000 }),
  c('José García', { relationship: 'plumber', phone: '(555) 010-2030', updatedAt: 5_000 }),
  c('Example Elementary Office', { relationship: 'school', email: 'office@school.example', updatedAt: 2_000 }),
  c('jose garcia', { relationship: 'neighbour', updatedAt: 4_000 }),
  c('Zed', { updatedAt: 1_000 }),
];

describe('directory search', () => {
  const names = (q: string) => filterContacts(people, q).map((p) => p.name);
  it('finds by name, ignoring case and accents', () => {
    expect(names('jordan')).toEqual(['Jordan Miller']);
    expect(names('JOSE GARCIA')).toEqual(['José García', 'jose garcia']);
  });
  it('finds by relationship, email and phone (digits alone also match a formatted phone)', () => {
    expect(names('coach')).toEqual(['Jordan Miller']);
    expect(names('office@school')).toEqual(['Example Elementary Office']);
    expect(names('555-0100')).toEqual(['Jordan Miller']);
    expect(names('5550102030')).toEqual(['José García']);
  });
  it('every typed word must match; an empty query keeps everyone; nothing matches nonsense', () => {
    expect(names('jose plumber')).toEqual(['José García']);
    expect(names('jose coach')).toEqual([]);
    expect(names('   ')).toHaveLength(5);
    expect(names('zzzz')).toEqual([]);
  });
});

describe('sorting', () => {
  it('A to Z ignores case and accents and is stable for equal names', () => {
    const out = sortContacts(people, 'name').map((p) => p.name);
    expect(out[0]).toBe('Example Elementary Office');
    expect(out.slice(-1)).toEqual(['Zed']);
    expect(sortContacts(people, 'name').map((p) => p.id)).toEqual(sortContacts([...people].reverse(), 'name').map((p) => p.id));
  });
  it('recently changed puts the newest first', () => {
    expect(sortContacts(people, 'recent').map((p) => p.name)).toEqual(['José García', 'jose garcia', 'Jordan Miller', 'Example Elementary Office', 'Zed']);
  });
  it('does not change the list it was given', () => {
    const copy = [...people];
    sortContacts(people, 'recent');
    expect(people).toEqual(copy);
  });
});

describe('same-name markers', () => {
  it('marks each contact in a group with how many OTHERS share its name, from one pass', () => {
    const m = sameNameCounts(people);
    expect(m.get(people[1].id!)).toBe(1);
    expect(m.get(people[3].id!)).toBe(1);
    expect(m.has(people[0].id!)).toBe(false);
  });
  it('ignores removed contacts', () => {
    const gone = c('Jordan Miller', { deletedAt: 9 });
    expect(sameNameCounts([...people, gone]).size).toBe(2);
  });
  it('distinguishing text uses relationship, phone, email and the added date, never notes', () => {
    const t = distinguish(c('X', { relationship: 'sister', phone: '555-0100', email: 'x@example.com', notes: 'SECRET' } as never));
    expect(t).toMatch(/sister · 555-0100 · x@example.com · added /);
    expect(t).not.toMatch(/SECRET/);
    expect(distinguish(c('Y'))).toMatch(/^no other details · added /);
  });
});

describe('links', () => {
  it('a phone link keeps digits and a leading plus only; nothing dialable gives no link', () => {
    expect(telHref('+1 (555) 010-0100 ext. 5')).toBe('tel:+15550100100' + '5');
    expect(telHref('call me')).toBeNull();
    expect(telHref('javascript:alert(1)')).toBe('tel:1');
  });
  it('a mail link only for a valid address, and the address is encoded', () => {
    expect(mailHref('a@example.com', validEmail)).toBe('mailto:a@example.com');
    expect(mailHref('a@example.com?cc=evil@example.com', validEmail)).toBeNull(); // a second address smuggled in is not a valid address
    expect(mailHref('a?subject=x@example.com', validEmail)).toBe('mailto:a%3Fsubject%3Dx@example.com');
    expect(mailHref('not an address', validEmail)).toBeNull();
    expect(mailHref('javascript:alert(1)//@x.y', validEmail)).toBe('mailto:javascript%3Aalert(1)%2F%2F@x.y');
  });
  it('the detail address is /contacts/c/<id>', () => {
    expect(contactRoute(42)).toBe('/c/42');
    expect(contactPath(42)).toBe('/contacts/c/42');
  });
});

describe('Global Search', () => {
  const rich = [c('Jordan Miller', { relationship: 'Soccer coach', phone: '555-0100', email: 'jordan@example.com', notes: 'private note text' } as never), c('Pat Plumber', { relationship: 'plumber' })];
  it('finds a contact by name or relationship and opens its own page', () => {
    const r = searchContactsData('jordan', rich);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ title: 'Jordan Miller', subtitle: 'Soccer coach', kind: 'Contact', path: `/contacts/c/${rich[0].id}` });
    expect(searchContactsData('plumber', rich).map((x) => x.title)).toEqual(['Pat Plumber']);
  });
  it('never searches or returns phone, email or notes', () => {
    for (const q of ['555-0100', '5550100', 'jordan@example.com', 'example.com', 'private note']) expect(searchContactsData(q, rich), q).toEqual([]);
    // scanText: the ids and timestamps in the result are clock-based and could contain "555" by chance.
    expect(scanText(searchContactsData('jordan', rich))).not.toMatch(/555|example\.com|private/);
  });
  it('caps results and ignores an empty query', () => {
    const many = Array.from({ length: 30 }, (_, i) => c(`Maria ${i}`));
    expect(searchContactsData('maria', many)).toHaveLength(8);
    expect(searchContactsData('  ', many)).toEqual([]);
  });
  it('the Tasks "contact" result is labelled so it cannot be mistaken for the Contact page', () => {
    const t = searchTasksData('jordan', [], [], [{ id: 9, name: 'Jordan Miller' }]);
    expect(t[0]).toMatchObject({ kind: 'Tasks for contact', subtitle: '0 open tasks', path: '/tasks?v=all&contact=9' });
    expect(searchContactsData('jordan', rich)[0].kind).not.toBe(t[0].kind);
  });
});
