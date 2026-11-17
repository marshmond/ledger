/** Test-only helpers for the CS-1 tests (never imported by the app). Invented names and dates only. */
import { vi } from 'vitest';
import { FinanceDB } from '../db';
import { createStore } from '../core/store';
import { installTracking } from '../lib/sync/track';
import { createCalendar, createEvent, ensureCalendarSeed, newEventData } from '../modules/calendar/data';
import { blankFields, PERSONAL_ID, type EventFields } from '../modules/calendar/model';
import type { SeriesExtras } from '../modules/calendar/series';
import { msAt } from '../modules/calendar/time';
import { registerModules } from '../modules';
import { createTask } from '../modules/tasks/data';
import { blankTask } from '../modules/tasks/model';
import { importIdKey } from './contract';
import { readDisplayState } from './readState';
import { buildProjection } from './build';

registerModules(); // registers the narrow Family reader the display layer asks for
export const TODAY = '2026-11-09';
export const TZ = 'America/New_York';
let n = 0;
export const fresh = (track = true) => { const d = new FinanceDB(`test-display-${n++}`); if (track) installTracking(d); return d; };
const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }; };
export const stubStorage = () => vi.stubGlobal('localStorage', mem());
export const TEST_KEY_BYTES = new Uint8Array(32).map((_, i) => 200 - i);
export const testKey = () => importIdKey(TEST_KEY_BYTES);

export const extras = (over: Partial<SeriesExtras> = {}): SeriesExtras => ({ calendarId: PERSONAL_ID, tagIds: [], contactIds: [], recurrence: null, trackDone: false, ...over });
export const addEvent = (d: FinanceDB, title: string, date: string, over: Partial<SeriesExtras> = {}, minutes?: number, f: Partial<EventFields> = {}) =>
  createEvent(newEventData({ ...(minutes === undefined ? blankFields(date) : { ...blankFields(date, msAt(date, minutes)), startDate: date, endDate: date }), title, ...f }, extras(over)), d);
export const addContact = (d: FinanceDB, name: string, extra: object = {}) => createStore(d).shared.contacts.put({ name, ...extra } as never);
// Family rows are written as plain rows here (not through the Family module), so this layer never imports Family, as the boundary test requires.
interface MemberFields { role?: string; status?: string; birthMonthDay?: string; birthYear?: number; color?: string; note?: string }
export const addMember = async (d: FinanceDB, contactId: number, over: MemberFields = {}) =>
  (await d.moduleRecords.add({ module: 'family', kind: 'member', data: { contactId, role: 'child', status: 'active', ...over }, createdAt: Date.now(), updatedAt: Date.now(), deletedAt: null } as never)) as number;
export const addFamilyDate = async (d: FinanceDB, f: { label: string; monthDay: string; year?: number; memberId?: number; dateKind?: string; status?: string }) =>
  (await d.moduleRecords.add({ module: 'family', kind: 'date', data: { dateKind: 'anniversary', status: 'active', ...f }, createdAt: Date.now(), updatedAt: Date.now(), deletedAt: null } as never)) as number;
export const addTask = (d: FinanceDB, title: string, over: Partial<ReturnType<typeof blankTask>> = {}, refs: { module: string; id: string | number }[] = []) => createTask(blankTask({ title, ...over }), refs, d);
export const calendar = (d: FinanceDB, name: string) => createCalendar(name, '#2f8f6b', d);
export const weekly = { freq: 'weekly', interval: 1, end: { type: 'never' } } as const;

/** Two children and a parent, all active; Coach is only a Contact. */
export async function household(track = true) {
  const d = fresh(track);
  await ensureCalendarSeed(d);
  const sam = await addContact(d, 'Sam Example', { email: 'HOSTILE-sam@example.test', phone: 'HOSTILE-555-0100', notes: 'HOSTILE-contact-note' });
  const robin = await addContact(d, 'Robin Example');
  const alex = await addContact(d, 'Alex Example', { email: 'HOSTILE-alex@example.test' });
  const coach = await addContact(d, 'Coach Example', { email: 'HOSTILE-coach@example.test', phone: 'HOSTILE-555-0199' });
  const samId = await addMember(d, sam, { color: '#4a7bd0', birthMonthDay: '11-12', birthYear: 2014, note: 'HOSTILE-member-note' });
  const robinId = await addMember(d, robin);
  const alexId = await addMember(d, alex, { role: 'parent', color: '#2f8f6b' });
  return { d, sam, robin, alex, coach, samId, robinId, alexId };
}

/** The whole path the preview takes: read, then build, with the test key. */
export async function projectionOf(d: FinanceDB, over: { today?: string; nowMs?: number; revision?: number } = {}) {
  const state = await readDisplayState(d, { today: over.today ?? TODAY, tz: TZ, nowMs: over.nowMs ?? Date.parse('2026-11-09T15:00:00Z'), idKey: await testKey(), revision: over.revision });
  const projection = await buildProjection(state.input);
  return { ...state, projection };
}
