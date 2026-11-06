import { useId, useState } from 'react';
import { formatCents } from '../../lib/money';
import type { CostBarModel, CostRow, DrawnSegment } from './financialView';

type View = 'expected' | 'paid';

const color = (slot: DrawnSegment['slot']) => (slot === 'none' ? undefined : `var(--s${slot + 1})`);
const pct = (n: number) => `${n.toFixed(1)}%`;
const signed = (c: number) => (c < 0 ? `−${formatCents(-c)}` : formatCents(c));
/** Paid beyond its part of the plan. "No budget line" is never that: its negative left only balances other rows. */
const over = (r: CostRow) => r.kind !== 'none' && r.leftCents < 0;

/**
 * A segmented bar and its legend. The legend is the accurate, accessible version of the bar: every row with exact, signed figures
 * and words ("paid beyond its share"), so nothing depends on colour. Only reads a model built from the Finance summary.
 */
export default function CostBar({ title, totalLabel, partLabel, model, linkSlot, inline }: { title: string; totalLabel: string; partLabel: string; model: CostBarModel; linkSlot?: React.ReactNode; inline?: boolean }) {
  const Head = inline ? 'h3' : 'h2';
  const uid = useId();
  const [view, setView] = useState<View>('expected');
  const [focus, setFocus] = useState<DrawnSegment | null>(null);
  const paidView = view === 'paid';

  const label = model.state === 'ok'
    ? `${title}: ${model.drawn.map((d) => `${d.name} ${pct(d.pct)}, ${formatCents(d.cents)}`).join('; ')}. ${model.reconciles ? `Total ${formatCents(model.totalCents)}.` : `Parts shown add up to ${formatCents(model.drawnCents)}; the total is ${formatCents(model.totalCents)}.`}`
    : `${title}: no bar. ${model.notes[0] ?? 'Nothing to show yet.'}`;

  return (
    <section className={`${inline ? 'pj-cost-inline ' : 'card pj-card '}viz pj-cost`} aria-labelledby={`${uid}-h`}>
      <div className="pj-card-head">
        <Head id={`${uid}-h`}>{title}</Head>
        {model.state !== 'empty' && (
          <div className="seg" role="group" aria-label="What the bar shows">
            <button type="button" className={!paidView ? 'on' : ''} aria-pressed={!paidView} onClick={() => setView('expected')}>{partLabel}</button>
            <button type="button" className={paidView ? 'on' : ''} aria-pressed={paidView} onClick={() => setView('paid')}>Paid and left</button>
          </div>
        )}
      </div>

      {model.state === 'empty' ? (
        <p className="muted">Add budget lines to see where the money goes.</p>
      ) : (
        <>
          <p className="pj-cost-total"><span className="muted small">{totalLabel}</span> <strong>{formatCents(model.totalCents)}</strong></p>

          {model.state === 'ok' && (
            <>
              <div className={`pj-cost-bar${paidView ? ' paidview' : ''}`} role="img" aria-label={label}>
                {model.drawn.map((d) => {
                  const paidFrac = d.cents > 0 ? Math.min(1, Math.max(0, d.paidCents / d.cents)) : 0;
                  return (
                    <div
                      key={d.key}
                      tabIndex={0}
                      className={`pj-seg${d.slot === 'none' ? ' none' : ''}${paidView && over(d) ? ' over' : ''}`}
                      style={{ flex: `${Math.max(d.pct, 0.8)} 0 0`, ...(d.slot === 'none' ? {} : { ['--seg' as string]: color(d.slot) }) }}
                      onPointerEnter={() => setFocus(d)}
                      onPointerLeave={() => setFocus(null)}
                      onFocus={() => setFocus(d)}
                      onBlur={() => setFocus(null)}
                      aria-label={`${d.name}: ${pct(d.pct)}, ${formatCents(d.cents)}${paidView ? `, paid ${formatCents(d.paidCents)}, left ${signed(d.leftCents)}${over(d) ? ', paid beyond its share' : ''}` : ''}`}
                    >
                      {paidView && <span className="pj-seg-paid" style={{ width: `${paidFrac * 100}%` }} />}
                    </div>
                  );
                })}
              </div>
              <p className="pj-cost-caption small" aria-live="polite">
                {focus ? <><strong>{focus.name}</strong>: {pct(focus.pct)} · {formatCents(focus.cents)}{paidView ? ` · paid ${formatCents(focus.paidCents)} · left ${signed(focus.leftCents)}${over(focus) ? ' (paid beyond its share)' : ''}` : ''}</> : <span className="muted">{paidView ? 'Dark part: paid. Light part: left to pay. A notch marks a line paid beyond its share.' : 'Hover or tab to a part for its amount.'}</span>}
              </p>
            </>
          )}

          {model.notes.map((n, i) => <p key={i} className="muted small pj-cost-note">{n}</p>)}

          <table className="pj-table pj-cost-table">
            <caption className="sr-only">{title}: exact figures by row</caption>
            <thead>
              <tr>
                <th>Line</th>
                {paidView ? <><th className="num">Paid</th><th className="num">Left to pay</th></> : <th className="num">Share</th>}
                <th className="num">{paidView ? partLabel : 'Amount'}</th>
              </tr>
            </thead>
            <tbody>
              {model.legend.map((r) => <LegendRow key={r.key} row={r} model={model} paidView={paidView} partLabel={partLabel} />)}
            </tbody>
          </table>
        </>
      )}
      {linkSlot}
    </section>
  );
}

function LegendRow({ row: r, model, paidView, partLabel }: { row: CostRow; model: CostBarModel; paidView: boolean; partLabel: string }) {
  const seg = model.drawn.find((d) => d.key === r.key);
  const swatch = seg ? (seg.slot === 'none' ? <span className="swatch none" /> : <span className="swatch" style={{ background: color(seg.slot) }} />) : <span className="swatch off" />;
  return (
    <>
      <tr>
        <th scope="row" data-label="Line"><span className="key">{swatch}{r.name}</span></th>
        {paidView ? (
          <>
            <td className="num" data-label="Paid">{signed(r.paidCents)}</td>
            <td className={`num ${over(r) ? 'neg' : ''}`} data-label="Left to pay">{over(r) ? `${signed(r.leftCents)} paid beyond its share` : r.kind === 'none' && r.leftCents < 0 ? `${signed(r.leftCents)} balances the lines` : signed(r.leftCents)}</td>
          </>
        ) : (
          <td className="num" data-label="Share">{seg ? pct(seg.pct) : '—'}</td>
        )}
        <td className={`num ${r.cents < 0 ? 'neg' : ''}`} data-label={paidView ? partLabel : 'Amount'}>
          {signed(r.cents)}
          {!paidView && over(r) && <span className="small neg"> · paid beyond its share</span>}
        </td>
      </tr>
      {(r.note || r.members) && (
        <tr className="pj-cost-sub">
          <td colSpan={paidView ? 4 : 3} className="muted small">
            {r.note}
            {r.members && (
              <ul className="plain">
                {r.members.map((m) => <li key={m.key}>{m.name}: {signed(m.cents)} (paid {signed(m.paidCents)}, left {signed(m.leftCents)})</li>)}
              </ul>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
