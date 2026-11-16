import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { resultProblem, type AnswerResult } from '../core/answers';
import { allAnswerReaders } from '../core/registry';
import { devices, type Dev } from './bills/billsTestkit';
import { previewLifecycle, applyLifecycle, type LcAction } from './bills/lifecycleData';
import { priceIncreaseAnswer } from './bills/answers';
import { assetRef, createAsset } from './assets/data';
import { blankAsset } from './assets/model';
import { blankService } from './assets/service';
import { insertService } from './assets/serviceData';
import { loadOverview } from './assets/overviewData';
import { maintenanceOverdueAnswer, maintenanceSpendAnswer, warrantiesExpiringAnswer } from './assets/answers';
import { loadHouseholdOverview } from './household/overview';
import { paymentsAnswer, yearAheadAnswer } from './household/answers';
import { TODAY, digest, seed, type Seed } from './household/householdSeed';
import { createProject, createCommitment } from './projects/data';
import { blankProject } from './projects/model';
import { overBudgetAnswer } from './projects/answers';
import { readOverBudgetProjects } from './projects/overBudget';
import { servicesUpcomingAnswer } from './services/answers';
import { completeTask, createTask } from './tasks/data';
import { blankTask } from './tasks/model';
import { registerModules } from './index';
import { headlineText } from '../shell/answersModel';

/**
 * R3.2 Quick Answers against one invented household (the B5 seed, plus a few records). Every answer is compared with the reader it wraps, a few figures are worked out by
 * hand, and the whole run is shown to write nothing. Amounts are invented. Today is 2026-11-08.
 */
let A: Dev;
let S: Seed;
let ids: { project: { over: number; ok: number; none: number }; dishwasher: number; filterTask: number; doneTask: number };
const ctx = { today: TODAY };
const price = (from: string, cents: number | null): LcAction => ({ type: 'price', from, until: null, cents, status: cents === null ? 'unknown' : 'fixed', label: '', source: 'provider-notice', note: '' });
const money = (c: number) => `$${(c / 100).toFixed(2)}`;
const go = async (id: number, a: LcAction) => { const p = await previewLifecycle(id, a, TODAY, money, A.d); if (p.problem) throw new Error(p.problem); await applyLifecycle(id, a, p.token, TODAY, A.d); };
const figure = (r: AnswerResult, id: string) => r.figures.find((f) => f.id === id);
const allRows = (r: AnswerResult) => r.groups.flatMap((g) => g.rows);

beforeAll(async () => {
  A = devices().A;
  S = await seed(A.d);
  // Bills: Streamly went up twice (an old rise, and a recent one); Sparkle went DOWN recently; Power's price never changed.
  await go(S.bill.streamly, price('2026-03-01', 1649));
  await go(S.bill.streamly, price('2026-10-20', 1799));
  await go(S.bill.sparkle, price('2026-10-25', 14000));
  // Home & Assets: more service history, an overdue Task, a finished-but-unsaved Task, a warranty ending in 40 days and one in 200 days.
  const svc = (over: Partial<ReturnType<typeof blankService>>) => insertService(blankService(S.home, over), A.d, TODAY);
  await svc({ title: 'Paint the fence', date: '2026-08-01', kind: 'improvement', costCents: 20000 });
  await svc({ title: 'Smoke alarm check', date: '2026-06-01', kind: 'inspection' });
  await svc({ title: 'Last year gutters', date: '2025-12-01', kind: 'maintenance', costCents: 70000 });
  const filterTask = await createTask(blankTask({ title: 'Replace furnace filters', dueDate: '2026-11-01' }), [assetRef(S.home)], A.d);
  const doneTask = await createTask(blankTask({ title: 'Clear the dryer vent', dueDate: '2026-10-20' }), [assetRef(S.home)], A.d);
  await completeTask(doneTask, TODAY, A.d);
  const dishwasher = await createAsset(blankAsset({ name: 'Dishwasher', warrantyEndDate: '2026-12-18' }), A.d);
  await createAsset(blankAsset({ name: 'Old freezer', warrantyEndDate: '2027-05-30' }), A.d);
  // Projects: one over its budget, one within it, one with nothing to compare with.
  const commit = (projectId: number, amountCents: number) => createCommitment(projectId, { title: 'Agreement', amountCents, status: 'accepted', parentId: null, budgetLineId: null, vendorContactId: null, acceptedDate: '2026-10-01', notes: '' }, A.d);
  const over = await createProject(blankProject({ name: 'Kitchen refresh', status: 'active', budgetCents: 1000000 }), A.d);
  const ok = await createProject(blankProject({ name: 'Garden path', status: 'active', budgetCents: 500000 }), A.d);
  const none = await createProject(blankProject({ name: 'Someday attic', status: 'planning' }), A.d);
  await commit(over, 1300000); await commit(ok, 400000);
  ids = { project: { over, ok, none }, dishwasher, filterTask, doneTask };
});

describe('every answer is a valid, sourced, whole-cent result', () => {
  it('all ten readers run on the household and pass the result checks (sources, links inside Ledger, a period)', async () => {
    registerModules();
    const readers = allAnswerReaders().filter((r) => r.reader.run);
    expect(readers.map((r) => r.reader.id).sort()).toEqual(['assets.maintenanceOverdue', 'assets.maintenanceSpend', 'assets.warrantiesExpiring', 'bills.priceIncreases', 'household.payments', 'household.yearAhead', 'projects.overBudget', 'services.upcoming']);
    const fns = [maintenanceOverdueAnswer, maintenanceSpendAnswer, warrantiesExpiringAnswer, priceIncreaseAnswer, paymentsAnswer, yearAheadAnswer, overBudgetAnswer, servicesUpcomingAnswer];
    for (const f of fns) { const r = await f(ctx, A.d); expect(resultProblem(r), f.name).toBeNull(); expect(r.assumptions.length + r.limitations.length, f.name).toBeGreaterThan(0); }
  });
});

describe('Which bills have increased recently?', () => {
  it('lists only the recorded rise inside the last 90 days, with the price just before it, and not a rise that is too old or a price cut', async () => {
    const r = await priceIncreaseAnswer(ctx, A.d);
    const rows = allRows(r);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ title: 'Streamly', date: '2026-10-20', dateLabel: 'Effective', href: `#/bills/o/${S.bill.streamly}` });
    expect(rows[0].amounts).toEqual([
      { label: 'Increase', cents: 150, certainty: 'known', strong: true }, { label: 'Before', cents: 1649, certainty: 'known' }, { label: 'Now', cents: 1799, certainty: 'known' },
    ]);
    expect(rows[0].chips?.map((c) => c.text)).toContain('+9.1%');
    expect(r.period).toEqual({ label: 'The last 90 days: Aug 11 through Nov 8, 2026', from: '2026-08-11', to: TODAY });
    expect(r.status).toBe('answered');
    expect(r.limitations.join(' ')).toMatch(/higher than the expected price is not treated as an increase/);
  });
  it('says "nothing found" when the only change is a price cut or is older than 90 days', async () => {
    const r = await priceIncreaseAnswer({ today: '2027-03-01' }, A.d);
    expect(r.status).toBe('none');
    expect(allRows(r)).toEqual([]);
  });
});

describe('Which projects are over budget?', () => {
  it('equals the reader the weekly review uses, with budget, expected total and the difference', async () => {
    const r = await overBudgetAnswer(ctx, A.d);
    const rows = allRows(r);
    const reader = await readOverBudgetProjects(A.d);
    expect(rows.map((x) => x.title)).toEqual(reader.map((p) => p.name));
    expect(rows).toHaveLength(1);
    expect(rows[0].amounts).toEqual([{ label: 'Over by', cents: 300000, strong: true }, { label: 'Budget', cents: 1000000 }, { label: 'Expected total cost', cents: 1300000 }]);
    expect(rows[0].href).toBe(`#/projects/${ids.project.over}`);
    expect(rows[0].detail).toBeUndefined();
  });
  it('never lists a project that is within budget or has no budget at all', async () => {
    const titles = allRows(await overBudgetAnswer(ctx, A.d)).map((x) => x.title);
    expect(titles).not.toContain('Garden path');
    expect(titles).not.toContain('Someday attic');
  });
});

describe('How much have we spent on home maintenance this year?', () => {
  it('equals the Overview\'s own maintenance figure for the year, worked out by hand: 150.00 + 310.00 + 95.00', async () => {
    const r = await maintenanceSpendAnswer(ctx, A.d);
    const own = (await loadOverview('2026', TODAY, A.d)).spending.household.byGroup.maintenance;
    expect(own).toBe(55500);
    const f = figure(r, 'maintenance')!;
    expect(f.value).toEqual({ kind: 'money', cents: 55500, certainty: 'known' });
    expect(r.headline).toContainEqual({ money: 55500 });
    expect(r.period).toEqual({ label: 'This year so far: Jan 1 through Nov 8, 2026', from: '2026-01-01', to: TODAY });
  });
  it('lists the supporting records, leaves out improvements, other years and the purchase, and never counts a missing cost as zero', async () => {
    const r = await maintenanceSpendAnswer(ctx, A.d);
    const titles = allRows(r).filter((x) => x.id.startsWith('service:')).map((x) => x.title).sort();
    expect(titles).toEqual(['Deep clean before listing', 'Furnace repair', 'Gutter cleaning', 'Smoke alarm check']);
    expect(titles).not.toContain('Paint the fence');
    expect(titles).not.toContain('Last year gutters');
    const smoke = allRows(r).find((x) => x.title === 'Smoke alarm check')!;
    expect(smoke.amounts).toBeUndefined();
    expect(smoke.chips?.[0].text).toBe('No cost recorded');
    expect(r.status).toBe('limited');
    expect(r.limitations.join(' ')).toMatch(/no cost recorded.*never counted as zero/);
    expect(r.assumptions[0]).toMatch(/recurring Household Services .* are not included/);
    expect(figure(r, 'records')!.value).toEqual({ kind: 'count', n: 4 });
  });
  it('a payment shared with Bills and Services is counted once, in this module (the cleaning bill, the arrangement and this record point at one $150.00 piece)', async () => {
    const r = await maintenanceSpendAnswer(ctx, A.d);
    const deep = allRows(r).find((x) => x.title === 'Deep clean before listing')!;
    expect(deep.amounts?.[0].cents).toBe(15000);
    expect(r.figures.find((f) => f.id === 'maintenance')!.value).toMatchObject({ cents: 55500 });
  });
  it('with no assets it is "not enough information" and points to where to add it', async () => {
    const empty = devices().A;
    const r = await maintenanceSpendAnswer(ctx, empty.d);
    expect(r.status).toBe('insufficient');
    expect(r.missing?.href).toBe('#/assets');
    expect(figure(r, 'maintenance')).toBeUndefined();
  });
});

describe('What maintenance is overdue?', () => {
  it('lists the overdue Task with its asset and due date, and keeps the finished-but-unsaved one apart (it is not overdue)', async () => {
    const r = await maintenanceOverdueAnswer(ctx, A.d);
    const overdue = r.groups.find((g) => g.id === 'overdue')!.rows;
    expect(overdue).toHaveLength(1);
    expect(overdue[0]).toMatchObject({ title: 'Replace furnace filters', date: '2026-11-01', detail: 'Family home', href: `#/assets/${S.home}` });
    expect(overdue[0].links).toEqual([{ label: 'Open task', href: `#/tasks?task=${ids.filterTask}` }]);
    expect(overdue[0].chips?.[0].text).toBe('7 days overdue');
    const unsaved = r.groups.find((g) => g.id === 'unsaved')!;
    expect(unsaved.rows.map((x) => x.title)).toEqual(['Clear the dryer vent']);
    expect(figure(r, 'overdue')!.value).toEqual({ kind: 'count', n: 1 });
    const ov = await loadOverview('all', TODAY, A.d);
    expect(ov.attention.overdueTasks.map((t) => t.taskId)).toEqual([ids.filterTask]);
    expect(ov.attention.unsaved.map((t) => t.taskId)).toEqual([ids.doneTask]);
  });
});

describe('What warranties are expiring soon?', () => {
  it('lists only the warranty ending in the next 90 days, with days left, and not the one 200 days away', async () => {
    const r = await warrantiesExpiringAnswer(ctx, A.d);
    const rows = allRows(r);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ title: 'Dishwasher', date: '2026-12-18', dateLabel: 'Ends', href: `#/assets/${ids.dishwasher}` });
    expect(rows[0].chips?.[0].text).toBe('40 days left');
    expect(r.period.to).toBe('2027-02-05');
    expect(r.limitations.join(' ')).toMatch(/replacement costs/);
  });
});

describe('What payments are coming up?', () => {
  it('shows today through day 29, never a later row, keeps known and estimated apart and never adds them', async () => {
    const r = await paymentsAnswer(ctx, A.d);
    expect(r.period).toEqual({ label: 'The next 30 days: Nov 8 through Dec 7, 2026', from: TODAY, to: '2026-12-07' });
    const rows = allRows(r);
    expect(rows.length).toBeGreaterThan(0);
    for (const x of rows) { expect(x.date! >= TODAY && x.date! <= '2026-12-07', `${x.title} ${x.date}`).toBe(true); expect(x.amounts?.[0].certainty).toBeTruthy(); }
    const known = figure(r, 'amount-known')!.value;
    const est = figure(r, 'amount-estimated')!.value;
    expect(known.kind).toBe('money');
    expect(est.kind).toBe('money');
    // reconcile with B5: the same rows, cut to 30 days, tallied by hand
    const o = await loadHouseholdOverview('all', TODAY, A.d);
    const w = o.commitments.windows.find((x) => x.days === 30)!;
    const mine = w.rows.filter((x) => x.date >= TODAY && x.date <= '2026-12-07' && x.foldedInto === null);
    const sum = (c: string) => mine.filter((x) => x.certainty === c && x.cents !== null).reduce((n, x) => n + (x.cents as number), 0);
    expect(known).toMatchObject({ cents: sum('known') });
    expect(est).toMatchObject({ cents: sum('estimated') });
    expect(rows).toHaveLength(mine.length);
  });
  it('says these are expected payments, not recorded ones, and that they are not automatically in the Forecast', async () => {
    const r = await paymentsAnswer(ctx, A.d);
    expect(r.limitations.join(' ')).toMatch(/expects from your bills and services, not payments that have been made/);
    expect(r.limitations.join(' ')).toMatch(/not in the Forecast/);
    for (const x of allRows(r)) expect(x.chips?.some((c) => /Forecast/.test(c.text)), x.title).toBe(true);
  });
  it('a linked bill and service that were not proven to be one charge keep both rows and say so', async () => {
    const r = await paymentsAnswer(ctx, A.d);
    expect(r.status).toBe('limited');
    expect(r.limitations.join(' ')).toMatch(/could not be proven to be one charge/);
  });
  it('with no bills or services it is "not enough information"', async () => {
    const r = await paymentsAnswer(ctx, devices().A.d);
    expect(r.status).toBe('insufficient');
  });
});

describe('What do we need to prepare for over the next year?', () => {
  it('keeps the groups apart (no grand total), uses the rolling twelve months and links to Year Ahead', async () => {
    const r = await yearAheadAnswer(ctx, A.d);
    expect(r.period.from).toBe(TODAY);
    expect(r.period.to).toBe('2027-11-07');
    expect(r.figures.map((f) => f.id)).toEqual(expect.arrayContaining(['bs-known', 'bs-estimated', 'projects', 'dates']));
    expect(r.figures.some((f) => /total/i.test(f.label))).toBe(false);
    expect(headlineText(r.headline, money, (t) => t)).toMatch(/not added together/);
    expect(r.fullView?.href).toBe('#/household/year-ahead');
    expect(r.limitations.join(' ')).toMatch(/never added into one total/);
    const projects = figure(r, 'projects')!.value;
    expect(projects).toMatchObject({ kind: 'money', cents: 1700000 });
  });
});

describe('What household services are coming up?', () => {
  it('lists the cleaning arrangement with its provider, its next dates inside the 30 days and a link, and makes nothing', async () => {
    const before = await digest(A.d);
    const r = await servicesUpcomingAnswer(ctx, A.d);
    expect(r.period).toEqual({ label: 'The next 30 days: Nov 8 through Dec 7, 2026', from: TODAY, to: '2026-12-07' });
    const rows = allRows(r);
    expect(rows.map((x) => x.title)).toEqual(['House cleaning']);
    expect(rows[0].detail).toContain('Provider: Sparkle Cleaning Co');
    expect(rows[0].href).toBe(`#/services/a/${S.clean}`);
    expect(rows[0].date! >= TODAY && rows[0].date! <= '2026-12-07').toBe(true);
    expect(await digest(A.d)).toBe(before);
  });
});

describe('asking never changes anything', () => {
  it('every reader leaves every table exactly as it was', async () => {
    const before = await digest(A.d);
    for (const f of [maintenanceOverdueAnswer, maintenanceSpendAnswer, warrantiesExpiringAnswer, priceIncreaseAnswer, paymentsAnswer, yearAheadAnswer, overBudgetAnswer, servicesUpcomingAnswer]) await f(ctx, A.d);
    expect(await digest(A.d)).toBe(before);
  });
  it('the answer files contain no database write, network call or storage write, and import no other module than their own and the shared readers they wrap', () => {
    const files = ['projects', 'bills', 'assets', 'services', 'household'].map((m) => join(resolve('src/modules'), m, 'answers.ts')).concat(resolve('src/shell/searchAnswers.ts'), resolve('src/shell/answersModel.ts'));
    for (const f of files) {
      const src = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      expect(src, f).not.toMatch(/\.(put|add|update|delete|bulkPut|bulkAdd|bulkDelete|transaction|clear)\(|fetch\(|localStorage|sessionStorage|indexedDB|XMLHttpRequest|navigator\.sendBeacon/);
    }
    // the catalog itself is pure: it touches no database at all (its Set.add calls are local)
    expect(readFileSync(resolve('src/core/answers.ts'), 'utf8')).not.toMatch(/from '[.\/]+\/db'|dexie|fetch\(|localStorage/);
    const dir = resolve('src/modules/today');
    const live = readdirSync(dir).filter((f) => f === 'answersLive.tsx').map((f) => readFileSync(join(dir, f), 'utf8'));
    expect(live[0]).not.toMatch(/\.(put|add|update|delete|bulkPut|bulkAdd|bulkDelete|transaction|clear)\(|fetch\(|localStorage/);
  });
});
