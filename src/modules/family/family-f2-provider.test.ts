import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FinanceDB } from '../../db';
import { createStore } from '../../core/store';
import { queryProviders, type DerivedItem, type DueProvider } from '../../core/dueProvider';
import { exportAll, importAll } from '../../lib/backup';
import { checkBackupText } from '../../lib/backupFile';
import { dexieMeta, RemoteConflict, SyncEngine, type RemoteFile, type RemoteStore } from '../../lib/sync/engine';
import { installTracking } from '../../lib/sync/track';
import { createEvent, ensureCalendarSeed, loadEvents, loadLayers } from '../calendar/data';
import { ALL_ON, isLayerVisible, toggleLayer } from '../calendar/layerVisibility';
import { dropCovered, storedItemKey } from '../calendar/markerCoordination';
import { blankFields, FAMILY_ID, PERSONAL_ID } from '../calendar/model';
import { occurrencesOf } from '../calendar/occurrences';
import { newEventData } from '../calendar/data';
import type { SeriesExtras } from '../calendar/series';
import { msAt } from '../calendar/time';
import type { CalItem } from '../calendar/useCalendarData';
import { todayList, upcomingDays } from '../today/logic';
import { createMember, loadMembers, setBirthdayOnCalendar, setMemberStatus, updateMember } from './data';
import { createDate, loadDates, setDateOnCalendar, setDateStatus, updateDate } from './dateData';
import { familyDueItems, familyDueProvider } from './dueProvider';
import { FAMILY_LAYER_COLOR } from './dueProvider';

/** F2: the Family due provider against a real (in-memory) database, with the Calendar's own coordination filter. All names and dates are invented. */
vi.mock('../../lib/download', () => ({ downloadText: () => undefined }));
let n = 0;
const fresh = () => { const d = new FinanceDB(`test-family-f2-${n++}`); installTracking(d); return d; };
const YEAR = 2026;
const kid = { role: 'child' as const, status: 'active' as const };
const yearly = { freq: 'yearly', interval: 1, end: { type: 'never' } } as const;
const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }; };
beforeEach(() => { vi.stubGlobal('localStorage', mem()); });

const addContact = (d: FinanceDB, name: string, extra: object = {}) => createStore(d).shared.contacts.put({ name, ...extra } as never);
async function addMember(d: FinanceDB, contactId: number, birthMonthDay: string | undefined, extra: object = {}) {
  return (await createMember({ contact: { mode: 'existing', contactId }, fields: { ...kid, ...(birthMonthDay ? { birthMonthDay } : {}), ...extra } }, d, YEAR)).id;
}
const extras = (over: Partial<SeriesExtras> = {}): SeriesExtras => ({ calendarId: PERSONAL_ID, tagIds: [], contactIds: [], recurrence: null, trackDone: false, ...over });
/** The owner's own yearly Birthday event for these Contacts, starting on `start`. */
const addStored = (d: FinanceDB, start: string, contactIds: number[], over: Partial<SeriesExtras> = {}, title = 'A birthday') =>
  createEvent(newEventData({ ...blankFields(start), title }, extras({ type: 'birthday', contactIds, recurrence: yearly, ...over })), d);
const q = (from: string, to: string, today = from) => ({ from, to, today, overdueDays: 0 });
const ask = (d: FinanceDB, from: string, to: string, today = from) => familyDueItems(d, q(from, to, today));
const everyTable = async (d: FinanceDB) => JSON.stringify(await Promise.all(d.tables.map(async (t) => [t.name, await t.toArray()])));

/**
 * What the Calendar and Today do with the answers: a stored event's occurrences and the providers' markers, each tagged with its layer, then the
 * visibility filter (Calendar only), then `dropCovered`. Items carry just the fields those steps (and Today's slicing) read, built the same way as
 * `useCalendarData` builds them (`storedItemKey` for stored events, `source` for markers).
 */
async function assemble(d: FinanceDB, from: string, to: string, today: string) {
  const layers = await loadLayers(d);
  const events = await loadEvents(d);
  const derived = await queryProviders({ from, to, today, overdueDays: 0 }, [{ ...familyDueProvider, getDueItems: (query) => familyDueItems(d, query) } as DueProvider]);
  const items: CalItem[] = [];
  for (const ev of events) {
    for (const o of occurrencesOf(ev, from, to)) {
      items.push({ key: storedItemKey(o.eventId, o.key), title: o.title, layerId: ev.data.calendarId, layerName: 'Personal', color: '', derived: false, allDay: o.allDay, firstDay: o.firstDay, lastDay: o.lastDay, startMs: o.startMs, endMs: o.endMs, priority: o.priority, location: '', done: o.done, overdue: false, soon: false, recurring: o.recurring, occ: o } as CalItem);
    }
  }
  const layer = layers.find((l) => l.providerId === 'family');
  for (const it of derived.family ?? []) {
    items.push({ key: `d:${it.id}`, title: it.title, layerId: layer?.id ?? -1, layerName: 'Family', color: '', derived: true, allDay: true, firstDay: it.date, lastDay: it.endDate ?? it.date, startMs: msAt(it.date), endMs: msAt(it.date), priority: it.priority, location: '', done: it.status !== 'open', overdue: it.status === 'open' && it.date < today, soon: false, recurring: false, source: it } as CalItem);
  }
  return {
    items,
    calendar: (vis = ALL_ON) => dropCovered(items.filter((i) => isLayerVisible(vis, i.layerId))),
    today: () => dropCovered(items),
  };
}
const titles = (xs: CalItem[]) => xs.map((i) => i.title).sort();

describe('registration', () => {
  it('the provider is the one the Calendar seeds the Family layer for (fixed id, no collision, seeded once)', async () => {
    const d = fresh();
    await Promise.all([ensureCalendarSeed(d), ensureCalendarSeed(d)]);
    const layers = await loadLayers(d);
    const fam = layers.filter((l) => l.providerId === 'family');
    expect(fam).toHaveLength(1);
    expect(fam[0]).toMatchObject({ id: FAMILY_ID, name: 'Family', sourceType: 'derived', builtin: true });
    expect(new Set(layers.map((l) => l.id)).size).toBe(layers.length);
    expect(FAMILY_ID).toBe(9_000_000_000_000_108);
    expect(familyDueProvider).toMatchObject({ id: 'family', layerName: 'Family', color: FAMILY_LAYER_COLOR });
  });
});

describe('member birthdays', () => {
  it('a member with a birthday gets one marker a year, with no stored Calendar event, no Task and no other row written', async () => {
    const d = fresh();
    const sam = await addContact(d, 'Sam Example', { phone: '555-0100', email: 'sam@example.test' });
    const id = await addMember(d, sam, '05-14', { birthYear: 2016, note: 'Private note.' });
    const before = await everyTable(d);
    const items = await ask(d, '2026-01-01', '2028-12-31', '2026-06-01');
    expect(items.map((i) => [i.id, i.status])).toEqual([[`family:birthday-${id}:2026-05-14`, 'handled'], [`family:birthday-${id}:2027-05-14`, 'open'], [`family:birthday-${id}:2028-05-14`, 'open']]);
    expect(await everyTable(d)).toBe(before); // read-only: byte-identical
    expect(await loadEvents(d)).toEqual([]);
    expect(await d.moduleRecords.where('module').equals('tasks').count()).toBe(0);
    const text = JSON.stringify(items.map((i) => [i.title, i.detail, i.icsUid]));
    for (const secret of ['2016', 'Private', '555', 'sam@example']) expect(text).not.toContain(secret);
  });

  it('the name is the Contact\'s CURRENT name (rename the Contact and the title follows); a missing or deleted Contact gives no marker and no crash', async () => {
    const d = fresh();
    const sam = await addContact(d, 'Sam Example');
    const pat = await addContact(d, 'Pat Sample');
    await addMember(d, sam, '05-14');
    await addMember(d, pat, '05-15');
    await d.contacts.update(sam, { name: 'Samuel Example' });
    expect((await ask(d, '2026-05-01', '2026-05-31')).map((i) => i.title)).toEqual(["Samuel Example's birthday", "Pat Sample's birthday"]);
    await d.contacts.update(pat, { deletedAt: Date.now() });
    expect((await ask(d, '2026-05-01', '2026-05-31')).map((i) => i.title)).toEqual(["Samuel Example's birthday"]);
    await d.contacts.delete(sam); // gone entirely
    expect(await ask(d, '2026-05-01', '2026-05-31')).toEqual([]);
  });

  it('the per-member switch removes only that member\'s birthday and changes nothing else on the record (an unknown field and the note survive)', async () => {
    const d = fresh();
    const sam = await addContact(d, 'Sam Example');
    const pat = await addContact(d, 'Pat Sample');
    const a = await addMember(d, sam, '05-14', { note: 'Keep me.' });
    await addMember(d, pat, '05-15');
    await d.moduleRecords.update(a, { data: { ...(await d.moduleRecords.get(a))!.data, future: { keep: 1 } } });
    await setBirthdayOnCalendar(a, false, d);
    expect((await ask(d, '2026-05-01', '2026-05-31')).map((i) => i.title)).toEqual(["Pat Sample's birthday"]);
    const row = (await d.moduleRecords.get(a))!.data as Record<string, unknown>;
    expect(row).toMatchObject({ birthdayOnCalendar: false, note: 'Keep me.', future: { keep: 1 }, birthMonthDay: '05-14' });
    await setBirthdayOnCalendar(a, true, d);
    expect((await d.moduleRecords.get(a))!.data).not.toHaveProperty('birthdayOnCalendar');
    expect(await ask(d, '2026-05-01', '2026-05-31')).toHaveLength(2);
    // the full edit form path keeps the switch too
    await updateMember(a, { ...kid, birthMonthDay: '05-14', birthdayOnCalendar: false }, d, YEAR);
    expect(await ask(d, '2026-05-01', '2026-05-31')).toHaveLength(1);
  });

  it('a past member has no birthday on the Calendar, and it returns when they are in the household again', async () => {
    const d = fresh();
    const sam = await addContact(d, 'Sam Example');
    const id = await addMember(d, sam, '05-14');
    await setMemberStatus(id, 'past', d);
    expect(await ask(d, '2026-05-01', '2026-05-31')).toEqual([]);
    await setMemberStatus(id, 'active', d);
    expect(await ask(d, '2026-05-01', '2026-05-31')).toHaveLength(1);
  });

  it('editing the birthday moves the marker; the identity of the member (and so the id prefix) does not change', async () => {
    const d = fresh();
    const sam = await addContact(d, 'Sam Example');
    const id = await addMember(d, sam, '05-14');
    await updateMember(id, { ...kid, birthMonthDay: '06-02' }, d, YEAR);
    expect((await ask(d, '2026-05-01', '2026-06-30')).map((i) => i.id)).toEqual([`family:birthday-${id}:2026-06-02`]);
  });

  it('a leap-day birthday: 28 February in 2027 and 2026, 29 February in 2028', async () => {
    const d = fresh();
    const sam = await addContact(d, 'Sam Example');
    await addMember(d, sam, '02-29');
    const dates = (await ask(d, '2026-01-01', '2028-12-31')).map((i) => i.date);
    expect(dates).toEqual(['2026-02-28', '2027-02-28', '2028-02-29']);
  });

  it('damaged and unreadable member rows never crash the answer and are left exactly as they were', async () => {
    const d = fresh();
    const sam = await addContact(d, 'Sam Example');
    await addMember(d, sam, '05-14');
    const bad = await d.moduleRecords.add({ module: 'family', kind: 'member', data: { contactId: 'x', role: 'wizard', birthMonthDay: '05-14' }, createdAt: 1, updatedAt: 1, deletedAt: null } as never);
    const junk = await d.moduleRecords.add({ module: 'family', kind: 'member', data: 'not an object', createdAt: 1, updatedAt: 1, deletedAt: null } as never);
    const worse = await d.moduleRecords.add({ module: 'family', kind: 'date', data: { label: 7 }, createdAt: 1, updatedAt: 1, deletedAt: null } as never);
    const unknownKind = await d.moduleRecords.add({ module: 'family', kind: 'from-the-future', data: { x: 1 }, createdAt: 1, updatedAt: 1, deletedAt: null } as never);
    const before = await everyTable(d);
    expect((await ask(d, '2026-05-01', '2026-05-31')).map((i) => i.title)).toEqual(["Sam Example's birthday"]);
    expect(await everyTable(d)).toBe(before);
    expect([bad, junk, worse, unknownKind].every(Boolean)).toBe(true);
  });

  it('two active records for one Contact (a cross-device duplicate) show ONE birthday', async () => {
    const d = fresh();
    const sam = await addContact(d, 'Sam Example');
    const first = await addMember(d, sam, '05-14');
    await d.moduleRecords.add({ module: 'family', kind: 'member', data: { contactId: sam, role: 'child', status: 'active', birthMonthDay: '05-14' }, createdAt: 9, updatedAt: 9, deletedAt: null } as never);
    expect((await loadMembers(d)).filter((m) => m.data?.status === 'active')).toHaveLength(2);
    expect((await ask(d, '2026-05-01', '2026-05-31')).map((i) => i.id)).toEqual([`family:birthday-${first}:2026-05-14`]);
  });
});

describe('important dates', () => {
  it('create, appear, edit, switch off, archive and restore, each without writing anything but the Family record', async () => {
    const d = fresh();
    const sam = await addContact(d, 'Sam Example');
    const memberId = await addMember(d, sam, undefined);
    const id = await createDate({ dateKind: 'anniversary', label: 'Wedding anniversary', monthDay: '06-21', year: 2012, memberId, status: 'active' }, d, YEAR);
    const stored = (await d.moduleRecords.get(id))!;
    expect(stored).toMatchObject({ module: 'family', kind: 'date' });
    expect(Object.keys(stored.data as object).sort()).toEqual(['dateKind', 'label', 'memberId', 'monthDay', 'status', 'year']);
    expect((await ask(d, '2026-06-01', '2026-06-30')).map((i) => [i.id, i.title])).toEqual([[`family:date-${id}:2026-06-21`, 'Wedding anniversary']]);

    await updateDate(id, { dateKind: 'anniversary', label: 'Our anniversary', monthDay: '06-22', year: 2012, memberId, status: 'active' }, d, YEAR);
    expect((await ask(d, '2026-06-01', '2026-06-30')).map((i) => [i.date, i.title])).toEqual([['2026-06-22', 'Our anniversary']]);

    await setDateOnCalendar(id, false, d);
    expect(await ask(d, '2026-06-01', '2026-06-30')).toEqual([]);
    expect((await loadDates(d))[0].data!.onCalendar).toBe(false);
    await setDateOnCalendar(id, true, d);
    expect(await ask(d, '2026-06-01', '2026-06-30')).toHaveLength(1);

    await setDateStatus(id, 'archived', d);
    expect(await ask(d, '2026-06-01', '2026-06-30')).toEqual([]);
    expect(await d.moduleRecords.get(id)).toBeTruthy(); // archived, not deleted
    await setDateStatus(id, 'active', d);
    expect(await ask(d, '2026-06-01', '2026-06-30')).toHaveLength(1);

    expect(await loadEvents(d)).toEqual([]);
    expect(await d.moduleRecords.where('module').equals('tasks').count()).toBe(0);
    expect(await d.contacts.count()).toBe(1);
  });

  it('refuses a bad date, a member that does not exist, and an unreadable record; archiving keeps every other stored field', async () => {
    const d = fresh();
    await expect(createDate({ dateKind: 'other', label: '', monthDay: '06-21', status: 'active' }, d, YEAR)).rejects.toThrow(/short name/);
    await expect(createDate({ dateKind: 'other', label: 'X', monthDay: '02-30', status: 'active' }, d, YEAR)).rejects.toThrow(/real date/);
    await expect(createDate({ dateKind: 'other', label: 'X', monthDay: '06-21', memberId: 424242, status: 'active' }, d, YEAR)).rejects.toThrow(/no longer exists/);
    const id = await createDate({ dateKind: 'other', label: 'Adoption day', monthDay: '09-09', status: 'active' }, d, YEAR);
    await d.moduleRecords.update(id, { data: { ...(await d.moduleRecords.get(id))!.data, future: { keep: [1, 2] }, year: 'garbled' } });
    await setDateStatus(id, 'archived', d);
    expect((await d.moduleRecords.get(id))!.data).toMatchObject({ status: 'archived', future: { keep: [1, 2] }, year: 'garbled', label: 'Adoption day' });
    const broken = await d.moduleRecords.add({ module: 'family', kind: 'date', data: { label: 'x', monthDay: 'zz', dateKind: 'other', status: 'active' }, createdAt: 1, updatedAt: 1, deletedAt: null } as never);
    const before = JSON.stringify(await d.moduleRecords.get(broken));
    await expect(setDateStatus(broken as number, 'archived', d)).rejects.toThrow(/could not be read/);
    await expect(updateDate(broken as number, { dateKind: 'other', label: 'x', monthDay: '01-01', status: 'active' }, d, YEAR)).rejects.toThrow(/could not be read/);
    expect(JSON.stringify(await d.moduleRecords.get(broken))).toBe(before);
  });

  it('a date about a past member, or about a member who has been removed, still shows until the owner archives it', async () => {
    const d = fresh();
    const sam = await addContact(d, 'Sam Example');
    const memberId = await addMember(d, sam, undefined);
    await createDate({ dateKind: 'other', label: 'Remembering', monthDay: '03-03', memberId, status: 'active' }, d, YEAR);
    await setMemberStatus(memberId, 'past', d);
    expect(await ask(d, '2026-03-01', '2026-03-31')).toHaveLength(1);
    await d.moduleRecords.update(memberId, { deletedAt: Date.now() });
    expect(await ask(d, '2026-03-01', '2026-03-31')).toHaveLength(1);
  });
});

describe('stored Birthday events and Family birthdays (the 9 cases)', () => {
  async function world() {
    const d = fresh();
    await ensureCalendarSeed(d);
    const sam = await addContact(d, 'Sam Example');
    const memberId = await addMember(d, sam, '05-14');
    return { d, sam, memberId };
  }
  const W = ['2026-05-01', '2026-05-31', '2026-05-01'] as const;

  it('1. a Family birthday with no stored event shows once, on both Calendar and Today', async () => {
    const { d } = await world();
    const a = await assemble(d, ...W);
    expect(titles(a.calendar())).toEqual(["Sam Example's birthday"]);
    expect(titles(a.today())).toEqual(["Sam Example's birthday"]);
  });

  it('2. a stored Birthday event with no Family birthday is untouched', async () => {
    const d = fresh();
    await ensureCalendarSeed(d);
    const sam = await addContact(d, 'Sam Example');
    await addStored(d, '2019-05-14', [sam], {}, "Sam Example's birthday");
    const a = await assemble(d, ...W);
    expect(a.items.map((i) => i.derived)).toEqual([false]);
    expect(a.calendar()).toHaveLength(1);
  });

  it('3. both for the same Contact and the same day: the stored event shows, the Family marker is left out, nothing is deleted or changed', async () => {
    const { d, sam, memberId } = await world();
    const ev = await addStored(d, '2019-05-14', [sam], {}, "Sam Example's birthday");
    const eventsBefore = JSON.stringify(await loadEvents(d));
    const marker = (await ask(d, ...W))[0];
    expect(marker.coveredBy).toBe(storedItemKey(ev, '2026-05-14'));
    expect(marker.id).toBe(`family:birthday-${memberId}:2026-05-14`);
    const a = await assemble(d, ...W);
    expect(a.items).toHaveLength(2);
    expect(a.calendar().map((i) => i.derived)).toEqual([false]);
    expect(a.today().map((i) => i.derived)).toEqual([false]);
    expect(JSON.stringify(await loadEvents(d))).toBe(eventsBefore);
    expect(await ask(d, ...W)).toHaveLength(1); // the provider still reports it (it is a display decision only)
  });

  it('4. two DIFFERENT Contacts with the same name: the stored event belongs to the other person, so both show', async () => {
    const { d } = await world();
    const otherSam = await addContact(d, 'Sam Example');
    await addStored(d, '2019-05-14', [otherSam], {}, "Sam Example's birthday");
    const a = await assemble(d, ...W);
    expect((await ask(d, ...W))[0].coveredBy).toBeUndefined();
    expect(a.calendar()).toHaveLength(2);
    expect(a.today()).toHaveLength(2);
  });

  it('   ...and an event with the right title but NO Contact, a plain (non-Birthday) event, or a Birthday on another day, covers nothing', async () => {
    const { d, sam } = await world();
    await addStored(d, '2019-05-14', [], {}, "Sam Example's birthday");
    await addStored(d, '2019-05-14', [sam], { type: undefined, recurrence: yearly }, 'Something else with Sam');
    await addStored(d, '2019-05-15', [sam], {}, "Sam Example's birthday (the wrong day)");
    expect((await ask(d, ...W))[0].coveredBy).toBeUndefined();
    expect((await assemble(d, ...W)).calendar().filter((i) => i.title === "Sam Example's birthday")).toHaveLength(2); // the stored lookalike and the marker
  });

  it('5. the stored event is on a hidden calendar: the Family marker comes back (hiding one can never hide both)', async () => {
    const { d, sam } = await world();
    await addStored(d, '2019-05-14', [sam], {}, "Sam Example's birthday");
    const a = await assemble(d, ...W);
    const hidePersonal = toggleLayer(ALL_ON, PERSONAL_ID, [PERSONAL_ID, FAMILY_ID]);
    expect(a.calendar(hidePersonal).map((i) => i.derived)).toEqual([true]);
    const hideFamily = toggleLayer(ALL_ON, FAMILY_ID, [PERSONAL_ID, FAMILY_ID]);
    expect(a.calendar(hideFamily).map((i) => i.derived)).toEqual([false]);
    expect(a.today()).toHaveLength(1); // Today does not use layer visibility
  });

  it('5b. deleting the stored event brings the Family marker back', async () => {
    const { d, sam } = await world();
    const ev = await addStored(d, '2019-05-14', [sam]);
    await d.moduleRecords.update(ev, { deletedAt: Date.now() });
    expect((await ask(d, ...W))[0].coveredBy).toBeUndefined();
    expect((await assemble(d, ...W)).calendar().map((i) => i.derived)).toEqual([true]);
  });

  it('6. a Family birthday the owner switched off: only the stored event shows', async () => {
    const { d, sam, memberId } = await world();
    await addStored(d, '2019-05-14', [sam]);
    await setBirthdayOnCalendar(memberId, false, d);
    expect(await ask(d, ...W)).toEqual([]);
    expect((await assemble(d, ...W)).calendar().map((i) => i.derived)).toEqual([false]);
  });

  it('7. a skipped occurrence or one moved to another day does not cover that year; an edited title or a time-of-day change still does', async () => {
    const { d, sam } = await world();
    const ev = await addStored(d, '2019-05-14', [sam]);
    const patch = async (fn: (data: Record<string, unknown>) => Record<string, unknown>) => d.moduleRecords.update(ev, { data: fn((await d.moduleRecords.get(ev))!.data as Record<string, unknown>) });

    await patch((x) => ({ ...x, skipped: ['2026-05-14'] }));
    expect((await ask(d, ...W))[0].coveredBy).toBeUndefined();
    expect((await assemble(d, ...W)).calendar().map((i) => i.derived)).toEqual([true]);

    await patch((x) => ({ ...x, skipped: [], overrides: { '2026-05-14': { startDate: '2026-05-16', endDate: '2026-05-16' } } }));
    expect((await ask(d, ...W))[0].coveredBy).toBeUndefined(); // moved to the 16th: nothing stands on the 14th
    expect((await assemble(d, ...W)).calendar()).toHaveLength(2); // the moved event and the Family marker

    await patch((x) => ({ ...x, overrides: { '2026-05-14': { title: 'Sam turns a year older!' } } }));
    expect((await ask(d, ...W))[0].coveredBy).toBe(storedItemKey(ev, '2026-05-14')); // same day, new title: the same occurrence
    expect((await assemble(d, ...W)).calendar().map((i) => i.derived)).toEqual([false]);
  });

  it('8. editing the Family birthday date re-decides coverage for the new date', async () => {
    const { d, sam, memberId } = await world();
    await addStored(d, '2019-05-14', [sam]);
    expect((await ask(d, ...W))[0].coveredBy).toBeTruthy();
    await updateMember(memberId, { ...kid, birthMonthDay: '05-20' }, d, YEAR);
    const moved = await ask(d, ...W);
    expect(moved.map((i) => i.date)).toEqual(['2026-05-20']);
    expect(moved[0].coveredBy).toBeUndefined();
    expect((await assemble(d, ...W)).calendar()).toHaveLength(2);
  });

  it('a 29 February birthday and a stored yearly event begun on 29 February coincide every year (the 28th in 2026 and 2027)', async () => {
    const d = fresh();
    await ensureCalendarSeed(d);
    const sam = await addContact(d, 'Sam Example');
    await addMember(d, sam, '02-29');
    const ev = await addStored(d, '2020-02-29', [sam]);
    const items = await ask(d, '2026-01-01', '2028-12-31');
    expect(items.map((i) => [i.date, i.coveredBy])).toEqual([
      ['2026-02-28', storedItemKey(ev, '2026-02-28')], ['2027-02-28', storedItemKey(ev, '2027-02-28')], ['2028-02-29', storedItemKey(ev, '2028-02-29')],
    ]);
  });

  it('a stored event begun on 28 February for a leap-day member agrees in ordinary years and differs in leap years (both show: documented)', async () => {
    const d = fresh();
    const sam = await addContact(d, 'Sam Example');
    await addMember(d, sam, '02-29');
    const ev = await addStored(d, '2021-02-28', [sam]);
    const items = await ask(d, '2026-01-01', '2028-12-31');
    expect(items.map((i) => [i.date, !!i.coveredBy])).toEqual([['2026-02-28', true], ['2027-02-28', true], ['2028-02-29', false]]);
    expect(ev).toBeTruthy();
  });

  it('the markers coordinate only in the Calendar\'s display: the filter changes nothing for ordinary items and never hides a stored event', () => {
    const stored = { key: 'e:1:2026-05-14', occ: {}, done: false } as unknown as CalItem;
    const done = { key: 'e:2:2026-05-14', occ: {}, done: true } as unknown as CalItem;
    const cover = (by: string) => ({ key: 'd:x', source: { id: 'family:birthday-1:2026-05-14', status: 'open', coveredBy: by } }) as unknown as CalItem;
    expect(dropCovered([stored, cover('e:1:2026-05-14')])).toEqual([stored]);
    expect(dropCovered([done, cover('e:2:2026-05-14')])).toHaveLength(2); // a done occurrence does not cover
    expect(dropCovered([cover('e:9:2026-05-14')])).toHaveLength(1); // nothing to cover it: it stays
    expect(dropCovered([stored])).toEqual([stored]);
  });
});

describe('Today', () => {
  it('shows a birthday today and the next days through the existing aggregation, with no Task made and the Family records unchanged', async () => {
    const d = fresh();
    await ensureCalendarSeed(d);
    const sam = await addContact(d, 'Sam Example');
    const pat = await addContact(d, 'Pat Sample');
    await addMember(d, sam, '05-14');
    await addMember(d, pat, '05-17');
    await createDate({ dateKind: 'other', label: 'Adoption day', monthDay: '05-21', status: 'active' }, d, YEAR);
    const family = async () => JSON.stringify(await d.moduleRecords.where('module').equals('family').toArray());
    const before = await family();
    const tablesBefore = await everyTable(d);
    const a = await assemble(d, '2026-05-14', '2026-05-21', '2026-05-14');
    expect(todayList(a.today(), '2026-05-14').map((i) => i.title)).toEqual(["Sam Example's birthday"]);
    expect(upcomingDays(a.today(), '2026-05-14', 7).map((g) => [g.date, g.items.map((i) => i.title)])).toEqual([['2026-05-17', ["Pat Sample's birthday"]], ['2026-05-21', ['Adoption day']]]);
    expect(await family()).toBe(before);
    expect(await everyTable(d)).toBe(tablesBefore);
    expect(await d.moduleRecords.where('module').equals('tasks').count()).toBe(0);
  });

  it('a switched-off birthday, an off date and an archived date are absent from Today', async () => {
    const d = fresh();
    const sam = await addContact(d, 'Sam Example');
    const id = await addMember(d, sam, '05-14');
    const off = await createDate({ dateKind: 'other', label: 'Off date', monthDay: '05-14', onCalendar: false, status: 'active' }, d, YEAR);
    const arch = await createDate({ dateKind: 'other', label: 'Old date', monthDay: '05-14', status: 'archived' }, d, YEAR);
    await setBirthdayOnCalendar(id, false, d);
    const a = await assemble(d, '2026-05-14', '2026-05-14', '2026-05-14');
    expect(todayList(a.today(), '2026-05-14')).toEqual([]);
    expect(off && arch).toBeTruthy();
  });

  it('a birthday that has passed is never "overdue"', async () => {
    const d = fresh();
    const sam = await addContact(d, 'Sam Example');
    await addMember(d, sam, '05-14');
    const items = await queryProviders({ from: '2026-05-20', to: '2026-05-30', today: '2026-05-20', overdueDays: 30 }, [{ ...familyDueProvider, getDueItems: (query) => familyDueItems(d, query) } as DueProvider]);
    expect(items.family).toEqual([]); // outside the window and not open, so it is not pulled in as overdue
  });
});

describe('Finance and other modules are never read or written', () => {
  it('the provider asks only for Family records, Contacts and Calendar events; every other table is untouched', async () => {
    const d = fresh();
    const touched = new Set<string>();
    const wrote = new Set<string>();
    d.use({
      stack: 'dbcore', name: 'f2-spy',
      create: (down) => ({
        ...down,
        table: (name) => {
          const t = down.table(name);
          return {
            ...t,
            get: (r) => { touched.add(name); return t.get(r); },
            getMany: (r) => { touched.add(name); return t.getMany(r); },
            query: (r) => { touched.add(name); return t.query(r); },
            count: (r) => { touched.add(name); return t.count(r); },
            openCursor: (r) => { touched.add(name); return t.openCursor(r); },
            mutate: (r) => { wrote.add(name); return t.mutate(r); },
          };
        },
      }),
    });
    const sam = await addContact(d, 'Sam Example');
    await addMember(d, sam, '05-14');
    touched.clear(); wrote.clear();
    await ask(d, '2026-05-01', '2026-05-31');
    expect([...touched].sort()).toEqual(['contacts', 'moduleRecords']);
    expect([...wrote]).toEqual([]);
  });
});

describe('backup, restore and sync', () => {
  it('a backup round trip gives the very same markers (ids, titles, coverage) in a fresh database', async () => {
    const A = fresh();
    await ensureCalendarSeed(A);
    const sam = await addContact(A, 'Sam Example');
    const memberId = await addMember(A, sam, '05-14', { birthdayOnCalendar: false });
    const pat = await addContact(A, 'Pat Sample');
    await addMember(A, pat, '05-15');
    await createDate(({ dateKind: 'anniversary', label: 'Wedding anniversary', monthDay: '06-21', year: 2012, status: 'active' }), A, YEAR);
    await addStored(A, '2019-05-15', [pat]);
    const want = (await ask(A, '2026-05-01', '2026-06-30')).map((i) => [i.id, i.title, i.coveredBy]);
    expect(want.length).toBe(2);
    const { file } = checkBackupText(JSON.stringify(await exportAll(A)));
    const B = fresh();
    await importAll(B, file);
    expect((await ask(B, '2026-05-01', '2026-06-30')).map((i) => [i.id, i.title, i.coveredBy])).toEqual(want);
    expect((await B.moduleRecords.get(memberId))!.data).toMatchObject({ birthdayOnCalendar: false }); // the switch survives restore
  });

  it('two devices: a date, a switch and a birthday arrive on the other device and give the same markers', async () => {
    const remote = (() => {
      const r = {
        puts: 0, file: null as RemoteFile | null,
        async getFile() { return r.file ? { sha: r.file.sha, bytes: r.file.bytes.slice() } : null; },
        async putFile(bytes: Uint8Array, sha: string | undefined) { if ((r.file?.sha ?? undefined) !== sha) throw new RemoteConflict('stale'); r.puts++; r.file = { sha: `sha${r.puts}`, bytes: bytes.slice() }; return r.file.sha; },
      };
      return r satisfies RemoteStore;
    })();
    const mk = () => { const d = fresh(); return { d, engine: new SyncEngine(d, dexieMeta(`family-f2-meta-${n++}`), remote, 'a good passphrase') }; };
    const A = mk();
    const B = mk();
    const sam = await addContact(A.d, 'Sam Example');
    const memberId = await addMember(A.d, sam, '05-14');
    const dateId = await createDate({ dateKind: 'other', label: 'Adoption day', monthDay: '09-09', status: 'active' }, A.d, YEAR);
    await A.engine.initialUpload();
    await B.engine.replaceFromRemote();
    await setBirthdayOnCalendar(memberId, false, B.d);
    await setDateStatus(dateId, 'archived', B.d);
    for (let i = 0; i < 2; i++) { await B.engine.sync(); await A.engine.sync(); }
    for (const x of [A, B]) {
      expect(await ask(x.d, '2026-01-01', '2026-12-31')).toEqual([]);
      expect((await loadMembers(x.d))[0].data!.birthdayOnCalendar).toBe(false);
    }
    await setDateStatus(dateId, 'active', A.d);
    for (let i = 0; i < 2; i++) { await A.engine.sync(); await B.engine.sync(); }
    expect((await ask(B.d, '2026-01-01', '2026-12-31')).map((i: DerivedItem) => i.id)).toEqual([`family:date-${dateId}:2026-09-09`]);
  });
});
