/**
 * CS-1: Family Command Station eligibility. PURE (no database, clock, network or random numbers).
 *
 * "What may appear on a shared family display" is stored as APPEND-ONLY decision records in the existing shared `moduleRecords` table
 * (module `display`, kind `grant`). No new table, no migration. A decision is never edited or deleted by any screen; a new decision
 * SUPERSEDES the ones its writer had seen. The effective state of a subject is worked out here, and only from the `supersedes` links:
 * a timestamp (which a wrong device clock could fake) is never used to order decisions.
 *
 * Rules (the CS-0.1 design, section F.3):
 *  - No decision means PRIVATE.
 *  - The "heads" of a subject are the decisions no other decision supersedes. Any head that is unreadable, unknown, deleted or part of a cycle
 *    means HIDDEN. Any head that says `hide` means HIDDEN (concurrent choices: the safest wins). All heads `show`: SHOWN, at the narrowest level.
 *  - An event's own decision beats its calendar's; a per-event `hide` beats a shared calendar.
 *  - The global switch (`all`) overrides every ordinary decision.
 *  - A visit or maintenance reminder is shown only with a label the owner typed.
 */

export const DISPLAY_MODULE = 'display';
export const GRANT_KIND = 'grant';
export const GRANT_VERSION = 1;
export const LABEL_MAX = 80;

export type Decision = 'show' | 'hide';
export type Level = 'details' | 'busy';
export const BUSY_TITLE = 'Busy';

export type SubjectKind = 'all' | 'event' | 'calendar' | 'task' | 'visit' | 'reminder' | 'dates' | 'date';
export const subjectOf = (kind: Exclude<SubjectKind, 'all' | 'dates'>, id: number) => `${kind}:${id}`;
export const ALL_SUBJECT = 'all';
export const ALL_DATES_SUBJECT = 'dates:all';
export const memberDatesSubject = (memberId: number) => `dates:${memberId}`;

/** The shape written into `data`. Fields this code does not know are kept by the store; nothing here reads them. */
export interface GrantData {
  v: 1;
  subject: string;
  decision: Decision;
  /** Events and calendars only. Absent means `details`. */
  level?: Level;
  /** The owner's own display text (required for visits and reminders; optional for Busy). */
  label?: string;
  /** Visits and reminders: Family member record ids the owner chose to show it for. */
  people?: number[];
  /** The title at the time of an event or Task approval, so the editor can say "the title changed since you approved it". Never published. */
  titleAtGrant?: string;
  /** The ids of this subject's decisions this device had seen when it wrote this one. */
  supersedes: number[];
  /** Random per page load: an audit aid only, never an identity. */
  deviceId: string;
}

export interface GrantRow {
  id?: number;
  module?: string;
  kind?: string;
  data?: unknown;
  createdAt?: number;
  updatedAt?: number;
  deletedAt?: number | null;
}

export interface ParsedSubject { kind: SubjectKind; id: number | null }

/** `all`, `event:12`, `calendar:12`, `task:12`, `visit:12`, `reminder:12`, `dates:all`, `dates:12`, `date:12`. Anything else is null. */
export function parseSubject(s: unknown): ParsedSubject | null {
  if (typeof s !== 'string') return null;
  if (s === ALL_SUBJECT) return { kind: 'all', id: null };
  if (s === ALL_DATES_SUBJECT) return { kind: 'dates', id: null };
  const m = /^(event|calendar|task|visit|reminder|dates|date):(\d{1,18})$/.exec(s);
  if (!m) return null;
  const id = Number(m[2]);
  return Number.isSafeInteger(id) ? { kind: m[1] as SubjectKind, id } : null;
}

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v);
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export const cleanLabel = (s: unknown): string => (typeof s === 'string' ? s.trim().replace(/\s+/g, ' ') : '');
const labelOk = (s: string) => s.length > 0 && s.length <= LABEL_MAX;

export type HiddenReason = 'revoked' | 'conflict' | 'unreadable' | 'deleted' | 'cycle' | 'label-missing' | 'killed';
export interface SubjectState {
  subject: string;
  /** `none`: the owner never decided (private). */
  state: 'none' | 'show' | 'hide';
  level: Level;
  label: string | null;
  people: number[];
  titleAtGrant: string | null;
  /** Two or more current decisions disagree (or one is unreadable): the owner should choose again. */
  conflict: boolean;
  reason: HiddenReason | null;
  /** The decision records that currently decide this subject. */
  headIds: number[];
  /** How many decision records exist for this subject, superseded or not. */
  count: number;
}

interface Node {
  id: number;
  subject: string;
  ok: boolean;
  deleted: boolean;
  decision: Decision | null;
  level: Level;
  label: string;
  people: number[];
  titleAtGrant: string;
  supersedes: number[];
}

function readNode(r: GrantRow): Node | null {
  if (r.module !== DISPLAY_MODULE || r.kind !== GRANT_KIND || !isInt(r.id)) return null;
  const d = isRecord(r.data) ? r.data : null;
  if (!d || !parseSubject(d.subject)) return null;
  const decision = d.decision === 'show' || d.decision === 'hide' ? d.decision : null;
  const level: Level | null = d.level === undefined ? 'details' : d.level === 'details' || d.level === 'busy' ? d.level : null;
  const sup = d.supersedes === undefined ? [] : Array.isArray(d.supersedes) && d.supersedes.every(isInt) ? (d.supersedes as number[]) : null;
  const labelRaw = d.label === undefined ? '' : typeof d.label === 'string' ? d.label : null;
  const people = d.people === undefined ? [] : Array.isArray(d.people) && d.people.every(isInt) ? (d.people as number[]) : null;
  const deleted = r.deletedAt != null;
  const ok = d.v === GRANT_VERSION && decision !== null && level !== null && sup !== null && labelRaw !== null && people !== null && !deleted;
  return {
    id: r.id, subject: d.subject as string, ok, deleted, decision,
    level: level ?? 'details', label: cleanLabel(labelRaw), people: people ?? [], titleAtGrant: typeof d.titleAtGrant === 'string' ? d.titleAtGrant : '',
    supersedes: sup ?? [],
  };
}

const none = (subject: string): SubjectState => ({ subject, state: 'none', level: 'details', label: null, people: [], titleAtGrant: null, conflict: false, reason: null, headIds: [], count: 0 });

export interface GrantIndex {
  /** The state of one subject (`none` when the owner never decided it). */
  get(subject: string): SubjectState;
  /** The global "hide everything" switch is on (or unreadable). Overrides every ordinary decision. */
  killed: boolean;
  /** Every subject with at least one decision. */
  subjects: SubjectState[];
  /** The id of EVERY display decision record this device holds, readable or not, deleted or not (the privacy-decision history). Sorted. */
  recordIds: number[];
  /** Records that name no readable subject: they decide nothing (and so can show nothing) but are still part of the history. */
  unattributable: number[];
  /** Subjects the owner should look at again (conflicting or unreadable decisions). */
  conflicts: SubjectState[];
}

const KINDS_NEEDING_LABEL: ReadonlySet<SubjectKind> = new Set<SubjectKind>(['visit', 'reminder']);

/** Works out every subject's effective state. Pure and deterministic: the result does not depend on the order of `rows`. */
export function resolveGrants(rows: readonly GrantRow[]): GrantIndex {
  const mine = rows.filter((r) => r.module === DISPLAY_MODULE && r.kind === GRANT_KIND && isInt(r.id));
  const recordIds = [...new Set(mine.map((r) => r.id as number))].sort((a, b) => a - b);
  const nodes: Node[] = [];
  const unattributable: number[] = [];
  for (const r of mine) {
    const n = readNode(r);
    if (n) nodes.push(n); else unattributable.push(r.id as number);
  }
  const bySubject = new Map<string, Node[]>();
  for (const n of nodes) bySubject.set(n.subject, [...(bySubject.get(n.subject) ?? []), n]);

  const states = new Map<string, SubjectState>();
  for (const [subject, group] of bySubject) {
    const ids = new Set(group.map((n) => n.id));
    const superseded = new Set<number>();
    for (const n of group) for (const s of n.supersedes) if (ids.has(s) && s !== n.id) superseded.add(s);
    const heads = group.filter((n) => !superseded.has(n.id)).sort((a, b) => a.id - b.id);
    const base = { ...none(subject), count: group.length, headIds: heads.map((h) => h.id) };
    const hide = (reason: HiddenReason, conflict: boolean): SubjectState => ({ ...base, state: 'hide', reason, conflict });
    if (heads.length === 0) { states.set(subject, hide('cycle', true)); continue; }
    const bad = heads.find((h) => !h.ok);
    if (bad) { states.set(subject, hide(bad.deleted ? 'deleted' : 'unreadable', true)); continue; }
    if (heads.some((h) => h.decision === 'hide')) { states.set(subject, hide(heads.length > 1 ? 'conflict' : 'revoked', heads.length > 1 && heads.some((h) => h.decision === 'show'))); continue; }
    // every head says show
    const level: Level = heads.some((h) => h.level === 'busy') ? 'busy' : 'details';
    const last = heads[heads.length - 1];
    const people = heads.map((h) => h.people).reduce((a, b) => a.filter((x) => b.includes(x)));
    const parsed = parseSubject(subject)!;
    const label = last.label;
    if (KINDS_NEEDING_LABEL.has(parsed.kind) && !labelOk(label)) { states.set(subject, hide('label-missing', false)); continue; }
    states.set(subject, {
      ...base, state: 'show', level, people: [...new Set(people)].sort((a, b) => a - b),
      label: label && label.length <= LABEL_MAX ? label : null, titleAtGrant: last.titleAtGrant || null, conflict: heads.length > 1,
    });
  }

  const allState = states.get(ALL_SUBJECT);
  const killed = !!allState && allState.state === 'hide';
  const subjects = [...states.values()].sort((a, b) => a.subject.localeCompare(b.subject));
  return {
    get: (s) => states.get(s) ?? none(s),
    killed,
    subjects,
    recordIds,
    unattributable: unattributable.sort((a, b) => a - b),
    conflicts: subjects.filter((s) => s.conflict || (s.state === 'hide' && (s.reason === 'unreadable' || s.reason === 'cycle' || s.reason === 'deleted'))),
  };
}

// ---------------- what is shown, for one item ----------------

export type ShowVia = 'event' | 'calendar' | 'task' | 'dates' | 'date' | 'visit' | 'reminder';
export interface Effective {
  /** What the display may carry: nothing, Busy, or the details. */
  show: 'hidden' | 'details' | 'busy';
  via: ShowVia | 'kill' | 'none';
  /** Why it is hidden, in a word, when a decision (not the absence of one) hid it. */
  reason: HiddenReason | null;
  label: string | null;
  people: number[];
  conflict: boolean;
}
const HIDDEN: Effective = { show: 'hidden', via: 'none', reason: null, label: null, people: [], conflict: false };
const fromState = (s: SubjectState, via: ShowVia): Effective =>
  s.state === 'show'
    ? { show: s.level, via, reason: null, label: s.label, people: s.people, conflict: s.conflict }
    : { show: 'hidden', via, reason: s.reason, label: null, people: [], conflict: s.conflict };

/** Event: its own decision first, then its calendar's. A calendar that is not a local one can never be shared (pass `calendarShareable: false`). */
export function effectiveForEvent(g: GrantIndex, eventId: number, calendarId: number, calendarShareable = true): Effective {
  if (g.killed) return { ...HIDDEN, via: 'kill', reason: 'killed' };
  const own = g.get(subjectOf('event', eventId));
  if (own.state !== 'none') return fromState(own, 'event');
  if (!calendarShareable) return HIDDEN;
  const cal = g.get(subjectOf('calendar', calendarId));
  return cal.state === 'none' ? HIDDEN : fromState(cal, 'calendar');
}

/** Task: the decision on the root of its repeat chain (the caller resolves the root; `null` = the chain is ambiguous: hidden). */
export function effectiveForTask(g: GrantIndex, rootId: number | null): Effective {
  if (g.killed) return { ...HIDDEN, via: 'kill', reason: 'killed' };
  if (rootId === null) return HIDDEN;
  const s = g.get(subjectOf('task', rootId));
  return s.state === 'none' ? HIDDEN : fromState(s, 'task');
}

export function effectiveForSimple(g: GrantIndex, kind: 'visit' | 'reminder', id: number): Effective {
  if (g.killed) return { ...HIDDEN, via: 'kill', reason: 'killed' };
  const s = g.get(subjectOf(kind, id));
  return s.state === 'none' ? HIDDEN : fromState(s, kind);
}

/** An important date, or a member's birthday (`dateId: null`): its own decision, then the member's, then the household-wide one. */
export function effectiveForDate(g: GrantIndex, dateId: number | null, memberId: number | null): Effective {
  if (g.killed) return { ...HIDDEN, via: 'kill', reason: 'killed' };
  if (dateId !== null) {
    const own = g.get(subjectOf('date', dateId));
    if (own.state !== 'none') return fromState(own, 'date');
  }
  if (memberId !== null) {
    const m = g.get(memberDatesSubject(memberId));
    if (m.state !== 'none') return fromState(m, 'dates');
  }
  const all = g.get(ALL_DATES_SUBJECT);
  return all.state === 'none' ? HIDDEN : fromState(all, 'dates');
}

// ---------------- the privacy-decision history ----------------

/**
 * Compares the privacy-decision history a publisher last saw (`published`, opaque ids) with what this device holds (`current`). `missing` are ids
 * the publication knew that this device does not have (a restore or replace removed them): publishing from here would be unsafe. `added` are ids
 * this device holds that the publication did not know. Both are sets of opaque strings; order does not matter.
 */
export function compareHistory(published: readonly string[], current: readonly string[]): { missing: string[]; added: string[]; same: boolean } {
  const p = new Set(published);
  const c = new Set(current);
  const missing = [...p].filter((x) => !c.has(x)).sort();
  const added = [...c].filter((x) => !p.has(x)).sort();
  return { missing, added, same: missing.length === 0 && added.length === 0 };
}
