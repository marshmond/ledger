import { describe, expect, it } from 'vitest';
import { generateDates } from '../../core/recurrence';
import { semiDates, type Semimonthly } from '../../lib/semimonthly';
import {
  describeSchedule, expectedDates, inPause, nextExpected, parseSlot, readSchedule, scheduleProblem, slotCollisions, type Schedule,
} from './schedule';
import { addD, dim, dow, iso, lastBiz, monday, monthly, pad, src } from './billsTestkit';

/** Expected dates are worked out here WITHOUT the code under test. All data invented. 2026-11-06 is a Friday. */
const all = (s: Schedule | null, from: string, to: string, over = {}) => expectedDates(src(s, over), from, to);
const dates = (s: Schedule | null, from: string, to: string, over = {}) => all(s, from, to, over).map((e) => e.nominal);

describe('B1: every billing pattern gives exactly the right dates (tests 16, 17)', () => {
  it('weekly: every Friday for a year, 7 days apart, slots are the Monday of each week', () => {
    const s: Schedule = { kind: 'weeks', every: 1, weekday: 5, anchorDate: '2026-11-06' };
    const want = Array.from({ length: 52 }, (_, i) => addD('2026-11-06', 7 * i));
    expect(dates(s, '2026-11-06', '2027-11-04')).toEqual(want);
    expect(all(s, '2026-11-06', '2026-11-20').map((e) => e.slot)).toEqual(['w2026-11-02', 'w2026-11-09', 'w2026-11-16']);
    expect(want.every((d) => dow(d) === 5)).toBe(true);
  });
  it('every two weeks and every four weeks are exactly 14 and 28 days apart across the year end', () => {
    const two: Schedule = { kind: 'weeks', every: 2, weekday: 5, anchorDate: '2026-11-06' };
    const got = dates(two, '2026-11-06', '2027-12-31');
    expect(got.slice(0, 4)).toEqual(['2026-11-06', '2026-11-20', '2026-12-04', '2026-12-18']);
    got.forEach((d, i) => expect(d).toBe(addD('2026-11-06', 14 * i)));
    const four: Schedule = { kind: 'weeks', every: 4, weekday: 5, anchorDate: '2026-11-06' };
    dates(four, '2026-11-06', '2028-01-01').forEach((d, i) => expect(d).toBe(addD('2026-11-06', 28 * i)));
    const three: Schedule = { kind: 'weeks', every: 3, weekday: 1, anchorDate: '2026-11-09' };
    dates(three, '2026-11-09', '2027-06-01').forEach((d, i) => expect(d).toBe(addD('2026-11-09', 21 * i)));
  });
  it('weekly on a Sunday belongs to the week that starts on the Monday before it', () => {
    const s: Schedule = { kind: 'weeks', every: 1, weekday: 0, anchorDate: '2026-11-08' };
    const e = all(s, '2026-11-08', '2026-11-22');
    expect(e.map((x) => x.nominal)).toEqual(['2026-11-08', '2026-11-15', '2026-11-22']);
    expect(e.map((x) => x.slot)).toEqual(['w2026-11-02', 'w2026-11-09', 'w2026-11-16']);
    e.forEach((x) => expect(x.slot).toBe(`w${monday(x.nominal)}`));
  });
  it('monthly on a date: every month of two years, clamped in short months; slots are the months', () => {
    const got = all(monthly(31, '2026-01'), '2026-01-01', '2027-12-31');
    expect(got).toHaveLength(24);
    got.forEach((e, i) => {
      const y = 2026 + Math.floor(i / 12), m = (i % 12) + 1;
      expect(e.nominal).toBe(iso(y, m, dim(y, m)));
      expect(e.slot).toBe(`m${y}-${pad(m)}`);
    });
  });
  it('day 31 into April and 29 to 31 into February, in a leap and a non-leap year', () => {
    expect(dates(monthly(31, '2027-03'), '2027-03-01', '2027-05-31')).toEqual(['2027-03-31', '2027-04-30', '2027-05-31']);
    for (const d of [29, 30, 31]) {
      expect(dates(monthly(d, '2027-01'), '2027-02-01', '2027-02-28'), `non-leap ${d}`).toEqual(['2027-02-28']);
      expect(dates(monthly(d, '2028-01'), '2028-02-01', '2028-02-29'), `leap ${d}`).toEqual([d === 29 ? '2028-02-29' : '2028-02-29']);
    }
    expect(dates(monthly(28, '2028-01'), '2028-02-01', '2028-02-29')).toEqual(['2028-02-28']);
  });
  it('the last day and the last business day of every month for four years', () => {
    const lastDay: Schedule = { kind: 'months', every: 1, slot: { kind: 'lastDay' }, anchorMonth: '2024-01' };
    const lastBizS: Schedule = { kind: 'months', every: 1, slot: { kind: 'lastBusinessDay' }, anchorMonth: '2024-01' };
    const ld = dates(lastDay, '2024-01-01', '2027-12-31');
    const lb = dates(lastBizS, '2024-01-01', '2027-12-31');
    expect(ld).toHaveLength(48);
    ld.forEach((d, i) => expect(d).toBe(iso(2024 + Math.floor(i / 12), (i % 12) + 1, dim(2024 + Math.floor(i / 12), (i % 12) + 1))));
    lb.forEach((d, i) => expect(d).toBe(lastBiz(2024 + Math.floor(i / 12), (i % 12) + 1)));
    expect(lb).toContain('2026-10-30'); // 31 Oct 2026 is a Saturday
    expect(lb).toContain('2026-11-30'); // a Monday
  });
  it('every 2, 3 and 6 months and once a year', () => {
    expect(dates(monthly(12, '2026-11', 2), '2026-11-01', '2027-11-30')).toEqual(['2026-11-12', '2027-01-12', '2027-03-12', '2027-05-12', '2027-07-12', '2027-09-12', '2027-11-12']);
    expect(dates(monthly(1, '2026-12', 3), '2026-11-01', '2027-12-31')).toEqual(['2026-12-01', '2027-03-01', '2027-06-01', '2027-09-01', '2027-12-01']);
    expect(dates(monthly(30, '2026-12', 6), '2026-11-01', '2028-06-30')).toEqual(['2026-12-30', '2027-06-30', '2027-12-30', '2028-06-30']);
    expect(dates(monthly(15, '2027-03', 12), '2026-11-07', '2030-12-31')).toEqual(['2027-03-15', '2028-03-15', '2029-03-15', '2030-03-15']);
    expect(dates(monthly(29, '2028-02', 12), '2028-01-01', '2032-12-31')).toEqual(['2028-02-29', '2029-02-28', '2030-02-28', '2031-02-28', '2032-02-29']);
    expect(dates(monthly(7, '2026-01', 24), '2026-01-01', '2031-01-01')).toEqual(['2026-01-07', '2028-01-07', '2030-01-07']);
  });
  it('previous and next business day adjustments move the nominal date but keep the month', () => {
    // 15 Aug 2026 Saturday, 15 Nov 2026 Sunday
    const prev = dates(monthly(15, '2026-08', 1, 'previous'), '2026-08-01', '2026-12-31');
    expect(prev).toEqual(['2026-08-14', '2026-09-15', '2026-10-15', '2026-11-13', '2026-12-15']);
    const next = dates(monthly(15, '2026-08', 1, 'next'), '2026-08-01', '2026-12-31');
    expect(next).toEqual(['2026-08-17', '2026-09-15', '2026-10-15', '2026-11-16', '2026-12-15']);
  });
  it('twice a month agrees with the Household Services dates and names each date a or b', () => {
    const semi: Semimonthly = { a: { kind: 'day', day: 15, adjust: 'none' }, b: { kind: 'lastBusinessDay' } };
    const s: Schedule = { kind: 'twice-monthly', semi, anchorMonth: '2026-01' };
    const got = all(s, '2026-01-01', '2027-12-31');
    expect(got.map((e) => e.nominal)).toEqual(semiDates(semi, '2026-01-01', '2026-01-01', '2027-12-31'));
    expect(got).toHaveLength(48);
    got.forEach((e, i) => expect(e.slot).toBe(`s${e.nominal.slice(0, 7)}${i % 2 === 0 ? 'a' : 'b'}`));
    expect(got.slice(0, 4).map((e) => e.nominal)).toEqual(['2026-01-15', '2026-01-30', '2026-02-15', '2026-02-27']);
  });
  it('twice a month: the 1st and 15th, month boundaries and December into January', () => {
    const s: Schedule = { kind: 'twice-monthly', semi: { a: { kind: 'day', day: 1 }, b: { kind: 'day', day: 15 } }, anchorMonth: '2026-11' };
    expect(all(s, '2026-12-15', '2027-01-01').map((e) => `${e.slot}@${e.nominal}`)).toEqual(['s2026-12b@2026-12-15', 's2027-01a@2027-01-01']);
    expect(dates(s, '2026-11-20', '2026-12-31')).toEqual(['2026-12-01', '2026-12-15']);
  });
  it('on demand (no schedule) gives nothing', () => {
    expect(all(null, '2026-01-01', '2030-12-31')).toEqual([]);
  });
  it('the window edges are inclusive and an empty or reversed window is empty', () => {
    expect(dates(monthly(12, '2026-01'), '2026-11-12', '2026-12-12')).toEqual(['2026-11-12', '2026-12-12']);
    expect(dates(monthly(12, '2026-01'), '2026-11-13', '2026-12-11')).toEqual([]);
    expect(dates(monthly(12, '2026-01'), '2026-12-12', '2026-11-12')).toEqual([]);
  });
  it('nextExpected finds the next date even for a schedule that bills once every 24 months', () => {
    const s = src(monthly(7, '2027-06', 24), { trackingSince: '2026-11-07' });
    expect(nextExpected(s, '2026-11-07', 2).map((e) => e.nominal)).toEqual(['2027-06-07', '2029-06-07']);
    expect(nextExpected(src(monthly(12), { trackingSince: '2026-11-07' }), '2026-11-07', 3).map((e) => e.nominal)).toEqual(['2026-11-12', '2026-12-12', '2027-01-12']);
  });
});

describe('B1: the reader agrees with the existing generator for plain rules (oracle, test 18)', () => {
  it('weekly families equal generateDates', () => {
    for (const every of [1, 2, 3, 4, 6]) for (const anchor of ['2026-11-06', '2026-11-08', '2026-11-09', '2027-02-28']) {
      const w = dow(anchor);
      const want = generateDates(anchor, { freq: 'weekly', interval: every, byWeekday: [w], end: { type: 'never' } }, anchor, '2029-12-31');
      expect(dates({ kind: 'weeks', every, weekday: w, anchorDate: anchor }, anchor, '2029-12-31'), `${anchor} every ${every}`).toEqual(want);
    }
  });
  it('monthly families equal generateDates for days 1 to 31 and every 1, 2, 3, 6, 12 (ten years)', () => {
    for (let day = 1; day <= 31; day++) for (const every of [1, 2, 3, 6, 12]) {
      const want = generateDates(`2024-01-${pad(day)}`, { freq: 'monthly', interval: every, monthly: 'date', end: { type: 'never' } }, '2024-01-01', '2033-12-31');
      expect(dates(monthly(day, '2024-01', every), '2024-01-01', '2033-12-31'), `day ${day} every ${every}`).toEqual(want);
    }
  });
});

describe('B1: tracking start, pauses, ending and reopening (tests 21, 22 reader part)', () => {
  const s = monthly(12, '2026-01');
  it('nothing before the tracking start is ever derived (no pile of missed bills)', () => {
    expect(dates(s, '2026-01-01', '2026-12-31', { trackingSince: '2026-11-07' })).toEqual(['2026-11-12', '2026-12-12']);
    expect(dates(s, '2026-01-01', '2026-12-31', { trackingSince: '2026-11-13' })).toEqual(['2026-12-12']);
    expect(dates(s, '2026-01-01', '2026-12-31', { trackingSince: '2026-11-12' })).toEqual(['2026-11-12', '2026-12-12']);
  });
  it('a closed pause leaves out the dates inside it and resumes afterwards; "to" is the first day expected again', () => {
    const pauses = [{ from: '2027-02-01', to: '2027-05-12' }];
    expect(dates(s, '2027-01-01', '2027-06-30', { pauses })).toEqual(['2027-01-12', '2027-05-12', '2027-06-12']);
    expect(inPause('2027-05-11', pauses)).toBe(true);
    expect(inPause('2027-05-12', pauses)).toBe(false);
    expect(inPause('2027-01-31', pauses)).toBe(false);
    expect(inPause('2027-02-01', pauses)).toBe(true);
  });
  it('an open pause leaves out everything from its start; a paused record with no open pause fails closed', () => {
    expect(dates(s, '2027-01-01', '2027-06-30', { pauses: [{ from: '2027-03-01', to: null }], status: 'paused' })).toEqual(['2027-01-12', '2027-02-12']);
    expect(dates(s, '2027-01-01', '2027-06-30', { status: 'paused' })).toEqual([]);
  });
  it('an ended record is expected up to and including its end date, never after', () => {
    expect(dates(s, '2027-01-01', '2027-06-30', { status: 'ended', endedOn: '2027-03-12' })).toEqual(['2027-01-12', '2027-02-12', '2027-03-12']);
    expect(dates(s, '2027-01-01', '2027-06-30', { status: 'ended', endedOn: '2027-03-11' })).toEqual(['2027-01-12', '2027-02-12']);
    expect(dates(s, '2027-01-01', '2027-06-30', { status: 'ended', endedOn: null })).toEqual([]);
  });
  it('a status this version does not know fails closed (nothing expected)', () => {
    expect(dates(s, '2027-01-01', '2027-06-30', { status: 'unsupported' })).toEqual([]);
  });
  it('ended then reopened with a kept gap: the gap has no dates and later dates return', () => {
    const pauses = [{ from: '2027-03-13', to: '2027-06-01' }];
    expect(dates(s, '2027-01-01', '2027-07-31', { pauses })).toEqual(['2027-01-12', '2027-02-12', '2027-03-12', '2027-06-12', '2027-07-12']);
  });
});

describe('B1: schedule revisions (history) and parsing', () => {
  it('dates before a change come from the old schedule and dates after from the new one', () => {
    const history = [{ until: '2026-12-31', schedule: monthly(12, '2026-01') }];
    const e = expectedDates(src(monthly(20, '2027-01'), { scheduleHistory: history }), '2026-10-01', '2027-03-31');
    expect(e.map((x) => x.nominal)).toEqual(['2026-10-12', '2026-11-12', '2026-12-12', '2027-01-20', '2027-02-20', '2027-03-20']);
    expect(e.map((x) => x.slot)).toEqual(['m2026-10', 'm2026-11', 'm2026-12', 'm2027-01', 'm2027-02', 'm2027-03']);
    expect(slotCollisions(e)).toEqual([]);
  });
  it('two revisions in a row are applied in date order whatever order they are stored in', () => {
    const history = [{ until: '2027-06-30', schedule: monthly(20, '2027-01') }, { until: '2026-12-31', schedule: monthly(12, '2026-01') }];
    const e = expectedDates(src(monthly(5, '2027-07'), { scheduleHistory: history }), '2026-12-01', '2027-08-31').map((x) => x.nominal);
    expect(e).toEqual(['2026-12-12', '2027-01-20', '2027-02-20', '2027-03-20', '2027-04-20', '2027-05-20', '2027-06-20', '2027-07-05', '2027-08-05']);
  });
  it('a schedule claiming the same period twice is reported, not hidden', () => {
    const history = [{ until: '2026-12-14', schedule: monthly(12, '2026-01') }];
    const e = expectedDates(src(monthly(20, '2026-12'), { scheduleHistory: history }), '2026-12-01', '2026-12-31');
    expect(slotCollisions(e)).toEqual([{ slot: 'm2026-12', dates: ['2026-12-12', '2026-12-20'] }]);
  });
  it('readSchedule accepts the stored shapes and refuses damaged or future ones (never throws)', () => {
    expect(readSchedule({ kind: 'weeks', every: 2, weekday: 5, anchorDate: '2026-11-06' })).toEqual({ kind: 'weeks', every: 2, weekday: 5, anchorDate: '2026-11-06' });
    expect(readSchedule(monthly(12))).toEqual(monthly(12));
    for (const bad of [null, undefined, 5, 'x', {}, { kind: 'weeks' }, { kind: 'weeks', every: 0, weekday: 1, anchorDate: '2026-11-06' }, { kind: 'weeks', every: 2, weekday: 9, anchorDate: '2026-11-06' },
      { kind: 'weeks', every: 2, weekday: 5, anchorDate: '2026-02-30' }, { kind: 'months', every: 25, slot: { kind: 'day', day: 3 }, anchorMonth: '2026-01' }, { kind: 'months', every: 1, slot: { kind: 'day', day: 40 }, anchorMonth: '2026-01' },
      { kind: 'months', every: 1, slot: { kind: 'day', day: 3 }, anchorMonth: '2026-13' }, { kind: 'twice-monthly', semi: { a: { kind: 'day', day: 1 } }, anchorMonth: '2026-01' }, { kind: 'quarterly-future', every: 3 }]) {
      expect(readSchedule(bad)).toBeNull();
    }
  });
  it('scheduleProblem refuses what could not work and explains', () => {
    expect(scheduleProblem({ kind: 'weeks', every: 2, weekday: 1, anchorDate: '2026-11-06' })).toMatch(/weekday/);
    expect(scheduleProblem(monthly(1, '2026-01', 1, 'previous'))).toMatch(/outside its own month/);
    expect(scheduleProblem({ kind: 'twice-monthly', semi: { a: { kind: 'day', day: 30 }, b: { kind: 'lastDay' } }, anchorMonth: '2026-01' })).toMatch(/same date/);
    expect(scheduleProblem(monthly(12))).toBeNull();
  });
  it('slot ids are parsed back, and a damaged slot is none of the four shapes', () => {
    expect(parseSlot('m2026-12')).toEqual({ kind: 'm', month: '2026-12' });
    expect(parseSlot('s2026-12b')).toEqual({ kind: 's', month: '2026-12', which: 'b' });
    expect(parseSlot('w2026-12-07')).toEqual({ kind: 'w', monday: '2026-12-07' });
    expect(parseSlot('x1730000044444000')).toEqual({ kind: 'x', id: '1730000044444000' });
    for (const bad of ['', 'w2026-12-08', 'm2026-13', 's2026-12c', 'q1', 'm2026-1', null, 7]) expect(parseSlot(bad as never), String(bad)).toBeNull();
  });
  it('describeSchedule reads naturally for the common patterns', () => {
    expect(describeSchedule(null)).toBe('On demand (no regular schedule)');
    expect(describeSchedule(monthly(12))).toBe('Monthly, on the 12th');
    expect(describeSchedule(monthly(15, '2027-03', 12))).toBe('Once a year, on the 15th of March');
    expect(describeSchedule(monthly(1, '2027-03', 3))).toBe('Every 3 months (quarterly), on the 1st');
    expect(describeSchedule({ kind: 'weeks', every: 2, weekday: 5, anchorDate: '2026-11-06' })).toBe('Every 2 weeks on Friday');
    expect(describeSchedule({ kind: 'months', every: 1, slot: { kind: 'lastBusinessDay' }, anchorMonth: '2026-01' })).toBe('Monthly, on the last business day of the month');
  });
});
