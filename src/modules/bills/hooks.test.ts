import { scanText } from '../../lib/leakTestkit';
import { describe, expect, it } from 'vitest';
import { db } from '../../db';
import { allQuickAdds, allSearchSources, recordSource } from '../../core/registry';
import { routeQuickAdd } from '../../core/quickAddRoute';
import { registerModules } from '../index';
import { billsModule } from './index';
import { createObligation, getObligation } from './data';
import { applyUndo } from './undo';
import { billQuickAdd, parseBillQuick } from './quickAddDef';
import { billRecords } from './records';
import { searchBillsData } from './searchSource';
import { asObligation, toStored, type ObligationData, type ObligationRecord } from './model';
import { blankDraft, draftOfSchedule, draftProblem, previewDraft, scheduleOfDraft, type Pattern, type ScheduleDraft } from './scheduleDraft';
import { buildOverview, buildRows, countByStatus, filterRows, providersOf } from './views';
import { amountWords } from './BillsParts';
import { fresh, monthly, ob } from './billsTestkit';
import type { ModuleRecord } from '../../core/entities';

/** Search, Quick Add, record links, the schedule draft and the list/overview read models. Invented data. 2026-11-07 is a Saturday. */
const TODAY = '2026-11-07';
let n = 1000;
const rec = (over: Partial<ObligationData>): ObligationRecord => asObligation({ id: n++, module: 'bills', kind: 'obligation', data: toStored(ob({ trackingSince: TODAY, ...over }, TODAY)), createdAt: 1, updatedAt: 1, deletedAt: null } as ModuleRecord);

describe('B1: registration and Quick Add clash checks (test: Search and Quick Add registration)', () => {
  it('the module registers with Finance’s `b` and `bill` untouched, and every Quick Add word is still unique', () => {
    registerModules();
    const defs = allQuickAdds();
    const bills = defs.find((d) => d.id === 'bills-obligation')!;
    expect(bills).toBeDefined();
    expect(bills.prefix).toBe('bs');
    expect(bills.aliases).toEqual(['subscription', 'sub']);
    const words = defs.flatMap((d) => [d.prefix, ...(d.aliases ?? [])].map((w) => w.toLowerCase()));
    expect(new Set(words).size).toBe(words.length);
    const finance = defs.find((d) => d.id === 'scheduled')!;
    expect(finance.prefix).toBe('b');
    expect(finance.aliases).toContain('bill');
    expect(billsModule.id).toBe('bills');
  });
  it('typing routes to the right destination: bs, subscription and sub go to Bills; b and bill still go to Finance', () => {
    registerModules();
    const defs = allQuickAdds();
    const id = (t: string) => routeQuickAdd(t, defs).def?.id;
    expect(id('bs Streamly 15.49 monthly')).toBe('bills-obligation');
    expect(id('subscription Streamly 15.49 monthly')).toBe('bills-obligation');
    expect(id('sub: Streamly 15.49 monthly')).toBe('bills-obligation');
    expect(id('b Pay the rent')).toBe('scheduled');
    expect(id('bill Pay the rent')).toBe('scheduled');
    expect(id('hs House cleaning')).toBe('household-service');
    expect(id('t buy milk')).toBe('task');
    expect(routeQuickAdd('bs Streamly', defs).rest).toBe('Streamly');
  });
  it('Search and records are registered', () => {
    registerModules();
    expect(allSearchSources().some((s) => s.moduleId === 'bills' && s.source.group === 'Bills & Subscriptions')).toBe(true);
    expect(recordSource('bills')).toBe(billRecords);
  });
  it('B2 contributes the due provider (Calendar layer) and the Today card; ST-S2 adds only the read-only transaction-reference reader', () => {
    expect(billsModule.contributes?.dueProvider?.id).toBe('bills');
    expect(billsModule.contributes?.todayCards?.map((c) => c.id)).toEqual(['bills.attention']);
    expect(Object.keys(billsModule.contributes ?? {}).sort()).toEqual(['dueProvider', 'quickAdd', 'records', 'searchSource', 'todayCards', 'txnReferences']);
  });
});

describe('B1: Quick Add understands plain lines and refuses unclear ones in words', () => {
  const p = (t: string, plain = false) => parseBillQuick(t, TODAY, ['Streamly'], plain)!;
  it('"Streamly 15.49 monthly 12th autopay"', () => {
    const q = p('Streamly 15.49 monthly 12th autopay');
    expect(q.problem).toBeNull();
    expect(q.data).toMatchObject({ title: 'Streamly', amountKind: 'fixed', payment: { how: 'auto', fundingAccountId: null }, trackingSince: TODAY });
    expect(q.data.prices).toEqual([{ from: TODAY, cents: 1549, label: '' }]);
    expect(q.data.schedule).toEqual(monthly(12, '2026-11'));
  });
  it('"Example Power varies monthly 18th": the amount varies, with no amount invented', () => {
    const q = p('Example Power varies monthly 18th');
    expect(q.problem).toBeNull();
    expect(q.data).toMatchObject({ title: 'Example Power', amountKind: 'variable', type: 'utility', need: 'essential', prices: [] });
    expect(q.data.schedule).toEqual(monthly(18, '2026-11'));
    expect(q.data.payment.how).toBe('unknown');
  });
  it('"Home insurance 1200 yearly 15 mar": once a year, next March, in whole cents', () => {
    const q = p('Home insurance 1200 yearly 15 mar');
    expect(q.problem).toBeNull();
    expect(q.data.type).toBe('insurance');
    expect(q.data.prices[0].cents).toBe(120000);
    expect(q.data.schedule).toEqual(monthly(15, '2027-03', 12));
  });
  it('weekly on a weekday, every 2 weeks, every 3 months, last business day, "with" a provider, and dollar signs', () => {
    const w = p('Maple Gym $10 weekly fri');
    expect(w.data.schedule).toMatchObject({ kind: 'weeks', every: 1, weekday: 5, anchorDate: '2026-11-13' });
    expect(p('Window cleaner 40 every 2 weeks').data.schedule).toMatchObject({ kind: 'weeks', every: 2, weekday: 6, anchorDate: TODAY });
    expect(p('Pest control 90 every 3 months 20th').data.schedule).toEqual(monthly(20, '2026-11', 3));
    expect(p('Water bill 60 monthly last business day').data.schedule).toEqual({ kind: 'months', every: 1, slot: { kind: 'lastBusinessDay' }, anchorMonth: '2026-11' });
    const q = p('Streamly Premium 15.49 monthly 12th with Streamly');
    expect(q.providerName).toBe('Streamly');
    expect(q.providerExists).toBe(true);
    expect(q.data.title).toBe('Streamly Premium');
  });
  it('a past day this month rolls to next month, never to a past date', () => {
    expect(p('Thing 5 monthly 3rd').data.schedule).toEqual(monthly(3, '2026-12'));
  });
  it('an unclear line is shown with a plain problem and is refused: nothing is guessed', async () => {
    expect(p('Streamly 15.49').problem).toMatch(/how often/);
    expect(p('15.49 monthly').problem).toMatch(/what it is/);
    expect(p('Gym 20 twice monthly').problem).toMatch(/form/);
    expect(p('Streamly 15.49 monthly 40th').problem).toMatch(/not valid|real|Pick a day/);
    expect(parseBillQuick('', TODAY, [])).toBeNull();
    const preview = billQuickAdd.parse!('Streamly 15.49', { plain: false })!;
    await expect(billQuickAdd.commit!(preview)).rejects.toThrow(/how often/);
  });
  it('plain mode makes the whole text the title (no shorthand)', () => {
    const q = p('Streamly 15.49 monthly', true);
    expect(q.data.title).toBe('Streamly 15.49 monthly');
    expect(q.data.schedule).toBeNull();
  });
  it('the preview states it is expected dates only; Add saves it and Undo removes it, keeping the Contact', async () => {
    const preview = billQuickAdd.parse!('Quickadd Cable 79.99 monthly 3rd manual with Quickadd Cable Co', {})!;
    expect(preview.summary).toMatch(/Expected dates only/);
    expect(preview.fields.some((f) => f.label === 'Problem')).toBe(false);
    const undo = await billQuickAdd.commit!(preview);
    const rows = (await db.moduleRecords.toArray()).filter((r) => r.module === 'bills');
    expect(rows).toHaveLength(1);
    expect(asObligation(rows[0]).data.payment.how).toBe('manual');
    await undo!();
    expect(await getObligation(rows[0].id as number, db)).toBeUndefined();
    expect((await db.contacts.toArray()).filter((c) => c.name === 'Quickadd Cable Co')).toHaveLength(1);
    await db.moduleRecords.clear(); await db.contacts.clear();
  });
});

describe('B1: Search and record links show title, provider and type only (test 34, privacy)', () => {
  const SECRETS = { notes: 'door code is 4471-secret', url: 'https://example.com/private-statement', cents: 987654, phone: '555-0199-7777', account: 'ACCT-9988776655' };
  const list = [
    rec({ title: 'Streamly Premium', type: 'subscription', providerNameSnapshot: 'Streamly', prices: [{ from: TODAY, cents: SECRETS.cents, label: '' }], notes: SECRETS.notes, refs: [{ label: 'Statement', url: SECRETS.url }] }),
    rec({ title: 'Example Power Co', type: 'utility', providerNameSnapshot: 'Example Power' }),
    rec({ title: 'Old gym', type: 'membership', providerNameSnapshot: 'Maple Gym', status: 'ended', endedOn: '2026-10-01' }),
  ];
  it('finds by title, provider name and type label; ended items rank last; the page itself is found', () => {
    expect(searchBillsData('streamly', list).map((r) => r.title)).toEqual(['Streamly Premium']);
    expect(searchBillsData('maple', list)[0].title).toBe('Old gym');
    expect(searchBillsData('utility', list).map((r) => r.title)).toEqual(['Example Power Co']);
    expect(searchBillsData('bills', list)[0]).toMatchObject({ kind: 'Page', path: '/bills' });
    const both = searchBillsData('one', [rec({ title: 'Ended one', status: 'ended', endedOn: '2026-10-01' }), rec({ title: 'Active one' })]).filter((r) => r.kind !== 'Page');
    expect(both.map((r) => r.title)).toEqual(['Active one', 'Ended one']);
    expect(searchBillsData('   ', list)).toEqual([]);
  });
  it('labels the result kind and links to the detail page', () => {
    const r = searchBillsData('streamly', list)[0];
    expect(r.kind).toBe('Subscription');
    expect(r.path).toBe(`/bills/o/${list[0].id}`);
    expect(searchBillsData('example power', list)[0].kind).toBe('Bill');
  });
  it('never matches or shows amounts, notes, document links or contact details', () => {
    for (const q of [SECRETS.notes, 'secret', '4471', SECRETS.url, 'private-statement', '987654', '9876.54', SECRETS.phone, SECRETS.account, 'statement']) expect(searchBillsData(q, list).filter((r) => r.kind !== 'Page'), q).toEqual([]);
    const text = JSON.stringify(searchBillsData('streamly', list));
    for (const s of [SECRETS.notes, SECRETS.url, '987654', '9,876', '9876.54']) expect(text).not.toContain(s);
    expect(text).not.toMatch(/\$\s?\d/);
  });
  it('record links: found by name, described by label, never an amount; a missing record describes as null', async () => {
    const d = db;
    const r = await createObligation({ data: ob({ title: 'Linkable Subscription', type: 'subscription', prices: [{ from: TODAY, cents: 424242, label: '' }], notes: SECRETS.notes }, TODAY), provider: { name: 'Link Provider' } }, d);
    const found = await billRecords.search('linkable');
    expect(found).toEqual([{ id: `obligation:${r.id}`, label: 'Linkable Subscription, Link Provider', kind: 'Subscription' }]);
    const info = await billRecords.describe(`obligation:${r.id}`);
    expect(info).toEqual({ label: 'Linkable Subscription, Link Provider', kind: 'Subscription', path: `/bills/o/${r.id}` });
    expect(scanText([found, info])).not.toMatch(/424242|4244|secret|\$/);
    expect(await billRecords.describe('obligation:1')).toBeNull();
    expect(await billRecords.describe('arrangement:5')).toBeNull();
    await applyUndo(r.undo, d);
    expect(await billRecords.describe(`obligation:${r.id}`)).toBeNull();
    await d.contacts.clear(); await d.moduleRecords.clear();
  });
});

describe('B1: Hide Amounts and wording: an amount is never shown as spent, unknown is never $0', () => {
  const MASK = (c: number) => (c >= 0 ? '$••••' : '');
  it('masked amounts contain no digit; unknown and varying amounts say so', () => {
    expect(amountWords({ cents: 1549, basis: 'fixed' }, MASK)).toBe('$•••• each time');
    expect(amountWords({ cents: 9000, basis: 'variable' }, MASK)).toBe('Varies, about $••••');
    expect(amountWords({ cents: 1549, basis: 'fixed' }, MASK)).not.toMatch(/\d/);
    expect(amountWords({ cents: null, basis: 'unknown' }, MASK)).toBe('Amount not known');
    expect(amountWords({ cents: null, basis: 'variable' }, MASK)).toBe('Amount varies');
    expect(amountWords({ cents: null, basis: 'fixed' }, MASK)).toBe('Amount not known');
    expect(amountWords({ cents: 0, basis: 'fixed' }, (c) => `$${(c / 100).toFixed(2)}`)).toBe('$0.00 each time'); // a known zero is shown as zero, unlike unknown
  });
  it('no text produced for Search, record links or Quick Add previews carries a currency amount', async () => {
    const q = billQuickAdd.parse!('Priv Test 15.49 monthly 12th autopay', {})!;
    expect(q.summary).toMatch(/\$15\.49/); // the person typed it and is about to add it (masked when Hide Amounts is on)
    expect(scanText(searchBillsData('priv', [rec({ title: 'Priv Test', prices: [{ from: TODAY, cents: 1549, label: '' }] })]))).not.toMatch(/\$|15\.49|1549/);
  });
});

describe('B1: the schedule draft behind the form', () => {
  it('round trips every pattern', () => {
    const cases: [Pattern, Partial<ScheduleDraft>][] = [
      ['monthly', { first: '2026-12-12' }], ['weekly', { first: '2026-11-06' }], ['every2weeks', { first: '2026-11-06' }], ['every4weeks', { first: '2026-11-06' }], ['everyNweeks', { first: '2026-11-06', n: 3 }],
      ['every2months', { first: '2026-12-12' }], ['quarterly', { first: '2026-12-12' }], ['every6months', { first: '2026-12-12' }], ['yearly', { first: '2027-03-15' }], ['everyNmonths', { first: '2026-12-12', n: 5 }],
      ['twice', { first: '2026-12-01' }], ['ondemand', {}],
    ];
    for (const [pattern, over] of cases) {
      const d: ScheduleDraft = { ...blankDraft(TODAY), pattern, ...over };
      expect(draftProblem(d), pattern).toBeNull();
      const s = scheduleOfDraft(d);
      const back = draftOfSchedule(s, TODAY);
      expect(back.pattern, pattern).toBe(pattern);
      expect(scheduleOfDraft(back), pattern).toEqual(s);
    }
  });
  it('the weekday, day and month come from the one date picked; last day kinds anchor on the right month', () => {
    expect(scheduleOfDraft({ ...blankDraft(TODAY), pattern: 'weekly', first: '2026-11-06' })).toMatchObject({ weekday: 5, anchorDate: '2026-11-06' });
    expect(scheduleOfDraft({ ...blankDraft(TODAY), pattern: 'monthly', first: '2026-12-31' })).toEqual(monthly(31, '2026-12'));
    expect(scheduleOfDraft({ ...blankDraft(TODAY), pattern: 'monthly', first: '2026-12-15', dayKind: 'lastBusinessDay' })).toEqual({ kind: 'months', every: 1, slot: { kind: 'lastBusinessDay' }, anchorMonth: '2026-12' });
    expect(draftOfSchedule({ kind: 'months', every: 1, slot: { kind: 'lastDay' }, anchorMonth: '2026-12' }, TODAY).first).toBe('2026-12-31');
  });
  it('problems are plain words: missing date, impossible weekend rule, same-day twice-monthly, bad N', () => {
    expect(draftProblem({ ...blankDraft(TODAY), first: '' })).toMatch(/date of the next bill/);
    expect(draftProblem({ ...blankDraft(TODAY), pattern: 'twice', first: '' })).toMatch(/month/);
    expect(draftProblem({ ...blankDraft(TODAY), first: '2026-12-01', adjust: 'previous' })).toMatch(/outside its own month/);
    expect(draftProblem({ ...blankDraft(TODAY), pattern: 'twice', first: '2026-12-01', semi: { a: { kind: 'day', day: 30 }, b: { kind: 'lastDay' } } })).toMatch(/same date/);
    expect(draftProblem({ ...blankDraft(TODAY), pattern: 'everyNmonths', n: 99, first: '2026-12-01' })).toMatch(/1 to 24/);
    expect(draftProblem({ ...blankDraft(TODAY), pattern: 'everyNweeks', n: 0, first: '2026-11-06' })).toMatch(/1 to 52/);
  });
  it('previews the next three dates before saving; none when there is a problem or no schedule', () => {
    expect(previewDraft({ ...blankDraft(TODAY), first: '2026-11-12' }, TODAY, TODAY).map((e) => e.nominal)).toEqual(['2026-11-12', '2026-12-12', '2027-01-12']);
    expect(previewDraft({ ...blankDraft(TODAY), pattern: 'ondemand' }, TODAY, TODAY)).toEqual([]);
    expect(previewDraft({ ...blankDraft(TODAY), first: '' }, TODAY, TODAY)).toEqual([]);
    expect(previewDraft({ ...blankDraft(TODAY), first: '2026-01-12' }, '2026-11-20', '2026-11-20').map((e) => e.nominal)[0]).toBe('2026-12-12'); // tracking start respected
  });
});

describe('B1: list and overview read models', () => {
  const list = [
    rec({ title: 'Streamly Premium', type: 'subscription', providerContactId: 1, providerNameSnapshot: 'Streamly', schedule: monthly(12, '2026-11'), review: { on: true, note: 'n', since: TODAY } }),
    rec({ title: 'Example Power Co', type: 'utility', providerContactId: 2, providerNameSnapshot: 'Example Power', schedule: monthly(18, '2026-11'), amountKind: 'variable', prices: [{ from: TODAY, cents: 9000, label: '' }] }),
    rec({ title: 'Paused thing', status: 'paused', pauses: [{ from: TODAY, to: null }], schedule: monthly(1, '2026-11') }),
    rec({ title: 'Ended thing', status: 'ended', endedOn: '2026-11-07', type: 'membership' }),
    rec({ title: 'No provider', type: 'other', schedule: null }),
    rec({ title: 'Mortgage', type: 'loan', schedule: monthly(1, '2026-12'), prices: [{ from: TODAY, cents: 150000, label: '' }] }),
  ];
  it('rows: active first, then soonest next date; filters by status, type and provider', () => {
    const rows = buildRows(list, TODAY);
    expect(rows.map((r) => r.ob.data.title).slice(0, 3)).toEqual(['Streamly Premium', 'Example Power Co', 'Mortgage']);
    expect(countByStatus(rows, 'active')).toBe(4);
    expect(countByStatus(rows, 'paused')).toBe(1);
    expect(countByStatus(rows, 'ended')).toBe(1);
    expect(countByStatus(rows, 'all')).toBe(6);
    expect(filterRows(rows, { status: 'ended', type: 'all', provider: 'all' }).map((r) => r.ob.data.title)).toEqual(['Ended thing']);
    expect(filterRows(rows, { status: 'all', type: 'utility', provider: 'all' }).map((r) => r.ob.data.title)).toEqual(['Example Power Co', 'Paused thing']);
    expect(filterRows(rows, { status: 'all', type: 'all', provider: 2 }).map((r) => r.ob.data.title)).toEqual(['Example Power Co']);
    expect(filterRows(rows, { status: 'all', type: 'all', provider: 'none' }).map((r) => r.ob.data.title)).toEqual(expect.arrayContaining(['No provider', 'Ended thing']));
    expect(providersOf(list).map((p) => p.name)).toEqual(['Example Power', 'Streamly']);
  });
  it('overview: counts, loans left out of upcoming dates, the review list, and notes in plain words', () => {
    const ov = buildOverview(list, TODAY);
    expect(ov.counts).toEqual({ active: 4, paused: 1, ended: 1, total: 6, needsReview: 0 });
    expect(ov.upcoming.map((u) => `${u.ob.data.title}@${u.nominal}`)).toEqual(['Streamly Premium@2026-11-12', 'Example Power Co@2026-11-18', 'Streamly Premium@2026-12-12', 'Example Power Co@2026-12-18']); // the Mortgage (a loan) is left out
    expect(ov.upcoming.every((u) => u.nominal >= TODAY && u.nominal <= '2026-12-22')).toBe(true);
    expect(ov.review.map((r) => r.ob.data.title)).toEqual(['Streamly Premium']);
    expect(ov.commitments.loanExcluded).toBe(1);
    const damaged = rec({ title: 'Damaged', schedule: undefined as never });
    damaged.data = { ...damaged.data, rawKept: { schedule: { kind: 'lunar' } } };
    const o2 = buildOverview([damaged], TODAY);
    expect(o2.counts.needsReview).toBe(1);
    expect(o2.notes[0].text).toMatch(/could not be read/);
  });
  it('an upcoming date is never described as a payment', () => {
    const ov = buildOverview(list, TODAY);
    expect(JSON.stringify(ov.upcoming.map((u) => ({ n: u.nominal, s: u.slot, a: u.amount })))).not.toMatch(/paid|payment|spent/i);
  });
});

describe('B1: a fresh database has no Bills records and registering the module adds none', () => {
  it('nothing is written at start-up', async () => {
    const d = fresh();
    expect(await d.moduleRecords.count()).toBe(0);
    registerModules();
    expect(await d.moduleRecords.count()).toBe(0);
  });
});
