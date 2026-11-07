/**
 * BILLING PERIODS (B2). PURE: no database, no clock. A period is one obligation plus one slot. It is never stored: it is worked out on demand
 * from the obligation's schedule (the EXPECTED periods) and the sparse fact records (what the household RECORDED). Nothing here creates a
 * Task, a Calendar event or a future fact, so no future occurrence is ever pre-created.
 *
 * For each period the module derives, separately and in this order: its facts (effective = readable and not superseded), its timing date
 * and class (timing.ts), its amounts (amounts.ts), and its one primary label (labels.ts). Disagreeing facts are never silently merged:
 *   - two different invoice amounts => owed is unknown, never one of them
 *   - two different due dates => timing is "unclear", never one of them
 *   - a skip together with a payment record => the payment counts and the skip is ignored for the label
 */
import { addDays } from '../../lib/dates';
import { deriveAmounts, declared, paymentEvidence, type Amounts } from './amounts';
import { NO_FINANCE } from './payments';
import type { TxnLookup } from '../../lib/txnRef';
import { dueDateOf, isEffective, isReadable, type CycleRecord, type FactBody } from './cycleModel';
import { expectedAmountOn, scheduleSource, type ObligationRecord } from './model';
import { expectedDates } from './schedule';
import { scheduleProduces } from './slots';
import { deriveTiming, type Timing } from './timing';
import { OPEN_LABELS, primaryLabel, type LabelId } from './labels';

type Eff = CycleRecord & { body: FactBody; obligationId: number; slot: string };

export interface Period {
  obligationId: number;
  slot: string;
  /** The date the schedule in force gives this period, or null when no schedule produces it (an extra bill, or a period left behind by a schedule change). */
  nominal: string | null;
  /** The current expected-dates reader produces it (tracking start, pauses and end date honoured). */
  expected: boolean;
  /** It holds records but no schedule produces its slot: shown under "From an earlier schedule". Never an extra bill. */
  fromEarlier: boolean;
  isExtra: boolean;
  /** Every record about this period, readable or not, newest first. */
  records: CycleRecord[];
  /** Readable and not superseded. These are the only records any figure uses. */
  effective: Eff[];
  superseded: CycleRecord[];
  unreadable: CycleRecord[];
  timing: Timing;
  amounts: Amounts;
  declared: boolean;
  /** An effective skip record exists. */
  skipped: boolean;
  /** A skip AND payment evidence are both recorded: the payment counts, the skip is ignored for the label. */
  skipVsPayment: boolean;
  /** B3: an explicit declaration that live Finance contradicts (a linked payment is missing, changed in structure or reversed, and nothing is counted). */
  suspended: boolean;
  label: LabelId;
  /** The label is one of the "still open" ones: money may still be owed, or its payment is not confirmed. */
  open: boolean;
}

const newestFirst = (a: CycleRecord, b: CycleRecord) => b.createdAt - a.createdAt || b.id - a.id;

/** Derives one period from its records. `nominal` is the schedule date for the slot (or null). */
export function derivePeriod(ob: ObligationRecord, slot: string, nominal: string | null, expected: boolean, records: CycleRecord[], today: string, lookup: TxnLookup = NO_FINANCE): Period {
  const recs = [...records].sort(newestFirst);
  const effective = recs.filter(isEffective) as Eff[];
  const superseded = recs.filter((r) => isReadable(r) && r.supersededBy !== null);
  const unreadable = recs.filter((r) => r.body === null);
  const dueDates = effective.flatMap((f) => { const x = dueDateOf(f.body); return x ? [x] : []; });
  const timing = deriveTiming(dueDates, nominal, today);
  const exp = nominal ? expectedAmountOn(ob.data, nominal) : null;
  const amounts = deriveAmounts(effective, exp, lookup);
  const decl = declared(effective);
  const fin = amounts.finance;
  // B0 C1/C2: a declaration never silently overrides live Finance. When the linked payments count for nothing because one is missing, changed in
  // structure or reversed, the declaration is suspended (kept, shown, not relied on) until the owner looks.
  const suspended = decl && !!fin && fin.paidCents <= 0 && (fin.counts.review > 0 || fin.reversed);
  const evidence = amounts.paid > 0 || decl || paymentEvidence(effective);
  const skipRecorded = effective.some((f) => f.body.fact === 'skip');
  const skipVsPayment = skipRecorded && evidence;
  const label = primaryLabel({
    skip: skipRecorded, owed: amounts.owed, owedFromBill: amounts.basis === 'billed', paid: amounts.paid, remaining: amounts.remaining, declared: decl, suspended,
    fromFinance: amounts.source === 'finance', declaredFull: effective.some((f) => f.body.fact === 'paid-in-full'),
    timing: timing.class, days: timing.days, how: ob.data.payment.how, invoiceRecorded: amounts.invoiceRecorded,
  });
  const isExtra = slot.startsWith('x');
  return {
    obligationId: ob.id, slot, nominal, expected, fromEarlier: !isExtra && nominal === null && recs.length > 0, isExtra,
    records: recs, effective, superseded, unreadable, timing, amounts, declared: decl, skipped: skipRecorded && !evidence, skipVsPayment, suspended, label,
    open: OPEN_LABELS.has(label),
  };
}

/** Groups fact records by obligation and slot (records with no valid obligation or slot are not groupable and are left out). */
export function groupBySlot(cycles: CycleRecord[]): Map<string, CycleRecord[]> {
  const out = new Map<string, CycleRecord[]>();
  for (const c of cycles) {
    if (c.obligationId === null || c.slot === null || c.parsed === null) continue;
    const key = `${c.obligationId}|${c.slot}`;
    out.set(key, [...(out.get(key) ?? []), c]);
  }
  return out;
}

export interface PeriodWindow { from: string; to: string }
export interface PeriodOptions {
  /** Include every period that holds records, whatever its date (the bill's own page). Otherwise only periods whose timing date is inside the window. */
  allRecorded?: boolean;
  /** B3: the live Finance transactions the period's payment links point at (read once, in bulk, by the caller). Without it every link reads as "not found". */
  lookup?: TxnLookup;
}

/**
 * The periods of one obligation: the EXPECTED ones (derived from the schedule) and every period that holds records, with their state.
 * `cycles` may hold other obligations' records; only this obligation's are used. Sorted by timing date (periods with no date last).
 */
export function periodsOf(ob: ObligationRecord, cycles: CycleRecord[], today: string, win: PeriodWindow, opts: PeriodOptions = {}): Period[] {
  const src = scheduleSource(ob.data);
  const mine = groupBySlot(cycles.filter((c) => c.obligationId === ob.id));
  const exp = new Map<string, string>();
  // dates are looked up a little wider than the window so a period whose recorded due date moves into the window is still found
  for (const e of expectedDates(src, addDays(win.from, -62), addDays(win.to, 62))) if (!exp.has(e.slot)) exp.set(e.slot, e.nominal);
  const slots = new Set<string>([...exp.keys(), ...[...mine.keys()].map((k) => k.slice(k.indexOf('|') + 1))]);
  const out: Period[] = [];
  for (const slot of slots) {
    const records = mine.get(`${ob.id}|${slot}`) ?? [];
    const isExtra = slot.startsWith('x');
    const nominal = isExtra ? null : exp.get(slot) ?? scheduleProduces(src, slot);
    const p = derivePeriod(ob, slot, nominal, exp.has(slot), records, today, opts.lookup ?? NO_FINANCE);
    const inWindow = p.timing.date !== null && p.timing.date >= win.from && p.timing.date <= win.to;
    if (inWindow || (opts.allRecorded && records.length > 0)) out.push(p);
  }
  return out.sort((a, b) => (a.timing.date ?? '9999').localeCompare(b.timing.date ?? '9999') || a.slot.localeCompare(b.slot));
}
