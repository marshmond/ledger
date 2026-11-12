import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { FinanceDB } from '../../db';
import { all, byTag, parseHtml, textOf, unnamedButtons, type El } from '../../lib/a11yTestkit';
import { addDays } from '../../lib/dates';
import { providerNamed } from '../../core/contactTestkit';
import { installTracking } from '../../lib/sync/track';
import { tasksOfArrangement, createArrangement } from '../services/data';
import { servicesDueItems } from '../services/dueProvider';
import { blankArrangement, type Cadence } from '../services/model';
import AgendaView from './AgendaView';
import {
  cellModel, contextLine, dayButtonName, dayTone, fullDate, gridWeeks, itemAccessibleName, itemCountWords, MAX_CELL_ITEMS, moveSelection, relativeWord, stepMonth, weekdayHeads,
} from './calendarModel';
import MonthView, { monthGridStart } from './MonthView';
import { FAMILY_ID, FINANCE_ID, PERSONAL_ID, TASKS_ID } from './model';
import SelectedDay from './SelectedDay';
import { ALL_ON, deselectAll, type Visibility, isLayerVisible, parseVisibility, selectAll, serializeVisibility, toggleLayer, visibleCount, VISIBILITY_KEY } from './layerVisibility';
import { readVisibility, sortItems, type CalItem } from './useCalendarData';

/**
 * D13: the Calendar redesign. Every name, date and layer here is invented. 2026-11-12 is a Thursday ("today" below).
 * These tests pin behavior and structure, not pixels: the grid's roles and marks, the selection model, the words a screen reader hears, the layer
 * choices, the page's address contract and unchanged scheduling (the services projections come from the real data layer, only read here).
 */
const TODAY = '2026-11-12';
const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const html = (node: Parameters<typeof renderToStaticMarkup>[0]) => parseHtml(renderToStaticMarkup(node));

let seq = 0;
const item = (over: Partial<CalItem> & { day: string }): CalItem => {
  const { day, ...rest } = over;
  seq++;
  return {
    key: `t:${seq}`, title: `Item ${seq}`, layerId: PERSONAL_ID, layerName: 'Personal', color: '#4a7bd0', derived: false, allDay: true, firstDay: day, lastDay: day,
    startMs: Date.parse(`${day}T00:00:00Z`), endMs: Date.parse(`${day}T00:00:00Z`) + 86_400_000, priority: 'medium', location: '', done: false, overdue: false, soon: false, recurring: false,
    ...rest,
  };
};
const noop = () => undefined;
const drawMonth = (items: CalItem[], over: { month?: string; selected?: string; today?: string; weekStart?: number } = {}) =>
  html(createElement(MonthView, { month: over.month ?? '2026-11', selected: over.selected ?? TODAY, weekStart: over.weekStart ?? 0, today: over.today ?? TODAY, items, onSelect: noop, onCreate: noop, onOpenItem: noop }));
const cells = (d: El) => all(d, (e) => e.attrs.role === 'gridcell');
const cellOf = (d: El, date: string) => cells(d).find((c) => c.attrs['data-date'] === date)!;
/** The words of a decorative (aria-hidden) tag in a cell: sighted people read them, assistive technology gets the button's name instead. */
const tag = (c: El, cls: string) => all(c, (e) => (e.attrs.class ?? '') === cls).map((e) => e.children.join('')).join('');
const dayBtn = (c: El) => all(c, (e) => e.tag === 'button' && (e.attrs.class ?? '').includes('cal-daynum'))[0];

describe('D13 the month grid is cut into six real weeks', () => {
  it('monthGridStart is unchanged: the first day of the week that holds the 1st', () => {
    expect(monthGridStart('2026-11', 0)).toBe('2026-11-01');   // Nov 1, 2026 is a Sunday
    expect(monthGridStart('2026-11', 1)).toBe('2026-10-26');
    expect(monthGridStart('2027-01', 0)).toBe('2026-12-27');   // across the year boundary
    expect(monthGridStart('2028-02', 0)).toBe('2028-01-30');   // leap year
  });
  it('gridWeeks gives six rows of seven consecutive dates', () => {
    const w = gridWeeks('2026-11-01');
    expect(w).toHaveLength(6);
    expect(w.every((r) => r.length === 7)).toBe(true);
    const flat = w.flat();
    expect(flat[0]).toBe('2026-11-01'); expect(flat[41]).toBe('2026-12-12');
    expect(new Set(flat).size).toBe(42);
    for (let i = 1; i < flat.length; i++) expect(flat[i]).toBe(addDays(flat[i - 1], 1));
  });
  it('weekday headings follow the first day of the week (Sunday or Monday)', () => {
    expect(weekdayHeads(0).map((h) => h.short)).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
    expect(weekdayHeads(1).map((h) => h.long)).toEqual(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']);
    expect(weekdayHeads(6)[0].long).toBe('Saturday');
  });
  it('the grid is the same in every time zone, including the days the clocks change (it only does calendar-day arithmetic)', () => {
    const original = process.env.TZ;
    try {
      for (const tz of ['America/New_York', 'Europe/London', 'Australia/Lord_Howe', 'Pacific/Auckland', 'UTC']) {
        process.env.TZ = tz;
        for (const start of ['2026-10-25', '2027-03-07', '2027-03-28', '2026-11-01']) {
          const flat = gridWeeks(start).flat();
          for (let i = 1; i < flat.length; i++) expect(flat[i], `${tz} ${start}`).toBe(addDays(flat[i - 1], 1));
          expect(flat[0]).toBe(start);
        }
        expect(moveSelection('2027-03-13', 'ArrowRight', 0)).toBe('2027-03-14');   // US spring-forward Sunday
        expect(moveSelection('2026-10-31', 'ArrowRight', 0)).toBe('2026-11-01');   // US fall-back Sunday
      }
    } finally { if (original === undefined) delete process.env.TZ; else process.env.TZ = original; }
  });
});

describe('D13 selection and keyboard movement', () => {
  it('arrow keys move by a day and a week, Home and End to the ends of the week (either first day), PageUp and PageDown by a month', () => {
    expect(moveSelection('2026-11-12', 'ArrowLeft', 0)).toBe('2026-11-11');
    expect(moveSelection('2026-11-12', 'ArrowRight', 0)).toBe('2026-11-13');
    expect(moveSelection('2026-11-12', 'ArrowUp', 0)).toBe('2026-11-05');
    expect(moveSelection('2026-11-12', 'ArrowDown', 0)).toBe('2026-11-19');
    expect(moveSelection('2026-11-12', 'Home', 0)).toBe('2026-11-08');   // Sunday-first
    expect(moveSelection('2026-11-12', 'End', 0)).toBe('2026-11-14');
    expect(moveSelection('2026-11-12', 'Home', 1)).toBe('2026-11-09');   // Monday-first
    expect(moveSelection('2026-11-12', 'End', 1)).toBe('2026-11-15');
    expect(moveSelection('2026-11-15', 'Home', 1)).toBe('2026-11-09');   // a Sunday is the END of a Monday-first week
    expect(moveSelection('2026-11-12', 'PageDown', 0)).toBe('2026-12-12');
    expect(moveSelection('2026-11-12', 'PageUp', 0)).toBe('2026-10-12');
    expect(moveSelection('2026-11-12', 'PageDown', 0, true)).toBe('2027-11-12');
    expect(moveSelection('2026-11-12', 'a', 0)).toBeNull();
    expect(moveSelection('2026-11-12', 'Enter', 0)).toBeNull();
  });
  it('month ends, year ends and leap years', () => {
    expect(moveSelection('2026-11-30', 'ArrowRight', 0)).toBe('2026-12-01');
    expect(moveSelection('2026-12-31', 'ArrowRight', 0)).toBe('2027-01-01');
    expect(moveSelection('2027-01-01', 'ArrowLeft', 0)).toBe('2026-12-31');
    expect(moveSelection('2028-02-28', 'ArrowRight', 0)).toBe('2028-02-29');
    expect(moveSelection('2028-02-29', 'ArrowRight', 0)).toBe('2028-03-01');
    expect(moveSelection('2027-02-28', 'ArrowRight', 0)).toBe('2027-03-01');
    expect(moveSelection('2027-01-31', 'PageDown', 0)).toBe('2027-02-28');   // clamped to the shorter month
    expect(moveSelection('2028-01-31', 'PageDown', 0)).toBe('2028-02-29');
    expect(moveSelection('2028-02-29', 'PageDown', 0, true)).toBe('2029-02-28');
  });
  it('stepping a month keeps the same day of the month (clamped), so the selected day is never invented', () => {
    expect(stepMonth('2026-11-12', 1)).toBe('2026-12-12');
    expect(stepMonth('2026-01-31', 1)).toBe('2026-02-28');
    expect(stepMonth('2026-03-31', -1)).toBe('2026-02-28');
    expect(stepMonth('2026-12-15', 1)).toBe('2027-01-15');
  });
  it('exactly one cell is selected and exactly one is today; when they differ both marks exist on different cells', () => {
    const d = drawMonth([], { selected: '2026-11-20' });
    expect(cells(d)).toHaveLength(42);
    const sel = cells(d).filter((c) => c.attrs['aria-selected'] === 'true');
    const cur = cells(d).filter((c) => c.attrs['aria-current'] === 'date');
    expect(sel.map((c) => c.attrs['data-date'])).toEqual(['2026-11-20']);
    expect(cur.map((c) => c.attrs['data-date'])).toEqual([TODAY]);
    expect(cells(d).filter((c) => c.attrs['aria-selected'] === 'false')).toHaveLength(41);
  });
  it('when today is the selected day one cell carries both marks, and today is also written as a word', () => {
    const d = drawMonth([], { selected: TODAY });
    const c = cellOf(d, TODAY);
    expect(c.attrs['aria-selected']).toBe('true'); expect(c.attrs['aria-current']).toBe('date');
    expect(tag(c, 'cal-today-tag')).toBe('Today');   // a visible word, not only a filled number
    expect(dayBtn(c).attrs['aria-label']).toBe('Thursday, November 12, 2026, today, no items');
    expect(tag(cellOf(d, '2026-11-13'), 'cal-today-tag')).toBe('');
  });
  it('one day number button is the grid\'s single Tab stop, and it is the selected one', () => {
    const d = drawMonth([item({ day: '2026-11-20' })], { selected: '2026-11-20' });
    const stops = cells(d).map(dayBtn).filter((b) => b.attrs.tabindex === '0');
    expect(stops).toHaveLength(1);
    expect(stops[0].parent!.parent!.attrs['data-date']).toBe('2026-11-20');
    // items inside unselected cells are not Tab stops (they are all in the selected-day list, which is)
    const chips = all(cellOf(d, '2026-11-20'), (e) => e.tag === 'button' && (e.attrs.class ?? '').includes('cal-chip'));
    expect(chips.every((c) => c.attrs.tabindex === '0')).toBe(true);
    const other = drawMonth([item({ day: '2026-11-20' })], { selected: '2026-11-12' });
    expect(all(cellOf(other, '2026-11-20'), (e) => e.tag === 'button' && (e.attrs.class ?? '').includes('cal-chip')).every((c) => c.attrs.tabindex === '-1')).toBe(true);
  });
  it('the grid is a real grid: a header row with named columns and six week rows, each of seven cells', () => {
    const d = drawMonth([]);
    const grid = all(d, (e) => e.attrs.role === 'grid')[0];
    expect(grid.attrs['aria-label']).toBe('November 2026 calendar');
    const rows = all(d, (e) => e.attrs.role === 'row');
    expect(rows).toHaveLength(7);
    const heads = all(d, (e) => e.attrs.role === 'columnheader');
    expect(heads.map((h) => h.attrs['aria-label'])).toEqual(['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']);
    for (const r of rows.slice(1)) expect(r.children.filter((c) => typeof c !== 'string' && c.attrs.role === 'gridcell')).toHaveLength(7);
  });
  it('days outside the month and weekend days are marked, and the first of a month names the month', () => {
    const d = drawMonth([], { month: '2026-10', selected: '2026-10-15' });   // October 2026 starts on a Thursday, so the grid shows September and November days
    expect(cellOf(d, '2026-09-30').attrs.class).toContain('out');
    expect(cellOf(d, '2026-11-01').attrs.class).toContain('out');
    expect(cellOf(d, '2026-10-17').attrs.class).toContain('weekend');
    expect(cellOf(d, '2026-10-16').attrs.class).not.toContain('weekend');
    expect(cellOf(d, '2026-10-01').attrs.class).not.toContain('out');
    expect(tag(cellOf(d, '2026-10-01'), 'cal-month-tag')).toBe('Oct');
    expect(tag(cellOf(d, '2026-11-01'), 'cal-month-tag')).toBe('Nov');
    expect(tag(cellOf(d, '2026-10-02'), 'cal-month-tag')).toBe('');
    expect(dayTone({ isToday: true, isWeekend: true, isOut: false })).toBe('today');
    expect(dayTone({ isToday: false, isWeekend: true, isOut: true })).toBe('out');
  });
});

describe('D13 items in cells, overflow, order and names', () => {
  const day = '2026-11-18';
  const timed = (h: number, title: string, over: Partial<CalItem> = {}) => item({ day, title, allDay: false, startMs: Date.parse(`${day}T${String(h).padStart(2, '0')}:00:00Z`), endMs: Date.parse(`${day}T${String(h).padStart(2, '0')}:30:00Z`), ...over });
  it('events are in the cell of their own date, never another (including adjacent-month cells)', () => {
    const items = [item({ day: '2026-10-01', title: 'First' }), item({ day: '2026-09-30', title: 'Before' }), item({ day: '2026-11-01', title: 'After' }), item({ day: '2026-10-31', title: 'Last' })];
    const d = drawMonth(items, { month: '2026-10', selected: '2026-10-15' });
    for (const [date, title] of [['2026-10-01', 'First'], ['2026-09-30', 'Before'], ['2026-11-01', 'After'], ['2026-10-31', 'Last']]) {
      expect(textOf(cellOf(d, date))).toContain(title);
      for (const other of cells(d)) if (other.attrs['data-date'] !== date) expect(textOf(other)).not.toContain(title);
    }
  });
  it('a multi-day item appears in every cell it covers, once per cell', () => {
    const d = drawMonth([item({ day: '2026-11-25', lastDay: '2026-11-27', title: 'Grandparents visit' })]);
    for (const date of ['2026-11-25', '2026-11-26', '2026-11-27']) expect(all(cellOf(d, date), (e) => e.tag === 'button' && (e.attrs.class ?? '').includes('cal-chip'))).toHaveLength(1);
    expect(textOf(cellOf(d, '2026-11-28'))).not.toContain('Grandparents');
  });
  it('a dense day lists the first three in the day\'s own order, counts the rest, and the cell\'s name says how many there are', () => {
    const many = [timed(17, 'E'), timed(9, 'B'), item({ day, title: 'A all day' }), timed(8, 'C'), timed(10, 'D'), timed(18, 'F')];
    const m = cellModel(day, { month: '2026-11', today: TODAY, selected: TODAY, items: many });
    expect(MAX_CELL_ITEMS).toBe(3);
    expect(m.count).toBe(6);
    expect(m.shown.map((i) => i.title)).toEqual(['A all day', 'C', 'B']);   // all-day first, then by time (the existing rule)
    expect(m.more).toBe(3);
    expect(m.dots).toHaveLength(4);
    const d = drawMonth(many);
    const c = cellOf(d, day);
    expect(textOf(c)).toContain('+3 more');
    expect(dayBtn(c).attrs['aria-label']).toBe('Wednesday, November 18, 2026, 6 items');
    // nothing is dropped: the selected-day list shows all six
    const sel = html(createElement(SelectedDay, { date: day, today: TODAY, items: many, onOpenItem: noop, onAdd: noop, onAddTask: noop }));
    expect(all(sel, (e) => e.tag === 'button' && (e.attrs.class ?? '').includes('cal-row'))).toHaveLength(6);
    expect(textOf(sel)).toContain('6 items');
  });
  it('the order within a day is the existing rule (all-day, start time, priority, title) and was not changed', () => {
    const a = item({ day, title: 'b', allDay: false, startMs: 5, priority: 'low' });
    const b = item({ day, title: 'a', allDay: false, startMs: 5, priority: 'high' });
    const c = item({ day, title: 'z', allDay: true });
    expect([a, b, c].sort(sortItems).map((i) => i.title)).toEqual(['z', 'a', 'b']);
  });
  it('every item has a full accessible name: title, when, source, and the flags that colour cannot carry', () => {
    const t = timed(9, 'Pediatrician checkup', { recurring: true, layerName: 'Personal' });
    expect(itemAccessibleName(item({ day, title: 'School holiday' }))).toBe('School holiday, All day, Personal calendar');
    expect(itemAccessibleName(t)).toContain('Pediatrician checkup, ');
    expect(itemAccessibleName(t)).toContain('Personal calendar');
    expect(itemAccessibleName(t)).toContain('repeats');
    expect(itemAccessibleName(item({ day, title: 'Due: Power', derived: true, layerName: 'Bills & Subscriptions', overdue: true, priority: 'high' }))).toBe('Due: Power, All day, Bills & Subscriptions calendar (automatic, read-only), High priority, overdue');
    expect(itemAccessibleName(item({ day, title: 'Plan', done: true }))).toContain('done');
    expect(itemAccessibleName(item({ day, title: 'Kitchen', project: { id: 1, label: 'Kitchen refresh' } }))).toContain('project Kitchen refresh');
    const d = drawMonth([item({ day, title: 'School holiday' })]);
    const chip = all(cellOf(d, day), (e) => e.tag === 'button' && (e.attrs.class ?? '').includes('cal-chip'))[0];
    expect(chip.attrs['aria-label']).toBe('School holiday, All day, Personal calendar');
    expect(unnamedButtons(d)).toEqual([]);
  });
  it('a long title is cut by style only: the full words stay in the markup and in the name', () => {
    const long = 'A very long event title that cannot fit in a month cell but must stay readable in full for assistive technology';
    const d = drawMonth([item({ day, title: long })]);
    const chip = all(cellOf(d, day), (e) => e.tag === 'button' && (e.attrs.class ?? '').includes('cal-chip'))[0];
    expect(textOf(chip)).toContain(long);
    expect(chip.attrs['aria-label']).toContain(long);
    expect(read('./calendar.css')).toMatch(/\.cal-chip-title \{[^}]*text-overflow: ellipsis/);
  });
  it('an empty date draws no chips and says "no items"', () => {
    const d = drawMonth([]);
    expect(all(d, (e) => (e.attrs.class ?? '').includes('cal-chip '))).toHaveLength(0);
    expect(dayBtn(cellOf(d, '2026-11-03')).attrs['aria-label']).toBe('Tuesday, November 3, 2026, no items');
    expect(itemCountWords(0)).toBe('no items'); expect(itemCountWords(1)).toBe('1 item'); expect(itemCountWords(2)).toBe('2 items');
  });
  it('colours are the item\'s own: a chip carries its layer colour as data, and no member identity colour is applied', () => {
    const d = drawMonth([item({ day, color: '#123456' })]);
    const chip = all(cellOf(d, day), (e) => e.tag === 'button' && (e.attrs.class ?? '').includes('cal-chip'))[0];
    expect(chip.attrs.style).toContain('#123456');
    for (const f of ['./MonthView.tsx', './SelectedDay.tsx', './AgendaView.tsx', './CalendarPage.tsx', './calendarModel.ts']) {
      const src = read(f);
      expect(src, f).not.toMatch(/MemberMark|MemberDot|MemberChip|--mc-|memberColor/);
    }
    expect(read('./calendar.css')).not.toMatch(/--mc-/);
  });
});

describe('D13 the selected day and the agenda', () => {
  it('the selected-day panel names the weekday and date, says today, lists the items and offers Add event and Add task for that date', () => {
    const items = [item({ day: TODAY, title: 'Soccer practice', allDay: false, startMs: Date.parse(`${TODAY}T17:00:00Z`) })];
    const d = html(createElement(SelectedDay, { date: TODAY, today: TODAY, items, onOpenItem: noop, onAdd: noop, onAddTask: noop }));
    const h = all(d, (e) => e.tag === 'h2')[0];
    expect(textOf(h)).toBe('Thursday, November 12, 2026');
    const t = textOf(d);
    expect(t).toContain('Today'); expect(t).toContain('1 item'); expect(t).toContain('Soccer practice');
    const buttons = byTag(d, 'button').map((b) => textOf(b));
    expect(buttons).toContain('Add event'); expect(buttons).toContain('Add task');
    expect(all(d, (e) => e.tag === 'time')).toHaveLength(1);   // the shared date tile
  });
  it('an empty day says so and still offers to add', () => {
    const d = html(createElement(SelectedDay, { date: '2026-11-14', today: TODAY, items: [], onOpenItem: noop, onAdd: noop, onAddTask: noop }));
    expect(textOf(d)).toContain('Nothing on this day');
    expect(textOf(d)).toContain('no items');
    expect(textOf(d)).not.toContain('Today');
    expect(byTag(d, 'button').map((b) => textOf(b))).toContain('Add event');
  });
  it('tomorrow and yesterday are named, other days are not', () => {
    expect(relativeWord('2026-11-13', TODAY)).toBe('Tomorrow');
    expect(relativeWord('2026-11-11', TODAY)).toBe('Yesterday');
    expect(relativeWord('2026-11-20', TODAY)).toBeNull();
    expect(contextLine(TODAY)).toEqual({ weekday: 'Thursday', rest: 'November 12, 2026' });
    expect(fullDate('2028-02-29')).toBe('Tuesday, February 29, 2028');
  });
  it('the agenda groups by day in order with a date tile each, puts Overdue on top, and keeps the empty message', () => {
    const items = [
      item({ day: '2026-11-14', title: 'Saturday thing' }),
      item({ day: TODAY, title: 'Thursday thing' }),
      item({ day: '2026-11-09', title: 'Old bill', overdue: true, derived: true, priority: 'high' }),
    ];
    const d = html(createElement(AgendaView, { from: TODAY, days: 14, today: TODAY, items, onOpenItem: noop, onCreate: noop }));
    const sections = all(d, (e) => e.tag === 'section');
    expect(sections.map((s) => s.attrs['aria-label'])).toEqual(['Overdue', 'Thursday, Nov 12, 2026', 'Saturday, Nov 14, 2026']);
    expect(all(d, (e) => e.tag === 'time').length).toBeGreaterThanOrEqual(3);   // two day tiles and the overdue date
    expect(textOf(sections[1])).toContain('Today');
    expect(textOf(sections[0])).toContain('Old bill');
    const empty = html(createElement(AgendaView, { from: TODAY, days: 7, today: TODAY, items: [], onOpenItem: noop, onCreate: noop }));
    expect(textOf(empty)).toContain('Nothing on the calendar from');
    expect(textOf(empty)).toContain('Add an event');
  });
});

describe('D13 the page keeps every view, control and address it had', () => {
  const page = read('./CalendarPage.tsx');
  it('the four views, their ids and the default-view rule are the same', () => {
    expect(page).toMatch(/\{ id: 'month', label: 'Month' \}, \{ id: 'week', label: 'Week' \}, \{ id: 'workweek', label: 'Work week' \}, \{ id: 'agenda', label: 'Agenda' \}/);
    expect(page).toContain("narrow() ? 'agenda' : 'month'");
    expect(page).toContain("const VIEW_KEY = 'calendar-last-view'");
    expect(page).toContain("const RANGE_KEY = 'calendar-agenda-range'");
    expect(page).toContain('const RANGES = [7, 14, 30, 90]');
    expect(page).toContain("role=\"tablist\" aria-label=\"View\" onKeyDown={rovingKeys}");
  });
  it('the address parameters still work: v, d, r, new, project and open', () => {
    for (const k of ["sp.get('v')", "sp.get('d')", "sp.get('r')", "sp.get('new')", "sp.get('project')", "sp.get('open')"]) expect(page).toContain(k);
    expect(page).toContain("next.delete('new'); next.delete('project')");
    expect(page).toContain('data.items.find((i) => i.key === openParam)');
    expect(page).toContain('setEditor({ start: { date: anchor, ...(Number.isInteger(pid) && pid > 0 ? { projectId: pid } : {}) } })');
  });
  it('every control it had is still there: previous, next, Today, jump to date, add event, add task, layers, export, manage calendars', () => {
    for (const w of ['aria-label="Previous"', 'aria-label="Next"', '>Today</button>', 'aria-label="Jump to date"', ' Add event</button>', ' Add task</button>', '<LayerMenu', 'Export…', 'onManage={() => setManage(true)}', 'aria-label="Agenda range"']) expect(page, w).toContain(w);
    expect(page).toContain('range.from <= today && range.to >= today && anchor === today');   // the Today button's disabled rule, unchanged
    expect(page).toContain('requestTask({ dueDate: addDate })');
  });
  it('the page uses the shared header, one h1, and the period is a live h2 (not a second page title)', () => {
    expect(page).toContain('<PageHeader');
    expect(page).toContain('title="Calendar"');
    expect(page).toMatch(/<h2 className="cal-period" aria-live="polite">/);
    expect(page).not.toMatch(/<h1/);
  });
  it('the layers the page draws come from the data and the visibility hook only, and a view change cannot touch them', () => {
    expect(page).toContain('const vis = useLayerVisibility(layerIds)');
    expect(page).toContain('items.filter((i) => vis.isVisible(i.layerId))'.replace('items', '(data?.items ?? [])'));
    const go = page.slice(page.indexOf('const go = '), page.indexOf('// The days on screen'));
    expect(go).not.toMatch(/vis\.|Visibility|calendar-hidden-layers/);
  });
  it('creation requests keep their contract: a blank event for a date, a project prefill, the selected day\'s own Add event, and double-click on a cell', () => {
    expect(page).toContain('onAdd={(date) => setEditor({ start: { date } })}');
    expect(page).toContain('onCreate={(date) => setEditor({ start: { date } })}');
    expect(read('./MonthView.tsx')).toContain('onDoubleClick={() => onCreate(d)}');
    expect(read('./MonthView.tsx')).not.toMatch(/onClick=\{\(\) => onCreate/);
    expect(read('./EventEditor.tsx')).toContain('projectId?: number');
  });
  it('week and work-week day headings still open the day dialog; derived items still open their read-only detail', () => {
    expect(page).toContain('onOpenDay={setDayOpen}');
    expect(page).toContain('const openItem = (i: CalItem) => (i.derived ? setDetail(i) : i.occ && setEditor({ occ: i.occ }))');
  });
});

describe('D13 overlays: visibility is only ever a display choice', () => {
  const available = [PERSONAL_ID, FINANCE_ID, TASKS_ID, FAMILY_ID, 77];
  const store = new Map<string, string>();
  const real = (globalThis as { localStorage?: unknown }).localStorage;
  const stub = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
  afterEach(() => { store.clear(); (globalThis as { localStorage?: unknown }).localStorage = real; });
  const withStore = () => { (globalThis as { localStorage?: unknown }).localStorage = stub; };

  it('first load with no preference shows every layer, including one registered later', () => {
    withStore();
    const v = readVisibility();
    expect(v).toEqual(ALL_ON);
    expect([...available, 999].every((id) => isLayerVisible(v, id))).toBe(true);
    expect(visibleCount(v, available)).toBe(5);
  });
  it('select all, deselect all, one layer, Personal only and several layers behave as before', () => {
    expect(visibleCount(deselectAll(), available)).toBe(0);
    expect(visibleCount(selectAll(), available)).toBe(5);
    const personalOnly = available.filter((id) => id !== PERSONAL_ID).reduce((v, id) => toggleLayer(v, id, available), ALL_ON);
    expect(personalOnly).toEqual({ mode: 'only', shown: [PERSONAL_ID] });
    expect(isLayerVisible(personalOnly, 999)).toBe(false);   // a layer registered later stays off after a deliberate choice
    const one = toggleLayer(deselectAll(), FAMILY_ID, available);
    expect(one).toEqual({ mode: 'only', shown: [FAMILY_ID] });
    const several = toggleLayer(toggleLayer(one, TASKS_ID, available), PERSONAL_ID, available);
    expect(visibleCount(several, available)).toBe(3);
    expect(toggleLayer(selectAll(), FINANCE_ID, available)).toEqual({ mode: 'only', shown: available.filter((id) => id !== FINANCE_ID) });
  });
  it('a stored choice survives a reload (the key and both stored formats are unchanged, and nothing else is written)', () => {
    withStore();
    expect(VISIBILITY_KEY).toBe('calendar-hidden-layers');
    const chosen = toggleLayer(deselectAll(), PERSONAL_ID, available);
    store.set(VISIBILITY_KEY, serializeVisibility(chosen));
    expect(readVisibility()).toEqual(chosen);
    expect(store.get(VISIBILITY_KEY)).toBe(JSON.stringify({ only: [PERSONAL_ID] }));
    store.set(VISIBILITY_KEY, JSON.stringify([FINANCE_ID]));   // an older build's list of hidden layers
    expect(readVisibility()).toEqual({ mode: 'all-but', hidden: [FINANCE_ID] });
    expect(isLayerVisible(readVisibility(), FINANCE_ID)).toBe(false);
    expect(parseVisibility('not json')).toEqual(ALL_ON);
    expect([...store.keys()]).toEqual([VISIBILITY_KEY]);
  });
  it('a layer that disappears from the data is ignored; the owner\'s other choices are kept', () => {
    const v = parseVisibility(JSON.stringify({ only: [PERSONAL_ID, 12345] }));
    expect(visibleCount(v, available)).toBe(1);
    expect(isLayerVisible(v, PERSONAL_ID)).toBe(true);
  });
  it('hiding a layer hides items on screen only: the filtered list is the whole story and no record is changed', () => {
    const a = item({ day: TODAY, layerId: PERSONAL_ID, title: 'Mine' });
    const b = item({ day: TODAY, layerId: FINANCE_ID, title: 'Bill', derived: true });
    const personalOnly: Visibility = { mode: 'only', shown: [PERSONAL_ID] };
    const shown = [a, b].filter((i) => isLayerVisible(personalOnly, i.layerId));
    expect(shown.map((i) => i.title)).toEqual(['Mine']);
    expect([a, b]).toHaveLength(2);
  });
  it('the layer button keeps its words and gains only a decorative color stack that no screen reader reads', () => {
    const src = read('./LayerMenu.tsx');
    expect(src).toContain('<i className="cal-lm-stack" aria-hidden="true">');
    expect(src).toContain('triggerLabel(shown, total)');
    expect(src).toContain('aria-haspopup="dialog"');
    expect(src).toContain('Select all'); expect(src).toContain('Deselect all');
    expect(src).toContain("document.addEventListener('keydown', key)");
    expect(read('./calendar.css')).toMatch(/\.cal-lm-stack \{/);
  });
});

describe('D13 the event editor keeps its fields and gains only grouping', () => {
  const src = read('./EventEditor.tsx');
  it('every field it had is still there', () => {
    for (const w of ['Title', 'Type', 'All day', "{allDay ? 'First day' : 'Starts'}", "{allDay ? 'Last day' : 'Ends'}", 'Calendar', 'Priority', 'Project', '<RepeatFields', 'Location', 'Notes', 'Reminders', 'Keep it as overdue until I mark it done', 'Tags', 'People', 'Linked records', 'Start from', 'Mark done', 'Delete']) expect(src, w).toContain(w);
    expect(src).toContain('aria-label="Start time"'); expect(src).toContain('aria-label="End time"');
  });
  it('Save is the form\'s submit, Cancel closes without saving, Escape and the backdrop go through the shared Modal', () => {
    expect(src).toContain('<button type="submit" className="btn primary" disabled={busy}>Save</button>');
    expect(src).toContain('<button type="button" className="btn" onClick={onClose}>Cancel</button>');
    expect(src).toContain('onSubmit={(e) => { e.preventDefault(); save(); }}');
    expect(src).toContain('wide variant="sheet"');
    expect(src).toContain('autoFocus');
  });
  it('the sections are named and labelled, and the sticky action bar is styled', () => {
    for (const id of ['ev-s-what', 'ev-s-when', 'ev-s-where', 'ev-s-details', 'ev-s-people']) expect(src).toContain(`aria-labelledby="${id}"`);
    expect((src.match(/<h3 className="cal-sec-title"/g) ?? []).length).toBe(5);
    expect(read('./calendar.css')).toMatch(/\.cal-form \.cal-actions \{[^}]*position: sticky/);
  });
  it('persistence and validation were not touched: the same save, create and delete calls and the same error path', () => {
    for (const w of ['saveEdit(occ, fields, extras(), scope)', 'createEvent(newEventData(fields, extras()))', 'setError(e instanceof Error ? e.message', 'if (occ?.recurring) setAsk({ kind: \'save\', fields: f })', 'retireEvent(', 'removeOccurrence(occ, scope)']) expect(src, w).toContain(w);
  });
  it('a derived item (a bill, a task, a family date) still opens a read-only detail, never the event editor', () => {
    const dlg = read('./dialogs.tsx');
    expect(dlg).toContain('Read-only'.slice(0, 0) + 'To change this, change it where it comes from.');
    expect(dlg).toContain('src.openSource()');
    expect(read('./CalendarPage.tsx')).toContain('i.derived ? setDetail(i)');
  });
});

describe('D13 style rules that carry accessibility', () => {
  const css = read('./calendar.css');
  it('today and the selected day have different, non-colour marks', () => {
    expect(css).toMatch(/\.cal-cell\.selected \{[^}]*box-shadow: inset 0 0 0 2px var\(--accent\)/);
    expect(css).toMatch(/\.cal-cell\.today \.cal-daynum \{[^}]*background: var\(--accent\)/);
    expect(css).toMatch(/\.cal-today-tag \{/);
  });
  it('keyboard focus is visible on the grid, chips and rows', () => {
    expect(css).toMatch(/\.cal-chip:focus-visible[^{]*\.cal-daynum:focus-visible[^{]*\{[^}]*outline: 2px solid var\(--accent\)/);
  });
  it('touch targets, reduced motion and print are handled', () => {
    expect(css).toMatch(/@media \(pointer: coarse\)[\s\S]*\.cal-more \{ min-height: 32px/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    expect(css).toMatch(/@media print \{[^}]*\.cal-bar/);
  });
  it('no new hard-coded colours and no text below 11px', () => {
    const body = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/var\(--[\w-]+, #[0-9a-f]{3,8}\)/gi, '');
    const hex = body.match(/#[0-9a-f]{3,8}\b/gi) ?? [];
    expect(hex).toEqual(['#fff']);   // the long-standing white check mark in .cal-swatch
    expect([...body.matchAll(/font-size:\s*(\d+)px/g)].map((m) => m[0])).toEqual(['font-size: 11px']);   // only the long-standing swatch check mark
    expect(/font-size:\s*(9|10)px/.test(body)).toBe(false);
  });
});

describe('D13 recurring Household Services: twelve months of projected visits, one Task, no duplicates, no writes', () => {
  let n = 0;
  const fresh = () => { const d = new FinanceDB(`test-d13-${n++}`); installTracking(d); return d; };
  const START = '2026-11-06';   // a Friday
  const biweekly: Cadence = { mode: 'fixed', rule: { freq: 'weekly', interval: 2, end: { type: 'never' } }, anchorDate: START };
  const semi = (anchor: string, a: object, b: object): Cadence => ({ mode: 'fixed', anchorDate: anchor, rule: { freq: 'monthly', interval: 1, monthly: 'date', end: { type: 'never' } }, semi: { a, b } as never });
  const add = async (d: FinanceDB, cadence: Cadence, today: string) =>
    createArrangement({ data: blankArrangement({ title: 'House cleaning', cadence }), provider: await providerNamed(d, "Rosa's Cleaning"), today }, d);
  const visitItems = async (d: FinanceDB, today: string) => (await servicesDueItems(d, { from: today, to: addDays(today, 800), today, overdueDays: 0 })).filter((i) => i.id.startsWith('services:visit-'));
  const rowCounts = async (d: FinanceDB) => JSON.stringify([await d.moduleRecords.count(), await d.links.count(), await d.txns.count(), (await d.moduleRecords.toArray()).map((r) => r.updatedAt).join()]);
  /** What the Calendar's hook makes of one derived item (all-day, its own date): enough for the grid. */
  const asCal = (it: { id: string; title: string; date: string; endDate?: string }): CalItem => item({ day: it.date, lastDay: it.endDate ?? it.date, key: `d:${it.id}`, title: it.title, derived: true, layerId: 9000000000000106, layerName: 'Household Services' });
  /** Lay every month of the horizon out as the month view does and count how often each item lands in a cell of ITS OWN month. */
  const sweep = (items: CalItem[], firstMonth: string, months: number) => {
    const seen = new Map<string, string[]>();
    for (let m = 0; m < months; m++) {
      const [y, mo] = firstMonth.split('-').map(Number);
      const idx = y * 12 + (mo - 1) + m;
      const month = `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
      for (const date of gridWeeks(monthGridStart(month, 0)).flat()) {
        const c = cellModel(date, { month, today: START, selected: START, items });
        if (c.isOut) continue;
        for (const i of items.filter((x) => x.firstDay <= date && x.lastDay >= date)) seen.set(i.key, [...(seen.get(i.key) ?? []), date]);
      }
    }
    return seen;
  };

  it('every other Friday: 26 projected visits plus the one open Task; each lands once, on its own date, in the right month', async () => {
    const d = fresh();
    const r = await add(d, biweekly, START);
    const raw = await visitItems(d, START);
    expect(raw).toHaveLength(26);
    expect(new Set(raw.map((i) => i.id)).size).toBe(26);
    const items = raw.map(asCal);
    const seen = sweep(items, '2026-11', 13);
    expect(seen.size).toBe(26);
    for (const i of items) expect(seen.get(i.key), i.key).toEqual([i.firstDay]);   // exactly one cell, the item's own date
    const open = (await tasksOfArrangement(r.id, d)).filter((t) => t.data.status !== 'done');
    expect(open).toHaveLength(1);                       // only the next actionable Task exists
    expect(open[0].data.dueDate).toBe(START);
    expect(new Set(raw.map((i) => new Date(`${i.date}T00:00:00Z`).getUTCDay()))).toEqual(new Set([5]));   // all Fridays
  });
  it('the 1st and 15th, across February, a leap year and the year end: nothing shifts, nothing doubles', async () => {
    const d = fresh();
    const today = '2027-12-20';
    const r = await add(d, semi('2027-12-01', { kind: 'day', day: 1, adjust: 'none' }, { kind: 'day', day: 15, adjust: 'none' }), today);
    const raw = await visitItems(d, today);
    const dates = raw.map((i) => i.date);
    expect((await tasksOfArrangement(r.id, d)).filter((t) => t.data.status !== 'done').map((t) => t.data.dueDate)).toEqual(['2028-01-01']);   // the one actionable Task holds the first date
    expect(dates).not.toContain('2028-01-01');
    for (const x of ['2028-01-15', '2028-02-01', '2028-02-15', '2028-03-01', '2028-12-01']) expect(dates).toContain(x);
    expect(new Set(dates).size).toBe(dates.length);
    const seen = sweep(raw.map(asCal), '2027-12', 13);
    for (const i of raw.map(asCal)) expect(seen.get(i.key)).toEqual([i.firstDay]);
  });
  it('the 15th and the last business day: February, leap February and month ends keep the dates the schedule gives (Calendar only draws them)', async () => {
    const d = fresh();
    const today = '2028-01-15';
    await add(d, semi('2028-01-15', { kind: 'day', day: 15, adjust: 'none' }, { kind: 'lastBusinessDay' }), today);
    const raw = await visitItems(d, today);
    const dates = raw.map((i) => i.date);
    expect(dates).toContain('2028-02-29');   // Tuesday: the last business day of leap February
    expect(dates).toContain('2028-02-15');
    expect(dates).toContain('2028-04-28');   // 30 April 2028 is a Sunday, so the last business day is Friday the 28th
    expect(dates).not.toContain('2028-04-30');
    const seen = sweep(raw.map(asCal), '2028-01', 13);
    for (const i of raw.map(asCal)) expect(seen.get(i.key)).toEqual([i.firstDay]);
  });
  it('drawing the Calendar writes nothing: no Task, event, visit, link or Finance row, and no stored timestamp moves', async () => {
    const d = fresh();
    await add(d, biweekly, START);
    const before = await rowCounts(d);
    for (let i = 0; i < 3; i++) {
      const items = (await visitItems(d, START)).map(asCal);
      for (const date of gridWeeks(monthGridStart('2026-11', 0)).flat()) cellModel(date, { month: '2026-11', today: START, selected: START, items });
      renderToStaticMarkup(createElement(MonthView, { month: '2026-11', selected: START, weekStart: 0, today: START, items, onSelect: noop, onCreate: noop, onOpenItem: noop }));
    }
    expect(await rowCounts(d)).toBe(before);
  });
  it('the projection comes from the existing services provider, not from the Calendar (no scheduling code in the redesigned files)', () => {
    for (const f of ['./calendarModel.ts', './MonthView.tsx', './SelectedDay.tsx', './CalendarPage.tsx']) {
      const src = read(f);
      expect(src, f).not.toMatch(/generateDates|cadenceBetween|plannedVisit|createTask|saveTask|\.add\(|\.put\(|\.bulkAdd\(/);
    }
  });
});

describe('D13 coverage with the other shared pieces', () => {
  it('the Calendar uses the shared header, segmented control, date tile, chip and card pieces and adds no parallel framework', () => {
    expect(read('./CalendarPage.tsx')).toContain("from '../../ui/components'");
    expect(read('./CalendarPage.tsx')).toContain('className="ui-seg cal-views"');
    expect(read('./SelectedDay.tsx')).toContain("from '../../ui/DateTile'");
    expect(read('./AgendaView.tsx')).toContain('DateTile');
    expect(read('./AgendaView.tsx')).toContain('DateInline');
    expect(read('./SelectedDay.tsx')).toContain('ui-chip ui-chip--active');
    const pkg = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'));
    expect(Object.keys(pkg.dependencies).sort()).toEqual(['dexie', 'dexie-react-hooks', 'papaparse', 'react', 'react-dom', 'react-router-dom']);
  });
  it('dayButtonName gives the full date, today and the count', () => {
    expect(dayButtonName('2026-11-12', TODAY, 3)).toBe('Thursday, November 12, 2026, today, 3 items');
    expect(dayButtonName('2026-11-13', TODAY, 1)).toBe('Friday, November 13, 2026, 1 item');
  });
});

describe('D13 final correction: toasts cannot cover a dialog\'s Save and Cancel (D13-F1) and a new event starts in Title (D13-F2)', () => {
  const styles = readFileSync(new URL('../../styles.css', import.meta.url), 'utf8');
  const z = (re: RegExp) => Number(re.exec(styles)?.[1]);
  it('the failure mechanism: notifications normally sit ABOVE a dialog (z-index 120 over 100), so a stacked toast can cover the bottom bar of a tall dialog', () => {
    expect(z(/\.toasts \{[^}]*z-index: (\d+)/)).toBe(120);
    expect(z(/\.modal-back \{[^}]*z-index: (\d+)/)).toBe(100);
  });
  it('the correction: while any dialog backdrop exists the notifications drop below it, and only then (the base values are unchanged)', () => {
    const m = /body:has\(\.modal-back\) \.toasts \{ z-index: (\d+); \}/.exec(styles);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeLessThan(z(/\.modal-back \{[^}]*z-index: (\d+)/));
    // still above the page itself (module bar 50, round Add button 40), so with no dialog open they are in front as before
    expect(Number(m![1])).toBeGreaterThan(50);
    expect(styles).not.toMatch(/\.toasts \{[^}]*pointer-events: none/);   // toast buttons (Undo, Dismiss) stay clickable
  });
  it('the editor focuses Title for a new event only, not on a touch screen, and leaves the shared Modal alone', () => {
    const src = read('./EventEditor.tsx');
    expect(src).toContain('ref={titleRef}');
    expect(src).toContain("if (occ || (typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches)) return;");
    expect(src).toContain('titleRef.current?.focus()');
  });
});
