/**
 * THE HOUSEHOLD FINANCES OVERVIEW (B5): ONE small read-only loader hands everything to ONE pure builder, the same shape Home & Assets H5 and Household Services S5 use.
 * Nothing is stored, nothing is written, no Task, record or Finance row is created to power it, and a test pins that repeated loads change no row.
 *
 * It asks the code that already decides each thing:
 *   - recorded spending across Bills, Household Services and Home & Assets: `recordedAcrossModules` (which calls `householdSpend` and `billsRecordedPayments` unchanged);
 *   - commitments and expected payments: `householdCommitments` (Bills' billing periods and `buildCommitments`, Services' `expectedWindow`);
 *   - needs review: `householdReview` (the union's own sharing and evidence items, the commitments' overlap notices, Bills' lifecycle items);
 *   - contract dates: Bills' `upcomingDeadlines` and Services' `contractDeadlines` (the same readers the Calendar and Today use).
 * Finance is read ONCE for this screen: Bills' own bulk read of the transactions its links point at, plus one `bulkGet` of the transactions only Services or Home & Assets
 * reference. There is no per-row read and no full transaction-table read.
 */
import { db, type FinanceDB } from '../../db';
import type { Link } from '../../core/entities';
import { addDays } from '../../lib/dates';
import { todayISO } from '../../lib/money';
import { loadTxnMap, lookupOfMap } from '../../lib/txnLookup';
import type { TxnLookup } from '../../lib/txnRef';
import { loadServices } from '../assets/serviceData';
import type { ServiceRecord } from '../assets/service';
import { costRecords } from '../assets/spending';
import { attention, derive, loadBillsSnapshot, upcomingDeadlines, AWAITING_DAYS, type BillsSnapshot } from '../bills/readModel';
import { DEADLINE_LABEL as BILL_DEADLINE_LABEL } from '../bills/terms';
import { scheduleStateOf } from '../services/expectedCharges';
import { contractDeadlines } from '../services/contract';
import { pairsFromLinks, type HouseholdInput } from '../services/householdSpend';
import { periodChoices, resolvePeriod, type PeriodId, type ResolvedPeriod } from '../services/periods';
import { visitAssetMap } from '../services/servicesOverview';
import { payRecords } from '../services/servicesSpend';
import { buildOverview, loadSnapshotAndLinks, type Snapshot } from '../services/views';
import { householdCommitments, type HouseholdCommitments } from './commitments';
import type { HMod } from './model';
import { householdReview, type ReviewItem } from './review';
import { recordedAcrossModules, type RecordedAcrossModules } from './unionSpend';

export interface ContractAction {
  id: string;
  module: 'bills' | 'services';
  kind: 'trial' | 'renewal' | 'notice' | 'cancel-followup';
  title: string;
  date: string;
  /** Days from today (negative = already past). */
  daysAway: number;
  label: string;
  /** Plain words, no amounts. */
  note: string;
  href: string;
}

export interface OverviewInput {
  today: string;
  period: PeriodId;
  bills: BillsSnapshot;
  services: Snapshot;
  links: Link[];
  homeServices: ServiceRecord[];
  lookup: TxnLookup;
}

export interface HouseholdOverview {
  today: string;
  period: ResolvedPeriod;
  periodOptions: { id: PeriodId; label: string }[];
  /** The selected period. */
  spending: RecordedAcrossModules;
  /** All time: the review conditions do not depend on the period. */
  lifetime: RecordedAcrossModules;
  commitments: HouseholdCommitments;
  actions: ContractAction[];
  review: ReviewItem[];
  /** How many records each module holds (the things "managed in" it). */
  managed: Record<HMod, number>;
  empty: boolean;
}

const ACTION_DAYS = 90;
const dayDiff = (to: string, from: string) => Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000);

export function buildHouseholdOverview(i: OverviewInput): HouseholdOverview {
  const { today } = i;
  const resolved = resolvePeriod(i.period, today);
  const pairs = pairsFromLinks(i.links);
  const household: HouseholdInput = { assets: i.services.assets, homeServices: i.homeServices, arrangements: i.services.arrangements, visits: i.services.visits, pairs, visitAssets: visitAssetMap(i.services, i.links) };
  const serviceLinks = i.bills.serviceLinks ?? new Map<number, number[]>();
  const across = { household, obligations: i.bills.obligations, cycles: i.bills.cycles, serviceLinks };
  const spending = recordedAcrossModules(across, i.lookup, resolved.range);
  const lifetime = resolved.id === 'all' ? spending : recordedAcrossModules(across, i.lookup);

  const bills = derive(i.bills, today);
  const base = buildOverview(i.services);
  const state = new Map(base.rows.map((r) => [r.a.id, scheduleStateOf(r.tasks)]));
  const commitments = householdCommitments({ today, bills, services: { arrangements: i.services.arrangements, state }, serviceLinks });
  const review = householdReview({ lifetime, commitments, bills, arrangements: i.services.arrangements, state, serviceLinks, today });

  // ---- upcoming contractual actions: one row per date, a linked arrangement's identical date folded into the bill's row ----
  const actions: ContractAction[] = [];
  const billOf = new Map<number, string>(i.bills.obligations.map((o) => [o.id, o.data.title]));
  const seen = new Map<string, ContractAction>();
  for (const d of upcomingDeadlines(bills, ACTION_DAYS)) {
    const kind = d.kind;
    const a: ContractAction = { id: `bill:${d.ob.id}:${kind}:${d.date}`, module: 'bills', kind, title: d.ob.data.title, date: d.date, daysAway: dayDiff(d.date, today), label: BILL_DEADLINE_LABEL[kind], note: '', href: `#/bills/o/${d.ob.id}` };
    actions.push(a);
    for (const arr of serviceLinks.get(d.ob.id) ?? []) seen.set(`${kind}|${d.date}|${arr}`, a);
  }
  for (const d of contractDeadlines(i.services.arrangements)) {
    if (d.date < today || d.date > addDays(today, ACTION_DAYS)) continue;
    const twin = seen.get(`${d.kind}|${d.date}|${d.arrangementId}`);
    if (twin) { twin.note = 'The linked Household Services arrangement shows the same date.'; continue; }
    actions.push({ id: `service:${d.arrangementId}:${d.kind}:${d.date}`, module: 'services', kind: d.kind, title: d.title, date: d.date, daysAway: dayDiff(d.date, today), label: d.kind === 'renewal' ? 'Renewal' : 'Notice deadline', note: '', href: `#/services/a/${d.arrangementId}` });
  }
  for (const it of attention(bills).items) {
    if (it.category !== 'cancelAwaiting' || it.obligationId === null || !it.date) continue;
    actions.push({ id: `bill:${it.obligationId}:follow-up:${it.date}`, module: 'bills', kind: 'cancel-followup', title: billOf.get(it.obligationId) ?? 'A bill', date: it.date, daysAway: dayDiff(it.date, today), label: 'Follow up on a cancellation request', note: `Asked on ${it.date}; nothing is recorded as confirmed. It is still treated as active (follow-up after ${AWAITING_DAYS} days).`, href: `#/bills/o/${it.obligationId}` });
  }
  actions.sort((a, b) => a.date.localeCompare(b.date) || a.module.localeCompare(b.module) || a.id.localeCompare(b.id, 'en', { numeric: true }));

  const managed: Record<HMod, number> = {
    bills: i.bills.obligations.filter((o) => o.data.status === 'active').length,
    services: i.services.arrangements.filter((a) => a.data.status === 'active').length,
    home: i.services.assets.filter((a) => !a.data.archived).length,
  };
  const empty = i.bills.obligations.length === 0 && i.services.arrangements.length === 0 && i.services.visits.length === 0 && i.services.assets.length === 0;
  return { today, period: resolved, periodOptions: periodChoices(today, years(lifetime, i.lookup)), spending, lifetime, commitments, actions, review, managed, empty };
}

/** The calendar years in which anything counted is dated (so the selector offers past years that have something in them). */
function years(l: RecordedAcrossModules, lookup: TxnLookup): string[] {
  const ys = new Set<string>();
  for (const p of l.pieces) { const d = p.date ?? lookup(p.txnId)?.date; if (d && /^\d{4}-/.test(d)) ys.add(d.slice(0, 4)); }
  for (const t of l.typed) if (t.date && /^\d{4}-/.test(t.date)) ys.add(t.date.slice(0, 4));
  return [...ys];
}

/**
 * Reads everything the Overview needs, once, read-only. A failure rejects the whole load, so a caller can never be handed a total built from only some of the sources
 * (the page shows an error instead of a complete-looking figure).
 */
export async function loadHouseholdOverview(period: PeriodId, today: string = todayISO(), d: FinanceDB = db): Promise<HouseholdOverview> {
  const [bills, { snapshot, links }, homeServices] = await Promise.all([loadBillsSnapshot(d), loadSnapshotAndLinks(d), loadServices(d)]);
  const refs = [...payRecords(snapshot.arrangements, snapshot.visits).flatMap((r) => r.refs), ...costRecords(snapshot.assets, homeServices).flatMap((r) => r.refs)];
  const extra = await loadTxnMap(refs.filter((r) => !bills.financeTxns.has(r.txnId)), d);
  const lookup = lookupOfMap(new Map([...bills.financeTxns, ...extra]));
  return buildHouseholdOverview({ today, period, bills, services: snapshot, links, homeServices, lookup });
}

// ---- Today ----

/** What Today shows, and only what the Bills and Household Services cards do NOT already say: cross-module concerns. Counts only. */
export interface TodayCounts { possibleDuplicates: number; overlaps: number; unknownSoon: number; total: number }
export function todayCounts(o: HouseholdOverview): TodayCounts {
  const possibleDuplicates = o.lifetime.review.filter((r) => r.kind === 'possible-duplicate').length;
  const overlaps = o.commitments.twelve.consolidations.filter((c) => c.status !== 'folded').length;
  const w = o.commitments.windows.find((x) => x.days === 30)!;
  const unknownSoon = w.totals.unknown.count + w.totals.disputed.count;
  return { possibleDuplicates, overlaps, unknownSoon, total: possibleDuplicates + overlaps + unknownSoon };
}
