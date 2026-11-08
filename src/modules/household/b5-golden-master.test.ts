import { describe, expect, it } from 'vitest';
import { costRecords, spend } from '../assets/spending';
import { householdSpend } from '../services/householdSpend';
import { expectedWindow, scheduleStateOf } from '../services/expectedCharges';
import { billsCostRecords, billsRecordedPayments } from '../bills/billsSpend';
import { buildCommitments } from '../bills/commitments';
import { cashTiming, derive, type BillsSnapshot } from '../bills/readModel';
import { confirmBody, creditF, inv, lcRec, monthly, obRec, obWith, paidOut, requestBody } from '../bills/billsTestkit';
import type { Txn } from '../../types';
import { asset, arrangement, billFact, billLink, lk, R, split, txn, visit, weekly, work } from './householdTestkit';

/**
 * B5 GOLDEN-MASTER GATE. These tests pin what the EXISTING readers return today: Home & Assets `spend()`, Household Services `householdSpend()`, the Bills-only
 * `billsRecordedPayments()`, and the Bills / Services expected-payment figures. They were written and passed BEFORE any B5 union code existed, and the B5 build does not
 * edit any of those files. Every expected number below is worked out by hand (the arithmetic is in the comment) and is NEVER produced by calling the function under test.
 * Everything is invented. Finance outflows are negative cents. Today is 2026-11-08 (a Sunday); 2026-11-06 was a Friday.
 */
const TODAY = '2026-11-08';
const homeSpend = (assets: ReturnType<typeof asset>[], services: ReturnType<typeof work>[], lookup: ReturnType<typeof lk>) => spend(costRecords(assets, services), lookup);

describe('golden master 1: Home & Assets spend() (the shared engine)', () => {
  it('a whole-transaction reference counts the live amount: one $150.00 payment', () => {
    const t = txn(1, -15000);
    const s = homeSpend([asset(1)], [work(1, 1, { txnRefs: [R(t)] })], lk(t));
    expect([s.totalCents, s.financeCents, s.manualCents]).toEqual([15000, 15000, 0]);
    expect(s.pieces.map((p) => p.key)).toEqual(['1:w']);
  });

  it('a split-part reference counts only that part: parts $30.00 and $70.00, part 1 linked = $70.00', () => {
    const t = txn(2, -10000, { splits: [split(3000), split(7000, 6)] });
    const s = homeSpend([asset(1)], [work(1, 1, { txnRefs: [R(t, 1)] })], lk(t));
    expect(s.totalCents).toBe(7000);
    expect(s.pieces.map((p) => p.key)).toEqual(['2:1']);
  });

  it('a whole transaction and one of its parts on different records: the whole ($100.00) counts once, the part is covered, in either order', () => {
    const t = txn(3, -10000, { splits: [split(3000), split(7000, 6)] });
    for (const order of [[0, 1], [1, 0]]) {
      const sv = [work(1, 1, { txnRefs: [R(t)] }), work(2, 1, { txnRefs: [R(t, 0)], date: '2026-03-11' })];
      const s = homeSpend([asset(1)], order.map((i) => sv[i]), lk(t));
      expect(s.totalCents).toBe(10000);
      expect(s.coveredParts).toHaveLength(1);
      expect(s.pieces.map((p) => p.key)).toEqual(['3:w']);
    }
  });

  it('one payment reached by three records on two assets is counted once ($40.00) and listed as shared', () => {
    const t = txn(4, -4000);
    const s = homeSpend([asset(1), asset(2)], [work(1, 1, { txnRefs: [R(t)] }), work(2, 1, { txnRefs: [R(t)], date: '2026-03-12' }), work(3, 2, { txnRefs: [R(t)], date: '2026-03-13' })], lk(t));
    expect(s.totalCents).toBe(4000);
    expect(s.pieces[0].recordIds).toHaveLength(3);
    expect(s.sharedPieces).toHaveLength(1);
  });

  it('a typed outside-Finance amount counts as typed ($80.00); a typed amount is never matched to a Finance payment by value', () => {
    const t = txn(5, -8000);
    const s = homeSpend([asset(1)], [work(1, 1, { costCents: 8000 }), work(2, 1, { txnRefs: [R(t)], date: '2026-03-11' })], lk(t));
    expect([s.manualCents, s.financeCents, s.totalCents]).toEqual([8000, 8000, 16000]); // 80.00 typed + 80.00 Finance: two payments
  });

  it('a record holding both a typed amount and references uses the references only ($90.00), and is listed as "both"', () => {
    const t = txn(6, -9000);
    const sv = work(1, 1, { costCents: 5000, txnRefs: [R(t)] });
    const s = homeSpend([asset(1)], [sv], lk(t));
    expect([s.totalCents, s.manualCents, s.financeCents]).toEqual([9000, 0, 9000]);
    expect(s.both).toEqual(['service:1']);
  });

  it('refunds: $120.00 paid then $50.00 back = $70.00; paid then fully refunded = $0.00; a refund alone = minus $50.00', () => {
    const out = txn(7, -12000), back = txn(8, 5000, { date: '2026-03-20' }), full = txn(9, 12000, { date: '2026-03-21' });
    expect(homeSpend([asset(1)], [work(1, 1, { txnRefs: [R(out), R(back)] })], lk(out, back)).totalCents).toBe(7000);
    expect(homeSpend([asset(1)], [work(1, 1, { txnRefs: [R(out), R(full)] })], lk(out, full)).totalCents).toBe(0);
    expect(homeSpend([asset(1)], [work(1, 1, { txnRefs: [R(back)] })], lk(back)).totalCents).toBe(-5000);
  });

  it('a deleted transaction counts nothing and is listed as missing (the snapshot is never an amount)', () => {
    const gone = txn(10, -7777);
    const s = homeSpend([asset(1)], [work(1, 1, { txnRefs: [R(gone)] })], lk());
    expect(s.totalCents).toBe(0);
    expect(s.review.map((r) => r.resolved.state)).toEqual(['missing']);
  });

  it('a changed whole-transaction amount uses the LIVE amount: linked at $100.00, now $125.00 = $125.00', () => {
    const linked = txn(11, -10000);
    const live = { ...linked, amountCents: -12500 };
    const s = homeSpend([asset(1)], [work(1, 1, { txnRefs: [R(linked)] })], lk(live));
    expect(s.totalCents).toBe(12500);
    expect(s.changed).toHaveLength(1);
    expect(s.pieces[0].resolved.state).toBe('changed');
  });

  it('a restructured split (the parts swapped after linking) counts nothing and needs review', () => {
    const linked = txn(12, -10000, { splits: [split(3000), split(7000, 6)] });
    const live = { ...linked, splits: [split(7000, 6), split(3000)] };
    const s = homeSpend([asset(1)], [work(1, 1, { txnRefs: [R(linked, 0)] })], lk(live));
    expect(s.totalCents).toBe(0);
    expect(s.review.map((r) => r.resolved.state)).toEqual(['split-changed']);
  });

  it('unknown is not zero: a service with no cost is listed as unknown and adds nothing; a typed $0.00 is a real zero', () => {
    const s = homeSpend([asset(1)], [work(1, 1, {}), work(2, 1, { costCents: 0, date: '2026-03-11' })], lk());
    expect(s.unknown.map((u) => u.recordId)).toEqual(['service:1']);
    expect([s.manualRecords, s.totalCents]).toEqual([1, 0]);
  });
});

describe('golden master 2: Household Services householdSpend() (Services plus Home & Assets)', () => {
  const input = (p: Partial<Parameters<typeof householdSpend>[0]>) => ({ assets: [asset(1)], homeServices: [], arrangements: [arrangement(1)], visits: [], pairs: [], ...p });

  it('the same $150.00 payment on a visit and a Home & Assets record is one payment: total $150.00, linked in both, module pages add to $300.00', () => {
    const t = txn(20, -15000);
    const h = householdSpend(input({ visits: [visit(1, { txnRefs: [R(t)] })], homeServices: [work(1, 1, { txnRefs: [R(t)] })] }), lk(t));
    expect([h.totalCents, h.servicesCents, h.homeCents, h.linkedInBothCents]).toEqual([15000, 15000, 15000, 15000]);
    expect(h.reconciliation).toMatchObject({ simpleSumCents: 30000, differenceCents: 15000, overlapBothCents: 15000 });
    expect(h.pieces.map((p) => p.modules)).toEqual([['home', 'services']]);
  });

  it('a whole transaction on one side and a part on the other: the whole ($100.00) counts, the part ($30.00) is covered; the module pages add to $130.00', () => {
    const t = txn(21, -10000, { splits: [split(3000), split(7000, 6)] });
    const h = householdSpend(input({ visits: [visit(1, { txnRefs: [R(t)] })], homeServices: [work(1, 1, { txnRefs: [R(t, 0)] })] }), lk(t));
    expect(h.totalCents).toBe(10000);
    expect(h.reconciliation).toMatchObject({ simpleSumCents: 13000, differenceCents: 3000, coveredAcrossCents: 3000 });
  });

  it('typed amounts: a visit and its linked (recorded-as) Home & Assets record are one job: $120.00 counts once and the other is not added', () => {
    const h = householdSpend(input({ visits: [visit(1, { paidManualCents: 12000 })], homeServices: [work(1, 1, { costCents: 12000 })], pairs: [{ visitId: 1, serviceId: 1 }] }), lk());
    expect([h.totalCents, h.typedCents]).toEqual([12000, 12000]);
    expect(h.reconciliation.typedNotAddedCents).toBe(12000);
  });

  it('a linked (recorded-as) job with a Finance payment on one side and a typed amount on the other counts ONLY the Finance payment: $120.00, not $240.00 (the typed amount would be the same money twice)', () => {
    const t = txn(24, -12000);
    const h = householdSpend(input({ visits: [visit(1, { paidManualCents: 12000 })], homeServices: [work(1, 1, { txnRefs: [R(t)] })], pairs: [{ visitId: 1, serviceId: 1 }] }), lk(t));
    expect([h.totalCents, h.financeCents, h.typedCents]).toEqual([12000, 12000, 0]);
    expect([h.servicesCents, h.homeCents, h.reconciliation.typedNotAddedCents]).toEqual([12000, 12000, 12000]); // each module page shows $120.00 (24,000 together); the typed 12,000 is the whole difference
  });

  it('two UNLINKED typed amounts of the same size both count: $120.00 + $120.00 = $240.00 (never matched by value)', () => {
    const h = householdSpend(input({ visits: [visit(1, { paidManualCents: 12000, date: '2026-03-10' })], homeServices: [work(1, 1, { costCents: 12000, date: '2026-05-02' })] }), lk());
    expect(h.totalCents).toBe(24000);
  });

  it('a completed visit with no payment is "unknown", not zero and not unpaid; nothing is added', () => {
    const h = householdSpend(input({ visits: [visit(1)] }), lk());
    expect([h.totalCents, h.unknown.completedVisits]).toEqual([0, 1]);
  });

  it('a period narrows a Finance reference by the LIVE transaction day: only the 2026 payment ($100.00) is in 2026', () => {
    const a = txn(22, -10000, { date: '2026-03-10' }), b = txn(23, -4000, { date: '2025-12-01' });
    const inp = input({ visits: [visit(1, { txnRefs: [R(a)] }), visit(2, { txnRefs: [R(b)], date: '2025-12-01' })] });
    expect(householdSpend(inp, lk(a, b), { from: '2026-01-01', to: '2026-12-31' }).totalCents).toBe(10000);
    expect(householdSpend(inp, lk(a, b)).totalCents).toBe(14000);
  });
});

describe('golden master 3: Bills billsRecordedPayments() and the Bills period figures', () => {
  const OBS = [obRec(1, { title: 'Power', type: 'utility' }), obRec(2, { title: 'Phone', type: 'telecom' })];
  const total = (cycles: ReturnType<typeof billLink>[], lookup: ReturnType<typeof lk>) => billsRecordedPayments(billsCostRecords(OBS, cycles), lookup);

  it('a Finance link beside a typed payment in ONE billing period: the link ($120.00) is used, the typed amount is set aside (left out, kept)', () => {
    const t = txn(30, -12000, { date: '2026-11-10' });
    const cycles = [billFact(1, 'm2026-11', paidOut('2026-11-09', 12000)), billLink(1, 'm2026-11', t)];
    const r = total(cycles, lk(t));
    expect([r.totalCents, r.financeCents, r.typedCents]).toEqual([12000, 12000, 0]);
    // the cost record itself carries ONE source: references, and no typed amount beside them (so a reader that mixed the two would be noticed even where the total hides it)
    expect(billsCostRecords(OBS, cycles).every((rec) => rec.refs.length > 0 && rec.manualCents === null)).toBe(true);
    expect(r.both).toEqual([]);
  });

  it('the same $120.00 typed in one period and linked in another is TWO payments: $240.00', () => {
    const t = txn(31, -12000, { date: '2026-12-10' });
    expect(total([billFact(1, 'm2026-11', paidOut('2026-11-09', 12000)), billLink(1, 'm2026-12', t)], lk(t)).totalCents).toBe(24000);
  });

  it('one payment linked on two periods and a second bill is counted once ($120.00) and listed as shared across three periods', () => {
    const t = txn(32, -12000, { date: '2026-11-10' });
    const r = total([billLink(1, 'm2026-11', t), billLink(1, 'm2026-12', t), billLink(2, 'm2026-11', t)], lk(t));
    expect(r.totalCents).toBe(12000);
    expect(r.sharedPieces).toEqual([{ key: '32:w', periods: ['bill:1:m2026-11', 'bill:1:m2026-12', 'bill:2:m2026-11'] }]);
  });

  it('a partial payment: billed $240.00, $100.00 paid = $140.00 remaining; only the $100.00 is recorded spending', () => {
    const t = txn(33, -10000, { date: '2026-11-10' });
    const cycles = [billFact(1, 'm2026-11', inv(24000, { dueDate: '2026-11-18' })), billLink(1, 'm2026-11', t)];
    const snap: BillsSnapshot = { obligations: [OBS[0]], cycles, tasks: [], financeTxns: new Map([[33, t]]) };
    const p = derive(snap, TODAY).periods.get(1)!.find((x) => x.slot === 'm2026-11')!;
    expect([p.amounts.owed, p.amounts.paid, p.amounts.remaining]).toEqual([24000, 10000, 14000]);
    expect(total(cycles, lk(t)).totalCents).toBe(10000);
    const w30 = cashTiming(derive(snap, TODAY)).find((w) => w.days === 30)!;
    expect(w30.known).toEqual({ cents: 14000, count: 1 }); // what REMAINS, not the whole bill
  });

  it('a provider credit lowers what is owed, never what was paid: billed $120.00, credit $20.00, paid $60.00 = owed $100.00, remaining $40.00, recorded $60.00', () => {
    const t = txn(34, -6000, { date: '2026-11-10' });
    const cycles = [billFact(1, 'm2026-11', inv(12000, { dueDate: '2026-11-18' })), billFact(1, 'm2026-11', creditF(2000)), billLink(1, 'm2026-11', t)];
    const snap: BillsSnapshot = { obligations: [OBS[0]], cycles, tasks: [], financeTxns: new Map([[34, t]]) };
    const p = derive(snap, TODAY).periods.get(1)!.find((x) => x.slot === 'm2026-11')!;
    expect([p.amounts.owed, p.amounts.paid, p.amounts.remaining]).toEqual([10000, 6000, 4000]);
    expect(total(cycles, lk(t)).totalCents).toBe(6000);
  });

  it('refund: $120.00 paid, $50.00 back = $70.00; a bill that is only invoiced has recorded spending $0.00', () => {
    const out = txn(35, -12000), back = txn(36, 5000, { date: '2026-11-20' });
    expect(total([billLink(1, 'm2026-11', out), billLink(1, 'm2026-11', back)], lk(out, back)).totalCents).toBe(7000);
    expect(total([billFact(1, 'm2026-11', inv(12000))], lk()).totalCents).toBe(0);
  });

  it('a deleted transaction counts nothing, is listed as missing, and a typed amount in that period does NOT start counting again', () => {
    const gone = txn(37, -5000);
    const r = total([billLink(1, 'm2026-11', gone), billFact(1, 'm2026-11', paidOut('2026-11-09', 5000))], lk());
    expect(r.totalCents).toBe(0);
    expect(r.review.map((x) => x.state)).toEqual(['missing']);
  });
});

describe('golden master 4: expected payments and commitments (what is EXPECTED, never money spent)', () => {
  it('an uninvoiced monthly $90.00 bill: 12 expected dates in the next 12 months = $1,080.00 known; recorded spending is $0.00', () => {
    const o = obRec(1, {}, '2026-11-07'); // $90.00 on the 18th, from 2026-11-07
    const c = buildCommitments([o], TODAY);
    expect(c.window).toEqual({ from: '2026-11-08', to: '2027-11-07' });
    expect([c.known.cents, c.known.periods, c.estimated.cents, c.unknown.periods]).toEqual([108000, 12, 0, 0]); // 12 x 9000
    expect(billsRecordedPayments(billsCostRecords([o], []), lk()).totalCents).toBe(0);
  });

  it('cash timing for that bill: nothing in 7 days (to 15 Nov), 18 Nov in 30 days ($90.00), 18 Nov + 18 Dec + 18 Jan in 90 days ($270.00)', () => {
    const snap: BillsSnapshot = { obligations: [obRec(1, {}, '2026-11-07')], cycles: [], tasks: [], financeTxns: new Map() };
    const w = Object.fromEntries(cashTiming(derive(snap, TODAY)).map((x) => [x.days, x.known]));
    expect(w[7]).toEqual({ cents: 0, count: 0 });
    expect(w[30]).toEqual({ cents: 9000, count: 1 });
    expect(w[90]).toEqual({ cents: 27000, count: 3 });
  });

  it('a varying bill is an ESTIMATE and a bill with no amount is UNKNOWN (never zero)', () => {
    const est = obRec(1, { amountKind: 'variable', prices: [{ from: '2026-11-07', cents: 8000, label: '' }] });
    const unk = obRec(2, { amountKind: 'unknown', prices: [] });
    const c = buildCommitments([est, unk], TODAY);
    expect([c.known.cents, c.estimated.cents, c.estimated.periods, c.unknown.periods]).toEqual([0, 96000, 12, 12]); // 12 x 8000 estimated; 12 dates with no amount
  });

  it('a subscription with a CONFIRMED future cancellation (effective 31 Dec 2026) expects only 15 Nov and 15 Dec: 2 x $15.49 = $30.98; payments already recorded stay', () => {
    const streamly = (extra: ReturnType<typeof lcRec>[] = []) => obWith(3, extra, { title: 'Streamly', type: 'subscription', schedule: monthly(15, '2026-01'), trackingSince: '2026-01-01', prices: [{ from: '2026-01-01', cents: 1549, label: '' }] }, '2026-01-01');
    const confirmed = streamly([lcRec(1, 3, requestBody('2026-10-20')), lcRec(2, 3, confirmBody('2026-12-31', '2026-10-25'))]);
    expect(confirmed.data.lc!.cutoffOn).toBe('2026-12-31');
    expect([buildCommitments([confirmed], TODAY).known.cents, buildCommitments([confirmed], TODAY).known.periods]).toEqual([3098, 2]);
    const requestOnly = streamly([lcRec(1, 3, requestBody('2026-10-20'))]);
    expect(buildCommitments([requestOnly], TODAY).known.periods).toBe(12); // a request is not a cancellation
    const paid = ['m2026-02', 'm2026-03', 'm2026-04'].map((slot, i) => { const t = txn(60 + i, -1549, { date: `2026-0${i + 2}-15` }); return { t, f: billLink(3, slot, t) }; });
    const r = billsRecordedPayments(billsCostRecords([confirmed], paid.map((p) => p.f)), lk(...paid.map((p) => p.t)));
    expect(r.totalCents).toBe(4647); // 3 x 1549, unchanged by the cancellation
  });

  it('a cancellation that took effect in the past stops all new commitments, and its historical payments stay recorded', () => {
    const past = obWith(4, [lcRec(1, 4, requestBody('2026-06-01')), lcRec(2, 4, confirmBody('2026-06-30', '2026-06-02'))], { title: 'Old Gym', type: 'membership', schedule: monthly(15, '2026-01'), trackingSince: '2026-01-01', prices: [{ from: '2026-01-01', cents: 3000, label: '' }] }, '2026-01-01');
    expect(buildCommitments([past], TODAY).known.periods).toBe(0);
    const t = txn(70, -3000, { date: '2026-05-15' });
    expect(billsRecordedPayments(billsCostRecords([past], [billLink(4, 'm2026-05', t)]), lk(t)).totalCents).toBe(3000);
  });

  it('an unconfirmed expected service visit: a weekly Friday $120.00-per-visit arrangement with no logged visit expects 4 Fridays in the next 30 days = $480.00, and it is not spending', () => {
    const a = arrangement(1, { cadence: weekly, expected: { basis: 'perVisit', cents: 12000 } });
    const w = expectedWindow([a], new Map([[1, scheduleStateOf([])]]), TODAY, 30); // Fridays 13, 20, 27 Nov and 4 Dec
    expect(w.items[0].dates).toEqual(['2026-11-13', '2026-11-20', '2026-11-27', '2026-12-04']);
    expect(w.estimateCents).toBe(48000);
    expect(householdSpend({ assets: [], homeServices: [], arrangements: [a], visits: [], pairs: [] }, lk()).totalCents).toBe(0);
  });

  it('a per-month Services estimate is NOT converted (no rule for part months): it is listed as not converted, never added or zeroed', () => {
    const a = arrangement(1, { cadence: weekly, expected: { basis: 'perMonth', cents: 40000 } });
    const w = expectedWindow([a], new Map([[1, scheduleStateOf([])]]), TODAY, 30);
    expect([w.estimateCents, w.items.length, w.notConverted.length]).toEqual([0, 0, 1]);
  });
});

describe('golden master 5: refunds against a shared payment keep every module consistent', () => {
  it('a $150.00 payment and a $30.00 refund, both linked from a Services visit AND a Bills period, are each counted once: net $120.00 in each module and in the union of the two readers', () => {
    const pay = txn(80, -15000, { date: '2026-11-10' }), back = txn(81, 3000, { date: '2026-11-20' });
    const t = [pay, back] as Txn[];
    const h = householdSpend({ assets: [], homeServices: [], arrangements: [arrangement(1)], visits: [visit(1, { txnRefs: [R(pay), R(back)] })], pairs: [] }, lk(...t));
    const b = billsRecordedPayments(billsCostRecords([obRec(1)], [billLink(1, 'm2026-11', pay), billLink(1, 'm2026-11', back)]), lk(...t));
    expect([h.totalCents, b.totalCents]).toEqual([12000, 12000]);
  });
});
