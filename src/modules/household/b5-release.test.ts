import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { makeTxnRef } from '../../lib/txnRef';
import { blankService } from '../assets/service';
import { insertService } from '../assets/serviceData';
import { devices } from '../bills/billsTestkit';
import { TODAY, digest, seed } from './householdSeed';
import { loadHouseholdOverview } from './overview';
import { HouseholdCardView, loadTodayState } from './todayCards';

/** B5 final release checks: Today's three distinct states, and period switching of the recorded-spending figure. Invented data; amounts worked out by hand. */
describe('Today card: no concerns, a successful zero, and unavailable are three different things', () => {
  it('a real failed read gives "unavailable" (never zero counts), writes nothing, and a retry gives the real counts', async () => {
    const { A } = devices();
    await seed(A.d);
    const before = await digest(A.d);
    const spy = vi.spyOn(A.d.txns, 'bulkGet').mockRejectedValue(new Error('read failed'));
    expect(await loadTodayState(TODAY, A.d)).toBe('unavailable');
    spy.mockRestore();
    expect(await digest(A.d)).toBe(before);
    expect(await loadTodayState(TODAY, A.d)).toMatchObject({ overlaps: 1, total: 1 });
  });

  it('a second-read failure is also "unavailable"', async () => {
    const { A } = devices();
    await seed(A.d);
    const real = A.d.txns.bulkGet.bind(A.d.txns);
    let n = 0;
    const spy = vi.spyOn(A.d.txns, 'bulkGet').mockImplementation(((...a: Parameters<typeof real>) => (++n === 2 ? Promise.reject(new Error('x')) : real(...a))) as never);
    expect(await loadTodayState(TODAY, A.d)).toBe('unavailable');
    spy.mockRestore();
  });

  it('a successful load of an empty household is real zero counts, not "unavailable"', async () => {
    const { A } = devices();
    expect(await loadTodayState(TODAY, A.d)).toEqual({ possibleDuplicates: 0, overlaps: 0, unknownSoon: 0, total: 0 });
  });

  it('markup: unavailable is a discreet notice with a link, no counts, no badge, no amount or name; zero counts list nothing; counts list only counts', () => {
    const bad = renderToStaticMarkup(h(HouseholdCardView, { state: 'unavailable' }));
    expect(bad).toMatch(/could not be read/);
    expect(bad).toMatch(/href="#\/household"/);
    expect(bad).not.toMatch(/badge|<li/);
    expect(bad.replace(/<[^>]*>/g, ' ')).not.toMatch(/[$\d]/); // the visible words hold no digit and no amount
    const zero = renderToStaticMarkup(h(HouseholdCardView, { state: { possibleDuplicates: 0, overlaps: 0, unknownSoon: 0, total: 0 } }));
    expect(zero).not.toMatch(/<li|badge|could not be read/);
    const some = renderToStaticMarkup(h(HouseholdCardView, { state: { possibleDuplicates: 1, overlaps: 2, unknownSoon: 0, total: 3 } }));
    expect(some).toMatch(/1 payment may be recorded twice/);
    expect(some).toMatch(/2 bills and services may describe the same expense/);
    expect(some).not.toMatch(/\$|could not be read/);
    expect(renderToStaticMarkup(h(HouseholdCardView, { state: undefined }))).toMatch(/Loading/);
  });
});

describe('Period switching of recorded spending', () => {
  /** The seed plus a payment OUTSIDE the last 30 days (5 Oct, $50.00) and its refund INSIDE them (20 Oct, $20.00), both on one Home & Assets record. */
  async function world() {
    const { A } = devices();
    const s = await seed(A.d);
    const add = async (date: string, amountCents: number) => (await A.d.txns.get((await A.d.txns.add({ accountId: s.acct, date, amountCents, payee: 'Window Co', memo: '', status: 'cleared', categoryId: null })) as number))!;
    const pay = await add('2026-10-05', -5000), back = await add('2026-10-20', 2000);
    await insertService(blankService(s.home, { title: 'Window repair', date: '2026-10-05', kind: 'repair', txnRefs: [makeTxnRef(pay), makeTxnRef(back)] }), A.d, TODAY);
    return A;
  }

  it('last 30 days (10 Oct to 8 Nov) versus last 90 days versus all time: Finance, typed and total move together, the refund counts in its own window, and every breakdown still adds up', async () => {
    const A = await world();
    const before = await digest(A.d);
    const p30 = await loadHouseholdOverview('last30', TODAY, A.d), p90 = await loadHouseholdOverview('last90', TODAY, A.d), all = await loadHouseholdOverview('all', TODAY, A.d);
    // last 30: $150.00 + $15.49 + $62.00 in October, the $20.00 refund (its $50.00 payment is on 5 Oct, outside), no typed amount (gutter cleaning is 5 Oct)
    expect([p30.spending.financeCents, p30.spending.typedCents, p30.spending.totalCents, p30.spending.moneyBackCents]).toEqual([15000 + 1549 + 6200 - 2000, 0, 20749, 2000]);
    // last 90 (11 Aug on) and all time: everything: 647.98 + 50.00 - 20.00
    for (const o of [p90, all]) expect([o.spending.financeCents, o.spending.typedCents, o.spending.totalCents]).toEqual([55298 + 5000 - 2000, 9500, 67798]);
    for (const o of [p30, p90, all]) {
      const s = o.spending;
      expect(s.totalCents).toBe(s.financeCents + s.typedCents);
      expect(Object.values(s.byAttribution).reduce((n, x) => n + x, 0)).toBe(s.totalCents); // exact additive attribution
      expect(s.byCategory.reduce((n, x) => n + x.cents, 0)).toBe(s.totalCents);
      expect(new Set(s.pieces.map((p) => p.key)).size).toBe(s.pieces.length);
      expect(s.reconciliation.explainsDifference).toBe(true);
    }
    // the $150.00 payment shared by three modules is one piece, credited to "shared", in every window that holds it
    for (const o of [p30, p90, all]) expect(o.spending.byAttribution.shared).toBe(15000);
    expect(p30.spending.pieces.some((p) => p.cents < 0)).toBe(true); // the refund is a counted piece on its own date
    // twelve-month commitments and the review list do not depend on the period; nothing was written
    expect(JSON.stringify(p30.commitments)).toBe(JSON.stringify(all.commitments));
    expect(JSON.stringify(p90.review)).toBe(JSON.stringify(all.review));
    expect(await digest(A.d)).toBe(before);
  });

  it('a typed amount follows its own date and an unknown is never turned into zero: the typed $95.00 (5 Oct) is in a window that holds 5 Oct and out of one that starts 6 Oct', async () => {
    const A = await world();
    const all = await loadHouseholdOverview('all', TODAY, A.d);
    const typed = all.spending.typed.find((t) => t.authoritative)!;
    expect([typed.cents, typed.date]).toEqual([9500, '2026-10-05']);
    const p30 = await loadHouseholdOverview('last30', TODAY, A.d);
    expect(p30.spending.typed.filter((t) => t.authoritative)).toEqual([]);
    expect(p30.spending.unknown).toEqual(all.spending.unknown); // unknown counts are reported as counts in every window, not as amounts
  });
});
