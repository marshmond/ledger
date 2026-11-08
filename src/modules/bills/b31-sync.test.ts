import { describe, expect, it } from 'vitest';
import { FinanceDB } from '../../db';
import { buildBackup, checkBackupText, restoreChecked } from '../../lib/backupFile';
import { summarizeBackup } from '../../lib/backupSummary';
import { makeTxnRef } from '../../lib/txnRef';
import type { RecurringRule, Txn } from '../../types';
import { loadCycles, newOp, reconsiderRejection, rejectSuggestion } from './cycleData';
import { createObligation, getObligation, loadObligations } from './data';
import { loadDecisions, recordDecision, removeDecision, loadDiscovery, snapOf } from './discoveryData';
import { periodsOf, type Period } from './periods';
import { loadBillsSnapshot } from './readModel';
import { lookupOfMap } from '../../lib/txnLookup';
import { ruleLinkConflicts } from './scheduledLink';
import { keepRuleOn, linkRule } from './scheduledLinkData';
import { loadSuggestions } from './suggestData';
import { devices, financeSnapshot, fresh, monthly, ob, settle } from './billsTestkit';
import type { ObligationData } from './model';

/**
 * B3.1 with the real SyncEngine (two devices, which also sync Finance) and a real backup and restore. Rejections and review choices are separate records
 * added by one device and carried to the other, so two devices can never overwrite each other's evidence. Invented data only.
 */
const TODAY = '2026-11-20';
const SLOT = 'm2026-11';
const mkOb = (over: Partial<ObligationData> = {}): ObligationData => ob({ title: 'Example Power Co', providerNameSnapshot: 'Example Power Co', amountKind: 'fixed', prices: [{ from: '2026-01-01', cents: 12000, label: '' }], schedule: monthly(18, '2026-01'), trackingSince: '2026-01-01', ...over }, TODAY);
const addTxn = async (d: FinanceDB, acct: number, amountCents: number, over: Partial<Txn> = {}): Promise<Txn> => {
  const t: Txn = { accountId: acct, date: '2026-11-18', amountCents, payee: 'Example Power Co', memo: '', status: 'pending', categoryId: 5, ...over };
  return { ...t, id: (await d.txns.add(t)) as number };
};
const period = async (d: FinanceDB, id: number): Promise<Period> => {
  const snap = await loadBillsSnapshot(d);
  return periodsOf((await getObligation(id, d))!, snap.cycles, TODAY, { from: '2026-01-01', to: '2027-12-31' }, { allRecorded: true, lookup: lookupOfMap(snap.financeTxns) }).find((p) => p.slot === SLOT)!;
};
const suggest = async (d: FinanceDB, id: number) => loadSuggestions((await getObligation(id, d))!, await period(d, id), TODAY, d);
const rejections = async (d: FinanceDB) => (await loadCycles(d)).filter((c) => c.body?.fact === 'suggestion-reject');

async function seeded() {
  const { A, B } = devices();
  const acct = (await A.d.accounts.add({ name: 'Test checking', kind: 'checking', openingBalanceCents: 0, openingDate: '2026-01-01' } as never)) as number;
  const bill = await createObligation({ data: mkOb(), provider: { name: 'Example Power Co' }, today: TODAY }, A.d);
  const t1 = await addTxn(A.d, acct, -12000, { date: '2026-11-17' });
  const t2 = await addTxn(A.d, acct, -12000, { date: '2026-11-19', memo: 'second' });
  await A.engine.initialUpload();
  await B.engine.replaceFromRemote();
  return { A, B, acct, id: bill.id, t1, t2 };
}
const reject = (d: FinanceDB, id: number, t: Txn) => rejectSuggestion({ obligationId: id, slot: SLOT, ref: makeTxnRef(t), op: newOp() }, d);

describe('B3.1 two devices: rejections', () => {
  it('a rejection made on A reaches B, and both stop suggesting that payment for that period', async () => {
    const { A, B, id, t1, t2 } = await seeded();
    expect((await suggest(B.d, id)).suggestions).toHaveLength(2);
    await reject(A.d, id, t1);
    await settle(A, B);
    for (const d of [A.d, B.d]) {
      const r = await suggest(d, id);
      expect(r.suggestions.map((s) => s.txn.id)).toEqual([t2.id]);
      expect(r.rejected).toHaveLength(1);
    }
  });

  it('each device rejects a DIFFERENT payment while offline: both rejections survive on both devices (separate records, nothing overwritten)', async () => {
    const { A, B, id, t1, t2 } = await seeded();
    await reject(A.d, id, t1);
    await reject(B.d, id, t2);
    await settle(A, B);
    for (const d of [A.d, B.d]) {
      expect(await rejections(d)).toHaveLength(2);
      const r = await suggest(d, id);
      expect(r.suggestions).toEqual([]);
      expect(r.rejected.map((x) => x.rec.body.ref.txnId).sort()).toEqual([t1.id, t2.id].sort());
    }
  });

  it('both devices reject the SAME payment: both records are kept (nothing silently discarded), it reads as rejected once, and no conflict is raised', async () => {
    const { A, B, id, t1 } = await seeded();
    await reject(A.d, id, t1);
    await reject(B.d, id, t1);
    await settle(A, B);
    for (const d of [A.d, B.d]) {
      expect(await rejections(d)).toHaveLength(2);
      expect((await suggest(d, id)).rejected.length).toBe(2); // each record is listed; the piece is still excluded once
      expect((await suggest(d, id)).suggestions.map((s) => s.txn.id)).not.toContain(t1.id);
    }
  });

  it('A reconsiders one rejection while B makes another: the reconsidered one is back, the other stays, on both devices', async () => {
    const { A, B, id, t1, t2 } = await seeded();
    const r1 = await reject(A.d, id, t1);
    await settle(A, B);
    await reconsiderRejection(r1.id, (await A.d.moduleRecords.get(r1.id))!.updatedAt, A.d);
    await reject(B.d, id, t2);
    await settle(A, B);
    for (const d of [A.d, B.d]) {
      const r = await suggest(d, id);
      expect(r.suggestions.map((s) => s.txn.id)).toEqual([t1.id]);
      expect(r.rejected.map((x) => x.rec.body.ref.txnId)).toEqual([t2.id]);
    }
  });

  it('a rejection never touches the Finance rows it points at, on either device', async () => {
    const { A, B, id, t1 } = await seeded();
    const fin = await financeSnapshot(A.d);
    await reject(A.d, id, t1);
    await settle(A, B);
    expect(await financeSnapshot(A.d, false)).toBe(await financeSnapshot(B.d, false));
    expect((await financeSnapshot(A.d)).length).toBe(fin.length);
  });
});

describe('B3.1 two devices: one Finance Scheduled rule linked to two bills', () => {
  it('both pointers are kept and the conflict is visible on both devices; "keep it on this bill" on one device resolves it on both; Undo is guarded', async () => {
    const { A, B } = devices();
    const acct = (await A.d.accounts.add({ name: 'Test checking', kind: 'checking', openingBalanceCents: 0, openingDate: '2026-01-01' } as never)) as number;
    const ruleId = (await A.d.recurring.add({ accountId: acct, payee: 'Example Power Co', amountCents: -12000, categoryId: 5, memo: '', frequency: 'monthly', startDate: '2026-01-18', active: true } as RecurringRule)) as number;
    const one = await createObligation({ data: mkOb({ title: 'Bill one', providerNameSnapshot: 'One' }), today: TODAY }, A.d);
    const two = await createObligation({ data: mkOb({ title: 'Bill two', providerNameSnapshot: 'Two' }), today: TODAY }, A.d);
    await A.engine.initialUpload();
    await B.engine.replaceFromRemote();
    await linkRule({ obligationId: one.id, ruleId, expect: null, today: TODAY }, A.d); // each device, offline, sees a free rule
    await linkRule({ obligationId: two.id, ruleId, expect: null, today: TODAY }, B.d);
    await settle(A, B);
    for (const d of [A.d, B.d]) {
      expect((await getObligation(one.id, d))!.data.scheduledRuleIds).toEqual([ruleId]);
      expect((await getObligation(two.id, d))!.data.scheduledRuleIds).toEqual([ruleId]);
      expect(ruleLinkConflicts(await loadObligations(d))).toHaveLength(1);
    }
    const holders = await loadObligations(A.d);
    const r = await keepRuleOn({ ruleId, keepId: one.id, expect: Object.fromEntries(holders.map((h) => [h.id, h.updatedAt])), today: TODAY }, A.d);
    await settle(A, B);
    for (const d of [A.d, B.d]) {
      expect(ruleLinkConflicts(await loadObligations(d))).toEqual([]);
      expect((await getObligation(one.id, d))!.data.scheduledRuleIds).toEqual([ruleId]);
      expect((await getObligation(two.id, d))!.data.scheduledRuleIds).toEqual([]);
    }
    expect(await A.d.recurring.count()).toBe(1); // the rule was never touched
    expect(r.undo.rows.length).toBe(1);
  });
});

describe('B3.1 two devices: review choices about suggestions', () => {
  const seedPattern = async (d: FinanceDB, acct: number) => { for (const m of ['2026-08', '2026-09', '2026-10', '2026-11']) await addTxn(d, acct, -1549, { date: `${m}-12`, payee: 'Streamly Premium' }); };

  it('a "not recurring" choice on A hides the suggestion on B; B taking it back shows it again on A', async () => {
    const { A, B, acct } = await seeded();
    await seedPattern(A.d, acct);
    await A.engine.sync(); await B.engine.sync();
    const c = (await loadDiscovery(TODAY, A.d)).suggestions.find((x) => x.payee === 'Streamly Premium')!;
    const r = await recordDecision({ key: c.key, decision: 'not-recurring', snap: snapOf(c), today: TODAY, op: newOp() }, A.d);
    await settle(A, B);
    expect((await loadDiscovery(TODAY, B.d)).suggestions.find((x) => x.payee === 'Streamly Premium')).toBeUndefined();
    await removeDecision(r.id, (await B.d.moduleRecords.get(r.id))!.updatedAt, B.d);
    await settle(A, B);
    expect((await loadDiscovery(TODAY, A.d)).suggestions.find((x) => x.payee === 'Streamly Premium')).toBeTruthy();
  });

  it('two different choices about the same pattern are both kept; the newest decides and the older stays as history', async () => {
    const { A, B, acct } = await seeded();
    await seedPattern(A.d, acct);
    await A.engine.sync(); await B.engine.sync();
    const c = (await loadDiscovery(TODAY, A.d)).suggestions.find((x) => x.payee === 'Streamly Premium')!;
    await recordDecision({ key: c.key, decision: 'not-recurring', snap: snapOf(c), today: '2026-11-18', op: newOp() }, A.d);
    await recordDecision({ key: c.key, decision: 'dismissed', snap: snapOf(c), today: '2026-11-19', op: newOp() }, B.d);
    await settle(A, B);
    for (const d of [A.d, B.d]) {
      const ds = await loadDecisions(d);
      expect(ds.map((x) => x.decision).sort()).toEqual(['dismissed', 'not-recurring']);
      expect((await loadDiscovery(TODAY, d)).hidden.map((x) => x.decision!.decision)).toEqual(['dismissed']);
    }
  });
});

describe('B3.1 backup and restore: rejections, choices and Scheduled links come back exactly', () => {
  it('a real backup of a bill with a rejection, a review choice and a linked rule restores to the same suggestions, hidden patterns and link; the summary leaks no names', async () => {
    const src = fresh('b31bk');
    const acct = (await src.accounts.add({ name: 'Test checking', kind: 'checking', openingBalanceCents: 0, openingDate: '2026-01-01' } as never)) as number;
    const ruleId = (await src.recurring.add({ accountId: acct, payee: 'Example Power Co', amountCents: -12000, categoryId: 5, memo: '', frequency: 'monthly', startDate: '2026-01-18', active: true } as RecurringRule)) as number;
    const bill = await createObligation({ data: mkOb(), provider: { name: 'Example Power Co' }, today: TODAY }, src);
    await linkRule({ obligationId: bill.id, ruleId, expect: null, today: TODAY }, src);
    const keep = await addTxn(src, acct, -12000, { date: '2026-11-17' });
    const nope = await addTxn(src, acct, -12000, { date: '2026-11-19' });
    await rejectSuggestion({ obligationId: bill.id, slot: SLOT, ref: makeTxnRef(nope), op: newOp() }, src);
    for (const m of ['2026-08', '2026-09', '2026-10', '2026-11']) await addTxn(src, acct, -1549, { date: `${m}-12`, payee: 'Streamly Premium' });
    const c = (await loadDiscovery(TODAY, src)).suggestions.find((x) => x.payee === 'Streamly Premium')!;
    await recordDecision({ key: c.key, decision: 'not-recurring', snap: snapOf(c), today: TODAY, op: newOp() }, src);
    const before = await suggest(src, bill.id);
    expect(before.suggestions.map((s) => s.txn.id)).toEqual([keep.id]);

    const text = JSON.stringify(await buildBackup(src));
    const summary = JSON.stringify(summarizeBackup(JSON.parse(text)));
    expect(summary).not.toMatch(/Example|Streamly|\$\d/);
    expect(summary).toMatch(/Recurring-expense review choices/);

    const dst = fresh('b31bk2');
    const mem = new Map<string, string>();
    await restoreChecked(dst, checkBackupText(text).file, { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); }, removeItem: (k: string) => { mem.delete(k); } } as never);
    const after = await suggest(dst, bill.id);
    expect(after.suggestions.map((s) => s.txn.id)).toEqual([keep.id]);
    expect(after.rejected.map((x) => x.rec.body.ref.txnId)).toEqual([nope.id]);
    expect((await getObligation(bill.id, dst))!.data.scheduledRuleIds).toEqual([ruleId]);
    const disc = await loadDiscovery(TODAY, dst);
    expect(disc.suggestions.find((x) => x.payee === 'Streamly Premium')).toBeUndefined();
    expect(disc.hidden.map((x) => x.payee)).toEqual(['Streamly Premium']);
    expect(await financeSnapshot(dst, false)).toBe(await financeSnapshot(src, false));
  });

  it('unknown fields on a rejection and on a review choice survive a backup and restore', async () => {
    const src = fresh('b31bk3');
    const bill = await createObligation({ data: mkOb(), today: TODAY }, src);
    await src.moduleRecords.add({ id: 930001, module: 'bills', kind: 'cycle', data: { obligationId: bill.id, slot: SLOT, fact: 'suggestion-reject', ref: { txnId: 5, snapshot: { date: '2026-11-18', payee: 'X', amountCents: -1 } }, future: { keep: [1, 2] } }, createdAt: 1, updatedAt: 1, deletedAt: null } as never);
    await src.moduleRecords.add({ id: 930002, module: 'bills', kind: 'discovery', data: { key: 'p:x', decision: 'dismissed', on: TODAY, snap: { n: 3, last: '2026-11-12', cents: 100 }, future: { keep: 'yes' } }, createdAt: 1, updatedAt: 1, deletedAt: null } as never);
    const text = JSON.stringify(await buildBackup(src));
    const dst = fresh('b31bk4');
    const mem = new Map<string, string>();
    await restoreChecked(dst, checkBackupText(text).file, { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); }, removeItem: (k: string) => { mem.delete(k); } } as never);
    expect((await dst.moduleRecords.get(930001))!.data).toMatchObject({ fact: 'suggestion-reject', future: { keep: [1, 2] } });
    expect((await dst.moduleRecords.get(930002))!.data).toMatchObject({ decision: 'dismissed', future: { keep: 'yes' } });
  });
});
