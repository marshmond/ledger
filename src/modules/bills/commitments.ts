/**
 * Indicative recurring commitments (B1; B0 12.2 figures T2 to T4). PURE. Reads obligations only: no Finance read, no payment, no stored figure.
 *
 * WHAT THESE NUMBERS ARE. They are what the obligations EXPECT to cost over the next 12 months, worked out date by date from the same
 * `expectedDates` reader the previews use, each date at the price in force on that date. They are plans, NOT money spent. Three kinds of
 * expected date are kept apart and never mixed:
 *   Known       the amount is fixed (the same each time)
 *   Estimated   the amount varies and the owner gave a typical value
 *   Unknown     no amount: counted, shown as a count, and in NEITHER total (an unknown amount is never zero)
 * Annual and irregular bills are NOT presented as monthly spending: the "averaged" figure is the 12-month total divided by 12 and is always
 * labelled so, and an on-demand bill (no schedule) has no dates and is listed as "not counted".
 * Obligations Loans owns (A-8: a loan, one pointing at a loan, one paid through the loan) are left out of every total and listed separately.
 * Paused and ended obligations are handled by the reader itself: an open pause or a past end gives no dates; a future end still gives
 * dates until then. There is no special case here, so a preview and a total can never disagree.
 */
import { addDays, addMonths } from '../../lib/dates';
import { expectedAmountOn, isLoanExcluded, scheduleSource, type ObligationRecord } from './model';
import { expectedDates } from './schedule';

export type LineKind = 'known' | 'estimated' | 'mixed' | 'unknown' | 'none' | 'on-demand';
export interface CommitmentLine {
  id: number;
  title: string;
  kind: LineKind;
  /** Expected dates in the window. */
  periods: number;
  /** Total of the dates that have an amount (known + estimated), whole cents. */
  knownCents: number;
  estimatedCents: number;
  unknownPeriods: number;
}
export interface Commitments {
  window: { from: string; to: string };
  known: { cents: number; obligations: number; periods: number };
  estimated: { cents: number; obligations: number; periods: number };
  unknown: { obligations: number; periods: number };
  /** The 12-month totals divided by 12, rounded to the cent. Always shown as "averaged". */
  averaged: { knownCents: number; estimatedCents: number };
  /** Obligations with no schedule (nothing is expected, so nothing is counted). */
  onDemand: number;
  /** Obligations left out because Loans owns their payments. */
  loanExcluded: number;
  lines: CommitmentLine[];
}

/** Twelve calendar months from `today`, `today` included: [today, same day next year minus one day], so a monthly bill counts 12 times. */
export const commitmentWindow = (today: string) => ({ from: today, to: addDays(addMonths(today, 12), -1) });

export function buildCommitments(obligations: ObligationRecord[], today: string): Commitments {
  const window = commitmentWindow(today);
  const lines: CommitmentLine[] = [];
  const out: Commitments = {
    window, known: { cents: 0, obligations: 0, periods: 0 }, estimated: { cents: 0, obligations: 0, periods: 0 }, unknown: { obligations: 0, periods: 0 },
    averaged: { knownCents: 0, estimatedCents: 0 }, onDemand: 0, loanExcluded: 0, lines,
  };
  for (const r of obligations) {
    const d = r.data;
    if (isLoanExcluded(d)) { out.loanExcluded++; continue; }
    const dates = expectedDates(scheduleSource(d), window.from, window.to);
    const line: CommitmentLine = { id: r.id, title: d.title, kind: 'none', periods: dates.length, knownCents: 0, estimatedCents: 0, unknownPeriods: 0 };
    if (!d.schedule && d.scheduleHistory.length === 0) { if (d.status === 'active') out.onDemand++; line.kind = 'on-demand'; lines.push(line); continue; }
    let knownPeriods = 0, estPeriods = 0;
    for (const e of dates) {
      const a = expectedAmountOn(d, e.nominal);
      if (a.cents === null) line.unknownPeriods++;
      else if (a.basis === 'fixed') { line.knownCents += a.cents; knownPeriods++; }
      else { line.estimatedCents += a.cents; estPeriods++; }
    }
    line.kind = dates.length === 0 ? 'none' : [knownPeriods > 0, estPeriods > 0, line.unknownPeriods > 0].filter(Boolean).length > 1 ? 'mixed' : knownPeriods > 0 ? 'known' : estPeriods > 0 ? 'estimated' : 'unknown';
    out.known.cents += line.knownCents; out.known.periods += knownPeriods; if (knownPeriods) out.known.obligations++;
    out.estimated.cents += line.estimatedCents; out.estimated.periods += estPeriods; if (estPeriods) out.estimated.obligations++;
    out.unknown.periods += line.unknownPeriods; if (line.unknownPeriods) out.unknown.obligations++;
    lines.push(line);
  }
  out.averaged = { knownCents: Math.round(out.known.cents / 12), estimatedCents: Math.round(out.estimated.cents / 12) };
  return out;
}
