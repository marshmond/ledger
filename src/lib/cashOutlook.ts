import { addDays } from './dates';

/**
 * The cash-outlook card on Today: the lowest point your checking and savings are forecast to reach in the next `days` days, and
 * whether that is under your warning level (the total of your account minimums, or the single "Warn me below" level).
 * Returns null when there is no meaningful forecast (no cash account, or nothing to forecast from), so the card stays out of the way.
 */
export interface CashOutlook {
  lowCents: number;
  lowDate: string;
  thresholdCents: number;
  /** True when the level is the total of account minimums rather than the single "Warn me below" level. */
  usesMinimums: boolean;
  below: boolean;
}

export function cashOutlook(
  f: {
    cashAccounts: number;
    thresholdCents: number;
    floorCents: number;
    input: { startCents: number };
    result: { events: { date: string; balanceCents: number }[] };
  },
  today: string,
  days = 90,
): CashOutlook | null {
  if (f.cashAccounts < 1 || f.result.events.length === 0) return null;
  const end = addDays(today, days);
  let low = { cents: f.input.startCents, date: today };
  for (const e of f.result.events) {
    if (e.date > end) break;
    if (e.balanceCents < low.cents) low = { cents: e.balanceCents, date: e.date };
  }
  return { lowCents: low.cents, lowDate: low.date, thresholdCents: f.thresholdCents, usesMinimums: f.floorCents > 0, below: low.cents < f.thresholdCents };
}
