/**
 * The Home & Assets overview (H5), worked out from records that already exist. PURE: nothing is stored, nothing is written, and there is no
 * rule of its own for "overdue", "expiring", "unsaved" or "needs review". It only asks the existing code:
 *   - overdue / open: Tasks' own `isOverdue` (tasks/views);
 *   - expiring warranty: H4's `warrantyStatus` ('soon' = within 60 days, end day included) over `effectiveWarranties` (implicit H1 warranty hidden once a real one exists);
 *   - completed task not saved to history: H2's `unsavedTasks`; duplicate history: H2's `duplicateTaskGroups`;
 *   - money: H3's `spend()` unchanged. This file only chooses WHICH cost records and references go in (by their own dates) and groups them.
 *
 * "In use" assets (not archived, status In use or Stored) are the ones whose upcoming maintenance and warranties raise attention. This is the
 * same rule that decides whether a warranty puts a marker on the Calendar (`showsWarrantyMarkers`), so the two never disagree. Archived and
 * Sold / Disposed / Replaced assets keep their history and their money, and raise nothing.
 */
import type { Link } from '../../core/entities';
import type { TaskRecord } from '../tasks/model';
import { isOverdue } from '../tasks/views';
import { showsWarrantyMarkers } from './dueProvider';
import { duplicateTaskGroups, unsavedTasks } from './maintenance';
import { parseAssetRef, type AssetRecord } from './model';
import type { ServiceRecord } from './service';
import { costRecords, spend, type CostRecord, type SpendSummary } from './spending';
import type { TxnLookup, TxnRef } from './txnRef';
import { effectiveWarranties, groupByAsset, warrantyStatus, type WarrantyRecord } from './warranty';

/** How many rows each overview block lists. The rest is one click away on the asset or in Tasks. */
export const OVERVIEW_ROWS = 6;

// ---- which tasks belong to which assets ----

/** Task id -> ids of the live assets it is linked to, read from the shared links (either direction). Links to missing assets are ignored. */
export function taskAssetMap(links: Link[], liveAssetIds: Set<number>): Map<number, number[]> {
  const m = new Map<number, Set<number>>();
  for (const l of links) {
    const [aSide, tSide] = l.fromModule === 'assets' && l.toModule === 'tasks' ? [l.fromId, l.toId] : l.toModule === 'assets' && l.fromModule === 'tasks' ? [l.toId, l.fromId] : [null, null];
    if (aSide === null || tSide === null) continue;
    const aid = parseAssetRef(aSide);
    const tid = Number(tSide);
    if (aid === null || !Number.isFinite(tid) || !liveAssetIds.has(aid)) continue;
    m.set(tid, (m.get(tid) ?? new Set()).add(aid));
  }
  return new Map([...m].map(([t, s]) => [t, [...s].sort((a, b) => a - b)]));
}

// ---- rows ----

export interface MaintenanceRow { taskId: number; title: string; dueDate: string; overdue: boolean; assetIds: number[] }
export interface WarrantyRow { assetId: number; warrantyId: number | null; title: string; endDate: string; daysLeft: number; providerContactId: number | null }
export interface UnsavedRow { taskId: number; title: string; assetIds: number[] }
export interface ServiceRow { service: ServiceRecord; /** what it cost, worked out by `spend()` for this one record */ cost: { kind: 'amount'; cents: number } | { kind: 'review' } | { kind: 'none' } }

export interface Attention {
  /** Distinct open, past-due tasks linked to at least one in-use asset (a task on three assets counts once). */
  overdueTasks: MaintenanceRow[];
  /** Distinct in-use assets that have at least one of those tasks. */
  overdueAssetIds: number[];
  expiringWarranties: WarrantyRow[];
  unsaved: UnsavedRow[];
  /** Jobs saved twice (one task, several service records). */
  duplicateJobs: number;
  /** Records pointing at an asset that is not here (H4 orphans). */
  orphans: number;
  /** Finance references that are left out of the totals because the transaction or split changed (H3). */
  reviewRefs: number;
}
export const attentionTotal = (a: Attention) => a.overdueTasks.length + a.expiringWarranties.length + a.unsaved.length + a.duplicateJobs + a.orphans + a.reviewRefs;

const dayDiff = (to: string, from: string) => Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000);

// ---- spending ----

/** 'all' = lifetime; otherwise a four-digit calendar year ('2026'). */
export type Period = 'all' | string;
export const isYear = (p: Period) => /^\d{4}$/.test(p);

export interface PlaceSpend { rootId: number; name: string; summary: SpendSummary }
export interface SpendingOverview {
  period: Period;
  /** Every asset together, each payment once. The only whole-household figure. */
  household: SpendSummary;
  /** The same records split by the property / top-level asset they sit under. A payment linked in two places is counted once in each place, so these may add up to more than the household figure. */
  places: PlaceSpend[];
  placesSumCents: number;
  /** Typed costs with no date: they can only be shown under "All time". */
  undatedTyped: number;
  /** Calendar years that have anything dated, newest first. */
  years: string[];
}

/** The top of the asset's place chain. Cycle-proof and bounded. */
export function rootOf(assets: AssetRecord[], id: number): number {
  const by = new Map(assets.map((a) => [a.id, a]));
  const seen = new Set<number>();
  let cur = id;
  while (!seen.has(cur) && seen.size < 20) {
    seen.add(cur);
    const p = by.get(cur)?.data.parentId;
    if (p === null || p === undefined || !by.has(p)) return cur;
    cur = p;
  }
  return cur;
}

/** The day a Finance reference counts on: the LIVE transaction's date, else the date it was linked with, else the record's own date. */
const refDate = (r: TxnRef, lookup: TxnLookup, recordDate: string | null) => lookup(r.txnId)?.date || r.snapshot.date || recordDate;

/**
 * Narrows cost records to one calendar year, by each piece's OWN date, without touching how `spend()` counts:
 *  - a Finance reference counts in the year of its transaction (a record paid across two years is split by reference);
 *  - a typed cost counts in the year of its record's date (service date, or purchase date);
 *  - a typed cost with no date is left out of every year and reported as `undatedTyped`.
 * Unknown costs are kept with their record's date so they are still reported, never counted as $0.
 */
export function recordsForPeriod(records: CostRecord[], dateOf: (r: CostRecord) => string | null, lookup: TxnLookup, period: Period): { records: CostRecord[]; undatedTyped: number } {
  if (!isYear(period)) return { records, undatedTyped: 0 };
  const inYear = (d: string | null) => !!d && d.startsWith(`${period}-`);
  const out: CostRecord[] = [];
  let undatedTyped = 0;
  for (const r of records) {
    const date = dateOf(r);
    if (r.refs.length) {
      const kept = r.refs.filter((x) => inYear(refDate(x, lookup, date)));
      // References win over a typed amount (H3); manualCents is dropped so a year's slice does not repeat the "both" notice.
      if (kept.length) out.push({ ...r, refs: kept, manualCents: null });
    } else if (r.manualCents !== null) {
      if (date === null) undatedTyped++;
      else if (inYear(date)) out.push(r);
    } else if (inYear(date)) out.push(r);
  }
  return { records: out, undatedTyped };
}

export function buildSpending(assets: AssetRecord[], services: ServiceRecord[], lookup: TxnLookup, period: Period): SpendingOverview {
  const all = costRecords(assets, services);
  const byAsset = new Map(assets.map((a) => [a.id, a]));
  const serviceById = new Map(services.map((s) => [`service:${s.id}`, s]));
  const dateOf = (r: CostRecord): string | null => (r.id.startsWith('service:') ? serviceById.get(r.id)?.data.date ?? null : byAsset.get(r.assetId)?.data.purchaseDate ?? null);

  const years = new Set<string>();
  for (const r of all) for (const d of [dateOf(r), ...r.refs.map((x) => refDate(x, lookup, dateOf(r)))]) if (d && /^\d{4}-/.test(d)) years.add(d.slice(0, 4));

  const { records, undatedTyped } = recordsForPeriod(all, dateOf, lookup, period);
  const household = spend(records, lookup);
  const groups = new Map<number, CostRecord[]>();
  for (const r of records) { const k = rootOf(assets, r.assetId); groups.set(k, [...(groups.get(k) ?? []), r]); }
  const places: PlaceSpend[] = [];
  for (const [rootId, rs] of groups) {
    const summary = spend(rs, lookup);
    if (summary.totalCents === 0 && !summary.review.length && !summary.unknown.length && !summary.pieces.length) continue;
    places.push({ rootId, name: byAsset.get(rootId)?.data.name ?? '(asset removed)', summary });
  }
  places.sort((a, b) => b.summary.totalCents - a.summary.totalCents || a.name.localeCompare(b.name));
  return { period, household, places, placesSumCents: places.reduce((n, p) => n + p.summary.totalCents, 0), undatedTyped, years: [...years].sort().reverse() };
}

// ---- the whole overview ----

export interface OverviewInput {
  assets: AssetRecord[];
  warranties: WarrantyRecord[];
  services: ServiceRecord[];
  tasks: TaskRecord[];
  links: Link[];
  lookup: TxnLookup;
  orphanCount: number;
  today: string;
  period: Period;
}
export interface Overview {
  attention: Attention;
  upcoming: MaintenanceRow[];
  upcomingTotal: number;
  warranties: WarrantyRow[];
  recent: ServiceRow[];
  spending: SpendingOverview;
  counts: { inUse: number; total: number };
}

export function buildOverview(i: OverviewInput): Overview {
  const live = new Set(i.assets.map((a) => a.id));
  const inUse = new Set(i.assets.filter(showsWarrantyMarkers).map((a) => a.id));
  const taskAssets = taskAssetMap(i.links, live);
  const taskById = new Map(i.tasks.map((t) => [t.id, t]));
  const mine = (assetIds: number[]) => assetIds.filter((x) => inUse.has(x));

  // Open dated maintenance: one row per TASK, however many assets it is linked to.
  const maintenance: MaintenanceRow[] = [];
  for (const [tid, aids] of taskAssets) {
    const t = taskById.get(tid);
    const ids = mine(aids);
    if (!t || t.data.status === 'done' || !t.data.dueDate || !ids.length) continue;
    maintenance.push({ taskId: tid, title: t.data.title, dueDate: t.data.dueDate, overdue: isOverdue(t, i.today), assetIds: ids });
  }
  maintenance.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.taskId - b.taskId);
  const overdueTasks = maintenance.filter((m) => m.overdue);

  // Warranties that end within the H4 window, for in-use assets, using the same stored-or-implicit choice the asset page and Calendar make.
  const wByAsset = groupByAsset(i.warranties);
  const warranties: WarrantyRow[] = [];
  for (const a of i.assets) {
    if (!inUse.has(a.id)) continue;
    for (const w of effectiveWarranties(a.id, a.data, wByAsset.get(a.id) ?? [])) {
      if (w.endDate && warrantyStatus(w.endDate, i.today) === 'soon') warranties.push({ assetId: a.id, warrantyId: w.id, title: w.title, endDate: w.endDate, daysLeft: dayDiff(w.endDate, i.today), providerContactId: w.providerContactId });
    }
  }
  warranties.sort((a, b) => a.endDate.localeCompare(b.endDate) || a.assetId - b.assetId || (a.warrantyId ?? 0) - (b.warrantyId ?? 0));

  // Completed linked tasks with no saved service record (H2's rule), counted once per task.
  const servicesOfLive = i.services.filter((s) => live.has(s.data.assetId));
  const unsavedByTask = new Map<number, number[]>();
  for (const aid of inUse) {
    const completed = [...taskAssets].filter(([, ids]) => ids.includes(aid)).map(([tid]) => taskById.get(tid)).filter((t): t is TaskRecord => !!t && t.data.status === 'done');
    for (const t of unsavedTasks(completed, servicesOfLive.filter((s) => s.data.assetId === aid))) unsavedByTask.set(t.id, [...(unsavedByTask.get(t.id) ?? []), aid]);
  }
  const unsaved: UnsavedRow[] = [...unsavedByTask].map(([taskId, assetIds]) => ({ taskId, title: taskById.get(taskId)!.data.title, assetIds: [...assetIds].sort((x, y) => x - y) })).sort((a, b) => a.taskId - b.taskId);

  // Money, once, over every asset (history and past assets still count); the spending block narrows it by period.
  const spending = buildSpending(i.assets, i.services, i.lookup, i.period);
  const lifetime = i.period === 'all' ? spending.household : spend(costRecords(i.assets, i.services), i.lookup);

  const assetById = new Map(i.assets.map((a) => [a.id, a]));
  const recent: ServiceRow[] = [...servicesOfLive]
    .sort((a, b) => b.data.date.localeCompare(a.data.date) || b.id - a.id)
    .slice(0, OVERVIEW_ROWS)
    .map((s) => {
      const rec = costRecords([assetById.get(s.data.assetId)!], [s]).filter((r) => r.id === `service:${s.id}`);
      const r = spend(rec, i.lookup);
      const cost: ServiceRow['cost'] = r.review.length && r.totalCents === 0 ? { kind: 'review' } : r.unknown.length ? { kind: 'none' } : { kind: 'amount', cents: r.totalCents };
      return { service: s, cost };
    });

  const attention: Attention = {
    overdueTasks,
    overdueAssetIds: [...new Set(overdueTasks.flatMap((m) => m.assetIds))].sort((a, b) => a - b),
    expiringWarranties: warranties,
    unsaved,
    duplicateJobs: duplicateTaskGroups(servicesOfLive).length,
    orphans: i.orphanCount,
    reviewRefs: lifetime.review.length,
  };
  return {
    attention,
    upcoming: maintenance.slice(0, OVERVIEW_ROWS),
    upcomingTotal: maintenance.length,
    warranties: warranties.slice(0, OVERVIEW_ROWS),
    recent,
    spending,
    counts: { inUse: inUse.size, total: i.assets.length },
  };
}
