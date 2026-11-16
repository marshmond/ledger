/**
 * R3.2 Quick Answers for Household Finances. READ ONLY. No money rule lives here.
 *
 *  1. "What payments are coming up?" is B5's own commitment reader (`loadHouseholdOverview` -> `commitments.windows`, the one Household Finances and the weekly review use), cut to
 *     today through day 29 (30 calendar days, today included; B5's own "30 days" window runs to day 30, so its day-30 rows are left out, exactly as the weekly review does for its
 *     7-day window) and tallied with B5's own `addRow`. Known and estimated amounts stay apart; unknown and disputed rows are COUNTS, never zero. A Services row folded into its
 *     linked bill is not listed or added again. A linked bill and service that could not be proven to be one charge keep both rows and say so.
 *  2. "What do we need to prepare for over the next year?" is R3.1's own composition (`loadYearAhead`): the same four groups, never added together.
 *
 * These are commitments and expectations, not recorded transactions, and they are not automatically in the Finance Forecast.
 */
import { db, type FinanceDB } from '../../db';
import { plural, rangeWords, type AnswerCertainty, type AnswerContext, type AnswerFigure, type AnswerGroup, type AnswerResult, type AnswerRow } from '../../core/answers';
import { addDays } from '../../lib/dates';
import { loadObligations } from '../bills/data';
import { addRow, type CommitmentRow, type Totals } from './commitments';
import { CERTAINTY_LABEL } from './model';
import { loadHouseholdOverview, type HouseholdOverview } from './overview';
import { KIND_LABEL, SOURCE_LABEL, type YaRow, type YearAhead } from './yearAhead';
import { loadYearAhead } from './yearAheadData';

export const PAYMENT_DAYS = 30;
const SOURCE = 'Household Finances';
const SHOW = 12;
const tone = (c: AnswerCertainty) => (c === 'known' ? ('done' as const) : c === 'estimated' ? ('info' as const) : ('warning' as const));
const emptyTotals = (): Totals => ({ known: { cents: 0, count: 0 }, estimated: { cents: 0, count: 0 }, unknown: { count: 0 }, disputed: { count: 0 } });
/** Known always; estimated only when there is at least one estimated payment (an estimate of nothing is not shown as "$0.00"). */
const moneyFigures = (id: string, label: string, t: Totals): AnswerFigure[] => [
  { id: `${id}-known`, label: `${label}: known`, value: { kind: 'money', cents: t.known.cents, certainty: 'known' }, note: `${plural(t.known.count, 'payment')}` },
  ...(t.estimated.count > 0 ? [{ id: `${id}-estimated`, label: `${label}: estimated`, value: { kind: 'money' as const, cents: t.estimated.cents, certainty: 'estimated' as const }, note: plural(t.estimated.count, 'payment') }] : []),
];

// ---- 1. payments ----

export function paymentsResult(o: HouseholdOverview, today: string, billsWithScheduled: ReadonlySet<number>): AnswerResult {
  const to = addDays(today, PAYMENT_DAYS - 1);
  const base = { period: { label: `The next 30 days: ${rangeWords(today, to)}`, from: today, to }, sources: [{ module: 'household', label: 'Household Finances', href: '#/household' }, { module: 'bills', label: 'Bills & Subscriptions', href: '#/bills' }, { module: 'services', label: 'Household Services', href: '#/services' }], fullView: { label: 'Open Household Finances', href: '#/household' } };
  if (o.empty) {
    return { ...base, status: 'insufficient', headline: ['No bills or household services are recorded, so there is nothing to look ahead to.'], figures: [], groups: [], assumptions: [], limitations: [], missing: { what: 'Bills & Subscriptions or Household Services records', where: 'Bills & Subscriptions or Household Services: add what you pay regularly.', href: '#/bills' } };
  }
  const win = o.commitments.windows.find((w) => w.days === PAYMENT_DAYS)!;
  const inside: CommitmentRow[] = win.rows.filter((r) => r.date >= today && r.date <= to);
  const kept = inside.filter((r) => r.foldedInto === null);
  const folded = inside.length - kept.length;
  const totals = emptyTotals();
  for (const r of kept) addRow(totals, r.cents, r.certainty);
  const rowUnknown = totals.unknown.count;
  totals.unknown.count += win.notConverted.length; // B5's own tally: a service whose estimate is not per visit is counted as not known
  const unproven = win.consolidations.filter((c) => c.status !== 'folded');
  const overlapping = (r: CommitmentRow) => unproven.some((c) => (r.module === 'bills' ? r.sourceId === c.billId : r.sourceId === c.arrangementId));
  const overlap = kept.some(overlapping);
  const noScale = win.notConverted.length;

  const rows: AnswerRow[] = kept.slice(0, SHOW).map((r) => {
    const linked = r.module === 'bills' && billsWithScheduled.has(r.sourceId);
    return {
      id: r.id + `|${r.date}`, title: r.title, href: r.href, source: r.module === 'bills' ? 'Bills & Subscriptions' : 'Household Services', detail: r.note || undefined,
      date: r.date, dateLabel: 'Expected',
      amounts: [{ label: 'Amount', cents: r.certainty === 'known' || r.certainty === 'estimated' ? r.cents : null, certainty: r.certainty, strong: true }],
      chips: [
        { text: CERTAINTY_LABEL[r.certainty], tone: tone(r.certainty) },
        ...(overlapping(r) ? [{ text: 'May be the same charge as a linked record', tone: 'warning' as const }] : []),
        { text: linked ? 'Tied to a scheduled payment (may be in the Forecast)' : 'Not in the Forecast', tone: 'neutral' as const },
      ],
    };
  });

  const limitations: string[] = [
    'These are payments Ledger expects from your bills and services, not payments that have been made. Nothing here says a payment is paid, funded or late.',
    'The Finance Forecast includes a bill only when it is tied to an active scheduled payment. A bill or service without that tie is not in the Forecast, so its amount is not part of the projected cash.',
  ];
  if (rowUnknown > 0) limitations.push(`${plural(rowUnknown, 'payment has', 'payments have')} no known amount. ${rowUnknown === 1 ? 'It is' : 'They are'} counted, not added as zero.`);
  if (totals.disputed.count > 0) limitations.push(`${plural(totals.disputed.count, 'bill has', 'bills have')} recorded prices that disagree, so no amount is used until you choose one.`);
  if (noScale > 0) limitations.push(`${plural(noScale, 'service has', 'services have')} an estimate that is not per visit, so no figure is given for ${noScale === 1 ? 'it' : 'them'}; ${noScale === 1 ? 'it is' : 'they are'} counted under "Amount not known".`);
  if (overlap) limitations.push('A bill and a service are linked but could not be proven to be one charge, so both are listed and both may be counted. Household Finances shows how much could be counted twice.');
  if (folded > 0) limitations.push(`${plural(folded, 'service visit')} that belong${folded === 1 ? 's' : ''} to a linked bill ${folded === 1 ? 'is' : 'are'} counted once, as the bill.`);

  const none = kept.length === 0 && noScale === 0;
  const groups: AnswerGroup[] = [{ id: 'payments', heading: 'Soonest first', rows, hidden: Math.max(0, kept.length - SHOW), more: kept.length > SHOW ? { label: 'See every expected payment', href: '#/household' } : undefined }];
  return {
    ...base,
    status: none ? 'none' : overlap || noScale > 0 ? 'limited' : 'answered',
    headline: none ? ['No bill or service payment is expected in the next 30 days.'] : [
      `${plural(kept.length, 'payment is', 'payments are')} expected in the next 30 days: `, { money: totals.known.cents }, ` known (${plural(totals.known.count, 'payment')})`,
      ...(totals.estimated.count > 0 ? [' and ', { money: totals.estimated.cents }, ` estimated (${plural(totals.estimated.count, 'payment')})`] : []),
      ...(totals.unknown.count + totals.disputed.count > 0 ? [`, plus ${plural(totals.unknown.count + totals.disputed.count, 'payment')} with no known amount`] : []), '.',
    ],
    figures: [
      ...moneyFigures('amount', 'Expected', totals),
      { id: 'unknown', label: 'Amount not known', value: { kind: 'count', n: totals.unknown.count } },
      { id: 'disputed', label: 'Prices in dispute', value: { kind: 'count', n: totals.disputed.count } },
    ],
    groups,
    assumptions: [
      'The next 30 days means today and the 29 days after it.',
      'Known and estimated amounts are kept apart and never added together. Counts of payments with no known amount are shown, never treated as zero.',
      'Bills and services are read exactly as Household Finances reads them.',
    ],
    limitations,
  };
}

export async function paymentsAnswer(ctx: AnswerContext, d: FinanceDB = db): Promise<AnswerResult> {
  const [o, bills] = await Promise.all([loadHouseholdOverview('all', ctx.today, d), loadObligations(d)]);
  return paymentsResult(o, ctx.today, new Set(bills.filter((b) => b.data.scheduledRuleIds.length > 0).map((b) => b.id)));
}

// ---- 2. year ahead ----

const groupOf = (r: YaRow): 'billsServices' | 'finance' | 'projects' | 'dates' => (!r.financial ? 'dates' : r.source === 'projects' ? 'projects' : r.source === 'finance' ? 'finance' : 'billsServices');
const rowOf = (r: YaRow): AnswerRow => ({
  id: r.id, title: r.title, href: r.href, source: SOURCE_LABEL[r.source], detail: r.note || undefined,
  date: r.date ?? undefined, dateLabel: r.financial ? 'Expected' : KIND_LABEL[r.kind],
  amounts: r.financial ? [{ label: 'Amount', cents: r.certainty === 'known' || r.certainty === 'estimated' ? r.cents : null, certainty: r.certainty ?? 'unknown', strong: true }] : undefined,
  chips: [{ text: KIND_LABEL[r.kind], tone: 'neutral' }, ...(r.certainty ? [{ text: CERTAINTY_LABEL[r.certainty], tone: tone(r.certainty) }] : []), ...(r.folded ? [{ text: 'Counted once, as the linked bill', tone: 'info' as const }] : []), ...(r.overlap ? [{ text: 'May duplicate another record', tone: 'warning' as const }] : [])],
});

export function yearAheadResult(ya: YearAhead): AnswerResult {
  const group = (g: ReturnType<typeof groupOf>) => ya.rows.concat(ya.undated).filter((r) => groupOf(r) === g && !r.folded);
  const bs = ya.figures.billsServices;
  const fin = ya.figures.finance;
  const pr = ya.figures.projects;
  const figures: AnswerFigure[] = [];
  if (bs.complete) figures.push(...moneyFigures('bs', 'Bills and services', bs.totals), { id: 'bs-unknown', label: 'Bills and services: amount not known', value: { kind: 'count', n: bs.totals.unknown.count + bs.totals.disputed.count } });
  else figures.push({ id: 'bs', label: 'Bills and services', value: { kind: 'text', text: 'Not available' }, note: 'A source could not be read, so no figure is shown.' });
  if (fin.complete) figures.push(...moneyFigures('fin', 'Finance-only payments', fin.totals));
  else figures.push({ id: 'fin', label: 'Finance-only payments', value: { kind: 'text', text: 'Not available' }, note: 'A source could not be read, so no figure is shown.' });
  if (pr.complete) figures.push({ id: 'projects', label: 'Project payments still to pay', value: { kind: 'money', cents: pr.leftCents, certainty: 'known' }, note: `${plural(pr.count, 'agreement')}${pr.undated > 0 ? `; ${pr.undated} with no payment date` : ''}` });
  else figures.push({ id: 'projects', label: 'Project payments still to pay', value: { kind: 'text', text: 'Not available' }, note: 'A source could not be read, so no figure is shown.' });
  figures.push({ id: 'dates', label: 'Important dates (no money)', value: { kind: 'count', n: ya.deadlineCount } });

  const failed = ya.sources.filter((s) => !s.ok).map((s) => SOURCE_LABEL[s.id]);
  const dates = group('dates');
  const groups: AnswerGroup[] = [];
  if (ya.attention.length > 0) groups.push({ id: 'attention', heading: 'Needs a decision or more information', rows: ya.attention.slice(0, 4).map((a, i) => ({ id: `attn:${a.id}:${i}`, title: a.title, detail: a.reason, href: a.href ?? '#/household/year-ahead', source: SOURCE })), hidden: Math.max(0, ya.attention.length - 4), more: ya.attention.length > 4 ? { label: 'See all in Year Ahead', href: '#/household/year-ahead' } : undefined });
  if (dates.length > 0) groups.push({ id: 'dates', heading: 'Important dates, soonest first', rows: dates.slice(0, 4).map(rowOf), hidden: Math.max(0, dates.length - 4), more: dates.length > 4 ? { label: 'See all in Year Ahead', href: '#/household/year-ahead' } : undefined });
  const proj = group('projects');
  if (proj.length > 0) groups.push({ id: 'projects', heading: 'Project payments still to pay', note: 'No payment date is stored for a project agreement, so these have no date.', rows: proj.slice(0, 3).map(rowOf), hidden: Math.max(0, proj.length - 3), more: proj.length > 3 ? { label: 'See all in Year Ahead', href: '#/household/year-ahead' } : undefined });
  const finRows = group('finance');
  if (finRows.length > 0) groups.push({ id: 'finance', heading: 'Finance-only payments', rows: finRows.slice(0, 3).map(rowOf), hidden: Math.max(0, finRows.length - 3), more: finRows.length > 3 ? { label: 'See all in Year Ahead', href: '#/household/year-ahead' } : undefined });

  const payments = ya.rows.filter((r) => r.financial && !r.folded).length + ya.undated.filter((r) => r.financial).length;
  const nothing = payments === 0 && ya.deadlineCount === 0 && !ya.incomplete;
  const limitations = [
    'The groups are shown separately and are never added into one total: bills and services, Finance-only payments, and project payments are different kinds of money.',
    'These are commitments and expectations, not recorded spending, and they are not the Finance Forecast.',
    'Bills count what their schedule expects; a payment already made this period is not subtracted.',
  ];
  if (failed.length > 0) limitations.push(`${failed.join(', ')} could not be read, so any figure that needs ${failed.length === 1 ? 'it' : 'them'} is not shown.`);
  if (ya.possibleOverlaps > 0) limitations.push(`${plural(ya.possibleOverlaps, 'possible overlap')} between a bill and a service or scheduled payment. Year Ahead lists what may be counted twice.`);
  return {
    status: nothing ? 'none' : ya.incomplete ? 'limited' : 'answered',
    headline: nothing ? ['Nothing is planned for the next twelve months.'] : [`Over the next twelve months Ledger knows of ${plural(payments, 'expected payment')} and ${plural(ya.deadlineCount, 'important date')}. The money is in separate groups below and is not added together.`],
    period: { label: `The next twelve months: ${rangeWords(ya.from, ya.to)}`, from: ya.from, to: ya.to },
    figures, groups,
    assumptions: ['The next twelve months is Year Ahead\'s own rolling window: from today to the same day next year, minus one day.', 'Every figure is the one Year Ahead shows; each group follows its own certainty words (known, estimated, not known).'],
    limitations,
    sources: [{ module: 'household', label: 'Year Ahead', href: '#/household/year-ahead' }, ...ya.sources.filter((s) => s.ok).map((s) => ({ module: s.id, label: SOURCE_LABEL[s.id], href: s.id === 'finance' ? '#/ledger/scheduled' : `#/${s.id === 'assets' ? 'assets' : s.id}` }))],
    fullView: { label: 'Open Year Ahead', href: '#/household/year-ahead' },
  };
}

export async function yearAheadAnswer(ctx: AnswerContext, d: FinanceDB = db): Promise<AnswerResult> {
  return yearAheadResult(await loadYearAhead(ctx.today, d));
}
