/**
 * Today's shared options and the memory of dismissed or snoozed alerts. Both live in the existing `settings` table, so they are in
 * backups and sync to your other devices. (The card layout and the Hide amounts switch are NOT here: those are per device, see layout.ts.)
 *
 * Alerts are remembered one settings row each (`todayAlert:<alert id>|<period>`), so two devices that dismiss different alerts at the
 * same time never overwrite each other. The period (see `Alert.period`) makes a dismissed alert return when the situation changes.
 */
import { db, type FinanceDB } from '../../db';
import { addDays } from '../../lib/dates';

export interface TodaySettings {
  /** How many days ahead "Coming up" looks. */
  lookAheadDays: number;
  /** How many overdue items the Overdue card lists before pointing to the module that holds the rest. */
  overdueRows: number;
}
export const DEFAULT_TODAY_SETTINGS: TodaySettings = { lookAheadDays: 7, overdueRows: 25 };
export const LOOK_AHEAD_CHOICES = [3, 7, 14, 30] as const;
export const OVERDUE_ROWS_CHOICES = [5, 10, 15, 20, 25] as const;
const SETTINGS_KEY = 'todaySettings';

export function normalizeTodaySettings(raw: unknown): TodaySettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<TodaySettings>;
  const n = Number(r.lookAheadDays);
  const rows = Number(r.overdueRows);
  return {
    lookAheadDays: Number.isInteger(n) && n >= 1 && n <= 60 ? n : DEFAULT_TODAY_SETTINGS.lookAheadDays,
    overdueRows: (OVERDUE_ROWS_CHOICES as readonly number[]).includes(rows) ? rows : DEFAULT_TODAY_SETTINGS.overdueRows,
  };
}
export async function loadTodaySettings(d: FinanceDB = db): Promise<TodaySettings> {
  return normalizeTodaySettings((await d.settings.get(SETTINGS_KEY))?.value);
}
export async function saveTodaySettings(patch: Partial<TodaySettings>, d: FinanceDB = db): Promise<TodaySettings> {
  const next = normalizeTodaySettings({ ...(await loadTodaySettings(d)), ...patch });
  await d.settings.put({ key: SETTINGS_KEY, value: next });
  return next;
}

// ---- dismissed and snoozed alerts ----

export interface AlertMemory {
  /** `active` means "show it again" (an alert that was dismissed and then restored). */
  state: 'dismissed' | 'snoozed' | 'active';
  /** Snoozed alerts reappear on this day (YYYY-MM-DD). */
  until?: string;
  /** When this was set (ms), for tidying. */
  at: number;
}
export type AlertMemoryMap = Record<string, AlertMemory>;

const ALERT_PREFIX = 'todayAlert:';

/** The stable key for one alert in one situation: its id plus the period it is about. */
export const alertKey = (a: { id: string; period?: string }) => `${a.id}|${a.period ?? ''}`;

export function normalizeAlertMemory(raw: unknown): AlertMemory | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<AlertMemory>;
  if (r.state !== 'dismissed' && r.state !== 'snoozed' && r.state !== 'active') return null;
  return { state: r.state, until: typeof r.until === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.until) ? r.until : undefined, at: Number.isFinite(r.at) ? Number(r.at) : 0 };
}

/** Should this alert be left out right now? Snoozing ends on the snooze date; dismissing lasts until the alert's period changes. */
export function isAlertHidden(mem: AlertMemory | undefined, today: string): boolean {
  if (!mem) return false;
  if (mem.state === 'dismissed') return true;
  if (mem.state === 'snoozed') return !!mem.until && today < mem.until;
  return false;
}

export const snoozeUntil = (today: string, days: number) => addDays(today, days);

/** A custom snooze date must be a real calendar date after today (YYYY-MM-DD). */
export function isValidSnoozeDate(date: string, today: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const d = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === date && date > today;
}

export async function loadAlertMemory(d: FinanceDB = db): Promise<AlertMemoryMap> {
  const rows = await d.settings.where('key').startsWith(ALERT_PREFIX).toArray();
  const out: AlertMemoryMap = {};
  for (const r of rows) {
    const m = normalizeAlertMemory(r.value);
    if (m) out[r.key.slice(ALERT_PREFIX.length)] = m;
  }
  return out;
}

export async function rememberAlert(key: string, mem: Omit<AlertMemory, 'at'>, d: FinanceDB = db): Promise<void> {
  await d.settings.put({ key: ALERT_PREFIX + key, value: { ...mem, at: Date.now() } });
}

/** Brings an alert back (the rows are not deleted, so the change reaches your other devices as an ordinary update). */
export const restoreAlert = (key: string, d: FinanceDB = db) => rememberAlert(key, { state: 'active' }, d);
