import { useEffect, useRef, useState, type ReactNode } from 'react';
import { formatCents } from '../lib/money';
import type { NetWorthBar } from '../lib/homeCharts';
import { compactUSD, niceTicks } from '../pages/charts';

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

const NW_PARTS: { key: 'cashCents' | 'investmentsCents' | 'propertyCents' | 'cardsOwedCents' | 'loansOwedCents'; name: string; color: string; up: boolean }[] = [
  { key: 'cashCents', name: 'Cash', color: 'var(--chart-1)', up: true },
  { key: 'investmentsCents', name: 'Investments', color: 'var(--chart-3)', up: true },
  { key: 'propertyCents', name: 'Property', color: 'var(--chart-4)', up: true },
  { key: 'cardsOwedCents', name: 'Credit cards', color: 'var(--chart-5)', up: false },
  { key: 'loansOwedCents', name: 'Loans', color: 'var(--chart-2)', up: false },
];

/** Assets stacked above the zero line, what is owed stacked below it, and net worth as a line on top. Hover, tap, or use the arrow keys to read a month. */
export function NetWorthChart({ bars, label }: { bars: NetWorthBar[]; label: string }) {
  const [idx, setIdx] = useState<number | null>(null);
  // Draw at the card's real width so labels stay readable instead of shrinking with the card.
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(480);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setW(Math.max(260, Math.round(el.clientWidth))));
    ro.observe(el);
    setW(Math.max(260, Math.round(el.clientWidth)));
    return () => ro.disconnect();
  }, []);
  const H = 240;
  const M = { l: 52, r: 10, t: 10, b: 26 };
  const n = bars.length;
  const upTicks = niceTicks(Math.max(...bars.map((b) => Math.max(b.upCents, b.netCents)), 1) / 100, 3).map((v) => v * 100);
  const downMax = Math.max(...bars.map((b) => Math.max(b.downCents, -b.netCents)), 0);
  const downTicks = downMax > 0 ? niceTicks(downMax / 100, 2).map((v) => -v * 100).filter((v) => v < 0) : [];
  const top = upTicks[upTicks.length - 1] || 1;
  const bottom = downTicks.length ? downTicks[downTicks.length - 1] : 0;
  const y = (v: number) => M.t + ((top - v) / (top - bottom)) * (H - M.t - M.b);
  const slot = (W - M.l - M.r) / n;
  const cx = (i: number) => M.l + slot * i + slot / 2;
  const bw = Math.max(3, Math.min(34, slot * 0.62));
  const step = Math.ceil(n / Math.max(2, Math.floor((W - M.l - M.r) / 62)));
  const line = bars.map((b, i) => `${i === 0 ? 'M' : 'L'}${cx(i).toFixed(1)},${y(b.netCents).toFixed(1)}`).join(' ');
  const last = bars[n - 1];
  const b = idx === null ? null : bars[idx];
  const move = (clientX: number, el: SVGSVGElement) => {
    const r = el.getBoundingClientRect();
    const px = ((clientX - r.left) / r.width) * W;
    setIdx(Math.min(n - 1, Math.max(0, Math.floor((px - M.l) / slot))));
  };

  return (
    <div className="nwchart" ref={box}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ height: H }}
        role="img"
        aria-label={`${label}. Latest ${last.label}: assets ${formatCents(last.upCents)}, owed ${formatCents(last.downCents)}, net worth ${formatCents(last.netCents)}.`}
        tabIndex={0}
        onPointerMove={(e) => move(e.clientX, e.currentTarget)}
        onPointerDown={(e) => move(e.clientX, e.currentTarget)}
        onPointerLeave={() => setIdx(null)}
        onFocus={() => setIdx((i) => i ?? n - 1)}
        onBlur={() => setIdx(null)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') setIdx((i) => Math.min(n - 1, (i ?? -1) + 1));
          if (e.key === 'ArrowLeft') setIdx((i) => Math.max(0, (i ?? n) - 1));
        }}
      >
        {[...upTicks, ...downTicks].map((v) => (
          <g key={v}>
            {v !== 0 && <line x1={M.l} x2={W - M.r} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeWidth={1} />}
            <text x={M.l - 6} y={y(v) + 4} textAnchor="end" className="axis-label">{compactUSD(v)}</text>
          </g>
        ))}
        {idx !== null && <rect x={M.l + slot * idx} y={M.t} width={slot} height={H - M.t - M.b} fill="var(--accent-soft)" />}
        {bars.map((p, i) => {
          if (!p.hasParts) return null;
          let up = 0;
          let down = 0;
          return NW_PARTS.map((s) => {
            const v = p[s.key];
            if (v <= 0) return null;
            const from = s.up ? up : down;
            if (s.up) up += v; else down += v;
            const y1 = s.up ? y(from + v) : y(-from);
            const y2 = s.up ? y(from) : y(-(from + v));
            return <rect key={`${p.date}${s.key}`} x={cx(i) - bw / 2} y={y1} width={bw} height={Math.max(0, y2 - y1)} fill={s.color} />;
          });
        })}
        <line x1={M.l} x2={W - M.r} y1={y(0)} y2={y(0)} className="axis" />
        {n >= 2 && <path d={line} fill="none" stroke="var(--fg)" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />}
        {bars.map((p, i) => <circle key={p.date} cx={cx(i)} cy={y(p.netCents)} r={n > 14 ? 2.5 : 3.5} fill="var(--fg)" stroke="var(--card)" strokeWidth={1.5} />)}
        {bars.map((p, i) => (i % step === 0 || i === n - 1) && (i === n - 1 || n - 1 - i >= step) && (
          <text key={p.date} x={cx(i)} y={H - 8} textAnchor="middle" className="axis-label">{p.label}</text>
        ))}
      </svg>
      {b && idx !== null && (
        <div className="tip nw-tip" style={{ left: `clamp(4px, calc(${(cx(idx) / W) * 100}% - 80px), calc(100% - 184px))`, top: 4 }}>
          <div style={{ marginBottom: 4 }}><strong>{b.label}</strong></div>
          <div className="row2"><span className="k"><i style={{ borderColor: 'var(--fg)' }} />Net worth</span><strong>{formatCents(b.netCents)}</strong></div>
          {b.hasParts ? NW_PARTS.map((s) => b[s.key] > 0 && (
            <div className="row2" key={s.key}><span className="k"><span className="swatch" style={{ background: s.color }} />{s.name}</span><strong>{s.up ? '' : '-'}{formatCents(b[s.key])}</strong></div>
          )) : <div className="muted">Total only (no breakdown saved)</div>}
        </div>
      )}
      <ul className="legend inline">
        {NW_PARTS.map((s) => <li key={s.key}><span className="swatch" style={{ background: s.color }} aria-hidden="true" />{s.name}</li>)}
        <li><span className="legend-line" aria-hidden="true" />Net worth</li>
      </ul>
    </div>
  );
}
