/**
 * Family Management F3: an "important contact" for a household member. PURE (no database, clock or network).
 *
 * A `moduleRecords` row (module `family`, kind `contact`) that says "this shared Contact matters to this member, for this reason" (a school office,
 * a coach, a childcare provider, an emergency contact). It stores ONLY the two ids and a short purpose: the Contact's name, phone and email stay on
 * the shared Contact, so there is no second address book. One row per fact, so two devices that each add a different contact both keep theirs.
 *
 * Reading is defensive and lossless, like the member and date records: a damaged REQUIRED field (member, contact, purpose, status) makes the row
 * "needs review" (counted, never rewritten); fields this version does not know are carried through every edit.
 *
 * "Remove" is ARCHIVE (a status change that can be undone), never a delete, and it never touches the Contact.
 */
import type { ModuleRecord } from '../../core/entities';

export const CONTACT_KIND = 'contact';

export const PURPOSE_MAX = 60;
export const CONTACT_STATUSES = ['active', 'archived'] as const;
export type ContactStatus = (typeof CONTACT_STATUSES)[number];

export interface ImportantContactFields {
  /** The Family member record this is for. */
  memberId: number;
  /** The shared Contact. */
  contactId: number;
  /** Short label such as "Soccer coach" or "School office". The owner's own words. */
  purpose: string;
  status: ContactStatus;
}

export interface ImportantContactRecord {
  id: number;
  createdAt: number;
  updatedAt: number;
  /** The readable view, or null when a required field could not be read. */
  data: ImportantContactFields | null;
  problems: string[];
  /** The row exactly as stored: edits are made on top of this so unknown fields survive. */
  raw: Record<string, unknown>;
}

const KNOWN = new Set(['memberId', 'contactId', 'purpose', 'status']);
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

/** Two purposes are "the same" ignoring case, accents and extra spaces. */
export const purposeKey = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
export const tidyPurpose = (s: string) => s.trim().replace(/\s+/g, ' ');

/** Plain-words problem with what a person typed, or null. */
export function validateImportantContact(f: Partial<ImportantContactFields>): string | null {
  if (!isInt(f.memberId)) return 'That family member is not valid.';
  if (!isInt(f.contactId)) return 'Choose a contact.';
  const purpose = tidyPurpose(f.purpose ?? '');
  if (!purpose) return 'Say what this contact is for, for example “School office” or “Soccer coach”.';
  if (purpose.length > PURPOSE_MAX) return `The purpose can be at most ${PURPOSE_MAX} characters.`;
  if (!CONTACT_STATUSES.includes(f.status as ContactStatus)) return 'Choose whether the association is active or removed.';
  return null;
}

export function cleanImportantContact(f: ImportantContactFields): ImportantContactFields {
  return { memberId: f.memberId, contactId: f.contactId, purpose: tidyPurpose(f.purpose), status: f.status };
}

/** Reads a stored row defensively. Never throws, never writes. */
export function asImportantContact(r: ModuleRecord): ImportantContactRecord {
  const raw: Record<string, unknown> = isRecord(r.data) ? r.data : {};
  const base = { id: r.id as number, createdAt: r.createdAt, updatedAt: r.updatedAt, raw };
  if (!isRecord(r.data)) return { ...base, data: null, problems: ['The record is not readable.'] };
  const problems: string[] = [];
  if (!isInt(raw.memberId)) problems.push('It does not point at a family member.');
  if (!isInt(raw.contactId)) problems.push('It does not point at a contact.');
  if (typeof raw.purpose !== 'string' || !tidyPurpose(raw.purpose)) problems.push('It has no readable purpose.');
  if (!CONTACT_STATUSES.includes(raw.status as ContactStatus)) problems.push('Its status is not one this version knows.');
  if (problems.length) return { ...base, data: null, problems };
  return {
    ...base, problems,
    data: {
      memberId: raw.memberId as number,
      contactId: raw.contactId as number,
      purpose: tidyPurpose(raw.purpose as string).slice(0, PURPOSE_MAX * 4), // a very long purpose from another version is shown cut, never stored cut
      status: raw.status as ContactStatus,
    },
  };
}

/** What gets stored: everything already on the row that this code does not know, then the known fields. */
export function toStoredImportantContact(raw: Record<string, unknown>, fields: ImportantContactFields): Record<string, unknown> {
  const unknown = Object.fromEntries(Object.entries(raw).filter(([k, v]) => !KNOWN.has(k) && v !== undefined));
  return { ...unknown, ...cleanImportantContact(fields) };
}

/** The identity of an association for duplicate checks: the same member, the same Contact and the same purpose (ignoring case and spacing). */
export const associationKey = (f: Pick<ImportantContactFields, 'memberId' | 'contactId' | 'purpose'>) => `${f.memberId}|${f.contactId}|${purposeKey(f.purpose)}`;

/** The ACTIVE, readable records for one member, oldest first. */
export function activeFor(records: readonly ImportantContactRecord[], memberId: number): ImportantContactRecord[] {
  return records.filter((r) => r.data?.status === 'active' && r.data.memberId === memberId).sort((a, b) => a.id - b.id);
}

/**
 * Groups of ACTIVE associations that say exactly the same thing (two devices can each add one while offline). A group is a WARNING for the
 * owner to resolve by removing one; nothing is merged or deleted automatically.
 */
export function duplicateAssociations(records: readonly ImportantContactRecord[]): ImportantContactRecord[][] {
  const by = new Map<string, ImportantContactRecord[]>();
  for (const r of records) {
    if (r.data?.status !== 'active') continue;
    const k = associationKey(r.data);
    by.set(k, [...(by.get(k) ?? []), r]);
  }
  return [...by.values()].filter((g) => g.length > 1).map((g) => g.sort((a, b) => a.id - b.id));
}
