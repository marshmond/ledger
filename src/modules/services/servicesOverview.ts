/**
 * The Household Services Overview reader (S5-A), after Home & Assets H5: ONE small read-only loader hands everything to ONE pure builder.
 * Nothing is stored, nothing is written, no Task, Visit or Event is created to power it, and there is no rule of its own for "unlogged", "duplicate",
 * "needs a schedule check", "contract deadline" or "needs review". It only asks the code that already decides those things:
 *   - arrangement and visit conditions: `buildOverview` (views.ts), the same function the Today card's counts come from;
 *   - contract deadlines: `contractDeadlines` (the Calendar layer and Today use it too);
 *   - the next dates: the open visit Task and `plannedVisitDates` (the Calendar layer);
 *   - money: `householdSpend` (which reuses H3's `spend()` and S4's `recorded-as` links), `servicesSpend`, `expectedWindow`;
 *   - insights: `buildInsights`.
 * Today keeps its own light, count-only card; both ask the same functions, and a test pins that the counts agree.
 */
import { db, type FinanceDB } from '../../db';
import type { Link } from '../../core/entities';
import { todayISO } from '../../lib/money';
import { addDays } from '../../lib/dates';
import { daysBetween } from '../../lib/money';
import { lookupOfMap, loadTxnMap } from '../../lib/txnLookup';
import type { TxnLookup } from '../../lib/txnRef';
import { loadServices } from '../assets/serviceData';
import { costRecords } from '../assets/spending';
import { parseAssetRef } from '../assets/model';
import type { ServiceRecord } from '../assets/service';
import { contractDeadlines, DEADLINE_LABEL, type Deadline } from './contract';
import { expectedWindow, scheduleStateOf, type ExpectedWindow, type ScheduleState } from './expectedCharges';
import { duplicateHandoffs, type Handoff } from './handoff';
import { householdSpend, pairsFromLinks, type HouseholdSpend, type PairLink, type SourceRef } from './householdSpend';
import { buildInsights, providerBreakdown, type Insight, type ProviderBreakdown } from './insights';
import { ASSET_LINK, MODULE } from './model';
import { arrangementRoute, visitRoute } from './paths';
import { periodChoices, resolvePeriod, type PeriodId, type ResolvedPeriod } from './periods';
import { horizonEnd, plannedVisitDates } from './plannedVisits';
import { payRecords, providerKeyOf } from './servicesSpend';
import { markersOf } from './schedule';
import { DEFAULT_UPCOMING_DAYS, type UpcomingDays } from './upcomingWindow';
import { buildOverview, loadSnapshotAndLinks, providerList, visitRows, type AttentionItem, type Overview, type Snapshot, type VisitRow } from './views';
import type { UnloggedItem } from './visits';
import { parseVisitRef } from './visitModel';

/** How far ahead the "Upcoming" list looks (7, 14, 30 or 90 days, default 30) and how many rows it shows before "Show all": see upcomingWindow.ts. */
export { DEFAULT_UPCOMING_DAYS, UPCOMING_ROWS, UPCOMING_WINDOWS } from './upcomingWindow';
/** Contract deadlines inside this many days are "Needs attention" (the same window Today counts); this many are listed for review. */
export const ATTENTION_DEADLINE_DAYS = 30;
export const REVIEW_DEADLINE_DAYS = 90;
/** How many of the newest visits are made available to the Recent activity list (the page shows 10 after filtering). */
export const RECENT_POOL = 200;

export type AttentionKind = 'contract' | 'unlogged' | 'schedule' | 'duplicate-visits' | 'duplicate-handoff' | 'finance-reference' | 'typed-amount' | 'review-visit' | 'provider' | 'asset';
export interface AttentionEntry {
  id: string;
  kind: AttentionKind;
  text: string;
  hint: string;
  /** A route inside Household Services (for `Link`). */
  to?: string;
  /** A hash address elsewhere in Ledger (Home & Assets pages). */
  href?: string;
  arrangementId?: number;
  /** For `unlogged`: lets the page offer "Log this visit…". */
  unlogged?: UnloggedItem;
}

export interface UpcomingRow {
  key: string;
  kind: 'task' | 'expected';
  arrangementId: number;
  title: string;
  providerName: string;
  providerContactId: number | null;
  date: string;
  time: string | null;
  overdue: boolean;
  /** The usual date this visit stands for, when this one was moved on its own. Later dates are not shifted. */
  movedFrom: string | null;
  taskId: number | null;
  assetNames: string[];
}
export interface ContractRow extends Deadline { label: string; daysAway: number; providerName: string }

export interface ServicesOverviewInput {
  snapshot: Snapshot;
  links: Link[];
  homeServices: ServiceRecord[];
  lookup: TxnLookup;
  today: string;
  period: PeriodId;
  /** The Upcoming list's date window (7, 14, 30 or 90). Default 30. It changes only that list. */
  upcomingDays?: UpcomingDays;
}
export interface ServicesOverview {
  today: string;
  /** The window the `upcoming` list was built for. */
  upcomingDays: UpcomingDays;
  period: ResolvedPeriod;
  periodOptions: { id: PeriodId; label: string }[];
  base: Overview;
  /** The newest logged visits (completed, skipped, cancelled), for the page to filter and cut. */
  recent: VisitRow[];
  counts: { active: number; paused: number; ended: number; total: number };
  attention: AttentionEntry[];
  upcoming: UpcomingRow[];
  contracts: ContractRow[];
  providers: { contactId: number; name: string; active: number; total: number }[];
  /** The selected period. */
  spend: HouseholdSpend;
  /** All time: the review conditions behind "Needs attention" do not depend on the period. */
  lifetime: HouseholdSpend;
  byProvider: ProviderBreakdown;
  insights: Insight[];
  /** ESTIMATES of upcoming charges (S3's 30 and 90 days, and the 12-month Calendar horizon). Never spending, never added to anything. */
  estimates: ExpectedWindow[];
}

const dayDiff = (to: string, from: string) => Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000);

/** Where a record behind a claim opens: a Household Services page (`to`), or a Home & Assets page (`href`). */
export function sourceTarget(src: SourceRef): { to?: string; href?: string } {
  if (src.type === 'visit') return { to: visitRoute(src.id) };
  if (src.type === 'arrangement') return { to: arrangementRoute(src.id) };
  if (src.type === 'service') return { href: `#/assets/${src.assetId ?? ''}?service=${src.id}` };
  return { href: `#/assets/${src.id}` };
}

/** Asset ids each visit serves: its own `serves` links, else its arrangement's. Read from the links already loaded. */
export function visitAssetMap(snap: Snapshot, links: Link[]): Map<number, number[]> {
  const own = new Map<number, number[]>();
  for (const l of links) {
    if (l.type !== ASSET_LINK || l.fromModule !== MODULE || l.toModule !== 'assets') continue;
    const v = parseVisitRef(l.fromId);
    const a = parseAssetRef(l.toId);
    if (v === null || a === null) continue;
    const list = own.get(v) ?? [];
    if (!list.includes(a)) list.push(a);
    own.set(v, list);
  }
  const out = new Map<number, number[]>();
  for (const v of snap.visits) out.set(v.id, own.get(v.id) ?? (v.data.arrangementId !== null ? snap.assetIdsBy.get(v.data.arrangementId) ?? [] : []));
  return out;
}

/** Visits that have two or more live Home & Assets records for the same asset (the S4 duplicate-handoff rule, applied to every visit). */
export function visitsWithDuplicateHandoffs(pairs: PairLink[], homeServices: ServiceRecord[]): { visitId: number; assetIds: number[] }[] {
  const byId = new Map(homeServices.map((s) => [s.id, s]));
  const byVisit = new Map<number, Handoff[]>();
  for (const p of pairs) byVisit.set(p.visitId, [...(byVisit.get(p.visitId) ?? []), { linkId: 0, serviceId: p.serviceId, service: byId.get(p.serviceId) ?? null }]);
  const out: { visitId: number; assetIds: number[] }[] = [];
  for (const [visitId, hs] of [...byVisit].sort((a, b) => a[0] - b[0])) {
    const d = duplicateHandoffs(hs);
    if (d.length) out.push({ visitId, assetIds: d.map((x) => x.assetId) });
  }
  return out;
}

export function buildServicesOverview(i: ServicesOverviewInput, money?: (c: number) => string): ServicesOverview {
  const { snapshot: s, today } = i;
  const base = buildOverview(s);
  const period = resolvePeriod(i.period, today);
  const pairs = pairsFromLinks(i.links);
  const visitAssets = visitAssetMap(s, i.links);
  const hin = { assets: s.assets, homeServices: i.homeServices, arrangements: s.arrangements, visits: s.visits, pairs, visitAssets };
  const spend = householdSpend(hin, i.lookup, period.range);
  const lifetime = period.id === 'all' ? spend : householdSpend(hin, i.lookup);

  // ---- needs attention: every entry comes from a reader that already exists ----
  const attention: AttentionEntry[] = [];
  const deadlines = contractDeadlines(s.arrangements);
  const providerOf = (arrangementId: number) => s.arrangements.find((a) => a.id === arrangementId)?.data.providerNameSnapshot ?? '';
  for (const d of deadlines) {
    if (d.date < today || d.date > addDays(today, ATTENTION_DEADLINE_DAYS)) continue;
    attention.push({ id: `contract:${d.kind}:${d.arrangementId}`, kind: 'contract', text: `${DEADLINE_LABEL[d.kind]} for ${d.title} on ${d.date}`, hint: d.kind === 'notice' ? 'Last day to act or give notice' : 'Check the agreement before it renews', to: arrangementRoute(d.arrangementId), arrangementId: d.arrangementId });
  }
  for (const u of base.unlogged) {
    const a = s.arrangements.find((x) => x.id === u.arrangementId);
    attention.push({ id: `unlogged:${u.task.id}`, kind: 'unlogged', text: `${a?.data.title ?? u.task.data.title}: finished ${u.finishedOn || 'on an unknown day'}, not yet logged`, hint: 'Log this visit', to: arrangementRoute(u.arrangementId), arrangementId: u.arrangementId, unlogged: u });
  }
  for (const x of base.attention as AttentionItem[]) {
    const kind: AttentionKind = x.key.startsWith('p') ? 'provider' : x.key.startsWith('h') ? 'schedule' : 'asset';
    attention.push({ id: `arr:${x.key}`, kind, text: x.text, hint: x.hint, to: arrangementRoute(x.arrangementId), arrangementId: x.arrangementId });
  }
  for (const g of base.duplicates.filter((d) => d.reason !== 'lookalike')) {
    attention.push({ id: `dup:${g.key}`, kind: 'duplicate-visits', text: `Possible duplicate visit: ${g.visits[0].data.title}`, hint: 'Nothing was merged. Open each one to look.', to: visitRoute(g.visits[0].id) });
  }
  for (const d of visitsWithDuplicateHandoffs(pairs, i.homeServices)) {
    const v = s.visits.find((x) => x.id === d.visitId);
    if (v) attention.push({ id: `handoff:${d.visitId}`, kind: 'duplicate-handoff', text: `Recorded twice in Home & Assets: ${v.data.title} (${v.data.date})`, hint: 'Possible duplicate maintenance record. Nothing was merged.', to: visitRoute(v.id) });
  }
  const seenRec = new Set<string>();
  for (const r of lifetime.review) {
    if (r.kind !== 'finance-reference' && r.kind !== 'typed-differs' && r.kind !== 'typed-left-out') continue;
    const src = r.sources[0];
    if (!src) continue;
    const id = `${r.kind}:${r.recordIds.join(',')}`;
    if (seenRec.has(id)) continue;
    seenRec.add(id);
    const label = lifetime.claims.find((c) => c.recordId === r.recordIds[0])?.title ?? 'A record';
    const where = sourceTarget(src);
    attention.push({
      id: `fin:${id}`, kind: r.kind === 'finance-reference' ? 'finance-reference' : 'typed-amount',
      text: r.kind === 'finance-reference' ? `A linked payment needs review: ${label}` : r.kind === 'typed-differs' ? `Two typed amounts differ for ${label}` : `A typed amount is not added for ${label}`,
      hint: r.kind === 'finance-reference' ? 'It counts as $0 until you pick the payment again' : r.kind === 'typed-differs' ? 'Only the visit\'s amount is counted' : 'A Finance payment is linked on the same job', ...where,
    });
  }
  for (const v of base.needsReview) attention.push({ id: `review:${v.id}`, kind: 'review-visit', text: `A visit has a status this version does not understand: ${v.data.title}`, hint: 'It counts as nothing and is kept as found', to: visitRoute(v.id) });

  // ---- upcoming: the open Task is THE next visit; later dates are derived from the schedule (nothing is created) ----
  const upcoming: UpcomingRow[] = [];
  const upcomingDays = i.upcomingDays ?? DEFAULT_UPCOMING_DAYS;
  const windowEnd = addDays(today, upcomingDays); // inclusive: a visit exactly this many days away is in, one day later is out
  const names = (aid: number) => (base.rows.find((r) => r.a.id === aid)?.assets ?? []).filter((a) => !a.missing).map((a) => a.name).slice(0, 2);
  for (const r of base.rows) {
    if (r.a.data.status !== 'active') continue;
    const d = r.a.data;
    // The open Task: listed when it is inside the window, or already past (overdue, so it is never hidden by a narrow window).
    if (r.open && r.open.data.dueDate && r.open.data.dueDate <= windowEnd) {
      const occ = markersOf(r.open).occurrence;
      upcoming.push({ key: `t${r.open.id}`, kind: 'task', arrangementId: r.a.id, title: d.title, providerName: d.providerNameSnapshot, providerContactId: d.providerContactId, date: r.open.data.dueDate, time: r.open.data.dueTime ?? d.visitTime, overdue: r.open.data.dueDate < today, movedFrom: occ && occ !== r.open.data.dueDate ? occ : null, taskId: r.open.id, assetNames: names(r.a.id) });
    }
    const state: ScheduleState = scheduleStateOf(r.tasks);
    for (const date of plannedVisitDates(r.a, state, today, today, windowEnd)) {
      upcoming.push({ key: `e${r.a.id}:${date}`, kind: 'expected', arrangementId: r.a.id, title: d.title, providerName: d.providerNameSnapshot, providerContactId: d.providerContactId, date, time: d.visitTime, overdue: false, movedFrom: null, taskId: null, assetNames: names(r.a.id) });
    }
  }
  upcoming.sort((a, b) => a.date.localeCompare(b.date) || (a.kind === b.kind ? 0 : a.kind === 'task' ? -1 : 1) || a.arrangementId - b.arrangementId);

  const contracts: ContractRow[] = deadlines
    .filter((d) => d.date >= today && d.date <= addDays(today, REVIEW_DEADLINE_DAYS))
    .map((d) => ({ ...d, label: DEADLINE_LABEL[d.kind], daysAway: dayDiff(d.date, today), providerName: providerOf(d.arrangementId) }));

  // ---- money and insights ----
  const payAll = payRecords(s.arrangements, s.visits);
  const nameFor = (key: string) => {
    const a = s.arrangements.find((x) => providerKeyOf(x.data.providerContactId, x.data.providerNameSnapshot) === key);
    const v = s.visits.find((x) => providerKeyOf(x.data.providerContactId, x.data.providerNameSnapshot) === key);
    const cid = key.startsWith('c:') ? Number(key.slice(2)) : null;
    return (cid !== null ? s.contacts.find((c) => c.id === cid)?.name : undefined) ?? a?.data.providerNameSnapshot ?? v?.data.providerNameSnapshot ?? key.replace(/^n:/, '');
  };
  const schedule = new Map<number, ScheduleState>(base.rows.map((r) => [r.a.id, scheduleStateOf(r.tasks)]));
  const recordedVisitIds = new Set(pairs.map((p) => p.visitId));
  const insights = buildInsights({
    today, arrangements: s.arrangements, visits: s.visits, payAll, lookup: i.lookup, schedule, period,
    unloggedArrangementIds: new Set(base.unlogged.map((u) => u.arrangementId)), assetIdsBy: s.assetIdsBy, recordedVisitIds,
  }, money);

  const years = new Set<string>();
  for (const v of s.visits) if (/^\d{4}-/.test(v.data.date)) years.add(v.data.date.slice(0, 4));
  for (const p of lifetime.pieces) { const t = p.key ? i.lookup(Number(p.key.split(':')[0]))?.date : undefined; if (t && /^\d{4}-/.test(t)) years.add(t.slice(0, 4)); }
  for (const sv of i.homeServices) if (/^\d{4}-/.test(sv.data.date)) years.add(sv.data.date.slice(0, 4));

  return {
    today, upcomingDays, period, periodOptions: periodChoices(today, [...years]), base, recent: visitRows(s, s.visits.slice(0, RECENT_POOL)),
    counts: { active: base.active.length, paused: base.paused.length, ended: base.ended.length, total: base.rows.length },
    // EVERY visit in the window: the page decides how many rows to show and offers "Show all", so nothing is silently cut here.
    attention, upcoming, contracts, providers: providerList(s), spend, lifetime,
    byProvider: providerBreakdown(payAll, i.lookup, period.range, nameFor), insights,
    estimates: [30, 90, daysBetween(horizonEnd(today), today)].map((n) => expectedWindow(s.arrangements, schedule, today, n)),
  };
}

/**
 * Reads everything the Overview needs, once, read-only: the Services snapshot with its links, the Home & Assets service records, and the Finance
 * transactions that any payment reference points at (one bulk read). Repeated visits to the page read and write nothing else.
 */
export async function loadServicesOverview(period: PeriodId, today: string = todayISO(), d: FinanceDB = db, money?: (c: number) => string, upcomingDays: UpcomingDays = DEFAULT_UPCOMING_DAYS): Promise<ServicesOverview> {
  const [{ snapshot, links }, homeServices] = await Promise.all([loadSnapshotAndLinks(d), loadServices(d)]);
  const refs = [...payRecords(snapshot.arrangements, snapshot.visits).flatMap((r) => r.refs), ...costRecords(snapshot.assets, homeServices).flatMap((r) => r.refs)];
  const lookup = lookupOfMap(await loadTxnMap(refs, d));
  return buildServicesOverview({ snapshot, links, homeServices, lookup, today, period, upcomingDays }, money);
}

