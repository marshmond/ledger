import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FinanceDB } from '../../db';
import { createStore } from '../../core/store';
import { scanText } from '../../lib/leakTestkit';
import { createCalendar, createEvent, ensureCalendarSeed, loadEvents, loadLayers, newEventData, removeOccurrence, saveEdit } from '../calendar/data';
import { ALL_ON, deselectAll, toggleLayer } from '../calendar/layerVisibility';
import { blankFields, PERSONAL_ID, type EventFields } from '../calendar/model';
import { occurrencesOf } from '../calendar/occurrences';
import type { SeriesExtras } from '../calendar/series';
import { msAt } from '../calendar/time';
import { completeTask, createTask, saveTask } from '../tasks/data';
import { blankTask } from '../tasks/model';
import { createMember, setMe, setMemberStatus } from './data';
import { createDate, setDateStatus } from './dateData';
import { buildHouseholdTasks, DATE_DAYS, forPerson, householdPeople, readHouseholdOverview, ACTIVITY_DAYS, NO_CONTACT_NAME } from './householdOverview';
import { loadMembers } from './data';

/** F4 household overview: aggregation over the real Calendar, Tasks and Family code. Invented names and dates only. */
let n = 0;
const fresh = () => new FinanceDB(`test-family-f4-${n++}`);
const TODAY = '2026-11-09'; // a Monday
const weekly = { freq: 'weekly', interval: 1, end: { type: 'never' } } as const;
const daily = { freq: 'daily', interval: 1, end: { type: 'never' } } as const;
const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }; };
beforeEach(() => { vi.stubGlobal('localStorage', mem()); });

const addContact = (d: FinanceDB, name: string) => createStore(d).shared.contacts.put({ name } as never);
type Fields = Parameters<typeof createMember>[0]['fields'];
const addMember = async (d: FinanceDB, contactId: number, over: Partial<Fields> = {}) => (await createMember({ contact: { mode: 'existing', contactId }, fields: { role: 'child', status: 'active', ...over } }, d, 2026)).id;
const extras = (over: Partial<SeriesExtras> = {}): SeriesExtras => ({ calendarId: PERSONAL_ID, tagIds: [], contactIds: [], recurrence: null, trackDone: false, ...over });
const addEvent = (d: FinanceDB, title: string, date: string, over: Partial<SeriesExtras> = {}, minutes?: number, f: Partial<EventFields> = {}, type?: string) =>
  createEvent({ ...newEventData({ ...(minutes === undefined ? blankFields(date) : { ...blankFields(date, msAt(date, minutes)), startDate: date, endDate: date }), title, ...f }, extras(over)), ...(type ? { type } : {}) }, d);
const task = (d: FinanceDB, title: string, contactIds: number[], over: Partial<ReturnType<typeof blankTask>> = {}) => createTask(blankTask({ title, contactIds, ...over }), [], d);
const snapshot = async (d: FinanceDB) => JSON.stringify(await Promise.all(d.tables.map(async (t) => [t.name, await t.toArray()])));
const read = (d: FinanceDB, vis = ALL_ON, today = TODAY) => readHouseholdOverview(today, vis, d);

/** Sam (child, blue), Robin (child), Alex (parent) and Jo (spouse), all active; Coach is only a Contact. */
async function household() {
  const d = fresh();
  await ensureCalendarSeed(d);
  const [sam, robin, alex, jo, coach] = [await addContact(d, 'Sam Example'), await addContact(d, 'Robin Example'), await addContact(d, 'Alex Example'), await addContact(d, 'Jo Example'), await addContact(d, 'Coach Example')];
  const samId = await addMember(d, sam, { color: '#4a7bd0' });
  const robinId = await addMember(d, robin);
  const alexId = await addMember(d, alex, { role: 'parent' });
  const joId = await addMember(d, jo, { role: 'spouse' });
  return { d, sam, robin, alex, jo, coach, samId, robinId, alexId, joId };
}

describe('the household: active and past members, spouse and "This is me"', () => {
  it('lists active members only, with role, colour and name from the shared Contact, sorted by name', async () => {
    const { d, samId, joId } = await household();
    const o = await read(d);
    expect(o.people.map((p) => [p.name, p.role])).toEqual([['Alex Example', 'parent'], ['Jo Example', 'spouse'], ['Robin Example', 'child'], ['Sam Example', 'child']]);
    expect(o.people.find((p) => p.memberId === samId)!.color).toBe('#4a7bd0');
    expect(o.people.find((p) => p.memberId === joId)!.role).toBe('spouse');
  });

  it('a past member is not in the household: their events, tasks and birthday are not listed', async () => {
    const { d, robin, robinId } = await household();
    await addEvent(d, 'Robin recital', '2026-11-11', { contactIds: [robin] });
    await task(d, 'Robin form', [robin]);
    await setMemberStatus(robinId, 'past', d);
    const o = await read(d);
    expect(o.people.map((p) => p.name)).not.toContain('Robin Example');
    expect(o.activities.items).toEqual([]);
    expect(o.tasks.items).toEqual([]);
  });

  it('"This is me" marks exactly the one effective member', async () => {
    const { d, alexId } = await household();
    await setMe(alexId, d);
    const o = await read(d);
    expect(o.people.filter((p) => p.isMe).map((p) => p.name)).toEqual(['Alex Example']);
  });

  it('two competing "This is me" marks (two devices): nobody is chosen, nothing is rewritten', async () => {
    const d = fresh();
    const a = await addContact(d, 'Alex Example');
    const j = await addContact(d, 'Jo Example');
    await addMember(d, a, { role: 'parent', isMe: true });
    await addMember(d, j, { role: 'spouse', isMe: true });
    const before = await snapshot(d);
    const o = await read(d);
    expect(o.people.map((p) => p.isMe)).toEqual([false, false]);
    expect(await snapshot(d)).toBe(before);
  });

  it('a member whose Contact is gone is named plainly and still listed; two records for one Contact are one person', async () => {
    const { d, sam } = await household();
    await d.contacts.update(sam, { deletedAt: Date.now() } as never);
    // a second, duplicate active record for Robin's contact (as two offline devices could make)
    const robin = (await d.contacts.toArray()).find((c) => c.name === 'Robin Example')!.id as number;
    await d.moduleRecords.add({ module: 'family', kind: 'member', createdAt: 5, updatedAt: 5, deletedAt: null, data: { contactId: robin, role: 'child', status: 'active' } } as never);
    const o = await read(d);
    expect(o.people.filter((p) => p.name === 'Robin Example')).toHaveLength(1);
    expect(o.people.some((p) => p.name === NO_CONTACT_NAME)).toBe(true);
  });
});

describe('activities: the next seven days', () => {
  it('spans today and the six days after it, soonest first, across every member', async () => {
    const { d, sam, robin, coach } = await household();
    await addEvent(d, 'Yesterday', '2026-11-08', { contactIds: [sam] }, 9 * 60);
    await addEvent(d, 'Today late', TODAY, { contactIds: [robin] }, 20 * 60);
    await addEvent(d, 'Day 7 (last)', '2026-11-15', { contactIds: [sam] }, 8 * 60);
    await addEvent(d, 'Day 8 (out)', '2026-11-16', { contactIds: [sam] }, 8 * 60);
    await addEvent(d, 'Mid week all day', '2026-11-12', { contactIds: [robin] });
    await addEvent(d, 'Mid week timed', '2026-11-12', { contactIds: [sam] }, 15 * 60);
    await addEvent(d, 'Coach only', '2026-11-11', { contactIds: [coach] });
    await addEvent(d, 'Nobody', '2026-11-11');
    expect(ACTIVITY_DAYS).toBe(7);
    const o = await read(d);
    expect(o.activities.items.map((a) => a.title)).toEqual(['Today late', 'Mid week all day', 'Mid week timed', 'Day 7 (last)']);
  });

  it('an event for two members is ONE row that names both; the same person listed twice is still one; a non-member contact is not named', async () => {
    const { d, sam, robin, coach, samId, robinId } = await household();
    await addEvent(d, 'Swim meet', '2026-11-14', { contactIds: [robin, sam, coach, sam] }, 9 * 60);
    const o = await read(d);
    expect(o.activities.items).toHaveLength(1);
    const a = o.activities.items[0];
    expect(a.people.map((p) => [p.memberId, p.name])).toEqual([[robinId, 'Robin Example'], [samId, 'Sam Example']]);
    expect(a.people[1].color).toBe('#4a7bd0');
    expect(a.key).toBe(`${a.eventId}:${a.occKey}`); // identity is the event and its occurrence, not its title or people
    expect(await loadEvents(d)).toHaveLength(1); // nothing was copied into the Calendar
  });

  it('two different events with the same title and people stay two rows', async () => {
    const { d, sam, robin } = await household();
    await addEvent(d, 'Practice', '2026-11-10', { contactIds: [sam, robin] }, 17 * 60);
    await addEvent(d, 'Practice', '2026-11-10', { contactIds: [sam, robin] }, 17 * 60);
    expect((await read(d)).activities.items).toHaveLength(2);
  });

  it('a repeating event gives exactly the Calendar\'s occurrences for the window', async () => {
    const { d, sam } = await household();
    const id = await addEvent(d, 'Practice', '2026-11-02', { contactIds: [sam], recurrence: weekly }, 17 * 60);
    await addEvent(d, 'Daily meds check', '2026-11-01', { contactIds: [sam], recurrence: daily });
    const o = await read(d);
    const ev = (await loadEvents(d)).find((e) => e.id === id)!;
    const cal = occurrencesOf(ev, TODAY, '2026-11-15').map((x) => x.key);
    expect(o.activities.items.filter((a) => a.eventId === id).map((a) => a.occKey)).toEqual(cal);
    expect(o.activities.items.filter((a) => a.title === 'Daily meds check')).toHaveLength(7); // bounded by the window, not by the series
    expect(o.activities.items.every((a) => a.recurring)).toBe(true);
  });

  it('a skipped occurrence is omitted and a moved one shows its new day, using the real Calendar edit functions', async () => {
    const { d, sam } = await household();
    const id = await addEvent(d, 'Practice', '2026-11-02', { contactIds: [sam], recurrence: weekly }, 17 * 60);
    await addEvent(d, 'Lesson', '2026-11-03', { contactIds: [sam], recurrence: weekly }, 16 * 60);
    const ev = (await loadEvents(d)).find((e) => e.id === id)!;
    const occ = (day: string) => occurrencesOf(ev, day, day)[0];
    await removeOccurrence(occ('2026-11-09'), 'one', d); // skip today's practice
    const lesson = (await loadEvents(d)).find((e) => e.data.title === 'Lesson')!;
    const o10 = occurrencesOf(lesson, '2026-11-10', '2026-11-10')[0];
    await saveEdit(o10, { ...o10, title: 'Lesson (moved)', startDate: '2026-11-13', endDate: '2026-11-13', startAt: msAt('2026-11-13', 16 * 60), endAt: msAt('2026-11-13', 17 * 60) }, extras({ contactIds: [sam], recurrence: weekly }), 'one', d);
    const items = (await read(d)).activities.items;
    expect(items.filter((a) => a.eventId === id).map((a) => a.occKey)).toEqual([]); // 9 Nov skipped; the next one (16 Nov) is past day 7
    const moved = items.find((a) => a.title === 'Lesson (moved)')!;
    expect([moved.firstDay, moved.occKey]).toEqual(['2026-11-13', '2026-11-10']);
    expect(items.filter((a) => a.title === 'Lesson')).toHaveLength(0);
  });

  it('a multi-day event that began earlier and is still going is listed once, all-day and timed items read correctly', async () => {
    const { d, sam } = await household();
    await addEvent(d, 'Camp', '2026-11-07', { contactIds: [sam] }, undefined, { endDate: '2026-11-11' });
    await addEvent(d, 'Dentist', '2026-11-10', { contactIds: [sam] }, 14 * 60);
    const items = (await read(d)).activities.items;
    expect(items.map((a) => [a.title, a.allDay])).toEqual([['Camp', true], ['Dentist', false]]);
  });

  it('deleted and retired events are not listed', async () => {
    const { d, sam } = await household();
    const gone = await addEvent(d, 'Gone', '2026-11-10', { contactIds: [sam] });
    await addEvent(d, 'Kept', '2026-11-11', { contactIds: [sam] });
    const ev = (await loadEvents(d)).find((e) => e.id === gone)!;
    await removeOccurrence(occurrencesOf(ev, '2026-11-10', '2026-11-10')[0], 'all', d);
    const retired = await addEvent(d, 'Retired', '2026-11-12', { contactIds: [sam] });
    const row = await d.moduleRecords.get(retired);
    await d.moduleRecords.update(retired, { data: { ...(row!.data as object), retired: { module: 'bills', recordId: 1, note: 'x' } } } as never);
    expect((await read(d)).activities.items.map((a) => a.title)).toEqual(['Kept']);
  });

  it('an event whose calendar no longer exists is still listed, in a neutral colour', async () => {
    const { d, sam } = await household();
    await addEvent(d, 'Orphan', '2026-11-11', { contactIds: [sam], calendarId: 424242 });
    const a = (await read(d)).activities.items[0];
    expect([a.calendarName, a.color]).toEqual(['Calendar', '#6b7280']);
  });
});

describe('calendars switched off on this device', () => {
  it('their events are counted, never listed; switching back on lists them; a shared hidden event is counted once', async () => {
    const { d, sam, robin } = await household();
    const school = await createCalendar('School', '#4a7bd0', d);
    await addEvent(d, 'Mine', '2026-11-12', { contactIds: [sam] });
    await addEvent(d, 'Hidden shared', '2026-11-13', { contactIds: [sam, robin], calendarId: school });
    await addEvent(d, 'Hidden weekly', '2026-11-10', { contactIds: [sam], calendarId: school, recurrence: weekly }); // 10 Nov and 15... only 10 Nov in the 7 days
    const off = toggleLayer(ALL_ON, school, (await loadLayers(d)).map((l) => l.id));
    const o = await read(d, off);
    expect(o.activities.items.map((a) => a.title)).toEqual(['Mine']);
    expect(o.activities.hidden).toHaveLength(2);
    expect((await read(d, ALL_ON)).activities.items).toHaveLength(3);
  });

  it('"deselect all" lists nothing and counts everything; the person filter counts only that person\'s hidden items', async () => {
    const { d, sam, robin, samId, robinId } = await household();
    await addEvent(d, 'Sam thing', '2026-11-12', { contactIds: [sam] });
    await addEvent(d, 'Robin thing', '2026-11-12', { contactIds: [robin] });
    const o = await read(d, deselectAll());
    expect(o.activities.items).toEqual([]);
    expect(o.activities.hidden).toHaveLength(2);
    expect(forPerson(o, samId).activities.hidden).toHaveLength(1);
    expect(forPerson(o, robinId).activities.hidden.map((h) => h.memberIds)).toEqual([[robinId]]);
  });
});

describe('responsibilities: open Tasks that name a member', () => {
  it('lists open tasks naming any member, once each; done tasks, non-member contacts and nobody are excluded', async () => {
    const { d, sam, robin, coach } = await household();
    await task(d, 'Sign form', [sam]);
    await task(d, 'Shared chore', [sam, robin, sam]);
    await task(d, 'Coach call', [coach]);
    await task(d, 'Nobody', []);
    const done = await task(d, 'Finished', [sam]);
    await completeTask(done, TODAY, d);
    const t = (await read(d)).tasks.items;
    expect(t.map((x) => x.title).sort()).toEqual(['Shared chore', 'Sign form']);
    expect(t.find((x) => x.title === 'Shared chore')!.people.map((p) => p.name)).toEqual(['Robin Example', 'Sam Example']);
  });

  it('puts overdue first, then dated by Tasks\' own order, then undated last, with priority as the tie-break', async () => {
    const { d, sam } = await household();
    await task(d, 'Undated', [sam]);
    await task(d, 'Next week', [sam], { dueDate: '2026-11-16' });
    await task(d, 'B same day low', [sam], { dueDate: '2026-11-10', priority: 'low' });
    await task(d, 'A same day high', [sam], { dueDate: '2026-11-10', priority: 'high' });
    await task(d, 'Late', [sam], { dueDate: '2026-11-03' });
    await task(d, 'Later still overdue', [sam], { dueDate: '2026-11-08' });
    await task(d, 'Planned only', [sam], { startDate: '2026-11-12' });
    await task(d, 'Planned in the past', [sam], { startDate: '2026-11-01' });
    const t = (await read(d)).tasks.items;
    expect(t.map((x) => x.title)).toEqual(['Late', 'Later still overdue', 'Planned in the past', 'A same day high', 'B same day low', 'Planned only', 'Next week', 'Undated']);
    expect(t.filter((x) => x.overdue).map((x) => x.title)).toEqual(['Late', 'Later still overdue']);
    expect(t.find((x) => x.title === 'A same day high')!.high).toBe(true);
    expect(t.find((x) => x.title === 'Undated')!.when).toBeNull();
  });

  it('a repeating task is one record: completing it moves the list to the next one, and nothing is created by reading', async () => {
    const { d, sam } = await household();
    const id = await task(d, 'Pack bag', [sam], { dueDate: '2026-11-10', repeat: { mode: 'fixed', rule: weekly } });
    const first = (await read(d)).tasks.items;
    expect(first.map((x) => [x.id, x.repeats])).toEqual([[id, true]]);
    const { spawnedId } = await completeTask(id, TODAY, d);
    const next = (await read(d)).tasks.items;
    expect(next.map((x) => x.id)).toEqual([spawnedId]);
    expect(next[0].repeats).toBe(true);
    expect(await d.moduleRecords.where('[module+kind]').equals(['tasks', 'task']).count()).toBe(2); // the completed one and its successor, made by Tasks, not by Family
  });

  it('taking the member off a task, or deleting it, removes it; Family keeps no second association', async () => {
    const { d, sam, robin } = await household();
    const id = await task(d, 'Form', [sam, robin]);
    expect((await read(d)).tasks.items[0].people).toHaveLength(2);
    const rec = (await d.moduleRecords.get(id))!;
    await saveTask(id, { ...(rec.data as unknown as ReturnType<typeof blankTask>), contactIds: [robin] }, d);
    expect((await read(d)).tasks.items[0].people.map((p) => p.name)).toEqual(['Robin Example']);
    await d.moduleRecords.update(id, { deletedAt: Date.now() } as never);
    expect((await read(d)).tasks.items).toEqual([]);
  });

  it('waiting and in-progress tasks are still open and carry their status', async () => {
    const { d, sam } = await household();
    await task(d, 'Waiting on school', [sam], { status: 'waiting' });
    await task(d, 'Doing', [sam], { status: 'doing' });
    expect((await read(d)).tasks.items.map((t) => t.status).sort()).toEqual(['doing', 'waiting']);
  });

  it('buildHouseholdTasks is pure: the input is not reordered or changed', () => {
    const person = { memberId: 1, contactId: 1, name: 'A', role: 'child' as const, isMe: false };
    const t = (id: number, over: object) => ({ id, createdAt: id, updatedAt: id, data: { ...blankTask({ contactIds: [1] }), title: `t${id}`, ...over } });
    const input = [t(3, { dueDate: '2026-11-20' }), t(1, { dueDate: '2026-11-01' }), t(2, { status: 'done' })];
    const copy = JSON.stringify(input);
    expect(buildHouseholdTasks(input, [person], TODAY).map((x) => x.id)).toEqual([1, 3]);
    expect(JSON.stringify(input)).toBe(copy);
  });
});

describe('birthdays and important dates', () => {
  it('lists birthdays and active dates within 30 days, soonest first, each about the right person; 31 days out is not listed', async () => {
    const { d, sam, samId, jo, joId } = await household();
    await d.moduleRecords.update(samId, { data: { contactId: sam, role: 'child', status: 'active', color: '#4a7bd0', birthMonthDay: '11-20' } } as never);
    await d.moduleRecords.update(joId, { data: { contactId: jo, role: 'spouse', status: 'active', birthMonthDay: '12-09' } } as never); // day 30
    await createDate({ dateKind: 'anniversary', label: 'Wedding anniversary', monthDay: '11-14', status: 'active', memberId: joId }, d, 2026);
    await createDate({ dateKind: 'other', label: 'Adoption day', monthDay: '12-10', status: 'active' }, d, 2026); // day 31
    await createDate({ dateKind: 'other', label: 'House move day', monthDay: '11-25', status: 'active' }, d, 2026);
    const o = await read(d);
    expect(DATE_DAYS).toBe(30);
    expect(o.dates.map((r) => [r.title, r.date])).toEqual([['Wedding anniversary', '2026-11-14'], ["Sam Example's birthday", '2026-11-20'], ['House move day', '2026-11-25'], ["Jo Example's birthday", '2026-12-09']]);
    expect(o.dates[0].person?.name).toBe('Jo Example');
    expect(o.dates[1].person?.name).toBe('Sam Example');
    expect(o.dates[2].person).toBeUndefined(); // a household-wide date
  });

  it('a past member has no birthday; a date record about them stays until archived and is named, not attached to a household person', async () => {
    const { d, robin, robinId } = await household();
    await d.moduleRecords.update(robinId, { data: { contactId: robin, role: 'child', status: 'active', birthMonthDay: '11-12' } } as never);
    const rec = await createDate({ dateKind: 'other', label: 'Remembrance day', monthDay: '11-13', status: 'active', memberId: robinId }, d, 2026);
    await setMemberStatus(robinId, 'past', d);
    const o = await read(d);
    expect(o.dates.map((r) => r.title)).toEqual(['Remembrance day']);
    expect(o.dates[0].person).toBeUndefined();
    expect(o.dates[0].aboutName).toBe('Robin Example');
    await setDateStatus(rec, 'archived', d);
    expect((await read(d)).dates).toEqual([]);
  });

  it('a leap-day birthday falls on 28 February in a year without one and on 29 February in a leap year', async () => {
    const { d, sam, samId } = await household();
    await d.moduleRecords.update(samId, { data: { contactId: sam, role: 'child', status: 'active', birthMonthDay: '02-29' } } as never);
    expect((await read(d, ALL_ON, '2027-02-20')).dates.map((r) => r.date)).toEqual(['2027-02-28']);
    expect((await read(d, ALL_ON, '2028-02-20')).dates.map((r) => r.date)).toEqual(['2028-02-29']);
    expect((await read(d, ALL_ON, '2027-12-20')).dates.map((r) => r.date)).toEqual([]); // 28 Feb 2028 is not the date: 2028 is a leap year, and it is 70 days away anyway
  });

  it('a birthday switched off the Calendar is still listed (as F2\'s dates page does), and says so', async () => {
    const { d, sam, samId } = await household();
    await d.moduleRecords.update(samId, { data: { contactId: sam, role: 'child', status: 'active', birthMonthDay: '11-12', birthdayOnCalendar: false } } as never);
    const r = (await read(d)).dates[0];
    expect([r.title, r.onCalendar]).toEqual(["Sam Example's birthday", false]);
  });

  it('a stored Birthday event for the same person on the same day is shown once, as the date, not again as an activity', async () => {
    const { d, sam, robin, samId } = await household();
    await d.moduleRecords.update(samId, { data: { contactId: sam, role: 'child', status: 'active', birthMonthDay: '11-12' } } as never);
    await addEvent(d, "Sam Example's birthday", '2026-11-12', { contactIds: [sam] }, undefined, {}, 'birthday');
    await addEvent(d, "Robin Example's birthday", '2026-11-13', { contactIds: [robin] }, undefined, {}, 'birthday'); // Robin has no birthday set: this event is all there is
    await addEvent(d, 'Birthday party', '2026-11-12', { contactIds: [sam] }, 14 * 60); // an ordinary event on the same day is a real activity
    const o = await read(d);
    expect(o.dates.map((r) => r.title)).toEqual(["Sam Example's birthday"]);
    expect(o.activities.items.map((a) => a.title)).toEqual(['Birthday party', "Robin Example's birthday"]); // Sam's stored birthday event is the date row above; Robin has no birthday set, so hers stays
  });

  it('two different people with birthdays on the same day stay two date rows; a stored Birthday event only covers its own Contact', async () => {
    const { d, sam, robin, samId, robinId } = await household();
    for (const [id, c] of [[samId, sam], [robinId, robin]] as const) await d.moduleRecords.update(id, { data: { contactId: c, role: 'child', status: 'active', birthMonthDay: '11-12' } } as never);
    await addEvent(d, "Sam Example's birthday", '2026-11-12', { contactIds: [sam] }, undefined, {}, 'birthday'); // covers Sam only
    const o = await read(d);
    expect(o.dates.map((r) => r.title)).toEqual(["Robin Example's birthday", "Sam Example's birthday"]);
    expect(o.activities.items).toEqual([]); // Sam's stored event is the same fact as his date row; nothing else is on that day
    await addEvent(d, 'Joint party', '2026-11-12', { contactIds: [sam, robin] }, 14 * 60);
    expect((await read(d)).activities.items.map((a) => a.title)).toEqual(['Joint party']);
  });

  it('family dates stay on the overview whatever the Calendar layers are switched to (only activities follow that preference)', async () => {
    const { d, sam, samId } = await household();
    await d.moduleRecords.update(samId, { data: { contactId: sam, role: 'child', status: 'active', birthMonthDay: '11-12' } } as never);
    await createDate({ dateKind: 'other', label: 'Reunion', monthDay: '11-20', status: 'active' }, d, 2026);
    await addEvent(d, 'Mine', '2026-11-11', { contactIds: [sam] });
    const o = await read(d, deselectAll());
    expect(o.dates.map((r) => r.title)).toEqual(["Sam Example's birthday", 'Reunion']);
    expect(o.activities.items).toEqual([]);
  });

  it('titles carry a name or label only: no birth year, age, note or contact detail anywhere in the dates', async () => {
    const { d, sam, samId } = await household();
    await d.contacts.update(sam, { phone: '555-0100', email: 'sam@example.test', notes: 'private contact note' } as never);
    await d.moduleRecords.update(samId, { data: { contactId: sam, role: 'child', status: 'active', birthMonthDay: '11-12', birthYear: 2015, note: 'secret member note' } } as never);
    const text = scanText(await read(d)); // ids are scrubbed first (src/lib/leakTestkit.ts), so only real text can match
    expect(text).not.toMatch(/2015|secret member note|555-0100|sam@example|private contact note/);
  });
});

describe('the optional person filter', () => {
  it('narrows activities, responsibilities and dates by the same person; null is everyone; household-wide dates are not any one person\'s', async () => {
    const { d, sam, robin, samId, robinId } = await household();
    await d.moduleRecords.update(samId, { data: { contactId: sam, role: 'child', status: 'active', birthMonthDay: '11-12' } } as never);
    await addEvent(d, 'Shared', '2026-11-11', { contactIds: [sam, robin] });
    await addEvent(d, 'Sam only', '2026-11-11', { contactIds: [sam] });
    await task(d, 'Robin task', [robin]);
    await task(d, 'Both task', [sam, robin]);
    await createDate({ dateKind: 'other', label: 'Whole household day', monthDay: '11-20', status: 'active' }, d, 2026);
    const o = await read(d);
    expect(forPerson(o, null)).toBe(o);
    const s = forPerson(o, samId);
    expect(s.activities.items.map((a) => a.title)).toEqual(['Sam only', 'Shared']); // same day, both all-day: by title
    expect(s.tasks.items.map((t) => t.title)).toEqual(['Both task']);
    expect(s.dates.map((r) => r.title)).toEqual(["Sam Example's birthday"]);
    const r = forPerson(o, robinId);
    expect(r.activities.items.map((a) => a.title)).toEqual(['Shared']);
    expect(r.tasks.items.map((t) => t.title).sort()).toEqual(['Both task', 'Robin task']);
    expect(r.dates).toEqual([]);
    expect(o.activities.items).toHaveLength(2); // filtering made no change to the whole
  });
});

describe('empty, missing and damaged data', () => {
  it('an empty household gives empty sections and reads nothing it does not need', async () => {
    const d = fresh();
    const o = await read(d);
    expect(o).toEqual({ people: [], activities: { items: [], hidden: [] }, tasks: { items: [] }, dates: [] });
  });

  it('only past members: no people, no activities or tasks, even with events and tasks that name them', async () => {
    const { d, sam, samId } = await household();
    await addEvent(d, 'Sam thing', '2026-11-11', { contactIds: [sam] });
    await task(d, 'Sam task', [sam]);
    for (const m of await loadMembers(d)) await setMemberStatus(m.id, 'past', d);
    const o = await read(d);
    expect([o.people.length, o.activities.items.length, o.tasks.items.length]).toEqual([0, 0, 0]);
    expect(samId).toBeGreaterThan(0);
  });

  it('damaged Calendar and Task rows (null, wrong types) are skipped without hiding the good ones', async () => {
    const { d, sam } = await household();
    const ev = (data: unknown) => d.moduleRecords.add({ module: 'calendar', kind: 'event', createdAt: 1, updatedAt: 1, deletedAt: null, data } as never);
    const tk = (data: unknown) => d.moduleRecords.add({ module: 'tasks', kind: 'task', createdAt: 1, updatedAt: 1, deletedAt: null, data } as never);
    await ev(null);
    await ev({ title: 42, contactIds: 'sam' });
    await ev({ title: ['x'], contactIds: [sam, 'x', null], startDate: '2026-11-12', endDate: 'soon', allDay: true, recurrence: 'weekly', skipped: 'no', overrides: 7 });
    await tk(null);
    await tk({ title: 7, contactIds: 'sam', dueDate: 99 });
    await tk({ title: 'Odd but fine', contactIds: [sam, 'x', null], status: 'someday', priority: 'urgent' });
    await addEvent(d, 'Good event', '2026-11-13', { contactIds: [sam] });
    const o = await read(d);
    expect(o.tasks.items.map((t) => t.title)).toEqual(['Odd but fine']);
    expect(o.activities.items.map((a) => a.title)).toContain('Good event');
  });

  it('unreadable member and date rows are ignored here (they are listed for review on the page itself)', async () => {
    const { d } = await household();
    await d.moduleRecords.add({ module: 'family', kind: 'member', createdAt: 1, updatedAt: 1, deletedAt: null, data: { contactId: 'x', role: 'wizard' } } as never);
    await d.moduleRecords.add({ module: 'family', kind: 'date', createdAt: 1, updatedAt: 1, deletedAt: null, data: { label: 7 } } as never);
    const o = await read(d);
    expect(o.people).toHaveLength(4);
    expect(o.dates).toEqual([]);
  });
});

describe('reading is read-only and stays inside Family, Calendar and Tasks', () => {
  it('reading changes no row in any table (timestamps included), Finance tables included, and makes no record', async () => {
    const { d, sam, robin, samId } = await household();
    await d.moduleRecords.update(samId, { data: { contactId: sam, role: 'child', status: 'active', birthMonthDay: '11-12' } } as never);
    await addEvent(d, 'Practice', '2026-11-02', { contactIds: [sam, robin], recurrence: weekly }, 17 * 60);
    await task(d, 'Late form', [sam], { dueDate: '2026-11-01', repeat: { mode: 'fixed', rule: weekly } });
    await createDate({ dateKind: 'anniversary', label: 'Anniversary', monthDay: '11-14', status: 'active' }, d, 2026);
    const acct = (await d.accounts.add({ name: 'Test checking', kind: 'checking', openingBalanceCents: 100000, openingDate: '2026-01-01' } as never)) as number;
    await d.txns.add({ accountId: acct, date: '2026-11-02', amountCents: -1800, payee: 'Paint store', memo: '', status: 'cleared', categoryId: null } as never);
    const before = await snapshot(d);
    const o = await read(d);
    await read(d, deselectAll());
    forPerson(o, samId);
    expect(await snapshot(d)).toBe(before);
    expect([await d.accounts.count(), await d.txns.count()]).toEqual([1, 1]);
  });

  it('householdPeople needs no database: pure, same answer twice', async () => {
    const { d } = await household();
    const members = await loadMembers(d);
    const names = new Map((await d.contacts.toArray()).map((c) => [c.id as number, c.name]));
    expect(householdPeople(members, names)).toEqual(householdPeople(members, names));
  });

  it('the window bounds the work: thirty daily series are seven rows each, never unbounded', async () => {
    const { d, sam } = await household();
    for (let i = 0; i < 30; i++) await addEvent(d, `Series ${i}`, '2026-01-01', { contactIds: [sam], recurrence: daily });
    expect((await read(d)).activities.items).toHaveLength(30 * 7);
  });
});
