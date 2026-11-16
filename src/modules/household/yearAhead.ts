/**
 * YEAR AHEAD (R3.1). PURE: no database, no clock, nothing stored. A read-only composition of what the existing readers already say about the next twelve months.
 *
 * It owns NO rule about money. Every row comes from a reader that already exists, and the figures that matter are the readers' own:
 *   - Bills and Household Services: the dates and amounts are the ones `buildCommitments` (Bills) and `expectedWindow` (Services) use, and the group figures ARE B5's
 *     `householdCommitments().twelve` figures (so this page can never disagree with Household Finances). Linked bills and services are folded by B5's own rule
 *     (exactly one link each way, equal totals); anything less certain keeps both and says so.
 *   - Finance: Scheduled spending rules (the same date generator the Scheduled page uses), loan payments and tax amounts from the Forecast's own input. A rule that a
 *     bill points at is counted once, as the bill. A rule whose payee resembles a bill, an arrangement or a loan is listed as a POSSIBLE OVERLAP and kept OUT of the figure.
 *   - Projects: the agreed amount still left to pay on an accepted agreement (`summariseProject`), never the budget, never what was paid. No payment date is stored for a
 *     commitment, so every such row is "Date not specified"; none is invented.
 *   - Home & Assets: warranty end dates and open dated maintenance. Informational only: no replacement cost exists, and none is made up.
 *
 * Three figures groups are kept apart and NEVER added together: Bills and services, Finance-only, Projects. Recorded spending and the Forecast's cash balances are not
 * used here at all. An amount that is not known stays "not known" (never zero). A source that fails to load removes ITS group's figure instead of shrinking it.
 */
import { addDays, addMonths } from '../../lib/dates';
import { occurrencesBetween } from '../../lib/financeRead';
import { namesOfBill, payeeMatch, type PayeeName } from '../../lib/payeeMatch';
import { buildCommitments, commitmentWindow } from '../bills/commitments';
import { expectedAmountOn, isLoanExcluded, scheduleSource, type ObligationRecord } from '../bills/model';
import { expectedDates } from '../bills/schedule';
import { holdersOf } from '../bills/scheduledLink';
import { upcomingDeadlines, type Derived } from '../bills/readModel';
import { DEADLINE_LABEL } from '../bills/terms';
import type { ScheduleState } from '../services/expectedCharges';
import { contractDeadlines } from '../services/contract';
import type { ArrangementRecord } from '../services/model';
import type { RecurringRule } from '../../types';
import { addRow, hasPriceDispute, householdCommitments, servicesRows, type Consolidation, type HouseholdCommitments, type Totals } from './commitments';
import type { Certainty } from './model';

export type Source = 'bills' | 'services' | 'finance' | 'projects' | 'assets';
export const SOURCE_LABEL: Record<Source, string> = { bills: 'Bills & Subscriptions', services: 'Household Services', finance: 'Finance', projects: 'Projects', assets: 'Home & Assets' };
export const SOURCE_ORDER: readonly Source[] = ['bills', 'services', 'finance', 'projects', 'assets'];
export type RowKind = 'bill' | 'visit' | 'scheduled' | 'loan' | 'tax' | 'project' | 'renewal' | 'trial' | 'notice' | 'warranty' | 'maintenance';
export const KIND_LABEL: Record<RowKind, string> = { bill: 'Bill', visit: 'Service visit', scheduled: 'Scheduled payment', loan: 'Loan payment', tax: 'Tax payment', project: 'Project payment', renewal: 'Renewal date', trial: 'Trial ends', notice: 'Cancel-by deadline', warranty: 'Warranty ends', maintenance: 'Maintenance due' };
/** Which figure group a financial row belongs to. */
export type Group = 'billsServices' | 'finance' | 'projects';
export const GROUP_LABEL: Record<Group, string> = { billsServices: 'Bills and services', finance: 'Finance-only payments', projects: 'Project payments' };

export interface YaRow {
  id: string;
  source: Source;
  kind: RowKind;
  /** true: money that may leave. false: a date to prepare for; it never has an amount. */
  financial: boolean;
  title: string;
  /** null = Date not specified (only project commitments). */
  date: string | null;
  /** Whole cents, or null when not known (never zero). */
  cents: number | null;
  /** null on a date-only row. */
  certainty: Certainty | null;
  /** Plain words, no amounts. */
  note: string;
  href: string;
  /** A linked service visit that is counted once, as the bill. Listed, not added. */
  folded: boolean;
  /** Plain words naming the record it may duplicate. Such a Finance row is NOT in the Finance-only figure. */
  overlap: string | null;
  /** Whether the Finance Forecast already contains this payment. null = not a claim this page can make. */
  forecast: 'in' | 'not' | null;
  /** Happens at most four times in the window (annual, quarterly, one-off): worth setting money aside for. */
  irregular: boolean;
}

export type Part<T> = { ok: true; value: T } | { ok: false; error: string };
export interface BillsPart { obligations: ObligationRecord[]; derived: Derived; serviceLinks: Map<number, number[]> }
export interface ServicesPart { arrangements: ArrangementRecord[]; state: Map<number, ScheduleState> }
export interface FinancePart {
  rules: RecurringRule[];
  /** `${ruleId}|${date}` already posted or skipped. */
  handled: Set<string>;
  /** Open accounts the Forecast reads scheduled items from (checking, savings, credit card). */
  cashAccountIds: Set<number>;
  /** The Forecast's own loan and tax items (signed: money out is negative for tax; loans are payment amounts). Refunds are ignored. */
  loans: { date: string; label: string; cents: number }[];
  taxes: { date: string; label: string; cents: number }[];
  /** Last day (exclusive) the Forecast projects, and whether it includes tax. */
  forecastEnd: string;
  includeTaxes: boolean;
}
export interface ProjectItem { projectId: number; projectName: string; commitmentId: number; title: string; agreedCents: number; paidCents: number; leftCents: number; targetDate: string | null }
export interface ProjectsPart { items: ProjectItem[] }
export interface AssetsPart {
  warranties: { key: string; assetId: number; assetName: string; title: string; date: string; warrantyId: number | null }[];
  maintenance: { taskId: number; title: string; date: string; assetId: number; assetName: string }[];
  overdueMaintenance: number;
}
export interface YearAheadParts { bills: Part<BillsPart>; services: Part<ServicesPart>; finance: Part<FinancePart>; projects: Part<ProjectsPart>; assets: Part<AssetsPart> }

export interface Figures { complete: boolean; totals: Totals }
export interface ProjectFigures { complete: boolean; leftCents: number; count: number; undated: number }
export interface YaPeriod {
  index: number; from: string; to: string;
  rows: YaRow[];
  /** Per-period subtotals. `null` when that group's figure is not complete. Never added to each other. */
  billsServices: Totals | null; finance: Totals | null;
  payments: number; deadlines: number;
}
export interface Attn { id: string; kind: 'overlap' | 'unknown' | 'irregular' | 'undated' | 'deadline' | 'maintenance' | 'source'; title: string; reason: string; href: string | null }

export interface YearAhead {
  today: string; from: string; to: string;
  periods: YaPeriod[];
  undated: YaRow[];
  /** Every dated row, in order. */
  rows: YaRow[];
  figures: { billsServices: Figures; finance: Figures; projects: ProjectFigures };
  /** Bills and services figures exactly as Household Finances shows them (null when either source failed). */
  commitments: HouseholdCommitments | null;
  deadlineCount: number;
  /** Finance scheduled payments a bill points at, counted once as the bill. */
  linkedScheduled: number;
  possibleOverlaps: number;
  sources: { id: Source; label: string; ok: boolean; error?: string }[];
  incomplete: boolean;
  attention: Attn[];
  overdueMaintenance: number;
}

const FINANCE_SCHEDULED = '#/ledger/scheduled';
const rank = (r: YaRow) => (r.financial ? 0 : 1);
const sortRows = (a: YaRow, b: YaRow) => (a.date ?? '').localeCompare(b.date ?? '') || rank(a) - rank(b) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id, 'en', { numeric: true });

/** The twelve rolling periods of the window: [today + k months, today + k+1 months - 1 day], contiguous, ending on the window's own last day. */
export function periodsOf(today: string): { from: string; to: string }[] {
  const out: { from: string; to: string }[] = [];
  for (let k = 0; k < 12; k++) out.push({ from: addMonths(today, k), to: addDays(addMonths(today, k + 1), -1) });
  return out;
}

// ---- Bills ----

/** One row per expected billing date: the SAME dates and amounts `buildCommitments` totals (a test pins that the sums agree). */
export function billRows(obligations: ObligationRecord[], today: string, forecastIn: (o: ObligationRecord) => boolean | null): YaRow[] {
  const w = commitmentWindow(today);
  const out: YaRow[] = [];
  for (const r of obligations) {
    const d = r.data;
    if (isLoanExcluded(d)) continue;
    if (!d.schedule && d.scheduleHistory.length === 0) continue;
    const dates = expectedDates(scheduleSource(d), w.from, w.to);
    const irregular = dates.length > 0 && dates.length <= 4;
    const disputed = hasPriceDispute(r);
    const f = forecastIn(r);
    for (const e of dates) {
      const a = expectedAmountOn(d, e.nominal);
      const certainty: Certainty = a.cents === null ? (disputed ? 'disputed' : 'unknown') : a.basis === 'fixed' ? 'known' : 'estimated';
      const date = e.nominal; // the same date `buildCommitments` uses
      out.push({ id: `bill:${r.id}:${e.slot}`, source: 'bills', kind: 'bill', financial: true, title: d.title, date, cents: a.cents, certainty, note: certainty === 'disputed' ? 'Recorded prices disagree, so no amount is shown.' : '', href: `#/bills/o/${r.id}`, folded: false, overlap: null, forecast: f === null ? null : f ? 'in' : 'not', irregular });
    }
  }
  return out;
}

// ---- Finance ----

const isCashRule = (r: RecurringRule) => !r.transferAccountId && r.amountCents < 0;

export function financeRows(f: FinancePart, today: string, obligations: ObligationRecord[] | null, arrangements: ArrangementRecord[] | null): { rows: YaRow[]; linkedScheduled: number } {
  const w = commitmentWindow(today);
  const out: YaRow[] = [];
  let linkedScheduled = 0;
  const loanNames: PayeeName[] = f.loans.map((l) => ({ text: l.label.replace(/ payment$/i, ''), via: 'title' as const }));
  const unchecked = obligations === null ? 'Bills could not be read, so a duplicate of a bill cannot be ruled out.' : null;
  for (const r of f.rules) {
    if (!r.active || !isCashRule(r)) continue;
    const id = r.id as number;
    const dates = occurrencesBetween(r, w.from, w.to).filter((d) => !f.handled.has(`${id}|${d}`));
    if (dates.length === 0) continue;
    if (obligations && holdersOf(id, obligations).length > 0) { linkedScheduled++; continue; } // a bill points at it: counted once, as the bill
    let overlap: string | null = unchecked;
    if (!overlap && obligations) {
      for (const o of obligations) if (!isLoanExcluded(o.data) && payeeMatch(r.payee, namesOfBill(o.data)).kind !== 'none') { overlap = `This may be the same expense as the bill "${o.data.title}".`; break; }
    }
    if (!overlap && arrangements) {
      for (const a of arrangements) if (a.data.status === 'active' && payeeMatch(r.payee, ([{ text: a.data.title, via: 'title' }, { text: a.data.providerNameSnapshot, via: 'provider' }] as PayeeName[]).filter((n) => n.text.trim())).kind !== 'none') { overlap = `This may be the same expense as the household service "${a.data.title}".`; break; }
    }
    if (!overlap && payeeMatch(r.payee, loanNames).kind !== 'none') overlap = 'This may be the same expense as a loan payment listed below.';
    const inForecast = f.cashAccountIds.has(r.accountId);
    const irregular = dates.length <= 4;
    for (const date of dates) out.push({ id: `rule:${id}:${date}`, source: 'finance', kind: 'scheduled', financial: true, title: r.payee || 'Scheduled payment', date, cents: -r.amountCents, certainty: 'known', note: 'The amount on the Finance scheduled payment.', href: `${FINANCE_SCHEDULED}?rule=${id}`, folded: false, overlap, forecast: inForecast && date > today && date < f.forecastEnd ? 'in' : 'not', irregular });
  }
  for (const l of f.loans) {
    if (l.date < w.from || l.date > w.to) continue;
    out.push({ id: `loan:${l.label}:${l.date}`, source: 'finance', kind: 'loan', financial: true, title: l.label, date: l.date, cents: l.cents, certainty: 'estimated', note: "Worked out from the loan's terms and rate history. Extra payments are not included.", href: '#/ledger/debt', folded: false, overlap: null, forecast: l.date < f.forecastEnd ? 'in' : 'not', irregular: false });
  }
  for (const t of f.taxes) {
    if (t.cents >= 0 || t.date < w.from || t.date > w.to) continue; // a refund is money coming in, not something to prepare for
    out.push({ id: `tax:${t.label}:${t.date}`, source: 'finance', kind: 'tax', financial: true, title: t.label, date: t.date, cents: -t.cents, certainty: 'estimated', note: "An estimate from the Tax plan, not a bill. Ledger does not schedule or pay it.", href: '#/ledger/taxplan', folded: false, overlap: null, forecast: f.includeTaxes && t.date < f.forecastEnd ? 'in' : 'not', irregular: true });
  }
  return { rows: out, linkedScheduled };
}

// ---- Projects and Home & Assets ----

export function projectRows(p: ProjectsPart): YaRow[] {
  return p.items.filter((i) => i.leftCents > 0).map((i) => ({
    id: `project:${i.projectId}:${i.commitmentId}`, source: 'projects', kind: 'project', financial: true, title: `${i.projectName}: ${i.title}`, date: null, cents: i.leftCents, certainty: 'known',
    note: i.targetDate ? `Agreed amount still to pay. The project's target date is ${i.targetDate}; no payment date is recorded.` : 'Agreed amount still to pay. No payment date is recorded.',
    href: `#/projects/${i.projectId}`, folded: false, overlap: null, forecast: null, irregular: false,
  }));
}

export function assetRows(a: AssetsPart, today: string): YaRow[] {
  const w = commitmentWindow(today);
  const out: YaRow[] = [];
  for (const x of a.warranties) if (x.date >= w.from && x.date <= w.to) out.push({ id: `warranty:${x.key}`, source: 'assets', kind: 'warranty', financial: false, title: `${x.assetName}: ${x.title}`, date: x.date, cents: null, certainty: null, note: 'The last day this warranty covers. Informational only.', href: `#/assets/${x.assetId}`, folded: false, overlap: null, forecast: null, irregular: false });
  for (const m of a.maintenance) if (m.date >= w.from && m.date <= w.to) out.push({ id: `maintenance:${m.taskId}`, source: 'assets', kind: 'maintenance', financial: false, title: `${m.assetName}: ${m.title}`, date: m.date, cents: null, certainty: null, note: 'A dated maintenance task. No cost is recorded for it.', href: `#/assets/${m.assetId}`, folded: false, overlap: null, forecast: null, irregular: false });
  return out;
}

// ---- the composition ----

const tally = (rows: YaRow[]): Totals => {
  const t: Totals = { known: { cents: 0, count: 0 }, estimated: { cents: 0, count: 0 }, unknown: { count: 0 }, disputed: { count: 0 } };
  for (const r of rows) if (r.financial && !r.folded && r.certainty) addRow(t, r.cents, r.certainty);
  return t;
};
const emptyTotals = (): Totals => tally([]);
const groupOf = (r: YaRow): Group | null => (!r.financial ? null : r.source === 'bills' || r.source === 'services' ? 'billsServices' : r.source === 'finance' ? 'finance' : 'projects');
/** A Finance row that may duplicate another record is listed but never added. */
const countable = (r: YaRow) => r.overlap === null;

export function composeYearAhead(today: string, parts: YearAheadParts): YearAhead {
  const w = commitmentWindow(today);
  const bills = parts.bills.ok ? parts.bills.value : null;
  const services = parts.services.ok ? parts.services.value : null;
  const fin = parts.finance.ok ? parts.finance.value : null;
  const proj = parts.projects.ok ? parts.projects.value : null;
  const assets = parts.assets.ok ? parts.assets.value : null;

  // Bills and services: B5's own figures, and the one fold decision it already made.
  const commitments = bills && services ? householdCommitments({ today, bills: bills.derived, services: { arrangements: services.arrangements, state: services.state }, serviceLinks: bills.serviceLinks }) : null;
  const foldedArr = new Set((commitments?.twelve.consolidations ?? []).filter((c) => c.status === 'folded').map((c) => c.arrangementId));
  const uncertain: Consolidation[] = (commitments?.twelve.consolidations ?? []).filter((c) => c.status !== 'folded');
  const uncertainBill = new Set(uncertain.map((c) => c.billId)), uncertainArr = new Set(uncertain.map((c) => c.arrangementId));

  const eligible = fin ? (o: ObligationRecord): boolean | null => (o.data.scheduledRuleIds.some((id) => fin.rules.some((r) => r.id === id && r.active && isCashRule(r) && fin.cashAccountIds.has(r.accountId))) ? true : false) : () => null;
  const rows: YaRow[] = [];
  if (bills) {
    for (const r of billRows(bills.obligations, today, eligible)) rows.push(uncertainBill.has(Number(r.id.split(':')[1])) ? { ...r, overlap: 'A linked household service may be the same charge.' } : r);
    for (const d of upcomingDeadlines(bills.derived, 365)) {
      if (d.date < w.from || d.date > w.to) continue;
      rows.push({ id: `bill-date:${d.ob.id}:${d.kind}:${d.date}`, source: 'bills', kind: d.kind, financial: false, title: d.ob.data.title, date: d.date, cents: null, certainty: null, note: `${DEADLINE_LABEL[d.kind]}. A date, not an extra payment.`, href: `#/bills/o/${d.ob.id}`, folded: false, overlap: null, forecast: null, irregular: false });
    }
  }
  if (services) {
    const days = Math.round((Date.parse(w.to + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / 86400000);
    for (const r of servicesRows(services, today, days).rows) {
      const folded = foldedArr.has(r.sourceId);
      rows.push({ id: r.id, source: 'services', kind: 'visit', financial: true, title: r.title, date: r.date, cents: r.cents, certainty: r.certainty, note: folded ? 'Counted once, as the linked bill. Shown here, not added.' : r.note, href: r.href, folded, overlap: uncertainArr.has(r.sourceId) ? 'A linked bill may be the same charge.' : null, forecast: null, irregular: false });
    }
    const billDateOf = new Map<string, number[]>();
    for (const [b, arrs] of bills?.serviceLinks ?? []) for (const a of arrs) billDateOf.set(String(a), [...(billDateOf.get(String(a)) ?? []), b]);
    for (const d of contractDeadlines(services.arrangements)) {
      if (d.date < w.from || d.date > w.to) continue;
      const twin = (billDateOf.get(String(d.arrangementId)) ?? []).some((b) => rows.some((x) => x.id === `bill-date:${b}:${d.kind}:${d.date}`));
      if (twin) continue; // the linked bill already shows this date
      rows.push({ id: `service-date:${d.arrangementId}:${d.kind}:${d.date}`, source: 'services', kind: d.kind, financial: false, title: d.title, date: d.date, cents: null, certainty: null, note: `${DEADLINE_LABEL[d.kind]}. A date, not an extra payment.`, href: `#/services/a/${d.arrangementId}`, folded: false, overlap: null, forecast: null, irregular: false });
    }
  }
  let linkedScheduled = 0;
  if (fin) {
    const f = financeRows(fin, today, bills?.obligations ?? null, services?.arrangements ?? null);
    linkedScheduled = f.linkedScheduled;
    rows.push(...f.rows);
  }
  if (assets) rows.push(...assetRows(assets, today));
  const undated = proj ? projectRows(proj).sort(sortRows) : [];
  rows.sort(sortRows);

  const financeRowsAll = rows.filter((r) => groupOf(r) === 'finance');
  const bsDone = commitments !== null, finDone = fin !== null;
  const figures = {
    // B5's figures exactly; the rows below are only the same dates listed out.
    billsServices: { complete: bsDone, totals: commitments?.twelve.totals ?? emptyTotals() },
    finance: { complete: finDone, totals: tally(financeRowsAll.filter(countable)) },
    projects: { complete: proj !== null, leftCents: undated.reduce((n, r) => n + (r.cents ?? 0), 0), count: undated.length, undated: undated.length },
  };

  const periods: YaPeriod[] = periodsOf(today).map((p, index) => {
    const inP = rows.filter((r) => r.date !== null && r.date >= p.from && r.date <= p.to);
    return {
      index, from: p.from, to: p.to, rows: inP,
      billsServices: bsDone ? tally(inP.filter((r) => groupOf(r) === 'billsServices')) : null,
      finance: finDone ? tally(inP.filter((r) => groupOf(r) === 'finance' && countable(r))) : null,
      payments: inP.filter((r) => r.financial && !r.folded).length, deadlines: inP.filter((r) => !r.financial).length,
    };
  });

  const sources = SOURCE_ORDER.map((id) => { const p = parts[id]; return p.ok ? { id, label: SOURCE_LABEL[id], ok: true } : { id, label: SOURCE_LABEL[id], ok: false, error: p.error }; });
  const incomplete = sources.some((s) => !s.ok);

  const attention: Attn[] = [];
  for (const s of sources) if (!s.ok) attention.push({ id: `source:${s.id}`, kind: 'source', title: `${s.label} could not be read`, reason: 'This review is incomplete. Figures that depend on it are not shown. Nothing was changed.', href: null });
  for (const c of uncertain) attention.push({ id: `overlap:${c.billId}:${c.arrangementId}`, kind: 'overlap', title: `${c.billTitle} and ${c.arrangementTitle}`, reason: 'A bill and a household service may describe the same expense. Both are counted until you decide.', href: `#/bills/o/${c.billId}` });
  for (const r of financeRowsAll.filter((x) => x.overlap).filter((x, i, a) => a.findIndex((y) => y.title === x.title) === i)) attention.push({ id: `overlap:${r.id}`, kind: 'overlap', title: r.title, reason: `${r.overlap} It is listed but not added to the Finance-only figure.`, href: r.href });
  if (bills) for (const l of buildCommitments(bills.obligations, today).lines.filter((x) => x.unknownPeriods > 0)) attention.push({ id: `unknown:${l.id}`, kind: 'unknown', title: l.title, reason: `${l.unknownPeriods === 1 ? 'One payment has' : `${l.unknownPeriods} payments have`} no known amount. Not counted, and not zero.`, href: `#/bills/o/${l.id}` });
  if (commitments) for (const n of commitments.twelve.services.notConverted) attention.push({ id: `unknown:svc:${n.arrangementId}`, kind: 'unknown', title: n.title, reason: 'Its estimate is per month, season or year, so no amount is placed on its dates. Counted as not known, never as zero.', href: `#/services/a/${n.arrangementId}` });
  // one line per bill or payment (its next date), largest first
  const irregular = rows.filter((r) => r.financial && r.irregular && r.cents !== null && !r.folded && countable(r)).filter((r, i, a) => a.findIndex((y) => y.source === r.source && y.title === r.title) === i).sort((a, b) => (b.cents ?? 0) - (a.cents ?? 0)).slice(0, 5);
  for (const r of irregular) attention.push({ id: `irregular:${r.id}`, kind: 'irregular', title: r.title, reason: `Not every month; next on ${r.date}. Worth setting money aside for.`, href: r.href });
  if (undated.length) attention.push({ id: 'undated', kind: 'undated', title: `${undated.length} project ${undated.length === 1 ? 'commitment has' : 'commitments have'} no payment date`, reason: 'The amount still to pay is known, but no date is recorded, so none is shown in the months.', href: null });
  for (const r of rows.filter((x) => !x.financial && x.source !== 'assets').slice(0, 3)) attention.push({ id: `deadline:${r.id}`, kind: 'deadline', title: r.title, reason: `${KIND_LABEL[r.kind]} on ${r.date}.`, href: r.href });
  if (assets && assets.overdueMaintenance > 0) attention.push({ id: 'maintenance', kind: 'maintenance', title: `${assets.overdueMaintenance} maintenance ${assets.overdueMaintenance === 1 ? 'task is' : 'tasks are'} already overdue`, reason: 'These are before today, so they are not in the months below.', href: '#/assets' });

  return {
    today, from: w.from, to: w.to, periods, undated, rows, figures, commitments,
    deadlineCount: rows.filter((r) => !r.financial).length, linkedScheduled, possibleOverlaps: financeRowsAll.filter((r) => r.overlap).length + uncertain.length,
    sources, incomplete, attention, overdueMaintenance: assets?.overdueMaintenance ?? 0,
  };
}
