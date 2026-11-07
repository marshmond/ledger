import { describe, expect, it } from 'vitest';
import { deriveAmounts, declared } from './amounts';
import { findConflicts } from './cycleConflicts';
import { bodyFields, readCycle, storedCycle, validateBody, type FactBody } from './cycleModel';
import { evidenceLine, LABEL_TEXT, primaryLabel, type LabelId, type LabelInput } from './labels';
import { expectedAmountOn } from './model';
import { derivePeriod, periodsOf } from './periods';
import { planScheduleChange } from './schedule';
import { daysUntil, deriveTiming, timingClass, timingDate } from './timing';
import { creditF, dueOn, fact, inv, monthly, ob, obRec, paidFull, paidOut, rawFact, skipF } from './billsTestkit';
import type { ModuleRecord } from '../../core/entities';

const TODAY = '2026-11-07';
const OB = obRec(1, { title: 'Example Power Co', amountKind: 'variable', prices: [{ from: '2026-01-01', cents: 9000, label: '' }], schedule: monthly(18, '2026-01'), trackingSince: '2026-01-01', payment: { how: 'manual', fundingAccountId: null } });
const F = (slot: string, body: FactBody, id: number, extra: Record<string, unknown> = {}) => fact(1, slot, body, id, id, extra);

describe('B2 timing: five mutually exclusive classes (B0 6.2, test 63)', () => {
  it('every day count from -400 to +400 has exactly one class, and the boundaries are exact', () => {
    const seen: Record<string, number> = {};
    for (let d = -400; d <= 400; d++) { const c = timingClass(d, false); seen[c] = (seen[c] ?? 0) + 1; }
    expect(Object.values(seen).reduce((a, b) => a + b, 0)).toBe(801);
    expect(timingClass(8, false)).toBe('upcoming');
    expect(timingClass(7, false)).toBe('soon');
    expect(timingClass(1, false)).toBe('soon');
    expect(timingClass(0, false)).toBe('today'); // "due today" is not hidden by "due soon"
    expect(timingClass(-1, false)).toBe('past');
    expect(seen).toEqual({ past: 400, today: 1, soon: 7, upcoming: 393 });
  });
  it('unclear wins over everything when dates conflict or there is no date', () => {
    for (const d of [-5, 0, 3, 30]) expect(timingClass(d, true)).toBe('unclear');
    expect(timingClass(null, false)).toBe('unclear');
  });
  it('one recorded due date wins over the nominal date; two different dates are never resolved; no date at all is unclear', () => {
    expect(timingDate(['2026-12-20'], '2026-12-18')).toEqual({ date: '2026-12-20', source: 'due' });
    expect(timingDate(['2026-12-20', '2026-12-20'], '2026-12-18')).toEqual({ date: '2026-12-20', source: 'due' });
    expect(timingDate(['2026-12-20', '2026-12-22'], '2026-12-18').source).toBe('conflict');
    expect(timingDate([], null)).toEqual({ date: null, source: 'none' });
    expect(deriveTiming(['2026-12-20', '2026-12-22'], '2026-12-18', TODAY).class).toBe('unclear');
    expect(daysUntil('2026-11-10', TODAY)).toBe(3);
  });
});

describe('B2 amounts: owed, paid and remaining are separate (B0 6.3)', () => {
  const eff = (...bodies: FactBody[]) => bodies.map((b, i) => F('m2026-12', b, i + 1)).filter((x) => x.body !== null) as never;
  const none = { cents: null, basis: 'unknown' as const };
  it('an invoice is the owed basis; a confirmed $0.00 invoice is zero, not unknown', () => {
    const a = deriveAmounts(eff(inv(11420)), none);
    expect([a.basis, a.owed, a.remaining]).toEqual(['billed', 11420, 11420]);
    const z = deriveAmounts(eff(inv(0)), none);
    expect([z.basis, z.owed, z.remaining, z.invoiceRecorded]).toEqual(['billed', 0, 0, true]);
  });
  it('unknown never becomes zero; an expected amount is not billed', () => {
    const u = deriveAmounts([], none);
    expect([u.basis, u.owed, u.remaining]).toEqual(['unknown', null, null]);
    const e = deriveAmounts([], { cents: 9000, basis: 'variable' });
    expect([e.basis, e.owed]).toEqual(['estimate', 9000]);
    const f = deriveAmounts([], { cents: 1549, basis: 'fixed' });
    expect([f.basis, f.owed]).toEqual(['expected', 1549]);
  });
  it('two different invoice amounts make owed unknown (records disagree), never one of them', () => {
    const a = deriveAmounts(eff(inv(10000), inv(12000)), { cents: 9000, basis: 'fixed' });
    expect([a.basis, a.owed, a.remaining]).toEqual(['disagree', null, null]);
    const same = deriveAmounts(eff(inv(10000), inv(10000)), none);
    expect([same.basis, same.owed]).toEqual(['billed', 10000]); // the same amount twice counts once
  });
  it('a credit lowers owed and is never a payment; identical credits count once', () => {
    const a = deriveAmounts(eff(inv(12000), creditF(2000, 'goodwill')), none);
    expect([a.owed, a.paid, a.creditCents]).toEqual([10000, 0, 2000]);
    expect(deriveAmounts(eff(inv(12000), creditF(2000, 'Goodwill'), creditF(2000, 'goodwill')), none).creditCents).toBe(2000);
    expect(deriveAmounts(eff(inv(12000), creditF(2000, 'a'), creditF(2000, 'b')), none).creditCents).toBe(4000);
    expect(deriveAmounts(eff(inv(1000), creditF(5000)), none).owed).toBe(0); // never negative
  });
  it('a typed outside-Finance payment lowers remaining; a declaration with no amount adds nothing and never creates an amount', () => {
    const part = deriveAmounts(eff(inv(12000), paidOut('2026-12-19', 6000)), none);
    expect([part.paid, part.remaining, part.overpaid]).toEqual([6000, 6000, 0]);
    const over = deriveAmounts(eff(inv(12000), paidOut('2026-12-19', 13000)), none);
    expect([over.remaining, over.overpaid]).toEqual([0, 1000]);
    const noAmt = deriveAmounts(eff(inv(12000), paidOut('2026-12-19', null), paidFull()), none);
    expect([noAmt.paid, noAmt.remaining]).toEqual([0, 12000]);
    expect(declared(eff(paidFull()))).toBe(true);
    expect(declared(eff(paidOut('2026-12-19', null)))).toBe(true);
    expect(declared(eff(paidOut('2026-12-19', 500)))).toBe(false);
  });
  it('two DIFFERENT typed payments count as 0 and are flagged; identical ones count once', () => {
    const c = deriveAmounts(eff(inv(12000), paidOut('2026-12-19', 5000), paidOut('2026-12-20', 7000)), none);
    expect([c.paid, c.paidConflict]).toEqual([0, true]);
    const d = deriveAmounts(eff(inv(12000), paidOut('2026-12-19', 5000), paidOut('2026-12-19', 5000)), none);
    expect([d.paid, d.paidConflict]).toEqual([5000, false]);
  });
  it('an unknown-amount bill with a typed payment has owed unknown and remaining unknown, not zero', () => {
    const a = deriveAmounts(eff(paidOut('2026-12-19', 5000)), none);
    expect([a.owed, a.paid, a.remaining]).toEqual([null, 5000, null]);
  });
});

describe('B2 primary label: one label, fixed precedence, nothing contradicts the amounts (tests 24, 25, 64)', () => {
  const base: LabelInput = { skip: false, owed: null, owedFromBill: false, paid: 0, remaining: null, declared: false, suspended: false, timing: 'upcoming', days: 20, how: 'manual', invoiceRecorded: false };
  const L = (o: Partial<LabelInput>) => primaryLabel({ ...base, ...o });
  it('the worked rows', () => {
    expect(L({})).toBe('upcoming');
    expect(L({ timing: 'soon', days: 3 })).toBe('due-soon');
    expect(L({ timing: 'today', days: 0 })).toBe('due-today');
    expect(L({ timing: 'past', days: -4 })).toBe('not-confirmed'); // no invoice: never "Overdue" (test 24)
    expect(L({ timing: 'past', days: -4, invoiceRecorded: true, owed: 100, owedFromBill: true, remaining: 100 })).toBe('overdue'); // test 25
    expect(L({ how: 'unknown', timing: 'past', days: -4 })).toBe('not-confirmed'); // "unknown how" is treated as by hand
    expect(L({ skip: true })).toBe('skipped');
    expect(L({ owed: 0, owedFromBill: true, remaining: 0 })).toBe('no-payment-due');
    expect(L({ owed: 0, owedFromBill: false, remaining: 0 })).toBe('no-payment-expected');
    expect(L({ owed: 12000, paid: 12000, remaining: 0 })).toBe('paid');
    expect(L({ owed: 12000, paid: 6000, remaining: 6000 })).toBe('partly-paid');
    expect(L({ paid: 5000 })).toBe('payment-recorded');
    expect(L({ declared: true })).toBe('marked-paid');
    expect(L({ timing: 'unclear', days: null })).toBe('date-unclear');
  });
  it('autopay is only "scheduled", is never overdue, and asks for a check only after the grace period (tests 1, 2)', () => {
    expect(L({ how: 'auto', timing: 'soon', days: 3 })).toBe('scheduled-auto');
    expect(L({ how: 'auto', timing: 'today', days: 0 })).toBe('scheduled-auto');
    expect(L({ how: 'auto', timing: 'past', days: -1 })).toBe('scheduled-auto');
    expect(L({ how: 'auto', timing: 'past', days: -3 })).toBe('scheduled-auto'); // grace edge: still scheduled
    expect(L({ how: 'auto', timing: 'past', days: -4 })).toBe('autopay-check');
    expect(L({ how: 'auto', timing: 'past', days: -400, invoiceRecorded: true })).toBe('autopay-check'); // never "Overdue"
    expect(L({ how: 'auto', timing: 'past', days: -4, graceDays: 10 })).toBe('scheduled-auto');
  });
  it('a skip that sits beside a payment record never hides the payment', () => {
    expect(L({ skip: true, paid: 5000 })).toBe('payment-recorded');
    expect(L({ skip: true, declared: true })).toBe('marked-paid');
  });
  it('EXHAUSTIVE: every combination gets exactly one label and no label contradicts the inputs', () => {
    let n = 0;
    const timings = [['unclear', null], ['upcoming', 30], ['upcoming', 8], ['soon', 7], ['soon', 1], ['today', 0], ['past', -1], ['past', -3], ['past', -4], ['past', -90]] as const;
    for (const skip of [false, true]) for (const owed of [null, 0, 12000]) for (const fromBill of [false, true]) for (const paid of [0, 3000, 12000, 15000])
      for (const decl of [false, true]) for (const susp of [false, true]) for (const [timing, days] of timings) for (const how of ['auto', 'manual', 'unknown'] as const) for (const invoiceRecorded of [false, true]) {
        const remaining = owed === null ? null : Math.max(0, owed - paid);
        const i: LabelInput = { skip, owed, owedFromBill: fromBill, paid, remaining, declared: decl, suspended: susp, timing, days, how, invoiceRecorded };
        const l: LabelId = primaryLabel(i);
        n++;
        expect(LABEL_TEXT[l], JSON.stringify(i)).toBeTruthy();
        const evidence = paid > 0 || decl;
        if (l === 'paid') { expect(owed !== null && paid > 0 && remaining === 0, JSON.stringify(i)).toBe(true); }
        if (l === 'overdue' || l === 'not-confirmed') { expect(evidence || how === 'auto' || (owed === 0), JSON.stringify(i)).toBe(false); }
        if (l === 'overdue') expect(invoiceRecorded && how !== 'auto', JSON.stringify(i)).toBe(true);
        if (l === 'skipped') expect(skip && !evidence, JSON.stringify(i)).toBe(true);
        if (l === 'partly-paid') expect((remaining ?? 0) > 0, JSON.stringify(i)).toBe(true);
        if (l === 'scheduled-auto' || l === 'autopay-check') expect(how, JSON.stringify(i)).toBe('auto');
        if (l === 'autopay-check') expect(days !== null && days < -3, JSON.stringify(i)).toBe(true);
        if (l === 'payment-recorded') expect(paid > 0 && owed === null, JSON.stringify(i)).toBe(true);
        if (paid > 0 && owed !== null) expect(['paid', 'partly-paid', 'no-payment-due', 'no-payment-expected', 'skipped']).toContain(l === 'skipped' ? 'skipped' : l);
      }
    expect(n).toBe(2 * 3 * 2 * 4 * 2 * 2 * 10 * 3 * 2);
  });
  it('no label or evidence line uses a settlement word or claims a bank result', () => {
    for (const l of Object.keys(LABEL_TEXT) as LabelId[]) {
      const text = `${LABEL_TEXT[l]} ${evidenceLine(l)}`;
      expect(text, l).not.toMatch(/\b(settled|cleared|received|bank-confirmed|bank confirmed|confirmed by (your|the) bank|succeeded|processed)\b/i);
    }
    expect(evidenceLine('scheduled-auto')).toMatch(/only an expectation/);
    expect(evidenceLine('paid')).toMatch(/outside Finance/);
    expect(evidenceLine('marked-paid')).toMatch(/no amount/);
  });
});

describe('B2 reading facts: defensive, lossless, nothing invented (B0 N8)', () => {
  it('a readable fact round-trips with unknown fields kept exactly', () => {
    const r = rawFact(5, { obligationId: 1, slot: 'm2026-12', fact: 'invoice', invoicedCents: 11420, dueDate: '2026-12-20', futureField: { a: [1, 2] }, op: 'abc' });
    expect(r.body).toMatchObject({ fact: 'invoice', invoicedCents: 11420, dueDate: '2026-12-20' });
    const back = storedCycle({ raw: r.raw, obligationId: 1, slot: 'm2026-12', op: r.op, supersededBy: null, movedFrom: null }, r.body!);
    expect(back.futureField).toEqual({ a: [1, 2] });
    expect(back.op).toBe('abc');
    expect(back.invoicedCents).toBe(11420);
  });
  it('an unknown fact type is kept, flagged, never counted and never rewritten', () => {
    const r = rawFact(6, { obligationId: 1, slot: 'm2026-12', fact: 'payment-link', ref: { txnId: 99 } });
    expect(r.body).toBeNull();
    expect(r.problem).toMatch(/payment-link/);
    const p = derivePeriod(OB, 'm2026-12', '2026-12-18', true, [r], TODAY);
    expect(p.unreadable).toHaveLength(1);
    expect(p.effective).toHaveLength(0);
    expect(p.amounts.paid).toBe(0);
    expect(p.label).not.toBe('paid');
  });
  it('damaged fields make a record unreadable instead of contributing an amount', () => {
    const bad = [
      { obligationId: 1, slot: 'm2026-12', fact: 'invoice', invoicedCents: -5 },
      { obligationId: 1, slot: 'm2026-12', fact: 'invoice', invoicedCents: 10.5 },
      { obligationId: 1, slot: 'm2026-12', fact: 'invoice', invoicedCents: '100' },
      { obligationId: 1, slot: 'm2026-12', fact: 'invoice' },
      { obligationId: 1, slot: 'm2026-12', fact: 'invoice', invoicedCents: 100, dueDate: '2026-02-30' },
      { obligationId: 1, slot: 'm2026-12', fact: 'paid-outside', paidOn: '2026-12-19', cents: -1 },
      { obligationId: 1, slot: 'm2026-12', fact: 'credit', cents: NaN },
      { obligationId: 1, slot: 'm2026-12', fact: 'due-date', dueDate: 'soon' },
      { obligationId: 1, slot: 'm2026-12', fact: 'skip', supersededBy: 'x' },
      { obligationId: 1, slot: 'm2026-12', fact: 'skip', movedFrom: 'banana' },
      { obligationId: 'one', slot: 'm2026-12', fact: 'skip' },
      { obligationId: 1, slot: 'banana', fact: 'skip' },
      { obligationId: 1, slot: 'w2026-12-08', fact: 'skip' }, // not a Monday
      { obligationId: 1, slot: 'm2026-13', fact: 'skip' },
      { slot: 'm2026-12', fact: 'skip' }, {}, { obligationId: 1, slot: 'm2026-12' },
    ];
    bad.forEach((d, i) => { const r = rawFact(100 + i, d as Record<string, unknown>); expect(r.body, JSON.stringify(d)).toBeNull(); expect(r.problem, JSON.stringify(d)).toBeTruthy(); });
    expect(() => readCycle({ id: 1, module: 'bills', kind: 'cycle', data: null, createdAt: 1, updatedAt: 1, deletedAt: null } as unknown as ModuleRecord)).not.toThrow();
  });
  it('a zero-dollar invoice is a valid, confirmed fact; a typed payment must be above zero; amounts are whole cents', () => {
    expect(validateBody(inv(0))).toBeNull();
    expect(validateBody(inv(-1))).toMatch(/not valid/);
    expect(validateBody(inv(10.5))).toMatch(/not valid/);
    expect(validateBody(paidOut('2026-12-19', 0))).toMatch(/above \$0/);
    expect(validateBody(paidOut('2026-12-19', null))).toBeNull();
    expect(validateBody(inv(100, { invoiceDate: '2026-12-10', dueDate: '2026-12-01' }))).toMatch(/before the bill date/);
    expect(validateBody(inv(100, { invoiceNumber: 'x'.repeat(41) }))).toMatch(/too long/);
    expect(validateBody(creditF(0))).toMatch(/above \$0/);
    expect(bodyFields(paidOut('2026-12-19', null))).toEqual({ fact: 'paid-outside', paidOn: '2026-12-19' }); // no amount key at all
  });
});

describe('B2 periods: identity survives a moved due date and a business-day change (tests 53 to 55)', () => {
  it('a due-date fact moves the timing date and nothing else; the slot never changes', () => {
    const p = derivePeriod(OB, 'm2026-12', '2026-12-18', true, [F('m2026-12', dueOn('2026-12-22'), 1)], TODAY);
    expect(p.slot).toBe('m2026-12');
    expect(p.timing.date).toBe('2026-12-22');
    expect(p.nominal).toBe('2026-12-18');
    expect(p.timing.source).toBe('due');
    const q = derivePeriod(OB, 'm2026-12', '2026-12-18', true, [], TODAY);
    expect(q.timing.date).toBe('2026-12-18');
    expect(q.timing.source).toBe('nominal');
  });
  it('a business-day adjustment changes the nominal date inside the month, never the slot or the facts', () => {
    const adjusted = obRec(2, { schedule: monthly(5, '2026-01', 1, 'previous'), trackingSince: '2026-01-01' });
    const plain = obRec(3, { schedule: monthly(5, '2026-01'), trackingSince: '2026-01-01' });
    const a = periodsOf(adjusted, [], TODAY, { from: '2026-12-01', to: '2026-12-31' });
    const b = periodsOf(plain, [], TODAY, { from: '2026-12-01', to: '2026-12-31' });
    expect(a.map((x) => x.slot)).toEqual(b.map((x) => x.slot));
    expect(a[0].slot).toBe('m2026-12');
    const cyc = fact(2, 'm2026-12', inv(5000), 9);
    expect(periodsOf(adjusted, [cyc], TODAY, { from: '2026-12-01', to: '2026-12-31' })[0].effective).toHaveLength(1);
    expect(periodsOf(plain, [{ ...cyc, obligationId: 3 }], TODAY, { from: '2026-12-01', to: '2026-12-31' })[0].effective).toHaveLength(1);
  });
  it('two obligations due the same day never share a period; an extra bill gets its own x slot (test 59)', () => {
    const o2 = obRec(2, { title: 'Other', schedule: monthly(18, '2026-01'), trackingSince: '2026-01-01' });
    const facts = [fact(1, 'm2026-12', inv(100), 1), fact(2, 'm2026-12', inv(200), 2), fact(1, 'x777', inv(35), 3, 3, {})];
    const p1 = periodsOf(OB, facts, TODAY, { from: '2026-12-01', to: '2026-12-31' }, { allRecorded: true });
    const p2 = periodsOf(o2, facts, TODAY, { from: '2026-12-01', to: '2026-12-31' }, { allRecorded: true });
    expect(p1.map((x) => x.slot)).toEqual(expect.arrayContaining(['m2026-12', 'x777']));
    expect(p1.find((x) => x.slot === 'x777')!.isExtra).toBe(true);
    expect(p1.find((x) => x.slot === 'x777')!.amounts.owed).toBe(35);
    expect(p1.find((x) => x.slot === 'm2026-12')!.amounts.owed).toBe(100);
    expect(p2.find((x) => x.slot === 'm2026-12')!.amounts.owed).toBe(200);
  });
  it('a period no schedule produces is reported "from an earlier schedule" and still counts as recorded', () => {
    const quarterly = obRec(4, { schedule: monthly(10, '2026-01', 3), trackingSince: '2026-01-01' });
    const f = fact(4, 'm2026-12', paidOut('2026-12-12', 5000), 1); // quarterly: 2026-10, 2027-01 ... so 2026-12 is not produced
    const ps = periodsOf(quarterly, [f], TODAY, { from: '2026-12-01', to: '2026-12-31' }, { allRecorded: true });
    const p = ps.find((x) => x.slot === 'm2026-12')!;
    expect(p.fromEarlier).toBe(true);
    expect(p.expected).toBe(false);
    expect(p.nominal).toBeNull();
    expect(p.amounts.paid).toBe(5000);
  });
  it('nothing before the tracking start is ever derived, and nothing in the future is stored (tests 22, 31)', () => {
    const young = obRec(5, { schedule: monthly(18, '2026-11'), trackingSince: TODAY });
    const ps = periodsOf(young, [], TODAY, { from: '2026-01-01', to: '2027-12-31' });
    expect(ps.every((p) => p.nominal! >= TODAY)).toBe(true);
    expect(ps[0].slot).toBe('m2026-11');
  });
  it('a skipped period is Skipped; a skip with a payment keeps the payment and flags the disagreement (test 23)', () => {
    const s = derivePeriod(OB, 'm2026-12', '2026-12-18', true, [F('m2026-12', skipF('moved house'), 1)], TODAY);
    expect([s.label, s.skipped, s.open]).toEqual(['skipped', true, false]);
    const both = derivePeriod(OB, 'm2026-12', '2026-12-18', true, [F('m2026-12', skipF(), 1), F('m2026-12', paidOut('2026-12-19', 5000), 2)], TODAY);
    expect([both.skipVsPayment, both.skipped, both.amounts.paid]).toEqual([true, false, 5000]);
    expect(both.label).toBe('partly-paid'); // an estimate of $90.00 is owed and $50.00 is recorded: the payment still shows
  });
  it('superseded records stay in history and drop out of every figure', () => {
    const old = F('m2026-12', inv(10000), 1, { supersededBy: 2 });
    const keep = F('m2026-12', inv(12000), 2);
    const p = derivePeriod(OB, 'm2026-12', '2026-12-18', true, [old, keep], TODAY);
    expect(p.amounts.owed).toBe(12000);
    expect(p.superseded.map((x) => x.id)).toEqual([1]);
    expect(p.records.map((x) => x.id).sort()).toEqual([1, 2]);
  });
  it('expected amount for an extra period is unknown, never zero', () => {
    const p = derivePeriod(OB, 'x1', null, false, [F('x1', dueOn('2026-12-30'), 1)], TODAY);
    expect(p.amounts.owed).toBeNull();
    expect(expectedAmountOn(OB.data, '2026-12-18').cents).toBe(9000);
  });
});

describe('B2 conflicts: contradictory evidence is reported, complementary evidence is not (tests 60, 62)', () => {
  const find = (facts: ReturnType<typeof fact>[], obs = [OB]) => findConflicts(obs, facts);
  const kinds = (facts: ReturnType<typeof fact>[]) => find(facts).map((c) => c.kind).sort();
  it('an invoice, a due-date correction and a payment declaration coexist without any conflict', () => {
    expect(kinds([F('m2026-12', inv(11420, { dueDate: '2026-12-20' }), 1), F('m2026-12', dueOn('2026-12-20'), 2), F('m2026-12', paidOut('2026-12-19', 11420), 3), F('m2026-12', creditF(500), 4)])).toEqual([]);
  });
  it('two invoices with different amounts disagree; with the same amount they are duplicates; neither is deleted', () => {
    const d = find([F('m2026-12', inv(10000), 1), F('m2026-12', inv(12000), 2)]);
    expect(d.map((c) => c.kind)).toEqual(['invoice-amount']);
    expect(d[0]).toMatchObject({ severity: 'disagree', ids: [1, 2], candidates: [1, 2], repairs: ['use-one', 'different-bills', 'leave'] });
    const dup = find([F('m2026-12', inv(10000), 1), F('m2026-12', inv(10000), 2)]);
    expect(dup.map((c) => c.kind)).toEqual(['invoice-duplicate']);
    expect(dup[0].severity).toBe('duplicate');
  });
  it('different actual due dates conflict; the same date twice is only a duplicate', () => {
    expect(kinds([F('m2026-12', dueOn('2026-12-20'), 1), F('m2026-12', dueOn('2026-12-22'), 2)])).toEqual(['due-date']);
    expect(kinds([F('m2026-12', dueOn('2026-12-20'), 1), F('m2026-12', dueOn('2026-12-20'), 2)])).toEqual(['duplicate-record']);
    const inv2 = find([F('m2026-12', inv(10000, { dueDate: '2026-12-20' }), 1), F('m2026-12', dueOn('2026-12-25'), 2)]);
    expect(inv2.map((c) => c.kind)).toEqual(['due-date']);
    expect(inv2[0].candidates).toEqual([1]); // an invoice carries its own date, so only the plain due-date record can be set aside
    const two = find([F('m2026-12', inv(10000, { dueDate: '2026-12-20' }), 1), F('m2026-12', inv(10000, { dueDate: '2026-12-25' }), 2)]).filter((c) => c.kind === 'due-date');
    expect(two[0].candidates).toEqual([]);
    expect(two[0].repairs).toEqual(['leave']);
  });
  it('a skip beside a payment disagrees, and the payment is the only record that may be chosen', () => {
    const c = find([F('m2026-12', skipF(), 1), F('m2026-12', paidOut('2026-12-19', 5000), 2)]);
    expect(c.map((x) => x.kind)).toEqual(['skip-payment']);
    expect(c[0].candidates).toEqual([2]);
    expect(kinds([F('m2026-12', skipF(), 1), F('m2026-12', paidFull(), 2)])).toEqual(['skip-payment']);
  });
  it('two different typed payments conflict; identical records recorded twice are duplicates', () => {
    expect(kinds([F('m2026-12', paidOut('2026-12-19', 5000), 1), F('m2026-12', paidOut('2026-12-20', 7000), 2)])).toEqual(['paid-amount']);
    expect(kinds([F('m2026-12', paidOut('2026-12-19', 5000), 1), F('m2026-12', paidOut('2026-12-19', 5000), 2)])).toEqual(['duplicate-record']);
    expect(kinds([F('m2026-12', skipF(), 1), F('m2026-12', skipF(), 2)])).toEqual(['duplicate-record']);
    expect(kinds([F('m2026-12', creditF(2000, 'a'), 1), F('m2026-12', creditF(2000, 'A'), 2)])).toEqual(['duplicate-record']);
    expect(kinds([F('m2026-12', creditF(2000, 'a'), 1), F('m2026-12', creditF(2000, 'b'), 2)])).toEqual([]);
  });
  it('one document number on two periods is a look-alike warning, never a rejection', () => {
    const c = find([F('m2026-11', inv(100, { invoiceNumber: 'A-1042' }), 1), F('m2026-12', inv(100, { invoiceNumber: 'a-1042' }), 2)]);
    expect(c.map((x) => x.kind)).toEqual(['invoice-number']);
  });
  it('an invoice in a period no schedule produces needs review; an extra bill never does', () => {
    const q = obRec(4, { schedule: monthly(10, '2026-01', 3), trackingSince: '2026-01-01' });
    expect(findConflicts([q], [fact(4, 'm2026-12', inv(100), 1)]).map((c) => c.kind)).toEqual(['earlier-schedule']);
    expect(findConflicts([q], [fact(4, 'x99', inv(100), 1)])).toEqual([]);
    expect(findConflicts([q], [fact(4, 'm2026-10', inv(100), 1)])).toEqual([]);
  });
  it('facts whose bill is missing, and records this version cannot read, are reported and kept', () => {
    const c = findConflicts([OB], [fact(99, 'm2026-12', inv(100), 1), rawFact(2, { obligationId: 1, slot: 'm2026-12', fact: 'payment-link' }), rawFact(3, { nonsense: true })]);
    expect(c.map((x) => x.kind).sort()).toEqual(['missing-obligation', 'unreadable', 'unreadable']);
    expect(c.find((x) => x.kind === 'missing-obligation')!.repairs).toEqual(['remove']);
    expect(c.filter((x) => x.kind === 'unreadable').every((x) => x.repairs.length === 0)).toBe(true);
  });
  it('a record that arrives at a period whose records were moved is flagged for review, with the place the others went', () => {
    const moved = F('m2027-01', inv(100), 1, { movedFrom: 'm2026-12' });
    const late = F('m2026-12', paidOut('2026-12-19', 100), 2);
    const c = find([moved, late]);
    const a = c.find((x) => x.kind === 'moved-arrival')!;
    expect(a.ids).toEqual([2]);
    expect(a.target).toBe('m2027-01');
    expect(a.repairs).toEqual(['move', 'leave']);
  });
  it('an acknowledged conflict stays listed as acknowledged, and a changed record is a new problem', () => {
    const f1 = F('m2026-12', inv(10000), 1), f2 = F('m2026-12', inv(12000), 2);
    const key = find([f1, f2])[0].key;
    const acked = { ...OB, data: { ...OB.data, acknowledged: [key] } };
    expect(findConflicts([acked], [f1, f2])[0].acknowledged).toBe(true);
    const f2b = fact(1, 'm2026-12', inv(12000), 2, 99);
    expect(findConflicts([acked], [f1, f2b])[0].acknowledged).toBe(false);
  });
  it('conflicts are reported in a stable order and never mutate their inputs', () => {
    const facts = [F('m2026-12', inv(10000), 1), F('m2026-12', inv(12000), 2)];
    const before = JSON.stringify(facts);
    const a = find(facts), b = find([...facts].reverse());
    expect(a.map((c) => c.key)).toEqual(b.map((c) => c.key));
    expect(JSON.stringify(facts)).toBe(before);
  });
});

describe('B2 schedule changes when billing facts exist (B1 report section 13)', () => {
  const cur = (schedule: ReturnType<typeof monthly> | null, over: object = {}) => ({ schedule, scheduleHistory: [], trackingSince: '2026-01-01', ...over });
  const twice = (a: number, b: number, anchorMonth = '2026-01') => ({ kind: 'twice-monthly' as const, semi: { a: { kind: 'day' as const, day: a, adjust: 'none' as const }, b: { kind: 'day' as const, day: b, adjust: 'none' as const } }, anchorMonth });
  it('a period holding a fact counts as applied: the schedule is revised, not silently replaced', () => {
    const blank = planScheduleChange(cur(monthly(12, '2026-12'), { trackingSince: '2026-12-20' }), monthly(28, '2026-12'), '2026-12-25');
    expect(blank.mode).toBe('replace'); // nothing ever applied, nothing recorded: simply replaced (B1)
    expect(blank.problem).toBeNull();
    const withFact = planScheduleChange(cur(monthly(12, '2026-12'), { trackingSince: '2026-12-20' }), monthly(28, '2026-12'), '2026-12-25', ['m2026-12']);
    expect(withFact.mode).toBe('revise');
    expect(withFact.problem).toMatch(/December 2026 already has recorded information/);
    expect(withFact.problem).toMatch(/Start the new schedule on 2027-01-01 or later/);
  });
  it('twice-monthly a/b cannot be corrected in place while facts exist (they would re-attach to a different bill)', () => {
    const old = twice(20, 28);
    const sched = (extra: object = {}) => cur(old as never, extra);
    // without a fact, the 20th/28th bills of December have not happened by the 10th, so moving the first bill to the 15th is fine...
    expect(planScheduleChange(sched(), twice(15, 28) as never, '2026-12-10').problem).toBeNull();
    // ...but once the first December bill holds a recorded fact (an invoice entered early), the period counts as applied and the change is refused
    const withFact = planScheduleChange(sched(), twice(15, 28) as never, '2026-12-10', ['s2026-12a']);
    expect(withFact.mode).toBe('revise');
    expect(withFact.problem).toMatch(/December 2026 \(first bill\) already has recorded information/);
    expect(withFact.problem).toMatch(/Start the new schedule on 2027-01-01 or later/);
    // a dated change on a clean boundary keeps every fact on its own slot and its own meaning
    const dated = planScheduleChange(sched(), twice(15, 28) as never, '2027-01-01', ['s2026-12a']);
    expect(dated.problem).toBeNull();
    expect(dated.history[0]).toMatchObject({ until: '2026-12-31' });
  });
  it('facts on periods after the change are not "applied" and do not block it', () => {
    const r = planScheduleChange(cur(monthly(12, '2026-01')), monthly(20, '2026-01'), '2027-01-01', ['m2027-02']);
    expect(r.problem).toBeNull();
  });
  it('an extra bill (x) has no period and never blocks a change', () => {
    const r = planScheduleChange(cur(monthly(12, '2026-12'), { trackingSince: '2026-12-20' }), monthly(20, '2026-12'), '2026-12-25', ['x12345']);
    expect(r.mode).toBe('replace');
  });
});

void ob;

describe('B2 look-alike extra bills are flagged, never rejected (B0 N11)', () => {
  const o = obRec(1, { schedule: monthly(18, '2026-01'), trackingSince: '2026-01-01' });
  it('two extra bills with the same amount and bill date look alike; different dates or different document numbers do not', () => {
    const a = fact(1, 'x1', inv(3500, { invoiceDate: '2026-08-02' }), 1), b = fact(1, 'x2', inv(3500, { invoiceDate: '2026-08-02' }), 2);
    expect(findConflicts([o], [a, b]).map((c) => c.kind)).toEqual(['invoice-number']);
    expect(findConflicts([o], [a, fact(1, 'x2', inv(3500, { invoiceDate: '2026-08-03' }), 2)])).toEqual([]);
    expect(findConflicts([o], [fact(1, 'x1', inv(3500, { invoiceDate: '2026-08-02', invoiceNumber: 'A-1' }), 1), fact(1, 'x2', inv(3500, { invoiceDate: '2026-08-02', invoiceNumber: 'A-2' }), 2)])).toEqual([]);
    expect(findConflicts([o], [fact(1, 'm2026-11', inv(3500, { invoiceDate: '2026-08-02' }), 1), fact(1, 'm2026-12', inv(3500, { invoiceDate: '2026-08-02' }), 2)])).toEqual([]); // two ordinary periods are never "extras"
  });
});
