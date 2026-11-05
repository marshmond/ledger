import { describe, expect, it } from 'vitest';
import { FinanceDB } from '../../db';
import { cashOutlook } from '../../lib/cashOutlook';
import type { CalItem } from '../calendar/useCalendarData';
import { dayHeading, maskAmounts, moduleOf, overdueGroups, reminderItems, todayList, upcomingDays } from './logic';
import { defaultLayout, HIDE_AMOUNTS_KEY, LAYOUT_KEY, loadHideAmounts, loadLayout, moveEntry, resolveLayout, saveHideAmounts, saveLayout, toggleEntryHidden, toggleEntrySize } from './layout';
import { alertKey, DEFAULT_TODAY_SETTINGS, isAlertHidden, loadAlertMemory, loadTodaySettings, normalizeAlertMemory, normalizeTodaySettings, rememberAlert, restoreAlert, saveTodaySettings } from './settings';

const TODAY = '2026-11-05';
let n = 0;
const item = (o: Partial<CalItem> & { module?: string }): CalItem => {
  const { module, ...rest } = o;
  return {
    key: `k${n++}`, title: 't', layerId: 1, layerName: 'L', color: '#000', derived: module !== undefined && module !== 'calendar', allDay: true, firstDay: TODAY, lastDay: TODAY,
    startMs: Date.parse(`${rest.firstDay ?? TODAY}T00:00:00`), endMs: 0, priority: 'medium', location: '', done: false, overdue: false, soon: false, recurring: false,
    source: module && module !== 'calendar' ? ({ sourceModule: module } as CalItem['source']) : undefined, ...rest,
  };
};

describe('Today list', () => {
  it('has today and multi-day items in progress, all-day first then by time, and no overdue leftovers', () => {
    const timed = item({ title: 'Dentist', allDay: false, startMs: 2000 });
    const allday = item({ title: 'Trash day' });
    const span = item({ title: 'Trip', firstDay: '2026-11-03', lastDay: '2026-11-07' });
    const late = item({ title: 'Old', firstDay: '2026-11-01', lastDay: '2026-11-01', overdue: true });
    const tomorrow = item({ title: 'Later', firstDay: '2026-11-06', lastDay: '2026-11-06' });
    const out = todayList([timed, tomorrow, late, allday, span], TODAY).map((i) => i.title);
    expect(out.slice(-1)).toEqual(['Dentist']);
    expect(out).toContain('Trip');
    expect(out).toContain('Trash day');
    expect(out).not.toContain('Old');
    expect(out).not.toContain('Later');
  });
});

describe('Overdue card', () => {
  it('keeps only open items inside the window, grouped by module, oldest first', () => {
    const items = [
      item({ title: 'Rent', module: 'ledger', firstDay: '2026-10-20', lastDay: '2026-10-20', overdue: true }),
      item({ title: 'Call', module: 'tasks', firstDay: '2026-10-10', lastDay: '2026-10-10', overdue: true }),
      item({ title: 'Too old', module: 'tasks', firstDay: '2026-09-01', lastDay: '2026-09-01', overdue: true }),
      item({ title: 'Done', module: 'tasks', firstDay: '2026-10-11', lastDay: '2026-10-11', overdue: true, done: true }),
      item({ title: 'Today', module: 'tasks' }),
      item({ title: 'Meeting', firstDay: '2026-10-30', lastDay: '2026-10-30', overdue: true }),
    ];
    const g = overdueGroups(items, TODAY, 30);
    expect(g.map((x) => x.moduleId)).toEqual(['tasks', 'ledger', 'calendar']);
    expect(g[0].items.map((i) => i.title)).toEqual(['Call']);
    expect(g.flatMap((x) => x.items).map((i) => i.title)).not.toContain('Too old');
  });
  it('the window is the overdue-days setting: exactly that many days back is still shown', () => {
    const edge = item({ title: 'Edge', module: 'tasks', firstDay: '2026-10-06', lastDay: '2026-10-06', overdue: true });
    expect(overdueGroups([edge], TODAY, 30)).toHaveLength(1);
    expect(overdueGroups([edge], TODAY, 29)).toHaveLength(0);
    expect(overdueGroups([edge], TODAY, 0)).toHaveLength(0);
  });
  it('names the module an item belongs to', () => {
    expect(moduleOf(item({ module: 'ledger' }))).toBe('ledger');
    expect(moduleOf(item({}))).toBe('calendar');
  });
});

describe('Coming up card', () => {
  it('groups by start day, after today, up to the look-ahead, skipping done items', () => {
    const items = [
      item({ title: 'A', firstDay: '2026-11-06', lastDay: '2026-11-06' }),
      item({ title: 'B', firstDay: '2026-11-06', lastDay: '2026-11-06', allDay: false, startMs: 5 }),
      item({ title: 'C', firstDay: '2026-11-12', lastDay: '2026-11-12' }),
      item({ title: 'Too far', firstDay: '2026-11-13', lastDay: '2026-11-13' }),
      item({ title: 'Done', firstDay: '2026-11-07', lastDay: '2026-11-07', done: true }),
      item({ title: 'Today', firstDay: TODAY, lastDay: TODAY }),
    ];
    const days = upcomingDays(items, TODAY, 7);
    expect(days.map((d) => d.date)).toEqual(['2026-11-06', '2026-11-12']);
    expect(days[0].items.map((i) => i.title)).toEqual(['A', 'B']);
  });
  it('a longer look-ahead brings in more', () => {
    const far = item({ firstDay: '2026-11-13', lastDay: '2026-11-13' });
    expect(upcomingDays([far], TODAY, 7)).toHaveLength(0);
    expect(upcomingDays([far], TODAY, 14)).toHaveLength(1);
  });
  it('says Tomorrow for the next day', () => {
    expect(dayHeading('2026-11-06', TODAY, () => 'x')).toBe('Tomorrow');
    expect(dayHeading('2026-11-08', TODAY, () => 'Sun, Nov 8')).toBe('Sun, Nov 8');
  });
});

describe('Reminders due', () => {
  it('lists items whose reminder time has passed and are not done', () => {
    const a = item({ title: 'Soon', soon: true });
    const b = item({ title: 'Quiet' });
    const c = item({ title: 'Done soon', soon: true, done: true });
    expect(reminderItems([a, b, c]).map((i) => i.title)).toEqual(['Soon']);
  });
});

describe('Hide amounts', () => {
  it('masks dollar amounts in text and leaves the rest', () => {
    expect(maskAmounts('Rent $1,200.00')).toBe('Rent $••••');
    expect(maskAmounts('Cash may drop to -$80.50 on 2026-11-20')).toBe('Cash may drop to $•••• on 2026-11-20');
    expect(maskAmounts('Checking is $1,650.00, under your $2,000.00 minimum')).toBe('Checking is $••••, under your $•••• minimum');
    expect(maskAmounts('No money here, 3 items')).toBe('No money here, 3 items');
  });
  it('is remembered per device', () => {
    const m = new Map<string, string>();
    const store = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    expect(loadHideAmounts(store)).toBe(false);
    saveHideAmounts(true, store);
    expect(m.get(HIDE_AMOUNTS_KEY)).toBe('1');
    expect(loadHideAmounts(store)).toBe(true);
    saveHideAmounts(false, store);
    expect(loadHideAmounts(store)).toBe(false);
  });
});

describe('card layout (per device)', () => {
  const cards = [
    { id: 'a.one', defaultWidth: 'half' as const, priority: 20 },
    { id: 'b.two', defaultWidth: 'full' as const, priority: 10 },
    { id: 'c.three', defaultWidth: 'half' as const, priority: 30 },
  ];
  it('defaults to priority order at default widths', () => {
    expect(defaultLayout(cards)).toEqual([
      { id: 'b.two', size: 'full', hidden: false }, { id: 'a.one', size: 'half', hidden: false }, { id: 'c.three', size: 'half', hidden: false },
    ]);
  });
  it('keeps saved order and choices, drops unknown cards, appends new ones', () => {
    const saved = [{ id: 'c.three', size: 'full', hidden: true }, { id: 'gone', size: 'half' }, { id: 'a.one', size: 'bogus' }, { id: 'a.one', size: 'full' }];
    const out = resolveLayout(saved, cards);
    expect(out.map((c) => c.id)).toEqual(['c.three', 'a.one', 'b.two']);
    expect(out[0]).toEqual({ id: 'c.three', size: 'full', hidden: true });
    expect(out[1].size).toBe('half'); // an invalid size falls back to the card's default
  });
  it('junk falls back to the default', () => {
    expect(resolveLayout('nope', cards)).toEqual(defaultLayout(cards));
    expect(resolveLayout(null, cards)).toEqual(defaultLayout(cards));
  });
  it('moves, resizes and hides', () => {
    const l = defaultLayout(cards);
    expect(moveEntry(l, 'a.one', -1).map((c) => c.id)).toEqual(['a.one', 'b.two', 'c.three']);
    expect(moveEntry(l, 'b.two', -1)).toBe(l);
    expect(toggleEntrySize(l, 'a.one')[1].size).toBe('full');
    expect(toggleEntryHidden(l, 'a.one')[1].hidden).toBe(true);
  });
  it('saves and loads through browser storage, falling back when it is broken', () => {
    const m = new Map<string, string>();
    const store = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    saveLayout(toggleEntryHidden(defaultLayout(cards), 'c.three'), store);
    expect(m.has(LAYOUT_KEY)).toBe(true);
    expect(loadLayout(cards, store).find((c) => c.id === 'c.three')?.hidden).toBe(true);
    m.set(LAYOUT_KEY, '{not json');
    expect(loadLayout(cards, store)).toEqual(defaultLayout(cards));
  });
});

describe('Today settings (shared)', () => {
  it('defaults and cleans junk', () => {
    expect(normalizeTodaySettings(undefined)).toEqual(DEFAULT_TODAY_SETTINGS);
    expect(normalizeTodaySettings({ lookAheadDays: 0 }).lookAheadDays).toBe(7);
    expect(normalizeTodaySettings({ lookAheadDays: 14 }).lookAheadDays).toBe(14);
    expect(normalizeTodaySettings({ lookAheadDays: 2.5 }).lookAheadDays).toBe(7);
  });
  it('saves and loads from the settings table', async () => {
    const d = new FinanceDB('test-today-settings');
    expect((await loadTodaySettings(d)).lookAheadDays).toBe(7);
    await saveTodaySettings({ lookAheadDays: 14 }, d);
    expect((await loadTodaySettings(d)).lookAheadDays).toBe(14);
  });
});

describe('dismissed and snoozed alerts (shared)', () => {
  it('a key is the alert id plus its period, so a new period is a new alert', () => {
    expect(alertKey({ id: 'backup', period: '2026-11' })).toBe('backup|2026-11');
    expect(alertKey({ id: 'backup', period: '2026-12' })).not.toBe(alertKey({ id: 'backup', period: '2026-11' }));
  });
  it('dismissed stays hidden, snoozed hides until its day, active shows', () => {
    expect(isAlertHidden(undefined, TODAY)).toBe(false);
    expect(isAlertHidden({ state: 'dismissed', at: 1 }, TODAY)).toBe(true);
    expect(isAlertHidden({ state: 'snoozed', until: '2026-11-06', at: 1 }, TODAY)).toBe(true);
    expect(isAlertHidden({ state: 'snoozed', until: '2026-11-06', at: 1 }, '2026-11-06')).toBe(false);
    expect(isAlertHidden({ state: 'snoozed', at: 1 }, TODAY)).toBe(false);
    expect(isAlertHidden({ state: 'active', at: 1 }, TODAY)).toBe(false);
  });
  it('ignores bad stored values', () => {
    expect(normalizeAlertMemory(null)).toBeNull();
    expect(normalizeAlertMemory({ state: 'weird' })).toBeNull();
    expect(normalizeAlertMemory({ state: 'snoozed', until: 'tomorrow', at: 5 })).toEqual({ state: 'snoozed', until: undefined, at: 5 });
  });
  it('stores each alert in its own settings row and can restore it', async () => {
    const d = new FinanceDB('test-today-alerts');
    await rememberAlert('backup|2026-11', { state: 'dismissed' }, d);
    await rememberAlert('forecast|2026-11-20', { state: 'snoozed', until: '2026-11-12' }, d);
    const mem = await loadAlertMemory(d);
    expect(Object.keys(mem).sort()).toEqual(['backup|2026-11', 'forecast|2026-11-20']);
    expect(isAlertHidden(mem['backup|2026-11'], TODAY)).toBe(true);
    expect(isAlertHidden(mem['forecast|2026-11-20'], TODAY)).toBe(true);
    // a different period of the same alert is a different key: it is not hidden
    expect(mem['backup|2026-12']).toBeUndefined();
    await restoreAlert('backup|2026-11', d);
    expect(isAlertHidden((await loadAlertMemory(d))['backup|2026-11'], TODAY)).toBe(false);
    // other settings rows are not mistaken for alerts
    await d.settings.put({ key: 'todaySettings', value: { lookAheadDays: 7 } });
    expect(Object.keys(await loadAlertMemory(d))).toHaveLength(2);
  });
});

describe('Cash outlook', () => {
  const ev = (date: string, cents: number, balanceCents: number) => ({ date, label: 'x', cents, kind: 'bill' as const, balanceCents });
  const f = (over: Partial<Parameters<typeof cashOutlook>[0]> = {}) => ({
    cashAccounts: 1, thresholdCents: 200000, floorCents: 200000, input: { startCents: 500000 },
    result: { events: [ev('2026-11-10', -100000, 400000), ev('2026-11-20', -250000, 150000), ev('2026-12-01', 300000, 450000), ev('2027-04-01', -400000, 50000)] },
    ...over,
  });
  it('finds the lowest point in the next 90 days and says whether it is under the level', () => {
    const o = cashOutlook(f(), '2026-11-05', 90)!;
    expect(o).toMatchObject({ lowCents: 150000, lowDate: '2026-11-20', below: true, thresholdCents: 200000, usesMinimums: true });
  });
  it('ignores dips beyond the horizon', () => {
    const o = cashOutlook(f(), '2026-11-05', 90)!;
    expect(o.lowDate).not.toBe('2027-04-01');
  });
  it('is above the level when it stays high; the start balance counts as the low if nothing goes lower', () => {
    const o = cashOutlook(f({ result: { events: [ev('2026-11-10', 100000, 600000)] } }), '2026-11-05', 90)!;
    expect(o).toMatchObject({ lowCents: 500000, lowDate: '2026-11-05', below: false });
  });
  it('shows nothing without a cash account or without anything to forecast from', () => {
    expect(cashOutlook(f({ cashAccounts: 0 }), '2026-11-05')).toBeNull();
    expect(cashOutlook(f({ result: { events: [] } }), '2026-11-05')).toBeNull();
  });
  it('reports the single level when no minimums are set', () => {
    expect(cashOutlook(f({ floorCents: 0, thresholdCents: 100000 }), '2026-11-05')).toMatchObject({ usesMinimums: false, thresholdCents: 100000 });
  });
});
