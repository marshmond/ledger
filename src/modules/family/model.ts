/**
 * Family Management F1: the household-member record. PURE (no database, clock or network).
 *
 * A member is a `moduleRecords` row (module `family`, kind `member`) that POINTS AT one shared Contact. The Contact is the person's identity
 * (name, phone, email); the member holds only what a Contact cannot: role, active/past, birthday, display color and a short masked note.
 * Nothing about the person's name is copied here, so there is no second address book.
 *
 * Reading is defensive and lossless: a row this code cannot make sense of is returned as "needs review" (`data: null`) and is never rewritten;
 * fields this code does not know are carried through every edit.
 */
import type { ModuleRecord } from '../../core/entities';

export const MODULE = 'family';
export const KIND = 'member';
export const FAMILY_BASE = '/family';
/** A member's page, as written inside the module (the module prefix is added by the router). A helper, so no screen writes the address by hand. */
export const memberRoute = (id: number) => `/m/${id}`;
/** The Family dates page, as written inside the module. */
export const DATES_ROUTE = '/dates';

/** C1 adds `spouse`. A record from before still reads (nothing changes role by itself); an older build shows a `spouse` record as "needs review" until updated. */
export const ROLES = ['parent', 'spouse', 'child', 'grandparent', 'other'] as const;
export type Role = (typeof ROLES)[number];
export const ROLE_LABEL: Record<Role, string> = { parent: 'Parent', spouse: 'Spouse', child: 'Child', grandparent: 'Grandparent', other: 'Other' };

export const STATUSES = ['active', 'past'] as const;
export type Status = (typeof STATUSES)[number];
export const STATUS_LABEL: Record<Status, string> = { active: 'In the household', past: 'Past member' };

/** The approved display colors. Same values as the Calendar's swatches (a test pins that); each has a NAME so color is never the only cue. */
export const COLORS: readonly { value: string; name: string }[] = [
  { value: '#4a7bd0', name: 'Blue' },
  { value: '#2f8f6b', name: 'Green' },
  { value: '#c0562f', name: 'Orange' },
  { value: '#8a5cc7', name: 'Purple' },
  { value: '#c4398a', name: 'Pink' },
  { value: '#b8860b', name: 'Gold' },
  { value: '#2a9fb0', name: 'Teal' },
  { value: '#6b7280', name: 'Gray' },
];
export const colorName = (value: string | undefined): string => COLORS.find((c) => c.value === value)?.name ?? '';

export const NOTE_MAX = 300;
export const MIN_BIRTH_YEAR = 1900;

/** The fields a person edits. `contactId` is fixed once a member exists (changing it changes whose Tasks and events they appear to own). */
export interface MemberFields {
  role: Role;
  status: Status;
  /** `MM-DD`, or undefined when not set. */
  birthMonthDay?: string;
  birthYear?: number;
  /** One of COLORS, or undefined for neutral. */
  color?: string;
  note?: string;
  /** F2: false = leave this member's birthday off the owner's Calendar. Stored ONLY when false; absent (or unreadable) = shown. Says nothing about any future shared display. */
  birthdayOnCalendar?: boolean;
  /**
   * C1: "This is me", the owner's own profile. Stored ONLY when true (absent = not me). A preference inside one household app: it is not a login, a
   * permission or an account, and it grants no access to anything. Only an ACTIVE member can be me (see `effectiveMe`).
   */
  isMe?: boolean;
}
export type MemberData = MemberFields & { contactId: number };

export interface MemberRecord {
  id: number;
  createdAt: number;
  updatedAt: number;
  /** The readable view, or null when a required field (contact, role, status) could not be read: then the row is only listed for review. */
  data: MemberData | null;
  /** Plain-words reasons something could not be read (empty when everything is fine). Never contains the note. */
  problems: string[];
  /** The row exactly as stored: edits are made on top of this so unknown fields survive. */
  raw: Record<string, unknown>;
}

const KNOWN = new Set(['contactId', 'role', 'status', 'birthMonthDay', 'birthYear', 'color', 'note', 'birthdayOnCalendar', 'isMe']);
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isId = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v);

const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
/** `MM-DD` is a real calendar day. 02-29 is allowed (a leap-day birthday); how it is shown in non-leap years is a later (Calendar) decision. */
export function validMonthDay(s: unknown): s is string {
  if (typeof s !== 'string') return false;
  const m = /^(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const month = Number(m[1]);
  const day = Number(m[2]);
  return month >= 1 && month <= 12 && day >= 1 && day <= DAYS_IN_MONTH[month - 1];
}
export const monthDay = (month: number, day: number) => `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** "14 May". Empty for an invalid value. */
export function monthDayText(s: string | undefined): string {
  if (!validMonthDay(s)) return '';
  return `${Number(s.slice(3))} ${MONTH_NAMES[Number(s.slice(0, 2)) - 1]}`;
}
const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

export function validBirthYear(y: unknown, thisYear: number): y is number {
  return isId(y) && y >= MIN_BIRTH_YEAR && y <= thisYear;
}

/** Plain-words problem with the fields a person typed, or null. Pure; the contact and duplicate checks are in `data.ts`. */
export function validateFields(f: Partial<MemberFields>, thisYear: number): string | null {
  if (!ROLES.includes(f.role as Role)) return 'Choose a role.';
  if (!STATUSES.includes(f.status as Status)) return 'Choose whether this person is in the household now or is a past member.';
  if (f.birthMonthDay !== undefined && !validMonthDay(f.birthMonthDay)) return 'That birthday is not a real date.';
  if (f.birthYear !== undefined) {
    if (!validBirthYear(f.birthYear, thisYear)) return `The birth year must be a whole year from ${MIN_BIRTH_YEAR} to ${thisYear}.`;
    if (f.birthMonthDay === '02-29' && !isLeap(f.birthYear)) return `${f.birthYear} was not a leap year, so it has no 29 February.`;
  }
  if (f.color !== undefined && !COLORS.some((c) => c.value === f.color)) return 'Choose one of the listed colors.';
  if (f.note !== undefined && (typeof f.note !== 'string' || f.note.length > NOTE_MAX)) return `The note can be at most ${NOTE_MAX} characters.`;
  return null;
}

/** Trims text, drops empty optional fields, so a stored record carries a field only when it has a value. */
export function cleanFields(f: MemberFields): MemberFields {
  const note = (f.note ?? '').trim();
  return {
    role: f.role,
    status: f.status,
    ...(f.birthMonthDay ? { birthMonthDay: f.birthMonthDay } : {}),
    ...(f.birthYear !== undefined ? { birthYear: f.birthYear } : {}),
    ...(f.color ? { color: f.color } : {}),
    ...(note ? { note } : {}),
    ...(f.birthdayOnCalendar === false ? { birthdayOnCalendar: false } : {}),
    ...(f.isMe === true && f.status === 'active' ? { isMe: true } : {}),
  };
}

/**
 * Reads a stored row defensively. Never throws, never writes. A damaged REQUIRED field (contact, role, status) gives `data: null`; a damaged
 * OPTIONAL field is left out of the view and named in `problems` (the stored value is untouched until the person saves that field again).
 */
export function asMember(r: ModuleRecord, thisYear = new Date().getFullYear()): MemberRecord {
  const raw: Record<string, unknown> = isRecord(r.data) ? r.data : {};
  const problems: string[] = [];
  const base = { id: r.id as number, createdAt: r.createdAt, updatedAt: r.updatedAt, raw };
  if (!isRecord(r.data)) return { ...base, data: null, problems: ['The record is not readable.'] };
  if (!isId(raw.contactId)) problems.push('It does not point at a contact.');
  if (!ROLES.includes(raw.role as Role)) problems.push('Its role is not one this version knows.');
  if (!STATUSES.includes(raw.status as Status)) problems.push('Its status is not one this version knows.');
  if (problems.length) return { ...base, data: null, problems };

  const data: MemberData = { contactId: raw.contactId as number, role: raw.role as Role, status: raw.status as Status };
  if (raw.birthMonthDay !== undefined) {
    if (validMonthDay(raw.birthMonthDay)) data.birthMonthDay = raw.birthMonthDay;
    else problems.push('The birthday could not be read.');
  }
  if (raw.birthYear !== undefined) {
    if (validBirthYear(raw.birthYear, thisYear + 1)) data.birthYear = raw.birthYear; // a year ahead is tolerated on READ (clock differences between devices)
    else problems.push('The birth year could not be read.');
  }
  if (raw.color !== undefined) {
    if (typeof raw.color === 'string' && COLORS.some((c) => c.value === raw.color)) data.color = raw.color;
    else problems.push('The color could not be read.');
  }
  if (raw.note !== undefined) {
    if (typeof raw.note === 'string') data.note = raw.note.slice(0, NOTE_MAX * 4); // a very long note from another version is shown cut, never stored cut
    else problems.push('The note could not be read.');
  }
  if (raw.birthdayOnCalendar !== undefined) {
    if (typeof raw.birthdayOnCalendar === 'boolean') data.birthdayOnCalendar = raw.birthdayOnCalendar;
    else problems.push('The Calendar setting could not be read, so the birthday is treated as shown.');
  }
  if (raw.isMe !== undefined) {
    if (typeof raw.isMe === 'boolean') { if (raw.isMe) data.isMe = true; }
    else problems.push('The "This is me" setting could not be read, so it is treated as off.');
  }
  return { ...base, data, problems };
}

/** What gets stored: everything already on the row that this code does not know, then the known fields. `contactId` always comes from the row. */
export function toStored(raw: Record<string, unknown>, contactId: number, fields: MemberFields): Record<string, unknown> {
  const unknown = Object.fromEntries(Object.entries(raw).filter(([k, v]) => !KNOWN.has(k) && v !== undefined));
  return { ...unknown, contactId, ...cleanFields(fields) };
}

/**
 * Groups of ACTIVE members that point at the same Contact (two devices can each add one while offline). A group is a WARNING, never merged
 * or deleted automatically. Past members and unreadable rows are not part of a group.
 */
export function duplicateGroups(members: readonly MemberRecord[]): MemberRecord[][] {
  const by = new Map<number, MemberRecord[]>();
  for (const m of members) {
    if (m.data?.status !== 'active') continue;
    by.set(m.data.contactId, [...(by.get(m.data.contactId) ?? []), m]);
  }
  return [...by.values()].filter((g) => g.length > 1).map((g) => g.sort((a, b) => a.id - b.id));
}

/** The note is private: never part of any label, list text or message built from a member. */
export function memberSummary(name: string, d: Pick<MemberData, 'role' | 'status'>): string {
  return `${name}, ${ROLE_LABEL[d.role].toLowerCase()}${d.status === 'past' ? ' (past member)' : ''}`;
}

/** Contacts that share a (case/accent-insensitive) name with the one being typed, for the "use the existing one instead?" warning. */
export function sameNameContacts<T extends { name: string }>(contacts: readonly T[], typed: string, key: (s: string) => string): T[] {
  const k = key(typed);
  return k ? contacts.filter((c) => key(c.name) === k) : [];
}

/**
 * C1: who is "me"? PURE. Only an ACTIVE, readable member marked `isMe` counts (a past member can never be me, even if an older build left the mark).
 * Each device keeps its own local rule (setting one clears the others in one transaction), but two devices can each mark a DIFFERENT member while
 * offline and both marks then survive sync. Rule: exactly one marked active member = that member is me; two or more = a CONFLICT and NOBODY is treated
 * as me until the owner chooses (Ledger never guesses who the owner is, and reading never rewrites anything). None marked = no one.
 */
export interface MeState {
  /** The one effective "me", or null when nobody is marked or the marks conflict. */
  me: MemberRecord | null;
  /** Every active member that carries the mark when there is more than one, oldest first; empty otherwise. */
  conflict: MemberRecord[];
}
export function effectiveMe(members: readonly MemberRecord[]): MeState {
  const marked = members.filter((m) => m.data?.status === 'active' && m.data.isMe === true).sort((a, b) => a.id - b.id);
  if (marked.length === 1) return { me: marked[0], conflict: [] };
  return { me: null, conflict: marked.length > 1 ? marked : [] };
}

/**
 * U1: a short label that tells members apart when they share a name, built only from what the member already has on screen elsewhere (role, color NAME,
 * and when the record was added). No ids, free text, birth years or contact details. Order: role, color, added date.
 */
export function memberHint(m: MemberRecord): string {
  const parts: string[] = [];
  if (m.data) {
    parts.push(ROLE_LABEL[m.data.role]);
    const c = colorName(m.data.color);
    if (c) parts.push(c);
  }
  parts.push(`added ${new Date(m.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`);
  return parts.join(', ');
}
