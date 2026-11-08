import { describe, expect, it } from 'vitest';
import type { Txn } from '../../types';
import { householdSpend, type HouseholdInput } from '../services/householdSpend';
import { billsCostRecords, billsRecordedPayments } from '../bills/billsSpend';
import { inv, obRec, paidOut } from '../bills/billsTestkit';
import type { CycleRecord } from '../bills/cycleModel';
import type { ObligationRecord } from '../bills/model';
import { recordedAcrossModules, type AcrossInput } from './unionSpend';
import { asset, arrangement, billFact, billLink, lk, R, split, txn, visit, work } from './householdTestkit';

/**
 * B5 recorded spending across Bills, Household Services and Home & Assets. Expected numbers are worked out by hand, or by the small ORACLE below, which reads raw
 * transactions directly and shares no code with `spend()` / `resolveRef` / `pieceKey`. Everything is invented. Finance outflows are negative cents.
 */
interface World { assets?: ReturnType<typeof asset>[]; services?: ReturnType<typeof work>[]; arrangements?: ReturnType<typeof arrangement>[]; visits?: ReturnType<typeof visit>[]; pairs?: HouseholdInput['pairs']; obligations?: ObligationRecord[]; cycles?: CycleRecord[]; serviceLinks?: Map<number, number[]> }
const input = (w: World): AcrossInput => ({
  household: { assets: w.assets ?? [asset(1)], homeServices: w.services ?? [], arrangements: w.arrangements ?? [arrangement(1)], visits: w.visits ?? [], pairs: w.pairs ?? [] },
  obligations: w.obligations ?? [obRec(1, { title: 'Cleaning service', type: 'housing' })], cycles: w.cycles ?? [], serviceLinks: w.serviceLinks,
});
const across = (w: World, ...ts: Txn[]) => recordedAcrossModules(input(w), lk(...ts));
const sum = (xs: number[]) => xs.reduce((n, x) => n + x, 0);

/** Every invariant that must hold for EVERY world. */
function invariants(r: ReturnType<typeof across>) {
  expect(r.totalCents).toBe(r.financeCents + r.typedCents);
  expect(sum(r.pieces.map((p) => p.cents))).toBe(r.financeCents);
  expect(sum(r.typed.filter((t) => t.authoritative).map((t) => t.cents))).toBe(r.typedCents);
  expect(sum(Object.values(r.byAttribution))).toBe(r.totalCents); // the additive breakdown adds to the total EXACTLY
  expect(sum(r.byCategory.map((c) => c.cents))).toBe(r.totalCents);
  expect(r.paidOutCents - r.moneyBackCents).toBe(r.financeCents);
  expect(sum(Object.values(r.statusCents))).toBe(r.financeCents);
  expect(r.proof.reconciles).toBe(true);
  expect(r.reconciliation.explainsDifference).toBe(true);
  expect(new Set(r.pieces.map((p) => p.key)).size).toBe(r.pieces.length); // every piece once
  for (const p of r.pieces) { expect(p.associations.length).toBeGreaterThan(0); expect(p.why.length).toBeGreaterThan(0); }
  // privacy: nothing the data layer writes in words contains an amount (Hide Amounts has nothing to hide in the explanations)
  const words = [...r.pieces.map((p) => p.why), ...r.typed.map((t) => t.note), ...r.review.map((x) => x.text), ...r.caveats].join(' ');
  expect(words).not.toMatch(/\$/);
}

describe('B5 union: the mandatory $150.00 case across all three modules', () => {
  const t = txn(1, -15000, { date: '2026-03-10' });
  const world: World = {
    arrangements: [arrangement(1, { title: 'House cleaning' })], visits: [visit(1, { title: 'Cleaning, 10 March', txnRefs: [R(t)] })],
    obligations: [obRec(1, { title: 'Cleaning service', type: 'housing' })], cycles: [billLink(1, 'm2026-03', t)],
    assets: [asset(1, { name: 'House' })], services: [work(1, 1, { title: 'Deep clean before listing', txnRefs: [R(t)] })],
  };

  it('is counted ONCE: the Finance-backed total is $150.00, not $300.00 or $450.00', () => {
    const r = across(world, t);
    expect(r.financeCents).toBe(15000);
    expect(r.totalCents).toBe(15000);
    expect(r.pieces).toHaveLength(1);
    invariants(r);
  });

  it('shows all three associations, credits the payment to "shared" (not to a module by list order), and keeps each module\'s own page-total', () => {
    const r = across(world, t);
    const p = r.pieces[0];
    expect(p.associations.map((a) => `${a.module}:${a.recordId}`)).toEqual(['bills:bill:1:m2026-03', 'services:visit:1', 'home:service:1']);
    expect(p.modules).toEqual(['bills', 'services', 'home']);
    expect([p.sharedAcrossModules, p.attribution, p.category]).toEqual([true, 'shared', 'Shared between modules']);
    expect(r.byAttribution).toEqual({ bills: 0, services: 0, home: 0, shared: 15000 });
    expect(r.moduleOwnCents).toEqual({ bills: 15000, services: 15000, home: 15000 });
  });

  it('explains exactly why the three module pages add to $450.00 and the household says $150.00', () => {
    const r = across(world, t);
    expect(r.reconciliation).toMatchObject({ simpleSumCents: 45000, differenceCents: 30000, withinServicesHomeCents: 15000, alsoInBillsCents: 15000, coveredAcrossBillsCents: 0, explainsDifference: true });
    expect(r.review.filter((x) => x.kind === 'shared-across')).toHaveLength(1);
    expect(r.review.find((x) => x.kind === 'shared-across')!.class).toBe('informational'); // sharing is not a mistake
  });

  it('reads the existing readers without changing them: each still reports its own figure', () => {
    const r = across(world, t);
    expect(r.parts.household.totalCents).toBe(householdSpend(input(world).household, lk(t)).totalCents);
    expect(r.parts.bills.totalCents).toBe(billsRecordedPayments(billsCostRecords(input(world).obligations, input(world).cycles), lk(t)).totalCents);
  });
});

describe('B5 union: whole and split pieces across modules', () => {
  const s = txn(2, -10000, { splits: [split(3000), split(7000, 6)] });

  it('a whole in Bills and a part in Services: the whole counts ($100.00), the part is covered; the association is kept on the whole', () => {
    const r = across({ cycles: [billLink(1, 'm2026-03', s)], visits: [visit(1, { txnRefs: [R(s, 0)] })] }, s);
    expect(r.totalCents).toBe(10000);
    expect(r.pieces.map((p) => p.key)).toEqual(['2:w']);
    expect(r.pieces[0].associations.map((a) => `${a.recordId}:${a.via}`)).toEqual(['bill:1:m2026-03:reference', 'visit:1:covered-part']);
    expect(r.reconciliation).toMatchObject({ simpleSumCents: 13000, differenceCents: 3000, coveredAcrossBillsCents: 3000, alsoInBillsCents: 0 });
    expect(r.review.map((x) => x.kind)).toContain('whole-and-part');
    invariants(r);
  });

  it('parts in Bills under a whole in Home & Assets: the same rule in the other direction', () => {
    const r = across({ cycles: [billLink(1, 'm2026-03', s, 1)], services: [work(1, 1, { txnRefs: [R(s)] })] }, s);
    expect(r.totalCents).toBe(10000);
    expect(r.reconciliation).toMatchObject({ simpleSumCents: 17000, differenceCents: 7000, coveredAcrossBillsCents: 7000 });
    invariants(r);
  });

  it('different split parts in different modules are distinct pieces and each counts once ($30.00 + $70.00)', () => {
    const r = across({ cycles: [billLink(1, 'm2026-03', s, 0)], visits: [visit(1, { txnRefs: [R(s, 1)] })] }, s);
    expect(r.totalCents).toBe(10000);
    expect(r.pieces.map((p) => [p.key, p.attribution])).toEqual([['2:0', 'bills'], ['2:1', 'services']]);
    expect(r.reconciliation.differenceCents).toBe(0);
    invariants(r);
  });

  it('the same part in two modules is one piece ($30.00)', () => {
    const r = across({ cycles: [billLink(1, 'm2026-03', s, 0)], visits: [visit(1, { txnRefs: [R(s, 0)] })] }, s);
    expect(r.totalCents).toBe(3000);
    expect(r.pieces[0].attribution).toBe('shared');
    invariants(r);
  });
});

describe('B5 union: separate payments, refunds, typed amounts', () => {
  it('two legitimate payments from one provider both count: $100.00 + $120.00', () => {
    const a = txn(3, -10000, { date: '2026-02-10' }), b = txn(4, -12000, { date: '2026-03-10' });
    const r = across({ visits: [visit(1, { txnRefs: [R(a)] })], cycles: [billLink(1, 'm2026-03', b)] }, a, b);
    expect(r.totalCents).toBe(22000);
    expect(r.pieces.map((p) => p.attribution)).toEqual(['services', 'bills']);
    invariants(r);
  });

  it('a partial refund lowers the net once: $150.00 paid (linked from two modules), $40.00 back = $110.00', () => {
    const pay = txn(5, -15000), back = txn(6, 4000, { date: '2026-03-20' });
    const r = across({ visits: [visit(1, { txnRefs: [R(pay)] })], cycles: [billLink(1, 'm2026-03', pay), billLink(1, 'm2026-03', back)] }, pay, back);
    expect([r.totalCents, r.paidOutCents, r.moneyBackCents]).toEqual([11000, 15000, 4000]);
    invariants(r);
  });

  it('a full refund brings the net to $0.00; a refund alone is minus $40.00 (never hidden)', () => {
    const pay = txn(7, -15000), back = txn(8, 15000, { date: '2026-03-20' }), only = txn(9, 4000, { date: '2026-03-21' });
    expect(across({ cycles: [billLink(1, 'm2026-03', pay), billLink(1, 'm2026-03', back)] }, pay, back).totalCents).toBe(0);
    expect(across({ services: [work(1, 1, { txnRefs: [R(only)] })] }, only).totalCents).toBe(-4000);
  });

  it('two independent outside-Finance payments of identical amounts all count: $50.00 in each of three modules = $150.00 (never matched by value)', () => {
    const r = across({ visits: [visit(1, { paidManualCents: 5000 })], services: [work(1, 1, { costCents: 5000 })], cycles: [billFact(1, 'm2026-03', paidOut('2026-03-10', 5000))] });
    expect(r.totalCents).toBe(15000);
    expect(r.typedCents).toBe(15000);
    expect(r.byAttribution).toMatchObject({ bills: 5000, services: 5000, home: 5000, shared: 0 });
    expect(r.review.filter((x) => x.class === 'possible-duplicate')).toEqual([]);
    invariants(r);
  });

  it('a Finance-linked Bills payment and a typed Services payment with the same amount, close dates and the same provider are a POSSIBLE duplicate: both stay counted and the figure is not called reconciled', () => {
    const t = txn(10, -12000, { date: '2026-03-10' });
    const w: World = { obligations: [obRec(1, { title: 'Cleaning service', type: 'housing', providerContactId: 7 })], cycles: [billLink(1, 'm2026-03', t)], visits: [visit(1, { providerContactId: 7, paidManualCents: 12000, date: '2026-03-12' })] };
    const r = across(w, t);
    expect(r.totalCents).toBe(24000);
    const maybe = r.review.filter((x) => x.kind === 'possible-duplicate');
    expect(maybe).toHaveLength(1);
    expect(maybe[0].class).toBe('possible-duplicate');
    expect(r.reconciled).toBe(false);
    expect(r.caveats.join(' ')).toMatch(/recorded twice/);
    invariants(r);
  });

  it('the same amount and date but NO provider or link evidence is not even a hint (and nothing is removed either way)', () => {
    const t = txn(11, -12000, { date: '2026-03-10' });
    const r = across({ obligations: [obRec(1, { title: 'Cleaning service', type: 'housing', providerContactId: 7 })], cycles: [billLink(1, 'm2026-03', t)], visits: [visit(1, { providerContactId: 8, paidManualCents: 12000, date: '2026-03-10' })] }, t);
    expect(r.totalCents).toBe(24000);
    expect(r.review.filter((x) => x.kind === 'possible-duplicate')).toEqual([]);
  });

  it('an explicit "bills for" link counts as the relationship evidence for a possible duplicate', () => {
    const t = txn(12, -12000, { date: '2026-03-10' });
    const w: World = { cycles: [billLink(1, 'm2026-03', t)], visits: [visit(1, { arrangementId: 1, providerContactId: null, paidManualCents: 12000, date: '2026-03-11' })], serviceLinks: new Map([[1, [1]]]) };
    expect(across(w, t).review.filter((x) => x.kind === 'possible-duplicate')).toHaveLength(1);
  });

  it('the same linked job in Services and Home & Assets (S4 recorded-as): the typed $120.00 counts once and is reported as already handled', () => {
    const r = across({ visits: [visit(1, { paidManualCents: 12000 })], services: [work(1, 1, { costCents: 12000 })], pairs: [{ visitId: 1, serviceId: 1 }] });
    expect(r.totalCents).toBe(12000);
    expect(r.typed.filter((x) => !x.authoritative)).toHaveLength(1);
    invariants(r);
  });
});

describe('B5 union: what is NOT counted, and what Finance words never change', () => {
  it('a Finance transaction that no record references counts nothing, even a pending one posted from a scheduled item (the union reads no scheduled-item table)', () => {
    const pending = txn(50, -9900, { status: 'pending' });
    const r = across({ visits: [visit(1)], services: [work(1, 1)] }, pending);
    expect([r.totalCents, r.pieces.length]).toEqual([0, 0]);
  });

  it('pending, cleared and reconciled never change a number: the same payment linked from two modules totals $120.00 in each state, and the status word is shown beside it', () => {
    const totals = (['pending', 'cleared', 'reconciled'] as const).map((status) => {
      const t = txn(51, -12000, { status });
      const r = across({ visits: [visit(1, { txnRefs: [R(t)] })], cycles: [billLink(1, 'm2026-03', t)] }, t);
      expect(r.pieces[0].status).toBe(status);
      return r.totalCents;
    });
    expect(totals).toEqual([12000, 12000, 12000]);
  });

  it('a piece Finance also tags to a Project is counted once as a recorded payment; no Project money is read or added', () => {
    const t = txn(52, -15000, { project: { projectId: 7 } } as Partial<Txn>);
    const r = across({ visits: [visit(1, { txnRefs: [R(t)] })], cycles: [billLink(1, 'm2026-03', t)] }, t);
    expect(r.totalCents).toBe(15000);
    expect(JSON.stringify(Object.keys(r))).not.toMatch(/project/i);
  });
});

describe('B5 union: stale, deleted and restructured references', () => {
  it('a transaction deleted after linking counts nothing in every module and is listed once per record', () => {
    const gone = txn(13, -9000);
    const r = across({ visits: [visit(1, { txnRefs: [R(gone)] })], cycles: [billLink(1, 'm2026-03', gone)] });
    expect(r.totalCents).toBe(0);
    expect(r.review.filter((x) => x.kind === 'stale')).toHaveLength(2);
    expect(r.reconciled).toBe(false);
    invariants(r);
  });

  it('a split restructured after linking counts nothing and asks for review (the snapshot is never an amount)', () => {
    const linked = txn(14, -10000, { splits: [split(3000), split(7000, 6)] });
    const live = { ...linked, splits: [split(7000, 6), split(3000)] };
    const r = across({ cycles: [billLink(1, 'm2026-03', linked, 0)] }, live);
    expect(r.totalCents).toBe(0);
    expect(r.review.map((x) => x.kind)).toEqual(['stale']);
  });

  it('stale in one module and valid in another: the piece counts through the valid one and the stale one is still listed', () => {
    const original = txn(15, -10000, { splits: [split(3000), split(7000, 6)] });
    const live = { ...original, splits: [split(7000, 6), split(3000)] }; // part 0 is now the $70.00 part
    const r = across({ visits: [visit(1, { txnRefs: [R(original, 0)] })], cycles: [billLink(1, 'm2026-03', live, 0)] }, live);
    expect(r.totalCents).toBe(7000);
    expect(r.pieces.map((p) => [p.key, p.associations.map((a) => a.module)])).toEqual([['15:0', ['bills']]]);
    expect(r.review.find((x) => x.kind === 'stale')!.text).toMatch(/counted through another record/);
  });

  it('a changed Finance amount uses the live amount everywhere: linked at $100.00, now $125.00', () => {
    const linked = txn(16, -10000), live = { ...linked, amountCents: -12500 };
    const r = across({ visits: [visit(1, { txnRefs: [R(linked)] })], cycles: [billLink(1, 'm2026-03', linked)] }, live);
    expect(r.totalCents).toBe(12500);
    expect(r.pieces[0].changed).toBe(true);
  });
});

describe('B5 union: Bills lifecycle and typed rules are preserved', () => {
  it('historical payments on an ENDED subscription stay in recorded spending', () => {
    const ended = obRec(2, { title: 'Streamly', type: 'subscription', status: 'ended', endedOn: '2026-06-30', endReason: 'cancelled' });
    const ts = [1, 2, 3].map((i) => txn(20 + i, -1549, { date: `2026-0${i + 1}-15` }));
    const r = across({ obligations: [ended], cycles: ts.map((t, i) => billLink(2, `m2026-0${i + 2}`, t)) }, ...ts);
    expect(r.totalCents).toBe(4647);
    expect(r.byAttribution.bills).toBe(4647);
    invariants(r);
  });

  it('a typed amount beside a Finance link in one period is kept but set aside; a missing Finance link does not make the typed amount count again', () => {
    const t = txn(30, -12000);
    const both = across({ cycles: [billFact(1, 'm2026-03', paidOut('2026-03-09', 12000)), billLink(1, 'm2026-03', t)] }, t);
    expect([both.totalCents, both.typedCents, both.typed.filter((x) => !x.authoritative).length]).toEqual([12000, 0, 1]);
    const gone = across({ cycles: [billFact(1, 'm2026-03', paidOut('2026-03-09', 12000)), billLink(1, 'm2026-03', txn(31, -12000))] });
    expect([gone.totalCents, gone.typedCents]).toEqual([0, 0]);
    expect(gone.reconciled).toBe(false);
  });

  it('a typed payment with NO amount is unknown (listed, never zero, never counted); two different typed amounts are disputed (counted as neither)', () => {
    const unknown = across({ cycles: [billFact(1, 'm2026-03', paidOut('2026-03-09', null))] });
    expect([unknown.totalCents, unknown.unknown.billsAmountUnknown]).toEqual([0, 1]);
    expect(unknown.review.map((x) => x.kind)).toEqual(['amount-unknown']);
    expect(unknown.reconciled).toBe(false);
    const disputed = across({ cycles: [billFact(1, 'm2026-03', paidOut('2026-03-09', 5000)), billFact(1, 'm2026-03', paidOut('2026-03-10', 6000))] });
    expect([disputed.totalCents, disputed.unknown.billsTypedDisputed]).toEqual([0, 1]);
  });

  it('an invoice, an expected amount and a credit are never recorded spending', () => {
    const r = across({ cycles: [billFact(1, 'm2026-03', inv(12000))] });
    expect(r.totalCents).toBe(0);
    expect(r.pieces).toEqual([]);
    expect(r.reconciled).toBe(true);
  });

  it('a completed Services visit with no payment is unknown, not zero and not unpaid', () => {
    const r = across({ visits: [visit(1)] });
    expect([r.totalCents, r.unknown.completedVisits]).toEqual([0, 1]);
  });
});

describe('B5 union: empty household, periods, and agreement with the existing readers', () => {
  it('an empty household is all zeros, reconciled, and has nothing to review', () => {
    const r = across({ arrangements: [], assets: [], obligations: [] });
    expect([r.totalCents, r.pieces.length, r.typed.length, r.review.length, r.reconciled]).toEqual([0, 0, 0, 0, true]);
    invariants(r);
  });

  it('with no Bills records the union equals Household Services + Home & Assets on every figure (S5 is not redefined)', () => {
    const t = txn(40, -8000), u = txn(41, -2000);
    const w: World = { obligations: [], visits: [visit(1, { txnRefs: [R(t)], paidManualCents: null }), visit(2, { paidManualCents: 1500, date: '2026-03-11' })], services: [work(1, 1, { txnRefs: [R(t), R(u)] })] };
    const r = across(w, t, u);
    const s5 = householdSpend(input(w).household, lk(t, u));
    expect([r.totalCents, r.financeCents, r.typedCents]).toEqual([s5.totalCents, s5.financeCents, s5.typedCents]);
    expect([r.moduleOwnCents.services, r.moduleOwnCents.home, r.moduleOwnCents.bills]).toEqual([s5.servicesCents, s5.homeCents, 0]);
    expect(r.reconciliation.differenceCents).toBe(s5.reconciliation.differenceCents);
  });

  it('a period narrows Finance references by the LIVE transaction day and typed amounts by their own day, in every module', () => {
    const a = txn(42, -10000, { date: '2026-03-10' }), b = txn(43, -4000, { date: '2025-12-01' });
    const w: World = { visits: [visit(1, { txnRefs: [R(a)] })], cycles: [billLink(1, 'm2025-12', b), billLink(1, 'm2026-03', a), billFact(2, 'm2026-04', paidOut('2026-04-02', 700)), billFact(2, 'm2025-11', paidOut('2025-11-02', 900))], obligations: [obRec(1), obRec(2, { title: 'Phone', type: 'telecom' })] };
    const year = recordedAcrossModules(input(w), lk(a, b), { from: '2026-01-01', to: '2026-12-31' });
    expect(year.totalCents).toBe(10000 + 700);
    expect(recordedAcrossModules(input(w), lk(a, b)).totalCents).toBe(10000 + 4000 + 700 + 900);
    invariants(year);
  });

  it('record order never changes the total, the pieces or their associations', () => {
    const a = txn(44, -5000), b = txn(45, -7000, { splits: [split(2000), split(5000, 6)] });
    const w: World = { visits: [visit(1, { txnRefs: [R(a)] }), visit(2, { txnRefs: [R(b, 0)], date: '2026-03-12' })], services: [work(1, 1, { txnRefs: [R(b)] }), work(2, 1, { txnRefs: [R(a)], date: '2026-03-14' })], cycles: [billLink(1, 'm2026-03', a), billLink(1, 'm2026-04', b, 1)] };
    const fwd = across(w, a, b);
    const rev = across({ ...w, visits: [...w.visits!].reverse(), services: [...w.services!].reverse(), cycles: [...w.cycles!].reverse() }, b, a);
    expect(fwd.totalCents).toBe(rev.totalCents);
    expect(JSON.stringify(fwd.pieces)).toBe(JSON.stringify(rev.pieces));
    expect(JSON.stringify(fwd.review)).toBe(JSON.stringify(rev.review));
    invariants(fwd);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
// The independent oracle and 300 seeded random households.
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
/** Deterministic PRNG (mulberry32) so a failure names a seed that reproduces it. */
const prng = (seed: number) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

interface Claim { txnId: number; part?: number }
/** The oracle: raw transactions only. Whole covers its parts everywhere; every other piece once; refunds are positive transactions. Typed amounts are added as they are. */
function oracle(txns: Txn[], claims: Claim[], typed: number[]): number {
  const byId = new Map(txns.map((t) => [t.id!, t]));
  const live = claims.filter((c) => byId.has(c.txnId));
  const wholes = new Set(live.filter((c) => c.part === undefined).map((c) => c.txnId));
  const seen = new Set<string>();
  let total = 0;
  for (const c of live) {
    const k = `${c.txnId}:${c.part ?? 'w'}`;
    if (seen.has(k) || (c.part !== undefined && wholes.has(c.txnId))) continue;
    seen.add(k);
    const t = byId.get(c.txnId)!;
    total += c.part === undefined ? -t.amountCents : -t.splits![c.part].amountCents;
  }
  return total + sum(typed);
}

function randomWorld(seed: number) {
  const rnd = prng(seed);
  const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
  const txns: Txn[] = [];
  for (let id = 1; id <= 8; id++) {
    const out = pick([-1000, -2500, -4000, -9000, -12000]);
    if (rnd() < 0.25) txns.push(txn(id, pick([500, 1500]), { date: '2026-03-20' })); // a refund
    else if (rnd() < 0.5) { const a = Math.round(-out * 0.3 / 100) * 100; txns.push(txn(id, out, { splits: [split(a), split(-out - a, 6)] })); } // a split transaction
    else txns.push(txn(id, out));
  }
  const claims: Claim[] = [];
  const typed: number[] = [];
  const refsFor = (): Claim[] => {
    const n = Math.floor(rnd() * 3);
    const out: Claim[] = [];
    for (let i = 0; i < n; i++) { const t = pick(txns); out.push(t.splits && rnd() < 0.5 ? { txnId: t.id!, part: Math.floor(rnd() * 2) } : { txnId: t.id! }); }
    return out;
  };
  const toRefs = (cs: Claim[]) => cs.map((c) => R(txns.find((t) => t.id === c.txnId)!, c.part));
  const visits: ReturnType<typeof visit>[] = [], services: ReturnType<typeof work>[] = [], cycles: CycleRecord[] = [];
  const nv = 1 + Math.floor(rnd() * 4), ns = Math.floor(rnd() * 4), nb = Math.floor(rnd() * 5);
  for (let i = 1; i <= nv; i++) {
    const cs = refsFor();
    // a typed amount only where there is no reference (a record holds one source)
    const typedC = cs.length === 0 && rnd() < 0.5 ? pick([1100, 2300, 3700]) : null;
    claims.push(...cs); if (typedC) typed.push(typedC);
    visits.push(visit(i, { txnRefs: toRefs(cs), paidManualCents: typedC, date: `2026-03-${10 + i}` }));
  }
  for (let i = 1; i <= ns; i++) {
    const cs = refsFor();
    const typedC = cs.length === 0 && rnd() < 0.5 ? pick([1300, 2900]) : null;
    claims.push(...cs); if (typedC) typed.push(typedC);
    services.push(work(i, 1, { txnRefs: toRefs(cs), costCents: typedC, date: `2026-04-${10 + i}` }));
  }
  for (let i = 1; i <= nb; i++) {
    const slot = `m2026-0${((i - 1) % 4) + 1}`, ob = 1 + (i % 2);
    const cs = refsFor();
    if (cs.length) { claims.push(...cs); cs.forEach((c) => cycles.push(billLink(ob, slot, txns.find((t) => t.id === c.txnId)!, c.part))); }
    else if (rnd() < 0.5) { const c = pick([1700, 2100]); typed.push(c); cycles.push(billFact(ob, slot, paidOut('2026-03-05', c))); }
  }
  return { txns, claims, typed, w: { visits, services, cycles, obligations: [obRec(1, { title: 'Power', type: 'utility' }), obRec(2, { title: 'Phone', type: 'telecom' })] } as World };
}

describe('B5 union: 300 seeded random households agree with the independent oracle, in any record order', () => {
  it('total, finance and typed equal the oracle; every piece is counted once; the breakdowns add up; order never matters', () => {
    const seen = { sharedAcross: 0, coveredAcross: 0, refunds: 0, typed: 0, threeModules: 0, negativeTotal: 0 };
    for (let seed = 1; seed <= 300; seed++) {
      const { txns, claims, typed, w } = randomWorld(seed);
      const r = recordedAcrossModules(input(w), lk(...txns));
      // the generator gives each billing period EITHER links OR one typed amount, so the oracle's typed list is exactly what must be added
      const want = oracle(txns, claims, typed);
      expect(r.totalCents, `seed ${seed}`).toBe(want);
      invariants(r);
      if (r.pieces.some((p) => p.sharedAcrossModules)) seen.sharedAcross++;
      if (r.reconciliation.coveredAcrossBillsCents !== 0) seen.coveredAcross++;
      if (r.moneyBackCents > 0) seen.refunds++;
      if (r.typedCents > 0) seen.typed++;
      if (r.pieces.some((p) => p.modules.length === 3)) seen.threeModules++;
      if (r.totalCents < 0) seen.negativeTotal++;
      const rnd = prng(seed + 1000);
      const shuffle = <T,>(xs: T[]) => xs.map((x) => [rnd(), x] as const).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
      const again = recordedAcrossModules(input({ ...w, visits: shuffle(w.visits!), services: shuffle(w.services!), cycles: shuffle(w.cycles!) }), lk(...shuffle(txns)));
      expect(again.totalCents, `seed ${seed} shuffled`).toBe(r.totalCents);
      expect(JSON.stringify(again.pieces), `seed ${seed} pieces`).toBe(JSON.stringify(r.pieces));
      expect(again.byAttribution, `seed ${seed} attribution`).toEqual(r.byAttribution);
    }
    // the generator must really reach the hard paths, or agreement with the oracle proves little
    expect(seen.sharedAcross).toBeGreaterThan(40);
    expect(seen.coveredAcross).toBeGreaterThan(5);
    expect(seen.refunds).toBeGreaterThan(40);
    expect(seen.typed).toBeGreaterThan(80);
    expect(seen.threeModules).toBeGreaterThan(3);
  });
});
