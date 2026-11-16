/**
 * YEAR AHEAD loader (R3.1). READ ONLY. Each source is read on its own and wrapped, so one failure removes only what depends on it (the pure composer then says the review
 * is incomplete and shows no figure for that group). It runs only when the Year Ahead page is opened: nothing here is loaded by Today or at start-up, nothing is stored or
 * cached, and every table is read with the same loaders the owning module's own screen uses.
 */
import { db, type FinanceDB } from '../../db';
import { todayISO } from '../../lib/money';
import { addMonths } from '../../lib/dates';
import { DEFAULT_FORECAST, loadForecast, type ForecastSettings } from '../../lib/forecastLive';
import { derive, loadBillsSnapshot } from '../bills/readModel';
import { loadAssets } from '../assets/data';
import { showsWarrantyMarkers } from '../assets/dueProvider';
import { loadAssetLinks } from '../assets/overviewData';
import { taskAssetMap } from '../assets/overview';
import { effectiveWarranties, groupByAsset } from '../assets/warranty';
import { loadWarranties } from '../assets/warrantyData';
import { loadCommitments, loadProjects } from '../projects/data';
import { OPEN_STATUSES } from '../projects/model';
import { loadProjectSummary } from '../../lib/txnProject';
import { scheduleStateOf } from '../services/expectedCharges';
import { buildOverview, loadSnapshotAndLinks } from '../services/views';
import { loadTasks } from '../tasks/data';
import { isOverdue } from '../tasks/views';
import { composeYearAhead, type AssetsPart, type BillsPart, type FinancePart, type Part, type ProjectsPart, type ServicesPart, type YearAhead, type YearAheadParts } from './yearAhead';

async function attempt<T>(read: () => Promise<T>): Promise<Part<T>> {
  try { return { ok: true, value: await read() }; }
  catch (e) { return { ok: false, error: e instanceof Error ? e.message : 'Something went wrong while reading.' }; }
}

const readBills = (today: string, d: FinanceDB) => async (): Promise<BillsPart> => {
  const snap = await loadBillsSnapshot(d);
  return { obligations: snap.obligations, derived: derive(snap, today), serviceLinks: snap.serviceLinks ?? new Map() };
};

const readServices = (d: FinanceDB) => async (): Promise<ServicesPart> => {
  const { snapshot } = await loadSnapshotAndLinks(d);
  const base = buildOverview(snapshot);
  return { arrangements: snapshot.arrangements, state: new Map(base.rows.map((r) => [r.a.id, scheduleStateOf(r.tasks)])) };
};

const readFinance = (today: string, d: FinanceDB) => async (): Promise<FinancePart> => {
  const saved = ((await d.settings.get('forecast'))?.value ?? {}) as Partial<ForecastSettings>;
  const months = saved.months ?? DEFAULT_FORECAST.months;
  // The Forecast's own loan and tax items, asked for thirteen months so the whole window is covered whatever horizon the owner chose on the Forecast page.
  const [fc, rules, logs, accounts] = await Promise.all([loadForecast(d, today, { months: 13 }), d.recurring.toArray(), d.recurringLog.toArray(), d.accounts.toArray()]);
  return {
    rules,
    handled: new Set(logs.map((l) => `${l.ruleId}|${l.date}`)),
    cashAccountIds: new Set(accounts.filter((a) => !a.closed && (a.kind === 'checking' || a.kind === 'savings' || a.kind === 'credit_card')).map((a) => a.id as number)),
    loans: fc.input.loans.map((l) => ({ date: l.date, label: l.label, cents: l.paymentCents })),
    taxes: fc.input.taxes.map((t) => ({ date: t.date, label: t.label, cents: t.cents })),
    forecastEnd: addMonths(`${today.slice(0, 7)}-01`, months),
    includeTaxes: saved.includeTaxes ?? DEFAULT_FORECAST.includeTaxes,
  };
};

const readProjects = (d: FinanceDB) => async (): Promise<ProjectsPart> => {
  const items: ProjectsPart['items'] = [];
  for (const p of (await loadProjects(d)).filter((x) => !x.data.archived && OPEN_STATUSES.includes(x.data.status))) {
    const [summary, commitments] = await Promise.all([loadProjectSummary(d, p.id), loadCommitments(p.id, d)]);
    if (!summary) continue;
    for (const c of summary.contracts) {
      if (c.status !== 'accepted' || c.leftCents <= 0) continue;
      const root = commitments.find((x) => x.id === c.rootId);
      items.push({ projectId: p.id, projectName: p.data.name, commitmentId: c.rootId, title: root?.data.title ?? 'Agreement', agreedCents: c.agreedCents, paidCents: c.paidCents, leftCents: c.leftCents, targetDate: p.data.targetDate });
    }
  }
  return { items };
};

const readAssets = (today: string, d: FinanceDB) => async (): Promise<AssetsPart> => {
  const [assets, warranties, links] = await Promise.all([loadAssets(d), loadWarranties(d), loadAssetLinks(d)]);
  const tasks = links.some((l) => l.fromModule === 'tasks' || l.toModule === 'tasks') ? await loadTasks(d) : [];
  const inUse = assets.filter(showsWarrantyMarkers);
  const by = groupByAsset(warranties);
  const out: AssetsPart = { warranties: [], maintenance: [], overdueMaintenance: 0 };
  for (const a of inUse) for (const w of effectiveWarranties(a.id, a.data, by.get(a.id) ?? [])) if (w.endDate) out.warranties.push({ key: w.id === null ? `asset-${a.id}` : String(w.id), assetId: a.id, assetName: a.data.name, title: w.title, date: w.endDate, warrantyId: w.id });
  const nameOf = new Map(inUse.map((a) => [a.id, a.data.name]));
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  for (const [tid, aids] of taskAssetMap(links, new Set(assets.map((a) => a.id)))) {
    const t = taskById.get(tid);
    const aid = aids.find((x) => nameOf.has(x));
    if (!t || t.data.status === 'done' || !t.data.dueDate || aid === undefined) continue;
    if (isOverdue(t, today)) out.overdueMaintenance++;
    else out.maintenance.push({ taskId: tid, title: t.data.title, date: t.data.dueDate, assetId: aid, assetName: nameOf.get(aid) ?? '' });
  }
  return out;
};

/** Reads every source independently (read-only) and composes the year. A failed source never blocks the others. */
export async function loadYearAhead(today: string = todayISO(), d: FinanceDB = db): Promise<YearAhead> {
  const [bills, services, finance, projects, assets] = await Promise.all([attempt(readBills(today, d)), attempt(readServices(d)), attempt(readFinance(today, d)), attempt(readProjects(d)), attempt(readAssets(today, d))]);
  const parts: YearAheadParts = { bills, services, finance, projects, assets };
  return composeYearAhead(today, parts);
}
