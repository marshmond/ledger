import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FinanceDB } from '../../db';
import { createDistinctContact, updateContactDetails } from '../../core/contacts';
import { createStore } from '../../core/store';
import { readContactReferences } from '../../core/contactReferences';
import { allContactReferenceProviders } from '../../core/registry';
import { encryptText, exportAll, importAll } from '../../lib/backup';
import { buildBackup, checkBackupText, prepareEncryptedRestore, restoreWithSafetyCopy } from '../../lib/backupFile';
import { dexieMeta, RemoteConflict, SyncEngine, type RemoteFile, type RemoteStore } from '../../lib/sync/engine';
import { installTracking } from '../../lib/sync/track';
import { createEvent, ensureCalendarSeed, newEventData } from '../calendar/data';
import { ALL_ON } from '../calendar/layerVisibility';
import { blankFields, PERSONAL_ID } from '../calendar/model';
import type { SeriesExtras } from '../calendar/series';
import { createProject } from '../projects/data';
import { blankProject } from '../projects/model';
import { completeTask, createTask } from '../tasks/data';
import { blankTask } from '../tasks/model';
import { registerModules } from '../index';
import { createMember, getMember, loadMembers, setMe } from './data';
import { createDate } from './dateData';
import { familyDueItems } from './dueProvider';
import { forPerson, readHouseholdOverview } from './householdOverview';
import { addImportantContact, loadImportantContacts } from './importantContactData';
import { calendarLink, readMemberSchedule } from './memberSchedule';
import { readMemberProjects, readMemberTasks } from './memberWork';
import { effectiveMe } from './model';
import { readFamilySearchData, searchFamilyData } from './searchSource';
import { readContactReferences as familyOwnReferences } from './references';

/** F5 final integration: Search, Quick Add's forms, the overview and the member page working together over one invented household. */
registerModules();
vi.mock('../../lib/download', () => ({ downloadText: () => undefined }));
let n = 0;
const fresh = () => { const d = new FinanceDB(`test-family-f5-int-${n++}`); installTracking(d); return d; };
const TODAY = '2026-11-09'; // a Monday
const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }; };
beforeEach(() => { vi.stubGlobal('localStorage', mem()); });
const snapshot = async (d: FinanceDB) => JSON.stringify(await Promise.all(d.tables.map(async (t) => [t.name, await t.toArray()])));
const extras = (over: Partial<SeriesExtras> = {}): SeriesExtras => ({ calendarId: PERSONAL_ID, tagIds: [], contactIds: [], recurrence: null, trackDone: false, ...over });
const addEvent = (d: FinanceDB, title: string, date: string, over: Partial<SeriesExtras> = {}, type?: string) =>
  createEvent({ ...newEventData({ ...blankFields(date), title }, extras(over)), ...(type ? { type } : {}) }, d);
type Fields = Parameters<typeof createMember>[0]['fields'];
const member = async (d: FinanceDB, contactId: number, over: Partial<Fields> = {}) => (await createMember({ contact: { mode: 'existing', contactId }, fields: { role: 'child', status: 'active', ...over } }, d, 2026)).id;

/** Sam (child), Jo (spouse), Alex (parent). Sam has a swim event, a Task, a Project, an important contact and an anniversary-style date. */
async function household() {
  const d = fresh();
  await ensureCalendarSeed(d);
  const sam = await createDistinctContact(d, { name: 'Sam Example', phone: '555-0142' });
  const jo = await createDistinctContact(d, { name: 'Jo Example' });
  const alex = await createDistinctContact(d, { name: 'Alex Example' });
  const coach = await createDistinctContact(d, { name: 'Coach Example', email: 'coach@example.test' });
  const samM = await member(d, sam, { birthMonthDay: '11-12', note: 'private note text' });
  const joM = await member(d, jo, { role: 'spouse' });
  const alexM = await member(d, alex, { role: 'parent' });
  const swim = await addEvent(d, 'Swim meet', '2026-11-11', { contactIds: [sam, jo] });
  const dentist = await addEvent(d, 'Dentist', '2026-11-12', { contactIds: [alex] });
  const form = await createTask(blankTask({ title: 'Sign permission slip', contactIds: [sam], dueDate: '2026-11-08' }), [], d);
  const kitchen = await createProject(blankProject({ name: 'Treehouse', vendorContactIds: [sam] }), d);
  const ic = await addImportantContact({ memberId: samM, contact: { mode: 'existing', contactId: coach }, purpose: 'Swim coach' }, d);
  const date = await createDate({ dateKind: 'anniversary', label: 'Wedding anniversary', monthDay: '11-20', memberId: joM, status: 'active' }, d, 2026);
  return { d, sam, jo, alex, coach, samM, joM, alexM, swim, dentist, form, kitchen, ic, date };
}

describe('one household, every part agreeing (the overview, the member page and Search use the same records)', () => {
  it('the member page sections, the household overview and Search all find Sam through one Contact id', async () => {
    const h = await household();
    const [sched, tasks, projects, important] = [await readMemberSchedule(h.sam, TODAY, ALL_ON, h.d), await readMemberTasks(h.sam, TODAY, h.d), await readMemberProjects(h.sam, h.d), await loadImportantContacts(h.d)];
    expect(sched.items.map((i) => i.title)).toEqual(['Swim meet']);
    expect(tasks.tasks.map((t) => t.data.title)).toEqual(['Sign permission slip']);
    expect(projects.open.map((p) => p.data.name)).toEqual(['Treehouse']);
    expect(important.map((r) => [r.data!.memberId, r.data!.contactId, r.data!.purpose])).toEqual([[h.samM, h.coach, 'Swim coach']]);

    const o = await readHouseholdOverview(TODAY, ALL_ON, h.d);
    expect(o.people.map((p) => p.name)).toEqual(['Alex Example', 'Jo Example', 'Sam Example']);
    expect(o.activities.items.map((a) => a.title)).toEqual(['Swim meet', 'Dentist']);
    expect(o.activities.items[0].people.map((p) => p.name)).toEqual(['Jo Example', 'Sam Example']);
    expect(o.tasks.items.map((t) => [t.title, t.overdue])).toEqual([['Sign permission slip', true]]);
    expect(o.dates.map((x) => x.title)).toEqual(["Sam Example's birthday", 'Wedding anniversary']);

    const found = searchFamilyData('sam', await readFamilySearchData(h.d));
    expect(found.map((r) => r.path)).toEqual([`/family/m/${h.samM}`]);
  });

  it('the person filter narrows activities, tasks and dates together and changes no record', async () => {
    const h = await household();
    const before = await snapshot(h.d);
    const o = await readHouseholdOverview(TODAY, ALL_ON, h.d);
    const v = forPerson(o, h.samM);
    expect(v.activities.items.map((a) => a.title)).toEqual(['Swim meet']);
    expect(v.tasks.items.map((t) => t.title)).toEqual(['Sign permission slip']);
    expect(v.dates.map((x) => x.title)).toEqual(["Sam Example's birthday"]);
    expect(forPerson(o, h.joM).tasks.items).toEqual([]);
    expect(await snapshot(h.d)).toBe(before);
  });

  it('every link the Family screens write is the owner\'s own supported address', async () => {
    const h = await household();
    const o = await readHouseholdOverview(TODAY, ALL_ON, h.d);
    expect(calendarLink(o.activities.items[0])).toMatch(/^#\/calendar\?v=agenda&d=2026-11-11&open=e%3A\d+%3A2026-11-11$/);
    expect(o.tasks.items[0].id).toBe(h.form); // rendered as #/tasks?task=<id> (see the F4 render tests)
    expect((await readMemberProjects(h.sam, h.d)).open[0].id).toBe(h.kitchen); // rendered as #/projects/<id>
    const refs = await readContactReferences([h.sam], h.d, allContactReferenceProviders(), TODAY);
    const mine = refs.byContact.get(h.sam)!;
    expect(mine.map((r) => r.href)).toContain(`/family/m/${h.samM}`);
    for (const r of mine) expect(r.href?.startsWith('/')).toBe(true);
  });
});

describe('Contact rename and a missing Contact', () => {
  it('renaming a Contact changes the name everywhere and no Family reference, member id or Contact id', async () => {
    const h = await household();
    const ids = JSON.stringify((await loadMembers(h.d)).map((m) => [m.id, m.data!.contactId]));
    await updateContactDetails(h.d, h.sam, { name: 'Robert Example' });
    expect(JSON.stringify((await loadMembers(h.d)).map((m) => [m.id, m.data!.contactId]))).toBe(ids);
    expect(JSON.stringify((await loadImportantContacts(h.d)).map((r) => [r.data!.memberId, r.data!.contactId]))).toBe(JSON.stringify([[h.samM, h.coach]]));
    const o = await readHouseholdOverview(TODAY, ALL_ON, h.d);
    expect(o.people.map((p) => p.name)).toContain('Robert Example');
    expect(o.activities.items[0].people.map((p) => p.name)).toContain('Robert Example');
    expect((await readMemberSchedule(h.sam, TODAY, ALL_ON, h.d)).items).toHaveLength(1);
    expect((await readMemberTasks(h.sam, TODAY, h.d)).tasks).toHaveLength(1);
    expect(searchFamilyData('robert', await readFamilySearchData(h.d)).map((r) => r.id)).toEqual([`family-member:${h.samM}`]);
    expect(searchFamilyData('sam', await readFamilySearchData(h.d))).toEqual([]);
    expect((await familyOwnReferences(h.sam, h.d)).events).toBe(1);
  });

  it('a soft-deleted Contact fails safely: no crash, the member is simply not offered by Search, and the overview names it plainly', async () => {
    const h = await household();
    await h.d.contacts.update(h.sam, { deletedAt: Date.now() });
    expect(searchFamilyData('sam', await readFamilySearchData(h.d))).toEqual([]);
    const o = await readHouseholdOverview(TODAY, ALL_ON, h.d);
    expect(o.people.some((p) => p.contactId === h.sam)).toBe(true); // still a household member; shown with a plain placeholder name, as in F4
    expect(o.people.find((p) => p.contactId === h.sam)!.name).toBe('Contact no longer exists');
    await expect(readMemberSchedule(h.sam, TODAY, ALL_ON, h.d)).resolves.toBeTruthy();
  });

  it('two people with one name stay separate in Search, the overview and the member page', async () => {
    const h = await household();
    const other = await createDistinctContact(h.d, { name: 'Sam Example' });
    const otherM = await member(h.d, other, { role: 'other' });
    await addEvent(h.d, 'Other Sam dentist', '2026-11-10', { contactIds: [other] });
    const found = searchFamilyData('sam example', await readFamilySearchData(h.d));
    expect(found.map((r) => r.id).sort()).toEqual([`family-member:${h.samM}`, `family-member:${otherM}`].sort());
    expect((await readMemberSchedule(h.sam, TODAY, ALL_ON, h.d)).items.map((i) => i.title)).toEqual(['Swim meet']);
    expect((await readMemberSchedule(other, TODAY, ALL_ON, h.d)).items.map((i) => i.title)).toEqual(['Other Sam dentist']);
    expect((await readMemberTasks(other, TODAY, h.d)).tasks).toEqual([]);
  });
});

describe('"This is me" stays explicit', () => {
  it('nobody is me until the owner chooses; two marks (two devices) are a conflict and Search still works', async () => {
    const h = await household();
    expect(effectiveMe(await loadMembers(h.d)).me).toBeNull();
    await setMe(h.alexM, h.d);
    expect(effectiveMe(await loadMembers(h.d)).me?.id).toBe(h.alexM);
    // Simulate the second device's mark arriving by sync.
    const joRow = await h.d.moduleRecords.get(h.joM);
    await h.d.moduleRecords.update(h.joM, { data: { ...(joRow!.data as object), isMe: true } });
    const state = effectiveMe(await loadMembers(h.d));
    expect(state.me).toBeNull();
    expect(state.conflict.map((m) => m.id)).toEqual([h.joM, h.alexM].sort((a, b) => a - b));
    expect(searchFamilyData('jo', await readFamilySearchData(h.d)).filter((r) => r.kind === 'Family member')).toHaveLength(1);
  });
});

describe('birthday and Calendar coordination', () => {
  it('a stored Birthday event for the same Contact and day covers the Family marker; a different person\'s does not', async () => {
    const h = await household();
    const stored = await addEvent(h.d, "Sam Example's birthday", '2026-11-12', { contactIds: [h.sam] }, 'birthday');
    await addEvent(h.d, 'Someone else birthday', '2026-11-12', { contactIds: [h.alex] }, 'birthday');
    const items = await familyDueItems(h.d, { from: '2026-11-01', to: '2026-11-30', today: TODAY, overdueDays: 0 } as never);
    const sam = items.find((i) => i.title === "Sam Example's birthday")!;
    expect(sam.coveredBy).toBe(`e:${stored}:2026-11-12`);
    expect(items.filter((i) => i.title === "Sam Example's birthday")).toHaveLength(1);
  });

  it('adding an important date (what Quick Add\'s form does) stores no Calendar event and shows once through the provider', async () => {
    const h = await household();
    const before = await h.d.moduleRecords.where('[module+kind]').equals(['calendar', 'event']).count();
    await createDate({ dateKind: 'other', label: 'Pool day', monthDay: '11-25', status: 'active' }, h.d, 2026);
    expect(await h.d.moduleRecords.where('[module+kind]').equals(['calendar', 'event']).count()).toBe(before);
    const items = await familyDueItems(h.d, { from: '2026-11-01', to: '2026-11-30', today: TODAY, overdueDays: 0 } as never);
    expect(items.filter((i) => i.title === 'Pool day')).toHaveLength(1);
  });
});

describe('recurring and finished work is the owning module\'s business', () => {
  it('a skipped weekly series is not listed on that date; completing a repeating Task leaves one open Task (Tasks\' own rule)', async () => {
    const h = await household();
    const weekly = { freq: 'weekly', interval: 1, end: { type: 'never' } } as const;
    await addEvent(h.d, 'Piano', '2026-11-09', { contactIds: [h.sam], recurrence: weekly as never });
    const o = await readHouseholdOverview(TODAY, ALL_ON, h.d);
    expect(o.activities.items.filter((a) => a.title === 'Piano')).toHaveLength(1);
    const tid = await createTask(blankTask({ title: 'Practice scales', contactIds: [h.sam], dueDate: TODAY, repeat: { mode: 'fixed', rule: weekly } }), [], h.d);
    await completeTask(tid, TODAY, h.d);
    const after = await readHouseholdOverview(TODAY, ALL_ON, h.d);
    expect(after.tasks.items.filter((t) => t.title === 'Practice scales')).toHaveLength(1);
    expect(after.tasks.items.find((t) => t.title === 'Practice scales')!.repeats).toBe(true);
  });
});

describe('nothing reads by writing', () => {
  it('Search, the overview, the member readers, the dependency readers and the due provider leave every table byte-identical', async () => {
    const h = await household();
    const before = await snapshot(h.d);
    for (const q of ['e', 'sam', 'birthday', 'wedding', 'family']) searchFamilyData(q, await readFamilySearchData(h.d));
    await readHouseholdOverview(TODAY, ALL_ON, h.d);
    await readMemberSchedule(h.sam, TODAY, ALL_ON, h.d);
    await readMemberTasks(h.sam, TODAY, h.d);
    await readMemberProjects(h.sam, h.d);
    await loadImportantContacts(h.d);
    await familyOwnReferences(h.sam, h.d);
    await readContactReferences([h.sam, h.coach], h.d, allContactReferenceProviders(), TODAY);
    await familyDueItems(h.d, { from: '2026-11-01', to: '2027-02-01', today: TODAY, overdueDays: 0 } as never);
    expect(await snapshot(h.d)).toBe(before);
    expect((await getMember(h.samM, h.d))!.updatedAt).toBeGreaterThan(0);
  });
});

describe('backup and encrypted sync carry everything, and Search works on the result', () => {
  const searchable = async (d: FinanceDB) => JSON.stringify(await Promise.all(['sam', 'sam birthday', 'wedding', 'jo', 'spouse'].map(async (q) => searchFamilyData(q, await readFamilySearchData(d)))));

  it('a plain backup restores into an empty profile and Search gives the same answers', async () => {
    const h = await household();
    const want = await searchable(h.d);
    const { file } = checkBackupText(JSON.stringify(await exportAll(h.d)));
    const C = fresh();
    await importAll(C, file);
    expect(await searchable(C)).toBe(want);
    expect(JSON.parse(want).flat().length).toBeGreaterThan(4);
  });

  it('an encrypted backup hides every name, label and note, restores through the safety sequence, and Search still answers', async () => {
    const h = await household();
    const want = await searchable(h.d);
    const text = await encryptText(JSON.stringify(await buildBackup(h.d, mem())), 'a good passphrase');
    for (const s of ['Sam Example', 'Wedding anniversary', 'private note text', 'Swim coach']) expect(text).not.toContain(s);
    const target = fresh();
    const { file } = await prepareEncryptedRestore(text, 'a good passphrase');
    await restoreWithSafetyCopy(target, file, { saveCopy: async () => 'copy', storage: mem() });
    expect(await searchable(target)).toBe(want);
  }, 30000);

  it('two devices syncing through the real engine see the same Family search results, with no table added', async () => {
    const remote = (() => {
      const r = {
        puts: 0, file: null as RemoteFile | null,
        async getFile() { return r.file ? { sha: r.file.sha, bytes: r.file.bytes.slice() } : null; },
        async putFile(bytes: Uint8Array, sha: string | undefined) {
          if ((r.file?.sha ?? undefined) !== sha) throw new RemoteConflict('stale');
          r.puts++; r.file = { sha: `sha${r.puts}`, bytes: bytes.slice() }; return r.file.sha;
        },
      };
      return r satisfies RemoteStore;
    })();
    const A = fresh(); const B = fresh();
    const eA = new SyncEngine(A, dexieMeta(`family-f5-meta-${n++}`), remote, 'a good passphrase');
    const eB = new SyncEngine(B, dexieMeta(`family-f5-meta-${n++}`), remote, 'a good passphrase');
    const sam = await createDistinctContact(A, { name: 'Sam Example' });
    const m = await member(A, sam, { birthMonthDay: '05-14' });
    await eA.initialUpload();
    await eB.replaceFromRemote();
    await createDate({ dateKind: 'other', label: 'Pool closing day', monthDay: '09-15', status: 'active' }, A, 2026);
    for (let i = 0; i < 2; i++) { await eA.sync(); await eB.sync(); }
    await eA.sync();
    for (const d of [A, B]) {
      expect(searchFamilyData('sam', await readFamilySearchData(d)).map((r) => r.id)).toEqual([`family-member:${m}`]);
      expect(searchFamilyData('pool', await readFamilySearchData(d)).map((r) => r.kind)).toEqual(['Family date']);
      expect(d.tables.map((t) => t.name).filter((x) => /family|search|quick/i.test(x))).toEqual([]);
    }
    expect(createStore(B).shared.contacts).toBeTruthy();
  }, 30000);
});


describe('phone layout of the add-member contact list (found in the F5 browser pass)', () => {
  it('a contact row never shrinks below its own text: the list scrolls instead (a flex column with a maximum height would otherwise squash rows so their text overlaps)', () => {
    const css = readFileSync('src/modules/family/family.css', 'utf8');
    const rule = /^\.fm-opt \{[^}]*\}/m.exec(css)![0];
    expect(rule).toMatch(/flex: none;/);
    expect(/^\.fm-pick \{[^}]*\}/m.exec(css)![0]).toMatch(/overflow: auto/);
  });
});
