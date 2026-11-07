import { describe, expect, it } from 'vitest';
import type { Txn } from '../../types';
import { makeTxnRef, type TxnRef } from '../../lib/txnRef';
import { blankAsset, type AssetRecord } from '../assets/model';
import { blankService, type ServiceRecord } from '../assets/service';
import { costRecords, spend } from '../assets/spending';
import { buildSpending } from '../assets/overview';
import { blankArrangement, type ArrangementRecord } from './model';
import { householdSpend, pairsFromLinks, type HouseholdInput, type PairLink } from './householdSpend';
import { payRecords, servicesSpend } from './servicesSpend';
import { blankVisit, type VisitRecord } from './visitModel';

/** S5-B financial test matrix. Everything is invented and in memory: the pure function is fed records directly, so each scenario states exactly what the claims are. */
const rec = <T,>(id: number, data: T) => ({ id, createdAt: id, updatedAt: id, data });
const asset = (id: number, over: Parameters<typeof blankAsset>[0] = {}): AssetRecord => rec(id, blankAsset({ name: `Asset ${id}`, ...over }));
const work = (id: number, assetId: number, over: Partial<ServiceRecord['data']> = {}): ServiceRecord => rec(id, blankService(assetId, { title: `Work ${id}`, date: '2026-03-10', ...over }));
const arrangement = (id: number, over: Partial<ArrangementRecord['data']> = {}): ArrangementRecord => rec(id, blankArrangement({ title: `Arrangement ${id}`, ...over }));
const visit = (id: number, over: Partial<VisitRecord['data']> = {}): VisitRecord => rec(id, blankVisit({ title: `Visit ${id}`, date: '2026-03-10', status: 'completed', providerContactId: 1, providerNameSnapshot: 'Pat Pools', arrangementId: 1, ...over }));
const txn = (id: number, amountCents: number, over: Partial<Txn> = {}): Txn => ({ id, accountId: 1, date: '2026-03-10', amountCents, payee: `Payee ${id}`, memo: '', status: 'cleared', categoryId: 5, ...over } as Txn);
const split = (outflowCents: number, categoryId = 5) => ({ amountCents: -outflowCents, categoryId });
const lk = (...ts: Txn[]) => { const m = new Map(ts.map((t) => [t.id as number, t])); return (id: number) => m.get(id); };
const R = (t: Txn, i?: number): TxnRef => makeTxnRef(t, i);

interface Pieces { assets?: AssetRecord[]; services?: ServiceRecord[]; arrangements?: ArrangementRecord[]; visits?: VisitRecord[]; pairs?: PairLink[] }
const input = (p: Pieces): HouseholdInput => ({ assets: p.assets ?? [asset(1)], homeServices: p.services ?? [], arrangements: p.arrangements ?? [arrangement(1)], visits: p.visits ?? [], pairs: p.pairs ?? [] });
const byStatus = (h: ReturnType<typeof householdSpend>) => Object.fromEntries(['included', 'merged', 'covered', 'excluded'].map((s) => [s, h.claims.filter((c) => c.status === s).length]));

/** The invariants that must hold for EVERY scenario. */
function invariants(h: ReturnType<typeof householdSpend>) {
  expect(h.reconciliation.reconciles).toBe(true);
  expect(h.reconciliation.explainsDifference).toBe(true);
  expect(h.claims.filter((c) => c.status === 'included').reduce((t, c) => t + c.cents, 0)).toBe(h.totalCents);
  expect(h.totalCents).toBe(h.financeCents + h.typedCents);
  expect(h.counts.included + h.counts.merged + h.counts.covered + h.counts.excluded).toBe(h.claims.length);
  // never reads Project money: nothing in the output is named project spending
  expect(JSON.stringify(Object.keys(h))).not.toMatch(/projectSpend|projectPaid/);
}

describe('S5-B household spending: the financial test matrix (claims and cents)', () => {
  it('1. a Household Services payment only', () => {
    const t = txn(1, -10000);
    const h = householdSpend(input({ visits: [visit(1, { txnRefs: [R(t)] })] }), lk(t));
    expect(h.totalCents).toBe(10000);
    expect([h.servicesCents, h.homeCents, h.linkedInBothCents]).toEqual([10000, 0, 0]);
    expect(h.pieces).toHaveLength(1);
    expect(byStatus(h)).toEqual({ included: 1, merged: 0, covered: 0, excluded: 0 });
    invariants(h);
  });

  it('2. a Home & Assets payment only', () => {
    const t = txn(2, -5000);
    const h = householdSpend(input({ services: [work(1, 1, { txnRefs: [R(t)] })] }), lk(t));
    expect(h.totalCents).toBe(5000);
    expect([h.servicesCents, h.homeCents]).toEqual([0, 5000]);
    expect(h.pieces).toHaveLength(1);
    invariants(h);
  });

  it('3. the same whole transaction in both modules counts once, and the page can say it is linked in both', () => {
    const t = txn(3, -12000);
    const h = householdSpend(input({ visits: [visit(1, { txnRefs: [R(t)] })], services: [work(1, 1, { txnRefs: [R(t)] })] }), lk(t));
    expect(h.totalCents).toBe(12000);
    expect(h.pieces).toHaveLength(1);
    expect(h.pieces[0].modules).toEqual(['home', 'services']);
    expect(h.linkedInBothCents).toBe(12000);
    expect(h.reconciliation).toMatchObject({ simpleSumCents: 24000, differenceCents: 12000, overlapBothCents: 12000, coveredAcrossCents: 0, typedNotAddedCents: 0 });
    expect(byStatus(h)).toEqual({ included: 1, merged: 1, covered: 0, excluded: 0 });
    invariants(h);
  });

  it('4. the same split part in both modules counts once (the part, not the whole transaction)', () => {
    const t = txn(4, -10000, { splits: [split(3000), split(7000, 6)] });
    const h = householdSpend(input({ visits: [visit(1, { txnRefs: [R(t, 0)] })], services: [work(1, 1, { txnRefs: [R(t, 0)] })] }), lk(t));
    expect(h.totalCents).toBe(3000);
    expect(h.pieces).toHaveLength(1);
    expect(h.linkedInBothCents).toBe(3000);
    invariants(h);
  });

  it('5. a whole transaction on one side and an overlapping part on the other: the whole counts once, the part is covered, in both orders and both ways round', () => {
    const t = txn(5, -10000, { splits: [split(3000), split(7000, 6)] });
    for (const wholeInServices of [true, false]) {
      const whole = R(t), part = R(t, 0);
      const i = wholeInServices
        ? input({ visits: [visit(1, { txnRefs: [whole] })], services: [work(1, 1, { txnRefs: [part] })] })
        : input({ visits: [visit(1, { txnRefs: [part] })], services: [work(1, 1, { txnRefs: [whole] })] });
      for (const flip of [false, true]) {
        const shuffled = flip ? { ...i, visits: [...i.visits].reverse(), homeServices: [...i.homeServices].reverse() } : i;
        const h = householdSpend(shuffled, lk(t));
        expect(h.totalCents).toBe(10000);
        expect(h.pieces.map((p) => p.key)).toEqual(['5:w']);
        expect(byStatus(h)).toEqual({ included: 1, merged: 0, covered: 1, excluded: 0 });
        // module pages: one counts 10000, the other 3000; the household counts the whole once
        expect(h.reconciliation).toMatchObject({ simpleSumCents: 13000, differenceCents: 3000, coveredAcrossCents: 3000, overlapBothCents: 0 });
        expect(h.linkedInBothCents).toBe(10000);
        invariants(h);
      }
    }
  });

  it('6. several different split parts all count (each part once)', () => {
    const t = txn(6, -10000, { splits: [split(3000), split(7000, 6)] });
    const h = householdSpend(input({ visits: [visit(1, { txnRefs: [R(t, 0)] })], services: [work(1, 1, { txnRefs: [R(t, 1)] })] }), lk(t));
    expect(h.totalCents).toBe(10000);
    expect(h.pieces).toHaveLength(2);
    expect(h.linkedInBothCents).toBe(0);
    invariants(h);
  });

  it('7. one payment linked to several services is counted once and not divided', () => {
    const t = txn(7, -9000);
    const h = householdSpend(input({ visits: [visit(1, { txnRefs: [R(t)] }), visit(2, { txnRefs: [R(t)], date: '2026-03-17' }), visit(3, { txnRefs: [R(t)], date: '2026-03-24' })] }), lk(t));
    expect(h.totalCents).toBe(9000);
    expect(h.servicesCents).toBe(9000);
    expect(h.pieces[0].recordIds).toHaveLength(3);
    expect(byStatus(h)).toEqual({ included: 1, merged: 2, covered: 0, excluded: 0 });
    invariants(h);
  });

  it('8. one payment linked to several assets is counted once', () => {
    const t = txn(8, -4000);
    const h = householdSpend(input({ assets: [asset(1), asset(2), asset(3)], services: [work(1, 1, { txnRefs: [R(t)] }), work(2, 2, { txnRefs: [R(t)] }), work(3, 3, { txnRefs: [R(t)] })] }), lk(t));
    expect(h.totalCents).toBe(4000);
    expect(h.homeCents).toBe(4000);
    expect(h.pieces).toHaveLength(1);
    invariants(h);
  });

  it('9. one payment shared by visits with different outcomes (completed, skipped, cancelled) is counted once', () => {
    const t = txn(9, -6000);
    const h = householdSpend(input({ visits: [
      visit(1, { txnRefs: [R(t)] }),
      visit(2, { status: 'skipped', txnRefs: [R(t)], date: '2026-03-17' }),
      visit(3, { status: 'cancelled', cancelledBy: 'household', txnRefs: [R(t)], date: '2026-03-24' }),
    ] }), lk(t));
    expect(h.totalCents).toBe(6000);
    expect(h.pieces).toHaveLength(1);
    invariants(h);
  });

  it('10. refunds and negative amounts: a refund linked in the other module lowers the one household figure once', () => {
    const pay = txn(10, -10000), back = txn(11, 2500);
    const h = householdSpend(input({ visits: [visit(1, { txnRefs: [R(pay)] })], services: [work(1, 1, { txnRefs: [R(back)] })] }), lk(pay, back));
    expect(h.totalCents).toBe(7500);
    expect(h.financeCents).toBe(7500);
    expect(h.claims.find((c) => c.key === '11:w')!.cents).toBe(-2500);
    // linking the same refund in both modules still counts it once
    const h2 = householdSpend(input({ visits: [visit(1, { txnRefs: [R(pay), R(back)] })], services: [work(1, 1, { txnRefs: [R(back)] })] }), lk(pay, back));
    expect(h2.totalCents).toBe(7500);
    invariants(h); invariants(h2);
  });

  it('11. transfers are never spending: the claim is excluded for review and adds nothing', () => {
    const tr = txn(12, -20000, { transferTxnId: 99 });
    const ok = txn(13, -1000);
    const h = householdSpend(input({ visits: [visit(1, { txnRefs: [R(tr), R(ok)] })], services: [work(1, 1, { txnRefs: [R(tr)] })] }), lk(tr, ok));
    expect(h.totalCents).toBe(1000);
    expect(byStatus(h).excluded).toBe(2);
    expect(h.review.filter((r) => r.kind === 'finance-reference')).toHaveLength(2);
    invariants(h);
  });

  it('12. a changed Finance amount: the LIVE amount is used (never the snapshot) and the change is listed', () => {
    const t = txn(14, -10000);
    const r = R(t);
    const live = { ...t, amountCents: -12500 };
    const h = householdSpend(input({ visits: [visit(1, { txnRefs: [r] })], services: [work(1, 1, { txnRefs: [r] })] }), lk(live));
    expect(h.totalCents).toBe(12500);
    expect(h.review.some((x) => x.kind === 'changed')).toBe(true);
    invariants(h);
  });

  it('13. a deleted or missing transaction counts nothing in either module (the snapshot is never substituted)', () => {
    const t = txn(15, -8000);
    const h = householdSpend(input({ visits: [visit(1, { txnRefs: [R(t)] })], services: [work(1, 1, { txnRefs: [R(t)] })] }), lk());
    expect(h.totalCents).toBe(0);
    expect(h.review.filter((r) => r.kind === 'finance-reference')).toHaveLength(2);
    expect(byStatus(h)).toEqual({ included: 0, merged: 0, covered: 0, excluded: 2 });
    invariants(h);
  });

  it('14. a stale or reordered split needs review and counts nothing, while a correct reference to the same part elsewhere still counts it once', () => {
    const t = txn(16, -10000, { splits: [split(3000), split(7000, 6)] });
    const stale = R(t, 0);
    const reordered = { ...t, splits: [split(7000, 6), split(3000)] };
    const h = householdSpend(input({ visits: [visit(1, { txnRefs: [stale] })] }), lk(reordered));
    expect(h.totalCents).toBe(0);
    expect(h.review[0].kind).toBe('finance-reference');
    // the other module holds a reference made AFTER the reorder: valid, counts once; the old one stays listed
    const good = R(reordered, 0);
    const h2 = householdSpend(input({ visits: [visit(1, { txnRefs: [stale] })], services: [work(1, 1, { txnRefs: [good] })] }), lk(reordered));
    expect(h2.totalCents).toBe(7000);
    expect(h2.pieces).toHaveLength(1);
    expect(h2.review.filter((r) => r.kind === 'finance-reference')).toHaveLength(1);
    invariants(h); invariants(h2);
  });

  it('15. identical split amounts and categories are told apart only by position: different positions are different pieces, the same position is one', () => {
    const t = txn(17, -6000, { splits: [split(3000), split(3000)] });
    const diff = householdSpend(input({ visits: [visit(1, { txnRefs: [R(t, 0)] })], services: [work(1, 1, { txnRefs: [R(t, 1)] })] }), lk(t));
    expect(diff.totalCents).toBe(6000);
    expect(diff.pieces).toHaveLength(2);
    const same = householdSpend(input({ visits: [visit(1, { txnRefs: [R(t, 0)] })], services: [work(1, 1, { txnRefs: [R(t, 0)] })] }), lk(t));
    expect(same.totalCents).toBe(3000);
    // amounts alone never merge anything: a typed amount equal to a Finance piece is a separate claim
    const mixed = householdSpend(input({ visits: [visit(1, { txnRefs: [R(t, 0)] })], services: [work(1, 1, { costCents: 3000 })] }), lk(t));
    expect(mixed.totalCents).toBe(6000);
    invariants(diff); invariants(same); invariants(mixed);
  });

  it('16. typed amounts on unrelated records with identical values are both counted; a same-day, same-provider, same-asset pair only raises a hint', () => {
    const unrelated = householdSpend(input({ visits: [visit(1, { paidManualCents: 5000 })], services: [work(1, 1, { costCents: 5000, date: '2026-04-01', providerContactId: 2 })] }), lk());
    expect(unrelated.totalCents).toBe(10000);
    expect(unrelated.review).toHaveLength(0);
    const lookalike = householdSpend({ ...input({ visits: [visit(1, { paidManualCents: 5000 })], services: [work(1, 1, { costCents: 5000, providerContactId: 1 })] }), visitAssets: new Map([[1, [1]]]) }, lk());
    expect(lookalike.totalCents).toBe(10000);
    expect(lookalike.review.map((r) => r.kind)).toEqual(['same-job-hint']);
    expect(byStatus(lookalike)).toEqual({ included: 2, merged: 0, covered: 0, excluded: 0 });
    // same day and provider but a different asset: no hint, both counted
    const otherAsset = householdSpend({ ...input({ assets: [asset(1), asset(2)], visits: [visit(1, { paidManualCents: 5000 })], services: [work(1, 1, { costCents: 5000, providerContactId: 1 })] }), visitAssets: new Map([[1, [2]]]) }, lk());
    expect(otherAsset.totalCents).toBe(10000);
    expect(otherAsset.review).toHaveLength(0);
    invariants(unrelated); invariants(lookalike); invariants(otherAsset);
  });

  it('17. a typed amount on a visit and its recorded-as asset record: one payment event, counted once, from the visit', () => {
    const h = householdSpend(input({ visits: [visit(1, { paidManualCents: 5000 })], services: [work(1, 1, { costCents: 5000 })], pairs: [{ visitId: 1, serviceId: 1 }] }), lk());
    expect(h.totalCents).toBe(5000);
    expect(h.typedCents).toBe(5000);
    expect([h.servicesCents, h.homeCents]).toEqual([5000, 5000]);
    expect(byStatus(h)).toEqual({ included: 1, merged: 0, covered: 0, excluded: 1 });
    expect(h.claims.find((c) => c.status === 'included')!.recordId).toBe('visit:1');
    expect(h.reconciliation).toMatchObject({ simpleSumCents: 10000, differenceCents: 5000, typedNotAddedCents: 5000 });
    expect(h.review).toHaveLength(0);
    invariants(h);
  });

  it('18. a linked visit and record with different typed amounts: the visit counts, the difference is flagged', () => {
    const h = householdSpend(input({ visits: [visit(1, { paidManualCents: 5000 })], services: [work(1, 1, { costCents: 4500 })], pairs: [{ visitId: 1, serviceId: 1 }] }), lk());
    expect(h.totalCents).toBe(5000);
    expect(h.review.map((r) => r.kind)).toEqual(['typed-differs']);
    expect(h.reconciliation.typedNotAddedCents).toBe(4500);
    // a payment on only one side counts exactly once either way round
    const onlyRecord = householdSpend(input({ visits: [visit(1)], services: [work(1, 1, { costCents: 4500 })], pairs: [{ visitId: 1, serviceId: 1 }] }), lk());
    expect(onlyRecord.totalCents).toBe(4500);
    expect(onlyRecord.unknown.completedVisits).toBe(0);
    invariants(h); invariants(onlyRecord);
  });

  it('18b. unknown is never $0: a Home & Assets record with no cost is unknown only if nothing in its linked job carries a payment, and a completed visit with no payment is counted as "no payment recorded"', () => {
    const none = householdSpend(input({ visits: [visit(1)], services: [work(1, 1)], pairs: [{ visitId: 1, serviceId: 1 }] }), lk());
    expect(none.totalCents).toBe(0);
    expect(none.unknown).toEqual({ homeWork: 1, completedVisits: 1 });
    const paid = householdSpend(input({ visits: [visit(1, { paidManualCents: 3000 })], services: [work(1, 1)], pairs: [{ visitId: 1, serviceId: 1 }] }), lk());
    expect(paid.unknown).toEqual({ homeWork: 0, completedVisits: 0 });
    expect(paid.totalCents).toBe(3000);
    const unlinked = householdSpend(input({ visits: [visit(1, { paidManualCents: 3000 })], services: [work(1, 1)] }), lk());
    expect(unlinked.unknown.homeWork).toBe(1);
    invariants(none); invariants(paid); invariants(unlinked);
  });

  it('19. a deleted or missing recorded-as target: no pair, each side counts alone, nothing is lost or doubled, and it is listed', () => {
    const h = householdSpend(input({ visits: [visit(1, { paidManualCents: 5000 })], pairs: [{ visitId: 1, serviceId: 77 }] }), lk());
    expect(h.totalCents).toBe(5000);
    expect(h.review.map((r) => r.kind)).toEqual(['dangling-pair']);
    // the record arrives later (sync): now they pair and the amount is still counted once
    const later = householdSpend(input({ visits: [visit(1, { paidManualCents: 5000 })], services: [work(77, 1, { costCents: 5000 })], pairs: [{ visitId: 1, serviceId: 77 }] }), lk());
    expect(later.totalCents).toBe(5000);
    // a link to a visit that is gone: the record alone counts
    const noVisit = householdSpend(input({ services: [work(5, 1, { costCents: 2000 })], pairs: [{ visitId: 9, serviceId: 5 }] }), lk());
    expect(noVisit.totalCents).toBe(2000);
    invariants(h); invariants(later); invariants(noVisit);
  });

  it('20. two offline devices each recorded the same visit (two records, two links): still one payment', () => {
    const typed = householdSpend(input({ visits: [visit(1, { paidManualCents: 5000 })], services: [work(1, 1, { costCents: 5000 }), work(2, 1, { costCents: 5000, title: 'Work 2 (other device)' })], pairs: [{ visitId: 1, serviceId: 1 }, { visitId: 1, serviceId: 2 }] }), lk());
    expect(typed.totalCents).toBe(5000);
    expect(byStatus(typed)).toEqual({ included: 1, merged: 0, covered: 0, excluded: 2 });
    // typed on the records only (the visit has none): the first record counts, the duplicate does not
    const recOnly = householdSpend(input({ visits: [visit(1)], services: [work(1, 1, { costCents: 5000 }), work(2, 1, { costCents: 5000 })], pairs: [{ visitId: 1, serviceId: 1 }, { visitId: 1, serviceId: 2 }] }), lk());
    expect(recOnly.totalCents).toBe(5000);
    // the same Finance payment on both duplicates
    const t = txn(20, -5000);
    const fin = householdSpend(input({ visits: [visit(1, { txnRefs: [R(t)] })], services: [work(1, 1, { txnRefs: [R(t)] }), work(2, 1, { txnRefs: [R(t)] })], pairs: [{ visitId: 1, serviceId: 1 }, { visitId: 1, serviceId: 2 }] }), lk(t));
    expect(fin.totalCents).toBe(5000);
    expect(fin.pieces[0].recordIds).toHaveLength(3);
    // one visit recorded for two DIFFERENT assets: one job, one payment
    const two = householdSpend(input({ assets: [asset(1), asset(2)], visits: [visit(1, { paidManualCents: 3000 })], services: [work(1, 1, { costCents: 3000 }), work(2, 2, { costCents: 3000 })], pairs: [{ visitId: 1, serviceId: 1 }, { visitId: 1, serviceId: 2 }] }), lk());
    expect(two.totalCents).toBe(3000);
    invariants(typed); invariants(recOnly); invariants(fin); invariants(two);
  });

  it('21. a Finance payment plus a separate, legitimate manual charge: both count unless they are one linked job', () => {
    const t = txn(21, -10000);
    const sep = householdSpend(input({ visits: [visit(1, { txnRefs: [R(t)] }), visit(2, { paidManualCents: 2500, date: '2026-03-17' })] }), lk(t));
    expect(sep.totalCents).toBe(12500);
    expect([sep.financeCents, sep.typedCents]).toEqual([10000, 2500]);
    // unlinked: a Finance piece on the visit and a typed cost on an unrelated record both count (nothing is matched by value)
    const unlinked = householdSpend(input({ visits: [visit(1, { txnRefs: [R(t)] })], services: [work(1, 1, { costCents: 2500, date: '2026-05-01' })] }), lk(t));
    expect(unlinked.totalCents).toBe(12500);
    // linked as one job: the typed amount on the record would count the same money twice, so it is left out and listed
    const linked = householdSpend(input({ visits: [visit(1, { txnRefs: [R(t)] })], services: [work(1, 1, { costCents: 10000 })], pairs: [{ visitId: 1, serviceId: 1 }] }), lk(t));
    expect(linked.totalCents).toBe(10000);
    expect(linked.review.map((r) => r.kind)).toEqual(['typed-left-out']);
    expect(linked.reconciliation.typedNotAddedCents).toBe(10000);
    invariants(sep); invariants(unlinked); invariants(linked);
  });

  it('22. periods: a payment counts on its transaction date and a typed amount on its record date; a linked job crossing a boundary counts once overall', () => {
    const t = txn(22, -10000, { date: '2027-01-02' });
    const v = visit(1, { date: '2026-12-30', txnRefs: [R(t)] });
    const i = input({ visits: [v] });
    expect(householdSpend(i, lk(t), { from: '2026-01-01', to: '2026-12-31' }).totalCents).toBe(0);
    expect(householdSpend(i, lk(t), { from: '2027-01-01', to: '2027-12-31' }).totalCents).toBe(10000);
    expect(householdSpend(i, lk(t)).totalCents).toBe(10000);
    // a typed job whose visit and record fall on either side of the year end
    const j = input({ visits: [visit(1, { date: '2026-12-31', paidManualCents: 4000 })], services: [work(1, 1, { date: '2027-01-01', costCents: 4000 })], pairs: [{ visitId: 1, serviceId: 1 }] });
    const y26 = householdSpend(j, lk(), { from: '2026-01-01', to: '2026-12-31' });
    const y27 = householdSpend(j, lk(), { from: '2027-01-01', to: '2027-12-31' });
    const all = householdSpend(j, lk());
    expect(y26.totalCents + y27.totalCents).toBe(all.totalCents);
    expect(all.totalCents).toBe(4000);
    expect([y26.totalCents, y27.totalCents]).toEqual([4000, 0]);
    for (const h of [y26, y27, all]) invariants(h);
  });

  it('23. undated typed amounts count only under all time', () => {
    const a = asset(1, { purchaseCents: 90000, purchaseDate: null });
    const h = householdSpend(input({ assets: [a] }), lk());
    expect(h.totalCents).toBe(90000);
    expect(householdSpend(input({ assets: [a] }), lk(), { from: '2026-01-01', to: '2026-12-31' }).totalCents).toBe(0);
    const v = householdSpend(input({ visits: [visit(1, { date: '', paidManualCents: 700 })] }), lk());
    expect(v.totalCents).toBe(700);
    expect(householdSpend(input({ visits: [visit(1, { date: '', paidManualCents: 700 })] }), lk(), { from: '2026-01-01' }).totalCents).toBe(0);
  });

  it('24. assets at several levels of the hierarchy are one flat set: a payment is counted once however many levels reach it', () => {
    const t = txn(24, -15000);
    const home = asset(1, { type: 'property' }), kitchen = asset(2, { parentId: 1, type: 'area' }), oven = asset(3, { parentId: 2, type: 'appliance' });
    const i = input({ assets: [home, kitchen, oven], services: [work(1, 1, { txnRefs: [R(t)] }), work(2, 2, { txnRefs: [R(t)] }), work(3, 3, { txnRefs: [R(t)] })] });
    const h = householdSpend(i, lk(t));
    expect(h.totalCents).toBe(15000);
    expect(h.pieces[0].recordIds).toHaveLength(3);
    invariants(h);
  });

  it('25. a payment that Finance also attributes to a Project is counted once, the Project is context only, and no Project money is read', () => {
    const t = txn(25, -30000, { project: { projectId: 7 } } as Partial<Txn>);
    const h = householdSpend(input({ visits: [visit(1, { txnRefs: [R(t)] })], services: [work(1, 1, { txnRefs: [R(t)] })] }), lk(t));
    expect(h.totalCents).toBe(30000);
    expect(h.projectTaggedPieces).toBe(1);
    invariants(h);
  });

  it('26. the arrangement as a whole (a retainer payment) is a claim like any other and is deduplicated against the other module', () => {
    const t = txn(26, -5000);
    const h = householdSpend(input({ arrangements: [arrangement(1, { txnRefs: [R(t)] })], services: [work(1, 1, { txnRefs: [R(t)] })] }), lk(t));
    expect(h.totalCents).toBe(5000);
    expect(h.claims.map((c) => c.recordId).sort()).toEqual(['arrangement:1', 'service:1']);
    invariants(h);
  });
});

describe('S5-B equality with the module pages and the invariants on random data', () => {
  // a small deterministic generator (no Math.random): the same data every run
  const rng = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);

  function randomWorld(seed: number) {
    const r = rng(seed);
    const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];
    const txns: Txn[] = [];
    for (let id = 1; id <= 8; id++) {
      const n = r() < 0.4 ? 2 + Math.floor(r() * 2) : 0;
      const parts = Array.from({ length: n }, () => split(500 + Math.floor(r() * 5) * 500, pick([5, 6])));
      txns.push(txn(id, parts.length ? parts.reduce((t, p) => t + p.amountCents, 0) : r() < 0.15 ? 1500 : -(1000 + Math.floor(r() * 9) * 500), {
        date: pick(['2025-11-20', '2026-01-15', '2026-06-01', '2026-10-30']), ...(parts.length ? { splits: parts } : {}), ...(r() < 0.08 ? { transferTxnId: 99 } : {}),
      }));
    }
    const live = txns.map((t) => (r() < 0.1 ? { ...t, amountCents: t.amountCents - 100 } : t)).filter(() => r() > 0.05);
    const anyRef = (): TxnRef[] => {
      const out: TxnRef[] = [];
      const k = r() < 0.6 ? 0 : 1 + Math.floor(r() * 2);
      for (let q = 0; q < k; q++) {
        const t = pick(txns);
        const ref = t.splits?.length && r() < 0.6 ? R(t, Math.floor(r() * t.splits.length)) : R(t);
        if (!out.some((x) => x.txnId === ref.txnId && x.splitIndex === ref.splitIndex)) out.push(ref);
      }
      // a whole and a part of the same transaction on one record is invalid input for the editors; keep it valid
      return out.filter((x, _i, all) => x.splitIndex === undefined || !all.some((y) => y.txnId === x.txnId && y.splitIndex === undefined));
    };
    const date = () => pick(['2025-12-31', '2026-01-01', '2026-05-05', '2026-09-09', '2026-10-31']);
    const typed = () => (r() < 0.25 ? 500 * (1 + Math.floor(r() * 6)) : null);
    const visits: VisitRecord[] = [], services: ServiceRecord[] = [], pairs: PairLink[] = [];
    for (let i = 1; i <= 8; i++) {
      const refs = anyRef();
      visits.push(visit(i, { date: date(), status: pick(['completed', 'completed', 'skipped', 'cancelled'] as const), cancelledBy: null, txnRefs: refs, paidManualCents: refs.length ? null : typed() }));
    }
    for (let i = 1; i <= 8; i++) {
      const refs = anyRef();
      services.push(work(i, pick([1, 2, 3]), { date: date(), txnRefs: refs, costCents: refs.length ? null : typed() }));
    }
    for (let i = 1; i <= 8; i++) if (r() < 0.5) pairs.push({ visitId: 1 + Math.floor(r() * 9), serviceId: 1 + Math.floor(r() * 9) });
    const assets = [asset(1), asset(2, { parentId: 1 }), asset(3, { purchaseCents: r() < 0.5 ? 10000 : null, purchaseDate: date() })];
    return { world: input({ assets, visits, services, pairs, arrangements: [arrangement(1, { txnRefs: anyRef() })] }), lookup: (id: number) => live.find((t) => t.id === id) };
  }

  it('on 300 random worlds every claim has one status, the included claims add up to the total, and the difference from the module pages is explained exactly (all time and for two periods)', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const { world, lookup } = randomWorld(seed);
      for (const p of [{}, { from: '2026-01-01', to: '2026-12-31' }, { from: '2025-01-01', to: '2025-12-31' }]) {
        const h = householdSpend(world, lookup, p);
        invariants(h);
      }
    }
  });

  it('each module total equals its own page: Home & Assets (the H3 spend over the same records) and Household Services (servicesSpend), all time', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const { world, lookup } = randomWorld(seed);
      const h = householdSpend(world, lookup);
      expect(h.homeCents).toBe(spend(costRecords(world.assets, world.homeServices), lookup).totalCents);
      expect(h.servicesCents).toBe(servicesSpend(payRecords(world.arrangements, world.visits), lookup).totalCents);
    }
  });

  it('a calendar year equals the Home & Assets overview figure for that year', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const { world, lookup } = randomWorld(seed);
      const h = householdSpend(world, lookup, { from: '2026-01-01', to: '2026-12-31' });
      expect(h.homeCents).toBe(buildSpending(world.assets, world.homeServices, lookup, '2026').household.totalCents);
    }
  });

  it('the answer does not depend on the order the records arrive in', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const { world, lookup } = randomWorld(seed);
      const a = householdSpend(world, lookup);
      const b = householdSpend({ ...world, visits: [...world.visits].reverse(), homeServices: [...world.homeServices].reverse(), assets: [...world.assets].reverse(), arrangements: [...world.arrangements].reverse(), pairs: [...world.pairs].reverse() }, lookup);
      expect(b.totalCents).toBe(a.totalCents);
      expect([b.financeCents, b.typedCents, b.linkedInBothCents]).toEqual([a.financeCents, a.typedCents, a.linkedInBothCents]);
      expect(b.claims.map((c) => `${c.recordId}|${c.key ?? ''}|${c.status}|${c.cents}`).sort()).toEqual(a.claims.map((c) => `${c.recordId}|${c.key ?? ''}|${c.status}|${c.cents}`).sort());
    }
  });

  it('a linked job is never counted twice and never dropped: with a pair, the typed total is at most the sum of the two sides and at least the larger one', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const typedV = 100 * (1 + (seed % 7)), typedS = 100 * (1 + (seed % 5));
      const h = householdSpend(input({ visits: [visit(1, { paidManualCents: typedV })], services: [work(1, 1, { costCents: typedS })], pairs: [{ visitId: 1, serviceId: 1 }] }), lk());
      expect(h.totalCents).toBe(typedV);
    }
  });

  it('pairsFromLinks reads only live recorded-as links between a visit and a service record', () => {
    const base = { id: 1, fromModule: 'services', toModule: 'assets', type: 'recorded-as', createdAt: 1, updatedAt: 1 };
    const links = [
      { ...base, fromId: 'visit:5', toId: 'service:9' },
      { ...base, id: 2, fromId: 'visit:5', toId: 'service:9' },
      { ...base, id: 3, fromId: 'visit:6', toId: 'service:9', deletedAt: 5 },
      { ...base, id: 4, fromId: 'task:1', toId: 'service:2' },
      { ...base, id: 5, type: 'serves', fromId: 'visit:7', toId: 'service:3' },
    ] as unknown as Parameters<typeof pairsFromLinks>[0];
    expect(pairsFromLinks(links)).toEqual([{ visitId: 5, serviceId: 9 }]);
  });
});
