import { describe, expect, it } from 'vitest';
import type { FinanceDB } from '../../db';
import type { ModuleRecord } from '../../core/entities';
import { applyLifecycle as applyB1, createObligation, editObligation, getObligation, loadObligations, planDelete, type ObligationEdit } from './data';
import { LC_KIND } from './lifecycleModel';
import { lifecycleRecordsOf } from './lifecycleRead';
import { acknowledgeEvidence, applyLifecycle, previewLifecycle, type LcAction } from './lifecycleData';
import { loadLifecycleFinance, scheduledAfterEnd } from './lifecycleFinance';
import { attention, attentionLines, derive, loadBillsSnapshot } from './readModel';
import { loadBillTasks, markersOf } from './tasks';
import { periodsOf } from './periods';
import { runUndo } from './undo';
import { newOp, recordFact } from './cycleData';
import { financeSnapshot, fresh, monthly, ob } from './billsTestkit';
import type { ObligationData } from './model';
import { toStored } from './model';
import type { RecurringRule, Txn } from '../../types';

/**
 * B4 against a real database: every action previews, refuses a stale preview, applies in one transaction, rolls back whole on a failure and can be undone only while
 * nothing it touched has changed. Finance tables are snapshotted around everything. Invented data only.
 */
const TODAY = '2026-11-20';
const money = (c: number) => `$${(c / 100).toFixed(2)}`;
const mk = (over: Partial<ObligationData> = {}): ObligationData => ob({
  title: 'Streamly Premium', providerNameSnapshot: 'Streamly', type: 'subscription', need: 'flexible', amountKind: 'fixed', prices: [{ from: '2026-01-01', cents: 1499, label: '' }],
  schedule: monthly(12, '2026-01'), trackingSince: '2026-01-01', payment: { how: 'auto', fundingAccountId: null }, ...over,
}, TODAY);
const make = async (over: Partial<ObligationData> = {}, d: FinanceDB = fresh('b4')) => ({ d, id: (await createObligation({ data: mk(over), provider: { name: 'Streamly' }, today: TODAY }, d)).id });
const go = async (d: FinanceDB, id: number, a: LcAction, today = TODAY) => {
  const p = await previewLifecycle(id, a, today, money, d);
  if (p.problem) throw new Error(`preview problem: ${p.problem}`);
  return { p, r: await applyLifecycle(id, a, p.token, today, d) };
};
const lcRows = async (d: FinanceDB) => (await d.moduleRecords.where('[module+kind]').equals(['bills', LC_KIND]).toArray()).filter((r) => r.deletedAt == null);
const obRow = async (d: FinanceDB, id: number) => JSON.stringify(await d.moduleRecords.get(id));
const cyRows = async (d: FinanceDB) => JSON.stringify(await d.moduleRecords.where('[module+kind]').equals(['bills', 'cycle']).toArray());

const invoice = (d: FinanceDB, id: number, slot: string, cents: number, extra: { dueDate?: string; invoiceDate?: string } = {}) =>
  recordFact({ obligationId: id, slot, body: { fact: 'invoice', invoicedCents: cents, invoiceDate: extra.invoiceDate ?? null, dueDate: extra.dueDate ?? null, invoiceNumber: '', nominal: null }, op: newOp(), today: TODAY }, d);
const request = (over: Partial<Extract<LcAction, { type: 'cancel-request' }>> = {}): LcAction => ({ type: 'cancel-request', requestedOn: '2026-11-18', requestedEffectiveOn: null, method: 'website', ref: '', awaiting: true, note: '', followUpOn: null, ...over });
const confirm = (over: Partial<Extract<LcAction, { type: 'cancel-confirm' }>> = {}): LcAction => ({ type: 'cancel-confirm', confirmedOn: '2026-11-19', effectiveOn: '2026-12-31', providerRef: '', finalCharge: 'unknown', finalChargeCents: null, refundCents: null, accessUntil: null, note: '', ...over });
const price = (from: string, cents: number | null, over: Partial<Extract<LcAction, { type: 'price' }>> = {}): LcAction => ({ type: 'price', from, until: null, cents, status: cents === null ? 'unknown' : 'fixed', label: '', source: 'provider-notice', note: '', ...over });
const trial = (over: Partial<Extract<LcAction, { type: 'trial' }>> = {}): LcAction => ({ type: 'trial', startsOn: '2026-11-10', endsOn: '2026-11-24', paymentOnFile: 'yes', conversion: 'auto', convertsToCents: 1499, cadence: 'monthly', mustCancel: false, noticeBy: null, note: '', makePrices: false, ...over });
const renewal = (over: Partial<Extract<LcAction, { type: 'renewal' }>> = {}): LcAction => ({ type: 'renewal', renewalDate: '2027-04-15', cadence: 'annual', auto: true, noticeDays: null, noticeByDate: null, changes: 'unknown', confirmed: true, note: '', ...over });

describe('B4 recording a cancellation request', () => {
  it('writes ONE record, leaves the bill record, its status, its periods and Finance untouched, and says it is not contacting the provider', async () => {
    const { d, id } = await make();
    const before = await obRow(d, id), fin = await financeSnapshot(d), cy = await cyRows(d);
    const { p, r } = await go(d, id, request());
    expect(p.lines.join(' ')).toMatch(/Ledger is only recording your request\. It does not contact the provider/);
    expect(p.lines.join(' ')).toMatch(/stays active/);
    expect(await lcRows(d)).toHaveLength(1);
    expect(r.ids).toHaveLength(1);
    expect(await obRow(d, id)).toBe(before); // not one byte of the bill record changed
    expect(await cyRows(d)).toBe(cy);
    expect(await financeSnapshot(d)).toBe(fin);
    const o = (await getObligation(id, d))!;
    expect(o.data.status).toBe('active');
    expect(o.data.lc?.cutoffOn).toBeNull();
  });

  it('a request is not a confirmation: expected bills continue in every period, and the reminder Tasks already made are not stopped', async () => {
    const { d, id } = await make({ reminders: { payTask: true, leadDays: 3 } });
    await go(d, id, renewal({ renewalDate: '2027-02-12', noticeByDate: '2026-12-20', auto: true }));
    const tasksBefore = (await loadBillTasks(d)).map((t) => t.id);
    expect(tasksBefore.length).toBeGreaterThan(0);
    await go(d, id, request());
    expect((await loadBillTasks(d)).map((t) => t.id).sort()).toEqual(tasksBefore.sort());
    const o = (await getObligation(id, d))!;
    const snap = await loadBillsSnapshot(d);
    const ps = periodsOf(o, snap.cycles, TODAY, { from: '2027-01-01', to: '2027-06-30' });
    expect(ps.filter((p) => p.expected).length).toBe(6);
  });

  it('can make ONE follow-up Task on request, never a second while it is open, and the Task finishing records nothing', async () => {
    const { d, id } = await make();
    await go(d, id, request({ followUpOn: '2026-11-27' }));
    const tasks = await loadBillTasks(d);
    expect(tasks).toHaveLength(1);
    expect(markersOf(tasks[0])).toMatchObject({ purpose: 'followup' });
    expect(tasks[0].data.dueDate).toBe('2026-11-27');
    await go(d, id, request({ requestedOn: '2026-11-19', followUpOn: '2026-11-28' }));
    expect((await loadBillTasks(d)).filter((t) => t.data.status !== 'done')).toHaveLength(1);
  });

  it('a confirmation retires an untouched follow-up Task (and says so first); a Task the owner changed is never removed', async () => {
    const { d, id } = await make();
    await go(d, id, request({ followUpOn: '2026-11-27' }));
    const p = await previewLifecycle(id, confirm(), TODAY, money, d);
    expect(p.lines.join(' ')).toMatch(/reminder Task that Bills made and you have not changed will be removed/);
    await applyLifecycle(id, confirm(), p.token, TODAY, d);
    expect((await loadBillTasks(d)).filter((t) => t.data.status !== 'done')).toHaveLength(0);

    const two = await make();
    await go(two.d, two.id, request({ followUpOn: '2026-11-27' }));
    const t = (await loadBillTasks(two.d))[0];
    await two.d.moduleRecords.put({ ...(await two.d.moduleRecords.get(t.id))!, data: { ...t.data, notes: 'I added a note', title: 'My own title' } as never });
    await go(two.d, two.id, confirm());
    expect((await loadBillTasks(two.d)).filter((x) => x.data.status !== 'done')).toHaveLength(1);
  });

  it('refuses a request on a bill that has already ended, and a record dated nonsense', async () => {
    const { d, id } = await make({ status: 'ended', endedOn: '2026-10-01', endReason: 'cancelled' });
    expect((await previewLifecycle(id, request(), TODAY, money, d)).problem).toMatch(/already ended/);
    const two = await make();
    expect((await previewLifecycle(two.id, request({ requestedOn: '2026-02-30' }), TODAY, money, two.d)).problem).toMatch(/not a real date/);
    expect(await lcRows(two.d)).toHaveLength(0);
  });
});

describe('B4 recording a confirmation', () => {
  it('stops expected bills after the effective date without ending the bill; both records stay; the preview explains what stays and what Finance still needs', async () => {
    const { d, id } = await make({ scheduledRuleIds: [999] });
    await go(d, id, request());
    const { p } = await go(d, id, confirm());
    const text = p.lines.join(' ');
    expect(text).toMatch(/Service is not shown as ended before 2026-12-31/);
    expect(text).toMatch(/still counted up to and including 2026-12-31/);
    expect(text).toMatch(/Bills and payments already recorded stay/);
    expect(text).toMatch(/Nothing in Finance changes/);
    expect(p.warnings.join(' ')).toMatch(/Finance scheduled payment is not changed/);
    const o = (await getObligation(id, d))!;
    expect(o.data.status).toBe('active');
    expect(o.data.lc?.cutoffOn).toBe('2026-12-31');
    expect(o.data.lc?.records).toHaveLength(2);
    const snap = await loadBillsSnapshot(d);
    const ps = periodsOf(o, snap.cycles, TODAY, { from: '2026-11-01', to: '2027-06-30' }).filter((x) => x.expected);
    expect(ps.map((x) => x.slot)).toEqual(['m2026-11', 'm2026-12']);
  });

  it('confirmation with no earlier request is accepted; immediate cancellation is effective that day', async () => {
    const { d, id } = await make();
    await go(d, id, confirm({ confirmedOn: TODAY, effectiveOn: TODAY }));
    expect((await getObligation(id, d))!.data.lc?.cutoffOn).toBe(TODAY);
  });

  it('a confirmation NEVER changes the stored status or the bill record (pre-commit correction: there is no "also mark ended" action); Undo removes it', async () => {
    const { d, id } = await make();
    const before = await obRow(d, id);
    const { r, p } = await go(d, id, confirm());
    expect(p.lines.join(' ')).toMatch(/status is not changed/);
    expect(await obRow(d, id)).toBe(before);
    expect((await getObligation(id, d))!.data.status).toBe('active');
    expect(await runUndo(r.undo, () => undefined, d)).toBe(true);
    expect(await lcRows(d)).toHaveLength(0);
  });

  it('Provider changes the effective date: the new confirmation replaces the old; the old stays visible as history', async () => {
    const { d, id } = await make();
    await go(d, id, confirm());
    await go(d, id, confirm({ effectiveOn: '2027-01-15' }));
    const o = (await getObligation(id, d))!;
    expect(o.data.lc?.cutoffOn).toBe('2027-01-15');
    expect(o.data.lc?.conflicts).toEqual([]);
    expect(o.data.lc?.records).toHaveLength(2);
    expect(o.data.lc?.replaced.size).toBe(1);
  });

  it('withdrawing a confirmation (provider rejected it) brings expected bills back; reopening an ended bill is the owner\'s explicit choice', async () => {
    const { d, id } = await make();
    await go(d, id, request());
    await go(d, id, confirm());
    await applyB1({ id, action: 'end', expect: null, today: TODAY, date: '2026-12-31', reason: 'cancelled' }, d); // the owner's own, separate End
    expect((await getObligation(id, d))!.data.status).toBe('ended');
    await go(d, id, { type: 'cancel-withdraw', on: TODAY, kind: 'provider-rejected', note: '', reopen: true });
    const o = (await getObligation(id, d))!;
    expect(o.data.status).toBe('active');
    expect(o.data.lc?.cutoffOn).toBeNull();
    expect(o.data.lc?.cancel.negated.size).toBe(2);
    expect(o.data.lc?.records).toHaveLength(3);
  });

  it('reactivating a subscription later negates the cancellation but keeps it in the history', async () => {
    const { d, id } = await make();
    await go(d, id, confirm({ confirmedOn: '2026-06-01', effectiveOn: '2026-06-30' }));
    await go(d, id, { type: 'reactivate', on: '2026-09-01', note: '', reopen: false });
    const o = (await getObligation(id, d))!;
    expect(o.data.lc?.cutoffOn).toBeNull();
    expect(o.data.lc?.records).toHaveLength(2);
  });

  it('there is nothing to withdraw when no cancellation is on record', async () => {
    const { d, id } = await make();
    expect((await previewLifecycle(id, { type: 'cancel-withdraw', on: TODAY, kind: 'owner-retracted', note: '', reopen: false }, TODAY, money, d)).problem).toMatch(/no cancellation on record/);
  });

  it('final charges and refunds are only NOTES: no money is created, and an invoice for the final bill can still be recorded after the effective date', async () => {
    const { d, id } = await make();
    const fin = await financeSnapshot(d);
    const { p } = await go(d, id, confirm({ finalCharge: 'expected', finalChargeCents: 750, refundCents: 300 }));
    expect(p.lines.join(' ')).toMatch(/note, not a payment/);
    expect(p.lines.join(' ')).toMatch(/Ledger does not create a refund/);
    expect(await financeSnapshot(d)).toBe(fin);
    const ob2 = (await getObligation(id, d))!;
    void ob2;
    const extra = await invoice(d, id, 'x1730000000000123', 750, { invoiceDate: '2027-01-03', dueDate: '2027-01-20' });
    expect(extra.id).toBeGreaterThan(0); // the final bill after the effective date can still be recorded
  });
});

describe('B4 guarded: stale previews, rollback and Undo', () => {
  it('a stale preview refuses and writes nothing (another action changed the evidence in between)', async () => {
    const { d, id } = await make();
    const p1 = await previewLifecycle(id, request(), TODAY, money, d);
    await go(d, id, { type: 'cancel-plan', plannedOn: null, note: '' });
    const rows = JSON.stringify(await lcRows(d));
    await expect(applyLifecycle(id, request(), p1.token, TODAY, d)).rejects.toThrow(/Something changed since you opened this/);
    expect(JSON.stringify(await lcRows(d))).toBe(rows);
  });

  it('a stale preview also refuses when the bill record itself changed', async () => {
    const { d, id } = await make();
    const p = await previewLifecycle(id, request(), TODAY, money, d);
    const cur = (await getObligation(id, d))!;
    const e: ObligationEdit = { title: 'Streamly Premium (renamed)', type: 'subscription', need: 'flexible', amountKind: 'fixed', amountCents: 1499, trackingSince: '2026-01-01', schedule: cur.data.schedule, payment: cur.data.payment, paidThroughLoan: false, review: { on: false, note: '' }, refs: [], notes: '' };
    await editObligation(id, e, cur.updatedAt, TODAY, d);
    await expect(applyLifecycle(id, request(), p.token, TODAY, d)).rejects.toThrow(/Something changed/);
    expect(await lcRows(d)).toHaveLength(0);
  });

  it('a failure partway through rolls EVERYTHING back: no record, no Task, the bill unchanged', async () => {
    const { d, id } = await make({ reminders: { payTask: true, leadDays: 3 } });
    const before = await obRow(d, id);
    const tasks = JSON.stringify(await loadBillTasks(d));
    const p = await previewLifecycle(id, confirm(), TODAY, money, d);
    await expect(applyLifecycle(id, confirm(), p.token, TODAY, d, { afterWrite: async () => { throw new Error('boom'); } })).rejects.toThrow('boom');
    expect(await lcRows(d)).toHaveLength(0);
    expect(await obRow(d, id)).toBe(before);
    expect(JSON.stringify(await loadBillTasks(d))).toBe(tasks);
  });

  it('Undo removes exactly what the action added; it refuses (writing nothing) once anything it touched has changed', async () => {
    const { d, id } = await make();
    const a = await go(d, id, request());
    const b = await go(d, id, confirm());
    const say: string[] = [];
    // the request's own records changed? it was only added; Undo of A is fine while its record is untouched
    expect(await runUndo(a.r.undo, (t) => say.push(t), d)).toBe(true);
    expect(await lcRows(d)).toHaveLength(1);
    // a remote edit of the confirmation record (simulated) makes its Undo refuse and write nothing
    const row = (await d.moduleRecords.get(b.r.ids[0]))!;
    await d.moduleRecords.put({ ...row, updatedAt: row.updatedAt + 5, data: { ...(row.data as object), note: 'edited elsewhere' } as never });
    const snapshot = JSON.stringify(await lcRows(d));
    expect(await runUndo(b.r.undo, (t) => say.push(t), d)).toBe(false);
    expect(say.at(-1)).toMatch(/can no longer be undone/);
    expect(JSON.stringify(await lcRows(d))).toBe(snapshot);
  });

  it('an action on a bill that no longer exists changes nothing', async () => {
    const { d, id } = await make();
    const p = await previewLifecycle(id, request(), TODAY, money, d);
    await d.moduleRecords.update(id, { deletedAt: Date.now() });
    await expect(applyLifecycle(id, request(), p.token, TODAY, d)).rejects.toThrow(/no longer exists/);
    expect(await lcRows(d)).toHaveLength(0);
  });
});

describe('B4 trials', () => {
  it('records a trial with its price steps; Ledger shows the dates, makes the deadline Task and never a Finance transaction or payment', async () => {
    const { d, id } = await make();
    const fin = await financeSnapshot(d);
    const { p } = await go(d, id, trial({ makePrices: true, mustCancel: true, noticeBy: '2026-11-22' }));
    expect(p.lines.join(' ')).toMatch(/never assume the trial turned into a paid plan/);
    expect(await financeSnapshot(d)).toBe(fin);
    const o = (await getObligation(id, d))!;
    const steps = o.data.lc!.priceRows.map((r) => [r.from, r.cents]);
    expect(steps).toEqual([['2026-01-01', 1499], ['2026-11-10', 0], ['2026-11-25', 1499]]);
    const tasks = await loadBillTasks(d);
    expect(tasks.map((t) => markersOf(t)?.purpose)).toEqual(['notice']); // the cancel-by is THE action; the trial end is informational
    expect(tasks[0].data.dueDate).toBe('2026-11-20'); // the reminder is 3 days before the deadline but never before today ...
    expect(markersOf(tasks[0])?.deadline).toBe('2026-11-22'); // ... and the real deadline is kept apart from the reminder date
    expect(await lcRows(d)).toHaveLength(3);
  });

  it('a trial that ends on the cancel-by day makes ONE Task, and no Task at all when the owner turned deadline Tasks off', async () => {
    const a = await make();
    await go(a.d, a.id, trial({ endsOn: '2026-12-01', mustCancel: true, noticeBy: '2026-12-01' }));
    expect((await loadBillTasks(a.d)).map((t) => markersOf(t)?.purpose)).toEqual(['trial']);
    const b = await make({ noDeadlineTasks: true });
    await go(b.d, b.id, trial());
    expect(await loadBillTasks(b.d)).toHaveLength(0);
  });

  it('an unknown conversion price is recorded as unknown, never zero; an unknown cadence is allowed', async () => {
    const { d, id } = await make();
    await go(d, id, trial({ convertsToCents: null, cadence: 'unknown', makePrices: true }));
    const o = (await getObligation(id, d))!;
    expect(o.data.lc!.priceRows.find((r) => r.label === 'after the trial')).toMatchObject({ cents: null, status: 'unknown' });
  });

  it('an extension replaces the trial end and moves the Task; the earlier end date is kept as history', async () => {
    const { d, id } = await make();
    await go(d, id, trial({ endsOn: '2026-11-24' }));
    const t0 = await loadBillTasks(d);
    expect(t0).toHaveLength(1);
    await go(d, id, { type: 'trial-extend', endsOn: '2026-12-08', note: 'provider extended' });
    const o = (await getObligation(id, d))!;
    expect(o.data.lc!.trial.endsOn).toBe('2026-12-08');
    expect(o.data.lc!.replaced.size).toBe(1);
    const open = (await loadBillTasks(d)).filter((t) => t.data.status !== 'done');
    expect(open).toHaveLength(1);
    expect(open[0].id).toBe(t0[0].id);
    expect(markersOf(open[0])?.deadline).toBe('2026-12-08'); // moved, not duplicated
  });

  it('a trial cancelled before conversion, or an outcome recorded, ends the trial deadline; a trial that expired with no evidence is only a review item', async () => {
    const { d, id } = await make();
    await go(d, id, trial({ endsOn: '2026-11-15' }));
    let a = attention(derive(await loadBillsSnapshot(d), TODAY));
    expect(a.passedDates).toBe(1);
    expect(a.items.find((i) => i.category === 'passedDates')?.text).toMatch(/Ledger did not convert anything and does not know what happened/);
    await go(d, id, { type: 'trial-outcome', outcome: 'cancelled', on: '2026-11-14', note: '' });
    a = attention(derive(await loadBillsSnapshot(d), TODAY));
    expect(a.passedDates).toBe(0);
  });

  it('trial-to-paid with no Finance posting leaves no transaction, link or invoice', async () => {
    const { d, id } = await make();
    await go(d, id, trial({ makePrices: true }));
    await go(d, id, { type: 'trial-outcome', outcome: 'converted', on: '2026-11-25', note: '' });
    expect(await d.txns.count()).toBe(0);
    expect(JSON.parse(await cyRows(d))).toEqual([]);
  });
});

describe('B4 price history', () => {
  it('a price change adds ONE record and changes nothing already recorded: invoices, payment links and Finance stay exactly as they were', async () => {
    const { d, id } = await make();
    await invoice(d, id, 'm2026-12', 1499, { invoiceDate: '2026-12-01', dueDate: '2026-12-12' });
    const cy = await cyRows(d), fin = await financeSnapshot(d), row = await obRow(d, id);
    const { p } = await go(d, id, price('2026-12-01', 1799));
    expect(p.lines.join(' ')).toMatch(/From 2026-12-01: \$17\.99 \(was \$14\.99; \+\$3\.00 per bill\)/);
    expect(p.lines.join(' ')).toMatch(/Over those, about \+\$36\.00/);
    expect(await cyRows(d)).toBe(cy);
    expect(await financeSnapshot(d)).toBe(fin);
    expect(await obRow(d, id)).toBe(row);
    expect((await lcRows(d))).toHaveLength(1);
  });

  it('retroactive: a price starting in the PAST changes expected amounts only; a recorded invoice keeps its amount', async () => {
    const { d, id } = await make();
    await invoice(d, id, 'm2026-10', 1499, { invoiceDate: '2026-10-01', dueDate: '2026-10-12' });
    const { p } = await go(d, id, price('2026-10-01', 1999));
    const o = (await getObligation(id, d))!;
    const snap = await loadBillsSnapshot(d);
    const ps = periodsOf(o, snap.cycles, TODAY, { from: '2026-09-01', to: '2026-12-31' }, { allRecorded: true });
    const oct = ps.find((x) => x.slot === 'm2026-10')!, nov = ps.find((x) => x.slot === 'm2026-11')!;
    expect(nov.amounts.owed).toBe(1999);
    expect(oct.amounts.owed).toBe(1499); // the invoice is untouched by the retroactive price
    expect(p.lines.join(' ')).toMatch(/already has a bill you recorded/);
  });

  it('a step on the first price\'s own day is refused with a plain message; a correction of a recorded step replaces it', async () => {
    const { d, id } = await make();
    expect((await previewLifecycle(id, price('2026-01-01', 1200), TODAY, money, d)).problem).toMatch(/first price on the bill already starts on that day/);
    await go(d, id, price('2027-01-01', 1799));
    await go(d, id, price('2027-01-01', 1699));
    const o = (await getObligation(id, d))!;
    expect(o.data.lc!.conflicts).toEqual([]);
    expect(o.data.lc!.priceRows.find((r) => r.from === '2027-01-01')?.cents).toBe(1699);
    expect(o.data.lc!.records).toHaveLength(2); // the superseded price is still there
  });

  it('a price that starts partway between billing dates gets the extra-bill warning; an unknown price is described as unknown, never zero', async () => {
    const { d, id } = await make();
    const mid = await previewLifecycle(id, price('2027-02-20', 1799), TODAY, money, d);
    expect(mid.midPeriod).toBe(true);
    expect(mid.warnings.join(' ')).toMatch(/extra bill/);
    const unknown = await previewLifecycle(id, price('2027-02-12', null), TODAY, money, d);
    expect(unknown.lines.join(' ')).toMatch(/not known\. It is not treated as zero/);
  });

  it('Hide Amounts: the preview shows only what the masking function gives it', async () => {
    const { d, id } = await make();
    const p = await previewLifecycle(id, price('2027-01-01', 1799), TODAY, () => '$••••', d);
    expect(p.lines.join(' ')).not.toMatch(/\$\s?\d|\d+\.\d{2}/); // no dollar figure survives (dates and counts are not amounts)
    expect(p.lines.join(' ')).toMatch(/\$••••/);
  });

  it('a provider credit is NOT a price change: recording one writes no lifecycle record and the price is untouched', async () => {
    const { d, id } = await make();
    await recordFact({ obligationId: id, slot: 'm2026-12', body: { fact: 'credit', cents: 500, note: 'goodwill' }, op: newOp(), today: TODAY }, d);
    expect(await lcRows(d)).toHaveLength(0);
    expect((await getObligation(id, d))!.data.lc).toBeUndefined();
  });

  it('the lifecycle view never leaks into the stored bill: an unrelated edit after price records keeps the stored prices exactly as entered', async () => {
    const { d, id } = await make();
    await go(d, id, price('2027-01-01', 1799));
    const cur = (await getObligation(id, d))!;
    expect(cur.data.lc).toBeDefined();
    expect(JSON.stringify(toStored(cur.data))).not.toContain('"lc"');
    const e: ObligationEdit = { title: 'Streamly Premium', type: 'subscription', need: 'flexible', amountKind: 'fixed', amountCents: 1499, trackingSince: '2026-01-01', schedule: cur.data.schedule, payment: cur.data.payment, paidThroughLoan: false, review: { on: false, note: '' }, refs: [], notes: 'edited' };
    await editObligation(id, e, cur.updatedAt, TODAY, d);
    const stored = (await d.moduleRecords.get(id))!.data as { prices: unknown[]; lc?: unknown };
    expect(stored.prices).toEqual([{ from: '2026-01-01', cents: 1499, label: '' }]);
    expect(stored.lc).toBeUndefined();
  });
});

describe('B4 renewals', () => {
  it('records the term, makes only the Tasks it needs (none for an automatic renewal; ONE for a manual one), never 12 months of Tasks or events', async () => {
    const a = await make();
    await go(a.d, a.id, renewal({ auto: true }));
    expect(await loadBillTasks(a.d)).toHaveLength(0);
    const b = await make();
    await go(b.d, b.id, renewal({ auto: false, noticeDays: 30, renewalDate: '2027-04-15' }));
    expect((await loadBillTasks(b.d)).map((t) => markersOf(t)?.purpose).sort()).toEqual(['notice', 'renewal']);
    expect(await b.d.dueItems.count()).toBe(0);
    expect((await b.d.moduleRecords.toArray()).filter((r) => r.module === 'calendar').length).toBe(0);
  });

  it('"did it renew?": renewed records an outcome AND the next date in one step; the old date is history; nothing is renewed by Ledger', async () => {
    const { d, id } = await make();
    await go(d, id, renewal({ renewalDate: '2026-11-01' }));
    let a = attention(derive(await loadBillsSnapshot(d), TODAY));
    expect(a.passedDates).toBe(1);
    expect(a.items.find((i) => i.category === 'passedDates')?.text).toMatch(/Ledger did not renew anything and does not know what happened/);
    await go(d, id, { type: 'renewal-outcome', forDate: '2026-11-01', outcome: 'renewed', on: '2026-11-02', note: '', next: { renewalDate: '2027-11-01', cadence: 'annual', auto: true, noticeDays: null, noticeByDate: null, changes: 'unknown', confirmed: true } });
    const o = (await getObligation(id, d))!;
    expect(o.data.lc!.renewal.fact?.body.renewalDate).toBe('2027-11-01');
    a = attention(derive(await loadBillsSnapshot(d), TODAY));
    expect(a.passedDates).toBe(0);
    expect(await d.txns.count()).toBe(0);
  });

  it('a renewal date passing with no record only raises a review item for a limited time and never writes a renewal fact or a payment', async () => {
    const { d, id } = await make();
    await go(d, id, renewal({ renewalDate: '2026-11-01' }));
    const n0 = (await lcRows(d)).length;
    for (const today of ['2026-11-20', '2027-03-01']) attention(derive(await loadBillsSnapshot(d), today));
    expect((await lcRows(d)).length).toBe(n0);
    expect(attention(derive(await loadBillsSnapshot(d), '2027-03-01')).passedDates).toBe(0); // aged out, not nagging forever
  });

  it('renewal while a cancellation is pending keeps the Task and the marker; once confirmed, renewals after the effective date disappear', async () => {
    const { d, id } = await make();
    await go(d, id, renewal({ auto: false, renewalDate: '2027-04-15' }));
    await go(d, id, request());
    expect((await loadBillTasks(d)).filter((t) => t.data.status !== 'done')).toHaveLength(1);
    await go(d, id, confirm({ effectiveOn: '2027-01-31' }));
    expect((await loadBillTasks(d)).filter((t) => t.data.status !== 'done')).toHaveLength(0); // the renewal Task stood for something no longer expected
    expect((await getObligation(id, d))!.data.lc!.cutoffOn).toBe('2027-01-31');
  });
});

describe('B4 conflicts and review items', () => {
  const raw = async (d: FinanceDB, id: number, data: Record<string, unknown>, rid: number) => { await d.moduleRecords.add({ id: rid, module: 'bills', kind: LC_KIND, data: { obligationId: id, ...data }, createdAt: rid, updatedAt: rid, deletedAt: null } as ModuleRecord); };

  it('two confirmations that disagree: both kept, neither used, a review item with the right wording; "use this one" settles it and keeps the history', async () => {
    const { d, id } = await make();
    await raw(d, id, { fact: 'cancel-confirm', confirmedOn: '2026-11-15', effectiveOn: '2026-12-31' }, 1730000000000001);
    await raw(d, id, { fact: 'cancel-confirm', confirmedOn: '2026-11-16', effectiveOn: '2027-01-31' }, 1730000000000002);
    const o = (await getObligation(id, d))!;
    expect(o.data.lc!.cutoffOn).toBeNull();
    const a = attention(derive(await loadBillsSnapshot(d), TODAY));
    expect(a.lifecycleConflict).toBe(1);
    expect(attentionLines(a).find((l) => l.id === 'lifecycleConflict')?.text).toBe('1 subscription record disagrees with another');
    const key = o.data.lc!.conflicts[0].key;
    await go(d, id, { type: 'resolve', conflictKey: key, chooseId: 1730000000000002 });
    const after = (await getObligation(id, d))!;
    expect(after.data.lc!.conflicts).toEqual([]);
    expect(after.data.lc!.cutoffOn).toBe('2027-01-31');
    expect(after.data.lc!.records).toHaveLength(3);
  });

  it('"leave as is" acknowledges the exact evidence: the item goes quiet, the dates stay unused, and a changed record brings it back', async () => {
    const { d, id } = await make();
    await raw(d, id, { fact: 'cancel-confirm', confirmedOn: '2026-11-15', effectiveOn: '2026-12-31' }, 1730000000000001);
    await raw(d, id, { fact: 'cancel-confirm', confirmedOn: '2026-11-16', effectiveOn: '2027-01-31' }, 1730000000000002);
    const key = (await getObligation(id, d))!.data.lc!.conflicts[0].key;
    await acknowledgeEvidence(id, key, TODAY, d);
    expect(attention(derive(await loadBillsSnapshot(d), TODAY)).lifecycleConflict).toBe(0);
    expect((await getObligation(id, d))!.data.lc!.cutoffOn).toBeNull();
    await raw(d, id, { fact: 'cancel-confirm', confirmedOn: '2026-11-17', effectiveOn: '2027-03-01' }, 1730000000000003);
    expect(attention(derive(await loadBillsSnapshot(d), TODAY)).lifecycleConflict).toBe(1);
  });

  it('a cancellation request with no confirmation becomes a review item only after a week, and "leave as is" quiets it', async () => {
    const { d, id } = await make();
    await go(d, id, request({ requestedOn: '2026-11-10' }));
    expect(attention(derive(await loadBillsSnapshot(d), '2026-11-14')).cancelAwaiting).toBe(0);
    const a = attention(derive(await loadBillsSnapshot(d), TODAY));
    expect(a.cancelAwaiting).toBe(1);
    expect(a.items.find((i) => i.category === 'cancelAwaiting')?.text).toMatch(/It is still treated as active/);
    await acknowledgeEvidence(id, a.items.find((i) => i.category === 'cancelAwaiting')!.ackKey!, TODAY, d);
    expect(attention(derive(await loadBillsSnapshot(d), TODAY)).cancelAwaiting).toBe(0);
  });

  it('Today lines are counts only: no title, provider, note or amount', async () => {
    const { d, id } = await make({ title: 'Secretly Named Service', notes: 'private note 12345' });
    await go(d, id, request({ requestedOn: '2026-11-01', note: 'my private detail' }));
    const lines = attentionLines(attention(derive(await loadBillsSnapshot(d), TODAY))).map((l) => l.text).join(' | ');
    expect(lines).toMatch(/cancellation request is still awaiting confirmation/);
    expect(lines).not.toMatch(/Secretly|Streamly|private|12345|\$/);
  });
});

describe('B4 charges after a cancellation, and a Finance Scheduled payment that outlives the bill', () => {
  const txn = async (d: FinanceDB, date: string, cents: number, over: Partial<Txn> = {}) => ({ ...(await (async () => { const t: Txn = { accountId: 1, date, amountCents: cents, payee: 'Streamly Premium', memo: '', status: 'cleared', categoryId: 5, ...over }; return { ...t, id: (await d.txns.add(t)) as number }; })()) });

  it('flags a matching charge after the effective date with the right words, never links, disputes or changes anything in Finance', async () => {
    const { d, id } = await make();
    await go(d, id, confirm({ confirmedOn: '2026-06-10', effectiveOn: '2026-06-30' }));
    await txn(d, '2026-07-15', -1499);
    const fin = await financeSnapshot(d), cy = await cyRows(d);
    const a = attention(derive(await loadBillsSnapshot(d), TODAY));
    expect(a.afterCancel).toBe(1);
    expect(a.items.find((i) => i.category === 'afterCancel')?.text).toMatch(/Worth a look; nothing was disputed or changed/);
    expect(await financeSnapshot(d)).toBe(fin);
    expect(await cyRows(d)).toBe(cy); // no payment link was created
    expect((await getObligation(id, d))!.data.lc!.cutoffOn).toBe('2026-06-30'); // and the cancellation was not reopened
  });

  it('a charge before the effective date, a pending charge, and a refund each behave as described; the owner can leave the evidence as is', async () => {
    const { d, id } = await make();
    await go(d, id, confirm({ confirmedOn: '2026-06-10', effectiveOn: '2026-06-30' }));
    await txn(d, '2026-06-15', -1499);
    expect(attention(derive(await loadBillsSnapshot(d), TODAY)).afterCancel).toBe(0);
    await txn(d, '2026-07-15', -1499, { status: 'pending' });
    const a = attention(derive(await loadBillsSnapshot(d), TODAY));
    expect(a.afterCancel).toBe(1);
    await acknowledgeEvidence(id, a.items.find((i) => i.category === 'afterCancel')!.ackKey!, TODAY, d);
    expect(attention(derive(await loadBillsSnapshot(d), TODAY)).afterCancel).toBe(0);
    await txn(d, '2026-07-25', -1499); // new evidence: raised again
    expect(attention(derive(await loadBillsSnapshot(d), TODAY)).afterCancel).toBe(1);
    await txn(d, '2026-08-01', 2998); // a refund covering both: nothing left to count
    expect(attention(derive(await loadBillsSnapshot(d), TODAY)).afterCancel).toBe(0);
  });

  it('a Finance Scheduled rule that is still active for a cancelled or ended bill is a review item; ending or switching the rule off clears it; Finance is never edited', async () => {
    const d = fresh('b4sched');
    const acct = (await d.accounts.add({ name: 'Test checking', kind: 'checking', openingBalanceCents: 0, openingDate: '2026-01-01' } as never)) as number;
    const ruleId = (await d.recurring.add({ accountId: acct, payee: 'Streamly Premium', amountCents: -1499, categoryId: 5, memo: '', frequency: 'monthly', startDate: '2026-01-12', active: true } as RecurringRule)) as number;
    const { id } = await make({ scheduledRuleIds: [ruleId] }, d);
    await go(d, id, confirm({ confirmedOn: '2026-06-10', effectiveOn: '2026-06-30' }));
    const fin = await financeSnapshot(d);
    const snap = await loadBillsSnapshot(d);
    const items = scheduledAfterEnd(snap.obligations, snap.lcFinance!, TODAY);
    expect(items).toHaveLength(1);
    expect(attention(derive(snap, TODAY)).scheduledAfterEnd).toBe(1);
    expect(await financeSnapshot(d)).toBe(fin);
    await d.recurring.update(ruleId, { active: false });
    expect(attention(derive(await loadBillsSnapshot(d), TODAY)).scheduledAfterEnd).toBe(0);
  });

  it('the Finance read is one date-range read of the window after the cancellation and reads nothing when nothing is cancelled', async () => {
    const { d } = await make();
    const snap = await loadBillsSnapshot(d);
    const fin = await loadLifecycleFinance(snap.obligations, d);
    expect(fin.transactions).toEqual([]);
    expect(fin.rules.size).toBe(0);
  });
});

describe('B4 bills with lifecycle records are history', () => {
  it('cannot be permanently deleted; the reason says why', async () => {
    const { d, id } = await make();
    expect((await planDelete(id, d)).allowed).toBe(true);
    await go(d, id, { type: 'cancel-plan', plannedOn: null, note: '' });
    const plan = await planDelete(id, d);
    expect(plan.allowed).toBe(false);
    expect(plan.reasons.join(' ')).toMatch(/lifecycle record/);
  });

  it('an unrelated edit leaves every lifecycle record exactly as it was', async () => {
    const { d, id } = await make();
    await go(d, id, confirm());
    const rows = JSON.stringify(await lcRows(d));
    const cur = (await getObligation(id, d))!;
    await editObligation(id, { title: 'Streamly Premium', type: 'subscription', need: 'flexible', amountKind: 'fixed', amountCents: 1499, trackingSince: '2026-01-01', schedule: cur.data.schedule, payment: cur.data.payment, paidThroughLoan: false, review: { on: false, note: '' }, refs: [], notes: 'x' }, cur.updatedAt, TODAY, d);
    expect(JSON.stringify(await lcRows(d))).toBe(rows);
    expect((await loadObligations(d))[0].data.lc?.cutoffOn).toBe('2026-12-31');
    expect((await lifecycleRecordsOf(id, d)).length).toBe(1);
  });
});

