import { scanText } from '../../lib/leakTestkit';
import { describe, expect, it } from 'vitest';
import type { FinanceDB } from '../../db';
import type { ModuleRecord } from '../../core/entities';
import { derivedId, type DerivedItem } from '../../core/dueProvider';
import { addMonths } from '../../lib/dates';
import { dropCovered } from '../calendar/markerCoordination';
import { deadlineKey } from '../services/contract';
import { servicesDueItems } from '../services/dueProvider';
import { billsDueItems, horizonEnd, servicesDeadlineKey } from './dueProvider';
import { createObligation } from './data';
import { applyServiceLink, previewServiceLink } from './crossLinks';
import { applyLifecycle, previewLifecycle, type LcAction } from './lifecycleData';
import { loadBillTasks } from './tasks';
import { financeSnapshot, fresh, monthly, ob } from './billsTestkit';
import type { ObligationData } from './model';

/**
 * B4 on the Calendar: markers are WORKED OUT when the Calendar draws, over the same rolling 12 months as before. Nothing is stored for a future date, titles carry no amount
 * or note, a recorded renewal repeats on its cadence without creating records, and a linked Household Services arrangement can stand in for a Bills marker only for the SAME
 * kind of date on the SAME day. Invented data only.
 */
const TODAY = '2026-11-20';
const Q = { from: TODAY, to: addMonths(TODAY, 12), today: TODAY, overdueDays: 0 };
const money = (c: number) => `$${(c / 100).toFixed(2)}`;
const mk = (over: Partial<ObligationData> = {}): ObligationData => ob({ title: 'Streamly Premium', providerNameSnapshot: 'Streamly', type: 'subscription', need: 'flexible', amountKind: 'fixed', prices: [{ from: '2026-01-01', cents: 1499, label: '' }], schedule: monthly(12, '2026-01'), trackingSince: '2026-01-01', payment: { how: 'auto', fundingAccountId: null }, notes: 'a private note 4242', ...over }, TODAY);
const make = async (over: Partial<ObligationData> = {}) => { const d = fresh('b4cal'); return { d, id: (await createObligation({ data: mk(over), provider: { name: 'Streamly' }, today: TODAY }, d)).id }; };
const go = async (d: FinanceDB, id: number, a: LcAction) => { const p = await previewLifecycle(id, a, TODAY, money, d); if (p.problem) throw new Error(p.problem); return applyLifecycle(id, a, p.token, TODAY, d); };
const renewal = (over: Partial<Extract<LcAction, { type: 'renewal' }>> = {}): LcAction => ({ type: 'renewal', renewalDate: '2027-04-15', cadence: 'annual', auto: true, noticeDays: null, noticeByDate: null, changes: 'unknown', confirmed: true, note: 'my private renewal note', ...over });
const confirm = (over: Partial<Extract<LcAction, { type: 'cancel-confirm' }>> = {}): LcAction => ({ type: 'cancel-confirm', confirmedOn: '2026-11-19', effectiveOn: '2027-01-31', providerRef: 'REF-9', finalCharge: 'unknown', finalChargeCents: null, refundCents: null, accessUntil: null, note: 'my private cancel note', ...over });
const markers = async (d: FinanceDB, kind?: string) => (await billsDueItems(d, Q)).filter((i) => !i.id.includes(':due-') && (!kind || i.id.startsWith(`bills:${kind}-`)));

describe('B4 Calendar: renewals repeat on their cadence inside the rolling 12 months, derived and never stored', () => {
  it('an annual renewal shows once in the window; a monthly one shows every month and stops at the horizon; none of it is stored', async () => {
    const a = await make();
    await go(a.d, a.id, renewal());
    expect((await markers(a.d, 'renewal')).map((i) => i.date)).toEqual(['2027-04-15']);
    const b = await make();
    await go(b.d, b.id, renewal({ renewalDate: '2026-11-25', cadence: 'monthly' }));
    const dates = (await markers(b.d, 'renewal')).map((i) => i.date);
    expect(dates[0]).toBe('2026-11-25');
    expect(dates.length).toBeGreaterThanOrEqual(12);
    expect(dates.every((x) => x <= horizonEnd(TODAY))).toBe(true);
    expect(new Set(dates).size).toBe(dates.length); // each date once
    expect(await b.d.dueItems.count()).toBe(0);
    expect((await b.d.moduleRecords.toArray()).filter((r) => r.module === 'calendar').length).toBe(0);
    expect((await loadBillTasks(b.d)).length).toBe(0); // and no Task for an automatic renewal, let alone twelve
  });

  it('ids are stable between two reads and between devices\' clocks of the same day; a recorded renewal is "expected", never "renewed"', async () => {
    const { d, id } = await make();
    await go(d, id, renewal({ confirmed: false }));
    const one = await markers(d, 'renewal'), two = await markers(d, 'renewal');
    expect(one.map((i) => i.id)).toEqual(two.map((i) => i.id));
    expect(one[0].id).toBe(derivedId('bills', `renewal-${id}`, '2027-04-15'));
    expect(one[0].title).toBe('Renewal expected: Streamly Premium');
    expect(one[0].detail).toMatch(/expected, not confirmed/);
    expect(one[0].detail).not.toMatch(/renewed successfully|has renewed/i);
  });

  it('a renewal date that is already past is shown as handled, and the next one is still ahead; nothing was made at the date', async () => {
    const { d, id } = await make();
    await go(d, id, renewal({ renewalDate: '2026-11-10', cadence: 'annual' }));
    const q = { ...Q, from: '2026-11-01' };
    const items = (await billsDueItems(d, q)).filter((i) => i.id.startsWith('bills:renewal-'));
    expect(items.map((i) => [i.date, i.status])).toEqual([['2026-11-10', 'handled'], ['2027-11-10', 'open']]);
  });

  it('a notice deadline and an expected renewal on one day are two markers; an open Task for the notice stands for ITS marker only', async () => {
    const { d, id } = await make();
    await go(d, id, renewal({ renewalDate: '2027-03-01', noticeByDate: '2027-03-01' }));
    const ids = (await markers(d)).map((i) => i.id.split(':')[1].replace(/-\d+$/, ''));
    expect(ids.sort()).toEqual(['notice', 'renewal']);
  });

  it('a manual renewal is an action: its Task suppresses the matching marker only when the Task is dated the same day', async () => {
    const { d, id } = await make();
    await go(d, id, renewal({ auto: false, renewalDate: '2027-02-01' }));
    const tasks = await loadBillTasks(d);
    expect(tasks.some((t) => t.data.title.startsWith('Renewal:'))).toBe(true);
    const t = tasks.find((x) => x.data.title.startsWith('Renewal:'))!;
    const shown = (await markers(d, 'renewal')).map((i) => i.date);
    expect(t.data.dueDate === '2027-02-01' ? shown.includes('2027-02-01') === false : shown.includes('2027-02-01')).toBe(true);
  });
});

describe('B4 Calendar: cancellation and price markers', () => {
  it('a confirmed cancellation shows its effective date and removes renewals after it; the markers are informational', async () => {
    const { d, id } = await make();
    await go(d, id, renewal({ renewalDate: '2027-04-15' }));
    await go(d, id, confirm());
    expect((await markers(d, 'renewal'))).toEqual([]);
    const c = await markers(d, 'cancel');
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ date: '2027-01-31', title: 'Cancellation effective: Streamly Premium', status: 'open', priority: 'low' });
    expect(c[0].id).toBe(derivedId('bills', `cancel-${id}`, '2027-01-31'));
  });

  it('a recorded price change shows on its day without an amount in the title or detail', async () => {
    const { d, id } = await make();
    await go(d, id, { type: 'price', from: '2027-01-01', until: null, cents: 1799, status: 'fixed', label: '', source: 'provider-notice', note: 'secret price note', });
    const p = await markers(d, 'price');
    expect(p.map((i) => [i.date, i.title])).toEqual([['2027-01-01', 'Price change: Streamly Premium']]);
    expect(p[0].detail).not.toMatch(/\d/);
  });

  it('titles and details never carry an amount, a note, a reference or an account: only the bill\'s own title and a short word', async () => {
    const { d, id } = await make();
    await go(d, id, renewal({ auto: false, noticeDays: 30 }));
    await go(d, id, { type: 'price', from: '2027-01-01', until: null, cents: 1799, status: 'fixed', label: 'intro', source: 'invoice', note: 'secret price note' });
    await go(d, id, confirm());
    const text = scanText(await billsDueItems(d, Q));
    expect(text).not.toMatch(/private|secret|4242|REF-9|1799|17\.99|14\.99|\$\d/);
  });

  it('building the markers writes nothing at all: every table is identical before and after', async () => {
    const { d, id } = await make();
    await go(d, id, renewal());
    await go(d, id, confirm());
    const before = JSON.stringify(await Promise.all(d.tables.map((t) => t.toArray())));
    await billsDueItems(d, Q);
    expect(JSON.stringify(await Promise.all(d.tables.map((t) => t.toArray())))).toBe(before);
    expect(await financeSnapshot(d)).toBe(await financeSnapshot(d));
  });

  it('a bill that was ended draws no future markers of any kind', async () => {
    const { d, id } = await make({ status: 'ended', endedOn: '2026-10-01', endReason: 'cancelled' });
    void id;
    expect((await markers(d)).length).toBe(0);
  });
});

describe('B4 Calendar and Household Services: a linked arrangement stands in only for the SAME kind of date on the SAME day', () => {
  const arrangement = async (d: FinanceDB, over: Record<string, unknown> = {}) => (await d.moduleRecords.add({ id: 880001, module: 'services', kind: 'arrangement', data: { title: 'House cleaners', status: 'active', providerNameSnapshot: 'Cleaning Co', renewalDate: '2027-04-15', noticeByDate: '2027-03-16', ...over }, createdAt: 1, updatedAt: 1, deletedAt: null } as ModuleRecord)) as number;
  const link = async (d: FinanceDB, id: number, arr: number) => { const p = await previewServiceLink(id, arr, 'linked', d); return applyServiceLink(id, arr, 'linked', p.token, TODAY, d); };
  const calendar = async (d: FinanceDB) => [...(await billsDueItems(d, Q)), ...(await servicesDueItems(d, Q))].map((i): DerivedItem & { source: { id: string; status: string; coveredBy?: string } } => ({ ...i, source: { id: i.id, status: i.status, ...(i.coveredBy ? { coveredBy: i.coveredBy } : {}) } }));

  it('the Bills id format for a Services marker is the Services one (a string contract, so the two can never drift apart)', () => {
    for (const k of ['renewal', 'notice'] as const) expect(servicesDeadlineKey(k, 12)).toBe(deadlineKey(k, 12));
  });

  it('same kind, same day, linked: the Bills marker is left out ONLY while the Services marker is shown; the Services marker is never the one hidden', async () => {
    const { d, id } = await make();
    await go(d, id, renewal({ renewalDate: '2027-04-15', noticeByDate: '2027-03-16' }));
    const arr = await arrangement(d);
    await link(d, id, arr);
    const all = await calendar(d);
    const shown = dropCovered(all).map((i) => i.id);
    expect(shown).toContain(derivedId('services', `renewal-${arr}`, '2027-04-15'));
    expect(shown).toContain(derivedId('services', `notice-${arr}`, '2027-03-16'));
    expect(shown).not.toContain(derivedId('bills', `renewal-${id}`, '2027-04-15'));
    expect(shown).not.toContain(derivedId('bills', `notice-${id}`, '2027-03-16'));
    // with the Services layer off, the Bills markers come back
    const billsOnly = dropCovered(all.filter((i) => i.sourceModule === 'bills')).map((i) => i.id);
    expect(billsOnly).toContain(derivedId('bills', `renewal-${id}`, '2027-04-15'));
  });

  it('a DIFFERENT date, a different kind, or an unlinked arrangement hides nothing; names alone never link anything', async () => {
    const { d, id } = await make();
    await go(d, id, renewal({ renewalDate: '2027-04-20', noticeByDate: '2027-03-16' })); // the renewal differs from Services' by five days
    const arr = await arrangement(d);
    expect(dropCovered(await calendar(d)).filter((i) => i.sourceModule === 'bills').length).toBe((await billsDueItems(d, Q)).length); // not linked: nothing hidden
    await link(d, id, arr);
    const shown = dropCovered(await calendar(d)).map((i) => i.id);
    expect(shown).toContain(derivedId('bills', `renewal-${id}`, '2027-04-20')); // different day: both shown
    expect(shown).toContain(derivedId('services', `renewal-${arr}`, '2027-04-15'));
    expect(shown).not.toContain(derivedId('bills', `notice-${id}`, '2027-03-16')); // same kind, same day: stood in for
  });

  it('a trial, a cancellation date and a price change have no Services equivalent: they are never covered', async () => {
    const { d, id } = await make();
    await go(d, id, { type: 'trial', startsOn: null, endsOn: '2026-12-01', paymentOnFile: 'unknown', conversion: 'unknown', convertsToCents: null, cadence: 'unknown', mustCancel: false, noticeBy: null, note: '', makePrices: false });
    await go(d, id, confirm());
    const arr = await arrangement(d);
    await link(d, id, arr);
    const items = await billsDueItems(d, Q);
    for (const kind of ['trial-', 'cancel-', 'price-']) for (const i of items.filter((x) => x.id.startsWith(`bills:${kind}`))) expect(i.coveredBy).toBeUndefined();
  });

  it('service VISITS are never touched, and linking changes no Services record and no financial total', async () => {
    const { d, id } = await make();
    const arr = await arrangement(d, { cadence: { mode: 'fixed', rule: { freq: 'weekly', interval: 2, byWeekday: [5], end: { type: 'never' } }, anchorDate: '2026-11-20' } });
    const servicesBefore = JSON.stringify(await d.moduleRecords.get(arr));
    const fin = await financeSnapshot(d);
    const visitsBefore = (await servicesDueItems(d, Q)).filter((i) => i.id.includes(':visit-')).map((i) => i.id);
    await link(d, id, arr);
    expect(JSON.stringify(await d.moduleRecords.get(arr))).toBe(servicesBefore);
    expect(await financeSnapshot(d)).toBe(fin);
    const shown = dropCovered(await calendar(d)).map((i) => i.id);
    for (const v of visitsBefore) expect(shown).toContain(v);
  });
});
