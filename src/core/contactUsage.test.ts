import { describe, expect, it } from 'vitest';
import { FinanceDB } from '../db';
import { collectNumbers, LOW_ID, readContactUsage, usageKindText, usageSummary, type UsageEntry } from './contactUsage';
import { createDistinctContact } from './contacts';
import { createStore } from './store';
import { installTracking } from '../lib/sync/track';
import { readContactReferences } from '../modules/family/references';

/** Contacts C1: the conservative usage reader. Invented data only. */
let n = 0;
const fresh = () => { const d = new FinanceDB(`test-contact-usage-${n++}`); installTracking(d); return d; };
const row = (d: FinanceDB, module: string, kind: string, data: unknown, deleted = false) =>
  d.moduleRecords.add({ module, kind, createdAt: 1, updatedAt: 1, deletedAt: deleted ? 5 : null, data } as never) as Promise<number>;
const snapshot = async (d: FinanceDB) => JSON.stringify(await Promise.all(d.tables.map(async (t) => [t.name, await t.toArray()])));
const kinds = (es: UsageEntry[] | undefined) => (es ?? []).map((e) => `${e.module}/${e.kind}:${e.count}`);

describe('coverage: every place a Contact id is stored (the C0 inventory)', () => {
  it('sees Tasks, Calendar, Projects, commitments, Home & Assets, Services, Bills, Family members, important contacts and links', async () => {
    const d = fresh();
    const c = await createDistinctContact(d, { name: 'Pat Example' });
    const k = await createDistinctContact(d, { name: 'Not Referenced' });
    await row(d, 'tasks', 'task', { title: 'Call', contactIds: [c, 12] });
    await row(d, 'tasks', 'task', { title: 'Other', contactIds: [c] });
    await row(d, 'calendar', 'event', { title: 'Visit', contactIds: [c] });
    await row(d, 'projects', 'project', { name: 'Kitchen', vendorContactIds: [c] });
    await row(d, 'projects', 'commitment', { vendorContactId: c, amountCents: 100 });
    await row(d, 'assets', 'asset', { name: 'Boiler', contacts: [{ contactId: c, role: 'installer' }] });
    await row(d, 'assets', 'service', { providerContactId: c });
    await row(d, 'assets', 'warranty', { providerContactId: c });
    await row(d, 'services', 'arrangement', { providerContactId: c, extraContactIds: [] });
    await row(d, 'services', 'arrangement', { providerContactId: null, extraContactIds: [c] });
    await row(d, 'services', 'visit', { providerContactId: c, providerNameSnapshot: 'Pat Example' });
    await row(d, 'bills', 'obligation', { providerContactId: c, providerNameSnapshot: 'Pat Example' });
    await row(d, 'family', 'member', { contactId: c, role: 'parent', status: 'active' });
    await row(d, 'family', 'contact', { memberId: 5, contactId: c, purpose: 'x', status: 'active' });
    await d.links.add({ fromModule: 'contacts', fromId: c, toModule: 'tasks', toId: 'task:1', type: 'about', createdAt: 1, updatedAt: 1, deletedAt: null } as never);
    await d.links.add({ fromModule: 'tasks', fromId: 'task:2', toModule: 'contacts', toId: `contact:${c}`, type: 'about', createdAt: 1, updatedAt: 1, deletedAt: null } as never);
    const u = await readContactUsage(d);
    expect(kinds(u.byContact.get(c))).toEqual([
      'family/contact:1', 'family/member:1', 'tasks/task:2', 'calendar/event:1', 'projects/commitment:1', 'projects/project:1',
      'assets/asset:1', 'assets/service:1', 'assets/warranty:1', 'services/arrangement:2', 'services/visit:1', 'bills/obligation:1', 'shared/link:2',
    ]);
    expect(u.byContact.get(k)).toBeUndefined();
    expect(usageSummary(u.byContact.get(c))).toBe('Used in Family, Tasks, Calendar, Projects, Home & Assets, Household Services, Bills & Subscriptions and Saved links and attachments');
    expect(usageSummary(u.byContact.get(k))).toBe('Not mentioned anywhere else yet');
  });

  it('ignores deleted records and deleted links, counts a record once however many times it names the Contact, and still counts an unknown kind', async () => {
    const d = fresh();
    const c = await createDistinctContact(d, { name: 'Pat Example' });
    await row(d, 'tasks', 'task', { contactIds: [c], extra: { again: c } });
    await row(d, 'tasks', 'task', { contactIds: [c] }, true);
    await row(d, 'futuremodule', 'thing', { deep: { deeper: [{ who: c }] } });
    await d.links.add({ fromModule: 'contacts', fromId: c, toModule: 'tasks', toId: 'task:1', type: 'about', createdAt: 1, updatedAt: 1, deletedAt: 9 } as never);
    const u = await readContactUsage(d);
    expect(kinds(u.byContact.get(c))).toEqual(['tasks/task:1', 'futuremodule/thing:1']);
    expect(usageKindText(u.byContact.get(c)![1])).toBe('1 record');
    expect(usageSummary(u.byContact.get(c))).toBe('Used in Tasks and futuremodule');
  });

  it('does not count a deleted Contact, and a number that is only part of a longer number does not match', async () => {
    const d = fresh();
    const s = createStore(d).shared.contacts;
    const c = await s.put({ name: 'Pat Example' } as never);
    const gone = await s.put({ name: 'Gone' } as never);
    await s.remove(gone);
    await row(d, 'tasks', 'task', { contactIds: [gone, c], big: c * 10 + 1, text: `${c}` });
    const u = await readContactUsage(d);
    expect(u.byContact.has(gone)).toBe(false);
    expect(kinds(u.byContact.get(c))).toEqual(['tasks/task:1']);
  });

  it('limits the search to the Contacts asked for', async () => {
    const d = fresh();
    const a = await createDistinctContact(d, { name: 'A' });
    const b = await createDistinctContact(d, { name: 'B' });
    await row(d, 'tasks', 'task', { contactIds: [a, b] });
    const u = await readContactUsage(d, [a]);
    expect([...u.byContact.keys()]).toEqual([a]);
  });

  it('flags a short (not time-based) id as approximate', async () => {
    const d = fresh();
    await d.contacts.add({ id: 7, name: 'Old style', createdAt: 1, updatedAt: 1, deletedAt: null } as never);
    await row(d, 'tasks', 'task', { priority: 7 });
    const u = await readContactUsage(d);
    expect(u.approximate.has(7)).toBe(true);
    expect(7).toBeLessThan(LOW_ID);
  });
});

describe('collectNumbers', () => {
  it('finds numbers in nested values, reads contact:<id> text, and ignores other text, fractions and null', () => {
    const into = new Set<number>();
    collectNumbers({ a: [1, { b: 2 }], c: 'contact:33', d: 'task:44', e: 1.5, f: null, g: undefined, h: '55' }, into);
    expect([...into].sort((x, y) => x - y)).toEqual([1, 2, 33]);
  });
});

describe('read-only', () => {
  it('writes nothing: every table is byte-identical before and after, including with deleted rows and links', async () => {
    const d = fresh();
    const c = await createDistinctContact(d, { name: 'Pat Example' });
    await row(d, 'tasks', 'task', { contactIds: [c] });
    await row(d, 'tasks', 'task', { contactIds: [c] }, true);
    await d.attachments.add({ ownerModule: 'assets', ownerId: 'asset:1', fileName: 'a.pdf', storage: 'none', createdAt: 1, updatedAt: 1, deletedAt: null } as never);
    const before = await snapshot(d);
    await readContactUsage(d);
    await readContactUsage(d, [c]);
    expect(await snapshot(d)).toBe(before);
  });
});

describe('does not undercount what the Family reader already recognises', () => {
  it('on a shared fixture every Family count is matched or exceeded', async () => {
    const d = fresh();
    const c = await createDistinctContact(d, { name: 'Sam Example' });
    const other = await createDistinctContact(d, { name: 'Alex Example' });
    await row(d, 'tasks', 'task', { contactIds: [c] });
    await row(d, 'tasks', 'task', { contactIds: [c, other] });
    await row(d, 'tasks', 'task', { contactIds: [other] });
    await row(d, 'calendar', 'event', { contactIds: [c] });
    await row(d, 'projects', 'project', { vendorContactIds: [c] });
    const self = await row(d, 'family', 'member', { contactId: c, role: 'child', status: 'active' });
    await row(d, 'family', 'member', { contactId: c, role: 'child', status: 'past' });
    await d.links.add({ fromModule: 'contacts', fromId: c, toModule: 'tasks', toId: 'task:1', type: 'about', createdAt: 1, updatedAt: 1, deletedAt: null } as never);
    const f = await readContactReferences(c, d, self);
    const u = await readContactUsage(d);
    const get = (m: string, k: string) => (u.byContact.get(c) ?? []).find((e) => e.module === m && e.kind === k)?.count ?? 0;
    expect(get('tasks', 'task')).toBeGreaterThanOrEqual(f.tasks);
    expect(get('calendar', 'event')).toBeGreaterThanOrEqual(f.events);
    expect(get('projects', 'project')).toBeGreaterThanOrEqual(f.projects);
    expect(get('shared', 'link')).toBeGreaterThanOrEqual(f.links);
    expect(get('family', 'member')).toBeGreaterThanOrEqual(f.otherMembers + 1); // the Family reader leaves the member asked about out; this one counts every record
    expect(f.total).toBeGreaterThan(0);
  });
});

describe('summary wording', () => {
  it('names one, two or three modules in plain words', () => {
    const e = (module: string, kind = 'x'): UsageEntry => ({ module, kind, count: 1 });
    expect(usageSummary([e('tasks')])).toBe('Used in Tasks');
    expect(usageSummary([e('calendar'), e('family')])).toBe('Used in Family and Calendar');
    expect(usageSummary([e('calendar'), e('family'), e('tasks')])).toBe('Used in Family, Tasks and Calendar');
    expect(usageSummary([])).toBe('Not mentioned anywhere else yet');
  });
});

describe('a practical scale fixture', () => {
  it('one pass over 1,500 contacts and about 15,000 records stays well inside a second or two, and is correct', async () => {
    const d = fresh();
    const ids: number[] = [];
    const at = Date.now();
    await d.contacts.bulkAdd(Array.from({ length: 1500 }, (_, i) => ({ name: `Person ${i}`, createdAt: at, updatedAt: at, deletedAt: null })) as never);
    for (const c of await d.contacts.toArray()) ids.push(c.id as number);
    // Give every contact an id large enough to be time-based, as real ones are.
    const big = ids.map((_, i) => 1_780_000_000_000_000 + i);
    await d.contacts.clear();
    await d.contacts.bulkAdd(big.map((id, i) => ({ id, name: `Person ${i}`, createdAt: at, updatedAt: at, deletedAt: null })) as never);
    const recs = [];
    for (let i = 0; i < 15000; i++) {
      const kind = i % 5;
      const a = big[i % big.length];
      const b = big[(i * 7) % big.length];
      recs.push(
        kind === 0 ? { module: 'tasks', kind: 'task', data: { title: `t${i}`, contactIds: [a, b], checklist: [{ text: 'x', done: false }], notes: 'n'.repeat(50) } }
          : kind === 1 ? { module: 'calendar', kind: 'event', data: { title: `e${i}`, contactIds: [a] } }
          : kind === 2 ? { module: 'projects', kind: 'commitment', data: { vendorContactId: a, amountCents: i } }
          : kind === 3 ? { module: 'services', kind: 'visit', data: { providerContactId: b, providerNameSnapshot: `Person ${i}`, costCents: i } }
          : { module: 'bills', kind: 'obligation', data: { providerContactId: a, amountCents: i } },
      );
    }
    await d.moduleRecords.bulkAdd(recs.map((r) => ({ ...r, createdAt: at, updatedAt: at, deletedAt: null })) as never);
    const t0 = performance.now();
    const u = await readContactUsage(d);
    const ms = performance.now() - t0;
    console.log(`[C1 scale] usage scan of 1500 contacts / 15000 records: ${ms.toFixed(0)} ms`);
    expect(u.scanned).toBe(15000);
    expect(u.byContact.size).toBeGreaterThan(1000);
    const first = u.byContact.get(big[0])!;
    expect(first.reduce((s, e) => s + e.count, 0)).toBeGreaterThan(0);
    expect(ms).toBeLessThan(8000);
  }, 60000);
});
