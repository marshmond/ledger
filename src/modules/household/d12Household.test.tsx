import { readFileSync } from 'node:fs';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { maskMoney } from '../../ui/TxnRefs';
import { devices } from '../bills/billsTestkit';
import { TODAY, seed } from './householdSeed';
import { loadHouseholdOverview, type HouseholdOverview } from './overview';
import { ActionsCard, AreasCard, CommitmentsCard, ManagedCard, ReadMe, ReviewCard, SpendingCard, SummaryTiles, TraceCard, UpcomingCard } from './Parts';

/**
 * D12, Household Finances. The page was restyled and reordered; every figure still comes from the same readers. These tests render the real components with the
 * B5 invented household and check that the three ideas stay apart, that certainty keeps its words, that unknown is never shown as zero, that nothing new is added up,
 * and that Hide amounts still protects every figure. Static markup: structure and text, not a look, a screen reader or a phone.
 */
const shown = (c: number) => `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const hidden = () => '$••••';
const id = (t: string) => t;
const src = (f: string) => readFileSync(`src/modules/household/${f}`, 'utf8');
const code = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/ \/\/ .*$/gm, '');
const strip = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

async function overview(period = 'all'): Promise<HouseholdOverview> {
  const { A } = devices();
  await seed(A.d);
  return loadHouseholdOverview(period, TODAY, A.d);
}
const tiles = (o: HouseholdOverview, days: 7 | 30 | 90, money = shown, hide = false) => renderToStaticMarkup(h(SummaryTiles, { c: o.commitments, s: o.spending, days, periodLabel: o.period.label, hide, money }));

describe('D12 Household: Expected, Committed and Recorded stay three separate things', () => {
  it('the summary draws three separate regions, each with its own words, and the figures are the provider values for the window shown', async () => {
    const o = await overview();
    const w = o.commitments.windows.find((x) => x.days === 30)!;
    const html = tiles(o, 30);
    expect((html.match(/<section /g) ?? []).length).toBe(3);
    for (const [idn, word, tag] of [['hh-t-exp', 'Expected', 'Not spent yet'], ['hh-t-com', 'Committed', 'Plans, not payments'], ['hh-t-rec', 'Recorded', 'Backed by a record']]) {
      expect(html).toContain(`aria-labelledby="${idn}"`);
      expect(html).toMatch(new RegExp(`id="${idn}"[^>]*>${word}</h2>`));
      expect(html).toContain(tag);
    }
    const exp = html.slice(html.indexOf('hh-tile--exp'), html.indexOf('hh-tile--com'));
    const com = html.slice(html.indexOf('hh-tile--com'), html.indexOf('hh-tile--rec'));
    const rec = html.slice(html.indexOf('hh-tile--rec'));
    expect(exp).toContain(shown(w.totals.known.cents));
    expect(exp).toContain(shown(w.totals.estimated.cents));
    expect(exp).toContain('Next 30 days');
    expect(com).toContain(shown(o.commitments.twelve.totals.known.cents));
    expect(com).toContain(shown(o.commitments.twelve.totals.estimated.cents));
    expect(com).toContain('Next 12 months');
    expect(rec).toContain(shown(o.spending.totalCents));
    expect(rec).toContain(shown(o.spending.financeCents));
    expect(rec).toContain(shown(o.spending.typedCents));
    expect(rec).toContain(o.period.label);
  });

  it('the Expected tile follows the 7, 30 or 90 day choice and says which window it shows', async () => {
    const o = await overview();
    for (const d of [7, 30, 90] as const) {
      const w = o.commitments.windows.find((x) => x.days === d)!;
      const html = tiles(o, d);
      expect(html).toContain(`Next ${d} days`);
      expect(html).toContain(shown(w.totals.known.cents));
      expect(html).toContain(`${w.totals.known.count} payment`);
    }
  });

  it('no figure on the page adds Expected, Committed or Recorded together, or a known amount to an estimate', async () => {
    const o = await overview();
    const w = o.commitments.windows.find((x) => x.days === 30)!;
    const page = strip([tiles(o, 30), renderToStaticMarkup(h(UpcomingCard, { c: o.commitments, money: shown, text: id })), renderToStaticMarkup(h(CommitmentsCard, { c: o.commitments, money: shown, text: id }))].join(' '));
    const sums = [w.totals.known.cents + w.totals.estimated.cents, o.commitments.twelve.totals.known.cents + o.commitments.twelve.totals.estimated.cents, w.totals.known.cents + o.commitments.twelve.totals.known.cents, o.spending.totalCents + w.totals.known.cents];
    const present = new Set([...page.matchAll(/\$[\d,]+\.\d\d/g)].map((m) => m[0]));
    for (const s of sums) if (![w.totals.known.cents, w.totals.estimated.cents, o.commitments.twelve.totals.known.cents, o.commitments.twelve.totals.estimated.cents, o.spending.totalCents].includes(s)) expect(present.has(shown(s)), `an unsupported total ${shown(s)} is shown`).toBe(false);
    const c = code(src('Parts.tsx'));
    expect(c).not.toMatch(/known\.cents\s*\+|estimated\.cents\s*\+|\+\s*[\w.]*estimated\.cents|\+\s*[\w.]*known\.cents/);
  });

  it('the Recorded tile is not built from Expected or Committed: it takes only the spending reader', () => {
    const c = code(src('Parts.tsx'));
    const rec = c.slice(c.indexOf('<section className="hh-tile hh-tile--rec"'), c.indexOf('</section>', c.indexOf('<section className="hh-tile hh-tile--rec"')));
    expect(rec).not.toMatch(/windows|twelve|commitments/);
  });
});

describe('D12 Household: certainty keeps its words and unknown is never zero', () => {
  it('Known is plain, Estimated says "Estimated" with a wave and a dashed edge, Not known says "Not known" with a question mark and shows a count', async () => {
    const o = await overview();
    const html = renderToStaticMarkup(h(UpcomingCard, { c: o.commitments, money: shown, text: id, days: 90 }));
    expect(html).toMatch(/ui-figure--estimated[\s\S]*?ui-figure-tag[\s\S]*?Estimated/);
    expect(html).toContain('hh-chip c-known');
    expect(html).toContain('hh-chip c-estimated');
    for (const w of ['Known', 'Estimated']) expect(html).toMatch(new RegExp(`hh-chip c-${w.toLowerCase()}[^>]*><svg[^>]*aria-hidden="true"[^>]*>[\\s\\S]*?</svg>${w}</span>`));
    expect(html).toContain('Known amounts');
    expect(html).toContain('Estimated amounts');
    expect(html).toContain('Amount not known');
  });

  it('an unknown amount is a count of items, with the words "not added, and not zero", and never a dollar figure', async () => {
    const o = structuredClone(await overview());
    const w = o.commitments.windows.find((x) => x.days === 30)!;
    w.totals.unknown.count = 3;
    w.totals.known = { cents: 0, count: 0 };
    const html = renderToStaticMarkup(h(UpcomingCard, { c: o.commitments, money: shown, text: id, days: 30 }));
    const unknown = html.slice(html.indexOf('ui-figure--unknown'), html.indexOf('</div></div>', html.indexOf('ui-figure--unknown')) + 12);
    expect(strip(unknown)).toMatch(/Amount not known\s+3 items\s+Not known\s+not added, and not zero/);
    expect(unknown).not.toMatch(/\$/);
    // a known figure of nothing is still a KNOWN zero with its payment count; it is not the unknown figure
    expect(html).toMatch(/ui-figure--known[\s\S]*?\$0\.00[\s\S]*?0 payments/);
  });

  it('a row with no amount says "Amount not known" and carries the Not known chip, not a figure', async () => {
    const o = structuredClone(await overview());
    const w = o.commitments.windows.find((x) => x.days === 90)!;
    const row = w.rows[0];
    row.cents = null; row.certainty = 'unknown';
    const html = renderToStaticMarkup(h(UpcomingCard, { c: o.commitments, money: shown, text: id, days: 90 }));
    const li = html.slice(html.indexOf('hh-prow'), html.indexOf('</li>', html.indexOf('hh-prow')));
    expect(li).toContain('Amount not known');
    expect(li).toMatch(/hh-chip c-unknown[^>]*><svg[\s\S]*?<\/svg>Not known/);
    expect(li).not.toMatch(/hh-amt/);
  });

  it('a disputed amount keeps its own words ("In dispute") and is not labelled Not known', async () => {
    const o = structuredClone(await overview());
    const w = o.commitments.windows.find((x) => x.days === 30)!;
    w.totals.disputed.count = 2;
    const html = renderToStaticMarkup(h(UpcomingCard, { c: o.commitments, money: shown, text: id, days: 30 }));
    const d = html.slice(html.indexOf('hh-dispute'), html.indexOf('</div></div>', html.indexOf('hh-dispute')) + 12);
    expect(strip(d)).toMatch(/Amount in dispute\s+2 items\s+In dispute\s+not added/);
    expect(d).not.toContain('Not known');
  });

  it('the figures themselves are the shared Figure component, so its word, shape and edge rules apply', () => {
    expect(src('Parts.tsx')).toContain("import { Figure } from '../../ui/Figure';");
    expect(code(src('Parts.tsx'))).toMatch(/<Figure certainty="unknown" label="Amount not known"/);
  });
});

describe('D12 Household: periods, review and disclosures use the existing sources', () => {
  it('the 7/30/90 choice is page state the tile and the card share, and changing it re-reads nothing (the providers already hold all three windows)', () => {
    const s = code(src('OverviewPage.tsx'));
    expect(s).toMatch(/const \[days, setDays\] = useState<7 \| 30 \| 90>\(30\)/);
    expect(s).toMatch(/\[period, today, hide, again\]/); // the reader reruns for a new Recorded period, Hide amounts or a retry, and for nothing else
    expect(s).toContain("loadHouseholdOverview(period, today)");
    expect(s).toMatch(/<UpcomingCard [^>]*days=\{days\} onDays=\{setDays\}/);
    expect(s).toMatch(/<SummaryTiles [^>]*days=\{days\}/);
  });

  it('the card works on its own as before (no props = 30 days), and a given window is the one drawn', async () => {
    const o = await overview();
    const own = renderToStaticMarkup(h(UpcomingCard, { c: o.commitments, money: shown, text: id }));
    expect(own).toMatch(/<label class="on"><input type="radio" name="hh-days" checked="" value="30"/);
    const seven = renderToStaticMarkup(h(UpcomingCard, { c: o.commitments, money: shown, text: id, days: 7 }));
    expect(seven).toMatch(/<label class="on"><input type="radio" name="hh-days" checked="" value="7"/);
    expect(seven).toContain(`from today to`);
  });

  it('Needs review lists the same items with the same links, counts the action items only, and moved up without changing what it says', async () => {
    const o = await overview();
    const html = renderToStaticMarkup(h(ReviewCard, { items: o.review, text: id }));
    const action = o.review.filter((i) => i.class !== 'informational').length;
    expect(html).toContain('Needs review');
    if (action > 0) expect(html).toContain(`<span class="hh-count">${action}</span>`);
    for (const i of o.review) { expect(strip(html)).toContain(i.text); for (const l of i.links) expect(html).toContain(`href="${l.href}"`); }
    const page = code(src('OverviewPage.tsx'));
    expect(page.indexOf('<ReviewCard')).toBeGreaterThan(page.indexOf('<SummaryTiles'));
    expect(page.indexOf('<ReviewCard')).toBeLessThan(page.indexOf('<UpcomingCard'));
    expect(code(src('Parts.tsx'))).not.toMatch(/from '\.\/review'.*(?<!type )\{[^}]*(build|collect|review)[A-Za-z]*/); // the screen takes the list as given; it does not decide what needs review
  });

  it('no row-level overlap marker is drawn: the overlap notes name the two records, as before', async () => {
    const o = await overview();
    const html = renderToStaticMarkup(h(UpcomingCard, { c: o.commitments, money: shown, text: id, days: 90 }));
    expect(html).not.toMatch(/Check overlap/i);
    expect(code(src('Parts.tsx'))).not.toMatch(/Check overlap/i);
  });

  it('every disclosure still has its summary and the same names, and the counted lists are still reachable', async () => {
    const o = await overview();
    const noop = () => undefined;
    const html = [h(ReadMe), h(SummaryTiles, { c: o.commitments, s: o.spending, days: 30, periodLabel: o.period.label, money: shown }), h(ReviewCard, { items: o.review, text: id }), h(UpcomingCard, { c: o.commitments, money: shown, text: id }), h(ActionsCard, { actions: o.actions, text: id }), h(CommitmentsCard, { c: o.commitments, money: shown, text: id }),
      h(SpendingCard, { s: o.spending, periodLabel: o.period.label, periodOptions: o.periodOptions, period: 'all', onPeriod: noop, money: shown }), h(AreasCard, { s: o.spending, money: shown }), h(TraceCard, { s: o.spending, money: shown, text: id }), h(ManagedCard, { managed: o.managed })].map((e) => renderToStaticMarkup(e)).join('\n');
    expect((html.match(/<details/g) ?? []).length).toBe((html.match(/<summary/g) ?? []).length);
    for (const t of ['How to read this page', 'Why this is less than the three module pages added together', 'Finance payments counted', 'Typed as paid outside Finance']) expect(strip(html)).toContain(t);
    for (const m of html.matchAll(/<section[^>]*aria-labelledby="([^"]+)"/g)) expect(html, m[1]).toContain(`id="${m[1]}"`);
    expect(html).toMatch(/<fieldset[^>]*><legend class="sr-only">How far ahead<\/legend>/);
    expect(html).toContain('aria-label="Period for recorded spending"');
    for (const w of ['Expected, not spent', 'These are plans, not payments', 'not all of your spending', 'never as zero']) expect(html).toContain(w);
  });

  it('the sum "what is counted" is shown as an equation for the eye and as the same sentence for a screen reader, with the same three figures', async () => {
    const o = await overview();
    const html = renderToStaticMarkup(h(TraceCard, { s: o.spending, money: shown, text: id }));
    const p = o.spending.proof;
    expect(html).toContain(`<p class="sr-only">Every figure above is the sum of these lists: ${shown(p.piecesCents)} from Finance payments plus ${shown(p.typedCents)} typed = ${shown(p.sumCents)}.</p>`);
    expect(html).toMatch(/class="hh-eq" aria-hidden="true"/);
    expect(p.piecesCents + p.typedCents).toBe(p.sumCents); // the provider's own proof; the screen does not add
    expect(code(src('Parts.tsx'))).not.toMatch(/proof\.piecesCents\s*\+/);
  });
});

describe('D12 Household: Hide amounts protects every figure, including the new ones', () => {
  it('summary tiles: no digit of money anywhere, counts stay, no proportion bar is drawn', async () => {
    const o = await overview();
    const html = tiles(o, 30, hidden, true);
    expect(html).not.toMatch(/\$\s?\d/);
    expect(html).toMatch(/\$••••/);
    expect(html).toMatch(/\d+ payments?/);
    expect(html).not.toContain('hh-split"');
    expect(html).toContain('aria-label="Recorded spending total"');
  });

  it('with amounts shown the tile draws a bar made only of what the readers returned, hidden from assistive technology', async () => {
    const o = await overview();
    const html = tiles(o, 30);
    expect(html).toMatch(/<div class="hh-split" aria-hidden="true"><span style="width:[\d.]+%"><\/span><\/div>/);
  });

  it('every card, hidden: no dollar digit in text or in any accessible name, and no bars that would show proportions', async () => {
    const o = await overview();
    const noop = () => undefined;
    const t = (x: string) => maskMoney(x);
    const html = [h(SummaryTiles, { c: o.commitments, s: o.spending, days: 90, periodLabel: o.period.label, hide: true, money: hidden }), h(UpcomingCard, { c: o.commitments, money: hidden, text: t, days: 90 }), h(CommitmentsCard, { c: o.commitments, money: hidden, text: t }),
      h(SpendingCard, { s: o.spending, periodLabel: o.period.label, periodOptions: o.periodOptions, period: 'all', onPeriod: noop, money: hidden, hide: true }), h(AreasCard, { s: o.spending, money: hidden, hide: true }), h(TraceCard, { s: o.spending, money: hidden, text: t }), h(ReviewCard, { items: o.review, text: t }), h(ActionsCard, { actions: o.actions, text: t })].map((e) => renderToStaticMarkup(e)).join('\n');
    expect(html).not.toMatch(/\$\s?\d/);
    for (const m of html.matchAll(/(?:aria-label|title|alt)="([^"]*)"/g)) expect(m[1]).not.toMatch(/\$\s?\d/);
    expect(html).not.toContain('hh-split"');
    expect(html).not.toContain('hh-areabar-fill');
    expect(html).not.toMatch(/\$0\.00/); // hidden is a mask, never a zero
  });
});

describe('D12 Household: structure, wording and stylesheet', () => {
  it('the page order is: how to read, summary, review, expected, then commitments beside the actions, recorded beside the areas, and what is counted', () => {
    const s = code(src('OverviewPage.tsx'));
    const order = ['<ReadMe', '<SummaryTiles', '<ReviewCard', '<UpcomingCard', '<CommitmentsCard', '<ActionsCard', '<ManagedCard', '<SpendingCard', '<AreasCard', '<TraceCard'].map((k) => s.indexOf(k));
    expect(order.every((x) => x > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('the page still says it is read-only, and the heading levels do not skip', async () => {
    expect(code(src('OverviewPage.tsx'))).toContain('Read-only: nothing here changes a record');
    const o = await overview();
    const html = tiles(o, 30) + renderToStaticMarkup(h(ReviewCard, { items: o.review, text: id }));
    expect(html).not.toMatch(/<h[1456]/); // ids-ok: a tag pattern, never an id. Tiles and review use h2 under the page h1; only a review group uses h3, inside its card
  });

  it('uses tokens only: no hex color, no priority override, no new font, and American spelling', () => {
    const css = src('household.css').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/!important|@font-face|url\(/);
    expect(src('household.css') + src('Parts.tsx')).not.toMatch(/colour|grey\b/i);
  });
});
