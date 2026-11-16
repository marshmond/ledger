import { beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { FinanceDB } from '../../db';
import { COLOR_ID_BY_HEX, KNOWN_ROLES, MISSING_CONTACT_NAME, lensMatches, nameList, peopleFromRows, peopleOf, loadHouseholdPeople, peopleByContact } from '../../core/householdPeople';
import { createStore, repo } from '../../core/store';
import type { ModuleRecord } from '../../core/entities';
import { addDays } from '../../lib/dates';
import { scanText } from '../../lib/leakTestkit';
import { createEvent, ensureCalendarSeed, loadEvents, newEventData, removeOccurrence } from '../calendar/data';
import { ALL_ON, deselectAll } from '../calendar/layerVisibility';
import { blankFields, PERSONAL_ID, type EventFields } from '../calendar/model';
import { occurrencesOf } from '../calendar/occurrences';
import type { SeriesExtras } from '../calendar/series';
import { msAt } from '../calendar/time';
import { createCalendar } from '../calendar/data';
import { createTask, completeTask } from '../tasks/data';
import { blankTask } from '../tasks/model';
import { createMember, loadMembers, setMemberStatus } from './data';
import { createDate } from './dateData';
import { loadDates } from './dateData';
import { buildFamilyView, entriesOf, FAMILY_ENTRY_KEYS, FAMILY_PERSON_KEYS, narrowFamilyView, readFamilyView, UnsupportedAudienceError, type FamilyEntry, type FamilyView, type FamilyViewPerson } from './familyView';
import { householdPeople, readHouseholdOverview } from './householdOverview';
import { memberColorId } from './memberIdentity';
import { COLORS, ROLES } from './model';

/** R4.2: the shared Family view reader. Real Calendar, Tasks and Family code on an in-memory database; invented names and dates only. */
let n = 0;
const fresh = () => new FinanceDB(`test-family-r42-${n++}`);
const TODAY = '2026-11-09'; // a Monday
const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }; };
beforeEach(() => { vi.stubGlobal('localStorage', mem()); });

const weekly = { freq: 'weekly', interval: 1, end: { type: 'never' } } as const;
const addContact = (d: FinanceDB, name: string, extra: object = {}) => createStore(d).shared.contacts.put({ name, ...extra } as never);
type Fields = Parameters<typeof createMember>[0]['fields'];
const addMember = async (d: FinanceDB, contactId: number, over: Partial<Fields> = {}) => (await createMember({ contact: { mode: 'existing', contactId }, fields: { role: 'child', status: 'active', ...over } }, d, 2026)).id;
const extras = (over: Partial<SeriesExtras> = {}): SeriesExtras => ({ calendarId: PERSONAL_ID, tagIds: [], contactIds: [], recurrence: null, trackDone: false, ...over });
const addEvent = (d: FinanceDB, title: string, date: string, over: Partial<SeriesExtras> = {}, minutes?: number, f: Partial<EventFields> = {}) =>
  createEvent(newEventData({ ...(minutes === undefined ? blankFields(date) : { ...blankFields(date, msAt(date, minutes)), startDate: date, endDate: date }), title, ...f }, extras(over)), d);
const task = (d: FinanceDB, title: string, contactIds: number[], over: Partial<ReturnType<typeof blankTask>> = {}) => createTask(blankTask({ title, contactIds, ...over }), [], d);
const snapshot = async (d: FinanceDB) => JSON.stringify(await Promise.all(d.tables.map(async (t) => [t.name, await t.toArray()])));
const viewOf = (d: FinanceDB, from = '2026-11-08', to = '2026-11-14', selected: number[] = [], vis = ALL_ON) => readFamilyView('owner', { from, to, today: TODAY, visibility: vis, selected }, d);
const titles = (v: FamilyView) => entriesOf(v).map((e) => e.title);

/** Sam (child, blue), Robin (child), Alex (parent) and Jo (spouse), all active; Coach is only a Contact. */
async function household() {
  const d = fresh();
  await ensureCalendarSeed(d);
  const [sam, robin, alex, jo, coach] = [await addContact(d, 'Sam Example'), await addContact(d, 'Robin Example'), await addContact(d, 'Alex Example'), await addContact(d, 'Jo Example'), await addContact(d, 'Coach Example')];
  const samId = await addMember(d, sam, { color: '#4a7bd0', birthMonthDay: '11-12', birthYear: 2015 });
  const robinId = await addMember(d, robin);
  const alexId = await addMember(d, alex, { role: 'parent', color: '#2f8f6b' });
  const joId = await addMember(d, jo, { role: 'spouse' });
  return { d, sam, robin, alex, jo, coach, samId, robinId, alexId, joId };
}

describe('who is on the week, from the real Calendar, Tasks and Family code', () => {
  it('a shared event is ONE entry that names every member; a single-person event names one; an event naming nobody is not a Family item', async () => {
    const { d, sam, robin, alex } = await household();
    await addEvent(d, 'Swim meet', '2026-11-11', { contactIds: [sam, robin] }, 10 * 60);
    await addEvent(d, 'Piano', '2026-11-12', { contactIds: [alex] }, 16 * 60);
    await addEvent(d, 'Dentist (nobody named)', '2026-11-12', {}, 9 * 60);
    const v = await viewOf(d);
    const swim = entriesOf(v).filter((e) => e.title === 'Swim meet');
    expect(swim).toHaveLength(1);
    expect(swim[0].people.map((p) => p.name)).toEqual(['Robin Example', 'Sam Example']);
    expect(swim[0].kind).toBe('event');
    expect(titles(v)).toContain('Piano');
    expect(titles(v)).not.toContain('Dentist (nobody named)'); // unassigned: never attributed to anyone
    expect(v.days.find((x) => x.date === '2026-11-11')!.entries.map((e) => e.title)).toEqual(['Swim meet']);
  });

  it('filtering one member keeps that member\'s items, keeps a shared item once with ALL its people, and drops the rest', async () => {
    const { d, sam, robin, alex } = await household();
    await addEvent(d, 'Swim meet', '2026-11-11', { contactIds: [sam, robin] }, 10 * 60);
    await addEvent(d, 'Piano', '2026-11-12', { contactIds: [alex] }, 16 * 60);
    await task(d, 'Sam form', [sam], { dueDate: '2026-11-10' });
    const all = await viewOf(d);
    const robinOnly = narrowFamilyView(all, [robin]);
    expect(titles(robinOnly)).toEqual(['Swim meet']);
    expect(entriesOf(robinOnly)[0].people.map((p) => p.name)).toEqual(['Robin Example', 'Sam Example']); // still associated with both
    const samAndAlex = narrowFamilyView(all, [sam, alex]);
    expect(titles(samAndAlex).sort()).toEqual(['Piano', 'Sam form', 'Swim meet', "Sam Example's birthday"].sort()); // chosen twice over, listed once
    expect(titles(narrowFamilyView(all, []))).toEqual(titles(all)); // Everyone
    // reading with the filter gives the same as narrowing afterwards
    expect(titles(await viewOf(d, '2026-11-08', '2026-11-14', [robin]))).toEqual(['Swim meet']);
    expect(all.people.map((p) => p.name)).toEqual(['Alex Example', 'Jo Example', 'Robin Example', 'Sam Example']); // the filter never hides who is in the household
  });

  it('a Contact who is not a household member is not a person: no entry, no chip, no error', async () => {
    const { d, coach, sam } = await household();
    await addEvent(d, 'Practice', '2026-11-10', { contactIds: [coach] }, 17 * 60);
    await addEvent(d, 'Practice with coach', '2026-11-11', { contactIds: [coach, sam] }, 17 * 60);
    const v = await viewOf(d);
    expect(titles(v)).not.toContain('Practice');
    expect(entriesOf(v).find((e) => e.title === 'Practice with coach')!.people.map((p) => p.name)).toEqual(['Sam Example']);
  });

  it('a past member, a member whose Contact is gone and a damaged member row never break the view and are not attributed', async () => {
    const { d, robin, robinId, sam } = await household();
    await addEvent(d, 'Robin recital', '2026-11-11', { contactIds: [robin] }, 10 * 60);
    await setMemberStatus(robinId, 'past', d);
    await d.moduleRecords.add({ module: 'family', kind: 'member', createdAt: 5, updatedAt: 5, deletedAt: null, data: { contactId: 'x', role: 'wizard', status: 'active' } } as never);
    await d.moduleRecords.add({ module: 'family', kind: 'member', createdAt: 6, updatedAt: 6, deletedAt: null, data: null } as never);
    const ghost = await addContact(d, 'Ghost Example');
    await addMember(d, ghost);
    await addEvent(d, 'Ghost visit', '2026-11-12', { contactIds: [ghost] }, 11 * 60);
    await d.contacts.delete(ghost);
    const v = await viewOf(d);
    expect(titles(v)).not.toContain('Robin recital');
    expect(v.people.map((p) => p.name)).not.toContain('Robin Example');
    expect(entriesOf(v).find((e) => e.title === 'Ghost visit')!.people[0].name).toBe(MISSING_CONTACT_NAME);
    expect(narrowFamilyView(v, [robin, 999999])).toBeDefined(); // a stale choice just matches nothing
    expect(sam).toBeGreaterThan(0);
  });

  it('a repeating event comes from the Calendar\'s own occurrence generator: once a week, skipped dates stay skipped', async () => {
    const { d, sam } = await household();
    const id = await addEvent(d, 'Practice', '2026-11-04', { contactIds: [sam], recurrence: weekly }, 17 * 60);
    const ev = (await loadEvents(d)).find((e) => e.id === id)!;
    await removeOccurrence(occurrencesOf(ev, '2026-11-18', '2026-11-18')[0], 'one', d);
    const ev2 = (await loadEvents(d)).find((e) => e.id === id)!;
    for (const [from, to] of [['2026-11-08', '2026-11-14'], ['2026-11-15', '2026-11-21'], ['2026-11-22', '2026-11-28']] as const) {
      const mine = entriesOf(await viewOf(d, from, to)).filter((e) => e.title === 'Practice');
      expect(mine.map((e) => e.key)).toEqual(occurrencesOf(ev2, from, to).map((o) => `e:${o.eventId}:${o.key}`));
      expect(mine.every((e) => e.recurring)).toBe(true);
    }
    expect(entriesOf(await viewOf(d, '2026-11-15', '2026-11-21')).filter((e) => e.title === 'Practice')).toHaveLength(0); // the 18th was skipped
  });

  it('Tasks: open and dated only; a finished Task is gone; undated is not on a day; earlier open ones are carried over only when the window includes today', async () => {
    const { d, sam } = await household();
    const done = await task(d, 'Done form', [sam], { dueDate: '2026-11-10' });
    await completeTask(done, TODAY, d);
    await task(d, 'Open form', [sam], { dueDate: '2026-11-11', dueTime: '15:30' });
    await task(d, 'No date', [sam]);
    await task(d, 'Late form', [sam], { dueDate: '2026-11-02' });
    await task(d, 'Nobody', [], { dueDate: '2026-11-11' });
    const thisWeek = await viewOf(d);
    expect(titles(thisWeek)).toContain('Open form');
    expect(titles(thisWeek)).not.toContain('Done form');
    expect(titles(thisWeek)).not.toContain('No date');
    expect(titles(thisWeek)).not.toContain('Nobody');
    expect(thisWeek.carriedOver.map((e) => [e.title, e.status])).toEqual([['Late form', 'overdue']]);
    const open = entriesOf(thisWeek).find((e) => e.title === 'Open form')!;
    expect([open.kind, open.source, open.startTime, open.allDay, open.link]).toEqual(['task', 'Tasks', '15:30', false, expect.stringMatching(/^#\/tasks\?task=\d+$/)]);
    const nextWeek = await viewOf(d, '2026-11-15', '2026-11-21');
    expect(nextWeek.carriedOver).toEqual([]);
  });

  it('birthdays and important dates come from Family\'s own date rules; no birth year or age is carried', async () => {
    const { d, samId, jo } = await household();
    await createDate({ dateKind: 'anniversary', label: 'Anniversary', monthDay: '11-13', year: 2011, memberId: undefined, status: 'active' }, d);
    await createDate({ dateKind: 'other', label: 'Jo\'s day', monthDay: '11-10', memberId: (await loadMembers(d)).find((m) => m.data!.contactId === jo)!.id, status: 'active' }, d);
    const v = await viewOf(d);
    const dates = entriesOf(v).filter((e) => e.kind === 'birthday' || e.kind === 'date');
    expect(dates.map((e) => [e.title, e.firstDay, e.kind])).toEqual([["Jo's day", '2026-11-10', 'date'], ["Sam Example's birthday", '2026-11-12', 'birthday'], ['Anniversary', '2026-11-13', 'date']]);
    expect(dates.find((e) => e.title === 'Anniversary')!.people).toEqual([]); // household-wide
    expect(dates.find((e) => e.title === "Jo's day")!.people.map((p) => p.name)).toEqual(['Jo Example']);
    expect(dates.find((e) => e.kind === 'birthday')!.link).toBe(`#/family/m/${samId}`);
    expect(scanText(v)).not.toMatch(/2015|2011|\bage\b/i); // ids are scrubbed first, so only real text can match
    // choosing one person keeps only that person's dates; a household-wide date is not theirs
    expect(titles(narrowFamilyView(v, [jo]))).toEqual(["Jo's day"]);
  });

  it('calendars switched off on this device are counted, never listed, and the preference is not changed', async () => {
    const { d, sam } = await household();
    const cal = await createCalendar('School', '#2f8f6b', d);
    await addEvent(d, 'School trip', '2026-11-11', { contactIds: [sam], calendarId: cal }, 9 * 60);
    await addEvent(d, 'Piano', '2026-11-11', { contactIds: [sam] }, 16 * 60);
    const vis = deselectAll();
    const before = JSON.stringify(vis);
    const v = await viewOf(d, '2026-11-08', '2026-11-14', [], vis);
    expect(titles(v)).not.toContain('School trip');
    expect(v.hiddenCount).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(vis)).toBe(before);
  });
});

describe('the owner view reconciles with today\'s Family overview', () => {
  it('same events, same people, same open Tasks and same dates for the same days', async () => {
    const { d, sam, robin, alex } = await household();
    await addEvent(d, 'Swim meet', '2026-11-11', { contactIds: [sam, robin] }, 10 * 60);
    await addEvent(d, 'Practice', '2026-11-03', { contactIds: [sam], recurrence: weekly }, 17 * 60);
    await addEvent(d, 'Piano', '2026-11-14', { contactIds: [alex] }, 16 * 60);
    await addEvent(d, 'Next week only', '2026-11-20', { contactIds: [alex] }, 16 * 60);
    await task(d, 'Sam form', [sam], { dueDate: '2026-11-10' });
    await task(d, 'Late', [robin], { dueDate: '2026-11-01' });
    await task(d, 'Undated', [sam]);
    await createDate({ dateKind: 'anniversary', label: 'Anniversary', monthDay: '11-13', year: 2011, memberId: undefined, status: 'active' }, d);
    const overview = await readHouseholdOverview(TODAY, ALL_ON, d);
    const from = TODAY;
    const to = addDays(TODAY, 6); // the overview's seven days
    const v = await viewOf(d, from, to);
    const entries = entriesOf(v);

    expect(v.people.map((p) => [p.memberId, p.contactId, p.name])).toEqual(overview.people.map((p) => [p.memberId, p.contactId, p.name]));
    expect(v.people.map((p) => p.colorId)).toEqual(overview.people.map((p) => memberColorId(p.color)));

    const eventKeys = entries.filter((e) => e.kind === 'event').map((e) => e.key).sort();
    expect(eventKeys).toEqual(overview.activities.items.map((a) => `e:${a.key}`).sort());
    for (const a of overview.activities.items) expect(entries.find((e) => e.key === `e:${a.key}`)!.people.map((p) => p.memberId)).toEqual(a.people.map((p) => p.memberId));

    const taskIds = entries.filter((e) => e.kind === 'task').map((e) => e.key).sort(); // entriesOf includes the carried-over ones
    expect(taskIds).toEqual(overview.tasks.items.filter((t) => t.when).map((t) => `t:${t.id}`).sort()); // the overview also lists the undated ones; the week has no day for them
    expect(overview.tasks.items.some((t) => !t.when)).toBe(true);

    const dateRows = entries.filter((e) => e.kind === 'birthday' || e.kind === 'date').map((e) => `${e.title}|${e.firstDay}`).sort();
    expect(dateRows).toEqual(overview.dates.filter((x) => x.date <= to).map((x) => `${x.title}|${x.date}`).sort());
  });

  it('a stored Birthday event on the same day as the birthday is shown once (as the birthday), as the overview does', async () => {
    const { d, sam } = await household();
    await addEvent(d, "Sam's birthday party", '2026-11-12', { contactIds: [sam] });
    const typed = await d.moduleRecords.filter((r) => r.module === 'calendar' && r.kind === 'event').first();
    await d.moduleRecords.update(typed!.id as number, { data: { ...(typed!.data as object), type: 'birthday' } } as never);
    const v = await viewOf(d);
    const overview = await readHouseholdOverview(TODAY, ALL_ON, d);
    expect(entriesOf(v).filter((e) => e.kind === 'event')).toHaveLength(0);
    expect(overview.activities.items).toHaveLength(0);
    expect(entriesOf(v).filter((e) => e.kind === 'birthday')).toHaveLength(1);
  });
});

describe('the audience contract fails closed', () => {
  it.each([['display'], ['Owner'], [''], [undefined], [null], [{ audience: 'owner' }], [42]])('refuses %j and reads nothing', async (aud) => {
    const { d } = await household();
    const where = vi.spyOn(d.moduleRecords, 'where');
    const get = vi.spyOn(d.contacts, 'bulkGet');
    await expect(readFamilyView(aud, { from: TODAY, to: TODAY, today: TODAY, visibility: ALL_ON }, d)).rejects.toBeInstanceOf(UnsupportedAudienceError);
    expect(where).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
    expect(() => buildFamilyView(aud, { members: [], dates: [], names: new Map(), events: [], layers: [], tasks: [], visibility: ALL_ON, today: TODAY, from: TODAY, to: TODAY })).toThrow(UnsupportedAudienceError);
  });
  it('only "owner" is served, and the view says so', async () => {
    const { d } = await household();
    expect((await viewOf(d)).audience).toBe('owner');
  });
});

describe('the output cannot carry Finance fields, free-form records or private details', () => {
  const walk = (v: unknown, path = '$', out: string[] = []): string[] => {
    if (Array.isArray(v)) v.forEach((x) => walk(x, `${path}[]`, out));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { out.push(`${path}.${k}`); walk(x, `${path}.${k}`, out); }
    return out;
  };

  it('the TypeScript types list exactly the allowed fields (a new field fails to compile here until it is reviewed)', () => {
    expectTypeOf<keyof FamilyEntry>().toEqualTypeOf<'key' | 'kind' | 'title' | 'firstDay' | 'lastDay' | 'allDay' | 'startTime' | 'endTime' | 'recurring' | 'status' | 'people' | 'link' | 'source'>();
    expectTypeOf<keyof FamilyViewPerson>().toEqualTypeOf<'memberId' | 'contactId' | 'name' | 'colorId'>();
    expectTypeOf<keyof FamilyView>().toEqualTypeOf<'audience' | 'from' | 'to' | 'people' | 'days' | 'carriedOver' | 'hiddenCount'>();
    expect([...FAMILY_ENTRY_KEYS].sort()).toEqual(['allDay', 'endTime', 'firstDay', 'key', 'kind', 'lastDay', 'link', 'people', 'recurring', 'source', 'startTime', 'status', 'title'].sort());
    expect([...FAMILY_PERSON_KEYS].sort()).toEqual(['colorId', 'contactId', 'memberId', 'name']);
  });

  it('a built view has only those keys, and none of the deliberately sensitive source text appears anywhere in it', async () => {
    const { d, sam, alex } = await household();
    await d.moduleRecords.update((await loadMembers(d))[0].id, { data: { ...((await loadMembers(d))[0].raw as object), note: 'SECRET-MEMBER-NOTE' } } as never);
    await d.contacts.update(sam, { phone: '555-0100-SECRET', email: 'secret@example.com', notes: 'SECRET-CONTACT-NOTE' } as never);
    await addEvent(d, 'Check-up', '2026-11-11', { contactIds: [sam] }, 9 * 60, { location: 'SECRET-PLACE 12 Elm St', notes: 'SECRET-EVENT-NOTE $48,000 account 12345678', reminders: [30] });
    await task(d, 'Pay school fee', [alex], { dueDate: '2026-11-12', notes: 'SECRET-TASK-NOTE routing 021000021', createdFrom: { module: 'ledger', id: 5, label: 'SECRET-ACCOUNT Checking ****4321' } });
    // other modules' records, deliberately full of money, that must never come near the view
    await repo<ModuleRecord>(d.moduleRecords).put({ module: 'bills', kind: 'obligation', data: { name: 'SECRET-BILL Mortgage', amountCents: 241_000, accountId: 7 } } as never);
    await repo<ModuleRecord>(d.moduleRecords).put({ module: 'projects', kind: 'project', data: { name: 'SECRET-PROJECT Kitchen $48,000', vendorContactIds: [sam], budgetCents: 4_800_000 } } as never);
    const v = await viewOf(d);
    const text = JSON.stringify(v);
    for (const secret of ['SECRET', '555-0100', 'secret@example.com', '48,000', '12345678', '021000021', '****4321', 'Elm St', '4800000', '241000']) expect(text, secret).not.toContain(secret);
    const keys = new Set(walk(v).map((p) => p.split('.').pop()!));
    const allowed = new Set([...FAMILY_ENTRY_KEYS, ...FAMILY_PERSON_KEYS, 'audience', 'from', 'to', 'people', 'days', 'carriedOver', 'hiddenCount', 'date', 'entries']);
    expect([...keys].filter((k) => !allowed.has(k as never))).toEqual([]);
    for (const e of entriesOf(v)) expect(Object.keys(e).sort()).toEqual([...FAMILY_ENTRY_KEYS].sort());
  });

  it('reading, narrowing and building never write to any table', async () => {
    const { d, sam } = await household();
    await addEvent(d, 'Swim meet', '2026-11-11', { contactIds: [sam] }, 10 * 60);
    await task(d, 'Form', [sam], { dueDate: '2026-11-10' });
    const before = await snapshot(d);
    const v = await viewOf(d);
    narrowFamilyView(v, [sam]);
    await viewOf(d, '2026-11-08', '2026-11-14', [sam]);
    expect(await snapshot(d)).toBe(before);
  });
});

describe('the neutral people reader used by Calendar, Tasks and Today agrees with Family', () => {
  it('its constants are Family\'s own (colors, roles, missing-Contact wording)', () => {
    expect(Object.entries(COLOR_ID_BY_HEX)).toEqual(COLORS.map((c) => [c.value, c.name.toLowerCase()]));
    expect([...KNOWN_ROLES]).toEqual([...ROLES]);
    expect(MISSING_CONTACT_NAME).toBe('Contact no longer exists');
  });

  it('chooses the same people as Family\'s household list on tricky rows, and reads only identity', async () => {
    const { d, sam, robin, samId, robinId } = await household();
    await setMemberStatus(robinId, 'past', d);
    await d.moduleRecords.add({ module: 'family', kind: 'member', createdAt: 9, updatedAt: 9, deletedAt: null, data: { contactId: sam, role: 'parent', status: 'active', color: '#c4398a' } } as never); // a duplicate for Sam: the oldest wins
    await d.moduleRecords.add({ module: 'family', kind: 'member', createdAt: 9, updatedAt: 9, deletedAt: null, data: { contactId: robin, role: 'wizard', status: 'active' } } as never);
    await d.moduleRecords.add({ module: 'family', kind: 'member', createdAt: 9, updatedAt: 9, deletedAt: null, data: { contactId: 12, role: 'child', status: 'active', color: 'not-a-color' } } as never);
    const ghost = await addContact(d, 'Ghost');
    await addMember(d, ghost, { color: '#6b7280' });
    await d.contacts.delete(ghost);
    const members = await loadMembers(d);
    const names = new Map((await d.contacts.toArray()).map((c) => [c.id as number, c.name]));
    const fam = householdPeople(members, names).map((p) => [p.memberId, p.contactId, p.name, memberColorId(p.color)]);
    const neutral = (await loadHouseholdPeople(d)).map((p) => [p.memberId, p.contactId, p.name, p.colorId]);
    expect(neutral).toEqual(fam);
    expect(neutral.find((p) => p[0] === samId)![3]).toBe('blue'); // not the duplicate's pink
    for (const p of await loadHouseholdPeople(d)) expect(Object.keys(p).sort()).toEqual(['colorId', 'contactId', 'memberId', 'name']);
    // pure form, with a Contact name map
    expect(peopleFromRows([], new Map())).toEqual([]);
  });

  it('peopleOf and lensMatches: once each, name order, ignore non-members; Everyone passes unassigned, a choice does not', async () => {
    const { d, sam, robin, coach } = await household();
    const by = peopleByContact(await loadHouseholdPeople(d));
    expect(peopleOf([sam, robin, sam, coach, 123456], by).map((p) => p.name)).toEqual(['Robin Example', 'Sam Example']);
    expect(peopleOf(undefined, by)).toEqual([]);
    expect(lensMatches([], [])).toBe(true);
    expect(lensMatches(undefined, [])).toBe(true);
    expect(lensMatches([], [sam])).toBe(false);
    expect(lensMatches([coach], [sam])).toBe(false);
    expect(lensMatches([sam, robin], [robin, 99])).toBe(true);
    expect(nameList([])).toBe('');
    expect(nameList(['A'])).toBe('A');
    expect(nameList(['A', 'B'])).toBe('A and B');
    expect(nameList(['A', 'B', 'C'])).toBe('A, B and C');
  });

  it('the Family dates and members are still readable by their own loaders (no data touched by the neutral reader)', async () => {
    const { d } = await household();
    const before = await snapshot(d);
    await loadHouseholdPeople(d);
    expect(await snapshot(d)).toBe(before);
    expect(await loadDates(d)).toEqual([]);
  });
});
