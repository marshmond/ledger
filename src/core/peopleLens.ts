/**
 * R4.2: the person filter ("lens") shared by Calendar, Tasks, Today and Family Week. It is a view choice only.
 *
 * It lives in this browser tab's session storage: not in the database, not in a backup, not synced, and gone when the tab is closed. Default is Everyone
 * (nothing chosen). It never changes an event, a Task or a family member, and choosing a person never touches the Calendar's layer (overlay) switches,
 * which have their own saved preference. One small shared store, so a choice made on the Calendar is still there on Tasks and Today; each screen says
 * plainly when the lens is on and offers "Show everyone".
 */
import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { useSharedLive } from './sharedLive';
import { loadHouseholdPeople, lensMatches, peopleByContact, peopleOf, type HouseholdPerson } from './householdPeople';

export const LENS_KEY = 'ledger-people-lens';

const isIds = (v: unknown): v is number[] => Array.isArray(v) && v.every((x) => typeof x === 'number' && Number.isInteger(x));

/** Reads the saved choice; anything unreadable is Everyone. */
export function readLens(): number[] {
  try {
    const raw = sessionStorage.getItem(LENS_KEY);
    const v: unknown = raw ? JSON.parse(raw) : [];
    return isIds(v) ? [...new Set(v)] : [];
  } catch { return []; }
}

let current: number[] = readLens();
const listeners = new Set<() => void>();
const snapshot = () => current;

/** Replaces the choice (Contact ids). An empty list is Everyone. */
export function setLens(ids: readonly number[]): void {
  current = [...new Set(ids)];
  try { if (current.length) sessionStorage.setItem(LENS_KEY, JSON.stringify(current)); else sessionStorage.removeItem(LENS_KEY); } catch { /* storage unavailable: the choice lasts until the page closes */ }
  listeners.forEach((l) => l());
}
/** For tests: forget the in-memory copy and read storage again. */
export function resetLensForTests(): void { current = readLens(); listeners.forEach((l) => l()); }

export interface Lens {
  /** The household's active people, or undefined while they load. */
  people: HouseholdPerson[] | undefined;
  /** Contact id to person. */
  byContact: Map<number, HouseholdPerson>;
  /** The chosen people's Contact ids that are STILL household members (a person who left the household drops out; if none is left it is Everyone). */
  selected: number[];
  /** True when someone is chosen. */
  active: boolean;
  /** The chosen people, in name order. */
  chosen: HouseholdPerson[];
  matches: (contactIds: readonly number[] | undefined) => boolean;
  toggle: (contactId: number) => void;
  clear: () => void;
  set: (ids: readonly number[]) => void;
}

export const HOUSEHOLD_PEOPLE_KEY = 'household.people';

/** The one hook every screen uses: the people, the choice and the test. The people query is shared, so many rows cost one read. */
export function useLens(): Lens {
  const people = useSharedLive(HOUSEHOLD_PEOPLE_KEY, () => loadHouseholdPeople());
  const saved = useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, snapshot, snapshot);
  const byContact = useMemo(() => peopleByContact(people ?? []), [people]);
  const selected = useMemo(() => saved.filter((c) => byContact.has(c)), [saved, byContact]);
  const chosen = useMemo(() => peopleOf(selected, byContact), [selected, byContact]);
  const toggle = useCallback((id: number) => setLens(saved.includes(id) ? saved.filter((c) => c !== id) : [...saved, id]), [saved]);
  return useMemo(() => ({
    people, byContact, selected, active: selected.length > 0, chosen,
    matches: (ids) => lensMatches(ids, selected), toggle, clear: () => setLens([]), set: setLens,
  }), [people, byContact, selected, chosen, toggle]);
}
