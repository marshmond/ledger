import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { FinanceDB } from '../../db';
import { makeTxnRef, type TxnLookup } from '../../lib/txnRef';
import { lookupOfMap } from '../../lib/txnLookup';
import type { Split, Txn, TxnStatus } from '../../types';
import { billsCostRecords, billsRecordedPayments, explain } from './billsSpend';
import { creditF, fact, fresh, inv, obRec, paidOut } from './billsTestkit';
import { createObligation } from './data';
import { findConflicts } from './cycleConflicts';
import { loadCycles, newOp, recordFact } from './cycleData';
import { attention, derive, loadBillsSnapshot } from './readModel';
import { derivePeriod } from './periods';
import { PaymentList } from './PaymentUI';
import { monthly, ob } from './billsTestkit';
import type { CycleRecord, FactBody } from './cycleModel';

/** B3 Bills-only recorded payments (the reader B5 will consume), the performance and malformed-data promises, the privacy of the payment list, and the boundaries. */
const TODAY = '2026-11-07';
let tid = 500;
const txn = (amountCents: number, over: Partial<Txn> = {}): Txn => ({ id: tid++, accountId: 1, date: '2026-11-10', amountCents, payee: 'Example Power', memo: '', status: 'pending', categoryId: 5, ...over });
const lookupOf = (...ts: Txn[]): TxnLookup => { const m = new Map(ts.map((t) => [t.id!, t])); return (id) => m.get(id); };
let fid = 1;
const link = (oid: number, slot: string, t: Txn, split?: number): CycleRecord => fact(oid, slot, { fact: 'payment-link', ref: makeTxnRef(t, split) }, fid++);
const f = (oid: number, slot: string, body: FactBody): CycleRecord => fact(oid, slot, body, fid++);
const splitTxn = (parts: [number, number | null][]): Txn => { const splits: Split[] = parts.map(([amountCents, categoryId]) => ({ amountCents, categoryId })); return txn(splits.reduce((n, s) => n + s.amountCents, 0), { splits }); };
const OBS = [obRec(1, { title: 'Power', type: 'utility' }), obRec(2, { title: 'Phone', type: 'telecom' }), obRec(3, { title: 'Streaming', type: 'subscription' })];
const total = (cycles: CycleRecord[], lookup: TxnLookup, obs = OBS) => billsRecordedPayments(billsCostRecords(obs, cycles), lookup);

describe('B3 Bills-only recorded payments: each Finance piece once, explainable piece by piece', () => {
  it('one Finance payment linked to two periods of one bill, and to another bill, is counted ONCE in the total and is flagged as a possible duplicate attribution', () => {
    const t = txn(-12000);
    const cycles = [link(1, 'm2026-11', t), link(1, 'm2026-12', t), link(2, 'm2026-11', t)];
    const r = total(cycles, lookupOf(t));
    expect(r.totalCents).toBe(12000);
    expect(r.financeCents).toBe(12000);
    expect(r.sharedPieces).toEqual([{ key: `${t.id}:w`, periods: ['bill:1:m2026-11', 'bill:1:m2026-12', 'bill:2:m2026-11'] }]);
    // the conflict reader flags it too, and resolves nothing
    const c = findConflicts(OBS, cycles).filter((x) => x.kind === 'payment-shared');
    expect(c).toHaveLength(1);
    expect(c[0].repairs).toEqual(['leave']);
    expect(c[0].text).toMatch(/counted once in totals/);
  });

  it('a whole transaction supersedes its overlapping parts everywhere (in one period or across periods)', () => {
    const s = splitTxn([[-7000, 5], [-5000, 6]]);
    const cycles = [link(1, 'm2026-11', s, 0), link(2, 'm2026-11', s), link(3, 'm2026-11', s, 1)];
    const r = total(cycles, lookupOf(s));
    expect(r.totalCents).toBe(12000); // the whole counts; neither part is added on top
    expect(r.summary.coveredParts).toHaveLength(2);
  });

  it('refunds reduce the net recorded payments; money back larger than payments gives a negative net, never hidden', () => {
    const out = txn(-12000), back = txn(5000, { date: '2026-11-20' });
    expect(total([link(1, 'm2026-11', out), link(1, 'm2026-11', back)], lookupOf(out, back)).totalCents).toBe(7000);
    expect(total([link(1, 'm2026-11', back)], lookupOf(back)).totalCents).toBe(-5000);
  });

  it('missing, split-changed and no-longer-spending references count zero and are listed for review', () => {
    const gone = txn(-1000), s = splitTxn([[-7000, 5], [-5000, 6]]), x = txn(-2000), ok = txn(-3000);
    const live = lookupOf({ ...s, splits: [s.splits![1], s.splits![0]] }, { ...x, transferTxnId: 4 }, ok);
    const r = total([link(1, 'm2026-11', gone), link(1, 'm2026-12', s, 0), link(2, 'm2026-11', x), link(2, 'm2026-12', ok)], live);
    expect(r.totalCents).toBe(3000);
    expect(r.review.map((x) => x.state).sort()).toEqual(['missing', 'not-spending', 'split-changed']);
  });

  it('a typed amount counts only for a period with no Finance link, is never matched to a Finance piece by value, and two different typed amounts count nothing', () => {
    const t = txn(-12000);
    const typedOnly = total([f(1, 'm2026-11', paidOut('2026-11-09', 12000))], lookupOf());
    expect(typedOnly).toMatchObject({ totalCents: 12000, typedCents: 12000, financeCents: 0 });
    // the same amount typed in one period and linked in another is TWO payments (never merged because the numbers match)
    expect(total([f(1, 'm2026-11', paidOut('2026-11-09', 12000)), link(1, 'm2026-12', t)], lookupOf(t)).totalCents).toBe(24000);
    // typed beside links in ONE period: the links are used, the typed amount is left out
    const beside = total([f(1, 'm2026-11', paidOut('2026-11-09', 12000)), link(1, 'm2026-11', t)], lookupOf(t));
    expect(beside).toMatchObject({ totalCents: 12000, typedCents: 0, financeCents: 12000 });
    // the cost record itself carries ONE source, so even a reader that mixed sources would be noticed: nothing is both typed and linked
    expect(beside.both).toEqual([]);
    expect(billsCostRecords(OBS, [f(1, 'm2026-11', paidOut('2026-11-09', 12000)), link(1, 'm2026-11', t)]).every((r) => r.refs.length > 0 && r.manualCents === null)).toBe(true);
    expect(total([f(1, 'm2026-11', paidOut('2026-11-09', 5000)), f(1, 'm2026-11', paidOut('2026-11-10', 6000))], lookupOf()).totalCents).toBe(0);
    expect(total([f(1, 'm2026-11', paidOut('2026-11-09', 5000)), f(1, 'm2026-11', paidOut('2026-11-10', 5000))], lookupOf()).totalCents).toBe(5000); // identical typed amounts count once
  });

  it('pending, cleared and reconciled never change a number', () => {
    const sums = (['pending', 'cleared', 'reconciled'] as TxnStatus[]).map((status) => { const t = txn(-12000, { status }); return total([link(1, 'm2026-11', t)], lookupOf(t)).totalCents; });
    expect(new Set(sums)).toEqual(new Set([12000]));
  });

  it('expected amounts, invoices, credits and scheduled estimates are never money spent', () => {
    const r = total([f(1, 'm2026-11', inv(12000)), f(1, 'm2026-11', creditF(2000)), f(2, 'm2026-11', inv(5000))], lookupOf());
    expect(r.totalCents).toBe(0);
    expect(billsCostRecords(OBS, [f(1, 'm2026-11', inv(12000))])).toEqual([]);
  });

  it('every counted piece is explainable: it names the periods behind it and the pieces add up to the total', () => {
    const a = txn(-5000), b = txn(-7000), back = txn(2000);
    const cycles = [link(1, 'm2026-11', a), link(1, 'm2026-11', b), link(2, 'm2026-11', back), f(3, 'm2026-11', paidOut('2026-11-09', 1500))];
    const lookup = lookupOf(a, b, back);
    const recs = billsCostRecords(OBS, cycles);
    const pieces = explain(recs, lookup);
    expect(pieces.every((p) => p.recordIds.length > 0 && /^bill:\d+:/.test(p.recordIds[0]))).toBe(true);
    const r = billsRecordedPayments(recs, lookup);
    expect(pieces.reduce((n, p) => n + p.spendCents, 0)).toBe(r.financeCents);
    expect(r.financeCents + r.typedCents).toBe(r.totalCents);
    expect(r.byType).toMatchObject({ utility: 12000, telecom: -2000, subscription: 1500 });
    expect(Object.values(r.byType).reduce((n, x) => n + x, 0)).toBe(r.totalCents);
  });

  it('a loan-tracked bill, and records of a bill that is not here, contribute nothing', () => {
    const t = txn(-9999);
    const loan = obRec(9, { title: 'Mortgage', type: 'loan' });
    expect(total([link(9, 'm2026-11', t), link(77, 'm2026-11', t)], lookupOf(t), [...OBS, loan]).totalCents).toBe(0);
  });

  it('the output is deterministic whatever order the records arrive in', () => {
    const a = txn(-5000), b = txn(-7000);
    const cycles = [link(1, 'm2026-11', a), link(2, 'm2026-11', a), link(1, 'm2026-12', b)];
    const fwd = total(cycles, lookupOf(a, b)), rev = total([...cycles].reverse(), lookupOf(a, b));
    expect(fwd.totalCents).toBe(rev.totalCents);
    expect(fwd.sharedPieces).toEqual(rev.sharedPieces);
    expect(billsCostRecords(OBS, cycles).map((r) => r.id)).toEqual(billsCostRecords(OBS, [...cycles].reverse()).map((r) => r.id));
  });
});

describe('B3 performance and data loading: one bulk read, no per-period queries, calm with an empty or damaged database', () => {
  it('many bills and many periods with shared pieces: ONE bulk Finance read, no per-reference read, and repeated loads change nothing', async () => {
    const d = fresh('b3perf');
    const acct = (await d.accounts.add({ name: 'Test checking', kind: 'checking', openingBalanceCents: 0, openingDate: '2026-01-01' } as never)) as number;
    const ids: number[] = [];
    for (let i = 0; i < 25; i++) ids.push((await createObligation({ data: ob({ title: `Bill ${i}`, schedule: monthly(10 + (i % 15), '2026-06'), trackingSince: '2026-06-01' }, TODAY), today: TODAY }, d)).id);
    const txs: Txn[] = [];
    for (let i = 0; i < 40; i++) txs.push({ ...(txn(-1000 - i, { accountId: acct })), id: (await d.txns.add(txn(-1000 - i, { accountId: acct }))) as number });
    let n = 0;
    for (const id of ids) for (const slot of ['m2026-07', 'm2026-08', 'm2026-09', 'm2026-10', 'm2026-11']) {
      const t = txs[n++ % txs.length]; // pieces are shared by many periods
      await recordFact({ obligationId: id, slot, body: { fact: 'payment-link', ref: makeTxnRef(t) }, op: newOp(), today: TODAY }, d).catch(() => null);
    }
    expect((await loadCycles(d)).length).toBeGreaterThan(100);
    const bulk = vi.spyOn(d.txns, 'bulkGet');
    const single = vi.spyOn(d.txns, 'get');
    const where = vi.spyOn(d.txns, 'where');
    const before = JSON.stringify([await d.moduleRecords.toArray(), await d.txns.toArray()]);
    const snaps = [];
    for (let i = 0; i < 3; i++) { const s = await loadBillsSnapshot(d); attention(derive(s, TODAY)); snaps.push(s); }
    expect(bulk).toHaveBeenCalledTimes(3); // one bulk read per load
    expect(single).not.toHaveBeenCalled();
    expect(where).not.toHaveBeenCalled();
    expect(snaps[0].financeTxns.size).toBeLessThanOrEqual(40);
    // the pure derivation touches no database at all
    bulk.mockClear();
    attention(derive(snaps[0], TODAY)); attention(derive(snaps[0], TODAY));
    expect(bulk).not.toHaveBeenCalled();
    expect(JSON.stringify([await d.moduleRecords.toArray(), await d.txns.toArray()])).toBe(before);
  });

  it('an empty database loads and derives without error and without any Finance read of consequence', async () => {
    const d = fresh('b3empty');
    const s = await loadBillsSnapshot(d);
    expect(s.obligations).toEqual([]);
    expect(s.financeTxns.size).toBe(0);
    expect(attention(derive(s, TODAY)).total).toBe(0);
  });

  it('damaged payment-link records (no reference, a junk reference, wrong types) are kept, shown as needing review, never counted, and never crash a screen', async () => {
    const d = fresh('b3bad');
    const { id } = await createObligation({ data: ob({ title: 'Power' }, TODAY), today: TODAY }, d);
    const add = (data: Record<string, unknown>) => d.moduleRecords.add({ module: 'bills', kind: 'cycle', data: { obligationId: id, slot: 'm2026-11', ...data }, createdAt: Date.now(), updatedAt: Date.now(), deletedAt: null } as never);
    await add({ fact: 'payment-link' });
    await add({ fact: 'payment-link', ref: 5 });
    await add({ fact: 'payment-link', ref: { txnId: 'x', snapshot: {} } });
    await add({ fact: 'payment-link', ref: { txnId: 3, splitIndex: -1 } });
    await add({ fact: 'payment-link', ref: { txnId: 3, splitIndex: 1 } }); // a part with no fingerprint: readable, but it cannot be trusted
    const s = await loadBillsSnapshot(d);
    const a = attention(derive(s, TODAY));
    expect(a.records).toBeGreaterThanOrEqual(4); // each unreadable record is reported
    const unreadable = s.cycles.filter((c) => c.body === null);
    expect(unreadable.length).toBe(4);
    expect(unreadable.every((c) => c.problem !== null)).toBe(true);
    expect(billsCostRecords(s.obligations, s.cycles).every((r) => r.refs.every((x) => x.txnId === 3))).toBe(true);
    expect(billsRecordedPayments(billsCostRecords(s.obligations, s.cycles), lookupOfMap(s.financeTxns)).totalCents).toBe(0);
  });
});

describe('B3 the payment list honors Hide Amounts and shows Finance\'s own words', () => {
  const OB1 = obRec(1, { payment: { how: 'manual', fundingAccountId: null }, prices: [{ from: '2026-01-01', cents: 12000, label: '' }] });
  const money = (c: number) => `$${(c / 100).toFixed(2)}`;
  const mask = () => '$••••';
  const render = (p: ReturnType<typeof derivePeriod>, m: (c: number) => string, hide: boolean, readOnly = false) =>
    renderToStaticMarkup(createElement(PaymentList, { p, money: m, hide, readOnly, onReplace: () => undefined, onRemove: () => undefined }));
  const t = txn(-12000, { status: 'cleared', payee: 'Example Power' });
  const gone = txn(-3000, { payee: 'Gone Co' });
  const p = derivePeriod(OB1, 'm2026-11', '2026-11-18', true, [fact(1, 'm2026-11', inv(12000), 1), link(1, 'm2026-11', t), link(1, 'm2026-11', gone)], TODAY, lookupOf(t));

  it('with Hide Amounts ON no figure appears anywhere in the list; payee, date and status stay', () => {
    const out = render(p, mask, true);
    expect(out).not.toMatch(/\$\s?\d/);
    expect(out).toContain('Example Power');
    expect(out).toContain('Recorded in Finance: cleared');
    expect(out).toContain('Needs review');
    expect(out).toMatch(/Net recorded in Finance for this period: \$••••/);
  });

  it('with Hide Amounts OFF the live amount, the status and the review reason are shown, with a way to replace or remove each link', () => {
    const out = render(p, money, false);
    expect(out).toContain('Paid $120.00');
    expect(out).toContain('Recorded in Finance: cleared');
    expect(out).toMatch(/Remove link/);
    expect(out).toMatch(/Replace this payment/);
    expect(out).toContain('they do not show that the provider received the money'); // the reminder that status words are not bank settlement
    expect(out).not.toMatch(/\b(settled|bank-confirmed)\b/i);
  });

  it('the read-only history list offers no replace or remove', () => {
    const out = render(p, money, false, true);
    expect(out).not.toMatch(/Remove link|Replace this payment/);
    expect(out).toContain('Example Power');
  });

  it('a period with no Finance link renders nothing', () => {
    const none = derivePeriod(OB1, 'm2026-11', '2026-11-18', true, [fact(1, 'm2026-11', inv(12000), 1)], TODAY, lookupOf());
    expect(render(none, money, false)).toBe('');
  });
});

describe('B3 boundaries: no schema change, no change to the other modules\' money, and Finance is read only through the shared loader', () => {
  const DIR = 'src/modules/bills';
  const sources = readdirSync(DIR).filter((x) => /\.(ts|tsx)$/.test(x) && !/\.test\.tsx?$/.test(x) && x !== 'billsTestkit.ts').map((x) => ({ x, text: readFileSync(join(DIR, x), 'utf8') }));
  const scan = (re: RegExp) => sources.filter((s) => re.test(s.text)).map((s) => s.x);

  it('no new table and no migration: the schema is still Dexie version 15 with 40 tables', () => {
    const d = new FinanceDB('b3-schema');
    expect(d.verno).toBe(15);
    expect(d.tables).toHaveLength(40);
  });

  it('Bills reads Finance only through the shared bulk loader (never a table of its own), and never writes a Finance table', () => {
    expect(scan(/\.(txns|accounts|categories|recurring|recurringLog|loans)\s*\.\s*(add|put|update|delete|bulkAdd|bulkPut|bulkDelete|clear|modify)\b/)).toEqual([]);
    expect(scan(/\.txns\b/)).toEqual([]);
    expect(scan(/\bloadTxnMap\b/).sort()).toEqual(['PaymentHistoryCard.tsx', 'PeriodsCard.tsx', 'readModel.ts', 'tasks.ts']);
    expect(scan(/from '\.\.\/\.\.\/lib\/txnLookup'/).sort()).toEqual(['PaymentHistoryCard.tsx', 'PeriodsCard.tsx', 'dueProvider.ts', 'readModel.ts', 'tasks.ts']);
  });

  it('the new money files write nothing and store nothing', () => {
    for (const f of ['payments.ts', 'paymentLinks.ts', 'billsSpend.ts']) {
      const t = sources.find((s) => s.x === f)!.text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      // no database handle at all (a Set's own `.add` is fine), no storage, no network
      expect(/\.(put|update|delete|bulkAdd|bulkPut|clear|modify)\(|repo\(|\.remove\(|from '\.\.\/\.\.\/db'|moduleRecords|localStorage|fetch\(|indexedDB/.test(t), f).toBe(false);
    }
  });

  it('every production call that derives periods passes the live Finance lookup (a forgotten one would read every linked payment as missing)', () => {
    for (const s of sources) {
      for (const line of s.text.split('\n')) {
        if (!/\b(periodsOf|derivePeriod)\(/.test(line) || /^\s*(\*|\/\/|export (async )?function)/.test(line)) continue;
        expect(line, `${s.x}: ${line.trim().slice(0, 100)}`).toMatch(/lookup/);
      }
    }
  });

  it('household spending is untouched and Bills does not reach into it: S5\'s union does not know about Bills, and Bills does not import the services module', () => {
    const hs = readFileSync('src/modules/services/householdSpend.ts', 'utf8');
    expect(hs).not.toMatch(/bills|billsSpend|BillCostRecord/i);
    expect(scan(/from '\.\.\/services\//)).toEqual([]);
    const spending = readFileSync('src/modules/assets/spending.ts', 'utf8');
    expect(spending).not.toMatch(/bills/i); // spend() was not modified for Bills
  });

  it('only the owner of a fact kind writes it: link, replace and switch go through the one fact writer', () => {
    expect(scan(/kind:\s*CYCLE_KIND|kind:\s*'cycle'/).sort()).toEqual(['cycleData.ts', 'cycleRepair.ts']);
    // the only places that BUILD a payment-link fact body: the model's own writer and the confirmation dialog (which hands it to the one fact writer)
    expect(scan(/\bfact:\s*'payment-link'/).sort()).toEqual(['PaymentUI.tsx', 'cycleModel.ts']);
  });

  it('every kind of item the Today card counts can be found and acted on from the Needs-review page (a Today link must never lead to an empty page)', () => {
    const model = readFileSync(join(DIR, 'readModel.ts'), 'utf8');
    const review = readFileSync(join(DIR, 'ReviewPage.tsx'), 'utf8');
    const categories = /const CATEGORIES: AttentionCategory\[\] = \[([^\]]+)\]/.exec(model)![1].split(',').map((x) => x.trim().replace(/'/g, ''));
    expect(categories.length).toBeGreaterThanOrEqual(16);
    const onUpcomingPage = new Set(['dueSoon', 'trials', 'notices', 'renewals']);
    for (const c of categories) if (!onUpcomingPage.has(c)) expect(review, c).toContain(`'${c}'`);
  });
});
