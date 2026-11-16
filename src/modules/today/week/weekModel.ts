/**
 * R1.2 "This Week": the pure composition of the weekly household review. NO React, NO database, NO clock (the caller passes `today`), nothing stored.
 *
 * THIS FILE DECIDES NOTHING ABOUT THE HOUSEHOLD. Every list and figure comes from a function that already exists, and is only cut to the seven-day window and
 * arranged:
 *   - Needs you:        `useNeedsYou` -> `previewAttention` (core/attention.ts). Ranking, identity and wording are R1.1's, untouched.
 *   - Schedule:         `todayList` and `upcomingDays` (Today's own list functions) over the Calendar's own items (events plus every module's due provider).
 *   - Commitments:      `householdCommitments` rows from `loadHouseholdOverview` (B5), cut to the week and tallied by the Household module's own reader (household/weekReview.ts).
 *   - Cash:             `cashOutlook` over Finance's own forecast (the Today "Cash outlook" function, with a shorter horizon for the week).
 *   - Home & projects:  the Needs-you items of Assets and Projects that the short list leaves out, Home & Assets' own `upcoming` maintenance, and the projects
 *                       that are over budget (all three through the module readers in core/weekReaders.ts).
 *   - Family:           F4's household overview (activities and dates for the week), through the Family module's reader.
 *
 * This file imports no module: the Household, Family, Assets and Projects readers arrive through `contributes.weekReview` (core/weekReaders.ts), the same way
 * Needs you gets its items, so Today stays ignorant of them.
 *
 * THE WINDOW: today and the six days after it, seven calendar days, both ends included.
 *
 * MONEY RULES (see the R1.2 report): commitments, expectations and recorded payments are different things. This page shows commitments and
 * expectations only, each row says whether its amount is fixed, an estimate, not known or in dispute, and a known total and an estimated total are NEVER
 * added together. Unknown and disputed rows are counted, never added as zero. Nothing here says that anything is paid, funded or overdue.
 */
import { addDays } from '../../../lib/dates';
import { previewAttention, type RankedAttention } from '../../../core/attention';
import type { LoadedForecast } from '../../../lib/forecastLive';
import { cashOutlook, type CashOutlook } from '../../../lib/cashOutlook';
import type { CalItem } from '../../calendar/useCalendarData';
import type { WeekFamily, WeekMaintenance, WeekMoney, WeekOverBudget, WeekPayRow } from '../../../core/weekReaders';
import { todayList, upcomingDays } from '../logic';
import { rangeText } from '../todayModel';

/** Seven days: today and the six after it. */
export const WEEK_DAYS = 7;
/** Maintenance that falls after this week but within this many days is mentioned as "coming up" (planning ahead). */
export const PLAN_AHEAD_DAYS = 30;
/** Most "more from Home & Assets and Projects" rows listed before the rest are left to Needs you. */
export const HOME_ROWS = 8;

export const weekWindow = (today: string) => ({ from: today, to: addDays(today, WEEK_DAYS - 1) });
export const inWeek = (date: string, today: string) => { const w = weekWindow(today); return date >= w.from && date <= w.to; };

/** What a source gave: still loading, could not be read (shown as such, never as "nothing"), or its value. */
export type Part<T> = { state: 'loading' } | { state: 'failed' } | { state: 'ready'; value: T };
export const ready = <T,>(value: T): Part<T> => ({ state: 'ready', value });

export type Section<T> = { state: 'loading' } | { state: 'failed' } | { state: 'ready'; data: T; empty: boolean };

export interface WeekInputs {
  today: string;
  needs: Part<{ ranked: RankedAttention[]; failed: string[] }>;
  calendar: Part<CalItem[]>;
  money: Part<WeekMoney>;
  cash: Part<LoadedForecast | null>;
  assets: Part<WeekMaintenance[]>;
  overBudget: Part<WeekOverBudget[]>;
  family: Part<WeekFamily>;
}

// ---- sections ----

export interface NeedsWeek { shown: RankedAttention[]; total: number; remaining: number; urgent: number; failedModules: string[] }

export interface WeekDay { date: string; items: CalItem[] }
export interface ScheduleWeek { days: WeekDay[]; count: number }

export type MoneyWeek = WeekMoney;

export interface CashWeek { week: CashOutlook | null; ninety: CashOutlook | null }

export type HomeKind = 'needs' | 'overBudget' | 'maintenance';
export interface HomeItem {
  key: string;
  kind: HomeKind;
  source: 'Home & Assets' | 'Projects';
  title: string;
  /** Words with no amount. For an over-budget project the amounts are in `money` and the caller words the sentence (so Hide amounts can cover it). */
  detail: string;
  /** A chip: "3 days overdue", "Due in 12 days", "Over budget". */
  chip: string;
  tone: 'overdue' | 'warning' | 'info';
  date: string | null;
  href: string;
  money?: { overCents: number; budgetCents: number };
}
export interface HomeWeek { items: HomeItem[]; moreInNeeds: number }

export type FamilyWeek = WeekFamily;

export interface SummaryTile { id: 'needs' | 'calendar' | 'payments' | 'home'; label: string; count: number; note: string; href: string }

export interface WeekReview {
  today: string;
  from: string;
  to: string;
  range: string;
  needs: Section<NeedsWeek>;
  schedule: Section<ScheduleWeek>;
  money: Section<MoneyWeek>;
  cash: Section<CashWeek>;
  home: Section<HomeWeek>;
  family: Section<FamilyWeek>;
  summary: SummaryTile[];
  /** The names of the parts that could not be read, so the page says the review is incomplete instead of looking complete. */
  unavailable: string[];
  /** Everything has answered and nothing needed a mention. */
  quiet: boolean;
  /** Something is still loading. */
  loading: boolean;
}

const SOURCE_NAME: Record<string, 'Home & Assets' | 'Projects'> = { assets: 'Home & Assets', projects: 'Projects' };
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const section = <A, T>(p: Part<A>, build: (a: A) => { data: T; empty: boolean }): Section<T> => {
  if (p.state !== 'ready') return p;
  const { data, empty } = build(p.value);
  return { state: 'ready', data, empty };
};

// ---- builders (each exported so a test can pin it on its own) ----

export function buildNeeds(n: { ranked: RankedAttention[]; failed: string[] }): NeedsWeek {
  const p = previewAttention(n.ranked);
  return { shown: p.shown, total: p.total, remaining: p.remaining, urgent: n.ranked.filter((r) => r.tier === 1).length, failedModules: n.failed };
}

/**
 * Today's own list functions, cut to the week: `todayList` (what Today lists for today, overdue leftovers excluded) and `upcomingDays` with a six-day look-ahead
 * (tomorrow through today + 6). Done items are left out of a briefing. `leave` removes what another section presents instead (the Family section).
 */
export function buildSchedule(items: CalItem[], today: string, leave: (i: CalItem) => boolean = () => false): ScheduleWeek {
  const days: WeekDay[] = [];
  const now = todayList(items, today).filter((i) => !i.done && !leave(i));
  if (now.length) days.push({ date: today, items: now });
  for (const d of upcomingDays(items, today, WEEK_DAYS - 1)) {
    const list = d.items.filter((i) => !leave(i));
    if (list.length) days.push({ date: d.date, items: list });
  }
  return { days, count: days.reduce((s, d) => s + d.items.length, 0) };
}

/** What Family presents itself: its derived markers (birthdays and important dates) and the stored events listed as household activities. */
export function familyCovers(f: WeekFamily | null): (i: CalItem) => boolean {
  if (!f) return () => false;
  const keys = new Set(f.activities.map((a) => a.openKey));
  return (i) => (i.derived ? i.source?.sourceModule === 'family' : keys.has(i.key));
}

/**
 * The Bills "Due: <bill>" marker on a day is the same occurrence as that bill's expected-payment row in the Payments section, so it is shown once, there. This
 * leaves out only a marker whose bill and date match a row that section lists; any other Bills marker (a renewal, a notice date) stays in the schedule.
 */
export function moneyCovers(rows: readonly WeekPayRow[]): (i: CalItem) => boolean {
  const due = rows.filter((r) => r.module === 'bills');
  return (i) => !!i.derived && !!i.source && i.source.sourceModule === 'bills' && due.some((r) => i.firstDay === r.date && i.source!.id.startsWith(`bills:due-${r.sourceId}-`));
}

export function buildCash(f: LoadedForecast | null, today: string): CashWeek {
  if (!f) return { week: null, ninety: null };
  return { week: cashOutlook(f, today, WEEK_DAYS - 1), ninety: cashOutlook(f, today, 90) };
}

/**
 * Things at home and in projects that the five-line Needs-you preview did not already show:
 *   1. the Home & Assets and Projects items in the full Needs-you ranking beyond the preview (overdue maintenance, warranties ending, projects behind),
 *   2. projects over budget (not something Needs you raises),
 *   3. maintenance due after this week but within 30 days (this week's is in the schedule).
 */
export function buildHome(args: { today: string; needs: NeedsWeek | null; ranked: RankedAttention[]; assets: WeekMaintenance[] | null; overBudget: WeekOverBudget[] | null }): HomeWeek {
  const { today } = args;
  const shownIds = new Set((args.needs?.shown ?? []).map((i) => i.id));
  const items: HomeItem[] = [];
  const left = args.ranked.filter((r) => SOURCE_NAME[r.moduleId] && !shownIds.has(r.id));
  for (const r of left.slice(0, HOME_ROWS)) {
    items.push({ key: r.id, kind: 'needs', source: SOURCE_NAME[r.moduleId], title: r.title, detail: r.reason, chip: '', tone: r.tier === 1 ? 'overdue' : r.tier === 2 ? 'warning' : 'info', date: r.date, href: r.href });
  }
  for (const p of args.overBudget ?? []) {
    items.push({ key: `projects:over-budget:${p.id}`, kind: 'overBudget', source: 'Projects', title: p.name, detail: 'Expected cost is over the budget.', chip: 'Over budget', tone: 'warning', date: null, href: p.href, money: { overCents: p.overCents, budgetCents: p.budgetCents } });
  }
  const last = addDays(today, PLAN_AHEAD_DAYS);
  const { to } = weekWindow(today);
  for (const m of args.assets ?? []) {
    if (m.overdue || m.dueDate <= to || m.dueDate > last) continue;
    items.push({ key: `assets:maintenance:${m.taskId}`, kind: 'maintenance', source: 'Home & Assets', title: m.title, detail: 'Maintenance coming up after this week.', chip: '', tone: 'info', date: m.dueDate, href: m.href });
  }
  return { items, moreInNeeds: Math.max(0, left.length - HOME_ROWS) };
}

// ---- the whole review ----

const NAMES = { needs: 'Needs you', schedule: 'Schedule', money: 'Payments', cash: 'Cash outlook', home: 'Home and projects', family: 'Family' } as const;

export function buildWeekReview(i: WeekInputs): WeekReview {
  const { today } = i;
  const { from, to } = weekWindow(today);

  const needs = section(i.needs, (n) => { const d = buildNeeds(n); return { data: d, empty: d.total === 0 && d.failedModules.length === 0 }; });
  const family = section(i.family, (d) => ({ data: d, empty: d.activities.length === 0 && d.dates.length === 0 }));

  const money = section(i.money, (d) => ({ data: d, empty: d.rows.length === 0 && d.contractDates.length === 0 && d.notConverted === 0 }));

  // The schedule waits for Family, so a row never jumps from one section to the other. If Family could not be read, nothing is left out of the schedule.
  const familyWeek = i.family.state === 'ready' ? i.family.value : null;
  const moneyRows = money.state === 'ready' ? money.data.rows : [];
  const leaveOut = (x: CalItem) => familyCovers(familyWeek)(x) || moneyCovers(moneyRows)(x);
  const schedule: Section<ScheduleWeek> = i.family.state === 'loading' || i.money.state === 'loading' ? { state: 'loading' } : section(i.calendar, (items) => { const d = buildSchedule(items, today, leaveOut); return { data: d, empty: d.count === 0 }; });

  const cash = section(i.cash, (f) => { const d = buildCash(f, today); return { data: d, empty: !d.week && !d.ninety }; });

  // Home and projects need the Needs-you ranking (to leave out what the preview shows). The other two parts are optional: if they fail, what remains is still listed and the failure is reported.
  const home: Section<HomeWeek> = i.needs.state !== 'ready' ? (i.needs.state === 'loading' ? { state: 'loading' } : { state: 'failed' }) : (() => {
    if (i.assets.state === 'loading' || i.overBudget.state === 'loading') return { state: 'loading' } as const;
    const d = buildHome({
      today, needs: needs.state === 'ready' ? needs.data : null, ranked: i.needs.value.ranked,
      assets: i.assets.state === 'ready' ? i.assets.value : null, overBudget: i.overBudget.state === 'ready' ? i.overBudget.value : null,
    });
    return { state: 'ready', data: d, empty: d.items.length === 0 } as const;
  })();

  const unavailable: string[] = [];
  if (needs.state === 'failed') unavailable.push(NAMES.needs);
  else if (needs.state === 'ready' && needs.data.failedModules.length) unavailable.push(`${NAMES.needs} (some modules)`);
  if (schedule.state === 'failed') unavailable.push(NAMES.schedule);
  if (money.state === 'failed') unavailable.push(NAMES.money);
  if (cash.state === 'failed') unavailable.push(NAMES.cash);
  if (family.state === 'failed') unavailable.push(NAMES.family);
  if (home.state === 'failed' || i.assets.state === 'failed' || i.overBudget.state === 'failed') unavailable.push(NAMES.home);

  const summary: SummaryTile[] = [];
  if (needs.state === 'ready' && needs.data.total > 0) summary.push({ id: 'needs', label: 'Need you', count: needs.data.total, note: needs.data.urgent > 0 ? `${needs.data.urgent} overdue or urgent` : 'none overdue', href: '#/today/needs' });
  const calCount = (schedule.state === 'ready' ? schedule.data.count : 0) + (family.state === 'ready' ? family.data.activities.length + family.data.dates.length : 0);
  if (calCount > 0 && (schedule.state === 'ready' || family.state === 'ready')) summary.push({ id: 'calendar', label: calCount === 1 ? 'Event or task' : 'Events and tasks', count: calCount, note: 'this week', href: '#/calendar?v=agenda' });
  if (money.state === 'ready' && money.data.rows.length > 0) summary.push({ id: 'payments', label: money.data.rows.length === 1 ? 'Payment expected' : 'Payments expected', count: money.data.rows.length, note: 'not yet paid', href: '#/household' });
  if (home.state === 'ready' && home.data.items.length > 0) summary.push({ id: 'home', label: 'Home and projects', count: home.data.items.length, note: 'to look at', href: '#/assets' });

  const secs = [needs, schedule, money, cash, home, family];
  const loading = secs.some((s) => s.state === 'loading');
  const quiet = !loading && unavailable.length === 0 && secs.every((s) => s.state === 'ready' && s.empty);
  return { today, from, to, range: rangeText(from, to), needs, schedule, money, cash, home, family, summary, unavailable, quiet, loading };
}

export const weekCountWords = (n: number, one: string, many = `${one}s`) => plural(n, one, many);
