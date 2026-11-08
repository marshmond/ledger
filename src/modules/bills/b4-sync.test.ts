import { describe, expect, it } from 'vitest';
import type { FinanceDB } from '../../db';
import type { ModuleRecord } from '../../core/entities';
import { buildBackup, checkBackupText, restoreChecked } from '../../lib/backupFile';
import { summarizeBackup } from '../../lib/backupSummary';
import { makeTxnRef } from '../../lib/txnRef';
import type { RecurringRule, Txn } from '../../types';
import { newOp, recordFact } from './cycleData';
import { createObligation, getObligation } from './data';
import { applyServiceLink, billLinks, previewServiceLink, serviceLinksFor } from './crossLinks';
import { applyLifecycle, previewLifecycle, type LcAction } from './lifecycleData';
import { LC_KIND } from './lifecycleModel';
import { periodsOf } from './periods';
import { attention, derive, loadBillsSnapshot } from './readModel';
import { runUndo } from './undo';
import { devices, financeSnapshot, monthly, ob, settle } from './billsTestkit';
import type { ObligationData } from './model';

/**
 * B4 with the real SyncEngine (two devices that also sync Finance) and a real backup and restore. Lifecycle records are separate, added records, so two devices can never
 * overwrite each other's evidence; anything that disagrees is shown and nothing is silently resolved. Invented data only.
 */
const TODAY = '2026-11-20';
const money = (c: number) => `$${(c / 100).toFixed(2)}`;
const mk = (over: Partial<ObligationData> = {}): ObligationData => ob({ title: 'Streamly Premium', providerNameSnapshot: 'Streamly', type: 'subscription', need: 'flexible', amountKind: 'fixed', prices: [{ from: '2026-01-01', cents: 1499, label: '' }], schedule: monthly(12, '2026-01'), trackingSince: '2026-01-01', payment: { how: 'auto', fundingAccountId: null }, ...over }, TODAY);
const go = async (d: FinanceDB, id: number, a: LcAction) => { const p = await previewLifecycle(id, a, TODAY, money, d); if (p.problem) throw new Error(p.problem); return applyLifecycle(id, a, p.token, TODAY, d); };
const request = (over: Partial<Extract<LcAction, { type: 'cancel-request' }>> = {}): LcAction => ({ type: 'cancel-request', requestedOn: '2026-11-18', requestedEffectiveOn: null, method: 'website', ref: '', awaiting: true, note: '', followUpOn: null, ...over });
const confirm = (over: Partial<Extract<LcAction, { type: 'cancel-confirm' }>> = {}): LcAction => ({ type: 'cancel-confirm', confirmedOn: '2026-11-19', effectiveOn: '2026-12-31', providerRef: '', finalCharge: 'unknown', finalChargeCents: null, refundCents: null, accessUntil: null, note: '', ...over });
const price = (from: string, cents: number): LcAction => ({ type: 'price', from, until: null, cents, status: 'fixed', label: '', source: 'provider-notice', note: '' });
const lcRows = async (d: FinanceDB) => (await d.moduleRecords.where('[module+kind]').equals(['bills', LC_KIND]).toArray()).filter((r) => r.deletedAt == null);
const view = async (d: FinanceDB, id: number) => (await getObligation(id, d))!.data.lc!;

async function seeded(over: Partial<ObligationData> = {}) {
  const { A, B } = devices();
  const acct = (await A.d.accounts.add({ name: 'Test checking', kind: 'checking', openingBalanceCents: 0, openingDate: '2026-01-01' } as never)) as number;
  const bill = await createObligation({ data: mk(over), provider: { name: 'Streamly' }, today: TODAY }, A.d);
  await A.engine.initialUpload();
  await B.engine.replaceFromRemote();
  return { A, B, acct, id: bill.id };
}

describe('B4 two devices: trials', () => {
  it('a trial extension on A and a "converted" outcome on B are both kept on both devices; nothing is lost or invented', async () => {
    const { A, B, id } = await seeded();
    await go(A.d, id, { type: 'trial', startsOn: '2026-11-10', endsOn: '2026-11-24', paymentOnFile: 'yes', conversion: 'auto', convertsToCents: 1499, cadence: 'monthly', mustCancel: false, noticeBy: null, note: '', makePrices: false });
    await settle(A, B);
    await go(A.d, id, { type: 'trial-extend', endsOn: '2026-12-08', note: '' });
    await go(B.d, id, { type: 'trial-outcome', outcome: 'converted', on: '2026-11-25', note: '' });
    await settle(A, B);
    for (const d of [A.d, B.d]) {
      const v = await view(d, id);
      expect(v.records.map((r) => r.body?.fact).sort()).toEqual(['trial', 'trial-extend', 'trial-outcome']);
      expect(v.trial.endsOn).toBe('2026-12-08');
      expect(v.trial.outcome?.body.outcome).toBe('converted');
      expect(v.conflicts).toEqual([]);
    }
    expect(await d2(A.d, id)).toBe(await d2(B.d, id));
  });
});
const d2 = async (d: FinanceDB, id: number) => JSON.stringify((await view(d, id)).records.map((r) => [r.id, r.body?.fact]).sort());

describe('B4 two devices: price steps', () => {
  it('different prices for the SAME start day on each device: both survive, the day reads unknown, a review item appears on both, and "use this one" settles both', async () => {
    const { A, B, id } = await seeded();
    await go(A.d, id, price('2027-01-01', 1799));
    await go(B.d, id, price('2027-01-01', 1899));
    await settle(A, B);
    for (const d of [A.d, B.d]) {
      const v = await view(d, id);
      expect(v.conflicts.map((c) => c.kind)).toEqual(['price-same-date']);
      expect(v.priceRows.filter((r) => r.recordId !== null)).toHaveLength(2);
      expect((await getObligation(id, d))!.data.lc!.prices.find((p) => p.from === '2027-01-01')?.cents).toBeNull();
      expect(attention(derive(await loadBillsSnapshot(d), TODAY)).lifecycleConflict).toBe(1);
    }
    const v = await view(A.d, id);
    await go(A.d, id, { type: 'resolve', conflictKey: v.conflicts[0].key, chooseId: v.conflicts[0].ids[0] });
    await settle(A, B);
    for (const d of [A.d, B.d]) {
      const w = await view(d, id);
      expect(w.conflicts).toEqual([]);
      expect(w.priceRows.filter((r) => r.recordId !== null)).toHaveLength(1); // one price is in force now
      expect(w.records.filter((r) => r.body?.fact === 'price-step')).toHaveLength(3); // and both earlier records are kept as history
    }
  });

  it('different future steps on the two devices are both applied in date order (no conflict)', async () => {
    const { A, B, id } = await seeded();
    await go(A.d, id, price('2027-01-01', 1799));
    await go(B.d, id, price('2027-07-01', 1999));
    await settle(A, B);
    for (const d of [A.d, B.d]) expect((await view(d, id)).prices.map((p) => p.cents)).toEqual([1499, 1799, 1999]);
  });
});

describe('B4 two devices: cancellation evidence is never overwritten', () => {
  it('two confirmations with different effective dates: both kept on both devices, neither used, expected bills keep running, a review item on both', async () => {
    const { A, B, id } = await seeded();
    await go(A.d, id, confirm({ effectiveOn: '2026-12-31' }));
    await go(B.d, id, confirm({ effectiveOn: '2027-01-31' }));
    await settle(A, B);
    for (const d of [A.d, B.d]) {
      const v = await view(d, id);
      expect(v.conflicts.map((c) => c.kind)).toEqual(['confirm-dates']);
      expect(v.cutoffOn).toBeNull();
      expect(v.records).toHaveLength(2);
      const snap = await loadBillsSnapshot(d);
      expect(periodsOf((await getObligation(id, d))!, snap.cycles, TODAY, { from: '2027-02-01', to: '2027-04-30' }).filter((p) => p.expected)).toHaveLength(3);
      expect(attention(derive(snap, TODAY)).lifecycleConflict).toBe(1);
    }
  });

  it('two confirmations with the SAME effective date agree: one cancellation, no conflict', async () => {
    const { A, B, id } = await seeded();
    await go(A.d, id, confirm());
    await go(B.d, id, confirm({ confirmedOn: '2026-11-20' }));
    await settle(A, B);
    for (const d of [A.d, B.d]) { const v = await view(d, id); expect(v.conflicts).toEqual([]); expect(v.cutoffOn).toBe('2026-12-31'); }
  });

  it('a withdrawal made on B (after seeing the request) and a confirmation made on A (without seeing it) disagree: neither wins silently', async () => {
    const { A, B, id } = await seeded();
    await go(A.d, id, request());
    await settle(A, B);
    await go(B.d, id, { type: 'cancel-withdraw', on: '2026-11-19', kind: 'owner-retracted', note: '', reopen: false });
    await go(A.d, id, confirm());
    await settle(A, B);
    for (const d of [A.d, B.d]) {
      const v = await view(d, id);
      expect(v.conflicts.map((c) => c.kind)).toEqual(['withdraw-vs-evidence']);
      expect(v.cutoffOn).toBeNull();
      expect(v.records).toHaveLength(3);
    }
  });

  it('a cancellation on A and a request-then-withdraw sequence on B that DID see everything are plain history, not a conflict', async () => {
    const { A, B, id } = await seeded();
    await go(A.d, id, request());
    await settle(A, B);
    await go(B.d, id, { type: 'cancel-withdraw', on: '2026-11-19', kind: 'owner-retracted', note: '', reopen: false });
    await settle(A, B);
    for (const d of [A.d, B.d]) { const v = await view(d, id); expect(v.conflicts).toEqual([]); expect(v.cancel.request).toBeNull(); }
  });

  it('a cancellation on A and a new invoice on B: both survive, and the period holding the invoice still shows although it is after the effective date', async () => {
    const { A, B, id } = await seeded();
    await go(A.d, id, confirm({ effectiveOn: '2026-12-31' }));
    await recordFact({ obligationId: id, slot: 'm2027-01', body: { fact: 'invoice', invoicedCents: 750, invoiceDate: '2027-01-03', dueDate: '2027-01-20', invoiceNumber: '', nominal: null }, op: newOp(), today: TODAY }, B.d);
    await settle(A, B);
    for (const d of [A.d, B.d]) {
      const o = (await getObligation(id, d))!;
      const snap = await loadBillsSnapshot(d);
      const ps = periodsOf(o, snap.cycles, TODAY, { from: '2026-11-01', to: '2027-03-31' }, { allRecorded: true });
      expect(o.data.lc!.cutoffOn).toBe('2026-12-31');
      expect(ps.find((p) => p.slot === 'm2027-01')?.amounts.owed).toBe(750); // the final bill stays recordable and visible
      expect(ps.filter((p) => p.expected).map((p) => p.slot)).toEqual(['m2026-11', 'm2026-12']);
    }
  });

  it('a cancellation on A and a payment link on B: the link survives and still counts; the cancellation is not reopened', async () => {
    const { A, B, id, acct } = await seeded();
    const t: Txn = { accountId: acct, date: '2026-11-12', amountCents: -1499, payee: 'Streamly Premium', memo: '', status: 'cleared', categoryId: 5 };
    const tid = (await A.d.txns.add(t)) as number;
    await A.engine.sync(); await B.engine.sync();
    await go(A.d, id, confirm());
    await recordFact({ obligationId: id, slot: 'm2026-11', body: { fact: 'payment-link', ref: makeTxnRef({ ...t, id: tid }) }, op: newOp(), today: TODAY }, B.d);
    await settle(A, B);
    for (const d of [A.d, B.d]) {
      const snap = await loadBillsSnapshot(d);
      const p = periodsOf((await getObligation(id, d))!, snap.cycles, TODAY, { from: '2026-11-01', to: '2026-11-30' }, { allRecorded: true, lookup: (await import('../../lib/txnLookup')).lookupOfMap(snap.financeTxns) }).find((x) => x.slot === 'm2026-11')!;
      expect(p.amounts.paid).toBe(1499);
      expect((await view(d, id)).cutoffOn).toBe('2026-12-31');
    }
  });

  it('a bill whose cancellation took effect while a Finance Scheduled payment is still live: B sees the review item, and Finance is untouched on both', async () => {
    const { A, B, acct, id } = await seeded();
    const ruleId = (await A.d.recurring.add({ accountId: acct, payee: 'Streamly Premium', amountCents: -1499, categoryId: 5, memo: '', frequency: 'monthly', startDate: '2026-01-12', active: true } as RecurringRule)) as number;
    const cur = (await getObligation(id, A.d))!;
    await A.d.moduleRecords.put({ ...(await A.d.moduleRecords.get(id))!, updatedAt: cur.updatedAt + 1, data: { ...(await A.d.moduleRecords.get(id))!.data as object, scheduledRuleIds: [ruleId] } as never });
    await A.engine.sync(); await B.engine.sync();
    await go(A.d, id, confirm({ confirmedOn: '2026-06-10', effectiveOn: '2026-06-30' }));
    const fin = await financeSnapshot(A.d, false);
    await settle(A, B);
    expect(await financeSnapshot(B.d, false)).toBe(fin);
    for (const d of [A.d, B.d]) expect(attention(derive(await loadBillsSnapshot(d), TODAY)).scheduledAfterEnd).toBe(1);
  });
});

describe('B4 two devices: the Household Services link', () => {
  const arrangement = async (d: FinanceDB) => (await d.moduleRecords.add({ id: 880001, module: 'services', kind: 'arrangement', data: { title: 'House cleaners', status: 'active', providerNameSnapshot: 'Cleaning Co' }, createdAt: 1, updatedAt: 1, deletedAt: null } as ModuleRecord)) as number;
  const link = async (d: FinanceDB, id: number, arr: number, action: 'linked' | 'unlinked') => { const p = await previewServiceLink(id, arr, action, d); if (p.problem) throw new Error(p.problem); return applyServiceLink(id, arr, action, p.token, TODAY, d); };

  it('link on A reaches B; unlink on B reaches A; each writes an audit record; neither Services nor Finance changes', async () => {
    const { A, B, id } = await seeded();
    const arr = await arrangement(A.d);
    await A.engine.sync(); await B.engine.sync();
    const servicesBefore = JSON.stringify(await A.d.moduleRecords.get(arr));
    const fin = await financeSnapshot(A.d, false);
    await link(A.d, id, arr, 'linked');
    await settle(A, B);
    for (const d of [A.d, B.d]) { expect((await billLinks(id, d)).map((l) => l.arrangementId)).toEqual([arr]); expect((await serviceLinksFor([id], d)).get(id)).toEqual([arr]); }
    await link(B.d, id, arr, 'unlinked');
    await settle(A, B);
    for (const d of [A.d, B.d]) { expect(await billLinks(id, d)).toEqual([]); expect((await view(d, id)).records.map((r) => r.body?.fact)).toEqual(['service-link', 'service-link']); }
    expect(JSON.stringify(await A.d.moduleRecords.get(arr))).toBe(servicesBefore);
    expect(await financeSnapshot(A.d, false)).toBe(fin);
  });

  it('both devices link the same arrangement while offline: no duplicate shows, and one unlink clears both rows', async () => {
    const { A, B, id } = await seeded();
    const arr = await arrangement(A.d);
    await A.engine.sync(); await B.engine.sync();
    await link(A.d, id, arr, 'linked');
    await link(B.d, id, arr, 'linked');
    await settle(A, B);
    for (const d of [A.d, B.d]) expect((await serviceLinksFor([id], d)).get(id)).toEqual([arr]); // one arrangement, however many rows
    await link(A.d, id, arr, 'unlinked');
    await settle(A, B);
    for (const d of [A.d, B.d]) expect(await billLinks(id, d)).toEqual([]);
  });

  it('linking twice on one device is refused; two different bills linked to one arrangement raise one review item (both links kept)', async () => {
    const { A, B, id } = await seeded();
    const second = await createObligation({ data: mk({ title: 'Cleaning payment' }), today: TODAY }, A.d);
    const arr = await arrangement(A.d);
    await link(A.d, id, arr, 'linked');
    expect((await previewServiceLink(id, arr, 'linked', A.d)).problem).toMatch(/already linked/);
    await link(A.d, second.id, arr, 'linked');
    await A.engine.sync(); await B.engine.sync();
    for (const d of [A.d, B.d]) expect(attention(derive(await loadBillsSnapshot(d), TODAY)).lifecycleConflict).toBe(1);
  });

  it('a link to an arrangement that has not reached this device is refused with a plain message and writes nothing', async () => {
    const { A, id } = await seeded();
    const p = await previewServiceLink(id, 123456, 'linked', A.d);
    expect(p.problem).toMatch(/not here/);
    expect(await billLinks(id, A.d)).toEqual([]);
  });

  it('Undo of a link refuses (writing nothing) once the link was changed elsewhere', async () => {
    const { A, B, id } = await seeded();
    const arr = await arrangement(A.d);
    await A.engine.sync(); await B.engine.sync();
    await link(A.d, id, arr, 'linked');
    await settle(A, B);
    const u = await link(A.d, id, arr, 'unlinked');
    await settle(A, B);
    await link(B.d, id, arr, 'linked'); // someone linked it again after the unlink
    await settle(A, B);
    const before = JSON.stringify(await A.d.links.toArray());
    expect(await runUndo(u.undo, () => undefined, A.d)).toBe(false);
    expect(JSON.stringify(await A.d.links.toArray())).toBe(before);
  });
});

describe('B4 guarded Undo after a remote change', () => {
  it('A applies, B edits the same record, A syncs: Undo refuses and writes nothing', async () => {
    const { A, B, id } = await seeded();
    const r = await go(A.d, id, confirm());
    await settle(A, B);
    const row = (await B.d.moduleRecords.get(r.ids[0]))!;
    await B.d.moduleRecords.put({ ...row, updatedAt: row.updatedAt + 10, data: { ...(row.data as object), note: 'edited on B' } as never });
    await settle(A, B);
    const before = JSON.stringify(await lcRows(A.d));
    expect(await runUndo(r.undo, () => undefined, A.d)).toBe(false);
    expect(JSON.stringify(await lcRows(A.d))).toBe(before);
  });
});

describe('B4 backup and restore', () => {
  const store = () => { const mem = new Map<string, string>(); return { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); }, removeItem: (k: string) => { mem.delete(k); } } as never; };

  it('lifecycle records, links and a bill restore exactly; the derived state and conflicts are the same after; the summary counts them without naming anything', async () => {
    const { A, id } = await seeded();
    await go(A.d, id, request());
    await go(A.d, id, confirm());
    await go(A.d, id, price('2027-01-01', 1799));
    await A.d.moduleRecords.add({ id: 880001, module: 'services', kind: 'arrangement', data: { title: 'House cleaners', status: 'active' }, createdAt: 1, updatedAt: 1, deletedAt: null } as ModuleRecord);
    const p = await previewServiceLink(id, 880001, 'linked', A.d);
    await applyServiceLink(id, 880001, 'linked', p.token, TODAY, A.d);
    const text = JSON.stringify(await buildBackup(A.d));
    const summary = JSON.stringify(summarizeBackup(JSON.parse(text)));
    expect(summary).toMatch(/Subscription lifecycle records/);
    expect(summary).not.toMatch(/Streamly|House cleaners/);
    const { B } = devices();
    await restoreChecked(B.d, checkBackupText(text).file, store());
    const rows = async (d: FinanceDB) => JSON.stringify((await lcRows(d)).map((r) => [r.id, r.data]).sort());
    expect(await rows(B.d)).toBe(await rows(A.d));
    const va = await view(A.d, id), vb = await view(B.d, id);
    expect(vb.cutoffOn).toBe(va.cutoffOn);
    expect(vb.conflicts).toEqual(va.conflicts);
    expect((await billLinks(id, B.d)).map((l) => l.arrangementId)).toEqual([880001]);
  });

  it('unknown fields on a lifecycle record and an unknown record type survive a backup and restore exactly', async () => {
    const { A, id } = await seeded();
    await A.d.moduleRecords.add({ id: 930001, module: 'bills', kind: LC_KIND, data: { obligationId: id, fact: 'cancel-request', requestedOn: '2026-11-18', future: { keep: [1, 2] } }, createdAt: 1, updatedAt: 1, deletedAt: null } as never);
    await A.d.moduleRecords.add({ id: 930002, module: 'bills', kind: LC_KIND, data: { obligationId: id, fact: 'chargeback-filed', on: '2026-11-18', future: 'yes' }, createdAt: 2, updatedAt: 2, deletedAt: null } as never);
    const text = JSON.stringify(await buildBackup(A.d));
    const { B } = devices();
    await restoreChecked(B.d, checkBackupText(text).file, store());
    expect((await B.d.moduleRecords.get(930001))!.data).toMatchObject({ fact: 'cancel-request', future: { keep: [1, 2] } });
    expect((await B.d.moduleRecords.get(930002))!.data).toMatchObject({ fact: 'chargeback-filed', future: 'yes' });
    const v = await view(B.d, id);
    expect(v.unreadable.map((r) => r.id)).toEqual([930002]); // listed for review, never counted
  });
});

describe('B4 an older (B3.1) build', () => {
  /** What a B3.1 build reads: obligations, cycle facts and discovery choices, each by its own kind. It has no reader at all for kind `lifecycle`. */
  const olderReads = async (d: FinanceDB) => ({
    obligations: (await d.moduleRecords.where('[module+kind]').equals(['bills', 'obligation']).toArray()).filter((r) => r.deletedAt == null),
    cycles: (await d.moduleRecords.where('[module+kind]').equals(['bills', 'cycle']).toArray()).filter((r) => r.deletedAt == null),
  });

  it('never reads or converts lifecycle records into another kind; they ride through sync untouched, and an unrelated edit of the bill leaves them as they were', async () => {
    const { A, B, id } = await seeded();
    await go(A.d, id, confirm());
    await go(A.d, id, price('2027-01-01', 1799));
    await settle(A, B);
    const older = await olderReads(B.d);
    expect(older.cycles).toEqual([]); // nothing was turned into a billing-period fact
    expect(older.obligations).toHaveLength(1);
    expect(JSON.stringify(older.obligations[0].data)).not.toContain('"lc"'); // no derived value was written into the bill
    // an older build edits the bill (here: a plain whole-record edit of the title, as it would) and syncs
    const row = (await B.d.moduleRecords.get(id))!;
    await B.d.moduleRecords.put({ ...row, updatedAt: row.updatedAt + 10, data: { ...(row.data as object), title: 'Renamed by an older build' } as never });
    const before = JSON.stringify(await lcRows(B.d));
    await settle(A, B);
    expect(JSON.stringify(await lcRows(B.d))).toBe(before);
    expect((await lcRows(A.d)).length).toBe(2);
    expect((await view(A.d, id)).cutoffOn).toBe('2026-12-31'); // the newer build still reads its own evidence
  });

  it('LIMITATION: an older build does not know the cancellation date, so it keeps showing expected bills after it. Nothing is lost, and updating fixes it.', async () => {
    const { A, B, id } = await seeded();
    await go(A.d, id, confirm());
    await settle(A, B);
    // the older reader's expected dates come from the bill record alone (no lifecycle view): it still produces periods after the effective date
    const rowOnly = (await olderReads(B.d)).obligations[0];
    expect((rowOnly.data as { status: string }).status).toBe('active');
  });
});
