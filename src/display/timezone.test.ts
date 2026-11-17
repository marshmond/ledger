import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { appendDecision } from './grantStore';
import { subjectOf } from './grants';
import { addEvent, household, projectionOf, stubStorage, weekly } from './displayTestkit';

/**
 * CS-1: recurrence, all-day dates and daylight-saving time are deterministic. The projection stores LOCAL wall-clock strings in the publishing
 * device's zone (recorded as `generatedFor.tz`), using the Calendar's own expansion. US daylight time ends on 2026-11-01 and begins on 2027-03-14.
 */
const original = process.env.TZ;
let zoneWorks = false;
beforeAll(() => {
  process.env.TZ = 'America/New_York';
  zoneWorks = new Date(2026, 6, 1, 12).getTimezoneOffset() === 240 && new Date(2026, 11, 1, 12).getTimezoneOffset() === 300;
});
afterAll(() => { if (original === undefined) delete process.env.TZ; else process.env.TZ = original; });
beforeEach(() => stubStorage());

describe('daylight-saving time', () => {
  it('the test zone is really in effect (otherwise these checks prove nothing)', () => { expect(zoneWorks).toBe(true); });

  it('a weekly 09:00 event keeps 09:00 on the wall clock before and after the clocks go back', async () => {
    const { d } = await household();
    const id = await addEvent(d, 'Standup', '2026-10-26', { recurrence: weekly }, 9 * 60);
    await appendDecision({ subject: subjectOf('event', id), decision: 'show' }, d);
    const { projection } = await projectionOf(d, { today: '2026-10-28' });
    const byDate = Object.fromEntries(projection.entries.map((e) => [e.start.date, e.start.time]));
    expect(byDate['2026-10-26']).toBe('09:00'); // before 2026-11-01 (daylight time)
    expect(byDate['2026-11-02']).toBe('09:00'); // after (standard time)
    expect(byDate['2026-11-09']).toBe('09:00');
    expect(projection.generatedFor.tz).toBe('America/New_York');
  });

  it('an event on the night the clocks go back keeps its own wall-clock start and end', async () => {
    const { d } = await household();
    const id = await addEvent(d, 'Late show', '2026-11-01', {}, 23 * 60 + 30); // 23:30 on the day of the change
    await appendDecision({ subject: subjectOf('event', id), decision: 'show' }, d);
    const { projection } = await projectionOf(d, { today: '2026-11-01' });
    expect(projection.entries[0]).toMatchObject({ allDay: false, start: { date: '2026-11-01', time: '23:30' }, end: { date: '2026-11-02', time: '00:30' } });
  });

  it('an all-day multi-day event cannot shift a day across the change, and its last day is inclusive', async () => {
    const { d } = await household();
    const id = await addEvent(d, 'Trip', '2026-10-30', {}, undefined, { endDate: '2026-11-02' });
    await appendDecision({ subject: subjectOf('event', id), decision: 'show' }, d);
    const { projection } = await projectionOf(d, { today: '2026-10-28' });
    expect(projection.entries[0]).toMatchObject({ allDay: true, start: { date: '2026-10-30', time: null }, end: { date: '2026-11-02', time: null } });
  });

  it('a yearly all-day birthday-style event and a repeating event give the same dates on every build', async () => {
    const { d } = await household();
    const id = await addEvent(d, 'Anniversary', '2026-03-14', { recurrence: { freq: 'yearly', interval: 1, end: { type: 'never' } } });
    await appendDecision({ subject: subjectOf('event', id), decision: 'show' }, d);
    const a = await projectionOf(d, { today: '2027-03-10' });
    const b = await projectionOf(d, { today: '2027-03-10' });
    expect(a.projection.entries.map((e) => e.start.date)).toEqual(['2027-03-14']);
    expect(JSON.stringify(a.projection)).toBe(JSON.stringify(b.projection));
  });

  it('spring forward: a 02:30 event on the missing hour still produces a valid, real wall-clock time', async () => {
    const { d } = await household();
    const id = await addEvent(d, 'Early', '2027-03-14', {}, 2 * 60 + 30); // 02:30 does not exist on 2027-03-14 in New York
    await appendDecision({ subject: subjectOf('event', id), decision: 'show' }, d);
    const { projection } = await projectionOf(d, { today: '2027-03-12' });
    expect(projection.entries[0].start.date).toBe('2027-03-14');
    expect(projection.entries[0].start.time).toMatch(/^0[23]:[0-5]\d$/);
  });
});
