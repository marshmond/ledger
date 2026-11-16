/**
 * R3.2 Quick Answers for Today: "What needs my attention?" (R1.1) and "What is happening this week?" (R1.2). READ ONLY. Both read through the SAME hooks the Today screens use
 * (`useNeedsYou`, `useWeekInputs`), so the answer cannot disagree with them: ranking, duplicate handling and wording are R1.1's, the seven-day window and sections are R1.2's. Nothing
 * here scores, ranks or de-duplicates anything. The Forecast read is skipped for the week answer (it is long and the short answer does not show it).
 */
import { useMemo } from 'react';
import { previewAttention, TIER_WORDS, whenWords, type RankedAttention } from '../../core/attention';
import { AttentionProviders } from '../../core/AttentionProviders';
import { plural, type AnswerCertainty, type AnswerFigure, type AnswerGroup, type AnswerLiveProps, type AnswerResult, type AnswerRow } from '../../core/answers';
import { timeLabel } from '../../core/time';
import { useNeedsYou } from './useNeedsYou';
import { moduleName } from './TodayData';
import { CERTAINTY_WORDS } from './week/weekText';
import { useWeekInputs } from './week/useWeekInputs';
import { WEEK_DAYS, buildWeekReview, weekWindow, type WeekReview } from './week/weekModel';
import { NEEDS_HREF } from './NeedsYou';

const tone = (r: Pick<RankedAttention, 'tier'>) => (r.tier === 1 ? ('overdue' as const) : r.tier === 2 ? ('warning' as const) : ('info' as const));
const certTone = (c: AnswerCertainty) => (c === 'known' ? ('done' as const) : c === 'estimated' ? ('info' as const) : ('warning' as const));

// ---- Answer 1: what needs my attention (R1.1) ----

export function needsResult(ranked: readonly RankedAttention[], failed: readonly string[], today: string): AnswerResult {
  const p = previewAttention([...ranked], 5);
  const byTier = (t: number) => ranked.filter((r) => r.tier === t).length;
  const rows: AnswerRow[] = p.shown.map((r) => ({
    id: r.id, title: r.title, detail: r.reason, href: r.href, source: moduleName(r.moduleId) + (r.alsoFrom.length ? ` (also in ${r.alsoFrom.map(moduleName).join(', ')})` : ''),
    ...(r.date ? { date: r.date, dateLabel: r.kind === 'deadline' ? 'Date' : 'Since' } : {}),
    chips: [{ text: whenWords(r, today), tone: tone(r) }, { text: TIER_WORDS[r.tier], tone: 'neutral' as const }, ...(r.count && r.count > 1 ? [{ text: `${r.count} records`, tone: 'neutral' as const }] : [])],
  }));
  const limitations = failed.length > 0 ? [`${failed.map(moduleName).join(', ')} could not be checked just now, so ${failed.length === 1 ? 'its' : 'their'} items are missing from this list. Missing is not the same as nothing needing attention.`] : [];
  const none = ranked.length === 0;
  return {
    status: failed.length > 0 ? 'limited' : none ? 'none' : 'answered',
    headline: none ? [failed.length > 0 ? 'Nothing was found among the modules that could be checked.' : 'Nothing needs your attention right now.']
      : [`${plural(ranked.length, 'thing needs', 'things need')} your attention${byTier(1) > 0 ? `, ${byTier(1)} of them overdue or urgent` : ''}.`],
    period: { label: 'As of today', from: null, to: null },
    figures: [
      { id: 'total', label: 'Need attention', value: { kind: 'count', n: ranked.length } },
      { id: 'urgent', label: TIER_WORDS[1], value: { kind: 'count', n: byTier(1) } },
      { id: 'soon', label: TIER_WORDS[2], value: { kind: 'count', n: byTier(2) } },
      { id: 'review', label: TIER_WORDS[3], value: { kind: 'count', n: byTier(3) } },
    ],
    groups: [{ id: 'needs', heading: p.remaining > 0 ? `The ${p.shown.length} most urgent` : 'Most urgent first', rows, hidden: p.remaining, more: p.remaining > 0 ? { label: `See all ${ranked.length} in Needs you`, href: NEEDS_HREF } : undefined }],
    assumptions: ['This is the same ranked list as "Needs you" on Today: ranking, wording and duplicate handling are not changed. A thing reported by two modules is listed once.', 'Items never show an amount; open one to see its details.'],
    limitations,
    sources: [{ module: 'today', label: 'Needs you', href: NEEDS_HREF }],
    fullView: { label: 'Open Needs you', href: NEEDS_HREF },
  };
}

function NeedsInner({ today, render }: { today: string; render: AnswerLiveProps['render'] }) {
  const needs = useNeedsYou(today);
  const run = useMemo(() => (needs.ready ? ({ state: 'ready', result: needsResult(needs.ranked, needs.failed, today) } as const) : ({ state: 'loading' } as const)), [needs.ready, needs.ranked, needs.failed, today]);
  return <>{render(run)}</>;
}

export function NeedsAnswerLive({ ctx, render }: AnswerLiveProps) {
  return <AttentionProviders today={ctx.today}><NeedsInner today={ctx.today} render={render} /></AttentionProviders>;
}

// ---- Answer 2: what is happening this week (R1.2) ----

const SHOW = 5;

export function weekResult(r: WeekReview): AnswerResult {
  const { today } = r;
  const w = weekWindow(today);
  const groups: AnswerGroup[] = [];
  const figures: AnswerFigure[] = [];
  const limitations: string[] = [];

  if (r.needs.state === 'ready' && r.needs.data.total > 0) {
    const n = r.needs.data;
    figures.push({ id: 'needs', label: 'Need you', value: { kind: 'count', n: n.total }, note: n.urgent > 0 ? `${n.urgent} overdue or urgent` : 'none overdue' });
    groups.push({
      id: 'needs', heading: 'Needs your attention', rows: n.shown.slice(0, 3).map((x) => ({ id: x.id, title: x.title, detail: x.reason, href: x.href, source: moduleName(x.moduleId), chips: [{ text: whenWords(x, today), tone: tone(x) }] })),
      hidden: Math.max(0, n.total - 3), more: n.total > 3 ? { label: `See all ${n.total} in Needs you`, href: NEEDS_HREF } : undefined,
    });
  }
  if (r.money.state === 'ready' && (r.money.data.rows.length > 0 || r.money.data.contractDates.length > 0)) {
    const m = r.money.data;
    figures.push({ id: 'payments', label: 'Payments expected', value: { kind: 'count', n: m.rows.length }, note: 'expected, not paid' });
    if (m.totals.known.count > 0) figures.push({ id: 'known', label: 'Fixed amounts', value: { kind: 'money', cents: m.totals.known.cents, certainty: 'known' }, note: plural(m.totals.known.count, 'payment') });
    if (m.totals.estimated.count > 0) figures.push({ id: 'estimated', label: 'Estimated payments', value: { kind: 'money', cents: m.totals.estimated.cents, certainty: 'estimated' }, note: plural(m.totals.estimated.count, 'payment') });
    if (m.totals.unknown.count + m.totals.disputed.count > 0) figures.push({ id: 'unknown', label: 'Amount not known', value: { kind: 'count', n: m.totals.unknown.count + m.totals.disputed.count }, note: 'not counted as zero' });
    const rows: AnswerRow[] = [
      ...m.rows.slice(0, SHOW).map((x): AnswerRow => ({
        id: x.id, title: x.title, href: x.href, date: x.date, dateLabel: 'Expected', source: x.module === 'bills' ? 'Bills & Subscriptions' : 'Household Services', detail: x.note || undefined,
        amounts: [{ label: 'Amount', cents: x.certainty === 'known' || x.certainty === 'estimated' ? x.cents : null, certainty: x.certainty as AnswerCertainty, strong: true }],
        chips: [{ text: CERTAINTY_WORDS[x.certainty], tone: certTone(x.certainty as AnswerCertainty) }],
      })),
      ...m.contractDates.slice(0, Math.max(0, SHOW - m.rows.length)).map((c): AnswerRow => ({ id: c.id, title: c.title, href: c.href, date: c.date, dateLabel: c.label, source: 'Household Finances', chips: [{ text: c.label, tone: 'info' }] })),
    ];
    groups.push({ id: 'payments', heading: 'Payments and contract dates', rows, hidden: Math.max(0, m.rows.length + m.contractDates.length - rows.length), more: m.rows.length + m.contractDates.length > rows.length ? { label: 'See the full week', href: '#/today/week' } : undefined });
    if (m.overlap) limitations.push('Some linked bills and services may be the same charge, so a payment could be counted twice.');
    if (m.notConverted > 0) limitations.push(`${plural(m.notConverted, 'service has', 'services have')} an estimate that is not per visit, so no figure is given for the week.`);
  }
  if (r.schedule.state === 'ready' && r.schedule.data.count > 0) {
    const s = r.schedule.data;
    figures.push({ id: 'schedule', label: 'Events and tasks', value: { kind: 'count', n: s.count } });
    const all = s.days.flatMap((d) => d.items.map((i) => ({ d: d.date, i })));
    groups.push({
      id: 'schedule', heading: 'Events and tasks', rows: all.slice(0, SHOW).map(({ d, i }): AnswerRow => ({ id: i.key, title: i.title, href: '#/calendar?v=agenda', date: d, dateLabel: i.allDay ? 'All day' : timeLabel(i.startMs), source: i.layerName, chips: i.overdue ? [{ text: 'Overdue', tone: 'overdue' as const }] : undefined })),
      hidden: Math.max(0, all.length - SHOW), more: all.length > SHOW ? { label: 'See the full week', href: '#/today/week' } : undefined,
    });
  }
  if (r.family.state === 'ready' && (r.family.data.dates.length > 0 || r.family.data.activities.length > 0)) {
    const f = r.family.data;
    figures.push({ id: 'family', label: 'Family dates and activities', value: { kind: 'count', n: f.dates.length + f.activities.length } });
    const rows: AnswerRow[] = [
      ...f.dates.slice(0, 3).map((d): AnswerRow => ({ id: d.key, title: d.title, href: d.href, date: d.date, dateLabel: d.kind, source: 'Family', detail: d.person?.name })),
      ...f.activities.slice(0, 3).map((a): AnswerRow => ({ id: a.key, title: a.title, href: a.href, date: a.firstDay, dateLabel: a.when, source: 'Family', detail: a.people.map((p) => p.name).join(', ') || undefined })),
    ];
    groups.push({ id: 'family', heading: 'Family', rows: rows.slice(0, SHOW), hidden: Math.max(0, f.dates.length + f.activities.length - Math.min(rows.length, SHOW)), more: { label: 'See the full week', href: '#/today/week' } });
  }
  if (r.home.state === 'ready' && r.home.data.items.length > 0) {
    const h = r.home.data;
    figures.push({ id: 'home', label: 'Home and projects', value: { kind: 'count', n: h.items.length }, note: 'to look at' });
    groups.push({
      id: 'home', heading: 'Home and projects', rows: h.items.slice(0, 4).map((i): AnswerRow => ({
        id: i.key, title: i.title, detail: i.money ? undefined : i.detail, href: i.href, ...(i.date ? { date: i.date } : {}), source: i.source,
        amounts: i.money ? [{ label: 'Over budget by', cents: i.money.overCents, strong: true }] : undefined, chips: [{ text: i.chip, tone: i.tone === 'overdue' ? 'overdue' : i.tone === 'warning' ? 'warning' : 'info' }],
      })),
      hidden: Math.max(0, h.items.length - 4), more: h.items.length > 4 ? { label: 'See the full week', href: '#/today/week' } : undefined,
    });
  }
  if (r.unavailable.length > 0) limitations.push(`${r.unavailable.join(', ')} could not be read just now, so ${r.unavailable.length === 1 ? 'that part' : 'those parts'} of the week may be missing. Missing is not the same as nothing happening.`);
  const WORDS: Record<string, string> = { needs: 'need you', payments: 'payments expected', schedule: 'events and tasks', family: 'family dates and activities', home: 'home and project items' };
  const counts = figures.flatMap((f) => (f.value.kind === 'count' && f.id in WORDS ? [{ id: f.id, n: f.value.n }] : []));
  const quiet = counts.length === 0 && r.unavailable.length === 0;
  const said = counts.map((c) => `${c.n} ${c.n === 1 && c.id === 'payments' ? 'payment expected' : WORDS[c.id]}`).join(', ');
  return {
    status: r.unavailable.length > 0 || limitations.length > 0 ? 'limited' : quiet ? 'none' : 'answered',
    headline: quiet ? ['Nothing is scheduled or waiting for this week.'] : [`This week: ${said || 'only the parts that could not be read are missing (see below)'}.`],
    period: { label: `This week, ${r.range} (${WEEK_DAYS} days, today included)`, from: w.from, to: w.to },
    figures, groups,
    assumptions: ['The week is today and the six days after it, the same seven days as the This week page.', 'Payments are expected payments from your bills and services, not payments made. Fixed amounts and estimates are never added together.'],
    limitations,
    sources: [{ module: 'today', label: 'This week', href: '#/today/week' }, { module: 'calendar', label: 'Calendar', href: '#/calendar?v=agenda' }],
    fullView: { label: 'Open This week', href: '#/today/week' },
  };
}

function WeekInner({ today, render }: { today: string; render: AnswerLiveProps['render'] }) {
  const inputs = useWeekInputs(today, { cash: false });
  const review = useMemo(() => buildWeekReview(inputs), [inputs]);
  const run = useMemo(() => (review.loading ? ({ state: 'loading' } as const) : ({ state: 'ready', result: weekResult(review) } as const)), [review]);
  return <>{render(run)}</>;
}

export function WeekAnswerLive({ ctx, render }: AnswerLiveProps) {
  return <AttentionProviders today={ctx.today}><WeekInner today={ctx.today} render={render} /></AttentionProviders>;
}
