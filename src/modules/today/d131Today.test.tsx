import { readFileSync, readdirSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CalItem } from '../calendar/useCalendarData';
import { ToastProvider } from '../../ui/Toast';
import { overdueGroups, todayList, upcomingDays } from './logic';
import { TodayHeroView } from './TodayHero';
import { TodayRow, openItem, openLabel } from './TodayRow';
import { kindIcon, nextWhen, stripCells, summarizeToday } from './todayModel';

const goTo = vi.fn();
vi.mock('../../core/dueProvider', async (orig) => ({ ...(await orig<typeof import('../../core/dueProvider')>()), goTo: (p: string) => goTo(p) }));

/**
 * D13.1. Today's new composition keeps every list, count and action; these guards check the row and hero markup, the stylesheet's structure, the date rules the
 * page relies on, and that the new files add no calculation, money code or timer. Every name, date and amount is invented.
 */

const TODAY = '2026-11-12'; // a Thursday
let n = 0;
const item = (o: Partial<CalItem> & { module?: string; complete?: boolean }): CalItem => {
  const { module, complete, ...rest } = o;
  const derived = module !== undefined && module !== 'calendar';
  return {
    key: `k${n++}`, title: 't', layerId: 1, layerName: 'Personal', color: '#4a7bd0', derived, allDay: true, firstDay: TODAY, lastDay: TODAY,
    startMs: Date.parse(`${rest.firstDay ?? TODAY}T00:00:00`), endMs: 0, priority: 'medium', location: '', done: false, overdue: false, soon: false, recurring: false,
    source: derived ? ({ sourceModule: module, sourceLabel: module === 'bills' ? 'Open bill' : 'Open task', openSource: () => goTo(`source:${module}`), actions: complete ? { complete: async () => undefined, reopen: async () => undefined } : undefined } as unknown as CalItem['source']) : undefined,
    ...rest,
  };
};
const day = (iso: string, extra: Partial<CalItem> & { module?: string; complete?: boolean } = {}) => item({ firstDay: iso, lastDay: iso, startMs: Date.parse(`${iso}T00:00:00`), ...extra });
const row = (it: CalItem, hide = false, tile?: { today: string; overdue?: boolean }) =>
  renderToStaticMarkup(<ToastProvider><ul><TodayRow item={it} hideAmounts={hide} tile={tile} /></ul></ToastProvider>);

beforeEach(() => goTo.mockClear());

describe('D13.1 rows', () => {
  it('a day row shows its time, a kind icon, the title and the source line; the kind icon is decorative', () => {
    const html = row(day('2026-11-13', { title: 'Family movie night', allDay: false, startMs: Date.parse('2026-11-13T19:00:00') }));
    expect(html).toContain('td-when');
    expect(html).toContain('7:00 PM');
    expect(html).toMatch(/class="td-kind" aria-hidden="true"/);
    expect(html).toContain('Family movie night');
    expect(html).toContain('Personal');
    expect(html).toContain('Edit in Calendar');
  });

  it('an overdue row starts with the red date tile (not a time) and carries the Overdue chip with its icon', () => {
    const html = row(day('2026-10-15', { title: 'Due: Demo Power Co', overdue: true, module: 'bills', layerName: 'Bills & Subscriptions' }), false, { today: TODAY, overdue: true });
    expect(html).toContain('ui-dtile--overdue');
    expect(html).not.toContain('td-when');
    expect(html).toContain('ui-chip--overdue');
    expect(html).toContain('Overdue');
    expect(html).toContain('Open bill');
    expect(html).toContain('Thursday, October 15, 2026, overdue'); // the tile speaks the full date and the state
  });

  it('a task keeps its check button (named Mark done) and a bill keeps a words button; money items never get a check', () => {
    expect(row(day('2026-11-13', { title: 'Call plumber', module: 'tasks', complete: true }))).toContain('aria-label="Mark done: Call plumber"');
    const bill = row(day('2026-11-15', { title: 'Due: Demo Streaming', module: 'bills' }));
    expect(bill).not.toContain('Mark done');
    expect(bill).toContain('td-open');
    expect(openLabel(day('2026-11-15', { module: 'bills' }))).toBe('Open bill');
  });

  it('a done item shows its Done chip and no check button; Due soon keeps its explanation', () => {
    const done = row(day('2026-11-13', { title: 'Finished', done: true }));
    expect(done).toContain('ui-chip--done');
    expect(done).not.toContain('Mark done');
    expect(row(day('2026-11-13', { soon: true }))).toContain('A reminder time has passed');
  });

  it('Hide amounts masks a dollar amount in the title, the accessible name and the tooltip', () => {
    const html = row(day('2026-11-15', { title: 'Pay $1,200.00 to Demo Co', module: 'tasks', complete: true }), true);
    expect(html).not.toMatch(/\$\s?\d/);
    expect(html).toContain('$••••');
    expect(row(day('2026-11-15', { title: 'Pay $1,200.00 to Demo Co', module: 'tasks', complete: true }), false)).toContain('$1,200.00');
  });

  it('the kind icon follows the item\'s existing source and defaults to the calendar icon', () => {
    expect(['tasks', 'bills', 'ledger', 'family', 'services', 'assets', 'projects', 'calendar', 'zzz'].map(kindIcon)).toEqual(['task', 'receipt', 'receipt', 'gift', 'wrench', 'home', 'folder', 'calendar', 'calendar']);
  });
});

describe('D13.1 navigation is unchanged', () => {
  it('an own event opens the Calendar agenda on its day with the item selected; a derived item opens its own module', () => {
    const e = day('2026-11-13', { title: 'Soccer practice' });
    openItem(e);
    expect(goTo).toHaveBeenCalledWith(`/calendar?v=agenda&d=2026-11-13&open=${encodeURIComponent(e.key)}`);
    openItem(day('2026-11-15', { module: 'bills' }));
    expect(goTo).toHaveBeenLastCalledWith('source:bills');
    expect(openLabel(e)).toBe('Edit in Calendar');
  });
});

describe('D13.1 Next up bar and status band', () => {
  const items: CalItem[] = [
    day('2026-11-12', { title: 'Dentist' }),
    day('2026-10-15', { title: 'Due: Demo Power Co', overdue: true, module: 'bills' }),
    day('2026-11-13', { title: 'House cleaning', module: 'tasks' }),
    day('2026-11-15', { title: 'Pay $1,200.00 to Demo Co', module: 'bills' }),
  ];
  const draw = (list: CalItem[], hide = false) => renderToStaticMarkup(<TodayHeroView s={summarizeToday(list, TODAY, 30, 7)} today={TODAY} hideAmounts={hide} overdueDays={30} lookAheadDays={7} />);

  it('selection is unchanged: the first row of Coming up; when today still has items the label says "after today"', () => {
    const s = summarizeToday(items, TODAY, 30, 7);
    expect(s.next).toBe(upcomingDays(items, TODAY, 7)[0].items[0]);
    const html = draw(items);
    expect(html).toContain('Next up');
    expect(html).toContain('td-next-qual');
    expect(html).toContain('after today');
    expect(html).toContain('1 on today&#x27;s schedule');
    expect(html).toContain('Tomorrow');
  });

  it('with nothing today the label is plain and the left half says so; with nothing coming up it says so without inventing an item', () => {
    const quiet = draw(items.filter((i) => i.title !== 'Dentist'));
    expect(quiet).not.toContain('after today');
    expect(quiet).toContain('Nothing scheduled for today');
    const none = draw([]);
    expect(none).toContain('Nothing in the next 7 days');
    expect(none).not.toContain('td-next-btn');
  });

  it('the band shows the same three counts the cards list, and an unknown value is never drawn as zero (the bar draws nothing until data exists)', () => {
    const s = summarizeToday(items, TODAY, 30, 7);
    const html = draw(items);
    expect(html).toMatch(/td-stat-num">1<\/span>.*td-stat-num">1<\/span>.*td-stat-num">2<\/span>/s); // overdue 1, today 1, coming up 2
    expect(s.overdueTotal).toBe(overdueGroups(items, TODAY, 30).reduce((a, g) => a + g.items.length, 0));
    expect(s.todayCount).toBe(todayList(items, TODAY).length);
    const hero = readFileSync(new URL('./TodayHero.tsx', import.meta.url), 'utf8');
    expect(hero).toContain('s ? <TodayHeroView');
    expect(hero).toContain(': null');
  });

  it('Hide amounts masks an amount in the Next up title and place, and the bar holds no money of its own', () => {
    const lone = [day('2026-11-15', { title: 'Pay $1,200.00 to Demo Co', module: 'bills', location: 'Branch $45' })];
    const shown = draw(lone, false);
    const hidden = draw(lone, true);
    expect(shown).toContain('$1,200.00');
    expect(hidden).not.toMatch(/\$\s?\d/);
    expect(hidden).toContain('$••••');
  });
});

describe('D13.1 dates', () => {
  const cells = (today: string, look = 7) => stripCells(upcomingDays([], today, look), today, look).map((c) => `${c.weekday} ${c.day}`);

  it('the next seven days cross a month, a year and a leap day correctly', () => {
    expect(cells('2026-11-27')).toEqual(['SAT 28', 'SUN 29', 'MON 30', 'TUE 1', 'WED 2', 'THU 3', 'FRI 4']);
    expect(cells('2026-12-28')).toEqual(['TUE 29', 'WED 30', 'THU 31', 'FRI 1', 'SAT 2', 'SUN 3', 'MON 4']);
    expect(cells('2028-02-26')).toEqual(['SUN 27', 'MON 28', 'TUE 29', 'WED 1', 'THU 2', 'FRI 3', 'SAT 4']);
    expect(cells('2026-02-26')).toEqual(['FRI 27', 'SAT 28', 'SUN 1', 'MON 2', 'TUE 3', 'WED 4', 'THU 5']); // 2026 is not a leap year
  });

  it('daylight saving days do not shift a date-only item by a day (spring forward 2026-03-08, fall back 2026-11-01)', () => {
    expect(cells('2026-03-06')).toEqual(['SAT 7', 'SUN 8', 'MON 9', 'TUE 10', 'WED 11', 'THU 12', 'FRI 13']);
    expect(cells('2026-10-30')).toEqual(['SAT 31', 'SUN 1', 'MON 2', 'TUE 3', 'WED 4', 'THU 5', 'FRI 6']);
    const dst = [day('2026-03-08', { title: 'On the clock change' }), day('2026-11-01', { title: 'On the fall back' })];
    expect(upcomingDays(dst, '2026-03-07', 7)[0].date).toBe('2026-03-08');
    expect(upcomingDays(dst, '2026-10-31', 7)[0].date).toBe('2026-11-01');
    expect(nextWhen('2026-03-08', '2026-03-07')).toBe('Tomorrow');
    expect(nextWhen('2026-11-01', '2026-10-31')).toBe('Tomorrow');
  });

  it('the Overdue window and the look-ahead still decide what is listed (unchanged functions)', () => {
    const items = [day('2026-10-13', { overdue: true, module: 'tasks' }), day('2026-10-12', { overdue: true, module: 'tasks' })];
    expect(overdueGroups(items, TODAY, 30).flatMap((g) => g.items).length).toBe(1); // 30 days back is Oct 13
    expect(summarizeToday([day('2026-11-19')], TODAY, 30, 7).upcomingCount).toBe(1);
    expect(summarizeToday([day('2026-11-20')], TODAY, 30, 7).upcomingCount).toBe(0);
  });
});

describe('D13.1 structure of the page and its stylesheet', () => {
  const css = readFileSync(new URL('./today.css', import.meta.url), 'utf8');
  const page = readFileSync(new URL('./TodayModule.tsx', import.meta.url), 'utf8');

  it('reading order: heading, then the Next up bar and status band, then the agenda column, then the supporting column (so a phone shows the agenda first)', () => {
    const at = (s: string) => page.indexOf(s);
    expect(at('<PageHeader')).toBeGreaterThan(-1);
    expect(at('<PageHeader')).toBeLessThan(at('<TodayHero'));
    expect(at('<TodayHero')).toBeLessThan(at('data-col="agenda"'));
    expect(at('data-col="agenda"')).toBeLessThan(at('data-col="side"'));
  });

  it('desktop: two columns only when the area is wide (a size container), about 62 and 38 percent; otherwise one column', () => {
    expect(css).toMatch(/\.td-cols-wrap \{ container-type: inline-size; \}/);
    expect(css).toMatch(/\.td-cols \{ display: grid; grid-template-columns: minmax\(0, 1fr\);/);
    expect(css).toMatch(/@container \(min-width: 880px\) \{\s*\.td-cols \{ grid-template-columns: minmax\(0, 1\.65fr\) minmax\(0, 1fr\)/);
  });

  it('the stylesheet uses theme tokens only: no hex colors, no important flags', () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/!important/);
  });

  it('phone: controls and rows keep 44 px targets and the header is one compact row', () => {
    const coarse = css.slice(css.indexOf('@media (max-width: 640px), (pointer: coarse)'));
    expect(coarse.slice(0, coarse.indexOf('\n}'))).toMatch(/\.td-check \{ width: 44px; min-width: 44px; height: 44px; \}[\s\S]*\.td-tools button, \.td-tools button\.ghost \{ min-height: 44px; min-width: 44px; \}[\s\S]*\.td-act \.td-open \{ min-height: 44px; \}/);
    expect(css).toMatch(/\.page-head\.td-head \{ display: grid; grid-template-columns: minmax\(0, 1fr\) auto;/);
  });

  it('the page uses the app\'s own day hook (it updates itself at midnight) and adds no timer, clock or storage of its own', () => {
    expect(page).toContain("useToday()");
    const files = readdirSync(new URL('.', import.meta.url)).filter((f) => /^(TodayModule|TodayHero|TodayRow|cards|composition|todayModel)\.tsx?$/.test(f));
    for (const f of files) expect(readFileSync(new URL(f, import.meta.url), 'utf8'), f).not.toMatch(/setInterval|setTimeout|Date\.now\(|new Date\(/);
  });

  it('the new composition touches no money, recurrence, schedule or database code', () => {
    for (const f of ['composition.ts', 'TodayModule.tsx', 'TodayRow.tsx', 'cards.tsx', 'todayModel.ts']) {
      const src = readFileSync(new URL(f, import.meta.url), 'utf8');
      expect(src, f).not.toMatch(/formatCents|cashOutlook|from '\.\.\/\.\.\/db'|recurrence|services\/schedule|\.bulkAdd\(|\.put\(/);
    }
  });

  it('the card definitions (ids, titles, priorities) are the D11 ones', () => {
    const src = readFileSync(new URL('./cards.tsx', import.meta.url), 'utf8');
    expect(src).toContain("{ id: 'today.agenda', title: 'Today', defaultWidth: 'full', priority: 10,");
    expect(src).toContain("{ id: 'today.reminders', title: 'Reminders due', defaultWidth: 'half', priority: 15, hideWhenEmpty: true,");
    expect(src).toContain("{ id: 'today.overdue', title: 'Overdue', defaultWidth: 'half', priority: 20, hideWhenEmpty: true,");
    expect(src).toContain("{ id: 'today.upcoming', title: 'Coming up', defaultWidth: 'half', priority: 30,");
  });
});
