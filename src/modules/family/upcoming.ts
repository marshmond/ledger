/**
 * Family Management F2: the list on the Family dates page. PURE. It lists member birthdays (read from the member profiles, never copied) beside the
 * important-date records, each with the date it next falls on, so the owner sees everything in one order and whether it is on their Calendar.
 * Titles carry a name or label only: no birth year, no age, no note (a test checks the whole serialised list).
 */
import { datesInRange, nextOccurrence } from './calendarDates';
import { birthdaySubjects } from './dueProvider';
import type { DateKind, DateRecord } from './dateModel';
import type { MemberRecord } from './model';

export interface UpcomingRow {
  /** Stable list key. */
  key: string;
  type: 'birthday' | DateKind;
  title: string;
  /** The next date it falls on, `YYYY-MM-DD`. */
  date: string;
  /** Birthday rows: the member's record id. Date rows: the date record's id. */
  memberId?: number;
  recordId?: number;
  /** Whether the owner's Calendar shows it. */
  onCalendar: boolean;
}

/**
 * Birthdays of active members who have one (shown here even when the member's Calendar switch is off, marked as off) and active dates, soonest first.
 * `names` maps a Contact id to its name; a member whose Contact is missing is left out.
 */
export function upcomingRows(members: readonly MemberRecord[], dates: readonly DateRecord[], names: ReadonlyMap<number, string>, today: string): UpcomingRow[] {
  const rows: UpcomingRow[] = [];
  // Ask for the birthdays as if every switch were on, then mark the ones that are off, so the list can still show them.
  const everyBirthday = members.map((m) => (m.data && m.data.birthdayOnCalendar === false ? { ...m, data: { ...m.data, birthdayOnCalendar: undefined } } : m));
  const isOff = new Map(members.map((m) => [m.id, m.data?.birthdayOnCalendar === false]));
  for (const s of birthdaySubjects(everyBirthday, names)) {
    const date = nextOccurrence(s.monthDay, today);
    if (!date) continue;
    rows.push({ key: `b${s.memberId}`, type: 'birthday', title: `${s.name}'s birthday`, date, memberId: s.memberId, onCalendar: !isOff.get(s.memberId) });
  }
  for (const r of dates) {
    const d = r.data;
    if (!d || d.status !== 'active') continue;
    const date = nextOccurrence(d.monthDay, today);
    if (!date) continue;
    rows.push({ key: `d${r.id}`, type: d.dateKind, title: d.label, date, recordId: r.id, onCalendar: d.onCalendar !== false });
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title) || a.key.localeCompare(b.key));
}

/**
 * R4.2: the same birthdays and important dates as `upcomingRows`, but for an exact window (`from` to `to`, both inclusive) instead of "the next one after today", so
 * the Family Week can show any week. A date that falls twice in a very long window is listed twice. Same rules as the Calendar's Family layer (`datesInRange`,
 * leap day on 28 February). Birthdays of members whose Calendar switch is off are listed and marked, exactly as `upcomingRows` does.
 */
export function datesInWindow(members: readonly MemberRecord[], dates: readonly DateRecord[], names: ReadonlyMap<number, string>, from: string, to: string): UpcomingRow[] {
  const rows: UpcomingRow[] = [];
  const everyBirthday = members.map((m) => (m.data && m.data.birthdayOnCalendar === false ? { ...m, data: { ...m.data, birthdayOnCalendar: undefined } } : m));
  const isOff = new Map(members.map((m) => [m.id, m.data?.birthdayOnCalendar === false]));
  for (const s of birthdaySubjects(everyBirthday, names)) {
    for (const date of datesInRange(s.monthDay, from, to)) rows.push({ key: `b${s.memberId}:${date}`, type: 'birthday', title: `${s.name}'s birthday`, date, memberId: s.memberId, onCalendar: !isOff.get(s.memberId) });
  }
  for (const r of dates) {
    const d = r.data;
    if (!d || d.status !== 'active') continue;
    for (const date of datesInRange(d.monthDay, from, to)) rows.push({ key: `d${r.id}:${date}`, type: d.dateKind, title: d.label, date, recordId: r.id, onCalendar: d.onCalendar !== false });
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title) || a.key.localeCompare(b.key));
}
