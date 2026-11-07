/**
 * Practical, DETERMINISTIC insights for the Services Overview (S5-C). Pure: the same records and the same `today` always give the same list.
 * No model, no network, no stored result. Every insight names the Ledger records it rests on (`evidence`, `links`), is worded neutrally, says what
 * it cannot know, and changes nothing.
 *
 * Reused, not re-invented: the S3 paid-amount readers (`servicesSpend`, `visitPayment`, `typicalCost`'s median), the S3 estimate window
 * (`expectedWindow`), the cadence adapter (`cadenceBetween`) and the S4 horizon. Three honesty rules:
 *   - No judgment on thin history: an "unusual cost" needs at least TYPICAL_MIN_SAMPLE OTHER reliable visits; a "long gap" needs two completed visits.
 *   - The absence of a visit record is never read as a provider failing to come. The wording says the visit may simply not have been logged.
 *   - A difference is information, not an error: seasons, extra work, tips and part payments are normal.
 */
import { addDays } from '../../lib/dates';
import { daysBetween, formatCents } from '../../lib/money';
import { pieceKey, resolveRef, type TxnLookup } from '../../lib/txnRef';
import { expectedWindow, type ScheduleState } from './expectedCharges';
import { cadenceBetween, type ArrangementRecord } from './model';
import { horizonEnd } from './plannedVisits';
import { resolvePeriod, type ResolvedPeriod } from './periods';
import { arrangementRoute, visitRoute } from './paths';
import { servicesSpend, TYPICAL_MIN_SAMPLE, type PayRecord } from './servicesSpend';
import type { VisitRecord } from './visitModel';

export type InsightKind = 'trend' | 'expected' | 'unusual' | 'gap' | 'skips' | 'moves' | 'handoff';
export interface Insight {
  id: string;
  kind: InsightKind;
  /** `check` = worth a look; `info` = good to know. */
  tone: 'check' | 'info';
  title: string;
  detail: string;
  links: { label: string; to: string }[];
  /** The records it rests on (e.g. `visit:12`, `arrangement:3`). */
  evidence: string[];
}

export interface InsightInput {
  today: string;
  arrangements: ArrangementRecord[];
  visits: VisitRecord[];
  payAll: PayRecord[];
  lookup: TxnLookup;
  schedule: Map<number, ScheduleState>;
  period: ResolvedPeriod;
  /** Arrangements that have a finished-but-not-logged visit (already under "Needs attention"; not repeated as a gap). */
  unloggedArrangementIds: Set<number>;
  /** Arrangement id -> asset ids it serves (live links). */
  assetIdsBy: Map<number, number[]>;
  /** Visits that already have a `recorded-as` link. */
  recordedVisitIds: Set<number>;
}

export const MAX_INSIGHTS = 8;
/** An unusual cost needs to differ by at least this much (cents) as well as by the ratio, so small amounts never raise it. */
export const UNUSUAL_MIN_DIFF_CENTS = 1000;
export const UNUSUAL_HIGH = 1.5;
export const UNUSUAL_LOW = 0.5;
const RECENT_DAYS = 120;
const SKIP_DAYS = 90;
const GAP_FLOOR_DAYS = 60;

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); };
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// ---- by provider (an unambiguous breakdown) ----

export interface ProviderSpendRow { providerKey: string; name: string; cents: number }
export interface ProviderBreakdown { rows: ProviderSpendRow[]; /** Payments that more than one provider's records reach: not attributed to anyone. */ sharedCents: number; totalCents: number }

/**
 * Recorded Services spending by provider where attribution is unambiguous. A payment (Finance piece) that records of more than one provider reach,
 * or that a whole transaction of another provider covers, is not given to anyone: it is listed as shared. Rows plus shared always equal the total.
 */
export function providerBreakdown(payAll: PayRecord[], lookup: TxnLookup, range: { from?: string; to?: string }, nameOf: (providerKey: string) => string): ProviderBreakdown {
  const s = servicesSpend(payAll, lookup, range, payAll);
  const prov = new Map(payAll.map((r) => [r.id, r.providerKey]));
  const coveredBy = new Map<number, Set<string>>();
  for (const c of s.summary.coveredParts) coveredBy.set(c.resolved.ref.txnId, (coveredBy.get(c.resolved.ref.txnId) ?? new Set()).add(prov.get(c.recordId) ?? ''));
  const cents = new Map<string, number>();
  let shared = 0;
  for (const p of s.summary.pieces) {
    const who = new Set(p.recordIds.map((id) => prov.get(id) ?? ''));
    for (const w of coveredBy.get(p.resolved.ref.txnId) ?? []) who.add(w);
    if (who.size === 1) { const k = [...who][0]; cents.set(k, (cents.get(k) ?? 0) + p.spendCents); } else shared += p.spendCents;
  }
  // typed amounts belong to the record that holds them (counted only when that record has no references)
  for (const r of payAll) {
    if (r.refs.length || r.manualCents === null) continue;
    const day = r.date;
    if ((range.from && (!day || day < range.from)) || (range.to && (!day || day > range.to))) continue;
    cents.set(r.providerKey, (cents.get(r.providerKey) ?? 0) + r.manualCents);
  }
  const rows = [...cents.entries()].map(([providerKey, c]) => ({ providerKey, name: nameOf(providerKey), cents: c })).filter((r) => r.cents !== 0).sort((a, b) => b.cents - a.cents || a.name.localeCompare(b.name));
  return { rows, sharedCents: shared, totalCents: s.totalCents };
}

// ---- reliable amounts ----

/**
 * Each completed visit's own payment when it is reliable: linked or typed, not shared with another record, nothing to review, and positive. These are
 * the same tests as the S3 typical price (`typicalCost`/`visitPayment`), done once for every visit with an index of who reaches each transaction, so the
 * cost grows with the number of records and not with their square. A test pins that the two agree.
 */
export function reliableAmounts(visits: VisitRecord[], all: PayRecord[], lookup: TxnLookup): Map<number, number | null> {
  const reach = new Map<number, { id: string; whole: boolean; key: string }[]>();
  for (const r of all) for (const x of r.refs) { const l = reach.get(x.txnId) ?? []; l.push({ id: r.id, whole: x.splitIndex === undefined, key: pieceKey(x) }); reach.set(x.txnId, l); }
  const out = new Map<number, number | null>();
  for (const v of visits) {
    if (v.data.status !== 'completed') { out.set(v.id, null); continue; }
    const refs = v.data.txnRefs;
    if (!refs.length && v.data.paidManualCents === null) { out.set(v.id, null); continue; }
    const me = `visit:${v.id}`;
    const resolved = refs.map((r) => resolveRef(r, lookup));
    const shared = refs.some((y) => (reach.get(y.txnId) ?? []).some((o) => o.id !== me && (o.key === pieceKey(y) || o.whole || y.splitIndex === undefined)));
    if (resolved.some((x) => x.needsReview) || shared) { out.set(v.id, null); continue; }
    const cents = refs.length ? resolved.reduce((t, x) => t + x.spendCents, 0) : v.data.paidManualCents;
    out.set(v.id, cents !== null && cents > 0 ? cents : null);
  }
  return out;
}

export function buildInsights(input: InsightInput, money: (cents: number) => string = formatCents): Insight[] {
  // A fixed order for everything below, so the same records give the same list however they arrive: arrangements by id, visits newest first (then by id).
  const i: InsightInput = {
    ...input,
    arrangements: [...input.arrangements].sort((a, b) => a.id - b.id),
    visits: [...input.visits].sort((a, b) => (b.data.date || '').localeCompare(a.data.date || '') || b.id - a.id),
  };
  const out: Insight[] = [];

  // 1. recorded spending against the comparable prior period (Household Services payments)
  if (i.period.prior) {
    const cur = servicesSpend(i.payAll, i.lookup, i.period.range, i.payAll);
    const pri = servicesSpend(i.payAll, i.lookup, i.period.prior.range, i.payAll);
    if (cur.totalCents !== 0 || pri.totalCents !== 0) {
      const review = cur.summary.review.length + pri.summary.review.length;
      let line: string;
      if (pri.totalCents === 0) line = `Nothing was recorded for ${i.period.prior.label}, so there is nothing to compare with.`;
      else {
        const pct = Math.round(((cur.totalCents - pri.totalCents) / Math.abs(pri.totalCents)) * 100);
        line = Math.abs(pct) < 10 ? `That is about the same as ${money(pri.totalCents)} for ${i.period.prior.label}.` : `That is ${Math.abs(pct)}% ${pct > 0 ? 'higher' : 'lower'} than the ${money(pri.totalCents)} recorded for ${i.period.prior.label}.`;
      }
      out.push({
        id: 'trend', kind: 'trend', tone: 'info', title: `Recorded service payments, ${i.period.label.toLowerCase()}`,
        detail: `${money(cur.totalCents)} was recorded for household services. ${line} Only recorded payments are counted, so a bill paid just before or after the dividing day moves between periods.${review ? ` ${plural(review, 'linked payment needs', 'linked payments need')} review and ${review === 1 ? 'counts' : 'count'} as $0 until fixed.` : ''}`,
        links: [], evidence: [],
      });
    }
  }

  // 2. what the schedule and the cost estimates imply for the next 12 months (an estimate, kept apart from what was recorded)
  const horizonDays = daysBetween(horizonEnd(i.today), i.today);
  const w = expectedWindow(i.arrangements, i.schedule, i.today, horizonDays);
  if (w.items.length) {
    const last12 = servicesSpend(i.payAll, i.lookup, resolvePeriod('last12', i.today).range, i.payAll);
    out.push({
      id: 'expected', kind: 'expected', tone: 'info', title: 'Estimated cost of the next 12 months of visits',
      detail: `About ${money(w.estimateCents)} (an estimate: your per-visit cost estimates times the visits the schedules expect). For comparison, ${money(last12.totalCents)} of payments were recorded over the last 12 months. The estimate is not a charge, a payment or spending.${w.notConverted.length ? ` ${plural(w.notConverted.length, 'arrangement is', 'arrangements are')} not included because ${w.notConverted.length === 1 ? 'its estimate is' : 'their estimates are'} not per visit, or there is no schedule to project.` : ''}`,
      links: w.items.slice(0, 3).map((x) => ({ label: x.title, to: arrangementRoute(x.arrangementId) })), evidence: w.items.map((x) => `arrangement:${x.arrangementId}`),
    });
  }

  // 3. a recent charge far from the usual price
  const reliable = reliableAmounts(i.visits, i.payAll, i.lookup);
  const byArr = new Map<number, VisitRecord[]>();
  for (const v of i.visits) if (v.data.arrangementId !== null) byArr.set(v.data.arrangementId, [...(byArr.get(v.data.arrangementId) ?? []), v]);
  const unusual: { v: VisitRecord; cents: number; med: number; ratio: number; n: number }[] = [];
  for (const [aid, vs] of byArr) {
    if (!i.arrangements.some((a) => a.id === aid)) continue;
    for (const v of vs) {
      if (!v.data.date || v.data.date > i.today || daysBetween(i.today, v.data.date) > RECENT_DAYS) continue;
      const cents = reliable.get(v.id) ?? null;
      if (cents === null) continue;
      const amounts = vs.filter((x) => x.id !== v.id).map((x) => reliable.get(x.id) ?? null).filter((c): c is number => c !== null);
      // fewer than the S3 minimum of OTHER reliable visits: no judgment
      if (amounts.length < TYPICAL_MIN_SAMPLE) continue;
      // when the usual price itself swings (a seasonal service), a different amount is ordinary variation
      if (Math.max(...amounts) > 2 * Math.min(...amounts)) continue;
      const med = median(amounts);
      const ratio = cents / med;
      if ((ratio >= UNUSUAL_HIGH || ratio <= UNUSUAL_LOW) && Math.abs(cents - med) >= UNUSUAL_MIN_DIFF_CENTS) unusual.push({ v, cents, med, ratio, n: amounts.length });
    }
  }
  unusual.sort((a, b) => Math.abs(Math.log(b.ratio)) - Math.abs(Math.log(a.ratio)) || a.v.id - b.v.id);
  for (const u of unusual.slice(0, 3)) {
    out.push({
      id: `unusual:${u.v.id}`, kind: 'unusual', tone: 'check', title: `${u.v.data.title}: a different amount than usual`,
      detail: `The payment for the visit on ${u.v.data.date} was ${money(u.cents)}. The typical payment for this arrangement is about ${money(u.med)} (the median of ${plural(u.n, 'earlier visit', 'earlier visits')} with a clear payment). That can be perfectly normal: extra work, a season, a tip or a part payment.`,
      links: [{ label: 'Open the visit', to: visitRoute(u.v.id) }], evidence: [`visit:${u.v.id}`],
    });
  }

  // 4. a long gap in the logged history of a regular service
  for (const a of i.arrangements) {
    const c = a.data.cadence;
    if (a.data.status !== 'active' || !c || c.mode !== 'fixed' || i.unloggedArrangementIds.has(a.id)) continue;
    const done = (byArr.get(a.id) ?? []).filter((v) => v.data.status === 'completed' && v.data.date && v.data.date <= i.today).map((v) => v.data.date).sort();
    if (done.length < 2) continue;
    const dates = cadenceBetween(c, addDays(i.today, -400), addDays(i.today, 400));
    if (dates.length < 3) continue;
    const interval = median(dates.slice(1).map((d, k) => daysBetween(d, dates[k])));
    const last = done[done.length - 1];
    const gap = daysBetween(i.today, last);
    if (gap > Math.max(GAP_FLOOR_DAYS, Math.round(interval * 2.5))) {
      out.push({
        id: `gap:${a.id}`, kind: 'gap', tone: 'check', title: `${a.data.title}: no completed visit logged for ${gap} days`,
        detail: `The last completed visit on record was ${last}. The schedule usually has one about every ${interval} days. This may only mean visits happened and were not logged; Ledger cannot tell.`,
        links: [{ label: 'Open the arrangement', to: arrangementRoute(a.id) }], evidence: [`arrangement:${a.id}`],
      });
    }
  }

  // 5. skipped or cancelled visits close together
  for (const a of i.arrangements) {
    const recent = (byArr.get(a.id) ?? []).filter((v) => (v.data.status === 'skipped' || v.data.status === 'cancelled') && v.data.date && v.data.date <= i.today && daysBetween(i.today, v.data.date) <= SKIP_DAYS);
    if (recent.length < 2) continue;
    const sk = recent.filter((v) => v.data.status === 'skipped').length;
    const byProvider = recent.filter((v) => v.data.status === 'cancelled' && v.data.cancelledBy === 'provider').length;
    const byHousehold = recent.filter((v) => v.data.status === 'cancelled' && v.data.cancelledBy === 'household').length;
    const parts = [sk && `${sk} skipped`, byHousehold && `${byHousehold} cancelled by the household`, byProvider && `${byProvider} cancelled by the provider`].filter(Boolean).join(', ');
    out.push({
      id: `skips:${a.id}`, kind: 'skips', tone: 'check', title: `${a.data.title}: ${recent.length} visits not carried out in the last ${SKIP_DAYS} days`,
      detail: `${parts}. Skipped and cancelled visits are never counted as service. There may be good reasons; this is only a note that it happened more than once.`,
      links: [{ label: 'Open the arrangement', to: arrangementRoute(a.id) }], evidence: recent.map((v) => v.id).sort((x, y) => x - y).map((id) => `visit:${id}`),
    });
  }

  // 6. dates that keep changing
  for (const a of i.arrangements) {
    if (a.data.status !== 'active') continue;
    const last = (byArr.get(a.id) ?? []).filter((v) => v.data.occurrence && v.data.date && v.data.status !== 'unsupported').slice(0, 6);
    if (last.length < 4) continue;
    const moved = last.filter((v) => v.data.date !== v.data.occurrence).length;
    if (moved >= 3) {
      out.push({
        id: `moves:${a.id}`, kind: 'moves', tone: 'info', title: `${a.data.title}: visits often happen on a different day`,
        detail: `${moved} of the last ${last.length} logged visits happened on a day other than the scheduled one. If the usual day has changed, you can change the schedule so the dates match.`,
        links: [{ label: 'Open the arrangement', to: arrangementRoute(a.id) }], evidence: [`arrangement:${a.id}`],
      });
    }
  }

  // 7. completed visits to an asset that were not recorded as maintenance (optional)
  const unrecorded = i.visits.filter((v) => v.data.status === 'completed' && v.data.arrangementId !== null && (i.assetIdsBy.get(v.data.arrangementId)?.length ?? 0) > 0 && !i.recordedVisitIds.has(v.id) && v.data.date && v.data.date <= i.today && daysBetween(i.today, v.data.date) <= SKIP_DAYS);
  if (unrecorded.length) {
    out.push({
      id: 'handoff', kind: 'handoff', tone: 'info', title: `${plural(unrecorded.length, 'recent visit', 'recent visits')} not recorded in Home & Assets`,
      detail: `${plural(unrecorded.length, 'completed visit', 'completed visits')} in the last ${SKIP_DAYS} days ${unrecorded.length === 1 ? 'was' : 'were'} for services that look after an asset and ${unrecorded.length === 1 ? 'is' : 'are'} not in that asset's maintenance history. That is optional: record one only if you want it in the asset's history.`,
      links: unrecorded.slice(0, 3).map((v) => ({ label: `${v.data.title} (${v.data.date})`, to: visitRoute(v.id) })), evidence: unrecorded.map((v) => v.id).sort((x, y) => x - y).map((id) => `visit:${id}`),
    });
  }

  const rank: Record<InsightKind, number> = { unusual: 0, gap: 1, skips: 2, moves: 3, handoff: 4, trend: 5, expected: 6 };
  return out.sort((a, b) => (a.tone === b.tone ? 0 : a.tone === 'check' ? -1 : 1) || rank[a.kind] - rank[b.kind] || a.id.localeCompare(b.id)).slice(0, MAX_INSIGHTS);
}

