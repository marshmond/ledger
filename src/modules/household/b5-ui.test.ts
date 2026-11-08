import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { maskMoney } from '../../ui/TxnRefs';
import { devices } from '../bills/billsTestkit';
import { TODAY, seed } from './householdSeed';
import { loadHouseholdOverview } from './overview';
import { ActionsCard, AreasCard, CommitmentsCard, ManagedCard, ReadMe, ReviewCard, SpendingCard, TraceCard, UpcomingCard } from './Parts';
import OverviewPage from './OverviewPage';

/**
 * B5 screen markup (static): privacy with Hide Amounts, accessible structure, honest loading. This renders the real components to markup, so it proves structure and text.
 * It is NOT a real screen-reader, keyboard or phone test (those are in the browser acceptance and the owner checklist, and real devices are not tested).
 */
const shown = (c: number) => `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const hidden = () => '$••••';

async function cards(money: (c: number) => string, text: (t: string) => string) {
  const { A } = devices();
  await seed(A.d);
  const o = await loadHouseholdOverview('all', TODAY, A.d);
  const noop = () => undefined;
  return [
    h(ReadMe), h(UpcomingCard, { c: o.commitments, money, text }), h(ActionsCard, { actions: o.actions, text }), h(CommitmentsCard, { c: o.commitments, money, text }),
    h(SpendingCard, { s: o.spending, periodLabel: o.period.label, periodOptions: o.periodOptions, period: 'all', onPeriod: noop, money }),
    h(AreasCard, { s: o.spending, money }), h(ReviewCard, { items: o.review, text }), h(TraceCard, { s: o.spending, money, text }), h(ManagedCard, { managed: o.managed }),
  ].map((e) => renderToStaticMarkup(e));
}

describe('B5 screen: Hide Amounts', () => {
  it('with amounts hidden, no dollar figure survives anywhere on any card: every amount is masked, counts stay visible', async () => {
    const html = (await cards(hidden, (t) => maskMoney(t))).join('\n');
    expect(html).not.toMatch(/\$\s?\d/);
    expect(html).toMatch(/\$••••/);
    expect(html).toMatch(/6 payments/); // counts are not amounts and stay
  });

  it('with amounts shown, the figures are the hand-worked ones', async () => {
    const html = (await cards(shown, (t) => t)).join('\n');
    expect(html).toContain('$647.98'); // 150.00 + 15.49 + 15.49 + 62.00 + 340.00 - 30.00 + 95.00
    expect(html).toContain('$165.49'); // the 30-day known payments of THIS seed: Sparkle 150.00 on 15 Nov + Streamly 15.49 on 15 Nov (the power bill, $70.00 on 20 Nov, is an estimate)
    expect(html).toContain('$552.98'); // the Finance-backed part
    expect(html).toContain('$95.00'); // the typed part
  });
});

describe('B5 screen: structure and words', () => {
  it('every card is a labelled region, radio groups have a legend, tables have a caption and scoped headers, and disclosures have a summary', async () => {
    const html = (await cards(shown, (t) => t)).join('\n');
    for (const m of html.matchAll(/<section[^>]*aria-labelledby="([^"]+)"/g)) expect(html, m[1]).toContain(`id="${m[1]}"`);
    expect(html).toMatch(/<fieldset[^>]*><legend class="sr-only">How far ahead<\/legend>/);
    expect(html).toMatch(/<caption class="sr-only">Recorded spending by household area<\/caption>/);
    expect(html).toMatch(/<th scope="col">Area<\/th>/);
    expect(html).toMatch(/<th scope="row"/);
    expect((html.match(/<details/g) ?? []).length).toBe((html.match(/<summary/g) ?? []).length);
    expect(html).toMatch(/aria-label="Period for recorded spending"/);
    expect(html).toMatch(/role="status"/);
  });

  it('keeps the three ideas apart in words: expected is not spent, commitments are not payments, recorded spending is not all spending, unknown is never zero', async () => {
    const html = (await cards(shown, (t) => t)).join('\n');
    expect(html).toMatch(/Expected, not spent/);
    expect(html).toMatch(/These are plans, not payments/);
    expect(html).toMatch(/not all of your spending/);
    expect(html).toMatch(/never as zero/);
    expect(html).toMatch(/Not fully reconciled|Nothing unresolved is affecting this figure/);
    expect(html).toMatch(/Finance's words are marks you keep|<\/p>/); // pending words are not presented as settlement
  });

  it('the not-reconciled notice is shown when something unresolved affects the total, and the same notice is absent when nothing does', async () => {
    const { A } = devices();
    const s = await seed(A.d);
    await A.d.txns.delete(s.T4.id!); // a linked payment deleted in Finance
    const o = await loadHouseholdOverview('all', TODAY, A.d);
    const bad = renderToStaticMarkup(h(SpendingCard, { s: o.spending, periodLabel: 'All time', periodOptions: [], period: 'all', onPeriod: () => undefined, money: shown }));
    expect(bad).toMatch(/Not fully reconciled/);
    expect(bad).not.toMatch(/Nothing unresolved is affecting this figure/);
    const { A: B } = devices();
    await seed(B.d);
    const ok = renderToStaticMarkup(h(SpendingCard, { s: (await loadHouseholdOverview('all', TODAY, B.d)).spending, periodLabel: 'All time', periodOptions: [], period: 'all', onPeriod: () => undefined, money: shown }));
    expect(ok).toMatch(/Nothing unresolved is affecting this figure/);
  });

  it('while the data is loading the page shows NO totals and no money at all', () => {
    const html = renderToStaticMarkup(h(OverviewPage));
    expect(html).toMatch(/no totals are shown until everything has been read/);
    expect(html).not.toMatch(/\$\s?\d/);
  });
});
