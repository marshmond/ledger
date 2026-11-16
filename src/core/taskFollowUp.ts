/**
 * R1.3 "Finish the loop": after a Task is marked done, offer the next useful step when the Task stands for work that can be recorded elsewhere.
 *
 * Three different things stay three different things:
 *   - Task done      = the reminder was completed. This file never changes it, and never treats it as proof that work happened.
 *   - Visit logged   = Household Services recorded that a visit really took place (and its outcome).
 *   - History saved  = Home & Assets recorded that work was done on an asset.
 * This file writes NOTHING. It only (1) asks the modules whether a finished Task has something left to log and (2) opens that module's OWN
 * existing dialog, in place. Saving still happens only when the person presses the dialog's own button, through the module's own function.
 *
 * Boundaries: Tasks, Today and the Calendar never import Household Services or Home & Assets. Each module offers one `contributes.taskFollowUp`
 * hook (a small reader plus a lazily loaded dialog), exactly like `attention` and `weekReview`. Nothing here is stored, synced or backed up.
 */
import type { ComponentType } from 'react';
import { db, type FinanceDB } from '../db';
import { allTaskFollowUps } from './registry';
import { createStore } from './store';

/** Set when several finished Tasks are being logged one after another (a bulk completion, or "Log selected one at a time" on an overview). */
export interface FollowUpQueue { position: number; total: number; onSkip(): void }

/**
 * What a module's follow-up dialog receives. It must work out for itself whether the offer still stands (the Task may have been reopened or logged since).
 * `subject` is the record in the module this particular offer is about when the Task could be about several (an asset id); the module may ignore it.
 * `onSaved` is called once, just before `onClose`, only when the work was really saved (never when the dialog was cancelled).
 */
export interface TaskFollowUpDialogProps { taskId: number; subject?: number; onClose(): void; onSaved?(): void; queue?: FollowUpQueue }

/** What a module says about a finished Task that it can log. `label` is the button text, in plain words ("Log completed visit"). */
export interface TaskFollowUpOffer { label: string }

export interface TaskFollowUpSource {
  /**
   * Read-only. Called only for a Task that is linked to a record of this module, AFTER the Task was marked done. Returns an offer, or null when there is
   * nothing to log (an ordinary task, a "book it" reminder, work that is already logged, a record that is gone). Must call the module's existing readers.
   */
  read(taskId: number): Promise<TaskFollowUpOffer | null>;
  /** The module's EXISTING logging dialog behind a thin wrapper, loaded on demand so the module's screens stay out of the first download. */
  Dialog: () => Promise<{ default: ComponentType<TaskFollowUpDialogProps> }>;
}

export interface ResolvedFollowUp { moduleId: string; taskId: number; label: string; subject?: number }

const TASKS = 'tasks';

/** The modules a Task is linked to (a record of that module is on the other end of one of the Task's links). */
async function linkedModules(taskId: number, d: FinanceDB): Promise<Set<string>> {
  const links = await createStore(d).shared.links.linkedTo({ module: TASKS, id: taskId });
  const out = new Set<string>();
  for (const l of links) {
    if (l.fromModule === TASKS && String(l.fromId) === String(taskId)) out.add(l.toModule);
    else if (l.toModule === TASKS && String(l.toId) === String(taskId)) out.add(l.fromModule);
  }
  out.delete(TASKS);
  return out;
}

/**
 * The follow-up for a Task that has just been finished, or null. A Task with no link to a module that offers one is answered from the Task's own links
 * alone, so finishing an ordinary task loads no module code. A module that throws is treated as "nothing to offer": finishing a Task must never fail
 * or slow down because of this. When two modules both offer, the first in module order wins (only one button is shown).
 */
export async function resolveTaskFollowUp(taskId: number, d: FinanceDB = db, sources: { moduleId: string; source: TaskFollowUpSource }[] = allTaskFollowUps()): Promise<ResolvedFollowUp | null> {
  if (sources.length === 0) return null;
  let linked: Set<string>;
  try { linked = await linkedModules(taskId, d); } catch { return null; }
  for (const s of sources) {
    if (!linked.has(s.moduleId)) continue;
    try {
      const offer = await s.source.read(taskId);
      if (offer) return { moduleId: s.moduleId, taskId, label: offer.label };
    } catch { /* a module that cannot answer offers nothing */ }
  }
  return null;
}

// ---- opening the dialog in place ----

const EVENT = 'ledger-task-followup';

/**
 * Asks the app-wide host (mounted once in the shell) to open the module's own logging dialog for this Task, or for each of several Tasks in turn. With several,
 * every dialog says "N of M", has "Skip this one", and saves only when its own button is pressed: nothing is ever saved for the group as a whole.
 */
export function openTaskFollowUp(f: ResolvedFollowUp | ResolvedFollowUp[]): void {
  const items = Array.isArray(f) ? f : [f];
  if (items.length > 0 && typeof window !== 'undefined') window.dispatchEvent(new CustomEvent<ResolvedFollowUp[]>(EVENT, { detail: items }));
}
export function onTaskFollowUp(fn: (items: ResolvedFollowUp[]) => void): () => void {
  const h = (e: Event) => { const items = (e as CustomEvent<ResolvedFollowUp[]>).detail; if (items?.length) fn(items); };
  window.addEventListener(EVENT, h);
  return () => window.removeEventListener(EVENT, h);
}

// ---- walking through several offers, one dialog at a time (pure, so the rules are tested) ----

export interface FollowUpRun { items: ResolvedFollowUp[]; i: number }

/**
 * Moves on from dialog `from`: to the next one, or ends the run after the last. It acts only while `from` is still the CURRENT dialog, so a save that already moved
 * the run on is not moved on a second time by the close that follows it (and a late "Skip" from a dialog that is gone does nothing).
 */
export function advanceRun(run: FollowUpRun | null, from: number): FollowUpRun | null {
  if (!run || run.i !== from) return run;
  return from + 1 < run.items.length ? { ...run, i: from + 1 } : null;
}
/** Ends the whole run (Cancel, Not now, the X, Escape) when dialog `from` is still the current one. Nothing already saved is undone. */
export function stopRun(run: FollowUpRun | null, from: number): FollowUpRun | null {
  return run && run.i === from ? null : run;
}

// ---- the one shared "Done" message every completion entry point uses ----

type Toast = (text: string, undo?: () => void | Promise<void>, action?: { label: string; onClick: () => void }) => void;

/**
 * Shows the ordinary "Done: ..." message (with its ordinary Undo) and, when a finished Task has something to log, one extra button beside Undo. Call it AFTER
 * the Task(s) were completed. The wording, the Undo and the completion itself are exactly what each screen had before; ignoring the button changes nothing.
 * For several Tasks (a bulk completion) the button reads "Log N one at a time" and walks through them with the dialogs' own Save buttons.
 */
export async function announceTaskDone(
  toast: Toast,
  done: { taskId?: number; taskIds?: number[]; text: string; undo?: () => void | Promise<void> },
  resolve: (taskId: number) => Promise<ResolvedFollowUp | null> = resolveTaskFollowUp,
): Promise<void> {
  const ids = done.taskIds ?? (done.taskId !== undefined ? [done.taskId] : []);
  let found: ResolvedFollowUp[] = [];
  try { found = (await Promise.all(ids.map((id) => resolve(id).catch(() => null)))).filter((x): x is ResolvedFollowUp => x !== null); } catch { found = []; }
  const action = found.length === 0 ? undefined
    : { label: found.length === 1 ? found[0].label : `Log ${found.length} one at a time`, onClick: () => openTaskFollowUp(found) };
  toast(done.text, done.undo, action);
}
