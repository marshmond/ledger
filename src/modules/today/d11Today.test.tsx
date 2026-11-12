import { readFileSync, readdirSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { CalItem } from '../calendar/useCalendarData';
import { defaultLayout, LAYOUT_KEY, resolveLayout } from './layout';
import { dayHeading, maskAmounts, overdueGroups, todayList, upcomingDays } from './logic';
import { DayStrip, TodayHeroView } from './TodayHero';
import { TodayRow } from './TodayRow';
import { headingDate, nextWhen, rangeText, stripCells, summarizeToday } from './todayModel';
import { ToastProvider } from '../../ui/Toast';
import { HIDE_AMOUNTS_KEY } from '../../core/hideAmounts';

/**
 * D11. Today's new top (the "Next up" bar, the status band, the day strip) and its date tiles. The guards here are about what the redesign must NOT do:
 * invent a number or an urgency rule, change which items are overdue or coming up, change the card list or the saved layout, or let an amount through
 * Hide amounts. Every date and amount is invented.
 */

const TODAY = '2026-11-12'; // a Thursday
let n = 0;
const item = (o: Partial<CalItem> & { module?: string }): CalItem => {
  const { module, ...rest } = o;
  return {
    key: `k${n++}`, title: 't', layerId: 1, layerName: 'Personal', color: '#4a7bd0', derived: module !== undefined && module !== 'calendar', allDay: true, firstDay: TODAY, lastDay: TODAY,
    startMs: Date.parse(`${rest.firstDay ?? TODAY}T00:00:00`), endMs: 0, priority: 'medium', location: '', done: false, overdue: false, soon: false, recurring: false,
    source: module && module !== 'calendar' ? ({ sourceModule: module, sourceLabel: 'Open bill', openSource: () => undefined } as unknown as CalItem['source']) : undefined, ...rest,
  };
};
const day = (iso: string, extra: Partial<CalItem> & { module?: string } = {}) => item({ firstDay: iso, lastDay: iso, startMs: Date.parse(`${iso}T00:00:00`), ...extra });

const sample = (): CalItem[] => [
  day('2026-11-12', { title: 'Dentist', allDay: false, startMs: Date.parse('2026-11-12T15:00:00') }),
  day('2026-10-15', { title: 'Due: Demo Power Co', overdue: true, module: 'bills' }),
  day('2026-11-09', { title: 'Renew library cards', overdue: true, module: 'tasks' }),
  day('2026-11-09', { title: 'Another late task', overdue: true, module: 'tasks' }),
  day('2026-11-13', { title: 'House cleaning', module: 'tasks' }),
  day('2026-11-13', { title: 'Family movie night', allDay: false, startMs: Date.parse('2026-11-13T19:00:00') }),
  day('2026-11-15', { title: 'Pay $1,200.00 to Demo Co', module: 'bills' }),
  day('2026-11-25', { title: 'Beyond the look-ahead' }),
];

describe('D11 summary: counts and Next up come from the lists the cards use', () => {
  const items = sample();
  const s = summarizeToday(items, TODAY, 30, 7);

  it('the overdue count is the sum of the Overdue card\'s groups, per module, in the card\'s order', () => {
    const groups = overdueGroups(items, TODAY, 30);
    expect(s.overdueTotal).toBe(groups.reduce((a, g) => a + g.items.length, 0));
    expect(s.overdueParts).toEqual(groups.map((g) => ({ moduleId: g.moduleId, count: g.items.length })));
    expect(s.overdueTotal).toBe(3);
  });

  it('the Today and Coming up counts are the lengths of the Today and Coming up lists', () => {
    expect(s.todayCount).toBe(todayList(items, TODAY).length);
    expect(s.upcomingCount).toBe(upcomingDays(items, TODAY, 7).reduce((a, d) => a + d.items.length, 0));
    expect(s.upcomingCount).toBe(3); // 13th x2 and 15th; the 25th is past the 7 day look-ahead
    expect(s.days).toEqual(upcomingDays(items, TODAY, 7));
  });

  it('Next up is the first row of Coming up and nothing else (no rule of its own)', () => {
    const first = upcomingDays(items, TODAY, 7)[0].items[0];
    expect(s.next).toBe(first);
    expect(s.next?.title).toBe('House cleaning'); // all-day items come first in the card's own order, even though the movie has a time
  });

  it('with nothing coming up there is no Next up and no invented item', () => {
    const none = summarizeToday([day('2026-11-12', { title: 'Dentist' })], TODAY, 30, 7);
    expect(none.next).toBeNull();
    expect(none.upcomingCount).toBe(0);
    expect(none.todayCount).toBe(1);
    expect(summarizeToday([], TODAY, 30, 7)).toMatchObject({ overdueTotal: 0, todayCount: 0, upcomingCount: 0, next: null, days: [], overdueParts: [] });
  });

  it('items outside the overdue window or already done are not counted, exactly as in the card', () => {
    const old = day('2026-08-01', { overdue: true, module: 'tasks' });
    const done = day('2026-11-08', { overdue: true, done: true, module: 'tasks' });
    expect(summarizeToday([old, done], TODAY, 30, 7).overdueTotal).toBe(0);
    expect(summarizeToday([old], TODAY, 120, 7).overdueTotal).toBe(1);
  });

  it('the look-ahead setting changes the range and the count the same way it changes the card', () => {
    const wide = summarizeToday(items, TODAY, 30, 14);
    expect(wide.upcomingTo).toBe('2026-11-26');
    expect(wide.upcomingCount).toBe(4);
    expect(summarizeToday(items, TODAY, 30, 3).upcomingCount).toBe(3); // the 15th is exactly 3 days ahead
    expect(summarizeToday(items, TODAY, 30, 2).upcomingCount).toBe(2);
  });
});

describe('D11 dates: calendar facts only, no clock', () => {
  it('Today\'s heading date is a weekday and the rest, from the date given', () => {
    expect(headingDate('2026-11-12')).toEqual({ weekday: 'Thursday', rest: 'November 12, 2026' });
    expect(headingDate('2027-01-01')).toEqual({ weekday: 'Friday', rest: 'January 1, 2027' });
    expect(headingDate('not a date')).toBeNull();
    expect(headingDate('2026-02-30')).toBeNull();
  });

  it('Next up says Tomorrow or a dated day, adding the year only when it differs', () => {
    expect(nextWhen('2026-11-13', TODAY)).toBe('Tomorrow');
    expect(nextWhen('2026-11-14', TODAY)).toBe('Sat, Nov 14'); // a weekend date
    expect(nextWhen('2027-01-03', '2026-12-31')).toBe('Sun, Jan 3, 2027');
    expect(nextWhen('2027-01-01', '2026-12-31')).toBe('Tomorrow'); // year boundary
    expect(nextWhen('2026-03-02', '2026-02-28')).toBe('Mon, Mar 2'); // month boundary, not a leap year: the 28th is followed by March 1
    expect(nextWhen('2026-03-01', '2026-02-28')).toBe('Tomorrow');
    expect(nextWhen('2026-03-09', '2026-03-08')).toBe('Tomorrow'); // the day the US clocks go forward: still the next calendar day
    expect(nextWhen('2026-11-02', '2026-11-01')).toBe('Tomorrow'); // the day they go back
  });

  it('the range text spans a month and a year without moving any day', () => {
    expect(rangeText('2026-11-13', '2026-11-19')).toBe('Nov 13 to Nov 19');
    expect(rangeText('2026-11-28', '2026-12-04')).toBe('Nov 28 to Dec 4');
    expect(rangeText('2026-12-29', '2027-01-04')).toBe('Dec 29, 2026 to Jan 4, 2027');
  });

  it('the day strip starts tomorrow, never passes 7 days or the look-ahead, and counts the card\'s own rows', () => {
    const days = upcomingDays(sample(), TODAY, 7);
    const cells = stripCells(days, TODAY, 7);
    expect(cells.map((c) => c.date)).toEqual(['2026-11-13', '2026-11-14', '2026-11-15', '2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19']);
    expect(cells.map((c) => c.count)).toEqual([2, 0, 1, 0, 0, 0, 0]);
    expect(cells[0].tone).toBe('tomorrow');
    expect(cells[1].tone).toBe('weekend'); // Saturday
    expect(cells[1].weekday).toBe('SAT');
    expect(stripCells(days, TODAY, 3)).toHaveLength(3);
    expect(stripCells(upcomingDays(sample(), TODAY, 30), TODAY, 30)).toHaveLength(7);
    expect(stripCells(days, TODAY, 0)).toEqual([]);
  });

  it('the Coming up day heading words (kept as a hidden heading) are unchanged', () => {
    expect(dayHeading('2026-11-13', TODAY, (x) => `L(${x})`)).toBe('Tomorrow');
    expect(dayHeading('2026-11-14', TODAY, (x) => `L(${x})`)).toBe('L(2026-11-14)');
  });
});

describe('D11 Hide amounts: nothing new can show an amount', () => {
  const html = (hide: boolean) => renderToStaticMarkup(<TodayHeroView s={summarizeToday(sample().map((i) => (i.title.startsWith('Pay') ? { ...i, firstDay: '2026-11-13', lastDay: '2026-11-13' } : i)).filter((i) => i.title !== 'House cleaning'), TODAY, 30, 7)} today={TODAY} hideAmounts={hide} overdueDays={30} lookAheadDays={7} />);

  it('the Next up title is masked when the switch is on, and shown when it is off', () => {
    expect(html(false)).toContain('Pay $1,200.00 to Demo Co');
    const on = html(true);
    expect(on).toContain('Pay $••••');
    expect(on).not.toContain('1,200'); // ids-ok: a fixed invented amount in a test string; generated ids never contain a comma
    expect(on).not.toMatch(/\$\s?\d/);
  });

  it('a masked row masks the same way (title, accessible name and tooltip text)', () => {
    const row = renderToStaticMarkup(<ToastProvider><ul><TodayRow item={item({ title: 'Pay $1,200.00 to Demo Co', priority: 'high' })} hideAmounts tile={{ today: TODAY }} /></ul></ToastProvider>);
    expect(row).not.toContain('1,200'); // ids-ok: a fixed invented amount in a test string; generated ids never contain a comma
    expect(row).toContain('$••••');
  });

  it('the band and strip hold only counts and dates (no money value is computed anywhere in the new files)', () => {
    for (const f of ['TodayHero.tsx', 'todayModel.ts']) {
      const src = readFileSync(`src/modules/today/${f}`, 'utf8');
      expect(src, f).not.toMatch(/formatCents|cents|cashOutlook|useLiveQuery|from '\.\.\/\.\.\/db'|localStorage|Date\.now|new Date\(/);
    }
  });

  it('maskAmounts is the unchanged rule', () => {
    expect(maskAmounts('Pay $1,234.56, -$80 and $5')).toBe('Pay $••••, $•••• and $••••');
  });
});

describe('D11 markup: date tiles speak the full date, status is words', () => {
  it('an overdue row draws a tile with a machine date, the full date as hidden text and "overdue"', () => {
    const html = renderToStaticMarkup(<ToastProvider><ul><TodayRow item={day('2026-10-15', { title: 'Due: Demo Power Co', overdue: true, module: 'bills' })} hideAmounts={false} tile={{ today: TODAY, overdue: true }} /></ul></ToastProvider>);
    expect(html).toContain('dateTime="2026-10-15"');
    expect(html).toContain('Thursday, October 15, 2026');
    expect(html).toContain('overdue');
    expect(html).toContain('ui-dtile--overdue');
    expect(html).toContain('Overdue'); // the visible chip word beside the title
    expect(html).toContain('Open bill'); // the existing action, unchanged
  });

  it('a row without a tile is the old row (time column, no tile)', () => {
    const html = renderToStaticMarkup(<ToastProvider><ul><TodayRow item={item({ title: 'Dentist' })} hideAmounts={false} /></ul></ToastProvider>);
    expect(html).toContain('td-when');
    expect(html).not.toContain('ui-dtile');
  });

  it('the Next up bar offers the item\'s own existing action and names it', () => {
    const html = renderToStaticMarkup(<TodayHeroView s={summarizeToday(sample(), TODAY, 30, 7)} today={TODAY} hideAmounts={false} overdueDays={30} lookAheadDays={7} />);
    expect(html).toContain('Next up');
    expect(html).toContain('House cleaning');
    expect(html).toContain('Tomorrow · All day');
    expect(html).toContain('Open bill'); // the stand-in source's label: whatever the owning module calls the action is used as is
    expect(html).toContain('1 on today&#x27;s schedule');
    expect(html).toContain('Overdue');
    expect(html).toContain('Nov 13 to Nov 19');
  });

  it('empty states are plain sentences with no placeholder activity', () => {
    const html = renderToStaticMarkup(<TodayHeroView s={summarizeToday([], TODAY, 30, 7)} today={TODAY} hideAmounts={false} overdueDays={30} lookAheadDays={7} />);
    expect(html).toContain('Nothing scheduled for today');
    expect(html).toContain('Nothing in the next 7 days');
    expect(html).toContain('Nothing overdue in the last 30 days');
    expect(html).not.toContain('td-next-title');
  });

  it('the phone day strip is a picture only: hidden from assistive technology', () => {
    const html = renderToStaticMarkup(<DayStrip cells={stripCells([], TODAY, 7)} />);
    expect(html).toContain('aria-hidden="true"');
    expect(renderToStaticMarkup(<DayStrip cells={[]} />)).toBe('');
  });
});

describe('D11 cards and layout are untouched', () => {
  const files = [
    'src/modules/today/cards.tsx', 'src/modules/ledger/todayCards.tsx', 'src/modules/projects/todayCards.tsx', 'src/modules/bills/todayCards.tsx',
    'src/modules/assets/todayCards.tsx', 'src/modules/household/todayCards.tsx', 'src/modules/services/todayCards.tsx',
  ];
  const ids = files.flatMap((f) => [...readFileSync(f, 'utf8').matchAll(/\{ id: '([a-z]+\.[a-zA-Z]+)', title: '([^']+)', defaultWidth: '(half|full)', priority: (\d+)(, hideWhenEmpty: true)?/g)].map((m) => ({ id: m[1], title: m[2], width: m[3], priority: Number(m[4]), hide: !!m[5] })));

  it('the same eleven cards, with the same titles, widths, priorities and hide-when-empty flags', () => {
    expect(ids).toEqual([
      { id: 'today.agenda', title: 'Today', width: 'full', priority: 10, hide: false },
      { id: 'today.reminders', title: 'Reminders due', width: 'half', priority: 15, hide: true },
      { id: 'today.overdue', title: 'Overdue', width: 'half', priority: 20, hide: true },
      { id: 'today.upcoming', title: 'Coming up', width: 'half', priority: 30, hide: false },
      { id: 'ledger.attention', title: 'Needs attention', width: 'half', priority: 40, hide: false },
      { id: 'ledger.cash', title: 'Cash outlook', width: 'half', priority: 50, hide: true },
      { id: 'projects.attention', title: 'Projects', width: 'half', priority: 35, hide: true },
      { id: 'bills.attention', title: 'Bills & Subscriptions', width: 'half', priority: 37, hide: true },
      { id: 'assets.attention', title: 'Home & Assets', width: 'half', priority: 38, hide: true },
      { id: 'household.attention', title: 'Household finances', width: 'half', priority: 38, hide: true },
      { id: 'services.attention', title: 'Household Services', width: 'half', priority: 39, hide: true },
    ]);
  });

  it('the default layout still lists them by priority, and a saved layout still resolves as before', () => {
    const cards = ids.map((c) => ({ id: c.id, defaultWidth: c.width as 'half' | 'full', priority: c.priority }));
    const d = defaultLayout(cards);
    expect(d.map((e) => e.id)).toEqual(['today.agenda', 'today.reminders', 'today.overdue', 'today.upcoming', 'projects.attention', 'bills.attention', 'assets.attention', 'household.attention', 'services.attention', 'ledger.attention', 'ledger.cash']);
    const saved = [{ id: 'ledger.cash', size: 'full', hidden: true }, { id: 'today.upcoming', size: 'half', hidden: false }, { id: 'gone.card', size: 'full', hidden: false }];
    const r = resolveLayout(saved, cards);
    expect(r.slice(0, 2)).toEqual([{ id: 'ledger.cash', size: 'full', hidden: true }, { id: 'today.upcoming', size: 'half', hidden: false }]);
    expect(r).toHaveLength(11);
    expect(r.some((e) => e.id === 'gone.card')).toBe(false);
  });

  it('the stored keys are unchanged', () => {
    expect(LAYOUT_KEY).toBe('today.layout.v1');
    expect(HIDE_AMOUNTS_KEY).toBe('today.hideAmounts.v1');
  });

  it('the new top is not a card: it is mounted by the page, not registered, and the layout editor does not list it', () => {
    const page = readFileSync('src/modules/today/TodayModule.tsx', 'utf8');
    expect(page).toContain('<TodayHero today={today} hideAmounts={hideAmounts} />');
    expect(readFileSync('src/modules/today/cards.tsx', 'utf8')).not.toContain('<TodayHero');
    expect(readdirSync('src/modules/today').filter((f) => /^(layout|settings)\.ts$/.test(f))).toHaveLength(2);
  });

  it('the card pieces still use the unchanged list rules (no copy of them in the cards)', () => {
    const cards = readFileSync('src/modules/today/cards.tsx', 'utf8');
    expect(cards).toContain('overdueGroups(items, today, overdueDays)');
    expect(cards).toContain('upcomingDays(items, today, lookAheadDays)');
    expect(cards).toContain('todayList(items, today)');
    expect(cards).toContain("tile={{ today, overdue: true }}");
    expect(cards).not.toMatch(/\.filter\(\(i\) => i\.overdue/);
  });
});
