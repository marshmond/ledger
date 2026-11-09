/**
 * Family Management F2: the important-date record. PURE (no database, clock or network).
 *
 * A `moduleRecords` row (module `family`, kind `date`) for a yearly date that is NOT a member's own birthday: an anniversary or another date the
 * household wants to remember. A member's birthday is never stored here; it is read from the member's profile, so there is exactly one copy.
 *
 * Reading is defensive and lossless, like the member record: a damaged REQUIRED field (kind, label, month-day, status) makes the row "needs
 * review" (listed, not editable, never rewritten); a damaged OPTIONAL field is left out of the view and named; fields this version does not know are
 * carried through every edit.
 *
 * Privacy: nothing here says a date may appear on a shared display. There is deliberately NO display or sharing field (absent already means
 * private, and F2 adds no tablet control). `onCalendar` controls the OWNER's Calendar only.
 */
import type { ModuleRecord } from '../../core/entities';
import { validBirthYear, validMonthDay } from './model';

export const DATE_KIND = 'date';

export const DATE_KINDS = ['anniversary', 'other'] as const;
export type DateKind = (typeof DATE_KINDS)[number];
export const DATE_KIND_LABEL: Record<DateKind, string> = { anniversary: 'Anniversary', other: 'Other important date' };

export const DATE_STATUSES = ['active', 'archived'] as const;
export type DateStatus = (typeof DATE_STATUSES)[number];

export const LABEL_MAX = 60;
const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

export interface DateFields {
  dateKind: DateKind;
  /** Short title shown on the Calendar. The owner's own words; the form says not to put private details in it. */
  label: string;
  /** `MM-DD`. */
  monthDay: string;
  /** The year it began (an anniversary's first year). Shown only on the Family dates page, never on the Calendar. */
  year?: number;
  /** The Family member record this is about (optional; absent = the whole household). Only the id is stored. */
  memberId?: number;
  /** false = leave off the owner's Calendar. Stored ONLY when false; absent (or unreadable) = shown. */
  onCalendar?: boolean;
  status: DateStatus;
}

export interface DateRecord {
  id: number;
  createdAt: number;
  updatedAt: number;
  data: DateFields | null;
  problems: string[];
  raw: Record<string, unknown>;
}

const KNOWN = new Set(['dateKind', 'label', 'monthDay', 'year', 'memberId', 'onCalendar', 'status']);
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

/** Plain-words problem with what a person typed, or null. */
export function validateDate(f: Partial<DateFields>, thisYear: number): string | null {
  if (!DATE_KINDS.includes(f.dateKind as DateKind)) return 'Choose what kind of date this is.';
  const label = (f.label ?? '').trim();
  if (!label) return 'Give the date a short name.';
  if (label.length > LABEL_MAX) return `The name can be at most ${LABEL_MAX} characters.`;
  if (!validMonthDay(f.monthDay)) return 'That is not a real date.';
  if (f.year !== undefined) {
    if (!validBirthYear(f.year, thisYear)) return `The year must be a whole year from 1900 to ${thisYear}.`;
    if (f.monthDay === '02-29' && !isLeap(f.year)) return `${f.year} was not a leap year, so it has no 29 February.`;
  }
  if (f.memberId !== undefined && !isInt(f.memberId)) return 'That family member is not valid.';
  if (!DATE_STATUSES.includes(f.status as DateStatus)) return 'Choose whether the date is active or archived.';
  return null;
}

export function cleanDate(f: DateFields): DateFields {
  return {
    dateKind: f.dateKind,
    label: f.label.trim().replace(/\s+/g, ' '),
    monthDay: f.monthDay,
    status: f.status,
    ...(f.year !== undefined ? { year: f.year } : {}),
    ...(f.memberId !== undefined ? { memberId: f.memberId } : {}),
    ...(f.onCalendar === false ? { onCalendar: false } : {}),
  };
}

/** Reads a stored row defensively. Never throws, never writes. */
export function asDate(r: ModuleRecord, thisYear = new Date().getFullYear()): DateRecord {
  const raw: Record<string, unknown> = isRecord(r.data) ? r.data : {};
  const base = { id: r.id as number, createdAt: r.createdAt, updatedAt: r.updatedAt, raw };
  if (!isRecord(r.data)) return { ...base, data: null, problems: ['The record is not readable.'] };
  const problems: string[] = [];
  if (!DATE_KINDS.includes(raw.dateKind as DateKind)) problems.push('Its kind is not one this version knows.');
  if (typeof raw.label !== 'string' || !raw.label.trim()) problems.push('It has no readable name.');
  if (!validMonthDay(raw.monthDay)) problems.push('Its date could not be read.');
  if (!DATE_STATUSES.includes(raw.status as DateStatus)) problems.push('Its status is not one this version knows.');
  if (problems.length) return { ...base, data: null, problems };

  const data: DateFields = {
    dateKind: raw.dateKind as DateKind,
    label: (raw.label as string).trim().slice(0, LABEL_MAX * 4), // a very long label from another version is shown cut, never stored cut
    monthDay: raw.monthDay as string,
    status: raw.status as DateStatus,
  };
  if (raw.year !== undefined) {
    if (validBirthYear(raw.year, thisYear + 1)) data.year = raw.year as number;
    else problems.push('The year could not be read.');
  }
  if (raw.memberId !== undefined) {
    if (isInt(raw.memberId)) data.memberId = raw.memberId;
    else problems.push('The family member could not be read.');
  }
  if (raw.onCalendar !== undefined) {
    if (typeof raw.onCalendar === 'boolean') data.onCalendar = raw.onCalendar;
    else problems.push('The Calendar setting could not be read, so the date is treated as shown.');
  }
  return { ...base, data, problems };
}

/** What gets stored: everything on the row this code does not know, then the known fields. */
export function toStoredDate(raw: Record<string, unknown>, fields: DateFields): Record<string, unknown> {
  const unknown = Object.fromEntries(Object.entries(raw).filter(([k, v]) => !KNOWN.has(k) && v !== undefined));
  return { ...unknown, ...cleanDate(fields) };
}
