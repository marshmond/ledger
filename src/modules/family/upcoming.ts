/**
 * Family Management F2: the list on the Family dates page. PURE. It lists member birthdays (read from the member profiles, never copied) beside the
 * important-date records, each with the date it next falls on, so the owner sees everything in one order and whether it is on their Calendar.
 * Titles carry a name or label only: no birth year, no age, no note (a test checks the whole serialised list).
 */
import { nextOccurrence } from './calendarDates';
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
