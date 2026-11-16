import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { ModuleBase } from '../../../core/router';
import { previewAttention, rankAttention, type AttentionItem } from '../../../core/attention';
import { cashOutlook } from '../../../lib/cashOutlook';
import { loadForecast } from '../../../lib/forecastLive';
import type { LoadedForecast } from '../../../lib/forecastLive';
import { devices } from '../../bills/billsTestkit';
import type { CalItem } from '../../calendar/useCalendarData';
import { ALL_ON } from '../../calendar/layerVisibility';
import { readHouseholdOverview, type HouseholdOverview as FamilyOverview } from '../../family/householdOverview';
import { weekFamilyOf } from '../../family/weekReview';
import { loadOverview } from '../../assets/overviewData';
import { maintenanceOf } from '../../assets/weekReview';
import type { CommitmentRow } from '../../household/commitments';
import { TODAY as SEED_TODAY, digest, seed } from '../../household/householdSeed';
import { loadHouseholdOverview, type HouseholdOverview as MoneyOverview } from '../../household/overview';
import { weekMoneyOf } from '../../household/weekReview';
import { overBudgetOf, readOverBudgetProjects } from '../../projects/overBudget';
import { allWeekReaders } from '../../../core/registry';
import { registerModules } from '../../index';
import type { WeekFamily, WeekMaintenance, WeekMoney } from '../../../core/weekReaders';
import { blankProject } from '../../projects/model';
import type { ProjectRecord } from '../../projects/model';
import type { ProjectSummary } from '../../../lib/txnProject';
import { todayList, upcomingDays } from '../logic';
import { WeekView } from './WeekPage';
import { buildHome, moneyCovers, buildNeeds, buildSchedule, buildWeekReview, familyCovers, inWeek, ready, weekWindow, type WeekInputs } from './weekModel';
import { HIDDEN_AMOUNT, cashLine, rowAmount, totalsLines, weekText } from './weekText';

/** R1.2 This Week. Every name, date and amount is invented. */
const TODAY = '2026-11-08'; // a Sunday; the week is Nov 8 to Nov 14

let n = 0;
const cal = (o: Partial<CalItem> & { module?: string } = {}): CalItem => {
  const { module, ...rest } = o;
  return {
    key: `k${n++}`, title: 'Thing', layerId: 1, layerName: 'Personal', color: '#000', derived: !!module && module !== 'calendar', allDay: true, firstDay: TODAY, lastDay: TODAY,
    startMs: Date.parse(`${rest.firstDay ?? TODAY}T00:00:00`), endMs: 0, priority: 'medium', location: '', done: false, overdue: false, soon: false, recurring: false,
    source: module && module !== 'calendar' ? ({ sourceModule: module } as CalItem['source']) : undefined, ...rest,
  };
};
const need = (o: Partial<AttentionItem> = {}): AttentionItem => { n++; return { id: `assets:t${n}`, moduleId: 'assets', recordId: null, condition: null, kind: 'overdue', date: '2026-11-01', title: `Furnace filter ${n}`, reason: 'A maintenance task is overdue.', href: '#/assets/1', provenance: 'Home & Assets overview: overdue maintenance', ...o }; };

const row = (o: Partial<CommitmentRow> = {}): CommitmentRow => ({ id: `bill:1:${n++}`, module: 'bills', sourceId: 1, title: 'Power company', date: '2026-11-10', cents: 12000, certainty: 'known', note: '', href: '#/bills/o/1', foldedInto: null, ...o });
const moneyOverview = (rows: CommitmentRow[], extra: Partial<{ mayOverlap: boolean; consolidations: unknown[]; notConverted: unknown[] }> = {}, actions: unknown[] = []): MoneyOverview => ({
  commitments: { windows: [{ days: 7, rows, mayOverlap: false, consolidations: [], notConverted: [], ...extra }] },
  actions,
} as unknown as MoneyOverview);

const family = (o: { activities?: Partial<WeekFamily['activities'][number]>[]; dates?: Partial<WeekFamily['dates'][number]>[] } = {}): WeekFamily => ({
  dates: (o.dates ?? []).map((d, i) => ({ key: `d${i}`, date: '2026-11-10', title: 'A date', kind: 'Birthday', href: '#/family/dates', person: null, ...d })),
  activities: (o.activities ?? []).map((a, i) => ({ key: `a${i}`, openKey: `e:${i}`, title: 'Soccer', firstDay: '2026-11-10', when: 'All day', calendarName: 'Personal', href: '#/calendar?v=agenda', people: [], ...a })),
  hiddenActivities: 0,
});
const money = (rows: CommitmentRow[], extra: Parameters<typeof moneyOverview>[1] = {}, actions: unknown[] = []): WeekMoney => weekMoneyOf(moneyOverview(rows, extra, actions), TODAY);

const base = (over: Partial<WeekInputs> = {}): WeekInputs => ({
  today: TODAY,
  needs: ready({ ranked: [], failed: [] }), calendar: ready([]), money: ready(money([])), cash: ready(null),
  assets: ready([] as WeekMaintenance[]), overBudget: ready([]), family: ready(family()), ...over,
});

describe('the seven-day window', () => {
  it('is today and the six days after it, both ends included', () => {
    expect(weekWindow(TODAY)).toEqual({ from: '2026-11-08', to: '2026-11-14' });
    expect(inWeek('2026-11-08', TODAY)).toBe(true);
    expect(inWeek('2026-11-14', TODAY)).toBe(true);
    expect(inWeek('2026-11-15', TODAY)).toBe(false);
    expect(inWeek('2026-11-07', TODAY)).toBe(false);
  });
  it('crosses a month and a year, and a leap day, by the calendar', () => {
    expect(weekWindow('2026-12-28').to).toBe('2027-01-03');
    expect(weekWindow('2028-02-26').to).toBe('2028-03-03');
    expect(weekWindow('2026-02-25').to).toBe('2026-03-03');
  });
  it('the review states the exact range it covers, and a day later it moves by one day', () => {
    expect(buildWeekReview(base()).range).toBe('Nov 8 to Nov 14');
    expect(buildWeekReview(base({ today: '2026-11-09' })).range).toBe('Nov 9 to Nov 15');
    expect(buildWeekReview(base({ today: '2026-12-30' })).range).toBe('Dec 30, 2026 to Jan 5, 2027');
  });
});

describe('the schedule is Today\'s own lists, cut to the week', () => {
  const items = [
    cal({ title: 'Today thing' }),
    cal({ title: 'Tomorrow', firstDay: '2026-11-09', lastDay: '2026-11-09' }),
    cal({ title: 'Last day', firstDay: '2026-11-14', lastDay: '2026-11-14' }),
    cal({ title: 'Day eight', firstDay: '2026-11-15', lastDay: '2026-11-15' }),
    cal({ title: 'Yesterday late', firstDay: '2026-11-07', lastDay: '2026-11-07', overdue: true }),
    cal({ title: 'Done already', firstDay: '2026-11-10', lastDay: '2026-11-10', done: true }),
    cal({ title: 'Trip', firstDay: '2026-11-06', lastDay: '2026-11-09' }),
  ];
  it('keeps today through day seven, drops day eight, overdue leftovers and done items', () => {
    const s = buildSchedule(items, TODAY);
    const titles = s.days.flatMap((d) => d.items.map((i) => i.title));
    expect([...titles].sort()).toEqual(['Last day', 'Today thing', 'Tomorrow', 'Trip']); // the order within a day is Today's own (the next test pins it)
    expect(s.count).toBe(4);
  });
  it('agrees with todayList and upcomingDays, item for item', () => {
    const s = buildSchedule(items.filter((i) => !i.done), TODAY);
    const expected = [...todayList(items.filter((i) => !i.done), TODAY).map((i) => i.key), ...upcomingDays(items, TODAY, 6).flatMap((d) => d.items.map((i) => i.key))];
    expect(s.days.flatMap((d) => d.items.map((i) => i.key))).toEqual(expected);
  });
  it('leaves out only what Family presents itself, and only when Family was read', () => {
    const stored = cal({ title: 'Soccer', firstDay: '2026-11-10', lastDay: '2026-11-10', key: 'e:5:2026-11-10' });
    const bday = cal({ title: "Sam's birthday", module: 'family', firstDay: '2026-11-11', lastDay: '2026-11-11' });
    const other = cal({ title: 'Dentist', firstDay: '2026-11-11', lastDay: '2026-11-11' });
    const fam = family({ activities: [{ openKey: 'e:5:2026-11-10', title: 'Soccer' }] });
    expect(buildSchedule([stored, bday, other], TODAY, familyCovers(fam)).days.flatMap((d) => d.items.map((i) => i.title))).toEqual(['Dentist']);
    // Family could not be read: nothing is removed from the schedule.
    const r = buildWeekReview(base({ calendar: ready([stored, bday, other]), family: { state: 'failed' } }));
    expect(r.schedule.state === 'ready' && r.schedule.data.count).toBe(3);
    expect(r.unavailable).toContain('Family');
  });
});

describe('one occurrence is shown once', () => {
  it('a Bills "Due:" marker that matches a payment row in the Payments section is left out of the schedule; other Bills markers stay', () => {
    const mk = (id: string, title: string, date: string) => cal({ title, module: 'bills', firstDay: date, lastDay: date, source: { sourceModule: 'bills', id } as CalItem['source'] });
    const due = mk('bills:due-1-2026-11:2026-11-10', 'Due: Power company', '2026-11-10');
    const wrongDay = mk('bills:due-1-2026-11:2026-11-12', 'Due: Power company', '2026-11-12');
    const otherBill = mk('bills:due-2-2026-11:2026-11-10', 'Due: Water', '2026-11-10');
    const renewal = mk('bills:renewal-1:2026-11-10', 'Renewal: Power company', '2026-11-10');
    const rows = [row({ sourceId: 1, date: '2026-11-10' })];
    const r = buildWeekReview(base({ calendar: ready([due, wrongDay, otherBill, renewal]), money: ready(money(rows)) }));
    expect(r.schedule.state === 'ready' && r.schedule.data.days.flatMap((d) => d.items.map((i) => i.title)).sort()).toEqual(['Due: Power company', 'Due: Water', 'Renewal: Power company']);
    expect(moneyCovers(rows)(due)).toBe(true);
    // Payments could not be read: the markers stay, so nothing disappears from the review
    const down = buildWeekReview(base({ calendar: ready([due]), money: { state: 'failed' } }));
    expect(down.schedule.state === 'ready' && down.schedule.data.count).toBe(1);
  });
});

describe('Needs you is reused, not redone', () => {
  const ranked = rankAttention([
    need({ id: 'assets:a', date: '2026-10-01' }), need({ id: 'assets:b', date: '2026-10-02' }), need({ id: 'bills:c', moduleId: 'bills', date: '2026-10-03' }),
    need({ id: 'assets:d', date: '2026-10-04' }), need({ id: 'projects:e', moduleId: 'projects', date: '2026-10-05' }), need({ id: 'assets:f', date: '2026-10-06' }),
    need({ id: 'projects:g', moduleId: 'projects', date: '2026-10-07' }),
  ], TODAY);
  it('shows the very five items and the true remainder that Today\'s section shows, in the same order', () => {
    const w = buildNeeds({ ranked, failed: [] });
    const p = previewAttention(ranked);
    expect(w.shown.map((i) => i.id)).toEqual(p.shown.map((i) => i.id));
    expect([w.total, w.remaining]).toEqual([7, 2]);
    expect(w.urgent).toBe(ranked.filter((i) => i.tier === 1).length);
  });
  it('the same condition reported by two modules stays one item (R1.1 identity), and the review never lists it twice in Home and projects', () => {
    const twice = rankAttention([need({ id: 'assets:x', condition: 'task:9:overdue' }), need({ id: 'tasks:x', moduleId: 'tasks', condition: 'task:9:overdue' })], TODAY);
    expect(twice).toHaveLength(1);
    const r = buildWeekReview(base({ needs: ready({ ranked, failed: [] }), calendar: ready([]) }));
    const shownIds = r.needs.state === 'ready' ? r.needs.data.shown.map((i) => i.id) : [];
    const homeKeys = r.home.state === 'ready' ? r.home.data.items.map((i) => i.key) : [];
    expect(homeKeys.filter((k) => shownIds.includes(k))).toEqual([]);
    expect(homeKeys.sort()).toEqual(ranked.filter((i) => (i.moduleId === 'assets' || i.moduleId === 'projects') && !shownIds.includes(i.id)).map((i) => i.id).sort());
  });
  it('a module that could not be read is named in the review as incomplete, never treated as zero', () => {
    const r = buildWeekReview(base({ needs: ready({ ranked: [], failed: ['bills'] }) }));
    expect(r.unavailable).toEqual(['Needs you (some modules)']);
    expect(r.quiet).toBe(false);
  });
});

describe('payments and commitments are not double counted or mislabelled', () => {
  const win = [
    row({ id: 'bill:1:a', date: '2026-11-08', cents: 12000, certainty: 'known' }),
    row({ id: 'bill:2:a', sourceId: 2, title: 'Water', date: '2026-11-09', cents: 4000, certainty: 'estimated' }),
    row({ id: 'bill:3:a', sourceId: 3, title: 'Mystery', date: '2026-11-10', cents: null, certainty: 'unknown' }),
    row({ id: 'bill:4:a', sourceId: 4, title: 'Disputed', date: '2026-11-11', cents: null, certainty: 'disputed' }),
    row({ id: 'visit:9:a', module: 'services', sourceId: 9, title: 'Cleaning', date: '2026-11-12', cents: 12000, certainty: 'estimated', foldedInto: 'bill:1' }),
    row({ id: 'bill:5:a', sourceId: 5, title: 'Day eight', date: '2026-11-15', cents: 999, certainty: 'known' }), // B5's "7 days" window reaches day 8; the week does not
    row({ id: 'bill:6:a', sourceId: 6, title: 'Day zero minus one', date: '2026-11-07', cents: 777, certainty: 'known' }),
  ];
  const m = money(win);
  it('lists only rows inside the seven days, and not a service row that is folded into its linked bill', () => {
    expect(m.rows.map((r) => r.id)).toEqual(['bill:1:a', 'bill:2:a', 'bill:3:a', 'bill:4:a']);
    expect(m.folded).toBe(1);
  });
  it('tallies with B5\'s own addRow: fixed and estimated are separate, unknown and disputed are counted and never added as zero', () => {
    expect(m.totals).toEqual({ known: { cents: 12000, count: 1 }, estimated: { cents: 4000, count: 1 }, unknown: { count: 1 }, disputed: { count: 1 } });
    // the rows listed are the ones tallied: nothing in the tally comes from a row that is not listed
    expect(m.rows.reduce((n, r) => n + (r.certainty === 'known' ? (r.cents ?? 0) : 0), 0)).toBe(m.totals.known.cents);
    expect(m.rows.reduce((n, r) => n + (r.certainty === 'estimated' ? (r.cents ?? 0) : 0), 0)).toBe(m.totals.estimated.cents);
    const lines = totalsLines(m.totals, false);
    expect(lines).toHaveLength(4);
    expect(lines.join('\n')).not.toMatch(/\$160\.00/); // ids-ok: a dollar figure, not an id (120.00 + 40.00 is never shown as one figure)
  });
  it('says what each amount is, in words', () => {
    expect(rowAmount(win[0], false)).toBe('$120.00');
    expect(rowAmount(win[1], false)).toBe('about $40.00');
    expect(rowAmount(win[2], false)).toBe('amount not known');
    expect(rowAmount(win[3], false)).toBe('amount in dispute');
    expect(rowAmount(win[0], true)).toBe(HIDDEN_AMOUNT);
  });
  it('warns about an overlap only when a listed bill or arrangement is in an unproven pair', () => {
    const cons = [{ status: 'uncertain', billId: 1, arrangementId: 9 }];
    expect(money(win, { mayOverlap: true, consolidations: cons }).overlap).toBe(true);
    expect(money(win, { mayOverlap: true, consolidations: [{ status: 'uncertain', billId: 77, arrangementId: 88 }] }).overlap).toBe(false);
    expect(money(win, { mayOverlap: true, consolidations: [{ status: 'folded', billId: 1, arrangementId: 9 }] }).overlap).toBe(false);
  });
  it('contract dates are cut to the week', () => {
    const o = money([], {}, [{ id: 'a', date: '2026-11-14' }, { id: 'b', date: '2026-11-15' }, { id: 'c', date: '2026-11-07' }]);
    expect(o.contractDates.map((a) => a.id)).toEqual(['a']);
  });
  it('cash outlook is Finance\'s own function: the week figure is its 7-day horizon, the long one is the same 90 days Today shows', () => {
    const f = { cashAccounts: 1, thresholdCents: 100000, floorCents: 0, input: { startCents: 500000 }, result: { events: [{ date: '2026-11-10', balanceCents: 450000 }, { date: '2026-11-20', balanceCents: 80000 }] } } as unknown as LoadedForecast;
    const r = buildWeekReview(base({ cash: ready(f) }));
    expect(r.cash.state === 'ready' && r.cash.data).toEqual({ week: cashOutlook(f, TODAY, 6), ninety: cashOutlook(f, TODAY, 90) });
    expect(r.cash.state === 'ready' && r.cash.data.week?.lowCents).toBe(450000);
    expect(r.cash.state === 'ready' && r.cash.data.ninety?.below).toBe(true);
    expect(cashLine(cashOutlook(f, TODAY, 6)!, 'this week', true)).not.toMatch(/\d{2},?\d{3}/);
  });
});

describe('projects over budget come from the project summary and nothing else', () => {
  const proj = (id: number, over: Partial<ProjectRecord['data']> = {}): ProjectRecord => ({ id, createdAt: id, updatedAt: id, data: { ...blankProject(), name: `Project ${id}`, status: 'active', ...over } });
  const sum = (budget: number, expected: number, over = expected > budget): ProjectSummary => ({ budgetCents: budget, expectedTotalCents: expected, flags: { overBudget: over } } as unknown as ProjectSummary);
  it('lists active projects with a budget whose own flag says over, most over first, with the difference the project page shows', () => {
    const list = overBudgetOf(
      [proj(1), proj(2), proj(3, { status: 'completed' }), proj(4, { archived: true }), proj(5), proj(6)],
      new Map([[1, sum(100000, 130000)], [2, sum(100000, 90000)], [3, sum(100000, 200000)], [4, sum(100000, 200000)], [5, sum(0, 50000, true)], [6, sum(100000, 250000)]]),
    );
    expect(list.map((p) => [p.id, p.overCents])).toEqual([[6, 150000], [1, 30000]]);
  });
});

describe('home and projects', () => {
  it('adds over-budget projects and maintenance after this week (within 30 days) and leaves this week\'s maintenance to the schedule', () => {
    const assets = maintenanceOf({ upcoming: [
      { taskId: 1, title: 'Gutters', dueDate: '2026-11-12', overdue: false, assetIds: [3] },
      { taskId: 2, title: 'Furnace service', dueDate: '2026-11-20', overdue: false, assetIds: [3] },
      { taskId: 3, title: 'Far away', dueDate: '2027-02-01', overdue: false, assetIds: [3] },
      { taskId: 4, title: 'Late one', dueDate: '2026-11-01', overdue: true, assetIds: [3] },
    ] });
    const h = buildHome({ today: TODAY, needs: null, ranked: [], assets, overBudget: [{ id: 7, name: 'Kitchen', budgetCents: 100000, expectedTotalCents: 120000, overCents: 20000, href: '#/projects/7' }] });
    expect(h.items.map((i) => i.title)).toEqual(['Kitchen', 'Furnace service']);
  });
  it('a source that fails leaves the rest of the section, and is reported', () => {
    const r = buildWeekReview(base({ assets: { state: 'failed' }, overBudget: ready([{ id: 7, name: 'Kitchen', budgetCents: 100000, expectedTotalCents: 120000, overCents: 20000, href: '#/projects/7' }]) }));
    expect(r.home.state === 'ready' && r.home.data.items.map((i) => i.title)).toEqual(['Kitchen']);
    expect(r.unavailable).toEqual(['Home and projects']);
  });
});

describe('empty and partial households', () => {
  it('a nearly empty household is a quiet week: no tiles, no sections, no placeholders', () => {
    const r = buildWeekReview(base());
    expect(r.quiet).toBe(true);
    expect(r.summary).toEqual([]);
    const html = renderToStaticMarkup(<MemoryRouter><ModuleBase value="/today"><WeekView review={r} hide={false} /></ModuleBase></MemoryRouter>);
    expect(html).toContain('A quiet week');
    expect(html).not.toContain('wk-card');
  });
  it('money with no calendar, calendar with no money, and nothing from projects each leave the other sections working', () => {
    const onlyMoney = buildWeekReview(base({ money: ready(money([row()])) }));
    expect(onlyMoney.summary.map((t) => t.id)).toEqual(['payments']);
    const onlyCal = buildWeekReview(base({ calendar: ready([cal({ title: 'Picnic' })]) }));
    expect(onlyCal.summary.map((t) => t.id)).toEqual(['calendar']);
    expect(onlyCal.quiet).toBe(false);
  });
  it('while something is still loading the review says so and is not "quiet"; one failed source never blocks the others', () => {
    const loading = buildWeekReview(base({ money: { state: 'loading' } }));
    expect([loading.loading, loading.quiet]).toEqual([true, false]);
    const failed = buildWeekReview(base({ money: { state: 'failed' }, calendar: ready([cal({ title: 'Picnic' })]) }));
    expect(failed.unavailable).toEqual(['Payments']);
    expect(failed.schedule.state === 'ready' && failed.schedule.data.count).toBe(1);
  });
});

describe('the module readers are offered through the registry, not imported', () => {
  it('every reader the page needs is registered by its module, with no module screen opened', () => {
    registerModules();
    expect(Object.keys(allWeekReaders()).sort()).toEqual(['family', 'maintenance', 'money', 'overBudget']);
  });
  it("the review's own files import no module (the same rule Needs you follows), only core, lib, the Calendar hook and Today", () => {
    const dir = resolve('src/modules/today/week');
    for (const f of readdirSync(dir).filter((x) => /\.(ts|tsx)$/.test(x) && !/\.test\./.test(x))) {
      const text = readFileSync(join(dir, f), 'utf8');
      const mods = [...text.matchAll(/from '\.\.\/\.\.\/(?!calendar)([a-z]+)\//g)].map((m) => m[1]);
      expect(mods, f).toEqual([]);
    }
  });
  it("Family's reader sends its own addresses (never a path under Today), a semantic color id, and only the week", () => {
    const person = { memberId: 3, contactId: 30, name: 'Sam Demo', color: '#2563eb' };
    const o = {
      people: [], tasks: { items: [] },
      activities: { hidden: [{ key: 'h', memberIds: [3] }], items: [{ key: '5:x', openKey: 'e:5:x', title: 'Soccer', firstDay: '2026-11-11', lastDay: '2026-11-11', allDay: true, startMs: 0, endMs: 0, calendarName: 'Personal', recurring: false, done: false, people: [person] }] },
      dates: [
        { key: 'b3', type: 'birthday', title: "Sam's birthday", date: '2026-11-10', onCalendar: true, person },
        { key: 'd1', type: 'anniversary', title: 'Anniversary', date: '2026-11-25', onCalendar: true },
        { key: 'd2', type: 'other', title: 'Past', date: '2026-11-07', onCalendar: true },
      ],
    } as unknown as FamilyOverview;
    const w = weekFamilyOf(o, TODAY);
    expect(w.dates.map((d) => d.key)).toEqual(['b3']);
    expect(w.dates[0].href).toBe('#/family/m/3');
    expect(w.activities[0].people[0]).toMatchObject({ memberId: 3, name: 'Sam Demo', href: '#/family/m/3' });
    expect(w.activities[0].href).toContain('#/calendar');
    expect(w.hiddenActivities).toBe(1);
    expect(JSON.stringify(w)).not.toContain('#2563eb'); // a stored color value is never passed on
    const html = renderToStaticMarkup(<MemoryRouter><ModuleBase value="/today"><WeekView review={buildWeekReview(base({ family: ready(w) }))} hide={false} /></ModuleBase></MemoryRouter>);
    expect(html).toContain('href="#/family/m/3"');
    expect(html).not.toContain('/today/family');
    expect(html).toContain('Sam Demo');
  });
});

describe('Hide amounts covers the screen, the paper and the copied text', () => {
  const f = { cashAccounts: 1, thresholdCents: 100000, floorCents: 0, input: { startCents: 500000 }, result: { events: [{ date: '2026-11-10', balanceCents: 450000 }] } } as unknown as LoadedForecast;
  const inputs = base({
    calendar: ready([cal({ title: 'Pay the $250 deposit', firstDay: '2026-11-09', lastDay: '2026-11-09' })]),
    money: ready(money([row(), row({ id: 'bill:2:a', title: 'Water', cents: 4000, certainty: 'estimated' })])),
    cash: ready(f),
    overBudget: ready([{ id: 7, name: 'Kitchen', budgetCents: 1000000, expectedTotalCents: 1234500, overCents: 234500, href: '#/projects/7' }]),
  });
  const review = buildWeekReview(inputs);
  const html = (hide: boolean) => renderToStaticMarkup(<MemoryRouter><ModuleBase value="/today"><WeekView review={review} hide={hide} /></ModuleBase></MemoryRouter>);
  it('with amounts shown the money is there (so the test below proves something)', () => {
    expect(html(false)).toContain('$120.00');
    expect(html(false)).toContain('$2,345.00');
    expect(weekText(review, false)).toContain('$4,500.00');
  });
  it('hidden: no dollar figure on the screen markup (which is also what is printed), and none in the copied text', () => {
    const h = html(true);
    expect(h).not.toMatch(/\$\s?\d/);
    expect(h).toContain(HIDDEN_AMOUNT);
    const t = weekText(review, true);
    expect(t).not.toMatch(/\$\s?\d/);
    expect(t).toContain(HIDDEN_AMOUNT);
    expect(t).toContain('Amounts are hidden.');
  });
});

describe('the copied text', () => {
  const ranked = rankAttention([need({ id: 'assets:q', title: 'Replace furnace filter', date: '2026-11-01' })], TODAY);
  const r = buildWeekReview(base({
    needs: ready({ ranked, failed: [] }),
    calendar: ready([cal({ title: 'Dentist', firstDay: '2026-11-10', lastDay: '2026-11-10' })]),
    money: ready(money([row()])),
  }));
  const t = weekText(r, false);
  it('is plain words in sections: the range, what needs attention, the schedule and the payments, saying plainly that nothing is paid', () => {
    expect(t).toContain('This Week: Your household at a glance');
    expect(t).toContain('Nov 8 to Nov 14');
    expect(t).toContain('NEEDS YOU (1)');
    expect(t).toContain('Replace furnace filter');
    expect(t).toContain('SCHEDULE');
    expect(t).toContain('Dentist');
    expect(t).toContain('PAYMENTS AND COMMITMENTS');
    expect(t).toContain('Nothing here says a payment has been made.');
  });
  it('carries no internal ids, links or record numbers, and leaves empty sections out', () => {
    expect(t).not.toMatch(/assets:q|#\/|bill:1/);
    expect(t).not.toContain('FAMILY');
    expect(t).not.toContain('CASH OUTLOOK');
    expect(t).not.toContain('HOME AND PROJECTS');
  });
  it('says so when part of the review could not be read', () => {
    const bad = weekText(buildWeekReview(base({ money: { state: 'failed' } })), false);
    expect(bad).toContain('Not included');
    expect(bad).toContain('Payments');
    expect(bad).toContain('incomplete');
  });
});

describe('opening the review writes nothing', () => {
  it('every reader the page uses leaves every table of a real database exactly as it was', async () => {
    const { A } = devices();
    await seed(A.d);
    const before = await digest(A.d);
    const [seeded] = await Promise.all([loadHouseholdOverview('all', SEED_TODAY, A.d), loadOverview('all', SEED_TODAY, A.d), readOverBudgetProjects(A.d), readHouseholdOverview(SEED_TODAY, ALL_ON, A.d), loadForecast(A.d, SEED_TODAY)]);
    await loadHouseholdOverview('all', SEED_TODAY, A.d);
    expect(weekMoneyOf(seeded, SEED_TODAY).rows.every((x) => inWeek(x.date, SEED_TODAY))).toBe(true);
    expect(await digest(A.d)).toBe(before);
  });
  it('the review\'s own files contain no database write, no network call and no storage write (the Hide amounts switch is the existing preference and is the only storage use)', () => {
    const dir = resolve('src/modules/today/week');
    const files = [...readdirSync(dir).filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f)).map((f) => join(dir, f)), ...['projects/overBudget.ts', 'household/weekReview.ts', 'family/weekReview.ts', 'assets/weekReview.ts'].map((f) => resolve('src/modules', f)), resolve('src/core/weekReaders.ts')];
    expect(files.length).toBeGreaterThanOrEqual(9);
    for (const f of files) {
      const src = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      expect(src, f).not.toMatch(/\.(put|add|update|delete|bulkPut|bulkAdd|bulkDelete|transaction|clear)\(|fetch\(|localStorage|sessionStorage|indexedDB/);
    }
  });
});
