import { describe, expect, it } from 'vitest';
import { rankAttention, type AttentionItem } from '../../core/attention';
import { resultProblem } from '../../core/answers';
import type { WeekMoney } from '../../core/weekReaders';
import { needsResult, weekResult } from './answersLive';
import { buildWeekReview, ready, type WeekInputs } from './week/weekModel';

/** R3.2: the two Today answers are built from R1.1's ranked list and R1.2's review, unchanged. Invented items only. Today is 2026-11-16. */
const TODAY = '2026-11-16';
const item = (n: number, over: Partial<AttentionItem> = {}): AttentionItem => ({
  id: `assets:task:${n}:overdue`, moduleId: 'assets', recordId: `task:${n}`, condition: `task:${n}:overdue`, kind: 'overdue', date: '2026-11-10', title: `Task ${n}`, reason: `Task ${n} is 6 days overdue.`,
  href: `#/assets/${n}`, provenance: 'Home & Assets overview: overdue maintenance', ...over,
});

describe('What needs my attention? (R1.1)', () => {
  it('shows the same ranked list, the first five, with the true total and a link to the whole list', () => {
    const items = [1, 2, 3, 4, 5, 6, 7].map((n) => item(n, { date: `2026-11-0${n}` }));
    const ranked = rankAttention(items, TODAY);
    const r = needsResult(ranked, [], TODAY);
    expect(resultProblem(r)).toBeNull();
    expect(r.groups[0].rows.map((x) => x.id)).toEqual(ranked.slice(0, 5).map((x) => x.id));
    expect(r.groups[0].hidden).toBe(2);
    expect(r.groups[0].more).toEqual({ label: 'See all 7 in Needs you', href: '#/today/needs' });
    expect(r.figures.find((f) => f.id === 'total')!.value).toEqual({ kind: 'count', n: 7 });
    expect(r.figures.find((f) => f.id === 'urgent')!.value).toEqual({ kind: 'count', n: 7 });
    expect(r.status).toBe('answered');
  });
  it('keeps R1.1\'s duplicate handling: one condition reported by two modules is one row, naming both', () => {
    const a = item(9);
    const b: AttentionItem = { ...a, id: 'tasks:task:9:overdue', moduleId: 'tasks', href: '#/tasks?task=9', provenance: 'Tasks: overdue' };
    const r = needsResult(rankAttention([a, b], TODAY), [], TODAY);
    expect(r.groups[0].rows).toHaveLength(1);
    expect(r.groups[0].rows[0].source).toMatch(/also in/);
  });
  it('carries the reason and the urgency words from the item, and never an amount', () => {
    const r = needsResult(rankAttention([item(1)], TODAY), [], TODAY);
    expect(r.groups[0].rows[0]).toMatchObject({ title: 'Task 1', detail: 'Task 1 is 6 days overdue.', href: '#/assets/1' });
    expect(r.groups[0].rows[0].chips?.map((c) => c.text)).toEqual(['6 days overdue', 'Overdue or urgent']);
    expect(JSON.stringify(r)).not.toMatch(/\$\d/);
  });
  it('nothing needs attention is a real, checked "no"; a module that could not be read is NOT a "no"', () => {
    expect(needsResult([], [], TODAY)).toMatchObject({ status: 'none', headline: ['Nothing needs your attention right now.'] });
    const bad = needsResult([], ['bills'], TODAY);
    expect(bad.status).toBe('limited');
    expect(bad.headline[0]).not.toMatch(/^Nothing needs/);
    expect(bad.limitations.join(' ')).toMatch(/Missing is not the same as nothing needing attention/);
  });
});

describe('What is happening this week? (R1.2)', () => {
  const money: WeekMoney = {
    rows: [
      { id: 'bill:1', module: 'bills', sourceId: 1, title: 'Streamly', date: '2026-11-18', cents: 1549, certainty: 'known', note: '', href: '#/bills/o/1' },
      { id: 'bill:2', module: 'bills', sourceId: 2, title: 'Example Power', date: '2026-11-19', cents: 7000, certainty: 'estimated', note: '', href: '#/bills/o/2' },
      { id: 'arr:3', module: 'services', sourceId: 3, title: 'Lawn care', date: '2026-11-20', cents: null, certainty: 'unknown', note: '', href: '#/services/a/3' },
    ],
    folded: 0, overlap: false, notConverted: 0, contractDates: [],
    totals: { known: { cents: 1549, count: 1 }, estimated: { cents: 7000, count: 1 }, unknown: { count: 1 }, disputed: { count: 0 } },
  };
  const inputs = (over: Partial<WeekInputs> = {}): WeekInputs => ({
    today: TODAY, needs: ready({ ranked: rankAttention([item(1)], TODAY), failed: [] }), calendar: ready([]), money: ready(money), cash: ready(null),
    assets: ready([]), overBudget: ready([]), family: ready({ dates: [], activities: [], hiddenActivities: 0 }), ...over,
  });
  it('uses the seven-day window, keeps fixed and estimated amounts apart, and counts the unknown one instead of making it zero', () => {
    const r = weekResult(buildWeekReview(inputs()));
    expect(resultProblem(r)).toBeNull();
    expect(r.period).toMatchObject({ from: TODAY, to: '2026-11-22' });
    expect(r.period.label).toMatch(/7 days, today included/);
    expect(r.figures.find((f) => f.id === 'known')!.value).toMatchObject({ kind: 'money', cents: 1549 });
    expect(r.figures.find((f) => f.id === 'estimated')!.value).toMatchObject({ kind: 'money', cents: 7000 });
    expect(r.figures.find((f) => f.id === 'unknown')!.value).toEqual({ kind: 'count', n: 1 });
    expect(r.figures.some((f) => /total/i.test(f.label))).toBe(false);
    const rows = r.groups.find((g) => g.id === 'payments')!.rows;
    expect(rows.find((x) => x.title === 'Lawn care')!.amounts![0]).toMatchObject({ cents: null, certainty: 'unknown' });
  });
  it('a part that could not be read makes the answer limited and says it may be missing, never "nothing is happening"', () => {
    const r = weekResult(buildWeekReview(inputs({ money: { state: 'failed' }, family: { state: 'failed' } })));
    expect(r.status).toBe('limited');
    expect(r.limitations.join(' ')).toMatch(/could not be read.*Missing is not the same as nothing happening/);
  });
  it('a quiet week with everything read is a checked "nothing"', () => {
    const r = weekResult(buildWeekReview(inputs({ needs: ready({ ranked: [], failed: [] }), money: ready({ ...money, rows: [], totals: { known: { cents: 0, count: 0 }, estimated: { cents: 0, count: 0 }, unknown: { count: 0 }, disputed: { count: 0 } } }) })));
    expect(r.status).toBe('none');
    expect(r.headline).toEqual(['Nothing is scheduled or waiting for this week.']);
  });
  it('links to the full This week page', () => {
    const r = weekResult(buildWeekReview(inputs()));
    expect(r.fullView?.href).toBe('#/today/week');
    expect(r.sources.map((s) => s.label)).toEqual(['This week', 'Calendar']);
  });
});
