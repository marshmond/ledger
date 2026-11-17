/**
 * CS-1: what the Family module lets a shared family display see. READ-ONLY and narrow on purpose (the types are in `core/displaySources.ts`).
 *
 * Returned, and nothing else: for each active household person an id, the Contact's NAME, a semantic color id and a coarse group
 * (adult, child, other: the role WORD is never returned); for each birthday only the dates it falls on in the window; for each important date only
 * its short name and those dates. Never: a birth year, an age, a member note, a role word, a phone, an email, an anniversary's start year, or a
 * Contact that is not a household member. Whether any of it is actually SHOWN is decided elsewhere (`src/display/grants.ts`); this file only reads.
 * The dates come from Family's own rule for 29 February (`calendarDates.ts`), so the display agrees with the Calendar layer.
 */
import type { FinanceDB } from '../../db';
import { isLive } from '../../core/store';
import { loadHouseholdPeople } from '../../core/householdPeople';
import { registerFamilyDisplayReader, type DisplayFamily, type DisplayGroup } from '../../core/displaySources';
import { datesInRange } from './calendarDates';
import { asDate, DATE_KIND } from './dateModel';
import { asMember, KIND, MODULE } from './model';

const GROUP_OF_ROLE: Record<string, DisplayGroup> = { parent: 'adult', spouse: 'adult', grandparent: 'adult', child: 'child', other: 'other' };

export async function readDisplayFamily(d: FinanceDB, from: string, to: string): Promise<DisplayFamily> {
  const [people, memberRows, dateRows] = await Promise.all([
    loadHouseholdPeople(d),
    d.moduleRecords.where('[module+kind]').equals([MODULE, KIND]).toArray(),
    d.moduleRecords.where('[module+kind]').equals([MODULE, DATE_KIND]).toArray(),
  ]);
  const members = new Map(memberRows.filter(isLive).map((r) => [r.id as number, asMember(r)]));
  const out: DisplayFamily = { people: [], birthdays: [], dates: [] };
  for (const p of people) {
    const m = members.get(p.memberId)?.data;
    if (!m) continue;
    out.people.push({ memberId: p.memberId, contactId: p.contactId, name: p.name, colorId: p.colorId, group: GROUP_OF_ROLE[m.role] ?? 'other' });
    if (m.birthMonthDay) out.birthdays.push({ memberId: p.memberId, dates: datesInRange(m.birthMonthDay, from, to) });
  }
  const active = new Set(out.people.map((p) => p.memberId));
  for (const r of dateRows.filter(isLive)) {
    const x = asDate(r).data;
    if (!x || x.status !== 'active') continue;
    out.dates.push({ id: r.id as number, label: x.label, memberId: x.memberId !== undefined && active.has(x.memberId) ? x.memberId : null, dates: datesInRange(x.monthDay, from, to) });
  }
  out.dates.sort((a, b) => a.id - b.id);
  return out;
}

registerFamilyDisplayReader(readDisplayFamily);
