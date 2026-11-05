/**
 * Pure rules for what each Today card lists. Everything comes from one aggregation (the Calendar's data hook): events, plus whatever the
 * due providers report, already expanded into items. These functions only sort and slice that list, so they are easy to test.
 */
import { addDays } from '../../lib/dates';
import type { CalItem } from '../calendar/useCalendarData';
import { sortItems } from '../calendar/useCalendarData';

/** Things happening today (including multi-day items in progress), all-day first, then by time. Overdue leftovers are NOT in here. */
export function todayList(items: CalItem[], today: string): CalItem[] {
  return items
    .filter((i) => i.firstDay <= today && i.lastDay >= today && !(i.overdue && i.lastDay < today))
    .sort(sortItems);
}

export interface OverdueGroup {
  /** `calendar` for your own events, otherwise the providing module's id (`ledger`, `tasks`). */
  moduleId: string;
  items: CalItem[];
}

export const moduleOf = (i: CalItem): string => (i.derived ? i.source?.sourceModule ?? 'other' : 'calendar');

/** Open items that ended before today but not longer ago than `overdueDays`, oldest first, grouped by module in first-seen order. */
export function overdueGroups(items: CalItem[], today: string, overdueDays: number): OverdueGroup[] {
  const oldest = addDays(today, -Math.max(0, overdueDays));
  const late = items
    .filter((i) => i.overdue && !i.done && i.lastDay < today && i.firstDay >= oldest)
    .sort((a, b) => a.firstDay.localeCompare(b.firstDay) || sortItems(a, b));
  const groups: OverdueGroup[] = [];
  for (const i of late) {
    const id = moduleOf(i);
    const g = groups.find((x) => x.moduleId === id);
    if (g) g.items.push(i); else groups.push({ moduleId: id, items: [i] });
  }
  return groups;
}

/** The first `max` overdue items across the groups, in order, plus how many each module has beyond that. */
export function limitOverdue(groups: OverdueGroup[], max: number): { shown: OverdueGroup[]; more: { moduleId: string; count: number }[] } {
  let left = Math.max(0, max);
  const shown: OverdueGroup[] = [];
  const more: { moduleId: string; count: number }[] = [];
  for (const g of groups) {
    const take = g.items.slice(0, left);
    left -= take.length;
    if (take.length > 0) shown.push({ ...g, items: take });
    if (g.items.length > take.length) more.push({ moduleId: g.moduleId, count: g.items.length - take.length });
  }
  return { shown, more };
}

/** Where to see every overdue item of a module (a full address such as `/tasks?v=overdue`). */
export function overdueMorePath(moduleId: string, today: string, overdueDays: number): string {
  if (moduleId === 'tasks') return '/tasks?v=overdue';
  if (moduleId === 'ledger') return '/ledger/scheduled';
  if (moduleId === 'calendar') return `/calendar?v=agenda&d=${addDays(today, -Math.max(0, overdueDays))}`;
  return `/${moduleId}`;
}

export interface UpcomingDay {
  date: string;
  items: CalItem[];
}

/** The next `days` days after today, grouped by the day each item starts. Empty days are left out. */
export function upcomingDays(items: CalItem[], today: string, days: number): UpcomingDay[] {
  const last = addDays(today, Math.max(0, days));
  const byDay = new Map<string, CalItem[]>();
  for (const i of items) {
    if (i.firstDay <= today || i.firstDay > last || i.done) continue;
    byDay.set(i.firstDay, [...(byDay.get(i.firstDay) ?? []), i]);
  }
  return [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, list]) => ({ date, items: list.sort(sortItems) }));
}

/** Items whose reminder time has passed and have not started yet ("Due soon"), soonest first. */
export function reminderItems(items: CalItem[]): CalItem[] {
  return items.filter((i) => i.soon && !i.done).sort(sortItems);
}

/** Hides money in text for the "Hide amounts" switch: "$1,234.56", "-$80", "$5" all become "$••••". */
export function maskAmounts(text: string): string {
  return text.replace(/-?\$\s?\d[\d,]*(?:\.\d+)?/g, '$••••');
}

/** "Tomorrow", or "Fri, Nov 7" for the day heading in the coming-up list. */
export function dayHeading(date: string, today: string, label: (d: string) => string): string {
  return date === addDays(today, 1) ? 'Tomorrow' : label(date);
}
