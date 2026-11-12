import type { ReactNode } from 'react';
import { formatCents } from '../lib/money';

/**
 * Two small presentation pieces of Ledger Home (D12 final pass). Both only DRAW values the page already has; neither works out a figure, a ratio to show, or a status.
 */

export interface OwnPart { name: string; cents: number }

/**
 * "What you own and owe": the assets (positive balances) and the amount owed as two bars on ONE drawing scale (the longer of the two fills its track), then the parts the
 * assets are made of. The widths are only a drawing and are hidden from assistive technology: no percentage is shown or spoken, and nothing here subtracts one figure from
 * the other or says they reconcile. With no assets the page's own empty words are shown (the owed figure is not drawn alone, as before).
 */
export function OwnOweBars({ assetsCents, owedCents, parts, empty }: { assetsCents: number; owedCents: number; parts: readonly OwnPart[]; empty: ReactNode }) {
  if (parts.length === 0) return <>{empty}</>;
  const scale = Math.max(assetsCents, owedCents, 1);
  const rows = [
    { name: 'Assets (positive balances)', cents: assetsCents, cls: 'good', flag: '' },
    { name: 'Owed (cards and loans)', cents: owedCents, cls: owedCents > assetsCents ? 'over' : '', flag: owedCents > assetsCents ? 'More than assets' : '' },
  ];
  return (
    <div className="home-own">
      {rows.map((r) => (
        <div className="home-own-row" key={r.name}>
          <div className="bar-top"><span>{r.name}</span><span className={`bar-detail ${r.flag ? 'neg' : ''}`}>{r.flag && <span className="bar-flag">{r.flag}</span>}{formatCents(r.cents)}</span></div>
          <div className="bar-track" aria-hidden="true"><div className={`bar-fill ${r.cls}`} style={{ width: `${(Math.max(0, r.cents) / scale) * 100}%` }} /></div>
        </div>
      ))}
      <ul className="home-parts" aria-label="What the assets are made of">
        {parts.map((a) => <li key={a.name}><span>{a.name}</span><span className="home-parts-val">{formatCents(a.cents)}</span></li>)}
      </ul>
    </div>
  );
}

export interface CheckinStepLike { id: string; status: 'done' | 'todo' | 'na' }

/**
 * The monthly check-in as a segmented bar: one segment for each step that applies to you (the steps the check-in itself counts), filled when that step is done. The numbers
 * and the "next" step come from the check-in's own progress; this draws them and decides nothing. The bar is a named progress bar that says "N of M steps done".
 */
export function CheckinSteps({ steps, done, total, complete, nextTitle, streak }: { steps: readonly CheckinStepLike[]; done: number; total: number; complete: boolean; nextTitle?: string; streak: number }) {
  return (
    <div className="home-steps">
      <div className="home-steps-bar" role="progressbar" aria-label="Monthly check-in progress" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-valuetext={`${done} of ${total} steps done`}>
        {steps.filter((s) => s.status !== 'na').map((s) => <span key={s.id} className={s.status === 'done' ? 'on' : ''} />)}
      </div>
      <p className="home-steps-count"><strong>{done} of {total}</strong> steps done this month</p>
      <p className="muted home-steps-next">{complete ? 'All steps done.' : <><span className="home-start-eyebrow">Next</span> {nextTitle ?? ''}</>}{streak > 1 && <><br />{streak} months in a row</>}</p>
    </div>
  );
}
