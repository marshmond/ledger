/**
 * CS-1: the schedule-only reader that lets a shared family display show a household-service VISIT without exposing the arrangement.
 *
 * It returns, for each arrangement it is asked about, ONLY `{ date, time }` pairs: when the next visits are, worked out with this module's own rules
 * (the one open visit Task is the next visit, and `plannedVisitDates` supplies the standing schedule after it). It returns no title, provider,
 * price, agreement or notice date, payment, note, link or contact. The text on the display is a label the owner types on the family-display
 * decision, never anything this module wrote. Only ACTIVE arrangements have visits; a paused or ended one returns an empty list.
 * It reads nothing for an arrangement it was not asked about.
 */
import type { FinanceDB } from '../../db';
import { isLive } from '../../core/store';
import { visitTasksBy } from './dueProvider';
import { scheduleStateOf } from './expectedCharges';
import { asArrangement, KIND, MODULE } from './model';
import { plannedVisitDates } from './plannedVisits';

export interface DisplayVisit { date: string; time: string | null }

/** For each requested arrangement id, its upcoming visits inside `from..to`. A missing or inactive arrangement has an empty list. */
export async function readDisplayVisits(d: FinanceDB, ids: readonly number[], today: string, from: string, to: string): Promise<Map<number, DisplayVisit[]>> {
  const out = new Map<number, DisplayVisit[]>();
  if (ids.length === 0) return out;
  // Only this module's own arrangement rows are looked at (a decision that names some other module's record number reads nothing of it).
  const wanted = new Set(ids);
  const records = (await d.moduleRecords.where('[module+kind]').equals([MODULE, KIND]).filter((r) => wanted.has(r.id as number)).toArray()).filter(isLive).map(asArrangement);
  const active = records.filter((a) => a.data.status === 'active');
  const tasks = await visitTasksBy(d, new Set(active.map((a) => a.id)));
  for (const id of ids) out.set(id, []);
  for (const a of active) {
    const visitTasks = tasks.get(a.id) ?? [];
    const state = scheduleStateOf(visitTasks);
    const open = visitTasks.filter((t) => t.data.status !== 'done').sort((x, y) => (x.data.dueDate ?? '9999').localeCompare(y.data.dueDate ?? '9999') || x.id - y.id)[0];
    const when = new Map<string, string | null>();
    if (open?.data.dueDate && open.data.dueDate >= from && open.data.dueDate <= to) when.set(open.data.dueDate, open.data.dueTime ?? a.data.visitTime);
    for (const date of plannedVisitDates(a, state, today, from, to)) if (!when.has(date)) when.set(date, a.data.visitTime);
    out.set(a.id, [...when.entries()].map(([date, time]) => ({ date, time })).sort((x, y) => x.date.localeCompare(y.date)));
  }
  return out;
}
