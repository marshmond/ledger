/**
 * Calendar settings. One record in the existing `settings` table (so it is in backups and syncs with everything else).
 * They live in the shell Settings page; the Calendar and the Ledger provider both read them.
 */
import { db, type FinanceDB } from '../db';
import type { Priority } from './entities';

export type ViewId = 'month' | 'week' | 'workweek' | 'agenda';

/** The kinds of Finance item whose default priority can be changed. */
export const FINANCE_CLASSES = ['bill', 'income', 'vest', 'tax', 'rmd', 'milestone', 'loan'] as const;
export type FinanceClass = (typeof FINANCE_CLASSES)[number];
export const FINANCE_CLASS_LABEL: Record<FinanceClass, string> = {
  bill: 'Bills (money going out)',
  income: 'Income and transfers',
  vest: 'RSU vests',
  tax: 'Tax deadlines and year-end reminder',
  rmd: 'Required minimum distributions',
  milestone: 'Pay milestones (caps reached)',
  loan: 'Loan payments',
};

export interface CalendarSettings {
  /** 0 = Sunday ... 6 = Saturday. */
  weekStart: number;
  /** Which view to open with: the one used last, or always a fixed one. */
  openWith: 'last' | ViewId;
  /** Calendar that new events go into. null = Personal. */
  defaultCalendarId: number | null;
  /** How many days back unhandled past-due Finance items still show. */
  overdueDays: number;
  /** Default priority per class of Finance item (bills and loans become `high` within 3 days or when overdue). */
  financePriorities: Record<FinanceClass, Priority>;
}

export const DEFAULT_CALENDAR_SETTINGS: CalendarSettings = {
  weekStart: 0,
  openWith: 'last',
  defaultCalendarId: null,
  overdueDays: 30,
  financePriorities: { bill: 'medium', income: 'low', vest: 'reminder', tax: 'high', rmd: 'high', milestone: 'reminder', loan: 'medium' },
};

const KEY = 'calendarSettings';

/** Fills in anything missing or invalid, so an old or hand-edited value can never break the Calendar. */
export function normalizeSettings(raw: unknown): CalendarSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<CalendarSettings>;
  const D = DEFAULT_CALENDAR_SETTINGS;
  const pr = (p: unknown, d: Priority): Priority => (p === 'high' || p === 'medium' || p === 'low' || p === 'reminder' ? p : d);
  const fp = (r.financePriorities ?? {}) as Partial<Record<FinanceClass, Priority>>;
  return {
    weekStart: Number.isInteger(r.weekStart) && r.weekStart! >= 0 && r.weekStart! <= 6 ? r.weekStart! : D.weekStart,
    openWith: r.openWith === 'month' || r.openWith === 'week' || r.openWith === 'workweek' || r.openWith === 'agenda' ? r.openWith : 'last',
    defaultCalendarId: typeof r.defaultCalendarId === 'number' ? r.defaultCalendarId : null,
    overdueDays: Number.isFinite(r.overdueDays) && r.overdueDays! >= 0 && r.overdueDays! <= 3650 ? Math.floor(r.overdueDays!) : D.overdueDays,
    financePriorities: Object.fromEntries(FINANCE_CLASSES.map((c) => [c, pr(fp[c], D.financePriorities[c])])) as Record<FinanceClass, Priority>,
  };
}

export async function loadCalendarSettings(d: FinanceDB = db): Promise<CalendarSettings> {
  return normalizeSettings((await d.settings.get(KEY))?.value);
}

export async function saveCalendarSettings(patch: Partial<CalendarSettings>, d: FinanceDB = db): Promise<CalendarSettings> {
  const next = normalizeSettings({ ...(await loadCalendarSettings(d)), ...patch });
  await d.settings.put({ key: KEY, value: next });
  return next;
}
