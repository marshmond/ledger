import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { CalItem } from '../calendar/useCalendarData';
import { ToastProvider } from '../../ui/Toast';
import { UpcomingAgenda } from './cards';
import {
  PHONE_PROMOTED, STATUS_UNIT, composeToday, copyArrangement, defaultArrangement, deriveFromLegacy, hideCard, moveUnit, sanitizeArrangement, sideUnits,
} from './composition';
import { defaultLayout, moveEntry, type CardInfo } from './layout';
import { upcomingDays } from './logic';
import { PREVIEW_DAYS, hiddenRangeText, moreText, previewDays, showAllLabel } from './todayModel';

/**
 * D13.1 final mobile correction. A phone shows the first three populated days of Coming up (each whole) and one button reveals the rest; a computer always shows
 * every day. Cash outlook is drawn once, after Overdue, on a phone only. These guards check that the preview is DISPLAY ONLY: same days, same order, same rows,
 * same actions, same masking, no new data or calculation. Every title, date and amount is invented.
 */

const TODAY = '2026-11-12'; // a Thursday
let n = 0;
const item = (iso: string, title: string, extra: Partial<CalItem> & { module?: string; complete?: boolean } = {}): CalItem => {
  const { module, complete, ...rest } = extra;
  const derived = module !== undefined && module !== 'calendar';
  return {
    key: `k${n++}`, title, layerId: 1, layerName: 'Personal', color: '#4a7bd0', derived, allDay: true, firstDay: iso, lastDay: iso, startMs: Date.parse(`${iso}T00:00:00`), endMs: 0,
    priority: 'medium', location: '', done: false, overdue: false, soon: false, recurring: false,
    source: derived ? ({ sourceModule: module, sourceLabel: 'Open bill', openSource: () => undefined, actions: complete ? { complete: async () => undefined, reopen: async () => undefined } : undefined } as unknown as CalItem['source']) : undefined,
    ...rest,
  };
};

/** Five populated days (Nov 13 busy with nine rows, then 14, 15, 17, 19) and one item past the 7 day look-ahead. */
const items = (): CalItem[] => [
  ...Array.from({ length: 9 }, (_, k) => item('2026-11-13', `Busy day item ${k + 1}`, { module: 'tasks', complete: true })),
  item('2026-11-14', 'Saturday plan'),
  item('2026-11-15', 'Due: Demo Streaming', { module: 'bills' }),
  item('2026-11-15', 'Pay $1,200.00 to Demo Co', { module: 'tasks', complete: true }),
  item('2026-11-17', 'Tuesday errand', { module: 'tasks', complete: true }),
  item('2026-11-19', 'Order school supplies', { module: 'tasks', complete: true }),
  item('2026-11-25', 'Beyond the look-ahead'),
];
const days = (list = items()) => upcomingDays(list, TODAY, 7);

const draw = (d: ReturnType<typeof days>, o: { phone: boolean; expanded?: boolean; hide?: boolean }) =>
  renderToStaticMarkup(<ToastProvider><UpcomingAgenda days={d} today={TODAY} hideAmounts={!!o.hide} phone={o.phone} expanded={!!o.expanded} onToggle={() => undefined} /></ToastProvider>);
const dayDates = (html: string) => [...html.matchAll(/data-day="([\d-]+)"/g)].map((m) => m[1]);

describe('D13.1 mobile preview: the model', () => {
  it('takes the first three populated days, whole, and counts every row', () => {
    const d = days();
    const p = previewDays(d);
    expect(PREVIEW_DAYS).toBe(3);
    expect(p.shown.map((x) => x.date)).toEqual(['2026-11-13', '2026-11-14', '2026-11-15']);
    expect(p.hidden.map((x) => x.date)).toEqual(['2026-11-17', '2026-11-19']);
    expect(p.shown[0].items).toHaveLength(9); // a busy day is never cut in the middle
    expect(p.totalItems).toBe(9 + 1 + 2 + 1 + 1);
    expect(p.hiddenItems).toBe(2);
    expect(p.shown).toBe(p.shown); // slices of the SAME day objects: nothing was rebuilt
    expect(p.shown[1]).toBe(d[1]);
    expect(p.totalItems).toBe(d.reduce((s, x) => s + x.items.length, 0));
  });

  it('fewer than three days, exactly three, and none', () => {
    const two = days(items().filter((i) => i.firstDay <= '2026-11-14'));
    expect(previewDays(two)).toMatchObject({ hidden: [], hiddenItems: 0 });
    expect(previewDays(two).shown).toHaveLength(2);
    const three = days(items().filter((i) => i.firstDay <= '2026-11-15'));
    expect(previewDays(three).hidden).toEqual([]);
    expect(previewDays([])).toEqual({ shown: [], hidden: [], totalItems: 0, hiddenItems: 0 });
  });

  it('the label uses the real count (never a fixed one) and the second line names the hidden days', () => {
    expect(showAllLabel(17)).toBe('Show all 17 items');
    expect(showAllLabel(1)).toBe('Show all 1 item');
    const p = previewDays(days());
    expect(showAllLabel(p.totalItems)).toBe('Show all 14 items');
    expect(moreText(p)).toBe('Also Tue 17 to Thu 19 · 2 more');
    expect(hiddenRangeText(previewDays(days(items().filter((i) => i.firstDay <= '2026-11-17'))).hidden)).toBe('Tue 17');
    expect(moreText(previewDays([]))).toBe('');
  });

  it('a hidden range that crosses a month or a year names the month', () => {
    const d = (iso: string) => ({ date: iso, items: [item(iso, 'x')] });
    expect(hiddenRangeText([d('2026-11-28'), d('2026-12-01')])).toBe('Sat Nov 28 to Tue Dec 1');
    expect(hiddenRangeText([d('2026-12-30'), d('2027-01-02')])).toBe('Wed Dec 30 to Sat Jan 2');
    expect(hiddenRangeText([d('2028-02-28'), d('2028-02-29'), d('2028-03-01')])).toBe('Mon Feb 28 to Wed Mar 1');
  });
});

describe('D13.1 mobile preview: what the page draws', () => {
  it('collapsed on a phone: three whole days, the busy day complete, a labeled button in the collapsed state', () => {
    const html = draw(days(), { phone: true });
    expect(dayDates(html)).toEqual(['2026-11-13', '2026-11-14', '2026-11-15']);
    expect((html.match(/aria-label="Mark done: Busy day item/g) ?? []).length).toBe(9);
    expect(html).toContain('Show all 14 items');
    expect(html).toContain('Also Tue 17 to Thu 19 · 2 more');
    expect(html).toMatch(/<button type="button" class="td-more" aria-expanded="false" aria-controls="[^"]+"/);
    expect(html).not.toContain('Order school supplies');
    expect(html).not.toContain('Tuesday errand');
  });

  it('the button is an ordinary button that controls the list, and says so with aria-expanded', () => {
    const html = draw(days(), { phone: true });
    const controls = html.match(/aria-controls="([^"]+)"/)![1];
    expect(html).toContain(`<div id="${controls}">`);
    expect((html.match(/<button type="button" class="td-more"/g) ?? []).length).toBe(1);
    expect(html).not.toMatch(/class="td-more"[^>]*tabindex/);
    expect(html).not.toMatch(/class="td-more"[^>]*role=/);
  });

  it('expanded: every day and every row in the original order, a Show fewer button, a status line, and focus lands on the first revealed day', () => {
    const d = days();
    const html = draw(d, { phone: true, expanded: true });
    expect(dayDates(html)).toEqual(d.map((x) => x.date));
    expect(html).toMatch(/class="td-more" aria-expanded="true"/);
    expect(html).toContain('Show fewer');
    expect(html).toContain('Back to the first 3 days');
    expect(html).toContain('role="status">Showing all 14 items<');
    expect(html).toMatch(/data-day="2026-11-17" data-revealed="first"/);
    expect(html).not.toMatch(/data-day="2026-11-1[345]" data-revealed/); // ids-ok: a fixed date in invented markup, never a record id
    const flat = d.flatMap((x) => x.items.map((i) => i.title));
    expect(flat.every((t) => html.includes(t.replace('$1,200.00', '$1,200.00')))).toBe(true);
    expect(flat.indexOf('Tuesday errand')).toBeGreaterThan(flat.indexOf('Pay $1,200.00 to Demo Co'));
    expect(html.indexOf('Tuesday errand')).toBeGreaterThan(html.indexOf('Pay $1,200.00 to Demo Co'));
  });

  it('collapsing again returns exactly the first view', () => {
    const d = days();
    expect(draw(d, { phone: true, expanded: false })).toBe(draw(d, { phone: true }));
    expect(draw(d, { phone: true, expanded: true })).not.toBe(draw(d, { phone: true }));
  });

  it('fewer than three days, exactly three, or none: no button and no status text', () => {
    for (const list of [items().filter((i) => i.firstDay <= '2026-11-14'), items().filter((i) => i.firstDay <= '2026-11-15')]) {
      const html = draw(days(list), { phone: true });
      expect(html).not.toContain('td-more');
      expect(html).not.toContain('Show all');
      expect(dayDates(html).length).toBe(days(list).length);
    }
    const none = draw([], { phone: true });
    expect(none).not.toContain('td-more');
    expect(dayDates(none)).toEqual([]);
  });

  it('a computer always shows every day, with no button, whatever the expanded flag says', () => {
    const d = days();
    for (const expanded of [false, true]) {
      const html = draw(d, { phone: false, expanded });
      expect(dayDates(html)).toEqual(d.map((x) => x.date));
      expect(html).not.toContain('td-more');
      expect(html).not.toContain('Showing all');
      expect(html).not.toContain('data-revealed');
    }
  });

  it('rows keep their actions: check buttons for tasks, a words button for bills, in the preview and after expanding', () => {
    const html = draw(days(), { phone: true });
    expect(html).toContain('aria-label="Mark done: Busy day item 1"');
    expect(html).toContain('Open bill');
    expect(html).toContain('aria-label="Mark done: Pay $1,200.00 to Demo Co"');
    expect(draw(days(), { phone: true, expanded: true })).toContain('aria-label="Mark done: Order school supplies"');
  });

  it('Hide amounts still masks an amount in the preview and after expanding (title, name and tooltip)', () => {
    for (const expanded of [false, true]) {
      const html = draw(days(), { phone: true, expanded, hide: true });
      expect(html).not.toMatch(/\$\s?\d/);
      expect(html).toContain('$••••');
    }
    expect(draw(days(), { phone: true })).toContain('$1,200.00');
  });
});

describe('D13.1 mobile preview: it adds no data, rule or storage', () => {
  const cards = readFileSync(new URL('./cards.tsx', import.meta.url), 'utf8');
  const model = readFileSync(new URL('./todayModel.ts', import.meta.url), 'utf8');
  const css = readFileSync(new URL('./today.css', import.meta.url), 'utf8');

  it('the card still reads one list from the one provider and calls upcomingDays once; the preview functions are pure display helpers', () => {
    const body = cards.slice(cards.indexOf('function UpcomingCard'), cards.indexOf('function RemindersCard'));
    expect((body.match(/useTodayData\(\)/g) ?? []).length).toBe(1);
    expect((cards.match(/upcomingDays\(/g) ?? []).length).toBe(1);
    expect(body).not.toMatch(/localStorage|sessionStorage|useLiveQuery|useSharedLive|fetch\(/);
    const preview = model.slice(model.indexOf('export const PREVIEW_DAYS'), model.indexOf('export function kindIcon') > 0 ? model.indexOf('/**\n * D13.1: the small kind icon') : undefined);
    expect(preview).not.toMatch(/\bdb\b|Dexie|formatCents|storage|Date\.now|new Date|addDays\(/);
  });

  it('the expanded state is not saved anywhere (every visit starts compact)', () => {
    const body = cards.slice(cards.indexOf('function UpcomingCard'), cards.indexOf('function RemindersCard'));
    expect(body).toMatch(/useState\(false\)/);
    expect(body).not.toMatch(/localStorage|setItem/);
  });

  it('the rules for what Coming up lists are untouched (logic.ts still holds upcomingDays as before)', () => {
    const logic = readFileSync(new URL('./logic.ts', import.meta.url), 'utf8');
    expect(logic).toContain("if (i.firstDay <= today || i.firstDay > last || i.done) continue;");
    expect(logic).not.toMatch(/PREVIEW|previewDays|collapsed|Show all/);
  });

  it('no CSS ordering trick: the order on screen is the order in the page, so reading and Tab order agree', () => {
    expect(css).not.toMatch(/(^|[;{\s])order\s*:/m);
    expect(css).not.toMatch(/flex-direction:\s*column-reverse|row-reverse/);
  });

  it('the page uses the one phone width (640 px) for both the preview and the Cash outlook move', () => {
    const page = readFileSync(new URL('./TodayModule.tsx', import.meta.url), 'utf8');
    expect(model).toContain("PHONE_QUERY = '(max-width: 640px)'");
    expect(page).toContain('useMediaQuery(PHONE_QUERY)');
    expect(cards).toContain('useMediaQuery(PHONE_QUERY)');
  });
});

describe('D13.1 Cash outlook on a phone: once, after Overdue, nothing else disturbed', () => {
  const CARDS: CardInfo[] = [
    { id: 'today.agenda', defaultWidth: 'full', priority: 10 }, { id: 'today.reminders', defaultWidth: 'half', priority: 15 }, { id: 'today.overdue', defaultWidth: 'half', priority: 20 },
    { id: 'today.upcoming', defaultWidth: 'half', priority: 30 }, { id: 'projects.attention', defaultWidth: 'half', priority: 35 }, { id: 'bills.attention', defaultWidth: 'half', priority: 37 },
    { id: 'assets.attention', defaultWidth: 'half', priority: 38 }, { id: 'household.attention', defaultWidth: 'half', priority: 38 }, { id: 'services.attention', defaultWidth: 'half', priority: 39 },
    { id: 'ledger.attention', defaultWidth: 'half', priority: 40 }, { id: 'ledger.cash', defaultWidth: 'half', priority: 50 },
  ];
  const ids = (c: ReturnType<typeof composeToday>) => [...c.agenda.map((x) => x.id), ...c.side.flatMap((u) => u.cards.map((x) => x.id))];
  const a0 = defaultArrangement(CARDS);

  it('the phone order is Today, Reminders, Overdue, Cash outlook, Coming up, then Needs attention and Household status', () => {
    const c = composeToday(CARDS, a0, { phone: true });
    expect(c.agenda.map((x) => x.id)).toEqual(['today.agenda', 'today.reminders', 'today.overdue', 'ledger.cash', 'today.upcoming']);
    expect(c.agenda.find((x) => x.id === 'ledger.cash')?.promoted).toBe(true);
    expect(c.side.map((u) => u.id)).toEqual(['ledger.attention', STATUS_UNIT]);
    expect(PHONE_PROMOTED).toEqual({ id: 'ledger.cash', after: 'today.overdue' });
  });

  it('every one of the eleven cards is drawn exactly once on a phone, and on a computer', () => {
    for (const phone of [true, false]) {
      const all = ids(composeToday(CARDS, a0, { phone }));
      expect([...all].sort()).toEqual(CARDS.map((c) => c.id).sort());
      expect(new Set(all).size).toBe(all.length);
    }
  });

  it('a computer and a tablet are unchanged: the same composition as before the correction', () => {
    expect(composeToday(CARDS, a0, { phone: false })).toEqual(composeToday(CARDS, a0));
    const c = composeToday(CARDS, a0);
    expect(c.agenda.map((x) => x.id)).toEqual(['today.agenda', 'today.reminders', 'today.overdue', 'today.upcoming']);
    expect(c.side.map((u) => u.id)).toEqual(['ledger.attention', 'ledger.cash', STATUS_UNIT]);
    expect(c.agenda.some((x) => x.promoted)).toBe(false);
  });

  it('a hidden Cash outlook stays hidden on a phone, and a customized order still decides the rest of the side column', () => {
    const hidden = composeToday(CARDS, hideCard(a0, 'ledger.cash'), { phone: true });
    expect(hidden.agenda.find((x) => x.id === 'ledger.cash')).toMatchObject({ hidden: true, promoted: true });
    const custom = { side: [STATUS_UNIT, 'ledger.cash', 'ledger.attention'], hidden: [] };
    const c = composeToday(CARDS, custom, { phone: true });
    expect(c.side.map((u) => u.id)).toEqual([STATUS_UNIT, 'ledger.attention']); // the owner's order for the others is honored
    expect(composeToday(CARDS, custom).side.map((u) => u.id)).toEqual([STATUS_UNIT, 'ledger.cash', 'ledger.attention']); // and on a computer nothing moved
    expect(custom.side).toEqual([STATUS_UNIT, 'ledger.cash', 'ledger.attention']); // composing never changes what was saved
  });

  it('without a Cash outlook card (not registered) a phone composition changes nothing', () => {
    const fewer = CARDS.filter((c) => c.id !== 'ledger.cash');
    expect(composeToday(fewer, defaultArrangement(fewer), { phone: true })).toEqual(composeToday(fewer, defaultArrangement(fewer)));
  });

  it('moving a section on a phone steps past Cash outlook (which is not in the visible side list) so the move is visible', () => {
    const a = { side: ['ledger.attention', 'ledger.cash', STATUS_UNIT], hidden: [] };
    const before = copyArrangement(a);
    const down = moveUnit(a, 'ledger.attention', 1, ['ledger.cash']);
    expect(down.side).toEqual([STATUS_UNIT, 'ledger.cash', 'ledger.attention']);
    expect(moveUnit(a, 'ledger.attention', 1).side).toEqual(['ledger.cash', 'ledger.attention', STATUS_UNIT]); // no skip (a computer): one plain step
    expect(moveUnit(a, STATUS_UNIT, 1, ['ledger.cash'])).toBe(a);
    expect(moveUnit(a, 'ledger.attention', -1, ['ledger.cash'])).toBe(a);
    expect(a).toEqual(before);
  });

  it('saved layouts keep working: an earlier layout is still carried over, an invalid saved arrangement is repaired, and nothing here writes storage', () => {
    let legacy = defaultLayout(CARDS);
    for (let i = 0; i < 7; i++) legacy = moveEntry(legacy, 'ledger.cash', -1);
    const derived = deriveFromLegacy(legacy, CARDS);
    expect(derived.side[0]).toBe('ledger.cash');
    const phoneView = composeToday(CARDS, derived, { phone: true });
    expect(phoneView.agenda.map((x) => x.id)).toContain('ledger.cash');
    expect(sanitizeArrangement({ side: ['ledger.cash'], hidden: [] }, CARDS).side).toEqual(['ledger.cash', ...sideUnits(CARDS).map((u) => u.id).filter((x) => x !== 'ledger.cash')]);
    const src = readFileSync(new URL('./composition.ts', import.meta.url), 'utf8');
    expect(src.slice(src.indexOf('export function composeToday'), src.indexOf('/** The title Edit layout shows'))).not.toMatch(/setItem|removeItem|localStorage/);
  });
});
