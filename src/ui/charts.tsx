import type { ReactNode } from 'react';
import { formatCents } from '../lib/money';

/** Small hand-drawn charts for the Home cards. Colors come from --chart-N in styles.css; every chart also prints its numbers, so color is never the only signal. */

export const chartColor = (i: number) => `var(--chart-${(i % 6) + 1})`;

export interface DonutSlice {
  name: string;
  cents: number;
}

/** A ring split into slices, with a legend of names and amounts. `center` goes in the hole. */
export function Donut({ slices, label, center }: { slices: DonutSlice[]; label: string; center?: ReactNode }) {
  const total = slices.reduce((s, x) => s + x.cents, 0);
  const R = 40;
  const C = 2 * Math.PI * R;
  let offset = 0;
  return (
    <div className="donut">
      <div className="donut-ring">
        <svg viewBox="0 0 100 100" role="img" aria-label={label}>
          <circle cx="50" cy="50" r={R} className="donut-track" />
          {total > 0 && slices.map((s, i) => {
            const len = (s.cents / total) * C;
            const el = <circle key={s.name} cx="50" cy="50" r={R} className="donut-seg" style={{ stroke: chartColor(i) }} strokeDasharray={`${Math.max(len - 0.8, 0)} ${C}`} strokeDashoffset={-offset} transform="rotate(-90 50 50)" />;
            offset += len;
            return el;
          })}
        </svg>
        {center && <div className="donut-center">{center}</div>}
      </div>
      <ul className="legend">
        {slices.map((s, i) => (
          <li key={s.name}>
            <span className="swatch" style={{ background: chartColor(i) }} aria-hidden="true" />
            <span className="legend-name">{s.name}</span>
            <span className="legend-val">{formatCents(s.cents)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface Bar {
  name: string;
  /** 0 to 1 fills the bar; above 1 is drawn full and flagged. */
  ratio: number;
  detail: string;
  over?: boolean;
  /** Green fill that never turns amber (for income, where full is good). */
  good?: boolean;
}

/** Horizontal progress bars, one per row, with a name above and a short figure beside it. */
export function BarList({ bars }: { bars: Bar[] }) {
  return (
    <ul className="bars">
      {bars.map((b) => (
        <li key={b.name}>
          <div className="bar-top"><span>{b.name}</span><span className={`bar-detail ${b.over ? 'neg' : 'muted'}`}>{b.detail}</span></div>
          <div className="bar-track" role="progressbar" aria-label={b.name} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.round(b.ratio * 100))}>
            <div className={`bar-fill ${b.over ? 'over' : b.good ? 'good' : b.ratio > 0.85 ? 'warn' : ''}`} style={{ width: `${Math.min(1, b.ratio) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** A circular progress ring with text in the middle. */
export function Ring({ fraction, label, children }: { fraction: number; label: string; children?: ReactNode }) {
  const R = 40;
  const C = 2 * Math.PI * R;
  const f = Math.max(0, Math.min(1, fraction));
  return (
    <div className="donut-ring ring">
      <svg viewBox="0 0 100 100" role="img" aria-label={label}>
        <circle cx="50" cy="50" r={R} className="donut-track" />
        <circle cx="50" cy="50" r={R} className="donut-seg ring-fill" strokeDasharray={`${f * C} ${C}`} transform="rotate(-90 50 50)" />
      </svg>
      <div className="donut-center">{children}</div>
    </div>
  );
}

export interface PairPoint {
  label: string;
  a: number;
  b: number;
}

/** Side-by-side columns per period: `a` (income) and `b` (spending). */
export function PairedColumns({ points, aName, bName, label }: { points: PairPoint[]; aName: string; bName: string; label: string }) {
  const W = 360;
  const H = 150;
  const base = H - 22;
  const max = Math.max(1, ...points.flatMap((p) => [p.a, p.b]));
  const slot = W / points.length;
  const bw = Math.min(22, slot * 0.34);
  const h = (v: number) => (Math.max(0, v) / max) * (base - 6);
  return (
    <div>
      <svg className="paired" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
        <line x1="0" x2={W} y1={base} y2={base} className="axis" />
        {points.map((p, i) => {
          const cx = slot * i + slot / 2;
          return (
            <g key={p.label}>
              <rect x={cx - bw - 1} y={base - h(p.a)} width={bw} height={h(p.a)} rx="3" className="col-a" />
              <rect x={cx + 1} y={base - h(p.b)} width={bw} height={h(p.b)} rx="3" className="col-b" />
              <text x={cx} y={H - 6} textAnchor="middle" className="axis-label">{p.label}</text>
            </g>
          );
        })}
      </svg>
      <ul className="legend inline">
        <li><span className="swatch col-a-sw" aria-hidden="true" />{aName}</li>
        <li><span className="swatch col-b-sw" aria-hidden="true" />{bName}</li>
      </ul>
    </div>
  );
}
