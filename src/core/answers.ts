/**
 * R3.2 "Quick Answers": a small, fixed catalog of household questions, each answered by ONE named reader that calls a module's EXISTING read-only reader.
 * PURE (no React, no database, no clock). This is NOT a chat feature and NOT a language model: a typed question is matched to a reader by simple, documented
 * word rules (below), and the reader returns a STRUCTURED result (figures, dated rows, links, assumptions, limitations). The screen words and draws it.
 *
 * WHAT THIS FILE OWNS: the contract (`AnswerReader`, `AnswerResult`), the matcher, and a validator for tests. It owns NO household rule and NO calculation:
 * every number comes from the module that already owns it (B5 commitments, Bills price steps, Projects summaries, Home & Assets spending, R1.1 Needs you, R1.2 This
 * Week, R3.1 Year Ahead). A module offers readers through `contributes.answers` (registry.ts), so no module imports another.
 *
 * MATCHING (documented, pinned by tests):
 *   - A question is split into words; small filler words ("what", "the", "are", "do") are dropped; each remaining word is reduced to a plain stem
 *     ("projects" -> "project", "increased" -> "increas", "spent" -> "spend").
 *   - A reader lists a few phrases. A phrase matches when ALL of its stems are in the question. Extra words in the question do not stop a match, because the
 *     suggestion always shows the reader's OWN fixed question and period, never an echo of what was typed.
 *   - A question that names a period Ledger does not answer ("last year", "2024") still suggests the reader, with a plain note that the answer is for its own fixed period.
 *   - A few words alone ("due", "coming up") are AMBIGUOUS: Ledger offers several readers instead of picking one.
 *   - Anything else matches nothing, and Search carries on exactly as before. Ledger never invents an answer.
 */

import type { ComponentType, ReactNode } from 'react';
import { isInternalHref } from './attention';

/** What a reader is given. `today` is 'YYYY-MM-DD' in local time. */
export interface AnswerContext { today: string }

/** Where an answer came from. A link is always a hash address inside Ledger. Never invented: a reader lists a source only for a module it actually read. */
export interface AnswerSourceRef { module: string; label: string; href: string }

/** How sure an amount is: B5's own four words. */
export type AnswerCertainty = 'known' | 'estimated' | 'unknown' | 'disputed';

/** Words and values of the one-line answer. A `money` part is formatted (and masked by Hide amounts) by the screen, never by the reader. */
export type AnswerPart = string | { money: number };

export type AnswerValue =
  | { kind: 'count'; n: number }
  | { kind: 'money'; cents: number | null; certainty?: AnswerCertainty }
  | { kind: 'date'; date: string }
  | { kind: 'text'; text: string };

export interface AnswerFigure { id: string; label: string; value: AnswerValue; note?: string }

export interface AnswerRow {
  /** Unique within the result. */
  id: string;
  title: string;
  /** Plain words under the title. May carry a record's own name, so the screen masks any amount typed in it when Hide amounts is on. */
  detail?: string;
  /** YYYY-MM-DD. */
  date?: string;
  /** "Due", "Ends", "Effective": what the date is. */
  dateLabel?: string;
  /** Money figures for this row, each named ("Budget", "Over by"). `cents: null` is "Not known", never zero. `strong` marks the one the row is about. */
  amounts?: { label: string; cents: number | null; certainty?: AnswerCertainty; strong?: boolean }[];
  chips?: { text: string; tone?: 'neutral' | 'overdue' | 'warning' | 'done' | 'info' }[];
  /** Other places to open (for example the Task behind an asset's maintenance row). Same rule as `href`. */
  links?: { label: string; href: string }[];
  /** The record (or its page) in its own module: a hash address such as `#/bills/o/4`. */
  href: string;
  /** The module that holds the record, in words ("Bills & Subscriptions"). */
  source: string;
}

export interface AnswerGroup {
  id: string;
  heading: string;
  note?: string;
  rows: AnswerRow[];
  /** Rows the reader left out of `rows` to keep the answer short (the full list is behind `more`). */
  hidden?: number;
  more?: { label: string; href: string };
}

/**
 * `answered`: a complete answer.   `none`: the sources were read and nothing matches (a real, checked "no").
 * `limited`: an answer with a documented limitation (a source could not be read, or a figure cannot safely be given).
 * `insufficient`: Ledger cannot answer from what is recorded; `missing` says what is missing and where to add it.
 * A read that FAILS is not a status: the reader throws and the screen says the source could not be loaded.
 */
export type AnswerStatus = 'answered' | 'none' | 'limited' | 'insufficient';

export interface AnswerResult {
  status: AnswerStatus;
  /** The direct answer, as words and typed values. */
  headline: AnswerPart[];
  /** The period the answer covers, always shown. `from`/`to` are YYYY-MM-DD or null for "as of today". */
  period: { label: string; from: string | null; to: string | null };
  figures: AnswerFigure[];
  groups: AnswerGroup[];
  /** What was assumed or defined ("home maintenance means ..."). */
  assumptions: string[];
  /** What is excluded, uncertain or incomplete. */
  limitations: string[];
  /** The modules (and pages) the answer was read from. At least one. */
  sources: AnswerSourceRef[];
  /** For `insufficient`: what is missing and where it is managed. */
  missing?: { what: string; where: string; href: string };
  /** The module's own full view of the same thing. */
  fullView?: { label: string; href: string };
}

/** The state of an answer being read. A read that fails is `failed` (never an empty result). */
export type AnswerRun = { state: 'loading' } | { state: 'failed'; message: string } | { state: 'ready'; result: AnswerResult };
/** What a live reader (a component that uses hooks) is given: it reads, then calls `render` with the state. */
export interface AnswerLiveProps { ctx: AnswerContext; render(run: AnswerRun): ReactNode }

export interface AnswerReader {
  /** `<moduleId>.<name>`, permanent. */
  id: string;
  /** The fixed question, as shown ("Which projects are over budget?"). */
  question: string;
  /** Short name for the list of questions ("Projects over budget"). */
  title: string;
  /** Recognised wordings. Each must reduce to at least two stems (see `stems`). */
  phrases: string[];
  /** The default period, in words, shown before the answer is read ("the next 30 days"). */
  defaultPeriod: string;
  /** Reads the sources and returns the structured answer. READ ONLY. Rejects when a source cannot be read. */
  run?(ctx: AnswerContext): Promise<AnswerResult>;
  /**
   * Alternative to `run` for a source that is only available as a React hook (R1.1 Needs you, R1.2 This Week). A lazily loaded component that calls the hook and hands the state to
   * `render`. Exactly one of `run` / `Live`.
   */
  Live?: ComponentType<AnswerLiveProps>;
}

// ---- matching ----

const FILLER = new Set([
  'what', 'whats', 'which', 'who', 'how', 'is', 'are', 'was', 'were', 'be', 'the', 'a', 'an', 'of', 'do', 'does', 'did', 'to', 'for', 'in', 'on', 'at', 'and', 'or',
  'it', 'its', 'there', 'any', 'have', 'has', 'had', 'much', 'many', 'this', 'that', 'these', 'those', 'show', 'tell', 'list', 'please', 'can', 'could', 'will', 'with',
]);
const SYNONYM: Record<string, string> = {
  spent: 'spend', spending: 'spend', paid: 'pay', went: 'go', gone: 'go', up: 'up', rose: 'increase', raised: 'increase', higher: 'increase', hike: 'increase',
  expiring: 'expire', expires: 'expire', expired: 'expire', expiration: 'expire', expiry: 'expire', ends: 'end', ending: 'end',
  happening: 'happen', happens: 'happen', comes: 'come', coming: 'come', upcoming: 'upcome', recently: 'recent', lately: 'recent', late: 'overdue', behind: 'overdue',
  repairs: 'maintenance', repair: 'maintenance', upkeep: 'maintenance', visits: 'visit', services: 'service', needs: 'need', needing: 'need',
  bills: 'bill', subscriptions: 'subscription', payments: 'payment', projects: 'project', warranties: 'warranty', tasks: 'task', commitments: 'commitment',
  prepare: 'prepar', preparing: 'prepar', budgets: 'budget', increased: 'increase', increases: 'increase', increasing: 'increase', raises: 'increase', rises: 'increase',
};

/** One word reduced to its stem. Total and deterministic; the same function is applied to questions and to reader phrases. */
export function stem(word: string): string {
  const w = word.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (w in SYNONYM) return SYNONYM[w];
  if (w.length > 5 && w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (w.length > 4 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

/** The stems of a question or phrase, filler dropped, each stem once. */
export function stems(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.toLowerCase().replace(/[’']s\b/g, '').split(/[^a-z0-9]+/)) {
    if (!raw || FILLER.has(raw)) continue;
    const s = stem(raw);
    if (s && !FILLER.has(s) && !out.includes(s)) out.push(s);
  }
  return out;
}

/** A period word Ledger does not answer: the suggestion is still shown, with this note. */
export function periodCaveat(query: string, today: string): string | null {
  const q = query.toLowerCase();
  const year = Number(today.slice(0, 4));
  const years = [...q.matchAll(/\b(19|20)\d{2}\b/g)].map((m) => Number(m[0]));
  const odd = /\b(last|previous|prior|next)\s+(year|month|week|quarter|decade)\b/.test(q) || /\b(yesterday|tomorrow|lifetime|all[- ]time|ever|since)\b/.test(q) || years.some((y) => y !== year);
  return odd ? 'Ledger answers this question for the fixed period shown on the answer, not for the period you typed.' : null;
}

export interface AnswerSuggestion { moduleId: string; reader: AnswerReader; /** Higher is a closer match. */ score: number; caveat: string | null }
export interface AnswerChoice { id: string; title: string; note: string; choices: AnswerSuggestion[] }
export interface AnswerMatches { suggestions: AnswerSuggestion[]; ambiguous: AnswerChoice | null }

/**
 * Questions that could reasonably mean several things. The words must be the WHOLE question (extras are filler or nothing), so a specific question is never captured.
 * `choices` are reader ids; the screen offers only the ones that are registered.
 */
export const AMBIGUOUS_QUESTIONS: { id: string; title: string; words: string[][]; note: string; choices: string[] }[] = [
  { id: 'due', title: 'What is due?', words: [['due'], ['due', 'soon'], ['coming', 'up'].map(stem), ['come', 'up'], ['upcome'], ['upcome', 'soon'], ['soon']], note: 'That could mean several things. Which one do you want?',
    choices: ['household.payments', 'services.upcoming', 'today.week', 'today.needs'] },
  { id: 'expect', title: 'What is expected?', words: [['expect'], ['expect', 'soon']], note: 'That could mean several things. Which one do you want?',
    choices: ['household.payments', 'services.upcoming', 'household.yearAhead'] },
];

const MAX_SUGGESTIONS = 3;

export function matchAnswers(query: string, readers: readonly { moduleId: string; reader: AnswerReader }[], today: string): AnswerMatches {
  const q = stems(query);
  if (q.length === 0) return { suggestions: [], ambiguous: null };
  const have = new Set(q);
  const caveat = periodCaveat(query, today);
  const suggestions: AnswerSuggestion[] = [];
  for (const { moduleId, reader } of readers) {
    let best = 0;
    for (const p of reader.phrases) {
      const ps = stems(p);
      if (ps.length < 2 || !ps.every((s) => have.has(s))) continue;
      // closer when the question has few words beyond the phrase
      best = Math.max(best, ps.length * 10 - (q.length - ps.length));
    }
    if (best > 0) suggestions.push({ moduleId, reader, score: best, caveat });
  }
  suggestions.sort((a, b) => b.score - a.score || a.reader.id.localeCompare(b.reader.id));
  if (suggestions.length > 0) return { suggestions: suggestions.slice(0, MAX_SUGGESTIONS), ambiguous: null };

  for (const a of AMBIGUOUS_QUESTIONS) {
    if (!a.words.some((w) => w.length === q.length && w.every((s) => have.has(s)))) continue;
    const choices = a.choices.flatMap((id) => { const r = readers.find((x) => x.reader.id === id); return r ? [{ moduleId: r.moduleId, reader: r.reader, score: 1, caveat: null }] : []; });
    if (choices.length >= 2) return { suggestions: [], ambiguous: { id: a.id, title: a.title, note: a.note, choices } };
  }
  return { suggestions: [], ambiguous: null };
}

/** A few questions to show when the Search box is empty: the first reader of each of the first few modules, in registry order. */
export function exampleQuestions(readers: readonly { moduleId: string; reader: AnswerReader }[], count = 3): { moduleId: string; reader: AnswerReader }[] {
  const seen = new Set<string>();
  const out: { moduleId: string; reader: AnswerReader }[] = [];
  for (const r of readers) {
    if (seen.has(r.moduleId)) continue;
    seen.add(r.moduleId);
    out.push(r);
    if (out.length >= count) break;
  }
  return out;
}

// ---- addresses ----

export const ANSWERS_BASE = '/answers';
/** The address of one answer. Ids are `<module>.<name>`, safe in an address. */
export const answerPath = (id: string) => `${ANSWERS_BASE}/${encodeURIComponent(id)}`;

// ---- safety (used when a reader is registered and in every reader's test) ----

/** Why a reader definition is not acceptable, or null. */
export function readerProblem(moduleId: string, r: AnswerReader): string | null {
  if (!/^[a-z0-9]+\.[A-Za-z0-9]+$/.test(r.id) || !r.id.startsWith(`${moduleId}.`)) return `id "${r.id}" must be "${moduleId}.<name>"`;
  if (!r.question.trim().endsWith('?')) return 'the question must read as a question';
  if (!r.title.trim() || !r.defaultPeriod.trim()) return 'a title and a default period are required';
  if (r.phrases.length === 0) return 'no phrases';
  for (const p of r.phrases) if (stems(p).length < 2) return `phrase "${p}" has fewer than two meaningful words`;
  if (!!r.run === !!r.Live) return 'exactly one of run / Live is required';
  return null;
}

/** Why a result is not acceptable, or null. Checks the promises: every result names its sources and period, every link stays inside Ledger, nothing is invented. */
export function resultProblem(r: AnswerResult): string | null {
  if (r.headline.length === 0) return 'no headline';
  if (!r.period.label.trim()) return 'no period';
  if (r.sources.length === 0) return 'no sources';
  for (const s of r.sources) if (!isInternalHref(s.href) || !s.label.trim()) return `bad source "${s.label}"`;
  if (r.fullView && !isInternalHref(r.fullView.href)) return 'bad full view link';
  if (r.status === 'insufficient' && !r.missing) return 'insufficient without a missing note';
  if (r.missing && !isInternalHref(r.missing.href)) return 'bad missing link';
  if (r.status === 'limited' && r.limitations.length === 0) return 'limited without a limitation';
  const ids = new Set<string>();
  for (const g of r.groups) {
    if (g.more && !isInternalHref(g.more.href)) return `bad "more" link in ${g.id}`;
    for (const row of g.rows) {
      if (!isInternalHref(row.href) || (row.links ?? []).some((l) => !isInternalHref(l.href))) return `bad link on "${row.id}"`;
      if (ids.has(`${g.id}|${row.id}`)) return `duplicate row ${row.id}`;
      ids.add(`${g.id}|${row.id}`);
      if (!row.source.trim() || !row.title.trim()) return `row "${row.id}" lacks a title or source`;
      for (const a of row.amounts ?? []) if (a.cents !== null && !Number.isInteger(a.cents)) return `non-whole cents on "${row.id}"`;
    }
  }
  for (const f of r.figures) if (f.value.kind === 'money' && f.value.cents !== null && !Number.isInteger(f.value.cents)) return `non-whole cents in figure ${f.id}`;
  return null;
}

/** Helpers readers use so results stay uniform. */
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const dateWords = (iso: string, year: boolean) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(year ? { year: 'numeric' } : {}), timeZone: 'UTC' });
/** "Nov 16 through Dec 15, 2026" (the year on both ends when they differ). Both dates are YYYY-MM-DD. */
export const rangeWords = (from: string, to: string): string => `${dateWords(from, from.slice(0, 4) !== to.slice(0, 4))} through ${dateWords(to, true)}`;
