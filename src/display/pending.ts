/**
 * CS-1 final correction: a family-display choice made in an editor is a PENDING form change. It is written only when the editor's Save succeeds, inside
 * the SAME transaction as the save, and attached to the saved record's own identity (the event id that now holds the occurrence, including the NEW
 * id of a "this and following" split, or the root of a Task's repeat chain). Cancel and closing write nothing. A choice that would not change what is
 * effectively shown writes nothing either. The model stays append-only: this only calls `appendInTransaction`.
 * Every function must be called inside a transaction that includes `moduleRecords`.
 */
import type { FinanceDB } from '../db';
import { isLive } from '../core/store';
import { asEvent, asLayer, MODULE as CAL } from '../modules/calendar/model';
import { asTask, MODULE as TASKS } from '../modules/tasks/model';
import { taskRootId } from '../modules/tasks/chain';
import { effectiveForEvent, effectiveForTask, resolveGrants, subjectOf } from './grants';
import { appendInTransaction, loadGrantRows } from './grantStore';

export type DisplayChoice = 'hide' | 'show' | 'busy';
const TARGET = { hide: 'hidden', show: 'details', busy: 'busy' } as const;

/** Applies a pending choice to a SAVED event. Returns true if a decision was written. */
export async function applyEventChoice(d: FinanceDB, eventId: number, choice: DisplayChoice | null | undefined): Promise<boolean> {
  if (!choice) return false;
  const row = await d.moduleRecords.get(eventId);
  if (!row || row.module !== CAL || row.kind !== 'event' || !isLive(row)) return false;
  const ev = asEvent(row);
  const layerRow = await d.moduleRecords.get(ev.data.calendarId);
  const layer = layerRow && layerRow.module === CAL && layerRow.kind === 'calendar' && isLive(layerRow) ? asLayer(layerRow) : undefined;
  const g = resolveGrants(await loadGrantRows(d));
  const eff = effectiveForEvent({ ...g, killed: false }, eventId, ev.data.calendarId, layer ? layer.sourceType === 'local' : false);
  if (eff.show === TARGET[choice] && !eff.conflict) return false;
  await appendInTransaction({ subject: subjectOf('event', eventId), decision: choice === 'hide' ? 'hide' : 'show', level: choice === 'busy' ? 'busy' : undefined, titleAtGrant: choice === 'hide' ? undefined : ev.data.title }, d);
  return true;
}

/** Applies a pending choice to a SAVED Task: the decision goes on the root of its repeat chain. A task whose chain is ambiguous is left alone. */
export async function applyTaskChoice(d: FinanceDB, taskId: number, choice: DisplayChoice | null | undefined): Promise<boolean> {
  if (!choice || choice === 'busy') return false;
  const all = (await d.moduleRecords.where('[module+kind]').equals([TASKS, 'task']).toArray()).map(asTask);
  const root = taskRootId(taskId, new Map(all.map((t) => [t.id, { id: t.id, recurFrom: t.data.recurFrom }])));
  const task = all.find((t) => t.id === taskId);
  if (root === null || !task) return false;
  const g = resolveGrants(await loadGrantRows(d));
  const eff = effectiveForTask({ ...g, killed: false }, root);
  if (eff.show === TARGET[choice] && !eff.conflict) return false;
  await appendInTransaction({ subject: subjectOf('task', root), decision: choice, titleAtGrant: choice === 'hide' ? undefined : task.data.title }, d);
  return true;
}
