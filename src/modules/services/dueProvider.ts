/**
 * The Household Services due provider: a read-only Calendar layer "Household Services" worked out when the Calendar draws. Nothing is stored, copied or
 * written, and no Task, Event or reminder is made.
 *
 * Two kinds of marker (S4):
 *  1. CONTRACT DATES: each renewal date and notice-by date ("Renewal: House cleaning", "Notice deadline: House cleaning"). One marker per date; an ended
 *     arrangement shows none (its dates stay on its page); a paused one still does; past dates are `handled`. The text is the arrangement title only.
 *  2. EXPECTED VISITS (S4 correction 1): the arrangement's standing schedule across a rolling 12-month horizon (see `plannedVisits.ts` for the exact
 *     convention and why it starts after the open visit Task). Read only; only for active arrangements; never marked done; the single open visit Task is
 *     still the one actionable next visit and is shown by the Tasks layer, not here.
 *
 * Ids are stable: `services:<renewal|notice|visit>-<arrangement>:<date>`. The three kinds can never collide, so a renewal, a notice and a visit on the
 * same day are three separate entries. The title is the arrangement's title (visits: the same wording as the visit Task, with the provider's name);
 * never a phone, email, note, link, account number or amount.
 */
import { db, type FinanceDB } from '../../db';
import { derivedId, goTo, type DerivedItem, type DueProvider, type DueQuery } from '../../core/dueProvider';
import { isLive } from '../../core/store';
import { loadTasks } from '../tasks/data';
import type { TaskRecord } from '../tasks/model';
import { contractDeadlines, DEADLINE_LABEL, deadlineKey, deadlineMeaning } from './contract';
import { loadArrangements, visitTaskTitle } from './data';
import { scheduleStateOf } from './expectedCharges';
import { arrangementRefId, MODULE, parseArrangementRef, TASK_LINK } from './model';
import { plannedVisitDates, plannedVisitKey } from './plannedVisits';
import { arrangementPath } from './records';
import { isBooking } from './schedule';

export const SERVICES_LAYER_COLOR = '#2f7f9a';

/** The live visit Tasks of each arrangement (booking reminders left out), read with one pass over the links. */
async function visitTasksBy(d: FinanceDB, wanted: Set<number>): Promise<Map<number, TaskRecord[]>> {
  const out = new Map<number, TaskRecord[]>();
  if (wanted.size === 0) return out;
  const [tasks, links] = await Promise.all([loadTasks(d), d.links.toArray()]);
  const byId = new Map(tasks.map((t) => [t.id, t]));
  for (const l of links) {
    if (!isLive(l) || l.type !== TASK_LINK || l.fromModule !== 'tasks' || l.toModule !== MODULE) continue;
    const arr = parseArrangementRef(l.toId);
    const t = byId.get(Number(l.fromId));
    if (arr === null || !wanted.has(arr) || !t || isBooking(t)) continue;
    const list = out.get(arr) ?? [];
    if (!list.some((x) => x.id === t.id)) list.push(t);
    out.set(arr, list);
  }
  return out;
}

export async function servicesDueItems(d: FinanceDB, q: DueQuery): Promise<DerivedItem[]> {
  const arrangements = await loadArrangements(d);
  const contract = contractDeadlines(arrangements)
    .filter((x) => x.date >= q.from && x.date <= q.to)
    .map<DerivedItem>((x) => ({
      id: derivedId('services', deadlineKey(x.kind, x.arrangementId), x.date), sourceModule: 'services', sourceRecordId: arrangementRefId(x.arrangementId),
      title: `${DEADLINE_LABEL[x.kind]}: ${x.title}`, date: x.date, allDay: true, priority: x.kind === 'notice' ? 'medium' : 'low', status: x.date >= q.today ? 'open' : 'handled',
      detail: deadlineMeaning(x.kind), openSource: () => goTo(arrangementPath(x.arrangementId)), sourceLabel: 'Open arrangement',
    }));

  // expected visits: only arrangements that are active with a fixed schedule, and only when the range reaches into today..horizon
  const live = arrangements.filter((a) => a.data.status === 'active' && a.data.cadence?.mode === 'fixed');
  const tasksBy = await visitTasksBy(d, new Set(live.map((a) => a.id)));
  const visits: DerivedItem[] = [];
  for (const a of live) {
    const dates = plannedVisitDates(a, scheduleStateOf(tasksBy.get(a.id) ?? []), q.today, q.from, q.to);
    for (const date of dates) {
      visits.push({
        id: derivedId('services', plannedVisitKey(a.id), date), sourceModule: 'services', sourceRecordId: arrangementRefId(a.id),
        title: visitTaskTitle(a.data), date, allDay: !a.data.visitTime, ...(a.data.visitTime ? { time: a.data.visitTime } : {}), priority: 'low', status: 'open',
        detail: 'An expected visit from the arrangement\'s schedule. It is not a task: the next visit becomes a task when the one before it is logged. Nothing here marks a visit done.',
        openSource: () => goTo(arrangementPath(a.id)), sourceLabel: 'Open arrangement',
      });
    }
  }
  return [...contract, ...visits].sort((x, y) => x.date.localeCompare(y.date) || x.title.localeCompare(y.title) || x.id.localeCompare(y.id));
}

export const servicesDueProvider: DueProvider = {
  id: 'services',
  layerName: 'Household Services',
  color: SERVICES_LAYER_COLOR,
  getDueItems: (q) => servicesDueItems(db, q),
};
