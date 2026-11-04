import { describe, expect, it } from 'vitest';
import { FinanceDB } from '../../db';
import { addDays } from '../../lib/dates';
import { occurrencesBetween } from '../../lib/schedule';
import type { RecurringRule } from '../../types';
import {
  createEvent, ensureCalendarSeed, loadEvents, loadLayers, newEventData, removeOccurrence, restoreEventData, saveEdit, snapshotEvent,
  createCalendar, deleteCalendar, markOccurrenceDone,
} from './data';
import { blankFields, FINANCE_ID, PERSONAL_ID, TASKS_ID, type EventFields } from './model';
import { geometry, occurrencesOf, statusOf, type Occurrence } from './occurrences';
import { describeRule, generateDates, nthWeekdayDate, normalizeRule, type Recurrence } from './recurrence';
import { editAll, editOccurrence, skipOccurrence, splitFollowing, type SeriesExtras } from './series';
import { localISO, msAt } from './time';

let n = 0;
const fresh = () => new FinanceDB(`test-cal-${n++}`);
const rule = (r: Partial<Recurrence> & Pick<Recurrence, 'freq'>): Recurrence => ({ interval: 1, end: { type: 'never' }, ...r });
const extras = (over: Partial<SeriesExtras> = {}): SeriesExtras => ({ calendarId: PERSONAL_ID, tagIds: [], contactIds: [], recurrence: null, trackDone: false, ...over });

describe('repeat rules', () => {
  it('daily and every-N-days', () => {
    expect(generateDates('2026-11-01', rule({ freq: 'daily' }), '2026-11-03', '2026-11-05')).toEqual(['2026-11-03', '2026-11-04', '2026-11-05']);
    expect(generateDates('2026-11-01', rule({ freq: 'daily', interval: 3 }), '2026-11-01', '2026-11-10')).toEqual(['2026-11-01', '2026-11-04', '2026-11-07', '2026-11-10']);
  });

  it('weekly on chosen weekdays, every 2 weeks', () => {
    // 2026-11-02 is a Monday. Mon + Wed + Fri.
    const r = rule({ freq: 'weekly', byWeekday: [1, 3, 5] });
    expect(generateDates('2026-11-02', r, '2026-11-02', '2026-11-08')).toEqual(['2026-11-02', '2026-11-04', '2026-11-06']);
    const r2 = rule({ freq: 'weekly', interval: 2, byWeekday: [1] });
    expect(generateDates('2026-11-02', r2, '2026-11-02', '2026-12-01')).toEqual(['2026-11-02', '2026-11-16', '2026-11-30']);
    // no weekday chosen means the start date's weekday
    expect(generateDates('2026-11-04', rule({ freq: 'weekly' }), '2026-11-04', '2026-11-20')).toEqual(['2026-11-04', '2026-11-11', '2026-11-18']);
  });

  it('monthly by date clamps to the last day of shorter months, like Ledger', () => {
    const got = generateDates('2026-01-31', rule({ freq: 'monthly' }), '2026-01-01', '2026-05-31');
    expect(got).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31']);
    // identical to what Ledger's own scheduled items do for a monthly rule starting on the 31st
    const ledgerRule = { frequency: 'monthly', startDate: '2026-01-31' } as RecurringRule;
    expect(occurrencesBetween(ledgerRule, '2026-01-01', '2026-05-31')).toEqual(got);
    expect(generateDates('2028-01-31', rule({ freq: 'monthly' }), '2028-02-01', '2028-02-29')).toEqual(['2028-02-29']);
  });

  it('monthly on the 2nd Tuesday, and on the last Friday', () => {
    expect(nthWeekdayDate(2026, 11, 2, 2)).toBe('2026-11-10');
    expect(nthWeekdayDate(2026, 11, 5, -1)).toBe('2026-11-27');
    const r = rule({ freq: 'monthly', monthly: 'nth' });
    expect(generateDates('2026-11-10', r, '2026-11-01', '2027-02-28')).toEqual(['2026-11-10', '2026-12-08', '2027-01-12', '2027-02-09']);
    const last = rule({ freq: 'monthly', monthly: 'last' });
    expect(generateDates('2026-11-27', last, '2026-11-01', '2027-01-31')).toEqual(['2026-11-27', '2026-12-25', '2027-01-29']);
  });

  it('yearly keeps the date, and a Feb 29 start lands on Feb 28 in other years', () => {
    expect(generateDates('2026-11-04', rule({ freq: 'yearly' }), '2026-01-01', '2029-01-01')).toEqual(['2026-11-04', '2027-11-04', '2028-11-04']);
    expect(generateDates('2028-02-29', rule({ freq: 'yearly' }), '2028-01-01', '2031-12-31')).toEqual(['2028-02-29', '2029-02-28', '2030-02-28', '2031-02-28']);
  });

  it('ends after N times, on a date, or never; counts include the start even when asked from later', () => {
    expect(generateDates('2026-11-01', rule({ freq: 'daily', end: { type: 'count', count: 3 } }), '2026-11-01', '2027-01-01')).toEqual(['2026-11-01', '2026-11-02', '2026-11-03']);
    expect(generateDates('2026-11-01', rule({ freq: 'daily', end: { type: 'count', count: 3 } }), '2026-11-03', '2027-01-01')).toEqual(['2026-11-03']);
    expect(generateDates('2026-11-01', rule({ freq: 'weekly', end: { type: 'until', date: '2026-11-15' } }), '2026-11-01', '2027-01-01')).toEqual(['2026-11-01', '2026-11-08', '2026-11-15']);
    // far in the future is quick and right
    expect(generateDates('2020-01-01', rule({ freq: 'daily' }), '2026-11-04', '2026-11-04')).toEqual(['2026-11-04']);
    expect(generateDates('2020-01-06', rule({ freq: 'weekly', interval: 2 }), '2026-11-01', '2026-11-30')).toEqual(['2026-11-02', '2026-11-16', '2026-11-30']);
  });

  it('describes a rule in plain words and rejects junk', () => {
    expect(describeRule(rule({ freq: 'weekly', interval: 2, byWeekday: [1, 3] }), '2026-11-02')).toBe('Every 2 weeks on Mon, Wed');
    expect(describeRule(rule({ freq: 'monthly', monthly: 'nth' }), '2026-11-10')).toBe('Every month on the 2nd Tuesday');
    expect(describeRule(rule({ freq: 'yearly', end: { type: 'count', count: 5 } }), '2026-11-10')).toBe('Every year, 5 times');
    expect(normalizeRule({ freq: 'hourly' as never })).toBeNull();
    expect(normalizeRule({ freq: 'daily', interval: -4 })?.interval).toBe(1);
  });
});

describe('all-day items never shift; timed items follow the device clock', () => {
  const allDay: EventFields = { ...blankFields('2026-11-04'), title: 'Pay rent', allDay: true };

  it('an all-day date is the same text in every time zone', () => {
    const original = process.env.TZ;
    try {
      for (const tz of ['Pacific/Honolulu', 'America/Los_Angeles', 'UTC', 'Europe/London', 'Asia/Tokyo', 'Pacific/Auckland', 'Pacific/Kiritimati']) {
        process.env.TZ = tz;
        const ev = { id: 1, createdAt: 0, updatedAt: 0, data: { ...newEventData(allDay, extras({ recurrence: rule({ freq: 'monthly' }) })) } };
        const occ = occurrencesOf(ev, '2026-11-01', '2027-02-28');
        expect(occ.map((o) => o.firstDay), tz).toEqual(['2026-11-04', '2026-12-04', '2027-01-04', '2027-02-04']);
        expect(occ.every((o) => o.firstDay === o.lastDay), tz).toBe(true);
      }
    } finally {
      if (original === undefined) delete process.env.TZ; else process.env.TZ = original;
    }
  });

  it('a timed event is one moment: the same instant reads as a different local time in another zone', () => {
    const original = process.env.TZ;
    try {
      const instant = Date.UTC(2026, 10, 4, 18, 0); // 18:00 UTC
      process.env.TZ = 'UTC';
      expect(localISO(instant)).toBe('2026-11-04');
      process.env.TZ = 'Pacific/Auckland'; // 13 hours ahead: already the next morning
      expect(localISO(instant)).toBe('2026-11-05');
      process.env.TZ = 'America/Los_Angeles';
      expect(new Date(instant).getHours()).toBe(10);
    } finally {
      if (original === undefined) delete process.env.TZ; else process.env.TZ = original;
    }
  });

  it('an item that ends exactly at midnight belongs to the day before; multi-day all-day spans include the last day', () => {
    const g = geometry({ ...blankFields('2026-11-04', msAt('2026-11-04', 22 * 60)), endAt: msAt('2026-11-05', 0) });
    expect(g.lastDay).toBe('2026-11-04');
    expect(geometry({ ...allDay, startDate: '2026-11-04', endDate: '2026-11-06' }).lastDay).toBe('2026-11-06');
  });
});

describe('expanding events', () => {
  const timed = (startDate: string, h = 10): EventFields => ({ ...blankFields(startDate, msAt(startDate, h * 60)), title: 'Standup' });
  const rec = (data: Partial<ReturnType<typeof newEventData>>) => ({ id: 7, createdAt: 0, updatedAt: 0, data: { ...newEventData(timed('2026-11-02'), extras({ recurrence: rule({ freq: 'weekly' }) })), ...data } });

  it('weekly timed events keep the same clock time, skipped dates vanish, edited dates change', () => {
    const base = rec({});
    const got = occurrencesOf(base, '2026-11-01', '2026-11-30');
    expect(got.map((o) => o.key)).toEqual(['2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23', '2026-11-30']);
    expect(got.every((o) => new Date(o.startMs).getHours() === 10)).toBe(true);
    const skipped = occurrencesOf({ ...base, data: skipOccurrence(base.data, '2026-11-09') }, '2026-11-01', '2026-11-30');
    expect(skipped.map((o) => o.key)).not.toContain('2026-11-09');
    const edited = editOccurrence(base.data, '2026-11-16', { ...timed('2026-11-16'), title: 'Standup (moved)', startAt: msAt('2026-11-17', 9 * 60), endAt: msAt('2026-11-17', 10 * 60) });
    const moved = occurrencesOf({ ...base, data: edited }, '2026-11-15', '2026-11-22');
    expect(moved).toHaveLength(1);
    expect(moved[0]).toMatchObject({ key: '2026-11-16', title: 'Standup (moved)', firstDay: '2026-11-17' });
    expect(Object.keys(edited.overrides['2026-11-16']).sort()).toEqual(['endAt', 'startAt', 'title'].concat(['endDate', 'startDate']).filter((k) => k in edited.overrides['2026-11-16']).sort());
  });

  it('a long event that began before the range still shows', () => {
    const trip: EventFields = { ...blankFields('2026-11-28'), allDay: true, endDate: '2026-12-03', title: 'Trip' };
    const ev = { id: 8, createdAt: 0, updatedAt: 0, data: newEventData(trip, extras()) };
    expect(occurrencesOf(ev, '2026-12-01', '2026-12-07')).toHaveLength(1);
    expect(occurrencesOf(ev, '2026-12-04', '2026-12-07')).toHaveLength(0);
  });

  it('reminders and overdue are worked out from the clock', () => {
    const start = msAt('2026-11-04', 10 * 60);
    const o = { reminders: [60], startMs: start, endMs: start + 3600_000, trackDone: true, done: false };
    expect(statusOf(o, start - 90 * 60000)).toEqual({ soon: false, overdue: false });
    expect(statusOf(o, start - 30 * 60000)).toEqual({ soon: true, overdue: false });
    expect(statusOf(o, start + 2 * 3600_000)).toEqual({ soon: false, overdue: true });
    expect(statusOf({ ...o, done: true }, start + 2 * 3600_000).overdue).toBe(false);
  });
});

describe('editing a repeating event', () => {
  const start = (d: string): EventFields => ({ ...blankFields(d, msAt(d, 9 * 60)), title: 'Gym' });
  const master = newEventData(start('2026-11-02'), extras({ recurrence: rule({ freq: 'weekly', end: { type: 'count', count: 10 } }) }));
  const occ = (key: string): Occurrence => occurrencesOf({ id: 1, createdAt: 0, updatedAt: 0, data: master }, key, key)[0];

  it('this and following ends the old series the day before and starts a new one with the rest of the count', () => {
    const edited = { ...start('2026-11-16'), title: 'Yoga' };
    const r = splitFollowing(master, '2026-11-16', edited, extras({ recurrence: master.recurrence }))!;
    expect(r.old.recurrence?.end).toEqual({ type: 'until', date: '2026-11-15' });
    expect(generateDates('2026-11-02', r.old.recurrence!, '2026-11-01', '2027-06-01')).toEqual(['2026-11-02', '2026-11-09']);
    expect(r.next.title).toBe('Yoga');
    expect(r.next.recurrence?.end).toEqual({ type: 'count', count: 8 });
    expect(generateDates('2026-11-16', r.next.recurrence!, '2026-11-01', '2027-06-01')).toHaveLength(8);
    // 2 + 8 = the original 10, no more, no fewer
    expect(splitFollowing(master, '2026-11-02', edited, extras({ recurrence: master.recurrence }))).toBeNull(); // first occurrence = edit all
  });

  it('all events: moving one occurrence by two days moves the whole series by two days and keeps the time', () => {
    const edited = { ...start('2026-11-11'), title: 'Gym (new name)' }; // the 11/9 occurrence moved to 11/11
    const out = editAll(master, occ('2026-11-09'), edited, extras({ recurrence: master.recurrence }));
    expect(new Date(out.startAt).getHours()).toBe(9);
    expect(localISO(out.startAt)).toBe('2026-11-04');
    expect(out.title).toBe('Gym (new name)');
    expect(out.skipped).toEqual([]);
  });

  it('delete one occurrence / this and following / all', async () => {
    const d = fresh();
    const id = await createEvent(master, d);
    const first = (await loadEvents(d)).map((e) => e.id);
    expect(first).toEqual([id]);
    const o = occurrencesOf((await loadEvents(d))[0], '2026-11-09', '2026-11-09')[0];
    await removeOccurrence(o, 'one', d);
    expect((await loadEvents(d))[0].data.skipped).toEqual(['2026-11-09']);
    await removeOccurrence(occurrencesOf((await loadEvents(d))[0], '2026-11-16', '2026-11-16')[0], 'following', d);
    expect((await loadEvents(d))[0].data.recurrence?.end).toEqual({ type: 'until', date: '2026-11-15' });
    await removeOccurrence(occurrencesOf((await loadEvents(d))[0], '2026-11-02', '2026-11-02')[0], 'all', d);
    expect(await loadEvents(d)).toEqual([]);
    expect((await d.moduleRecords.get(id))?.deletedAt).toBeGreaterThan(0); // soft delete: Undo and sync both work from this
  });

  it('saving a "this and following" edit stores two events, and Undo can put the old one back', async () => {
    const d = fresh();
    const id = await createEvent(master, d);
    const before = await snapshotEvent(id, d);
    const o = occurrencesOf((await loadEvents(d))[0], '2026-11-16', '2026-11-16')[0];
    const newId = await saveEdit(o, { ...start('2026-11-16'), title: 'Yoga' }, extras({ recurrence: master.recurrence }), 'following', d);
    expect(newId).not.toBe(id);
    expect((await loadEvents(d)).map((e) => e.data.title).sort()).toEqual(['Gym', 'Yoga']);
    await restoreEventData(id, before, d);
    await restoreEventData(newId, null, d); // restore() of a live record changes nothing
    const all = await loadEvents(d);
    expect(all.find((e) => e.id === id)!.data.recurrence?.end).toEqual({ type: 'count', count: 10 });
  });

  it('marking an occurrence done is remembered per occurrence', async () => {
    const d = fresh();
    await createEvent({ ...master, trackDone: true }, d);
    const ev = (await loadEvents(d))[0];
    const o = occurrencesOf(ev, '2026-11-09', '2026-11-09')[0];
    await markOccurrenceDone(o, true, d);
    const after = occurrencesOf((await loadEvents(d))[0], '2026-11-02', '2026-11-16');
    expect(after.map((x) => x.done)).toEqual([false, true, false]);
  });
});

describe('calendars (layers)', () => {
  it('seeds Personal, Finance and Tasks once, even when run twice at the same time', async () => {
    const d = fresh();
    await Promise.all([ensureCalendarSeed(d), ensureCalendarSeed(d)]);
    await ensureCalendarSeed(d);
    const layers = await loadLayers(d);
    expect(layers.map((l) => [l.id, l.name, l.sourceType])).toEqual([
      [PERSONAL_ID, 'Personal', 'local'], [FINANCE_ID, 'Finance', 'derived'], [TASKS_ID, 'Tasks', 'derived'],
    ].sort((a, b) => String(a[1]).localeCompare(String(b[1]))));
    expect(layers.find((l) => l.id === FINANCE_ID)?.providerId).toBe('ledger');
  });

  it('deleting a calendar can move its events to Personal or delete them; built-ins cannot be deleted', async () => {
    const d = fresh();
    await ensureCalendarSeed(d);
    const work = await createCalendar('Work', '#2f8f6b', d);
    const ev = newEventData({ ...blankFields('2026-11-04'), title: 'Review' }, extras({ calendarId: work }));
    await createEvent(ev, d);
    expect(await deleteCalendar(PERSONAL_ID, 'delete', PERSONAL_ID, d)).toBe(0);
    expect(await deleteCalendar(work, 'move', PERSONAL_ID, d)).toBe(1);
    expect((await loadEvents(d))[0].data.calendarId).toBe(PERSONAL_ID);
    const other = await createCalendar('Other', '#c0562f', d);
    await createEvent(newEventData({ ...blankFields('2026-11-05'), title: 'Gone' }, extras({ calendarId: other })), d);
    expect(await deleteCalendar(other, 'delete', PERSONAL_ID, d)).toBe(1);
    expect((await loadEvents(d)).map((e) => e.data.title)).toEqual(['Review']);
  });

  it('days between helper used by the series code agrees with addDays', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
  });
});
