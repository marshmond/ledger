import { describe, expect, it } from 'vitest';
import { eventFieldsFor, extractRange, parseQuickEvent } from './quickEvent';

const TODAY = '2026-11-05'; // a Thursday

describe('time ranges', () => {
  it('reads 3-4pm as 3pm to 4pm and removes it from the text', () => {
    expect(extractRange('lunch 3-4pm')).toEqual({ start: '15:00', end: '16:00', rest: 'lunch' });
  });
  it('reads minutes, spaces and "to"', () => {
    expect(extractRange('standup 9:30am - 10am')).toMatchObject({ start: '09:30', end: '10:00' });
    expect(extractRange('from 3 to 4:30pm party')).toMatchObject({ start: '15:00', end: '16:30', rest: 'party' });
    expect(extractRange('x 3pm-4pm')).toMatchObject({ start: '15:00', end: '16:00' });
  });
  it('a start that would run backwards takes the other half of the day', () => {
    expect(extractRange('11-1pm')).toMatchObject({ start: '11:00', end: '13:00' });
    expect(extractRange('10am-2pm')).toMatchObject({ start: '10:00', end: '14:00' });
    expect(extractRange('12-1pm')).toMatchObject({ start: '12:00', end: '13:00' });
  });
  it('is not fooled by dates, bare numbers or impossible times', () => {
    expect(extractRange('dentist 2026-11-12')).toBeNull();
    expect(extractRange('seats 5-10')).toBeNull();
    expect(extractRange('13-14pm')).toBeNull();
    expect(extractRange('4pm-3pm')).toBeNull();
  });
});

describe('parsing an event', () => {
  it('a plain title with nothing else is an all-day event today', () => {
    expect(parseQuickEvent('Team offsite', TODAY)).toEqual({ title: 'Team offsite', date: TODAY, allDay: true, tags: [], recurrence: null });
  });
  it('a date word with no time is all-day on that date', () => {
    expect(parseQuickEvent('dentist friday', TODAY)).toMatchObject({ title: 'dentist', date: '2026-11-06', allDay: true });
    expect(parseQuickEvent('dentist nov 20', TODAY)).toMatchObject({ date: '2026-11-20', allDay: true });
  });
  it('"at 3pm" makes it timed, with no end (one hour is applied when saving)', () => {
    const p = parseQuickEvent('call mom tomorrow at 3pm', TODAY);
    expect(p).toMatchObject({ title: 'call mom', date: '2026-11-06', allDay: false, startTime: '15:00' });
    expect(p.endTime).toBeUndefined();
  });
  it('a time alone means today', () => {
    expect(parseQuickEvent('gym 6:30pm', TODAY)).toMatchObject({ title: 'gym', date: TODAY, allDay: false, startTime: '18:30' });
  });
  it('reads a range, with the date', () => {
    expect(parseQuickEvent('lunch with sam fri 12-1pm', TODAY)).toMatchObject({ title: 'lunch with sam', date: '2026-11-06', allDay: false, startTime: '12:00', endTime: '13:00' });
  });
  it('reads priority, tag and calendar name', () => {
    const p = parseQuickEvent('recital sat 2-3pm !high #kids @family', TODAY);
    expect(p).toMatchObject({ title: 'recital', date: '2026-11-07', priority: 'high', tags: ['kids'], calendar: 'family', startTime: '14:00', endTime: '15:00' });
  });
  it('reads repeats with the same words as tasks', () => {
    expect(parseQuickEvent('standup 9-9:30am every weekday'.replace('weekday', 'monday'), TODAY).recurrence).toMatchObject({ freq: 'weekly', interval: 1, byWeekday: [1] });
    expect(parseQuickEvent('book club every two weeks', TODAY).recurrence).toMatchObject({ freq: 'weekly', interval: 2 });
    expect(parseQuickEvent('book club every other week', TODAY).recurrence).toMatchObject({ freq: 'weekly', interval: 2 });
    expect(parseQuickEvent('rent day monthly', TODAY).recurrence).toMatchObject({ freq: 'monthly', interval: 1 });
    expect(parseQuickEvent('birthday nov 20 yearly', TODAY)).toMatchObject({ date: '2026-11-20', recurrence: { freq: 'yearly' } });
  });
  it('a weekday repeat starts on the next such day', () => {
    expect(parseQuickEvent('swim every tuesday', TODAY)).toMatchObject({ date: '2026-11-10', recurrence: { byWeekday: [2] } });
  });
  it('never loses what was typed: if everything is shorthand the line itself is the title', () => {
    expect(parseQuickEvent('3-4pm', TODAY).title).toBe('3-4pm');
    expect(parseQuickEvent('friday', TODAY).title).toBe('friday');
  });
  it('plain mode turns the shorthand off', () => {
    expect(parseQuickEvent('lunch fri 12-1pm !high', TODAY, { plain: true })).toEqual({ title: 'lunch fri 12-1pm !high', date: TODAY, allDay: true, tags: [], recurrence: null });
  });
});

describe('event fields', () => {
  it('all-day events cover their one day', () => {
    const f = eventFieldsFor(parseQuickEvent('dentist fri', TODAY));
    expect(f).toMatchObject({ title: 'dentist', allDay: true, startDate: '2026-11-06', endDate: '2026-11-06', priority: 'medium' });
  });
  it('a single time is one hour long; a range uses its end', () => {
    const one = eventFieldsFor(parseQuickEvent('call at 3pm', TODAY));
    expect(one.allDay).toBe(false);
    expect(one.endAt - one.startAt).toBe(3600_000);
    expect(new Date(one.startAt).getHours()).toBe(15);
    const range = eventFieldsFor(parseQuickEvent('workshop 9-11:30am', TODAY));
    expect(range.endAt - range.startAt).toBe(150 * 60_000);
  });
});
