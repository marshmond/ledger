import { describe, expect, it, vi } from 'vitest';
import type { FinanceDB } from '../../db';
import { lookupOfMap } from '../../lib/txnLookup';
import { makeTxnRef, type TxnLookup } from '../../lib/txnRef';
import type { RecurringLog, RecurringRule, Txn } from '../../types';
import { fact, fresh, monthly, ob as obData, obRec } from './billsTestkit';
import { loadCycles, newOp, rejectSuggestion } from './cycleData';
import type { CycleRecord, FactBody } from './cycleModel';
import { createObligation, getObligation } from './data';
import { loadDiscovery, readDecision } from './discoveryData';
import { derivePeriod, periodsOf } from './periods';
import { attention, attentionLines, derive, loadBillsSnapshot } from './readModel';
import { acknowledgeRuleConflict } from './scheduledLinkData';
import { suggestMatches } from './suggest';
import { loadSuggestions } from './suggestData';

/**
 * B3.1 gap-closing tests, added after the mutation check showed three behaviours no earlier test pinned (a rejection really is per period when the SAME
 * payment sits in two periods' windows; a weak payee resemblance plus a category is still not enough; a Scheduled date that passed with no posting
 * proves nothing even when a transaction on that date looks plausible), plus the bulk-read and speed checks the brief asks for.
 */
const TODAY = '2026-11-20';
let tid = 70000;
const txn = (amountCents: number, over: Partial<Txn> = {}): Txn => ({ id: tid++, accountId: 1, date: '2026-11-18', amountCents, payee: 'Example Power Co', memo: '', status: 'pending', categoryId: 5, ...over });
const lookupOf = (...ts: Txn[]): TxnLookup => { const m = new Map(ts.map((t) => [t.id!, t])); return (id) => m.get(id); };
const POWER = { title: 'Example Power Co', providerNameSnapshot: 'Example Power Co', payment: { how: 'manual' as const, fundingAccountId: null }, prices: [{ from: '2026-01-01', cents: 12000, label: '' }] };
const OB = obRec(1, POWER);
let fid = 1;
const f = (body: FactBody, slot: string, id = fid++): CycleRecord => fact(1, slot, body, id);

describe('B3.1 gaps: a rejection belongs to ONE period even when the same payment is a candidate for two', () => {
  it('the same transaction, rejected for November, is still suggested for the next period whose window also contains it, and the reverse', () => {
    const t = txn(-12000, { date: '2026-11-20' }); // inside November's window (11 to 28 Nov) and inside a period due on 25 Nov (18 Nov to 5 Dec)
    const rejectedForNov = f({ fact: 'suggestion-reject', ref: makeTxnRef(t) }, 'm2026-11');
    const lookup = lookupOf(t);
    const nov = derivePeriod(OB, 'm2026-11', '2026-11-18', true, [rejectedForNov], TODAY, lookup);
    const next = derivePeriod(OB, 'm2026-12', '2026-11-25', true, [], TODAY, lookup);
    const base = { obligation: OB, obligations: [OB], cycles: [rejectedForNov], transactions: [t], lookup, today: TODAY };
    expect(suggestMatches({ ...base, period: nov }).suggestions).toEqual([]);
    expect(suggestMatches({ ...base, period: nov }).rejected).toHaveLength(1);
    expect(suggestMatches({ ...base, period: next }).suggestions.map((s) => s.txn.id)).toEqual([t.id]);
    expect(suggestMatches({ ...base, period: next }).rejected).toEqual([]);
  });
});

describe('B3.1 gaps: weak evidence stays weak', () => {
  it('a payee that only shares a name word, in the bill\'s own category, is not suggested for a bill whose amount is not reliable', () => {
    const v = obRec(1, { ...POWER, amountKind: 'variable', prices: [], categoryId: 5 });
    const t = txn(-8734, { payee: 'Example Water Works', categoryId: 5 });
    const period = derivePeriod(v, 'm2026-11', '2026-11-18', true, [], TODAY, lookupOf(t));
    expect(suggestMatches({ obligation: v, period, obligations: [v], cycles: [], transactions: [t], lookup: lookupOf(t), today: TODAY }).suggestions).toEqual([]);
  });

  it('a plausible-looking transaction on a Scheduled date is NOT evidence when nothing was posted: only the posted log counts', () => {
    const RULE: RecurringRule = { id: 7, accountId: 1, payee: 'Example Power Co', amountCents: -12000, categoryId: 5, memo: '', frequency: 'monthly', startDate: '2026-01-18', active: true };
    const linked = obRec(1, { ...POWER, scheduledRuleIds: [7] });
    const t = txn(-12000, { date: '2026-11-18', payee: 'Unrelated Label' });
    const period = derivePeriod(linked, 'm2026-11', '2026-11-18', true, [], TODAY, lookupOf(t));
    const log: RecurringLog[] = [];
    const r = suggestMatches({ obligation: linked, period, obligations: [linked], cycles: [], transactions: [t], lookup: lookupOf(t), today: TODAY, scheduled: { rules: [RULE], log } });
    expect(r.suggestions).toEqual([]);
    expect(r.suggestions.some((s) => s.fromRule)).toBe(false);
  });
});

describe('B3.1 gaps: bulk reads and speed (real database)', () => {
  const fill = async (d: FinanceDB, n: number) => {
    const a = (await d.accounts.add({ name: 'Test checking', kind: 'checking', openingBalanceCents: 0, openingDate: '2020-01-01' } as never)) as number;
    const rows: Txn[] = [];
    for (let i = 0; i < n; i++) {
      const m = i % 36, y = 2023 + Math.floor(m / 12), mo = (m % 12) + 1;
      const payee = `Shop ${i % 230}`; // many payees, mostly irregular
      rows.push({ accountId: a, date: `${y}-${String(mo).padStart(2, '0')}-${String(1 + (i * 7) % 28).padStart(2, '0')}`, amountCents: -(500 + ((i * 37) % 9000)), payee, memo: '', status: 'cleared', categoryId: 3 });
    }
    for (let m = 0; m < 30; m++) { const y = 2024 + Math.floor((m + 5) / 12), mo = ((m + 5) % 12) + 1; rows.push({ accountId: a, date: `${y}-${String(mo).padStart(2, '0')}-12`, amountCents: -1549, payee: 'Streamly Premium', memo: '', status: 'cleared', categoryId: 3 }); }
    for (let i = 0; i < rows.length; i += 1000) await d.txns.bulkAdd(rows.slice(i, i + 1000));
    return a;
  };

  it('discovery reads the transactions ONCE, in one bulk call, and never loops the database per candidate; thousands of payments are scanned quickly', async () => {
    const d = fresh();
    await fill(d, 6000);
    const toArray = vi.spyOn(d.txns, 'toArray');
    const get = vi.spyOn(d.txns, 'get');
    const where = vi.spyOn(d.txns, 'where');
    const bulkGet = vi.spyOn(d.txns, 'bulkGet');
    const t0 = Date.now();
    const r = await loadDiscovery('2026-11-20', d);
    const ms = Date.now() - t0;
    expect(toArray).toHaveBeenCalledTimes(1);
    expect(get).not.toHaveBeenCalled();
    expect(where).not.toHaveBeenCalled();
    expect(bulkGet).not.toHaveBeenCalled();
    expect(r.scanned.transactions).toBeGreaterThan(6000);
    expect(r.suggestions.find((c) => c.payee === 'Streamly Premium')?.tier).toBe('strong');
    expect(ms).toBeLessThan(5000); // a loose bound for a slow test machine; the app reads this once per Overview visit
  });

  it('suggestions read only a date window plus the stored links in bulk (no whole-table read, no per-transaction lookups)', async () => {
    const d = fresh();
    const a = await fill(d, 3000);
    const { id } = await createObligation({ data: obData({ title: 'Example Power Co', providerNameSnapshot: 'Example Power Co', amountKind: 'fixed', prices: [{ from: '2026-01-01', cents: 12000, label: '' }], schedule: monthly(18, '2026-01'), trackingSince: '2026-01-01' }, TODAY), today: TODAY }, d);
    await d.txns.add({ accountId: a, date: '2026-11-17', amountCents: -12000, payee: 'Example Power Co', memo: '', status: 'pending', categoryId: 5 });
    const snap = await loadBillsSnapshot(d);
    const o = (await getObligation(id, d))!;
    const period = periodsOf(o, snap.cycles, TODAY, { from: '2026-01-01', to: '2027-12-31' }, { allRecorded: true, lookup: lookupOfMap(snap.financeTxns) }).find((p) => p.slot === 'm2026-11')!;
    const toArray = vi.spyOn(d.txns, 'toArray');
    const get = vi.spyOn(d.txns, 'get');
    const t0 = Date.now();
    const r = await loadSuggestions(o, period, TODAY, d);
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(toArray).not.toHaveBeenCalled(); // the window is read through the date index, never the whole table
    expect(get).not.toHaveBeenCalled();
    expect(r.suggestions).toHaveLength(1);
  });
});

describe('B3.1 gaps: one operation is one press', () => {
  it('a repeated operation id writes nothing even if the second press names a different payment (a stale double submit)', async () => {
    const d = fresh();
    const a = (await d.accounts.add({ name: 'Test checking', kind: 'checking', openingBalanceCents: 0, openingDate: '2026-01-01' } as never)) as number;
    const { id } = await createObligation({ data: obData({ title: 'Example Power Co', amountKind: 'fixed', prices: [{ from: '2026-01-01', cents: 12000, label: '' }], schedule: monthly(18, '2026-01'), trackingSince: '2026-01-01' }, TODAY), today: TODAY }, d);
    const t1 = { ...txn(-12000), accountId: a }, t2 = { ...txn(-12000, { date: '2026-11-19' }), accountId: a };
    t1.id = (await d.txns.add(t1)) as number;
    t2.id = (await d.txns.add(t2)) as number;
    const op = newOp();
    const first = await rejectSuggestion({ obligationId: id, slot: 'm2026-11', ref: makeTxnRef(t1), op }, d);
    const second = await rejectSuggestion({ obligationId: id, slot: 'm2026-11', ref: makeTxnRef(t2), op }, d);
    expect(second.reused).toBe(true);
    expect(second.id).toBe(first.id);
    expect((await loadCycles(d)).filter((c) => c.body?.fact === 'suggestion-reject')).toHaveLength(1);
  });
});

describe('B3.1 gaps: a review choice must be well formed to hide anything', () => {
  it('a choice with a valid shape but a name this version does not know is ignored and hides nothing', async () => {
    const d = fresh();
    const a = (await d.accounts.add({ name: 'Test checking', kind: 'checking', openingBalanceCents: 0, openingDate: '2026-01-01' } as never)) as number;
    for (const m of ['2026-08', '2026-09', '2026-10', '2026-11']) await d.txns.add({ accountId: a, date: m + '-12', amountCents: -1549, payee: 'Streamly Premium', memo: '', status: 'cleared', categoryId: 3 });
    await d.moduleRecords.add({ id: 940001, module: 'bills', kind: 'discovery', data: { key: 'p:streamly premium', decision: 'delete-everything', on: TODAY, snap: { n: 4, last: '2026-11-12', cents: 1549 } }, createdAt: 1, updatedAt: 1, deletedAt: null } as never);
    expect(readDecision((await d.moduleRecords.get(940001))!)).toBeNull();
    expect((await loadDiscovery(TODAY, d)).suggestions.map((c) => c.payee)).toEqual(['Streamly Premium']);
  });
});

describe('B3.1 gaps: a Scheduled payment linked to two bills is counted for Today and Needs review', () => {
  it('counts once, words only (no bill name), carries the rule for the repair, and stops counting when the owner leaves it as is', async () => {
    const d = fresh();
    const a = (await d.accounts.add({ name: 'Test checking', kind: 'checking', openingBalanceCents: 0, openingDate: '2026-01-01' } as never)) as number;
    const ruleId = (await d.recurring.add({ accountId: a, payee: 'Example Power Co', amountCents: -12000, categoryId: 5, memo: '', frequency: 'monthly', startDate: '2026-01-18', active: true })) as number;
    const mkBill = (title: string) => createObligation({ data: obData({ title, amountKind: 'fixed', prices: [{ from: '2026-01-01', cents: 12000, label: '' }], schedule: monthly(18, '2026-01'), trackingSince: '2026-01-01' }, TODAY), today: TODAY }, d);
    const one = await mkBill('Bill one'), two = await mkBill('Bill two');
    for (const x of [one, two]) { const o = (await getObligation(x.id, d))!; await d.moduleRecords.update(x.id, { data: { ...(o.data as object), scheduledRuleIds: [ruleId] } }); }
    const a1 = attention(derive(await loadBillsSnapshot(d), TODAY));
    expect(a1.ruleShared).toBe(1);
    expect(a1.items.find((i) => i.category === 'ruleShared')).toMatchObject({ ruleId });
    const line = attentionLines(a1).find((l) => l.id === 'ruleShared')!;
    expect(line.text).toBe('1 Finance scheduled payment is linked to more than one bill');
    expect(line.text).not.toMatch(/Bill one|Bill two/);
    await acknowledgeRuleConflict(ruleId, d);
    expect(attention(derive(await loadBillsSnapshot(d), TODAY)).ruleShared).toBe(0);
  });
});
