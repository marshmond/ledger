import { afterEach, describe, expect, it, vi } from 'vitest';
import { FinanceDB } from '../../db';
import { handoffFor, registerModule } from '../../core/registry';
import { ledgerModule } from '../ledger';
import { ledgerRecords } from '../ledger/records';
import { ledgerDueItems } from '../ledger/dueProvider';
import { matchRepeat } from '../ledger/fromEvent';
import type { RecurringRule } from '../../types';
import { createEvent, loadEvents, newEventData, restoreEventData, retireEvent } from './data';
import { birthdayTitle, buildSeed, defaultsFor, EVENT_TYPES, FINANCE_PRESETS } from './eventTypes';
import { blankFields, PERSONAL_ID } from './model';
import type { Recurrence } from './recurrence';
import type { SeriesExtras } from './series';
import { occurrencesOf } from './occurrences';

let n = 0;
const fresh = () => new FinanceDB(`test-handoff-${n++}`);
const TODAY = '2026-11-04';
const rule = (r: Partial<Recurrence> & Pick<Recurrence, 'freq'>): Recurrence => ({ interval: 1, end: { type: 'never' }, ...r });
const extras = (over: Partial<SeriesExtras> = {}): SeriesExtras => ({ calendarId: PERSONAL_ID, tagIds: [], contactIds: [], recurrence: null, trackDone: false, ...over });
const seedOf = (r: Recurrence | null, start = '2026-12-05', ex = false) => buildSeed({ title: 'Test rent', startDate: start, notes: 'note' }, r, TODAY, ex);

describe('Bill event -> Ledger frequency', () => {
  it('maps the five simple repeats and leaves semimonthly for the owner to choose', () => {
    const f = (r: Recurrence | null) => matchRepeat(seedOf(r)).frequency;
    expect(f(rule({ freq: 'weekly' }))).toBe('weekly');
    expect(f(rule({ freq: 'weekly', interval: 2 }))).toBe('biweekly');
    expect(f(rule({ freq: 'monthly' }))).toBe('monthly');
    expect(f(rule({ freq: 'monthly', interval: 3 }))).toBe('quarterly');
    expect(f(rule({ freq: 'yearly' }))).toBe('yearly');
    expect(f(rule({ freq: 'monthly', interval: 12 }))).toBe('yearly');
  });

  it('says so, and asks, when the repeat is not one of the six', () => {
    for (const r of [rule({ freq: 'daily' }), rule({ freq: 'weekly', interval: 3 }), rule({ freq: 'monthly', interval: 2 }), rule({ freq: 'weekly', byWeekday: [1, 3] }), rule({ freq: 'monthly', monthly: 'nth' })]) {
      const m = matchRepeat(seedOf(r));
      expect(m.frequency).toBeNull();
      expect(m.note).toMatch(/does not match one of Ledger's six options/);
    }
  });

  it('a one-time event becomes a rule that ends on its date', () => {
    const m = matchRepeat(seedOf(null));
    expect(m).toMatchObject({ frequency: 'monthly', endDate: '2026-12-05' });
    expect(m.note).toMatch(/happen once/);
  });

  it('keeps the end of a repeat (a date, or the last of N times)', () => {
    expect(matchRepeat(seedOf(rule({ freq: 'monthly', end: { type: 'until', date: '2027-03-05' } }))).endDate).toBe('2027-03-05');
    expect(matchRepeat(seedOf(rule({ freq: 'monthly', end: { type: 'count', count: 3 } }))).endDate).toBe('2027-02-05');
  });
});

describe('the seed an event hands over', () => {
  it('starts a long-running bill at its next date, not its old first date', () => {
    const s = seedOf(rule({ freq: 'monthly' }), '2025-01-15');
    expect(s.date).toBe('2026-11-15');
    expect(seedOf(rule({ freq: 'monthly' }), '2027-01-15').date).toBe('2027-01-15');
    expect(seedOf(null, '2025-01-15').date).toBe('2025-01-15');
  });
  it('carries the title, notes and whether single dates were changed', () => {
    expect(seedOf(null, '2026-12-05', true)).toMatchObject({ title: 'Test rent', notes: 'note', hasExceptions: true, repeat: null });
  });
});

describe('Ledger offers the handoff through the registry', () => {
  it('a Bill event can be handed to Ledger; other types cannot', () => {
    registerModule(ledgerModule);
    expect(handoffFor('bill')?.label).toBe('Create scheduled item in Ledger');
    expect(handoffFor('bill')?.moduleId).toBe('ledger');
    expect(handoffFor('finance')).toBeUndefined();
    expect(handoffFor('birthday')).toBeUndefined();
    expect(handoffFor(undefined)).toBeUndefined();
  });
});

describe('retiring an event after Ledger takes it over', () => {
  async function setup() {
    const d = fresh();
    const accountId = (await d.accounts.add({ name: 'Test checking', kind: 'checking', openingBalanceCents: 0, openingDate: '2026-01-01' } as never)) as number;
    const evId = await createEvent(newEventData({ ...blankFields('2026-11-15'), title: 'Test rent' }, extras({ recurrence: rule({ freq: 'monthly' }), type: 'bill' })), d);
    const ruleId = (await d.recurring.add({ accountId, payee: 'Test rent', amountCents: -150000, categoryId: null, memo: '', frequency: 'monthly', startDate: '2026-11-15', active: true } as RecurringRule)) as number;
    return { d, evId, ruleId };
  }
  const feb = { from: '2026-11-01', to: '2027-01-31', today: TODAY, overdueDays: 0 };

  it('leaves exactly one item: the event is gone, the Ledger rule remains, and the dates line up', async () => {
    const { d, evId, ruleId } = await setup();
    // Before retiring, the same bill would show twice (the calendar event and the Ledger item).
    const calBefore = (await loadEvents(d)).flatMap((e) => occurrencesOf(e, '2026-11-01', '2027-01-31')).length;
    expect(calBefore).toBe(3);
    expect(await retireEvent(evId, { module: 'ledger', recordId: `scheduled:${ruleId}`, note: 'Now owned by Ledger: Test rent' }, d)).toBe(true);
    expect(await loadEvents(d)).toEqual([]);
    const led = (await ledgerDueItems(d, feb)).filter((i) => String(i.sourceRecordId).startsWith('scheduled:'));
    expect(led.map((i) => i.date)).toEqual(['2026-11-15', '2026-12-15', '2027-01-15']);
  });

  it('keeps the event as a soft-deleted record with a note pointing at the rule, and can bring it back', async () => {
    const { d, evId, ruleId } = await setup();
    await retireEvent(evId, { module: 'ledger', recordId: `scheduled:${ruleId}`, note: 'Now owned by Ledger: Test rent' }, d);
    const raw = await d.moduleRecords.get(evId);
    expect(raw?.deletedAt).toBeTruthy();
    expect((raw!.data as { retired?: unknown }).retired).toEqual({ module: 'ledger', recordId: `scheduled:${ruleId}`, note: 'Now owned by Ledger: Test rent' });
    await restoreEventData(evId, null, d);
    expect((await loadEvents(d)).map((e) => e.id)).toEqual([evId]);
  });

  it('does nothing for an event that is already gone', async () => {
    const { d, evId } = await setup();
    expect(await retireEvent(evId, { module: 'ledger', recordId: 'scheduled:1', note: 'x' }, d)).toBe(true);
    expect(await retireEvent(evId, { module: 'ledger', recordId: 'scheduled:1', note: 'x' }, d)).toBe(false);
  });
});

describe('click-through to the Ledger record', () => {
  async function seed() {
    const { db } = await import('../../db');
    await db.accounts.clear(); await db.recurring.clear();
    const a = (await db.accounts.add({ name: 'Test checking', kind: 'checking', openingBalanceCents: 0, openingDate: '2026-01-01' } as never)) as number;
    const r = (await db.recurring.add({ accountId: a, payee: 'Test rent', amountCents: -100, categoryId: null, memo: '', frequency: 'monthly', startDate: '2026-11-15', active: true } as RecurringRule)) as number;
    return { db, a, r };
  }
  afterEach(() => vi.unstubAllGlobals());

  it('a scheduled item opens its own edit form; accounts open the account page; a missing record opens nothing', async () => {
    const win = { location: { hash: '' } };
    vi.stubGlobal('window', win);
    const { a, r } = await seed();
    expect((await ledgerRecords.describe(`scheduled:${r}`))?.path).toBe(`/ledger/scheduled?rule=${r}`);
    expect((await ledgerRecords.describe(`account:${a}`))?.path).toBe(`/ledger/account/${a}`);
    expect(await ledgerRecords.openSource!('scheduled:999999')).toBe(false);
    expect(win.location.hash).toBe('');
    expect(await ledgerRecords.openSource!(`scheduled:${r}`)).toBe(true);
    expect(win.location.hash).toBe(`#/ledger/scheduled?rule=${r}`);
  });

  it('the Finance layer item for a scheduled rule opens that rule, and offers no date editing', async () => {
    const win = { location: { hash: '' } };
    vi.stubGlobal('window', win);
    const { db, r } = await seed();
    const [item] = (await ledgerDueItems(db, { from: '2026-11-01', to: '2026-11-30', today: TODAY, overdueDays: 0 })).filter((i) => i.sourceRecordId === `scheduled:${r}`);
    item.openSource();
    expect(win.location.hash).toBe(`#/ledger/scheduled?rule=${r}`);
    expect(item.actions).toBeUndefined();
    expect(item.sourceLabel).toBe('Edit in Ledger');
  });
});

describe('event types and their starting values', () => {
  it('offers Event, Bill, Finance date and Birthday', () => {
    expect(EVENT_TYPES.map((t) => t.id)).toEqual(['', 'bill', 'finance', 'birthday']);
  });
  it('a birthday is yearly and all-day; a bill starts monthly with a reminder and "keep until done"; both tag only where it makes sense', () => {
    const b = defaultsFor('birthday', false)!;
    expect(b).toMatchObject({ allDay: true, repeat: { freq: 'yearly', interval: 1 }, priority: 'low' });
    expect(b.tag).toBeUndefined();
    const bill = defaultsFor('bill', false)!;
    expect(bill).toMatchObject({ trackDone: true, reminders: [1440], repeat: { freq: 'monthly' }, tag: 'Finance' });
    expect(defaultsFor('finance', false)).toMatchObject({ tag: 'Finance', trackDone: true });
    expect(defaultsFor('', false)).toBeNull();
  });
  it('never replaces a repeat the event already has', () => {
    expect(defaultsFor('bill', true)!.repeat).toBeUndefined();
  });
  it('Finance presets only supply a name and a repeat (no invented date)', () => {
    expect(FINANCE_PRESETS.map((p) => p.id)).toEqual(['card-due', 'card-statement', 'renewal', 'tax-prep']);
    for (const p of FINANCE_PRESETS) expect(p.repeat.freq === 'monthly' || p.repeat.freq === 'yearly').toBe(true);
  });
  it('titles a birthday for the person', () => {
    expect(birthdayTitle('Test Person')).toBe("Test Person's birthday");
  });
});
