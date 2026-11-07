import { describe, expect, it } from 'vitest';
import { makeTxnRef, pieceKey, type TxnLookup } from '../../lib/txnRef';
import { spend } from '../assets/spending';
import type { Split, Txn, TxnStatus } from '../../types';
import { creditF, fact, inv, obRec, paidFull, paidOut, skipF } from './billsTestkit';
import type { CycleRecord, FactBody } from './cycleModel';
import { evidenceLine, LABEL_TEXT, primaryLabel, type LabelId } from './labels';
import { evidenceText, labelText, amountLine } from './PeriodParts';
import { financePayments, STATUS_DETAIL, STATUS_WORDS, statusSummary } from './payments';
import { derivePeriod, type Period } from './periods';
import { findConflicts } from './cycleConflicts';

/**
 * B3: what a billing period says once Finance payments are linked. Pure (no database): every case builds invented transactions, links them with the
 * shared `makeTxnRef`, and reads the period exactly as the app does. Money is whole cents; Finance outflows are negative.
 */
const TODAY = '2026-11-07';
const LATE = '2026-12-05'; // the November bill (18th) is 17 days past due
const OB = obRec(1, { payment: { how: 'manual', fundingAccountId: null }, prices: [{ from: '2026-01-01', cents: 12000, label: '' }] });
const money = (c: number) => `$${(c / 100).toFixed(2)}`;
const SLOT = 'm2026-11';

let tid = 100;
const txn = (amountCents: number, over: Partial<Txn> = {}): Txn => ({ id: tid++, accountId: 1, date: '2026-11-10', amountCents, payee: 'Example Power', memo: '', status: 'pending', categoryId: 5, ...over });
const lookupOf = (...ts: Txn[]): TxnLookup => { const m = new Map(ts.map((t) => [t.id!, t])); return (id) => m.get(id); };
let fid = 1;
const link = (t: Txn, split?: number, id = fid++): CycleRecord => fact(1, SLOT, { fact: 'payment-link', ref: makeTxnRef(t, split) }, id);
const f = (body: FactBody, id = fid++): CycleRecord => fact(1, SLOT, body, id);
const period = (records: CycleRecord[], lookup: TxnLookup, today = TODAY): Period => derivePeriod(OB, SLOT, '2026-11-18', true, records, today, lookup);
const splitTxn = (parts: [number, number | null][], over: Partial<Txn> = {}): Txn => {
  const splits: Split[] = parts.map(([amountCents, categoryId]) => ({ amountCents, categoryId }));
  return txn(splits.reduce((n, s) => n + s.amountCents, 0), { splits, ...over });
};

describe('B3 amounts: the examples, each reconciled to the pieces that were counted', () => {
  it('$120 invoice and one $120 payment: paid, nothing left, the label never says settled', () => {
    const t = txn(-12000);
    const p = period([f(inv(12000)), link(t)], lookupOf(t));
    expect(p.amounts).toMatchObject({ owed: 12000, paid: 12000, remaining: 0, source: 'finance', basis: 'billed' });
    expect(p.label).toBe('paid');
    expect(p.open).toBe(false);
    expect(p.amounts.finance!.netCents).toBe(12000);
  });

  it('$120 invoice and a $50 payment: partly paid, $70 left, still open', () => {
    const t = txn(-5000);
    const p = period([f(inv(12000)), link(t)], lookupOf(t));
    expect(p.amounts).toMatchObject({ owed: 12000, paid: 5000, remaining: 7000 });
    expect(p.label).toBe('partly-paid');
    expect(p.open).toBe(true);
    expect(labelText(p, money)).toBe('Partly paid ($50.00 of $120.00)');
  });

  it('$120 invoice and two distinct $60 pieces: both count, and the second one makes it paid', () => {
    const a = txn(-6000), b = txn(-6000, { date: '2026-11-12' });
    expect(period([f(inv(12000)), link(a)], lookupOf(a, b)).label).toBe('partly-paid');
    const p = period([f(inv(12000)), link(a), link(b)], lookupOf(a, b));
    expect(p.amounts).toMatchObject({ paid: 12000, remaining: 0 });
    expect(p.label).toBe('paid');
    expect(p.amounts.finance!.counts.counted).toBe(2);
  });

  it('two identical-looking but independent payments are two payments (same payee, date and amount are never merged)', () => {
    const a = txn(-6000, { payee: 'Same Co', date: '2026-11-10' }), b = txn(-6000, { payee: 'Same Co', date: '2026-11-10' });
    expect(pieceKey(makeTxnRef(a))).not.toBe(pieceKey(makeTxnRef(b)));
    const p = period([f(inv(12000)), link(a), link(b)], lookupOf(a, b));
    expect(p.amounts.paid).toBe(12000);
    expect(p.amounts.finance!.counts).toMatchObject({ counted: 2, duplicate: 0 });
  });

  it('$120 invoice, a $20 provider credit and a $100 payment: the credit lowers what is owed and is never counted as paid', () => {
    const t = txn(-10000);
    const p = period([f(inv(12000)), f(creditF(2000)), link(t)], lookupOf(t));
    expect(p.amounts).toMatchObject({ owed: 10000, creditCents: 2000, paid: 10000, remaining: 0 });
    expect(p.label).toBe('paid');
    // the credit alone is not a payment
    expect(period([f(inv(12000)), f(creditF(2000))], lookupOf()).amounts).toMatchObject({ paid: 0, owed: 10000, remaining: 10000 });
  });

  it('$120 paid and later refunded: net nothing paid, the period is open again, a reversal is reported, and nothing claims the payment failed', () => {
    const out = txn(-12000), back = txn(12000, { date: '2026-11-20' });
    const p = period([f(inv(12000)), link(out), link(back)], lookupOf(out, back), LATE);
    expect(p.amounts).toMatchObject({ paid: 0, remaining: 12000 });
    expect(p.amounts.finance).toMatchObject({ netCents: 0, outCents: 12000, backCents: 12000, reversed: true });
    expect(p.label).toBe('overdue'); // billed, manual, past due, nothing counted
    expect(p.open).toBe(true);
    expect(evidenceText(p, money)).toMatch(/reversed or refunded in Finance/);
    expect(evidenceText(p, money)).not.toMatch(/\b(failed|bounced|declined)\b/i);
  });

  it('a refund smaller than the payment lowers the net but is not a reversal: $120 paid, $20 back = $100 recorded, $20 left', () => {
    const out = txn(-12000), back = txn(2000, { date: '2026-11-20' });
    const p = period([f(inv(12000)), link(out), link(back)], lookupOf(out, back));
    expect(p.amounts).toMatchObject({ paid: 10000, remaining: 2000 });
    expect(p.amounts.finance!.reversed).toBe(false);
    expect(p.label).toBe('partly-paid');
  });

  it('only money back linked (no payment): nothing paid, and it is called a reversal so a declaration cannot hide it', () => {
    const back = txn(5000);
    const p = period([f(inv(12000)), link(back)], lookupOf(back));
    expect(p.amounts.paid).toBe(0);
    expect(p.amounts.finance).toMatchObject({ netCents: -5000, paidCents: 0, reversed: true });
  });

  it('a whole transaction and one of its parts in ONE period: the whole counts, the part is covered and counts nothing', () => {
    const t = splitTxn([[-7000, 5], [-5000, 6]]);
    const p = period([f(inv(12000)), link(t, 0), link(t)], lookupOf(t));
    expect(p.amounts).toMatchObject({ paid: 12000 });
    const roles = Object.fromEntries(p.amounts.finance!.pieces.map((x) => [x.key, x.role]));
    expect(roles[`${t.id}:w`]).toBe('counted');
    expect(roles[`${t.id}:0`]).toBe('covered');
  });

  it('two parts of one split are two pieces: each counts once', () => {
    const t = splitTxn([[-7000, 5], [-5000, 6]]);
    const p = period([f(inv(12000)), link(t, 0), link(t, 1)], lookupOf(t));
    expect(p.amounts.paid).toBe(12000);
    expect(p.amounts.finance!.counts.counted).toBe(2);
    const one = period([f(inv(12000)), link(t, 1)], lookupOf(t));
    expect(one.amounts).toMatchObject({ paid: 5000, remaining: 7000 });
  });

  it('the same piece linked twice (two devices): counted once, the second is a visible duplicate', () => {
    const t = txn(-12000);
    const p = period([f(inv(12000)), link(t), link(t)], lookupOf(t));
    expect(p.amounts.paid).toBe(12000);
    expect(p.amounts.finance!.counts).toMatchObject({ counted: 1, duplicate: 1 });
    expect(p.amounts.finance!.pieces.map((x) => x.role)).toEqual(['counted', 'duplicate']);
  });

  it('a zero-dollar invoice needs no payment; a payment that turns up is shown as paid more than billed, with no accusation', () => {
    expect(period([f(inv(0))], lookupOf()).label).toBe('no-payment-due');
    const t = txn(-1500);
    const p = period([f(inv(0)), link(t)], lookupOf(t));
    expect(p.amounts).toMatchObject({ owed: 0, paid: 1500, overpaid: 1500, remaining: 0 });
    expect(p.label).toBe('paid');
    expect(labelText(p, money)).toBe('Paid ($15.00 more than billed)');
  });

  it('a payment when the amount owed is unknown: "Payment recorded", never a guess at what remains', () => {
    const noPrice = obRec(2, { prices: [], amountKind: 'unknown' as never });
    const t = txn(-4321);
    const p = derivePeriod(noPrice, SLOT, '2026-11-18', true, [fact(2, SLOT, { fact: 'payment-link', ref: makeTxnRef(t) }, 1)], TODAY, lookupOf(t));
    expect(p.amounts).toMatchObject({ owed: null, paid: 4321, remaining: null });
    expect(p.label).toBe('payment-recorded');
  });

  it('conflicting invoices still show what was paid; the amount owed stays unknown', () => {
    const t = txn(-9000);
    const p = period([f(inv(12000)), f(inv(11000)), link(t)], lookupOf(t));
    expect(p.amounts).toMatchObject({ basis: 'disagree', owed: null, paid: 9000, remaining: null });
    expect(p.label).toBe('payment-recorded');
  });

  it('an expected amount is never money paid, an invoice is never a payment, and unknown is never zero', () => {
    const p = period([], lookupOf());
    expect(p.amounts).toMatchObject({ basis: 'expected', owed: 12000, paid: 0, source: 'none', finance: null });
    expect(period([f(inv(12000))], lookupOf()).amounts.paid).toBe(0);
  });
});

describe('B3 live Finance changes: the live amount is used, a stale link is kept and counts nothing, nothing is stored as "paid"', () => {
  it('a changed Finance amount: the live amount is used, the change is reported, and remaining is recomputed', () => {
    const t = txn(-12000);
    const ref = link(t);
    const edited: Txn = { ...t, amountCents: -9000 };
    const p = period([f(inv(12000)), ref], lookupOf(edited));
    expect(p.amounts).toMatchObject({ paid: 9000, remaining: 3000 });
    expect(p.amounts.finance!.counts.changed).toBe(1);
    expect(p.amounts.finance!.pieces[0].resolved.state).toBe('changed');
    expect(p.label).toBe('partly-paid'); // a previously paid period becomes partly paid when Finance changes
  });

  it('a deleted Finance transaction: the link is kept with its snapshot, counts 0, and is listed for review (the period is open again)', () => {
    const t = txn(-12000);
    const p = period([f(inv(12000)), link(t)], lookupOf(), LATE);
    expect(p.amounts).toMatchObject({ paid: 0, remaining: 12000 });
    expect(p.amounts.finance).toMatchObject({ linked: true });
    expect(p.amounts.finance!.counts).toMatchObject({ review: 1, counted: 0 });
    expect(p.amounts.finance!.pieces[0]).toMatchObject({ role: 'review', spendCents: 0 });
    expect(p.amounts.finance!.pieces[0].resolved.state).toBe('missing');
    expect(p.label).toBe('overdue');
    expect(p.effective.some((x) => x.body.fact === 'payment-link')).toBe(true); // nothing was removed
  });

  it('a transaction that became a transfer is not spending: kept, counts nothing, listed', () => {
    const t = txn(-12000);
    const xfer: Txn = { ...t, transferTxnId: 999 };
    const p = period([f(inv(12000)), link(t)], lookupOf(xfer));
    expect(p.amounts.paid).toBe(0);
    expect(p.amounts.finance!.pieces[0]).toMatchObject({ role: 'review' });
    expect(p.amounts.finance!.pieces[0].resolved.state).toBe('not-spending');
  });

  it('a stale split fingerprint (parts reordered or changed): counts nothing, is never moved to the part now in that position', () => {
    const t = splitTxn([[-7000, 5], [-5000, 6]]);
    const ref = link(t, 0);
    const reordered: Txn = { ...t, splits: [t.splits![1], t.splits![0]] };
    const p = period([f(inv(12000)), ref], lookupOf(reordered));
    expect(p.amounts.paid).toBe(0);
    expect(p.amounts.finance!.pieces[0]).toMatchObject({ role: 'review' });
    expect(p.amounts.finance!.pieces[0].resolved.state).toBe('split-changed');
    const merged: Txn = { ...t, splits: undefined };
    expect(period([f(inv(12000)), ref], lookupOf(merged)).amounts.finance!.pieces[0].resolved.state).toBe('split-changed');
  });

  it('every amount is recomputed on each read: the same records give a different answer when Finance differs, with no stored paid bit', () => {
    const t = txn(-12000);
    const rs = [f(inv(12000)), link(t)];
    const states = [lookupOf(t), lookupOf({ ...t, amountCents: -3000 }), lookupOf()].map((l) => period(rs, l).amounts.paid);
    expect(states).toEqual([12000, 3000, 0]);
  });
});

describe('B3 Finance status: pending, cleared and reconciled are Finance\'s own words and never change a number', () => {
  const STATUSES: TxnStatus[] = ['pending', 'cleared', 'reconciled'];
  it('the same payment gives the same amounts whatever its Finance status; only the words differ', () => {
    const out = STATUSES.map((status) => { const t = txn(-12000, { status }); const p = period([f(inv(12000)), link(t)], lookupOf(t)); return { status, paid: p.amounts.paid, remaining: p.amounts.remaining, label: p.label, ev: evidenceText(p, money), sum: statusSummary(p.amounts.finance!) }; });
    expect(new Set(out.map((o) => `${o.paid}|${o.remaining}|${o.label}`)).size).toBe(1);
    expect(out.map((o) => o.sum)).toEqual(['Recorded in Finance: pending', 'Recorded in Finance: cleared', 'Recorded in Finance: reconciled']);
    for (const o of out) expect(o.ev).toContain(STATUS_DETAIL[o.status]);
  });

  it('pending is "entered, not marked cleared", cleared is not proof the provider received it, reconciled means a completed reconciliation', () => {
    expect(STATUS_DETAIL.pending).toMatch(/not marked cleared/);
    expect(STATUS_DETAIL.pending).toMatch(/does not show that the provider has been paid/);
    expect(STATUS_DETAIL.cleared).toMatch(/does not by itself show that the provider received it/);
    expect(STATUS_DETAIL.reconciled).toMatch(/reconciliation you completed/);
  });

  it('mixed statuses are listed together; an imported bank-file row is marked; a pending one is never called cleared', () => {
    const a = txn(-6000, { status: 'cleared', externalId: 'x1' }), b = txn(-6000, { status: 'pending' });
    const p = period([f(inv(12000)), link(a), link(b)], lookupOf(a, b));
    expect(statusSummary(p.amounts.finance!)).toBe('Recorded in Finance: 1 pending, 1 cleared');
    expect(p.amounts.finance!.pieces.map((x) => x.imported)).toEqual([true, false]);
    const pend = period([f(inv(12000)), link(b), link(txn(-6000, { status: 'pending' }))], lookupOf(b));
    expect(statusSummary(financePayments([{ factId: 1, createdAt: 1, ref: makeTxnRef(b) }], lookupOf(b)))).not.toMatch(/cleared/);
    expect(pend).toBeDefined();
  });

  it('only counted pieces carry a status: a missing transaction has none', () => {
    const t = txn(-12000);
    const p = period([f(inv(12000)), link(t)], lookupOf());
    expect(p.amounts.finance!.pieces[0].status).toBeNull();
    expect(statusSummary(p.amounts.finance!)).toBeNull();
  });
});

describe('B3 one money source: typed or Finance, never both added', () => {
  it('Finance links win over a typed amount; the typed amount is left out of every figure but kept and shown', () => {
    const t = txn(-12000);
    const p = period([f(inv(12000)), f(paidOut('2026-11-09', 12000)), link(t)], lookupOf(t));
    expect(p.amounts).toMatchObject({ paid: 12000, source: 'finance', typedLeftOut: [12000], remaining: 0 }); // 12000, not 24000
    expect(amountLine(p, money)).toMatch(/a typed payment \(\$120\.00\) is left out/);
  });

  it('a typed amount alone still counts (the B2 behaviour is unchanged)', () => {
    const p = period([f(inv(12000)), f(paidOut('2026-11-09', 5000))], lookupOf());
    expect(p.amounts).toMatchObject({ paid: 5000, source: 'typed', typedLeftOut: [], finance: null, remaining: 7000 });
    expect(p.label).toBe('partly-paid');
  });

  it('even when every link is stale the typed amount does not stand in silently: Finance is the chosen source and counts 0 until the owner looks', () => {
    const t = txn(-12000);
    const p = period([f(inv(12000)), f(paidOut('2026-11-09', 12000)), link(t)], lookupOf());
    expect(p.amounts).toMatchObject({ paid: 0, source: 'finance', typedLeftOut: [12000] });
  });

  it('a typed record that was set aside (superseded) is history: it is not counted and not "left out"', () => {
    const t = txn(-12000);
    const typed = fact(1, SLOT, paidOut('2026-11-09', 12000), 50, 50, { supersededBy: 51 });
    const p = period([f(inv(12000)), typed, fact(1, SLOT, { fact: 'payment-link', ref: makeTxnRef(t) }, 51)], lookupOf(t));
    expect(p.amounts).toMatchObject({ paid: 12000, typedLeftOut: [] });
    expect(p.superseded.map((r) => r.id)).toEqual([50]);
  });

  it('a "paid outside, no amount" declaration is not an amount, so it does not conflict with links and adds nothing', () => {
    const t = txn(-5000);
    const p = period([f(inv(12000)), f(paidOut('2026-11-09', null)), link(t)], lookupOf(t));
    expect(p.amounts).toMatchObject({ paid: 5000, typedLeftOut: [] });
  });
});

describe('B3 declarations never silently override live Finance (B0 6.4, C1 to C5)', () => {
  it('a paid-in-full declaration alone is "marked paid", with no amount counted', () => {
    const p = period([f(paidFull())], lookupOf());
    expect(p.label).toBe('marked-paid');
    expect(p.amounts.paid).toBe(0);
  });

  it('declared paid in full with Finance showing less: the owner\'s statement is respected and the difference is stated (C4), not hidden', () => {
    const t = txn(-10000);
    const p = period([f(inv(12000)), f(paidFull()), link(t)], lookupOf(t));
    expect(p.label).toBe('marked-paid-short');
    expect(p.amounts).toMatchObject({ paid: 10000, remaining: 2000 }); // the figures stay honest
    expect(labelText(p, money)).toBe('Marked paid in full by you; Finance shows $100.00 of $120.00');
    expect(p.open).toBe(false);
  });

  it('declared paid in full and Finance shows the whole amount: simply Paid', () => {
    const t = txn(-12000);
    expect(period([f(inv(12000)), f(paidFull()), link(t)], lookupOf(t)).label).toBe('paid');
  });

  it('declared paid in full but the linked payment was deleted: the declaration is SUSPENDED (needs review), not trusted over Finance (C1)', () => {
    const t = txn(-12000);
    const p = period([f(inv(12000)), f(paidFull()), link(t)], lookupOf());
    expect(p.suspended).toBe(true);
    expect(p.label).toBe('needs-review');
    expect(evidenceText(p, money)).toMatch(/missing, changed or was reversed/);
  });

  it('declared paid in full but the payment was refunded in full: suspended (C2)', () => {
    const out = txn(-12000), back = txn(12000);
    const p = period([f(inv(12000)), f(paidFull()), link(out), link(back)], lookupOf(out, back));
    expect(p.suspended).toBe(true);
    expect(p.label).toBe('needs-review');
  });

  it('a declaration with no Finance links at all is never suspended (B2 behaviour)', () => {
    expect(period([f(paidFull())], lookupOf()).suspended).toBe(false);
  });

  it('a typed "paid outside" amount with a stale link is not a declaration either: Finance is the source and counts 0', () => {
    const t = txn(-12000);
    const p = period([f(inv(12000)), f(paidOut('2026-11-09', 12000)), link(t)], lookupOf(), LATE);
    expect(p.amounts.paid).toBe(0);
    expect(p.label).toBe('overdue');
  });

  it('a skip beside a link whose transaction is gone: the link is still payment evidence, so the skip is ignored for the label and the disagreement is reported', () => {
    const t = txn(-12000);
    const p = period([f(inv(12000)), f(skipF('away')), link(t)], lookupOf());
    expect(p.amounts.paid).toBe(0); // nothing counts, yet a payment WAS recorded
    expect(p.skipVsPayment).toBe(true);
    expect(p.skipped).toBe(false);
    const conflicts = findConflicts([OB], [fact(1, SLOT, inv(12000), 1), fact(1, SLOT, skipF('away'), 2), fact(1, SLOT, { fact: 'payment-link', ref: makeTxnRef(t) }, 3)]);
    expect(conflicts.filter((c) => c.kind === 'skip-payment')).toHaveLength(1);
  });

  it('a skip beside a Finance payment: the payment counts and the skip is ignored (a payment is evidence)', () => {
    const t = txn(-12000);
    const p = period([f(inv(12000)), f(skipF('away')), link(t)], lookupOf(t));
    expect(p.skipVsPayment).toBe(true);
    expect(p.skipped).toBe(false);
    expect(p.amounts.paid).toBe(12000);
  });
});

describe('B3 wording: Finance\'s own status words only, never settlement or bank claims', () => {
  const FORBIDDEN = /\b(settled|received by the (bank|provider)|bank-confirmed|bank confirmed|confirmed by (your|the) bank|succeeded|processed|failed|bounced|declined)\b/i;
  it('no label, evidence line or status text claims bank settlement', () => {
    const t = txn(-12000, { status: 'cleared' });
    const worlds: Period[] = [
      period([f(inv(12000)), link(t)], lookupOf(t)), period([f(inv(12000)), link(t)], lookupOf()), period([f(inv(12000)), f(paidFull()), link(t)], lookupOf()),
      period([f(inv(12000)), f(paidFull()), link(txn(-100))], lookupOf(txn(-100))), period([f(inv(12000))], lookupOf(), LATE),
    ];
    for (const p of worlds) { expect(LABEL_TEXT[p.label]).not.toMatch(FORBIDDEN); expect(evidenceText(p, money)).not.toMatch(FORBIDDEN); expect(labelText(p, money)).not.toMatch(FORBIDDEN); }
    for (const s of ['pending', 'cleared', 'reconciled'] as const) { expect(STATUS_WORDS[s]).not.toMatch(FORBIDDEN); expect(STATUS_DETAIL[s]).not.toMatch(FORBIDDEN); }
  });

  it('"cleared" appears only as Finance\'s own status word ("Recorded in Finance: cleared"), never as a Bills claim', () => {
    for (const l of Object.keys(LABEL_TEXT) as LabelId[]) { expect(LABEL_TEXT[l]).not.toMatch(/cleared/i); expect(evidenceLine(l)).not.toMatch(/cleared/i); }
    const t = txn(-12000, { status: 'cleared' });
    expect(evidenceText(period([f(inv(12000)), link(t)], lookupOf(t)), money)).toMatch(/Recorded in Finance: cleared/);
  });

  it('autopay is not "paid" and now says "not yet seen in Finance"', () => {
    expect(LABEL_TEXT['autopay-check']).toBe('Autopay not yet seen in Finance, please check');
    expect(primaryLabel({ skip: false, owed: 12000, owedFromBill: true, paid: 0, remaining: 12000, declared: false, suspended: false, timing: 'past', days: -10, how: 'auto', invoiceRecorded: true })).toBe('autopay-check');
  });
});

describe('B3 reconciliation: every figure equals the pieces behind it (deterministic matrix and random worlds)', () => {
  /** A small seeded generator (mulberry32) so the "random" worlds are the same on every run. */
  const rng = (seed: number) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let x = Math.imul(seed ^ (seed >>> 15), 1 | seed); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
  const pick = <T,>(r: () => number, xs: T[]) => xs[Math.floor(r() * xs.length)];

  function world(r: () => number) {
    const txns: Txn[] = [];
    const records: CycleRecord[] = [];
    const bill = pick(r, [null, 0, 6000, 12000, 12000]);
    if (bill !== null) records.push(f(inv(bill)));
    if (r() < 0.25) records.push(f(creditF(pick(r, [500, 2000, 15000]))));
    const nTx = Math.floor(r() * 4);
    for (let i = 0; i < nTx; i++) {
      const kind = pick(r, ['out', 'out', 'out', 'back', 'split']);
      const status = pick<TxnStatus>(r, ['pending', 'cleared', 'reconciled']);
      const t = kind === 'back' ? txn(pick(r, [2000, 6000, 12000]), { status }) : kind === 'split' ? splitTxn([[-4000, 5], [-8000, 6]], { status }) : txn(-pick(r, [3000, 6000, 12000]), { status });
      txns.push(t);
      const mode = kind === 'split' ? pick(r, ['whole', 'part0', 'part1', 'part0']) : 'whole';
      records.push(link(t, mode === 'part0' ? 0 : mode === 'part1' ? 1 : undefined));
      if (r() < 0.2) records.push(link(t, mode === 'part0' ? 0 : mode === 'part1' ? 1 : undefined)); // a repeat
    }
    if (r() < 0.3) records.push(f(paidOut('2026-11-09', pick(r, [null, 4000, 12000]))));
    if (r() < 0.2) records.push(f(paidFull()));
    if (r() < 0.1) records.push(f(skipF()));
    // damage some of it after the links were made
    const live = new Map(txns.map((t) => [t.id!, { ...t }]));
    for (const t of txns) { const x = r(); if (x < 0.12) live.delete(t.id!); else if (x < 0.22) live.set(t.id!, { ...t, amountCents: Math.round(t.amountCents / 2) }); else if (x < 0.27 && t.splits) live.set(t.id!, { ...t, splits: [t.splits[1], t.splits[0]] }); else if (x < 0.31) live.set(t.id!, { ...t, transferTxnId: 7 }); }
    return { records, lookup: ((id: number) => live.get(id)) as TxnLookup, today: pick(r, [TODAY, LATE]) };
  }

  it('300 random worlds: one label, paid never negative, the net equals the counted pieces and equals spend(), typed never added to Finance, no settlement word', () => {
    const r = rng(20261107);
    let withLinks = 0, withReview = 0, withReversal = 0, withTypedLeftOut = 0, declaredShort = 0, suspended = 0;
    for (let i = 0; i < 300; i++) {
      const w = world(r);
      const p = period(w.records, w.lookup, w.today);
      const a = p.amounts;
      expect(Object.keys(LABEL_TEXT)).toContain(p.label);
      expect(a.paid).toBeGreaterThanOrEqual(0);
      if (a.owed !== null) { expect(a.remaining).toBe(Math.max(0, a.owed - a.paid)); expect(a.overpaid).toBe(Math.max(0, a.paid - a.owed)); } else expect(a.remaining).toBeNull();
      if (p.label === 'paid') expect(a.remaining ?? 0).toBe(0); // never "Paid" while something is left
      if (p.label === 'overdue' || p.label === 'not-confirmed') expect(a.paid).toBe(0); // never late with money recorded
      expect(`${LABEL_TEXT[p.label]} ${evidenceText(p, money)} ${amountLine(p, money)}`).not.toMatch(/\b(settled|bank-confirmed|succeeded|processed|failed)\b/i);
      const fin = a.finance;
      if (!fin) { expect(a.typedLeftOut).toEqual([]); expect(a.source).not.toBe('finance'); continue; }
      withLinks++;
      expect(a.source).toBe('finance');
      // reconciles to the counted pieces, and to the shared spend() on the same references
      const counted = fin.pieces.filter((x) => x.role === 'counted');
      expect(counted.reduce((n, x) => n + x.spendCents, 0)).toBe(fin.netCents);
      expect(fin.pieces.filter((x) => x.role !== 'counted').every((x) => x.spendCents === 0)).toBe(true);
      expect(new Set(counted.map((x) => x.key)).size).toBe(counted.length); // each piece once
      const refs = p.effective.flatMap((x) => (x.body.fact === 'payment-link' ? [x.body.ref] : []));
      const s = spend([{ id: 'x', assetId: 0, group: 'paid', title: '', manualCents: null, refs }], w.lookup, ['paid']);
      expect(fin.netCents).toBe(s.totalCents);
      expect(a.paid).toBe(Math.max(0, s.totalCents));
      // a covered part is never counted while its whole is
      for (const x of fin.pieces.filter((y) => y.role === 'covered')) expect(counted.some((y) => y.key === `${x.ref.txnId}:w`)).toBe(true);
      // typed amounts are never added
      const typed = [...new Set(p.effective.flatMap((x) => (x.body.fact === 'paid-outside' && x.body.cents ? [x.body.cents] : [])))];
      expect(a.typedLeftOut).toEqual(typed);
      if (typed.length) withTypedLeftOut++;
      if (fin.counts.review > 0) withReview++;
      if (fin.reversed) withReversal++;
      if (p.label === 'marked-paid-short') declaredShort++;
      if (p.suspended) { suspended++; expect(p.declared).toBe(true); expect(a.paid).toBe(0); }
    }
    // the generator really did exercise every branch (so the invariants above were not vacuous)
    for (const n of [withLinks, withReview, withReversal, withTypedLeftOut, declaredShort, suspended]) expect(n).toBeGreaterThan(0);
  });

  it('deterministic matrix: invoice x payments x typed x declaration (every combination reconciles and gives exactly one label)', () => {
    const invoices: (number | null)[] = [null, 0, 12000];
    const payments: { name: string; txns: Txn[] }[] = [
      { name: 'none', txns: [] }, { name: 'full', txns: [txn(-12000)] }, { name: 'partial', txns: [txn(-5000)] }, { name: 'two halves', txns: [txn(-6000), txn(-6000)] },
      { name: 'refunded', txns: [txn(-12000), txn(12000)] }, { name: 'over', txns: [txn(-15000)] },
    ];
    let n = 0;
    for (const inv0 of invoices) for (const pay of payments) for (const typed of [null, 4000]) for (const decl of [false, true]) for (const status of ['pending', 'cleared', 'reconciled'] as TxnStatus[]) {
      const ts = pay.txns.map((t) => ({ ...t, status }));
      const records = [...(inv0 !== null ? [f(inv(inv0))] : []), ...ts.map((t) => link(t)), ...(typed ? [f(paidOut('2026-11-09', typed))] : []), ...(decl ? [f(paidFull())] : [])];
      const p = period(records, lookupOf(...ts), LATE);
      n++;
      const net = ts.reduce((s, t) => s - t.amountCents, 0);
      if (ts.length) expect(p.amounts.finance!.netCents, `${inv0}/${pay.name}`).toBe(net);
      expect(p.amounts.paid, `${inv0}/${pay.name}/${typed}`).toBe(ts.length ? Math.max(0, net) : typed ?? 0);
      expect(p.amounts.source).toBe(ts.length ? 'finance' : typed ? 'typed' : 'none');
      if (ts.length && typed) expect(p.amounts.typedLeftOut).toEqual([typed]);
      if (p.label === 'paid' || p.label === 'partly-paid') expect(p.amounts.paid).toBeGreaterThan(0);
      if (p.label === 'paid') expect(p.amounts.remaining ?? 0).toBe(0);
    }
    expect(n).toBe(3 * 6 * 2 * 2 * 3);
  });
});
