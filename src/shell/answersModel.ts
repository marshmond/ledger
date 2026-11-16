/**
 * R3.2: the wording and formatting of an answer, as PURE functions of the reader's structured result. The reader decides nothing about words; the screen decides nothing about
 * money. Hide amounts is applied here and only here (`money` and `text` are passed in), so the one place that draws a figure is the one place that can hide it.
 */
import type { AnswerCertainty, AnswerFigure, AnswerPart, AnswerStatus } from '../core/answers';
import type { StatusTone } from '../ui/StatusChip';

export type Money = (cents: number) => string;
export type Text = (t: string) => string;

/** The chip an answer carries, by status. A plain, complete answer carries none. The words are always present. */
export function answerStatusView(s: AnswerStatus): { label: string; tone: StatusTone } | null {
  switch (s) {
    case 'none': return { label: 'Checked: nothing found', tone: 'info' };
    case 'limited': return { label: 'Answered, with limits', tone: 'warning' };
    case 'insufficient': return { label: 'Not enough information', tone: 'warning' };
    default: return null;
  }
}

/** The headline as one string (used by tests and by anything that needs plain text). Money follows Hide amounts. */
export function headlineText(parts: readonly AnswerPart[], money: Money, text: Text): string {
  return parts.map((p) => (typeof p === 'string' ? text(p) : money(p.money))).join('');
}

const CERT: Record<AnswerCertainty, 'known' | 'estimated' | 'unknown'> = { known: 'known', estimated: 'estimated', unknown: 'unknown', disputed: 'unknown' };

/** One figure as the `Figure` component takes it. A money figure with no amount is "not known", never zero. */
export function formatFigure(f: AnswerFigure, fmt: { money: Money; text: Text; day: (d: string) => string }): { value: string | undefined; certainty: 'known' | 'estimated' | 'unknown' } {
  const v = f.value;
  switch (v.kind) {
    case 'count': return { value: String(v.n), certainty: 'known' };
    case 'money': return v.cents === null ? { value: undefined, certainty: 'unknown' } : { value: fmt.money(v.cents), certainty: CERT[v.certainty ?? 'known'] };
    case 'date': return { value: fmt.day(v.date), certainty: 'known' };
    case 'text': return { value: fmt.text(v.text), certainty: 'known' };
  }
}

/** A row amount: "$120.00", "Not known" when there is none (never zero). */
export function rowAmountText(a: { cents: number | null; certainty?: AnswerCertainty }, money: Money): string {
  if (a.cents === null || a.certainty === 'unknown' || a.certainty === 'disputed') return a.certainty === 'disputed' ? 'In dispute' : 'Not known';
  return a.certainty === 'estimated' ? `about ${money(a.cents)}` : money(a.cents);
}
