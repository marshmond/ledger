import { describe, expect, it } from 'vitest';
import type { Txn } from '../../types';
import { chooseCost, initialChoice } from './costSource';
import { blankAsset, type AssetData, type AssetRecord } from './model';
import { blankService, costFromText, validateService, type ServiceData, type ServiceRecord } from './service';
import { assetSpend, costRecords, pieceUsers, spend, subtreeIds } from './spending';
import { checkNewRefs, isSpendingTxn, makeTxnRef, readTxnRefs, resolveRef, validateTxnRefs, type TxnRef } from './txnRef';
import { validateAsset } from './validate';

/** Invented data only. Money is whole cents; Finance outflows are negative. */
const T = (id: number, amountCents: number, over: Partial<Txn> = {}): Txn => ({ id, accountId: 1, date: '2026-03-02', amountCents, payee: 'Hardware Co', memo: '', status: 'cleared', categoryId: 5, ...over });
const split = (id: number, parts: [number, number | null][], over: Partial<Txn> = {}) => {
  const splits = parts.map(([a, c]) => ({ amountCents: a, categoryId: c }));
  return T(id, splits.reduce((s, x) => s + x.amountCents, 0), { categoryId: null, splits, ...over });
};
const look = (...ts: Txn[]) => { const m = new Map(ts.map((t) => [t.id!, t])); return (id: number) => m.get(id); };

const A = (id: number, over: Partial<AssetData> = {}): AssetRecord => ({ id, createdAt: id, updatedAt: id, data: blankAsset({ name: `Asset ${id}`, ...over }) });
const S = (id: number, assetId: number, over: Partial<ServiceData> = {}): ServiceRecord => ({ id, createdAt: id, updatedAt: id, data: blankService(assetId, { title: `Work ${id}`, date: `2026-03-${String(10 + id).padStart(2, '0')}`, kind: 'repair', ...over }) });
const whole = (t: Txn) => makeTxnRef(t);
const part = (t: Txn, i: number) => makeTxnRef(t, i);
const run = (assets: AssetRecord[], services: ServiceRecord[], lookup: (id: number) => Txn | undefined) => spend(costRecords(assets, services), lookup);

describe('H3 amounts: typed, from Finance, unknown', () => {
  it('1. a typed purchase price is counted as typed', () => {
    const r = run([A(1, { purchaseCents: 50000 })], [], look());
    expect(r.totalCents).toBe(50000);
    expect(r.manualCents).toBe(50000);
    expect(r.byGroup.acquisition).toBe(50000);
  });
  it('2. a typed service amount is counted as typed', () => {
    const r = run([A(1)], [S(1, 1, { costCents: 18000 })], look());
    expect(r.byGroup.maintenance).toBe(18000);
    expect(r.manualRecords).toBe(1);
  });
  it('3. unknown is not zero: a blank cost is listed as unknown, a typed 0 is a real $0', () => {
    const r = run([A(1)], [S(1, 1, { costCents: null }), S(2, 1, { costCents: 0 })], look());
    expect(r.unknown.map((u) => u.recordId)).toEqual(['service:1']);
    expect(r.manualRecords).toBe(1);
    expect(r.totalCents).toBe(0);
  });
  it('4. a purchase linked to a whole transaction uses the live amount', () => {
    const t = T(1, -120000);
    const r = run([A(1, { purchaseTxnRefs: [whole(t)] })], [], look(t));
    expect(r.financeCents).toBe(120000);
    expect(r.byGroup.acquisition).toBe(120000);
    expect(r.pieces).toHaveLength(1);
  });
  it('5. a purchase linked to ONE split counts only that part', () => {
    const t = split(1, [[-30000, 5], [-20000, 6]]);
    const r = run([A(1, { purchaseTxnRefs: [part(t, 1)] })], [], look(t));
    expect(r.financeCents).toBe(20000);
  });
  it('6. a service linked to a whole transaction', () => {
    const t = T(1, -8500);
    expect(run([A(1)], [S(1, 1, { txnRefs: [whole(t)] })], look(t)).byGroup.maintenance).toBe(8500);
  });
  it('7. a service linked to several pieces adds them', () => {
    const t1 = T(1, -8500), t2 = T(2, -1500), t3 = split(3, [[-1000, 5], [-2000, 6]]);
    const r = run([A(1)], [S(1, 1, { txnRefs: [whole(t1), whole(t2), part(t3, 0)] })], look(t1, t2, t3));
    expect(r.financeCents).toBe(11000);
    expect(r.pieces).toHaveLength(3);
  });
  it('8. money back (a refund) lowers the total', () => {
    const pay = T(1, -10000), refund = T(2, 2500, { payee: 'Hardware Co refund' });
    const r = run([A(1)], [S(1, 1, { txnRefs: [whole(pay), whole(refund)] })], look(pay, refund));
    expect(r.financeCents).toBe(7500);
  });
  it('9. transfers and setup entries never count and cannot be picked', () => {
    const tr = T(1, -50000, { transferTxnId: 2 });
    expect(isSpendingTxn(tr)).toBe(false);
    const ref: TxnRef = { txnId: 1, snapshot: { date: '2026-03-02', payee: 'x', amountCents: -50000 } };
    const r = run([A(1)], [S(1, 1, { txnRefs: [ref] })], look(tr));
    expect(r.totalCents).toBe(0);
    expect(r.review[0].resolved.state).toBe('not-spending');
    expect(checkNewRefs([ref], [], look(tr))).toMatch(/transfer/i);
  });
  it('a record that has both a typed amount and references uses the references and is flagged', () => {
    const t = T(1, -4000);
    const r = run([A(1)], [S(1, 1, { costCents: 99999, txnRefs: [whole(t)] })], look(t));
    expect(r.totalCents).toBe(4000);
    expect(r.both).toEqual(['service:1']);
  });
});

describe('H3 duplicates', () => {
  it('10. the same transaction on two records counts once, and the reuse is visible', () => {
    const t = T(1, -30000);
    const r = run([A(1)], [S(1, 1, { txnRefs: [whole(t)] }), S(2, 1, { kind: 'improvement', txnRefs: [whole(t)] })], look(t));
    expect(r.totalCents).toBe(30000);
    expect(r.sharedPieces).toHaveLength(1);
    expect(r.sharedPieces[0].recordIds).toEqual(['service:1', 'service:2']);
  });
  it('a purchase and a service sharing one piece count it once', () => {
    const t = T(1, -90000);
    const r = run([A(1, { purchaseTxnRefs: [whole(t)] })], [S(1, 1, { kind: 'improvement', txnRefs: [whole(t)] })], look(t));
    expect(r.totalCents).toBe(90000);
    expect(r.byGroup.acquisition).toBe(90000);
    expect(r.byGroup.other).toBe(0);
  });
  it('11. one piece on several assets counts once in an aggregate and each asset shows the reuse', () => {
    const t = T(1, -60000);
    const assets = [A(1, { type: 'property' }), A(2, { parentId: 1 }), A(3, { parentId: 1 })];
    const services = [S(1, 2, { txnRefs: [whole(t)] }), S(2, 3, { txnRefs: [whole(t)] })];
    expect(assetSpend(assets, services, 1, look(t)).combined.totalCents).toBe(60000);
    expect(assetSpend(assets, services, 2, look(t)).own.totalCents).toBe(60000); // each asset alone still shows it
    expect(assetSpend(assets, services, 3, look(t)).own.totalCents).toBe(60000);
    const users = pieceUsers(costRecords(assets, services)).get('1:w')!;
    expect(users.map((u) => u.assetId)).toEqual([2, 3]);
  });
  it('12. a whole transaction and one of its parts are the same money: counted once, whatever the order', () => {
    const t = split(1, [[-30000, 5], [-20000, 6]]);
    const a = [A(1)];
    const s1 = S(1, 1, { txnRefs: [whole(t)] }), s2 = S(2, 1, { txnRefs: [part(t, 0)] });
    for (const list of [[s1, s2], [s2, s1]]) {
      const r = run(a, list, look(t));
      expect(r.totalCents).toBe(50000);
      expect(r.coveredParts).toHaveLength(1);
    }
  });
  it('does not merge unrelated typed amounts that happen to match', () => {
    const r = run([A(1)], [S(1, 1, { costCents: 5000 }), S(2, 1, { costCents: 5000 })], look());
    expect(r.totalCents).toBe(10000);
  });
  it('the same piece twice on one record is refused at save, and a whole plus its part too', () => {
    const t = split(1, [[-30000, 5], [-20000, 6]]);
    expect(validateTxnRefs([whole(t), whole(t)])).toMatch(/twice/);
    expect(validateTxnRefs([whole(t), part(t, 0)])).toMatch(/twice|whole/);
    expect(validateTxnRefs([part(t, 0), part(t, 1)])).toBeNull();
    expect(readTxnRefs([whole(t), whole(t)])).toHaveLength(1);
  });
});

describe('H3 split and transaction integrity: never guess', () => {
  const t0 = () => split(1, [[-30000, 5], [-20000, 6], [-10000, 7]]);
  const lin = (t: Txn, i: number) => run([A(1)], [S(1, 1, { txnRefs: [part(t0(), i)] })], look(t));
  it('13. a reordered split is not silently attached to the other part', () => {
    const t = t0();
    const reordered = { ...t, splits: [t.splits![1], t.splits![0], t.splits![2]] };
    const r = lin(reordered, 0);
    expect(r.totalCents).toBe(0);
    expect(r.review).toHaveLength(1);
    expect(r.review[0].resolved.state).toBe('split-changed');
    expect(r.review[0].resolved.note).toMatch(/pick the part again/i);
  });
  it('14. a changed split amount needs review and the old amount is not used', () => {
    const t = t0();
    const edited = { ...t, splits: [{ ...t.splits![0], amountCents: -35000 }, t.splits![1], { ...t.splits![2], amountCents: -5000 }] };
    const r = lin(edited, 0);
    expect(r.totalCents).toBe(0);
    expect(r.financeCents).toBe(0);
    expect(r.review[0].resolved.spendCents).toBe(0);
  });
  it('a changed category also needs review', () => {
    const t = t0();
    expect(lin({ ...t, splits: t.splits!.map((s, i) => (i === 1 ? { ...s, categoryId: 99 } : s)) }, 1).review).toHaveLength(1);
  });
  it('15. a removed split part needs review', () => {
    const t = t0();
    const fewer = split(1, [[-50000, 5], [-10000, 7]]);
    expect(lin(fewer, 2).review[0].resolved.state).toBe('split-changed');
    expect(lin({ ...t, splits: undefined, categoryId: 5 }, 0).review[0].resolved.state).toBe('split-changed'); // no longer split at all
  });
  it('an untouched split keeps working, and a transaction whose other parts moved is re-checked as a whole', () => {
    const t = t0();
    expect(lin(t, 1).financeCents).toBe(20000);
  });
  it('a split reference with no fingerprint cannot be checked, so it is not counted', () => {
    const t = t0();
    const bare: TxnRef = { txnId: 1, splitIndex: 0, snapshot: { date: '2026-03-02', payee: 'x', amountCents: -30000 } };
    expect(run([A(1)], [S(1, 1, { txnRefs: [bare] })], look(t)).review).toHaveLength(1);
    expect(validateTxnRefs([bare])).toMatch(/not valid/);
  });
  it('16. a deleted transaction keeps the reference, counts nothing, and the snapshot is never used as an amount', () => {
    const t = T(1, -77700);
    const svcs = [S(1, 1, { txnRefs: [whole(t)] })];
    const r = run([A(1)], svcs, look());
    expect(r.totalCents).toBe(0);
    expect(r.review[0].resolved.state).toBe('missing');
    expect(r.review[0].resolved.note).toMatch(/deleted/);
    expect(svcs[0].data.txnRefs[0].snapshot.amountCents).toBe(-77700); // kept for explanation only
  });
  it('17. a changed payee or date is noted but the live transaction is still authoritative', () => {
    const t = T(1, -10000);
    const ref = whole(t);
    const live = { ...t, payee: 'Renamed Co', date: '2026-04-01', amountCents: -12000 };
    const x = resolveRef(ref, look(live));
    expect(x.state).toBe('changed');
    expect(x.needsReview).toBe(false);
    expect(x.spendCents).toBe(12000);
    expect(x.note).toMatch(/was/);
    const p = split(2, [[-100, 5], [-200, 6]]);
    const y = resolveRef(part(p, 1), look({ ...p, payee: 'Other' }));
    expect(y.state).toBe('changed');
    expect(y.spendCents).toBe(200);
  });
  it('a transaction that is later turned into a transfer stops counting', () => {
    const t = T(1, -10000);
    const r = run([A(1)], [S(1, 1, { txnRefs: [whole(t)] })], look({ ...t, transferTxnId: 9 }));
    expect(r.totalCents).toBe(0);
    expect(r.review[0].resolved.state).toBe('not-spending');
  });
  it('references already on a record are not re-checked on save, so a stale record can still be edited; new ones are checked', () => {
    const t = T(1, -10000);
    const old = whole(t);
    expect(checkNewRefs([old], [old], look())).toBeNull();
    expect(checkNewRefs([old], [], look())).toMatch(/no longer exists/);
    expect(checkNewRefs([part(split(2, [[-1, 5], [-2, 6]]), 0)], [], look())).toMatch(/no longer exists/);
  });
  it('stale references stay out of the verified total but the good ones still count', () => {
    const good = T(1, -5000), gone = T(2, -9000);
    const r = run([A(1)], [S(1, 1, { txnRefs: [whole(good), whole(gone)] })], look(good));
    expect(r.totalCents).toBe(5000);
    expect(r.review).toHaveLength(1);
  });
});

describe('H3 hierarchy rollups', () => {
  it('18. a property shows its own, what is inside, and the combined figure', () => {
    const t1 = T(1, -400000), t2 = T(2, -25000);
    const assets = [A(1, { type: 'property', purchaseTxnRefs: [whole(t1)] }), A(2, { parentId: 1 }), A(3, { parentId: 2, purchaseCents: 10000 })];
    const services = [S(1, 2, { txnRefs: [whole(t2)] }), S(2, 3, { costCents: 5000 })];
    const r = assetSpend(assets, services, 1, look(t1, t2));
    expect(r.own.totalCents).toBe(400000);
    expect(r.insideCents).toBe(25000 + 5000 + 10000);
    expect(r.combined.totalCents).toBe(440000);
    expect(r.hasInside).toBe(true);
    expect(assetSpend(assets, services, 3, look(t1, t2)).hasInside).toBe(false);
  });
  it('19. several descendants referencing one transaction count it once, and not again if the property also has it', () => {
    const t = T(1, -100000);
    const assets = [A(1, { type: 'property', purchaseTxnRefs: [whole(t)] }), A(2, { parentId: 1 }), A(3, { parentId: 1 })];
    const services = [S(1, 2, { txnRefs: [whole(t)] }), S(2, 3, { txnRefs: [whole(t)] })];
    const r = assetSpend(assets, services, 1, look(t));
    expect(r.combined.totalCents).toBe(100000);
    expect(r.insideCents).toBe(0);
    expect(r.combined.sharedPieces[0].recordIds).toHaveLength(3);
  });
  it('20. a loop or a missing parent cannot hang or double count', () => {
    const t = T(1, -1000);
    const assets = [A(1, { parentId: 2, purchaseTxnRefs: [whole(t)] }), A(2, { parentId: 1 }), A(3, { parentId: 99 }), A(4, { parentId: 4 })];
    expect([...subtreeIds(assets, 1)].sort()).toEqual([1, 2]);
    expect(assetSpend(assets, [S(1, 2, { txnRefs: [whole(t)] })], 1, look(t)).combined.totalCents).toBe(1000);
    expect([...subtreeIds(assets, 4)]).toEqual([4]);
    expect(subtreeIds(assets, 3).size).toBe(1);
    expect(assetSpend(assets, [S(9, 77, { costCents: 5 })], 3, look()).combined.totalCents).toBe(0); // a record for a missing asset is ignored
  });
  it('typed amounts inside are added as typed (never merged by value)', () => {
    const assets = [A(1, { type: 'property' }), A(2, { parentId: 1 })];
    const r = assetSpend(assets, [S(1, 1, { costCents: 3000 }), S(2, 2, { costCents: 3000 })], 1, look());
    expect(r.combined.totalCents).toBe(6000);
    expect(r.insideManualCents).toBe(3000);
  });
});

describe('H3 forms: either/or and validation', () => {
  it('a service or an asset cannot save both a typed amount and references', () => {
    const t = T(1, -100);
    const today = { today: '2026-11-06', contactExists: () => true };
    expect(validateService(blankService(1, { title: 'x', date: '2026-11-01', costCents: 5, txnRefs: [whole(t)] }), today)).toMatch(/either typed or taken from Finance/);
    expect(validateService(blankService(1, { title: 'x', date: '2026-11-01', costCents: null, txnRefs: [whole(t)] }), today)).toBeNull();
    expect(validateAsset(blankAsset({ name: 'x', purchaseCents: 5, purchaseTxnRefs: [whole(t)] }), undefined, () => undefined)).toMatch(/not both/);
  });
  it('switching sources names what would be removed and never drops it silently', () => {
    const t = T(1, -100);
    expect(chooseCost('finance', '125.00', [whole(t)], costFromText)).toMatchObject({ cents: null, dropped: 'the typed amount ($125.00)' });
    expect(chooseCost('finance', '', [whole(t)], costFromText).dropped).toBeNull();
    expect(chooseCost('manual', '10', [whole(t)], costFromText)).toMatchObject({ cents: 1000, refs: [] });
    expect(chooseCost('manual', '10', [whole(t)], costFromText).dropped).toMatch(/link to 1 Finance transaction/);
    expect(chooseCost('manual', 'abc', [], costFromText).badAmount).toBe(true);
    expect(chooseCost('manual', '', [], costFromText)).toMatchObject({ cents: null, refs: [], dropped: null });
    expect(initialChoice(500, [whole(t)])).toBe('finance');
    expect(initialChoice(500, [])).toBe('manual');
  });
  it('the reader drops junk references and never throws', () => {
    expect(readTxnRefs('nope')).toEqual([]);
    expect(readTxnRefs([null, 3, { txnId: 'x' }, { txnId: 4, splitIndex: -1 }, { txnId: 5, snapshot: 7 }])).toEqual([{ txnId: 5, snapshot: { date: '', payee: '', amountCents: 0 } }]);
  });
});
