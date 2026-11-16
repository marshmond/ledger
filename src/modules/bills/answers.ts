/**
 * R3.2 Quick Answers for Bills & Subscriptions. READ ONLY.
 *
 * "Which bills have increased recently?" reads the bill's OWN recorded price steps (`lc.prices` / `lc.priceRows`, B4: the first price plus every "Record a price change" the
 * owner made, with disagreements already shown as unknown). An increase is counted ONLY when two recorded prices, one right after the other, both have an amount and the later
 * one is higher and starts inside the window. A payment that was higher than expected is NOT an increase: Bills shows that separately as "a reason to look" (`priceNotice`) and
 * says it could be tax, a fee or a one-off. Differences in payment timing or between unrelated payments are never read.
 *
 * "Recently" = the last 90 calendar days, today included (today minus 89 days through today).
 */
import { db, type FinanceDB } from '../../db';
import { plural, rangeWords, type AnswerContext, type AnswerResult, type AnswerRow } from '../../core/answers';
import { addDays } from '../../lib/dates';
import { loadObligations } from './data';
import { PRICE_SOURCE_LABEL } from './lifecycleModel';
import { isLoanExcluded, type ObligationRecord } from './model';

export const RECENT_DAYS = 90;
const SOURCE = 'Bills & Subscriptions';

interface Increase { ob: ObligationRecord; from: string; previousCents: number; newCents: number; estimated: boolean; source: string | null }

/** Pure: the recorded increases that start inside the window, newest first. */
export function increasesIn(obs: readonly ObligationRecord[], today: string): { list: Increase[]; billsWithHistory: number } {
  const from = addDays(today, -(RECENT_DAYS - 1));
  const list: Increase[] = [];
  let billsWithHistory = 0;
  for (const ob of obs) {
    if (ob.data.status === 'ended' || isLoanExcluded(ob.data)) continue;
    const lc = ob.data.lc;
    if (!lc || lc.prices.length < 2) continue;
    billsWithHistory++;
    const steps = lc.prices;
    for (let i = 1; i < steps.length; i++) {
      const prev = steps[i - 1];
      const cur = steps[i];
      if (cur.from < from || cur.from > today) continue;
      if (prev.cents === null || cur.cents === null || prev.conflict || cur.conflict || cur.cents <= prev.cents) continue;
      const row = lc.priceRows.find((r) => r.from === cur.from && r.origin === 'recorded');
      list.push({ ob, from: cur.from, previousCents: prev.cents, newCents: cur.cents, estimated: !!(prev.estimated || cur.estimated), source: row?.source ? PRICE_SOURCE_LABEL[row.source] : null });
    }
  }
  list.sort((a, b) => b.from.localeCompare(a.from) || a.ob.data.title.localeCompare(b.ob.data.title) || a.ob.id - b.ob.id);
  return { list, billsWithHistory };
}

const pct = (prev: number, next: number) => `+${(Math.round(((next - prev) / prev) * 1000) / 10).toFixed(1)}%`;

export function priceIncreaseResult(obs: readonly ObligationRecord[], today: string): AnswerResult {
  const win = addDays(today, -(RECENT_DAYS - 1));
  const { list, billsWithHistory } = increasesIn(obs, today);
  const rows: AnswerRow[] = list.map((x) => ({
    id: `bill:${x.ob.id}:${x.from}`, title: x.ob.data.title, href: `#/bills/o/${x.ob.id}`, source: SOURCE,
    detail: x.source ? `Recorded from: ${x.source}.` : undefined,
    date: x.from, dateLabel: 'Effective',
    amounts: [
      { label: 'Increase', cents: x.newCents - x.previousCents, certainty: x.estimated ? 'estimated' : 'known', strong: true },
      { label: 'Before', cents: x.previousCents, certainty: x.estimated ? 'estimated' : 'known' },
      { label: 'Now', cents: x.newCents, certainty: x.estimated ? 'estimated' : 'known' },
    ],
    chips: [x.estimated ? { text: 'Estimated change', tone: 'warning' as const } : { text: 'Recorded increase', tone: 'info' as const }, ...(x.estimated ? [] : [{ text: pct(x.previousCents, x.newCents), tone: 'neutral' as const }])],
  }));
  const limitations = [
    'Only price changes you recorded are counted. A payment that was higher than the expected price is not treated as an increase (it could be tax, a fee or a one-off); Bills lists those separately as "a reason to look".',
    'A change that starts after today, a bill that has ended, and loan payments are not included.',
  ];
  if (billsWithHistory === 0) limitations.push('No bill has a recorded price history yet, so Ledger has nothing to compare. Record a price change on a bill to start one.');
  return {
    status: list.length === 0 ? 'none' : 'answered',
    headline: list.length === 0 ? ['No bill has a recorded price increase in the last 90 days.'] : [`${plural(list.length, 'recorded price increase')} in the last 90 days, across ${plural(new Set(list.map((x) => x.ob.id)).size, 'bill')}.`],
    period: { label: `The last 90 days: ${rangeWords(win, today)}`, from: win, to: today },
    figures: [{ id: 'count', label: 'Recorded increases', value: { kind: 'count', n: list.length } }],
    groups: [{ id: 'increases', heading: 'Recorded increases, newest first', rows }],
    assumptions: ['"Recently" means the last 90 days, today included.', 'An increase means the new recorded price is higher than the recorded price just before it.', 'A figure is "Estimated" when either price was recorded as an estimate.'],
    limitations,
    sources: [{ module: 'bills', label: 'Bills & Subscriptions', href: '#/bills' }],
    fullView: { label: 'Open Bills & Subscriptions', href: '#/bills' },
  };
}

export async function priceIncreaseAnswer(ctx: AnswerContext, d: FinanceDB = db): Promise<AnswerResult> {
  return priceIncreaseResult(await loadObligations(d), ctx.today);
}
