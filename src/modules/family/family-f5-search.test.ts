import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDistinctContact } from '../../core/contacts';
import { allSearchSources } from '../../core/registry';
import { groupResults } from '../../shell/searchGroups';
import { searchContactsData } from '../contacts/searchSource';
import { FinanceDB } from '../../db';
import { createStore } from '../../core/store';
import { scanText } from '../../lib/leakTestkit';
import { createMember, loadMembers, setMemberStatus } from './data';
import { createDate, setDateStatus } from './dateData';
import { familySearchSource, readFamilySearchData, searchFamilyData } from './searchSource';
import { registerModules } from '../index';

/** F5 Family search: behaviour over real Family records in a fresh database. Invented names and dates only. */
let n = 0;
const fresh = () => new FinanceDB(`test-family-f5-search-${n++}`);
const snapshot = async (d: FinanceDB) => JSON.stringify(await Promise.all(d.tables.map(async (t) => [t.name, await t.toArray()])));
type Fields = Parameters<typeof createMember>[0]['fields'];
const contact = (d: FinanceDB, name: string, extra: Record<string, string> = {}) => createDistinctContact(d, { name, ...extra });
const member = async (d: FinanceDB, contactId: number, over: Partial<Fields> = {}) => (await createMember({ contact: { mode: 'existing', contactId }, fields: { role: 'child', status: 'active', ...over } }, d, 2026)).id;
const find = async (d: FinanceDB, q: string, cap = 8) => searchFamilyData(q, await readFamilySearchData(d), cap);
afterEach(() => vi.unstubAllGlobals());

/** Sam (child, birthday 14 May, note and year set), Jo (spouse), Alex (parent), and Gran (grandparent, past). Phone, email, notes and year are planted to prove they never surface. */
async function household() {
  const d = fresh();
  const sam = await contact(d, 'Sam Example', { phone: '555-0142', email: 'sam.secret@example.test', relationship: 'my child' });
  const jo = await contact(d, 'Jo Example');
  const alex = await contact(d, 'Alex Example');
  const gran = await contact(d, 'Gran Example');
  const coach = await contact(d, 'Coach Example');
  const samM = await member(d, sam, { birthMonthDay: '05-14', birthYear: 2015, note: 'allergic to zebra-nuts', color: '#4a7bd0' });
  const joM = await member(d, jo, { role: 'spouse', birthMonthDay: '09-02' });
  const alexM = await member(d, alex, { role: 'parent' });
  const granM = await member(d, gran, { role: 'grandparent', status: 'past', birthMonthDay: '01-20' });
  return { d, sam, jo, alex, gran, coach, samM, joM, alexM, granM };
}

describe('registration', () => {
  registerModules();
  it('Family answers global search as its own "Family" group, next to (not inside) the Contacts group', () => {
    const fam = allSearchSources().filter((s) => s.moduleId === 'family');
    expect(fam).toHaveLength(1);
    expect(fam[0].source.group).toBe('Family');
    expect(allSearchSources().find((s) => s.moduleId === 'contacts')!.source.group).toBe('Contacts');
    expect(fam[0].source).toBe(familySearchSource);
  });
  it('a search for nothing, or only spaces, finds nothing', async () => {
    const { d } = await household();
    expect(await find(d, '')).toEqual([]);
    expect(await find(d, '   ')).toEqual([]);
  });
  it('the source itself answers through the application database (smoke test: no match, no error)', async () => {
    expect(await familySearchSource.search('zzzz-no-such-person', 5)).toEqual([]);
  });
});

describe('members', () => {
  it('an active member is found by name, labelled "Family member", with their relationship, and opens their own page', async () => {
    const { d, samM } = await household();
    const r = await find(d, 'sam');
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ id: `family-member:${samM}`, title: 'Sam Example', subtitle: 'Child', kind: 'Family member', path: `/family/m/${samM}` });
  });

  it('matches part of a name, any case, and ignores accents', async () => {
    const { d, samM } = await household();
    expect((await find(d, 'EXAM'))).toHaveLength(4); // Sam, Jo, Alex and Gran (past)
    expect((await find(d, 'sám'))[0].id).toBe(`family-member:${samM}`);
  });

  it('can be found by relationship ("spouse")', async () => {
    const { d, joM } = await household();
    const r = await find(d, 'spouse');
    expect(r.map((x) => x.id)).toEqual([`family-member:${joM}`]);
    expect(r[0].subtitle).toBe('Spouse');
  });

  it('a past member is found and says so; an active member ranks above a past one', async () => {
    const { d, granM } = await household();
    const r = await find(d, 'gran');
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ id: `family-member:${granM}`, subtitle: 'Grandparent · Past member', kind: 'Family member' });
    const both = await find(d, 'example');
    const idx = (id: number) => both.findIndex((x) => x.id === `family-member:${id}`);
    expect(idx(granM)).toBeGreaterThan(-1);
    for (const m of both.filter((x) => !/Past member/.test(x.subtitle ?? ''))) expect(both.indexOf(m)).toBeLessThan(idx(granM));
  });

  it('two different people with the same name are two separate hits that open their own pages (never merged)', async () => {
    const d = fresh();
    const a = await contact(d, 'Pat Example', { relationship: 'cousin' });
    const b = await contact(d, 'Pat Example');
    const aM = await member(d, a, { role: 'other' });
    const bM = await member(d, b, { role: 'child' });
    const r = await find(d, 'pat example');
    expect(r.map((x) => x.id).sort()).toEqual([`family-member:${aM}`, `family-member:${bM}`].sort());
    expect(r.map((x) => x.path).sort()).toEqual([`/family/m/${aM}`, `/family/m/${bM}`].sort());
    expect(new Set(r.map((x) => x.id)).size).toBe(2);
    expect(r.every((x) => /^(Child|Other) · Added /.test(x.subtitle ?? ''))).toBe(true); // same name: each also says when it was added
    expect((await find(d, 'pat'))[0].subtitle).toMatch(/Added /);
  });

  it('two member records for one Contact (a cross-device duplicate) are each flagged, not merged or hidden', async () => {
    const d = fresh();
    const c = await contact(d, 'Dana Example');
    const first = await member(d, c, { birthMonthDay: '03-03' });
    // A second device added the same Contact while offline: write the second row directly (createMember refuses an active duplicate).
    const second = await d.moduleRecords.add({ module: 'family', kind: 'member', createdAt: 5, updatedAt: 5, deletedAt: null, data: { contactId: c, role: 'child', status: 'active' } } as never) as number;
    const r = await find(d, 'dana');
    expect(r.map((x) => x.id).sort()).toEqual([`family-member:${first}`, `family-member:${second}`].sort());
    for (const x of r) expect(x.subtitle).toMatch(/Possible duplicate/);
    // ...but the person has one birthday.
    expect(await find(d, 'dana birthday')).toHaveLength(1);
  });

  it('a record that cannot be read, a deleted member, and a member whose Contact is gone are not offered', async () => {
    const { d, alexM, samM, sam } = await household();
    await d.moduleRecords.add({ module: 'family', kind: 'member', createdAt: 1, updatedAt: 1, deletedAt: null, data: { role: 'child' } } as never); // unreadable
    await d.moduleRecords.update(alexM, { deletedAt: Date.now() }); // soft-deleted member
    await d.contacts.update(sam, { deletedAt: Date.now() }); // Sam's Contact deleted
    const r = await find(d, 'example');
    expect(r.map((x) => x.id)).not.toContain(`family-member:${alexM}`);
    expect(r.map((x) => x.id)).not.toContain(`family-member:${samM}`);
    expect(r.every((x) => x.title !== 'Contact no longer exists')).toBe(true);
  });
});

describe('Contact results are a different, visibly separate result', () => {
  it('a member and their Contact are two hits with different groups, kinds and destinations', async () => {
    const { d, sam, samM } = await household();
    const data = await readFamilySearchData(d);
    const family = searchFamilyData('sam', data);
    const contacts = searchContactsData('sam', await createStore(d).shared.contacts.query());
    expect(family[0]).toMatchObject({ kind: 'Family member', path: `/family/m/${samM}` });
    expect(contacts[0]).toMatchObject({ kind: 'Contact', path: `/contacts/c/${sam}` });
    expect(family[0].id).not.toBe(contacts[0].id);
    // The dialog shows them under two headings.
    const groups = groupResults([
      { moduleId: 'contacts', name: 'Contacts', results: contacts },
      { moduleId: 'family', name: 'Family', results: family },
    ]);
    expect(groups.map((g) => g.name).sort()).toEqual(['Contacts', 'Family']);
  });

  it('a Contact who is not a member has no Family hit', async () => {
    const { d } = await household();
    expect(await find(d, 'coach')).toEqual([]);
  });
});

describe('birthdays', () => {
  it('a plain name finds the member once; the birthday appears only when the words are about the date', async () => {
    const { d, samM } = await household();
    expect((await find(d, 'sam')).map((x) => x.kind)).toEqual(['Family member']);
    const r = await find(d, 'sam birthday');
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ id: `family-birthday:${samM}`, title: "Sam Example's birthday", subtitle: '14 May', kind: 'Family birthday', path: `/family/m/${samM}` });
  });

  it('is found by month and day, without a year, for active members only (a past member has no birthday)', async () => {
    const { d, samM } = await household();
    const r = await find(d, '14 may');
    expect(r.map((x) => x.id)).toEqual([`family-birthday:${samM}`]);
    expect(scanText(r)).not.toMatch(/2015/);
    expect(await find(d, '20 january')).toEqual([]); // Gran (past)
    expect((await find(d, 'birthday')).filter((x) => x.kind !== 'Page').map((x) => x.kind)).toEqual(['Family birthday', 'Family birthday']); // Sam and Jo; not Gran, not Alex (none set)
  });

  it('a birthday kept off the Calendar can still be found (search is not the Calendar)', async () => {
    const d = fresh();
    const c = await contact(d, 'Lee Example');
    const m = await member(d, c, { birthMonthDay: '12-25', birthdayOnCalendar: false });
    expect((await find(d, 'lee birthday')).map((x) => x.id)).toEqual([`family-birthday:${m}`]);
  });

  it('a leap-day birthday is found as 29 February', async () => {
    const d = fresh();
    const c = await contact(d, 'Leap Example');
    await member(d, c, { birthMonthDay: '02-29' });
    expect((await find(d, '29 february'))[0].subtitle).toBe('29 February');
  });
});

describe('important dates', () => {
  async function withDates() {
    const h = await household();
    const wedding = await createDate({ dateKind: 'anniversary', label: 'Wedding anniversary', monthDay: '06-21', year: 2012, memberId: h.joM, status: 'active' }, h.d, 2026);
    const closing = await createDate({ dateKind: 'other', label: 'Pool closing day', monthDay: '09-15', status: 'active' }, h.d, 2026);
    const old = await createDate({ dateKind: 'other', label: 'Old pool date', monthDay: '04-01', status: 'active' }, h.d, 2026);
    await setDateStatus(old, 'archived', h.d);
    return { ...h, wedding, closing, old };
  }

  it('is found by its label, labelled "Family date", with the date (no year) and who it is about', async () => {
    const { d, wedding, joM } = await withDates();
    const r = await find(d, 'wedding');
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ id: `family-date:${wedding}`, title: 'Wedding anniversary', subtitle: '21 June · Anniversary · About Jo Example', kind: 'Family date', path: `/family/m/${joM}` });
    expect(scanText(r)).not.toMatch(/2012/);
  });

  it('a household-wide date opens the Family dates page', async () => {
    const { d, closing } = await withDates();
    const r = await find(d, 'pool closing');
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ id: `family-date:${closing}`, subtitle: '15 September · Other important date', path: '/family/dates' });
  });

  it('is found by kind or by day, and an archived date is not offered', async () => {
    const { d, wedding, closing } = await withDates();
    expect((await find(d, 'anniversary')).map((x) => x.id)).toEqual([`family-date:${wedding}`]);
    expect((await find(d, '15 september')).map((x) => x.id)).toEqual([`family-date:${closing}`]);
    expect(await find(d, 'old pool')).toEqual([]);
  });

  it('a date about a past member still opens that member; a date whose member record is gone opens the dates page', async () => {
    const { d, wedding, closing, joM } = await withDates();
    await setMemberStatus(joM, 'past', d);
    expect((await find(d, 'wedding'))[0].path).toBe(`/family/m/${joM}`);
    await d.moduleRecords.update(closing, { data: { dateKind: 'other', label: 'Pool closing day', monthDay: '09-15', status: 'active', memberId: 99999 } });
    expect((await find(d, 'pool closing'))[0]).toMatchObject({ path: '/family/dates', subtitle: '15 September · Other important date' });
    expect(wedding).toBeGreaterThan(0);
  });

  it('a damaged date record is skipped without hiding the others', async () => {
    const { d } = await withDates();
    await d.moduleRecords.add({ module: 'family', kind: 'date', createdAt: 1, updatedAt: 1, deletedAt: null, data: null } as never);
    await d.moduleRecords.add({ module: 'family', kind: 'date', createdAt: 1, updatedAt: 1, deletedAt: null, data: { label: 'Broken', monthDay: '13-45' } } as never);
    expect((await find(d, 'pool closing'))).toHaveLength(1);
    expect(await find(d, 'broken')).toEqual([]);
  });
});

describe('pages', () => {
  it('"family" and "dates" offer the Family pages, so the module can be found by name', async () => {
    const { d } = await household();
    const r = await find(d, 'family');
    expect(r.map((x) => [x.kind, x.title, x.path])).toEqual([['Page', 'Family', '/family'], ['Page', 'Family dates', '/family/dates']]); // "family" alone lists the pages, not every person
    expect((await find(d, 'family sam'))[0].kind).toBe('Family member');
    expect((await find(d, 'family birthday')).filter((x) => x.kind === 'Family birthday')).toHaveLength(2);
    expect((await find(d, 'family dates')).find((x) => x.kind === 'Page')).toMatchObject({ title: 'Family dates', path: '/family/dates' });
  });
});

describe('every destination is a route Family really serves', () => {
  const module = readFileSync('src/modules/family/FamilyModule.tsx', 'utf8');
  it('the route table has the overview, member and dates routes the hits use', () => {
    expect(module).toMatch(/<Route index element/);
    expect(module).toMatch(/path="m\/:id"/);
    expect(module).toMatch(/path="dates"/);
  });
  it('all hits for broad queries use only /family, /family/dates and /family/m/<id>', async () => {
    const h = await household();
    await createDate({ dateKind: 'anniversary', label: 'Wedding anniversary', monthDay: '06-21', memberId: h.joM, status: 'active' }, h.d, 2026);
    await createDate({ dateKind: 'other', label: 'Pool day', monthDay: '09-15', status: 'active' }, h.d, 2026);
    const seen = new Set<string>();
    for (const q of ['e', 'a', 'family', 'birthday', 'date', 'may', 'example']) for (const r of await find(h.d, q, 50)) seen.add(r.path!);
    expect(seen.size).toBeGreaterThan(3);
    for (const p of seen) expect(p).toMatch(/^\/family(\/dates|\/m\/\d+)?$/);
  });
});

describe('uniqueness and limits', () => {
  it('every hit has its own id, however broad the query', async () => {
    const { d } = await household();
    await createDate({ dateKind: 'other', label: 'Example day', monthDay: '07-07', status: 'active' }, d, 2026);
    for (const q of ['e', 'example', 'a', 'birthday family']) {
      const r = await find(d, q, 100);
      expect(new Set(r.map((x) => x.id)).size, q).toBe(r.length);
    }
  });
  it('respects the cap and returns the best first', async () => {
    const { d } = await household();
    const r = await find(d, 'example', 2);
    expect(r).toHaveLength(2);
    const all = await find(d, 'example', 50);
    expect(r.map((x) => x.id)).toEqual(all.slice(0, 2).map((x) => x.id));
  });
});

describe('privacy: no note, contact detail or birth year is searched, shown or returned', () => {
  it('searching for what is only in a note, phone, email, relationship or year finds nothing', async () => {
    const { d } = await household();
    for (const q of ['zebra', 'allergic', '555-0142', '0142', 'sam.secret', 'secret', 'my child', '2015']) expect(await find(d, q), q).toEqual([]);
  });
  it('the whole result list for broad queries contains none of them (checked with the repository\'s own scanner)', async () => {
    const { d } = await household();
    const all: unknown[] = [];
    for (const q of ['e', 'a', 'sam', 'birthday', 'family', 'may', 'example']) all.push(...(await find(d, q, 100)));
    const text = scanText(all); // generated ids and timestamps are replaced first (src/lib/leakTestkit.ts), so only real text can match
    expect(text).not.toMatch(/zebra|allergic|secret|my child|sam\.secret|@example\.test/);
    expect(text).not.toMatch(/2015/);
  });
  it('the search code reads a Contact\'s name only and never touches the member note', () => {
    const src = readFileSync('src/modules/family/searchSource.ts', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(src).not.toMatch(/\.(phone|email|notes|relationship)\b/);
    expect(src).not.toMatch(/\.note\b|birthYear|\.year\b/);
  });
  it('the reader keeps only Contact names', async () => {
    const { d } = await household();
    const data = await readFamilySearchData(d);
    for (const v of data.names.values()) expect(typeof v).toBe('string');
    expect(scanText([...data.names])).not.toMatch(/555|secret/);
  });
});

describe('read-only', () => {
  it('searching changes no row and no timestamp in any table', async () => {
    const { d, joM } = await household();
    await createDate({ dateKind: 'anniversary', label: 'Wedding anniversary', monthDay: '06-21', memberId: joM, status: 'active' }, d, 2026);
    const before = await snapshot(d);
    for (const q of ['e', 'sam', 'sam birthday', 'wedding', 'family', 'spouse', '14 may', 'nothing-here']) await find(d, q, 50);
    expect(await snapshot(d)).toBe(before);
    expect((await loadMembers(d)).length).toBe(4);
  });
  it('it makes no network call', async () => {
    const { d } = await household();
    const fetchSpy = vi.fn(() => { throw new Error('network is not allowed'); });
    vi.stubGlobal('fetch', fetchSpy);
    await find(d, 'sam');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it('the search files contain no write, transaction, storage, network or logging call', () => {
    const src = readFileSync('src/modules/family/searchSource.ts', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(src).not.toMatch(/\.(add|put|bulkAdd|bulkPut|update|delete|bulkDelete|clear|modify|remove|restore)\(|\.transaction\(|localStorage|sessionStorage|fetch\(|XMLHttpRequest|console\./);
  });
});

describe('a Contact rename shows through', () => {
  it('search follows the Contact\'s current name, and the member keeps its id', async () => {
    const { d, sam, samM } = await household();
    await d.contacts.update(sam, { name: 'Robert Example' });
    const r = await find(d, 'robert');
    expect(r.map((x) => x.id)).toEqual([`family-member:${samM}`]);
    expect(await find(d, 'sam birthday')).toEqual([]); // the old name no longer matches (names are not copied)
    expect((await find(d, 'robert birthday'))[0].id).toBe(`family-birthday:${samM}`);
  });
});
