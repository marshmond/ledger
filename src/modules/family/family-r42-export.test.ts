import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FinanceDB } from '../../db';
import { createStore, repo } from '../../core/store';
import { scanText } from '../../lib/leakTestkit';
import type { ModuleRecord } from '../../core/entities';
import { createCalendar, createEvent, ensureCalendarSeed, loadEvents, newEventData } from '../calendar/data';
import { ALL_ON, deselectAll } from '../calendar/layerVisibility';
import { blankFields, PERSONAL_ID, type EventFields } from '../calendar/model';
import type { SeriesExtras } from '../calendar/series';
import { msAt } from '../calendar/time';
import { createTask } from '../tasks/data';
import { blankTask } from '../tasks/model';
import { createMember } from './data';
import { createDate } from './dateData';
import { EXPORT_DAYS, buildFamilyIcs, readFamilyIcs } from './familyIcs';

/** R4.2 Family-only .ics: what is in it, what can never get in, and that making it changes nothing. Invented names, dates and amounts only. */
let n = 0;
const fresh = () => new FinanceDB(`test-family-r42-ics-${n++}`);
const TODAY = '2026-11-09';
const NOW = '2026-11-09T12:00:00.000Z';
const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }; };
beforeEach(() => { vi.stubGlobal('localStorage', mem()); });

const weekly = { freq: 'weekly', interval: 1, end: { type: 'never' } } as const;
const addContact = (d: FinanceDB, name: string) => createStore(d).shared.contacts.put({ name } as never);
const addMember = async (d: FinanceDB, contactId: number, over: object = {}) => (await createMember({ contact: { mode: 'existing', contactId }, fields: { role: 'child', status: 'active', ...over } as never }, d, 2026)).id;
const extras = (over: Partial<SeriesExtras> = {}): SeriesExtras => ({ calendarId: PERSONAL_ID, tagIds: [], contactIds: [], recurrence: null, trackDone: false, ...over });
const addEvent = (d: FinanceDB, title: string, date: string, over: Partial<SeriesExtras> = {}, minutes?: number, f: Partial<EventFields> = {}) =>
  createEvent(newEventData({ ...(minutes === undefined ? blankFields(date) : { ...blankFields(date, msAt(date, minutes)), startDate: date, endDate: date }), title, ...f }, extras(over)), d);
const snapshot = async (d: FinanceDB) => JSON.stringify(await Promise.all(d.tables.map(async (t) => [t.name, await t.toArray()])));
const unfold = (t: string) => t.replace(/\r\n[ ]/g, '').split('\r\n').filter(Boolean);
const events = (t: string) => { const out: string[][] = []; let cur: string[] | null = null; for (const l of unfold(t)) { if (l === 'BEGIN:VEVENT') cur = []; else if (l === 'END:VEVENT') { out.push(cur!); cur = null; } else cur?.push(l); } return out; };
const summaries = (t: string) => events(t).map((e) => e.find((l) => l.startsWith('SUMMARY:'))!.slice(8));

async function setup() {
  const d = fresh();
  await ensureCalendarSeed(d);
  const [sam, robin, alex, coach] = [await addContact(d, 'Sam Example'), await addContact(d, 'Robin Example'), await addContact(d, 'Alex Example'), await addContact(d, 'Coach Example')];
  await addMember(d, sam, { birthMonthDay: '11-12', birthYear: 2015, color: '#4a7bd0' });
  await addMember(d, robin);
  await addMember(d, alex, { role: 'parent' });
  return { d, sam, robin, alex, coach };
}
const run = (d: FinanceDB, selected: number[] = [], vis = ALL_ON) => readFamilyIcs({ today: TODAY, visibility: vis, selected }, d);

describe('what the family file contains', () => {
  it('a shared event, a repeating event, a birthday and an important date: right dates, all-day rules, repeat rule and stable ids', async () => {
    const { d, sam, robin } = await setup();
    const swim = await addEvent(d, 'Swim meet', '2026-11-11', { contactIds: [sam, robin] }, 10 * 60);
    const practice = await addEvent(d, 'Practice', '2026-11-04', { contactIds: [sam], recurrence: weekly }, 17 * 60);
    const camp = await addEvent(d, 'Camp', '2026-11-14', { contactIds: [robin] });
    await createDate({ dateKind: 'anniversary', label: 'Anniversary', monthDay: '12-02', year: 2011, memberId: undefined, status: 'active' }, d);
    const f = await run(d);
    const ev = events(f.text);
    expect(f.eventCount).toBe(3);
    expect(f.dateCount).toBe(2); // Sam's birthday and the anniversary
    expect(f.text.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true);
    expect(f.text).toContain('X-WR-CALNAME:Family');
    expect(f.text.endsWith('END:VCALENDAR\r\n')).toBe(true);

    const find = (title: string) => ev.find((e) => e.includes(`SUMMARY:${title}`))!;
    expect(find('Swim meet')).toContain(`UID:cal-${swim}@ledger.local`);
    expect(find('Swim meet')).toContain('DESCRIPTION:For: Robin Example and Sam Example');
    expect(find('Swim meet').some((l) => /^DTSTART:\d{8}T\d{6}Z$/.test(l))).toBe(true); // a one-off timed event: an absolute time
    expect(find('Practice')).toContain(`UID:cal-${practice}@ledger.local`);
    expect(find('Practice').some((l) => l.startsWith('RRULE:FREQ=WEEKLY'))).toBe(true); // written once, with its rule
    expect(find('Practice').some((l) => /^DTSTART:\d{8}T170000$/.test(l))).toBe(true); // a repeating timed event: floating local time, 17:00 stays 17:00
    expect(ev.filter((e) => e.includes('SUMMARY:Practice'))).toHaveLength(1);
    expect(find('Camp')).toEqual(expect.arrayContaining([`UID:cal-${camp}@ledger.local`, 'DTSTART;VALUE=DATE:20261114', 'DTEND;VALUE=DATE:20261115'])); // all-day: plain dates, end the day after
    const bday = find("Sam Example's birthday");
    expect(bday).toEqual(expect.arrayContaining(['DTSTART;VALUE=DATE:20261112', 'DTEND;VALUE=DATE:20261113']));
    expect(bday.find((l) => l.startsWith('UID:'))).toMatch(/^UID:family-birthday-\d+-2026-11-12@ledger\.local$/);
    expect(find('Anniversary')).toContain('DTSTART;VALUE=DATE:20261202');
    expect(scanText(f.text)).not.toMatch(/2015|2011/); // no birth year, no first year (ids scrubbed first, so only real text can match)
  });

  it('escapes what the format needs (comma, semicolon, backslash, new line) and folds long lines', async () => {
    const { d, sam } = await setup();
    await addEvent(d, 'Pizza, games; and a \\ slash\nsecond line ' + 'long '.repeat(30), '2026-11-13', { contactIds: [sam] });
    const t = (await run(d)).text;
    const raw = t.split('\r\n').find((l) => l.startsWith('SUMMARY:Pizza'))!;
    expect(raw).toContain('Pizza\\, games\\; and a \\\\ slash\\nsecond line');
    for (const line of t.split('\r\n')) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(unfold(t).find((l) => l.startsWith('SUMMARY:'))).toMatch(/long long $/);
  });

  it('keeps only title, time and who it is for: location, notes, reminders, tags and priority are removed, also from a one-date change', async () => {
    const { d, sam } = await setup();
    const id = await addEvent(d, 'Check-up', '2026-11-11', { contactIds: [sam], recurrence: weekly }, 9 * 60, { location: 'SECRET-PLACE 12 Elm St', notes: 'SECRET-NOTE $48,000', reminders: [30], priority: 'high' });
    const ev = (await loadEvents(d)).find((e) => e.id === id)!;
    await d.moduleRecords.update(id, { data: { ...(ev.data as object), overrides: { '2026-11-18': { title: 'Check-up (moved)', notes: 'SECRET-OVERRIDE-NOTE', location: 'SECRET-OVERRIDE-PLACE', reminders: [10] } } } } as never);
    const t = (await run(d)).text;
    for (const s of ['SECRET', 'Elm St', '48,000', 'LOCATION', 'VALARM', 'TRIGGER', 'CATEGORIES']) expect(t, s).not.toContain(s);
    expect(t).toContain('Check-up (moved)'); // the moved date keeps its own title
    expect(t).toContain('RECURRENCE-ID');
    expect(t).toMatch(/DESCRIPTION:For: Sam Example/);
  });

  it('a stored event is written with the Calendar export\'s own id, so a later full export does not duplicate it', async () => {
    const { d, sam } = await setup();
    const id = await addEvent(d, 'Swim meet', '2026-11-11', { contactIds: [sam] }, 10 * 60);
    expect(events((await run(d)).text)[0]).toContain(`UID:cal-${id}@ledger.local`);
  });

  it('is repeatable: the same data gives the same file', async () => {
    const { d, sam } = await setup();
    await addEvent(d, 'Swim meet', '2026-11-11', { contactIds: [sam] }, 10 * 60);
    const a = await buildFamilyIcs({ members: [], dates: [], names: new Map(), events: [], layers: [], visibility: ALL_ON, today: TODAY, nowIso: NOW });
    expect(a.eventCount + a.dateCount).toBe(0); // nobody in the household: nothing
    const x = (await run(d)).text.replace(/DTSTAMP:\S+/g, '');
    const y = (await run(d)).text.replace(/DTSTAMP:\S+/g, '');
    expect(x).toBe(y);
  });
});

describe('what is left out', () => {
  it('events naming nobody, only a non-member, or only past dates; a series that ended; and anything beyond twelve months', async () => {
    const { d, sam, coach } = await setup();
    await addEvent(d, 'Nobody named', '2026-11-11', {}, 9 * 60);
    await addEvent(d, 'Coach only', '2026-11-11', { contactIds: [coach] }, 9 * 60);
    await addEvent(d, 'Last month', '2026-10-01', { contactIds: [sam] }, 9 * 60);
    await addEvent(d, 'Ended series', '2026-09-01', { contactIds: [sam], recurrence: { freq: 'weekly', interval: 1, end: { type: 'count', count: 3 } } }, 9 * 60);
    await addEvent(d, 'Far future', `${Number(TODAY.slice(0, 4)) + 3}-01-05`, { contactIds: [sam] }, 9 * 60);
    await addEvent(d, 'Kept', '2026-11-12', { contactIds: [sam] }, 9 * 60);
    expect(summaries((await run(d)).text).filter((s) => !s.includes('birthday'))).toEqual(['Kept']);
    expect(EXPORT_DAYS).toBe(365);
  });

  it('a calendar switched off on this device is left out, and the switch is left as it was', async () => {
    const { d, sam } = await setup();
    const cal = await createCalendar('School', '#2f8f6b', d);
    await addEvent(d, 'School trip', '2026-11-12', { contactIds: [sam], calendarId: cal }, 9 * 60);
    await addEvent(d, 'Piano', '2026-11-12', { contactIds: [sam] }, 10 * 60);
    expect(summaries((await run(d)).text)).toEqual(expect.arrayContaining(['School trip', 'Piano']));
    const vis = deselectAll();
    const before = JSON.stringify(vis);
    expect(summaries((await run(d, [], vis)).text).filter((s) => s === 'School trip' || s === 'Piano')).toEqual([]);
    expect(JSON.stringify(vis)).toBe(before);
  });

  it('choosing people narrows the file the same way it narrows the page', async () => {
    const { d, sam, robin, alex } = await setup();
    await addEvent(d, 'Swim meet', '2026-11-11', { contactIds: [sam, robin] }, 10 * 60);
    await addEvent(d, 'Piano', '2026-11-12', { contactIds: [alex] }, 16 * 60);
    expect(summaries((await run(d, [robin])).text)).toEqual(['Swim meet']);
    expect(summaries((await run(d, [alex])).text)).toEqual(['Piano']);
    expect(summaries((await run(d, [sam, alex])).text).sort()).toEqual(["Sam Example's birthday", 'Piano', 'Swim meet'].sort());
  });

  it('a birthday that a stored Birthday event covers is written once', async () => {
    const { d, sam } = await setup();
    const id = await addEvent(d, "Sam's birthday", '2026-11-12', { contactIds: [sam] });
    await d.moduleRecords.update(id, { data: { ...((await d.moduleRecords.get(id))!.data as object), type: 'birthday' } } as never);
    const t = (await run(d)).text;
    expect(summaries(t).filter((s) => /birthday/i.test(s))).toEqual(["Sam's birthday"]);
  });

  it('a birthday whose "leave off my Calendar" switch is off is not written', async () => {
    const d = fresh();
    await ensureCalendarSeed(d);
    const sam = await addContact(d, 'Sam Example');
    await addMember(d, sam, { birthMonthDay: '11-12', birthdayOnCalendar: false });
    expect(summaries((await run(d)).text)).toEqual([]);
  });
});

describe('Finance, Bills, Projects and Tasks cannot get into the family file', () => {
  it('deliberately sensitive records in those modules, some even naming a family member, are not in the file or the counts', async () => {
    const { d, sam, alex } = await setup();
    await addEvent(d, 'Swim meet', '2026-11-11', { contactIds: [sam] }, 10 * 60);
    const put = (module: string, kind: string, data: object) => repo<ModuleRecord>(d.moduleRecords).put({ module, kind, data } as never);
    await put('bills', 'obligation', { name: 'SECRET-BILL Mortgage', amountCents: 241_000, accountId: 7, expectedDate: '2026-11-11', contactIds: [sam] });
    await put('projects', 'project', { name: 'SECRET-PROJECT Kitchen $48,000', vendorContactIds: [sam], budgetCents: 4_800_000, startDate: '2026-11-12' });
    await put('services', 'arrangement', { name: 'SECRET-SERVICE Lawn care $90', providerContactId: sam, nextDate: '2026-11-13' });
    await put('assets', 'warranty', { name: 'SECRET-WARRANTY Furnace', endDate: '2026-11-14' });
    await d.moduleRecords.add({ module: 'ledger', kind: 'scheduled', createdAt: 1, updatedAt: 1, deletedAt: null, data: { payee: 'SECRET-PAYEE', amountCents: 123_456, nextDate: '2026-11-11', contactIds: [sam] } } as never);
    await createTask(blankTask({ title: 'SECRET-TASK Pay tax $3,100', contactIds: [alex, sam], dueDate: '2026-11-12', notes: 'SECRET-TASK-NOTE' }), [], d);
    const f = await run(d);
    for (const s of ['SECRET', 'Mortgage', 'Kitchen', 'Lawn', 'Furnace', '48,000', '241000', '123456', '3,100']) expect(f.text, s).not.toContain(s);
    expect(summaries(f.text).sort()).toEqual(["Sam Example's birthday", 'Swim meet']);
    expect(f.eventCount).toBe(1);
    expect(f.dateCount).toBe(1);
    // the only event ids in the file are the Calendar's own
    expect(unfold(f.text).filter((l) => l.startsWith('UID:')).every((l) => /^UID:(cal-\d+|family-(birthday|date)-\d+-\d{4}-\d{2}-\d{2})@ledger\.local$/.test(l))).toBe(true);
  });

  it('making the file writes nothing and cannot read any table but the Calendar, Family and Contact records', async () => {
    const { d, sam } = await setup();
    await addEvent(d, 'Swim meet', '2026-11-11', { contactIds: [sam] }, 10 * 60);
    const before = await snapshot(d);
    // Every other table (accounts, transactions, scheduled payments, holdings, lots, tax data ...) is made to throw if it is read at all.
    const allowed = new Set(['moduleRecords', 'contacts']);
    const methods = ['where', 'toArray', 'get', 'bulkGet', 'filter', 'orderBy', 'toCollection', 'count', 'each', 'limit', 'offset', 'reverse'];
    const saved: [Record<string, unknown>, string, unknown][] = [];
    const blocked: string[] = [];
    for (const t of d.tables) {
      if (allowed.has(t.name)) continue;
      blocked.push(t.name);
      for (const m of methods) { saved.push([t as unknown as Record<string, unknown>, m, (t as unknown as Record<string, unknown>)[m]]); (t as unknown as Record<string, unknown>)[m] = () => { throw new Error('the family file read the table ' + t.name); }; }
    }
    expect(blocked).toEqual(expect.arrayContaining(['accounts', 'txns', 'taxLots']));
    try { expect(summaries((await run(d)).text)).toContain('Swim meet'); } finally { for (const [o, m, v] of saved) o[m] = v; }
    expect(await snapshot(d)).toBe(before);
  });
});
