import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { FinanceDB } from '../../db';
import { installTracking } from '../../lib/sync/track';
import { createObligation } from './data';
import { DueList } from './DueList';
import { LABEL_TEXT } from './labels';
import { blankObligation } from './model';
import { amountLine } from './PeriodParts';
import { PREVIEW_DATES, previewByDate, REVIEW_TONE, reviewTotal } from './presentation';
import { attention, cashTiming, derive, loadBillsSnapshot, upcoming, type AttentionCategory } from './readModel';
import { GROUP } from './ReviewPage';

/**
 * D15 Bills refinement: the phone overview preview of the next dates, and the Needs review page. Real Dexie, invented bills. 2026-11-07 is a Saturday.
 * The preview only chooses which of the entries it is given to draw; the review page lists the same attention items as before. Layout is checked in a real
 * browser, not here.
 */
let n = 0;
const fresh = () => { const d = new FinanceDB(`test-d15r-${n++}`); installTracking(d); return d; };
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
  // two bills share the 15th, one unknown amount, one varies, one fixed; the 8th and the 12th are already past, so there are past-date review items
  await createObligation({ data: bill('Invented Power', 'variable', 18, 9500), today: TODAY }, d);
  await createObligation({ data: bill('Invented Phone', 'fixed', 25, 8500), today: TODAY }, d);
  await createObligation({ data: bill('Invented Water', 'fixed', 15, 4200), today: TODAY }, d);
  await createObligation({ data: bill('Invented Streaming', 'fixed', 15, 1599), today: TODAY }, d);
  await createObligation({ data: bill('Invented Gym', 'unknown', 12, null), today: TODAY }, d);
  return { d, x: derive(await loadBillsSnapshot(d), TODAY) };
}

describe('D15 refinement: the phone preview shows the first populated dates, complete', () => {
  const e = (date: string, k: number) => ({ date, k });
  const dateOf = (v: { date: string }) => v.date;

  it('three populated dates: shows all three, with every entry on each (a shared date is never cut part-way)', () => {
    const entries = [e('d1', 1), e('d1', 2), e('d2', 3), e('d3', 4), e('d3', 5), e('d3', 6), e('d4', 7), e('d5', 8)];
    const p = previewByDate(entries, dateOf);
    expect(PREVIEW_DATES).toBe(3);
    expect(p.groups.map((g) => [g.date, g.entries.map((x) => x.k)])).toEqual([['d1', [1, 2]], ['d2', [3]], ['d3', [4, 5, 6]]]);
    expect(p.shown).toBe(6);
    expect(p.total).toBe(8);
    expect(p.hiddenDates).toBe(2);
  });
  it('more than three entries on the very first date still draws all of them', () => {
    const p = previewByDate([e('d1', 1), e('d1', 2), e('d1', 3), e('d1', 4), e('d2', 5)], dateOf);
    expect(p.groups).toHaveLength(2);
    expect(p.groups[0].entries).toHaveLength(4);
    expect(p.hiddenDates).toBe(0);
  });
  it('fewer than three dates shows them all and hides nothing', () => {
    const p = previewByDate([e('d1', 1), e('d2', 2)], dateOf);
    expect(p.groups).toHaveLength(2);
    expect(p.shown).toBe(2);
    expect(p.hiddenDates).toBe(0);
  });
  it('an empty list is an empty preview', () => {
    expect(previewByDate([], dateOf)).toEqual({ groups: [], shown: 0, total: 0, hiddenDates: 0 });
  });
  it('the order is the order given and nothing is dropped or invented (drawn entries are a prefix of the list)', () => {
    const entries = [e('a', 1), e('b', 2), e('c', 3), e('d', 4)];
    const p = previewByDate(entries, dateOf);
    expect(p.groups.flatMap((g) => g.entries)).toEqual(entries.slice(0, p.shown));
  });
});

describe('D15 refinement: on real data the preview is a prefix of the same expected dates the Upcoming page lists', () => {
  it('two bills on one date are both drawn; amounts keep their meaning (fixed expected, variable estimate, unknown not known); no $0.00', async () => {
    const { x } = await household();
    const ahead = upcoming(x).ahead;
    const p = previewByDate(ahead, (v) => v.period.timing.date!);
    const entries = p.groups.flatMap((g) => g.entries);
    expect(entries).toEqual(ahead.slice(0, entries.length));
    const first = p.groups[0];
    expect(first.entries.length).toBeGreaterThanOrEqual(1);
    const shared = ahead.filter((v) => v.period.timing.date === '2026-11-15');
    expect(shared.length).toBe(2);
    expect(p.groups.some((g) => g.date === '2026-11-15' && g.entries.length === 2)).toBe(true);
    const out = html(createElement(DueList, { entries: ahead, today: TODAY, money }));
    expect(out).toContain('Estimate, about $95.00');
    expect(out).toContain('Expected $85.00');
    expect(out).toContain('Amount not known');
    expect(out).not.toContain('$0.00');
  });
  it('every entry the preview leaves out is still on the Upcoming page: the page lists the whole `ahead` list, and the preview count label uses its length', async () => {
    const { x } = await household();
    const ahead = upcoming(x).ahead;
    const p = previewByDate(ahead, (v) => v.period.timing.date!);
    expect(p.shown).toBeLessThanOrEqual(ahead.length);
    expect(p.total).toBe(ahead.length);
    const page = readFileSync('src/modules/bills/UpcomingPage.tsx', 'utf8');
    expect(page).toContain('const { pastDue, ahead } = upcoming(x);');
    expect(page).toContain('weeks.set(w, [...(weeks.get(w) ?? []), e])');
    const overview = readFileSync('src/modules/bills/OverviewPage.tsx', 'utf8');
    expect(overview).toContain('View all upcoming{ahead.length > 0 ? ` (${ahead.length})` : \'\'}');
    expect(overview).toMatch(/<Link to=\{upcomingRoute\(\)\} className="btn">View all upcoming/);
  });
  it('the cash windows are the engine\'s own figures: known and estimated stay separate and an unknown amount is counted, never added', async () => {
    const { x } = await household();
    const w = cashTiming(x);
    expect(w.map((v) => v.days)).toEqual([7, 30, 90]);
    expect(w[1].unknown.count).toBeGreaterThanOrEqual(0);
    const page = readFileSync('src/modules/bills/OverviewPage.tsx', 'utf8');
    expect(page).not.toMatch(/known\.cents\s*\+|estimated\.cents\s*\+/);
  });
  it('the phone and desktop trees place each section once, the overview asks the read model once, and the phone order is counts, attention, cash, preview, costs', () => {
    const page = readFileSync('src/modules/bills/OverviewPage.tsx', 'utf8');
    expect((page.match(/upcoming\(x\)/g) ?? []).length).toBe(1);
    expect(page).toContain("useMediaQuery('(max-width: 640px)')");
    const phone = page.slice(page.lastIndexOf('{phone ? ('), page.indexOf(') : (\n            <div className="bl-layout">'));
    expect(phone.replace(/\s+/g, ' ')).toBe('{phone ? ( <> {cashEl} {comingEl} {costsEl} {reviewEl} {notesEl} </> ');
    expect(page.indexOf('{band}')).toBeLessThan(page.indexOf('{attentionEl}'));
    expect(page.indexOf('{attentionEl}')).toBeLessThan(page.lastIndexOf('{phone ? ('));
    const desktop = page.slice(page.indexOf('<div className="bl-layout">'), page.indexOf('<DiscoverCard />\n        </>\n      )}'));
    expect(desktop.indexOf('{comingEl}')).toBeLessThan(desktop.indexOf('{cashEl}'));
  });
});

describe('D15 refinement: the Needs review page lists exactly what the read model lists', () => {
  it('every attention category the page can show has a group, and every group has a tone; nothing is dropped', async () => {
    const { x } = await household();
    const a = attention(x);
    const grouped = new Set<AttentionCategory>(GROUP.flatMap((g) => g.id));
    const upcomingKinds: AttentionCategory[] = ['dueSoon', 'trials', 'notices', 'renewals'];
    for (const i of a.items) if (!upcomingKinds.includes(i.category)) expect(grouped.has(i.category), i.category).toBe(true);
    for (const g of GROUP) for (const c of g.id) expect(REVIEW_TONE[c]).toBeDefined();
    expect(Object.keys(REVIEW_TONE).sort()).toEqual([...new Set([...grouped, ...upcomingKinds])].sort());
  });
  it('the page total is the Overview button\'s own subtraction, equal to the number of items the page can list', async () => {
    const { x } = await household();
    const a = attention(x);
    const listed = a.items.filter((i) => GROUP.some((g) => g.id.includes(i.category))).length;
    expect(reviewTotal(a)).toBe(a.total - a.dueSoon - a.trials - a.notices - a.renewals);
    expect(reviewTotal(a)).toBe(listed);
    expect(listed).toBeGreaterThan(0);
  });
  it('reduced data: a household with no bills has nothing to review (the empty state), and an empty list reads as zero', async () => {
    const d = fresh();
    const x = derive(await loadBillsSnapshot(d), TODAY);
    const a = attention(x);
    expect(reviewTotal(a)).toBe(0);
    expect(a.items).toEqual([]);
    const page = readFileSync('src/modules/bills/ReviewPage.tsx', 'utf8');
    expect(page).toContain('count === 0 && acked.length === 0 ? <EmptyState title="Nothing needs review">');
  });
  it('past-date items show their period\'s own date and amount in words: expected, billed or estimate; a missing amount says so and is never $0; Hide amounts masks it', async () => {
    const { x } = await household();
    const a = attention(x);
    const notConfirmed = a.items.filter((i) => i.category === 'notConfirmed' && i.obligationId !== null && i.slot);
    expect(notConfirmed.length).toBeGreaterThan(0);
    const lines = notConfirmed.map((i) => { const p = (x.periods.get(i.obligationId!) ?? []).concat(x.recorded.get(i.obligationId!) ?? []).find((q) => q.slot === i.slot)!; return amountLine(p, money); });
    expect(lines.join(' | ')).toMatch(/Amount not known|Expected \$/);
    for (const l of lines) expect(l).not.toContain('$0.00');
    const gym = notConfirmed.find((i) => i.text.includes('Invented Gym'));
    if (gym) { const p = (x.periods.get(gym.obligationId!) ?? []).find((q) => q.slot === gym.slot)!; expect(amountLine(p, money)).toBe('Amount not known'); }
    const masked = notConfirmed.map((i) => amountLine((x.periods.get(i.obligationId!) ?? []).concat(x.recorded.get(i.obligationId!) ?? []).find((q) => q.slot === i.slot)!, hidden)).join(' ');
    expect(masked).not.toMatch(/\$\d/);
  });
  it('a Not confirmed paid item keeps its label words (nothing recorded is not "unpaid"), and a payment is never implied by reviewing', () => {
    expect(LABEL_TEXT['not-confirmed']).toBe('Not confirmed paid');
    const g = GROUP.find((v) => v.id.includes('notConfirmed'))!;
    expect(g.hint).toBe('Ledger only knows that no payment is recorded, not that anything is unpaid.');
    expect(GROUP.map((v) => v.hint).join(' ')).not.toMatch(/automatically marked paid|is now paid|marks it paid/i);
  });
});

describe('D15 refinement: the review page keeps every action and every link, and reading writes nothing', () => {
  const src = readFileSync('src/modules/bills/ReviewPage.tsx', 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  it('the same buttons, with the same conditions, as before', () => {
    for (const t of ['Open the bill', 'Mark paid…', 'Keep it on “{h.data.title}”', 'Leave as is', 'Update reminders']) expect(src).toContain(t);
    expect(src).toContain("(i.category === 'unconfirmedTasks' || i.category === 'notConfirmed' || i.category === 'autopayCheck')");
    expect(src).toContain("i.category === 'taskProblems' && <button");
    expect(src).toContain("(i.category === 'cancelAwaiting' || i.category === 'lifecycleConflict' || i.category === 'afterCancel' || i.category === 'scheduledAfterEnd') && ob && i.ackKey");
    expect(src).toContain('Left as is ({acked.length})');
    expect(src).toContain('<ConflictCard conflict={i.conflict}');
    expect(src).toContain('<FactDialog obligation={paid.ob}');
    expect(src).toContain('<KeepRuleDialog');
  });
  it('the page adds no write of its own, no new review condition and no new status', () => {
    expect(code).not.toMatch(/\.(put|add|bulkPut|bulkAdd|update|delete)\(|recordFact|createObligation|transaction\(/);
    expect(code).not.toMatch(/formatCents|toFixed|new Date|addDays/);
    expect(code).toContain('const a = attention(x);');
  });
  it('browsing the read model, the amounts and the groups writes no row', async () => {
    const { d, x } = await household();
    const before = await snapshot(d);
    const x2 = derive(await loadBillsSnapshot(d), TODAY);
    const a = attention(x2);
    reviewTotal(a);
    for (const i of a.items) { const p = i.obligationId !== null && i.slot ? (x2.periods.get(i.obligationId) ?? []).find((q) => q.slot === i.slot) : undefined; if (p) amountLine(p, money); }
    previewByDate(upcoming(x2).ahead, (v) => v.period.timing.date!);
    expect(await snapshot(d)).toBe(before);
    expect(x.snap.obligations).toHaveLength(5);
  });
  it('the phone rules keep the review actions and the preview button at 44 px and stack the summary', () => {
    const css = readFileSync('src/modules/bills/bills.css', 'utf8');
    expect(css).toMatch(/\.bl-rv-actions \.btn \{[^}]*min-height: 44px/);
    expect(css).toMatch(/\.bl-viewall \.btn \{[^}]*min-height: 44px/);
    expect(css).toMatch(/\.bl-rv-sum \{ grid-template-columns: minmax\(0, 1fr\)/);
  });
});
