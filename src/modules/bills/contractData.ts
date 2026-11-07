/**
 * Saving a bill's CONTRACT DATES and REMINDER SETTINGS (B2). Each is a guarded edit of the obligation record in one transaction: it refuses if the
 * record changed since the form opened, keeps every unknown field, keeps the bill's Tasks in step (making a deadline or pay Task when the owner
 * has asked for one), and returns a guarded Undo.
 *
 * A date is only a date. Nothing renews, cancels, reprices, posts or extends because one passes.
 */
import { db, type FinanceDB } from '../../db';
import { applyEdit, asObligation, KIND, MODULE, toStored, validateObligation, withLog, type ObligationRecord, type Reminders } from './model';
import { isLive, repo } from '../../core/store';
import type { ModuleRecord } from '../../core/entities';
import { ensureBillTasksIn } from './tasks';
import { termsProblem, toStoredTerms, type Terms } from './terms';
import { Recorder, type Undo } from './undo';
import { cycleTables } from './cycleData';

const STALE = 'This record was changed (maybe on another device) since you opened it. Close this, look again and redo your change. Nothing was changed.';

async function load(id: number, d: FinanceDB): Promise<ObligationRecord> {
  const r = await d.moduleRecords.get(id);
  if (!r || r.module !== MODULE || r.kind !== KIND || !isLive(r)) throw new Error('That bill no longer exists. Nothing was changed.');
  return asObligation(r);
}

async function writeWithTasks(id: number, expect: number | null, today: string, d: FinanceDB, change: (cur: ObligationRecord) => ReturnType<typeof applyEdit>): Promise<{ undo: Undo; createdTasks: number[] }> {
  const cur = await load(id, d);
  if (expect !== null && cur.updatedAt !== expect) throw new Error(STALE);
  const next = change(cur);
  const problem = validateObligation(next);
  if (problem) throw new Error(problem);
  const rec = new Recorder();
  await rec.capture(id, d);
  await repo<ModuleRecord>(d.moduleRecords).put({ id, module: MODULE, kind: KIND, data: toStored(next) });
  const ens = await ensureBillTasksIn(id, today, d, rec);
  return { undo: await rec.seal(d), createdTasks: ens.created };
}

/** "Update reminders": brings the bill's Tasks in step with its state right now (removes untouched Bills-made Tasks of a paused or ended bill that stand for something no longer expected; makes the one reminder an active bill is missing). Never touches a Task the owner changed or finished. Guarded Undo. */
export function tidyReminders(id: number, today: string, d: FinanceDB = db): Promise<{ undo: Undo; retired: number; created: number }> {
  return d.transaction('rw', ...cycleTables(d), async () => {
    await load(id, d);
    const rec = new Recorder();
    const r = await ensureBillTasksIn(id, today, d, rec);
    return { undo: await rec.seal(d), retired: r.retired.length, created: r.created.length };
  });
}

/** Saves renewal, notice-by, trial-end and "renews by itself". */
export function saveTerms(id: number, terms: Terms, expectUpdatedAt: number | null, today: string, d: FinanceDB = db): Promise<{ undo: Undo; createdTasks: number[] }> {
  return d.transaction('rw', ...cycleTables(d), async () => {
    const bad = termsProblem(terms);
    if (bad) throw new Error(bad);
    return writeWithTasks(id, expectUpdatedAt, today, d, (cur) => withLog(applyEdit(cur.data, { terms: toStoredTerms(terms) }), today, 'contract dates changed'));
  });
}

/** Saves the reminder settings (pay Task on or off, how many days before, deadline Tasks on or off). */
export function saveReminders(id: number, reminders: { payTask: boolean; leadDays: number; deadlineTasks: boolean }, expectUpdatedAt: number | null, today: string, d: FinanceDB = db): Promise<{ undo: Undo; createdTasks: number[] }> {
  return d.transaction('rw', ...cycleTables(d), async () => {
    if (!Number.isInteger(reminders.leadDays) || reminders.leadDays < 0 || reminders.leadDays > 60) throw new Error('Pick between 0 and 60 days before the due date.');
    const next: Reminders = { payTask: reminders.payTask, leadDays: reminders.leadDays };
    return writeWithTasks(id, expectUpdatedAt, today, d, (cur) => applyEdit(cur.data, { reminders: next, noDeadlineTasks: !reminders.deadlineTasks }));
  });
}
