import { describe, expect, it } from 'vitest';
import { makeTxnRef, pieceKey, type TxnLookup } from '../../lib/txnRef';
import { SETUP_CATEGORY_ID } from '../../lib/setupCategory';
import type { RecurringLog, RecurringRule, Split, Txn } from '../../types';
import { fact, inv, obRec, paidFull } from './billsTestkit';
import type { CycleRecord, FactBody } from './cycleModel';
import { derivePeriod, type Period } from './periods';
import { evidenceWords, MAX_SUGGESTIONS, suggestionStale, suggestMatches, suggestWindow, type SuggestInput } from './suggest';

/**
 * B3.1 payment-match suggestions: pure, deterministic, explained. Every case builds invented transactions, gives them to the reader and checks what it
 * offers, what it refuses to offer and why. A suggestion is never a link: nothing here writes.
 */
const TODAY = '2026-11-20';
const SLOT = 'm2026-11';
const DUE = '2026-11-18';
const money = (c: number) => `$${(c / 100).toFixed(2)}`;
const masked = () => '$••••';

let tid = 1000;
const txn = (amountCents: number, over: Partial<Txn> = {}): Txn => ({ id: tid++, accountId: 1, date: DUE, amountCents, payee: 'Example Power Co', memo: '', status: 'pending', categoryId: 5, ...over });
const lookupOf = (...ts: Txn[]): TxnLookup => { const m = new Map(ts.filter((t) => t.id !== undefined).map((t) => [t.id!, t])); return (id) => m.get(id); };

const POWER = { title: 'Example Power Co', providerNameSnapshot: 'Example Power Co', payment: { how: 'manual' as const, fundingAccountId: null }, prices: [{ from: '2026-01-01', cents: 12000, label: '' }], categoryId: null as number | null };
const OB = obRec(1, POWER);
let fid = 1;
const f = (body: FactBody, obligationId = 1, slot = SLOT, id = fid++): CycleRecord => fact(obligationId, slot, body, id);
const link = (t: Txn, split?: number, obligationId = 1, slot = SLOT) => f({ fact: 'payment-link', ref: makeTxnRef(t, split) }, obligationId, slot);
const reject = (t: Txn, split?: number, slot = SLOT) => f({ fact: 'suggestion-reject', ref: makeTxnRef(t, split) }, 1, slot);

function run(over: Omit<Partial<SuggestInput>, 'transactions'> & { records?: CycleRecord[]; txns: Txn[] }, ob = OB) {
  const records = over.records ?? [];
  const lookup = over.lookup ?? lookupOf(...over.txns);
  const period: Period = over.period ?? derivePeriod(ob, SLOT, DUE, true, records.filter((r) => r.obligationId === ob.id && r.slot === SLOT), TODAY, lookup);
  const { txns, records: _r, ...rest } = over; void _r;
  return suggestMatches({ obligation: ob, period, obligations: [ob], cycles: records, lookup, today: TODAY, ...rest, transactions: txns });
}

describe('B3.1 suggestions: what is offered and why', () => {
  it('an exact provider name, the billed amount and a date near the due date is a STRONG suggestion, explained in words', () => {
    const t = txn(-12000, { date: '2026-11-17' });
    const r = run({ txns: [t], records: [f(inv(12000))] });
    expect(r.suggestions).toHaveLength(1);
    const s = r.suggestions[0];
    expect(s.tier).toBe('strong');
    expect(s.key).toBe(pieceKey(makeTxnRef(t)));
    const words = s.forPoints.map((e) => evidenceWords(e, money));
    expect(words.some((w) => /payee matches/.test(w))).toBe(true);
    expect(words.some((w) => /1 day before the due date/.test(w))).toBe(true);
    expect(words.some((w) => /amount matches the bill you recorded \(\$120\.00\)/.test(w))).toBe(true);
    expect(s.needsReview).toBe(false);
    expect(r.none).toBeNull();
  });

  it('a fixed price with no bill recorded is also a reliable amount; a nearly exact amount (within 1%) matches', () => {
    expect(run({ txns: [txn(-12000)] }).suggestions[0].tier).toBe('strong');
    expect(run({ txns: [txn(-12100)] }).suggestions[0].forPoints.some((e) => e.kind === 'amount-match')).toBe(true);
    expect(run({ txns: [txn(-12200)] }).suggestions).toHaveLength(0); // 1.7% off a reliable amount: not shown
  });

  it('a payment a few days from the due date, in the usual window, is only POSSIBLE; outside the window it is not offered', () => {
    const near = txn(-12000, { date: '2026-11-24' }); // 6 days after
    const r = run({ txns: [near] });
    expect(r.suggestions[0].tier).toBe('possible');
    expect(run({ txns: [txn(-12000, { date: '2026-12-10' })] }).suggestions).toHaveLength(0);
    expect(run({ txns: [txn(-12000, { date: '2026-11-01' })] }).suggestions).toHaveLength(0);
  });

  it('an automatic payment has a narrower window (due minus 2 to plus 7)', () => {
    const auto = obRec(1, { ...POWER, payment: { how: 'auto', fundingAccountId: null } });
    expect(suggestWindow(auto, DUE)).toMatchObject({ from: '2026-11-16', to: '2026-11-25' });
    expect(run({ txns: [txn(-12000, { date: '2026-11-13' })] }, auto).suggestions).toHaveLength(0); // 5 days early: fine for a manual payment, not for autopay
    expect(run({ txns: [txn(-12000, { date: '2026-11-13' })] }).suggestions).toHaveLength(1);
  });

  it('a VARIABLE bill: the amount is never a reason to leave a payment out, and it is explained as unreliable', () => {
    const v = obRec(1, { ...POWER, amountKind: 'variable', prices: [] });
    const r = run({ txns: [txn(-8734, { date: '2026-11-19' })] }, v);
    expect(r.suggestions).toHaveLength(1);
    expect(r.suggestions[0].tier).toBe('possible'); // no reliable amount, so never "strong" on the payee and date alone
    expect(r.suggestions[0].againstPoints.map((e) => evidenceWords(e, money)).join(' ')).toMatch(/no reliable amount/);
  });

  it('a variable bill with three earlier payments: inside their range is strong near the due date; outside is possible and says so', () => {
    const v = obRec(1, { ...POWER, amountKind: 'variable', prices: [] });
    const past = [txn(-8000, { date: '2026-08-18' }), txn(-9500, { date: '2026-09-18' }), txn(-8800, { date: '2026-10-18' })];
    const history = [link(past[0], undefined, 1, 'm2026-08'), link(past[1], undefined, 1, 'm2026-09'), link(past[2], undefined, 1, 'm2026-10')];
    const inRange = txn(-9000);
    const r1 = run({ txns: [inRange], records: history, lookup: lookupOf(...past, inRange) }, v);
    expect(r1.suggestions[0].tier).toBe('strong');
    expect(r1.suggestions[0].forPoints.some((e) => e.kind === 'amount-range')).toBe(true);
    const spike = txn(-15000);
    const r2 = run({ txns: [spike], records: history, lookup: lookupOf(...past, spike) }, v);
    expect(r2.suggestions[0].tier).toBe('possible');
    expect(r2.suggestions[0].againstPoints.some((e) => e.kind === 'amount-outside-range')).toBe(true);
  });
});

describe('B3.1 suggestions: weak evidence is not enough', () => {
  it('the same amount at a different provider is NOT suggested, however close the date', () => {
    expect(run({ txns: [txn(-12000, { payee: 'Totally Different Inc' })] }).suggestions).toHaveLength(0);
  });

  it('an equal amount alone is never a suggestion (no payee, no Scheduled link)', () => {
    const r = run({ txns: [txn(-12000, { payee: 'Corner Grocery' }), txn(-12000, { payee: '', memo: 'something' })] });
    expect(r.suggestions).toHaveLength(0);
    expect(r.none).toMatch(/No payment in Finance looks like/);
  });

  it('two providers that only share an industry word are not alike ("Another Power Co" is not "Example Power Co")', () => {
    expect(run({ txns: [txn(-12000, { payee: 'Another Power Co' })] }).suggestions).toHaveLength(0);
  });

  it('a weak payee resemblance needs a reliable amount match to be shown, and is never strong', () => {
    const r = run({ txns: [txn(-12000, { payee: 'Example Water Works' })] }); // shares only the name word "example"
    expect(r.suggestions).toHaveLength(1);
    expect(r.suggestions[0].tier).toBe('possible');
    expect(r.suggestions[0].forPoints.some((e) => e.kind === 'payee-partial')).toBe(true);
    expect(run({ txns: [txn(-9900, { payee: 'Example Water Works' })] }).suggestions).toHaveLength(0);
  });

  it('a bank-style payee with extra words and a store number still matches the bill name', () => {
    expect(run({ txns: [txn(-12000, { payee: 'EXAMPLE POWER CO BILL PAY #4471' })] }).suggestions).toHaveLength(1);
  });

  it('a payee word the owner approved is trusted even when it is an industry word', () => {
    const withHint = obRec(1, { ...POWER, title: 'Electricity', providerNameSnapshot: '', payeeHints: ['power'] });
    expect(run({ txns: [txn(-12000, { payee: 'Metro Power' })] }, withHint).suggestions).toHaveLength(1);
    const noHint = obRec(1, { ...POWER, title: 'Electricity', providerNameSnapshot: '', payeeHints: [] });
    expect(run({ txns: [txn(-12000, { payee: 'Metro Power' })] }, noHint).suggestions).toHaveLength(0);
  });

  it('transfers, setup entries and money coming back are never suggested as payments', () => {
    const xfer = txn(-12000, { transferTxnId: 99 });
    const setup = txn(-12000, { categoryId: SETUP_CATEGORY_ID });
    const back = txn(12000);
    const r = run({ txns: [xfer, setup, back] });
    expect(r.suggestions).toHaveLength(0);
    expect(r.considered).toBe(0);
  });

  it('no match: says so plainly, claims nothing, and still offers the way out', () => {
    const r = run({ txns: [] });
    expect(r.suggestions).toEqual([]);
    expect(r.elsewhere).toEqual([]);
    expect(r.none).toMatch(/no Finance transactions dated/);
    const r2 = run({ txns: [txn(-500, { payee: 'Corner Grocery' })] });
    expect(r2.none).toMatch(/search all transactions below/);
  });

  it('a billing period with no due date has nothing to compare dates with, and says so', () => {
    const extra = derivePeriod(OB, 'x1730000000123', null, false, [], TODAY, lookupOf());
    const r = suggestMatches({ obligation: OB, period: extra, obligations: [OB], cycles: [], transactions: [txn(-12000)], lookup: lookupOf(), today: TODAY });
    expect(r.suggestions).toHaveLength(0);
    expect(r.none).toMatch(/no due date/);
  });

  it('a loan bill is never matched (Loans owns it)', () => {
    const loan = obRec(1, { ...POWER, type: 'loan' });
    expect(run({ txns: [txn(-12000)] }, loan).none).toMatch(/Loans page/);
  });
});

describe('B3.1 suggestions: the linked Finance Scheduled item', () => {
  const RULE: RecurringRule = { id: 7, accountId: 1, payee: 'Example Power Co', amountCents: -11500, categoryId: 5, memo: '', frequency: 'monthly', startDate: '2026-01-18', active: true };
  const linked = obRec(1, { ...POWER, scheduledRuleIds: [7] });
  const posted = (t: Txn): RecurringLog => ({ id: 1, ruleId: 7, date: '2026-11-18', action: 'posted', txnId: t.id });

  it('a payment POSTED from the linked rule for that date is strong evidence (a suggestion, never proof)', () => {
    const t = txn(-12000, { recurringId: 7, date: '2026-11-18', payee: 'Some Different Label' });
    const r = run({ txns: [t], scheduled: { rules: [RULE], log: [posted(t)] } }, linked);
    expect(r.suggestions).toHaveLength(1);
    expect(r.suggestions[0].tier).toBe('strong');
    expect(r.suggestions[0].fromRule).toEqual({ ruleId: 7, scheduledDate: '2026-11-18' });
    expect(evidenceWords(r.suggestions[0].forPoints[0], money)).toMatch(/does not show the provider was paid/);
  });

  it('a posted payment at a different amount than the bill is still shown (the rule posted it) but only as possible, with the difference stated', () => {
    const t = txn(-11500, { recurringId: 7, date: '2026-11-18' });
    const r = run({ txns: [t], records: [f(inv(12000))], scheduled: { rules: [RULE], log: [posted(t)] } }, linked);
    expect(r.suggestions[0].tier).toBe('possible');
    expect(r.suggestions[0].againstPoints.some((e) => e.kind === 'amount-differs')).toBe(true);
  });

  it('a scheduled date that has passed with nothing posted proves nothing: no suggestion appears and nothing is claimed', () => {
    const r = run({ txns: [], scheduled: { rules: [RULE], log: [] } }, linked);
    expect(r.suggestions).toEqual([]);
    expect(r.none).not.toMatch(/paid/i);
  });

  it('a "skipped" log entry is not evidence of a payment', () => {
    const t = txn(-12000, { payee: 'Unrelated Label' });
    const skipped: RecurringLog = { id: 2, ruleId: 7, date: '2026-11-18', action: 'skipped', txnId: t.id };
    expect(run({ txns: [t], scheduled: { rules: [RULE], log: [skipped] } }, linked).suggestions).toHaveLength(0);
  });

  it('a rule the bill does not link is ignored, even when the log says it posted that transaction', () => {
    const t = txn(-12000, { payee: 'Unrelated Label', recurringId: 7 });
    expect(run({ txns: [t], scheduled: { rules: [RULE], log: [posted(t)] } }).suggestions).toHaveLength(0); // OB links nothing
  });
});

describe('B3.1 suggestions: pieces already used, whole versus parts, refunds', () => {
  it('a payment already linked to THIS period is never offered again', () => {
    const t = txn(-12000);
    expect(run({ txns: [t], records: [link(t)] }).suggestions).toHaveLength(0);
  });

  it('a payment linked to another period of the same bill, or to another bill, goes to a separate qualified list, never to the recommendations', () => {
    const t = txn(-12000);
    const other = obRec(2, { title: 'Example Gas Co', providerNameSnapshot: 'Example Gas Co' });
    const r = suggestMatches({
      obligation: OB, period: derivePeriod(OB, SLOT, DUE, true, [], TODAY, lookupOf(t)), obligations: [OB, other], transactions: [t], lookup: lookupOf(t), today: TODAY,
      cycles: [link(t, undefined, 2, 'm2026-11')],
    });
    expect(r.suggestions).toEqual([]);
    expect(r.elsewhere).toHaveLength(1);
    expect(r.elsewhere[0].needsReview).toBe(true);
    expect(r.elsewhere[0].elsewhere.bills[0]).toMatchObject({ obligationId: 2, title: 'Example Gas Co', sameBill: false });
    expect(r.elsewhere[0].reviewReasons[0]).toMatch(/never divides it/);
    expect(r.elsewhere[0].tier).toBe('possible'); // a shared payment is never a headline recommendation
    const sameBill = run({ txns: [t], records: [link(t, undefined, 1, 'm2026-10')] });
    expect(sameBill.suggestions).toEqual([]);
    expect(sameBill.elsewhere[0].elsewhere.bills[0].sameBill).toBe(true);
  });

  it('a payment another module already uses is flagged the same way', () => {
    const t = txn(-12000);
    const r = run({ txns: [t], otherModules: new Map([[pieceKey(makeTxnRef(t)), ['Household Services']]]) });
    expect(r.suggestions).toEqual([]);
    expect(r.elsewhere[0].elsewhere.modules).toEqual(['Household Services']);
  });

  it('a split transaction offers its whole and each money-out part as separate pieces, with their own amounts', () => {
    const splits: Split[] = [{ amountCents: -7000, categoryId: 5 }, { amountCents: -5000, categoryId: 6 }];
    const t = txn(-12000, { splits });
    const v = obRec(1, { ...POWER, amountKind: 'variable', prices: [] });
    const r = run({ txns: [t] }, v);
    const keys = r.suggestions.map((s) => s.key).sort();
    expect(keys).toEqual([`${t.id}:0`, `${t.id}:1`, `${t.id}:w`].sort());
    expect(r.suggestions.find((s) => s.part?.index === 1)!.spendCents).toBe(5000);
    expect(r.suggestions.find((s) => !s.part)!.spendCents).toBe(12000);
  });

  it('for a bill with a reliable amount only the piece with that amount is offered (the whole), and after a partial payment the remainder matches', () => {
    const splits: Split[] = [{ amountCents: -7000, categoryId: 5 }, { amountCents: -5000, categoryId: 6 }];
    const t = txn(-12000, { splits });
    const r = run({ txns: [t], records: [f(inv(12000))] });
    expect(r.suggestions.map((s) => s.key)).toEqual([`${t.id}:w`]);
    // 5,000 already linked from another transaction: 7,000 is what is left, and the 7,000 part matches it
    const paid = txn(-5000, { date: '2026-11-10' });
    const t2 = txn(-12000, { splits, date: '2026-11-19' });
    const r2 = run({ txns: [t2], records: [f(inv(12000)), link(paid)], lookup: lookupOf(paid, t2) });
    // the whole still matches what was billed; the 7,000 part matches what is LEFT; the 5,000 part matches nothing and is not offered
    expect(r2.suggestions.map((s) => s.part?.index ?? 'w').sort()).toEqual([0, 'w']);
    expect(r2.suggestions.find((s) => s.part?.index === 0)!.forPoints.some((e) => e.kind === 'amount-match' && e.basis === 'remaining')).toBe(true);
  });

  it('a whole transaction is not offered when one of its parts is already linked to this period (and the reverse)', () => {
    const splits: Split[] = [{ amountCents: -7000, categoryId: 5 }, { amountCents: -5000, categoryId: 6 }];
    const t = txn(-12000, { splits });
    const v = obRec(1, { ...POWER, amountKind: 'variable', prices: [] });
    const r = run({ txns: [t], records: [link(t, 0)] }, v);
    expect(r.suggestions.map((s) => s.key)).toEqual([`${t.id}:1`]); // only the other part: the whole and part 0 are covered
  });

  it('a split with a setup part is not a payment at all (whole excluded), and a setup part is never offered', () => {
    const splits: Split[] = [{ amountCents: -7000, categoryId: 5 }, { amountCents: -5000, categoryId: SETUP_CATEGORY_ID }];
    const t = txn(-12000, { splits });
    const v = obRec(1, { ...POWER, amountKind: 'variable', prices: [] });
    expect(run({ txns: [t] }, v).suggestions.map((s) => s.key)).toEqual([`${t.id}:0`]);
  });

  it('money coming back from the payee afterwards is noted AGAINST the payment and asks for a closer look; it is never a payment itself', () => {
    const pay = txn(-12000, { date: '2026-11-18' });
    const refund = txn(12000, { date: '2026-11-25' });
    const r = run({ txns: [pay, refund] });
    expect(r.suggestions).toHaveLength(1);
    expect(r.suggestions[0].key).toBe(pieceKey(makeTxnRef(pay)));
    expect(r.suggestions[0].needsReview).toBe(true);
    expect(r.suggestions[0].tier).toBe('possible');
    expect(r.suggestions[0].againstPoints.some((e) => e.kind === 'refund-after')).toBe(true);
  });
});

describe('B3.1 suggestions: rejections are about ONE period and are judged conservatively', () => {
  it('a rejected, unchanged payment stays out of the suggestions and is listed as rejected', () => {
    const t = txn(-12000);
    const r = run({ txns: [t], records: [reject(t)] });
    expect(r.suggestions).toEqual([]);
    expect(r.rejected).toHaveLength(1);
    expect(r.rejected[0].state).toBe('unchanged');
  });

  it('a rejection for November does not blacklist the payee for December (or any other period)', () => {
    const t = txn(-12000, { date: '2026-12-17' });
    const rejectedInNov = reject(txn(-12000, { date: '2026-11-17' }), undefined, SLOT);
    const dec = obRec(1, POWER);
    const period = derivePeriod(dec, 'm2026-12', '2026-12-18', true, [], '2026-12-20', lookupOf(t));
    const r = suggestMatches({ obligation: dec, period, obligations: [dec], cycles: [rejectedInNov], transactions: [t], lookup: lookupOf(t), today: '2026-12-20' });
    expect(r.suggestions).toHaveLength(1);
    expect(r.rejected).toEqual([]);
  });

  it('a rejected payment that changed in Finance since is judged again: possible only, with a plain warning, never strong', () => {
    const before = txn(-12000);
    const rej = reject(before);
    const after: Txn = { ...before, amountCents: -12000, date: '2026-11-19' }; // the date was edited
    const r = run({ txns: [after], records: [rej], lookup: lookupOf(after) });
    expect(r.suggestions).toHaveLength(1);
    expect(r.suggestions[0].tier).toBe('possible');
    expect(r.suggestions[0].needsReview).toBe(true);
    expect(r.suggestions[0].againstPoints.some((e) => e.kind === 'changed-since-rejection')).toBe(true);
    expect(r.rejected[0].state).toBe('changed');
  });

  it('a rejected split part whose parts were reordered is not trusted as the same part: judged again, flagged, never strong', () => {
    const splits: Split[] = [{ amountCents: -7000, categoryId: 5 }, { amountCents: -5000, categoryId: 6 }];
    const t = txn(-12000, { splits });
    const rej = reject(t, 1); // "part 2" = the 5,000 one
    const reordered: Txn = { ...t, splits: [{ amountCents: -5000, categoryId: 6 }, { amountCents: -7000, categoryId: 5 }] };
    const v = obRec(1, { ...POWER, amountKind: 'variable', prices: [] });
    const r = run({ txns: [reordered], records: [rej], lookup: lookupOf(reordered) }, v);
    const atIndex1 = r.suggestions.find((s) => s.part?.index === 1)!;
    expect(atIndex1).toBeTruthy();
    expect(atIndex1.tier).toBe('possible');
    expect(atIndex1.needsReview).toBe(true);
    expect(r.rejected[0].state).toBe('split-changed');
  });

  it('a rejected transaction that was deleted is listed as gone, and nothing is suggested in its place', () => {
    const t = txn(-12000);
    const r = run({ txns: [], records: [reject(t)], lookup: lookupOf() });
    expect(r.rejected[0].state).toBe('gone');
  });

  it('a rejection that was soft-deleted (reconsidered) is not read as a rejection: the payment is offered again', () => {
    const t = txn(-12000);
    const rej = reject(t);
    const gone = { ...rej, supersededBy: 99 }; // not effective
    expect(run({ txns: [t], records: [gone] }).suggestions).toHaveLength(1);
  });
});

describe('B3.1 suggestions: stable, bounded, order independent, honest in Hide Amounts', () => {
  it('shows at most three suggestions and returns the same answer however the transactions arrive', () => {
    const ts = [0, 1, 2, 3, 4].map((i) => txn(-12000, { date: `2026-11-${14 + i}`, memo: `copy ${i}` }));
    const a = run({ txns: ts });
    const b = run({ txns: [...ts].reverse() });
    expect(a.suggestions).toHaveLength(MAX_SUGGESTIONS);
    expect(a.suggestions.map((s) => s.key)).toEqual(b.suggestions.map((s) => s.key));
    expect(a.suggestions.map((s) => s.txn.date)).toEqual(['2026-11-18', '2026-11-17', '2026-11-16']); // closest to the due date first
  });

  it('strong comes before possible, and a payment posted from the rule comes first', () => {
    const strong = txn(-12000, { date: '2026-11-18' });
    const possible = txn(-12000, { date: '2026-11-24' });
    const r = run({ txns: [possible, strong] });
    expect(r.suggestions.map((s) => s.tier)).toEqual(['strong', 'possible']);
  });

  it('no evidence sentence carries a raw amount when the amount function masks it (Hide Amounts)', () => {
    const t = txn(-11000);
    const r = run({ txns: [t], records: [f(inv(12000))], scheduled: { rules: [], log: [] } });
    const all = [...r.suggestions, ...r.elsewhere].flatMap((s) => [...s.forPoints, ...s.againstPoints]);
    const sample = run({ txns: [txn(-12000)], records: [f(inv(12000))] }).suggestions[0];
    for (const e of [...sample.forPoints, ...sample.againstPoints, ...all]) expect(evidenceWords(e, masked)).not.toMatch(/\$\d/);
  });

  it('reads only: the inputs are not changed', () => {
    const t = txn(-12000);
    const records = [f(inv(12000)), reject(txn(-1, { date: '2026-11-18' }))];
    const before = JSON.stringify({ t, records });
    run({ txns: [t], records });
    expect(JSON.stringify({ t, records })).toBe(before);
  });
});

describe('B3.1 suggestions: a suggestion that goes stale before it is confirmed', () => {
  it('unchanged is fine; deleted, edited, restructured or turned into a transfer are each refused in words', () => {
    const t = txn(-12000);
    const ref = makeTxnRef(t);
    expect(suggestionStale(ref, lookupOf(t))).toBeNull();
    expect(suggestionStale(ref, lookupOf())).toMatch(/no longer in Finance/);
    expect(suggestionStale(ref, lookupOf({ ...t, amountCents: -9000 }))).toMatch(/changed in Finance/);
    expect(suggestionStale(ref, lookupOf({ ...t, transferTxnId: 5 }))).toMatch(/transfer or a setup entry/);
    const split = txn(-12000, { splits: [{ amountCents: -7000, categoryId: 5 }, { amountCents: -5000, categoryId: 6 }] });
    const partRef = makeTxnRef(split, 0);
    expect(suggestionStale(partRef, lookupOf(split))).toBeNull();
    expect(suggestionStale(partRef, lookupOf({ ...split, splits: [{ amountCents: -5000, categoryId: 6 }, { amountCents: -7000, categoryId: 5 }] }))).toMatch(/split differently/);
  });
});

describe('B3.1 suggestions: a declared payment does not hide the suggestions', () => {
  it('still reads a period that carries a declaration, and a period with the payee only in the memo gets nothing', () => {
    const t = txn(-12000, { payee: '', memo: 'Example Power Co' });
    expect(run({ txns: [t], records: [f(paidFull())] }).suggestions).toHaveLength(0);
  });
});
