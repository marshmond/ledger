import type { ReactNode } from 'react';
import { Icon } from './icons';
import { figureView, type Certainty } from './figureModel';

/**
 * A labelled financial figure (D6 shared component; not yet placed on any screen).
 *
 * Purely presentational: `value` is text that a module has ALREADY formatted (by the module's own money formatting), shown exactly as given. This component
 * never computes, sums or rounds an amount, never treats a missing value as zero (it shows "Not known" instead), and never mixes known and
 * estimated amounts. `certainty` only changes how the figure is drawn: known is plain, estimated has a dashed edge, a wave icon and the word
 * "Estimated", and not known has an amber dashed edge, a question-mark icon and the words "Not known". The words are always present, so the
 * difference is not carried by colour or line style alone.
 *
 * `progress` is a ratio between 0 and 1 that the module has already worked out (the bar is drawn, not calculated); out-of-range numbers are held
 * to 0 to 1 for drawing and a missing or non-numeric one draws no bar.
 */
export function Figure({ label, value, description, certainty = 'known', progress, progressLabel, tone = 'default', size = 'md', as: Tag = 'div' }: {
  label: string;
  /** Already-formatted amount or text. */
  value?: ReactNode;
  description?: ReactNode;
  certainty?: Certainty;
  progress?: number | null;
  /** Spoken name for the bar when it needs more than the figure's label. */
  progressLabel?: string;
  tone?: 'default' | 'good' | 'bad' | 'warn';
  size?: 'md' | 'lg';
  as?: 'div' | 'li';
}) {
  const v = figureView({ value, certainty, progress });
  const cls = ['ui-figure', `ui-figure--${v.certainty}`, tone !== 'default' && v.certainty !== 'unknown' ? `ui-figure--${tone}` : '', size === 'lg' ? 'ui-figure--lg' : ''].filter(Boolean).join(' ');
  return (
    <Tag className={cls}>
      <div className="ui-figure-label">{label}</div>
      <div className="ui-figure-value">{v.hasValue ? value : <span aria-hidden="true">—</span>}</div>
      {v.tag && (
        <span className="ui-figure-tag"><Icon name={v.certainty === 'estimated' ? 'wave' : 'help'} size={12} />{v.tag}</span>
      )}
      {description && <div className="ui-figure-desc">{description}</div>}
      {v.percent !== null && (
        <div className="ui-figure-bar" role="progressbar" aria-label={progressLabel ?? label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={v.percent}>
          <span style={{ width: `${v.percent}%` }} />
        </div>
      )}
    </Tag>
  );
}
