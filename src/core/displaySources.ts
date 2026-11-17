/**
 * CS-1: how the family-display layer reads the Family module WITHOUT importing it (the same boundary `householdPeople.ts` keeps: no other part of
 * Ledger imports Family). The Family module registers one narrow reader at start-up; the display layer asks for it here.
 *
 * What the reader may return is fixed by these types: each household person's name, color id and a coarse group (never the role word, a birth year,
 * an age, a note, a phone or an email), and, for birthdays and important dates, only the dates they fall on inside the asked window. Whether any of it
 * is SHOWN is decided elsewhere; the reader only reads, and writes nothing.
 */
import type { FinanceDB } from '../db';
import type { MemberColorId } from '../ui/memberIdentityModel';

export type DisplayGroup = 'adult' | 'child' | 'other';
export interface DisplayFamilyPerson {
  memberId: number;
  /** The Contact this member points at. Used only to match an event or Task's people; never published. */
  contactId: number;
  name: string;
  colorId: MemberColorId | null;
  group: DisplayGroup;
}
export interface DisplayFamily {
  people: DisplayFamilyPerson[];
  /** A member's birthday: the dates (`YYYY-MM-DD`) it falls on inside the window. No year of birth, no age. */
  birthdays: { memberId: number; dates: string[] }[];
  /** Active important dates: the owner's short name and the dates it falls on inside the window. No start year. */
  dates: { id: number; label: string; memberId: number | null; dates: string[] }[];
}
export type FamilyDisplayReader = (d: FinanceDB, from: string, to: string) => Promise<DisplayFamily>;

let reader: FamilyDisplayReader | null = null;
export function registerFamilyDisplayReader(fn: FamilyDisplayReader | null): void { reader = fn; }
export const familyDisplayReader = (): FamilyDisplayReader | null => reader;
