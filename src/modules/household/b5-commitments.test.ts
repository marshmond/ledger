import { describe, expect, it } from 'vitest';
import type { Txn } from '../../types';
import { buildCommitments } from '../bills/commitments';
import { cashTiming, derive, type Derived } from '../bills/readModel';
import { confirmBody, creditF, inv, lcRec, monthly, obRec, obWith, requestBody, stepBody } from '../bills/billsTestkit';
import type { CycleRecord } from '../bills/cycleModel';
import type { ObligationRecord } from '../bills/model';
import type { Schedule } from '../bills/schedule';
import { scheduleStateOf, type ScheduleState } from '../services/expectedCharges';
import type { ArrangementRecord } from '../services/model';
import { householdCommitments, type HouseholdCommitments } from './commitments';
import { arrangement, billFact, biweekly, weekly } from './householdTestkit';

/**
 * B5 commitments and expected payments. Today is 2026-11-08 (a Sunday). Expected numbers are worked out by hand from the dates (the arithmetic is beside each).
 * Windows are [today, today + N] with both ends included: 7 days ends 15 Nov, 30 days ends 8 Dec, 90 days ends 6 Feb 2027, twelve months ends 7 Nov 2027.
 */
const TODAY = '2026-11-08';
const derived = (obs: ObligationRecord[], cycles: CycleRecord[] = [], txns: Txn[] = []): Derived => derive({ obligations: obs, cycles, tasks: [], financeTxns: new Map(txns.map((t) => [t.id!, t])) }, TODAY);
const bill = (id: number, over: Parameters<typeof obRec>[1] = {}) => obRec(id, { title: `Bill ${id}`, trackingSince: '2026-11-01', prices: [{ from: '2026-11-01', cents: 9000, label: '' }], ...over }, '2026-11-01');
const noServices = { arrangements: [] as ArrangementRecord[], state: new Map<number, ScheduleState>() };
const svc = (arrs: ArrangementRecord[], state: Map<number, ScheduleState> = new Map()) => ({ arrangements: arrs, state: new Map(arrs.map((a) => [a.id, state.get(a.id) ?? scheduleStateOf([])])) });
const run = (obs: ObligationRecord[], arrs: ArrangementRecord[] = [], links: Map<number, number[]> = new Map(), cycles: CycleRecord[] = []): HouseholdCommitments =>
  householdCommitments({ today: TODAY, bills: derived(obs, cycles), services: svc(arrs), serviceLinks: links });
const win = (c: HouseholdCommitments, days: number) => c.windows.find((w) => w.days === days)!;
const twice = (a: number, b: number, anchorMonth = '2026-11'): Schedule => ({ kind: 'twice-monthly', semi: { a: { kind: 'day', day: a, adjust: 'none' }, b: { kind: 'day', day: b, adjust: 'none' } }, anchorMonth });
const visits = (id: number, cents = 12000, cadence = biweekly, over: Partial<ArrangementRecord['data']> = {}) => arrangement(id, { title: `Cleaning ${id}`, cadence, expected: { basis: 'perVisit', cents }, ...over });

describe('B5 commitments: amounts keep their certainty (known, estimated, unknown, disputed)', () => {
  it('a known monthly $90.00 bill on the 18th: nothing in 7 days, $90.00 in 30 days (18 Nov), $270.00 in 90 days (18 Nov, 18 Dec, 18 Jan)', () => {
    const c = run([bill(1, { schedule: monthly(18, '2026-11') })]);
    expect([7, 30, 90].map((d) => [win(c, d).totals.known.cents, win(c, d).totals.known.count])).toEqual([[0, 0], [9000, 1], [27000, 3]]);
    expect(win(c, 30).rows.map((r) => [r.date, r.cents, r.certainty])).toEqual([['2026-11-18', 9000, 'known']]);
  });

  it('a varying bill is ESTIMATED, a bill with no amount is UNKNOWN (counted, never zero), and neither is added to the known figure', () => {
    const est = bill(1, { schedule: monthly(18, '2026-11'), amountKind: 'variable', prices: [{ from: '2026-11-01', cents: 8000, label: '' }] });
    const unk = bill(2, { schedule: monthly(20, '2026-11'), amountKind: 'unknown', prices: [] });
    const w = win(run([est, unk]), 30);
    expect([w.totals.known.cents, w.totals.estimated.cents, w.totals.estimated.count, w.totals.unknown.count]).toEqual([0, 8000, 1, 1]);
    expect(w.rows.find((r) => r.sourceId === 2)).toMatchObject({ cents: null, certainty: 'unknown' });
  });

  it('semimonthly $500.00 on the 1st and 15th: 15 Nov and 1 Dec fall in 30 days = $1,000.00; the 7-day window (to 15 Nov) holds only the 15th', () => {
    const c = run([bill(1, { schedule: twice(1, 15), prices: [{ from: '2026-11-01', cents: 50000, label: '' }] })]);
    expect([win(c, 7).totals.known.cents, win(c, 30).totals.known.cents, win(c, 30).totals.known.count]).toEqual([50000, 100000, 2]);
  });

  it('biweekly $75.00 on Fridays from 6 Nov: 20 Nov and 4 Dec in 30 days = $150.00; six Fridays in 90 days = $450.00', () => {
    const c = run([bill(1, { schedule: { kind: 'weeks', every: 2, weekday: 5, anchorDate: '2026-11-06' }, prices: [{ from: '2026-11-01', cents: 7500, label: '' }] })]);
    expect([win(c, 30).totals.known.cents, win(c, 90).totals.known.count, win(c, 90).totals.known.cents]).toEqual([15000, 6, 45000]);
  });

  it('quarterly $300.00 (20 Nov, 20 Feb, 20 May, 20 Aug) and annual $1,200.00 (15 Mar 2027): the twelve-month commitments are $1,200.00 each', () => {
    const q = bill(1, { schedule: monthly(20, '2026-11', 3), prices: [{ from: '2026-11-01', cents: 30000, label: '' }] });
    const a = bill(2, { schedule: monthly(15, '2026-03', 12), prices: [{ from: '2026-01-01', cents: 120000, label: '' }] });
    const c = run([q, a]);
    expect(win(c, 90).totals.known.cents).toBe(30000); // only 20 Nov is before 6 Feb
    expect([c.twelve.bills.lines.find((l) => l.id === 1)!.knownCents, c.twelve.bills.lines.find((l) => l.id === 2)!.knownCents]).toEqual([120000, 120000]);
  });

  it('a provider credit lowers what is expected: billed $120.00, credit $20.00 = $100.00 expected on 18 Nov', () => {
    const o = bill(1, { schedule: monthly(18, '2026-11') });
    const cycles = [billFact(1, 'm2026-11', inv(12000, { dueDate: '2026-11-18' })), billFact(1, 'm2026-11', creditF(2000))];
    expect(win(run([o], [], new Map(), cycles), 30).rows[0]).toMatchObject({ cents: 10000, certainty: 'known' });
  });

  it('a loan-tracked bill is never a commitment here (Loans owns its payments)', () => {
    const c = run([bill(1, { schedule: monthly(18, '2026-11'), type: 'loan' })]);
    expect(win(c, 90).rows).toEqual([]);
    expect(c.loansExcluded).toBe(1);
  });
});

describe('B5 commitments: prices, cancellations and lifecycle', () => {
  const streamly = (records: Parameters<typeof obWith>[1], over: Parameters<typeof obRec>[1] = {}) => obWith(1, records, { title: 'Streamly', type: 'subscription', schedule: monthly(18, '2026-11'), trackingSince: '2026-11-01', prices: [{ from: '2026-11-01', cents: 500, label: '' }], ...over }, '2026-11-01');

  it('a future price step changes only the expected payments on or after it: $5.00 on 18 Nov and 18 Dec, $15.00 on 18 Jan; recorded spending is not touched', () => {
    const o = streamly([lcRec(1, 1, stepBody('2027-01-01', 1500))]);
    const c = run([o]);
    expect(win(c, 90).rows.map((r) => [r.date, r.cents])).toEqual([['2026-11-18', 500], ['2026-12-18', 500], ['2027-01-18', 1500]]);
    expect(win(c, 90).rows[2].note).toMatch(/price change/);
    expect(c.twelve.bills.known.cents).toBe(500 * 2 + 1500 * 10); // Nov and Dec at $5.00, Jan to Oct at $15.00
  });

  it('a CONFIRMED future cancellation (effective 31 Dec) stops new expected payments after it: 18 Nov and 18 Dec only', () => {
    const o = streamly([lcRec(1, 1, requestBody('2026-10-20')), lcRec(2, 1, confirmBody('2026-12-31', '2026-10-25'))], { prices: [{ from: '2026-11-01', cents: 1549, label: '' }] });
    const c = run([o]);
    expect(win(c, 90).rows.map((r) => r.date)).toEqual(['2026-11-18', '2026-12-18']);
    expect([c.twelve.bills.known.periods, c.twelve.bills.known.cents]).toEqual([2, 3098]);
  });

  it('a cancellation REQUEST with no confirmation changes nothing: every payment is still expected, and each row says so', () => {
    const o = streamly([lcRec(1, 1, requestBody('2026-10-20'))]);
    const w = win(run([o]), 90);
    expect(w.rows).toHaveLength(3);
    expect(w.rows.every((r) => /requested but is not confirmed/.test(r.note))).toBe(true);
  });

  it('TWO different confirmed dates are a dispute: nothing is cut off, and the rows say the date is in dispute', () => {
    const o = streamly([lcRec(1, 1, confirmBody('2026-12-31', '2026-10-25')), lcRec(2, 1, confirmBody('2027-02-28', '2026-10-26'))]);
    expect(o.data.lc!.conflicts.some((x) => x.kind === 'confirm-dates')).toBe(true);
    const w = win(run([o]), 90);
    expect(w.rows).toHaveLength(3);
    expect(w.rows.every((r) => /in dispute/.test(r.note))).toBe(true);
  });

  it('two different prices recorded for the same day are DISPUTED: that payment reads as unknown (never one of the two prices, never zero)', () => {
    const o = streamly([lcRec(1, 1, stepBody('2026-12-01', 1000)), lcRec(2, 1, stepBody('2026-12-01', 2000))]);
    const c = run([o]);
    const w = win(c, 90);
    expect(w.rows.map((r) => [r.date, r.cents, r.certainty])).toEqual([['2026-11-18', 500, 'known'], ['2026-12-18', null, 'disputed'], ['2027-01-18', null, 'disputed']]);
    expect([w.totals.known.cents, w.totals.disputed.count, w.totals.unknown.count]).toEqual([500, 2, 0]);
    expect(c.twelve.disputedBills).toBe(1);
  });

  it('twelve months use ONE window end for both readers (Bills\' own, 7 Nov 2027): a Monday visit on 8 Nov 2027 is outside it, and the counts are PAYMENTS, not bills', () => {
    const mondays = arrangement(1, { title: 'Monday visits', cadence: { mode: 'fixed', rule: { freq: 'weekly', interval: 1, byWeekday: [1], end: { type: 'never' } }, anchorDate: '2026-11-09' }, expected: { basis: 'perVisit', cents: 1000 } });
    const c = run([bill(1, { schedule: monthly(18, '2026-11') })], [mondays]);
    expect(c.twelve.to).toBe('2027-11-07');
    expect(c.twelve.to).toBe(c.twelve.bills.window.to);
    expect(c.twelve.services.items[0].dates.at(-1)).toBe('2027-11-01'); // 8 Nov 2027 is a Monday but one day past the window
    expect([c.twelve.totals.known.count, c.twelve.totals.known.cents]).toEqual([12, 12 * 9000]); // 12 payments, not "1 bill"
    expect(c.twelve.totals.estimated.count).toBe(c.twelve.services.items[0].visits);
  });

  it('the twelve-month commitments equal the Bills reader\'s own figures (it is reused, not recalculated)', () => {
    const obs = [bill(1, { schedule: monthly(18, '2026-11') }), bill(2, { schedule: twice(1, 15), prices: [{ from: '2026-11-01', cents: 5000, label: '' }] })];
    const c = run(obs);
    const own = buildCommitments(obs, TODAY);
    expect([c.twelve.bills.known, c.twelve.bills.estimated, c.twelve.bills.unknown]).toEqual([own.known, own.estimated, own.unknown]);
    expect(c.twelve.totals.known.cents).toBe(own.known.cents);
  });
});

describe('B5 commitments: exact day boundaries', () => {
  it('a payment exactly 7 days away (15 Nov) is in the 7-day window and one on 16 Nov is not; 8 Dec is in the 30-day window, 9 Dec is not', () => {
    const on = (day: number, anchor: string) => bill(day, { title: `On ${day}`, schedule: monthly(day, anchor, 12) });
    const c = run([on(15, '2026-11'), on(16, '2026-11'), on(8, '2026-12'), on(9, '2026-12')]);
    expect(win(c, 7).rows.map((r) => r.date)).toEqual(['2026-11-15']);
    expect(win(c, 30).rows.map((r) => r.date)).toEqual(['2026-11-15', '2026-11-16', '2026-12-08']);
    expect(win(c, 90).rows.map((r) => r.date)).toEqual(['2026-11-15', '2026-11-16', '2026-12-08', '2026-12-09']);
  });

  it('a payment dated today is in every window; one dated yesterday and still open is not "ahead"', () => {
    const c = run([bill(1, { schedule: monthly(8, '2026-11', 12) }), bill(2, { schedule: monthly(7, '2026-11', 12) })]);
    expect(win(c, 7).rows.map((r) => r.sourceId)).toEqual([1]);
  });

  it('the Bills rows add up to the Bills cash timing for the same snapshot, window by window', () => {
    const obs = [bill(1, { schedule: monthly(18, '2026-11') }), bill(2, { schedule: monthly(20, '2026-11'), amountKind: 'variable', prices: [{ from: '2026-11-01', cents: 8000, label: '' }] }), bill(3, { schedule: monthly(25, '2026-11'), amountKind: 'unknown', prices: [] })];
    const d = derived(obs);
    const c = householdCommitments({ today: TODAY, bills: d, services: noServices, serviceLinks: new Map() });
    for (const own of cashTiming(d)) {
      const w = win(c, own.days);
      expect([w.totals.known.cents, w.totals.known.count, w.totals.estimated.cents, w.totals.estimated.count, w.totals.unknown.count]).toEqual([own.known.cents, own.known.count, own.estimated.cents, own.estimated.count, own.unknown.count]);
    }
  });
});

describe('B5 commitments: Household Services (estimates only, on the real cadence)', () => {
  it('a biweekly $120.00-per-visit arrangement: 20 Nov and 4 Dec in 30 days = $240.00 ESTIMATED; nothing in 7 days; it is not spending', () => {
    const c = run([], [visits(1)]);
    expect(win(c, 7).rows).toEqual([]);
    expect(win(c, 30).rows.map((r) => [r.date, r.cents, r.certainty])).toEqual([['2026-11-20', 12000, 'estimated'], ['2026-12-04', 12000, 'estimated']]);
    expect([win(c, 30).totals.estimated.cents, win(c, 30).totals.known.cents]).toEqual([24000, 0]);
  });

  it('an arrangement with a schedule and NO estimate gives dated rows with no amount: unknown, never $0.00', () => {
    const a = arrangement(1, { title: 'Pool care', cadence: weekly });
    const w = win(run([], [a]), 30);
    expect(w.rows.map((r) => [r.date, r.cents, r.certainty])).toEqual([['2026-11-13', null, 'unknown'], ['2026-11-20', null, 'unknown'], ['2026-11-27', null, 'unknown'], ['2026-12-04', null, 'unknown']]);
    expect([w.totals.unknown.count, w.totals.estimated.cents]).toEqual([4, 0]);
  });

  it('a per-month estimate is NOT converted (no rule for part months): listed as not converted and counted as unknown', () => {
    const a = arrangement(1, { title: 'Lawn plan', cadence: weekly, expected: { basis: 'perMonth', cents: 40000 } });
    const w = win(run([], [a]), 30);
    expect([w.rows.length, w.notConverted.length, w.totals.unknown.count, w.totals.estimated.cents]).toEqual([0, 1, 1, 0]);
  });

  it('paused and ended arrangements expect nothing', () => {
    const c = run([], [visits(1, 12000, biweekly, { status: 'paused' }), visits(2, 12000, biweekly, { status: 'ended' })]);
    expect(win(c, 90).rows).toEqual([]);
  });

  it('a visit moved to another day is counted once, on that day, and the later visits stay on the usual Fridays', () => {
    const a = visits(1, 12000, weekly);
    const state = new Map<number, ScheduleState>([[1, { openDue: '2026-11-10', openOccurrence: '2026-11-13', lastDoneOccurrence: null }]]);
    const c = householdCommitments({ today: TODAY, bills: derived([]), services: svc([a], state), serviceLinks: new Map() });
    expect(win(c, 30).rows.map((r) => r.date)).toEqual(['2026-11-10', '2026-11-20', '2026-11-27', '2026-12-04']);
  });

  it('Home & Assets adds no commitment, and says why', () => {
    const c = run([bill(1, { schedule: monthly(18, '2026-11') })], [visits(1)]);
    expect(c.homeAssets.contributes).toBe(false);
    expect(c.windows.flatMap((w) => w.rows).every((r) => r.module === 'bills' || r.module === 'services')).toBe(true);
  });
});

describe('B5 commitments: a bill and a Household Services arrangement that are linked', () => {
  const cleaner = (cents = 24000) => bill(1, { title: 'Cleaning service', schedule: monthly(18, '2026-11'), prices: [{ from: '2026-11-01', cents, label: '' }] });
  const link = new Map([[1, [1]]]);

  it('equal totals over the window ($240.00 billed on 18 Nov; two $120.00 visits on 20 Nov and 4 Dec) are ONE charge: counted once, the service rows are kept and labelled, nothing is deleted', () => {
    const c = run([cleaner()], [visits(1)], link);
    const w = win(c, 30);
    expect(w.consolidations.map((x) => [x.status, x.billsCents, x.servicesCents, x.exposureCents])).toEqual([['folded', 24000, 24000, 0]]);
    expect([w.totals.known.cents, w.totals.estimated.cents]).toEqual([24000, 0]);
    expect(w.rows.filter((r) => r.module === 'services').every((r) => r.foldedInto === 'bill:1')).toBe(true);
    expect(w.rows).toHaveLength(3); // 1 bill row + 2 service rows, all still listed
    expect(w.mayOverlap).toBe(false);
  });

  it('different totals are NOT folded: both are counted and the most that could be double-counted is shown ($200.00 billed against $240.00 of visits)', () => {
    const w = win(run([cleaner(20000)], [visits(1)], link), 30);
    expect(w.consolidations[0]).toMatchObject({ status: 'uncertain', billsCents: 20000, servicesCents: 24000, exposureCents: 20000 });
    expect([w.totals.known.cents, w.totals.estimated.cents]).toEqual([20000, 24000]);
    expect(w.mayOverlap).toBe(true);
    expect(w.overlapExposureCents).toBe(20000);
  });

  it('an extra one-off $60.00 charge is NEVER dropped: the bill now totals $300.00 against $240.00 of visits, so nothing is folded and both stay counted', () => {
    const extra = [billFact(1, 'x77', inv(6000, { dueDate: '2026-11-25' }))];
    const w = win(run([cleaner()], [visits(1)], link, extra), 30);
    expect(w.totals.known.cents).toBe(24000 + 6000);
    expect(w.consolidations[0].status).toBe('uncertain');
    expect(w.totals.estimated.cents).toBe(24000);
  });

  it('an amount that is not known on either side prevents folding (an unknown is never treated as equal to anything)', () => {
    const a = arrangement(1, { title: 'Cleaning 1', cadence: biweekly }); // visits expected, no estimate
    const w = win(run([cleaner()], [a], link), 30);
    expect(w.consolidations[0]).toMatchObject({ status: 'uncertain', exposureIsFloor: true });
    expect(w.rows.filter((r) => r.module === 'services').every((r) => r.foldedInto === null)).toBe(true);
  });

  it('an arrangement linked from two bills is ambiguous: nothing is folded', () => {
    const w = win(run([cleaner(), bill(2, { title: 'Cleaning insurance', schedule: monthly(19, '2026-11'), prices: [{ from: '2026-11-01', cents: 24000, label: '' }] })], [visits(1)], new Map([[1, [1]], [2, [1]]])), 30);
    expect(w.consolidations.every((x) => x.status === 'ambiguous')).toBe(true);
    expect(w.rows.every((r) => r.foldedInto === null)).toBe(true);
  });

  it('records that are NOT linked are never folded, even with identical amounts and dates (no guessing from names or amounts)', () => {
    const w = win(run([cleaner()], [visits(1)], new Map()), 30);
    expect(w.consolidations).toEqual([]);
    expect([w.totals.known.cents, w.totals.estimated.cents]).toEqual([24000, 24000]);
  });

  it('a link where one side has nothing in the window raises no notice (nothing could be counted twice)', () => {
    const w = win(run([cleaner()], [visits(1, 12000, biweekly, { status: 'paused' })], link), 30);
    expect(w.consolidations).toEqual([]);
  });

  it('twelve months: the same fold rule applies to the yearly totals ($2,880.00 billed; 26 visits cost more or less, so unequal totals stay separate)', () => {
    const c = run([cleaner()], [visits(1)], link);
    expect(c.twelve.consolidations[0].status).toBe('uncertain');
    expect(c.twelve.mayOverlap).toBe(true);
    expect(c.twelve.totals.known.cents).toBe(24000 * 12);
  });

  it('a linked Finance Scheduled payment is counted once, as the bill (no Finance rule is read or added)', () => {
    const w = win(run([bill(1, { schedule: monthly(18, '2026-11'), scheduledRuleIds: [5] })]), 30);
    expect(w.rows).toHaveLength(1);
    expect(w.totals.known.cents).toBe(9000);
  });
});

describe('B5 commitments: read-only', () => {
  it('building the commitments changes none of its inputs', () => {
    const obs = [bill(1, { schedule: monthly(18, '2026-11') })];
    const d = derived(obs);
    const arrs = [visits(1)];
    const before = JSON.stringify([d.snap.obligations, d.snap.cycles, arrs, [...d.periods]]);
    householdCommitments({ today: TODAY, bills: d, services: svc(arrs), serviceLinks: new Map([[1, [1]]]) });
    expect(JSON.stringify([d.snap.obligations, d.snap.cycles, arrs, [...d.periods]])).toBe(before);
  });

  it('is deterministic whatever order the records arrive in', () => {
    const obs = [bill(1, { schedule: monthly(18, '2026-11') }), bill(2, { schedule: monthly(20, '2026-11') })];
    const arrs = [visits(1), visits(2, 5000, weekly)];
    const a = householdCommitments({ today: TODAY, bills: derived(obs), services: svc(arrs), serviceLinks: new Map() });
    const b = householdCommitments({ today: TODAY, bills: derived([...obs].reverse()), services: svc([...arrs].reverse()), serviceLinks: new Map() });
    expect(JSON.stringify(a.windows)).toBe(JSON.stringify(b.windows));
  });
});
