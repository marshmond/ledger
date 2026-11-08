import { describe, expect, it } from 'vitest';
import type { FinanceDB } from '../db';
import type { TxnReferenceProvider } from '../core/txnDependents';
import { describeCounts, readTxnDependents } from '../core/txnDependents';
import { allTxnReferenceProviders } from '../core/registry';
import { buildBackup, checkBackupText, restoreChecked } from './backupFile';
import { makeTxnRef } from './txnRef';
import { bulkDelete } from './txnBulk';
import { applyTxnDeletion, DeletionRefused, deletionWords, planTxnDeletion } from './txnDeletion';
import { devices, fresh, settle } from '../modules/bills/billsTestkit';
import { newOp, recordFact } from '../modules/bills/cycleData';
import { billsTxnReferences } from '../modules/bills/txnReferences';
import { servicesTxnReferences } from '../modules/services/txnReferences';
import { assetsTxnReferences } from '../modules/assets/txnReferences';
import { projectsTxnReferences } from '../modules/projects/txnReferences';
import { ledgerTxnReferences } from '../modules/ledger/txnReferences';
import { createProject } from '../modules/projects/data';
import { blankProject } from '../modules/projects/model';
import { blankService } from '../modules/assets/service';
import { insertService } from '../modules/assets/serviceData';
import { blankVisit, VISIT_KIND } from '../modules/services/visitModel';
import { loadHouseholdOverview } from '../modules/household/overview';
import { TODAY, digest, seed, type Seed } from '../modules/household/householdSeed';
import type { Txn } from '../types';

/**
 * ST-S2 (DI-02): the dependency reader, the delete preview, the guarded atomic apply, races, sync and backup — on REAL databases (fake IndexedDB) with the real module readers.
 * Everything is invented. Money in comments: outflows are negative cents.
 */
const ALL: TxnReferenceProvider[] = [billsTxnReferences, servicesTxnReferences, assetsTxnReferences, projectsTxnReferences, ledgerTxnReferences];
const store = () => { const mem = new Map<string, string>(); return { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); }, removeItem: (k: string) => { mem.delete(k); } } as never; };

async function addTxn(d: FinanceDB, acct: number, over: Partial<Txn> = {}): Promise<Txn> {
  const id = (await d.txns.add({ accountId: acct, date: '2026-10-02', amountCents: -2000, payee: 'Invented Store', memo: '', status: 'cleared', categoryId: null, ...over } as never)) as number;
  return (await d.txns.get(id))!;
}
const moduleRows = async (d: FinanceDB) => JSON.stringify(await d.moduleRecords.toArray());
const kinds = (xs: { module: string }[]) => [...new Set(xs.map((x) => x.module))].sort();

describe('the dependency reader (read only, by id, never by amount or name)', () => {
  it('a transaction nothing points at has no dependents and is verified', async () => {
    const d = fresh('del'); const s = await seed(d);
    const t = await addTxn(d, s.acct);
    const p = await planTxnDeletion(d, [t.id!], ALL);
    expect(p.verified).toBe(true);
    expect(p.dependents).toEqual([]);
    expect(deletionWords(p).headline).toBe('Nothing else in Ledger points at this transaction.');
  });

  it('a Bills payment link, and a payment of the same amount and payee that nothing links, is NOT matched', async () => {
    const d = fresh('del'); const s = await seed(d);
    const lookalike = await addTxn(d, s.acct, { payee: 'Example Power', amountCents: -6200, date: '2026-10-20' }); // same payee, amount and date as T4
    expect((await planTxnDeletion(d, [lookalike.id!], ALL)).dependents).toEqual([]);
    const p = await planTxnDeletion(d, [s.T4.id!], ALL);
    expect(p.dependents.map((x) => [x.module, x.recordId, x.scope, x.standing, x.evidence])).toEqual([['bills', `bill:${s.bill.power}:m2026-10`, 'whole', 'current', true]]);
    expect(p.dependents[0].title).toBe('Example Power, October 2026');
    expect(p.dependents[0].href).toBe(`/bills/o/${s.bill.power}`);
  });

  it('one piece linked to two billing periods is two records (distinct associations), counted as "2 billing periods"', async () => {
    const d = fresh('del'); const s = await seed(d);
    await recordFact({ obligationId: s.bill.streamly, slot: 'm2026-10', body: { fact: 'payment-link', ref: makeTxnRef(s.T3) }, op: newOp(), today: TODAY }, d); // T3 already sits on m2026-09
    const p = await planTxnDeletion(d, [s.T3.id!], ALL);
    expect(p.dependents.map((x) => x.recordId).sort()).toEqual([`bill:${s.bill.streamly}:m2026-09`, `bill:${s.bill.streamly}:m2026-10`]);
    expect(describeCounts(p.counts)).toBe('2 billing periods');
  });

  it('Household Services: an arrangement payment and a visit payment are each one record', async () => {
    const d = fresh('del'); const s = await seed(d);
    const v = await addTxn(d, s.acct, { payee: 'Pat Pools', amountCents: -4500 });
    const visitId = (await d.moduleRecords.add({ module: 'services', kind: VISIT_KIND, createdAt: 1, updatedAt: 1, deletedAt: null, data: blankVisit({ title: 'Pool visit', date: '2026-10-03', status: 'completed', providerContactId: 1, providerNameSnapshot: 'Pat Pools', arrangementId: s.clean, payment: 'finance', txnRefs: [makeTxnRef(v)] }) } as never)) as number;
    const p = await planTxnDeletion(d, [v.id!, s.T1.id!], ALL);
    const svc = p.dependents.filter((x) => x.module === 'services').map((x) => x.recordId).sort();
    expect(svc).toEqual([`arrangement:${s.clean}`, `visit:${visitId}`].sort());
    expect(p.dependents.find((x) => x.recordId === `visit:${visitId}`)!.href).toBe(`/services/v/${visitId}`);
  });

  it('Home & Assets: a whole-transaction cost and a split-part cost are both found, with their scope', async () => {
    const d = fresh('del'); const s = await seed(d);
    const sp = await addTxn(d, s.acct, { amountCents: -10000, splits: [{ categoryId: null, amountCents: -6000 }, { categoryId: null, amountCents: -4000 }] });
    await insertService(blankService(s.home, { title: 'Part job', date: '2026-10-03', txnRefs: [makeTxnRef(sp, 1)] }), d, TODAY);
    const p = await planTxnDeletion(d, [sp.id!], ALL);
    expect(p.dependents).toHaveLength(1);
    expect(p.dependents[0]).toMatchObject({ module: 'assets', scope: 'part', parts: [1], standing: 'current', evidence: true });
    const whole = await planTxnDeletion(d, [s.T5.id!], ALL); // the furnace repair links the whole payment
    expect(whole.dependents[0]).toMatchObject({ module: 'assets', scope: 'whole', parts: [] });
  });

  it('Projects: a whole tag and a split-part tag are found through the transaction itself, and a deleted project is shown as such', async () => {
    const d = fresh('del'); const s = await seed(d);
    const pid = await createProject(blankProject({ name: 'Kitchen refit' }), d);
    await d.txns.update(s.T4.id!, { project: { projectId: pid } });
    const sp = await addTxn(d, s.acct, { amountCents: -9000, splits: [{ categoryId: null, amountCents: -5000, project: { projectId: pid } }, { categoryId: null, amountCents: -4000 }] });
    const gone = await addTxn(d, s.acct, { project: { projectId: 987654321 } });
    const p = await planTxnDeletion(d, [s.T4.id!, sp.id!, gone.id!], ALL);
    const proj = p.dependents.filter((x) => x.module === 'projects');
    expect(proj.map((x) => [x.txnId, x.scope, x.parts, x.standing, x.title])).toEqual([
      [s.T4.id, 'whole', [], 'current', 'Kitchen refit'],
      [sp.id, 'part', [0], 'current', 'Kitchen refit'],
      [gone.id, 'whole', [], 'stale', 'A project that no longer exists'],
    ]);
    expect(proj[0].href).toBe(`/projects/${pid}`);
  });

  it('one payment used by all four modules: every module is named, the sentence counts them, and the spending effect is stated', async () => {
    const d = fresh('del'); const s = await seed(d);
    const pid = await createProject(blankProject({ name: 'Spring clean' }), d);
    await d.txns.update(s.T1.id!, { project: { projectId: pid } });
    const p = await planTxnDeletion(d, [s.T1.id!], ALL);
    expect(kinds(p.dependents)).toEqual(['assets', 'bills', 'projects', 'services']);
    expect(p.evidenceRecords).toBe(4);
    const w = deletionWords(p);
    expect(w.headline).toBe('This payment is used by 1 billing period, 1 home-maintenance record, 1 service arrangement and 1 project.');
    expect(w.consequence).toMatch(/leaves those records in place.*need review.*no typed amount is put in its place/);
    expect(w.spending).toMatch(/4 records will stop counting this payment in recorded spending/);
    expect(JSON.stringify(p.dependents)).not.toMatch(/\$|\d+\.\d\d/); // no money in any message
  });

  it('two stored references to the same record are ONE dependent (a whole and a part of one transaction on one record)', async () => {
    const d = fresh('del'); const s = await seed(d);
    const sp = await addTxn(d, s.acct, { amountCents: -10000, splits: [{ categoryId: null, amountCents: -6000 }, { categoryId: null, amountCents: -4000 }] });
    const id = await insertService(blankService(s.home, { title: 'Doubled', date: '2026-10-03', txnRefs: [makeTxnRef(sp, 0)] }), d, TODAY);
    const row = (await d.moduleRecords.get(id))!;
    await d.moduleRecords.put({ ...row, data: { ...(row.data as object), txnRefs: [makeTxnRef(sp), makeTxnRef(sp), makeTxnRef(sp, 0), makeTxnRef(sp, 1)] } } as never);
    const p = await planTxnDeletion(d, [sp.id!], ALL);
    expect(p.dependents).toHaveLength(1);
    expect(p.dependents[0]).toMatchObject({ scope: 'whole', recordId: `service:${id}` });
    expect(p.counts[0].count).toBe(1);
  });

  it('a reference that is already out of date (the part changed since it was linked) is "stale", not evidence, and still listed', async () => {
    const d = fresh('del'); const s = await seed(d);
    const sp = await addTxn(d, s.acct, { amountCents: -10000, splits: [{ categoryId: null, amountCents: -6000 }, { categoryId: null, amountCents: -4000 }] });
    await insertService(blankService(s.home, { title: 'Part job', date: '2026-10-03', txnRefs: [makeTxnRef(sp, 0)] }), d, TODAY);
    await d.txns.update(sp.id!, { splits: [{ categoryId: null, amountCents: -7000 }, { categoryId: null, amountCents: -3000 }] }); // restructured after linking
    const p = await planTxnDeletion(d, [sp.id!], ALL);
    expect(p.dependents[0]).toMatchObject({ standing: 'stale', evidence: false });
    expect(p.evidenceRecords).toBe(0);
    expect(p.otherRecords).toBe(1);
  });

  it('a rejected suggestion and a saved entry this version cannot read are shown as history, never omitted', async () => {
    const d = fresh('del'); const s = await seed(d);
    const t = await addTxn(d, s.acct, { payee: 'Streamly', amountCents: -1549, date: '2026-08-15' });
    await recordFact({ obligationId: s.bill.streamly, slot: 'm2026-08', body: { fact: 'suggestion-reject', ref: makeTxnRef(t) }, op: newOp(), today: TODAY }, d);
    const u = await addTxn(d, s.acct, { amountCents: -777 });
    await d.moduleRecords.add({ module: 'bills', kind: 'cycle', createdAt: 5, updatedAt: 5, deletedAt: null, data: { obligationId: s.bill.streamly, slot: 'm2026-07', fact: 'a-future-fact', ref: makeTxnRef(u), extra: 'kept' } } as never);
    const a = await planTxnDeletion(d, [t.id!], ALL), b = await planTxnDeletion(d, [u.id!], ALL);
    expect(a.dependents[0]).toMatchObject({ standing: 'historical', evidence: false });
    expect(a.dependents[0].relation).toMatch(/rejected/);
    expect(b.dependents[0]).toMatchObject({ standing: 'historical', evidence: false });
    expect(b.dependents[0].relation).toMatch(/cannot read/);
  });

  it("Finance's own dependents: a posted scheduled payment is listed as history", async () => {
    const d = fresh('del'); const s = await seed(d);
    const t = await addTxn(d, s.acct, { payee: 'Rent' });
    const ruleId = (await d.recurring.add({ accountId: s.acct, payee: 'Rent', amountCents: -2000, categoryId: null, memo: '', frequency: 'monthly', startDate: '2026-10-02', active: true } as never)) as number;
    await d.recurringLog.add({ ruleId, date: '2026-10-02', action: 'posted', txnId: t.id! });
    const p = await planTxnDeletion(d, [t.id!], ALL);
    expect(p.dependents[0]).toMatchObject({ module: 'ledger', standing: 'historical', evidence: false, recordId: `scheduled:${ruleId}:2026-10-02` });
  });

  it('the reader writes nothing', async () => {
    const d = fresh('del'); const s = await seed(d);
    const before = await digest(d);
    await planTxnDeletion(d, [s.T1.id!, s.T4.id!, s.T5.id!], ALL);
    expect(await digest(d)).toBe(before);
  });

  it('the registry offers a reader from every module that holds references', async () => {
    const { registerModules } = await import('../modules');
    registerModules();
    expect(allTxnReferenceProviders().map((p) => p.label).sort()).toEqual(['Bills & Subscriptions', 'Home & Assets', 'Household Services', 'Ledger scheduled payments', 'Projects']);
  });
});

describe('when a module cannot be checked', () => {
  const broken: TxnReferenceProvider = { label: 'Broken module', find: async () => { throw new Error('could not read'); } };

  it('is "not verified" (never "nothing depends on it"), the other modules still report, and Delete is refused', async () => {
    const d = fresh('del'); const s = await seed(d);
    const p = await planTxnDeletion(d, [s.T4.id!], [...ALL, broken]);
    expect(p.verified).toBe(false);
    expect(p.unverified).toEqual([{ label: 'Broken module', message: 'could not read' }]);
    expect(p.dependents.length).toBe(1);
    expect(deletionWords(p).headline).toMatch(/could not finish checking/);
    await expect(applyTxnDeletion(d, p, [...ALL, broken])).rejects.toMatchObject({ reason: 'unverified' });
    expect(await d.txns.get(s.T4.id!)).toBeTruthy();
  });

  it('a reader that works at preview time but fails at apply time still refuses, and nothing is deleted', async () => {
    const d = fresh('del'); const s = await seed(d);
    let calls = 0;
    const flaky: TxnReferenceProvider = { label: 'Flaky', find: async () => { if (++calls > 1) throw new Error('gone'); return []; } };
    const plan = await planTxnDeletion(d, [s.T4.id!], [...ALL, flaky]);
    expect(plan.verified).toBe(true);
    await expect(applyTxnDeletion(d, plan, [...ALL, flaky])).rejects.toMatchObject({ reason: 'unverified' });
    expect(await d.txns.get(s.T4.id!)).toBeTruthy();
  });

  it('no readers registered at all is also "not verified"', async () => {
    const d = fresh('del'); const s = await seed(d);
    const p = await planTxnDeletion(d, [s.T4.id!], []);
    expect(p.verified).toBe(false);
    await expect(applyTxnDeletion(d, p, [])).rejects.toBeInstanceOf(DeletionRefused);
    expect((await readTxnDependents([s.T4.id!], new Map(), d, [])).verified).toBe(false);
  });
});

describe('the guarded apply: revalidated inside the delete itself', () => {
  it('cancel changes nothing: planning then walking away leaves every row as it was', async () => {
    const d = fresh('del'); const s = await seed(d);
    const before = await digest(d);
    await planTxnDeletion(d, [s.T1.id!], ALL);
    expect(await digest(d)).toBe(before);
  });

  it('deletes exactly what was shown, leaves every household record in place, and the readers keep their own stale-reference behaviour', async () => {
    const d = fresh('del'); const s = await seed(d);
    const overview0 = await loadHouseholdOverview('all', TODAY, d);
    expect(overview0.spending.totalCents).toBe(64798);
    const rowsBefore = await moduleRows(d);
    const plan = await planTxnDeletion(d, [s.T4.id!], ALL); // Example Power $62.00, linked from Bills only
    expect((await applyTxnDeletion(d, plan, ALL)).deleted).toBe(1);
    expect(await d.txns.get(s.T4.id!)).toBeUndefined();
    expect(await moduleRows(d)).toBe(rowsBefore); // no Bills, Services or Home & Assets record was touched
    const o = await loadHouseholdOverview('all', TODAY, d);
    expect(o.spending.totalCents).toBe(64798 - 6200); // the payment simply stops counting
    expect(o.spending.reconciled).toBe(false);
    expect(o.spending.review.some((r) => r.kind === 'stale')).toBe(true);
    expect(o.spending.caveats.join(' ')).toMatch(/linked payment needs review/);
  });

  it('a typed outside-Finance amount is NOT put in its place when the Finance payment disappears', async () => {
    const d = fresh('del'); const s = await seed(d);
    // a typed $70.00 for the same period (it arrived by sync or an older build; the form refuses to create this)
    await d.moduleRecords.add({ module: 'bills', kind: 'cycle', createdAt: 9, updatedAt: 9, deletedAt: null, data: { obligationId: s.bill.power, slot: 'm2026-10', fact: 'paid-outside', paidOn: '2026-10-21', cents: 7000 } } as never);
    const before = (await loadHouseholdOverview('all', TODAY, d)).spending.totalCents;
    expect(before).toBe(64798); // typed amount set aside while the Finance payment counts
    const p = await planTxnDeletion(d, [s.T4.id!], ALL);
    expect(p.dependents[0].note).toMatch(/stays set aside/);
    await applyTxnDeletion(d, p, ALL);
    expect((await loadHouseholdOverview('all', TODAY, d)).spending.totalCents).toBe(64798 - 6200); // not 64798 - 6200 + 7000
  });

  it('a transaction edited after the preview: nothing is deleted', async () => {
    const d = fresh('del'); const s = await seed(d);
    const plan = await planTxnDeletion(d, [s.T4.id!], ALL);
    await d.txns.update(s.T4.id!, { amountCents: -6300 });
    await expect(applyTxnDeletion(d, plan, ALL)).rejects.toMatchObject({ reason: 'stale' });
    expect(await d.txns.get(s.T4.id!)).toBeTruthy();
  });

  it('ANY edit to the transaction after the preview, even just its memo or status, makes the preview stale; a save that changes nothing does not', async () => {
    const d = fresh('del'); const s = await seed(d);
    const plan = await planTxnDeletion(d, [s.T4.id!], ALL);
    await d.txns.update(s.T4.id!, { memo: 'edited after the preview' });
    await expect(applyTxnDeletion(d, plan, ALL)).rejects.toMatchObject({ reason: 'stale' });
    const again = await planTxnDeletion(d, [s.T4.id!], ALL);
    await d.txns.update(s.T4.id!, { memo: 'edited after the preview' }); // same values written again (only the sync stamp moves)
    expect((await applyTxnDeletion(d, again, ALL)).deleted).toBe(1);
    const d2 = fresh('del'); const s2 = await seed(d2);
    const plan2 = await planTxnDeletion(d2, [s2.T4.id!], ALL);
    await d2.txns.update(s2.T4.id!, { status: 'pending' });
    await expect(applyTxnDeletion(d2, plan2, ALL)).rejects.toMatchObject({ reason: 'stale' });
  });

  it('a split restructured after the preview: nothing is deleted', async () => {
    const d = fresh('del'); const s = await seed(d);
    const sp = await addTxn(d, s.acct, { amountCents: -10000, splits: [{ categoryId: null, amountCents: -6000 }, { categoryId: null, amountCents: -4000 }] });
    const plan = await planTxnDeletion(d, [sp.id!], ALL);
    await d.txns.update(sp.id!, { splits: [{ categoryId: null, amountCents: -5000 }, { categoryId: null, amountCents: -5000 }] });
    await expect(applyTxnDeletion(d, plan, ALL)).rejects.toMatchObject({ reason: 'stale' });
    expect(await d.txns.get(sp.id!)).toBeTruthy();
  });

  it('a new link added by another module after the preview is NOT ignored: nothing is deleted until the owner sees it', async () => {
    const d = fresh('del'); const s = await seed(d);
    const plan = await planTxnDeletion(d, [s.T4.id!], ALL);
    await insertService(blankService(s.home, { title: 'Sneaky new link', date: '2026-10-21', txnRefs: [makeTxnRef(s.T4)] }), d, TODAY);
    await expect(applyTxnDeletion(d, plan, ALL)).rejects.toMatchObject({ reason: 'stale' });
    expect(await d.txns.get(s.T4.id!)).toBeTruthy();
    const fresh2 = await planTxnDeletion(d, [s.T4.id!], ALL);
    expect(fresh2.dependents.map((x) => x.module).sort()).toEqual(['assets', 'bills']);
    expect((await applyTxnDeletion(d, fresh2, ALL)).deleted).toBe(1); // confirming the new list works
  });

  it('a link removed after the preview also needs a fresh look; a different selection is never applied', async () => {
    const d = fresh('del'); const s = await seed(d);
    const plan = await planTxnDeletion(d, [s.T5.id!], ALL);
    const svc = (await d.moduleRecords.toArray()).find((r) => r.module === 'assets' && r.kind === 'service' && (r.data as { title?: string }).title === 'Furnace repair')!;
    await d.moduleRecords.put({ ...svc, deletedAt: 1 } as never);
    await expect(applyTxnDeletion(d, plan, ALL)).rejects.toMatchObject({ reason: 'stale' });
    const other = { ...plan, requested: [s.T6.id!], willDelete: [s.T6.id!] };
    await expect(applyTxnDeletion(d, other, ALL)).rejects.toMatchObject({ reason: 'stale' });
    expect(await d.txns.get(s.T6.id!)).toBeTruthy();
  });

  it('a transaction already deleted elsewhere is reported as gone and skipped; with nothing left, the apply refuses', async () => {
    const d = fresh('del'); const s = await seed(d);
    const lone = await addTxn(d, s.acct);
    const plan = await planTxnDeletion(d, [lone.id!, 99999999], ALL);
    expect(plan.missing).toEqual([99999999]);
    expect((await applyTxnDeletion(d, plan, ALL)).deleted).toBe(1);
    const again = await planTxnDeletion(d, [lone.id!], ALL);
    expect(again.willDelete).toEqual([]);
    await expect(applyTxnDeletion(d, again, ALL)).rejects.toMatchObject({ reason: 'empty' });
  });
});

describe('transfers and bulk deletion', () => {
  async function pair(d: FinanceDB, a: number, b: number) {
    const x = await addTxn(d, a, { payee: 'Transfer to Savings', amountCents: -5000 });
    const y = await addTxn(d, b, { payee: 'Transfer from Checking', amountCents: 5000 });
    await d.txns.update(x.id!, { transferTxnId: y.id! }); await d.txns.update(y.id!, { transferTxnId: x.id! });
    return [x, y] as const;
  }
  it('choosing one half of a transfer names the other half; choosing both does not double count', async () => {
    const d = fresh('del'); const s = await seed(d);
    const acct2 = (await d.accounts.add({ name: 'Test savings', kind: 'savings', openingBalanceCents: 0, openingDate: '2026-01-01' } as never)) as number;
    const [x, y] = await pair(d, s.acct, acct2);
    const one = await planTxnDeletion(d, [x.id!], ALL);
    expect(one.willDelete.sort()).toEqual([x.id!, y.id!].sort());
    expect(one.transferPartners).toEqual([y.id]);
    expect(deletionWords(one).headline).toMatch(/matching half of a transfer will be deleted too \(2 in all\)/);
    const both = await planTxnDeletion(d, [x.id!, y.id!], ALL);
    expect(both.willDelete).toHaveLength(2);
    expect(both.transferPartners).toEqual([]);
    expect((await applyTxnDeletion(d, one, ALL)).deleted).toBe(2);
    expect(await d.txns.get(y.id!)).toBeUndefined();
  });

  it('a bulk selection gathers every module, counts a record once, and deletes the whole selection in one step', async () => {
    const d = fresh('del'); const s = await seed(d);
    const acct2 = (await d.accounts.add({ name: 'Test savings', kind: 'savings', openingBalanceCents: 0, openingDate: '2026-01-01' } as never)) as number;
    const [x] = await pair(d, s.acct, acct2);
    const plan = await planTxnDeletion(d, [s.T1.id!, s.T2.id!, s.T5.id!, s.T6.id!, x.id!], ALL);
    // T1: bill period + arrangement + Home service; T2: bill period; T5 and T6: the SAME furnace service record (counted once)
    expect(plan.counts.map((c) => [c.module, c.count])).toEqual([['bills', 2], ['assets', 2], ['services', 1]]);
    expect(plan.willDelete).toHaveLength(6);
    expect(plan.transferPartners).toHaveLength(1);
    const rows = await moduleRows(d);
    expect((await applyTxnDeletion(d, plan, ALL)).deleted).toBe(6);
    expect(await moduleRows(d)).toBe(rows);
    for (const t of [s.T1, s.T2, s.T5, s.T6]) expect(await d.txns.get(t.id!)).toBeUndefined();
  });

  it('50 transactions with a failure halfway: all 50 stay, no account or household row changes (guarded apply)', async () => {
    const d = fresh('del'); const s = await seed(d);
    const ids: number[] = [];
    for (let i = 0; i < 50; i++) ids.push((await addTxn(d, s.acct, { payee: `Bulk ${i}`, amountCents: -(100 + i) })).id!);
    await insertService(blankService(s.home, { title: 'Uses one of them', date: '2026-10-03', txnRefs: [makeTxnRef((await d.txns.get(ids[10]))!)] }), d, TODAY);
    const plan = await planTxnDeletion(d, ids, ALL);
    expect(plan.willDelete).toHaveLength(50);
    const before = await digest(d);
    let seen = 0;
    const hook = () => { if (++seen === 25) throw new Error('injected failure'); };
    d.txns.hook('deleting', hook);
    await expect(applyTxnDeletion(d, plan, ALL)).rejects.toThrow('injected failure');
    d.txns.hook('deleting').unsubscribe(hook);
    expect(seen).toBe(25);
    expect(await d.txns.filter((t) => t.payee.startsWith('Bulk ')).count()).toBe(50);
    expect(await digest(d)).toBe(before);
    expect((await applyTxnDeletion(d, plan, ALL)).deleted).toBe(50); // and it works when nothing fails
    expect(await d.txns.filter((t) => t.payee.startsWith('Bulk ')).count()).toBe(0);
  });

  it('the plain bulkDelete is one transaction too (50 with a failure halfway all stay)', async () => {
    const d = fresh('del'); const s = await seed(d);
    const ids: number[] = [];
    for (let i = 0; i < 50; i++) ids.push((await addTxn(d, s.acct, { payee: `Plain ${i}` })).id!);
    const before = await digest(d);
    let seen = 0;
    const hook = () => { if (++seen === 30) throw new Error('boom'); };
    d.txns.hook('deleting', hook);
    await expect(bulkDelete(d, ids)).rejects.toThrow('boom');
    d.txns.hook('deleting').unsubscribe(hook);
    expect(await digest(d)).toBe(before);
    expect(await bulkDelete(d, ids)).toBe(50);
  });
});

describe('two devices, sync and backup', () => {
  it('a deletion on one device and a new link on the other converge to a VISIBLE stale reference, never a silent repair', async () => {
    const { A, B } = devices();
    const s: Seed = await seed(A.d);
    await A.engine.initialUpload(); await B.engine.replaceFromRemote();
    // B links the payment to another billing period while A deletes it
    await recordFact({ obligationId: s.bill.power, slot: 'm2026-09', body: { fact: 'payment-link', ref: makeTxnRef(s.T4) }, op: newOp(), today: TODAY }, B.d);
    const plan = await planTxnDeletion(A.d, [s.T4.id!], ALL);
    await applyTxnDeletion(A.d, plan, ALL);
    await settle(A, B);
    for (const dev of [A, B]) {
      expect(await dev.d.txns.get(s.T4.id!)).toBeUndefined();
      const o = await loadHouseholdOverview('all', TODAY, dev.d);
      const stale = o.spending.review.filter((r) => r.kind === 'stale' && r.text.startsWith('Example Power'));
      expect(stale.length).toBe(2); // October (linked before) and September (linked on the other device)
      expect(o.spending.reconciled).toBe(false);
      expect(o.spending.totalCents).toBe(64798 - 6200);
    }
    expect(JSON.stringify(await loadHouseholdOverview('all', TODAY, A.d))).toBe(JSON.stringify(await loadHouseholdOverview('all', TODAY, B.d)));
  });

  it('both devices delete the same payment: still converges and the records that pointed at it stay', async () => {
    const { A, B } = devices();
    const s = await seed(A.d);
    await A.engine.initialUpload(); await B.engine.replaceFromRemote();
    const rows = await moduleRows(A.d);
    await applyTxnDeletion(A.d, await planTxnDeletion(A.d, [s.T5.id!], ALL), ALL);
    await applyTxnDeletion(B.d, await planTxnDeletion(B.d, [s.T5.id!], ALL), ALL);
    await settle(A, B);
    expect(await A.d.txns.get(s.T5.id!)).toBeUndefined();
    expect(await B.d.txns.get(s.T5.id!)).toBeUndefined();
    expect(await moduleRows(A.d)).toBe(rows);
  });

  it('a backup taken after the deletion restores to the same stale-reference state, and unknown record fields survive', async () => {
    const d = fresh('del'); const s = await seed(d);
    const row = (await d.moduleRecords.toArray()).find((r) => r.module === 'assets' && r.kind === 'service' && (r.data as { title?: string }).title === 'Furnace repair')!;
    await d.moduleRecords.put({ ...row, data: { ...(row.data as object), someFutureField: { keep: 'me' } } } as never);
    await applyTxnDeletion(d, await planTxnDeletion(d, [s.T5.id!, s.T6.id!], ALL), ALL);
    const text = JSON.stringify(await buildBackup(d));
    const r = fresh('del');
    await restoreChecked(r, checkBackupText(text).file, store());
    const a = await loadHouseholdOverview('all', TODAY, d), b = await loadHouseholdOverview('all', TODAY, r);
    expect(b.spending.totalCents).toBe(a.spending.totalCents);
    expect(JSON.stringify(b.spending.review)).toBe(JSON.stringify(a.spending.review));
    expect(b.spending.review.filter((x) => x.kind === 'stale').length).toBeGreaterThan(0);
    const kept = (await r.moduleRecords.toArray()).find((x) => (x.data as { title?: string }).title === 'Furnace repair')!;
    expect((kept.data as { someFutureField?: unknown }).someFutureField).toEqual({ keep: 'me' });
    expect((await loadHouseholdOverview('all', TODAY, r)).spending.totalCents).toBe(64798 - (34000 - 3000));
  });
});
