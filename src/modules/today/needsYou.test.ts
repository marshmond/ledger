import { beforeAll, describe, expect, it } from 'vitest';
import { FinanceDB } from '../../db';
import { allAttentionSources } from '../../core/registry';
import { attentionProblem, containsMoney, previewAttention, rankAttention, type AttentionItem } from '../../core/attention';
import { installTracking } from '../../lib/sync/track';
import { registerModules } from '../index';
import { assetRef, createAsset } from '../assets/data';
import { readAssetsAttention } from '../assets/attention';
import { blankAsset } from '../assets/model';
import { loadOverview } from '../assets/overviewData';
import { blankWarranty } from '../assets/warranty';
import { createWarranty } from '../assets/warrantyData';
import { readBillsAttention } from '../bills/attention';
import { createObligation } from '../bills/data';
import { monthly, ob } from '../bills/billsTestkit';
import { attention as billsAttentionOf, derive, loadBillsSnapshot } from '../bills/readModel';
import { providerNamed } from '../../core/contactTestkit';
import { readHouseholdAttention } from '../household/attention';
import { TODAY, digest, seed, type Seed } from '../household/householdSeed';
import { loadHouseholdOverview, todayCounts } from '../household/overview';
import { readProjectsAttention } from '../projects/attention';
import { createProject } from '../projects/data';
import { blankProject } from '../projects/model';
import { projectAttention } from '../projects/todayLogic';
import { loadProjects } from '../projects/data';
import { servicesAttentionItems } from '../services/attention';
import { createStore } from '../../core/store';
import { blankArrangement } from '../services/model';
import { createArrangement, tasksOfArrangement } from '../services/data';
import { attentionCounts, loadSnapshot } from '../services/views';
import { completeTask, createTask, loadTasks } from '../tasks/data';
import { blankTask } from '../tasks/model';
import { loadAlertMemory } from './settings';

/**
 * R1.1. Each source adapter must agree with the authoritative reader of its own module (the one its Today card or Overview page uses), the items must
 * be valid, free of amounts and read-only, and an empty household must give nothing. Every name, date and amount below is invented. The household is the
 * B5 one (`seed`) plus one deliberate exception per module.
 */
const FURNACE_TASK_DUE = '2026-10-27'; // 12 days before TODAY (2026-11-08)
let n = 0;
const fresh = () => { const d = new FinanceDB(`test-needs-${n++}`); installTracking(d); return d; };

let d: FinanceDB;
let s: Seed;
let furnace: number;
let before: string;

beforeAll(async () => {
  registerModules();
  d = fresh();
  s = await seed(d);
  // Home & Assets: an overdue maintenance task, a warranty ending in 10 days, and a completed task that was never saved to history
  furnace = await createAsset(blankAsset({ name: 'Furnace' }), d);
  await createTask(blankTask({ title: 'Replace furnace filter', dueDate: FURNACE_TASK_DUE }), [assetRef(furnace)], d);
  await createWarranty(blankWarranty(furnace, { title: 'Parts and labor', endDate: '2026-11-18' }), d);
  const done = await createTask(blankTask({ title: 'Clear gutters', dueDate: '2026-11-02' }), [assetRef(furnace)], d);
  await completeTask(done, '2026-11-03', d);
  // Household Services: a finished visit that was not logged, and a renewal and a notice deadline that fall on the same day
  const visitTasks = await tasksOfArrangement(s.clean, d);
  await completeTask(visitTasks[0].id, TODAY, d);
  await createArrangement({ data: blankArrangement({ title: 'Pool service', renewalDate: '2026-11-12', noticeByDate: '2026-11-12' }), provider: await providerNamed(d, 'Blue Pools'), today: TODAY }, d);
  // Bills: a bill with no payment recorded for a period that has passed
  await createObligation({ data: ob({ need: 'flexible', title: 'Water', type: 'utility', trackingSince: '2026-09-01', prices: [{ from: '2026-09-01', cents: 4200, label: '' }], schedule: monthly(1, '2026-09') }, TODAY), provider: await providerNamed(d, 'City Water'), today: TODAY }, d);
  // Projects: a project whose target date has passed
  await createProject(blankProject({ name: 'Bathroom refit', status: 'active', targetDate: '2026-11-01' }), d);
  before = await digest(d);
});

const clean = (items: AttentionItem[], moduleId: string) => {
  for (const i of items) {
    expect(attentionProblem(moduleId, i), i.id).toBeNull();
    expect(containsMoney(`${i.title} ${i.reason}`), `${i.id}: ${i.title} / ${i.reason}`).toBe(false);
  }
};

describe('Home & Assets agrees with its overview reader', () => {
  it('has one item per overdue task, ending warranty and unsaved completed task, and counted items for the rest', async () => {
    const items = await readAssetsAttention(TODAY, d);
    const a = (await loadOverview('all', TODAY, d)).attention;
    expect(a.overdueTasks.length).toBeGreaterThan(0);
    expect(a.expiringWarranties.length).toBeGreaterThan(0);
    expect(a.unsaved.length).toBeGreaterThan(0);
    expect(items.filter((i) => i.id.endsWith(':overdue'))).toHaveLength(a.overdueTasks.length);
    expect(items.filter((i) => i.id.includes(':warranty:'))).toHaveLength(a.expiringWarranties.length);
    expect(items.filter((i) => i.id.endsWith(':unsaved'))).toHaveLength(a.unsaved.length);
    expect(items.find((i) => i.id === 'assets:duplicate-jobs')?.count ?? 0).toBe(a.duplicateJobs);
    expect(items.find((i) => i.id === 'assets:orphans')?.count ?? 0).toBe(a.orphans);
    expect(items.find((i) => i.id === 'assets:review-refs')?.count ?? 0).toBe(a.reviewRefs);
    clean(items, 'assets');
  });
  it('says what and where, with a link to the asset and the real number of days', async () => {
    const items = await readAssetsAttention(TODAY, d);
    const late = items.find((i) => i.id.endsWith(':overdue'))!;
    expect(late).toMatchObject({ kind: 'overdue', date: FURNACE_TASK_DUE, title: 'Replace furnace filter', href: `#/assets/${furnace}` });
    expect(late.reason).toBe('The maintenance task for Furnace is 12 days overdue.');
    const w = items.find((i) => i.id.includes(':warranty:'))!;
    expect(w).toMatchObject({ kind: 'deadline', date: '2026-11-18', title: 'Furnace: warranty ends' });
    expect(w.reason).toContain('in 10 days');
    expect(items.find((i) => i.id.endsWith(':unsaved'))!.reason).toBe('A completed maintenance task for Furnace is not saved to service history.');
  });
});

describe('Household Services agrees with its Today card readers', () => {
  it('has one item per condition the card counts, and the same-day renewal and notice stay two items', async () => {
    const snap = await loadSnapshot(d);
    const items = servicesAttentionItems(snap, TODAY);
    const c = attentionCounts(snap, TODAY);
    expect(c.unlogged).toBeGreaterThan(0);
    expect(items.filter((i) => i.id.endsWith(':unlogged'))).toHaveLength(c.unlogged);
    expect(items.filter((i) => i.id.endsWith(':schedule'))).toHaveLength(c.scheduleChecks);
    expect(items.filter((i) => i.id.endsWith(':duplicate'))).toHaveLength(c.duplicateGroups);
    expect(items.filter((i) => i.id.endsWith(':status'))).toHaveLength(c.needsReview);
    expect(items.filter((i) => i.id.endsWith(':renewal'))).toHaveLength(c.renewals!);
    expect(items.filter((i) => i.id.endsWith(':notice'))).toHaveLength(c.notices!);
    expect(c.renewals).toBe(1);
    expect(c.notices).toBe(1);
    clean(items, 'services');
  });
  it('the unlogged visit reads plainly and links to its arrangement', async () => {
    const snap = await loadSnapshot(d);
    const u = servicesAttentionItems(snap, TODAY).find((i) => i.id.endsWith(':unlogged'))!;
    expect(u.title).toBe('House cleaning');
    expect(u.reason).toMatch(/^A completed visit has not been logged \(finished \d{4}-\d{2}-\d{2}\)\.$/); // "finished" is when the task was ticked (the real clock)
    expect(u.href).toBe(`#/services/a/${s.clean}`);
    expect(u.kind).toBe('review');
  });
  it('does not use a provider name, phone, note or link', async () => {
    const text = JSON.stringify(servicesAttentionItems(await loadSnapshot(d), TODAY));
    expect(text).not.toMatch(/Sparkle|Blue Pools/);
  });
});

describe('Bills agrees with its read model', () => {
  it('has exactly one item per attention item the Bills card counts', async () => {
    const items = await readBillsAttention(TODAY, d);
    const a = billsAttentionOf(derive(await loadBillsSnapshot(d), TODAY));
    expect(a.total).toBeGreaterThan(0);
    expect(items).toHaveLength(a.total);
    expect(items.some((i) => i.title === 'Water')).toBe(true);
    clean(items, 'bills');
  });
  it('a bill with no payment recorded is a dated item (overdue by its own date) and links to the bill', async () => {
    const items = await readBillsAttention(TODAY, d);
    const water = items.find((i) => i.title === 'Water' && i.provenance.endsWith('bills not confirmed paid'))!;
    expect(water.kind).toBe('deadline');
    expect(water.date).not.toBeNull();
    expect(water.href).toMatch(/^#\/bills\/o\/\d+$/);
    expect(rankAttention([water], TODAY)[0].tier).toBe(1);
    expect(water.reason).toMatch(/^[A-Z].*\.$/);
  });
});

describe('Household finances agrees with its Today card counts', () => {
  it('has the card\'s three kinds of item, with the same counts', async () => {
    const items = await readHouseholdAttention(TODAY, d);
    const c = todayCounts(await loadHouseholdOverview('all', TODAY, d));
    expect(items.filter((i) => i.id.startsWith('household:duplicate:'))).toHaveLength(c.possibleDuplicates);
    expect(items.filter((i) => i.id.startsWith('household:overlap:'))).toHaveLength(c.overlaps);
    expect(items.find((i) => i.id === 'household:unknown-amounts')?.count ?? 0).toBe(c.unknownSoon);
    expect(items).toHaveLength(c.total - c.unknownSoon + (c.unknownSoon > 0 ? 1 : 0));
    clean(items, 'household');
  });
});

describe('Projects agrees with its Today card list', () => {
  it('has one item per project the card lists, in the card\'s words', async () => {
    const items = await readProjectsAttention(TODAY, d);
    const list = projectAttention(await loadProjects(d), await loadTasks(d), TODAY);
    expect(items).toHaveLength(list.length);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ title: 'Bathroom refit', kind: 'overdue', date: '2026-11-01', reason: '7 days past target.' });
    expect(items[0].href).toMatch(/^#\/projects\/\d+$/);
    clean(items, 'projects');
  });
});

describe('together', () => {
  it('every source, ranked: urgent first, and the order does not depend on which module answered first', async () => {
    const parts = await Promise.all([readAssetsAttention(TODAY, d), readBillsAttention(TODAY, d), readHouseholdAttention(TODAY, d), readProjectsAttention(TODAY, d), Promise.resolve(servicesAttentionItems(await loadSnapshot(d), TODAY))]);
    const all = parts.flat();
    const ranked = rankAttention(all, TODAY);
    expect(rankAttention([...parts].reverse().flat(), TODAY).map((r) => r.id)).toEqual(ranked.map((r) => r.id));
    const tiers = ranked.map((r) => r.tier);
    expect([...tiers].sort()).toEqual(tiers);
    expect(tiers[0]).toBe(1);
    expect(new Set(all.map((i) => i.id)).size).toBe(all.length); // ids are unique across modules (they are namespaced)
    expect(ranked).toHaveLength(all.length); // nothing in this household is a duplicate of another view
  });
  it('a completed task that is both not saved to asset history and not logged as a visit stays TWO items (different actions on one record)', async () => {
    const d2 = fresh();
    const s2 = await seed(d2);
    const asset = await createAsset(blankAsset({ name: 'Pool pump' }), d2);
    const tasks = await tasksOfArrangement(s2.clean, d2);
    await completeTask(tasks[0].id, TODAY, d2);
    // link that same finished task to the asset too
    await createStore(d2).shared.links.add({ module: 'tasks', id: tasks[0].id }, assetRef(asset), 'about');
    const items = [...(await readAssetsAttention(TODAY, d2)), ...servicesAttentionItems(await loadSnapshot(d2), TODAY)];
    const forTask = items.filter((i) => i.recordId === `task:${tasks[0].id}`);
    expect(forTask.map((i) => i.condition).sort()).toEqual([`task:${tasks[0].id}:unsaved-history`, `task:${tasks[0].id}:visit-unlogged`].sort());
    expect(new Set(forTask.map((i) => i.condition)).size).toBe(forTask.length);
    expect(rankAttention(forTask, TODAY)).toHaveLength(forTask.length);
  });
  it('is read-only by any route: no create, update, delete, clear or read-write transaction while every source was read', async () => {
    const seen: string[] = [];
    for (const t of d.tables) {
      t.hook('creating', () => { seen.push(`${t.name}:creating`); });
      t.hook('updating', () => { seen.push(`${t.name}:updating`); });
      t.hook('deleting', () => { seen.push(`${t.name}:deleting`); });
    }
    const tx = d.transaction.bind(d) as (...a: unknown[]) => unknown;
    (d as { transaction: unknown }).transaction = (...a: unknown[]) => { if (String(a[0]).startsWith('rw')) seen.push('rw-transaction'); return tx(...a); };
    await Promise.all([readAssetsAttention(TODAY, d), readBillsAttention(TODAY, d), readHouseholdAttention(TODAY, d), readProjectsAttention(TODAY, d), loadSnapshot(d), loadAlertMemory(d)]);
    (d as { transaction: unknown }).transaction = tx;
    expect(seen).toEqual([]);
    // the trap is not blind: a write through the same database is seen
    await d.settings.put({ key: 'trap-control', value: 1 });
    expect(seen).toEqual(['settings:creating']);
    await d.settings.delete('trap-control');
    before = await digest(d);
  });
  it('is read-only: no table changed while every source was read', async () => {
    await Promise.all([readAssetsAttention(TODAY, d), readBillsAttention(TODAY, d), readHouseholdAttention(TODAY, d), readProjectsAttention(TODAY, d), loadSnapshot(d), loadAlertMemory(d)]);
    expect(await digest(d)).toBe(before);
  });
});

describe('an empty household', () => {
  it('has nothing that needs anyone', async () => {
    const e = fresh();
    expect(await readAssetsAttention(TODAY, e)).toEqual([]);
    expect(await readBillsAttention(TODAY, e)).toEqual([]);
    expect(await readHouseholdAttention(TODAY, e)).toEqual([]);
    expect(await readProjectsAttention(TODAY, e)).toEqual([]);
    expect(servicesAttentionItems(await loadSnapshot(e), TODAY)).toEqual([]);
    expect(previewAttention(rankAttention([], TODAY))).toEqual({ shown: [], total: 0, remaining: 0 });
  });
});

describe('registration', () => {
  it('six modules contribute a source, each named after its own module', () => {
    expect(allAttentionSources().map((x) => x.moduleId)).toEqual(['ledger', 'projects', 'assets', 'services', 'bills', 'household']);
  });
});
