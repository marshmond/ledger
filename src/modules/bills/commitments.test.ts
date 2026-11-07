import { describe, expect, it } from 'vitest';
import type { ModuleRecord } from '../../core/entities';
import { asObligation, toStored, type ObligationData, type ObligationRecord } from './model';
import { buildCommitments, commitmentWindow } from './commitments';
import { addD, dow, monthly, ob } from './billsTestkit';

/** Hand-computed cases for the indicative recurring commitments (T2 to T4). Expectations, never money spent. Invented data. */
const TODAY = '2026-11-07'; // a Saturday; the 12-month window is 2026-11-07 to 2027-11-06
let n = 1;
const rec = (over: Partial<ObligationData>): ObligationRecord => asObligation({ id: n++, module: 'bills', kind: 'obligation', data: toStored(ob({ trackingSince: TODAY, ...over }, TODAY)), createdAt: 1, updatedAt: 1, deletedAt: null } as ModuleRecord);
const fixedMonthly = (cents: number, over: Partial<ObligationData> = {}) => rec({ amountKind: 'fixed', prices: [{ from: TODAY, cents, label: '' }], schedule: monthly(12, '2026-11'), ...over });

describe('B1: commitments are worked out date by date and add up exactly', () => {
  it('the 12-month window counts a monthly bill 12 times, not 13', () => {
    expect(commitmentWindow(TODAY)).toEqual({ from: '2026-11-07', to: '2027-11-06' });
    const c = buildCommitments([fixedMonthly(1549)], TODAY);
    expect(c.lines[0].periods).toBe(12);
    expect(c.known).toEqual({ cents: 12 * 1549, obligations: 1, periods: 12 });
    expect(c.averaged.knownCents).toBe(1549);
  });
  it('a yearly bill counts once, on its date; the monthly figure is only an average (annual is not monthly spending)', () => {
    const c = buildCommitments([rec({ title: 'Home insurance', prices: [{ from: TODAY, cents: 120000, label: '' }], schedule: monthly(15, '2027-03', 12) })], TODAY);
    expect(c.known.cents).toBe(120000);
    expect(c.lines[0].periods).toBe(1);
    expect(c.averaged.knownCents).toBe(10000);
  });
  it('a bill that varies is an ESTIMATE kept apart from the known total', () => {
    const c = buildCommitments([fixedMonthly(1549), rec({ amountKind: 'variable', prices: [{ from: TODAY, cents: 9000, label: '' }], schedule: monthly(18, '2026-11') })], TODAY);
    expect(c.known.cents).toBe(12 * 1549);
    expect(c.estimated).toEqual({ cents: 12 * 9000, obligations: 1, periods: 12 });
    expect(c.lines.map((l) => l.kind)).toEqual(['known', 'estimated']);
  });
  it('an unknown amount is counted but is in NEITHER total, and is never zero', () => {
    const c = buildCommitments([rec({ amountKind: 'unknown', prices: [], schedule: monthly(12, '2026-11') }), rec({ amountKind: 'variable', prices: [], schedule: monthly(5, '2026-11') })], TODAY);
    expect(c.known.cents).toBe(0);
    expect(c.estimated.cents).toBe(0);
    expect(c.unknown).toEqual({ obligations: 2, periods: 24 });
    expect(c.lines.every((l) => l.kind === 'unknown')).toBe(true);
    expect(c.known.obligations + c.estimated.obligations).toBe(0);
  });
  it('a free trial month (a known $0.00) then the regular price: each date uses the price in force on its own day', () => {
    const c = buildCommitments([rec({ prices: [{ from: TODAY, cents: 0, label: 'trial' }, { from: '2027-02-12', cents: 1549, label: 'regular' }], schedule: monthly(12, '2026-11') })], TODAY);
    // dates: 12 Nov, 12 Dec, 12 Jan at $0.00, then 12 Feb to 12 Oct (9 dates) at $15.49
    expect(c.known).toEqual({ cents: 9 * 1549, obligations: 1, periods: 12 });
    expect(c.unknown.periods).toBe(0);
  });
  it('weekly: the count comes from the calendar (independent check), and every 2 weeks halves it', () => {
    const fridays = (() => { let d = TODAY; while (dow(d) !== 5) d = addD(d, 1); const out: string[] = []; for (; d <= '2027-11-06'; d = addD(d, 7)) out.push(d); return out; })();
    const w = rec({ prices: [{ from: TODAY, cents: 1000, label: '' }], schedule: { kind: 'weeks', every: 1, weekday: 5, anchorDate: fridays[0] } });
    const c = buildCommitments([w], TODAY);
    expect(c.lines[0].periods).toBe(fridays.length);
    expect(c.known.cents).toBe(fridays.length * 1000);
    const w2 = rec({ prices: [{ from: TODAY, cents: 1000, label: '' }], schedule: { kind: 'weeks', every: 2, weekday: 5, anchorDate: fridays[0] } });
    expect(buildCommitments([w2], TODAY).lines[0].periods).toBe(Math.ceil(fridays.length / 2));
  });
  it('twice a month gives 24 dates a year', () => {
    const t = rec({ prices: [{ from: TODAY, cents: 5000, label: '' }], schedule: { kind: 'twice-monthly', semi: { a: { kind: 'day', day: 1 }, b: { kind: 'day', day: 15 } }, anchorMonth: '2026-11' } });
    const c = buildCommitments([t], TODAY);
    expect(c.lines[0].periods).toBe(24); // 15 Nov 2026, then 1st and 15th of Dec to Oct (22 dates), then 1 Nov 2027
    expect(c.known.cents).toBe(24 * 5000);
  });
  it('on-demand bills have no dates, so nothing is counted; they are listed, not guessed', () => {
    const c = buildCommitments([rec({ schedule: null })], TODAY);
    expect(c.onDemand).toBe(1);
    expect(c.known.cents + c.estimated.cents).toBe(0);
    expect(c.lines[0].kind).toBe('on-demand');
  });
  it('before the tracking start nothing is counted; after it, only later dates', () => {
    const c = buildCommitments([fixedMonthly(1000, { trackingSince: '2027-03-01' })], TODAY);
    expect(c.lines[0].periods).toBe(8); // 12 Mar to 12 Oct 2027
  });
});

describe('B1: paused and ended are handled the same way as the date previews (one reader, no special case)', () => {
  it('an open pause counts nothing from its start; a closed pause leaves a gap; an ended bill counts only until its end day', () => {
    const open = fixedMonthly(1000, { status: 'paused', pauses: [{ from: TODAY, to: null }] });
    expect(buildCommitments([open], TODAY).known.cents).toBe(0);
    const gap = fixedMonthly(1000, { pauses: [{ from: '2027-01-01', to: '2027-04-01' }] });
    expect(buildCommitments([gap], TODAY).lines[0].periods).toBe(9); // Nov, Dec, then Apr to Oct
    const past = fixedMonthly(1000, { status: 'ended', endedOn: '2026-11-01' });
    expect(buildCommitments([past], TODAY).known.cents).toBe(0);
    const future = fixedMonthly(1000, { status: 'ended', endedOn: '2027-01-31' });
    expect(buildCommitments([future], TODAY).lines[0].periods).toBe(3); // 12 Nov, 12 Dec, 12 Jan
  });
  it('a status this version does not know counts nothing (fail closed)', () => {
    const r = rec({});
    r.data = { ...r.data, status: 'unsupported', rawKept: { status: 'snoozed' } };
    expect(buildCommitments([r], TODAY).known.cents).toBe(0);
  });
});

describe('B1: loans are left out (A-8) and the figures cannot contain money that moved', () => {
  it('a loan, one pointing at a loan and one paid through the loan are excluded and counted separately', () => {
    const c = buildCommitments([fixedMonthly(120000, { type: 'loan' }), fixedMonthly(500, { loanId: 4 }), fixedMonthly(7000, { type: 'insurance', paidThroughLoan: true }), fixedMonthly(1549)], TODAY);
    expect(c.loanExcluded).toBe(3);
    expect(c.known.cents).toBe(12 * 1549);
    expect(c.lines).toHaveLength(1);
  });
  it('the result has no field for payments, spending or "paid"', () => {
    const c = buildCommitments([fixedMonthly(1549)], TODAY);
    expect(Object.keys(c).sort()).toEqual(['averaged', 'estimated', 'known', 'lines', 'loanExcluded', 'onDemand', 'unknown', 'window']);
    expect(JSON.stringify(c)).not.toMatch(/paid|spent|spending|payment/i);
  });
  it('the totals equal the sum of the per-bill lines, and the order of the input does not matter', () => {
    const list = [fixedMonthly(1549), fixedMonthly(1200, { title: 'B' }), rec({ amountKind: 'variable', prices: [{ from: TODAY, cents: 9000, label: '' }], schedule: monthly(18, '2026-11') }), rec({ amountKind: 'unknown', prices: [], schedule: monthly(3, '2026-11') })];
    const a = buildCommitments(list, TODAY);
    const b = buildCommitments([...list].reverse(), TODAY);
    expect(a.known).toEqual(b.known); expect(a.estimated).toEqual(b.estimated); expect(a.unknown).toEqual(b.unknown);
    expect(a.known.cents).toBe(a.lines.reduce((s, l) => s + l.knownCents, 0));
    expect(a.estimated.cents).toBe(a.lines.reduce((s, l) => s + l.estimatedCents, 0));
    expect(a.unknown.periods).toBe(a.lines.reduce((s, l) => s + l.unknownPeriods, 0));
  });
  it('reading the figures writes nothing and is repeatable', () => {
    const list = [fixedMonthly(1549)];
    const before = JSON.stringify(list);
    expect(JSON.stringify(buildCommitments(list, TODAY))).toBe(JSON.stringify(buildCommitments(list, TODAY)));
    expect(JSON.stringify(list)).toBe(before);
  });
});
