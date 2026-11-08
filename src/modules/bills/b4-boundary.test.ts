import { describe, expect, it } from 'vitest';
import type { FinanceDB } from '../../db';
import type { RecurringRule, Txn } from '../../types';
import { derivedId } from '../../core/dueProvider';
import { ledgerDueItems } from '../ledger/dueProvider';
import { saveTerms } from './contractData';
import { newOp, recordFact } from './cycleData';
import { applyLifecycle as applyB1, createObligation, getObligation } from './data';
import { billsDueItems } from './dueProvider';
import { applyLifecycle, previewLifecycle, type LcAction } from './lifecycleData';
import { lifecycleStates } from './lifecycleState';
import { periodsOf } from './periods';
import { attention, attentionLines, derive, loadBillsSnapshot } from './readModel';
import { expectedDates } from './schedule';
import { scheduleSource } from './model';
import { ensureBillTasks, loadBillTasks, markersOf } from './tasks';
import { readTerms } from './terms';
import { financeSnapshot, fresh, monthly, ob } from './billsTestkit';
import type { ObligationData } from './model';

/**
 * B4 pre-commit corrections. Part 1: a confirmation is evidence only; the stored status is never changed by it, so a cancellation confirmed on Jan 8 for Jan 31 reads as
 * "confirmed, effective in the future" until Jan 31, then "effective" (a date boundary decided by DATE COMPARISON, never by a timer), expected bills stop after the effective
 * date, and ending the bill is the owner's separate End. Part 3: the old (B2) contract dates and the new (B4) records describe the same deadlines without duplicating a Task.
 */
const TODAY = '2027-01-08';
const money = (c: number) => `$${(c / 100).toFixed(2)}`;
const mk = (over: Partial<ObligationData> = {}): ObligationData => ob({ title: 'Streamly Premium', providerNameSnapshot: 'Streamly', type: 'subscription', need: 'flexible', amountKind: 'fixed', prices: [{ from: '2026-01-01', cents: 1499, label: '' }], schedule: monthly(31, '2026-01'), trackingSince: '2026-01-01', payment: { how: 'auto', fundingAccountId: null }, ...over }, TODAY);
const make = async (over: Partial<ObligationData> = {}, d: FinanceDB = fresh('b4bnd')) => ({ d, id: (await createObligation({ data: mk(over), provider: { name: 'Streamly' }, today: TODAY }, d)).id });
const go = async (d: FinanceDB, id: number, a: LcAction, today = TODAY) => { const p = await previewLifecycle(id, a, today, money, d); if (p.problem) throw new Error(p.problem); return applyLifecycle(id, a, p.token, today, d); };
const confirm = (over: Partial<Extract<LcAction, { type: 'cancel-confirm' }>> = {}): LcAction => ({ type: 'cancel-confirm', confirmedOn: '2027-01-08', effectiveOn: '2027-01-31', providerRef: '', finalCharge: 'unknown', finalChargeCents: null, refundCents: null, accessUntil: null, note: '', ...over });
const renewal = (over: Partial<Extract<LcAction, { type: 'renewal' }>> = {}): LcAction => ({ type: 'renewal', renewalDate: '2027-04-15', cadence: 'annual', auto: false, noticeDays: null, noticeByDate: null, changes: 'unknown', confirmed: true, note: '', ...over });
const trial = (endsOn: string, over: Partial<Extract<LcAction, { type: 'trial' }>> = {}): LcAction => ({ type: 'trial', startsOn: null, endsOn, paymentOnFile: 'unknown', conversion: 'unknown', convertsToCents: null, cadence: 'unknown', mustCancel: false, noticeBy: null, note: '', makePrices: false, ...over });
const states = async (d: FinanceDB, id: number, today: string) => { const o = (await getObligation(id, d))!; return lifecycleStates(o.data.lc!, readTerms(o.data.terms), { status: o.data.status, endedOn: o.data.endedOn }, today).map((s) => s.id); };
const openTasks = async (d: FinanceDB) => (await loadBillTasks(d)).filter((t) => t.data.status !== 'done');
const purposes = async (d: FinanceDB) => (await openTasks(d)).map((t) => `${markersOf(t)!.purpose}@${markersOf(t)!.deadline ?? ''}`).sort();
const q = (today: string, from = '2026-12-01', to = '2027-12-31') => ({ from, to, today, overdueDays: 0 });
const nominals = (d: FinanceDB, id: number, from: string, to: string) => getObligation(id, d).then((o) => expectedDates(scheduleSource(o!.data), from, to).map((e) => e.nominal));

describe('B4 correction: a future-dated cancellation is never shown as Ended', () => {
  it('Jan 8 confirmed, Jan 31 effective: confirmed and still Active on Jan 8 and Jan 30; EFFECTIVE on Jan 31 (the date itself); the stored status never changes; no timer', async () => {
    const { d, id } = await make();
    const before = JSON.stringify(await d.moduleRecords.get(id));
    await go(d, id, confirm());
    expect(JSON.stringify(await d.moduleRecords.get(id))).toBe(before); // not one byte of the bill record
    for (const day of ['2027-01-08', '2027-01-30']) expect(await states(d, id, day), day).toEqual(['cancel-confirmed']);
    expect(await states(d, id, '2027-01-31')).toEqual(['cancel-effective']); // effective date equal to today
    expect(await states(d, id, '2027-02-15')).toEqual(['cancel-effective']);
    expect((await getObligation(id, d))!.data.status).toBe('active'); // at every date: nothing was flipped
    expect(await d.moduleRecords.get(id)).toEqual(JSON.parse(before)); // and reading at later dates wrote nothing
  });

  it('expected billing runs up to AND INCLUDING the effective day and stops after it; the Jan 31 period is expected, the Feb period is not', async () => {
    const { d, id } = await make();
    await go(d, id, confirm());
    expect(await nominals(d, id, '2027-01-01', '2027-06-30')).toEqual(['2027-01-31']);
    const snap = await loadBillsSnapshot(d);
    const ps = periodsOf((await getObligation(id, d))!, snap.cycles, '2027-01-31', { from: '2027-01-01', to: '2027-04-30' });
    expect(ps.filter((p) => p.expected).map((p) => p.slot)).toEqual(['m2027-01']);
  });

  it('a final invoice after the effective date can still be recorded and stays visible; the period is not expected, and its payment is not hidden', async () => {
    const { d, id } = await make();
    await go(d, id, confirm());
    await recordFact({ obligationId: id, slot: 'm2027-02', body: { fact: 'invoice', invoicedCents: 750, invoiceDate: '2027-02-03', dueDate: '2027-02-20', invoiceNumber: '', nominal: null }, op: newOp(), today: '2027-02-05' }, d);
    const snap = await loadBillsSnapshot(d);
    const feb = periodsOf((await getObligation(id, d))!, snap.cycles, '2027-02-05', { from: '2027-01-01', to: '2027-04-30' }, { allRecorded: true }).find((p) => p.slot === 'm2027-02')!;
    expect(feb.expected).toBe(false);
    expect(feb.amounts.owed).toBe(750);
    expect(feb.open).toBe(true);
    // ... and an extra bill (a partial period) too
    await recordFact({ obligationId: id, slot: 'x1730000000009999', body: { fact: 'invoice', invoicedCents: 300, invoiceDate: '2027-02-04', dueDate: null, invoiceNumber: '', nominal: null }, op: newOp(), today: '2027-02-05' }, d);
    expect((await loadBillsSnapshot(d)).cycles.filter((c) => c.body?.fact === 'invoice')).toHaveLength(2);
  });

  it('withdrawn: expected bills resume and the state returns to plain Active; replaced by a later date: the cutoff moves; reactivated: negated', async () => {
    const a = await make();
    await go(a.d, a.id, confirm());
    await go(a.d, a.id, { type: 'cancel-withdraw', on: '2027-01-10', kind: 'provider-withdrew', note: '', reopen: false }, '2027-01-10');
    expect(await states(a.d, a.id, '2027-01-12')).toEqual([]);
    expect((await nominals(a.d, a.id, '2027-01-01', '2027-04-30')).length).toBe(4);
    const b = await make();
    await go(b.d, b.id, confirm());
    await go(b.d, b.id, confirm({ effectiveOn: '2027-02-28' }));
    expect(await nominals(b.d, b.id, '2027-01-01', '2027-06-30')).toEqual(['2027-01-31', '2027-02-28']);
    expect(await states(b.d, b.id, '2027-02-10')).toEqual(['cancel-confirmed']); // the earlier effective date no longer makes it effective
    const c = await make();
    await go(c.d, c.id, confirm());
    await go(c.d, c.id, { type: 'reactivate', on: '2027-01-20', note: '', reopen: false }, '2027-01-20');
    expect((await nominals(c.d, c.id, '2027-01-01', '2027-04-30')).length).toBe(4);
  });

  it('immediate cancellation: effective the day it was confirmed (today) and billing for that day is still counted', async () => {
    const { d, id } = await make();
    await go(d, id, confirm({ confirmedOn: '2027-01-31', effectiveOn: '2027-01-31' }), '2027-01-31');
    expect(await states(d, id, '2027-01-31')).toEqual(['cancel-effective']);
    expect(await nominals(d, id, '2027-01-01', '2027-06-30')).toEqual(['2027-01-31']);
  });

  it('the owner\'s OWN B1 End: before a confirmation it governs (the later confirmation changes no status); after a confirmation it is separate and consistent', async () => {
    const a = await make();
    await applyB1({ id: a.id, action: 'end', expect: null, today: TODAY, date: '2027-01-15', reason: 'cancelled' }, a.d);
    await go(a.d, a.id, confirm());
    const oa = (await getObligation(a.id, a.d))!;
    expect(oa.data).toMatchObject({ status: 'ended', endedOn: '2027-01-15' });
    expect(await states(a.d, a.id, '2027-01-20')).toEqual(['ended']);
    expect(await nominals(a.d, a.id, '2027-01-01', '2027-06-30')).toEqual([]); // the End date (Jan 15) is before Jan 31: nothing more is expected

    const b = await make();
    await go(b.d, b.id, confirm());
    await applyB1({ id: b.id, action: 'end', expect: null, today: '2027-02-01', date: '2027-01-31', reason: 'cancelled' }, b.d);
    expect((await getObligation(b.id, b.d))!.data).toMatchObject({ status: 'ended', endedOn: '2027-01-31', endReason: 'cancelled' });
    expect(await states(b.d, b.id, '2027-02-02')).toEqual(['ended']);
    expect(await nominals(b.d, b.id, '2027-01-01', '2027-06-30')).toEqual(['2027-01-31']);
  });

  it('Today, Overview, Needs review and the Calendar agree: nothing to attend to while it is merely confirmed; the Calendar shows the effective day open, then handled; a later charge appears in all three counts the same', async () => {
    const { d, id } = await make();
    await go(d, id, confirm());
    const early = attention(derive(await loadBillsSnapshot(d), '2027-01-20'));
    const quiet = (a: ReturnType<typeof attention>) => a.items.filter((i) => i.category !== 'autopayCheck'); // (older months of an autopay bill with no Finance link are an ordinary B3 item)
    expect(quiet(early)).toEqual([]);
    expect(attentionLines(early).map((l) => l.id)).toEqual(['autopayCheck']);
    const cancel = (today: string) => billsDueItems(d, q(today, '2027-01-01')).then((r) => r.filter((i) => i.id === derivedId('bills', `cancel-${id}`, '2027-01-31')));
    expect((await cancel('2027-01-20'))[0]).toMatchObject({ status: 'open', title: 'Cancellation effective: Streamly Premium' });
    expect((await cancel('2027-02-10'))[0]).toMatchObject({ status: 'handled' });
    const t: Txn = { accountId: 1, date: '2027-02-03', amountCents: -1499, payee: 'Streamly Premium', memo: '', status: 'cleared', categoryId: 5 };
    await d.txns.add(t);
    const late = attention(derive(await loadBillsSnapshot(d), '2027-02-10'));
    expect(late.afterCancel).toBe(1);
    expect(attentionLines(late).map((l) => l.id)).toEqual(['autopayCheck', 'afterCancel']);
    expect(quiet(late).map((i) => i.category)).toEqual(['afterCancel']); // one list feeds Overview, Needs review and Today
  });

  it('Finance Scheduled is unchanged by a confirmation, keeps its own approval marker, and stays reviewable once the effective date has passed', async () => {
    const d = fresh('b4bndsched');
    const acct = (await d.accounts.add({ name: 'Test checking', kind: 'checking', openingBalanceCents: 0, openingDate: '2026-01-01' } as never)) as number;
    const ruleId = (await d.recurring.add({ accountId: acct, payee: 'Streamly Premium', amountCents: -1499, categoryId: 5, memo: '', frequency: 'monthly', startDate: '2026-01-31', active: true } as RecurringRule)) as number;
    const { id } = await make({ scheduledRuleIds: [ruleId] }, d);
    const finBefore = await financeSnapshot(d);
    const approvals = async (today: string) => (await ledgerDueItems(d, q(today, '2027-01-01', '2027-04-30'))).filter((i) => i.id.includes(`scheduled-${ruleId}`)).map((i) => i.id);
    const before = await approvals('2027-01-20');
    expect(before.length).toBeGreaterThan(0);
    await go(d, id, confirm());
    expect(await financeSnapshot(d)).toBe(finBefore);
    expect(await approvals('2027-01-20')).toEqual(before); // the Finance approval actions are exactly as they were
    expect(attention(derive(await loadBillsSnapshot(d), '2027-01-20')).scheduledAfterEnd).toBe(0); // not yet effective
    expect(attention(derive(await loadBillsSnapshot(d), '2027-02-05')).scheduledAfterEnd).toBe(1); // effective: reviewable, nothing changed there
    expect(await financeSnapshot(d)).toBe(finBefore);
  });
});

describe('B4 correction: reminder Tasks before and after the effective date', () => {
  const withTerms = async (d: FinanceDB, id: number, t: Record<string, unknown>, today = TODAY) => { const o = (await getObligation(id, d))!; await saveTerms(id, readTerms(t), o.updatedAt, today, d); };

  it('a deadline BEFORE the effective date keeps its Task; one AFTER it is retired (untouched) with Undo; an owner-edited one is never removed; nothing new appears after the date', async () => {
    const a = await make();
    await withTerms(a.d, a.id, { noticeByDate: '2027-01-20' });
    expect(await purposes(a.d)).toEqual(['notice@2027-01-20']);
    await go(a.d, a.id, confirm());
    expect(await purposes(a.d)).toEqual(['notice@2027-01-20']); // before the effective date: kept
    await ensureBillTasks(a.id, '2027-02-05', a.d);
    expect((await openTasks(a.d)).length).toBe(1); // the passed date creates nothing new

    const b = await make();
    await withTerms(b.d, b.id, { noticeByDate: '2027-02-15' });
    expect(await purposes(b.d)).toEqual(['notice@2027-02-15']);
    const r = await go(b.d, b.id, confirm());
    expect(await purposes(b.d)).toEqual([]); // after the effective date: retired
    const { runUndo } = await import('./undo');
    expect(await runUndo(r.undo, () => undefined, b.d)).toBe(true);
    expect(await purposes(b.d)).toEqual(['notice@2027-02-15']); // Undo brings it back

    const c = await make();
    await withTerms(c.d, c.id, { noticeByDate: '2027-02-15' });
    const t = (await openTasks(c.d))[0];
    await c.d.moduleRecords.put({ ...(await c.d.moduleRecords.get(t.id))!, data: { ...t.data, title: 'My own wording' } as never });
    await go(c.d, c.id, confirm());
    expect((await openTasks(c.d)).map((x) => x.data.title)).toEqual(['My own wording']); // never silently removed
  });

  it('a withdrawn confirmation brings back the Task that stood for a later deadline', async () => {
    const { d, id } = await make();
    await go(d, id, renewal({ renewalDate: '2027-04-15', auto: false }));
    expect((await purposes(d)).some((p) => p.startsWith('renewal'))).toBe(true);
    await go(d, id, confirm());
    expect(await purposes(d)).toEqual([]);
    await go(d, id, { type: 'cancel-withdraw', on: '2027-01-10', kind: 'owner-retracted', note: '', reopen: false }, '2027-01-10');
    expect((await purposes(d)).some((p) => p.startsWith('renewal'))).toBe(true);
    expect((await openTasks(d)).length).toBe(1);
  });
});

describe('B2 and B4 describe the same deadline: one actionable Task per purpose and occurrence', () => {
  const withTerms = async (d: FinanceDB, id: number, t: Record<string, unknown>) => { const o = (await getObligation(id, d))!; await saveTerms(id, readTerms(t), o.updatedAt, TODAY, d); };
  const markerIds = async (d: FinanceDB, id: number, kind: string) => (await billsDueItems(d, q(TODAY, TODAY))).filter((i) => i.id.startsWith(`bills:${kind}-${id}:`)).map((i) => i.date);

  it('1. the same trial end in B2 and B4: one Task, one marker, on that date', async () => {
    const { d, id } = await make();
    await withTerms(d, id, { trialEndsOn: '2027-02-01' });
    await go(d, id, trial('2027-02-01'));
    expect(await purposes(d)).toEqual(['trial@2027-02-01']);
    expect(await markerIds(d, id, 'trial')).toEqual(['2027-02-01']); // the actual deadline, once (the Task is dated 3 days earlier, so it does not stand in for it)
  });

  it('2. the same cancel-by date in B2 and B4: one notice Task', async () => {
    const { d, id } = await make();
    await withTerms(d, id, { noticeByDate: '2027-03-16' });
    await go(d, id, renewal({ renewalDate: '2027-04-15', auto: true, noticeByDate: '2027-03-16' }));
    expect(await purposes(d)).toEqual(['notice@2027-03-16']);
  });

  it('3. trial end and cancel-by on the same day: ONE Task (the trial), and no second marker for the notice', async () => {
    const { d, id } = await make();
    await go(d, id, trial('2027-02-01', { mustCancel: true, noticeBy: '2027-02-01' }));
    expect(await purposes(d)).toEqual(['trial@2027-02-01']);
    expect(await markerIds(d, id, 'notice')).toEqual([]);
  });

  it('4. a trial extended after its reminder exists: the untouched Task moves; an owner-moved Task is left alone and nothing is duplicated', async () => {
    const a = await make();
    await go(a.d, a.id, trial('2027-02-01'));
    const t0 = (await openTasks(a.d))[0];
    await go(a.d, a.id, { type: 'trial-extend', endsOn: '2027-02-20', note: '' });
    const open = await openTasks(a.d);
    expect(open.map((t) => t.id)).toEqual([t0.id]);
    expect(markersOf(open[0])!.deadline).toBe('2027-02-20');

    const b = await make();
    await go(b.d, b.id, trial('2027-02-01'));
    const t1 = (await openTasks(b.d))[0];
    await b.d.moduleRecords.put({ ...(await b.d.moduleRecords.get(t1.id))!, data: { ...t1.data, dueDate: '2027-01-25' } as never }); // the owner moved the reminder
    await go(b.d, b.id, { type: 'trial-extend', endsOn: '2027-02-20', note: '' });
    const open2 = await openTasks(b.d);
    expect(open2.map((t) => [t.id, t.data.dueDate])).toEqual([[t1.id, '2027-01-25']]); // untouched by Bills, not duplicated, not removed
    expect(attention(derive(await loadBillsSnapshot(b.d), TODAY)).taskProblems).toBe(1); // reported for a look instead
  });

  it('5. a renewal date that changes: the Task follows it (one Task), and the Calendar id is per date', async () => {
    const { d, id } = await make();
    await go(d, id, renewal({ renewalDate: '2027-04-15' }));
    const t0 = (await openTasks(d))[0];
    await go(d, id, renewal({ renewalDate: '2027-05-01' }));
    const open = await openTasks(d);
    expect(open.map((t) => t.id)).toEqual([t0.id]);
    expect(markersOf(open[0])!.deadline).toBe('2027-05-01');
    expect(open.length).toBe(1);
  });

  it('6. a confirmed cancellation removes the expected renewal (marker and Task); no stored future Tasks or events appear', async () => {
    const { d, id } = await make();
    await go(d, id, renewal({ renewalDate: '2027-04-15', cadence: 'monthly' }));
    await go(d, id, confirm());
    expect(await markerIds(d, id, 'renewal')).toEqual([]);
    expect(await purposes(d)).toEqual([]);
    expect(await d.dueItems.count()).toBe(0);
    expect((await d.moduleRecords.toArray()).filter((r) => r.module === 'calendar').length).toBe(0);
    expect((await loadBillTasks(d)).length).toBeLessThanOrEqual(2); // a handful of Tasks that ever existed, never one per month
  });

  it('9. a Household Services marker for the same deadline: the Bills Task stays (a Task is an action, not a marker), and a service visit is never hidden', async () => {
    const { d, id } = await make();
    await go(d, id, renewal({ renewalDate: '2027-04-15', noticeByDate: '2027-03-16' }));
    const tasksBefore = JSON.stringify(await openTasks(d));
    await d.moduleRecords.add({ id: 880001, module: 'services', kind: 'arrangement', data: { title: 'House cleaners', status: 'active', providerNameSnapshot: 'Cleaning Co', renewalDate: '2027-04-15', noticeByDate: '2027-03-16' }, createdAt: 1, updatedAt: 1, deletedAt: null } as never);
    const { previewServiceLink, applyServiceLink } = await import('./crossLinks');
    const p = await previewServiceLink(id, 880001, 'linked', d);
    await applyServiceLink(id, 880001, 'linked', p.token, TODAY, d);
    expect(JSON.stringify(await openTasks(d))).toBe(tasksBefore);
    expect((await billsDueItems(d, q(TODAY, TODAY))).filter((i) => i.coveredBy).map((i) => i.id.split(':')[1].replace(/-\d+$/, '')).sort()).toEqual(['notice', 'renewal']);
  });
});
