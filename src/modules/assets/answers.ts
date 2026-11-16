/**
 * R3.2 Quick Answers for Home & Assets. READ ONLY. Three questions, each built on this module's own existing readers; no cost, date or status rule is written here.
 *
 *  1. "How much have we spent on home maintenance this year?" The TOTAL is `buildSpending(...)` for the calendar year (the Overview's own spending reader: ONE-source cost
 *     rules, a payment counted once, refunds subtracted, a typed cost never mixed with a linked one), read at its "Maintenance, repairs and inspections" group. The listed records
 *     are the same cost records, each priced by `spend()` on its own, so a row's amount is a record's amount, not a second calculation.
 *  2. "What maintenance is overdue?" The Overview's `attention.overdueTasks` (open, past-due Tasks linked to an in-use asset) and, SEPARATELY, `attention.unsaved`
 *     (finished Tasks not saved to service history). A finished-but-unlogged task is never called overdue.
 *  3. "What warranties are expiring soon?" `effectiveWarranties` and `warrantyStatus` over in-use assets, with a 90-day window (the module's own "soon" is 60 days).
 */
import { db, type FinanceDB } from '../../db';
import { plural, rangeWords, type AnswerContext, type AnswerResult, type AnswerRow } from '../../core/answers';
import { addDays } from '../../lib/dates';
import { daysBetween } from '../../lib/money';
import { loadAssets } from './data';
import { showsWarrantyMarkers } from './dueProvider';
import { buildSpending, recordsForPeriod, type Overview } from './overview';
import { loadOverview } from './overviewData';
import type { AssetRecord } from './model';
import { SERVICE_KIND_LABEL, type ServiceRecord } from './service';
import { loadServices } from './serviceData';
import { costRecords, spend, GROUP_LABEL, type CostRecord } from './spending';
import { loadTxnMap, lookupOfMap } from './txnLookup';
import type { TxnLookup } from './txnRef';
import { effectiveWarranties, groupByAsset, warrantyStatus, type WarrantyRecord } from './warranty';
import { loadWarranties } from './warrantyData';

const SOURCE = 'Home & Assets';
const ASSETS_SOURCE = { module: 'assets', label: 'Home & Assets', href: '#/assets' };

// ---- 1. maintenance spending ----

export const MAINTENANCE_DEFINITION = 'Home maintenance means the "Maintenance, repairs and inspections" work saved in Home & Assets service history. Improvements, replacements and other work, an asset\'s purchase, and recurring Household Services (cleaning, landscaping, childcare and the like) are not included.';

export function maintenanceSpendResult(assets: readonly AssetRecord[], services: readonly ServiceRecord[], lookup: TxnLookup, today: string): AnswerResult {
  const year = today.slice(0, 4);
  const period = { label: `This year so far: ${rangeWords(`${year}-01-01`, today)}`, from: `${year}-01-01`, to: today };
  const base = { period, sources: [ASSETS_SOURCE], fullView: { label: 'Open Home & Assets', href: '#/assets' } };
  if (assets.length === 0) {
    return {
      ...base, status: 'insufficient', headline: ['There is nothing to add up yet: no asset or service history is recorded.'], figures: [], groups: [],
      assumptions: [MAINTENANCE_DEFINITION], limitations: [], missing: { what: 'Service history for your assets', where: 'Home & Assets: add an asset, then save maintenance to its history.', href: '#/assets' },
    };
  }
  // The authoritative figure: the Overview's own spending reader for the calendar year.
  const spending = buildSpending([...assets], [...services], lookup, year);
  const totalCents = spending.household.byGroup.maintenance;
  const otherCents = spending.household.byGroup.other;

  // The records behind it: the same cost records, narrowed to the year by the same function, priced one at a time by the same `spend()`.
  const all = costRecords([...assets], [...services]);
  const byAsset = new Map(assets.map((a) => [a.id, a]));
  const svc = new Map(services.map((s) => [`service:${s.id}`, s]));
  const dateOf = (r: CostRecord): string | null => (r.id.startsWith('service:') ? svc.get(r.id)?.data.date ?? null : byAsset.get(r.assetId)?.data.purchaseDate ?? null);
  const inYear = recordsForPeriod(all, dateOf, lookup, year).records.filter((r) => r.group === 'maintenance' && r.id.startsWith('service:'));
  const priced = inYear.map((r) => {
    const s = spend([r], lookup);
    const cost: { kind: 'amount'; cents: number } | { kind: 'review' } | { kind: 'none' } = s.review.length && s.totalCents === 0 ? { kind: 'review' } : s.unknown.length ? { kind: 'none' } : { kind: 'amount', cents: s.totalCents };
    return { r, rec: svc.get(r.id)!, cost };
  }).sort((a, b) => b.rec.data.date.localeCompare(a.rec.data.date) || b.rec.id - a.rec.id);

  const noCost = priced.filter((p) => p.cost.kind === 'none').length;
  const review = priced.filter((p) => p.cost.kind === 'review').length;
  const SHOW = 8;
  const rows: AnswerRow[] = priced.slice(0, SHOW).map((p) => ({
    id: p.r.id, title: p.rec.data.title, href: `#/assets/${p.rec.data.assetId}`, source: SOURCE,
    detail: `${byAsset.get(p.rec.data.assetId)?.data.name ?? 'An asset'} · ${SERVICE_KIND_LABEL[p.rec.data.kind]}`,
    date: p.rec.data.date, dateLabel: 'Done',
    amounts: p.cost.kind === 'amount' ? [{ label: 'Cost', cents: p.cost.cents, certainty: 'known' as const, strong: true }] : undefined,
    chips: [p.cost.kind === 'none' ? { text: 'No cost recorded', tone: 'warning' as const } : p.cost.kind === 'review' ? { text: 'Payment needs a second look', tone: 'warning' as const } : { text: p.r.refs.length ? 'From a Finance payment' : 'Typed amount', tone: 'neutral' as const }],
  }));

  const perAsset = new Map<number, number>();
  for (const p of priced) if (p.cost.kind === 'amount') perAsset.set(p.rec.data.assetId, (perAsset.get(p.rec.data.assetId) ?? 0) + p.cost.cents);
  const assetRows: AnswerRow[] = [...perAsset].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([id, cents]) => ({
    id: `asset:${id}`, title: byAsset.get(id)?.data.name ?? 'An asset', href: `#/assets/${id}`, source: SOURCE, amounts: [{ label: 'Maintenance', cents, certainty: 'known' as const, strong: true }],
  }));

  const limitations: string[] = [];
  if (noCost > 0) limitations.push(`${plural(noCost, 'maintenance record has', 'maintenance records have')} no cost recorded, so ${noCost === 1 ? 'it is' : 'they are'} not in the total. A missing cost is never counted as zero.`);
  if (review > 0) limitations.push(`${plural(review, 'record has a linked payment', 'records have linked payments')} that changed since it was linked and needs a second look, so ${review === 1 ? 'it is' : 'they are'} left out of the total until you check.`);
  if (assetRows.length > 1) limitations.push('A payment linked to more than one record is counted once in the total, so the by-asset amounts can add up to more than the total.');
  if (otherCents > 0) limitations.push('Work saved as an improvement, a replacement or "other" is a different group in Home & Assets and is not in this figure.');
  limitations.push('Recurring Household Services (such as cleaning or landscaping) are not included: they are not asset maintenance. Their spending is on Household finances.');

  const none = priced.length === 0;
  return {
    ...base,
    status: none ? 'none' : noCost + review > 0 ? 'limited' : 'answered',
    headline: none ? [`No home maintenance work is saved in service history for ${year} so far.`] : ['Home maintenance spending this year is ', { money: totalCents }, `, across ${plural(priced.length, 'saved record')}.`],
    figures: none ? [] : [
      { id: 'maintenance', label: GROUP_LABEL.maintenance, value: { kind: 'money', cents: totalCents, certainty: 'known' } },
      { id: 'records', label: 'Records counted', value: { kind: 'count', n: priced.length } },
    ],
    groups: [
      ...(assetRows.length > 0 ? [{ id: 'assets', heading: 'By asset', rows: assetRows }] : []),
      { id: 'records', heading: 'Supporting service-history records', rows, hidden: Math.max(0, priced.length - SHOW), more: priced.length > SHOW ? { label: 'See all service history', href: '#/assets' } : undefined },
    ],
    assumptions: [
      MAINTENANCE_DEFINITION,
      'The period is the calendar year so far. A linked payment counts in the year of its Finance transaction; a typed cost counts in the year of its record\'s date.',
      'Each cost comes from one source: a linked Finance payment, or an amount typed on the record, never both. Refunds lower the total.',
    ],
    limitations,
  };
}

export async function maintenanceSpendAnswer(ctx: AnswerContext, d: FinanceDB = db): Promise<AnswerResult> {
  const [assets, services] = await Promise.all([loadAssets(d), loadServices(d)]);
  const lookup = lookupOfMap(await loadTxnMap(costRecords(assets, services).flatMap((r) => r.refs), d));
  return maintenanceSpendResult(assets, services, lookup, ctx.today);
}

// ---- 2. overdue maintenance ----

export function overdueResult(o: Pick<Overview, 'attention'>, names: ReadonlyMap<number, string>, today: string): AnswerResult {
  const { overdueTasks, unsaved } = o.attention;
  const nameOf = (ids: number[]) => ids.map((i) => names.get(i)).filter((n): n is string => !!n).join(', ') || 'An asset';
  const rows: AnswerRow[] = overdueTasks.map((t) => ({
    id: `task:${t.taskId}`, title: t.title, href: `#/assets/${t.assetIds[0]}`, source: SOURCE, detail: nameOf(t.assetIds),
    date: t.dueDate, dateLabel: 'Was due', links: [{ label: 'Open task', href: `#/tasks?task=${t.taskId}` }],
    chips: [{ text: `${plural(daysBetween(today, t.dueDate), 'day')} overdue`, tone: 'overdue' as const }],
  }));
  const unsavedRows: AnswerRow[] = unsaved.map((u) => ({
    id: `unsaved:${u.taskId}`, title: u.title, href: `#/assets/${u.assetIds[0]}`, source: SOURCE, detail: nameOf(u.assetIds),
    links: [{ label: 'Open task', href: `#/tasks?task=${u.taskId}` }], chips: [{ text: 'Finished, not saved to history', tone: 'info' as const }],
  }));
  const none = rows.length === 0;
  return {
    status: none ? 'none' : 'answered',
    headline: none ? ['No maintenance task is overdue.'] : [`${plural(rows.length, 'maintenance task is', 'maintenance tasks are')} overdue.`],
    period: { label: 'As of today', from: null, to: null },
    figures: [
      { id: 'overdue', label: 'Overdue maintenance', value: { kind: 'count', n: rows.length } },
      ...(unsavedRows.length > 0 ? [{ id: 'unsaved', label: 'Finished, not saved to history', value: { kind: 'count' as const, n: unsavedRows.length }, note: 'Not overdue work: the job is done, only the record is missing.' }] : []),
    ],
    groups: [
      { id: 'overdue', heading: 'Overdue, oldest first', rows },
      ...(unsavedRows.length > 0 ? [{ id: 'unsaved', heading: 'Finished but not saved to service history', note: 'These are not overdue. The work was marked done; saving it keeps a history of what was done.', rows: unsavedRows }] : []),
    ],
    assumptions: ['Overdue means an open Task with a due date before today that is linked to an asset in use. A Task linked to several assets is listed once.', 'Maintenance Tasks come from the Tasks you linked to your assets.'],
    limitations: ['A maintenance job with no Task and no due date is not known to Ledger, so it cannot be listed.'],
    sources: [ASSETS_SOURCE, { module: 'tasks', label: 'Tasks', href: '#/tasks' }],
    fullView: { label: 'Open Home & Assets', href: '#/assets' },
  };
}

export async function maintenanceOverdueAnswer(ctx: AnswerContext, d: FinanceDB = db): Promise<AnswerResult> {
  const [ov, assets] = await Promise.all([loadOverview('all', ctx.today, d), loadAssets(d)]);
  return overdueResult(ov, new Map(assets.map((a) => [a.id, a.data.name])), ctx.today);
}

// ---- 3. warranties ----

export const WARRANTY_DAYS = 90;

export function warrantiesResult(assets: readonly AssetRecord[], warranties: readonly WarrantyRecord[], today: string): AnswerResult {
  const to = addDays(today, WARRANTY_DAYS - 1);
  const by = groupByAsset([...warranties]);
  const rows: AnswerRow[] = [];
  let noEnd = 0;
  for (const a of assets) {
    if (!showsWarrantyMarkers(a)) continue;
    for (const w of effectiveWarranties(a.id, a.data, by.get(a.id) ?? [])) {
      if (!w.endDate) { noEnd++; continue; }
      if (warrantyStatus(w.endDate, today) === 'expired' || w.endDate > to) continue;
      const left = daysBetween(w.endDate, today);
      rows.push({
        id: `warranty:${w.id ?? `asset-${a.id}`}`, title: a.data.name, detail: w.title, href: `#/assets/${a.id}${w.id === null ? '' : `?warranty=${w.id}`}`, source: SOURCE,
        date: w.endDate, dateLabel: 'Ends', chips: [{ text: left === 0 ? 'Ends today' : `${plural(left, 'day')} left`, tone: left <= 30 ? ('warning' as const) : ('neutral' as const) }],
      });
    }
  }
  rows.sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '') || a.id.localeCompare(b.id));
  const none = rows.length === 0;
  return {
    status: none ? 'none' : 'answered',
    headline: none ? ['No warranty on an asset in use ends in the next 90 days.'] : [`${plural(rows.length, 'warranty ends', 'warranties end')} in the next 90 days. The first is ${rows[0].title}.`],
    period: { label: `The next 90 days: ${rangeWords(today, to)}`, from: today, to },
    figures: [{ id: 'count', label: 'Warranties ending', value: { kind: 'count', n: rows.length } }],
    groups: [{ id: 'warranties', heading: 'Ending soonest first', rows }],
    assumptions: ['The end date is the last day the warranty is covered. Only assets in use (active or stored) are checked.', 'A warranty with no end date cannot be placed in time, so it is not listed.'],
    limitations: [...(noEnd > 0 ? [`${plural(noEnd, 'warranty has', 'warranties have')} no end date recorded and cannot be listed.`] : []), 'Ledger does not know replacement costs, and an ending warranty does not mean anything needs doing.'],
    sources: [ASSETS_SOURCE],
    fullView: { label: 'Open Home & Assets', href: '#/assets' },
  };
}

export async function warrantiesExpiringAnswer(ctx: AnswerContext, d: FinanceDB = db): Promise<AnswerResult> {
  const [assets, warranties] = await Promise.all([loadAssets(d), loadWarranties(d)]);
  return warrantiesResult(assets, warranties, ctx.today);
}
