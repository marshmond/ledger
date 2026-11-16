/**
 * Family for the weekly review (R1.2). READ ONLY. Everything comes from F4's own `readHouseholdOverview` (the reader the Family household page uses): activities are
 * already today + 6 days, dates (30 days there) are cut here to the same seven. Names and colors are the member's own; a color travels as the semantic color id,
 * never as a stored value. No birth year, age, note or contact detail is passed on (the household overview carries none).
 */
import { addDays } from '../../lib/dates';
import { todayISO } from '../../lib/money';
import type { WeekFamily, WeekPerson } from '../../core/weekReaders';
import { readVisibility } from '../calendar/useCalendarData';
import { DATE_KIND_LABEL } from './dateModel';
import { readHouseholdOverview, type HouseholdOverview, type PersonRef } from './householdOverview';
import { memberColorId } from './memberIdentity';
import { calendarLink, scheduleWhen } from './memberSchedule';
import { DATES_ROUTE, FAMILY_BASE, memberRoute } from './model';

const person = (p: PersonRef): WeekPerson => ({ memberId: p.memberId, name: p.name, colorId: memberColorId(p.color), href: `#${FAMILY_BASE}${memberRoute(p.memberId)}` });

export function weekFamilyOf(o: HouseholdOverview, today: string): WeekFamily {
  const to = addDays(today, 6);
  return {
    dates: o.dates.filter((d) => d.date >= today && d.date <= to).map((d) => ({
      key: d.key, date: d.date, title: d.title, kind: d.type === 'birthday' ? 'Birthday' : DATE_KIND_LABEL[d.type],
      href: `#${FAMILY_BASE}${d.person ? memberRoute(d.person.memberId) : DATES_ROUTE}`, person: d.person ? person(d.person) : null,
    })),
    activities: o.activities.items.map((a) => ({
      key: a.key, openKey: a.openKey, title: a.title, firstDay: a.firstDay, when: scheduleWhen(a).split(' · ').slice(1).join(' · ') || 'All day',
      calendarName: a.calendarName, href: calendarLink(a), people: a.people.map(person),
    })),
    hiddenActivities: o.activities.hidden.length,
  };
}

export async function readWeekFamily(today: string = todayISO()): Promise<WeekFamily> {
  return weekFamilyOf(await readHouseholdOverview(today, readVisibility()), today);
}
