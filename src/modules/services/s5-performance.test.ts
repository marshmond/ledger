import { describe, expect, it } from 'vitest';
import type { Txn } from '../../types';
import { makeTxnRef, type TxnRef } from '../../lib/txnRef';
import { blankAsset, type AssetRecord } from '../assets/model';
import { blankService, type ServiceRecord } from '../assets/service';
import { householdSpend, type PairLink } from './householdSpend';
import { buildInsights, reliableAmounts } from './insights';
import { blankArrangement, type ArrangementRecord, type Cadence } from './model';
import { resolvePeriod } from './periods';
import { payRecords, typicalCost } from './servicesSpend';
import { blankVisit, type VisitRecord } from './visitModel';

/** S5 reliability and performance on synthetic data (invented). Operation COUNTS are asserted (deterministic); one generous clock ceiling guards gross regressions. */
const TODAY = '2026-11-06';
const rec = <T,>(id: number, data: T) => ({ id, createdAt: id, updatedAt: id, data });
const weekly2: Cadence = { mode: 'fixed', rule: { freq: 'weekly', interval: 2, end: { type: 'never' } }, anchorDate: '2026-01-02' };
const rng = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const day = (k: number) => new Date(Date.UTC(2025, 0, 1) + (k % 600) * 86400000).toISOString().slice(0, 10);

function world(n: number, seed = 7) {
  const r = rng(seed);
  const txns: Txn[] = Array.from({ length: n }, (_, k) => ({ id: k + 1, accountId: 1, date: day(k * 3), amountCents: -(1000 + Math.floor(r() * 90) * 100), payee: `P${k}`, memo: '', status: 'cleared', categoryId: 5 }) as Txn);
  const byId = new Map(txns.map((t) => [t.id as number, t]));
  let lookups = 0;
  const lookup = (id: number) => { lookups++; return byId.get(id); };
  const ref = (): TxnRef[] => (r() < 0.6 ? [makeTxnRef(txns[Math.floor(r() * n)])] : []);
  const arrangements: ArrangementRecord[] = Array.from({ length: Math.max(3, Math.round(n / 70)) }, (_, k) => rec(k + 1, blankArrangement({ title: `Service ${k}`, cadence: weekly2, providerContactId: k + 1, providerNameSnapshot: `Provider ${k}` })));
  const visits: VisitRecord[] = Array.from({ length: n }, (_, k) => {
    const refs = ref();
    return rec(k + 1, blankVisit({ title: `Visit ${k}`, arrangementId: 1 + (k % arrangements.length), providerContactId: 1 + (k % arrangements.length), date: day(k), status: 'completed', txnRefs: refs, paidManualCents: refs.length || r() < 0.5 ? null : 1000 + Math.floor(r() * 50) * 100 }));
  });
  const assets: AssetRecord[] = Array.from({ length: 40 }, (_, k) => rec(k + 1, blankAsset({ name: `Asset ${k}`, parentId: k > 5 ? 1 + (k % 5) : null })));
  const homeServices: ServiceRecord[] = Array.from({ length: Math.round(n / 2) }, (_, k) => { const refs = ref(); return rec(k + 1, blankService(1 + (k % 40), { title: `Work ${k}`, date: day(k * 2), txnRefs: refs, costCents: refs.length || r() < 0.5 ? null : 2000 })); });
  const pairs: PairLink[] = Array.from({ length: Math.round(n / 8) }, (_, k) => ({ visitId: k * 8 + 1, serviceId: (k % Math.max(1, homeServices.length)) + 1 }));
  return { assets, homeServices, arrangements, visits, pairs, lookup, lookups: () => lookups, reset: () => { lookups = 0; } };
}

describe('S5 performance: the household total and the insights grow linearly with the number of records', () => {
  it('Finance lookups are one per reference, not per pair of records: 4x the data costs about 4x the lookups', () => {
    const small = world(500), big = world(2000);
    householdSpend(small, small.lookup, { from: '2026-01-01', to: '2026-12-31' });
    const a = small.lookups();
    householdSpend(big, big.lookup, { from: '2026-01-01', to: '2026-12-31' });
    const b = big.lookups();
    expect(a).toBeGreaterThan(0);
    expect(b / a).toBeLessThan(5); // 4x data; a quadratic method would be ~16x
  });

  it('5,000 visits, 2,500 asset records and 1,000+ transactions: the household total, reconciliation and insights finish well inside a second or two', () => {
    const w = world(5000);
    const t0 = Date.now();
    const h = householdSpend(w, w.lookup);
    const all = payRecords(w.arrangements, w.visits);
    buildInsights({
      today: TODAY, arrangements: w.arrangements, visits: w.visits, payAll: all, lookup: w.lookup, schedule: new Map(), period: resolvePeriod('last12', TODAY),
      unloggedArrangementIds: new Set(), assetIdsBy: new Map(), recordedVisitIds: new Set(),
    });
    const ms = Date.now() - t0;
    expect(h.reconciliation.reconciles).toBe(true);
    expect(h.reconciliation.explainsDifference).toBe(true);
    expect(ms).toBeLessThan(6000); // a generous ceiling: measured far lower; it exists to catch an accidental quadratic loop
  }, 30000);

  it('the indexed "reliable payment" the insights use agrees with the S3 typical price for every arrangement', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const w = world(400, seed);
      const all = payRecords(w.arrangements, w.visits);
      const rel = reliableAmounts(w.visits, all, w.lookup);
      for (const a of w.arrangements) {
        const vs = w.visits.filter((v) => v.data.arrangementId === a.id);
        const t = typicalCost(vs, all, w.lookup);
        const mine = vs.map((v) => rel.get(v.id) ?? null).filter((c): c is number => c !== null);
        expect(mine.length).toBe(t.sample);
        if (t.enough) {
          const s = [...mine].sort((x, y) => x - y), m = Math.floor(s.length / 2);
          expect(s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2)).toBe(t.medianCents);
        }
      }
    }
  });

  it('the claim list is complete but bounded in what it creates: one claim per payment reference or typed amount, nothing per pair of records', () => {
    const w = world(1500);
    const h = householdSpend(w, w.lookup);
    const refs = payRecords(w.arrangements, w.visits).reduce((t, r) => t + r.refs.length, 0) + w.homeServices.reduce((t, s) => t + s.data.txnRefs.length, 0);
    const typed = w.visits.filter((v) => !v.data.txnRefs.length && v.data.paidManualCents !== null).length + w.homeServices.filter((s) => !s.data.txnRefs.length && s.data.costCents !== null).length;
    expect(h.claims.length).toBeLessThanOrEqual(refs + typed);
    expect(h.claims.length).toBeGreaterThan(refs / 2);
  });
});
