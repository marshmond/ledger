/**
 * What the lifecycle records MEAN (B4). PURE: no database, no clock (callers pass `today`). Everything the screens, the Tasks planner, the Calendar
 * layer and the read model show about a subscription's life comes from `lifecycleView`, so they can never disagree.
 *
 * THE RULES (each is tested):
 *  - Records are evidence. Nothing here cancels, renews, converts, reprices or ends anything: a date passing only changes what is SHOWN.
 *  - A record is EFFECTIVE when it is readable and no later record replaced it. Replaced and negated records stay in the history.
 *  - Disagreement is never resolved silently. Two effective records of one kind that disagree (two effective cancellation dates, two prices from one
 *    day, two renewal dates, two trial end dates, a withdrawal and a confirmation written by devices that did not see each other) become a CONFLICT.
 *    While a conflict stands, the disputed value is NOT used: the date or price falls back to what was agreed before (the B2 contract dates and the
 *    first price), and a price in dispute reads as unknown, never as one of the candidates and never as zero.
 *  - A cancellation REQUEST is not a CONFIRMATION, and a confirmation is not the end of service: the effective date decides when expected periods stop.
 *  - An unknown price is never zero. A new price never touches an invoice or a payment already recorded; it only changes what is EXPECTED.
 */
import { localISO } from '../../core/time';
import { addDays, addMonths } from '../../lib/dates';
import type { PriceStep } from './model';
import { type LcEff, type LcOf, type LcRecord, type PriceSource, type PriceStatus, isLcReadable, type Cadence, type LcBody } from './lifecycleModel';
import { daysUntil } from './timing';
import { DEADLINE_LABEL, type DeadlineKind, type Terms } from './terms';

export const PASSED_WINDOW_DAYS = 60;
export const SOON_DAYS = 30;

// ---- effective records ----

export interface EffectiveSet { effective: LcEff[]; replaced: Map<number, number>; unreadable: LcRecord[]; all: LcEff[] }

/** Splits one bill's lifecycle records into the effective ones and the replaced ones. A replacement counts only when it is LATER (a higher id) than what it replaces. */
export function effectiveOf(records: LcRecord[]): EffectiveSet {
  const readable = records.filter(isLcReadable);
  const ids = new Set(readable.map((r) => r.id));
  const replaced = new Map<number, number>();
  for (const r of readable) for (const x of r.replaces) if (ids.has(x) && r.id > x && !replaced.has(x)) replaced.set(x, r.id);
  return { effective: readable.filter((r) => !replaced.has(r.id)), replaced, unreadable: records.filter((r) => !isLcReadable(r)), all: readable };
}

const only = <F extends LcBody['fact']>(list: LcEff[], f: F): (LcEff & { body: Extract<LcBody, { fact: F }> })[] => list.filter((r) => r.body.fact === f) as never;
const newest = <T extends { id: number }>(l: T[]): T | null => l.reduce<T | null>((b, x) => (b === null || x.id > b.id ? x : b), null);
const distinct = <T>(l: T[], key: (x: T) => string) => [...new Map(l.map((x) => [key(x), x])).values()];

/** True when neither record could see the other (they were written by devices that had not synced). */
export const concurrent = (a: LcEff, b: LcEff) => a.id !== b.id && !a.seen.includes(b.id) && !b.seen.includes(a.id) && !a.replaces.includes(b.id) && !b.replaces.includes(a.id) && !a.targets.includes(b.id) && !b.targets.includes(a.id);

// ---- conflicts ----

export type ConflictKind = 'confirm-dates' | 'withdraw-vs-evidence' | 'price-same-date' | 'price-overlap' | 'renewal-dates' | 'trial-ends' | 'trial-outcomes' | 'unreadable';
export interface LcConflict { key: string; kind: ConflictKind; ids: number[]; text: string; acknowledged: boolean }
const conflictKey = (kind: ConflictKind, ob: number, ids: number[]) => `lc|${kind}|${ob}|${[...ids].sort((a, b) => a - b).join(',')}`;

// ---- prices ----

export interface PriceRow {
  from: string; until: string | null; cents: number | null; status: PriceStatus; label: string; source: PriceSource | null; note: string;
  origin: 'baseline' | 'recorded' | 'gap' | 'conflict'; recordId: number | null; ids: number[];
}

/** The price steps in force: the first prices the owner entered (B1) plus the recorded steps, with disagreements shown as UNKNOWN and gaps after an end date as UNKNOWN. */
export function priceView(baseline: PriceStep[], eff: LcEff[], ob: number, acked: Set<string>): { steps: PriceStep[]; rows: PriceRow[]; conflicts: LcConflict[] } {
  type Cand = { from: string; until: string | null; cents: number | null; status: PriceStatus; label: string; source: PriceSource | null; note: string; id: number | null };
  const cands: Cand[] = [
    ...baseline.map((p): Cand => ({ from: p.from, until: null, cents: p.cents, status: p.cents === null ? 'unknown' : p.estimated ? 'estimated' : 'fixed', label: p.label, source: null, note: '', id: null })),
    ...only(eff, 'price-step').map((r): Cand => ({ from: r.body.from, until: r.body.until, cents: r.body.cents, status: r.body.status, label: r.body.label, source: r.body.source, note: r.body.note, id: r.id })),
  ];
  const conflicts: LcConflict[] = [];
  const rows: PriceRow[] = [];
  const byFrom = new Map<string, Cand[]>();
  for (const c of cands) byFrom.set(c.from, [...(byFrom.get(c.from) ?? []), c]);
  for (const from of [...byFrom.keys()].sort()) {
    const g = byFrom.get(from)!;
    const kinds = distinct(g, (c) => `${c.cents}|${c.status}|${c.until ?? ''}`);
    if (kinds.length > 1) {
      const ids = g.flatMap((c) => (c.id === null ? [] : [c.id]));
      const key = conflictKey('price-same-date', ob, ids);
      conflicts.push({ key, kind: 'price-same-date', ids, text: `Different prices are recorded from ${from}. Ledger is not using any of them: the price from that day reads as unknown until you choose.`, acknowledged: acked.has(key) });
      rows.push({ from, until: null, cents: null, status: 'unknown', label: 'records disagree', source: null, note: '', origin: 'conflict', recordId: null, ids });
      for (const c of g) if (c.id !== null) rows.push({ from, until: c.until, cents: c.cents, status: c.status, label: c.label, source: c.source, note: c.note, origin: 'recorded', recordId: c.id, ids: [c.id] });
    } else {
      const c = g[0];
      rows.push({ from, until: c.until, cents: c.cents, status: c.status, label: c.label, source: c.source, note: c.note, origin: c.id === null ? 'baseline' : 'recorded', recordId: c.id, ids: g.flatMap((x) => (x.id === null ? [] : [x.id])) });
    }
  }
  // a later step that starts INSIDE an earlier step's explicit range contradicts it: the later one reads as unknown, nothing is chosen for the owner
  const live = rows.filter((r) => r.origin === 'baseline' || r.origin === 'recorded').filter((r) => !rows.some((c) => c.origin === 'conflict' && c.from === r.from));
  const overlapped = new Set<string>();
  for (const a of live) if (a.until) for (const b of live) if (b !== a && b.from > a.from && b.from <= a.until && !overlapped.has(b.from)) {
    overlapped.add(b.from);
    const ids = [a.recordId, b.recordId].flatMap((x) => (x === null ? [] : [x]));
    const key = conflictKey('price-overlap', ob, ids.length ? ids : [0]);
    conflicts.push({ key, kind: 'price-overlap', ids, text: `A price starting ${b.from} begins inside the range of the price that runs until ${a.until}. Ledger is not using the later one until you choose.`, acknowledged: acked.has(key) });
  }
  const steps: PriceStep[] = [];
  const seenFrom = new Set<string>();
  for (const r of rows.sort((x, y) => x.from.localeCompare(y.from) || (x.origin === 'conflict' ? -1 : 1))) {
    if (seenFrom.has(r.from)) continue;
    const isConflict = r.origin === 'conflict' || overlapped.has(r.from);
    // a conflicted day reads as unknown; the first row for a day is the conflict row when one exists
    seenFrom.add(r.from);
    steps.push({ from: r.from, cents: isConflict ? null : r.cents, label: isConflict ? 'records disagree' : r.label, ...(r.status === 'estimated' && !isConflict ? { estimated: true } : {}), ...(isConflict ? { conflict: true } : {}) });
  }
  // after an explicit end date with nothing starting by the next day, the price is unknown (never carried forward, never zero)
  for (const r of rows) {
    if (!r.until || r.origin === 'conflict' || overlapped.has(r.from)) continue;
    const next = addDays(r.until, 1);
    if (!steps.some((s) => s.from > r.from && s.from <= next)) { steps.push({ from: next, cents: null, label: 'no price recorded after this' }); rows.push({ from: next, until: null, cents: null, status: 'unknown', label: 'no price recorded after this', source: null, note: '', origin: 'gap', recordId: null, ids: [] }); }
  }
  steps.sort((a, b) => a.from.localeCompare(b.from));
  rows.sort((a, b) => a.from.localeCompare(b.from) || (a.recordId ?? 0) - (b.recordId ?? 0));
  return { steps, rows, conflicts };
}

// ---- the view ----

export interface TrialView { endsOn: string | null; startsOn: string | null; fact: LcOf<'trial'> | null; extensions: LcOf<'trial-extend'>[]; outcome: LcOf<'trial-outcome'> | null; conflictIds: number[] }
export interface RenewalView { fact: LcOf<'renewal'> | null; outcomes: LcOf<'renewal-outcome'>[]; conflictIds: number[] }
export interface CancelView {
  plan: LcOf<'cancel-plan'> | null;
  /** Requests and confirmations that no withdrawal or reactivation negated. */
  requests: LcOf<'cancel-request'>[];
  confirms: LcOf<'cancel-confirm'>[];
  /** Everything a withdrawal or reactivation negated (kept in the history). */
  negated: Set<number>;
  withdrawals: LcOf<'cancel-withdraw'>[];
  reactivations: LcOf<'reactivate'>[];
  /** The single confirmation in force (several that AGREE on the effective date count as one), or null. */
  confirm: LcOf<'cancel-confirm'> | null;
  request: LcOf<'cancel-request'> | null;
  /** The confirmed effective date, only when it is not in dispute. */
  effectiveOn: string | null;
}
export interface LifecycleView {
  records: LcRecord[];
  effective: LcEff[];
  replaced: Map<number, number>;
  unreadable: LcRecord[];
  /** Effective prices (the first price plus recorded steps, conflicts and gaps as unknown). */
  prices: PriceStep[];
  priceRows: PriceRow[];
  trial: TrialView;
  renewal: RenewalView;
  cancel: CancelView;
  conflicts: LcConflict[];
  /** Acknowledged evidence keys. */
  acked: Set<string>;
  /** Expected billing periods stop after this day: the confirmed effective cancellation date, when it is agreed. Null otherwise. */
  cutoffOn: string | null;
  /** Arrangements the owner linked (net of unlinks). */
  arrangementIds: number[];
}

export const EMPTY_VIEW: LifecycleView = {
  records: [], effective: [], replaced: new Map(), unreadable: [], prices: [], priceRows: [], trial: { endsOn: null, startsOn: null, fact: null, extensions: [], outcome: null, conflictIds: [] },
  renewal: { fact: null, outcomes: [], conflictIds: [] }, cancel: { plan: null, requests: [], confirms: [], negated: new Set(), withdrawals: [], reactivations: [], confirm: null, request: null, effectiveOn: null },
  conflicts: [], acked: new Set(), cutoffOn: null, arrangementIds: [],
};

export interface ViewInput { obligationId: number; baselinePrices: PriceStep[]; records: LcRecord[] }

export function lifecycleView(input: ViewInput): LifecycleView {
  const ob = input.obligationId;
  const set = effectiveOf(input.records);
  const eff = set.effective;
  const acked = new Set(only(eff, 'ack').map((r) => r.body.key));
  const conflicts: LcConflict[] = [];
  const add = (kind: ConflictKind, ids: number[], text: string) => { const key = conflictKey(kind, ob, ids); conflicts.push({ key, kind, ids, text, acknowledged: acked.has(key) }); };

  const p = priceView(input.baselinePrices, eff, ob, acked);
  conflicts.push(...p.conflicts);

  // ---- trial ----
  const trials = only(eff, 'trial'), exts = only(eff, 'trial-extend');
  const ends = [...trials.map((t) => ({ r: t, d: t.body.endsOn })), ...exts.map((t) => ({ r: t, d: t.body.endsOn }))];
  const endDates = [...new Set(ends.map((e) => e.d))];
  let trialConflict: number[] = [];
  if (endDates.length > 1) { trialConflict = ends.map((e) => e.r.id); add('trial-ends', trialConflict, `Different trial end dates are recorded (${endDates.sort().join(' and ')}). Ledger is using none of them; the contract date you entered earlier, if any, stays in use.`); }
  // the trial's details (payment method, price after, must-cancel) stay available after an extension replaced the record that carried them
  const trialFact = newest(trials) ?? newest(set.all.filter((r): r is LcOf<'trial'> => r.body.fact === 'trial'));
  const outcomes = only(eff, 'trial-outcome');
  const outcomeKinds = [...new Set(outcomes.map((o) => o.body.outcome))];
  if (outcomeKinds.length > 1) add('trial-outcomes', outcomes.map((o) => o.id), 'Different trial outcomes are recorded (for example converted and cancelled). Check what really happened.');
  const trial: TrialView = { endsOn: endDates.length === 1 ? endDates[0] : null, startsOn: trialFact?.body.startsOn ?? null, fact: trialFact, extensions: exts, outcome: outcomeKinds.length === 1 ? newest(outcomes) : null, conflictIds: trialConflict };

  // ---- renewal ----
  const rens = only(eff, 'renewal');
  const renDates = [...new Set(rens.map((r) => r.body.renewalDate))];
  let renConflict: number[] = [];
  if (renDates.length > 1) { renConflict = rens.map((r) => r.id); add('renewal-dates', renConflict, `Different renewal dates are recorded (${renDates.sort().join(' and ')}). Ledger is using none of them; the contract date you entered earlier, if any, stays in use.`); }
  const renewal: RenewalView = { fact: renDates.length === 1 ? newest(rens) : null, outcomes: only(eff, 'renewal-outcome'), conflictIds: renConflict };

  // ---- cancellation ----
  const negators = [...only(eff, 'cancel-withdraw'), ...only(eff, 'reactivate')];
  const cancelFacts = [...only(eff, 'cancel-request'), ...only(eff, 'cancel-confirm')];
  const negated = new Set<number>();
  for (const n of negators) for (const t of n.targets) negated.add(t);
  // a negation that was written WITHOUT seeing a request or confirmation does not cover it: the two disagree and the owner is asked
  for (const n of negators) for (const c of cancelFacts) {
    if (negated.has(c.id) && n.targets.includes(c.id)) continue;
    if (!negated.has(c.id) && concurrent(n, c)) add('withdraw-vs-evidence', [n.id, c.id], `A ${n.body.fact === 'reactivate' ? 'reactivation' : 'withdrawal'} and a cancellation ${c.body.fact === 'cancel-confirm' ? 'confirmation' : 'request'} were recorded on devices that had not seen each other. Ledger is not treating the cancellation as confirmed until you look.`);
  }
  const requests = only(eff, 'cancel-request').filter((r) => !negated.has(r.id));
  const confirms = only(eff, 'cancel-confirm').filter((r) => !negated.has(r.id));
  const planF = newest(only(eff, 'cancel-plan').filter((r) => !negated.has(r.id)));
  const effDates = [...new Set(confirms.map((c) => c.body.effectiveOn))];
  if (effDates.length > 1) add('confirm-dates', confirms.map((c) => c.id), `Different effective cancellation dates are recorded (${effDates.sort().join(' and ')}). Ledger is using neither: expected bills keep running until you choose.`);
  const disputed = conflicts.some((c) => c.kind === 'confirm-dates' || c.kind === 'withdraw-vs-evidence');
  const confirm = effDates.length === 1 && !disputed ? newest(confirms) : null;
  const cancel: CancelView = {
    plan: planF, requests, confirms, negated, withdrawals: only(eff, 'cancel-withdraw'), reactivations: only(eff, 'reactivate'), confirm, request: newest(requests),
    effectiveOn: confirm ? confirm.body.effectiveOn : null,
  };

  if (set.unreadable.length) add('unreadable', set.unreadable.map((r) => r.id), `${set.unreadable.length === 1 ? 'A lifecycle record' : `${set.unreadable.length} lifecycle records`} could not be read by this version of Ledger. ${set.unreadable.length === 1 ? 'It is' : 'They are'} kept exactly as saved and not counted.`);

  // ---- Household Services links (net of unlinks, newest note per arrangement wins; the real link lives in the shared links table) ----
  const notes = only(eff, 'service-link');
  const arr = new Map<number, 'linked' | 'unlinked'>();
  for (const n of [...notes].sort((a, b) => a.id - b.id)) arr.set(n.body.arrangementId, n.body.action);

  return {
    records: [...input.records].sort((a, b) => b.createdAt - a.createdAt || b.id - a.id), effective: eff, replaced: set.replaced, unreadable: set.unreadable,
    prices: p.steps, priceRows: p.rows, trial, renewal, cancel, conflicts, acked, cutoffOn: cancel.effectiveOn, arrangementIds: [...arr].filter(([, a]) => a === 'linked').map(([id]) => id),
  };
}

/** A token that changes when any lifecycle record of the bill is added, changed or removed (a preview refuses to apply when it differs). */
export const lcToken = (records: LcRecord[]) => records.map((r) => `${r.id}.${r.updatedAt}`).sort().join(',');

// ---- deadlines (the dates reminders and the Calendar use) ----

export interface EffDeadline { kind: DeadlineKind; date: string; /** a Task is wanted for it */ action: boolean; source: 'terms' | 'recorded'; /** only an estimate until the owner confirms it */ estimated: boolean }

/**
 * The contract dates in force. With no lifecycle records this is exactly the B2 list. A recorded trial or renewal replaces the matching B2 date
 * (unless it is in dispute, then the B2 date stays). Only ONE cancel-by (notice) date is kept at a time so one Task never stands for two. A date later than
 * the confirmed cancellation is dropped. A trial whose end is also the cancel-by date is one deadline, not two.
 */
export function effectiveDeadlines(terms: Terms, v: LifecycleView, today: string): EffDeadline[] {
  const out: EffDeadline[] = [];
  const trialEnd = v.trial.endsOn ?? terms.trialEndsOn;
  const trialRecorded = v.trial.endsOn !== null;
  // a cancel-by date recorded with the ORIGINAL trial end is stale once the trial was extended, so it is used only while the end date is unchanged
  const tf = v.trial.fact && v.trial.fact.body.endsOn === v.trial.endsOn ? v.trial.fact.body : undefined;
  const tOutcome = v.trial.outcome;
  const trialOpen = trialEnd !== null && !tOutcome && !cancelEnded(v, trialEnd);
  const trialNotice = trialOpen && trialRecorded && tf?.mustCancel && tf.noticeBy ? tf.noticeBy : null;
  if (trialEnd && !tOutcome) out.push({ kind: 'trial', date: trialEnd, action: !(trialNotice && trialNotice < trialEnd), source: trialRecorded ? 'recorded' : 'terms', estimated: false });
  const rf = v.renewal.fact?.body;
  const renewalDate = rf ? rf.renewalDate : terms.renewalDate;
  if (renewalDate) out.push({ kind: 'renewal', date: renewalDate, action: !!rf && rf.auto === false, source: rf ? 'recorded' : 'terms', estimated: !!rf && !rf.confirmed });
  const renNotice = rf ? rf.noticeByDate ?? (rf.noticeDays !== null ? addDays(rf.renewalDate, -rf.noticeDays) : null) ?? terms.noticeByDate : terms.noticeByDate;
  const notice = trialNotice && trialNotice >= today ? trialNotice : renNotice ?? trialNotice;
  if (notice) out.push({ kind: 'notice', date: notice, action: true, source: trialNotice === notice || rf ? 'recorded' : 'terms', estimated: !!rf && !rf.confirmed && rf.noticeByDate === null });
  const cut = v.cutoffOn;
  return out
    .filter((d) => !(cut !== null && d.date > cut))
    // a trial that ends on the cancel-by day is one action: keep the trial deadline and drop the duplicate notice
    .filter((d) => !(d.kind === 'notice' && out.some((o) => o.kind === 'trial' && o.date === d.date && o.action)))
    .sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind));
}

/** True when the trial would end after a confirmed cancellation took effect (the trial is moot). */
const cancelEnded = (v: LifecycleView, date: string) => v.cutoffOn !== null && v.cutoffOn < date;

// ---- renewals ----

const STEP: Record<Cadence, { months?: number; days?: number } | null> = { weekly: { days: 7 }, monthly: { months: 1 }, quarterly: { months: 3 }, annual: { months: 12 }, other: null, unknown: null };

/** Expected renewal dates from `from` to `to` (both included): the recorded renewal date, then the cadence repeated. Derived on demand, never stored. Stops at a confirmed cancellation. */
export function renewalDates(v: LifecycleView, from: string, to: string, cap = 400): string[] {
  const f = v.renewal.fact?.body;
  if (!f) return [];
  const step = STEP[f.cadence];
  const out: string[] = [];
  const stop = v.cutoffOn !== null && v.cutoffOn < to ? v.cutoffOn : to;
  for (let k = 0; k < cap; k++) {
    const d = k === 0 ? f.renewalDate : step ? (step.months ? addMonths(f.renewalDate, k * step.months) : addDays(f.renewalDate, k * (step.days ?? 7))) : null;
    if (d === null || d > stop) break;
    if (d >= from) out.push(d);
    if (!step) break;
  }
  return out;
}

// ---- prices ----

export const priceStepOn = (v: LifecycleView, baseline: PriceStep[], date: string): PriceStep | null => {
  let hit: PriceStep | null = null;
  for (const p of v.prices.length ? v.prices : baseline) if (p.from <= date) hit = p;
  return hit;
};
/** The next price change after `today`: the first step starting later. */
export const nextPriceChange = (v: LifecycleView, today: string): PriceStep | null => v.prices.find((s) => s.from > today) ?? null;

// ---- states ----

export type StateId = 'review' | 'ended' | 'cancel-effective' | 'cancel-confirmed' | 'cancel-requested' | 'cancel-planned' | 'trial' | 'trial-check' | 'renewal-check' | 'renewal-soon';
export interface StateFlag { id: StateId; label: string; detail: string; tone: 'warn' | 'info' | 'calm' }
export interface StateInput { status: 'active' | 'paused' | 'ended' | 'unsupported'; endedOn: string | null }

/**
 * The lifecycle states that hold TODAY, derived from recorded evidence, most important first. Several can hold at once (it can be active, in trial,
 * and have a cancellation pending). None of them is stored, and none is a claim about what the provider has done.
 */
export function lifecycleStates(v: LifecycleView, terms: Terms, ob: StateInput, today: string): StateFlag[] {
  const out: StateFlag[] = [];
  const c = v.cancel;
  if (v.conflicts.some((x) => !x.acknowledged)) out.push({ id: 'review', label: 'Needs review', detail: 'The records about this subscription disagree or could not be read. Nothing was changed.', tone: 'warn' });
  if (ob.status === 'ended') out.push({ id: 'ended', label: ob.endedOn ? `Ended ${ob.endedOn}` : 'Ended', detail: 'You marked it ended. History and payments are kept.', tone: 'calm' });
  if (c.confirm && c.confirm.body.effectiveOn <= today && ob.status !== 'ended') out.push({ id: 'cancel-effective', label: `Cancellation effective ${c.confirm.body.effectiveOn}`, detail: 'The confirmed effective date has arrived, so no further bills are expected. Final charges and refunds can still be recorded. Nothing was ended for you: mark it ended when you are ready.', tone: 'info' });
  else if (c.confirm && ob.status !== 'ended') out.push({ id: 'cancel-confirmed', label: `Cancellation confirmed, effective ${c.confirm.body.effectiveOn}`, detail: `Service is expected to continue until then${c.confirm.body.accessUntil ? ` (access to ${c.confirm.body.accessUntil})` : ''}. Expected bills stop after that day.`, tone: 'info' });
  else if (c.request) out.push({ id: 'cancel-requested', label: c.request.body.awaiting ? 'Cancellation requested, confirmation pending' : 'Cancellation requested', detail: `You recorded a request on ${c.request.body.requestedOn}. It is still active, and a request is not proof the provider accepted it.`, tone: 'warn' });
  else if (c.plan) out.push({ id: 'cancel-planned', label: 'Cancellation planned', detail: `You intend to cancel${c.plan.body.plannedOn ? ` around ${c.plan.body.plannedOn}` : ''}. You have not recorded asking the provider.`, tone: 'info' });
  const te = v.trial.endsOn ?? terms.trialEndsOn;
  if (te && !v.trial.outcome && ob.status === 'active' && !(v.cutoffOn !== null && v.cutoffOn < te)) {
    if (te >= today) out.push({ id: 'trial', label: `In trial until ${te}`, detail: 'Ledger does not know whether it will convert to a paid plan.', tone: 'info' });
    else if (daysUntil(te, today) >= -PASSED_WINDOW_DAYS && !v.acked.has(ackKeyTrial(te))) out.push({ id: 'trial-check', label: `Trial ended ${te}: conversion not confirmed`, detail: 'Ledger did not convert anything and does not know whether it became a paid plan. Record what happened.', tone: 'warn' });
  }
  const deadlines = effectiveDeadlines(terms, v, today);
  const ren = deadlines.find((d) => d.kind === 'renewal');
  if (ren && ob.status === 'active') {
    const left = daysUntil(ren.date, today);
    const done = v.renewal.outcomes.some((o) => o.body.forDate === ren.date);
    if (left < 0 && left >= -PASSED_WINDOW_DAYS && !done && !v.acked.has(ackKeyRenewal(ren.date))) out.push({ id: 'renewal-check', label: `Renewal date ${ren.date} passed: not confirmed`, detail: 'Ledger did not renew anything and does not know whether it renewed. Record what happened.', tone: 'warn' });
    else if (left >= 0 && left <= SOON_DAYS) out.push({ id: 'renewal-soon', label: `Renewal expected ${ren.date}`, detail: ren.estimated ? 'The date is an estimate.' : 'Ledger does not renew anything.', tone: 'info' });
  }
  return out;
}
export const ackKeyTrial = (date: string) => `trial|${date}`;
export const ackKeyRenewal = (date: string) => `renewal|${date}`;
export const ackKeyAwaiting = (requestId: number) => `awaiting|${requestId}`;

/** The one-line state for a header chip: the first of the list, or Active. */
export const primaryState = (flags: StateFlag[], status: StateInput['status']): { label: string; tone: StateFlag['tone'] } =>
  flags.length ? { label: flags[0].label, tone: flags[0].tone } : { label: status === 'paused' ? 'Paused' : status === 'ended' ? 'Ended' : 'Active', tone: 'calm' };

// ---- timeline ----

export interface TimelineEntry { date: string; text: string; kind: 'recorded' | 'expected' | 'log'; /** the record this stands for */ recordId: number | null; /** replaced or negated, kept as history */ muted: boolean }

/** A readable history: what was RECORDED (including replaced and withdrawn records, marked as such) and, clearly labelled, the dates still ahead. Nothing is invented to fill gaps. */
export function timeline(v: LifecycleView, log: { on: string; kind: string; note: string }[], money: (c: number) => string, today: string): TimelineEntry[] {
  const out: TimelineEntry[] = [];
  for (const r of v.records) {
    if (r.body === null) continue;
    const b = r.body;
    const m = v.replaced.has(r.id) || v.cancel.negated.has(r.id);
    const push = (date: string, text: string, kind: TimelineEntry['kind'] = 'recorded') => out.push({ date, text: m ? `${text} (${v.replaced.has(r.id) ? 'replaced by a later record' : 'withdrawn'})` : text, kind, recordId: r.id, muted: m });
    switch (b.fact) {
      case 'trial': if (b.startsOn) push(b.startsOn, 'Trial started'); push(b.endsOn, b.endsOn > today ? 'Trial ends (date you recorded)' : 'Trial end date', b.endsOn > today ? 'expected' : 'recorded'); break;
      case 'trial-extend': push(b.endsOn, `Trial extended to ${b.endsOn}`); break;
      case 'trial-outcome': push(b.on, b.outcome === 'converted' ? 'Trial converted to a paid plan' : b.outcome === 'cancelled' ? 'Cancelled during the trial' : 'Trial ended with no charge'); break;
      case 'price-step': push(b.from, `${b.status === 'unknown' ? 'Price not known' : `${b.status === 'estimated' ? 'Estimated price' : 'Price'} ${money(b.cents ?? 0)}`}${b.label ? ` (${b.label})` : ''} from this day${b.until ? ` until ${b.until}` : ''}`, b.from > today ? 'expected' : 'recorded'); break;
      case 'renewal': push(b.renewalDate, `Renewal ${b.confirmed ? 'date' : 'date (estimated)'}${b.cadence !== 'unknown' && b.cadence !== 'other' ? `, repeats ${b.cadence === 'annual' ? 'every year' : b.cadence === 'quarterly' ? 'every 3 months' : b.cadence}` : ''}`, b.renewalDate > today ? 'expected' : 'recorded'); break;
      case 'renewal-outcome': push(b.on, `Renewal of ${b.forDate}: ${b.outcome === 'renewed' ? 'you recorded it renewed' : b.outcome === 'not-renewed' ? 'you recorded it did not renew' : 'not sure'}`); break;
      case 'cancel-plan': push(b.plannedOn ?? dayOf(r.createdAt), 'You planned to cancel'); break;
      case 'cancel-request': push(b.requestedOn, `Cancellation requested${b.requestedEffectiveOn ? ` (asked for ${b.requestedEffectiveOn})` : ''}`); break;
      case 'cancel-confirm':
        push(b.confirmedOn, 'Cancellation confirmed');
        push(b.effectiveOn, b.effectiveOn > today ? 'Cancellation effective (confirmed date)' : 'Cancellation effective', b.effectiveOn > today ? 'expected' : 'recorded');
        break;
      case 'cancel-withdraw': push(b.on, b.kind === 'owner-retracted' ? 'You withdrew the cancellation' : b.kind === 'provider-rejected' ? 'The provider did not accept the cancellation' : 'The provider withdrew its confirmation'); break;
      case 'reactivate': push(b.on, 'Reactivated'); break;
      case 'service-link': push(b.on, b.action === 'linked' ? 'Linked to a Household Services arrangement' : 'Unlinked from a Household Services arrangement'); break;
      case 'ack': break;
    }
  }
  for (const l of log) out.push({ date: l.on, text: `${l.kind}${l.note ? ` (${l.note})` : ''}`, kind: 'log', recordId: null, muted: false });
  return out.sort((a, b) => a.date.localeCompare(b.date) || (a.recordId ?? 0) - (b.recordId ?? 0));
}
const dayOf = (ms: number) => localISO(ms);

export const DEADLINE_WORDS: Record<DeadlineKind, string> = DEADLINE_LABEL;
