/**
 * What a financial figure shows, as plain data (D6). It decides PRESENTATION only:
 *  - it never adds, subtracts or formats an amount (the text arrives already formatted by the module's own logic and is shown as given);
 *  - it never treats a missing value as zero: a figure with no text is shown as "not known", never as $0.00;
 *  - it never combines a known amount with an estimated one.
 */
export type Certainty = 'known' | 'estimated' | 'unknown';

export interface FigureView {
  certainty: Certainty;
  /** The words of the certainty tag, or null for a known amount. */
  tag: 'Estimated' | 'Not known' | null;
  /** False when there is no value text to show (the component then draws a dash that is hidden from screen readers; the tag carries the meaning). */
  hasValue: boolean;
  /** Progress as a whole percent 0 to 100, or null when none should be drawn (not given, not a number, or the amount is not known). */
  percent: number | null;
}

export const hasText = (v: unknown): boolean => v !== null && v !== undefined && v !== false && !(typeof v === 'string' && v.trim() === '');

export function figureView(input: { value?: unknown; certainty?: Certainty; progress?: number | null }): FigureView {
  const given = hasText(input.value);
  // A "known" or "estimated" figure that has no value text is really an unknown one. It is never shown as zero.
  const certainty: Certainty = input.certainty === 'unknown' || !given ? 'unknown' : input.certainty === 'estimated' ? 'estimated' : 'known';
  const p = input.progress;
  const percent = certainty !== 'unknown' && typeof p === 'number' && Number.isFinite(p) ? Math.round(Math.min(1, Math.max(0, p)) * 100) : null;
  return { certainty, tag: certainty === 'estimated' ? 'Estimated' : certainty === 'unknown' ? 'Not known' : null, hasValue: given, percent };
}
