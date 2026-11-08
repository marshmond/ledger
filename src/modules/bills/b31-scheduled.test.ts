import { describe, expect, it } from 'vitest';
import type { RecurringLog, RecurringRule } from '../../types';
import { monthly, ob, obRec } from './billsTestkit';
import { billSeedFromRule, driftUnresolved, driftWords, frequencyOf, holdersOf, MAX_RULES_PER_BILL, nextRuleDate, ruleConflictKey, ruleKind, ruleLinkConflicts, ruleLinkProblem, scheduleDrift, scheduleFromRule, untrackedRules } from './scheduledLink';
import { scheduleProblem } from './schedule';

/**
 * B3.1 Finance Scheduled link: eligibility, two-device conflicts, drift notices and the rule-to-bill prefill. Pure. The rule rows here are invented;
 * nothing writes, so a rule is never changed by anything in this file.
 */
const TODAY = '2026-11-20';
const money = (c: number) => `$${(c / 100).toFixed(2)}`;
const rule = (over: Partial<RecurringRule> = {}): RecurringRule => ({ id: 7, accountId: 1, payee: 'Example Power Co', amountCents: -9000, categoryId: 5, memo: '', frequency: 'monthly', startDate: '2026-01-18', active: true, ...over });
const bill = (over = {}) => ob({ scheduledRuleIds: [7], ...over }); // monthly on the 18th, fixed $90.00, tracking since 2026-11-07
const drift = (b: ReturnType<typeof ob>, r: RecurringRule | undefined, log: RecurringLog[] = []) => scheduleDrift(b, r, log, TODAY);
const kinds = (n: ReturnType<typeof drift>) => n.map((x) => `${x.kind}:${x.level}`);

describe('B3.1 Scheduled link: which rules can be linked', () => {
  it('a Finance spending rule can be linked; income and transfers cannot', () => {
    expect(ruleKind(rule())).toBe('spending');
    expect(ruleKind(rule({ amountCents: 300000 }))).toBe('income');
    expect(ruleKind(rule({ transferAccountId: 9 }))).toBe('transfer');
    const ok = ruleLinkProblem({ ruleId: 7, rule: rule(), obligations: [], today: TODAY });
    expect(ok).toEqual({ problem: null, warnings: [] });
    expect(ruleLinkProblem({ ruleId: 7, rule: rule({ amountCents: 300000 }), obligations: [], today: TODAY }).problem).toMatch(/scheduled income/);
    expect(ruleLinkProblem({ ruleId: 7, rule: rule({ transferAccountId: 9 }), obligations: [], today: TODAY }).problem).toMatch(/between your own accounts/);
  });

  it('a missing or deleted rule cannot be linked, and the message does not say paid or unpaid', () => {
    const r = ruleLinkProblem({ ruleId: 7, rule: undefined, obligations: [], today: TODAY });
    expect(r.problem).toMatch(/not on this device, or it was deleted/);
    expect(r.problem).not.toMatch(/paid/i);
  });

  it('a rule another bill in force already holds cannot be linked, naming that bill; an ended bill does not hold it', () => {
    const holder = obRec(2, { title: 'Example Power Co', scheduledRuleIds: [7] });
    const refused = ruleLinkProblem({ ruleId: 7, rule: rule(), obligations: [holder], obligationId: 1, today: TODAY });
    expect(refused.problem).toMatch(/already linked to "Example Power Co"/);
    expect(holdersOf(7, [holder], 2)).toEqual([]); // the holder itself is excluded from "other holders"
    const ended = obRec(2, { title: 'Old bill', scheduledRuleIds: [7], status: 'ended', endedOn: '2026-10-01', endReason: 'cancelled', trackingSince: '2026-01-01' });
    expect(ruleLinkProblem({ ruleId: 7, rule: rule(), obligations: [ended], obligationId: 1, today: TODAY }).problem).toBeNull();
  });

  it('linking the same rule twice to one bill, or a sixth rule, is refused', () => {
    expect(ruleLinkProblem({ ruleId: 7, rule: rule(), obligations: [], alreadyLinked: [7], today: TODAY }).problem).toMatch(/already linked to this bill/);
    expect(ruleLinkProblem({ ruleId: 99, rule: rule({ id: 99 }), obligations: [], alreadyLinked: [1, 2, 3, 4, 5], today: TODAY }).problem).toMatch(new RegExp(`${MAX_RULES_PER_BILL} scheduled payments at most`));
  });

  it('an inactive or ended rule can be linked, with a plain warning (it is not an ineligible kind of rule)', () => {
    const off = ruleLinkProblem({ ruleId: 7, rule: rule({ active: false }), obligations: [], today: TODAY });
    expect(off.problem).toBeNull();
    expect(off.warnings[0]).toMatch(/switched off in Finance/);
    expect(ruleLinkProblem({ ruleId: 7, rule: rule({ endDate: '2026-06-01' }), obligations: [], today: TODAY }).warnings[0]).toMatch(/ended on 2026-06-01/);
  });
});

describe('B3.1 Scheduled link: two devices linked one rule to different bills', () => {
  it('both pointers are kept and the rule is reported as held by both, in a stable order, with a key that names exactly those bills', () => {
    const a = obRec(5, { title: 'Bill A', scheduledRuleIds: [7] }), b = obRec(2, { title: 'Bill B', scheduledRuleIds: [7, 8] }), c = obRec(3, { title: 'Bill C', scheduledRuleIds: [8] });
    const conflicts = ruleLinkConflicts([a, b, c]);
    expect(conflicts.map((x) => [x.ruleId, x.holders.map((h) => h.id)])).toEqual([[7, [2, 5]], [8, [2, 3]]]);
    expect(conflicts[0].key).toBe(ruleConflictKey(7, [5, 2]));
    expect(conflicts[0].key).toBe('rl|7|2,5');
    expect(a.data.scheduledRuleIds).toEqual([7]); // nothing was changed
  });

  it('one holder, or an ended holder, is not a conflict; a new holder is a new problem even after "leave as is"', () => {
    expect(ruleLinkConflicts([obRec(1, { scheduledRuleIds: [7] })])).toEqual([]);
    const ended = obRec(2, { scheduledRuleIds: [7], status: 'ended', endedOn: '2026-10-01', endReason: 'cancelled', trackingSince: '2026-01-01' });
    expect(ruleLinkConflicts([obRec(1, { scheduledRuleIds: [7] }), ended])).toEqual([]);
    const two = [obRec(1, { scheduledRuleIds: [7], acknowledged: ['rl|7|1,2'] }), obRec(2, { scheduledRuleIds: [7] })];
    expect(ruleLinkConflicts(two)[0].acknowledged).toBe(true);
    expect(ruleLinkConflicts([...two, obRec(3, { scheduledRuleIds: [7] })])[0].acknowledged).toBe(false);
  });
});

describe('B3.1 Scheduled link: drift is a calm, read-only notice', () => {
  it('a bill and a rule that agree produce no notice at all', () => {
    expect(drift(bill(), rule())).toEqual([]);
  });

  it('a deleted rule is "missing"; a switched-off or ended rule is "inactive"; the bill itself is never touched', () => {
    expect(kinds(drift(bill(), undefined))).toEqual(['missing:check']);
    expect(kinds(drift(bill(), rule({ active: false })))).toEqual(['inactive:check']);
    expect(kinds(drift(bill(), rule({ endDate: '2026-10-01' })))).toEqual(['inactive:check']);
    expect(kinds(drift(bill({ status: 'paused', pauses: [{ from: TODAY, to: null }] }), rule({ active: false })))).toEqual(['inactive:info']);
    expect(driftWords(drift(bill(), undefined)[0], money)).toMatch(/nothing is assumed paid or unpaid/);
  });

  it('an ended bill with a rule still active says so once; an ended bill with an inactive rule says nothing', () => {
    const ended = bill({ status: 'ended', endedOn: '2026-10-31', endReason: 'cancelled', trackingSince: '2026-01-01' });
    expect(kinds(drift(ended, rule()))).toEqual(['bill-ended:check']);
    expect(drift(ended, rule({ active: false }))).toEqual([]);
    expect(driftWords(drift(ended, rule())[0], money)).toMatch(/Ledger changes neither/);
  });

  it('a paused bill with an active rule is an explained difference, not a warning', () => {
    expect(kinds(drift(bill({ status: 'paused', pauses: [{ from: TODAY, to: null }] }), rule()))).toContain('bill-paused:info');
  });

  it('different cadences are reported: quarterly in Bills versus monthly in Finance; a bill with no schedule is only information', () => {
    const q = bill({ schedule: monthly(18, '2026-11', 3) });
    expect(kinds(drift(q, rule()))).toEqual(['cadence:check']);
    expect(driftWords(drift(q, rule())[0], money)).toBe('This bill is every 3 months, but its scheduled payment in Finance runs every month.');
    expect(kinds(drift(bill({ schedule: null }), rule()))).toEqual(['no-schedule:info']);
  });

  it('a schedule the owner changed, while Finance still runs the earlier pattern, says exactly that', () => {
    const changed = bill({ schedule: monthly(18, '2026-11', 3), scheduleHistory: [{ until: '2026-10-31', schedule: monthly(18, '2026-01', 1) }] });
    const n = drift(changed, rule());
    expect(n[0]).toMatchObject({ kind: 'schedule-history', level: 'check', on: '2026-10-31' });
    expect(driftWords(n[0], money)).toMatch(/You changed this bill to every 3 months from 2026-10-31/);
  });

  it('a fixed amount that differs is a "check"; the same amount is silent; a bill that varies only gets a calm note', () => {
    const n = drift(bill({ prices: [{ from: '2026-01-01', cents: 12000, label: '' }] }), rule({ amountCents: -11500 }));
    expect(kinds(n)).toEqual(['amount:check']);
    expect(driftWords(n[0], money)).toBe('This bill expects $120.00 each time, but Finance schedules $115.00.');
    expect(drift(bill(), rule())).toEqual([]);
    const v = drift(bill({ amountKind: 'variable', prices: [{ from: '2026-01-01', cents: 9000, label: '' }] }), rule({ amountCents: -9500 }));
    expect(kinds(v)).toEqual(['amount-varies:info']);
    expect(drift(bill({ amountKind: 'variable', prices: [{ from: '2026-01-01', cents: 9000, label: '' }] }), rule({ amountCents: -9000 }))).toEqual([]);
  });

  it('an introductory price is explained, not alarmed about: the rule already holds the price that starts later', () => {
    const intro = bill({ prices: [{ from: '2026-01-01', cents: 1500, label: 'introductory' }, { from: '2027-01-01', cents: 3000, label: '' }] });
    const n = drift(intro, rule({ amountCents: -3000 }));
    expect(kinds(n)).toEqual(['amount-later-price:info']);
    expect(driftWords(n[0], money)).toMatch(/price that starts here on 2027-01-01\. Until then this bill expects \$15\.00/);
    expect(driftUnresolved(n)).toBe(false);
  });

  it('a rule still holding the OLD price after a price rise is a "check" that names the price in force', () => {
    const rose = bill({ prices: [{ from: '2026-01-01', cents: 1500, label: 'introductory' }, { from: '2026-06-01', cents: 3000, label: '' }] });
    const n = drift(rose, rule({ amountCents: -1500 }));
    expect(n[0]).toMatchObject({ kind: 'amount', level: 'check', on: '2026-01-01', label: 'introductory' });
  });

  it('a few days between the Scheduled date and the bill date is normal and said calmly; a big gap is worth a look', () => {
    const near = drift(bill({ schedule: monthly(18, '2026-11') }), rule({ startDate: '2026-01-16' }));
    expect(kinds(near)).toEqual(['dates:info']);
    expect(driftWords(near[0], money)).toMatch(/A few days apart is normal/);
    const far = drift(bill({ schedule: monthly(18, '2026-11') }), rule({ startDate: '2026-01-05' }));
    expect(kinds(far)).toEqual(['dates:check']);
  });

  it('approving the Finance item early is NOT a month of disagreement: the next bill date is compared with the nearest rule occurrence, approved or not', () => {
    const posted: RecurringLog[] = [{ id: 1, ruleId: 7, date: '2026-11-18', action: 'posted', txnId: 4 }]; // November's item approved; the bill's November date (18th) is still ahead
    const b = bill();
    expect(scheduleDrift(b, rule(), posted, '2026-11-10')).toEqual([]);
    expect(scheduleDrift(b, rule(), [{ id: 2, ruleId: 7, date: '2026-11-18', action: 'skipped' }], '2026-11-10')).toEqual([]);
    expect(kinds(scheduleDrift(b, rule({ startDate: '2026-01-05' }), posted, '2026-11-10'))).toEqual(['dates:check']); // a genuinely different day is still reported
  });

  it('only periods on or after today are compared: a different tracking start date does not matter', () => {
    const early = bill({ trackingSince: '2026-01-01' });
    const late = bill({ trackingSince: '2026-11-15' });
    expect(drift(early, rule())).toEqual(drift(late, rule()));
  });

  it('the next scheduled date skips an occurrence already posted or skipped in Finance', () => {
    const r = rule();
    expect(nextRuleDate(r, [], TODAY)).toBe('2026-12-18');
    expect(nextRuleDate(r, [{ id: 1, ruleId: 7, date: '2026-12-18', action: 'posted', txnId: 4 }], TODAY)).toBe('2027-01-18');
    expect(nextRuleDate(r, [{ id: 1, ruleId: 8, date: '2026-12-18', action: 'posted' }], TODAY)).toBe('2026-12-18'); // another rule's log
  });

  it('"unresolved" is true only for a note worth a look, and a Finance posting never changes the bill\'s own record', () => {
    expect(driftUnresolved(drift(bill(), rule({ active: false })))).toBe(true);
    expect(driftUnresolved(drift(bill({ schedule: null }), rule()))).toBe(false);
    const b = bill();
    const before = JSON.stringify(b);
    drift(b, rule({ amountCents: -1 }));
    expect(JSON.stringify(b)).toBe(before);
  });
});

describe('B3.1 Scheduled link: a bill from a rule is a prefill, and an unfaithful recurrence is explained', () => {
  const cases: [RecurringRule['frequency'], Partial<RecurringRule>, string][] = [
    ['weekly', { startDate: '2026-11-02' }, 'weeks every 1'],
    ['biweekly', { startDate: '2026-11-02' }, 'weeks every 2'],
    ['monthly', { startDate: '2026-01-18' }, 'months every 1'],
    ['quarterly', { startDate: '2026-02-10' }, 'months every 3'],
    ['yearly', { startDate: '2026-03-15' }, 'months every 12'],
    ['semimonthly', { startDate: '2026-01-01', semiDays: [1, 15] }, 'twice-monthly'],
  ];
  for (const [freq, over, label] of cases) {
    it(`${freq} becomes a faithful Bills schedule (${label}) that Bills accepts`, () => {
      const r = rule({ frequency: freq, ...over });
      const { schedule, note } = scheduleFromRule(r);
      expect(note).toBeNull();
      expect(schedule).not.toBeNull();
      expect(scheduleProblem(schedule!)).toBeNull();
      const seed = billSeedFromRule(r);
      expect(seed.scheduleExact).toBe(true);
      expect(seed.notes).toEqual([]);
      expect(frequencyOf(schedule)).toBe(freq);
    });
  }

  it('the weekly anchor falls on the rule\'s weekday, a monthly rule keeps its day and an end-of-month day stays the last day', () => {
    expect(scheduleFromRule(rule({ frequency: 'weekly', startDate: '2026-11-02' })).schedule).toMatchObject({ kind: 'weeks', weekday: 1, anchorDate: '2026-11-02' });
    expect(scheduleFromRule(rule({ frequency: 'monthly', startDate: '2026-01-31' })).schedule).toMatchObject({ kind: 'months', slot: { kind: 'day', day: 31 }, anchorMonth: '2026-01' });
    expect(scheduleFromRule(rule({ frequency: 'semimonthly', startDate: '2026-01-01', semiDays: [15, 31] })).schedule).toMatchObject({ kind: 'twice-monthly', semi: { a: { kind: 'day', day: 15 }, b: { kind: 'lastDay' } } });
  });

  it('a recurrence Bills cannot hold exactly is explained and left for the owner; nothing is silently substituted', () => {
    const r = rule({ frequency: 'semimonthly', startDate: '2026-01-01', semiDays: [30, 31] }); // two payments on one day of a 30-day month
    const seed = billSeedFromRule(r);
    expect(seed.schedule).toBeNull();
    expect(seed.scheduleExact).toBe(false);
    expect(seed.notes[0]).toMatch(/cannot hold this recurrence exactly/);
  });

  it('carries payee, the amount as a positive figure, the account and the end date note; copies no payment history; never changes the rule', () => {
    const r = rule({ payee: ' Example Power Co ', amountCents: -9000, accountId: 3, endDate: '2027-06-01', active: false });
    const before = JSON.stringify(r);
    const seed = billSeedFromRule(r);
    expect(seed).toMatchObject({ ruleId: 7, title: 'Example Power Co', providerName: 'Example Power Co', amountCents: 9000, fundingAccountId: 3, endDate: '2027-06-01' });
    expect(seed.notes.join(' ')).toMatch(/stops this payment on 2027-06-01/);
    expect(seed.notes.join(' ')).toMatch(/switched off in Finance/);
    expect(JSON.stringify(r)).toBe(before);
    expect(Object.keys(seed)).not.toContain('txnRefs');
  });

  it('only live spending rules that no bill covers are listed as "not tracked"', () => {
    const rules = [rule({ id: 1, payee: 'Example Rent' }), rule({ id: 2, payee: 'Paycheck', amountCents: 5000 }), rule({ id: 3, payee: 'To Savings', transferAccountId: 9 }), rule({ id: 4, payee: 'Off', active: false }), rule({ id: 7, payee: 'Held' })];
    expect(untrackedRules(rules, [obRec(1, { scheduledRuleIds: [7] })], () => false, TODAY).map((r) => r.id)).toEqual([1]);
    expect(untrackedRules(rules, [], (p) => p === 'Example Rent', TODAY).map((r) => r.id)).toEqual([7]);
  });
});
