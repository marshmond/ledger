import { describe, expect, it } from 'vitest';
import type { ModuleRecord } from '../../core/entities';
import { stable } from '../../lib/sync/merge';
import {
  applyEdit, asObligation, blankObligation, expectedAmountOn, guessType, historyReasons, isLoanExcluded, needsReview, normalizeObligation, obligationLabel, parseObligationRef,
  priceOn, toStored, validateObligation, withLog, type ObligationData,
} from './model';
import { monthly, ob } from './billsTestkit';

/** Defensive parsing, unknown-field preservation and strict validation (tests 43 and B1 acceptance). All data invented. */
const row = (data: unknown, over: Partial<ModuleRecord> = {}): ModuleRecord => ({ id: 1730000000777000, module: 'bills', kind: 'obligation', data: data as never, createdAt: Date.UTC(2026, 10, 7, 15), updatedAt: Date.UTC(2026, 10, 7, 15), deletedAt: null, ...over }) as ModuleRecord;
const minimal = { title: 'Streamly Premium', type: 'subscription', need: 'flexible', status: 'active', amountKind: 'fixed', trackingSince: '2026-11-07', prices: [{ from: '2026-11-07', cents: 1549, label: '' }], schedule: monthly(12, '2026-11'), payment: { how: 'auto' } };

describe('B1: the reader never throws and never loses what it cannot read', () => {
  it('an empty or garbage record reads as a safe placeholder', () => {
    for (const data of [undefined, null, {}, [], 'text', 42, { title: 7, type: {}, status: [] }]) {
      const r = asObligation(row(data));
      expect(r.data.title).toBeTypeOf('string');
      expect(r.data.status === 'active' || r.data.status === 'unsupported').toBe(true);
      expect(Array.isArray(r.data.prices)).toBe(true);
    }
    expect(asObligation(row({})).data.title).toBe('(no title)');
  });
  it('fuzz: every field replaced by every kind of junk value still reads without throwing', () => {
    const junk: unknown[] = [null, 0, -5, 1.5, NaN, '', 'x', [], [1, 2], {}, { kind: 'zzz' }, true, [{}], [null], { from: 5 }];
    const keys = ['title', 'type', 'need', 'providerContactId', 'providerNameSnapshot', 'amountKind', 'prices', 'schedule', 'scheduleHistory', 'trackingSince', 'pauses', 'payment', 'scheduledRuleIds', 'payeeHints', 'categoryId', 'loanId', 'paidThroughLoan', 'reminders', 'terms', 'cancellation', 'predecessorId', 'acknowledged', 'status', 'endedOn', 'endReason', 'lifecycle', 'review', 'refs', 'notes'];
    for (const k of keys) for (const j of junk) {
      const r = asObligation(row({ ...minimal, [k]: j }));
      expect(r.data.title).toBeTypeOf('string');
      expect(() => toStored(r.data)).not.toThrow();
      expect(() => JSON.stringify(r.data)).not.toThrow();
    }
  });
  it('reads a complete record exactly', () => {
    const r = asObligation(row({ ...minimal, providerContactId: 42, providerNameSnapshot: 'Streamly', review: { on: true, note: 'check use', since: '2026-11-07' }, refs: [{ label: 'Statement', url: 'https://example.com/s' }], notes: 'n' }));
    expect(r.data).toMatchObject({ title: 'Streamly Premium', type: 'subscription', need: 'flexible', providerContactId: 42, providerNameSnapshot: 'Streamly', amountKind: 'fixed', status: 'active', payment: { how: 'auto', fundingAccountId: null }, review: { on: true, note: 'check use', since: '2026-11-07' } });
    expect(r.data.schedule).toEqual(monthly(12, '2026-11'));
    expect(needsReview(r.data)).toEqual([]);
  });
  it('a record with no tracking date reads as the day it was created', () => {
    const { trackingSince: _t, ...noTrack } = minimal; void _t;
    expect(asObligation(row(noTrack, { createdAt: new Date(2026, 5, 3, 12).getTime() })).data.trackingSince).toBe('2026-06-03');
  });
});

describe('B1: unknown fields and unreadable values survive every ordinary edit (test 43)', () => {
  const future = { ...minimal, futureField: { nested: [1, 2, { a: 'b' }] }, anotherNewThing: 'x', schedule: { kind: 'lunar', every: 3 }, status: 'snoozed', prices: [{ from: '2026-11-07', cents: 1549, label: '' }, { from: 'later', cents: 'lots' }] };
  it('unknown top-level fields come back byte for byte', () => {
    const r = asObligation(row(future));
    const out = toStored(normalizeObligation(r.data));
    expect(out.futureField).toEqual({ nested: [1, 2, { a: 'b' }] });
    expect(out.anotherNewThing).toBe('x');
  });
  it('an unsupported status, an unreadable schedule and a damaged price list are shown as needing review and written back unchanged', () => {
    const r = asObligation(row(future));
    expect(r.data.status).toBe('unsupported');
    expect(r.data.schedule).toBeNull();
    expect(needsReview(r.data).sort()).toEqual(['prices', 'schedule', 'status']);
    const edited = applyEdit(r.data, { title: 'Renamed', notes: 'a note' });
    const out = toStored(normalizeObligation(edited));
    expect(out.status).toBe('snoozed');
    expect(out.schedule).toEqual({ kind: 'lunar', every: 3 });
    expect(out.prices).toEqual(future.prices);
    expect(out.title).toBe('Renamed');
    expect(validateObligation(normalizeObligation(edited))).toBeNull();
  });
  it('changing a field on purpose replaces its kept raw value; other kept values stay', () => {
    const r = asObligation(row(future));
    const edited = applyEdit(r.data, { schedule: monthly(5, '2026-11') });
    expect(needsReview(edited).sort()).toEqual(['prices', 'status']);
    const out = toStored(normalizeObligation(edited));
    expect(out.schedule).toEqual(monthly(5, '2026-11'));
    expect(out.status).toBe('snoozed');
  });
  it('a stored record round-trips unchanged through the reader and writer (stable text equal)', () => {
    const full = {
      ...minimal, providerContactId: 42, providerNameSnapshot: 'Streamly', scheduleHistory: [{ until: '2026-10-31', schedule: monthly(1, '2026-01') }], pauses: [{ from: '2026-01-01', to: '2026-02-01' }],
      payment: { how: 'auto', fundingAccountId: 7 }, scheduledRuleIds: [11], payeeHints: ['streamly'], categoryId: 3, loanId: 9, paidThroughLoan: true, reminders: { payTask: true, leadDays: 3 }, terms: { autoRenews: true }, cancellation: { requestedOn: '2026-11-01' },
      predecessorId: 5, acknowledged: ['x'], endedOn: '2026-12-01', endReason: 'cancelled', lifecycle: [{ on: '2026-11-07', kind: 'paused', note: '' }], review: { on: true, note: 'n', since: '2026-11-07' }, refs: [{ label: 'A', url: 'https://example.com', note: 'b' }], notes: 'free text', extraKnownToFuture: 1,
      status: 'ended',
    };
    const back = toStored(asObligation(row(full)).data);
    expect(stable(back)).toBe(stable(full));
  });
  it('a minimal record stays minimal: unused features leave no trace', () => {
    const d = ob({ title: 'Example Power Co' });
    expect(Object.keys(toStored(d)).sort()).toEqual(['amountKind', 'need', 'payment', 'prices', 'schedule', 'status', 'title', 'trackingSince', 'type']);
    expect(toStored(blankObligation({ title: 'x' }, '2026-11-07'))).toEqual({ title: 'x', type: 'other', need: 'unsure', status: 'active', amountKind: 'unknown', trackingSince: '2026-11-07', payment: { how: 'unknown' } });
  });
  it('lifecycle is capped at the last 200 entries when read', () => {
    const lifecycle = Array.from({ length: 250 }, (_, i) => ({ on: '2026-11-07', kind: 'paused', note: String(i) }));
    const r = asObligation(row({ ...minimal, lifecycle }));
    expect(r.data.lifecycle).toHaveLength(200);
    expect(r.data.lifecycle[0].note).toBe('50');
    expect(withLog(r.data, '2026-11-08', 'resumed').lifecycle).toHaveLength(200);
  });
});

describe('B1: strict validation says what is wrong in plain words', () => {
  const v = (over: Partial<ObligationData>) => validateObligation(normalizeObligation(ob(over)));
  it('accepts a good record', () => expect(v({})).toBeNull());
  it('title', () => { expect(v({ title: '   ' })).toMatch(/what the bill/); expect(v({ title: 'x'.repeat(121) })).toMatch(/too long/); });
  it('amounts: whole non-negative cents, within the limit; a fixed bill needs one', () => {
    expect(v({ prices: [{ from: '2026-11-07', cents: -1, label: '' }] })).toMatch(/not valid/);
    expect(validateObligation(ob({ prices: [{ from: '2026-11-07', cents: 1.5, label: '' }] }))).toMatch(/not valid/); // validation itself is strict; normalising first rounds to whole cents
    expect(v({ prices: [{ from: '2026-11-07', cents: 1e12, label: '' }] })).toMatch(/not valid/);
    expect(v({ prices: [] })).toMatch(/Enter the amount/);
    expect(v({ amountKind: 'variable', prices: [] })).toBeNull();
    expect(v({ amountKind: 'unknown', prices: [] })).toBeNull();
    expect(v({ prices: [{ from: '2026-11-07', cents: 0, label: 'free trial' }] })).toBeNull(); // a known $0.00 is allowed
  });
  it('dates must be real calendar dates', () => {
    expect(v({ trackingSince: '2026-02-30' })).toMatch(/not a real date/);
    expect(v({ prices: [{ from: '2026-13-01', cents: 100, label: '' }] })).toMatch(/not a real date/);
    expect(v({ status: 'ended', endedOn: '2026-02-30' })).toMatch(/Enter the date it ended/);
    expect(v({ status: 'ended', endedOn: '2026-10-01', trackingSince: '2026-11-07' })).toMatch(/before the tracking start/);
  });
  it('schedule problems are refused with the schedule helper’s message', () => {
    expect(v({ schedule: monthly(1, '2026-11', 1, 'previous') })).toMatch(/outside its own month/);
    expect(v({ schedule: { kind: 'weeks', every: 2, weekday: 1, anchorDate: '2026-11-06' } })).toMatch(/weekday/);
  });
  it('payment, pauses, review, documents and notes', () => {
    expect(v({ payment: { how: 'auto', fundingAccountId: 0 } })).toMatch(/funding account/);
    expect(v({ pauses: [{ from: '2026-05-01', to: '2026-04-01' }] })).toMatch(/pause/);
    expect(v({ pauses: [{ from: '2026-05-01', to: null }, { from: '2026-06-01', to: null }] })).toMatch(/one pause/);
    expect(v({ review: { on: true, note: 'x'.repeat(501), since: null } })).toMatch(/review note/);
    expect(v({ refs: [{ label: 'Doc', url: 'javascript:alert(1)' }] })).toMatch(/http/);
    expect(v({ refs: [{ label: '', url: 'https://example.com' }] })).toMatch(/name/);
    expect(v({ refs: Array.from({ length: 21 }, (_, i) => ({ label: `d${i}` })) })).toMatch(/At most 20/);
    expect(v({ notes: 'x'.repeat(4001) })).toMatch(/too long/);
  });
  it('an unsupported status that is kept is allowed to be saved back; an invented one is not', () => {
    expect(validateObligation(normalizeObligation({ ...ob(), status: 'unsupported', rawKept: { status: 'snoozed' } }))).toBeNull();
    expect(validateObligation(normalizeObligation({ ...ob(), status: 'unsupported' }))).toMatch(/status/);
  });
});

describe('B1: amounts are plans, unknown is never zero (financial integrity)', () => {
  const steps = [{ from: '2026-11-12', cents: 499, label: 'introductory' }, { from: '2027-02-12', cents: 1549, label: 'regular' }];
  it('the price in force is the last step on or before the date; none in force means not known', () => {
    expect(priceOn(steps, '2026-11-11')).toBeNull();
    expect(priceOn(steps, '2026-11-12')?.cents).toBe(499);
    expect(priceOn(steps, '2027-02-11')?.cents).toBe(499);
    expect(priceOn(steps, '2027-02-12')?.cents).toBe(1549);
  });
  it('fixed is known, variable is an estimate, unknown has no amount at all (never zero), a $0.00 trial is a known zero', () => {
    expect(expectedAmountOn({ amountKind: 'fixed', prices: steps }, '2027-03-01')).toEqual({ cents: 1549, basis: 'fixed' });
    expect(expectedAmountOn({ amountKind: 'variable', prices: steps }, '2027-03-01')).toEqual({ cents: 1549, basis: 'variable' });
    expect(expectedAmountOn({ amountKind: 'variable', prices: [] }, '2027-03-01')).toEqual({ cents: null, basis: 'variable' });
    expect(expectedAmountOn({ amountKind: 'unknown', prices: steps }, '2027-03-01')).toEqual({ cents: null, basis: 'unknown' });
    expect(expectedAmountOn({ amountKind: 'fixed', prices: [{ from: '2026-01-01', cents: 0, label: 'trial' }] }, '2026-02-01')).toEqual({ cents: 0, basis: 'fixed' });
    expect(expectedAmountOn({ amountKind: 'fixed', prices: [{ from: '2026-01-01', cents: null, label: '' }] }, '2026-02-01').cents).toBeNull();
  });
  it('loans own their payments: a loan, one pointing at a loan, and one paid through the loan are excluded', () => {
    expect(isLoanExcluded(ob({ type: 'loan' }))).toBe(true);
    expect(isLoanExcluded(ob({ loanId: 3 }))).toBe(true);
    expect(isLoanExcluded(ob({ paidThroughLoan: true }))).toBe(true);
    expect(isLoanExcluded(ob({ type: 'insurance' }))).toBe(false);
  });
});

describe('B1: small helpers', () => {
  it('guessType reads common words and defaults to other', () => {
    expect(guessType('Home insurance')).toBe('insurance');
    expect(guessType('Example Power Co')).toBe('utility');
    expect(guessType('Fibre internet')).toBe('telecom');
    expect(guessType('Maple Gym')).toBe('membership');
    expect(guessType('Streamly Premium')).toBe('subscription');
    expect(guessType('Mortgage')).toBe('loan');
    expect(guessType('Something unusual')).toBe('other');
  });
  it('ids and labels: title, provider and status only, never an amount', () => {
    expect(parseObligationRef('obligation:12')).toBe(12);
    expect(parseObligationRef('arrangement:12')).toBeNull();
    const r = asObligation(row({ ...minimal, providerNameSnapshot: 'Streamly', status: 'paused' }));
    expect(obligationLabel(r)).toBe('Streamly Premium, Streamly (paused)');
    expect(obligationLabel(r)).not.toMatch(/\d/);
  });
  it('history reasons list why a record should not be permanently deleted', () => {
    expect(historyReasons(ob())).toEqual([]);
    expect(historyReasons(ob({ status: 'ended' })).length).toBeGreaterThan(0);
    expect(historyReasons(ob({ lifecycle: [{ on: '2026-11-07', kind: 'paused', note: '' }] }))).toContain('its life story has entries');
    expect(historyReasons(ob({ scheduledRuleIds: [4] }))).toContain('it points at a Finance scheduled item');
  });
});
