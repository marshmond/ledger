import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FinanceDB } from '../db';
import { loadEvents, saveEdit } from '../modules/calendar/data';
import { occurrencesOf } from '../modules/calendar/occurrences';
import { blankFields, type EventFields } from '../modules/calendar/model';
import { msAt } from '../modules/calendar/time';
import { isStamped, loadBaseline, needsReview, recordBaseline } from './compat';
import { effectiveForEvent, resolveGrants, subjectOf } from './grants';
import { appendDecision, loadGrantRows } from './grantStore';
import { addEvent, calendar, extras, household, projectionOf, stubStorage, weekly } from './displayTestkit';

/**
 * CS-2 older-build safeguard (release blocker, CS-1 report M.4). An OLDER build that splits a repeating event on a shared calendar copies no
 * display decision and leaves no pointer to the old event. The safeguard: events made by a current build carry a stamp bound to their own id;
 * after the owner's first-publication review, an event that would be shown only because its calendar is shared and that has no valid stamp is
 * withheld until the owner chooses. Invented data only.
 */
vi.mock('../lib/download', () => ({ downloadText: () => undefined }));
beforeEach(() => stubStorage());

const edited = (date: string, minutes: number, title: string): EventFields => ({ ...blankFields(date, msAt(date, minutes)), title, startDate: date, endDate: date });
const occ = async (d: FinanceDB, id: number, key: string) => occurrencesOf((await loadEvents(d)).find((e) => e.id === id)!, key, key)[0];
const titlesOf = async (d: FinanceDB) => (await projectionOf(d)).projection.entries.map((e) => `${e.title}@${e.start.date}`);
const raw = (d: FinanceDB, id: number) => d.moduleRecords.get(id) as Promise<{ data: Record<string, unknown>; createdAt: number }>;

/** What an OLDER build writes: a plain record, no stamp of its own, and no display decision. */
const olderBuildAdd = (d: FinanceDB, data: Record<string, unknown>, createdAt = Date.now()) =>
  d.moduleRecords.add({ module: 'calendar', kind: 'event', data, createdAt, updatedAt: createdAt, deletedAt: null } as never) as Promise<number>;

/** What an OLDER build does for "this and following": the old record ends the day before, and a NEW record is a copy of the old one (stamp included). */
async function olderBuildSplit(d: FinanceDB, id: number, from: string, title: string) {
  const old = await raw(d, id);
  const rule = old.data.recurrence as { end: unknown };
  await d.moduleRecords.update(id, { data: { ...old.data, recurrence: { ...rule, end: { type: 'until', date: '2026-11-15' } } } } as never);
  return olderBuildAdd(d, { ...old.data, title, startDate: from, endDate: from, startAt: msAt(from, 17 * 60), endAt: msAt(from, 18 * 60) });
}

async function sharedFamilyCalendar(d: FinanceDB) {
  const fam = await calendar(d, 'Family');
  await appendDecision({ subject: subjectOf('calendar', fam), decision: 'show' }, d);
  return fam;
}

describe('the stamp', () => {
  it('a new event carries a stamp bound to its own id; a copied stamp does not count', async () => {
    const { d } = await household();
    const id = await addEvent(d, 'Piano', '2026-11-10', {}, 16 * 60);
    const rec = await raw(d, id);
    expect(rec.data.prov).toEqual({ v: 1, id });
    expect(isStamped(id, rec.data)).toBe(true);
    expect(isStamped(id + 1, rec.data)).toBe(false); // the same data on another record (what an older build's split makes)
    expect(isStamped(id, { ...rec.data, prov: undefined })).toBe(false);
    expect(isStamped(id, { prov: { v: 2, id } })).toBe(false);
    expect(isStamped(id, null)).toBe(false);
  });

  it('every kind of edit keeps the stamp, and a split made by this build stamps the new half with its own id', async () => {
    const { d } = await household();
    const id = await addEvent(d, 'Piano', '2026-11-02', { recurrence: weekly }, 16 * 60);
    await saveEdit(await occ(d, id, '2026-11-09'), edited('2026-11-09', 16 * 60, 'Piano (this week)'), extras({ recurrence: weekly }), 'one', d);
    await saveEdit(await occ(d, id, '2026-11-09'), edited('2026-11-09', 16 * 60, 'Piano (all)'), extras({ recurrence: weekly }), 'all', d);
    expect((await raw(d, id)).data.prov).toEqual({ v: 1, id });
    const next = await saveEdit(await occ(d, id, '2026-11-16'), edited('2026-11-16', 17 * 60, 'Piano (new)'), extras({ recurrence: weekly }), 'following', d);
    expect(next).not.toBe(id);
    expect((await raw(d, next)).data.prov).toEqual({ v: 1, id: next });
    expect((await raw(d, id)).data.prov).toEqual({ v: 1, id });
  });

  it('no calendar code writes a NEW event record without a stamp (a guard against a future writer forgetting)', () => {
    const dir = join(__dirname, '..', 'modules', 'calendar');
    const offenders: string[] = [];
    for (const f of readdirSync(dir).filter((x) => /\.tsx?$/.test(x) && !/\.test\./.test(x))) {
      readFileSync(join(dir, f), 'utf8').split('\n').forEach((line, i) => {
        if (/kind: 'event'/.test(line) && /put\(|\.add\(/.test(line) && !/prov: stampFor\(/.test(line) && !/\bid[:,]/.test(line)) offenders.push(`${f}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});

describe('the baseline', () => {
  it('is recorded once, the earliest wins, and a second device or a double click cannot change it', async () => {
    const { d } = await household();
    expect(await loadBaseline(d)).toBeNull();
    expect(await recordBaseline(d, 2000)).toBe(2000);
    expect(await recordBaseline(d, 3000)).toBe(2000);
    expect(await recordBaseline(d, 1000)).toBe(1000);
    expect(await loadBaseline(d)).toBe(1000);
    expect((await d.moduleRecords.where('[module+kind]').equals(['display', 'compat']).count())).toBe(2);
  });

  it('needs a baseline before it holds anything back', () => {
    expect(needsReview({ id: 1, createdAt: 5000, data: {} }, null)).toBe(false);
    expect(needsReview({ id: 1, createdAt: 5000, data: {} }, 4000)).toBe(true);
    expect(needsReview({ id: 1, createdAt: 3000, data: {} }, 4000)).toBe(false); // made before: it was in the reviewed dataset
    expect(needsReview({ id: 1, createdAt: 5000, data: { prov: { v: 1, id: 1 } } }, 4000)).toBe(false);
  });
});

describe('MANDATORY: an older build splits a repeating event that was kept private on a shared calendar', () => {
  it('the successor is withheld, nothing becomes visible, and the owner can then choose', async () => {
    const { d } = await household();
    const fam = await sharedFamilyCalendar(d);
    const piano = await addEvent(d, 'Piano (private lessons)', '2026-11-02', { calendarId: fam, recurrence: weekly }, 16 * 60);
    await appendDecision({ subject: subjectOf('event', piano), decision: 'hide' }, d); // "Keep this one private"
    await recordBaseline(d, Date.now() - 10); // the owner confirmed the first publication
    expect(await titlesOf(d)).toEqual([]);

    const successor = await olderBuildSplit(d, piano, '2026-11-16', 'Piano (private lessons, new time)');

    // Without the safeguard the successor would inherit the shared calendar and be eligible: prove the risk is real.
    const g = resolveGrants(await loadGrantRows(d));
    expect(effectiveForEvent(g, successor, fam, true).show).toBe('details');
    // With it, nothing is published and the event is listed for review.
    const state = await projectionOf(d);
    expect(state.projection.entries).toEqual([]);
    expect(state.report.withheld.map((w) => w.eventId)).toEqual([successor]);
    expect(state.report.withheld[0]).toMatchObject({ title: 'Piano (private lessons, new time)', calendarName: 'Family' });
    expect(JSON.stringify(state.projection)).not.toContain('private lessons');

    // The owner keeps it private: it leaves the review list and stays out.
    await appendDecision({ subject: subjectOf('event', successor), decision: 'hide' }, d);
    const after = await projectionOf(d);
    expect(after.projection.entries).toEqual([]);
    expect(after.report.withheld).toEqual([]);
  });

  it('the owner can instead choose Show, and then it is published (an explicit approval is never withheld)', async () => {
    const { d } = await household();
    const fam = await sharedFamilyCalendar(d);
    const piano = await addEvent(d, 'Piano', '2026-11-02', { calendarId: fam, recurrence: weekly }, 16 * 60);
    await recordBaseline(d, Date.now() - 10);
    const successor = await olderBuildSplit(d, piano, '2026-11-16', 'Piano (new time)');
    expect((await projectionOf(d)).report.withheld.map((w) => w.eventId)).toEqual([successor]);
    await appendDecision({ subject: subjectOf('event', successor), decision: 'show' }, d);
    const s = await projectionOf(d);
    expect(s.report.withheld).toEqual([]);
    expect(s.projection.entries.map((e) => e.title)).toContain('Piano (new time)');
  });

  it('withholding does not touch the privacy history (grantsSeen) and holds back nothing else', async () => {
    const { d } = await household();
    const fam = await sharedFamilyCalendar(d);
    const piano = await addEvent(d, 'Piano', '2026-11-02', { calendarId: fam, recurrence: weekly }, 16 * 60);
    const other = await addEvent(d, 'Family dinner', '2026-11-12', { calendarId: fam }, 18 * 60);
    await recordBaseline(d, Date.now() - 10);
    const before = (await projectionOf(d)).projection.grantsSeen;
    await olderBuildSplit(d, piano, '2026-11-16', 'Piano (new time)');
    const s = await projectionOf(d);
    expect(s.projection.grantsSeen).toEqual(before);
    expect(s.projection.entries.map((e) => e.title)).toContain('Family dinner');
    expect(other).toBeGreaterThan(0);
  });
});

describe('ordinary scheduling is not disrupted', () => {
  it('new events made by this build on a shared calendar are published without any review', async () => {
    const { d } = await household();
    const fam = await sharedFamilyCalendar(d);
    await recordBaseline(d, Date.now() - 10);
    await addEvent(d, 'Soccer practice', '2026-11-12', { calendarId: fam }, 17 * 60);
    await addEvent(d, 'Family dinner', '2026-11-13', { calendarId: fam }, 18 * 60);
    const s = await projectionOf(d);
    expect(s.projection.entries.map((e) => e.title).sort()).toEqual(['Family dinner', 'Soccer practice']);
    expect(s.report.withheld).toEqual([]);
  });

  it('a split of a repeating event made by THIS build is a continuation: carried decision, stamped, not withheld', async () => {
    const { d } = await household();
    const fam = await sharedFamilyCalendar(d);
    const piano = await addEvent(d, 'Piano', '2026-11-02', { calendarId: fam, recurrence: weekly }, 16 * 60);
    await recordBaseline(d, Date.now() - 10);
    const next = await saveEdit(await occ(d, piano, '2026-11-16'), edited('2026-11-16', 17 * 60, 'Piano (new time)'), extras({ calendarId: fam, recurrence: weekly }), 'following', d);
    const s = await projectionOf(d);
    expect(s.report.withheld).toEqual([]);
    expect(s.projection.entries.map((e) => e.title)).toContain('Piano (new time)');
    expect(isStamped(next, (await raw(d, next)).data)).toBe(true);
  });

  it('and a private series split by THIS build stays private (the carried hide) and is not even listed for review', async () => {
    const { d } = await household();
    const fam = await sharedFamilyCalendar(d);
    const piano = await addEvent(d, 'Piano', '2026-11-02', { calendarId: fam, recurrence: weekly }, 16 * 60);
    await appendDecision({ subject: subjectOf('event', piano), decision: 'hide' }, d);
    await recordBaseline(d, Date.now() - 10);
    await saveEdit(await occ(d, piano, '2026-11-16'), edited('2026-11-16', 17 * 60, 'Piano (new time)'), extras({ calendarId: fam, recurrence: weekly }), 'following', d);
    const s = await projectionOf(d);
    expect(s.projection.entries).toEqual([]);
    expect(s.report.withheld).toEqual([]);
  });

  it('only events shown purely because of a shared calendar are held back; a plain unstamped event on a private calendar is not eligible anyway', async () => {
    const { d } = await household();
    await recordBaseline(d, Date.now() - 10);
    await olderBuildAdd(d, { ...(await raw(d, await addEvent(d, 'x', '2026-11-12', {}, 9 * 60))).data, title: 'Made by an older build', prov: undefined });
    const s = await projectionOf(d);
    expect(s.projection.entries).toEqual([]); // private by default: nothing to withhold, nothing shown
    expect(s.report.withheld).toEqual([]);
  });

  it('an unstamped event made by an older build AFTER the baseline is withheld; one made BEFORE it (and so reviewed) is not; one the owner approved by hand is not', async () => {
    const { d } = await household();
    const fam = await sharedFamilyCalendar(d);
    const template = (await raw(d, await addEvent(d, 'template', '2026-11-12', { calendarId: fam }, 9 * 60))).data;
    const base = Date.now() - 50_000;
    const mk = (title: string, createdAt: number) => olderBuildAdd(d, { ...template, title, prov: undefined }, createdAt);
    const early = await mk('Made before the review', base - 1000);
    const late = await mk('Made after the review', base + 1000);
    const approved = await mk('Approved by hand', base + 2000);
    await appendDecision({ subject: subjectOf('event', approved), decision: 'show' }, d);
    await recordBaseline(d, base);
    const s = await projectionOf(d);
    const titles = s.projection.entries.map((e) => e.title);
    expect(titles).toContain('Made before the review');
    expect(titles).toContain('Approved by hand');
    expect(titles).not.toContain('Made after the review');
    expect(s.report.withheld.map((w) => w.eventId)).toEqual([late]);
    expect(early).toBeGreaterThan(0);
  });

  it('before the first publication is confirmed (no baseline) nothing is withheld, so the owner\'s review shows everything', async () => {
    const { d } = await household();
    const fam = await sharedFamilyCalendar(d);
    const piano = await addEvent(d, 'Piano', '2026-11-02', { calendarId: fam, recurrence: weekly }, 16 * 60);
    await olderBuildSplit(d, piano, '2026-11-16', 'Piano (new time)');
    const s = await projectionOf(d);
    expect(s.report.withheld).toEqual([]);
    expect(s.projection.entries.map((e) => e.title)).toContain('Piano (new time)');
  });
});
