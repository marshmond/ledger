import { describe, expect, it } from 'vitest';
import { cleanReference, facetsOf, groupReferences, readContactReferences, sortReferences, unlistedMentions, type ContactReference, type ContactReferenceProvider } from '../../core/contactReferences';
import { readContactUsage } from '../../core/contactUsage';
import { createDistinctContact } from '../../core/contacts';
import { allContactReferenceProviders } from '../../core/registry';
import { readContactReferences as readFamilyCounts } from '../family/references';
import { registerModules } from '../index';
import { eventRecords } from '../calendar/records';
import { taskRecords } from '../tasks/records';
import { projectRecords } from '../projects/records';
import { assetRecords } from '../assets/records';
import { serviceRecords } from '../services/records';
import { billRecords } from '../bills/records';
import { freshDb, PROVIDERS, row, seedEverywhere, snapshot, TODAY } from './c2-testkit';

/** Contacts C2: the named cross-module reference readers. Invented data only. */
const read = (d: ReturnType<typeof freshDb>, ids: number[]) => readContactReferences(ids, d, PROVIDERS, TODAY);
const by = (refs: ContactReference[], module: string, kind: string) => refs.filter((r) => r.module === module && r.kind === kind);

describe('every supported field gives a named, linkable reference', () => {
  it('finds one reference per stored relationship, in the right module, with a plain relationship and an address', async () => {
    const d = freshDb();
    const { c, ids } = await seedEverywhere(d);
    const r = await read(d, [c]);
    expect(r.verified).toBe(true);
    const refs = r.byContact.get(c)!;
    const line = (x: ContactReference) => `${x.module}/${x.kind}:${x.recordId}:${x.role}`;
    expect(refs.map(line).sort()).toEqual([
      `family/member:${ids.member}:member`, `family/contact:${ids.important}:important`, `family/contact:${ids.importantOld}:important`,
      `calendar/event:${ids.event}:person`, `tasks/task:${ids.task}:person`,
      `projects/project:${ids.project}:vendor`, `projects/commitment:${ids.commitment}:vendor`,
      `assets/asset:${ids.asset}:person:installer`, `assets/service:${ids.service}:provider`, `assets/warranty:${ids.warranty}:provider`,
      `services/arrangement:${ids.arrangement}:provider`, `services/visit:${ids.visit}:provider`, `bills/obligation:${ids.bill}:provider`,
    ].sort());
    const one = (m: string, k: string, id: number) => refs.find((x) => x.module === m && x.kind === k && x.recordId === String(id))!;
    expect(one('tasks', 'task', ids.task)).toMatchObject({ title: 'Book the dentist', relation: 'Listed under People on this task', status: 'To do', date: '2026-12-01', href: `/tasks?task=${ids.task}` });
    expect(one('calendar', 'event', ids.event)).toMatchObject({ title: 'Parent meeting', date: '2026-12-02' });
    expect(one('calendar', 'event', ids.event).href).toContain(`/calendar?v=agenda&d=2026-12-02&open=`);
    expect(one('projects', 'project', ids.project)).toMatchObject({ title: 'Kitchen refit', href: `/projects/${ids.project}`, facet: 'project' });
    expect(one('projects', 'commitment', ids.commitment)).toMatchObject({ title: 'Cabinet quote', status: 'Accepted', href: `/projects/${ids.project}` });
    expect(one('projects', 'commitment', ids.commitment).relation).toContain('Kitchen refit');
    expect(one('assets', 'asset', ids.asset).relation).toBe('Related person on this item, as “installer”');
    expect(one('assets', 'service', ids.service)).toMatchObject({ href: `/assets/${ids.asset}?service=${ids.service}`, date: '2026-03-01', facet: 'provider' });
    expect(one('assets', 'warranty', ids.warranty).href).toBe(`/assets/${ids.asset}?warranty=${ids.warranty}`);
    expect(one('services', 'arrangement', ids.arrangement)).toMatchObject({ title: 'House cleaning', href: `/services/a/${ids.arrangement}`, facet: 'provider' });
    expect(one('services', 'visit', ids.visit)).toMatchObject({ href: `/services/v/${ids.visit}`, status: 'Completed', date: '2026-03-10' });
    expect(one('bills', 'obligation', ids.bill)).toMatchObject({ title: 'Example Power', relation: 'Provider of this bill', href: `/bills/o/${ids.bill}` });
    expect(one('family', 'member', ids.member)).toMatchObject({ relation: 'Spouse in the household', href: `/family/m/${ids.member}`, facet: 'member' });
    expect(one('family', 'contact', ids.important)).toMatchObject({ title: 'Soccer coach', relation: 'Important contact for Kai Example', href: `/family/m/${ids.kidMember}`, facet: 'important' });
  });

  it('respects archived associations: an archived important contact is listed quietly and is not an "important contact" facet', async () => {
    const d = freshDb();
    const { c, ids } = await seedEverywhere(d);
    const refs = (await read(d, [c])).byContact.get(c)!;
    const old = refs.find((x) => x.recordId === String(ids.importantOld))!;
    expect(old).toMatchObject({ inactive: true, status: 'Removed from the member’s list' });
    expect(old.facet).toBeUndefined();
    expect(refs.find((x) => x.recordId === String(ids.important))!.facet).toBe('important');
  });

  it('does not use the provider-name snapshot or a matching name: a snapshot, a title, a payee or a number alone is never a relationship', async () => {
    const d = freshDb();
    const c = await createDistinctContact(d, { name: 'Pat Example' });
    await row(d, 'services', 'arrangement', { title: 'Pat Example cleaning', status: 'active', providerContactId: null, providerNameSnapshot: 'Pat Example', extraContactIds: [] });
    await row(d, 'bills', 'obligation', { title: 'Pat Example', type: 'utility', providerContactId: null, providerNameSnapshot: 'Pat Example', status: 'active' });
    await row(d, 'tasks', 'task', { title: 'Call Pat Example', status: 'todo', contactIds: [], notes: 'Pat Example' });
    await row(d, 'calendar', 'event', { title: "Pat Example's birthday", allDay: true, startDate: '2026-12-02', contactIds: [] });
    await row(d, 'projects', 'project', { name: 'Pat Example', status: 'active', vendorContactIds: [] });
    const r = await read(d, [c]);
    expect(r.byContact.get(c)).toBeUndefined();
  });
});

describe('several references, several contacts, several states', () => {
  it('one Contact in many modules, and one record naming several Contacts, are each listed once per (record, role)', async () => {
    const d = freshDb();
    const a = await createDistinctContact(d, { name: 'Alex Example' });
    const b = await createDistinctContact(d, { name: 'Blake Example' });
    const t = await row(d, 'tasks', 'task', { title: 'Plan trip', status: 'doing', contactIds: [a, b, a] });
    const arr = await row(d, 'services', 'arrangement', { title: 'Pool care', status: 'paused', providerContactId: a, extraContactIds: [b, a] });
    const r = await read(d, [a, b]);
    expect(by(r.byContact.get(a)!, 'tasks', 'task')).toHaveLength(1);
    expect(by(r.byContact.get(b)!, 'tasks', 'task')).toHaveLength(1);
    expect(by(r.byContact.get(a)!, 'services', 'arrangement').map((x) => x.role)).toEqual(['provider']); // the provider is not also listed as "extra"
    expect(by(r.byContact.get(b)!, 'services', 'arrangement').map((x) => x.role)).toEqual(['extra']);
    expect(t).toBeGreaterThan(0); expect(arr).toBeGreaterThan(0);
  });

  it('skips deleted owning records, flags finished or archived ones, and reports only the Contacts asked about', async () => {
    const d = freshDb();
    const c = await createDistinctContact(d, { name: 'Pat Example' });
    const other = await createDistinctContact(d, { name: 'Other Person' });
    await row(d, 'tasks', 'task', { title: 'Deleted', status: 'todo', contactIds: [c] }, true);
    const done = await row(d, 'tasks', 'task', { title: 'Done one', status: 'done', contactIds: [c] });
    const arch = await row(d, 'projects', 'project', { name: 'Old job', status: 'completed', vendorContactIds: [c], archived: true });
    await row(d, 'bills', 'obligation', { title: 'Gone bill', type: 'utility', providerContactId: c, status: 'ended' });
    await row(d, 'tasks', 'task', { title: 'For someone else', status: 'todo', contactIds: [other] });
    const refs = (await read(d, [c])).byContact.get(c)!;
    expect(refs.find((x) => x.title === 'Deleted')).toBeUndefined();
    expect(refs.find((x) => x.recordId === String(done))).toMatchObject({ inactive: true, status: 'Done' });
    expect(refs.find((x) => x.recordId === String(arch))).toMatchObject({ inactive: true, status: 'Completed, archived' });
    expect(refs.find((x) => x.title === 'Gone bill')).toMatchObject({ inactive: true, status: 'Ended' });
    expect(refs.find((x) => x.title === 'For someone else')).toBeUndefined();
    expect((await read(d, [c])).byContact.has(other)).toBe(false);
  });

  it('a repeating task and a repeating event are each ONE reference (nothing is expanded or generated)', async () => {
    const d = freshDb();
    const c = await createDistinctContact(d, { name: 'Pat Example' });
    await row(d, 'tasks', 'task', { title: 'Weekly call', status: 'todo', dueDate: '2026-11-10', repeat: { unit: 'week', every: 1 }, contactIds: [c] });
    await row(d, 'calendar', 'event', { title: 'Weekly chat', allDay: true, startDate: '2026-11-03', endDate: '2026-11-03', contactIds: [c], recurrence: { freq: 'weekly', interval: 1 } });
    const before = await snapshot(d);
    const refs = (await read(d, [c])).byContact.get(c)!;
    expect(refs).toHaveLength(2);
    expect(await snapshot(d)).toBe(before);
  });
});

describe('missing and damaged records', () => {
  it('a damaged record of any kind never breaks the list: the readable ones still come back', async () => {
    const d = freshDb();
    const c = await createDistinctContact(d, { name: 'Pat Example' });
    for (const [m, k] of [['tasks', 'task'], ['calendar', 'event'], ['projects', 'project'], ['projects', 'commitment'], ['assets', 'asset'], ['assets', 'service'], ['assets', 'warranty'], ['services', 'arrangement'], ['services', 'visit'], ['bills', 'obligation'], ['family', 'member'], ['family', 'contact']]) {
      await row(d, m, k, null);
      await row(d, m, k, 'not an object');
      await row(d, m, k, { contactIds: 'x', vendorContactIds: { a: 1 }, contacts: 7, providerContactId: 'nope', extraContactIds: [null, 'a'], contactId: 'z' });
    }
    await row(d, 'tasks', 'task', { title: 'Fine', status: 'todo', contactIds: [c] });
    const r = await read(d, [c]);
    expect(r.unverified).toEqual([]);
    expect(r.byContact.get(c)!.map((x) => x.title)).toEqual(['Fine']);
  });

  it('a Family row that cannot be fully read but still names the Contact is listed as "needs review"', async () => {
    const d = freshDb();
    const c = await createDistinctContact(d, { name: 'Pat Example' });
    await row(d, 'family', 'member', { contactId: c, role: 'astronaut', status: 'active' });
    const refs = (await read(d, [c])).byContact.get(c)!;
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ title: 'Household member (needs review)', status: 'Needs review' });
    expect(refs[0].facet).toBeUndefined();
  });

  it('an important contact whose member is gone is still listed (without a link)', async () => {
    const d = freshDb();
    const c = await createDistinctContact(d, { name: 'Pat Example' });
    await row(d, 'family', 'contact', { memberId: 987654, contactId: c, purpose: 'School office', status: 'active' });
    const refs = (await read(d, [c])).byContact.get(c)!;
    expect(refs[0]).toMatchObject({ title: 'School office', relation: 'Important contact for a household member' });
    expect(refs[0].href).toBeUndefined();
  });

  it('an event with unreadable dates is still listed by title, without a date or link; a retired (handed-over) event is listed quietly', async () => {
    const d = freshDb();
    const c = await createDistinctContact(d, { name: 'Pat Example' });
    await row(d, 'calendar', 'event', { title: 'Odd one', contactIds: [c] });
    await row(d, 'calendar', 'event', { title: 'Handed over', allDay: true, startDate: '2026-12-02', contactIds: [c], retired: { to: 'ledger' } });
    const refs = (await read(d, [c])).byContact.get(c)!;
    expect(refs.map((x) => x.title).sort()).toEqual(['Handed over', 'Odd one']);
    expect(refs.find((x) => x.title === 'Handed over')).toMatchObject({ inactive: true, status: 'Moved to another module' });
    expect(refs.find((x) => x.title === 'Handed over')!.href).toBeUndefined();
  });

  it('a project commitment whose project is gone is listed without a link and says so', async () => {
    const d = freshDb();
    const c = await createDistinctContact(d, { name: 'Pat Example' });
    await row(d, 'projects', 'commitment', { projectId: 555, vendorContactId: c, title: 'Orphan quote', status: 'quoted', amountCents: 1, budgetLineId: null, parentId: null });
    const x = (await read(d, [c])).byContact.get(c)![0];
    expect(x.relation).toContain('its project no longer exists');
    expect(x.href).toBeUndefined();
  });
});

describe('the addresses are the owning modules\' own', () => {
  it('every address equals what the module\'s own record source says (so each link opens the real record)', async () => {
    const d = freshDb();
    const { c, ids } = await seedEverywhere(d);
    // The record sources read the application database, so the same rows are put there for the comparison.
    const { db } = await import('../../db');
    await db.delete(); await db.open();
    const m = await seedEverywhere(db);
    const refs = (await readContactReferences([m.c], db, PROVIDERS, TODAY)).byContact.get(m.c)!;
    const hrefOf = (module: string, kind: string, id: number) => refs.find((x) => x.module === module && x.kind === kind && x.recordId === String(id))!.href;
    expect(hrefOf('tasks', 'task', m.ids.task)).toBe((await taskRecords.describe(m.ids.task))!.path);
    expect(hrefOf('projects', 'project', m.ids.project)).toBe((await projectRecords.describe(m.ids.project))!.path);
    expect(hrefOf('assets', 'asset', m.ids.asset)).toBe((await assetRecords.describe(`asset:${m.ids.asset}`))!.path);
    expect(hrefOf('assets', 'service', m.ids.service)).toBe((await assetRecords.describe(`service:${m.ids.service}`))!.path);
    expect(hrefOf('assets', 'warranty', m.ids.warranty)).toBe((await assetRecords.describe(`warranty:${m.ids.warranty}`))!.path);
    expect(hrefOf('services', 'arrangement', m.ids.arrangement)).toBe((await serviceRecords.describe(`arrangement:${m.ids.arrangement}`))!.path);
    expect(hrefOf('services', 'visit', m.ids.visit)).toBe((await serviceRecords.describe(`visit:${m.ids.visit}`))!.path);
    expect(hrefOf('bills', 'obligation', m.ids.bill)).toBe((await billRecords.describe(`obligation:${m.ids.bill}`))!.path);
    const ev = await eventRecords.describe(m.ids.event);
    expect(hrefOf('calendar', 'event', m.ids.event)!.startsWith('/calendar?v=agenda&d=2026-12-02&open=')).toBe(true);
    expect(ev!.path.startsWith('/calendar?v=agenda&d=2026-12-02&open=')).toBe(true);
    expect(c).toBeGreaterThan(0); expect(ids.task).toBeGreaterThan(0);
  });
});

describe('read-only and isolated', () => {
  it('reading changes no table, no timestamp, and fires no write hook', async () => {
    const d = freshDb();
    const { c } = await seedEverywhere(d);
    const before = await snapshot(d);
    let writes = 0;
    for (const t of d.tables) { t.hook('creating', () => { writes++; }); t.hook('updating', () => { writes++; }); t.hook('deleting', () => { writes++; }); }
    await read(d, [c]);
    await readContactUsage(d, [c]);
    expect(writes).toBe(0);
    expect(await snapshot(d)).toBe(before);
  });

  it('never reads a Finance table', async () => {
    const d = freshDb();
    const { c } = await seedEverywhere(d);
    await d.accounts.add({ name: 'Checking', type: 'checking' } as never);
    await d.txns.add({ accountId: 1, date: TODAY, amountCents: -500, payee: 'Pat Example', memo: '', status: 'cleared' } as never);
    let reads = 0;
    const shared = new Set(['contacts', 'tags', 'attachments', 'links', 'dueItems', 'moduleRecords']);
    for (const t of d.tables) if (!shared.has(t.name)) t.hook('reading', (o) => { reads++; return o; });
    await read(d, [c]);
    expect(reads).toBe(0);
  });

  it('the reader files import no Finance code and contain no write', async () => {
    const fs = await import('node:fs');
    const files = ['family', 'calendar', 'tasks', 'projects', 'assets', 'services', 'bills'].map((m) => `src/modules/${m}/contactReferences.ts`).concat('src/core/contactReferences.ts');
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      expect(src, f).not.toMatch(/\bd\.\w+\.(put|add|bulkPut|bulkAdd|update|delete|bulkDelete|clear)\(|\.transaction\(|localStorage|sessionStorage|fetch\(|financeRead|\.txns\b|\.accounts\b|\.restore\(|\.remove\(/);
    }
  });
});

describe('the shared contract', () => {
  const ok: ContactReference = { contactId: 1, module: 'tasks', kind: 'task', recordId: '5', role: 'person', title: 'T', relation: 'R', href: '/tasks?task=5', date: '2026-01-02', status: 'To do', facet: 'provider' };
  it('cleanReference keeps a good item, drops a bad optional part, and rejects a bad required part', () => {
    const wanted = new Set([1]);
    expect(cleanReference(ok, wanted)).toEqual(ok);
    expect(cleanReference({ ...ok, href: 'https://evil.example/x', date: 'tomorrow', facet: 'bogus', inactive: 'yes' }, wanted)).toEqual({ contactId: 1, module: 'tasks', kind: 'task', recordId: '5', role: 'person', title: 'T', relation: 'R', status: 'To do' });
    expect(cleanReference({ ...ok, href: 'javascript:alert(1)' }, wanted)!.href).toBeUndefined();
    expect(cleanReference({ ...ok, href: '//evil.example' }, wanted)!.href).toBeUndefined();
    for (const bad of [null, 'x', 3, {}, { ...ok, contactId: 2 }, { ...ok, contactId: 1.5 }, { ...ok, title: '' }, { ...ok, relation: undefined }, { ...ok, module: 7 }]) expect(cleanReference(bad, wanted)).toBeNull();
  });

  it('a reader that throws is "could not check" (others still run); no readers is not verified; a malformed item is left out and makes the result unverified', async () => {
    const d = freshDb();
    const c = await createDistinctContact(d, { name: 'Pat Example' });
    const good: ContactReferenceProvider = { label: 'Good', find: async () => [{ ...ok, contactId: c }] };
    const boom: ContactReferenceProvider = { label: 'Broken', find: async () => { throw new Error('disk full'); } };
    const junk: ContactReferenceProvider = { label: 'Junk', find: async () => [{ nonsense: true } as never, { ...ok, contactId: c, recordId: '6' }] };
    const notList: ContactReferenceProvider = { label: 'NotAList', find: async () => 'x' as never };
    const a = await readContactReferences([c], d, [boom, good], TODAY);
    expect(a.verified).toBe(false);
    expect(a.unverified).toEqual([{ label: 'Broken', message: 'disk full' }]);
    expect(a.byContact.get(c)).toHaveLength(1);
    expect((await readContactReferences([c], d, [], TODAY)).verified).toBe(false);
    const j = await readContactReferences([c], d, [junk], TODAY);
    expect(j.dropped).toBe(1);
    expect(j.verified).toBe(false);
    expect(j.byContact.get(c)).toHaveLength(1);
    expect((await readContactReferences([c], d, [notList], TODAY)).verified).toBe(false);
  });

  it('the same (record, role) from two readers is one reference', async () => {
    const d = freshDb();
    const c = await createDistinctContact(d, { name: 'Pat Example' });
    const p: ContactReferenceProvider = { label: 'P', find: async () => [{ ...ok, contactId: c }] };
    expect((await readContactReferences([c], d, [p, p], TODAY)).byContact.get(c)).toHaveLength(1);
  });

  it('asking about no Contact reads nothing and is verified', async () => {
    const d = freshDb();
    expect((await readContactReferences([], d, [], TODAY)).verified).toBe(true);
  });

  it('groups in reading order, soonest first, finished last; an unknown module goes under "Other supported references"', () => {
    const mk = (module: string, title: string, date?: string, inactive = false): ContactReference => ({ ...ok, date, module, kind: 'x', recordId: title, title, ...(inactive ? { inactive: true } : {}) });
    const sorted = sortReferences([mk('tasks', 'late', '2027-01-01'), mk('tasks', 'soon', '2026-01-01'), mk('tasks', 'finished', '2025-01-01', true), mk('tasks', 'undated'), mk('family', 'fam'), mk('futuremodule', 'odd')]);
    expect(sorted.map((x) => x.title)).toEqual(['fam', 'soon', 'late', 'undated', 'finished', 'odd']);
    expect(groupReferences(sorted).map((g) => [g.label, g.items.length])).toEqual([['Family', 1], ['Tasks', 4], ['Other supported references', 1]]);
  });

  it('honours a shared link that names the Contact (either end, number or "contact:<id>"), naming the other end through its module when it can', async () => {
    const d = freshDb();
    const c = await createDistinctContact(d, { name: 'Pat Example' });
    await d.links.add({ fromModule: 'contacts', fromId: c, toModule: 'nomodule', toId: 'thing:1', type: 'about', createdAt: 1, updatedAt: 1, deletedAt: null } as never);
    await d.links.add({ fromModule: 'x', fromId: 'y', toModule: 'contacts', toId: `contact:${c}`, type: 'about', createdAt: 1, updatedAt: 1, deletedAt: null } as never);
    await d.links.add({ fromModule: 'contacts', fromId: c, toModule: 'nomodule', toId: 'thing:2', type: 'about', createdAt: 1, updatedAt: 1, deletedAt: 8 } as never);
    const refs = (await readContactReferences([c], d, [], TODAY)).byContact.get(c)!;
    expect(refs.map((x) => `${x.module}/${x.kind}`)).toEqual(['shared/link', 'shared/link']);
    expect(refs[0].title).toBe('A saved link');
  });
});

describe('layer 1 versus layer 2', () => {
  it('a record kind with no reader is reported as "other stored references may exist", never invented', async () => {
    const d = freshDb();
    const { c } = await seedEverywhere(d);
    await row(d, 'futuremodule', 'thing', { who: c });
    await d.attachments.add({ ownerModule: 'tasks', ownerId: 1, note: c, createdAt: 1, updatedAt: 1, deletedAt: null } as never);
    const refs = (await read(d, [c])).byContact.get(c)!;
    const usage = (await readContactUsage(d, [c])).byContact.get(c)!;
    const u = unlistedMentions(usage, refs);
    expect(u.kinds.map((k) => `${k.module}/${k.kind}:${k.count}`).sort()).toEqual(['futuremodule/thing:1', 'shared/attachment:1']);
    expect(u.total).toBe(2);
    expect(refs.some((x) => x.module === 'futuremodule')).toBe(false);
  });

  it('when everything can be named the lists agree (nothing unlisted)', async () => {
    const d = freshDb();
    const { c } = await seedEverywhere(d);
    const refs = (await read(d, [c])).byContact.get(c)!;
    const usage = (await readContactUsage(d, [c])).byContact.get(c)!;
    expect(unlistedMentions(usage, refs)).toEqual({ total: 0, kinds: [] });
  });

  it('a damaged record that only the numeric scan can see shows up as unlisted', async () => {
    const d = freshDb();
    const c = await createDistinctContact(d, { name: 'Pat Example' });
    await row(d, 'tasks', 'task', 'broken-but-has-number');
    await row(d, 'tasks', 'task', { title: 'Odd', status: 'todo', contactIds: 'x', hiddenAway: { deeper: [c] } });
    const refs = (await read(d, [c])).byContact.get(c);
    const usage = (await readContactUsage(d, [c])).byContact.get(c)!;
    expect(refs).toBeUndefined();
    expect(unlistedMentions(usage, refs ?? []).total).toBe(1);
  });
});

describe('Family\'s own dependency reader and the shared one', () => {
  it('on the same data the shared readers name everything the older Family reader counted (no loss)', async () => {
    const d = freshDb();
    const { c, ids } = await seedEverywhere(d);
    await row(d, 'tasks', 'task', { title: 'Second', status: 'todo', contactIds: [c] });
    await d.links.add({ fromModule: 'contacts', fromId: c, toModule: 'tasks', toId: 'task:1', type: 'about', createdAt: 1, updatedAt: 1, deletedAt: null } as never);
    const old = await readFamilyCounts(c, d, ids.member);
    const refs = (await read(d, [c])).byContact.get(c)!;
    const n = (m: string, k: string) => new Set(by(refs, m, k).map((x) => x.recordId)).size;
    expect(n('tasks', 'task')).toBeGreaterThanOrEqual(old.tasks);
    expect(n('calendar', 'event')).toBeGreaterThanOrEqual(old.events);
    expect(n('projects', 'project')).toBeGreaterThanOrEqual(old.projects);
    expect(n('shared', 'link')).toBeGreaterThanOrEqual(old.links);
    expect(old.tasks + old.events + old.projects + old.links).toBeGreaterThan(0);
    // Family member records for the same Contact that are not the member asked about: only the member itself exists here, so none.
    expect(old.otherMembers).toBe(0);
  });

  it('Family still uses its own reader unchanged (a deliberate separation, documented in the report)', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync('src/modules/family/MemberPage.tsx', 'utf8');
    expect(src).toContain("from './references'");
    expect(fs.readFileSync('src/modules/family/references.ts', 'utf8')).not.toMatch(/contactReferences/);
  });
});

describe('registration', () => {
  it('all seven modules register a reader, and the Contacts module registers none (it owns no records)', () => {
    registerModules();
    expect(allContactReferenceProviders().map((p) => p.label).sort()).toEqual(['Bills & Subscriptions', 'Calendar', 'Family', 'Home & Assets', 'Household Services', 'Projects', 'Tasks']);
  });

  it('facets come only from stored relationships', async () => {
    const d = freshDb();
    const { c } = await seedEverywhere(d);
    const refs = (await read(d, [c])).byContact.get(c)!;
    expect([...facetsOf(refs)].sort()).toEqual(['important', 'member', 'project', 'provider']);
    const p = await createDistinctContact(d, { name: 'Plumber Example', relationship: 'plumber' });
    expect(facetsOf((await read(d, [p])).byContact.get(p) ?? []).size).toBe(0); // a typed relationship word is not a facet
  });
});
