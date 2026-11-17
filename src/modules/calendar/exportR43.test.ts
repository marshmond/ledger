import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FinanceDB } from '../../db';
import { createStore } from '../../core/store';
import { scanText } from '../../lib/leakTestkit';
import { registerDueProvider, type DerivedItem } from '../../core/dueProvider';
import { buildCalendar } from '../../lib/calendar';
import { ledgerDueItems } from '../ledger/dueProvider';
import { familyDueItems } from '../family/dueProvider';
import { createMember } from '../family/data';
import { taskDueItems } from '../tasks/dueProvider';
import { createTask } from '../tasks/data';
import { blankTask } from '../tasks/model';
import { projectDueItems } from '../projects/dueProvider';
import { createProject } from '../projects/data';
import { blankProject } from '../projects/model';
import { createEvent, ensureCalendarSeed, loadEvents, loadLayers, newEventData } from './data';
import { buildExport, choiceOf, defaultKeys, exportAlarm, exportText, offeredLayers, spread, type ExportChoice } from './exportPlan';
import { readProviders, readStored } from './exportRead';
import { blankFields, FAMILY_ID, FINANCE_ID, PERSONAL_ID, type EventFields } from './model';
import type { SeriesExtras } from './series';
import type { RecurringRule } from '../../types';

/** R4.3 richer Calendar file. Invented names, dates and amounts only (the amounts and notes are deliberately sensitive-looking so a leak is visible). */
let n = 0;
const fresh = () => new FinanceDB(`test-r43-${n++}`);
const TODAY = '2026-11-09';
const NOW = '2026-11-09T12:00:00.000Z';
const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), keys: () => [...m.keys()] }; };
beforeEach(() => { vi.stubGlobal('localStorage', mem()); });

const unfold = (t: string) => t.replace(/\r\n[ ]/g, '').split('\r\n').filter(Boolean);
const vevents = (t: string) => { const out: string[][] = []; let cur: string[] | null = null; for (const l of unfold(t)) { if (l === 'BEGIN:VEVENT') cur = []; else if (l === 'END:VEVENT') { out.push(cur!); cur = null; } else cur?.push(l); } return out; };
const unescape = (s: string) => s.replace(/\\n/g, '\n').replace(/\\([,;\\])/g, '$1');
const titles = (t: string) => vevents(t).map((e) => unescape(e.find((l) => l.startsWith('SUMMARY:'))!.slice(8)));
const weekly = { freq: 'weekly', interval: 1, end: { type: 'never' } } as const;
const extras = (over: Partial<SeriesExtras> = {}): SeriesExtras => ({ calendarId: PERSONAL_ID, tagIds: [], contactIds: [], recurrence: null, trackDone: false, ...over });
const addEvent = (d: FinanceDB, title: string, date: string, over: Partial<SeriesExtras> = {}, f: Partial<EventFields> = {}, data: object = {}) =>
  createEvent({ ...newEventData({ ...blankFields(date), title, ...f }, extras(over)), ...data }, d);
const snapshot = async (d: FinanceDB) => JSON.stringify(await Promise.all(d.tables.map(async (t) => [t.name, await t.toArray()])));
const q = { from: TODAY, to: '2027-11-09', today: TODAY, overdueDays: 0 };
const choice = (over: Partial<ExportChoice> = {}): ExportChoice => ({ localIds: [PERSONAL_ID], providerIds: ['family', 'tasks', 'projects', 'ledger'], amounts: false, alarms: true, ...over });

/** A small invented household: own events, a Task with a time and sensitive notes, a Finance rule and loan, a family birthday, and a project. */
async function household(hide = false) {
  const d = fresh();
  await ensureCalendarSeed(d);
  const contact = await createStore(d).shared.contacts.put({ name: 'Sam Example' } as never);
  await createMember({ contact: { mode: 'existing', contactId: contact }, fields: { role: 'child', status: 'active', birthMonthDay: '11-12', birthYear: 2015 } as never }, d, 2026);
  // the owner's own repeating event: one skipped date, one date changed on its own, a reminder and sensitive notes
  const practice = await addEvent(d, 'Practice', '2026-11-04', { recurrence: weekly }, { notes: 'Pay coach $450 in cash', reminders: [30] }, { skipped: ['2026-11-18'], overrides: { '2026-11-25': { title: 'Practice (moved)' } } });
  // a stored Birthday event for the same Contact on the same day covers the Family marker
  const bday = await addEvent(d, "Sam Example's birthday", '2026-11-12', { contactIds: [contact] }, {}, { type: 'birthday' });
  await createTask(blankTask({ title: 'Call the plumber', dueDate: '2026-11-20', dueTime: '14:30', notes: 'Budget is $9,999.99, account 12345678' }), [], d);
  await createTask(blankTask({ title: 'Someday: paint shed', notes: 'no date' }), [], d);
  const acct = (await d.accounts.add({ name: 'Test checking', kind: 'checking', openingBalanceCents: 0, openingDate: '2026-01-01' } as never)) as number;
  await d.recurring.add({ accountId: acct, payee: 'Test Landlord', amountCents: -150000, categoryId: null, memo: '', frequency: 'monthly', startDate: '2026-12-01', active: true } as RecurringRule);
  await d.loans.add({ name: 'Mortgage', kind: 'mortgage', setup: 'current', balanceCents: 20_000_000, asOfDate: '2026-10-01', nextPaymentDate: '2026-12-01', remainingMonths: 300, annualRatePct: 6, extraMode: 'shorten', escrowMonthlyCents: 60_000, interestCategoryId: 2 } as never);
  await createProject(blankProject({ name: 'Test Kitchen', status: 'active', startDate: '2026-12-05', targetDate: '2027-02-01' }), d);
  const layers = await loadLayers(d);
  const events = await loadEvents(d);
  const derived = {
    ledger: await ledgerDueItems(d, q, hide), tasks: await taskDueItems(d, q), family: await familyDueItems(d, q), projects: await projectDueItems(d, q),
  };
  return { d, layers, events, derived, practice, bday, contact };
}
const make = (h: Awaited<ReturnType<typeof household>>, c: ExportChoice, nowIso = NOW) => buildExport({ layers: h.layers, events: h.events, derived: h.derived, choice: c, today: TODAY, nowIso });

describe('layers contribute their own dates, and only when selected', () => {
  it('each layer is in the file when chosen and absent when not', async () => {
    const h = await household();
    const all = titles(make(h, choice()).text);
    expect(all).toEqual(expect.arrayContaining(['Practice', 'Call the plumber', 'Start: Test Kitchen']));
    expect(all.some((t) => t === "Sam Example's birthday")).toBe(true);
    expect(all.some((t) => t.startsWith('Test Landlord'))).toBe(true);
    expect(all.some((t) => t.startsWith('Mortgage payment'))).toBe(true);
    expect(all.some((t) => t.startsWith('Target: Test Kitchen'))).toBe(true);
    expect(all).not.toContain('Someday: paint shed'); // an undated Task gets no invented date
    const onlyProjects = titles(make(h, choice({ localIds: [], providerIds: ['projects'] })).text);
    expect(onlyProjects).toEqual(['Start: Test Kitchen', 'Target: Test Kitchen']);
    const none = make(h, choice({ localIds: [], providerIds: [] }));
    expect(none.storedEvents + none.derivedCount).toBe(0);
  });

  it('a Task is its title, date and time only: its notes are never exported', async () => {
    const h = await household();
    const text = make(h, choice({ amounts: true })).text;
    expect(scanText(text)).not.toContain('9,999');
    expect(scanText(text)).not.toContain('12345678');
    const task = vevents(text).find((e) => e.includes('SUMMARY:Call the plumber'))!;
    expect(task.find((l) => l.startsWith('DTSTART:'))).toMatch(/^DTSTART:\d{8}T\d{6}Z$/); // timed, not turned into an all-day date
    expect(task.find((l) => l.startsWith('DTEND:'))).toMatch(/^DTEND:\d{8}T\d{6}Z$/);
    const [s, e] = ['DTSTART:', 'DTEND:'].map((p) => task.find((l) => l.startsWith(p))!.slice(p.length));
    expect(Number(e.slice(9, 11)) * 60 + Number(e.slice(11, 13)) - (Number(s.slice(9, 11)) * 60 + Number(s.slice(11, 13)))).toBe(30);
  });

  it('exporting changes nothing in the database', async () => {
    const h = await household();
    const before = await snapshot(h.d);
    await readStored(h.d);
    make(h, choice({ amounts: true }));
    expect(await snapshot(h.d)).toBe(before);
  });
});

describe('financial amounts', () => {
  it('are out by default: no amount in any title, description or alarm, whether or not Hide Amounts is on', async () => {
    for (const hide of [false, true]) {
      const h = await household(hide);
      const text = make(h, choice()).text;
      expect(scanText(text), `hide=${hide}`).not.toMatch(/1\\?,500|\$1500/); // the amount as written, not any digits that an id may happen to hold
      expect(text, `hide=${hide}`).not.toMatch(/\$[\d\\,]+\.\d\d/); // no figure with cents anywhere
      const lines = unfold(text);
      const landlord = vevents(text).find((e) => e.some((l) => l.startsWith('SUMMARY:Test Landlord')))!;
      expect(landlord).toContain('SUMMARY:Test Landlord');
      expect(landlord).toContain('DESCRIPTION:Scheduled payment to approve.');
      const loan = vevents(text).find((e) => e.some((l) => l.startsWith('SUMMARY:Mortgage payment')))!;
      expect(loan).toContain('SUMMARY:Mortgage payment');
      expect([...new Set(lines.filter((l) => /\$\d/.test(l)))]).toEqual(['DESCRIPTION:Pay coach $450 in cash']); // the only dollar figure is the owner's own note, written as typed
    }
  });

  it('appear only when the owner chooses them, with the provider\'s own full text', async () => {
    for (const hide of [false, true]) {
      const h = await household(hide);
      const text = make(h, choice({ amounts: true })).text;
      expect(titles(text)).toEqual(expect.arrayContaining(['Test Landlord $1,500.00']));
      expect(titles(text).some((t) => /^Mortgage payment \$[\d,]+\.\d\d$/.test(t))).toBe(true);
    }
  });

  it('a Finance item with no approved plain text is written generically, never with its raw title', () => {
    const raw = { id: 'ledger:x:2026-12-01', sourceModule: 'ledger', sourceRecordId: 'x', title: 'Rent $2,000', date: '2026-12-01', allDay: true, priority: 'medium', status: 'open', detail: 'Pay $2,000', openSource: () => {} } as DerivedItem;
    expect(exportText(raw, false)).toEqual({ title: 'Finance date', detail: '' });
    expect(exportText({ ...raw, icsPlainTitle: 'Rent' }, false)).toEqual({ title: 'Rent', detail: '' });
    expect(exportText(raw, true)).toEqual({ title: 'Rent $2,000', detail: 'Pay $2,000' });
  });

  it('every amount-bearing Finance calendar kind has amount-free words', () => {
    const items = buildCalendar({
      today: TODAY, horizonDays: 400, vests: [{ id: 'v1', date: '2026-12-10', label: 'Test Co', grossCents: 1_234_500, person: 'Sam' }], milestones: [],
      estimated: { dueDates: ['2026-12-15'], amountCents: 987_600 }, rmds: [], scheduled: [{ id: 's1', date: '2026-12-02', payee: 'Test Landlord', amountCents: -150_000 }],
      loans: [{ id: 'l1', date: '2026-12-03', name: 'Mortgage', paymentCents: 188_800 }], yearEndYears: [2026], fmt: (c) => `$${(c / 100).toFixed(2)}`,
    });
    for (const e of items) {
      const plainT = e.plainTitle ?? e.title, plainD = e.plainDetail ?? e.detail;
      expect(plainT, e.id).not.toMatch(/\d{3}/); // no figure of three or more digits in the words used without amounts
      expect(plainD, e.id).not.toMatch(/\$\d/);
    }
    expect(items.find((e) => e.kind === 'vest')!.detail).toContain('$12345.00'); // the full text still has it (Home is unchanged)
  });
});

describe('the file is well formed and stable', () => {
  it('has a balanced structure, unique ids per entry, alarms inside events, and lines of at most 75 bytes', async () => {
    const h = await household();
    const { text } = make(h, choice({ amounts: true }));
    expect(text.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true);
    expect(text.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(text.split('\r\n').every((l) => new TextEncoder().encode(l).length <= 75)).toBe(true);
    const lines = unfold(text);
    expect(lines.filter((l) => l === 'BEGIN:VEVENT')).toHaveLength(lines.filter((l) => l === 'END:VEVENT').length);
    expect(lines.filter((l) => l === 'BEGIN:VALARM')).toHaveLength(lines.filter((l) => l === 'END:VALARM').length);
    for (const e of vevents(text)) {
      expect(e.some((l) => l.startsWith('UID:'))).toBe(true);
      expect(e.some((l) => /^DTSTAMP:\d{8}T\d{6}Z$/.test(l))).toBe(true);
      expect(e.some((l) => l.startsWith('DTSTART'))).toBe(true);
      expect(e.filter((l) => l === 'BEGIN:VALARM').length).toBeLessThanOrEqual(1); // never two alarms on one entry
      const a = e.indexOf('BEGIN:VALARM');
      if (a >= 0) { expect(e.slice(a).filter((l) => l.startsWith('TRIGGER:'))).toHaveLength(1); expect(e.slice(a, a + 4).some((l) => l.startsWith('DESCRIPTION:'))).toBe(true); }
    }
    const uids = vevents(text).filter((e) => !e.some((l) => l.startsWith('RECURRENCE-ID'))).map((e) => e.find((l) => l.startsWith('UID:'))!);
    expect(new Set(uids).size).toBe(uids.length);
  });

  it('a repeating event keeps its identity, skipped date and edited occurrence; a repeated export is identical', async () => {
    const h = await household();
    const a = make(h, choice()).text;
    const b = make(h, choice()).text;
    expect(b).toBe(a); // same data, same time: byte for byte
    const mine = vevents(a).filter((e) => e.includes(`UID:cal-${h.practice}@ledger.local`));
    expect(mine).toHaveLength(2); // the series and the one changed date
    expect(mine[0]).toEqual(expect.arrayContaining(['RRULE:FREQ=WEEKLY;BYDAY=WE', 'EXDATE;VALUE=DATE:20261118', 'EXDATE;VALUE=DATE:20261125', 'SUMMARY:Practice']));
    expect(mine[1]).toContain('RECURRENCE-ID;VALUE=DATE:20261125');
    expect(mine[1]).toContain('SUMMARY:Practice (moved)');
    // across a later export the ids do not change, only the time stamp does
    const later = make(h, choice(), '2026-11-10T08:00:00.000Z').text;
    const ids = (t: string) => unfold(t).filter((l) => l.startsWith('UID:'));
    expect(ids(later)).toEqual(ids(a));
    expect(later).not.toBe(a);
  });

  it('timed and all-day dates are written the right way; family and Finance ids keep their conventions', async () => {
    const h = await household();
    const text = make(h, choice()).text;
    const kitchen = vevents(text).find((e) => e.includes('SUMMARY:Start: Test Kitchen'))!;
    expect(kitchen).toEqual(expect.arrayContaining(['DTSTART;VALUE=DATE:20261205', 'DTEND;VALUE=DATE:20261206']));
    expect(vevents(text).some((e) => e.some((l) => /^UID:bill-\d+-2026-12-01@ledger\.local$/.test(l)))).toBe(true);
    expect(vevents(text).some((e) => e.some((l) => /^UID:family-birthday-\d+-2026-11-12@ledger\.local$/.test(l)))).toBe(false); // covered below
  });
});

describe('alarms', () => {
  it('a stored event keeps its reminder; a timed item gets one an hour before; an all-day Task has none; one alarm at most per entry', async () => {
    const h = await household();
    const text = make(h, choice()).text;
    const practice = vevents(text).find((e) => e.includes('SUMMARY:Practice'))!;
    expect(practice).toContain('TRIGGER:-PT30M');
    const task = vevents(text).find((e) => e.includes('SUMMARY:Call the plumber'))!;
    expect(task).toContain('TRIGGER:-PT60M');
    const proj = vevents(text).find((e) => e.includes('SUMMARY:Start: Test Kitchen'))!;
    expect(proj.some((l) => l.includes('TRIGGER'))).toBe(false);
    const fin = vevents(text).find((e) => e.some((l) => l.startsWith('SUMMARY:Mortgage payment')))!;
    expect(fin).toContain('TRIGGER:-P1D'); // Finance's own alarm, unchanged
    expect(fin.slice(fin.indexOf('BEGIN:VALARM')).find((l) => l.startsWith('DESCRIPTION:'))).toBe('DESCRIPTION:Mortgage payment'); // alarm text is amount-free too
  });

  it('turning alarms off removes every alarm, including a stored event\'s', async () => {
    const h = await household();
    const r = make(h, choice({ alarms: false }));
    expect(r.text).not.toContain('VALARM');
    expect(r.alarmCount).toBe(0);
    expect(make(h, choice()).alarmCount).toBeGreaterThan(2);
  });

  it('an action deadline is reminded and information is not (provider alarm, else the timed default)', () => {
    const base = { sourceModule: 'bills', sourceRecordId: 'o:1', title: 'x', date: '2026-12-01', allDay: true, priority: 'low', status: 'open', openSource: () => {} } as unknown as DerivedItem;
    expect(exportAlarm({ ...base, icsAlarmMinutes: 1440 }, true)).toBe(1440);
    expect(exportAlarm(base, true)).toBeUndefined();
    expect(exportAlarm({ ...base, allDay: false, time: '09:00' }, true)).toBe(60);
    expect(exportAlarm({ ...base, icsAlarmMinutes: 1440 }, false)).toBeUndefined();
  });
});

describe('duplicates are decided by the existing coveredBy ids, after the layers are chosen', () => {
  it('a family birthday covered by a stored Birthday event is written once while that event is in the file, and returns when it is not', async () => {
    const h = await household();
    const both = make(h, choice({ providerIds: ['family'] }));
    expect(both.text.match(/Sam Example's birthday/g)).toHaveLength(1);
    expect(both.text).toContain(`UID:cal-${h.bday}@ledger.local`);
    expect(both.coveredCount).toBe(1);
    const familyOnly = make(h, choice({ localIds: [], providerIds: ['family'] }));
    expect(familyOnly.text).toMatch(/UID:family-birthday-\d+-2026-11-12@ledger\.local/);
    expect(familyOnly.coveredCount).toBe(0);
  });

  const item = (over: Partial<DerivedItem>): DerivedItem => ({ id: 'x', sourceModule: 'bills', sourceRecordId: 'o:1', title: 'Due: Test Power', date: '2026-12-01', allDay: true, priority: 'medium', status: 'open', openSource: () => {}, ...over });
  const fin = item({ id: 'ledger:scheduled-9:2026-12-01', sourceModule: 'ledger', sourceRecordId: 'scheduled:9', title: 'Test Power $80.00', icsPlainTitle: 'Test Power', icsPlainDetail: 'Scheduled payment to approve.', icsUid: 'bill-9-2026-12-01@ledger.local' });
  const bill = item({ id: 'bills:due-1-a:2026-12-01', icsUid: 'bills-1-a@ledger.local', coveredBy: 'ledger:scheduled-9:2026-12-01' });
  const layers = [{ id: PERSONAL_ID, name: 'Personal', color: '#4a7bd0', sourceType: 'local' as const }, { id: FINANCE_ID, name: 'Finance', color: '#2f8f6b', sourceType: 'derived' as const, providerId: 'ledger' }];
  const run = (providerIds: string[]) => buildExport({ layers, events: [], derived: { ledger: [fin], bills: [bill] }, choice: { localIds: [], providerIds, amounts: false, alarms: true }, today: TODAY, nowIso: NOW });

  it('a Bills marker covered by a Finance payment is written once; without Finance it is kept, so neither disappears', () => {
    const both = run(['bills', 'ledger']);
    expect(titles(both.text)).toEqual(['Test Power']);
    expect(both.coveredCount).toBe(1);
    expect(titles(run(['bills']).text)).toEqual(['Due: Test Power']);
    expect(titles(run(['ledger']).text)).toEqual(['Test Power']);
  });

  it('two different entries that share a title and date are both kept, and never share an id', () => {
    const a = item({ id: 'a:1:2026-12-01', sourceModule: 'projects', icsUid: 'same@x' });
    const b = item({ id: 'a:2:2026-12-01', sourceModule: 'projects', icsUid: 'same@x' });
    const r = buildExport({ layers, events: [], derived: { projects: [a, b] }, choice: { localIds: [], providerIds: ['projects'], amounts: false, alarms: true }, today: TODAY, nowIso: NOW });
    const uids = vevents(r.text).map((e) => e.find((l) => l.startsWith('UID:')));
    expect(uids).toHaveLength(2);
    expect(new Set(uids).size).toBe(2);
  });
});

describe('the dialog\'s choices', () => {
  it('start from the Calendar\'s visibility but never write it back', async () => {
    const h = await household();
    const offered = offeredLayers(h.layers, ['family', 'tasks', 'projects', 'ledger', 'bills']);
    expect(offered.filter((l) => l.kind === 'provider').map((l) => l.providerId)).toEqual(['family', 'tasks', 'bills', 'projects', 'ledger']);
    expect(offeredLayers(h.layers, ['ledger']).map((l) => l.key)).toEqual([`l:${PERSONAL_ID}`, 'p:ledger']); // a layer whose provider is not registered is not offered
    const keys = defaultKeys(offered, (id) => id === PERSONAL_ID || id === FAMILY_ID);
    expect(keys).toEqual([`l:${PERSONAL_ID}`, 'p:family']);
    const c = choiceOf([...keys, 'p:ledger'], offered, false, true);
    expect(c).toEqual({ localIds: [PERSONAL_ID], providerIds: ['family', 'ledger'], amounts: false, alarms: true });
    make(h, c);
    expect(localStorage.getItem('calendar-hidden-layers')).toBeNull();
    expect((localStorage as unknown as { keys: () => string[] }).keys()).toEqual([]);
  });

  it('the preview shows every selected layer, soonest first', async () => {
    const h = await household();
    const r = make(h, choice());
    expect(r.preview.length).toBeLessThanOrEqual(8);
    expect(new Set(r.preview.map((e) => e.layer)).size).toBeGreaterThanOrEqual(4);
    expect(r.preview.map((e) => e.date)).toEqual([...r.preview.map((e) => e.date)].sort());
    expect(spread([], 8)).toEqual([]);
    expect(r.layers.map((l) => l.name)).toEqual(['Your calendars', 'Family', 'Tasks', 'Projects', 'Finance']);
  });

  it('a layer with nothing scheduled is reported as empty, and a provider that fails or is missing is reported as not read, never as empty', async () => {
    registerDueProvider({ id: 'r43-broken', layerName: 'Broken', color: '#000000', getDueItems: () => { throw new Error('boom'); } });
    registerDueProvider({ id: 'r43-empty', layerName: 'Empty', color: '#000000', getDueItems: () => [] });
    const [broken, empty, missing] = await readProviders(['r43-broken', 'r43-empty', 'r43-nope'], TODAY);
    expect(broken).toMatchObject({ ok: false, items: [], error: 'boom' });
    expect(empty).toMatchObject({ ok: true, items: [] });
    expect(missing.ok).toBe(false);
  });
});
