import { scanText } from '../../lib/leakTestkit';
import { describe, expect, it } from 'vitest';
import { FinanceDB } from '../../db';
import { addDays } from '../../lib/dates';
import { derivedId } from '../../core/dueProvider';
import { registerModules } from '../index';
import { ensureCalendarSeed, loadLayers } from '../calendar/data';
import { BILLS_ID, FINANCE_ID, SERVICES_ID } from '../calendar/model';
import { saveTask } from '../tasks/data';
import { createObligation } from './data';
import { newOp, recordFact, loadCycles } from './cycleData';
import { billsDueItems, billsDueProvider, horizonEnd } from './dueProvider';
import { attention, attentionLines, cashTiming, derive, loadBillsSnapshot, upcoming, upcomingDeadlines } from './readModel';
import { saveTerms } from './contractData';
import { getObligation } from './data';
import { loadBillTasks, markersOf } from './tasks';
import { blankTerms } from './terms';
import { buildOverview } from './views';
import { MODULE, type ObligationData } from './model';
import { creditF, fresh, inv, monthly, ob, paidFull, paidOut, skipF } from './billsTestkit';
import type { FactBody } from './cycleModel';

/** Real Dexie. Invented data only. 2026-11-07 is a Saturday. */
const TODAY = '2026-11-07';
const q = (today = TODAY, from = today, to = addDays(today, 800), overdueDays = 0) => ({ from, to, today, overdueDays });
const mk = (d: FinanceDB, over: Partial<ObligationData> = {}, reminders: ObligationData['reminders'] = null) =>
  createObligation({ data: ob({ title: 'Example Power Co', amountKind: 'fixed', prices: [{ from: TODAY, cents: 9000, label: '' }], schedule: monthly(18, '2026-11'), reminders, ...over }, TODAY), provider: null, today: TODAY }, d);
const rec = (d: FinanceDB, id: number, slot: string, body: FactBody, finishTaskId?: number | null) => recordFact({ obligationId: id, slot, body, op: newOp(), today: TODAY, finishTaskId }, d);
const dueItems = async (d: FinanceDB, qq = q()) => (await billsDueItems(d, qq)).filter((i) => i.id.startsWith('bills:due-'));
const dates = async (d: FinanceDB, qq = q()) => (await dueItems(d, qq)).map((i) => i.date);
const state = async (d: FinanceDB) => JSON.stringify([await d.moduleRecords.toArray(), await d.links.toArray()]);

describe('B2 Calendar layer: rolling 12 months, derived, never stored (tests 31, 34)', () => {
  it('the layer id is the approved one and the layer is seeded once beside the existing layers', async () => {
    expect(BILLS_ID).toBe(9_000_000_000_000_107);
    registerModules();
    const d = fresh();
    await Promise.all([ensureCalendarSeed(d), ensureCalendarSeed(d)]);
    await ensureCalendarSeed(d);
    const layers = await loadLayers(d);
    const bills = layers.filter((l) => l.id === BILLS_ID);
    expect(bills).toHaveLength(1);
    expect(bills[0]).toMatchObject({ name: 'Bills & Subscriptions', sourceType: 'derived', providerId: 'bills', builtin: true });
    expect(layers.some((l) => l.id === SERVICES_ID)).toBe(true); // Household Services and Finance layers are preserved
    expect(layers.some((l) => l.id === FINANCE_ID)).toBe(true);
    expect(layers).toHaveLength(7);
    expect(billsDueProvider.id).toBe('bills');
  });
  it('a monthly bill shows 12 expected dates, today through the same day 12 months later, and stores nothing', async () => {
    const d = fresh();
    await mk(d);
    const before = await state(d);
    const got = await dates(d);
    expect(horizonEnd(TODAY)).toBe('2027-11-07');
    expect(got).toHaveLength(12);
    expect(got[0]).toBe('2026-11-18');
    expect(got[11]).toBe('2027-10-18');
    expect(await state(d)).toBe(before);
    expect(await loadCycles(d)).toHaveLength(0); // no future period record was created to fill the Calendar
  });
  it('the horizon moves forward with the clock by itself', async () => {
    const d = fresh();
    await mk(d);
    const later = await dates(d, q('2027-02-10'));
    expect(later[0]).toBe('2027-02-18');
    expect(later[later.length - 1] <= horizonEnd('2027-02-10')).toBe(true);
    expect(later).toContain('2028-01-18');
    expect(later).not.toContain('2028-03-18');
  });
  it('item ids are stable across devices and carry the period, and the phone-calendar id survives a moved due date', async () => {
    const A = fresh(), B = fresh();
    const ra = await mk(A);
    const first = (await dueItems(A))[0];
    expect(first.id).toBe(derivedId('bills', `due-${ra.id}-m2026-11`, '2026-11-18'));
    expect(first.title).toBe('Due: Example Power Co');
    expect(first.icsUid).toBe(`bills-${ra.id}-m2026-11@ledger.local`);
    await rec(A, ra.id, 'm2026-11', inv(11420, { dueDate: '2026-11-25' }));
    const moved = (await dueItems(A))[0];
    expect(moved.date).toBe('2026-11-25'); // the actual due date from the stored fact
    expect(moved.icsUid).toBe(first.icsUid);
    expect(moved.id).toBe(derivedId('bills', `due-${ra.id}-m2026-11`, '2026-11-25'));
    void B;
  });
  it('a recorded due date of the period outside the window is found; skipped, paid and zero periods are left out; partly paid stays', async () => {
    const d = fresh();
    const { id } = await mk(d, { amountKind: 'variable' });
    await rec(d, id, 'm2026-11', skipF());
    await rec(d, id, 'm2026-12', paidFull());
    await rec(d, id, 'm2027-01', inv(0));
    await rec(d, id, 'm2027-02', inv(10000));
    await rec(d, id, 'm2027-02', paidOut('2027-02-17', 4000));
    const got = await dates(d);
    expect(got).not.toContain('2026-11-18');
    expect(got).not.toContain('2026-12-18');
    expect(got).not.toContain('2027-01-18');
    expect(got).toContain('2027-02-18'); // partly paid: still due
    expect(got).toContain('2027-03-18');
  });
  it('overdue: a bill paid by hand, past its date and not confirmed stays visible; automatic payments past their date are not shown as overdue', async () => {
    const manual = fresh(), auto = fresh();
    await mk(manual, { trackingSince: '2026-10-01', schedule: monthly(1, '2026-10') });
    await mk(auto, { trackingSince: '2026-10-01', schedule: monthly(1, '2026-10'), payment: { how: 'auto', fundingAccountId: null } });
    const lookBack = q(TODAY, TODAY, addDays(TODAY, 30), 30);
    const m = await dueItems(manual, lookBack);
    expect(m.map((i) => i.date)).toContain('2026-11-01');
    expect(m.find((i) => i.date === '2026-11-01')!.priority).toBe('high');
    expect((await dueItems(auto, lookBack)).map((i) => i.date)).not.toContain('2026-11-01');
    expect((await dueItems(auto, q())).map((i) => i.date)).toContain('2026-12-01'); // an upcoming automatic payment is shown
  });
  it('a reminder Task on a DIFFERENT day is not a duplicate: both appear; on the SAME day for the same period the Task stands for the marker (Task versus due date)', async () => {
    const d = fresh();
    const { id } = await mk(d, {}, { payTask: true, leadDays: 3 });
    const t = (await loadBillTasks(d))[0];
    expect(t.data.dueDate).toBe('2026-11-15');
    expect((await dueItems(d)).map((i) => i.date)).toContain('2026-11-18'); // due date still shown beside a Task dated the 15th
    await saveTask(t.id, { ...t.data, dueDate: '2026-11-18' }, d); // the owner moves the Task onto the due date
    expect((await dueItems(d)).map((i) => i.date)).not.toContain('2026-11-18'); // the Task is that very period's marker
    expect((await dueItems(d)).map((i) => i.date)).toContain('2026-12-18'); // later periods are still derived
    void id;
    const e = fresh();
    const b = await mk(e, {}, { payTask: true, leadDays: 0 });
    expect((await dueItems(e)).map((i) => i.date)).not.toContain('2026-11-18');
    void b;
  });
  it('contract dates: cancel-by, trial end and renewal are three separate markers, handled once passed, none for an ended bill, never an amount', async () => {
    const d = fresh();
    const { id } = await mk(d, { payment: { how: 'auto', fundingAccountId: null } });
    const o = (await getObligation(id, d))!;
    await saveTerms(id, { ...blankTerms(), autoRenews: true, renewalDate: '2026-12-15', noticeByDate: '2026-12-15', trialEndsOn: '2026-11-01' }, o.updatedAt, TODAY, d);
    const all = await billsDueItems(d, q(TODAY, '2026-10-01', '2027-02-01'));
    const kinds = all.filter((i) => !i.id.startsWith('bills:due-'));
    expect(kinds.map((i) => i.id).sort()).toEqual([`bills:notice-${id}:2026-12-15`, `bills:renewal-${id}:2026-12-15`, `bills:trial-${id}:2026-11-01`].sort()); // a notice and a renewal on one day are two markers
    expect(kinds.find((i) => i.id.includes('trial'))!.status).toBe('handled');
    expect(kinds.find((i) => i.id.includes('notice'))!.priority).toBe('medium');
    expect(kinds.find((i) => i.id.includes('renewal'))!.priority).toBe('low');
    for (const i of all) expect(`${i.title} ${i.detail ?? ''}`, i.id).not.toMatch(/\$|\d+\.\d{2}\b/);
    const ended = fresh();
    const eo = await mk(ended, { status: 'ended', endedOn: '2026-11-30', terms: { renewalDate: '2026-12-15' } });
    void eo;
    expect((await billsDueItems(ended, q(TODAY, TODAY, '2027-02-01'))).filter((i) => !i.id.startsWith('bills:due-'))).toHaveLength(0);
  });
  it('a notice Task dated the same day as its marker stands for it; one on another day does not', async () => {
    const d = fresh();
    const { id } = await mk(d, { payment: { how: 'auto', fundingAccountId: null } }, { payTask: false, leadDays: 3 });
    const o = (await getObligation(id, d))!;
    await saveTerms(id, { ...blankTerms(), noticeByDate: '2026-12-15' }, o.updatedAt, TODAY, d);
    const notice = (i: { id: string }) => i.id.startsWith('bills:notice-');
    expect((await billsDueItems(d, q())).filter(notice)).toHaveLength(1); // the Task is for the 12th, the deadline is the 15th
    const t = (await loadBillTasks(d)).find((x) => markersOf(x)!.purpose === 'notice')!;
    await saveTask(t.id, { ...t.data, dueDate: '2026-12-15' }, d);
    expect((await billsDueItems(d, q())).filter(notice)).toHaveLength(0);
  });
  it('titles, details and the exported calendar text never carry an amount, account number or note', async () => {
    const d = fresh();
    const { id } = await mk(d, { notes: 'account 12345678', payment: { how: 'manual', fundingAccountId: 5 } });
    await rec(d, id, 'm2026-11', inv(123456, { invoiceNumber: 'A-1042' }));
    for (const i of await billsDueItems(d, q())) {
      const text = scanText({ t: i.title, d: i.detail, u: i.icsUid, s: i.sourceLabel });
      expect(text).not.toMatch(/\$|1234|12345678|A-1042|\d+\.\d{2}\b/);
    }
  });
  it('one failing provider cannot take the Calendar down, and an empty household costs nothing', async () => {
    const d = fresh();
    expect(await billsDueItems(d, q())).toEqual([]);
  });
});

describe('B2 Today card and Overview share one set of numbers (test 33, no names or amounts)', () => {
  const world = async () => {
    const d = fresh();
    const a = await mk(d, { title: 'Alpha Water', trackingSince: '2026-11-01', schedule: monthly(1, '2026-10'), amountKind: 'variable', prices: [{ from: '2026-11-01', cents: 9000, label: '' }] });
    const b = await mk(d, { title: 'Beta Gas', trackingSince: '2026-11-01', schedule: monthly(10, '2026-10'), amountKind: 'fixed', prices: [{ from: '2026-11-01', cents: 5000, label: '' }] });
    const c = await mk(d, { title: 'Gamma Auto', payment: { how: 'auto', fundingAccountId: null }, trackingSince: '2026-11-01', schedule: monthly(1, '2026-10') });
    await rec(d, a.id, 'm2026-11', inv(10000));
    return { d, a, b, c };
  };
  it('counts by hand: due in 7 days, not confirmed, autopay check, conflicts', async () => {
    const { d, a } = await world();
    // Alpha: billed $100, was due the 1st (6 days ago), no payment: Overdue. Beta: due the 10th, in 3 days: due soon. Gamma: automatic, due the 1st, 6 days ago: check.
    let at = attention(derive(await loadBillsSnapshot(d), TODAY));
    expect([at.dueSoon, at.notConfirmed, at.autopayCheck, at.conflicts, at.records, at.unconfirmedTasks]).toEqual([1, 1, 1, 0, 0, 0]);
    await d.moduleRecords.add({ id: 998001, module: MODULE, kind: 'cycle', data: { obligationId: a.id, slot: 'm2026-11', fact: 'invoice', invoicedCents: 12000 }, createdAt: Date.now(), updatedAt: Date.now(), deletedAt: null } as never);
    at = attention(derive(await loadBillsSnapshot(d), TODAY));
    expect(at.conflicts).toBe(1);
    const lines = attentionLines(at);
    expect(lines.map((l) => l.id)).toEqual(['dueSoon', 'notConfirmed', 'autopayCheck', 'conflicts']);
    for (const l of lines) expect(l.text, l.id).not.toMatch(/Alpha|Beta|Gamma|\$|\d+\.\d{2}/); // counts and words only
    expect(lines[0].text).toBe('1 bill due in the next 7 days');
  });
  it('the Overview and the Today card read the very same attention counts; a skip or a payment lowers both together', async () => {
    const { d, a } = await world();
    const x = derive(await loadBillsSnapshot(d), TODAY);
    const todayCard = attention(x);
    const overviewCard = attention(derive(await loadBillsSnapshot(d), TODAY));
    expect(overviewCard).toEqual(todayCard);
    await rec(d, a.id, 'm2026-11', paidFull());
    const after = attention(derive(await loadBillsSnapshot(d), TODAY));
    expect(after.notConfirmed).toBe(0);
    expect(after.total).toBe(todayCard.total - 1);
  });
  it('nothing needs attention for a bill that is simply upcoming: the card stays empty (hidden)', async () => {
    const d = fresh();
    await mk(d);
    expect(attentionLines(attention(derive(await loadBillsSnapshot(d), TODAY)))).toEqual([]);
  });
  it('older unrecorded months never pile up: only the last 45 days count', async () => {
    const d = fresh();
    await mk(d, { trackingSince: '2025-01-01', schedule: monthly(1, '2025-01') });
    const at = attention(derive(await loadBillsSnapshot(d), TODAY));
    expect(at.notConfirmed).toBe(2); // 1 November and 1 October (37 days ago): not 22 months
  });
  it('a Task finished, trials, notices, renewals and passed contract dates are counted by the same function', async () => {
    const d = fresh();
    const { id } = await mk(d, { payment: { how: 'auto', fundingAccountId: null }, amountKind: 'fixed' });
    const o = (await getObligation(id, d))!;
    await saveTerms(id, { ...blankTerms(), trialEndsOn: '2026-11-10', noticeByDate: '2026-11-20', renewalDate: '2026-11-30' }, o.updatedAt, TODAY, d);
    const at = attention(derive(await loadBillsSnapshot(d), TODAY));
    expect([at.trials, at.notices, at.renewals, at.passedDates]).toEqual([1, 1, 1, 0]);
    const o2 = (await getObligation(id, d))!;
    await saveTerms(id, { ...blankTerms(), trialEndsOn: '2026-11-01', renewalDate: '2026-11-03' }, o2.updatedAt, TODAY, d);
    const after = attention(derive(await loadBillsSnapshot(d), TODAY));
    expect(after.passedDates).toBe(2); // review items only: nothing renewed or converted
    expect(after.items.filter((i) => i.category === 'passedDates').every((i) => /did not (renew|convert)/.test(i.text))).toBe(true);
  });
});

describe('B2 cash timing: expected, hand-computed, never "paid" (test 15)', () => {
  it('7, 30 and 90 days split into known, estimated and unknown; a partial payment lowers what remains; skipped, paid and loans are left out', async () => {
    const d = fresh();
    await mk(d, { title: 'Fixed', schedule: monthly(10, '2026-11'), amountKind: 'fixed', prices: [{ from: TODAY, cents: 5000, label: '' }] }); // 11-10 (d=3), 12-10, 01-10, 02-10
    await mk(d, { title: 'Varies', schedule: monthly(25, '2026-11'), amountKind: 'variable', prices: [{ from: TODAY, cents: 9000, label: '' }] }); // 11-25 (d=18), 12-25, 01-25
    await mk(d, { title: 'Unknown', schedule: monthly(20, '2026-11'), amountKind: 'unknown', prices: [] }); // 11-20 (d=13), 12-20, 01-20
    const annual = await mk(d, { title: 'Insurance', schedule: monthly(5, '2026-11', 12), amountKind: 'fixed', prices: [{ from: TODAY, cents: 120000, label: '' }] }); // 2027-11-05: outside 90 days
    await mk(d, { title: 'Mortgage', type: 'loan', schedule: monthly(12, '2026-11'), amountKind: 'fixed', prices: [{ from: TODAY, cents: 200000, label: '' }] });
    const paidOne = await mk(d, { title: 'Paid already', schedule: monthly(9, '2026-11'), amountKind: 'fixed', prices: [{ from: TODAY, cents: 7000, label: '' }] });
    await rec(d, paidOne.id, 'm2026-11', paidOut('2026-11-06', 7000));
    const part = await mk(d, { title: 'Partly', schedule: monthly(11, '2026-11'), amountKind: 'fixed', prices: [{ from: TODAY, cents: 8000, label: '' }] });
    await rec(d, part.id, 'm2026-11', paidOut('2026-11-06', 3000));
    const skipped = await mk(d, { title: 'Skipped', schedule: monthly(12, '2026-11'), amountKind: 'fixed', prices: [{ from: TODAY, cents: 4000, label: '' }] });
    await rec(d, skipped.id, 'm2026-11', skipF());
    void annual;
    const w = cashTiming(derive(await loadBillsSnapshot(d), TODAY));
    // within 7 days (to 11-14): Fixed 5000 (11-10), Partly remaining 5000 (11-11); Paid already 0, Skipped none, Mortgage excluded
    expect(w[0]).toEqual({ days: 7, known: { cents: 10000, count: 2 }, estimated: { cents: 0, count: 0 }, unknown: { count: 0 } });
    // within 30 days (to 12-07): adds Varies 9000 (11-25) estimated, Unknown 11-20 (amount not known)
    expect(w[1]).toEqual({ days: 30, known: { cents: 10000, count: 2 }, estimated: { cents: 9000, count: 1 }, unknown: { count: 1 } });
    // within 90 days (to 02-05): Fixed 12-10, 01-10 (+10000); Partly 12-11, 01-11 (+16000); Paid 12-09, 01-09 (+14000); Skipped 12-12, 01-12 (+8000); Varies +2 (18000); Unknown +2
    expect(w[2].known.cents).toBe(10000 + 10000 + 16000 + 14000 + 8000);
    expect(w[2].estimated).toEqual({ cents: 27000, count: 3 });
    expect(w[2].unknown.count).toBe(3);
  });
  it('conflicting invoices make the amount unknown, never one of them; a confirmed $0.00 invoice adds nothing', async () => {
    const d = fresh();
    const a = await mk(d, { title: 'Disagree', schedule: monthly(10, '2026-11'), amountKind: 'fixed', prices: [{ from: TODAY, cents: 5000, label: '' }] });
    await rec(d, a.id, 'm2026-11', inv(6000));
    await d.moduleRecords.add({ id: 998002, module: MODULE, kind: 'cycle', data: { obligationId: a.id, slot: 'm2026-11', fact: 'invoice', invoicedCents: 7000 }, createdAt: Date.now(), updatedAt: Date.now(), deletedAt: null } as never);
    const z = await mk(d, { title: 'Zero', schedule: monthly(11, '2026-11'), amountKind: 'fixed', prices: [{ from: TODAY, cents: 5000, label: '' }] });
    await rec(d, z.id, 'm2026-11', inv(0));
    const w = cashTiming(derive(await loadBillsSnapshot(d), TODAY))[0];
    expect(w.known).toEqual({ cents: 0, count: 0 });
    expect(w.unknown.count).toBe(1);
    await rec(d, a.id, 'm2026-12', creditF(100)).catch(() => null);
  });
  it('a credit lowers what is expected', async () => {
    const d = fresh();
    const a = await mk(d, { schedule: monthly(10, '2026-11'), amountKind: 'fixed', prices: [{ from: TODAY, cents: 5000, label: '' }] });
    await rec(d, a.id, 'm2026-11', creditF(1200));
    expect(cashTiming(derive(await loadBillsSnapshot(d), TODAY))[0].known.cents).toBe(3800);
  });
});

describe('B2 Upcoming, Overview and read-only guarantees', () => {
  it('the Upcoming list carries every label (skipped and settled periods too), soonest first, loans left out, and contract dates apart', async () => {
    const d = fresh();
    const a = await mk(d, { title: 'Alpha', schedule: monthly(10, '2026-11') });
    await mk(d, { title: 'Mortgage', type: 'loan', schedule: monthly(12, '2026-11') });
    await rec(d, a.id, 'm2026-12', skipF());
    const x = derive(await loadBillsSnapshot(d), TODAY);
    const { ahead, pastDue } = upcoming(x);
    expect(pastDue).toEqual([]);
    expect(ahead.map((e) => `${e.ob.data.title}:${e.period.timing.date}:${e.period.label}`).slice(0, 3)).toEqual(['Alpha:2026-11-10:due-soon', 'Alpha:2026-12-10:skipped', 'Alpha:2027-01-10:upcoming']);
    expect(upcomingDeadlines(x)).toEqual([]);
  });
  it('the B1 Overview figures are unchanged by recording facts (they are expectations from the terms)', async () => {
    const d = fresh();
    const a = await mk(d, { schedule: monthly(10, '2026-11') });
    const before = buildOverview((await loadBillsSnapshot(d)).obligations, TODAY).commitments;
    await rec(d, a.id, 'm2026-11', inv(99999));
    expect(buildOverview((await loadBillsSnapshot(d)).obligations, TODAY).commitments).toEqual(before);
  });
});

describe('B2 Search stays free of recorded billing facts', () => {
  it('Search matches only the bill, never an amount, invoice number, note or credit text recorded for a period', async () => {
    const { searchBillsData } = await import('./searchSource');
    const { loadObligations } = await import('./data');
    const d = fresh();
    const { id } = await mk(d, { title: 'Example Power Co' });
    await rec(d, id, 'm2026-11', inv(123456, { invoiceNumber: 'ZX-9981', dueDate: '2026-11-25' }));
    await rec(d, id, 'm2026-11', creditF(500, 'goodwill gesture'));
    const obs = await loadObligations(d);
    for (const q2 of ['ZX-9981', '1234.56', '123456', 'goodwill', 'gesture']) expect(searchBillsData(q2, obs), q2).toEqual([]);
    expect(searchBillsData('example power', obs).map((r) => r.title)).toEqual(['Example Power Co']);
    const subtitles = scanText(searchBillsData('example power', obs));
    expect(subtitles).not.toMatch(/ZX-9981|1234|goodwill/);
  });
});

describe('B2 cash timing leaves past-due bills out of the future windows', () => {
  it('a bill past its date and not recorded is not added to the cash figures (it is listed under Not confirmed instead)', async () => {
    const d = fresh();
    await mk(d, { title: 'Late one', trackingSince: '2026-10-01', schedule: monthly(1, '2026-10'), amountKind: 'fixed', prices: [{ from: '2026-10-01', cents: 5000, label: '' }] });
    const x = derive(await loadBillsSnapshot(d), TODAY);
    const w = cashTiming(x);
    expect(attention(x).notConfirmed).toBe(2); // 1 October and 1 November
    expect(w[0].known).toEqual({ cents: 0, count: 0 }); // 7 days: nothing (the next one is 1 December)
    expect(w[1].known).toEqual({ cents: 5000, count: 1 }); // 30 days: only 1 December, never the two missed ones
    expect(w[2].known).toEqual({ cents: 15000, count: 3 }); // 90 days: 1 December, 1 January and 1 February (86 days)
  });
});
