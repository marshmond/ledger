/**
 * Calendar records. They live in the shared `moduleRecords` table (module 'calendar'), so backup, restore and device sync already
 * cover them. Two kinds: 'calendar' (a layer such as Personal) and 'event'.
 */
import type { ModuleRecord, Priority } from '../../core/entities';
import { normalizeRule, type Recurrence } from './recurrence';
import { todayISO } from '../../lib/money';

export const MODULE = 'calendar';

/** Built-in calendars get fixed ids so two devices that each create them end up with ONE (same convention as Ledger's built-in records). */
export const PERSONAL_ID = 9_000_000_000_000_101;
export const FINANCE_ID = 9_000_000_000_000_102;
export const TASKS_ID = 9_000_000_000_000_103;
export const PROJECTS_ID = 9_000_000_000_000_104;
export const ASSETS_ID = 9_000_000_000_000_105;
/** Household Services renewal and notice-by dates (S4). Verified unused in S4 before it was taken. */
export const SERVICES_ID = 9_000_000_000_000_106;
/** Bills & Subscriptions expected bills and contract dates (B2). Verified unused before it was taken. */
export const BILLS_ID = 9_000_000_000_000_107;
/** Family birthdays and important dates (F2). Verified unused before it was taken (the one earlier mention was a made-up id in a test, now changed). */
export const FAMILY_ID = 9_000_000_000_000_108;

/** `local`: events stored here. `derived`: worked out by a module's due provider (read-only). `subscribed`: reserved for external .ics feeds later. */
export type SourceType = 'local' | 'derived' | 'subscribed';

export interface LayerData {
  name: string;
  color: string;
  sourceType: SourceType;
  /** For derived (and later subscribed) calendars: which provider feeds it. */
  providerId?: string;
  builtin?: boolean;
}
export interface CalendarLayer extends LayerData {
  id: number;
}

export { PRIORITIES, PRIORITY_LABEL, PRIORITY_ICON } from '../../core/priority';

/** The fields of an event that a single occurrence can change on its own. */
export interface EventFields {
  title: string;
  allDay: boolean;
  /** All-day items: first and last day (inclusive), 'YYYY-MM-DD'. No time zone. */
  startDate: string;
  endDate: string;
  /** Timed items: absolute start and end (milliseconds). Shown in the device's local zone. */
  startAt: number;
  endAt: number;
  location: string;
  notes: string;
  priority: Priority;
  /** Minutes before the start (an all-day item starts at midnight). */
  reminders: number[];
}

export interface EventData extends EventFields {
  calendarId: number;
  tagIds: number[];
  contactIds: number[];
  recurrence: Recurrence | null;
  /** Occurrences (by their original date) that were deleted from a repeating series. */
  skipped: string[];
  /** Occurrences changed on their own, by original date. */
  overrides: Record<string, Partial<EventFields>>;
  /** Occurrences marked done (only used when `trackDone`). */
  doneKeys: string[];
  /** Keep showing it as overdue until it is marked done (bills, to-do style reminders). */
  trackDone: boolean;
  /** Free label such as 'bill' or 'finance' (used by Part C). */
  type?: string;
  /** The project this event belongs to (at most one, for the whole series). Only the id is stored. Absent = no project. */
  projectId?: number;
  /** If this event was retired because another module took it over: where it went. */
  retired?: { module: string; recordId: string | number; note: string };
}
export interface EventRecord {
  id: number;
  createdAt: number;
  updatedAt: number;
  data: EventData;
}

/** Fields this reader understands. Anything else in a stored record (written by another module or a newer version) is carried through untouched. */
const EVENT_KEYS = new Set(['title', 'allDay', 'startDate', 'endDate', 'startAt', 'endAt', 'location', 'notes', 'priority', 'reminders', 'calendarId', 'tagIds', 'contactIds', 'recurrence', 'skipped', 'overrides', 'doneKeys', 'trackDone', 'type', 'retired', 'projectId']);

const str = (v: unknown, d = '') => (typeof v === 'string' ? v : d);
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const nums = (v: unknown): number[] => (Array.isArray(v) ? v.filter((x): x is number => typeof x === 'number') : []);
const priority = (v: unknown): Priority => (v === 'high' || v === 'medium' || v === 'low' || v === 'reminder' ? v : 'medium');

/** Reads a stored record defensively: a record from another device or an older version can never crash a screen. */
export function asEvent(r: ModuleRecord): EventRecord {
  const d = r.data as Partial<EventData>;
  const today = todayISO();
  const startAt = num(d.startAt, Date.now());
  const allDay = d.allDay === true;
  const startDate = isDate(d.startDate) ? d.startDate : today;
  return {
    id: r.id as number,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    data: {
      ...(Object.fromEntries(Object.entries(d).filter(([k, v]) => !EVENT_KEYS.has(k) && v !== undefined)) as object),
      title: str(d.title, '(no title)'),
      allDay,
      startDate,
      endDate: isDate(d.endDate) && d.endDate >= startDate ? d.endDate : startDate,
      startAt,
      endAt: Math.max(startAt, num(d.endAt, startAt + 3600_000)),
      location: str(d.location),
      notes: str(d.notes),
      priority: priority(d.priority),
      reminders: nums(d.reminders),
      calendarId: num(d.calendarId, PERSONAL_ID),
      tagIds: nums(d.tagIds),
      contactIds: nums(d.contactIds),
      recurrence: normalizeRule(d.recurrence),
      skipped: Array.isArray(d.skipped) ? d.skipped.filter(isDate) : [],
      overrides: d.overrides && typeof d.overrides === 'object' ? (d.overrides as Record<string, Partial<EventFields>>) : {},
      doneKeys: Array.isArray(d.doneKeys) ? d.doneKeys.filter(isDate) : [],
      trackDone: d.trackDone === true,
      ...(d.type ? { type: str(d.type) } : {}),
      ...(d.retired ? { retired: d.retired } : {}),
      ...(typeof d.projectId === 'number' && Number.isFinite(d.projectId) ? { projectId: d.projectId } : {}),
    },
  };
}

export function asLayer(r: ModuleRecord): CalendarLayer {
  const d = r.data as Partial<LayerData>;
  return {
    id: r.id as number,
    name: str(d.name, 'Calendar'),
    color: /^#[0-9a-f]{6}$/i.test(str(d.color)) ? str(d.color) : '#4a7bd0',
    sourceType: d.sourceType === 'derived' || d.sourceType === 'subscribed' ? d.sourceType : 'local',
    ...(d.providerId ? { providerId: str(d.providerId) } : {}),
    ...(d.builtin ? { builtin: true } : {}),
  };
}

/** Colours offered for calendars. */
export const SWATCHES = ['#4a7bd0', '#2f8f6b', '#c0562f', '#8a5cc7', '#c4398a', '#b8860b', '#2a9fb0', '#6b7280'];

/** A blank event starting on `date` (all-day) or at `minutes` after midnight (timed, one hour long). */
export function blankFields(date: string, startAt?: number): EventFields {
  const at = startAt ?? Date.now();
  return { title: '', allDay: startAt === undefined, startDate: date, endDate: date, startAt: at, endAt: at + 3600_000, location: '', notes: '', priority: 'medium', reminders: [] };
}
