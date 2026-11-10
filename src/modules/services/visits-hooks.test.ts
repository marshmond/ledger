import { scrubGeneratedIds } from '../../lib/leakTestkit';
import { describe, expect, it } from 'vitest';
import { db, FinanceDB } from '../../db';
import { allTodayCards } from '../../core/registry';
import { registerModules } from '../index';
import { installTracking } from '../../lib/sync/track';
import { completeTask, loadTasks } from '../tasks/data';
import { taskDueItems } from '../tasks/dueProvider';
import { blankArrangement, type Cadence } from './model';
import { createArrangement, tasksOfArrangement } from './data';
import { addBookingReminder, loadVisits, logStandaloneVisit, logVisitFromTask, planLogVisit, type VisitInput } from './visits';
import { servicesModule } from './index';
import { serviceRecords } from './records';
import { searchServicesData } from './searchSource';
import { parseOneOffQuick, parseServiceQuick, serviceQuickAdd } from './quickAddDef';
import { attentionLines } from './todayCards';
import { attentionCounts, buildOverview, buildProvider, loadSnapshot, visitRows } from './views';
import { visitStats } from './visitModel';
import { applyLifecycle, planLifecycle } from './changes';
import { providerNamed } from '../../core/contactTestkit';

let n = 0;
const fresh = () => { const d = new FinanceDB(`test-visit-hooks-${n++}`); installTracking(d); return d; };
const TODAY = '2026-11-06'; // a Friday
const cad: Cadence = { mode: 'fixed', rule: { freq: 'weekly', interval: 2, end: { type: 'never' } }, anchorDate: TODAY };
const SECRETS = { phone: '555-0142-9999', email: 'rosa.secret@example.test', notes: 'spare key is under the blue pot', url: 'https://example.com/private-invoice', cents: 98765, visitNotes: 'alarm code is in the red folder' };
const input = (over: Partial<VisitInput> = {}): VisitInput => ({ status: 'completed', cancelledBy: null, date: TODAY, notes: '', chargedCents: null, chargeKind: null, ...over });

async function seeded(d: FinanceDB) {
  const r = await createArrangement({
    data: blankArrangement({ title: 'House cleaning', cadence: cad, notes: SECRETS.notes, visitTime: '09:00' }),
    provider: { name: "Rosa's Cleaning", phone: SECRETS.phone, email: SECRETS.email }, today: TODAY,
  }, d);
  const inp = input({ notes: SECRETS.visitNotes, chargedCents: SECRETS.cents, chargeKind: 'service', refs: [{ label: 'Invoice', url: SECRETS.url }] });
  const plan = await planLogVisit(r.id, r.taskId!, inp, TODAY, d);
  const v = await logVisitFromTask({ arrangementId: r.id, taskId: r.taskId!, input: inp, today: TODAY, expect: plan.expect }, d);
  return { r, v };
}
const leaks = (text: string) => Object.values(SECRETS).filter((x) => text.includes(String(x)) || text.includes((Number(x) / 100).toFixed(2)));

describe('Today card', () => {
  it('registers as services.attention, hidden when empty, half width', () => {
    registerModules();
    const c = allTodayCards().find((x) => x.id === 'services.attention')!;
    expect(c).toMatchObject({ hideWhenEmpty: true, defaultWidth: 'half' });
    expect(servicesModule.contributes?.todayCards?.map((x) => x.id)).toEqual(['services.attention']);
  });
  it('shows counts in words only, and nothing when there is nothing to look at', () => {
    expect(attentionLines({ unlogged: 0, duplicateGroups: 0, scheduleChecks: 0, needsReview: 0 })).toEqual([]);
    expect(attentionLines({ unlogged: 1, duplicateGroups: 0, scheduleChecks: 0, needsReview: 0 }).map((r) => r.text)).toEqual(['1 finished visit is not yet logged']);
    expect(attentionLines({ unlogged: 3, duplicateGroups: 2, scheduleChecks: 1, needsReview: 0 }).map((r) => r.text)).toEqual([
      '3 finished visits are not yet logged', '2 possible duplicate visit records need a look', '1 arrangement needs a schedule check',
    ]);
  });
  it('counts come from the same readers as the page, are read-only, and carry no names, contacts, notes, links or amounts', async () => {
    const d = fresh();
    const { r } = await seeded(d);
    await completeTask((await tasksOfArrangement(r.id, d))[1].id, TODAY, d); // finish the NEXT Task in Tasks: finished, not logged
    const before = JSON.stringify([await d.moduleRecords.toArray(), await d.links.toArray()]);
    const snap = await loadSnapshot(d);
    const counts = attentionCounts(snap);
    expect(counts).toMatchObject({ unlogged: 1, duplicateGroups: 0 });
    expect(JSON.stringify([await d.moduleRecords.toArray(), await d.links.toArray()])).toBe(before);
    const text = JSON.stringify(attentionLines(counts));
    expect(leaks(text)).toEqual([]);
    expect(text).not.toMatch(/Rosa|cleaning/i);
    expect(buildOverview(snap).unlogged).toHaveLength(1);
  });
});

describe('Search, records and Tasks never carry private details', () => {
  it('Search finds a visit by title or provider name only; notes, amount, link and contact details are not searched or shown', async () => {
    const d = fresh();
    await seeded(d);
    const snap = await loadSnapshot(d);
    const hit = searchServicesData('cleaning', snap.arrangements, 8, snap.visits).filter((r) => r.kind === 'Visit');
    expect(hit).toHaveLength(1);
    expect(hit[0].path).toMatch(/^\/services\/v\/\d+$/);
    expect(hit[0].subtitle).toBe("Completed · 2026-11-06 · Rosa's Cleaning");
    for (const secret of [SECRETS.phone, SECRETS.email, 'blue pot', 'red folder', 'private-invoice', '987', 'alarm']) {
      expect(searchServicesData(secret, snap.arrangements, 8, snap.visits)).toEqual([]);
    }
    expect(leaks(JSON.stringify(searchServicesData("rosa", snap.arrangements, 8, snap.visits)))).toEqual([]);
  });
  it('the records hook describes a visit by title and provider name, and a missing one as null', async () => {
    registerModules();
    const { v } = await seeded(db);
    const info = await serviceRecords.describe(`visit:${v.visitId}`);
    expect(info).toMatchObject({ label: "House cleaning, Rosa's Cleaning", kind: 'Visit', path: `/services/v/${v.visitId}` });
    expect(await serviceRecords.describe('visit:999999999')).toBeNull();
    expect(leaks(JSON.stringify(info))).toEqual([]);
  });
  it('visit Tasks, booking reminders and the Calendar entry carry no contact details, notes, links or amounts', async () => {
    const d = fresh();
    const { r } = await seeded(d);
    await addBookingReminder(r.id, '2026-11-09', d);
    const tasks = await loadTasks(d);
    expect(leaks(JSON.stringify(tasks.map((t) => ({ ...t.data, createdFrom: undefined }))))).toEqual([]);
    const items = await taskDueItems(d, { from: '2026-11-01', to: '2026-12-31', today: TODAY, overdueDays: 0 } as never);
    expect(leaks(JSON.stringify(items.map((i) => ({ title: i.title, detail: i.detail, time: i.time }))))).toEqual([]);
    expect(items.filter((i) => i.title.startsWith('House cleaning'))).toHaveLength(1); // once, with its time
    expect(items.find((i) => i.title.startsWith('House cleaning'))!.time).toBe('09:00');
  });
});

describe('history views', () => {
  it('the provider page lists visits by the provider AT THE TIME, newest first, and the stats count completed only', async () => {
    const d = fresh();
    const { r } = await seeded(d);
    const plan = await planLifecycle(r.id, 'replace', TODAY, d);
    await applyLifecycle({ action: 'replace', arrangementId: r.id, expect: plan.expect, today: TODAY, replace: { provider: { name: 'Bright Maids' } }, taskChoice: 'remove' }, d);
    await logStandaloneVisit({ provider: await providerNamed(d, "Rosa's Cleaning"), input: input({ title: 'Window clean', date: '2026-10-20' }), today: TODAY }, d);
    await logStandaloneVisit({ provider: await providerNamed(d, "Rosa's Cleaning"), input: input({ title: 'Cancelled clean', date: '2026-11-30', status: 'cancelled', cancelledBy: 'provider', chargedCents: 3000, chargeKind: 'cancellationFee' }), today: TODAY }, d);
    const snap = await loadSnapshot(d);
    const rosa = snap.contacts.find((c) => c.name === "Rosa's Cleaning")!;
    const bright = snap.contacts.find((c) => c.name === 'Bright Maids')!;
    const view = buildProvider(snap, rosa.id!);
    expect(view.visits.map((x) => x.v.data.title)).toEqual(['Cancelled clean', 'House cleaning', 'Window clean']);
    expect(view.stats).toMatchObject({ completed: 2, cancelled: 1, cancelledWithFee: 1, lastServiced: '2026-11-06' });
    expect(buildProvider(snap, bright.id!).visits).toHaveLength(0);
  });
  it('a removed contact, a removed arrangement and a one-off all still show in history', async () => {
    const d = fresh();
    const { r } = await seeded(d);
    await logStandaloneVisit({ provider: await providerNamed(d, 'Pat the Plumber'), input: input({ title: 'Drain repair', date: '2026-11-01' }), today: TODAY }, d);
    await d.contacts.clear();
    await d.moduleRecords.update(r.id, { deletedAt: Date.now() });
    const snap = await loadSnapshot(d);
    const rows = visitRows(snap, snap.visits);
    expect(rows).toHaveLength(2);
    expect(rows.find((x) => x.v.data.title === 'Drain repair')).toMatchObject({ arrangementTitle: null, arrangementGone: false, contactGone: true });
    expect(rows.find((x) => x.v.data.title === 'House cleaning')).toMatchObject({ arrangementGone: true, providerName: "Rosa's Cleaning", contactGone: true });
    expect(visitStats(snap.visits).completed).toBe(2);
  });
});

describe('Quick Add: hs visit', () => {
  const known = ["Maple Lawn Care"];
  it('a one-off visit: what, with whom, when and how much', () => {
    const p = parseOneOffQuick('visit mowed the lawn with Maple Lawn Care yesterday $85', TODAY, known)!;
    expect(p).toMatchObject({ title: 'mowed the lawn', providerName: 'Maple Lawn Care', providerExists: true, date: '2026-11-05', chargedCents: 8500, problem: null });
    expect(parseOneOffQuick('visit Fixed outlet with Pat 2026-10-30', TODAY, known)).toMatchObject({ date: '2026-10-30', chargedCents: null, providerExists: false });
    expect(parseOneOffQuick('visit Fixed outlet with Pat', TODAY, known)!.date).toBe(TODAY);
  });
  it('a missing provider or a future date is shown as a problem; a repeat means it is an arrangement, not a visit', () => {
    expect(parseOneOffQuick('visit mowed the lawn', TODAY, known)!.problem).toMatch(/with/);
    expect(parseOneOffQuick('visit mowed the lawn with Pat tomorrow', TODAY, known)!.problem).toMatch(/future/);
    expect(parseOneOffQuick('visit cleaning with Rosa every other friday', TODAY, known)).toBeNull();
    expect(parseOneOffQuick('cleaning with Rosa', TODAY, known)).toBeNull();
  });
  it('the S1 grammar still works unchanged', () => {
    const p = parseServiceQuick("House cleaning with Rosa's Cleaning every other Friday at 9am", TODAY, [])!;
    expect(p.data.title).toBe('House cleaning');
    expect(p.providerName).toBe("Rosa's Cleaning");
    expect(p.data.cadence).not.toBeNull();
    expect(serviceQuickAdd.parse!('visit mowed the lawn with Pat', { plain: true })!.fields.some((f) => f.label === 'One-off visit')).toBe(false);
  });
  it('previews first (no money in the summary), saves a visit only on Add (provider name kept as words, NO Contact made or linked), and Undo removes it', async () => {
    const preview = serviceQuickAdd.parse!('visit Drain repair with Pat the Plumber 2026-11-01 $120')!;
    expect(preview.summary).toBe('One-off visit: Drain repair with Pat the Plumber. No arrangement or task is created');
    expect(preview.fields.map((f) => f.label)).toEqual(['One-off visit', 'Provider', 'Date', 'Charged']);
    expect(scrubGeneratedIds(preview.summary)).not.toMatch(/120/);
    const before = { v: (await loadVisits(db)).length, t: (await loadTasks(db)).length, a: await db.moduleRecords.where('[module+kind]').equals(['services', 'arrangement']).count(), c: await db.contacts.count() };
    const undo = (await serviceQuickAdd.commit!(preview)) as () => Promise<void>;
    const v = (await loadVisits(db)).find((x) => x.data.title === 'Drain repair')!;
    expect(v.data).toMatchObject({ title: 'Drain repair', providerNameSnapshot: 'Pat the Plumber', date: '2026-11-01', chargedCents: 12000, chargeKind: 'service', arrangementId: null, taskId: null });
    expect((await loadTasks(db)).length).toBe(before.t);
    expect(await db.moduleRecords.where('[module+kind]').equals(['services', 'arrangement']).count()).toBe(before.a);
    expect(v.data.providerContactId).toBeNull(); // U2: Quick Add never invents a Contact identity from a typed name
    expect(await db.contacts.filter((c) => c.deletedAt == null).count()).toBe(before.c);
    await undo();
    expect((await loadVisits(db)).length).toBe(before.v);
    expect(await db.contacts.filter((c) => c.deletedAt == null).count()).toBe(before.c);
  });
  it('a preview with a problem is refused at Add, and saves nothing', async () => {
    const preview = serviceQuickAdd.parse!('visit mowed the lawn')!;
    expect(preview.fields.find((f) => f.label === 'Problem')).toBeTruthy();
    const before = (await loadVisits(db)).length;
    await expect(serviceQuickAdd.commit!(preview)).rejects.toThrow(/with/);
    expect((await loadVisits(db)).length).toBe(before);
  });
});

describe('Quick Add: one press, one visit', () => {
  it('committing the same preview twice (a double press) saves one visit; a fresh preview of the same text is a separate entry', async () => {
    const text = 'visit Gutter clean with Ned Test Gutters 2026-10-28';
    const preview = serviceQuickAdd.parse!(text)!;
    const before = (await loadVisits(db)).filter((v) => v.data.title === 'Gutter clean').length;
    await Promise.all([serviceQuickAdd.commit!(preview), serviceQuickAdd.commit!(preview)]);
    expect((await loadVisits(db)).filter((v) => v.data.title === 'Gutter clean')).toHaveLength(before + 1);
    await serviceQuickAdd.commit!(serviceQuickAdd.parse!(text)!); // a new entry on purpose: kept, with a look-alike notice
    expect((await loadVisits(db)).filter((v) => v.data.title === 'Gutter clean')).toHaveLength(before + 2);
  });
});
