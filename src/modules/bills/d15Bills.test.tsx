import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { FinanceDB } from '../../db';
import { dn } from './billsTestkit';
import { createObligation } from './data';
import { DueList } from './DueList';
import { LABEL_TEXT, type LabelId } from './labels';
import { blankObligation, type ExpectedAmount } from './model';
import { amountCertainty, billCount, groupByDate, LABEL_TONE, STATUS_TONE } from './presentation';
import { attention, cashTiming, derive, loadBillsSnapshot, upcoming, type CashWindow } from './readModel';
import { CashFigures } from './UpcomingPage';
import { installTracking } from '../../lib/sync/track';

/**
 * D15 Bills & Subscriptions. The overview, list, upcoming page and bill page were recomposed (date groups, a hero, key terms, two columns, figures for known
 * and estimated amounts). The amounts, dates, payment labels and review lists come from the engines that already existed and are unchanged. Real Dexie,
 * invented bills and dates. 2026-11-07 is a Saturday. Layout and look are checked in a real browser, not here.
 */
let n = 0;
const fresh = () => { const d = new FinanceDB(`test-d15-bills-${n++}`); installTracking(d); return d; };
const TODAY = '2026-11-07';
const money = (c: number) => `$${(c / 100).toFixed(2)}`;
const hidden = () => '$••••';
const snapshot = async (d: FinanceDB) => JSON.stringify([await d.moduleRecords.toArray(), await d.links.toArray(), await d.txns.toArray(), await d.settings.toArray()]);
const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(createElement(MemoryRouter, null, el));
const bill = (title: string, kind: 'fixed' | 'variable' | 'unknown', day: number, cents: number | null) => blankObligation({
  title, type: 'utility', need: 'essential', amountKind: kind, prices: cents === null ? [] : [{ from: '2026-01-01', cents, label: '' }], trackingSince: '2026-08-01',
  payment: { how: 'manual', fundingAccountId: null }, schedule: { kind: 'months', every: 1, slot: { kind: 'day', day, adjust: 'none' }, anchorMonth: '2026-08' },
}, TODAY);

async function household() {
  const d = fresh();
  await createObligation({ data: bill('Invented Power', 'variable', 18, 9500), today: TODAY }, d);
  await createObligation({ data: bill('Invented Phone', 'fixed', 25, 8500), today: TODAY }, d);
  await createObligation({ data: bill('Invented Gym', 'unknown', 12, null), today: TODAY }, d);
  const x = derive(await loadBillsSnapshot(d), TODAY);
  return { d, x };
}

describe('D15 Bills: five different situations never share a look', () => {
  const ids = Object.keys(LABEL_TEXT) as LabelId[];
  it('every period label has a tone, and the overdue tone is used by "Overdue (billed, no payment recorded)" alone', () => {
    expect(Object.keys(LABEL_TONE).sort()).toEqual([...ids].sort());
    expect(ids.filter((l) => LABEL_TONE[l] === 'overdue')).toEqual(['overdue']);
  });
  it('"Not confirmed paid" (nothing recorded, so unknown) is a warning, not the overdue tone and not done', () => {
    expect(LABEL_TONE['not-confirmed']).toBe('warning');
    expect(LABEL_TONE['date-unclear']).toBe('warning');
  });
  it('only a recorded payment reads as done; a scheduled automatic payment, an upcoming bill and a part payment never do', () => {
    expect(ids.filter((l) => LABEL_TONE[l] === 'done').sort()).toEqual(['paid', 'payment-recorded']);
    for (const l of ['scheduled-auto', 'upcoming', 'partly-paid', 'due-soon', 'autopay-check', 'marked-paid-short'] as LabelId[]) expect(LABEL_TONE[l]).not.toBe('done');
  });
  it('a bill\'s own status has a tone and the words stay (paused and unreadable are warnings)', () => {
    expect(STATUS_TONE).toEqual({ active: 'active', paused: 'warning', ended: 'neutral', unsupported: 'warning' });
  });
});

describe('D15 Bills: how certain an amount is', () => {
  it('a fixed amount is known, an amount that varies is an estimate, and no amount (or a missing figure) is not known', () => {
    expect(amountCertainty({ cents: 8500, basis: 'fixed' })).toBe('known');
    expect(amountCertainty({ cents: 9500, basis: 'variable' })).toBe('estimated');
    expect(amountCertainty({ cents: null, basis: 'unknown' })).toBe('unknown');
    expect(amountCertainty({ cents: null, basis: 'fixed' })).toBe('unknown');
    expect(amountCertainty({ cents: 0, basis: 'unknown' } as ExpectedAmount)).toBe('unknown');
  });
  it('a zero amount that WAS entered stays known (it is a real value), and is never confused with not known', () => {
    expect(amountCertainty({ cents: 0, basis: 'fixed' })).toBe('known');
  });
  it('counts bills in words', () => { expect(billCount(1)).toBe('1 bill'); expect(billCount(3)).toBe('3 bills'); expect(billCount(0)).toBe('0 bills'); });
  it('groups entries under their date in the order given', () => {
    const e = [{ d: 'a', k: 1 }, { d: 'a', k: 2 }, { d: 'b', k: 3 }];
    expect(groupByDate(e, (x) => x.d).map((g) => [g.date, g.entries.map((x) => x.k)])).toEqual([['a', [1, 2]], ['b', [3]]]);
  });
});

describe('D15 Bills: the cash figures keep known, estimated and not known apart', () => {
  const wins: CashWindow[] = [
    { days: 7, known: { cents: 10000, count: 2 }, estimated: { cents: 5000, count: 1 }, unknown: { count: 0 } },
    { days: 30, known: { cents: 0, count: 0 }, estimated: { cents: 0, count: 0 }, unknown: { count: 2 } },
  ];
  const out = html(createElement(CashFigures, { wins, money }));
  it('prints the engine\'s own known and estimated amounts as two figures and never their sum', () => {
    expect(out).toContain('$100.00');
    expect(out).toContain('$50.00');
    expect(out).not.toContain('$150.00'); // ids-ok: formatted money text, never an id
    expect(out).toMatch(/data-testid="cash-7-known"[\s\S]*Known[\s\S]*data-testid="cash-7-estimated"[\s\S]*Estimated/);
  });
  it('an estimated figure says "Estimated" in words, not only by its dashed edge', () => {
    expect(out).toContain('ui-figure--estimated');
    expect(out).toMatch(/ui-figure-tag[^>]*>[\s\S]{0,600}Estimated/);
  });
  it('a window with nothing expected says "None expected", and bills with no known amount are counted in words and never shown as $0.00', () => {
    expect(out).toContain('None expected');
    expect(out).toContain('2 bills');
    expect(out).toContain('with no known amount. Counted here, not added.');
    expect(out).not.toContain('$0.00');
  });
  it('Hide amounts leaves no digit in any figure', () => {
    const masked = html(createElement(CashFigures, { wins, money: hidden }));
    expect(masked).toContain('$••••');
    expect(masked).not.toMatch(/\$\d/);
  });
});

describe('D15 Bills: the expected dates, drawn from the existing read model', () => {
  it('shows each expected date under a tile with the amount in words: fixed as Expected, variable as an Estimate, unknown as "Amount not known"', async () => {
    const { x } = await household();
    const ahead = upcoming(x).ahead;
    const out = html(createElement(DueList, { entries: ahead, today: TODAY, money }));
    expect(out).toContain('ui-dtile');
    expect(out).toContain('Invented Power');
    expect(out).toContain('Estimate, about $95.00');
    expect(out).toContain('Expected $85.00');
    expect(out).toContain('Amount not known');
    expect(out).not.toContain('$0.00');
    expect(out).not.toContain('Paid ');
  });
  it('a date past its day with no payment recorded is "not confirmed", with the line that says what Ledger knows; it never claims to be paid', async () => {
    const { x } = await household();
    const past = upcoming(x).pastDue;
    expect(past.length).toBeGreaterThan(0);
    const out = html(createElement(DueList, { entries: past, today: TODAY, money, past: true }));
    expect(out).toContain(LABEL_TEXT['not-confirmed']);
    expect(out).toContain('No payment is recorded');
    expect(out).toContain('ui-chip--warning');
    expect(out).not.toContain('ui-chip--done');
  });
  it('every row links to its bill and Hide amounts removes the digits from the amount line', async () => {
    const { x } = await household();
    const ahead = upcoming(x).ahead;
    const out = html(createElement(DueList, { entries: ahead, today: TODAY, money: hidden }));
    for (const e of ahead) expect(out).toContain(`href="/o/${e.ob.id}"`);
    expect(out).toContain('$••••');
    expect(out).not.toMatch(/(Expected|Estimate, about) \$\d/);
  });
  it('the due date of every row is the date the period already had (no row is dated earlier than its tile)', async () => {
    const { x } = await household();
    for (const e of upcoming(x).ahead) expect(dn(e.period.timing.date!)).toBeGreaterThanOrEqual(dn(TODAY));
  });
});

describe('D15 Bills: browsing creates and changes nothing', () => {
  it('reading the model, the cash windows, the attention list and drawing the dated list write no row of any kind', async () => {
    const { d, x } = await household();
    const before = await snapshot(d);
    const x2 = derive(await loadBillsSnapshot(d), TODAY);
    cashTiming(x2); attention(x2);
    html(createElement(DueList, { entries: upcoming(x2).ahead, today: TODAY, money }));
    html(createElement(DueList, { entries: upcoming(x2).pastDue, today: TODAY, money, past: true }));
    expect(await snapshot(d)).toBe(before);
    expect(x.snap.obligations).toHaveLength(3);
  });
  it('the three bills keep their amounts: fixed 8500, variable 9500, unknown null', async () => {
    const { x } = await household();
    const by = Object.fromEntries(x.snap.obligations.map((o) => [o.data.title, o.data]));
    expect(by['Invented Phone'].prices[0].cents).toBe(8500);
    expect(by['Invented Power'].prices[0].cents).toBe(9500);
    expect(by['Invented Gym'].prices).toEqual([]);
    expect(by['Invented Gym'].amountKind).toBe('unknown');
  });
});

describe('D15 Bills: sources', () => {
  const src = (f: string) => readFileSync(`src/modules/bills/${f}`, 'utf8');
  const code = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  it('the new files write nothing, format no money themselves, and work out no date or amount of their own', () => {
    for (const f of ['presentation.ts', 'DueList.tsx']) {
      expect(code(src(f)), f).not.toMatch(/\.(put|add|bulkPut|bulkAdd|update|delete)\(|recordFact|createObligation|transaction\(/);
      expect(code(src(f)), f).not.toMatch(/formatCents|toFixed|new Date|addDays/);
    }
  });
  it('the overview does not add figures together: the known and estimated figures come from separate engine fields', () => {
    const page = code(src('OverviewPage.tsx'));
    expect(page).toContain('c.known.cents');
    expect(page).toContain('c.estimated.cents');
    expect(page).not.toMatch(/known\.cents\s*\+|\+\s*c\.estimated|estimated\.cents\s*\+/);
    expect(code(src('UpcomingPage.tsx'))).not.toMatch(/known\.cents\s*\+|estimated\.cents\s*\+/);
  });
  it('the overview keeps its three counts, the attention list, the review list and the 90-day link', () => {
    const page = src('OverviewPage.tsx');
    for (const t of ['count-active', 'count-paused', 'count-ended', 'Needs attention', 'Your review list', 'See the next 90 days', 'Expected recurring costs, next 12 months', 'Expected cash needed']) expect(page).toContain(t);
  });
  it('the bill page keeps every section it had, and its date chips come from the existing lifecycle flag', () => {
    const page = src('ObligationPage.tsx');
    for (const t of ['Next expected dates', 'More about the terms', 'Key terms', 'Your review list', 'Document links', 'What you have done to it', '<PeriodsCard', '<PaymentHistoryCard', '<ScheduledCard', '<ContractCard', '<LifecycleCard', 'Delete…', 'lc-chip']) expect(page).toContain(t);
  });
  it('the phone rules keep the date tile beside its bills, stack the key terms and keep targets at 44px', () => {
    const css = src('bills.css');
    expect(css).toMatch(/\.bl-day \{ display: grid; grid-template-columns: auto minmax\(0, 1fr\)/);
    expect(css).toMatch(/\.bl-keys \{ grid-template-columns: minmax\(0, 1fr\)/);
    expect(css).toMatch(/\.bl-head-actions \.btn \{[^}]*min-height: 44px/);
  });
});
