/**
 * The Family due provider (F2): a read-only Calendar layer "Family" worked out whenever the Calendar or Today asks. NOTHING is stored, copied or
 * written: no Calendar event, no Task, no reminder, no yearly series. Each answer is calculated from the requested window, so it moves with the clock.
 *
 * Two kinds of marker:
 *  1. MEMBER BIRTHDAYS `family:birthday-<memberId>:<date>`: one a year for every ACTIVE member with a valid birthday whose "show on Calendar" switch is
 *     on, titled "<Contact name>'s birthday". The name always comes from the linked Contact (a missing, deleted or unnamed Contact gives no marker).
 *  2. IMPORTANT DATES `family:date-<recordId>:<date>`: an active Family date (anniversary or other) that is switched on for the Calendar, titled with its label.
 *
 * Titles, details and calendar-file text carry NO birth year, age, note, phone, email or Contact detail. The identity of a marker is the member's (or the
 * date record's) own immutable id plus the date, so it is the same after a reload, a backup restore and a sync.
 *
 * PAST MEMBERS (policy): a member marked "past" has no birthday marker. Marking them in the household again brings it back. A date record is not tied
 * to a member's status, so one about a past member is shown until the owner archives it.
 *
 * TWO RECORDS FOR ONE PERSON (a duplicate the owner has not resolved yet): the OLDEST active record for a Contact supplies the birthday and the switch, so
 * the person gets one marker, not two. (Family already warns about the duplicate.)
 *
 * STORED BIRTHDAY EVENTS (`coveredBy`): if the owner also made a Calendar "Birthday" event for the SAME Contact (matched by Contact id, never by name)
 * and that event has an occurrence on the very same day, the marker names it in `coveredBy`. The Calendar then leaves the marker out only while that
 * occurrence is itself being shown (`calendar/markerCoordination.ts`), so hiding the owner's calendar, skipping or moving that year's occurrence, or
 * editing the date all bring the Family marker back. The stored event is never changed or hidden.
 *
 * FEBRUARY 29: see `calendarDates.ts` (28 February in a year without one, the same as the Calendar's own yearly repeat).
 *
 * Calendar visibility is the OWNER's Calendar only. A marker being visible there says nothing about any shared display; no such control exists in F2.
 */
import { db, type FinanceDB } from '../../db';
import { derivedId, goTo, type DerivedItem, type DueProvider, type DueQuery } from '../../core/dueProvider';
import { isLive } from '../../core/store';
import { loadEvents } from '../calendar/data';
import { storedItemKey } from '../calendar/markerCoordination';
import type { EventRecord } from '../calendar/model';
import { occurrencesOf } from '../calendar/occurrences';
import { datesInRange } from './calendarDates';
import { loadMembers } from './data';
import { loadDates } from './dateData';
import { DATE_KIND_LABEL, type DateRecord } from './dateModel';
import { DATES_ROUTE, FAMILY_BASE, memberRoute, type MemberRecord } from './model';

/** The Calendar's Pink swatch; the layer is seeded with it and the owner can recolour it. */
export const FAMILY_LAYER_COLOR = '#c4398a';

/** The title of a member's birthday marker. The same wording as the Calendar's own Birthday type (a test compares them). Name only. */
export const birthdayMarkerTitle = (name: string) => `${name}'s birthday`;

export interface BirthdaySubject { memberId: number; contactId: number; name: string; monthDay: string }

/**
 * Who has a birthday marker: active, readable members with a valid birthday, the switch not turned off, and a Contact with a name. One per Contact
 * (the oldest active record). Pure.
 */
export function birthdaySubjects(members: readonly MemberRecord[], contactNames: ReadonlyMap<number, string>): BirthdaySubject[] {
  const firstFor = new Map<number, MemberRecord>();
  for (const m of [...members].sort((a, b) => a.id - b.id)) {
    if (m.data?.status !== 'active' || firstFor.has(m.data.contactId)) continue;
    firstFor.set(m.data.contactId, m);
  }
  const out: BirthdaySubject[] = [];
  for (const m of firstFor.values()) {
    const d = m.data!;
    const name = contactNames.get(d.contactId)?.trim();
    if (!d.birthMonthDay || d.birthdayOnCalendar === false || !name) continue;
    out.push({ memberId: m.id, contactId: d.contactId, name, monthDay: d.birthMonthDay });
  }
  return out;
}

/**
 * The key of the stored Birthday event occurrence that stands for this person's birthday on `date`, or undefined. Matched by Contact id and event type
 * only. The occurrence must exist on that day (a skipped one is not an occurrence; one moved to another day is not on this day).
 */
export function storedBirthdayCover(events: readonly EventRecord[], contactId: number, date: string): string | undefined {
  for (const ev of [...events].sort((a, b) => a.id - b.id)) {
    if (ev.data.type !== 'birthday' || !ev.data.contactIds.includes(contactId)) continue;
    const occ = occurrencesOf(ev, date, date).find((o) => o.firstDay === date && o.lastDay === date);
    if (occ) return storedItemKey(ev.id, occ.key);
  }
  return undefined;
}

const status = (date: string, today: string): DerivedItem['status'] => (date >= today ? 'open' : 'handled');

/** The Calendar markers for the window. Pure apart from the `events` lookup being passed in. */
export function buildFamilyItems(
  input: { members: readonly MemberRecord[]; dates: readonly DateRecord[]; names: ReadonlyMap<number, string>; events: () => readonly EventRecord[] },
  q: Pick<DueQuery, 'from' | 'to' | 'today'>,
): DerivedItem[] {
  const out: DerivedItem[] = [];
  const subjects = birthdaySubjects(input.members, input.names);
  let events: readonly EventRecord[] | null = null; // read at most once, and only if a birthday falls in the window
  for (const s of subjects) {
    for (const date of datesInRange(s.monthDay, q.from, q.to)) {
      events ??= input.events();
      const cover = storedBirthdayCover(events, s.contactId, date);
      out.push({
        id: derivedId('family', `birthday-${s.memberId}`, date), sourceModule: 'family', sourceRecordId: `member:${s.memberId}`,
        title: birthdayMarkerTitle(s.name), date, allDay: true, priority: 'low', status: status(date, q.today), detail: 'Birthday',
        openSource: () => goTo(`${FAMILY_BASE}${memberRoute(s.memberId)}`), sourceLabel: 'Open in Family',
        icsUid: `family-birthday-${s.memberId}-${date}@ledger.local`,
        ...(cover ? { coveredBy: cover } : {}),
      });
    }
  }
  for (const r of input.dates) {
    const d = r.data;
    if (!d || d.status !== 'active' || d.onCalendar === false) continue;
    for (const date of datesInRange(d.monthDay, q.from, q.to)) {
      out.push({
        id: derivedId('family', `date-${r.id}`, date), sourceModule: 'family', sourceRecordId: `date:${r.id}`,
        title: d.label, date, allDay: true, priority: 'low', status: status(date, q.today), detail: DATE_KIND_LABEL[d.dateKind],
        openSource: () => goTo(`${FAMILY_BASE}${DATES_ROUTE}`), sourceLabel: 'Open Family dates',
        icsUid: `family-date-${r.id}-${date}@ledger.local`,
      });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}

/** Reads (never writes) the Family records, the Contact names they need and, only when a birthday falls in the window, the stored events. */
export async function familyDueItems(d: FinanceDB, q: DueQuery): Promise<DerivedItem[]> {
  const [members, dates] = await Promise.all([loadMembers(d), loadDates(d)]);
  const ids = [...new Set(members.flatMap((m) => (m.data?.status === 'active' && m.data.birthMonthDay ? [m.data.contactId] : [])))];
  const found = ids.length ? await d.contacts.bulkGet(ids) : [];
  const names = new Map<number, string>();
  found.forEach((c, i) => { if (c && isLive(c) && typeof c.name === 'string') names.set(ids[i], c.name); });
  let loaded: EventRecord[] | null = null;
  if (subjectsInWindow(members, names, q)) loaded = await loadEvents(d);
  return buildFamilyItems({ members, dates, names, events: () => loaded ?? [] }, q);
}

/** True when at least one birthday marker falls in the window (so the stored events are worth reading). */
function subjectsInWindow(members: readonly MemberRecord[], names: ReadonlyMap<number, string>, q: Pick<DueQuery, 'from' | 'to'>): boolean {
  return birthdaySubjects(members, names).some((s) => datesInRange(s.monthDay, q.from, q.to).length > 0);
}

export const familyDueProvider: DueProvider = {
  id: 'family',
  layerName: 'Family',
  color: FAMILY_LAYER_COLOR,
  getDueItems: (q) => familyDueItems(db, q),
};
