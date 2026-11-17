/** CS-1: what the editors need to tell the owner about one event or Task. Reads only the decisions, that item and its calendar (small on purpose: the editors load this, not the whole preview builder). */
import type { FinanceDB } from '../db';
import { isLive } from '../core/store';
import { asEvent, asLayer, MODULE as CAL } from '../modules/calendar/model';
import { asTask, MODULE as TASKS } from '../modules/tasks/model';
import { taskRootId } from '../modules/tasks/chain';
import { effectiveForEvent, effectiveForTask, resolveGrants, subjectOf, type Effective, type SubjectState } from './grants';
import { loadGrantRows } from './grantStore';
import { eventRejection, taskRejection, type Rejection } from './eligibility';
import { linkModules } from './linkModules';

/** What the owner sees for one event in the editor: the effective choice, why, and whether the event can be shown at all. Reads only the grants, this event and its calendar. */
export async function eventDisplayStatus(d: FinanceDB, eventId: number, calendarId: number): Promise<{ eff: Effective; own: SubjectState; calendarShared: boolean; calendarName: string; rejection: Rejection | null; killed: boolean }> {
  const [rows, layer, evRow, linked] = await Promise.all([loadGrantRows(d), d.moduleRecords.get(calendarId), d.moduleRecords.get(eventId), linkModules(d, CAL)]);
  const g = resolveGrants(rows);
  const l = layer && layer.module === CAL && layer.kind === 'calendar' && isLive(layer) ? asLayer(layer) : undefined;
  const eff = effectiveForEvent({ ...g, killed: false }, eventId, calendarId, l ? l.sourceType === 'local' : false);
  const cal = g.get(subjectOf('calendar', calendarId));
  const ev = evRow && evRow.module === CAL && evRow.kind === 'event' && isLive(evRow) ? asEvent(evRow) : undefined;
  const rejection = ev ? eventRejection({ type: ev.data.type, retired: !!ev.data.retired, projectId: ev.data.projectId, linkedModules: linked.get(eventId) ?? [], calendarSource: l?.sourceType }) : null;
  return { eff, own: g.get(subjectOf('event', eventId)), calendarShared: cal.state === 'show' && !!l && l.sourceType === 'local', calendarName: l?.name ?? 'Calendar', rejection, killed: g.killed };
}

/** The same for a Task: which series decision applies (the root of its repeat chain), and whether it can be shown. */
export async function taskDisplayStatus(d: FinanceDB, taskId: number): Promise<{ rootId: number | null; eff: Effective; own: SubjectState; rejection: Rejection | null; killed: boolean }> {
  const [rows, taskRows, linked] = await Promise.all([loadGrantRows(d), d.moduleRecords.where('[module+kind]').equals([TASKS, 'task']).toArray(), linkModules(d, TASKS)]);
  const g = resolveGrants(rows);
  const all = taskRows.map((r) => asTask(r));
  const chain = new Map(all.map((t) => [t.id, { id: t.id, recurFrom: t.data.recurFrom }]));
  const rootId = taskRootId(taskId, chain);
  const t = all.find((x) => x.id === taskId);
  const eff = effectiveForTask({ ...g, killed: false }, rootId);
  return { rootId, eff, own: rootId === null ? g.get('task:0') : g.get(subjectOf('task', rootId)), rejection: t ? taskRejection({ createdFromModule: t.data.createdFrom?.module, linkedModules: linked.get(taskId) ?? [] }) : null, killed: g.killed };
}
