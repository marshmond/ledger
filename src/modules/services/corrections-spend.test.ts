import { describe, expect, it } from 'vitest';
import { FinanceDB } from '../../db';
import { dexieMeta, RemoteConflict, SyncEngine, type RemoteFile, type RemoteStore } from '../../lib/sync/engine';
import { installTracking } from '../../lib/sync/track';
import { loadTxnMap, lookupOfMap } from '../../lib/txnLookup';
import { makeTxnRef } from '../../lib/txnRef';
import type { Txn } from '../../types';
import { createArrangement, loadArrangements } from './data';
import { blankArrangement } from './model';
import { setVisitPayment } from './payments';
import { forArrangement, forProvider, payRecords, servicesSpend, PAY_BUCKETS } from './servicesSpend';
import { loadVisits, logStandaloneVisit, type VisitInput } from './visits';

/** Pre-commit correction, finding 1: a payment shared by visits with DIFFERENT outcomes is never credited whole to one of them. Invented data. */
let n = 0;
const fresh = () => { const d = new FinanceDB(`test-corr1-${n++}`); installTracking(d); return d; };
const TODAY = '2026-11-06';
const addTxn = (d: FinanceDB, amountCents: number, over: Partial<Txn> = {}) => d.txns.add({ accountId: 1, date: '2026-11-01', amountCents, payee: 'Pat Pools', memo: '', status: 'cleared', categoryId: 5, ...over } as Txn) as Promise<number>;
const ref = async (d: FinanceDB, id: number, split?: number) => makeTxnRef((await d.txns.get(id))!, split);
const arr = async (d: FinanceDB, title = 'Pool service', name = 'Pat Pools') => (await createArrangement({ data: blankArrangement({ title }), provider: { name }, today: TODAY }, d)).id;
async function visit(d: FinanceDB, arrangementId: number, over: Partial<VisitInput> = {}) {
  const input: VisitInput = { status: 'completed', cancelledBy: null, date: '2026-10-05', title: 'Pool service', chargedCents: null, chargeKind: null, ...over };
  return (await logStandaloneVisit({ arrangementId, input, today: TODAY }, d)).visitId;
}
const cancelled: Partial<VisitInput> = { status: 'cancelled', cancelledBy: 'household', date: '2026-10-12' };
const skipped: Partial<VisitInput> = { status: 'skipped', date: '2026-10-19' };
const link = async (d: FinanceDB, v: number, ids: Array<[number, number?]>) => setVisitPayment(v, { source: 'finance', refs: await Promise.all(ids.map(([t, s]) => ref(d, t, s))), manualCents: null }, null, d);
async function calc(d: FinanceDB) {
  const [arrangements, visits] = await Promise.all([loadArrangements(d), loadVisits(d)]);
  const all = payRecords(arrangements, visits);
  const lookup = lookupOfMap(await loadTxnMap(all.flatMap((r) => r.refs), d));
  return { all, lookup, arrangements, spend: (rs = all, universe = all) => servicesSpend(rs, lookup, undefined, universe) };
}
const sum = (b: Record<string, number>) => Object.values(b).reduce((x, y) => x + y, 0);

describe('correction 1: shared payments with different outcomes', () => {
  it('completed + cancelled on one piece: counted once, shown as shared, never credited to either outcome; the lines add up to the total', async () => {
    const d = fresh();
    const a = await arr(d), t = await addTxn(d, -10000);
    await link(d, await visit(d, a), [[t]]);
    await link(d, await visit(d, a, cancelled), [[t]]);
    const s = (await calc(d)).spend();
    expect(s.totalCents).toBe(10000);
    expect(s.byClass).toEqual({ completed: 0, fees: 0, other: 0, shared: 10000 });
    expect(s.mixedPieces).toBe(1);
    expect(sum(s.byClass)).toBe(s.totalCents);
  });
  it('completed + skipped behaves the same, and the order the visits were made in does not matter', async () => {
    for (const order of [0, 1]) {
      const d = fresh();
      const a = await arr(d), t = await addTxn(d, -8000);
      const first = order === 0 ? {} : skipped, second = order === 0 ? skipped : {};
      await link(d, await visit(d, a, first), [[t]]);
      await link(d, await visit(d, a, second), [[t]]);
      const s = (await calc(d)).spend();
      expect(s.byClass).toEqual({ completed: 0, fees: 0, other: 0, shared: 8000 });
    }
  });
  it('a shared piece whose records all have the SAME outcome still goes to that outcome (three completed visits; a cancelled and a skipped visit are both "fees")', async () => {
    const d = fresh();
    const a = await arr(d), t = await addTxn(d, -30000), f = await addTxn(d, -5000);
    for (const date of ['2026-10-05', '2026-10-12', '2026-10-19']) await link(d, await visit(d, a, { date }), [[t]]);
    await link(d, await visit(d, a, { ...cancelled, date: '2026-10-26' }), [[f]]);
    await link(d, await visit(d, a, { ...skipped, date: '2026-10-27' }), [[f]]);
    const s = (await calc(d)).spend();
    expect(s.byClass).toEqual({ completed: 30000, fees: 5000, other: 0, shared: 0 });
    expect(s.totalCents).toBe(35000);
  });
  it('a refund shared by different outcomes is shared too (negative), and the lines still add up', async () => {
    const d = fresh();
    const a = await arr(d), t = await addTxn(d, -10000), r = await addTxn(d, 3000, { payee: 'Pat Pools refund' }), own = await addTxn(d, -2000);
    const v1 = await visit(d, a), v2 = await visit(d, a, cancelled);
    await link(d, v1, [[t], [r]]);
    await link(d, v2, [[r], [own]]);
    const s = (await calc(d)).spend();
    expect(s.totalCents).toBe(10000 - 3000 + 2000);
    expect(s.byClass).toEqual({ completed: 10000, fees: 2000, other: 0, shared: -3000 });
    expect(sum(s.byClass)).toBe(s.totalCents);
  });
  it('typed payments belong to their own visit and are not affected; they add to their class and the total still reconciles', async () => {
    const d = fresh();
    const a = await arr(d), t = await addTxn(d, -10000);
    const v1 = await visit(d, a), v2 = await visit(d, a, cancelled), v3 = await visit(d, a, { date: '2026-10-26' });
    await link(d, v1, [[t]]); await link(d, v2, [[t]]);
    await setVisitPayment(v3, { source: 'manual', refs: [], manualCents: 4500 }, null, d);
    const s = (await calc(d)).spend();
    expect(s.byClass).toEqual({ completed: 4500, fees: 0, other: 0, shared: 10000 });
    expect(sum(s.byClass)).toBe(s.totalCents);
  });
  it('a whole transaction on a completed visit and one of its parts on a cancelled one: the whole counts once and is shared', async () => {
    const d = fresh();
    const a = await arr(d);
    const t = await addTxn(d, -30000, { categoryId: null, splits: [{ categoryId: 5, amountCents: -12000 }, { categoryId: 6, amountCents: -18000 }] });
    await link(d, await visit(d, a), [[t]]);
    await link(d, await visit(d, a, cancelled), [[t, 0]]);
    const s = (await calc(d)).spend();
    expect(s.totalCents).toBe(30000);
    expect(s.summary.coveredParts).toHaveLength(1);
    expect(s.byClass).toEqual({ completed: 0, fees: 0, other: 0, shared: 30000 });
    // viewed from the cancelled visit's own records only, the part counts, and it is still shared because the whole is linked elsewhere
    const c = await calc(d);
    const fee = c.all.filter((r) => r.cls === 'fees');
    const view = c.spend(fee);
    expect(view.totalCents).toBe(12000);
    expect(view.byClass).toEqual({ completed: 0, fees: 0, other: 0, shared: 12000 });
  });
  it('different parts of one split on different outcomes are different money: each goes to its own outcome', async () => {
    const d = fresh();
    const a = await arr(d);
    const t = await addTxn(d, -30000, { categoryId: null, splits: [{ categoryId: 5, amountCents: -12000 }, { categoryId: 6, amountCents: -18000 }] });
    await link(d, await visit(d, a), [[t, 0]]);
    await link(d, await visit(d, a, cancelled), [[t, 1]]);
    expect((await calc(d)).spend().byClass).toEqual({ completed: 12000, fees: 18000, other: 0, shared: 0 });
  });
  it('arrangement and provider views classify with the whole module in mind: one piece shared across two arrangements of one provider', async () => {
    const d = fresh();
    const a1 = await arr(d, 'Main house pool'), a2 = await arr(d, 'Cabin pool'), t = await addTxn(d, -10000), own = await addTxn(d, -6000);
    await link(d, await visit(d, a1), [[t], [own]]);
    await link(d, await visit(d, a2, cancelled), [[t]]);
    const c = await calc(d);
    const module = c.spend();
    expect(module.byClass).toEqual({ completed: 6000, fees: 0, other: 0, shared: 10000 });
    const key = c.all[0].providerKey;
    const provider = c.spend(forProvider(c.all, key));
    expect(provider.byClass).toEqual(module.byClass);
    // each arrangement page: its own total, the shared piece shown as shared, never credited whole to completed or fees
    const first = c.spend(forArrangement(c.all, a1));
    expect(first.totalCents).toBe(16000);
    expect(first.byClass).toEqual({ completed: 6000, fees: 0, other: 0, shared: 10000 });
    const second = c.spend(forArrangement(c.all, a2));
    expect(second.byClass).toEqual({ completed: 0, fees: 0, other: 0, shared: 10000 });
    for (const x of [module, provider, first, second]) expect(sum(x.byClass)).toBe(x.totalCents);
    expect(PAY_BUCKETS).toEqual(['completed', 'fees', 'other', 'shared']);
  });
  it('an arrangement-level payment (other) that is also on a completed visit is shared, still counted once', async () => {
    const d = fresh();
    const a = await arr(d), t = await addTxn(d, -20000);
    const v = await visit(d, a);
    await d.moduleRecords.update(a, { 'data.txnRefs': [await ref(d, t)] }); // arrives from another device: both places
    await link(d, v, [[t]]).catch(() => undefined); // the app refuses this directly; here the record simply carries both
    await d.moduleRecords.update(v, { 'data.txnRefs': [await ref(d, t)] });
    const s = (await calc(d)).spend();
    expect(s.totalCents).toBe(20000);
    expect(s.byClass.shared).toBe(20000);
  });
});

// ---- two devices: the classification is the same everywhere ----
function remoteStore() {
  const r = {
    puts: 0, file: null as RemoteFile | null,
    async getFile() { return r.file ? { sha: r.file.sha, bytes: r.file.bytes.slice() } : null; },
    async putFile(bytes: Uint8Array, sha: string | undefined) {
      if ((r.file?.sha ?? undefined) !== sha) throw new RemoteConflict('stale');
      r.puts++; r.file = { sha: `sha${r.puts}`, bytes: bytes.slice() }; return r.file.sha;
    },
  };
  return r satisfies RemoteStore;
}
describe('correction 1 across two devices (real SyncEngine)', () => {
  it('A links one payment to a completed visit and B links it to a cancelled one: after sync both show it as shared, counted once', async () => {
    const remote = remoteStore();
    const mk = () => { const d = fresh(); return { d, engine: new SyncEngine(d, dexieMeta(`corr1-meta-${n++}`), remote, 'a good passphrase') }; };
    const A = mk(), B = mk();
    const a = await arr(A.d), t = await addTxn(A.d, -15000);
    const v1 = await visit(A.d, a), v2 = await visit(A.d, a, cancelled);
    await A.engine.initialUpload(); await B.engine.replaceFromRemote();
    await link(A.d, v1, [[t]]);
    await link(B.d, v2, [[t]]);
    for (let i = 0; i < 2; i++) { await A.engine.sync(); await B.engine.sync(); }
    await A.engine.sync();
    for (const x of [A, B]) {
      const s = (await calc(x.d)).spend();
      expect(s.totalCents).toBe(15000);
      expect(s.byClass).toEqual({ completed: 0, fees: 0, other: 0, shared: 15000 });
    }
  }, 90000);
});
