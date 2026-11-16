/**
 * R1.2: the words of the weekly review that the page, the printed page and the copied text all share, so the three can never disagree. PURE.
 * Amounts follow Hide amounts here and nowhere else: a hidden amount is `$••••` on the screen, on paper and in the copied text.
 */
import { whenWords } from '../../../core/attention';
import { dayLabel, timeLabel } from '../../../core/time';
import { addDays } from '../../../lib/dates';
import { formatCents } from '../../../lib/money';
import type { CashOutlook } from '../../../lib/cashOutlook';
import type { CalItem } from '../../calendar/useCalendarData';
import type { WeekPayRow, WeekTotals } from '../../../core/weekReaders';
import { maskAmounts } from '../logic';
import type { HomeItem, WeekReview } from './weekModel';

export const HIDDEN_AMOUNT = '$••••';
export const money = (cents: number, hide: boolean) => (hide ? HIDDEN_AMOUNT : formatCents(cents));
export const text = (s: string, hide: boolean) => (hide ? maskAmounts(s) : s);

export const CERTAINTY_WORDS: Record<WeekPayRow['certainty'], string> = { known: 'Fixed amount', estimated: 'Estimate', unknown: 'Amount not known', disputed: 'Amount in dispute' };

/** One row's amount in words: "$120.00", "about $40.00", "amount not known", "amount in dispute". Never zero for an unknown amount. */
export function rowAmount(r: Pick<WeekPayRow, 'cents' | 'certainty'>, hide: boolean): string {
  if (r.certainty === 'disputed') return 'amount in dispute';
  if (r.cents === null || r.certainty === 'unknown') return 'amount not known';
  return r.certainty === 'estimated' ? `about ${money(r.cents, hide)}` : money(r.cents, hide);
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The week's tally as separate lines: fixed and estimated amounts are NEVER added together. */
export function totalsLines(t: WeekTotals, hide: boolean): string[] {
  const out: string[] = [];
  if (t.known.count > 0) out.push(`Fixed amounts: ${money(t.known.cents, hide)} across ${plural(t.known.count, 'payment')}`);
  if (t.estimated.count > 0) out.push(`Estimates: about ${money(t.estimated.cents, hide)} across ${plural(t.estimated.count, 'payment')}`);
  if (t.unknown.count > 0) out.push(`${plural(t.unknown.count, 'payment')} with no known amount (not counted as zero)`);
  if (t.disputed.count > 0) out.push(`${plural(t.disputed.count, 'payment')} with an amount in dispute (not counted)`);
  return out;
}

/** "Lowest point in the next 7 days: $1,200.00 on Wed, Nov 18. Stays above your warning level ($1,000.00)." */
export function cashLine(o: CashOutlook, horizon: string, hide: boolean): string {
  const level = `${o.usesMinimums ? 'account minimums' : 'warning level'} (${money(o.thresholdCents, hide)})`;
  return `Lowest point ${horizon}: ${money(o.lowCents, hide)} on ${dayLabel(o.lowDate)}. ${o.below ? `Under your ${level}.` : `Stays above your ${level}.`}`;
}

export function homeDetail(i: HomeItem, hide: boolean): string {
  if (i.kind === 'overBudget' && i.money) return `Expected cost is ${money(i.money.overCents, hide)} more than the ${money(i.money.budgetCents, hide)} budget.`;
  return i.detail;
}

/** The chip words of a Home or projects row: its own, or a date phrase worked out from today. */
export function homeChip(i: HomeItem, today: string): string {
  if (i.chip) return i.chip;
  if (!i.date) return '';
  const d = Math.round((Date.parse(`${i.date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (i.kind === 'maintenance') return `Due ${dayLabel(i.date)}`;
  return d < 0 ? `${plural(-d, 'day')} overdue` : d === 0 ? 'Due today' : d === 1 ? 'Due tomorrow' : `Due in ${d} days`;
}

export const dayHeading = (date: string, today: string) => `${dayLabel(date, { weekday: 'long' })}${date === today ? ' (today)' : date === addDays(today, 1) ? ' (tomorrow)' : ''}`;
export const itemTime = (i: CalItem) => (i.allDay ? 'All day' : timeLabel(i.startMs));

export const WEEK_TITLE = 'This Week';
export const WEEK_SUBTITLE = 'Your household at a glance';

/** The plain-text version for pasting into a message or a note. Mirrors the screen, section by section; empty sections are left out. No notes, no internal ids. */
export function weekText(r: WeekReview, hide: boolean): string {
  const out: string[] = [];
  const line = (s = '') => out.push(s);
  line(`${WEEK_TITLE}: ${WEEK_SUBTITLE}`);
  line(`${r.range} (prepared ${dayLabel(r.today, { weekday: 'long', year: true })})`);
  if (hide) line('Amounts are hidden.');
  if (r.unavailable.length) { line(); line(`Not included (could not be read just now): ${r.unavailable.join(', ')}. This summary is incomplete.`); }

  if (r.needs.state === 'ready' && r.needs.data.total > 0) {
    const n = r.needs.data;
    line(); line(`NEEDS YOU (${n.total})`);
    for (const i of n.shown) line(`- ${text(i.title, hide)}: ${text(i.reason, hide)} [${whenWords(i, r.today)}]`);
    if (n.remaining > 0) line(`  and ${n.remaining} more in the full Needs you list`);
  }

  if (r.schedule.state === 'ready' && r.schedule.data.count > 0) {
    line(); line('SCHEDULE');
    for (const d of r.schedule.data.days) {
      line(dayHeading(d.date, r.today));
      for (const i of d.items) line(`  - ${itemTime(i)}: ${text(i.title, hide)} (${i.layerName})`);
    }
  }

  if (r.family.state === 'ready' && !r.family.empty) {
    const f = r.family.data;
    line(); line('FAMILY');
    for (const d of f.dates) line(`- ${dayLabel(d.date)}: ${d.title}`);
    for (const a of f.activities) line(`- ${dayLabel(a.firstDay)}, ${a.when}: ${a.title}${a.people.length ? ` (${a.people.map((p) => p.name).join(', ')})` : ''}`);
  }

  if (r.money.state === 'ready' && !r.money.empty) {
    const m = r.money.data;
    line(); line('PAYMENTS AND COMMITMENTS');
    line('These are expected payments and commitments. Nothing here says a payment has been made.');
    for (const x of m.rows) line(`- ${dayLabel(x.date)}: ${text(x.title, hide)}, ${rowAmount(x, hide)} (${CERTAINTY_WORDS[x.certainty].toLowerCase()})`);
    for (const t of totalsLines(m.totals, hide)) line(t);
    if (m.notConverted > 0) line(`${plural(m.notConverted, 'service arrangement')} expected with no figure for the week.`);
    if (m.overlap) line('Some linked bills and services may be the same charge, so a total could count it twice. Check them in Household finances.');
    for (const a of m.contractDates) line(`- ${dayLabel(a.date)}: ${a.label}: ${text(a.title, hide)}`);
  }

  if (r.cash.state === 'ready' && !r.cash.empty) {
    line(); line('CASH OUTLOOK');
    if (r.cash.data.week) line(cashLine(r.cash.data.week, 'this week', hide));
    if (r.cash.data.ninety) line(cashLine(r.cash.data.ninety, 'in the next 90 days', hide));
  }

  if (r.home.state === 'ready' && !r.home.empty) {
    line(); line('HOME AND PROJECTS');
    for (const i of r.home.data.items) line(`- ${text(i.title, hide)} (${i.source}): ${text(homeDetail(i, hide), hide)}${homeChip(i, r.today) ? ` [${homeChip(i, r.today)}]` : ''}`);
    if (r.home.data.moreInNeeds > 0) line(`  and ${r.home.data.moreInNeeds} more in the full Needs you list`);
  }

  if (r.quiet) { line(); line('A quiet week: nothing needs attention and nothing is scheduled.'); }
  return out.join('\n') + '\n';
}
