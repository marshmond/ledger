import { describe, expect, it } from 'vitest';
import { FinanceDB } from '../../db';
import { buildBackup, checkBackupText, restoreChecked } from '../../lib/backupFile';
import { summarizeBackup } from '../../lib/backupSummary';
import { loadTxnMap, lookupOfMap } from '../../lib/txnLookup';
import { makeTxnRef } from '../../lib/txnRef';
import type { Split, Txn } from '../../types';
import { createObligation, editObligation, getObligation, applyLifecycle, planLifecycle, type ObligationEdit } from './data';
import { loadCycles, newOp, recordFact, removeFact } from './cycleData';
import { findConflicts } from './cycleConflicts';
import { applyMove, applyRepair, planMove } from './cycleRepair';
import { periodsOf } from './periods';
import { attention, derive, loadBillsSnapshot } from './readModel';
import { billsCostRecords, billsRecordedPayments, explain } from './billsSpend';
import { applyUndo, isUndoRefused } from './undo';
import { MODULE, type ObligationData } from './model';
import { devices, fresh, inv, monthly, ob, paidOut, settle, sleep, financeSnapshot } from './billsTestkit';

/** B3 with the real SyncEngine (two devices, which also sync Finance), real backup and restore. Invented data only. 2026-11-07 is a Saturday. */
const TODAY = '2026-11-07';
const SLOT = 'm2026-11';
const mkOb = (over: Partial<ObligationData> = {}): ObligationData => ob({ title: 'Example Power Co', amountKind: 'fixed', prices: [{ from: TODAY, cents: 12000, label: '' }], schedule: monthly(18, '2026-11'), reminders: null, ...over }, TODAY);
const edit = (cur: ObligationData): ObligationEdit => ({
  title: cur.title, type: cur.type, need: cur.need, amountKind: cur.amountKind, amountCents: cur.prices[0]?.cents ?? null, trackingSince: cur.trackingSince, schedule: cur.schedule,
  payment: cur.payment, paidThroughLoan: cur.paidThroughLoan, review: { on: cur.review.on, note: cur.review.note }, refs: cur.refs, notes: cur.notes,
});
async function seeded(over: Partial<ObligationData> = {}) {
  const { A, B } = devices();
  const acct = (await A.d.accounts.add({ name: 'Test checking', kind: 'checking', openingBalanceCents: 0, openingDate: '2026-01-01' } as never)) as number;
  const r = await createObligation({ data: mkOb(over), provider: { name: 'Example Power Co' }, today: TODAY }, A.d);
  await recordFact({ obligationId: r.id, slot: SLOT, body: inv(12000), op: newOp(), today: TODAY }, A.d);
  await A.engine.initialUpload();
  await B.engine.replaceFromRemote();
  return { A, B, id: r.id, acct };
}
const addTxn = async (d: FinanceDB, acct: number, amountCents: number, over: Partial<Txn> = {}): Promise<Txn> => {
  const t: Txn = { accountId: acct, date: '2026-11-10', amountCents, payee: 'Example Power', memo: '', status: 'pending', categoryId: 5, ...over };
  return { ...t, id: (await d.txns.add(t)) as number };
};
const link = (d: FinanceDB, id: number, t: Txn, extra: { split?: number; slot?: string; switchTyped?: boolean } = {}) =>
  recordFact({ obligationId: id, slot: extra.slot ?? SLOT, body: { fact: 'payment-link', ref: makeTxnRef(t, extra.split) }, op: newOp(), today: TODAY, switchTyped: extra.switchTyped }, d);
const typed = (d: FinanceDB, id: number, cents: number) => recordFact({ obligationId: id, slot: SLOT, body: paidOut('2026-11-09', cents), op: newOp(), today: TODAY }, d);
const period = async (d: FinanceDB, id: number, slot = SLOT) => {
  const cycles = await loadCycles(d);
  const lookup = lookupOfMap(await loadTxnMap(cycles.flatMap((c) => (c.body?.fact === 'payment-link' && c.supersededBy === null ? [c.body.ref] : [])), d));
  return periodsOf((await getObligation(id, d))!, cycles, TODAY, { from: '2026-01-01', to: '2027-12-31' }, { allRecorded: true, lookup }).find((p) => p.slot === slot)!;
};
const conflicts = async (d: FinanceDB, id: number) => findConflicts([(await getObligation(id, d))!], await loadCycles(d));
const links = async (d: FinanceDB) => (await loadCycles(d)).filter((c) => c.body?.fact === 'payment-link');

describe('B3 two devices: a payment link is never lost to the other device', () => {
  it('1. a link made on A reaches B, and both compute the same paid amount from the live Finance transaction', async () => {
    const { A, B, id, acct } = await seeded();
    const t = await addTxn(A.d, acct, -12000, { status: 'cleared' });
    await link(A.d, id, t);
    await settle(A, B);
    for (const d of [A.d, B.d]) {
      expect(await links(d)).toHaveLength(1);
      const p = await period(d, id);
      expect(p.amounts).toMatchObject({ paid: 12000, remaining: 0, source: 'finance' });
      expect(p.amounts.finance!.pieces[0].status).toBe('cleared');
    }
  });

  it('2. A and B independently link DIFFERENT pieces to the same period: both facts survive on both devices and add up', async () => {
    const { A, B, id, acct } = await seeded();
    const a = await addTxn(A.d, acct, -5000), b = await addTxn(A.d, acct, -7000);
    await A.engine.sync(); await B.engine.sync(); await A.engine.sync();
    await link(A.d, id, a);
    await link(B.d, id, b);
    await settle(A, B);
    for (const d of [A.d, B.d]) {
      expect(await links(d)).toHaveLength(2);
      expect((await period(d, id)).amounts).toMatchObject({ paid: 12000, remaining: 0 });
      expect((await conflicts(d, id)).filter((c) => c.kind.startsWith('payment-') || c.kind === 'typed-and-finance')).toHaveLength(0);
    }
  });

  it('3. both devices link the SAME piece: both facts are kept (nothing is silently discarded), it is counted once, and the duplicate is reported', async () => {
    const { A, B, id, acct } = await seeded();
    const t = await addTxn(A.d, acct, -12000);
    await A.engine.sync(); await B.engine.sync(); await A.engine.sync();
    await link(A.d, id, t);
    await link(B.d, id, t);
    await settle(A, B);
    for (const d of [A.d, B.d]) {
      expect(await links(d)).toHaveLength(2);
      const p = await period(d, id);
      expect(p.amounts.paid).toBe(12000); // not 24000
      expect(p.amounts.finance!.counts).toMatchObject({ counted: 1, duplicate: 1 });
      const dup = (await conflicts(d, id)).filter((c) => c.kind === 'payment-duplicate');
      expect(dup).toHaveLength(1);
      expect(dup[0].repairs).toContain('use-one');
    }
  });

  it('4. A types a payment while B links Finance: both are preserved, the valid Finance evidence counts, the typed value is left out, a review notice is raised, and only an explicit repair resolves it', async () => {
    const { A, B, id, acct } = await seeded();
    const t = await addTxn(A.d, acct, -12000);
    await A.engine.sync(); await B.engine.sync(); await A.engine.sync();
    const ty = await typed(A.d, id, 12000);
    await link(B.d, id, t);
    await settle(A, B);
    for (const d of [A.d, B.d]) {
      const p = await period(d, id);
      expect(p.amounts).toMatchObject({ paid: 12000, source: 'finance', typedLeftOut: [12000] }); // never 24000
      const c = (await conflicts(d, id)).find((x) => x.kind === 'typed-and-finance')!;
      expect(c.severity).toBe('disagree');
      expect(attention(derive(await loadBillsSnapshot(d), TODAY)).typedFinance).toBe(1);
    }
    // nothing resolved by itself; the typed record is still there
    expect((await A.d.moduleRecords.get(ty.id))!.data).toMatchObject({ fact: 'paid-outside', cents: 12000 });
    const c = (await conflicts(A.d, id)).find((x) => x.kind === 'typed-and-finance')!;
    const keep = (await links(A.d))[0];
    await applyRepair({ key: c.key, choice: { kind: 'use-one', keepId: keep.id }, today: TODAY }, A.d);
    await settle(A, B);
    for (const d of [A.d, B.d]) {
      expect((await conflicts(d, id)).some((x) => x.kind === 'typed-and-finance')).toBe(false);
      expect((await period(d, id)).superseded.map((x) => x.id)).toEqual([ty.id]); // set aside, kept as history
      expect((await period(d, id)).amounts.paid).toBe(12000);
    }
  });

  it('5. A removes (sets aside) a link while B edits the bill: nothing else is lost, and the removal travels', async () => {
    const { A, B, id, acct } = await seeded();
    const t = await addTxn(A.d, acct, -12000);
    const r = await link(A.d, id, t);
    await settle(A, B);
    const c = (await loadCycles(A.d)).find((x) => x.id === r.id)!;
    await removeFact(c.id, c.updatedAt, TODAY, A.d);
    const cur = (await getObligation(id, B.d))!;
    await editObligation(id, { ...edit(cur.data), notes: 'B edit' }, cur.updatedAt, TODAY, B.d);
    await settle(A, B);
    for (const d of [A.d, B.d]) {
      expect(await links(d)).toHaveLength(0);
      expect((await getObligation(id, d))!.data.notes).toBe('B edit');
      expect((await loadCycles(d)).some((x) => x.body?.fact === 'invoice')).toBe(true);
      expect((await period(d, id)).amounts.paid).toBe(0);
    }
  });

  it('6. a Finance transaction deleted or altered after the link exists reaches the other device too: the link stays and reads as review or changed', async () => {
    const { A, B, id, acct } = await seeded();
    const t = await addTxn(A.d, acct, -12000);
    await link(A.d, id, t);
    await settle(A, B);
    await A.d.txns.update(t.id!, { amountCents: -9000 });
    await settle(A, B);
    for (const d of [A.d, B.d]) expect((await period(d, id)).amounts).toMatchObject({ paid: 9000, remaining: 3000 });
    await A.d.txns.delete(t.id!);
    await settle(A, B);
    for (const d of [A.d, B.d]) {
      const p = await period(d, id);
      expect(p.amounts.paid).toBe(0);
      expect(p.amounts.finance!.counts.review).toBe(1);
      expect(await links(d)).toHaveLength(1); // kept
    }
    // the transaction is on neither device any more, but the owner can still see what was linked from the snapshot
    expect((await period(B.d, id)).amounts.finance!.pieces[0].ref.snapshot).toMatchObject({ payee: 'Example Power', amountCents: -12000 });
  });

  it('7. a split reordered or changed on one device: the part link needs review on both (never moved to the part now in that position)', async () => {
    const { A, B, id, acct } = await seeded();
    const splits: Split[] = [{ amountCents: -7000, categoryId: 5 }, { amountCents: -5000, categoryId: 6 }];
    const t = await addTxn(A.d, acct, -12000, { splits });
    await link(A.d, id, t, { split: 0 });
    await settle(A, B);
    expect((await period(B.d, id)).amounts.paid).toBe(7000);
    await A.d.txns.update(t.id!, { splits: [splits[1], splits[0]] });
    await settle(A, B);
    for (const d of [A.d, B.d]) {
      const p = await period(d, id);
      expect(p.amounts.paid).toBe(0);
      expect(p.amounts.finance!.pieces[0].resolved.state).toBe('split-changed');
    }
  });

  it('8. the bill is ended on A while B links a payment: both survive, and the link still counts for its period', async () => {
    const { A, B, id, acct } = await seeded();
    const t = await addTxn(A.d, acct, -12000);
    await A.engine.sync(); await B.engine.sync(); await A.engine.sync();
    const plan = await planLifecycle(id, 'end', { today: TODAY, from: TODAY } as never, A.d);
    await applyLifecycle({ id, action: 'end', expect: plan.expect, today: TODAY, from: TODAY } as never, A.d);
    await link(B.d, id, t);
    await settle(A, B);
    for (const d of [A.d, B.d]) {
      expect(await links(d)).toHaveLength(1);
      expect((await period(d, id)).amounts.paid).toBe(12000);
    }
  });

  it('9. a period moved while a payment link exists: the link moves with it and counts for the new period on both devices', async () => {
    const { A, B, id, acct } = await seeded();
    const t = await addTxn(A.d, acct, -12000);
    await link(A.d, id, t);
    await settle(A, B);
    const mv = await planMove(id, SLOT, 'm2026-12', A.d);
    expect(mv.problem).toBeNull();
    await applyMove({ obligationId: id, from: SLOT, to: 'm2026-12', expect: mv.expect, today: TODAY }, A.d);
    await settle(A, B);
    for (const d of [A.d, B.d]) {
      expect((await period(d, id, 'm2026-12')).amounts.paid).toBe(12000);
      expect((await period(d, id, SLOT)).amounts.paid).toBe(0);
      expect((await links(d))[0].movedFrom).toBe(SLOT);
    }
  });

  it('10. a guarded Undo of a link is refused after another device changed what it touched, and writes nothing', async () => {
    const { A, B, id, acct } = await seeded();
    const t = await addTxn(A.d, acct, -12000);
    const r = await link(A.d, id, t);
    await settle(A, B);
    const c = (await loadCycles(B.d)).find((x) => x.id === r.id)!;
    await sleep(3);
    await removeFact(c.id, c.updatedAt, TODAY, B.d);
    await settle(A, B);
    const before = JSON.stringify(await A.d.moduleRecords.toArray());
    let refused = false;
    try { await applyUndo(r.undo, A.d); } catch (e) { refused = isUndoRefused(e); }
    expect(refused).toBe(true);
    expect(JSON.stringify(await A.d.moduleRecords.toArray())).toBe(before);
  });

  it('11. a fact type an older or newer build wrote (and its fields) survives an edit of the same period, sync and restore beside payment links', async () => {
    const { A, B, id, acct } = await seeded();
    const t = await addTxn(A.d, acct, -12000);
    await A.d.moduleRecords.add({ id: 660001, module: MODULE, kind: 'cycle', data: { obligationId: id, slot: SLOT, fact: 'suggestion-reject', txnId: 77, futureField: { deep: [1, 2] } }, createdAt: 1, updatedAt: 1, deletedAt: null } as never);
    await link(A.d, id, t);
    await settle(A, B);
    expect((await B.d.moduleRecords.get(660001))!.data).toMatchObject({ fact: 'suggestion-reject', futureField: { deep: [1, 2] } });
    expect((await period(B.d, id)).amounts.paid).toBe(12000);
    expect((await period(B.d, id)).unreadable.map((r) => r.id)).toEqual([660001]); // kept, shown as needing review, never counted
  });
});

describe('B3 backup and restore: links, amounts and set-aside evidence come back exactly', () => {
  it('a real backup of a bill with a typed payment set aside and two Finance links restores to the same periods, amounts and statuses', async () => {
    const src = fresh('b3bk');
    const acct = (await src.accounts.add({ name: 'Test checking', kind: 'checking', openingBalanceCents: 0, openingDate: '2026-01-01' } as never)) as number;
    const r = await createObligation({ data: mkOb(), provider: { name: 'Example Power Co' }, today: TODAY }, src);
    await recordFact({ obligationId: r.id, slot: SLOT, body: inv(12000), op: newOp(), today: TODAY }, src);
    await typed(src, r.id, 5000);
    const a = await addTxn(src, acct, -5000, { status: 'cleared' }), b = await addTxn(src, acct, -7000, { status: 'reconciled' });
    await link(src, r.id, a, { switchTyped: true });
    await link(src, r.id, b);
    const before = await period(src, r.id);
    expect(before.amounts).toMatchObject({ paid: 12000, remaining: 0 });
    const text = JSON.stringify(await buildBackup(src));
    const groups = summarizeBackup(JSON.parse(text));
    expect(JSON.stringify(groups)).not.toMatch(/Example|Test checking|\$\s?\d|12000|5000|7000/); // no provider names, no amounts
    expect(groups.find((g) => g.id === 'bills')!.items).toEqual([{ label: 'Bills and subscriptions', n: 1 }, { label: 'Billing-period records', n: 4 }]); // the bill; invoice, typed payment, two links
    const dst = fresh('b3bk2');
    const mem = new Map<string, string>();
    await restoreChecked(dst, checkBackupText(text).file, { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); }, removeItem: (k: string) => { mem.delete(k); } } as never);
    const after = await period(dst, r.id);
    expect(after.amounts).toMatchObject({ paid: 12000, remaining: 0, source: 'finance', typedLeftOut: [] });
    expect(after.amounts.finance!.pieces.map((p) => p.status)).toEqual(['cleared', 'reconciled']);
    expect(after.superseded).toHaveLength(1); // the typed payment is still there as history
    expect(await links(dst)).toHaveLength(2);
    expect(await financeSnapshot(dst, false)).toBe(await financeSnapshot(src, false)); // a restore re-stamps update times, nothing else
  });
});

describe('B3 the same Finance payment referenced from Bills, Household Services and Home & Assets', () => {
  it('Bills counts it once; the other modules\' records and totals are not modified, and adding the Bills link changes neither', async () => {
    const d = fresh('b3x');
    const acct = (await d.accounts.add({ name: 'Test checking', kind: 'checking', openingBalanceCents: 0, openingDate: '2026-01-01' } as never)) as number;
    const r = await createObligation({ data: mkOb(), provider: { name: 'Example Power Co' }, today: TODAY }, d);
    const t = await addTxn(d, acct, -12000);
    // Home & Assets and Household Services keep their own references in their own records: one of each, pointing at the SAME transaction
    const { createAsset } = await import('../assets/data');
    const { blankAsset } = await import('../assets/model');
    const { blankService } = await import('../assets/service');
    const { insertService, loadServices } = await import('../assets/serviceData');
    const { costRecords, spend } = await import('../assets/spending');
    const asset = await createAsset(blankAsset({ name: 'Test furnace' }), d);
    await insertService(blankService(asset, { title: 'Service call', date: '2026-11-05', kind: 'maintenance', txnRefs: [makeTxnRef(t)] }), d, TODAY);
    const modulesBefore = JSON.stringify((await d.moduleRecords.toArray()).filter((x) => x.module !== MODULE));
    const lookup = lookupOfMap(await loadTxnMap([makeTxnRef(t)], d));
    const homeBefore = spend(costRecords([{ id: asset, createdAt: 0, updatedAt: 0, data: blankAsset({ name: 'Test furnace' }) } as never], await loadServices(d)), lookup);
    await link(d, r.id, t);
    // nothing outside Bills moved
    expect(JSON.stringify((await d.moduleRecords.toArray()).filter((x) => x.module !== MODULE))).toBe(modulesBefore);
    const homeAfter = spend(costRecords([{ id: asset, createdAt: 0, updatedAt: 0, data: blankAsset({ name: 'Test furnace' }) } as never], await loadServices(d)), lookup);
    expect(homeAfter.totalCents).toBe(homeBefore.totalCents);
    expect(homeAfter.totalCents).toBe(12000);
    // and Bills' own figure counts it once
    const snap = await loadBillsSnapshot(d);
    const recs = billsCostRecords(snap.obligations, snap.cycles);
    expect(billsRecordedPayments(recs, lookupOfMap(snap.financeTxns)).totalCents).toBe(12000);
    expect(explain(recs, lookupOfMap(snap.financeTxns)).map((p) => p.key)).toEqual([`${t.id}:w`]);
  });

  it('a payment that a Household Services visit and a Home & Assets record both reach: linking it in Bills changes neither module\'s records nor Household Services\' own household total (the B5 union is not built here)', async () => {
    const d = fresh('b3x2');
    const acct = (await d.accounts.add({ name: 'Test checking', kind: 'checking', openingBalanceCents: 0, openingDate: '2026-01-01' } as never)) as number;
    const r = await createObligation({ data: mkOb(), provider: { name: 'Example Power Co' }, today: TODAY }, d);
    const t = await addTxn(d, acct, -12000);
    const { createAsset } = await import('../assets/data');
    const { blankAsset } = await import('../assets/model');
    const { blankService } = await import('../assets/service');
    const { insertService } = await import('../assets/serviceData');
    const { logStandaloneVisit } = await import('../services/visits');
    const { setVisitPayment } = await import('../services/payments');
    const { loadServicesOverview } = await import('../services/servicesOverview');
    const asset = await createAsset(blankAsset({ name: 'Test furnace' }), d);
    await insertService(blankService(asset, { title: 'Service call', date: '2026-11-05', kind: 'maintenance', txnRefs: [makeTxnRef(t)] }), d, TODAY);
    const visit = (await logStandaloneVisit({ arrangementId: null, provider: { name: 'Rosa Cleaning' }, input: { status: 'completed', cancelledBy: null, date: '2026-11-05', title: 'Furnace check', chargedCents: null, chargeKind: null }, today: TODAY }, d)).visitId;
    await setVisitPayment(visit, { source: 'finance', refs: [makeTxnRef(t)], manualCents: null }, null, d);
    const others = async () => JSON.stringify((await d.moduleRecords.toArray()).filter((x) => x.module !== MODULE));
    const before = await others();
    const household = async () => { const o = await loadServicesOverview('all', TODAY, d); return { total: o.spend.totalCents, finance: o.spend.financeCents, pieces: o.spend.pieces.map((p) => `${p.key}:${p.cents}:${p.modules.join('+')}`) }; };
    const h0 = await household();
    expect(h0.total).toBe(12000); // Household Services and Home & Assets reach the same piece: counted once
    await link(d, r.id, t);
    expect(await others()).toBe(before); // no other module's record moved
    expect(await household()).toEqual(h0); // S5's household figure does not know about, and is not changed by, the Bills link
    const snap = await loadBillsSnapshot(d);
    expect(billsRecordedPayments(billsCostRecords(snap.obligations, snap.cycles), lookupOfMap(snap.financeTxns)).totalCents).toBe(12000); // and Bills counts it once on its own
  });
});
