import { describe, expect, it } from 'vitest';
import { FinanceDB } from '../../db';
import { toIcs } from '../../lib/calendar';
import { loadCalendar } from '../../lib/calendarLive';
import type { RecurringRule } from '../../types';
import { ledgerDueItems } from '../ledger/dueProvider';
import { newEventData } from './data';
import { buildIcs, rruleOf } from './ics';
import { blankFields, PERSONAL_ID, type EventFields, type EventRecord } from './model';
import type { Recurrence } from './recurrence';
import { msAt } from './time';

const ex = { calendarId: PERSONAL_ID, tagIds: [], contactIds: [], recurrence: null, trackDone: false };
const rec = (id: number, f: EventFields, over: Partial<ReturnType<typeof newEventData>> = {}): EventRecord => ({ id, createdAt: 0, updatedAt: 0, data: { ...newEventData(f, ex), ...over } });
const NOW = '2026-11-04T12:00:00.000Z';
const lines = (s: string) => s.split('\r\n');

describe('calendar file export', () => {
  it('writes all-day items as plain dates with an exclusive end, and a reminder', () => {
    const f: EventFields = { ...blankFields('2026-11-04'), title: 'Pay rent, then call; ok', allDay: true, reminders: [1440] };
    const out = lines(buildIcs({ name: 'Personal', events: [rec(1, f)], nowIso: NOW }));
    expect(out).toContain('DTSTART;VALUE=DATE:20261104');
    expect(out).toContain('DTEND;VALUE=DATE:20261105');
    expect(out).toContain('SUMMARY:Pay rent\\, then call\\; ok');
    expect(out).toContain('TRIGGER:-P1D');
    expect(out).toContain('UID:cal-1@ledger.local');
    expect(out.indexOf('TRIGGER:-P1D')).toBeGreaterThan(out.indexOf('PRIORITY:5')); // alarms after properties
    expect(out[out.length - 2]).toBe('END:VCALENDAR');
  });

  it('a one-off timed event is an absolute (UTC) time; a repeating one is a floating local time with its repeat rule and skipped dates', () => {
    const f: EventFields = { ...blankFields('2026-11-02', msAt('2026-11-02', 600)), title: 'Standup' };
    const once = lines(buildIcs({ name: 'x', events: [rec(2, f)], nowIso: NOW }));
    expect(once.find((l) => l.startsWith('DTSTART:'))).toMatch(/^DTSTART:\d{8}T\d{6}Z$/);
    const weekly: Recurrence = { freq: 'weekly', interval: 1, byWeekday: [1], end: { type: 'count', count: 5 } };
    const rep = lines(buildIcs({ name: 'x', events: [rec(3, f, { recurrence: weekly, skipped: ['2026-11-09'] })], nowIso: NOW }));
    expect(rep).toContain('DTSTART:20261102T100000');
    expect(rep).toContain('RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=5');
    expect(rep).toContain('EXDATE:20261109T100000');
  });

  it('an occurrence edited on its own becomes a separate entry with the same id', () => {
    const f: EventFields = { ...blankFields('2026-11-02', msAt('2026-11-02', 600)), title: 'Standup' };
    const weekly: Recurrence = { freq: 'weekly', interval: 1, end: { type: 'never' } };
    const out = lines(buildIcs({ name: 'x', events: [rec(4, f, { recurrence: weekly, overrides: { '2026-11-09': { title: 'Standup (moved)' } } })], nowIso: NOW }));
    expect(out.filter((l) => l === 'UID:cal-4@ledger.local')).toHaveLength(2);
    expect(out).toContain('RECURRENCE-ID:20261109T100000');
    expect(out).toContain('EXDATE:20261109T100000');
    expect(out).toContain('SUMMARY:Standup (moved)');
  });

  it('repeat rules: 31st of the month clamps like Ledger, "2nd Tuesday", last weekday, yearly, until', () => {
    const r = (x: Partial<Recurrence> & Pick<Recurrence, 'freq'>): Recurrence => ({ interval: 1, end: { type: 'never' }, ...x });
    expect(rruleOf(r({ freq: 'monthly' }), '2026-01-31', true)).toBe('FREQ=MONTHLY;BYMONTHDAY=28,29,30,31;BYSETPOS=-1');
    expect(rruleOf(r({ freq: 'monthly' }), '2026-01-15', true)).toBe('FREQ=MONTHLY;BYMONTHDAY=15');
    expect(rruleOf(r({ freq: 'monthly', monthly: 'nth', interval: 2 }), '2026-11-10', true)).toBe('FREQ=MONTHLY;INTERVAL=2;BYDAY=2TU');
    expect(rruleOf(r({ freq: 'monthly', monthly: 'last' }), '2026-11-27', true)).toBe('FREQ=MONTHLY;BYDAY=-1FR');
    expect(rruleOf(r({ freq: 'yearly', end: { type: 'until', date: '2030-01-01' } }), '2026-11-10', true)).toBe('FREQ=YEARLY;UNTIL=20300101');
    expect(rruleOf(r({ freq: 'daily', end: { type: 'until', date: '2030-01-01' } }), '2026-11-10', false)).toBe('FREQ=DAILY;UNTIL=20300101T235959');
  });

  it('long lines are folded and retired events are left out', () => {
    const f: EventFields = { ...blankFields('2026-11-04'), title: 'x'.repeat(200), allDay: true };
    const out = buildIcs({ name: 'x', events: [rec(5, f), rec(6, f, { retired: { module: 'ledger', recordId: 'scheduled:1', note: 'moved' } })], nowIso: NOW });
    expect(out.split('\r\n').every((l) => new TextEncoder().encode(l).length <= 75)).toBe(true);
    expect(out).not.toContain('cal-6@');
  });
});

describe('Finance layer export uses the same ids as Ledger’s own "Add to my calendar" file', () => {
  it('every bill id in the existing export is present, unchanged, in the Finance export', async () => {
    const d = new FinanceDB('test-ics-finance');
    const accountId = (await d.accounts.add({ name: 'Test checking', kind: 'checking', openingBalanceCents: 0, openingDate: '2026-01-01' } as never)) as number;
    await d.recurring.add({ accountId, payee: 'Test landlord', amountCents: -150000, categoryId: null, memo: '', frequency: 'weekly', startDate: '2026-11-06', active: true } as RecurringRule);
    const today = '2026-11-04';
    const existing = toIcs(await loadCalendar(d, today, 365), NOW);
    const existingUids = lines(existing).filter((l) => l.startsWith('UID:bill-'));
    expect(existingUids.length).toBeGreaterThan(3);
    const derived = await ledgerDueItems(d, { from: today, to: '2027-11-04', today, overdueDays: 0 });
    const ours = lines(buildIcs({ name: 'Finance', events: [], derived, nowIso: NOW }));
    for (const uid of existingUids) expect(ours, uid).toContain(uid);
    // and the all-day format matches the existing file
    expect(ours).toContain('DTSTART;VALUE=DATE:20261106');
    expect(ours).toContain('DTEND;VALUE=DATE:20261107');
  });
});
