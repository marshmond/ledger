import { describe, expect, it } from 'vitest';
import { SETUP_CATEGORY_ID } from '../../lib/setupCategory';
import type { Frequency, RecurringRule, Txn } from '../../types';
import { obRec } from './billsTestkit';
import { billSeedFromCandidate, cleaned, readableTitle, decisionFor, discoverRecurring, materialChange, SNOOZE_DAYS, type Decision, type DiscoveryInput } from './discovery';
import { scheduleProblem } from './schedule';
import { addD } from './billsTestkit';

/**
 * B3.1 recurring-expense discovery: pure and deterministic. Invented payees only. The reader proposes; these tests check what it proposes, what it
 * refuses to propose, and that it explains itself without inventing a pattern the existing detector could not substantiate.
 */
const TODAY = '2026-11-20';
let tid = 1;
const t = (payee: string, date: string, cents: number, over: Partial<Txn> = {}): Txn => ({ id: tid++, accountId: 1, date, amountCents: -Math.abs(cents), payee, memo: '', status: 'cleared', categoryId: 7, ...over });
/** One payment on `day` of each given month (YYYY-MM). */
const monthsOf = (payee: string, cents: number | ((i: number) => number), day: number, months: string[], over: Partial<Txn> = {}) =>
  months.map((m, i) => t(payee, `${m}-${String(day).padStart(2, '0')}`, typeof cents === 'function' ? cents(i) : cents, over));
const MONTHS6 = ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11'];
const last = (n: number) => MONTHS6.slice(-n);

const run = (txns: Txn[], over: Partial<DiscoveryInput> = {}) => discoverRecurring({ transactions: txns, rules: [], obligations: [], decisions: [], today: TODAY, ...over });
const all = (r: ReturnType<typeof run>) => [...r.suggestions, ...r.moreInfo];
const one = (r: ReturnType<typeof run>) => { const x = all(r); expect(x).toHaveLength(1); return x[0]; };
const decision = (key: string, d: Decision['decision'], over: Partial<Decision> = {}): Decision => ({ id: 1, key, decision: d, on: '2026-11-01', obligationId: null, snap: { f: 'monthly', n: 3, last: '2026-10-12', cents: 1549 }, ...over });

describe('B3.1 discovery: patterns the detector can substantiate', () => {
  it('three real monthly payments are a POSSIBLE pattern (the least evidence), with their dates, amounts and reasons shown', () => {
    const c = one(run(monthsOf('Streamly Premium', 1549, 12, last(3))));
    expect(c.tier).toBe('possible');
    expect(c.frequency).toBe('monthly');
    expect(c.count).toBe(3);
    expect(c.occurrences.map((o) => o.date)).toEqual(['2026-09-12', '2026-10-12', '2026-11-12']);
    expect(c.occurrences.every((o) => o.cents === 1549)).toBe(true);
    expect(c.amounts).toMatchObject({ typical: 1549, min: 1549, max: 1549, fixed: true });
    expect(c.nextDate).toBe('2026-12-12');
    expect(c.reasons.join(' ')).toMatch(/3 payments .* every month/);
    expect(c.uncertain.join(' ')).toMatch(/Only three payments/);
    expect(c.key).toBe('p:streamly premium');
  });

  it('four steady monthly payments with regular gaps are a STRONG pattern; six payments of a varying amount (a utility) are too', () => {
    expect(one(run(monthsOf('Streamly Premium', 1549, 12, last(4)))).tier).toBe('strong');
    const util = one(run(monthsOf('Example Power Co', (i) => 8000 + i * 900, 18, MONTHS6)));
    expect(util.tier).toBe('strong');
    expect(util.amounts.fixed).toBe(false);
    expect(util.uncertain.join(' ')).toMatch(/amount varies/);
    expect(one(run(monthsOf('Example Power Co', (i) => 8000 + i * 900, 18, last(5)))).tier).toBe('possible'); // five varying payments: not yet strong
  });

  it('two payments only are "needs more information": no cadence is claimed, and a third payment decides', () => {
    const r = run(monthsOf('Streamly Premium', 1549, 12, last(2)));
    expect(r.suggestions).toEqual([]);
    expect(r.moreInfo).toHaveLength(1);
    expect(r.moreInfo[0]).toMatchObject({ tier: 'more-info', frequency: null, count: 2, nextDate: null });
    expect(r.moreInfo[0].reasons.join(' ')).toMatch(/Two payments .* days apart/);
    expect(r.moreInfo[0].uncertain.join(' ')).toMatch(/do not make a pattern/);
    expect(run([t('Corner Grocery', '2026-10-12', 1549), t('Corner Grocery', '2026-11-12', 4100)]).moreInfo).toEqual([]); // different amounts: nothing
  });

  it('a single payment, or a payment history with a long silence, proposes nothing', () => {
    expect(all(run([t('Streamly Premium', '2026-11-12', 1549)]))).toEqual([]);
    expect(all(run(monthsOf('Old Gym', 3000, 5, ['2026-01', '2026-02', '2026-03'])))).toEqual([]); // stopped eight months ago: not "newly active"
  });

  it('weekly and biweekly patterns appear only when the dates really are that regular', () => {
    const weekly = Array.from({ length: 6 }, (_, i) => t('Example Dog Walker', addD('2026-10-03', i * 7), 2500));
    const w = one(run(weekly));
    expect(w.frequency).toBe('weekly');
    expect(w.tier).toBe('strong');
    const bi = Array.from({ length: 4 }, (_, i) => t('Example Cleaner', addD('2026-09-25', i * 14), 9000));
    expect(one(run(bi)).frequency).toBe('biweekly');
    // the same amount at irregular intervals is not a cadence ("similar amounts alone" prove nothing)
    const irregular = [t('Example Cleaner', '2026-09-01', 9000), t('Example Cleaner', '2026-09-20', 9000), t('Example Cleaner', '2026-11-02', 9000), t('Example Cleaner', '2026-11-05', 9000)];
    expect(all(run(irregular))).toEqual([]);
  });

  it('quarterly and yearly patterns are cautious: exactly three payments is only "possible", one annual payment proposes nothing', () => {
    const q = one(run([t('Example Insurance', '2026-02-10', 30000), t('Example Insurance', '2026-05-11', 30000), t('Example Insurance', '2026-08-10', 30000)]));
    expect(q.frequency).toBe('quarterly');
    expect(q.tier).toBe('possible');
    expect(q.uncertain.join(' ')).toMatch(/quarterly pattern is slow to confirm/);
    const y = one(run([t('Example Domain Co', '2024-11-15', 1800), t('Example Domain Co', '2025-11-15', 1800), t('Example Domain Co', '2026-11-15', 1800)]));
    expect(y.frequency).toBe('yearly');
    expect(y.tier).toBe('possible');
    expect(all(run([t('Example Domain Co', '2026-03-01', 1800)]))).toEqual([]);
  });

  it('an irregular set of payments, even at one store, is never listed (not a subscription)', () => {
    const r = run([t('Big Box Store', '2026-08-03', 2100), t('Big Box Store', '2026-08-29', 18400), t('Big Box Store', '2026-10-02', 740), t('Big Box Store', '2026-11-11', 9100)]);
    expect(all(r)).toEqual([]);
  });

  it('similar payees at different providers are separate suggestions, never merged', () => {
    const r = run([...monthsOf('Example Power Co', 9000, 18, last(4)), ...monthsOf('Another Power Co', 4500, 9, last(4))]);
    expect(r.suggestions.map((c) => c.payee).sort()).toEqual(['Another Power Co', 'Example Power Co']);
  });

  it('a payee written with store numbers and punctuation is one payee', () => {
    const c = one(run([t('STREAMLY*PREMIUM #4471', '2026-09-12', 1549), t('Streamly Premium', '2026-10-12', 1549), t('streamly premium 9920', '2026-11-12', 1549)]));
    expect(c.count).toBe(3);
  });

  it('payments from two accounts (a subscription moved to another card) are one pattern, and it says so', () => {
    const c = one(run([t('Streamly Premium', '2026-08-12', 1549, { accountId: 1 }), t('Streamly Premium', '2026-09-12', 1549, { accountId: 1 }), t('Streamly Premium', '2026-10-12', 1549, { accountId: 2 }), t('Streamly Premium', '2026-11-12', 1549, { accountId: 2 })]));
    expect(c.count).toBe(4);
    expect(c.uncertain.join(' ')).toMatch(/more than one account/);
  });
});

describe('B3.1 discovery: what is never a suggestion', () => {
  it('income, transfers and setup entries are excluded, however regular', () => {
    const income = monthsOf('Example Employer', -300000, 1, MONTHS6).map((x) => ({ ...x, amountCents: 300000 }));
    const transfers = monthsOf('To Savings', 50000, 5, MONTHS6, { transferTxnId: 999 });
    const setup = monthsOf('Opening entry', 10000, 3, MONTHS6, { categoryId: SETUP_CATEGORY_ID });
    const splitSetup = monthsOf('Mixed entry', 10000, 4, MONTHS6, { splits: [{ amountCents: -5000, categoryId: 7 }, { amountCents: -5000, categoryId: SETUP_CATEGORY_ID }] });
    const r = run([...income, ...transfers, ...setup, ...splitSetup]);
    expect(all(r)).toEqual([]);
    expect(r.scanned.transactions).toBe(0);
  });

  it('a loan payment, and the interest-and-escrow expense Loans writes, are left out and counted (tracked on the Loans page)', () => {
    const r = run([...monthsOf('Example Mortgage Servicing', 180000, 1, last(4)), ...monthsOf('Home loan: interest & escrow', 150000, 2, last(4)), ...monthsOf('Streamly Premium', 1549, 12, last(4))]);
    expect(r.suggestions.map((c) => c.payee)).toEqual(['Streamly Premium']);
    expect(r.loanLeftOut).toBe(2);
  });

  it('duplicated imports count once: the same payee on the same day, or the same bank id, is one occurrence', () => {
    const doubled = last(3).flatMap((m) => [t('Streamly Premium', `${m}-12`, 1549), t('Streamly Premium', `${m}-12`, 1549, { accountId: 2 })]);
    const c = one(run(doubled));
    expect(c.count).toBe(3);
    expect(c.uncertain.join(' ')).toMatch(/3 entries that looked like duplicates/);
    const sameBankId = [t('Streamly Premium', '2026-09-12', 1549, { externalId: 'A1' }), t('Streamly Premium', '2026-09-13', 1549, { externalId: 'A1' }), t('Streamly Premium', '2026-10-12', 1549), t('Streamly Premium', '2026-11-12', 1549)];
    expect(one(run(sameBankId)).count).toBe(3);
  });

  it('two payments in one week from a duplicate import do not make a pattern out of two real months', () => {
    expect(run([t('Streamly Premium', '2026-10-12', 1549), t('Streamly Premium', '2026-10-12', 1549, { accountId: 2 }), t('Streamly Premium', '2026-11-12', 1549)]).suggestions).toEqual([]);
  });

  it('a payee that matches a bill the owner ENDED is not suggested again, and is counted', () => {
    const ended = obRec(4, { title: 'Streamly Premium', status: 'ended', endedOn: '2026-08-01', endReason: 'cancelled', trackingSince: '2026-01-01' });
    const r = run(monthsOf('Streamly Premium', 1549, 12, last(4)), { obligations: [ended] });
    expect(all(r)).toEqual([]);
    expect(r.endedLeftOut).toBe(1);
  });
});

describe('B3.1 discovery: what already exists', () => {
  it('a payee an active bill already covers is "tracked", with that bill named; it is not a new suggestion', () => {
    const bill = obRec(3, { title: 'Streamly Premium', providerNameSnapshot: 'Streamly' });
    const r = run(monthsOf('STREAMLY PREMIUM 4471', 1549, 12, last(4)), { obligations: [bill] });
    expect(r.suggestions).toEqual([]);
    expect(r.tracked).toHaveLength(1);
    expect(r.tracked[0].existing!.id).toBe(3);
    expect(r.tracked[0].state).toBe('tracked');
  });

  it('a bill with only a similar name is shown as a possible match in the notes, and the suggestion stays', () => {
    const bill = obRec(3, { title: 'Streamly Kids', providerNameSnapshot: '' });
    const c = one(run(monthsOf('Streamly Premium', 1549, 12, last(4)), { obligations: [bill] }));
    expect(c.existing).toBeNull();
    expect(c.similar.map((o) => o.id)).toEqual([3]);
    expect(c.uncertain.join(' ')).toMatch(/similar name/);
  });

  it('a Finance Scheduled rule that may stand for it is shown as a plan, not proof; an inactive rule is marked inactive', () => {
    const live: RecurringRule = { id: 5, accountId: 1, payee: 'Streamly Premium', amountCents: -1549, categoryId: 7, memo: '', frequency: 'monthly', startDate: '2026-01-12', active: true };
    const off: RecurringRule = { ...live, id: 6, payee: 'Example Power Co', active: false };
    const r = run([...monthsOf('Streamly Premium', 1549, 12, last(4)), ...monthsOf('Example Power Co', 9000, 18, last(4))], { rules: [live, off] });
    const s = r.suggestions.find((c) => c.payee === 'Streamly Premium')!;
    expect(s.rules.map((x) => [x.rule.id, x.live])).toEqual([[5, true]]);
    expect(s.uncertain.join(' ')).toMatch(/plan; it does not show payments happened/);
    expect(r.suggestions.find((c) => c.payee === 'Example Power Co')!.rules.map((x) => [x.rule.id, x.live])).toEqual([[6, false]]);
  });

  it('a rule already linked to a bill is reported with that bill, so it is not offered a second time', () => {
    const live: RecurringRule = { id: 5, accountId: 1, payee: 'Streamly Premium', amountCents: -1549, categoryId: 7, memo: '', frequency: 'monthly', startDate: '2026-01-12', active: true };
    const bill = obRec(3, { title: 'My streaming', providerNameSnapshot: '', scheduledRuleIds: [5] });
    const c = one(run(monthsOf('Streamly Premium', 1549, 12, last(4)), { rules: [live], obligations: [bill] }));
    expect(c.rules[0].linkedTo!.id).toBe(3);
    expect(billSeedFromCandidate(c).ruleId).toBeNull();
  });

  it('scheduled spending rules nobody tracks are listed, but not income, transfers, switched-off rules, rules a bill points at or rules already shown with a suggestion', () => {
    const base: RecurringRule = { id: 1, accountId: 1, payee: 'Example Rent', amountCents: -120000, categoryId: 7, memo: '', frequency: 'monthly', startDate: '2026-01-01', active: true };
    const rules: RecurringRule[] = [
      base,
      { ...base, id: 2, payee: 'Paycheck', amountCents: 300000 },
      { ...base, id: 3, payee: 'To Savings', transferAccountId: 9 },
      { ...base, id: 4, payee: 'Old Club', active: false },
      { ...base, id: 5, payee: 'Linked Thing' },
      { ...base, id: 6, payee: 'Streamly Premium' },
      { ...base, id: 7, payee: 'Ended Rule', endDate: '2026-06-01' },
    ];
    const r = run(monthsOf('Streamly Premium', 1549, 12, last(4)), { rules, obligations: [obRec(2, { title: 'Linked', scheduledRuleIds: [5] })] });
    expect(r.rulesNotTracked.map((x) => x.id)).toEqual([1]);
  });
});

describe('B3.1 discovery: the owner\'s decisions, and when a pattern may come back', () => {
  const key = 'p:streamly premium';
  const three = monthsOf('Streamly Premium', 1549, 12, last(3));

  it('"not a recurring expense" hides the suggestion (and lists it as hidden) until something material changes', () => {
    const r = run(three, { decisions: [decision(key, 'not-recurring')] });
    expect(all(r)).toEqual([]);
    expect(r.hidden.map((c) => c.state)).toEqual(['not-recurring']);
  });

  it('"dismiss for now" hides it for a while, then it may return on its own', () => {
    const d = decision(key, 'dismissed', { on: '2026-10-01' });
    expect(all(run(three, { decisions: [d] }))).toEqual([]);
    const later = decision(key, 'dismissed', { on: addD(TODAY, -SNOOZE_DAYS) });
    expect(all(run(three, { decisions: [later] }))).toHaveLength(1);
  });

  it('a materially different pattern comes back whatever was decided: a new cadence, much more evidence, or a very different amount', () => {
    const snap = (over = {}) => ({ f: 'monthly' as Frequency | null, n: 3, last: '2026-10-12', cents: 1549, ...over });
    const c = (over = {}) => ({ frequency: 'monthly' as Frequency | null, count: 3, amounts: { typical: 1549, min: 1549, max: 1549, fixed: true }, ...over });
    expect(materialChange(snap(), c())).toBe(false);
    expect(materialChange(snap({ f: null }), c())).toBe(true); // two payments became a pattern
    expect(materialChange(snap(), c({ frequency: 'quarterly' }))).toBe(true);
    expect(materialChange(snap(), c({ count: 5 }))).toBe(false);
    expect(materialChange(snap(), c({ count: 6 }))).toBe(true); // doubled, at least three more
    expect(materialChange(snap(), c({ amounts: { typical: 2400, min: 2400, max: 2400, fixed: true } }))).toBe(true);
    expect(materialChange(snap(), c({ amounts: { typical: 1700, min: 1700, max: 1700, fixed: true } }))).toBe(false);
    // and end to end: six payments after "not recurring" at three
    const r = run(monthsOf('Streamly Premium', 1549, 12, MONTHS6), { decisions: [decision(key, 'not-recurring', { snap: snap({ n: 3 }) })] });
    expect(r.suggestions).toHaveLength(1);
  });

  it('new transactions added after an earlier scan are read on the next one', () => {
    const before = run(three);
    expect(one(before).count).toBe(3);
    const after = run([...three, t('Streamly Premium', '2026-12-12', 1549)], { today: '2026-12-20' });
    expect(one(after).count).toBe(4);
    expect(one(after).tier).toBe('strong');
  });

  it('the newest decision wins and older ones are not rewritten; a "tracked" choice holds only while its bill is in force', () => {
    const older = decision(key, 'not-recurring', { id: 1, on: '2026-10-01' });
    const newer = decision(key, 'dismissed', { id: 2, on: '2026-11-10' });
    expect(decisionFor(key, [older, newer])!.id).toBe(2);
    expect(decisionFor(key, [newer, older])!.id).toBe(2);
    const bill = obRec(3, { title: 'My streaming' });
    const tracked = decision(key, 'tracked', { obligationId: 3 });
    const withBill = run(three, { decisions: [tracked], obligations: [bill] });
    expect(withBill.tracked[0].existing!.id).toBe(3);
    expect(all(withBill)).toEqual([]);
    const gone = run(three, { decisions: [tracked], obligations: [] });
    expect(gone.suggestions).toHaveLength(1); // the bill is gone: the choice no longer hides anything
    const endedBill = obRec(3, { title: 'My streaming', status: 'ended', endedOn: '2026-10-01', endReason: 'cancelled', trackingSince: '2026-01-01' });
    expect(run(three, { decisions: [tracked], obligations: [endedBill] }).suggestions).toHaveLength(1);
  });

  it('a decision for one payee never hides another', () => {
    const r = run([...three, ...monthsOf('Example Power Co', 9000, 18, last(4))], { decisions: [decision(key, 'not-recurring')] });
    expect(r.suggestions.map((c) => c.payee)).toEqual(['Example Power Co']);
  });
});

describe('B3.1 discovery: deterministic and read-only', () => {
  it('gives the same answer whatever order the transactions arrive in, and never changes its input', () => {
    const txns = [...monthsOf('Streamly Premium', 1549, 12, last(4)), ...monthsOf('Example Power Co', (i) => 8000 + i * 900, 18, MONTHS6), ...monthsOf('Gym Club', 4000, 3, last(2))];
    const before = JSON.stringify(txns);
    const a = run(txns), b = run([...txns].reverse());
    expect(JSON.stringify(txns)).toBe(before);
    const sig = (r: ReturnType<typeof run>) => JSON.stringify([...r.suggestions, ...r.moreInfo].map((c) => [c.key, c.tier, c.count, c.occurrences.map((o) => o.txnId).sort()]));
    expect(sig(a)).toBe(sig(b));
    expect(a.suggestions.map((c) => c.tier)).toEqual(['strong', 'strong']);
    expect(a.moreInfo.map((c) => c.payee)).toEqual(['Gym Club']);
  });

  it('the cleaning adapter keeps only money-out, de-duplicated, non-setup transactions and merges accounts', () => {
    const c = cleaned([t('A Shop', '2026-11-01', 100), t('A Shop', '2026-11-01', 100), t('Pay', '2026-11-01', -500, { amountCents: 500 }), t('A Shop', '2026-11-02', 100, { transferTxnId: 1 }), t('', '2026-11-03', 100)]);
    expect(c.merged).toHaveLength(1);
    expect(c.merged[0].accountId).toBe(0);
    expect(c.eligible).toBe(2);
    expect([...c.duplicates.values()]).toEqual([1]);
  });

  it('what the detector returns is what is listed: count and frequency agree with the existing detector', async () => {
    const { detectRecurring } = await import('../../lib/financeRead');
    const txns = monthsOf('Streamly Premium', 1549, 12, last(4));
    const g = detectRecurring(cleaned(txns).merged, [], TODAY)[0];
    const c = one(run(txns));
    expect([c.count, c.frequency, c.amounts.typical]).toEqual([g.count, g.frequency, Math.abs(g.amountCents)]);
  });
});

describe('B3.1 discovery: bank payee text becomes a readable starting title', () => {
  it('turns bank text into a readable name and keeps a clean payee exactly as it is', () => {
    expect(readableTitle('STREAMLY*PREMIUM 8841')).toBe('Streamly Premium');
    expect(readableTitle('Streamly Premium')).toBe('Streamly Premium');
    expect(readableTitle('Example Gas Co')).toBe('Example Gas Co');
    expect(readableTitle('  ')).toBe('');
    const c = one(run([t('STREAMLY*PREMIUM 8841', '2026-09-12', 1549), t('STREAMLY*PREMIUM 8841', '2026-10-12', 1549), t('STREAMLY*PREMIUM 8841', '2026-11-12', 1549)]));
    expect(billSeedFromCandidate(c)).toMatchObject({ title: 'Streamly Premium', providerName: 'Streamly Premium' });
  });
});

describe('B3.1 discovery: a bill made from a suggestion is a prefill, and every field stays editable', () => {
  it('a monthly pattern becomes a monthly schedule on the typical day, from the month of the latest payment', () => {
    const s = billSeedFromCandidate(one(run([t('Streamly Premium', '2026-09-11', 1549), t('Streamly Premium', '2026-10-12', 1549), t('Streamly Premium', '2026-11-12', 1549)])));
    expect(s).toMatchObject({ title: 'Streamly Premium', providerName: 'Streamly Premium', amountKind: 'fixed', amountCents: 1549, type: 'subscription', payeeHint: 'streamly premium', fundingAccountId: 1, ruleId: null });
    expect(s.schedule).toEqual({ kind: 'months', every: 1, slot: { kind: 'day', day: 12, adjust: 'none' }, anchorMonth: '2026-11' });
    expect(scheduleProblem(s.schedule!)).toBeNull();
  });

  it('weekly and biweekly keep the weekday most payments fell on; quarterly keeps its real month', () => {
    const wk = billSeedFromCandidate(one(run(Array.from({ length: 5 }, (_, i) => t('Example Dog Walker', addD('2026-10-03', i * 7), 2500)))));
    expect(wk.schedule).toMatchObject({ kind: 'weeks', every: 1, weekday: 6 }); // 2026-10-03 is a Saturday
    expect(scheduleProblem(wk.schedule!)).toBeNull();
    const q = billSeedFromCandidate(one(run([t('Example Insurance', '2026-02-10', 30000), t('Example Insurance', '2026-05-11', 30000), t('Example Insurance', '2026-08-10', 30000)])));
    expect(q.schedule).toMatchObject({ kind: 'months', every: 3, anchorMonth: '2026-08' });
  });

  it('a varying amount seeds a "varies" bill with the typical amount; two payments seed NO schedule and say why', () => {
    const v = billSeedFromCandidate(one(run(monthsOf('Example Power Co', (i) => 8000 + i * 900, 18, MONTHS6))));
    expect(v.amountKind).toBe('variable');
    expect(v.type).toBe('utility');
    const two = billSeedFromCandidate(one(run(monthsOf('Streamly Premium', 1549, 12, last(2)))));
    expect(two.schedule).toBeNull();
    expect(two.notes.join(' ')).toMatch(/will not guess how often/);
  });

  it('a scheduled rule is offered for linking only when exactly one live, unlinked spending rule matches', () => {
    const rule: RecurringRule = { id: 5, accountId: 1, payee: 'Streamly Premium', amountCents: -1549, categoryId: 7, memo: '', frequency: 'monthly', startDate: '2026-01-12', active: true };
    expect(billSeedFromCandidate(one(run(monthsOf('Streamly Premium', 1549, 12, last(4)), { rules: [rule] }))).ruleId).toBe(5);
    expect(billSeedFromCandidate(one(run(monthsOf('Streamly Premium', 1549, 12, last(4)), { rules: [rule, { ...rule, id: 6 }] }))).ruleId).toBeNull();
    expect(billSeedFromCandidate(one(run(monthsOf('Streamly Premium', 1549, 12, last(4)), { rules: [{ ...rule, active: false }] }))).ruleId).toBeNull();
  });
});
