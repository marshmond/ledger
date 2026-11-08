import { describe, expect, it } from 'vitest';
import { addMonths } from '../../lib/dates';
import { makeTxnRef } from '../../lib/txnRef';
import type { Txn } from '../../types';
import { chargesAfterCancellation } from './lifecycleCharges';
import { LC_KIND, lcFields, readLifecycle, validateLc, type LcBody } from './lifecycleModel';
import { EMPTY_VIEW, effectiveDeadlines, lifecycleStates, nextPriceChange, renewalDates, timeline, ackKeyRenewal } from './lifecycleState';
import { expectedAmountOn, scheduleSource } from './model';
import { expectedDates } from './schedule';
import { blankTerms, readTerms } from './terms';
import { confirmBody, fact, lcRec, lcView, monthly, obWith, rawLc, renewalBody, requestBody, stepBody, trialBody } from './billsTestkit';

/**
 * B4 pure engine: the lifecycle records, what they mean, and the rules that keep the owner in charge. Invented data only. Dates are fixed so nothing depends on the clock.
 */
const TODAY = '2026-11-20';
const base = { prices: [{ from: '2026-01-01', cents: 999, label: '' }], trackingSince: '2026-01-01', schedule: monthly(5, '2026-01'), amountKind: 'fixed' as const };

describe('B4 reader: defensive and lossless', () => {
  it('a record type this version does not know is kept, listed and never counted', () => {
    const r = rawLc(10, { obligationId: 1, fact: 'cancel-lawsuit', note: 'x' });
    expect(r.body).toBeNull();
    expect(r.problem).toMatch(/not one this version/);
    const v = lcView([r]);
    expect(v.unreadable).toHaveLength(1);
    expect(v.conflicts.map((c) => c.kind)).toEqual(['unreadable']);
    expect(v.cutoffOn).toBeNull();
  });

  it('damaged fields make a record unreadable instead of throwing or guessing', () => {
    for (const data of [
      { obligationId: 1, fact: 'cancel-confirm', confirmedOn: '2026-13-45', effectiveOn: '2026-12-31' },
      { obligationId: 1, fact: 'price-step', from: '2026-12-01', cents: -5 },
      { obligationId: 1, fact: 'price-step', from: '2026-12-01', cents: 1.5 },
      { obligationId: 'one', fact: 'trial', endsOn: '2026-12-01' },
      { obligationId: 1, fact: 'trial', endsOn: '2026-12-01', replaces: 'x' },
      { obligationId: 1, fact: 'renewal', renewalDate: '2027-01-01', noticeDays: 999 },
    ]) expect(rawLc(11, data as never).body, JSON.stringify(data)).toBeNull();
  });

  it('unknown extra fields are kept in the raw record', () => {
    const r = rawLc(12, { obligationId: 1, fact: 'cancel-request', requestedOn: '2026-11-01', futureField: { a: 1 } });
    expect(r.body?.fact).toBe('cancel-request');
    expect(r.raw.futureField).toEqual({ a: 1 });
  });

  it('an absent price amount is UNKNOWN and is never zero; zero is a confirmed free price', () => {
    const unknown = lcRec(10, 1, stepBody('2026-12-01', null));
    expect(unknown.body && unknown.body.fact === 'price-step' && unknown.body.cents).toBeNull();
    const zero = lcRec(11, 1, stepBody('2026-12-01', 0));
    expect(zero.body && zero.body.fact === 'price-step' && zero.body.cents).toBe(0);
    expect(validateLc({ ...(stepBody('2026-12-01', null) as Extract<LcBody, { fact: 'price-step' }>), status: 'fixed' })).toMatch(/unknown price is never treated as zero/);
    expect(validateLc(stepBody('2026-12-01', 0))).toBeNull();
    expect(lcFields(stepBody('2026-12-01', 0))).toHaveProperty('cents', 0);
    expect(lcFields(stepBody('2026-12-01', null))).not.toHaveProperty('cents');
  });

  it('writes round-trip through the stored form', () => {
    const bodies: LcBody[] = [trialBody('2026-12-01', { startsOn: '2026-11-17', convertsToCents: 1499, mustCancel: true, noticeBy: '2026-11-29', note: 'n' }), renewalBody('2027-04-15', { noticeDays: 30, auto: false }), confirmBody('2026-12-31', '2026-11-20', { finalCharge: 'expected', finalChargeCents: 500, accessUntil: '2026-12-31' }), requestBody('2026-11-10', { requestedEffectiveOn: '2026-12-01', ref: 'REF-1' })];
    for (const b of bodies) expect(lcRec(10, 1, b).body).toEqual(b);
  });

  it('validation refuses impossible records in plain words', () => {
    expect(validateLc(trialBody('2026-12-01', { startsOn: '2026-12-05' }))).toMatch(/ends before it starts/);
    expect(validateLc(renewalBody('2027-01-01', { noticeByDate: '2027-02-01' }))).toMatch(/after the renewal date/);
    expect(validateLc(requestBody('2026-11-01', { ref: 'x'.repeat(41) }))).toMatch(/at most 40 characters/);
    expect(validateLc(confirmBody('2026-12-31', '2026-11-20', { finalCharge: 'expected' }))).toMatch(/expected final charge/);
    expect(validateLc(stepBody('2026-12-01', 500, { until: '2026-11-01' }))).toMatch(/ends before it starts/);
  });
});

describe('B4 replacing and the effective set', () => {
  it('a later record that replaces an earlier one makes the earlier one history, still listed', () => {
    const v = lcView([lcRec(10, 1, trialBody('2026-11-24')), lcRec(20, 1, { fact: 'trial-extend', endsOn: '2026-12-08', note: '' }, { replaces: [10] })]);
    expect(v.trial.endsOn).toBe('2026-12-08');
    expect(v.replaced.get(10)).toBe(20);
    expect(v.records.map((r) => r.id).sort()).toEqual([10, 20]);
    expect(v.conflicts).toEqual([]);
  });

  it('a "replacement" with an EARLIER id does not count, so two records can never replace each other and nothing vanishes', () => {
    const v = lcView([lcRec(10, 1, trialBody('2026-11-24')), lcRec(5, 1, { fact: 'trial-extend', endsOn: '2026-12-08', note: '' }, { replaces: [10] })]);
    expect(v.replaced.size).toBe(0);
    expect(v.conflicts.map((c) => c.kind)).toEqual(['trial-ends']);
    const loop = lcView([lcRec(10, 1, renewalBody('2027-01-01'), { replaces: [20] }), lcRec(20, 1, renewalBody('2027-02-01'), { replaces: [10] })]);
    expect(loop.effective.map((r) => r.id)).toEqual([20]); // only the later one replaces; the other stays effective
  });

  it('the same date recorded twice is one value, not a conflict', () => {
    const v = lcView([lcRec(10, 1, renewalBody('2027-04-15')), lcRec(11, 1, renewalBody('2027-04-15'))]);
    expect(v.conflicts).toEqual([]);
    expect(v.renewal.fact?.body.renewalDate).toBe('2027-04-15');
  });
});

describe('B4 price history', () => {
  const prices = base.prices;
  const amt = (v: ReturnType<typeof lcView>, date: string) => expectedAmountOn({ amountKind: 'fixed', prices, lc: v }, date);

  it('a single future price change leaves the past alone and changes the future', () => {
    const v = lcView([lcRec(10, 1, stepBody('2027-01-01', 1299))], prices);
    expect(amt(v, '2026-12-05').cents).toBe(999);
    expect(amt(v, '2027-01-05').cents).toBe(1299);
    expect(nextPriceChange(v, TODAY)).toMatchObject({ from: '2027-01-01', cents: 1299 });
  });

  it('several future steps apply in date order whatever order they were recorded in', () => {
    const v = lcView([lcRec(11, 1, stepBody('2027-07-01', 1599)), lcRec(10, 1, stepBody('2027-01-01', 1299))], prices);
    expect([amt(v, '2026-12-31').cents, amt(v, '2027-03-01').cents, amt(v, '2027-08-01').cents]).toEqual([999, 1299, 1599]);
  });

  it('an introductory price, then the standard price (no gap when the next starts the day after)', () => {
    const v = lcView([lcRec(10, 1, stepBody('2026-12-01', 500, { until: '2027-02-28', label: 'intro' })), lcRec(11, 1, stepBody('2027-03-01', 2000))], prices);
    expect([amt(v, '2026-12-15').cents, amt(v, '2027-03-15').cents]).toEqual([500, 2000]);
    expect(v.priceRows.some((r) => r.origin === 'gap')).toBe(false);
  });

  it('after an explicit end date with nothing following, the price is UNKNOWN (not carried forward, not zero)', () => {
    const v = lcView([lcRec(10, 1, stepBody('2026-12-01', 500, { until: '2027-02-28' }))], prices);
    expect(amt(v, '2027-02-20').cents).toBe(500);
    expect(amt(v, '2027-03-05').cents).toBeNull();
  });

  it('a free trial is a confirmed zero; a missing price after it is unknown, never zero', () => {
    const v = lcView([lcRec(10, 1, stepBody('2026-11-17', 0, { until: '2026-12-01', label: 'free trial' })), lcRec(11, 1, stepBody('2026-12-02', null))], prices);
    expect(amt(v, '2026-11-25')).toEqual({ cents: 0, basis: 'fixed' });
    expect(amt(v, '2026-12-10').cents).toBeNull();
  });

  it('an estimated step reads as an estimate on a fixed bill', () => {
    const v = lcView([lcRec(10, 1, stepBody('2027-01-01', 1300, { status: 'estimated' }))], prices);
    expect(amt(v, '2027-02-01')).toEqual({ cents: 1300, basis: 'variable' });
  });

  it('two different prices from the SAME day are never silently chosen: the day reads unknown and a review item is raised', () => {
    const v = lcView([lcRec(10, 1, stepBody('2027-01-01', 1299)), lcRec(11, 1, stepBody('2027-01-01', 1399))], prices);
    expect(v.conflicts.map((c) => c.kind)).toEqual(['price-same-date']);
    expect(amt(v, '2027-02-01').cents).toBeNull();
    expect(amt(v, '2026-12-01').cents).toBe(999);
    expect(v.priceRows.filter((r) => r.recordId !== null)).toHaveLength(2); // both stay visible
  });

  it('a recorded step that disagrees with the first price on the same day is a conflict too', () => {
    const v = lcView([lcRec(10, 1, stepBody('2026-01-01', 1111))], prices);
    expect(v.conflicts.map((c) => c.kind)).toEqual(['price-same-date']);
    expect(amt(v, '2026-06-01').cents).toBeNull();
  });

  it('a later step that starts INSIDE an earlier step\'s explicit range reads unknown until the owner chooses', () => {
    const v = lcView([lcRec(10, 1, stepBody('2026-12-01', 500, { until: '2027-02-28' })), lcRec(11, 1, stepBody('2027-01-15', 900))], prices);
    expect(v.conflicts.map((c) => c.kind)).toEqual(['price-overlap']);
    expect(amt(v, '2026-12-20').cents).toBe(500);
    expect(amt(v, '2027-02-01').cents).toBeNull();
  });

  it('a price that takes effect in a short month applies to the first bill dated on or after it, not before', () => {
    const ob = obWith(1, [lcRec(10, 1, stepBody('2027-02-15', 1200))], { ...base, schedule: monthly(31, '2026-01') });
    const dates = expectedDates(scheduleSource(ob.data), '2027-01-01', '2027-03-31');
    expect(dates.map((d) => d.nominal)).toEqual(['2027-01-31', '2027-02-28', '2027-03-31']);
    expect(dates.map((d) => expectedAmountOn(ob.data, d.nominal).cents)).toEqual([999, 1200, 1200]);
  });

  it('a bill with no lifecycle records is untouched: the view is absent and the first price is used', () => {
    const ob = obWith(1, [], base);
    expect(ob.data.lc).toBeUndefined();
    expect(expectedAmountOn(ob.data, '2026-12-05').cents).toBe(999);
  });
});

describe('B4 deadlines in force', () => {
  const t = readTerms({ trialEndsOn: '2026-12-01', noticeByDate: '2027-02-13', renewalDate: '2027-03-15' });

  it('with no lifecycle records this is exactly the B2 list (renewals informational)', () => {
    expect(effectiveDeadlines(t, EMPTY_VIEW, TODAY).map((d) => [d.kind, d.date, d.action])).toEqual([['trial', '2026-12-01', true], ['notice', '2027-02-13', true], ['renewal', '2027-03-15', false]]);
  });

  it('a trial that ends on the cancel-by day is ONE action, not two Tasks', () => {
    const same = readTerms({ trialEndsOn: '2026-12-01', noticeByDate: '2026-12-01' });
    expect(effectiveDeadlines(same, EMPTY_VIEW, TODAY).map((d) => d.kind)).toEqual(['trial']);
  });

  it('a recorded must-cancel-by date makes the cancel-by the action and the trial end informational', () => {
    const v = lcView([lcRec(10, 1, trialBody('2026-12-01', { mustCancel: true, noticeBy: '2026-11-28' }))]);
    const dl = effectiveDeadlines(blankTerms(), v, TODAY);
    expect(dl.map((d) => [d.kind, d.date, d.action])).toEqual([['notice', '2026-11-28', true], ['trial', '2026-12-01', false]]);
  });

  it('a recorded trial extension replaces the contract-date trial end, and the earlier B2 date is not used', () => {
    const v = lcView([lcRec(10, 1, trialBody('2026-12-08'))]);
    expect(effectiveDeadlines(t, v, TODAY).find((d) => d.kind === 'trial')?.date).toBe('2026-12-08');
  });

  it('an extension keeps the trial\'s details for display but drops a cancel-by date that belonged to the ORIGINAL end', () => {
    const v = lcView([lcRec(10, 1, trialBody('2026-12-01', { mustCancel: true, noticeBy: '2026-11-28', convertsToCents: 1499, paymentOnFile: 'yes' })), lcRec(20, 1, { fact: 'trial-extend', endsOn: '2026-12-15', note: '' }, { replaces: [10] })]);
    expect(v.trial.endsOn).toBe('2026-12-15');
    expect(v.trial.fact?.body).toMatchObject({ convertsToCents: 1499, paymentOnFile: 'yes' }); // details still shown
    expect(effectiveDeadlines(blankTerms(), v, TODAY).map((d) => [d.kind, d.date, d.action])).toEqual([['trial', '2026-12-15', true]]); // the old 11-28 cancel-by is not carried over
  });

  it('an outcome recorded for the trial removes the trial deadline (it no longer needs a reminder)', () => {
    const v = lcView([lcRec(10, 1, trialBody('2026-12-01')), lcRec(11, 1, { fact: 'trial-outcome', outcome: 'converted', on: '2026-12-02', note: '' })]);
    expect(effectiveDeadlines(t, v, TODAY).some((d) => d.kind === 'trial')).toBe(false);
  });

  it('two different renewal dates are NOT used: the earlier contract date stays', () => {
    const v = lcView([lcRec(10, 1, renewalBody('2027-04-15')), lcRec(11, 1, renewalBody('2027-05-01'))]);
    expect(v.conflicts.map((c) => c.kind)).toEqual(['renewal-dates']);
    expect(effectiveDeadlines(t, v, TODAY).find((d) => d.kind === 'renewal')?.date).toBe('2027-03-15');
  });

  it('a renewal you must make yourself wants a Task; an automatic one does not; notice days fill the cancel-by date', () => {
    const manual = lcView([lcRec(10, 1, renewalBody('2027-04-15', { auto: false, noticeDays: 30 }))]);
    const dl = effectiveDeadlines(blankTerms(), manual, TODAY);
    expect(dl.map((d) => [d.kind, d.date, d.action])).toEqual([['notice', '2027-03-16', true], ['renewal', '2027-04-15', true]]);
    const auto = lcView([lcRec(10, 1, renewalBody('2027-04-15', { auto: true }))]);
    expect(effectiveDeadlines(blankTerms(), auto, TODAY).find((d) => d.kind === 'renewal')?.action).toBe(false);
  });

  it('a date after the confirmed cancellation is dropped; an unconfirmed renewal is marked as an estimate', () => {
    const v = lcView([lcRec(10, 1, renewalBody('2027-04-15', { confirmed: false })), lcRec(11, 1, confirmBody('2026-12-31'))]);
    expect(effectiveDeadlines(blankTerms(), v, TODAY)).toEqual([]);
    const w = lcView([lcRec(10, 1, renewalBody('2027-04-15', { confirmed: false }))]);
    expect(effectiveDeadlines(blankTerms(), w, TODAY)[0].estimated).toBe(true);
  });
});

describe('B4 renewals worked out on demand', () => {
  it('annual: the recorded date, then every year, inside the window only', () => {
    const v = lcView([lcRec(10, 1, renewalBody('2026-04-15'))]);
    expect(renewalDates(v, '2026-01-01', '2029-01-01')).toEqual(['2026-04-15', '2027-04-15', '2028-04-15']);
    expect(renewalDates(v, TODAY, addMonths(TODAY, 12))).toEqual(['2027-04-15']); // the rolling 12 months
  });
  it('monthly clamps to short months without drifting (31st: Feb 28, then Mar 31 again)', () => {
    const v = lcView([lcRec(10, 1, renewalBody('2026-01-31', { cadence: 'monthly' }))]);
    expect(renewalDates(v, '2026-01-01', '2026-04-30')).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
  });
  it('an unknown cadence gives only the recorded date; nothing repeats', () => {
    const v = lcView([lcRec(10, 1, renewalBody('2026-04-15', { cadence: 'unknown' }))]);
    expect(renewalDates(v, '2026-01-01', '2030-01-01')).toEqual(['2026-04-15']);
  });
  it('a confirmed cancellation stops the series', () => {
    const v = lcView([lcRec(10, 1, renewalBody('2026-04-15', { cadence: 'monthly' })), lcRec(11, 1, confirmBody('2026-07-01'))]);
    expect(renewalDates(v, '2026-01-01', '2026-12-31').at(-1)).toBe('2026-06-15');
  });
  it('it is bounded: a very long window cannot loop without end', () => {
    const v = lcView([lcRec(10, 1, renewalBody('2026-01-01', { cadence: 'weekly' }))]);
    expect(renewalDates(v, '2026-01-01', '9999-12-31').length).toBeLessThanOrEqual(400);
  });
});

describe('B4 cancellation: request, confirmation, effective date', () => {
  const states = (rs: ReturnType<typeof lcRec>[], today = TODAY, status: 'active' | 'ended' = 'active', endedOn: string | null = null) => lifecycleStates(lcView(rs), blankTerms(), { status, endedOn }, today).map((s) => s.id);

  it('a request alone is NOT a confirmation: it stays active, expected bills continue, wording says confirmation is pending', () => {
    const v = lcView([lcRec(10, 1, requestBody('2026-11-10'))]);
    expect(v.cutoffOn).toBeNull();
    const s = lifecycleStates(v, blankTerms(), { status: 'active', endedOn: null }, TODAY);
    expect(s[0]).toMatchObject({ id: 'cancel-requested', label: 'Cancellation requested, confirmation pending' });
    const ob = obWith(1, [lcRec(10, 1, requestBody('2026-11-10'))], base);
    expect(expectedDates(scheduleSource(ob.data), '2027-01-01', '2027-03-31').length).toBe(3);
  });

  it('a confirmation with a FUTURE effective date: confirmed, not ended; expected bills stop after that day, not before', () => {
    const rs = [lcRec(10, 1, requestBody('2026-11-10')), lcRec(11, 1, confirmBody('2026-12-31', '2026-11-15'))];
    expect(states(rs)).toEqual(['cancel-confirmed']);
    const ob = obWith(1, rs, base);
    expect(ob.data.status).toBe('active'); // Ledger changed no status
    expect(expectedDates(scheduleSource(ob.data), '2026-11-01', '2027-06-30').map((e) => e.nominal)).toEqual(['2026-11-05', '2026-12-05']);
    const onTheDay = obWith(1, [lcRec(11, 1, confirmBody('2026-12-05'))], base);
    expect(expectedDates(scheduleSource(onTheDay.data), '2026-11-01', '2027-06-30').map((e) => e.nominal)).toEqual(['2026-11-05', '2026-12-05']); // the effective day itself is still covered
  });

  it('the effective date, not the confirmation date, decides: confirmed Jan 8, effective Jan 31 does not imply access ended Jan 8', () => {
    const v = lcView([lcRec(10, 1, requestBody('2027-01-05')), lcRec(11, 1, confirmBody('2027-01-31', '2027-01-08'))]);
    expect(lifecycleStates(v, blankTerms(), { status: 'active', endedOn: null }, '2027-01-10')[0].label).toBe('Cancellation confirmed, effective 2027-01-31');
    expect(lifecycleStates(v, blankTerms(), { status: 'active', endedOn: null }, '2027-02-01')[0].id).toBe('cancel-effective');
  });

  it('a confirmation with no earlier request is fine; an immediate cancellation is effective the same day', () => {
    expect(states([lcRec(10, 1, confirmBody('2026-11-20'))])).toEqual(['cancel-effective']);
  });

  it('when the effective date has arrived nothing is ended FOR the owner: the stored status is untouched and the state says so', () => {
    const rs = [lcRec(10, 1, confirmBody('2026-11-01', '2026-10-20'))];
    const ob = obWith(1, rs, base);
    expect(ob.data.status).toBe('active');
    const [s] = lifecycleStates(ob.data.lc!, blankTerms(), { status: 'active', endedOn: null }, TODAY);
    expect(s.detail).toMatch(/Nothing was ended for you/);
  });

  it('a withdrawal negates what it targets: the cancellation is history, billing carries on', () => {
    const rs = [lcRec(10, 1, requestBody('2026-11-10')), lcRec(11, 1, confirmBody('2026-12-31')), lcRec(12, 1, { fact: 'cancel-withdraw', on: '2026-11-18', kind: 'provider-withdrew', note: '' }, { targets: [10, 11], seen: [10, 11] })];
    const v = lcView(rs);
    expect(v.cutoffOn).toBeNull();
    expect(v.cancel.confirm).toBeNull();
    expect(v.conflicts).toEqual([]);
    expect(states(rs)).toEqual([]);
    const tl = timeline(v, [], (c) => `$${c}`, TODAY);
    expect(tl.filter((e) => e.muted).map((e) => e.text).join('|')).toMatch(/withdrawn/); // still visible, marked
  });

  it('a later confirmation after a withdrawal the device had seen is in force again', () => {
    const rs = [lcRec(10, 1, confirmBody('2026-12-31')), lcRec(11, 1, { fact: 'cancel-withdraw', on: '2026-11-18', kind: 'owner-retracted', note: '' }, { targets: [10], seen: [10] }), lcRec(12, 1, confirmBody('2027-01-31'), { seen: [10, 11] })];
    expect(lcView(rs).cutoffOn).toBe('2027-01-31');
  });

  it('reactivation negates a past cancellation', () => {
    const rs = [lcRec(10, 1, confirmBody('2026-06-30')), lcRec(11, 1, { fact: 'reactivate', on: '2026-09-01', note: '' }, { targets: [10], seen: [10] })];
    expect(lcView(rs).cutoffOn).toBeNull();
  });

  it('TWO confirmations with different effective dates are a conflict: neither date is used and expected bills keep running', () => {
    const rs = [lcRec(10, 1, confirmBody('2026-12-31')), lcRec(11, 1, confirmBody('2027-01-31'))];
    const v = lcView(rs);
    expect(v.conflicts.map((c) => c.kind)).toEqual(['confirm-dates']);
    expect(v.cutoffOn).toBeNull();
    expect(states(rs)[0]).toBe('review');
    const ob = obWith(1, rs, base);
    expect(expectedDates(scheduleSource(ob.data), '2027-02-01', '2027-03-31').length).toBe(2);
    expect(v.records).toHaveLength(2); // both stay visible
  });

  it('two confirmations that agree on the effective date count once and raise nothing', () => {
    const v = lcView([lcRec(10, 1, confirmBody('2026-12-31', '2026-11-15')), lcRec(11, 1, confirmBody('2026-12-31', '2026-11-16'))]);
    expect(v.conflicts).toEqual([]);
    expect(v.cutoffOn).toBe('2026-12-31');
  });

  it('a withdrawal and a confirmation written by devices that did NOT see each other disagree: the cancellation is not treated as confirmed', () => {
    const rs = [lcRec(10, 1, requestBody('2026-11-10')), lcRec(11, 1, { fact: 'cancel-withdraw', on: '2026-11-18', kind: 'owner-retracted', note: '' }, { targets: [10], seen: [10] }), lcRec(12, 1, confirmBody('2026-12-31'), { seen: [10] })];
    const v = lcView(rs);
    expect(v.conflicts.map((c) => c.kind)).toEqual(['withdraw-vs-evidence']);
    expect(v.cutoffOn).toBeNull();
  });

  it('a provider that changes the effective date is a correction (replaces), not a conflict', () => {
    const v = lcView([lcRec(10, 1, confirmBody('2026-12-31')), lcRec(11, 1, confirmBody('2027-01-15'), { replaces: [10], seen: [10] })]);
    expect(v.conflicts).toEqual([]);
    expect(v.cutoffOn).toBe('2027-01-15');
  });

  it('an owner-ended bill is Ended; a plan alone is only a plan', () => {
    expect(states([], TODAY, 'ended', '2026-11-01')).toEqual(['ended']);
    expect(states([lcRec(10, 1, { fact: 'cancel-plan', plannedOn: null, note: '' })])).toEqual(['cancel-planned']);
  });

  it('an acknowledged disagreement stops raising the item but still shows as unresolved; new evidence changes the key', () => {
    const rs = [lcRec(10, 1, confirmBody('2026-12-31')), lcRec(11, 1, confirmBody('2027-01-31'))];
    const key = lcView(rs).conflicts[0].key;
    const acked = lcView([...rs, lcRec(12, 1, { fact: 'ack', key, on: TODAY })]);
    expect(acked.conflicts[0].acknowledged).toBe(true);
    expect(acked.cutoffOn).toBeNull(); // leaving it as is does not pick a date
    const more = lcView([...rs, lcRec(12, 1, { fact: 'ack', key, on: TODAY }), lcRec(13, 1, confirmBody('2027-03-01'))]);
    expect(more.conflicts[0].acknowledged).toBe(false);
  });
});

describe('B4 trial and renewal states never assume what happened', () => {
  it('in trial, then "ended: conversion not confirmed" once the date passes; never "converted"', () => {
    const v = lcView([lcRec(10, 1, trialBody('2026-11-24'))]);
    const t = (today: string) => lifecycleStates(v, blankTerms(), { status: 'active', endedOn: null }, today).map((s) => s.id);
    expect(t('2026-11-20')).toEqual(['trial']);
    expect(t('2026-11-26')).toEqual(['trial-check']);
    expect(lifecycleStates(v, blankTerms(), { status: 'active', endedOn: null }, '2026-11-26')[0].label).toMatch(/conversion not confirmed/);
  });
  it('recording the outcome clears the check; leaving it as is clears it without recording anything', () => {
    const o = lcView([lcRec(10, 1, trialBody('2026-11-24')), lcRec(11, 1, { fact: 'trial-outcome', outcome: 'ended-no-charge', on: '2026-11-25', note: '' })]);
    expect(lifecycleStates(o, blankTerms(), { status: 'active', endedOn: null }, '2026-11-26')).toEqual([]);
    const a = lcView([lcRec(10, 1, trialBody('2026-11-24')), lcRec(11, 1, { fact: 'ack', key: 'trial|2026-11-24', on: '2026-11-26' })]);
    expect(lifecycleStates(a, blankTerms(), { status: 'active', endedOn: null }, '2026-11-26')).toEqual([]);
  });
  it('a renewal date that passed reads "not confirmed", never "renewed"; recording what happened or leaving it clears it', () => {
    const v = lcView([lcRec(10, 1, renewalBody('2026-11-01'))]);
    const [s] = lifecycleStates(v, blankTerms(), { status: 'active', endedOn: null }, TODAY);
    expect(s).toMatchObject({ id: 'renewal-check' });
    expect(s.label).toMatch(/not confirmed/);
    expect(s.detail).toMatch(/did not renew anything/);
    const done = lcView([lcRec(10, 1, renewalBody('2026-11-01')), lcRec(11, 1, { fact: 'renewal-outcome', forDate: '2026-11-01', outcome: 'renewed', on: '2026-11-02', note: '' })]);
    expect(lifecycleStates(done, blankTerms(), { status: 'active', endedOn: null }, TODAY)).toEqual([]);
    const left = lcView([lcRec(10, 1, renewalBody('2026-11-01')), lcRec(11, 1, { fact: 'ack', key: ackKeyRenewal('2026-11-01'), on: TODAY })]);
    expect(lifecycleStates(left, blankTerms(), { status: 'active', endedOn: null }, TODAY)).toEqual([]);
  });
  it('several states can hold at once: active with a cancellation pending and a renewal approaching', () => {
    const v = lcView([lcRec(10, 1, requestBody('2026-11-10')), lcRec(11, 1, renewalBody('2026-12-05'))]);
    expect(lifecycleStates(v, blankTerms(), { status: 'active', endedOn: null }, TODAY).map((s) => s.id)).toEqual(['cancel-requested', 'renewal-soon']);
  });
});

describe('B4 timeline: only what was recorded, with the future clearly labelled', () => {
  it('lists recorded facts and labels dates still ahead as expected; invents nothing', () => {
    const v = lcView([lcRec(10, 1, trialBody('2026-12-01', { startsOn: '2026-11-17' })), lcRec(11, 1, stepBody('2027-01-01', 1299)), lcRec(12, 1, requestBody('2026-11-18')), lcRec(13, 1, confirmBody('2026-12-31', '2026-11-19'))], base.prices);
    const tl = timeline(v, [{ on: '2026-11-05', kind: 'paused', note: '' }], (c) => `<${c}>`, TODAY);
    expect(tl.map((e) => `${e.date} ${e.kind} ${e.text}`)).toEqual([
      '2026-11-05 log paused',
      '2026-11-17 recorded Trial started',
      '2026-11-18 recorded Cancellation requested',
      '2026-11-19 recorded Cancellation confirmed',
      '2026-12-01 expected Trial ends (date you recorded)',
      '2026-12-31 expected Cancellation effective (confirmed date)',
      '2027-01-01 expected Price <1299> from this day',
    ]);
  });
  it('a replaced record stays in the timeline, marked, and a price shows through the masking function', () => {
    const v = lcView([lcRec(10, 1, stepBody('2026-12-01', 500)), lcRec(11, 1, stepBody('2026-12-01', 600), { replaces: [10] })]);
    const tl = timeline(v, [], () => '$••••', TODAY);
    expect(tl).toHaveLength(2);
    expect(tl.filter((e) => e.muted)).toHaveLength(1);
    expect(tl.every((e) => !/\d{3}/.test(e.text.replace(/2026-12-01/, '')))).toBe(true);
  });
});

describe('B4 possible charges after a cancellation (a nudge, never a verdict)', () => {
  const T = '2026-08-01';
  const ob = obWith(1, [lcRec(10, 1, confirmBody('2026-06-30', '2026-06-10'))], { title: 'Streamly Premium', providerNameSnapshot: 'Streamly', type: 'subscription', ...base, schedule: monthly(15, '2026-01') });
  let nid = 100;
  const tx = (date: string, cents: number, over: Partial<Txn> = {}): Txn => ({ id: nid++, accountId: 1, date, amountCents: cents, payee: 'STREAMLY PREMIUM 8841', memo: '', status: 'cleared', categoryId: 5, ...over });
  const run = (txns: Txn[], o = ob, cycles: ReturnType<typeof fact>[] = [], others = [ob]) => chargesAfterCancellation({ obligation: o, obligations: others, cycles, transactions: txns, today: T })!;

  it('a matching charge AFTER the effective date is listed and counted; one BEFORE it is not', () => {
    const r = run([tx('2026-07-15', -1499), tx('2026-06-15', -1499), tx('2026-06-30', -1499)]);
    expect(r.counted.map((c) => c.date)).toEqual(['2026-07-15']);
    expect(r.effectiveOn).toBe('2026-06-30');
  });

  it('no cancellation date, or one not yet reached, gives nothing to check', () => {
    expect(chargesAfterCancellation({ obligation: obWith(1, [], base), obligations: [], cycles: [], transactions: [tx('2026-07-15', -1499)], today: T })).toBeNull();
    expect(chargesAfterCancellation({ obligation: ob, obligations: [ob], cycles: [], transactions: [], today: '2026-06-20' })).toBeNull();
  });

  it('a pending charge is flagged as maybe not final and still shown', () => {
    const r = run([tx('2026-07-15', -1499, { status: 'pending' })]);
    expect(r.counted[0].notes.join(' ')).toMatch(/Pending/);
  });

  it('money coming back from the same payee offsets a charge it covers (still listed, not counted)', () => {
    const r = run([tx('2026-07-15', -1499), tx('2026-07-20', 1499)]);
    expect(r.counted).toEqual([]);
    expect(r.charges).toHaveLength(1);
    expect(r.refunds).toHaveLength(1);
    expect(r.charges[0].offsetBy).toBe(r.refunds[0].key);
  });

  it('a smaller refund does not offset a larger charge', () => {
    expect(run([tx('2026-07-15', -1499), tx('2026-07-20', 500)]).counted).toHaveLength(1);
  });

  it('a final charge the owner said to expect, up to the amount they recorded, is not counted; more than that is', () => {
    const o = obWith(1, [lcRec(10, 1, confirmBody('2026-06-30', '2026-06-10', { finalCharge: 'expected', finalChargeCents: 1499 }))], { title: 'Streamly Premium', providerNameSnapshot: 'Streamly', ...base });
    const r = run([tx('2026-07-05', -1499), tx('2026-07-15', -2999)], o, [], [o]);
    expect(r.charges.find((c) => c.date === '2026-07-05')?.expectedFinal).toBe(true);
    expect(r.counted.map((c) => c.date)).toEqual(['2026-07-15']);
  });

  it('a weak resemblance (a different provider that shares one word) is listed apart and never counted', () => {
    const o = obWith(1, [lcRec(10, 1, confirmBody('2026-06-30'))], { title: 'Example Power Co', providerNameSnapshot: 'Example Power Co', ...base });
    const r = run([tx('2026-07-15', -1499, { payee: 'Example Gas Co' }), tx('2026-07-16', -999, { payee: 'Another Streaming Co' })], o, [], [o]);
    expect(r.counted).toEqual([]);
    expect(r.weaker.map((w) => w.txn.payee)).toEqual(['Example Gas Co']);
  });

  it('a transaction the owner already linked to ANOTHER bill belongs there; one linked to THIS bill is still listed and counted', () => {
    const other = obWith(2, [], { title: 'Streamly Kids', ...base });
    const t1 = tx('2026-07-15', -1499), t2 = tx('2026-07-16', -1499);
    const cycles = [fact(2, 'm2026-07', { fact: 'payment-link', ref: makeTxnRef(t1) }, 50), fact(1, 'm2026-07', { fact: 'payment-link', ref: makeTxnRef(t2) }, 51)];
    const r = run([t1, t2], ob, cycles, [ob, other]);
    expect(r.counted.map((c) => c.date)).toEqual(['2026-07-16']);
    expect(r.counted[0].linkedSlot).toBe('m2026-07');
    expect(r.charges.find((c) => c.date === '2026-07-15')?.notes.join(' ')).toMatch(/Streamly Kids/);
  });

  it('a money-IN row or a transfer is never a charge; an owner-ended-as-cancelled bill is checked from its end date', () => {
    expect(run([tx('2026-07-15', -1499, { transferTxnId: 9 })]).counted).toEqual([]);
    const ended = obWith(1, [], { title: 'Streamly Premium', providerNameSnapshot: 'Streamly', ...base, status: 'ended', endedOn: '2026-06-30', endReason: 'cancelled' });
    expect(run([tx('2026-07-15', -1499)], ended, [], [ended]).counted).toHaveLength(1);
    const other = obWith(1, [], { title: 'Streamly Premium', providerNameSnapshot: 'Streamly', ...base, status: 'ended', endedOn: '2026-06-30', endReason: 'replaced' });
    expect(chargesAfterCancellation({ obligation: other, obligations: [other], cycles: [], transactions: [tx('2026-07-15', -1499)], today: T })).toBeNull();
  });

  it('acknowledged evidence stays quiet until the set of charges changes (a materially different key)', () => {
    const first = run([tx('2026-07-15', -1499)]);
    const acked = obWith(1, [lcRec(10, 1, confirmBody('2026-06-30', '2026-06-10')), lcRec(11, 1, { fact: 'ack', key: first.evidenceKey, on: T })], { title: 'Streamly Premium', providerNameSnapshot: 'Streamly', ...base });
    const same = chargesAfterCancellation({ obligation: acked, obligations: [acked], cycles: [], transactions: [tx('2026-07-15', -1499)], today: T })!;
    expect(same.evidenceKey).not.toBe(''); // sanity
    const t = tx('2026-07-15', -1499);
    const a1 = chargesAfterCancellation({ obligation: obWith(1, [lcRec(10, 1, confirmBody('2026-06-30')), lcRec(11, 1, { fact: 'ack', key: chargesAfterCancellation({ obligation: ob, obligations: [ob], cycles: [], transactions: [t], today: T })!.evidenceKey, on: T })], { title: 'Streamly Premium', providerNameSnapshot: 'Streamly', ...base }), obligations: [], cycles: [], transactions: [t], today: T })!;
    expect(a1.acknowledged).toBe(true);
    const more = chargesAfterCancellation({ obligation: obWith(1, [lcRec(10, 1, confirmBody('2026-06-30')), lcRec(11, 1, { fact: 'ack', key: a1.evidenceKey, on: T })], { title: 'Streamly Premium', providerNameSnapshot: 'Streamly', ...base }), obligations: [], cycles: [], transactions: [t, tx('2026-07-25', -1499)], today: T })!;
    expect(more.acknowledged).toBe(false);
  });

  it('charges are only looked for in a bounded window after the cancellation', () => {
    expect(run([tx('2028-01-01', -1499)], ob, [], [ob]).counted).toEqual([]);
  });
});

describe('B4 the stored record is never altered by reading it', () => {
  it('reading and re-reading yields the same value (no hidden mutation)', () => {
    const r = lcRec(10, 1, confirmBody('2026-12-31'));
    expect(readLifecycle({ id: 10, module: 'bills', kind: LC_KIND, data: r.raw as never, createdAt: 10, updatedAt: 10, deletedAt: null } as never)).toEqual(r);
  });
});
