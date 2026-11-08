/**
 * WRITING lifecycle records (B4): the guarded actions behind the trial, price, renewal and cancellation screens. Every action has the same shape:
 *
 *   1. `previewLifecycle`  reads only. It builds the records the action would add (the same pure `buildAction` the apply step uses), works out what that
 *                          changes (expected bills, dates, price, reminder Tasks), says what stays unchanged and what Finance would still need, and returns a TOKEN
 *                          that stands for the evidence it was built from.
 *   2. `applyLifecycle`    runs in ONE transaction: it re-reads the bill and its lifecycle records, REFUSES (writing nothing) if the token no longer matches (the
 *                          preview is stale: another device or another action changed something), rebuilds the records, writes them, keeps the bill's Tasks in step
 *                          through the existing Tasks planner, and returns a guarded Undo. An error anywhere rolls the whole action back.
 *
 * Records are ADDED, never edited. A correction is a new record that `replaces` the old one; a withdrawal `targets` what it negates. Nothing here writes a
 * Finance table, a Calendar event or a payment link, and nothing ends, renews, converts or cancels anything for the owner: the only change to the bill record
 * itself is the owner's own explicit choice ("also mark it ended", "reopen it"), made with the existing B1 end and reopen rules.
 */
import { db, type FinanceDB } from '../../db';
import type { ModuleRecord } from '../../core/entities';
import { repo } from '../../core/store';
import { addDays } from '../../lib/dates';
import { newId } from '../../lib/sync/track';
import { buildLifecycle, getObligation, tables, writeObligation } from './data';
import { cycleRecordsOf, createFollowUpTaskIn, ensureBillTasksIn, financeLookupFor, inBillsTx, loadBillTasks, markersOf, planBillTasks, planningPeriods } from './tasks';
import {
  LC_KIND, lcText, newLcData, readLifecycle, validateLc, CADENCES, WITHDRAW_LABEL, METHOD_LABEL,
  type Cadence, type Conversion, type FinalCharge, type LcBody, type LcRecord, type Method, type PriceSource, type PriceStatus, type RenewalChanges, type RenewalOutcome, type TrialOutcome, type WithdrawKind, type YesNo,
} from './lifecycleModel';
import { lifecycleRecordsOf, withLifecycle } from './lifecycleRead';
import { effectiveDeadlines, lcToken, lifecycleView, nextPriceChange, type LifecycleView } from './lifecycleState';
import { expectedAmountOn, scheduleSource, type ObligationData, type ObligationRecord } from './model';
import { expectedDates } from './schedule';
import { periodsOf } from './periods';
import { readTerms } from './terms';
import { Recorder, type Undo } from './undo';
import { NO_FINANCE } from './payments';

const STALE = 'Something changed since you opened this (maybe on another device, or in another window). Nothing was changed. Close it, look again and redo your change.';

// ---- the actions ----

export type LcAction =
  | { type: 'trial'; startsOn: string | null; endsOn: string; paymentOnFile: YesNo; conversion: Conversion; convertsToCents: number | null; cadence: Cadence; mustCancel: boolean; noticeBy: string | null; note: string; /** also record the trial price (zero) and the price after it */ makePrices: boolean }
  | { type: 'trial-extend'; endsOn: string; note: string }
  | { type: 'trial-outcome'; outcome: TrialOutcome; on: string; note: string }
  | { type: 'price'; from: string; until: string | null; cents: number | null; status: PriceStatus; label: string; source: PriceSource; note: string; /** ids of recorded prices this one corrects */ correct?: number[] }
  | { type: 'renewal'; renewalDate: string; cadence: Cadence; auto: boolean | null; noticeDays: number | null; noticeByDate: string | null; changes: RenewalChanges; confirmed: boolean; note: string }
  | { type: 'renewal-outcome'; forDate: string; outcome: RenewalOutcome; on: string; note: string; /** "renewed": the next renewal date */ next?: { renewalDate: string; cadence: Cadence; auto: boolean | null; noticeDays: number | null; noticeByDate: string | null; changes: RenewalChanges; confirmed: boolean } }
  | { type: 'cancel-plan'; plannedOn: string | null; note: string }
  | { type: 'cancel-request'; requestedOn: string; requestedEffectiveOn: string | null; method: Method; ref: string; awaiting: boolean; note: string; /** make one follow-up Task for this day */ followUpOn: string | null }
  | { type: 'cancel-confirm'; confirmedOn: string; effectiveOn: string; providerRef: string; finalCharge: FinalCharge; finalChargeCents: number | null; refundCents: number | null; accessUntil: string | null; note: string }
  | { type: 'cancel-withdraw'; on: string; kind: WithdrawKind; note: string; reopen: boolean }
  | { type: 'reactivate'; on: string; note: string; reopen: boolean }
  | { type: 'resolve'; conflictKey: string; chooseId: number }
  | { type: 'ack'; key: string };

export interface NewFact { body: LcBody; replaces: number[]; targets: number[] }
export interface Ctx { ob: ObligationRecord; records: LcRecord[]; today: string }
export interface Built { facts: NewFact[]; nextObligation: ObligationData | null; followUpOn: string | null; problem: string | null; /** the action starts partway through a billing period */ midPeriod: boolean }

const ids = (v: LifecycleView, f: LcBody['fact']) => v.effective.filter((r) => r.body.fact === f).map((r) => r.id);
const viewOf = (ctx: Ctx, extra: LcRecord[] = []) => lifecycleView({ obligationId: ctx.ob.id, baselinePrices: ctx.ob.data.prices, records: [...ctx.records, ...extra] });
const fact = (body: LcBody, replaces: number[] = [], targets: number[] = []): NewFact => ({ body, replaces, targets });

/** PURE: the records an action would add, and the bill change the owner asked for, or a plain-words problem. */
export function buildAction(ctx: Ctx, a: LcAction): Built {
  const v = viewOf(ctx);
  const d = ctx.ob.data;
  const out: Built = { facts: [], nextObligation: null, followUpOn: null, problem: null, midPeriod: false };
  const no = (problem: string): Built => ({ ...out, facts: [], problem });
  const txt = (s: string) => lcText(s);
  const add = (n: NewFact) => { out.facts.push({ ...n, body: n.body }); };
  const chainIds = [...ids(v, 'trial'), ...ids(v, 'trial-extend')];
  const noCancelLeft = v.cancel.requests.length === 0 && v.cancel.confirms.length === 0 && !v.cancel.plan;

  switch (a.type) {
    case 'trial': {
      if (d.status !== 'active') return no('Only an active bill can have a trial recorded. Reopen it first.');
      const trial: LcBody = { fact: 'trial', startsOn: a.startsOn, endsOn: a.endsOn, paymentOnFile: a.paymentOnFile, conversion: a.conversion, convertsToCents: a.convertsToCents, cadence: a.cadence, mustCancel: a.mustCancel, noticeBy: a.noticeBy, note: txt(a.note) };
      add(fact(trial, chainIds));
      if (a.makePrices) {
        // a trial is a zero price until it ends, then the conversion price (an unknown price after it is recorded as unknown, never as zero)
        const from = a.startsOn ?? ctx.today;
        const existing = v.priceRows.filter((r) => r.origin !== 'gap' && r.origin !== 'conflict');
        const after = addDays(a.endsOn, 1);
        if (existing.some((r) => r.from === from) || existing.some((r) => r.from === after)) return no('A price is already recorded for one of those days. Record the trial without prices, or correct the price first.');
        add(fact({ fact: 'price-step', from, until: a.endsOn, cents: 0, status: 'fixed', label: 'free trial', source: 'owner', note: '' }));
        add(fact({ fact: 'price-step', from: after, until: null, cents: a.convertsToCents, status: a.convertsToCents === null ? 'unknown' : 'fixed', label: 'after the trial', source: 'owner', note: '' }));
      }
      break;
    }
    case 'trial-extend': {
      if (!(v.trial.endsOn ?? readTerms(d.terms).trialEndsOn)) return no('There is no trial to extend. Record the trial first.');
      if (v.trial.outcome) return no('An outcome is already recorded for this trial. Record a new trial instead.');
      add(fact({ fact: 'trial-extend', endsOn: a.endsOn, note: txt(a.note) }, chainIds));
      break;
    }
    case 'trial-outcome': add(fact({ fact: 'trial-outcome', outcome: a.outcome, on: a.on, note: txt(a.note) }, ids(v, 'trial-outcome'))); break;
    case 'price': {
      const same = v.priceRows.filter((r) => r.from === a.from && r.origin === 'baseline');
      if (same.length) return no('The first price on the bill already starts on that day. Pick another day, or change the first price with Edit.');
      const dup = v.priceRows.filter((r) => r.from === a.from && r.origin === 'recorded' && r.recordId !== null);
      const correct = [...new Set([...(a.correct ?? []), ...dup.map((r) => r.recordId as number)])];
      add(fact({ fact: 'price-step', from: a.from, until: a.until, cents: a.status === 'unknown' ? null : a.cents, status: a.status, label: txt(a.label).slice(0, 60), source: a.source, note: txt(a.note) }, correct));
      break;
    }
    case 'renewal': add(fact({ fact: 'renewal', renewalDate: a.renewalDate, cadence: a.cadence, auto: a.auto, noticeDays: a.noticeDays, noticeByDate: a.noticeByDate, changes: a.changes, confirmed: a.confirmed, note: txt(a.note) }, ids(v, 'renewal'))); break;
    case 'renewal-outcome': {
      add(fact({ fact: 'renewal-outcome', forDate: a.forDate, outcome: a.outcome, on: a.on, note: txt(a.note) }, v.renewal.outcomes.filter((o) => o.body.forDate === a.forDate).map((o) => o.id)));
      if (a.outcome === 'renewed' && a.next) add(fact({ fact: 'renewal', ...a.next, note: '' }, ids(v, 'renewal')));
      break;
    }
    case 'cancel-plan': add(fact({ fact: 'cancel-plan', plannedOn: a.plannedOn, note: txt(a.note) }, ids(v, 'cancel-plan'))); break;
    case 'cancel-request': {
      if (d.status === 'ended') return no('This bill is already ended. Reopen it first if you want to record a new cancellation request.');
      add(fact({ fact: 'cancel-request', requestedOn: a.requestedOn, requestedEffectiveOn: a.requestedEffectiveOn, method: a.method, ref: txt(a.ref).slice(0, 40), awaiting: a.awaiting, note: txt(a.note) }, v.cancel.requests.map((r) => r.id)));
      out.followUpOn = a.followUpOn;
      break;
    }
    case 'cancel-confirm': {
      add(fact({ fact: 'cancel-confirm', confirmedOn: a.confirmedOn, effectiveOn: a.effectiveOn, providerRef: txt(a.providerRef).slice(0, 40), finalCharge: a.finalCharge, finalChargeCents: a.finalCharge === 'expected' ? a.finalChargeCents : null, refundCents: a.refundCents, accessUntil: a.accessUntil, note: txt(a.note) }, v.cancel.confirms.map((c) => c.id)));
      // B4 pre-commit correction: a confirmation NEVER changes the stored status. It is evidence; the stored B1 status stays as it is, the effective date decides what is
      // expected, and ending the bill is the separate, previewed End workflow (offered once the effective date has arrived).
      break;
    }
    case 'cancel-withdraw': case 'reactivate': {
      const targets = [...v.cancel.requests.map((r) => r.id), ...v.cancel.confirms.map((c) => c.id), ...(v.cancel.plan ? [v.cancel.plan.id] : [])];
      if (targets.length === 0 && !(a.type === 'reactivate' && d.status === 'ended')) return no(noCancelLeft ? 'There is no cancellation on record to withdraw.' : 'There is nothing to withdraw.');
      add(fact(a.type === 'reactivate' ? { fact: 'reactivate', on: a.on, note: txt(a.note) } : { fact: 'cancel-withdraw', on: a.on, kind: a.kind, note: txt(a.note) }, [], targets));
      if (a.reopen && d.status === 'ended') {
        const re = buildLifecycle(d, 'reopen', { today: ctx.today, date: a.on });
        if (!re.next) return no(re.problem ?? 'It cannot be reopened.');
        out.nextObligation = re.next;
      }
      break;
    }
    case 'ack': add(fact({ fact: 'ack', key: a.key, on: ctx.today })); break;
    case 'resolve': {
      const c = v.conflicts.find((x) => x.key === a.conflictKey);
      if (!c) return no('That disagreement is no longer there. Nothing was changed.');
      if (c.kind === 'unreadable' || c.kind === 'price-overlap') return no('This one cannot be fixed by choosing one record. Correct the price dates, or leave it as it is.');
      const chosen = v.effective.find((r) => r.id === a.chooseId && c.ids.includes(r.id));
      if (!chosen) return no('Pick one of the records that disagree.');
      if (c.kind === 'withdraw-vs-evidence') {
        const neg = chosen.body.fact === 'cancel-withdraw' || chosen.body.fact === 'reactivate';
        add(fact(chosen.body, neg ? [chosen.id] : c.ids, neg ? [...v.cancel.requests.map((r) => r.id), ...v.cancel.confirms.map((r) => r.id)] : []));
        break;
      }
      if (c.kind === 'price-same-date' && v.priceRows.some((r) => r.origin === 'baseline' && c.ids.length && r.from === (chosen.body.fact === 'price-step' ? chosen.body.from : ''))) return no('One of these is the first price on the bill. To use the other one, change the first price with Edit; to keep this one, correct or replace the other record.');
      add(fact(chosen.body, c.ids));
      break;
    }
  }
  for (const f of out.facts) { const p = validateLc(f.body); if (p) return no(p); }
  if (a.type === 'price') {
    const nominals = expectedDates(scheduleSource(d), addDays(a.from, -400), addDays(a.from, 400)).map((e) => e.nominal);
    out.midPeriod = !!d.schedule && !nominals.includes(a.from);
  }
  return out;
}

// ---- the preview ----

export interface LcPreview { problem: string | null; lines: string[]; /** things worth a closer look, not blockers */ warnings: string[]; token: string; midPeriod: boolean; built: Built }

const n = (c: number, one: string, many: string) => `${c} ${c === 1 ? one : many}`;
const upcomingIn = (data: ObligationData, from: string) => expectedDates(scheduleSource(data), from, addDays(from, 365)).length;

/** Reads only. Says what an action records, what it changes, what stays as it is and how to take it back. */
export async function previewLifecycle(obligationId: number, a: LcAction, today: string, money: (c: number) => string, d: FinanceDB = db): Promise<LcPreview> {
  const ob = await getObligation(obligationId, d);
  if (!ob) throw new Error('That bill no longer exists.');
  const records = await lifecycleRecordsOf(obligationId, d);
  const token = `${ob.updatedAt}|${lcToken(records)}`;
  const ctx: Ctx = { ob, records, today };
  const built = buildAction(ctx, a);
  const empty = (problem: string): LcPreview => ({ problem, lines: [], warnings: [], token, midPeriod: false, built });
  if (built.problem) return empty(built.problem);

  // the world after the action, built from the same records
  const fake = built.facts.map((f, i): LcRecord => readLifecycle({ id: Number.MAX_SAFE_INTEGER - 1000 + i, module: 'bills', kind: LC_KIND, data: newLcData(obligationId, f.body, { replaces: f.replaces, targets: f.targets, seen: records.map((r) => r.id) }), createdAt: Date.now(), updatedAt: Date.now(), deletedAt: null } as ModuleRecord));
  const afterView = viewOf(ctx, fake);
  const afterData: ObligationData = { ...(built.nextObligation ?? ob.data), lc: afterView };
  const afterOb: ObligationRecord = { ...ob, data: afterData };
  const before = ob.data;
  const terms = readTerms(before.terms);
  const lines: string[] = [];
  const warnings: string[] = [];
  const unchanged = ['Nothing in Finance changes, and no bill or payment you recorded is changed or hidden.'];

  switch (a.type) {
    case 'trial':
      lines.push(`Record a trial${a.startsOn ? ` from ${a.startsOn}` : ''} ending ${a.endsOn}. Conversion: ${a.conversion === 'auto' ? 'automatic' : a.conversion === 'manual' ? 'you would have to choose it' : 'not known'}. Payment method on file: ${a.paymentOnFile === 'yes' ? 'yes' : a.paymentOnFile === 'no' ? 'no' : 'not known'}.`);
      lines.push(a.convertsToCents === null ? 'The price after the trial is recorded as unknown. It is never treated as zero.' : `Expected price after the trial: ${money(a.convertsToCents)} (${CADENCES.includes(a.cadence) && a.cadence !== 'unknown' ? a.cadence : 'billing pattern from the bill'}). This is an expectation, not a payment.`);
      if (a.makePrices) lines.push('Two price steps are recorded with it: no charge during the trial, then the price after it.');
      lines.push('Ledger will never assume the trial turned into a paid plan because its end date passed. You will be asked what happened.');
      break;
    case 'trial-extend': lines.push(`The trial now ends ${a.endsOn}. The earlier end date stays in the history, marked as replaced.`); break;
    case 'trial-outcome': lines.push(`Record that the trial ${a.outcome === 'converted' ? 'converted to a paid plan' : a.outcome === 'cancelled' ? 'was cancelled' : 'ended with no charge'} on ${a.on}. This is a record of what you know. Ledger makes no payment and expects none by itself.`); break;
    case 'price': {
      const cur = expectedAmountOn({ amountKind: before.amountKind, prices: before.prices, lc: before.lc }, a.from);
      lines.push(a.status === 'unknown' ? `From ${a.from} the price is recorded as not known. It is not treated as zero, and expected amounts from then read "not known".` : `From ${a.from}${a.until ? ` until ${a.until}` : ''}: ${money(a.cents ?? 0)}${a.status === 'estimated' ? ' (an estimate)' : ''}${cur.cents !== null && a.cents !== null ? ` (was ${money(cur.cents)}; ${a.cents >= cur.cents ? '+' : '-'}${money(Math.abs(a.cents - cur.cents))} per bill)` : ''}.`);
      const win = expectedDates(scheduleSource(before), a.from, addDays(a.from, 364));
      const changed = win.filter((e) => JSON.stringify(expectedAmountOn(before, e.nominal)) !== JSON.stringify(expectedAmountOn(afterData, e.nominal)));
      if (changed.length) {
        const yearly = changed.reduce((s, e) => { const o = expectedAmountOn(before, e.nominal).cents, nx = expectedAmountOn(afterData, e.nominal).cents; return s + (o !== null && nx !== null ? nx - o : 0); }, 0);
        lines.push(`${n(changed.length, 'expected bill changes', 'expected bills change')} in the 12 months from ${a.from}, starting with the one dated ${changed[0].nominal}.${yearly !== 0 && a.status !== 'unknown' ? ` Over those, about ${yearly > 0 ? '+' : '-'}${money(Math.abs(yearly))}.` : ''}`);
      } else lines.push('No expected bill in the next 12 months changes (no bill is dated on or after that day).');
      const cyc = await cycleRecordsOf(obligationId, d);
      const recorded = periodsOf(afterOb, cyc, today, { from: a.from, to: addDays(a.from, 365) }, { allRecorded: true, lookup: NO_FINANCE }).filter((p) => p.amounts.invoiceRecorded && p.timing.date !== null && p.timing.date >= a.from);
      if (recorded.length) lines.push(`${n(recorded.length, 'billing period', 'billing periods')} from that day already ${recorded.length === 1 ? 'has' : 'have'} a bill you recorded. Those amounts are NOT changed by a price: a price only changes what is expected.`);
      if (built.midPeriod) warnings.push('This starts partway between two billing dates. Ledger uses the new price from the first bill dated on or after it. If your provider also charges a partial-period difference, record it as an extra bill on that period; Ledger never rewrites a bill you already recorded.');
      if (a.until) warnings.push(`After ${a.until} the price reads as unknown until you record the next one.`);
      break;
    }
    case 'renewal': lines.push(`Renewal ${a.confirmed ? 'on' : 'expected around'} ${a.renewalDate}${a.cadence !== 'unknown' && a.cadence !== 'other' ? `, repeating ${a.cadence === 'annual' ? 'every year' : a.cadence === 'quarterly' ? 'every 3 months' : a.cadence}` : ''}. ${a.auto === false ? 'You said you have to renew it yourself, so a reminder Task is made for a decision.' : a.auto === true ? 'It renews by itself. Ledger renews nothing and records no payment.' : 'Whether it renews by itself is not known.'}${a.changes !== 'none' && a.changes !== 'unknown' ? ` It may change the ${a.changes === 'both' ? 'price and terms' : a.changes}; record the new price as a price change when you know it.` : ''}`); break;
    case 'renewal-outcome': lines.push(`Record that the renewal of ${a.forDate} ${a.outcome === 'renewed' ? 'happened' : a.outcome === 'not-renewed' ? 'did not happen' : 'is not clear'}. This is a note of what you know; it is not payment evidence.`); if (a.next) lines.push(`The next renewal is expected ${a.next.renewalDate}.`); break;
    case 'cancel-plan': lines.push('Record that you plan to cancel. This is a note to yourself: nothing was sent to the provider and the subscription stays active.'); break;
    case 'cancel-request': lines.push(`Record that you asked to cancel on ${a.requestedOn} by ${METHOD_LABEL[a.method].toLowerCase()}${a.requestedEffectiveOn ? `, asking for ${a.requestedEffectiveOn}` : ''}. Ledger is only recording your request. It does not contact the provider, and a request is not proof the provider accepted it.`); lines.push('The subscription stays active. Expected bills, reminders and payment information stay as they are until there is a confirmation.'); if (a.followUpOn) lines.push(`One follow-up Task will be made for ${a.followUpOn}.`); break;
    case 'cancel-confirm': {
      const stillExpected = expectedDates(scheduleSource(before), today, a.effectiveOn).length;
      lines.push(`Record that the provider confirmed the cancellation on ${a.confirmedOn}, effective ${a.effectiveOn}${a.effectiveOn === a.confirmedOn ? ' (immediately)' : ''}. Service is not shown as ended before ${a.effectiveOn}${a.accessUntil ? `; you noted access continues to ${a.accessUntil}` : ''}.`);
      lines.push(`${n(stillExpected, 'expected bill is', 'expected bills are')} still counted up to and including ${a.effectiveOn}. ${n(Math.max(0, upcomingIn(before, today) - upcomingIn(afterData, today)), 'expected bill', 'expected bills')} after that day in the next 12 months stop being expected. Bills and payments already recorded stay.`);
      if (a.finalCharge === 'expected' && a.finalChargeCents !== null) lines.push(`A final charge of about ${money(a.finalChargeCents)} is noted as expected. It is a note, not a payment, and it is used only to avoid a false alarm.`);
      if (a.refundCents !== null) lines.push(`A refund of about ${money(a.refundCents)} is noted as expected. Ledger does not create a refund; link the money when it arrives.`);
      lines.push('The bill\'s status is not changed: it stays as it is until you choose End yourself (that is a separate step with its own preview).');
      if (before.scheduledRuleIds.length) warnings.push('Your Finance scheduled payment is not changed. If it should stop, do that on the Scheduled page.');
      break;
    }
    case 'cancel-withdraw': lines.push(`Record that the cancellation was withdrawn (${WITHDRAW_LABEL[a.kind].toLowerCase()}) on ${a.on}. The earlier request and confirmation stay in the history, marked as withdrawn, and expected bills carry on.`); if (built.nextObligation) lines.push('The bill is reopened, as you chose.'); break;
    case 'reactivate': lines.push(`Record that the subscription was reactivated on ${a.on}. The cancellation records stay in the history, marked as withdrawn, and expected bills carry on.`); if (built.nextObligation) lines.push('The bill is reopened, as you chose.'); break;
    case 'ack': lines.push('Leave this as it is. It will not be raised again unless the evidence changes. Nothing is changed or resolved.'); break;
    case 'resolve': lines.push('Use the record you picked. The others are kept in the history, marked as replaced.'); break;
  }

  // dates and reminders
  const viewBefore = before.lc ?? viewOf(ctx);
  const dlBefore = effectiveDeadlines(terms, viewBefore, today);
  const dlAfter = effectiveDeadlines(terms, afterView, today);
  const key = (x: { kind: string; date: string }) => `${x.kind}|${x.date}`;
  const nameOf: Record<string, string> = { notice: 'The last day to cancel or give notice', trial: 'The trial end', renewal: 'The renewal' };
  for (const x of dlAfter) if (!dlBefore.some((y) => key(y) === key(x))) lines.push(`${nameOf[x.kind]} is shown on ${x.date}.`);
  for (const x of dlBefore) if (!dlAfter.some((y) => key(y) === key(x))) lines.push(`${nameOf[x.kind]} on ${x.date} is no longer shown.`);
  const nextBefore = nextPriceChange(viewBefore, today), nextAfter = nextPriceChange(afterView, today);
  if (a.type !== 'price' && JSON.stringify(nextBefore) !== JSON.stringify(nextAfter) && nextAfter) lines.push(`The next price change is from ${nextAfter.from}.`);
  const tasks = (await loadBillTasks(d)).filter((t) => markersOf(t)?.obligation === obligationId);
  const lookup = await financeLookupFor(d, [obligationId]);
  const cyc = await cycleRecordsOf(obligationId, d);
  const planBefore = planBillTasks(ob, planningPeriods(ob, cyc, today, lookup), tasks, today);
  const planAfter = planBillTasks(afterOb, planningPeriods(afterOb, cyc, today, lookup), tasks, today);
  const createdNew = planAfter.create.filter((w) => !planBefore.create.some((x) => x.purpose === w.purpose && x.deadline === w.deadline && x.cycle === w.cycle));
  for (const w of createdNew) lines.push(`A reminder Task will be made: "${w.title}", for ${w.doOn}.`);
  const retire = planAfter.retire.filter((id) => !planBefore.retire.includes(id));
  if (retire.length) lines.push(`${n(retire.length, 'reminder Task that Bills made and you have not changed will be removed', 'reminder Tasks that Bills made and you have not changed will be removed')} because ${retire.length === 1 ? 'it stands' : 'they stand'} for something no longer expected. Undo brings ${retire.length === 1 ? 'it' : 'them'} back.`);
  const staleNew = planAfter.stale.filter((id) => !planBefore.stale.includes(id));
  if (staleNew.length) lines.push(`${n(staleNew.length, 'reminder Task you changed stays open and will be listed for a look', 'reminder Tasks you changed stay open and will be listed for a look')}. ${staleNew.length === 1 ? 'It is' : 'They are'} not removed.`);
  if (a.type === 'cancel-request') lines.push('Reminder Tasks already made are not stopped because you recorded a request. Finish them when you are ready.');
  lines.push(...unchanged);
  lines.push('You can undo this right after, and any record can be corrected later by recording a new one (the old one stays in the history).');
  return { problem: null, lines, warnings, token, midPeriod: built.midPeriod, built };
}

// ---- the apply ----

export interface LcApplied { undo: Undo; ids: number[]; taskIds: number[] }

/** Applies an action in ONE transaction, refusing (writing nothing) if the evidence changed since the preview (`token`). Returns a guarded Undo. */
export function applyLifecycle(obligationId: number, a: LcAction, token: string, today: string, d: FinanceDB = db, hooks: { afterWrite?: (d: FinanceDB) => Promise<void> } = {}): Promise<LcApplied> {
  return inBillsTx(d, tables(d), [obligationId], async (lookup) => {
    const ob = await getObligation(obligationId, d);
    if (!ob) throw new Error('That bill no longer exists. Nothing was changed.');
    const records = await lifecycleRecordsOf(obligationId, d);
    if (`${ob.updatedAt}|${lcToken(records)}` !== token) throw new Error(STALE);
    const built = buildAction({ ob, records, today }, a);
    if (built.problem) throw new Error(built.problem);
    const rec = new Recorder();
    const store = repo<ModuleRecord>(d.moduleRecords);
    const seen = records.map((r) => r.id);
    // ids are time-based; a correction counts only when it is LATER than what it corrects, so never start below the latest record of this bill
    let floor = records.reduce((m, r) => Math.max(m, r.id), 0);
    const written: number[] = [];
    for (const f of built.facts) {
      const id = Math.max(newId(), floor + 1);
      floor = id;
      await store.put({ id, module: 'bills', kind: LC_KIND, data: newLcData(obligationId, f.body, { replaces: f.replaces, targets: f.targets, seen }) });
      rec.made(id);
      written.push(id);
    }
    if (built.nextObligation) { await rec.capture(obligationId, d); await writeObligation(obligationId, built.nextObligation, d); }
    const taskIds: number[] = [];
    if (built.followUpOn) { const t = await createFollowUpTaskIn(obligationId, built.followUpOn, today, d, rec); if (t !== null) taskIds.push(t); }
    if (hooks.afterWrite) await hooks.afterWrite(d); // a test seam: throwing here must roll everything back
    const ens = await ensureBillTasksIn(obligationId, today, d, lookup, rec);
    taskIds.push(...ens.created);
    return { undo: await rec.seal(d), ids: written, taskIds };
  });
}

/** "Leave as is" on a review item: records that this exact evidence was looked at. Raised again only if the evidence changes. */
export async function acknowledgeEvidence(obligationId: number, key: string, today: string, d: FinanceDB = db): Promise<{ undo: Undo }> {
  const ob = await getObligation(obligationId, d);
  if (!ob) throw new Error('That bill no longer exists. Nothing was changed.');
  const records = await lifecycleRecordsOf(obligationId, d);
  const r = await applyLifecycle(obligationId, { type: 'ack', key }, `${ob.updatedAt}|${lcToken(records)}`, today, d);
  return { undo: r.undo };
}

export { withLifecycle };
