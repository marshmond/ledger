import { describe, expect, it, vi } from 'vitest';
import { buildBackup, checkBackupText, restoreChecked } from '../../lib/backupFile';
import { makeTxnRef } from '../../lib/txnRef';
import { blankService } from '../assets/service';
import { insertService } from '../assets/serviceData';
import { newOp, recordFact } from '../bills/cycleData';
import { applyServiceLink, previewServiceLink } from '../bills/crossLinks';
import { devices, monthly, settle } from '../bills/billsTestkit';
import { runUndo } from '../bills/undo';
import { applyLifecycle, previewLifecycle } from '../bills/lifecycleData';
import { toStored, blankObligation } from '../bills/model';
import { createArrangement } from '../services/data';
import { blankArrangement } from '../services/model';
import { loadHouseholdOverview, todayCounts } from './overview';
import { loadRelatedBills } from './relatedBill';
import { TODAY, digest, seed } from './householdSeed';
import { providerNamed } from '../../core/contactTestkit';

/**
 * B5 on REAL databases (fake IndexedDB): the loader, the read-only promise, bulk reads, scale, damaged data, fault injection, the Related bill reader, and the real
 * SyncEngine with two devices and a real backup and restore. Everything is invented. Amounts in comments are worked out by hand from the seed.
 */
const money = (c: number) => `$${(c / 100).toFixed(2)}`;

const store = () => { const mem = new Map<string, string>(); return { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); }, removeItem: (k: string) => { mem.delete(k); } } as never; };

describe('B5 loader on a real database', () => {
  it('the household total is the hand-worked $647.98, the $150.00 payment is ONE piece reached from three modules, and nothing is double-counted', async () => {
    const { A } = devices();
    await seed(A.d);
    const o = await loadHouseholdOverview('all', TODAY, A.d);
    expect(o.spending.totalCents).toBe(64798);
    expect([o.spending.financeCents, o.spending.typedCents, o.spending.moneyBackCents]).toEqual([55298, 9500, 3000]);
    expect(o.spending.byAttribution).toEqual({ bills: 9298, services: 0, home: 40500, shared: 15000 }); // 15.49+15.49+62.00 | none | 340.00-30.00+95.00 | the shared $150.00
    const shared = o.spending.pieces.filter((p) => p.sharedAcrossModules);
    expect(shared).toHaveLength(1);
    expect(shared[0].modules).toEqual(['bills', 'services', 'home']);
    expect(o.spending.reconciled).toBe(true);
  });

  it('the Bills bill linked to the cleaning arrangement is folded for 30 and 90 days (equal totals) and its yearly totals disagree, which is shown rather than hidden', async () => {
    const { A } = devices();
    await seed(A.d);
    const o = await loadHouseholdOverview('all', TODAY, A.d);
    const w30 = o.commitments.windows.find((w) => w.days === 30)!, w90 = o.commitments.windows.find((w) => w.days === 90)!;
    expect(w30.consolidations.map((c) => c.status)).toEqual(['folded']); // 1 bill of $150.00 on 15 Nov = 2 visits of $75.00 on 20 Nov and 4 Dec
    expect(w90.consolidations.map((c) => c.status)).toEqual(['folded']); // 3 x $150.00 = 6 x $75.00
    expect(o.commitments.twelve.consolidations.map((c) => c.status)).toEqual(['uncertain']); // 12 x $150.00 = $1,800.00 against 26 x $75.00 = $1,950.00
    expect(o.review.some((r) => r.class === 'contractual-overlap')).toBe(true);
  });

  it('loading (twice) writes NOTHING: every table of the database is identical afterwards, and no Task, record, link or Finance row appears', async () => {
    const { A } = devices();
    await seed(A.d);
    const before = await digest(A.d);
    await loadHouseholdOverview('last12', TODAY, A.d);
    await loadHouseholdOverview('all', TODAY, A.d);
    expect(await digest(A.d)).toBe(before);
  });

  it('Finance is read in BULK: no per-transaction read and no full transaction-table read, however many payments are linked', async () => {
    const { A } = devices();
    await seed(A.d);
    const get = vi.spyOn(A.d.txns, 'get'), all = vi.spyOn(A.d.txns, 'toArray'), bulk = vi.spyOn(A.d.txns, 'bulkGet');
    await loadHouseholdOverview('all', TODAY, A.d);
    expect(get).not.toHaveBeenCalled();
    expect(all).not.toHaveBeenCalled();
    expect(bulk.mock.calls.length).toBeLessThanOrEqual(2); // Bills' own bulk read of its linked payments + one for the transactions only Services or Home & Assets reference
  });

  it('an empty database loads to an empty overview with zero totals', async () => {
    const { A } = devices();
    const o = await loadHouseholdOverview('all', TODAY, A.d);
    expect([o.empty, o.spending.totalCents, o.review.length, o.actions.length]).toEqual([true, 0, 0, 0]);
  });

  it('a failed Finance read rejects the whole load: no partial total, nothing written', async () => {
    const { A } = devices();
    await seed(A.d);
    const before = await digest(A.d);
    const bulk = vi.spyOn(A.d.txns, 'bulkGet').mockRejectedValue(new Error('the Finance read failed'));
    await expect(loadHouseholdOverview('all', TODAY, A.d)).rejects.toThrow(/Finance read failed/);
    bulk.mockRestore();
    expect(await digest(A.d)).toBe(before);
    expect((await loadHouseholdOverview('all', TODAY, A.d)).spending.totalCents).toBe(64798); // and a retry works
  });

  it('a failure in the SECOND Finance read (the transactions only Services and Home & Assets reference) also rejects the load: it is never replaced by an empty result', async () => {
    const { A } = devices();
    await seed(A.d);
    const real = A.d.txns.bulkGet.bind(A.d.txns);
    let calls = 0;
    const spy = vi.spyOn(A.d.txns, 'bulkGet').mockImplementation(((...a: Parameters<typeof real>) => (++calls === 2 ? Promise.reject(new Error('second read failed')) : real(...a))) as never);
    await expect(loadHouseholdOverview('all', TODAY, A.d)).rejects.toThrow(/second read failed/);
    expect(calls).toBe(2); // Bills' own read passed; the household's own read is the one that failed
    spy.mockRestore();
  });

  it('damaged and unknown records never break the load and never become money: an unknown billing fact, a payment link to a deleted transaction, a malformed arrangement', async () => {
    const { A } = devices();
    const s = await seed(A.d);
    const raw = (module: string, kind: string, data: Record<string, unknown>) => A.d.moduleRecords.add({ module, kind, data, createdAt: Date.now(), updatedAt: Date.now(), deletedAt: null } as never);
    await raw('bills', 'cycle', { obligationId: s.bill.streamly, slot: 'm2026-11', fact: 'martian', payload: { x: 1 } });
    await raw('bills', 'cycle', { obligationId: s.bill.power, slot: 'm2026-09', fact: 'payment-link', ref: { txnId: 99999, snapshot: { date: '2026-09-20', payee: 'Gone', amountCents: -5000 } } });
    await raw('services', 'arrangement', { title: 'Odd', status: 'martian-status', cadence: { mode: 'sideways' } });
    const o = await loadHouseholdOverview('all', TODAY, A.d);
    expect(o.spending.totalCents).toBe(64798); // unchanged: damaged or missing evidence counts nothing
    expect(o.review.some((r) => r.id.includes('stale'))).toBe(true);
    expect(o.spending.reconciled).toBe(false);
  });

  it('Today shows counts only, and only cross-module concerns: no name, no amount', async () => {
    const { A } = devices();
    await seed(A.d);
    const c = todayCounts(await loadHouseholdOverview('all', TODAY, A.d));
    expect(c).toEqual({ possibleDuplicates: 0, overlaps: 1, unknownSoon: 0, total: 1 });
    expect(JSON.stringify(c)).not.toMatch(/Sparkle|Streamly|\$/);
  });
});

describe('B5 at scale: hundreds of bills, many arrangements, thousands of transactions, many shared references', () => {
  it('loads with bulk reads only and counts every piece once, however widely it is shared', async () => {
    const { A } = devices();
    const acct = (await A.d.accounts.add({ name: 'Test checking', kind: 'checking', openingBalanceCents: 0, openingDate: '2026-01-01' } as never)) as number;
    const N_TXN = 3000;
    await A.d.txns.bulkAdd(Array.from({ length: N_TXN }, (_, i) => ({ accountId: acct, date: `2026-${String(1 + (i % 9)).padStart(2, '0')}-${String(1 + (i % 27)).padStart(2, '0')}`, amountCents: -(1000 + (i % 50) * 100), payee: `Payee ${i}`, memo: '', status: 'cleared' as const, categoryId: null })));
    const txns = await A.d.txns.toArray();
    const now = Date.now();
    const obs = Array.from({ length: 300 }, (_, i) => ({ module: 'bills', kind: 'obligation', data: toStored(blankObligation({ title: `Bill ${i}`, type: 'utility', need: 'essential', amountKind: 'fixed', prices: [{ from: '2026-01-01', cents: 5000, label: '' }], schedule: monthly(1 + (i % 28), '2026-01'), trackingSince: '2026-01-01', payment: { how: 'manual', fundingAccountId: null } }, TODAY)), createdAt: now + i, updatedAt: now + i, deletedAt: null }));
    const ids = (await A.d.moduleRecords.bulkAdd(obs as never, { allKeys: true })) as number[];
    // 1,500 payment links; every transaction is linked from FIVE different periods, so most pieces are shared
    const links = Array.from({ length: 1500 }, (_, i) => ({ module: 'bills', kind: 'cycle', data: { obligationId: ids[i % 300], slot: `m2026-${String(1 + (Math.floor(i / 300) % 9)).padStart(2, '0')}`, fact: 'payment-link', ref: { txnId: txns[i % 300].id, snapshot: { date: txns[i % 300].date, payee: txns[i % 300].payee, amountCents: txns[i % 300].amountCents } } }, createdAt: now + i, updatedAt: now + i, deletedAt: null }));
    await A.d.moduleRecords.bulkAdd(links as never);
    const arrs = Array.from({ length: 60 }, (_, i) => ({ module: 'services', kind: 'arrangement', data: blankArrangement({ title: `Service ${i}`, status: 'active', txnRefs: [makeTxnRef(txns[i])] }), createdAt: now + i, updatedAt: now + i, deletedAt: null }));
    await A.d.moduleRecords.bulkAdd(arrs.map((a) => ({ ...a, data: { ...a.data } })) as never);
    const get = vi.spyOn(A.d.txns, 'get'), all = vi.spyOn(A.d.txns, 'toArray'), bulk = vi.spyOn(A.d.txns, 'bulkGet');
    const o = await loadHouseholdOverview('all', TODAY, A.d);
    expect(get).not.toHaveBeenCalled();
    expect(all).not.toHaveBeenCalled();
    expect(bulk.mock.calls.length).toBeLessThanOrEqual(2);
    // 300 distinct transactions are linked (5 times each from Bills; the first 60 also from Services), so exactly 300 pieces: each once
    expect(o.spending.pieces).toHaveLength(300);
    const hand = txns.slice(0, 300).reduce((n, t) => n - t.amountCents, 0);
    expect(o.spending.financeCents).toBe(hand);
    expect(o.spending.pieces.filter((p) => p.sharedAcrossModules)).toHaveLength(60);
    expect(o.spending.proof.reconciles).toBe(true);
  });
});

describe('B5 Related bill on a Household Services arrangement (read only)', () => {
  it('shows the linked bill, how it is paid and its status; it reads the existing link and writes nothing', async () => {
    const { A } = devices();
    const s = await seed(A.d);
    const before = await digest(A.d);
    const rows = await loadRelatedBills(s.clean, A.d, TODAY);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ billId: s.bill.sparkle, state: 'active', title: 'Sparkle Cleaning', amountCents: 15000, amountKind: 'fixed', href: `#/bills/o/${s.bill.sparkle}` });
    expect(rows[0].arrangementText).toMatch(/Monthly.*15th.*by hand/);
    expect(await digest(A.d)).toBe(before);
  });

  it('a link is never made from a similar name: an arrangement and a bill with the same provider and title but no link show nothing', async () => {
    const { A } = devices();
    const s = await seed(A.d);
    const other = (await createArrangement({ data: blankArrangement({ title: 'Sparkle Cleaning' }), provider: await providerNamed(A.d, 'Sparkle Cleaning Co'), today: TODAY }, A.d)).id;
    expect(await loadRelatedBills(other, A.d, TODAY)).toEqual([]);
    expect(s.bill.sparkle).toBeGreaterThan(0);
  });

  it('a bill that is missing is explained, not silently dropped: the link is kept and says so', async () => {
    const { A } = devices();
    const s = await seed(A.d);
    await A.d.moduleRecords.delete(s.bill.sparkle);
    const rows = await loadRelatedBills(s.clean, A.d, TODAY);
    expect(rows).toHaveLength(1);
    expect(rows[0].state).toBe('missing');
    expect(rows[0].statusText).toMatch(/link is kept/);
    expect(await A.d.links.filter((l) => l.type === 'bills-for').count()).toBe(1); // the relationship itself is untouched (the arrangement's own Task link is a separate row)
  });

  it('an ended bill is shown as ended, with its history kept in Bills; and unlinking removes the card\'s row without touching either record', async () => {
    const { A } = devices();
    const s = await seed(A.d);
    const act = { type: 'end', on: '2026-11-01', reason: 'cancelled', note: '' } as never;
    const p = await previewLifecycle(s.bill.sparkle, act, TODAY, money, A.d);
    if (!p.problem) await applyLifecycle(s.bill.sparkle, act, p.token, TODAY, A.d);
    const rows = await loadRelatedBills(s.clean, A.d, TODAY);
    expect(rows.length).toBe(1);
    // the Services records (arrangement, visits) and every Task, as text
    const mine = async () => JSON.stringify([...(await A.d.moduleRecords.where('module').equals('services').toArray()), ...(await A.d.moduleRecords.where('module').equals('tasks').toArray())]);
    const before = await mine();
    const un = await previewServiceLink(s.bill.sparkle, s.clean, 'unlinked', A.d);
    await applyServiceLink(s.bill.sparkle, s.clean, 'unlinked', un.token, TODAY, A.d);
    expect(await loadRelatedBills(s.clean, A.d, TODAY)).toEqual([]);
    expect(await mine()).toBe(before); // the arrangement and its single visit Task are unchanged by unlinking
  });
});

describe('B5 with the real SyncEngine: two devices', () => {
  async function pair() {
    const { A, B } = devices();
    const s = await seed(A.d);
    await A.engine.initialUpload();
    await B.engine.replaceFromRemote();
    return { A, B, s };
  }
  const pieces = (o: Awaited<ReturnType<typeof loadHouseholdOverview>>) => JSON.stringify(o.spending.pieces.map((p) => [p.key, p.cents, p.associations.map((a) => a.recordId)]));

  it('both devices compute the same household figure and the same cross-module links after a sync', async () => {
    const { A, B, s } = await pair();
    const a = await loadHouseholdOverview('all', TODAY, A.d), b = await loadHouseholdOverview('all', TODAY, B.d);
    expect([a.spending.totalCents, b.spending.totalCents]).toEqual([64798, 64798]);
    expect(pieces(a)).toBe(pieces(b));
    expect((await loadRelatedBills(s.clean, B.d, TODAY)).map((r) => r.billId)).toEqual([s.bill.sparkle]); // the "bills for" link crossed the sync
  });

  it('the SAME transaction linked independently on each device (Bills on A; a new Home & Assets record on B) converges: counted once, with every association', async () => {
    const { A, B, s } = await pair();
    const fresh = await A.d.txns.get((await A.d.txns.add({ accountId: s.acct, date: '2026-10-25', amountCents: -4400, payee: 'Gutter Pros', memo: '', status: 'cleared', categoryId: null })) as number);
    await settle(A, B);
    await recordFact({ obligationId: s.bill.power, slot: 'm2026-09', body: { fact: 'payment-link', ref: makeTxnRef(fresh!) }, op: newOp(), today: TODAY }, A.d);
    await insertService(blankService(s.home, { title: 'Gutter repair', date: '2026-10-25', kind: 'repair', txnRefs: [makeTxnRef(fresh!)] }), B.d, TODAY);
    await settle(A, B);
    const a = await loadHouseholdOverview('all', TODAY, A.d), b = await loadHouseholdOverview('all', TODAY, B.d);
    expect(a.spending.totalCents).toBe(64798 + 4400); // one new payment, counted once
    expect(a.spending.totalCents).toBe(b.spending.totalCents);
    const piece = a.spending.pieces.find((p) => p.txnId === fresh!.id)!;
    expect(piece.modules).toEqual(['bills', 'home']);
    expect(pieces(a)).toBe(pieces(b));
  });

  it('a payment deleted in Finance after linking is flagged on BOTH devices and counts nothing on both', async () => {
    const { A, B, s } = await pair();
    await A.d.txns.delete(s.T4.id!);
    await settle(A, B);
    for (const d of [A.d, B.d]) {
      const o = await loadHouseholdOverview('all', TODAY, d);
      expect(o.spending.totalCents).toBe(64798 - 6200);
      expect(o.review.some((r) => r.id.startsWith('u:stale:'))).toBe(true);
      expect(o.spending.reconciled).toBe(false);
    }
  });

  it('independent records added on each device are all kept: a typed Bills payment on A and a typed Home & Assets cost on B both count on both', async () => {
    const { A, B, s } = await pair();
    await recordFact({ obligationId: s.bill.power, slot: 'm2026-08', body: { fact: 'paid-outside', paidOn: '2026-08-20', cents: 7100 }, op: newOp(), today: TODAY }, A.d);
    await insertService(blankService(s.home, { title: 'Chimney sweep', date: '2026-10-30', kind: 'maintenance', costCents: 12500 }), B.d, TODAY);
    await settle(A, B);
    for (const d of [A.d, B.d]) expect((await loadHouseholdOverview('all', TODAY, d)).spending.totalCents).toBe(64798 + 7100 + 12500);
  });

  it('an unrelated edit on another device (a Task title) does not change what the household figure means', async () => {
    const { A, B } = await pair();
    const before = (await loadHouseholdOverview('all', TODAY, A.d)).spending.totalCents;
    const t = (await B.d.table('moduleRecords').where('module').equals('tasks').toArray())[0];
    if (t) await B.d.table('moduleRecords').update(t.id, { data: { ...t.data, title: 'Renamed on the other device' }, updatedAt: Date.now() });
    await settle(A, B);
    expect((await loadHouseholdOverview('all', TODAY, A.d)).spending.totalCents).toBe(before);
    expect((await loadHouseholdOverview('all', TODAY, B.d)).spending.totalCents).toBe(before);
  });

  it('an existing guarded Undo still works after the household has been read: the read changed nothing for Undo to refuse', async () => {
    const { A, s } = await pair();
    const r = await recordFact({ obligationId: s.bill.power, slot: 'm2026-08', body: { fact: 'paid-outside', paidOn: '2026-08-20', cents: 7100 }, op: newOp(), today: TODAY }, A.d);
    expect((await loadHouseholdOverview('all', TODAY, A.d)).spending.totalCents).toBe(64798 + 7100);
    expect(await runUndo(r.undo, () => undefined, A.d)).toBe(true);
    expect((await loadHouseholdOverview('all', TODAY, A.d)).spending.totalCents).toBe(64798);
  });
});

describe('B5 backup and restore', () => {
  it('a restored database gives the same household figure, the same pieces and associations, the same Related bill and the same review list', async () => {
    const { A } = devices();
    const s = await seed(A.d);
    const text = JSON.stringify(await buildBackup(A.d));
    const { B } = devices();
    await restoreChecked(B.d, checkBackupText(text).file, store());
    const a = await loadHouseholdOverview('all', TODAY, A.d), b = await loadHouseholdOverview('all', TODAY, B.d);
    expect(b.spending.totalCents).toBe(a.spending.totalCents);
    expect(JSON.stringify(b.spending.pieces)).toBe(JSON.stringify(a.spending.pieces));
    expect(JSON.stringify(b.review)).toBe(JSON.stringify(a.review));
    expect(JSON.stringify(b.commitments.windows)).toBe(JSON.stringify(a.commitments.windows));
    expect((await loadRelatedBills(s.clean, B.d, TODAY)).map((r) => r.billId)).toEqual([s.bill.sparkle]);
  });
});
