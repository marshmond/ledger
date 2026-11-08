import { scanText } from '../../lib/leakTestkit';
import { describe, expect, it } from 'vitest';
import { FinanceDB } from '../../db';
import { installTracking } from '../../lib/sync/track';
import { allDueProviders, queryProviders } from '../../core/dueProvider';
import { ensureCalendarSeed, loadLayers } from '../calendar/data';
import { ASSETS_ID, FINANCE_ID, PERSONAL_ID, PROJECTS_ID, SERVICES_ID, TASKS_ID } from '../calendar/model';
import { applyLifecycle, planLifecycle } from './changes';
import { contractDeadlines, contractProblem, contractWarnings, deadlineKey, upcomingContractCounts } from './contract';
import { CONTRACT_STALE, setContractDates } from './contractData';
import { createArrangement, getArrangement, loadArrangements } from './data';
import { servicesDueItems, servicesDueProvider } from './dueProvider';
import { asArrangement, blankArrangement, toStored } from './model';
import { attentionLines } from './todayCards';
import { attentionCounts, loadSnapshot } from './views';
import { applyUndo, isUndoRefused } from './undo';
import { servicesModule } from './index';
import { loadVisits, logStandaloneVisit } from './visits';

/** Invented data only. 2026-11-06 is a Friday. */
let n = 0;
const fresh = () => { const d = new FinanceDB(`test-s4c-${n++}`); installTracking(d); return d; };
const TODAY = '2026-11-06';
const add = (d: FinanceDB, over: Partial<ReturnType<typeof blankArrangement>> = {}, provider = "Rosa's Cleaning") =>
  createArrangement({ data: blankArrangement({ title: 'House cleaning', ...over }), provider: { name: provider }, today: TODAY }, d);
const items = (d: FinanceDB, from = '2026-01-01', to = '2027-12-31', today = TODAY) => servicesDueItems(d, { from, to, today, overdueDays: 0 });

describe('S4-C1 contract dates: model and validation', () => {
  it('26. only real calendar dates are accepted; empty is fine; the two are different dates', () => {
    expect(contractProblem({ renewalDate: '2027-01-01', noticeByDate: '2026-12-01' })).toBeNull();
    expect(contractProblem({ renewalDate: null, noticeByDate: null })).toBeNull();
    expect(contractProblem({ renewalDate: '2027-02-30', noticeByDate: null })).toMatch(/renewal date is not a real date/);
    expect(contractProblem({ renewalDate: null, noticeByDate: '2026-13-01' })).toMatch(/notice-by date is not a real date/);
    expect(contractProblem({ renewalDate: '2026-2-3', noticeByDate: null })).not.toBeNull();
  });
  it('26/27. soft warnings: notice after renewal, passed notice, past renewal, and an ended arrangement keeping its dates', () => {
    expect(contractWarnings({ renewalDate: '2027-01-01', noticeByDate: '2026-12-01' }, 'active', TODAY)).toEqual([]);
    expect(contractWarnings({ renewalDate: '2026-12-01', noticeByDate: '2027-01-01' }, 'active', TODAY).join(' ')).toMatch(/after the renewal date/);
    expect(contractWarnings({ renewalDate: '2027-01-01', noticeByDate: '2026-10-01' }, 'active', TODAY).join(' ')).toMatch(/already passed/);
    expect(contractWarnings({ renewalDate: '2026-10-01', noticeByDate: null }, 'active', TODAY).join(' ')).toMatch(/in the past.*never assumes a yearly/);
    const ended = contractWarnings({ renewalDate: '2026-10-01', noticeByDate: '2026-09-01' }, 'ended', TODAY);
    expect(ended.join(' ')).toMatch(/has ended.*kept as history/);
    expect(ended.join(' ')).not.toMatch(/already passed|in the past/); // an ended agreement is not nagged about
  });
  it('stored only when set; an arrangement without them is stored exactly as before S4; unreadable stored dates read as none; unknown fields survive', () => {
    const plain = toStored(blankArrangement({ title: 'x' }));
    expect('renewalDate' in plain || 'noticeByDate' in plain).toBe(false);
    expect(toStored(blankArrangement({ title: 'x', renewalDate: '2027-01-01' }))).toMatchObject({ renewalDate: '2027-01-01' });
    const rec = { id: 1, module: 'services', kind: 'arrangement', createdAt: 1, updatedAt: 1, deletedAt: null, data: { title: 'x', renewalDate: '2027-02-31', noticeByDate: 7, futureThing: { a: 1 } } };
    const a = asArrangement(rec as never);
    expect(a.data.renewalDate).toBeNull();
    expect(a.data.noticeByDate).toBeNull();
    expect((a.data as unknown as Record<string, unknown>).futureThing).toEqual({ a: 1 });
  });
  it('saving rejects an impossible date and changes nothing; the stale check refuses an edit made from an older copy', async () => {
    const d = fresh();
    const r = await add(d);
    const a0 = (await getArrangement(r.id, d))!;
    await expect(setContractDates(r.id, { renewalDate: '2027-02-30', noticeByDate: null }, a0.updatedAt, d)).rejects.toThrow(/not a real date/);
    expect((await getArrangement(r.id, d))!.updatedAt).toBe(a0.updatedAt);
    await setContractDates(r.id, { renewalDate: '2027-01-01', noticeByDate: '2026-12-01' }, a0.updatedAt, d);
    await expect(setContractDates(r.id, { renewalDate: '2028-01-01', noticeByDate: null }, a0.updatedAt, d)).rejects.toThrow(CONTRACT_STALE);
    expect((await getArrangement(r.id, d))!.data).toMatchObject({ renewalDate: '2027-01-01', noticeByDate: '2026-12-01' });
  });
});

describe('S4-C2 the derived Calendar layer', () => {
  it('the reserved layer id is the one S0 gave and is not used by any other built-in calendar', () => {
    expect(SERVICES_ID).toBe(9_000_000_000_000_106);
    expect(new Set([PERSONAL_ID, FINANCE_ID, TASKS_ID, PROJECTS_ID, ASSETS_ID, SERVICES_ID]).size).toBe(6);
  });
  it('the layer is seeded once (twice at once too) and is bound to the services provider', async () => {
    const d = fresh();
    await Promise.all([ensureCalendarSeed(d), ensureCalendarSeed(d)]);
    await ensureCalendarSeed(d);
    const layers = (await loadLayers(d)).filter((l) => l.id === SERVICES_ID);
    expect(layers).toHaveLength(1);
    expect(layers[0]).toMatchObject({ name: 'Household Services', sourceType: 'derived', providerId: 'services', builtin: true });
    expect(servicesModule.contributes?.dueProvider).toBe(servicesDueProvider);
    expect(servicesDueProvider.id).toBe('services');
  });
  it('28. two dates on one arrangement give two distinct markers, even on the same day; each links back to the arrangement', async () => {
    const d = fresh();
    const r = await add(d, { renewalDate: '2027-01-01', noticeByDate: '2026-12-01' });
    const same = await add(d, { title: 'Pest control', renewalDate: '2027-03-01', noticeByDate: '2027-03-01' });
    const got = await items(d);
    expect(got.map((i) => i.title)).toEqual(['Notice deadline: House cleaning', 'Renewal: House cleaning', 'Notice deadline: Pest control', 'Renewal: Pest control']);
    const ids = got.map((i) => i.id);
    expect(new Set(ids).size).toBe(4);
    expect(got.find((i) => i.title === 'Renewal: House cleaning')).toMatchObject({ date: '2027-01-01', sourceModule: 'services', sourceRecordId: `arrangement:${r.id}`, allDay: true, status: 'open' });
    expect(got.filter((i) => i.sourceRecordId === `arrangement:${same.id}`).map((i) => i.date)).toEqual(['2027-03-01', '2027-03-01']);
  });
  it('29. ids are stable across repeated reads and across a second device-style re-read', async () => {
    const d = fresh();
    await add(d, { renewalDate: '2027-01-01', noticeByDate: '2026-12-01' });
    const a = (await items(d)).map((i) => i.id), b = (await items(d)).map((i) => i.id), c = (await items(d, '2026-11-01', '2027-02-01')).map((i) => i.id);
    expect(a).toEqual(b);
    expect(c.sort()).toEqual(a.sort());
    expect(new Set(a).size).toBe(a.length);
  });
  it('respects the date range; a past date is a handled marker, not an overdue one', async () => {
    const d = fresh();
    await add(d, { renewalDate: '2027-01-01', noticeByDate: '2026-10-15' });
    expect((await items(d, '2026-12-01', '2027-01-31')).map((i) => i.title)).toEqual(['Renewal: House cleaning']);
    expect((await items(d, '2026-10-01', '2026-10-31'))[0]).toMatchObject({ status: 'handled', date: '2026-10-15' });
    const viaRegistry = await queryProviders({ from: '2026-10-01', to: '2027-02-01', today: TODAY, overdueDays: 30 }, [servicesDueProvider]);
    expect(viaRegistry.services.every((i) => i.status === 'handled' ? i.date >= '2026-10-01' : true)).toBe(true);
  });
  it('27. an ended arrangement shows no markers and does not count as upcoming, but its dates are NOT erased', async () => {
    const d = fresh();
    const r = await add(d, { renewalDate: '2027-01-01', noticeByDate: '2026-12-01' });
    expect(await items(d)).toHaveLength(2);
    const plan = await planLifecycle(r.id, 'end', TODAY, d);
    await applyLifecycle({ action: 'end', arrangementId: r.id, expect: plan.expect, today: TODAY, endReason: 'cancelled' }, d);
    expect(await items(d)).toEqual([]);
    expect(upcomingContractCounts(await loadArrangements(d), TODAY)).toEqual({ renewals: 0, notices: 0 });
    expect((await getArrangement(r.id, d))!.data).toMatchObject({ status: 'ended', renewalDate: '2027-01-01', noticeByDate: '2026-12-01' });
  });
  it('a paused arrangement keeps its deadlines (pausing visits does not end the agreement)', async () => {
    const d = fresh();
    const r = await add(d, { renewalDate: '2027-01-01' });
    const plan = await planLifecycle(r.id, 'pause', TODAY, d);
    await applyLifecycle({ action: 'pause', arrangementId: r.id, expect: plan.expect, today: TODAY }, d);
    expect(await items(d)).toHaveLength(1);
  });
  it('the Calendar text is the title only: no provider contact, notes, links, account numbers or money', async () => {
    const d = fresh();
    await createArrangement({
      data: blankArrangement({ title: 'Lawn care', notes: 'gate code 4455 account 99887766', refs: [{ label: 'Contract', url: 'https://example.com/secret-contract' }], expected: { basis: 'perMonth', cents: 12345 }, renewalDate: '2027-04-01', noticeByDate: '2027-03-01' }),
      provider: { name: 'Pat Lawns', phone: '555-0100', email: 'pat@example.com' }, today: TODAY,
    }, d);
    const text = scanText((await items(d)).map(({ openSource: _o, ...rest }) => rest));
    expect(text).not.toMatch(/4455|99887766|secret-contract|12345|123\.45|555-0100|pat@example|Pat Lawns/);
    expect(text).toMatch(/Lawn care/);
  });
  it('invalid or missing stored dates are skipped safely and no Task or Calendar event is ever created', async () => {
    const d = fresh();
    const r = await add(d, { renewalDate: '2027-01-01' });
    await d.moduleRecords.update(r.id, { 'data.noticeByDate': '2026-99-99', 'data.renewalDate': 'garbage' } as never);
    expect(await items(d)).toEqual([]);
    expect(contractDeadlines(await loadArrangements(d))).toEqual([]);
    const before = await d.moduleRecords.count();
    await items(d); await items(d);
    expect(await d.moduleRecords.count()).toBe(before);
    expect((await d.moduleRecords.toArray()).filter((x) => x.module === 'calendar' && x.kind === 'event')).toHaveLength(0);
    expect(deadlineKey('renewal', 7)).toBe('renewal-7');
  });
  it('the registry lists the provider once; the contract markers are the same whether or not the arrangement also has a schedule (expected visits are covered in s4-calendar.test.ts)', async () => {
    const d = fresh();
    await add(d, { renewalDate: '2027-01-01', cadence: { mode: 'fixed', rule: { freq: 'weekly', interval: 1, end: { type: 'never' } }, anchorDate: TODAY } });
    expect((await items(d, '2027-01-01', '2027-01-01')).filter((i) => i.id.startsWith('services:renewal-')).map((i) => i.title)).toEqual(['Renewal: House cleaning']);
    expect(allDueProviders().filter((p) => p.id === 'services').length).toBeLessThanOrEqual(1);
  });
});

describe('S4-C3 Today', () => {
  it('32. counts renewal dates and notice deadlines separately, within today..+30 inclusive, each once; ended arrangements are not counted', async () => {
    const d = fresh();
    await add(d, { title: 'A', renewalDate: '2026-11-20', noticeByDate: '2026-11-20' }); // same day: still one of each
    await add(d, { title: 'B', renewalDate: '2026-12-06' });                              // exactly +30: counted
    await add(d, { title: 'C', renewalDate: '2026-12-07', noticeByDate: '2026-11-05' });  // +31 and yesterday: neither
    await add(d, { title: 'D', noticeByDate: '2026-11-06' });                              // today: counted
    const ended = await add(d, { title: 'E', renewalDate: '2026-11-10', noticeByDate: '2026-11-10' });
    await applyLifecycle({ action: 'end', arrangementId: ended.id, expect: (await planLifecycle(ended.id, 'end', TODAY, d)).expect, today: TODAY }, d);
    const c = attentionCounts(await loadSnapshot(d), TODAY);
    expect([c.renewals, c.notices]).toEqual([2, 2]);
    expect(attentionLines(c).map((r) => r.text)).toEqual(['2 agreement notice deadlines in the next 30 days', '2 renewal dates in the next 30 days']);
    expect(attentionLines({ ...c, renewals: 1, notices: 1 }).map((r) => r.text)).toEqual(['1 agreement notice deadline in the next 30 days', '1 renewal date in the next 30 days']);
  });
  it('the existing lines stay, in order, with the new ones after them; without a date nothing new appears', () => {
    const base = { unlogged: 1, duplicateGroups: 2, scheduleChecks: 3, needsReview: 1 };
    expect(attentionLines(base).map((r) => r.id)).toEqual(['unlogged', 'dup', 'sched', 'review']);
    expect(attentionLines({ ...base, renewals: 2, notices: 1 }).map((r) => r.id)).toEqual(['unlogged', 'dup', 'sched', 'review', 'notice', 'renewal']);
  });
  it('33. Today holds counts only: no title, provider, link, note or amount', async () => {
    const d = fresh();
    await createArrangement({ data: blankArrangement({ title: 'Secret Title', notes: 'code 4455', expected: { basis: 'perMonth', cents: 12345 }, renewalDate: '2026-11-20' }), provider: { name: 'Pat Lawns', phone: '555-0100' }, today: TODAY }, d);
    const text = scanText(attentionLines(attentionCounts(await loadSnapshot(d), TODAY)));
    expect(text).not.toMatch(/Secret Title|Pat Lawns|555-0100|4455|12345|\$/);
    expect(text).toMatch(/1 renewal date in the next 30 days/);
  });
});

describe('S4-C4 agreement lifecycle', () => {
  it('30. dates survive edit, pause, resume, end and guarded Undo', async () => {
    const d = fresh();
    const r = await add(d, { renewalDate: '2027-01-01', noticeByDate: '2026-12-01', cadence: { mode: 'fixed', rule: { freq: 'weekly', interval: 1, end: { type: 'never' } }, anchorDate: TODAY } });
    const keep = async () => (await getArrangement(r.id, d))!.data;
    for (const action of ['pause', 'resume'] as const) {
      const plan = await planLifecycle(r.id, action, TODAY, d);
      await applyLifecycle({ action, arrangementId: r.id, expect: plan.expect, today: TODAY }, d);
      expect(await keep()).toMatchObject({ renewalDate: '2027-01-01', noticeByDate: '2026-12-01' });
    }
    const set = await setContractDates(r.id, { renewalDate: '2028-01-01', noticeByDate: '2027-12-01' }, (await getArrangement(r.id, d))!.updatedAt, d);
    expect(await keep()).toMatchObject({ renewalDate: '2028-01-01' });
    await applyUndo(set.undo, d);
    expect(await keep()).toMatchObject({ renewalDate: '2027-01-01', noticeByDate: '2026-12-01' });
    const plan = await planLifecycle(r.id, 'end', TODAY, d);
    const ended = await applyLifecycle({ action: 'end', arrangementId: r.id, expect: plan.expect, today: TODAY, endReason: 'finished' }, d);
    expect(await keep()).toMatchObject({ status: 'ended', renewalDate: '2027-01-01', noticeByDate: '2026-12-01' });
    await applyUndo(ended.undo, d);
    expect(await keep()).toMatchObject({ status: 'active', renewalDate: '2027-01-01', noticeByDate: '2026-12-01' });
  });
  it('a guarded Undo of a date change is refused when the arrangement changed since', async () => {
    const d = fresh();
    const r = await add(d, { renewalDate: '2027-01-01' });
    const set = await setContractDates(r.id, { renewalDate: '2028-01-01', noticeByDate: null }, null, d);
    await new Promise((x) => setTimeout(x, 5));
    await d.moduleRecords.update(r.id, { 'data.notes': 'edited elsewhere', updatedAt: Date.now() } as never);
    const err = await applyUndo(set.undo, d).catch((e) => e);
    expect(isUndoRefused(err)).toBe(true);
    expect((await getArrangement(r.id, d))!.data.renewalDate).toBe('2028-01-01'); // nothing was rolled back over the other edit
  });
  it('31. replacing the provider keeps the dates on the old arrangement as history and gives the new one none unless the owner ticks copy', async () => {
    const d = fresh();
    const r = await add(d, { renewalDate: '2027-01-01', noticeByDate: '2026-12-01' });
    const plan = await planLifecycle(r.id, 'replace', TODAY, d);
    const res = await applyLifecycle({ action: 'replace', arrangementId: r.id, expect: plan.expect, today: TODAY, replace: { provider: { name: 'Sparkle Clean' } } }, d);
    const old = (await getArrangement(r.id, d))!, succ = (await getArrangement(res.successorId!, d))!;
    expect(old.data).toMatchObject({ status: 'ended', endReason: 'replaced', renewalDate: '2027-01-01', noticeByDate: '2026-12-01' });
    expect(succ.data.renewalDate).toBeNull();
    expect(succ.data.noticeByDate).toBeNull();
    expect((await items(d)).map((i) => i.sourceRecordId)).toEqual([]); // the old agreement is history; the new one has no dates yet
    // with the explicit tick
    const d2 = fresh();
    const r2 = await add(d2, { renewalDate: '2027-01-01', noticeByDate: '2026-12-01' });
    const p2 = await planLifecycle(r2.id, 'replace', TODAY, d2);
    const res2 = await applyLifecycle({ action: 'replace', arrangementId: r2.id, expect: p2.expect, today: TODAY, replace: { provider: { name: 'Sparkle Clean' }, copyContractDates: true } }, d2);
    expect((await getArrangement(res2.successorId!, d2))!.data).toMatchObject({ renewalDate: '2027-01-01', noticeByDate: '2026-12-01' });
    expect((await items(d2)).map((i) => i.sourceRecordId)).toEqual([`arrangement:${res2.successorId}`, `arrangement:${res2.successorId}`]);
    // Undo of the replace brings the old one back whole
    await applyUndo(res2.undo, d2);
    expect((await getArrangement(r2.id, d2))!.data).toMatchObject({ status: 'active', renewalDate: '2027-01-01' });
  });
  it('contract dates add no Task, no reminder and do not touch visits', async () => {
    const d = fresh();
    const r = await add(d, {});
    const tasksBefore = await d.moduleRecords.filter((x) => x.module === 'tasks').count();
    await setContractDates(r.id, { renewalDate: '2027-01-01', noticeByDate: '2026-12-01' }, null, d);
    expect(await d.moduleRecords.filter((x) => x.module === 'tasks').count()).toBe(tasksBefore);
    expect(await loadVisits(d)).toHaveLength(0);
    await logStandaloneVisit({ arrangementId: r.id, input: { status: 'completed', cancelledBy: null, date: '2026-11-03', title: 'Clean', chargedCents: null, chargeKind: null }, today: TODAY }, d);
    expect((await getArrangement(r.id, d))!.data.renewalDate).toBe('2027-01-01');
  });
});
