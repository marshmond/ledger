/**
 * CS-1: reading and appending display decisions. Decisions are only ever ADDED: nothing here edits or deletes a grant record.
 * Writes go through the shared store's `repo`, so a decision has a time-based id and syncs and backs up like every other record.
 */
import { db, type FinanceDB } from '../db';
import type { ModuleRecord } from '../core/entities';
import { repo } from '../core/store';
import { emitHideDecision } from './publish/signals';
import {
  ALL_SUBJECT, cleanLabel, DISPLAY_MODULE, GRANT_KIND, GRANT_VERSION, LABEL_MAX, parseSubject, resolveGrants, subjectOf,
  type Decision, type GrantData, type GrantIndex, type Level,
} from './grants';

/** Random per page load. Written into each decision as an audit aid; it is not stored anywhere else and identifies nothing. */
const SESSION_DEVICE = Array.from({ length: 8 }, () => Math.floor(Math.random() * 16).toString(16)).join('');

/** Every display decision record on this device (including any a sync marked deleted: they matter to the history). */
export async function loadGrantRows(d: FinanceDB = db): Promise<ModuleRecord[]> {
  return d.moduleRecords.where('[module+kind]').equals([DISPLAY_MODULE, GRANT_KIND]).toArray();
}
export async function loadGrants(d: FinanceDB = db): Promise<GrantIndex> {
  return resolveGrants(await loadGrantRows(d));
}

export interface DecisionInput {
  subject: string;
  decision: Decision;
  level?: Level;
  label?: string;
  people?: number[];
  titleAtGrant?: string;
}

/** Plain-words problem with a decision about to be written, or null. */
export function checkDecision(i: DecisionInput): string | null {
  const s = parseSubject(i.subject);
  if (!s) return 'That is not something that can be shown on the family display.';
  if (i.decision !== 'show' && i.decision !== 'hide') return 'Choose show or hide.';
  if (s.kind === 'all' && i.level) return 'The hide-everything switch has no level.';
  if ((s.kind === 'visit' || s.kind === 'reminder') && i.decision === 'show') {
    const l = cleanLabel(i.label);
    if (!l) return 'Type the name the display should show for this. It never shows the original name.';
    if (l.length > LABEL_MAX) return `The display name can be at most ${LABEL_MAX} characters.`;
  }
  if (i.label !== undefined && cleanLabel(i.label).length > LABEL_MAX) return `The display name can be at most ${LABEL_MAX} characters.`;
  if (i.level === 'busy' && s.kind !== 'event' && s.kind !== 'calendar') return 'Only events and calendars can be shown as Busy.';
  return null;
}

/**
 * Appends one decision for a subject. It supersedes every decision for that subject this device can see, and it is written in one transaction
 * with the read, so two quick taps cannot both supersede the same set. Returns the new record's id.
 */
export async function appendDecision(i: DecisionInput, d: FinanceDB = db): Promise<number> {
  const problem = checkDecision(i);
  if (problem) throw new Error(problem);
  return d.transaction('rw', d.moduleRecords, () => appendInTransaction(i, d));
}

/** The same, for a caller that is already inside a `moduleRecords` transaction (a series split, for example). */
export async function appendInTransaction(i: DecisionInput, d: FinanceDB): Promise<number> {
  const seen = (await loadGrantRows(d)).filter((r) => (r.data as { subject?: unknown } | null)?.subject === i.subject).map((r) => r.id as number);
  const label = cleanLabel(i.label);
  const data: GrantData = {
    v: GRANT_VERSION, subject: i.subject, decision: i.decision,
    ...(i.level && i.level !== 'details' ? { level: i.level } : {}),
    ...(label ? { label } : {}),
    ...(i.people?.length ? { people: [...new Set(i.people)].sort((a, b) => a - b) } : {}),
    ...(i.titleAtGrant ? { titleAtGrant: i.titleAtGrant.slice(0, 200) } : {}),
    supersedes: seen.sort((a, b) => a - b), deviceId: SESSION_DEVICE,
  };
  const id = await repo<ModuleRecord>(d.moduleRecords).put({ module: DISPLAY_MODULE, kind: GRANT_KIND, data: data as unknown as Record<string, unknown> });
  if (i.decision === 'hide') emitHideDecision(); // CS-2: a revocation should reach the display promptly (runs after this call returns)
  return id;
}

/** The global switch. `true` hides everything locally; `false` resumes ordinary decisions. Both are decisions: nothing is deleted. */
export const setKillSwitch = (on: boolean, d: FinanceDB = db) => appendDecision({ subject: ALL_SUBJECT, decision: on ? 'hide' : 'show' }, d);

// ---------------- lineage ----------------

/**
 * "This and following" splits a repeating event and creates a NEW event id. Carries the old event's OWN decision to the new one, so an approval
 * (or an explicit "keep private") follows the series. If the old event's own decision is anything but a clean `show` (a hide, a conflict, an
 * unreadable record) the new event gets a `hide`: it can only ever fail closed. An event with no decision of its own is left alone (it inherits
 * its calendar's choice, as every new event does). Must be called inside a transaction that includes `moduleRecords`.
 */
export async function carryEventDecision(fromEventId: number, toEventId: number, d: FinanceDB, title: string): Promise<void> {
  const g = resolveGrants(await loadGrantRows(d));
  const own = g.get(subjectOf('event', fromEventId));
  if (own.state === 'none') return;
  if (own.state === 'show' && !own.conflict) {
    await appendInTransaction({ subject: subjectOf('event', toEventId), decision: 'show', level: own.level, label: own.label ?? undefined, titleAtGrant: title }, d);
  } else {
    await appendInTransaction({ subject: subjectOf('event', toEventId), decision: 'hide' }, d);
  }
}
