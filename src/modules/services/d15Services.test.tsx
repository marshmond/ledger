import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { providerNamed } from '../../core/contactTestkit';
import { FinanceDB } from '../../db';
import { installTracking } from '../../lib/sync/track';
import { createArrangement } from './data';
import { blankArrangement, cadenceText, type ArrangementRecord, type Cadence } from './model';
import { ArrangementCards, UpcomingCard } from './OverviewParts';
import { plannedVisitDates } from './plannedVisits';
import { ARRANGEMENT_TONE, arrangementCard, groupByDate, nextVisitView, occurrencesOf, UPCOMING_KIND_WORDS, VISIT_TONE } from './presentation';
import { scheduleStateOf } from './expectedCharges';
import { loadServicesOverview } from './servicesOverview';
import { buildRow, loadSnapshot } from './views';

/**
 * D15 Household Services. The overview and the arrangement page were recomposed (date groups, arrangement cards, a hero, two columns). The arrangements, their
 * cadences, the next-visit Task, the expected dates, the upcoming window and every link are the ones the screens already had. Real Dexie, invented names and
 * dates. 2026-11-06 is a Friday. Layout and look are checked in a real browser, not here.
 */
let n = 0;
const fresh = () => { const d = new FinanceDB(`test-d15-svc-${n++}`); installTracking(d); return d; };
const TODAY = '2026-11-06';
const never = { type: 'never' } as const;
const biweekly: Cadence = { mode: 'fixed', rule: { freq: 'weekly', interval: 2, byWeekday: [5], end: never }, anchorDate: TODAY };
const semimonthly: Cadence = { mode: 'fixed', rule: { freq: 'monthly', interval: 1, monthly: 'date', end: never }, anchorDate: '2026-11-15', semi: { a: { kind: 'day', day: 15, adjust: 'none' }, b: { kind: 'lastBusinessDay' } } };
const money = (c: number) => `$${(c / 100).toFixed(2)}`;
const hidden = () => '$••••';
const snapshot = async (d: FinanceDB) => JSON.stringify([await d.moduleRecords.toArray(), await d.links.toArray(), await d.txns.toArray(), await d.settings.toArray()]);
const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(createElement(MemoryRouter, null, el));

async function household() {
  const d = fresh();
  const clean = await createArrangement({ data: blankArrangement({ title: 'Invented cleaning', cadence: biweekly, expected: { basis: 'perVisit', cents: 15000 } }), provider: await providerNamed(d, 'Rosa Example'), assetIds: [], today: TODAY }, d);
  const pool = await createArrangement({ data: blankArrangement({ title: 'Invented pool care', cadence: semimonthly }), provider: await providerNamed(d, 'Blue Example'), assetIds: [], today: TODAY }, d);
  const paused = await createArrangement({ data: blankArrangement({ title: 'Invented snow plowing', status: 'paused', cadence: biweekly }), provider: await providerNamed(d, 'North Example'), assetIds: [], today: TODAY }, d);
  return { d, clean, pool, paused };
}

describe('D15 Services: the next visit, in words and as a date', () => {
  it('an active arrangement with an open Task has a dated next visit; one past its date is "Overdue", never "done"', () => {
    expect(nextVisitView('active', '2026-11-13', TODAY)).toEqual({ state: 'scheduled', date: '2026-11-13', label: 'Next visit' });
    expect(nextVisitView('active', TODAY, TODAY)).toMatchObject({ state: 'scheduled', label: 'Today' });
    expect(nextVisitView('active', '2026-11-02', TODAY)).toEqual({ state: 'overdue', date: '2026-11-02', label: 'Overdue' });
  });
  it('an active arrangement with no Task says nothing is scheduled; a paused or ended one says no visits are expected (never overdue)', () => {
    expect(nextVisitView('active', null, TODAY)).toMatchObject({ state: 'nothing', date: null, label: 'Nothing scheduled' });
    expect(nextVisitView('paused', '2026-01-01', TODAY)).toMatchObject({ state: 'inactive', date: null });
    expect(nextVisitView('ended', null, TODAY).label).toBe('Ended: no visits expected');
  });
  it('status and outcome tones keep their words; only a logged completion is "done"', () => {
    expect(ARRANGEMENT_TONE).toEqual({ active: 'active', paused: 'warning', ended: 'neutral' });
    expect(VISIT_TONE.completed).toBe('done');
    expect(VISIT_TONE.skipped).not.toBe('done');
    expect(VISIT_TONE.cancelled).not.toBe('done');
    expect(VISIT_TONE.unsupported).not.toBe('done');
  });
  it('groups rows under their date and keeps the given order', () => {
    const rows = [{ date: 'a', k: 1 }, { date: 'a', k: 2 }, { date: 'b', k: 3 }, { date: 'a', k: 4 }];
    expect(groupByDate(rows).map((g) => [g.date, g.rows.map((r) => r.k)])).toEqual([['a', [1, 2]], ['b', [3]], ['a', [4]]]);
  });
});

describe('D15 Services: arrangement cards say only what was entered', () => {
  it('shows the estimate with its basis only when one was entered; no estimate is never a price', async () => {
    const { d, clean } = await household();
    const od = await createArrangement({ data: blankArrangement({ title: 'Invented inspection' }), provider: null, assetIds: [], today: TODAY }, d);
    const snap = await loadSnapshot(d);
    const withEst = arrangementCard(buildRow(snap, snap.arrangements.find((a) => a.id === clean.id)!), TODAY, money);
    expect(withEst.estimate).toBe('Estimate $150.00 per visit');
    const none = arrangementCard(buildRow(snap, snap.arrangements.find((a) => a.id === od.id)!), TODAY, money);
    expect(none.estimate).toBeNull();
    expect(none.provider).toBe('No provider yet');
    expect(none.providerMissing).toBe(true);
    expect(none.next.state).toBe('nothing');
  });
  it('renders the list with a date tile, the provider, the cadence in words and a link to each arrangement; Hide amounts leaves no digits in the estimate', async () => {
    const { d, clean, paused } = await household();
    const ov = await loadServicesOverview('all', TODAY, d, undefined, 30);
    const out = html(createElement(ArrangementCards, { rows: ov.base.rows, today: TODAY, money, empty: 'None.' }));
    expect(out).toContain('ui-dtile');
    expect(out).toContain('Rosa Example');
    expect(out).toContain('Every 2 weeks on Fri');
    expect(out).toContain('Estimate $150.00 per visit');
    expect(out).toContain(`href="/a/${clean.id}"`);
    expect(out).toContain('Paused: no visits expected');
    expect(out).toContain(`href="/a/${paused.id}"`);
    const masked = html(createElement(ArrangementCards, { rows: ov.base.rows, today: TODAY, money: hidden, empty: 'None.' }));
    expect(masked).toContain('Estimate $••••');
    expect(masked).not.toContain('150.00'); // ids-ok: formatted money text, never an id
  });
  it('an empty list says so', () => {
    expect(html(createElement(ArrangementCards, { rows: [], today: TODAY, money, empty: 'None paused.' }))).toContain('None paused.');
  });
});

describe('D15 Services: biweekly and twice-monthly stay different, and the Calendar projection is the one that existed', () => {
  it('the cadence words differ, and the expected dates follow each rule (every 14 days; the 15th and the last business day)', async () => {
    const { d, clean, pool } = await household();
    const snap = await loadSnapshot(d);
    const a = snap.arrangements.find((x) => x.id === clean.id)!;
    const p = snap.arrangements.find((x) => x.id === pool.id)!;
    expect(cadenceText(a.data.cadence)).toBe('Every 2 weeks on Fri');
    expect(cadenceText(p.data.cadence)).toMatch(/^Twice monthly: the 15th and the last business day of the month/);
    const rowA = buildRow(snap, a); const rowP = buildRow(snap, p);
    const oa = occurrencesOf(a, rowA.tasks, TODAY, 100);
    const op = occurrencesOf(p, rowP.tasks, TODAY, 100);
    for (let i = 1; i < oa.dates.length; i++) expect((Date.parse(oa.dates[i]) - Date.parse(oa.dates[i - 1])) / 86400000).toBe(14);
    expect(op.dates.length).toBeGreaterThan(12);
    for (const x of op.dates) { const day = Number(x.slice(8)); expect(day === 15 || day >= 26).toBe(true); }
    expect(op.dates.some((x) => x.slice(8) === '15')).toBe(true);
    expect(op.dates.some((x) => Number(x.slice(8)) >= 26)).toBe(true);
  });
  it('the dates on the page are exactly the Calendar layer\'s own dates, after the one open Task, and the total is the 12-month count', async () => {
    const { d, clean } = await household();
    const snap = await loadSnapshot(d);
    const a = snap.arrangements.find((x) => x.id === clean.id)!;
    const row = buildRow(snap, a);
    const horizon = '2027-11-06';
    const calendar = plannedVisitDates(a, scheduleStateOf(row.tasks), TODAY, TODAY, horizon);
    const o = occurrencesOf(a, row.tasks, TODAY, 6);
    expect(o.total).toBe(calendar.length);
    expect(o.dates).toEqual(calendar.slice(0, 6));
    expect(calendar.length).toBeGreaterThanOrEqual(25);
    expect(row.open?.data.dueDate).toBeTruthy();
    for (const x of o.dates) expect(x > row.open!.data.dueDate!).toBe(true);
  });
  it('a paused or ended arrangement has no expected dates', async () => {
    const { d, paused } = await household();
    const snap = await loadSnapshot(d);
    const a = snap.arrangements.find((x) => x.id === paused.id)!;
    expect(occurrencesOf(a, [], TODAY).total).toBe(0);
  });
});

describe('D15 Services: one actionable Task per arrangement, and browsing creates nothing', () => {
  it('each recurring arrangement has exactly one open visit Task however many dates are shown', async () => {
    const { d, clean, pool } = await household();
    const snap = await loadSnapshot(d);
    for (const id of [clean.id, pool.id]) {
      const row = buildRow(snap, snap.arrangements.find((x) => x.id === id)!);
      expect(row.tasks.filter((t) => t.data.status !== 'done')).toHaveLength(1);
    }
    expect(snap.arrangements.find((x) => x.id === clean.id)).toBeDefined();
    const taskCount = (await d.moduleRecords.filter((r) => r.module === 'tasks').toArray()).length;
    expect(taskCount).toBe(2); // the paused one has none
  });
  it('loading the overview, working out the expected dates and drawing both lists write no row of any kind', async () => {
    const { d, clean } = await household();
    const before = await snapshot(d);
    const ov = await loadServicesOverview('all', TODAY, d, undefined, 90);
    const snap = await loadSnapshot(d);
    const a = snap.arrangements.find((x) => x.id === clean.id) as ArrangementRecord;
    occurrencesOf(a, buildRow(snap, a).tasks, TODAY, 6);
    html(createElement(UpcomingCard, { rows: ov.upcoming, total: ov.upcoming.length, days: 90, onDays: () => undefined, today: TODAY }));
    html(createElement(ArrangementCards, { rows: ov.base.rows, today: TODAY, money, empty: '' }));
    expect(await snapshot(d)).toBe(before);
  });
});

describe('D15 Services: the upcoming list keeps the Task and the expected dates apart', () => {
  it('groups by date under a tile; a Task is "Next visit (a task)" with an Open task link, an expected date is "Expected from schedule" with none; only a past Task is Overdue', async () => {
    const { d } = await household();
    const ov = await loadServicesOverview('all', TODAY, d, undefined, 90);
    const rows = ov.upcoming;
    expect(rows.some((r) => r.kind === 'task')).toBe(true);
    expect(rows.some((r) => r.kind === 'expected')).toBe(true);
    const out = html(createElement(UpcomingCard, { rows, total: rows.length, days: 90, onDays: () => undefined, today: TODAY }));
    expect(out).toContain('ui-dtile');
    expect(out).toContain(UPCOMING_KIND_WORDS.task);
    expect(out).toContain(UPCOMING_KIND_WORDS.expected);
    expect((out.match(/Open task/g) ?? []).length).toBe(rows.filter((r) => r.kind === 'task').length);
    expect(out).not.toContain('Overdue');
    const late = rows.map((r) => (r.kind === 'task' ? { ...r, overdue: true } : r));
    expect(html(createElement(UpcomingCard, { rows: late, total: late.length, days: 90, onDays: () => undefined, today: TODAY }))).toContain('Overdue');
  });
  it('the window still offers 7, 14, 30 and 90 days in one labelled select and says the Calendar keeps its 12 months', () => {
    const out = html(createElement(UpcomingCard, { rows: [], total: 0, days: 14, onDays: () => undefined, today: TODAY }));
    expect(out).toMatch(/<label[^>]*>Show the next<select/);
    for (const w of ['7 days', '14 days', '30 days', '90 days']) expect(out).toContain(`>${w}</option>`);
    expect(out).toMatch(/<option value="14" selected="">14 days<\/option>/);
  });
});

describe('D15 Services: sources', () => {
  const src = (f: string) => readFileSync(`src/modules/services/${f}`, 'utf8');
  const code = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  it('the new presentation file and the list parts write nothing and work out no schedule of their own', () => {
    for (const f of ['presentation.ts', 'VisitList.tsx']) expect(code(src(f)), f).not.toMatch(/\.(put|add|bulkPut|bulkAdd|update|delete)\(|ensureNextVisitTask|createTask|saveTask|transaction\(/);
    expect(code(src('presentation.ts'))).toContain("from './plannedVisits'");
    expect(code(src('presentation.ts'))).not.toMatch(/generateDates|nextCadenceDate|addDays|new Date/);
  });
  it('no assignment or ownership wording was added, and a visit in the past is never labelled completed by date alone', () => {
    const all = ['OverviewPage.tsx', 'OverviewParts.tsx', 'ArrangementPage.tsx', 'VisitList.tsx', 'presentation.ts'].map(src).join('\n');
    expect(all).not.toMatch(/Assigned to|Responsible for|Owned by/i);
    expect(code(src('presentation.ts'))).not.toMatch(/<\s*today\s*\?\s*'completed'|state: 'done'/);
  });
  it('the phone rules keep targets at 44px and keep the date tile beside its visits (no extra row per date)', () => {
    const css = src('services.css');
    expect(css).toMatch(/\.sv-day \{ display: grid; grid-template-columns: auto minmax\(0, 1fr\)/);
    expect(css).toMatch(/\.sv-seg label \{[^}]*min-height: 44px/);
    expect(css).toMatch(/\.sv-arr-card \{ grid-template-columns: 46px/);
  });
});
