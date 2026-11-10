import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { FinanceDB } from '../../db';
import { addDays } from '../../lib/dates';
import { installTracking } from '../../lib/sync/track';
import { saveTask } from '../tasks/data';
import { createArrangement, tasksOfArrangement } from './data';
import { servicesDueItems } from './dueProvider';
import { blankArrangement, type Cadence } from './model';
import { UpcomingCard } from './OverviewParts';
import { plannedVisitDates } from './plannedVisits';
import { loadServicesOverview } from './servicesOverview';
import {
  DEFAULT_UPCOMING_DAYS, filterUpcomingByProvider, loadUpcomingDays, parseUpcomingDays, saveUpcomingDays, UPCOMING_KEY, UPCOMING_ROWS, UPCOMING_WINDOWS, visibleUpcoming, type UpcomingDays,
} from './upcomingWindow';
import type { UpcomingRow } from './servicesOverview';
import { providerNamed } from '../../core/contactTestkit';

/** B3.0A: the Upcoming window (7, 14, 30, 90; default 30). Real Dexie, invented data. 2026-11-06 is a Friday. */
let n = 0;
const fresh = () => { const d = new FinanceDB(`test-b30a-${n++}`); installTracking(d); return d; };
const TODAY = '2026-11-06';
const weekly = (anchorDate: string): Cadence => ({ mode: 'fixed', rule: { freq: 'weekly', interval: 1, end: { type: 'never' } }, anchorDate });
const add = async (d: FinanceDB, title: string, anchor: string, provider = 'Rosa Cleaning') =>
  createArrangement({ data: blankArrangement({ title, cadence: weekly(anchor) }), provider: await providerNamed(d, provider), assetIds: [], today: TODAY }, d);
const load = (d: FinanceDB, days?: UpcomingDays) => loadServicesOverview('all', TODAY, d, undefined, days);
const datesOf = (rows: UpcomingRow[], arrangementId: number) => rows.filter((r) => r.arrangementId === arrangementId).map((r) => r.date);
const snapshot = async (d: FinanceDB) => JSON.stringify([await d.moduleRecords.toArray(), await d.links.toArray(), await d.txns.toArray(), await d.settings.toArray()]);
const store = (init: Record<string, string> = {}) => { const m = new Map(Object.entries(init)); return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } }; };

describe('B3.0A the preference: default, saved choice, invalid values', () => {
  it('offers exactly 7, 14, 30 and 90 days and defaults to 30 on a fresh configuration', () => {
    expect([...UPCOMING_WINDOWS]).toEqual([7, 14, 30, 90]);
    expect(DEFAULT_UPCOMING_DAYS).toBe(30);
    expect(loadUpcomingDays(store())).toBe(30);
  });
  it('the choice persists: saved, then read back by a new screen (a remount or a reload)', () => {
    const s = store();
    for (const d of UPCOMING_WINDOWS) { saveUpcomingDays(d, s); expect(s.m.get(UPCOMING_KEY)).toBe(String(d)); expect(loadUpcomingDays(s)).toBe(d); }
  });
  it('an invalid saved value is the default, never an error: other numbers, text, empty, junk, negative, fractions, lists', () => {
    for (const bad of ['5', '60', '0', '31', '07x', 'abc', '', ' ', '-7', '7.5', '[7]', '{"days":7}', 'null', 'NaN', '7 days', '1000']) expect(parseUpcomingDays(bad), bad).toBe(30);
    for (const bad of [null, undefined, NaN, 60, 0, -7, 7.5, {}, [], true]) expect(parseUpcomingDays(bad as never)).toBe(30);
    expect(loadUpcomingDays(store({ [UPCOMING_KEY]: '45' }))).toBe(30);
    expect(parseUpcomingDays(' 14 ')).toBe(14);
    expect(parseUpcomingDays(90)).toBe(90);
  });
  it('unavailable storage never throws: the default is used and saving is silently skipped', () => {
    const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(loadUpcomingDays(broken)).toBe(30);
    expect(() => saveUpcomingDays(7, broken)).not.toThrow();
  });
});

describe('B3.0A the window: each choice, and the exact boundaries', () => {
  it('uses 30 days when no window is given, and says which window the list was built for', async () => {
    const d = fresh();
    await add(d, 'House cleaning', TODAY);
    expect((await load(d)).upcomingDays).toBe(30);
    for (const w of UPCOMING_WINDOWS) expect((await load(d, w)).upcomingDays).toBe(w);
  });

  it('each of the four windows lists today up to and INCLUDING the date N days away, and nothing after it', async () => {
    const d = fresh();
    const fri = await add(d, 'Friday cleaning', TODAY); // 7 and 14 days away land exactly on 2026-11-13 and 2026-11-20
    const sun = await add(d, 'Sunday lawn', '2026-11-08'); // 2026-12-06 is exactly 30 days away
    const thu = await add(d, 'Thursday pool', '2026-11-12'); // 2027-02-04 is exactly 90 days away
    for (const w of UPCOMING_WINDOWS) {
      const end = addDays(TODAY, w);
      const ov = await load(d, w);
      for (const r of ov.upcoming) expect(r.date <= end, `${w}: ${r.date}`).toBe(true);
      expect(ov.upcoming.every((r) => r.date >= '2026-11-06')).toBe(true);
    }
    // 7 days: the visit exactly 7 days away is in, the one 8+ days away is out
    expect(datesOf((await load(d, 7)).upcoming, fri.id)).toEqual(['2026-11-06', '2026-11-13']);
    // 14 days: exactly 14 days away is in, 21 is out
    expect(datesOf((await load(d, 14)).upcoming, fri.id)).toEqual(['2026-11-06', '2026-11-13', '2026-11-20']);
    // 30 days: 2026-12-06 is exactly 30 days away: in; 2026-12-13 is out
    const s30 = datesOf((await load(d, 30)).upcoming, sun.id);
    expect(s30[0]).toBe('2026-11-08');
    expect(s30).toContain('2026-12-06');
    expect(s30).not.toContain('2026-12-13');
    expect(s30[s30.length - 1]).toBe('2026-12-06');
    // 90 days: 2027-02-04 is exactly 90 days away: in; 2027-02-11 is out
    const t90 = datesOf((await load(d, 90)).upcoming, thu.id);
    expect(t90[t90.length - 1]).toBe('2027-02-04');
    expect(t90).not.toContain('2027-02-11');
    // a longer window never loses what a shorter one showed
    const counts = await Promise.all(UPCOMING_WINDOWS.map(async (w) => (await load(d, w)).upcoming.length));
    expect(counts).toEqual([...counts].sort((a, b) => a - b));
    expect(counts[0]).toBeLessThan(counts[3]);
  });

  it('respects the device date: the same data on another day gives a window starting that day', async () => {
    const d = fresh();
    const a = await add(d, 'House cleaning', TODAY);
    const later = await loadServicesOverview('all', '2026-11-20', d, undefined, 7);
    // On 20 Nov the open Task (6 Nov) is overdue and still listed; expected dates come from today (20 Nov) to 27 Nov
    expect(datesOf(later.upcoming, a.id)).toEqual(['2026-11-06', '2026-11-20', '2026-11-27']);
    expect(later.upcoming[0]).toMatchObject({ kind: 'task', overdue: true });
  });

  it('the open Task beyond the window is left out, and the same Task inside a longer window is listed with its moved flag', async () => {
    const d = fresh();
    const a = await add(d, 'House cleaning', TODAY);
    const t = (await tasksOfArrangement(a.id, d)).filter((x) => x.data.status !== 'done')[0];
    await saveTask(t.id, { ...t.data, dueDate: '2026-12-20' }, d); // 44 days away, moved on its own
    expect((await load(d, 7)).upcoming.filter((r) => r.kind === 'task')).toEqual([]);
    expect((await load(d, 30)).upcoming.filter((r) => r.kind === 'task')).toEqual([]);
    const ninety = (await load(d, 90)).upcoming.filter((r) => r.kind === 'task');
    expect(ninety).toHaveLength(1);
    expect(ninety[0]).toMatchObject({ date: '2026-12-20', movedFrom: TODAY });
  });

  it('an overdue open Task is never hidden by a narrow window', async () => {
    const d = fresh();
    const a = await add(d, 'House cleaning', TODAY);
    const t = (await tasksOfArrangement(a.id, d)).filter((x) => x.data.status !== 'done')[0];
    await saveTask(t.id, { ...t.data, dueDate: '2026-11-01' }, d);
    const ov = await load(d, 7);
    expect(ov.upcoming[0]).toMatchObject({ kind: 'task', date: '2026-11-01', overdue: true });
  });

  it('a visit moved on its own is flagged and the later expected dates do not shift (same list in every window)', async () => {
    const d = fresh();
    const a = await add(d, 'House cleaning', TODAY);
    const base = (await load(d, 90)).upcoming.filter((r) => r.kind === 'expected').map((r) => r.date);
    const t = (await tasksOfArrangement(a.id, d)).filter((x) => x.data.status !== 'done')[0];
    await saveTask(t.id, { ...t.data, dueDate: '2026-11-08' }, d);
    for (const w of UPCOMING_WINDOWS) {
      const ov = await load(d, w);
      expect(ov.upcoming[0]).toMatchObject({ kind: 'task', date: '2026-11-08', movedFrom: TODAY });
      expect(ov.upcoming.filter((r) => r.kind === 'expected').map((r) => r.date)).toEqual(base.filter((x) => x <= addDays(TODAY, w)));
    }
  });
});

describe('B3.0A providers, paused and ended arrangements', () => {
  it('the provider filter keeps working with every window, and is applied before the row limit', async () => {
    const d = fresh();
    const a = await add(d, 'House cleaning', TODAY, 'Rosa Cleaning');
    const b = await add(d, 'Lawn mowing', '2026-11-07', 'Green Lawns');
    const ov = await load(d, 90);
    const rosa = ov.base.rows.find((r) => r.a.id === a.id)!.a.data.providerContactId;
    const green = ov.base.rows.find((r) => r.a.id === b.id)!.a.data.providerContactId;
    expect(rosa).not.toBe(green);
    const mine = filterUpcomingByProvider(ov.upcoming, String(rosa));
    expect(mine.length).toBeGreaterThan(UPCOMING_ROWS); // 13 weekly visits in 90 days: more than the card's first rows
    expect(mine.every((r) => r.arrangementId === a.id)).toBe(true);
    expect(filterUpcomingByProvider(ov.upcoming, String(green)).every((r) => r.arrangementId === b.id)).toBe(true);
    expect(filterUpcomingByProvider(ov.upcoming, 'all')).toHaveLength(ov.upcoming.length);
    expect(ov.upcoming.length).toBe(filterUpcomingByProvider(ov.upcoming, String(rosa)).length + filterUpcomingByProvider(ov.upcoming, String(green)).length);
  });

  it('paused and ended arrangements list nothing in any window', async () => {
    const d = fresh();
    const a = await add(d, 'House cleaning', TODAY);
    const p = await add(d, 'Lawn mowing', '2026-11-07', 'Green Lawns');
    const e = await add(d, 'Pool', '2026-11-08', 'Blue Pools');
    const { applyLifecycle, planLifecycle } = await import('./changes');
    await applyLifecycle({ action: 'pause', arrangementId: p.id, expect: (await planLifecycle(p.id, 'pause', TODAY, d)).expect, today: TODAY }, d);
    await applyLifecycle({ action: 'end', arrangementId: e.id, expect: (await planLifecycle(e.id, 'end', TODAY, d)).expect, today: TODAY }, d);
    for (const w of UPCOMING_WINDOWS) {
      const ov = await load(d, w);
      expect(ov.upcoming.some((r) => r.arrangementId === p.id || r.arrangementId === e.id)).toBe(false);
      expect(ov.upcoming.some((r) => r.arrangementId === a.id)).toBe(true);
    }
  });
});

describe('B3.0A nothing but the list changes', () => {
  it('changing the window writes nothing: no record, Task, link, event, transaction or setting is created or changed, and one open Task per arrangement remains', async () => {
    const d = fresh();
    const a = await add(d, 'House cleaning', TODAY);
    await add(d, 'Lawn mowing', '2026-11-07', 'Green Lawns');
    const before = await snapshot(d);
    for (let i = 0; i < 3; i++) for (const w of UPCOMING_WINDOWS) await load(d, w);
    expect(await snapshot(d)).toBe(before);
    expect((await tasksOfArrangement(a.id, d)).filter((x) => x.data.status !== 'done')).toHaveLength(1);
  });

  it('the Calendar layer still shows the rolling 12 months of expected visits, whatever window was chosen', async () => {
    const d = fresh();
    const a = await add(d, 'House cleaning', TODAY);
    const q = { from: TODAY, to: addDays(TODAY, 365), today: TODAY, overdueDays: 0 };
    const before = (await servicesDueItems(d, q)).map((i) => i.id);
    for (const w of UPCOMING_WINDOWS) await load(d, w);
    const after = (await servicesDueItems(d, q)).map((i) => i.id);
    expect(after).toEqual(before);
    const visits = after.filter((id) => id.startsWith(`services:visit-${a.id}:`));
    expect(visits.length).toBeGreaterThan(40); // about 52 weekly visits, far more than 90 days hold
    expect(visits[visits.length - 1] > `services:visit-${a.id}:2027-10-01`).toBe(true); // reaches the end of the 12 months (2027-11-06), not just 90 days
    expect(visits[visits.length - 1] <= `services:visit-${a.id}:2027-11-06`).toBe(true);
    expect(plannedVisitDates).toBeDefined();
  });
});

describe('B3.0A the card: accessible, compact and honest about how many visits match', () => {
  const rows = (k: number): UpcomingRow[] => Array.from({ length: k }, (_, i) => ({
    key: `e1:${i}`, kind: 'expected', arrangementId: 1, title: 'House cleaning', providerName: 'Rosa Cleaning', providerContactId: 5, date: addDays(TODAY, i * 7), time: null, overdue: false, movedFrom: null, taskId: null, assetNames: [],
  }));
  const html = (r: UpcomingRow[], days: UpcomingDays = 30) => renderToStaticMarkup(createElement(MemoryRouter, null, createElement(UpcomingCard, { rows: r, total: r.length, days, onDays: () => undefined })));

  it('has one labelled native selector (keyboard accessible) with the four windows, the current one selected', () => {
    const out = html(rows(3), 90);
    expect(out).toMatch(/<label[^>]*>Show the next<select/);
    expect((out.match(/<option/g) ?? []).length).toBe(4);
    for (const w of ['7 days', '14 days', '30 days', '90 days']) expect(out).toContain(`>${w}</option>`);
    expect(out).toMatch(/<option value="90" selected="">90 days<\/option>/);
    expect(out).toMatch(/aria-describedby="sv-up-note"/);
    expect(out).toMatch(/id="sv-up-note"[^>]*role="status"/);
  });

  it('does not claim to show everything when more visits match than the rows shown: it says so and offers "Show all"', () => {
    const out = html(rows(13), 90);
    expect((out.match(/class="sv-visit-top"/g) ?? []).length).toBe(UPCOMING_ROWS);
    expect(out).toContain('Showing 10 of 13 visits in the next 90 days.');
    expect(out).toMatch(/<button[^>]*aria-expanded="false"[^>]*>Show all 13 visits<\/button>/);
  });

  it('"Show all" really shows every visit that matches, and "show fewer" returns to the first rows (nothing is silently discarded)', () => {
    const all13 = rows(13);
    const first = visibleUpcoming(all13, false);
    expect(first.shown).toHaveLength(UPCOMING_ROWS);
    expect(first.more).toBe(3);
    const everything = visibleUpcoming(all13, true);
    expect(everything.shown).toEqual(all13);
    expect(everything.more).toBe(0);
    expect(visibleUpcoming(rows(4), false)).toMatchObject({ more: 0 });
    expect(visibleUpcoming([], true)).toEqual({ shown: [], more: 0 });
  });

  it('with ten or fewer visits there is no truncation notice and no extra button', () => {
    const out = html(rows(10), 30);
    expect(out).toContain('10 visits in the next 30 days.');
    expect(out).not.toContain('Show all');
    expect(html(rows(1), 7)).toContain('1 visit in the next 7 days.');
  });

  it('an empty window says so and points to a longer one', () => {
    const out = html([], 7);
    expect(out).toContain('Nothing in the next 7 days.');
    expect(out).toContain('Choose a longer window above');
  });

  it('says plainly that this window changes only this list, not the Calendar', () => {
    expect(html(rows(2))).toContain('the Calendar still shows the next 12 months');
  });
});
