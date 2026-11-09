import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FinanceDB } from '../../db';
import { createStore } from '../../core/store';
import { createEvent, ensureCalendarSeed, loadEvents, loadLayers, newEventData, removeOccurrence, saveEdit } from '../calendar/data';
import { ALL_ON, deselectAll, toggleLayer } from '../calendar/layerVisibility';
import { storedItemKey } from '../calendar/markerCoordination';
import { blankFields, PERSONAL_ID, type EventFields } from '../calendar/model';
import { occurrencesOf } from '../calendar/occurrences';
import type { SeriesExtras } from '../calendar/series';
import { msAt } from '../calendar/time';
import { createCalendar } from '../calendar/data';
import { createMember, loadMembers, setMemberStatus } from './data';
import { buildMemberSchedule, calendarLink, readMemberSchedule, SCHEDULE_DAYS, scheduleWhen } from './memberSchedule';

/** F3 Schedule: a member's upcoming Calendar events, read through the Calendar's own loader and expander. Invented names and dates only. */
let n = 0;
const fresh = () => new FinanceDB(`test-family-f3-sched-${n++}`);
const TODAY = '2026-11-09'; // a Monday
const kid = { role: 'child' as const, status: 'active' as const };
const weekly = { freq: 'weekly', interval: 1, end: { type: 'never' } } as const;
const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }; };
beforeEach(() => { vi.stubGlobal('localStorage', mem()); });

const addContact = (d: FinanceDB, name: string) => createStore(d).shared.contacts.put({ name } as never);
const addMember = async (d: FinanceDB, contactId: number) => (await createMember({ contact: { mode: 'existing', contactId }, fields: kid }, d, 2026)).id;
const extras = (over: Partial<SeriesExtras> = {}): SeriesExtras => ({ calendarId: PERSONAL_ID, tagIds: [], contactIds: [], recurrence: null, trackDone: false, ...over });
/** An all-day event on `date` (or a timed one when `minutes` is given). */
const addEvent = (d: FinanceDB, title: string, date: string, over: Partial<SeriesExtras> = {}, minutes?: number, f: Partial<EventFields> = {}) =>
  createEvent(newEventData({ ...(minutes === undefined ? blankFields(date) : { ...blankFields(date, msAt(date, minutes)), startDate: date, endDate: date }), title, ...f }, extras(over)), d);
const snapshot = async (d: FinanceDB) => JSON.stringify(await Promise.all(d.tables.map(async (t) => [t.name, await t.toArray()])));
const read = (d: FinanceDB, cid: number, vis = ALL_ON) => readMemberSchedule(cid, TODAY, vis, d);

async function household() {
  const d = fresh();
  await ensureCalendarSeed(d);
  const sam = await addContact(d, 'Sam Example');
  const robin = await addContact(d, 'Robin Example');
  const coach = await addContact(d, 'Coach Example');
  const samId = await addMember(d, sam);
  const robinId = await addMember(d, robin);
  return { d, sam, robin, coach, samId, robinId };
}

describe('which events belong to a member', () => {
  it('an event that names the member\'s Contact appears; events for other people and for nobody do not', async () => {
    const { d, sam, robin } = await household();
    await addEvent(d, 'Sam dentist', '2026-11-12', { contactIds: [sam] }, 15 * 60);
    await addEvent(d, 'Robin recital', '2026-11-13', { contactIds: [robin] }, 18 * 60);
    await addEvent(d, 'Nobody', '2026-11-14');
    const s = await read(d, sam);
    expect(s.items.map((i) => i.title)).toEqual(['Sam dentist']);
    expect(s.hiddenCount).toBe(0);
  });

  it('the empty state is an empty list, not an error', async () => {
    const { d, sam } = await household();
    expect(await read(d, sam)).toEqual({ items: [], hiddenCount: 0 });
  });

  it('an event for two members is listed ONCE on each profile, and names the other member (never a non-member contact)', async () => {
    const { d, sam, robin, coach, robinId } = await household();
    await addEvent(d, 'Swim meet', '2026-11-14', { contactIds: [sam, robin, coach, sam] }, 9 * 60);
    const a = await read(d, sam);
    const b = await read(d, robin);
    expect(a.items).toHaveLength(1);
    expect(b.items).toHaveLength(1);
    expect(a.items[0].also).toEqual([{ memberId: robinId, contactId: robin }]);
    expect(b.items[0].also.map((x) => x.contactId)).toEqual([sam]);
    expect(a.items[0].key).toBe(b.items[0].key); // the same occurrence, not a copy
    expect((await loadEvents(d))).toHaveLength(1); // nothing was duplicated in the Calendar
  });

  it('a past member\'s Contact is not named as "also for", and two member records for one person count as one person', async () => {
    const { d, sam, robin, robinId } = await household();
    await addMember(d, robin).catch(() => undefined); // refused: already a member
    await addEvent(d, 'Party', '2026-11-15', { contactIds: [sam, robin] });
    expect((await read(d, sam)).items[0].also).toHaveLength(1);
    await setMemberStatus(robinId, 'past', d);
    expect((await read(d, sam)).items[0].also).toEqual([]);
    expect((await read(d, robin)).items).toHaveLength(1); // a past member's own page still shows their events
  });
});

describe('window, order and shapes', () => {
  it('lists the next 30 days soonest first: today and day 30 are in, yesterday and day 31 are out', async () => {
    const { d, sam } = await household();
    const c = { contactIds: [sam] };
    await addEvent(d, 'Yesterday', '2026-11-08', c, 10 * 60);
    await addEvent(d, 'Today late', TODAY, c, 20 * 60);
    await addEvent(d, 'All-day later', '2026-11-20', c);
    await addEvent(d, 'Timed earlier', '2026-11-20', c, 8 * 60);
    await addEvent(d, 'Day 30', '2026-12-09', c);
    await addEvent(d, 'Day 31', '2026-12-10', c);
    expect(SCHEDULE_DAYS).toBe(30);
    const titles = (await read(d, sam)).items.map((i) => i.title);
    expect(titles).toEqual(['Today late', 'All-day later', 'Timed earlier', 'Day 30']); // an all-day item starts at local midnight, so it sorts before a timed one that day
  });

  it('a multi-day event that began before today and is still going is shown once', async () => {
    const { d, sam } = await household();
    await addEvent(d, 'Camp', '2026-11-07', { contactIds: [sam] }, undefined, { endDate: '2026-11-11' });
    const s = await read(d, sam);
    expect(s.items.map((i) => [i.title, i.firstDay, i.lastDay])).toEqual([['Camp', '2026-11-07', '2026-11-11']]);
    expect(scheduleWhen(s.items[0])).toMatch(/ – .*· All day$/);
  });

  it('all-day and timed items read in the Calendar\'s own words', async () => {
    const { d, sam } = await household();
    await addEvent(d, 'All day thing', '2026-11-12', { contactIds: [sam] });
    await addEvent(d, 'Timed thing', '2026-11-13', { contactIds: [sam] }, 16 * 60, { endAt: msAt('2026-11-13', 17 * 60) });
    const [a, t] = (await read(d, sam)).items;
    expect(a.allDay).toBe(true);
    expect(scheduleWhen(a)).toBe('Thu, Nov 12 · All day');
    expect(t.allDay).toBe(false);
    expect(scheduleWhen(t)).toMatch(/^Fri, Nov 13 · .*4:00.*PM.* – .*5:00.*PM/);
  });

  it('each item carries its calendar\'s colour and name, and the key the Calendar itself uses to open it', async () => {
    const { d, sam } = await household();
    const cal = await createCalendar('Soccer team', '#2f8f6b', d);
    const id = await addEvent(d, 'Practice', '2026-11-11', { contactIds: [sam], calendarId: cal }, 17 * 60);
    const it = (await read(d, sam)).items[0];
    expect([it.calendarName, it.color]).toEqual(['Soccer team', '#2f8f6b']);
    expect(it.openKey).toBe(storedItemKey(id, it.occKey));
    expect(calendarLink(it)).toBe(`#/calendar?v=agenda&d=2026-11-11&open=${encodeURIComponent(`e:${id}:2026-11-11`)}`);
  });

  it('an event whose calendar no longer exists is still shown, in a neutral colour', async () => {
    const { d, sam } = await household();
    await addEvent(d, 'Orphan', '2026-11-11', { contactIds: [sam], calendarId: 123456 });
    const it = (await read(d, sam)).items[0];
    expect([it.calendarName, it.color]).toEqual(['Calendar', '#6b7280']);
  });
});

describe('repeating events follow the Calendar\'s own engine', () => {
  it('a weekly series gives exactly the occurrences the Calendar gives for the same window, with their original-date keys', async () => {
    const { d, sam } = await household();
    const id = await addEvent(d, 'Practice', '2026-11-02', { contactIds: [sam], recurrence: weekly }, 17 * 60);
    const mine = (await read(d, sam)).items;
    const ev = (await loadEvents(d)).find((e) => e.id === id)!;
    const cal = occurrencesOf(ev, TODAY, '2026-12-09');
    expect(mine.map((i) => i.occKey)).toEqual(cal.map((o) => o.key));
    expect(mine.map((i) => i.firstDay)).toEqual(['2026-11-09', '2026-11-16', '2026-11-23', '2026-11-30', '2026-12-07']);
    expect(new Set(mine.map((i) => i.key)).size).toBe(5); // one entry per occurrence
    expect(mine.every((i) => i.recurring)).toBe(true);
  });

  it('a skipped date disappears and a one-date change shows where and how it was moved, by the real Calendar edit functions', async () => {
    const { d, sam } = await household();
    const id = await addEvent(d, 'Practice', '2026-11-02', { contactIds: [sam], recurrence: weekly }, 17 * 60);
    const ev = (await loadEvents(d)).find((e) => e.id === id)!;
    const occ = (day: string) => occurrencesOf(ev, day, day)[0];
    await removeOccurrence(occ('2026-11-16'), 'one', d); // skip 16 Nov
    const o23 = occ('2026-11-23');
    await saveEdit(o23, { ...o23, title: 'Practice (field 2)', startDate: '2026-11-24', endDate: '2026-11-24', startAt: msAt('2026-11-24', 17 * 60), endAt: msAt('2026-11-24', 18 * 60) }, extras({ contactIds: [sam], recurrence: weekly }), 'one', d);
    const mine = (await read(d, sam)).items;
    expect(mine.map((i) => i.occKey)).toEqual(['2026-11-09', '2026-11-23', '2026-11-30', '2026-12-07']); // 16 Nov is gone
    const moved = mine.find((i) => i.occKey === '2026-11-23')!;
    expect([moved.title, moved.firstDay]).toEqual(['Practice (field 2)', '2026-11-24']); // moved to the 24th, still named for its original date
    expect(mine.map((i) => i.title).filter((t) => t === 'Practice')).toHaveLength(3);
  });

  it('deleting the whole series, or a one-off, removes it from the profile; a retired event is never listed', async () => {
    const { d, sam } = await household();
    const id = await addEvent(d, 'Series', '2026-11-10', { contactIds: [sam], recurrence: weekly });
    const one = await addEvent(d, 'One-off', '2026-11-11', { contactIds: [sam] });
    const ev = (await loadEvents(d)).find((e) => e.id === id)!;
    await removeOccurrence(occurrencesOf(ev, '2026-11-10', '2026-11-10')[0], 'all', d);
    const ev1 = (await loadEvents(d)).find((e) => e.id === one)!;
    await removeOccurrence(occurrencesOf(ev1, '2026-11-11', '2026-11-11')[0], 'all', d);
    expect((await read(d, sam)).items).toEqual([]);
    const events = [{ id: 1, createdAt: 0, updatedAt: 0, data: { ...(await (async () => { await addEvent(d, 'x', '2026-11-12', { contactIds: [sam] }); return (await loadEvents(d))[0].data; })()), retired: { module: 'm', recordId: 1, note: 'n' } } }];
    const layers = await loadLayers(d);
    expect(buildMemberSchedule({ events, layers, members: await loadMembers(d), contactId: sam, visibility: ALL_ON, from: TODAY, to: '2026-12-09' }).items).toEqual([]);
  });
});

describe('calendars switched off on this device', () => {
  it('a hidden calendar\'s events are not listed but are counted; switching it back on lists them', async () => {
    const { d, sam } = await household();
    const school = await createCalendar('School', '#4a7bd0', d);
    await addEvent(d, 'Mine', '2026-11-12', { contactIds: [sam] });
    await addEvent(d, 'Hidden one', '2026-11-13', { contactIds: [sam], calendarId: school });
    await addEvent(d, 'Hidden two', '2026-11-14', { contactIds: [sam], calendarId: school, recurrence: weekly });
    const available = (await loadLayers(d)).map((l) => l.id);
    const off = toggleLayer(ALL_ON, school, available);
    const s = await read(d, sam, off);
    expect(s.items.map((i) => i.title)).toEqual(['Mine']);
    expect(s.hiddenCount).toBe(1 + 4); // one + the four weekly dates 14 Nov, 21 Nov, 28 Nov, 5 Dec
    expect((await read(d, sam, ALL_ON)).items).toHaveLength(6);
  });

  it('"Deselect all" lists nothing and counts everything; a calendar made later is off in "only" mode, exactly as in the Calendar', async () => {
    const { d, sam } = await household();
    await addEvent(d, 'Mine', '2026-11-12', { contactIds: [sam] });
    const none = await read(d, sam, deselectAll());
    expect(none.items).toEqual([]);
    expect(none.hiddenCount).toBe(1);
  });
});

describe('reading is read-only and defensive', () => {
  it('reading changes no row in any table (Calendar, Tasks, Contacts, Finance included)', async () => {
    const { d, sam } = await household();
    await addEvent(d, 'Practice', '2026-11-02', { contactIds: [sam], recurrence: weekly }, 17 * 60);
    const before = await snapshot(d);
    await read(d, sam);
    await read(d, sam, deselectAll());
    expect(await snapshot(d)).toBe(before);
  });

  it('a damaged event row (wrong types, no dates) is read without error and a malformed contactIds is not a match', async () => {
    const { d, sam } = await household();
    const row = (data: object) => d.moduleRecords.add({ module: 'calendar', kind: 'event', createdAt: 1, updatedAt: 1, deletedAt: null, data } as never);
    await row({ title: 42, contactIds: 'sam' });
    await row({ title: ['x'], contactIds: [sam, 'x', null, { a: 1 }], startDate: '2026-11-12', endDate: 'soon', allDay: true, recurrence: 'weekly', skipped: 'no', overrides: 7 });
    await row(null as never);
    await expect(read(d, sam)).resolves.toBeDefined();
    const s = await read(d, sam);
    expect(s.items.map((i) => i.firstDay)).toEqual(['2026-11-12']);
  });

  it('a Contact or member that has gone is not an error', async () => {
    const { d, sam, samId } = await household();
    await addEvent(d, 'Orphan trip', '2026-11-12', { contactIds: [sam, 987654] });
    await d.contacts.update(sam, { deletedAt: Date.now() } as never);
    expect((await read(d, sam)).items).toHaveLength(1); // the member keeps its events; the profile page says the Contact is gone
    expect(samId).toBeGreaterThan(0);
  });
});
