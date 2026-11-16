/**
 * R4.2 Family Lenses: how Calendar, Tasks and Today know WHO in the household a record concerns, without importing the Family module (the same idea as
 * `projectLink.ts`). READ-ONLY and IDENTITY ONLY: a person is a member id, the Contact id the member points at, the Contact's name and the member's
 * display color (one of the eight semantic ids). Nothing else of a member (role, birthday, birth year, note) and nothing of a Contact (phone, email,
 * notes) is read into this shape, and nothing is ever written.
 *
 * Who counts: the ACTIVE, readable members, one per Contact (the oldest record), exactly as Family's own `householdPeople` decides (a test pins that the two
 * agree on odd rows). A past member, an unreadable row or a Contact that is not a member is not a person here, so a record that names them simply shows no
 * chip. An event or Task is "for" a person only when its `contactIds` lists that person's Contact id: Ledger never guesses from a title or a note.
 *
 * The stored color is one of Family's eight hex values; the map below is the one copy outside Family and a test pins it to Family's `COLORS`.
 */
import { db, type FinanceDB } from '../db';
import type { MemberColorId } from '../ui/memberIdentityModel';
import type { ModuleRecord } from './entities';
import { isLive } from './store';

export const FAMILY_MODULE = 'family';
export const FAMILY_MEMBER_KIND = 'member';
/** What Family shows when a member's Contact is gone (kept in step with Family's own text by a test). */
export const MISSING_CONTACT_NAME = 'Contact no longer exists';
/** The roles a member row may have to be readable (Family's `ROLES`; a test pins it). */
export const KNOWN_ROLES: readonly string[] = ['parent', 'spouse', 'child', 'grandparent', 'other'];
/** Stored hex value to semantic color id (Family's `COLORS`; a test pins it). Anything else is "no color". */
export const COLOR_ID_BY_HEX: Readonly<Record<string, MemberColorId>> = {
  '#4a7bd0': 'blue', '#2f8f6b': 'green', '#c0562f': 'orange', '#8a5cc7': 'purple', '#c4398a': 'pink', '#b8860b': 'gold', '#2a9fb0': 'teal', '#6b7280': 'gray',
};

export interface HouseholdPerson {
  memberId: number;
  contactId: number;
  name: string;
  /** The member's color, or null for "no color" (drawn neutral gray). */
  colorId: MemberColorId | null;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isId = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

/** Pure: the active people from raw `family/member` rows and the live Contacts' names. */
export function peopleFromRows(rows: readonly ModuleRecord[], names: ReadonlyMap<number, string>): HouseholdPerson[] {
  const first = new Map<number, { memberId: number; color: MemberColorId | null }>();
  for (const r of [...rows].sort((a, b) => (a.id as number) - (b.id as number))) {
    const x = r.data;
    if (!isRecord(x) || !isId(x.contactId) || x.status !== 'active' || typeof x.role !== 'string' || !KNOWN_ROLES.includes(x.role)) continue;
    if (first.has(x.contactId)) continue;
    first.set(x.contactId, { memberId: r.id as number, color: typeof x.color === 'string' ? COLOR_ID_BY_HEX[x.color] ?? null : null });
  }
  return [...first.entries()]
    .map(([contactId, m]) => ({ memberId: m.memberId, contactId, name: names.get(contactId)?.trim() || MISSING_CONTACT_NAME, colorId: m.color }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.memberId - b.memberId);
}

/** Reads (never writes) the household's people: the member rows, then only the Contact rows they point at. */
export async function loadHouseholdPeople(d: FinanceDB = db): Promise<HouseholdPerson[]> {
  const rows = (await d.moduleRecords.where('[module+kind]').equals([FAMILY_MODULE, FAMILY_MEMBER_KIND]).toArray()).filter(isLive);
  const ids = [...new Set(rows.flatMap((r) => (isRecord(r.data) && isId(r.data.contactId) ? [r.data.contactId] : [])))];
  const found = ids.length ? await d.contacts.bulkGet(ids) : [];
  const names = new Map<number, string>();
  found.forEach((c, i) => { if (c && isLive(c) && typeof c.name === 'string') names.set(ids[i], c.name); });
  return peopleFromRows(rows, names);
}

/** Contact id to person, for looking up what a record's `contactIds` name. */
export const peopleByContact = (people: readonly HouseholdPerson[]): Map<number, HouseholdPerson> => new Map(people.map((p) => [p.contactId, p]));

/** The household people a record's `contactIds` name: once each, in name order. A Contact that is not a household member is ignored (no error, no chip). */
export function peopleOf(contactIds: readonly number[] | undefined, byContact: ReadonlyMap<number, HouseholdPerson>): HouseholdPerson[] {
  if (!contactIds?.length) return [];
  return [...new Set(contactIds)].flatMap((c) => (byContact.has(c) ? [byContact.get(c)!] : [])).sort((a, b) => a.name.localeCompare(b.name) || a.memberId - b.memberId);
}

/**
 * The lens test. `selected` is the chosen people's Contact ids; empty means Everyone (nothing is filtered, unassigned records included). With people chosen, a
 * record passes only when its `contactIds` names AT LEAST ONE of them (so a shared record passes once, and an unassigned one does not).
 */
export function lensMatches(contactIds: readonly number[] | undefined, selected: readonly number[]): boolean {
  if (selected.length === 0) return true;
  return !!contactIds?.some((c) => selected.includes(c));
}

/** A short spoken list: "Alex", "Alex and Sam", "Alex, Sam and Jo". */
export function nameList(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
