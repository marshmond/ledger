/**
 * R1.3 "Finish the loop", Household Services side. READ ONLY. When a visit Task has just been marked done, this says whether a visit can still be logged for
 * it. It works out nothing of its own: the Task and its arrangement come from the existing readers (`getTask`, `tasksOfArrangement`, `getArrangement`),
 * "is a booking reminder" from `isBooking`, and "already logged" from the existing visit list, the same test `unloggedVisits` and `planLog` use.
 * The logging itself is the existing `LogVisitDialog` ("Log this visit"), which re-checks everything and writes through `logVisitFromTask`.
 */
import { db, type FinanceDB } from '../../db';
import { createStore } from '../../core/store';
import type { TaskFollowUpOffer } from '../../core/taskFollowUp';
import { getTask } from '../tasks/data';
import { getArrangement, tasksOfArrangement } from './data';
import { MODULE, parseArrangementRef, TASK_LINK } from './model';
import { isBooking } from './schedule';
import { loadVisits } from './visits';
import { statusWords } from './visitModel';

import { SERVICES_FOLLOW_LABEL } from './followUpText';
export { SERVICES_FOLLOW_LABEL };

/** The arrangement a Task belongs to (its `about` link), or null. Several would be a data problem; the lowest id is used so the answer is stable. */
export async function arrangementOfTask(taskId: number, d: FinanceDB = db): Promise<number | null> {
  const links = await createStore(d).shared.links.linkedTo({ module: 'tasks', id: taskId });
  const ids = links
    .filter((l) => l.type === TASK_LINK && l.fromModule === 'tasks' && String(l.fromId) === String(taskId) && l.toModule === MODULE)
    .map((l) => parseArrangementRef(l.toId))
    .filter((x): x is number => x !== null);
  return ids.length ? Math.min(...ids) : null;
}

export type ServicesFollowCheck =
  | { ok: true; arrangementId: number }
  | { ok: false; reason: string; /** A visit that already covers this Task, when that is the reason. */ visitId?: number };

/** Whether a visit can still be logged for this finished Task, and if not, why in plain words. The same answer drives the button and the dialog. */
export async function checkServicesFollowUp(taskId: number, d: FinanceDB = db): Promise<ServicesFollowCheck> {
  const task = await getTask(taskId, d);
  if (!task) return { ok: false, reason: 'That task is not here any more, so there is no visit to log.' };
  if (task.data.status !== 'done') return { ok: false, reason: 'That task is not finished any more (it was reopened), so there is nothing to log yet. Nothing was changed.' };
  const arrangementId = await arrangementOfTask(taskId, d);
  if (arrangementId === null) return { ok: false, reason: 'That task is not part of a household service, so there is no visit to log.' };
  const a = await getArrangement(arrangementId, d);
  if (!a) return { ok: false, reason: 'The household service this task belongs to no longer exists, so nothing was logged.' };
  if (isBooking(task)) return { ok: false, reason: 'That was a reminder to book a visit, not a visit. Finishing it does not log anything.' };
  if (!(await tasksOfArrangement(arrangementId, d)).some((t) => t.id === taskId)) return { ok: false, reason: 'That task is not one of this service\'s visit tasks, so there is no visit to log.' };
  const already = (await loadVisits(d)).find((v) => v.data.taskId === taskId);
  if (already) return { ok: false, reason: `This visit was already logged (${statusWords(already.data).toLowerCase()}${already.data.date ? `, ${already.data.date}` : ''}). Nothing new was saved.`, visitId: already.id };
  return { ok: true, arrangementId };
}

/** The offer for the "Done" message, or null (an ordinary task, a booking reminder, a visit already logged, a service that is gone). */
export async function readServicesFollowUp(taskId: number): Promise<TaskFollowUpOffer | null> {
  return (await checkServicesFollowUp(taskId)).ok ? { label: SERVICES_FOLLOW_LABEL } : null;
}
