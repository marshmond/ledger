import { describe, expect, it } from 'vitest';
import type { Txn } from '../../types';
import { makeTxnRef } from '../../lib/txnRef';
import { addDays } from '../../lib/dates';
import { buildInsights, MAX_INSIGHTS, providerBreakdown, UNUSUAL_MIN_DIFF_CENTS, type InsightInput } from './insights';
import { blankArrangement, type ArrangementRecord, type Cadence } from './model';
import { periodChoices, resolvePeriod } from './periods';
import { payRecords, providerKeyOf, servicesSpend } from './servicesSpend';
import { blankVisit, type VisitRecord } from './visitModel';
import type { ScheduleState } from './expectedCharges';

/** S5-C insights and periods. Pure and in memory; invented data. */
const TODAY = '2026-11-06';
const rec = <T,>(id: number, data: T) => ({ id, createdAt: id, updatedAt: id, data });
const arr = (id: number, over: Partial<ArrangementRecord['data']> = {}): ArrangementRecord => rec(id, blankArrangement({ title: `Service ${id}`, providerContactId: id, providerNameSnapshot: `Provider ${id}`, ...over }));
const vis = (id: number, arrangementId: number, over: Partial<VisitRecord['data']> = {}): VisitRecord => rec(id, blankVisit({ title: `Visit ${id}`, arrangementId, providerContactId: arrangementId, providerNameSnapshot: `Provider ${arrangementId}`, status: 'completed', date: '2026-10-01', ...over }));
const txn = (id: number, amountCents: number, over: Partial<Txn> = {}): Txn => ({ id, accountId: 1, date: '2026-10-01', amountCents, payee: `Payee ${id}`, memo: '', status: 'cleared', categoryId: 5, ...over } as Txn);
const weekly2: Cadence = { mode: 'fixed', rule: { freq: 'weekly', interval: 2, end: { type: 'never' } }, anchorDate: '2026-01-02' };
const monthly: Cadence = { mode: 'fixed', rule: { freq: 'monthly', interval: 1, end: { type: 'never' } }, anchorDate: '2026-01-15' };
const typed = (id: number, aid: number, date: string, cents: number) => vis(id, aid, { date, paidManualCents: cents });

function input(over: Partial<InsightInput> & { arrangements: ArrangementRecord[]; visits: VisitRecord[] }, lookupTxns: Txn[] = []): InsightInput {
  const m = new Map(lookupTxns.map((t) => [t.id as number, t]));
  return {
    today: TODAY, payAll: payRecords(over.arrangements, over.visits), lookup: (id) => m.get(id), schedule: new Map<number, ScheduleState>(), period: resolvePeriod('last12', TODAY),
    unloggedArrangementIds: new Set(), assetIdsBy: new Map(), recordedVisitIds: new Set(), ...over,
  };
}
const ids = (i: InsightInput) => buildInsights(i, (c) => `[${c}]`).map((x) => x.id);

describe('S5-C periods', () => {
  it('each named period is a range of whole days with the comparable prior period right before it', () => {
    expect(resolvePeriod('last30', TODAY)).toMatchObject({ range: { from: '2026-10-08', to: TODAY }, prior: { range: { from: '2026-09-08', to: '2026-10-07' } } });
    expect(resolvePeriod('last90', TODAY).range).toEqual({ from: '2026-08-09', to: TODAY });
    expect(resolvePeriod('last12', TODAY)).toMatchObject({ range: { from: '2025-11-07', to: TODAY }, prior: { range: { from: '2024-11-07', to: '2025-11-06' } } });
    expect(resolvePeriod('ytd', TODAY)).toMatchObject({ range: { from: '2026-01-01', to: TODAY }, prior: { range: { from: '2025-01-01', to: '2025-11-06' } } });
    expect(resolvePeriod('2025', TODAY)).toMatchObject({ range: { from: '2025-01-01', to: '2025-12-31' }, prior: { range: { from: '2024-01-01', to: '2024-12-31' } } });
    expect(resolvePeriod('all', TODAY)).toMatchObject({ range: {}, prior: null });
    expect(resolvePeriod('banana', TODAY).id).toBe('last12');
  });
  it('the prior period never overlaps the current one, including across a leap day', () => {
    for (const today of ['2028-02-29', '2027-03-01', '2026-12-31', '2026-01-01']) for (const id of ['last30', 'last90', 'last12', 'ytd', String(Number(today.slice(0, 4)) - 1)]) {
      const p = resolvePeriod(id, today);
      expect(p.prior!.range.to! < p.range.from!).toBe(true);
    }
  });
  it('offers the fixed periods, then only past years that have something dated', () => {
    expect(periodChoices(TODAY, ['2024', '2026', '2025', 'x']).map((c) => c.id)).toEqual(['last12', 'last90', 'last30', 'ytd', '2025', '2024', 'all']);
  });
});

describe('S5-C insights: honest, deterministic, supported by records', () => {
  it('trend: compares recorded Services payments with the comparable prior period, in neutral words, and says what is not known', () => {
    const arrs = [arr(1)];
    const visits = [typed(1, 1, '2026-09-10', 30000), typed(2, 1, '2025-09-10', 20000)];
    const out = buildInsights(input({ arrangements: arrs, visits }), (c) => `$${c / 100}`);
    const t = out.find((x) => x.id === 'trend')!;
    expect(t.detail).toContain('$300 was recorded');
    expect(t.detail).toContain('50% higher than the $200 recorded for the 12 months before that');
    expect(t.detail).toMatch(/Only recorded payments are counted/);
    // about the same, and nothing to compare with
    const same = buildInsights(input({ arrangements: arrs, visits: [typed(1, 1, '2026-09-10', 20500), typed(2, 1, '2025-09-10', 20000)] }), (c) => `$${c / 100}`).find((x) => x.id === 'trend')!;
    expect(same.detail).toContain('about the same');
    const none = buildInsights(input({ arrangements: arrs, visits: [typed(1, 1, '2026-09-10', 100)] }), (c) => `$${c}`).find((x) => x.id === 'trend')!;
    expect(none.detail).toContain('Nothing was recorded for the 12 months before that');
    expect(ids(input({ arrangements: arrs, visits: [] }))).toEqual([]);                       // no payments at all: nothing to say
    expect(ids(input({ arrangements: arrs, visits: visits, period: resolvePeriod('all', TODAY) }))).not.toContain('trend'); // all time has no prior
    expect(JSON.stringify(out)).not.toMatch(/fraud|error|overcharg|mistake|wrong/i);
  });

  it('expected: a per-visit estimate times the schedule\'s own dates over the 12-month horizon, kept apart from what was recorded; per-month estimates are not converted', () => {
    const a = arr(1, { cadence: weekly2, expected: { basis: 'perVisit', cents: 10000 } });
    const b = arr(2, { cadence: monthly, expected: { basis: 'perMonth', cents: 5000 } });
    const sched = new Map<number, ScheduleState>([[1, { openDue: '2026-11-13', openOccurrence: '2026-11-13', lastDoneOccurrence: null }]]);
    const out = buildInsights(input({ arrangements: [a, b], visits: [typed(1, 1, '2026-10-01', 9000)], schedule: sched }), (c) => `$${c / 100}`);
    const e = out.find((x) => x.id === 'expected')!;
    expect(e.detail).toMatch(/\(an estimate:/);
    expect(e.detail).toMatch(/not a charge, a payment or spending/);
    expect(e.detail).toContain('$90 of payments were recorded');
    expect(e.detail).toMatch(/1 arrangement is not included/);
    // 12 months of every-other-Friday visits at $100: the open task (Nov 13) plus the later ones inside the horizon
    const n = Number(/About \$([\d,.]+)/.exec(e.detail)![1].replace(/,/g, '')) / 100;
    expect(n).toBeGreaterThanOrEqual(25);
    expect(n).toBeLessThanOrEqual(27);
    expect(ids(input({ arrangements: [arr(3, { cadence: weekly2 })], visits: [] }))).not.toContain('expected'); // no estimate, no figure
  });

  it('unusual cost: needs at least three OTHER reliable visits and a stable usual price; small differences and shared or unreliable payments never raise it', () => {
    const base = [typed(1, 1, '2026-08-01', 8000), typed(2, 1, '2026-08-15', 8200), typed(3, 1, '2026-09-01', 7900), typed(4, 1, '2026-09-20', 8100)];
    const high = typed(5, 1, '2026-11-01', 20000);
    expect(ids(input({ arrangements: [arr(1)], visits: [...base, high] }))).toContain('unusual:5');
    const low = typed(6, 1, '2026-11-01', 3000);
    expect(ids(input({ arrangements: [arr(1)], visits: [...base, low] }))).toContain('unusual:6');
    // thin history
    expect(ids(input({ arrangements: [arr(1)], visits: [base[0], base[1], high] }))).not.toContain('unusual:5');
    // a volatile (seasonal) usual price: ordinary variation, not a judgment
    const seasonal = [typed(1, 1, '2026-06-01', 3000), typed(2, 1, '2026-07-01', 9000), typed(3, 1, '2026-08-01', 4000), typed(4, 1, '2026-09-01', 8000)];
    expect(ids(input({ arrangements: [arr(1)], visits: [...seasonal, high] })).some((x) => x.startsWith('unusual'))).toBe(false);
    // a small absolute difference
    const cheap = [1, 2, 3, 4].map((k) => typed(k, 1, `2026-09-0${k}`, 100));
    expect(UNUSUAL_MIN_DIFF_CENTS).toBe(1000);
    expect(ids(input({ arrangements: [arr(1)], visits: [...cheap, typed(5, 1, '2026-11-01', 400)] })).some((x) => x.startsWith('unusual'))).toBe(false);
    // within the ratio
    expect(ids(input({ arrangements: [arr(1)], visits: [...base, typed(5, 1, '2026-11-01', 9500)] })).some((x) => x.startsWith('unusual'))).toBe(false);
    // an old visit is not "recent"
    expect(ids(input({ arrangements: [arr(1)], visits: [...base, typed(5, 1, '2026-03-01', 20000)] })).some((x) => x.startsWith('unusual'))).toBe(false);
    // a payment shared with another visit cannot be judged
    const t = txn(1, -20000);
    const sharedHigh = vis(5, 1, { date: '2026-11-01', txnRefs: [makeTxnRef(t)] });
    const sharedOther = vis(6, 1, { date: '2026-11-02', status: 'skipped', txnRefs: [makeTxnRef(t)] });
    expect(ids(input({ arrangements: [arr(1)], visits: [...base, sharedHigh, sharedOther] }, [t])).some((x) => x.startsWith('unusual'))).toBe(false);
    // a visit whose Finance link needs review is not judged either
    expect(ids(input({ arrangements: [arr(1)], visits: [...base, sharedHigh] }, [])).some((x) => x.startsWith('unusual'))).toBe(false);
    // the wording is information, never an accusation
    const w = buildInsights(input({ arrangements: [arr(1)], visits: [...base, high] }), (c) => `$${c / 100}`).find((x) => x.id === 'unusual:5')!;
    expect(w.detail).toContain('$200');
    expect(w.detail).toContain('$80.5');
    expect(w.detail).toMatch(/perfectly normal/);
  });

  it('gap: only a regular, active schedule with at least two completed visits; says the visit may simply not have been logged; never raised for an arrangement with a finished-not-logged visit', () => {
    const a = arr(1, { cadence: weekly2 });
    const old = [vis(1, 1, { date: '2026-05-01' }), vis(2, 1, { date: '2026-05-15' })];
    const out = buildInsights(input({ arrangements: [a], visits: old }), (c) => `$${c}`);
    const g = out.find((x) => x.id === 'gap:1')!;
    expect(g.detail).toMatch(/may only mean visits happened and were not logged/);
    
    expect(ids(input({ arrangements: [a], visits: [old[0]] }))).not.toContain('gap:1');           // one visit is too little history
    expect(ids(input({ arrangements: [a], visits: [vis(1, 1, { date: '2026-10-20' }), vis(2, 1, { date: '2026-10-27' })] }))).not.toContain('gap:1');
    expect(ids(input({ arrangements: [a], visits: old, unloggedArrangementIds: new Set([1]) }))).not.toContain('gap:1');
    expect(ids(input({ arrangements: [arr(1, { cadence: weekly2, status: 'paused' })], visits: old }))).not.toContain('gap:1');
    expect(ids(input({ arrangements: [arr(1, { cadence: null })], visits: old }))).not.toContain('gap:1');
    // skipped and cancelled visits are not completed visits
    expect(ids(input({ arrangements: [a], visits: [old[0], vis(2, 1, { date: '2026-05-15', status: 'skipped' })] }))).not.toContain('gap:1');
  });

  it('skips: two or more skipped or cancelled visits in 90 days are noted neutrally; one, or older ones, are not', () => {
    const a = arr(1);
    const out = buildInsights(input({ arrangements: [a], visits: [vis(1, 1, { date: '2026-10-20', status: 'skipped' }), vis(2, 1, { date: '2026-10-27', status: 'cancelled', cancelledBy: 'provider' })] }));
    const s = out.find((x) => x.id === 'skips:1')!;
    expect(s.detail).toMatch(/1 skipped, 1 cancelled by the provider/);
    expect(s.detail).toMatch(/never counted as service/);
    expect(ids(input({ arrangements: [a], visits: [vis(1, 1, { date: '2026-10-20', status: 'skipped' })] }))).not.toContain('skips:1');
    expect(ids(input({ arrangements: [a], visits: [vis(1, 1, { date: '2026-02-20', status: 'skipped' }), vis(2, 1, { date: '2026-02-27', status: 'skipped' })] }))).not.toContain('skips:1');
  });

  it('moves: three of the last six logged visits on a different day than scheduled; needs four logged visits first', () => {
    const mv = (id: number, date: string, occ: string) => vis(id, 1, { date, occurrence: occ, taskId: id });
    const four = [mv(1, '2026-10-02', '2026-10-01'), mv(2, '2026-10-09', '2026-10-08'), mv(3, '2026-10-16', '2026-10-15'), mv(4, '2026-10-22', '2026-10-22')];
    expect(ids(input({ arrangements: [arr(1)], visits: four }))).toContain('moves:1');
    expect(ids(input({ arrangements: [arr(1)], visits: four.slice(1) }))).not.toContain('moves:1');
    expect(ids(input({ arrangements: [arr(1)], visits: [mv(1, '2026-10-01', '2026-10-01'), mv(2, '2026-10-08', '2026-10-08'), mv(3, '2026-10-16', '2026-10-15'), mv(4, '2026-10-23', '2026-10-22')] }))).not.toContain('moves:1');
  });

  it('handoff: completed visits to a service that looks after an asset and were not recorded in Home & Assets are mentioned as optional; recorded ones are not', () => {
    const v = vis(1, 1, { date: '2026-10-20' });
    const base = { arrangements: [arr(1)], visits: [v], assetIdsBy: new Map([[1, [7]]]) };
    const h = buildInsights(input(base)).find((x) => x.id === 'handoff')!;
    expect(h.detail).toMatch(/optional/);
    expect(ids(input({ ...base, recordedVisitIds: new Set([1]) }))).not.toContain('handoff');
    expect(ids(input({ ...base, assetIdsBy: new Map() }))).not.toContain('handoff');
    expect(ids(input({ ...base, visits: [vis(1, 1, { date: '2026-02-01' })] }))).not.toContain('handoff');
    expect(ids(input({ ...base, visits: [vis(1, 1, { date: '2026-10-20', status: 'skipped' })] }))).not.toContain('handoff');
  });

  it('deterministic: the same records give the same insights whatever order they arrive in, and the list is capped', () => {
    const arrs = [1, 2, 3, 4, 5, 6].map((k) => arr(k, { cadence: weekly2 }));
    const visits = arrs.flatMap((a, k) => [vis(100 + k * 3, a.id, { date: '2026-05-01' }), vis(101 + k * 3, a.id, { date: '2026-05-15' }), vis(102 + k * 3, a.id, { date: '2026-10-20', status: 'skipped' }), vis(150 + k, a.id, { date: '2026-10-27', status: 'skipped' })]);
    const a = buildInsights(input({ arrangements: arrs, visits }));
    const b = buildInsights(input({ arrangements: [...arrs].reverse(), visits: [...visits].reverse() }));
    expect(b.map((x) => x.id)).toEqual(a.map((x) => x.id));
    expect(b).toEqual(a);
    expect(a.length).toBeLessThanOrEqual(MAX_INSIGHTS);
    expect(buildInsights(input({ arrangements: arrs, visits }))).toEqual(a);
  });

  it('deterministic where the answer depends on which visits are newest (dates that move) and which are listed first (unrecorded visits)', () => {
    const mv = (id: number, date: string, occ: string) => vis(id, 1, { date, occurrence: occ, taskId: id });
    const visits = [mv(300, '2026-10-02', '2026-10-01'), mv(301, '2026-10-09', '2026-10-08'), mv(302, '2026-10-16', '2026-10-15'), mv(303, '2026-10-22', '2026-10-22'), mv(304, '2026-09-22', '2026-09-22'), mv(305, '2026-09-15', '2026-09-14'), mv(306, '2026-08-20', '2026-08-20'), mv(307, '2026-08-27', '2026-08-27')];
    const assetIdsBy = new Map([[1, [9]]]);
    const a = buildInsights(input({ arrangements: [arr(1)], visits, assetIdsBy }));
    const b = buildInsights(input({ arrangements: [arr(1)], visits: [...visits].reverse(), assetIdsBy }));
    expect(a.map((x) => x.id)).toEqual(expect.arrayContaining(['moves:1', 'handoff']));
    expect(b).toEqual(a);
    expect(a.find((x) => x.id === 'handoff')!.links.map((l) => l.label)).toEqual(['Visit 303 (2026-10-22)', 'Visit 302 (2026-10-16)', 'Visit 301 (2026-10-09)']);
  });

  it('every insight names the records it rests on and money only appears through the money function', () => {
    const base = [typed(1, 1, '2026-08-01', 8000), typed(2, 1, '2026-08-15', 8200), typed(3, 1, '2026-09-01', 7900), typed(4, 1, '2026-09-20', 8100), typed(5, 1, '2026-11-01', 20000)];
    const out = buildInsights(input({ arrangements: [arr(1, { expected: { basis: 'perVisit', cents: 12345 }, cadence: weekly2 })], visits: base, schedule: new Map([[1, { openDue: '2026-11-13', openOccurrence: '2026-11-13', lastDoneOccurrence: null }]]) }), () => '[money]');
    const text = JSON.stringify(out);
    for (const digits of ['20000', '8000', '12345', '$200', '$80']) expect(text).not.toContain(digits);
    for (const x of out) expect(x.kind === 'trend' || x.evidence.length > 0).toBe(true);
  });
});

describe('S5-C by provider: unambiguous attribution only; the rows and the shared line always add up to the total', () => {
  it('a payment reached by two providers\' records is shared, never given to either', () => {
    const t = txn(1, -10000), u = txn(2, -4000);
    const visits = [
      vis(1, 1, { txnRefs: [makeTxnRef(t)] }), vis(2, 2, { txnRefs: [makeTxnRef(t)] }),   // one payment, two providers
      vis(3, 1, { txnRefs: [makeTxnRef(u)] }), typed(4, 2, '2026-10-05', 2500),
    ];
    const arrs = [arr(1), arr(2)];
    const all = payRecords(arrs, visits);
    const m = new Map([[1, t], [2, u]]);
    const b = providerBreakdown(all, (id) => m.get(id), {}, (k) => k);
    expect(b.sharedCents).toBe(10000);
    expect(Object.fromEntries(b.rows.map((r) => [r.providerKey, r.cents]))).toEqual({ [providerKeyOf(2, 'Provider 2')]: 2500, [providerKeyOf(1, 'Provider 1')]: 4000 });
    expect(b.rows.reduce((s, r) => s + r.cents, 0) + b.sharedCents).toBe(b.totalCents);
    expect(b.totalCents).toBe(servicesSpend(all, (id) => m.get(id)).totalCents);
  });
  it('a whole transaction of one provider that covers a part linked by another provider is shared too', () => {
    const t = txn(1, -10000, { splits: [{ amountCents: -3000, categoryId: 5 }, { amountCents: -7000, categoryId: 6 }] });
    const visits = [vis(1, 1, { txnRefs: [makeTxnRef(t)] }), vis(2, 2, { txnRefs: [makeTxnRef(t, 0)] })];
    const all = payRecords([arr(1), arr(2)], visits);
    const b = providerBreakdown(all, () => t, {}, (k) => k);
    expect(b.sharedCents).toBe(10000);
    expect(b.rows).toEqual([]);
  });
  it('holds for a period too, and for every deterministic mix', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const ts = [1, 2, 3, 4].map((k) => txn(k, -1000 * k * (1 + (seed % 3)), { date: seed % 2 ? '2026-10-01' : '2025-10-01' }));
      const visits = [1, 2, 3, 4, 5, 6].map((k) => vis(k, 1 + ((k + seed) % 3), k % 3 === 0 ? { date: '2026-09-0' + k, paidManualCents: 700 * k } : { txnRefs: [makeTxnRef(ts[(k + seed) % 4])], date: '2026-09-1' + k }));
      const all = payRecords([arr(1), arr(2), arr(3)], visits);
      const lookup = (id: number) => ts.find((x) => x.id === id);
      for (const range of [{}, { from: '2026-01-01', to: '2026-12-31' }, { from: addDays(TODAY, -90), to: TODAY }]) {
        const b = providerBreakdown(all, lookup, range, (k) => k);
        expect(b.rows.reduce((s, r) => s + r.cents, 0) + b.sharedCents).toBe(b.totalCents);
      }
    }
  });
});
