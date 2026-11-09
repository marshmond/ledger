import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateDates, type Recurrence } from '../../core/recurrence';
import { birthdayTitle } from '../calendar/eventTypes';
import { asDate, cleanDate, toStoredDate, validateDate, type DateFields } from './dateModel';
import { dateInYear, datesInRange, isIsoDate, MAX_SPAN_YEARS, nextOccurrence } from './calendarDates';
import { birthdayMarkerTitle, birthdaySubjects, buildFamilyItems } from './dueProvider';
import { asMember } from './model';
import { upcomingRows } from './upcoming';

/** F2 pure date logic: February 29, window edges, the important-date record and the dates list. Names and dates are invented. */
const yearly: Recurrence = { freq: 'yearly', interval: 1, end: { type: 'never' } };
const member = (id: number, data: Record<string, unknown>) => asMember({ id, module: 'family', kind: 'member', data, createdAt: id, updatedAt: id, deletedAt: null } as never, 2026);
const dateRow = (id: number, data: Record<string, unknown>) => asDate({ id, module: 'family', kind: 'date', data, createdAt: id, updatedAt: id, deletedAt: null } as never, 2026);
const base = { role: 'child', status: 'active' };

describe('where a yearly month-day falls', () => {
  it('ordinary days stay on their day in every kind of year', () => {
    expect(dateInYear('05-14', 2026)).toBe('2026-05-14');
    expect(dateInYear('12-31', 2027)).toBe('2027-12-31');
    expect(dateInYear('01-01', 2028)).toBe('2028-01-01');
  });

  it('29 February: the 29th in a leap year, the 28th in a year without one (century rules included)', () => {
    expect(dateInYear('02-29', 2024)).toBe('2024-02-29');
    expect(dateInYear('02-29', 2025)).toBe('2025-02-28');
    expect(dateInYear('02-29', 2100)).toBe('2100-02-28'); // divisible by 100, not by 400
    expect(dateInYear('02-29', 2000)).toBe('2000-02-29'); // divisible by 400
  });

  it('gives nothing for an invalid month-day or year', () => {
    for (const bad of ['', '2-3', '02-30', '13-01', '00-10', '04-31', 'ab-cd']) expect(dateInYear(bad, 2026)).toBe('');
    expect(dateInYear('05-14', 0)).toBe('');
    expect(dateInYear('05-14', 1.5)).toBe('');
  });

  it('FOLLOWS THE CALENDAR: a yearly event started on 29 February lands on exactly the same days as Family would put it', () => {
    const calendar = generateDates('2020-02-29', yearly, '2020-01-01', '2033-12-31');
    const family = datesInRange('02-29', '2020-01-01', '2033-12-31');
    expect(family).toEqual(calendar);
    expect(calendar.slice(0, 5)).toEqual(['2020-02-29', '2021-02-28', '2022-02-28', '2023-02-28', '2024-02-29']);
  });

  it('the same for ordinary days, so a stored Birthday event and the Family marker agree', () => {
    expect(datesInRange('05-14', '2024-01-01', '2030-12-31')).toEqual(generateDates('2019-05-14', yearly, '2024-01-01', '2030-12-31'));
  });
});

describe('windows', () => {
  it('includes both ends and nothing outside', () => {
    expect(datesInRange('05-14', '2026-05-14', '2026-05-14')).toEqual(['2026-05-14']);
    expect(datesInRange('05-14', '2026-05-15', '2027-05-13')).toEqual([]);
    expect(datesInRange('05-14', '2026-05-15', '2027-05-14')).toEqual(['2027-05-14']);
  });

  it('crosses the year end in both directions (December to January)', () => {
    expect(datesInRange('01-01', '2026-12-20', '2027-01-10')).toEqual(['2027-01-01']);
    expect(datesInRange('12-25', '2026-12-20', '2027-01-10')).toEqual(['2026-12-25']);
    expect(datesInRange('12-31', '2026-12-31', '2027-12-31')).toEqual(['2026-12-31', '2027-12-31']);
    expect(datesInRange('01-01', '2026-01-01', '2026-01-01')).toEqual(['2026-01-01']);
  });

  it('a rolling window of several years gives one date a year, oldest first', () => {
    expect(datesInRange('03-09', '2026-03-10', '2029-03-09')).toEqual(['2027-03-09', '2028-03-09', '2029-03-09']);
  });

  it('a 28 February window only catches a leap-day birthday in a year without a 29th', () => {
    expect(datesInRange('02-29', '2025-02-28', '2025-02-28')).toEqual(['2025-02-28']);
    expect(datesInRange('02-29', '2025-02-27', '2025-02-27')).toEqual([]);
    expect(datesInRange('02-29', '2028-02-28', '2028-02-28')).toEqual([]);
    expect(datesInRange('02-29', '2028-02-29', '2028-02-29')).toEqual(['2028-02-29']);
  });

  it('refuses a damaged, reversed or absurdly wide range instead of looping', () => {
    expect(datesInRange('05-14', '2026-13-01', '2027-01-01')).toEqual([]);
    expect(datesInRange('05-14', '2027-01-01', '2026-01-01')).toEqual([]);
    expect(datesInRange('05-14', 'x', 'y')).toEqual([]);
    expect(datesInRange('05-14', '1900-01-01', `${1900 + MAX_SPAN_YEARS + 5}-01-01`)).toEqual([]);
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('2024-02-29')).toBe(true);
  });

  it('the next occurrence is today when it is today, this year if ahead, else next year', () => {
    expect(nextOccurrence('05-14', '2026-05-14')).toBe('2026-05-14');
    expect(nextOccurrence('05-14', '2026-05-13')).toBe('2026-05-14');
    expect(nextOccurrence('05-14', '2026-05-15')).toBe('2027-05-14');
    expect(nextOccurrence('02-29', '2026-03-01')).toBe('2027-02-28');
    expect(nextOccurrence('02-29', '2027-03-01')).toBe('2028-02-29');
    expect(nextOccurrence('05-14', 'not a date')).toBe('');
  });
});

describe('the results do not depend on the device clock or time zone (an all-day date is a calendar date)', () => {
  const original = process.env.TZ;
  afterEach(() => { vi.useRealTimers(); if (original === undefined) delete process.env.TZ; else process.env.TZ = original; });
  const subject = member(1, { ...base, contactId: 5, birthMonthDay: '02-29' });
  const names = new Map([[5, 'Sam Example']]);
  const run = () => buildFamilyItems({ members: [subject], dates: [], names, events: () => [] }, { from: '2026-12-25', to: '2028-03-02', today: '2027-06-01' })
    .map((i) => [i.id, i.date, i.status]);

  it.each(['UTC', 'Pacific/Kiritimati', 'Pacific/Pago_Pago', 'America/New_York', 'Australia/Lord_Howe', 'Europe/London'])('%s, including clock-change weekends', (tz) => {
    process.env.TZ = tz;
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2027-03-14T07:30:00Z')); // a US clock-change day
    const here = run();
    process.env.TZ = 'UTC';
    expect(here).toEqual(run());
    expect(here.map((r) => r[1])).toEqual(['2027-02-28', '2028-02-29']);
  });
});

describe('the important-date record', () => {
  const fields: DateFields = { dateKind: 'anniversary', label: 'Wedding anniversary', monthDay: '06-21', year: 2012, status: 'active' };

  it('validates in plain words', () => {
    expect(validateDate(fields, 2026)).toBeNull();
    expect(validateDate({ ...fields, label: '   ' }, 2026)).toMatch(/short name/);
    expect(validateDate({ ...fields, label: 'x'.repeat(61) }, 2026)).toMatch(/at most 60/);
    expect(validateDate({ ...fields, monthDay: '02-30' }, 2026)).toMatch(/not a real date/);
    expect(validateDate({ ...fields, dateKind: 'birthday' as never }, 2026)).toMatch(/kind of date/);
    expect(validateDate({ ...fields, year: 1800 }, 2026)).toMatch(/1900/);
    expect(validateDate({ ...fields, year: 2027 }, 2026)).toMatch(/1900/);
    expect(validateDate({ ...fields, monthDay: '02-29', year: 2013 }, 2026)).toMatch(/not a leap year/);
    expect(validateDate({ ...fields, monthDay: '02-29', year: 2012 }, 2026)).toBeNull();
  });

  it('stores a field only when it has a value, and "off the Calendar" only when it is off', () => {
    expect(Object.keys(cleanDate({ ...fields, year: undefined })).sort()).toEqual(['dateKind', 'label', 'monthDay', 'status']);
    expect(cleanDate({ ...fields, onCalendar: true })).not.toHaveProperty('onCalendar');
    expect(cleanDate({ ...fields, onCalendar: false })).toHaveProperty('onCalendar', false);
    expect(cleanDate({ ...fields, label: '  Wedding   anniversary ' }).label).toBe('Wedding anniversary');
  });

  it('keeps unknown fields through an edit and replaces known ones', () => {
    const raw = { ...fields, onCalendar: false, future: { keep: 1 } };
    const next = toStoredDate(raw, { ...fields, label: 'Anniversary' });
    expect(next).toMatchObject({ future: { keep: 1 }, label: 'Anniversary' });
    expect(next).not.toHaveProperty('onCalendar'); // turned back on = absent
  });

  it('reads defensively: damaged required fields give "needs review", damaged optional fields are named and left out', () => {
    expect(dateRow(1, 'junk' as never).data).toBeNull();
    for (const bad of [{ label: '' }, { monthDay: '2-3' }, { dateKind: 'birthday' }, { status: 'gone' }]) {
      const r = dateRow(2, { ...fields, ...bad });
      expect(r.data).toBeNull();
      expect(r.problems.length).toBeGreaterThan(0);
    }
    const partly = dateRow(3, { ...fields, year: 'twenty', memberId: 'x', onCalendar: 'no' });
    expect(partly.data).toMatchObject({ label: 'Wedding anniversary', monthDay: '06-21' });
    expect(partly.data).not.toHaveProperty('year');
    expect(partly.data).not.toHaveProperty('memberId');
    expect(partly.data!.onCalendar).toBeUndefined(); // treated as shown
    expect(partly.problems).toHaveLength(3);
  });
});

describe('who gets a birthday marker', () => {
  const names = new Map([[5, 'Sam Example'], [6, 'Pat Sample'], [7, '   ']]);
  const ok = { ...base, birthMonthDay: '05-14' };

  it('active members with a valid birthday and a named Contact', () => {
    const ms = [member(1, { ...ok, contactId: 5 }), member(2, { ...ok, contactId: 6, status: 'past' }), member(3, { ...base, contactId: 6 }), member(4, { ...ok, contactId: 7 }), member(5, { ...ok, contactId: 99 })];
    expect(birthdaySubjects(ms, names).map((s) => s.memberId)).toEqual([1]);
  });

  it('a member whose switch is off, an unreadable member and a damaged birthday contribute nothing', () => {
    const ms = [member(1, { ...ok, contactId: 5, birthdayOnCalendar: false }), member(2, { contactId: 6, role: 'wizard', status: 'active', birthMonthDay: '05-14' }), member(3, { ...base, contactId: 6, birthMonthDay: '99-99' })];
    expect(birthdaySubjects(ms, names)).toEqual([]);
  });

  it('a damaged switch value counts as ON (and is reported on the member)', () => {
    const m = member(1, { ...ok, contactId: 5, birthdayOnCalendar: 'maybe' });
    expect(m.problems).toEqual(['The Calendar setting could not be read, so the birthday is treated as shown.']);
    expect(birthdaySubjects([m], names)).toHaveLength(1);
  });

  it('two active records for one Contact give ONE marker, from the oldest record (its switch decides)', () => {
    const older = member(3, { ...ok, contactId: 5 });
    const newer = member(9, { ...ok, contactId: 5, birthMonthDay: '05-15' });
    expect(birthdaySubjects([newer, older], names)).toMatchObject([{ memberId: 3, monthDay: '05-14' }]);
    const olderOff = member(3, { ...ok, contactId: 5, birthdayOnCalendar: false });
    expect(birthdaySubjects([newer, olderOff], names)).toEqual([]);
    // if the oldest is marked past, the next one takes over
    const olderPast = member(3, { ...ok, contactId: 5, status: 'past' });
    expect(birthdaySubjects([newer, olderPast], names)).toMatchObject([{ memberId: 9 }]);
  });
});

describe('the markers themselves', () => {
  const names = new Map([[5, 'Sam Example']]);
  const q = { from: '2026-05-01', to: '2026-05-31', today: '2026-05-14' };
  const sam = member(11, { ...base, contactId: 5, birthMonthDay: '05-14', birthYear: 2016, note: 'Private note about Sam.', color: '#4a7bd0' });
  const wed = dateRow(21, { dateKind: 'anniversary', label: 'Wedding anniversary', monthDay: '05-20', year: 2012, status: 'active', memberId: 11 });

  it('have stable ids from the immutable record id and the date, the Calendar wording, and no stored copy', () => {
    const items = buildFamilyItems({ members: [sam], dates: [wed], names, events: () => [] }, q);
    expect(items.map((i) => i.id)).toEqual(['family:birthday-11:2026-05-14', 'family:date-21:2026-05-20']);
    expect(items[0]).toMatchObject({ title: "Sam Example's birthday", allDay: true, status: 'open', sourceModule: 'family', icsUid: 'family-birthday-11-2026-05-14@ledger.local' });
    expect(items[0].title).toBe(birthdayTitle('Sam Example'));
    expect(birthdayMarkerTitle('Sam Example')).toBe(birthdayTitle('Sam Example'));
    expect(items[1]).toMatchObject({ title: 'Wedding anniversary', detail: 'Anniversary', icsUid: 'family-date-21-2026-05-20@ledger.local' });
    // computing again gives the very same answer
    expect(buildFamilyItems({ members: [sam], dates: [wed], names, events: () => [] }, q).map((i) => i.id)).toEqual(items.map((i) => i.id));
  });

  it('past days are handled (never overdue); today and later are open', () => {
    const items = buildFamilyItems({ members: [sam], dates: [], names, events: () => [] }, { ...q, today: '2026-05-15' });
    expect(items[0].status).toBe('handled');
    expect(buildFamilyItems({ members: [sam], dates: [], names, events: () => [] }, { ...q, today: '2026-05-14' })[0].status).toBe('open');
  });

  it('carry NO birth year, age, note, colour, phone, email or contact detail in any visible or exported text', () => {
    const text = JSON.stringify(buildFamilyItems({ members: [sam], dates: [wed], names, events: () => [] }, { from: '2025-01-01', to: '2030-12-31', today: '2026-05-14' }).map((i) => [i.title, i.detail, i.icsTitle, i.icsDetail, i.icsUid, i.sourceLabel, i.id]));
    for (const secret of ['2016', 'Private note', '#4a7bd0', 'age', 'turns', '2012']) expect(text.toLowerCase(), secret).not.toContain(secret.toLowerCase());
  });

  it('an archived date, a date switched off the Calendar and an unreadable date draw nothing', () => {
    const rows = [
      dateRow(31, { dateKind: 'other', label: 'Archived', monthDay: '05-02', status: 'archived' }),
      dateRow(32, { dateKind: 'other', label: 'Off', monthDay: '05-03', status: 'active', onCalendar: false }),
      dateRow(33, { dateKind: 'other', label: '', monthDay: '05-04', status: 'active' }),
    ];
    expect(buildFamilyItems({ members: [], dates: rows, names, events: () => [] }, q)).toEqual([]);
  });

  it('the stored events are read only when a birthday falls in the window', () => {
    const events = vi.fn(() => []);
    buildFamilyItems({ members: [sam], dates: [], names, events }, { ...q, from: '2026-06-01', to: '2026-06-30' });
    expect(events).not.toHaveBeenCalled();
    buildFamilyItems({ members: [sam], dates: [], names, events }, q);
    expect(events).toHaveBeenCalledTimes(1);
  });
});

describe('the dates list', () => {
  const names = new Map([[5, 'Sam Example'], [6, 'Pat Sample']]);
  const today = '2026-06-01';
  it('lists birthdays and dates together in the order they next fall, marking what is off the Calendar', () => {
    const ms = [member(1, { ...base, contactId: 5, birthMonthDay: '05-14', birthYear: 2016, note: 'secret' }), member(2, { ...base, contactId: 6, birthMonthDay: '07-01', birthdayOnCalendar: false })];
    const ds = [dateRow(9, { dateKind: 'anniversary', label: 'Wedding anniversary', monthDay: '06-21', year: 2012, status: 'active' }), dateRow(10, { dateKind: 'other', label: 'Old', monthDay: '01-01', status: 'archived' })];
    const rows = upcomingRows(ms, ds, names, today);
    expect(rows.map((r) => [r.title, r.date, r.onCalendar])).toEqual([
      ['Wedding anniversary', '2026-06-21', true],
      ["Pat Sample's birthday", '2026-07-01', false],
      ["Sam Example's birthday", '2027-05-14', true],
    ]);
    const text = JSON.stringify(rows);
    for (const secret of ['2016', 'secret', '2012']) expect(text).not.toContain(secret);
  });
  it('leaves out past members, members with no birthday and members whose Contact is gone', () => {
    const ms = [member(1, { ...base, contactId: 5, birthMonthDay: '05-14', status: 'past' }), member(2, { ...base, contactId: 6 }), member(3, { ...base, contactId: 77, birthMonthDay: '05-14' })];
    expect(upcomingRows(ms, [], names, today)).toEqual([]);
  });
});
