/**
 * R3.2 Quick Answers for Household Services. READ ONLY. "What household services are coming up?" is built from two readers this module already has:
 *   - the Overview's own `upcoming` rows (`buildOverview`): the ONE open visit Task of each active arrangement and its date (the next actionable visit), and
 *   - the standing schedule's expected dates (`plannedVisitDates`, the same function behind the Calendar's rolling twelve-month "Household Services" layer), which start AFTER
 *     that open visit Task. They are expected visits, not Tasks.
 * Nothing is created: no visit, no Task, no Calendar event, no reminder. The default window is today through day 29 (30 calendar days, today included). A visit Task whose
 * date has already passed is shown too, marked overdue, exactly as the Services overview shows it, because it still needs action.
 */
import { db, type FinanceDB } from '../../db';
import { plural, rangeWords, type AnswerContext, type AnswerResult, type AnswerRow } from '../../core/answers';
import { dayLabel } from '../../core/time';
import { addDays } from '../../lib/dates';
import { daysBetween } from '../../lib/money';
import { scheduleStateOf } from './expectedCharges';
import { plannedVisitDates } from './plannedVisits';
import { buildOverview, loadSnapshot, type Snapshot } from './views';

export const SERVICES_DAYS = 30;
const SOURCE = 'Household Services';

export function servicesUpcomingResult(s: Snapshot, today: string): AnswerResult {
  const to = addDays(today, SERVICES_DAYS - 1);
  const ov = buildOverview(s);
  const active = ov.active;
  const base = { period: { label: `The next 30 days: ${rangeWords(today, to)}`, from: today, to }, sources: [{ module: 'services', label: 'Household Services', href: '#/services' }], fullView: { label: 'Open Household Services', href: '#/services' } };
  if (s.arrangements.length === 0) {
    return {
      ...base, status: 'insufficient', headline: ['No household service is set up yet, so there is nothing to look ahead to.'], figures: [], groups: [], assumptions: [], limitations: [],
      missing: { what: 'A household service arrangement (for example cleaning or lawn care)', where: 'Household Services: add an arrangement and its schedule.', href: '#/services' },
    };
  }
  const providerOf = (r: (typeof active)[number]) => s.contacts.find((c) => c.id === r.a.data.providerContactId)?.name || r.a.data.providerNameSnapshot || '';
  const rows: AnswerRow[] = [];
  let visits = 0;
  for (const r of active) {
    const dates: { date: string; kind: 'task' | 'expected' }[] = [];
    if (r.nextDate && r.nextDate <= to) dates.push({ date: r.nextDate, kind: 'task' });
    for (const d of plannedVisitDates(r.a, scheduleStateOf(r.tasks), today, today, to)) if (!dates.some((x) => x.date === d)) dates.push({ date: d, kind: 'expected' });
    if (dates.length === 0) continue;
    dates.sort((a, b) => a.date.localeCompare(b.date));
    visits += dates.length;
    const first = dates[0];
    const later = dates.slice(1);
    const overdue = first.kind === 'task' && first.date < today;
    const provider = providerOf(r);
    rows.push({
      id: `arrangement:${r.a.id}`, title: r.a.data.title, href: `#/services/a/${r.a.id}`, source: SOURCE,
      detail: [provider ? `Provider: ${provider}` : 'No provider set yet', r.a.data.visitTime ? `at ${r.a.data.visitTime}` : null].filter(Boolean).join(' · '),
      date: first.date, dateLabel: first.kind === 'task' ? 'Next visit' : 'Expected',
      links: first.kind === 'task' && r.open ? [{ label: 'Open the visit task', href: `#/tasks?task=${r.open.id}` }] : undefined,
      chips: [
        { text: overdue ? `Overdue by ${plural(daysBetween(today, first.date), 'day')}` : r.a.data.status === 'active' ? 'Active' : r.a.data.status, tone: overdue ? 'overdue' as const : 'done' as const },
        ...(later.length ? [{ text: `Then ${later.slice(0, 3).map((x) => dayLabel(x.date, { weekday: 'short' })).join(', ')}${later.length > 3 ? ` and ${later.length - 3} more` : ''}`, tone: 'neutral' as const }] : []),
        ...(r.health.needsAttention ? [{ text: r.health.message, tone: 'warning' as const }] : []),
      ],
    });
  }
  rows.sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '') || a.title.localeCompare(b.title) || a.id.localeCompare(b.id, 'en', { numeric: true }));
  const noSchedule = active.filter((r) => !r.nextDate && !(r.a.data.cadence?.mode === 'fixed')).length;
  const none = rows.length === 0;
  const limitations = [
    'Only active arrangements are listed. Later visits come from the arrangement\'s standing schedule: they are expected dates, not Tasks. A new Task is made only when the visit before it is logged.',
    'Ledger does not know about a visit that is not on a schedule and has no open Task.',
  ];
  if (noSchedule > 0) limitations.push(`${plural(noSchedule, 'active arrangement has', 'active arrangements have')} no schedule or open visit, so ${noSchedule === 1 ? 'it cannot' : 'they cannot'} be placed in time.`);
  return {
    ...base,
    status: none ? 'none' : 'answered',
    headline: none ? ['No scheduled household service visit falls in the next 30 days.'] : [`${plural(visits, 'visit')} across ${plural(rows.length, 'household service')} in the next 30 days.`],
    figures: [{ id: 'services', label: 'Services with a visit', value: { kind: 'count', n: rows.length } }, { id: 'visits', label: 'Visits', value: { kind: 'count', n: visits } }],
    groups: [{ id: 'services', heading: 'Soonest first', rows }],
    assumptions: ['The next 30 days means today and the 29 days after it. The "Next visit" date is the arrangement\'s open visit Task; later dates come from its standing schedule.'],
    limitations,
  };
}

export async function servicesUpcomingAnswer(ctx: AnswerContext, d: FinanceDB = db): Promise<AnswerResult> {
  return servicesUpcomingResult(await loadSnapshot(d), ctx.today);
}
