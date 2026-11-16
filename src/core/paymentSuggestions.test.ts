import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FinanceDB } from '../db';
import { providerNamed } from './contactTestkit';
import { acceptCandidate, gatherSuggestions, rejectCandidate, type GatherEnv, type GatherResult, type LinkCandidate } from './paymentSuggestions';
import { fresh, monthly, ob } from '../modules/bills/billsTestkit';
import { createObligation, loadObligations } from '../modules/bills/data';
import { loadCycles } from '../modules/bills/cycleData';
import { loadSuggestions } from '../modules/bills/suggestData';
import { getObligation } from '../modules/bills/data';
import { loadBillsSnapshot } from '../modules/bills/readModel';
import { periodsOf } from '../modules/bills/periods';
import { recordFact, newOp } from '../modules/bills/cycleData';
import * as billsAdapter from '../modules/bills/paymentSuggest';
import * as servicesAdapter from '../modules/services/paymentSuggest';
import * as assetsAdapter from '../modules/assets/paymentSuggest';
import * as projectsAdapter from '../modules/projects/paymentSuggest';
import { billsTxnReferences } from '../modules/bills/txnReferences';
import { servicesTxnReferences } from '../modules/services/txnReferences';
import { assetsTxnReferences } from '../modules/assets/txnReferences';
import { projectsTxnReferences } from '../modules/projects/txnReferences';
import { logStandaloneVisit, loadVisits } from '../modules/services/visits';
import { setVisitPayment } from '../modules/services/payments';
import { createAsset } from '../modules/assets/data';
import { blankAsset } from '../modules/assets/model';
import { blankService } from '../modules/assets/service';
import { createService, loadServices, updateService } from '../modules/assets/serviceData';
import { addVendor, createCommitment, createProject } from '../modules/projects/data';
import { blankProject } from '../modules/projects/model';
import { setTxnProject } from '../lib/txnProject';
import { lookupOfMap } from '../lib/txnLookup';
import { makeTxnRef } from '../lib/txnRef';
import type { Txn } from '../types';

/**
 * R2.2 "Possible matches", with a real database (fake-indexeddb) and invented data only. Today is 2026-11-20. Each test gets its own database.
 * The environment is the four real adapters and the four real "who points at this transaction" readers, so the shell, the modules and the
 * existing link operations are all exercised together.
 */
const TODAY = '2026-11-20';
const OLD = '2026-01-01';
const src = (moduleId: string, label: string, m: { suggest: never; accept: never; reject: never }) => ({ moduleId, source: { label, suggest: m.suggest, accept: m.accept, reject: m.reject } });
const env: GatherEnv = {
  sources: [
    src('bills', 'Bills & Subscriptions', billsAdapter as never),
    src('services', 'Household Services', servicesAdapter as never),
    src('assets', 'Home & Assets', assetsAdapter as never),
    src('projects', 'Projects', projectsAdapter as never),
  ],
  providers: [billsTxnReferences, servicesTxnReferences, assetsTxnReferences, projectsTxnReferences],
};

const account = async (d: FinanceDB) => (await d.accounts.toArray())[0]?.id ?? ((await d.accounts.add({ name: 'Test checking', kind: 'checking', openingBalanceCents: 0, openingDate: '2026-01-01' } as never)) as number);
const addTxn = async (d: FinanceDB, amountCents: number, payee: string, date: string, over: Partial<Txn> = {}): Promise<Txn> => {
  const t: Txn = { accountId: await account(d), date, amountCents, payee, memo: '', status: 'cleared', categoryId: 5, ...over };
  return { ...t, id: (await d.txns.add(t)) as number };
};
const everything = async (d: FinanceDB) => JSON.stringify(await Promise.all(d.tables.map(async (t) => [t.name, await t.toArray()])));
const gather = (d: FinanceDB, ids: number[]): Promise<GatherResult> => gatherSuggestions(ids, TODAY, d, env);
const all = (r: GatherResult) => r.groups.flatMap((g) => g.candidates);
const forTxn = (r: GatherResult, id: number) => r.groups.find((g) => g.txn.id === id)?.candidates ?? [];
const pick = (r: GatherResult, id: number, moduleId: string): LinkCandidate => { const c = forTxn(r, id).find((x) => x.moduleId === moduleId); if (!c) throw new Error(`no ${moduleId} candidate for ${id}`); return c; };

// ---- invented households ----
const mkBill = async (d: FinanceDB, over = {}) => createObligation({ data: ob({ title: 'Example Power Co', providerNameSnapshot: 'Example Power Co', amountKind: 'fixed', prices: [{ from: OLD, cents: 12000, label: '' }], schedule: monthly(18, '2026-01'), trackingSince: OLD, ...over }, TODAY), provider: await providerNamed(d, 'Example Power Co'), today: TODAY }, d);
const mkVisit = async (d: FinanceDB, name: string, date: string, chargedCents: number | null, title = 'House cleaning') =>
  (await logStandaloneVisit({ arrangementId: null, provider: { ...(await providerNamed(d, name)) }, input: { status: 'completed', cancelledBy: null, date, title, chargedCents, chargeKind: chargedCents === null ? null : 'service' }, today: TODAY }, d)).visitId;
const mkService = async (d: FinanceDB, provider: string, date: string, over = {}) => {
  const assetId = await createAsset(blankAsset({ name: 'Gas furnace', type: 'other' }), d);
  return createService(blankService(assetId, { date, title: 'Annual furnace tune-up', kind: 'maintenance', providerContactId: (await providerNamed(d, provider)).contactId, ...over }), d, TODAY);
};
const mkProject = async (d: FinanceDB, vendor: string, over = {}) => {
  const id = await createProject(blankProject({ name: 'Kitchen remodel', status: 'active', startDate: '2026-10-01', targetDate: '2027-02-28', ...over }), d);
  await addVendor(id, (await providerNamed(d, vendor)).contactId, d);
  return id;
};

describe('R2.2 candidates: one credible match per module, each with plain reasons', () => {
  it('a bill, a service visit, a maintenance record and a project each get a candidate, with reasons and no amounts', async () => {
    const d = fresh('r22a');
    await mkBill(d);
    const visitId = await mkVisit(d, "Rosa's Cleaning", '2026-11-10', 9000);
    await mkService(d, 'Northside Heating', '2026-11-05');
    const projectId = await mkProject(d, 'Harbor Tile');
    const bill = await addTxn(d, -12000, 'Example Power Co', '2026-11-18');
    const visit = await addTxn(d, -9000, "Rosa's Cleaning", '2026-11-12');
    const svc = await addTxn(d, -22000, 'Northside Heating', '2026-11-06');
    const proj = await addTxn(d, -50000, 'Harbor Tile', '2026-11-08');
    const r = await gather(d, [bill.id!, visit.id!, svc.id!, proj.id!]);
    expect(r.checked).toBe(true);
    expect(r.unavailable).toEqual([]);
    const b = pick(r, bill.id!, 'bills'), v = pick(r, visit.id!, 'services'), s = pick(r, svc.id!, 'assets'), p = pick(r, proj.id!, 'projects');
    expect([b.action, v.action, s.action, p.action]).toEqual(['accept', 'accept', 'accept', 'accept']);
    expect(b.targetTitle).toBe('Example Power Co');
    expect(v.href).toBe(`/services/v/${visitId}`);
    expect(p.href).toBe(`/projects/${projectId}`);
    for (const c of [b, v, s, p]) {
      expect(c.reasons.length).toBeGreaterThanOrEqual(2);
      expect(c.reasons.join(' ')).toMatch(/payee/i);
      expect(c.reasons.join(' ') + c.targetDetail + c.targetTitle).not.toMatch(/\$|\d+(\.\d\d)\b|%|confidence/i); // no amount, no percentage
    }
  });

  it('an amount alone never suggests anything: the same amount at a different payee, and a visit charge with no payee match', async () => {
    const d = fresh('r22b');
    await mkBill(d);
    await mkVisit(d, "Rosa's Cleaning", '2026-11-10', 9000);
    const sameAsBill = await addTxn(d, -12000, 'Corner Hardware', '2026-11-18');
    const sameAsVisit = await addTxn(d, -9000, 'Lakeview Grocery', '2026-11-12');
    const r = await gather(d, [sameAsBill.id!, sameAsVisit.id!]);
    expect(all(r)).toEqual([]);
    expect(r.groups).toEqual([]);
  });

  it('a recorded charge that disagrees leaves the visit out, even with the right payee', async () => {
    const d = fresh('r22c');
    await mkVisit(d, "Rosa's Cleaning", '2026-11-10', 9000);
    const t = await addTxn(d, -15000, "Rosa's Cleaning", '2026-11-12');
    expect(all(await gather(d, [t.id!]))).toEqual([]);
  });

  it('money coming back, a transfer and an already-tagged payment are never suggested', async () => {
    const d = fresh('r22d');
    await mkBill(d);
    const projectId = await mkProject(d, 'Harbor Tile');
    const refund = await addTxn(d, 12000, 'Example Power Co', '2026-11-18');
    const tagged = await addTxn(d, -50000, 'Harbor Tile', '2026-11-08');
    await setTxnProject(d, tagged.id!, { projectId });
    expect(all(await gather(d, [refund.id!, tagged.id!]))).toEqual([]);
  });
});

describe('R2.2 ambiguity and review: Ledger never picks for the owner, and never assumes a whole payment is one project', () => {
  it('two visits that could match give two candidates, both "review", and the group says so', async () => {
    const d = fresh('r22e');
    await mkVisit(d, "Rosa's Cleaning", '2026-11-03', null);
    await mkVisit(d, "Rosa's Cleaning", '2026-11-10', null);
    const t = await addTxn(d, -18000, "Rosa's Cleaning", '2026-11-12');
    const r = await gather(d, [t.id!]);
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0].ambiguous).toBe(true);
    expect(r.groups[0].candidates.map((c) => c.action)).toEqual(['review', 'review']);
  });

  it('a bill and a project that both fit are both shown, none accepted from the list', async () => {
    const d = fresh('r22f');
    await mkBill(d);
    await mkProject(d, 'Example Power');
    const t = await addTxn(d, -12000, 'Example Power Co', '2026-11-18');
    const r = await gather(d, [t.id!]);
    expect(new Set(forTxn(r, t.id!).map((c) => c.moduleId))).toEqual(new Set(['bills', 'projects']));
    expect(r.groups[0].ambiguous).toBe(true);
    expect(forTxn(r, t.id!).every((c) => c.action === 'review')).toBe(true);
  });

  it('a split payment is a review for a project (the whole is never assumed), and so is a vendor with two contracts', async () => {
    const d = fresh('r22g');
    const projectId = await mkProject(d, 'Harbor Tile');
    const vendor = (await providerNamed(d, 'Harbor Tile')).contactId;
    const split = await addTxn(d, -50000, 'Harbor Tile', '2026-11-08', { splits: [{ categoryId: 5, amountCents: -30000 }, { categoryId: 6, amountCents: -20000 }] });
    const r = await gather(d, [split.id!]);
    const c = pick(r, split.id!, 'projects');
    expect(c.action).toBe('review');
    expect(c.reviewNote).toMatch(/split/i);
    expect(c.reviewHref).toBe(`/ledger/transactions?txn=${split.id}`);
    // two agreed contracts with the same vendor: the owner chooses
    for (const title of ['Tile supply', 'Tile install']) await createCommitment(projectId, { title, amountCents: 100000, status: 'accepted', parentId: null, budgetLineId: null, vendorContactId: vendor, acceptedDate: '2026-10-01', notes: '' }, d);
    const whole = await addTxn(d, -40000, 'Harbor Tile', '2026-11-09');
    const c2 = pick(await gather(d, [whole.id!]), whole.id!, 'projects');
    expect(c2.action).toBe('review');
    expect(c2.reviewNote).toMatch(/more than one agreed contract/i);
  });

  it('a maintenance record that already holds a typed cost is a review (one source: typed cost OR a payment)', async () => {
    const d = fresh('r22h');
    await mkService(d, 'Northside Heating', '2026-11-05', { costCents: 22000 });
    const t = await addTxn(d, -22000, 'Northside Heating', '2026-11-06');
    const c = pick(await gather(d, [t.id!]), t.id!, 'assets');
    expect(c.action).toBe('review');
    expect(c.reviewNote).toMatch(/typed/i);
  });
});

describe('R2.2 reading writes nothing and changes no total', () => {
  it('gathering leaves every table byte-for-byte identical', async () => {
    const d = fresh('r22i');
    await mkBill(d);
    await mkVisit(d, "Rosa's Cleaning", '2026-11-10', 9000);
    await mkService(d, 'Northside Heating', '2026-11-05');
    await mkProject(d, 'Harbor Tile');
    const ids = [(await addTxn(d, -12000, 'Example Power Co', '2026-11-18')).id!, (await addTxn(d, -9000, "Rosa's Cleaning", '2026-11-12')).id!, (await addTxn(d, -50000, 'Harbor Tile', '2026-11-08')).id!];
    const before = await everything(d);
    const r = await gather(d, ids);
    expect(all(r).length).toBeGreaterThanOrEqual(3);
    expect(await everything(d)).toBe(before);
  });

  it('a payment already linked to a record (by any module) is not suggested again, and nothing is replaced', async () => {
    const d = fresh('r22j');
    const visitId = await mkVisit(d, "Rosa's Cleaning", '2026-11-10', 9000);
    await mkVisit(d, "Rosa's Cleaning", '2026-11-13', 9000);
    const t = await addTxn(d, -9000, "Rosa's Cleaning", '2026-11-12');
    expect(forTxn(await gather(d, [t.id!]), t.id!)).not.toHaveLength(0);
    await setVisitPayment(visitId, { source: 'finance', refs: [makeTxnRef(t)], manualCents: null }, null, d);
    expect(all(await gather(d, [t.id!]))).toEqual([]);
  });

  it('when "who already uses this payment" cannot be checked, nothing at all is suggested', async () => {
    const d = fresh('r22k');
    await mkVisit(d, "Rosa's Cleaning", '2026-11-10', 9000);
    const t = await addTxn(d, -9000, "Rosa's Cleaning", '2026-11-12');
    const r = await gatherSuggestions([t.id!], TODAY, d, { ...env, providers: [{ label: 'Broken', find: async () => { throw new Error('nope'); } }] });
    expect(r.checked).toBe(false);
    expect(r.groups).toEqual([]);
  });

  it('a module that fails is named and the others still answer', async () => {
    const d = fresh('r22l');
    await mkVisit(d, "Rosa's Cleaning", '2026-11-10', 9000);
    const t = await addTxn(d, -9000, "Rosa's Cleaning", '2026-11-12');
    const broken = { moduleId: 'bills', source: { label: 'Bills & Subscriptions', suggest: async () => { throw new Error('x'); }, accept: async () => ({ ok: false as const, message: '' }), reject: async () => undefined } };
    const r = await gatherSuggestions([t.id!], TODAY, d, { ...env, sources: [broken, ...env.sources.slice(1)] });
    expect(r.unavailable).toEqual(['Bills & Subscriptions']);
    expect(all(r).map((c) => c.moduleId)).toEqual(['services']);
  });
});

describe('R2.2 "Not a match" is for ONE pair, and stays', () => {
  it('a rejected visit stays out of the list; the same provider is still suggested for another payment; an edited payment is judged again', async () => {
    const d = fresh('r22m');
    await mkVisit(d, "Rosa's Cleaning", '2026-11-10', 9000);
    await mkVisit(d, "Rosa's Cleaning", '2026-10-12', 9000);
    const t1 = await addTxn(d, -9000, "Rosa's Cleaning", '2026-11-12');
    const t2 = await addTxn(d, -9000, "Rosa's Cleaning", '2026-10-14');
    const first = pick(await gather(d, [t1.id!, t2.id!]), t1.id!, 'services');
    await rejectCandidate(first, d, env);
    const after = await gather(d, [t1.id!, t2.id!]);
    expect(forTxn(after, t1.id!)).toEqual([]); // that pair stays dismissed ...
    expect(forTxn(after, t2.id!)).toHaveLength(1); // ... the provider is not blocked for another payment
    await d.txns.update(t1.id!, { date: '2026-11-13' }); // edited: a different payment may be a different match
    expect(forTxn(await gather(d, [t1.id!]), t1.id!)).toHaveLength(1);
  });

  it('a bill rejection is the SAME memory the Link-a-payment dialog uses, in both directions', async () => {
    const d = fresh('r22n');
    const { id } = await mkBill(d);
    const t = await addTxn(d, -12000, 'Example Power Co', '2026-11-18');
    const c = pick(await gather(d, [t.id!]), t.id!, 'bills');
    const undo = await rejectCandidate(c, d, env);
    expect(forTxn(await gather(d, [t.id!]), t.id!)).toEqual([]);
    const facts = (await loadCycles(d)).filter((x) => x.body?.fact === 'suggestion-reject');
    expect(facts).toHaveLength(1); // Bills' own fact, nothing new
    // the Link-a-payment dialog agrees: its list no longer offers it either
    const snap = await loadBillsSnapshot(d);
    const o = (await getObligation(id, d))!;
    const p = periodsOf(o, snap.cycles, TODAY, { from: OLD, to: '2027-12-31' }, { allRecorded: true, lookup: lookupOfMap(snap.financeTxns) }).find((x) => x.slot === 'm2026-11')!;
    expect((await loadSuggestions(o, p, TODAY, d)).suggestions).toEqual([]);
    // Undo brings it back
    await undo!();
    expect(forTxn(await gather(d, [t.id!]), t.id!)).toHaveLength(1);
  });

  it('writes one small settings row per pair for the modules with no memory of their own, and no table or schema change', async () => {
    const d = fresh('r22o');
    await mkVisit(d, "Rosa's Cleaning", '2026-11-10', 9000);
    const t = await addTxn(d, -9000, "Rosa's Cleaning", '2026-11-12');
    const tablesBefore = d.tables.map((x) => x.name).sort();
    await rejectCandidate(pick(await gather(d, [t.id!]), t.id!, 'services'), d, env);
    const rows = await d.settings.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0].key).toMatch(/^link-reject:services:\d+:visit:\d+$/);
    expect(d.tables.map((x) => x.name).sort()).toEqual(tablesBefore);
  });
});

describe('R2.2 Accept uses the module\'s own link operation, and Finance is left exactly as it was', () => {
  const live = async (d: FinanceDB, id: number) => { const { updatedAt: _u, ...rest } = (await d.txns.get(id)) as Txn & { updatedAt?: number }; void _u; return rest; };

  it('Bills: the link equals the one the Link-a-payment path makes, and the payment is untouched', async () => {
    const A = fresh('r22pa'), B = fresh('r22pb');
    const idA = (await mkBill(A)).id, idB = (await mkBill(B)).id;
    const tA = await addTxn(A, -12000, 'Example Power Co', '2026-11-18'), tB = await addTxn(B, -12000, 'Example Power Co', '2026-11-18');
    const before = await live(A, tA.id!);
    const res = await acceptCandidate(pick(await gather(A, [tA.id!]), tA.id!, 'bills'), A, TODAY, env);
    expect(res.ok).toBe(true);
    await recordFact({ obligationId: idB, slot: 'm2026-11', body: { fact: 'payment-link', ref: makeTxnRef(tB) }, op: newOp(), today: TODAY }, B);
    const shape = async (d: FinanceDB, oid: number) => (await loadCycles(d)).filter((c) => c.obligationId === oid).map((c) => ({ slot: c.slot, body: c.body }));
    const norm = (x: unknown) => JSON.stringify(x).replace(/"txnId":\d+/g, '"txnId":0');
    expect(norm(await shape(A, idA))).toBe(norm(await shape(B, idB)));
    expect(await live(A, tA.id!)).toEqual(before);
    // and it is not offered again
    expect(forTxn(await gather(A, [tA.id!]), tA.id!)).toEqual([]);
  });

  it('Services: the visit ends up exactly as the visit\'s own payment dialog would leave it', async () => {
    const A = fresh('r22qa'), B = fresh('r22qb');
    const vA = await mkVisit(A, "Rosa's Cleaning", '2026-11-10', 9000), vB = await mkVisit(B, "Rosa's Cleaning", '2026-11-10', 9000);
    const tA = await addTxn(A, -9000, "Rosa's Cleaning", '2026-11-12'), tB = await addTxn(B, -9000, "Rosa's Cleaning", '2026-11-12');
    const before = await live(A, tA.id!);
    expect((await acceptCandidate(pick(await gather(A, [tA.id!]), tA.id!, 'services'), A, TODAY, env)).ok).toBe(true);
    await setVisitPayment(vB, { source: 'finance', refs: [makeTxnRef(tB)], manualCents: null }, null, B);
    const data = async (d: FinanceDB, id: number) => JSON.stringify((await loadVisits(d)).find((v) => v.id === id)!.data).replace(/"txnId":\d+/g, '"txnId":0').replace(/"providerContactId":\d+/, '"providerContactId":0');
    expect(await data(A, vA)).toBe(await data(B, vB));
    expect(await live(A, tA.id!)).toEqual(before);
  });

  it('Home & Assets: the record gains the reference and keeps everything else; no typed cost is invented or removed', async () => {
    const d = fresh('r22r');
    const id = await mkService(d, 'Northside Heating', '2026-11-05', { notes: 'Filter replaced' });
    const t = await addTxn(d, -22000, 'Northside Heating', '2026-11-06');
    const before = await live(d, t.id!);
    const was = (await loadServices(d)).find((s) => s.id === id)!.data;
    expect((await acceptCandidate(pick(await gather(d, [t.id!]), t.id!, 'assets'), d, TODAY, env)).ok).toBe(true);
    const now = (await loadServices(d)).find((s) => s.id === id)!.data;
    expect(now.txnRefs.map((r) => r.txnId)).toEqual([t.id]);
    expect({ ...now, txnRefs: [] }).toEqual({ ...was, txnRefs: [] });
    expect(now.costCents).toBeNull();
    expect(await live(d, t.id!)).toEqual(before);
  });

  it('Projects: only the project tag is added to the payment (same as the transaction form); a single agreed contract is tagged too', async () => {
    const A = fresh('r22sa'), B = fresh('r22sb');
    const pA = await mkProject(A, 'Harbor Tile'), pB = await mkProject(B, 'Harbor Tile');
    const vendor = (await providerNamed(A, 'Harbor Tile')).contactId;
    const cA = (await createCommitment(pA, { title: 'Tile install', amountCents: 100000, status: 'accepted', parentId: null, budgetLineId: null, vendorContactId: vendor, acceptedDate: '2026-10-01', notes: '' }, A)).id;
    const vendorB = (await providerNamed(B, 'Harbor Tile')).contactId;
    const cB = (await createCommitment(pB, { title: 'Tile install', amountCents: 100000, status: 'accepted', parentId: null, budgetLineId: null, vendorContactId: vendorB, acceptedDate: '2026-10-01', notes: '' }, B)).id;
    const tA = await addTxn(A, -50000, 'Harbor Tile', '2026-11-08'), tB = await addTxn(B, -50000, 'Harbor Tile', '2026-11-08');
    const before = await live(A, tA.id!);
    expect((await acceptCandidate(pick(await gather(A, [tA.id!]), tA.id!, 'projects'), A, TODAY, env)).ok).toBe(true);
    await setTxnProject(B, tB.id!, { projectId: pB, commitmentId: cB });
    const a = await live(A, tA.id!), b = await live(B, tB.id!);
    expect(a.project).toEqual({ projectId: pA, commitmentId: cA });
    expect({ ...a, project: undefined, accountId: 0 }).toEqual({ ...before, project: undefined, accountId: 0 }); // amount, payee, date, splits, status unchanged
    expect(a.project?.commitmentId).toBeDefined();
    expect(b.project?.commitmentId).toBeDefined();
  });
});

describe('R2.2 Accept re-checks first: a stale or already-linked suggestion cannot become a link', () => {
  it('the payment changed after Ledger looked: refused, nothing written', async () => {
    const d = fresh('r22t');
    await mkVisit(d, "Rosa's Cleaning", '2026-11-10', 9000);
    const t = await addTxn(d, -9000, "Rosa's Cleaning", '2026-11-12');
    const c = pick(await gather(d, [t.id!]), t.id!, 'services');
    await d.txns.update(t.id!, { payee: 'Someone Else' });
    const before = await everything(d);
    const r = await acceptCandidate(c, d, TODAY, env);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/changed/i);
    expect(await everything(d)).toBe(before);
  });

  it('the payment was linked elsewhere in the meantime: refused, nothing replaced', async () => {
    const d = fresh('r22u');
    await mkVisit(d, "Rosa's Cleaning", '2026-11-10', 9000);
    const t = await addTxn(d, -9000, "Rosa's Cleaning", '2026-11-12');
    const c = pick(await gather(d, [t.id!]), t.id!, 'services');
    expect(c.action).toBe('accept'); // the only match when it was looked at
    // ... then the owner links the same payment to a bill by hand, before pressing Accept
    const { id: billId } = await mkBill(d, { title: "Rosa's Cleaning", providerNameSnapshot: "Rosa's Cleaning", prices: [{ from: OLD, cents: 9000, label: '' }], schedule: monthly(12, '2026-01') });
    await recordFact({ obligationId: billId, slot: 'm2026-11', body: { fact: 'payment-link', ref: makeTxnRef(t) }, op: newOp(), today: TODAY }, d);
    const before = await everything(d);
    const r = await acceptCandidate(c, d, TODAY, env);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/already linked/i);
    expect(await everything(d)).toBe(before);
  });

  it('the record changed after Ledger looked (visit edited, record given a typed cost, bill given a typed payment): refused', async () => {
    const d = fresh('r22v');
    await mkVisit(d, "Rosa's Cleaning", '2026-11-10', 9000);
    const sid = await mkService(d, 'Northside Heating', '2026-11-05');
    const t1 = await addTxn(d, -9000, "Rosa's Cleaning", '2026-11-12'), t2 = await addTxn(d, -22000, 'Northside Heating', '2026-11-06');
    const r0 = await gather(d, [t1.id!, t2.id!]);
    const cv = pick(r0, t1.id!, 'services'), cs = pick(r0, t2.id!, 'assets');
    const v = (await loadVisits(d))[0];
    await d.moduleRecords.update(v.id, { data: { ...v.data, notes: 'edited' } });
    const s = (await loadServices(d)).find((x) => x.id === sid)!;
    await updateService(sid, { ...s.data, costCents: 21000 }, d, TODAY);
    const before = await everything(d);
    expect((await acceptCandidate(cv, d, TODAY, env)).ok).toBe(false);
    expect((await acceptCandidate(cs, d, TODAY, env)).ok).toBe(false);
    expect(await everything(d)).toBe(before);
  });

  it('a "review" candidate can never be accepted from the list', async () => {
    const d = fresh('r22w');
    await mkVisit(d, "Rosa's Cleaning", '2026-11-03', null);
    await mkVisit(d, "Rosa's Cleaning", '2026-11-10', null);
    const t = await addTxn(d, -18000, "Rosa's Cleaning", '2026-11-12');
    const c = forTxn(await gather(d, [t.id!]), t.id!)[0];
    const before = await everything(d);
    const r = await acceptCandidate(c, d, TODAY, env);
    expect(r.ok).toBe(false);
    expect(await everything(d)).toBe(before);
  });
});

describe('R2.2 modules register the hook', () => {
  it('Bills, Household Services, Home & Assets and Projects each contribute paymentSuggestions; Ledger (Finance) does not', async () => {
    const [b, s, a, p, l] = await Promise.all([import('../modules/bills'), import('../modules/services'), import('../modules/assets'), import('../modules/projects'), import('../modules/ledger')]);
    for (const m of [b.billsModule, s.servicesModule, a.assetsModule, p.projectsModule]) expect(typeof m.contributes?.paymentSuggestions?.suggest).toBe('function');
    expect(l.ledgerModule.contributes?.paymentSuggestions).toBeUndefined();
    void loadObligations;
  });
});

describe('R2.2 a vendor name alone is not enough to tag a payment to a project', () => {
  it('a project with no dates and no agreed contract with that vendor gives a review, not an accept', async () => {
    const d = fresh('r22x');
    await mkProject(d, 'Harbor Tile', { startDate: null, targetDate: null });
    const t = await addTxn(d, -50000, 'Harbor Tile', '2026-11-08');
    const c = pick(await gather(d, [t.id!]), t.id!, 'projects');
    expect(c.action).toBe('review');
    expect(c.reviewNote).toMatch(/only the vendor/i);
  });

  it('a payment dated long before the project started is not suggested', async () => {
    const d = fresh('r22y');
    await mkProject(d, 'Harbor Tile', { startDate: '2026-10-01', targetDate: '2027-02-28' });
    const t = await addTxn(d, -50000, 'Harbor Tile', '2026-06-01');
    expect(all(await gather(d, [t.id!]))).toEqual([]);
  });
});

describe('R2.2 an imported payment that was linked: Undo import is warned and guarded by the existing deletion check', () => {
  it('the deletion plan for the batch names the record that now points at the imported payment', async () => {
    const { planTxnDeletion } = await import('../lib/txnDeletion');
    const d = fresh('r22z');
    await mkVisit(d, "Rosa's Cleaning", '2026-11-10', 9000);
    const batch = (await d.importBatches.add({ accountId: await account(d), filename: 'bank.csv', importedAt: '2026-11-16T10:00:00Z', createdCount: 1, matched: [] })) as number;
    const t = await addTxn(d, -9000, "Rosa's Cleaning", '2026-11-12', { importBatchId: batch });
    expect((await acceptCandidate(pick(await gather(d, [t.id!]), t.id!, 'services'), d, TODAY, env)).ok).toBe(true);
    const ids = (await d.txns.where('importBatchId').equals(batch).primaryKeys()) as number[];
    const plan = await planTxnDeletion(d, ids, env.providers);
    expect(plan.verified).toBe(true);
    expect(plan.evidenceRecords).toBe(1);
    expect(plan.dependents.map((x) => x.module)).toEqual(['services']);
  });
});

describe('R2.2 guards: local only, nothing logged, no write path of its own', () => {
  const FILES = ['core/paymentSuggestions.ts', 'shell/PossibleMatches.tsx', 'modules/bills/paymentSuggest.ts', 'modules/services/paymentSuggest.ts', 'modules/assets/paymentSuggest.ts', 'modules/projects/paymentSuggest.ts'];
  const code = (f: string) => readFileSync(`src/${f}`, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  it('no network, no console, no storage, no timer, no model, in any new file', () => {
    for (const f of FILES) {
      expect(/\b(fetch|XMLHttpRequest|sendBeacon|WebSocket|EventSource|setInterval|setTimeout)\b|console\.|localStorage|sessionStorage|indexedDB|anthropic|openai/i.test(code(f).replace(/loadHideAmounts/g, '')), f).toBe(false);
    }
  });
  it('no new file writes a Finance transaction, a household record or a link directly: writes go through the owning module (the shell\'s one write is the small "Not a match" settings row)', () => {
    for (const f of FILES) {
      expect(/\.(txns|moduleRecords|links|accounts|recurring)\s*\.\s*(add|put|update|delete|bulkAdd|bulkPut|bulkDelete|clear|modify)\b/.test(code(f)), f).toBe(false);
    }
    const shellWrites = [...code('core/paymentSuggestions.ts').matchAll(/\.settings\s*\.\s*(add|put|update|delete|bulkPut|bulkDelete)\b/g)].map((m) => m[1]).sort();
    expect(shellWrites).toEqual(['delete', 'put', 'put']);
  });
  it('Finance does not import any household module for this (the shell file and Finance files never name a module)', () => {
    expect(/from '\.\.\/modules\//.test(code('core/paymentSuggestions.ts'))).toBe(false);
    expect(/from '\.\.\/modules\//.test(code('shell/PossibleMatches.tsx'))).toBe(false);
  });
  it('no reason or screen text carries a percentage, a score or a "confidence"', () => {
    for (const f of FILES) expect(/confidence|\d\s*%|percent|score/i.test(code(f)), f).toBe(false);
  });
});
