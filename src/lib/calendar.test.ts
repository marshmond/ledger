import { describe, expect, it } from 'vitest';
import { buildCalendar, toIcs, type CalendarInput } from './calendar';

const fmt = (c: number) => `$${(c / 100).toFixed(2)}`;
const base: CalendarInput = {
  today: '2026-10-17', horizonDays: 90, vests: [], milestones: [], estimated: null, rmds: [], scheduled: [], loans: [], yearEndYears: [], fmt,
};

describe('building the calendar', () => {
  it('includes only dates from today through the horizon, sorted', () => {
    const e = buildCalendar({
      ...base,
      vests: [
        { id: 'a', date: '2026-12-01', label: 'Grant A', grossCents: 500000, person: 'Alex' },
        { id: 'b', date: '2026-10-16', label: 'Past', grossCents: 1, person: 'Alex' },
        { id: 'c', date: '2027-03-01', label: 'Far', grossCents: 1, person: 'Alex' },
        { id: 'd', date: '2026-10-17', label: 'Today', grossCents: 1, person: 'Alex' },
      ],
    });
    expect(e.map((x) => x.title)).toEqual(['RSU vest: Today', 'RSU vest: Grant A']);
  });
  it('adds estimated-payment dates only when there is a shortfall', () => {
    const dueDates = ['2026-09-15', '2027-01-15'];
    expect(buildCalendar({ ...base, estimated: { dueDates, amountCents: 0 } })).toEqual([]);
    const e = buildCalendar({ ...base, horizonDays: 120, estimated: { dueDates, amountCents: 360000 } });
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ date: '2027-01-15', kind: 'tax', to: '/taxplan' });
    expect(e[0].detail).toContain('$3600.00');
  });
  it('adds RMD, year-end, bill, loan, and pay-cap items', () => {
    const e = buildCalendar({
      ...base,
      rmds: [{ person: 'Sam', year: 2026 }],
      yearEndYears: [2026],
      scheduled: [{ id: '1', date: '2026-10-20', payee: 'Rent', amountCents: -250000 }],
      loans: [{ id: '2', date: '2026-11-01', name: 'Mortgage', paymentCents: 243042 }],
      milestones: [{ id: '3', date: '2026-10-30', label: 'Social Security cap reached', person: 'Alex' }],
    });
    expect(e.map((x) => x.kind)).toEqual(['bill', 'cap', 'loan', 'year-end', 'rmd']);
    expect(e[0].title).toBe('Rent $2500.00');
  });
});

describe('iCalendar export', () => {
  const events = buildCalendar({
    ...base,
    vests: [{ id: 'v1', date: '2026-12-01', label: 'Grant, "A"; big', grossCents: 500000, person: 'Alex' }],
    scheduled: [{ id: 's1', date: '2026-10-20', payee: 'Rent', amountCents: -250000 }],
  });
  const ics = toIcs(events, '2026-10-17T12:30:45.123Z');

  it('is a valid-looking calendar with CRLF line endings', () => {
    expect(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics.split('\r\n').filter((l) => l === 'BEGIN:VEVENT')).toHaveLength(2);
    expect(ics).not.toMatch(/[^\r]\n/);
  });
  it('writes all-day events with an end date the next day', () => {
    expect(ics).toContain('DTSTART;VALUE=DATE:20261201');
    expect(ics).toContain('DTEND;VALUE=DATE:20261202');
    expect(ics).toContain('DTSTAMP:20261017T123045Z');
  });
  it('escapes commas, semicolons, and quotes in text', () => {
    expect(ics).toContain('SUMMARY:RSU vest: Grant\\, "A"\\; big');
  });
  it('adds a reminder the day before for vests but not for bills', () => {
    const blocks = ics.split('BEGIN:VEVENT').slice(1);
    const vest = blocks.find((b) => b.includes('RSU vest'))!;
    const bill = blocks.find((b) => b.includes('Rent'))!;
    expect(vest).toContain('TRIGGER:-P1D');
    expect(bill).not.toContain('VALARM');
  });
  it('folds long lines at 75 bytes', () => {
    const long = buildCalendar({ ...base, vests: [{ id: 'x', date: '2026-12-01', label: 'word '.repeat(40), grossCents: 1, person: 'A' }] });
    const out = toIcs(long, '2026-10-17T00:00:00Z');
    for (const line of out.split('\r\n')) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    // unfolding restores the text
    const unfolded = out.replace(/\r\n /g, '');
    expect(unfolded).toContain('SUMMARY:RSU vest: ' + 'word '.repeat(40));
  });
  it('is the same for the same input and has unique ids', () => {
    expect(toIcs(events, '2026-10-17T12:30:45Z')).toBe(toIcs(events, '2026-10-17T12:30:45Z'));
    const uids = ics.split('\r\n').filter((l) => l.startsWith('UID:'));
    expect(new Set(uids).size).toBe(uids.length);
  });
});
