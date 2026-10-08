import { useRef, useState } from 'react';
import { formatCents } from '../lib/money';

/** $1.2M / $850K / $900 from cents. */
export function compactUSD(cents: number): string {
  const d = cents / 100;
  const a = Math.abs(d);
  const sign = d < 0 ? '-' : '';
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(a >= 1e10 ? 0 : 1)}B`;
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`;
  if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(a >= 1e5 ? 0 : 1)}K`;
  return `${sign}$${a.toFixed(0)}`;
}

/** Round "nice" axis ticks from 0 up past max. */
export function niceTicks(max: number, count = 5): number[] {
  if (max <= 0) return [0];
  const raw = max / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = 0; v <= max + step * 0.999; v += step) out.push(v);
  return out;
}

// ---------- allocation: part-to-whole stacked bar (categorical colors, fixed order) ----------

export interface AllocItem {
  key: string | number;
  name: string;
  cents: number;
  pct: number;
  /** Stable slot (0-7). Color follows the entity, not its rank. */
  slot: number;
}

export function AllocationBar({ items, title }: { items: AllocItem[]; title: string }) {
  const [tip, setTip] = useState<{ x: number; y: number; item: AllocItem } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  if (items.length === 0) return <p className="muted">Add holdings to see the allocation.</p>;
  const show = (e: React.PointerEvent | React.FocusEvent, item: AllocItem) => {
    const r = box.current!.getBoundingClientRect();
    const x = 'clientX' in e ? e.clientX - r.left : 12;
    const y = 'clientY' in e ? e.clientY - r.top : 12;
    setTip({ x, y, item });
  };
  return (
    <div className="viz" ref={box}>
      <h3>{title}</h3>
      <div className="alloc" role="img" aria-label={items.map((i) => `${i.name} ${i.pct.toFixed(1)}%`).join(', ')}>
        {items.map((i) => (
          <div
            key={i.key}
            tabIndex={0}
            style={{ flex: `${Math.max(i.pct, 0.5)} 0 0`, background: `var(--s${i.slot + 1})` }}
            onPointerMove={(e) => show(e, i)}
            onPointerLeave={() => setTip(null)}
            onFocus={(e) => show(e, i)}
            onBlur={() => setTip(null)}
            aria-label={`${i.name}: ${i.pct.toFixed(1)}%, ${formatCents(i.cents)}`}
          />
        ))}
      </div>
      <div className="legend" style={{ display: 'block' }}>
        <table>
          <tbody>
            {items.map((i) => (
              <tr key={i.key}>
                <td><span className="key"><span className="swatch" style={{ background: `var(--s${i.slot + 1})` }} />{i.name}</span></td>
                <td className="num">{i.pct.toFixed(1)}%</td>
                <td className="num">{formatCents(i.cents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {tip && (
        <div className="tip" style={{ left: Math.min(tip.x + 12, 260), top: tip.y + 28 }}>
          <div className="row2"><span className="k"><i style={{ borderColor: `var(--s${tip.item.slot + 1})` }} />{tip.item.name}</span><strong>{tip.item.pct.toFixed(1)}%</strong></div>
          <div className="muted">{formatCents(tip.item.cents)}</div>
        </div>
      )}
    </div>
  );
}

// ---------- projection fan chart ----------

export interface FanData {
  startYear: number;
  p10: number[];
  p25: number[];
  p50: number[];
  p75: number[];
  p90: number[];
  steady: number[];
}

const W = 720;
const H = 320;
const M = { l: 56, r: 12, t: 12, b: 28 };

export function FanChart({ data, title, subtitle, realTerms }: { data: FanData; title: string; subtitle: string; realTerms: boolean }) {
  const n = data.p50.length - 1;
  const [idx, setIdx] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);

  const max = Math.max(...data.p90, ...data.steady);
  const ticks = niceTicks(max / 100, 5).map((v) => v * 100);
  const top = ticks[ticks.length - 1] || 1;
  const x = (t: number) => M.l + (t / Math.max(n, 1)) * (W - M.l - M.r);
  const y = (v: number) => M.t + (1 - v / top) * (H - M.t - M.b);
  const line = (arr: number[]) => arr.map((v, t) => `${t === 0 ? 'M' : 'L'}${x(t).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const band = (hi: number[], lo: number[]) =>
    `${hi.map((v, t) => `${t === 0 ? 'M' : 'L'}${x(t).toFixed(1)},${y(v).toFixed(1)}`).join(' ')} ${lo
      .map((_, k) => {
        const t = n - k;
        return `L${x(t).toFixed(1)},${y(lo[t]).toFixed(1)}`;
      })
      .join(' ')} Z`;

  const xTicks: number[] = [];
  const step = n > 30 ? 10 : 5;
  for (let t = 0; t <= n; t += step) xTicks.push(t);

  const locate = (clientX: number) => {
    const r = svg.current!.getBoundingClientRect();
    const px = ((clientX - r.left) / r.width) * W;
    const t = Math.round(((px - M.l) / (W - M.l - M.r)) * n);
    setIdx(Math.min(n, Math.max(0, t)));
  };

  const rows = idx === null ? [] : [
    ['90th percentile', data.p90[idx], 'var(--s1)', 0.35],
    ['75th percentile', data.p75[idx], 'var(--s1)', 0.6],
    ['Median', data.p50[idx], 'var(--s1)', 1],
    ['25th percentile', data.p25[idx], 'var(--s1)', 0.6],
    ['10th percentile', data.p10[idx], 'var(--s1)', 0.35],
    ['Steady-return path', data.steady[idx], 'var(--s2)', 1],
  ] as [string, number, string, number][];

  const tipLeft = idx === null ? 0 : (x(idx) / W) * 100;

  return (
    <div className="viz" ref={box}>
      <h3>{title}</h3>
      <div className="sub">{subtitle}</div>
      <div className="legend">
        <span className="key"><span className="line" style={{ borderColor: 'var(--s1)' }} />Median (typical outcome)</span>
        <span className="key"><span className="swatch" style={{ background: 'var(--s1)', opacity: 0.35 }} />Middle 50% of outcomes</span>
        <span className="key"><span className="swatch" style={{ background: 'var(--s1)', opacity: 0.15 }} />10th to 90th percentile</span>
        <span className="key"><span className="line" style={{ borderColor: 'var(--s2)' }} />Steady-return path (average)</span>
      </div>
      <svg
        ref={svg}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`${title}. Median ${compactUSD(data.p50[n])} after ${n} years; 10th to 90th percentile ${compactUSD(data.p10[n])} to ${compactUSD(data.p90[n])}.`}
        tabIndex={0}
        onPointerMove={(e) => locate(e.clientX)}
        onPointerLeave={() => setIdx(null)}
        onFocus={() => setIdx((i) => i ?? n)}
        onBlur={() => setIdx(null)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') setIdx((i) => Math.min(n, (i ?? 0) + 1));
          if (e.key === 'ArrowLeft') setIdx((i) => Math.max(0, (i ?? 0) - 1));
        }}
      >
        {ticks.map((v) => (
          <g key={v}>
            <line x1={M.l} x2={W - M.r} y1={y(v)} y2={y(v)} stroke="var(--grid)" strokeWidth={1} />
            <text x={M.l - 8} y={y(v) + 4} textAnchor="end" fontSize={11} fill="var(--ink-3)">{compactUSD(v)}</text>
          </g>
        ))}
        <line x1={M.l} x2={W - M.r} y1={y(0)} y2={y(0)} stroke="var(--axis)" strokeWidth={1} />
        {xTicks.map((t) => (
          <text key={t} x={x(t)} y={H - 8} textAnchor="middle" fontSize={11} fill="var(--ink-3)">{data.startYear + t}</text>
        ))}
        <path d={band(data.p90, data.p10)} fill="var(--s1)" fillOpacity={0.12} />
        <path d={band(data.p75, data.p25)} fill="var(--s1)" fillOpacity={0.22} />
        <path d={line(data.steady)} fill="none" stroke="var(--s2)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        <path d={line(data.p50)} fill="none" stroke="var(--s1)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {idx !== null && (
          <g>
            <line x1={x(idx)} x2={x(idx)} y1={M.t} y2={y(0)} stroke="var(--ink-3)" strokeWidth={1} />
            <circle cx={x(idx)} cy={y(data.p50[idx])} r={4} fill="var(--s1)" stroke="var(--surface-1)" strokeWidth={2} />
            <circle cx={x(idx)} cy={y(data.steady[idx])} r={4} fill="var(--s2)" stroke="var(--surface-1)" strokeWidth={2} />
          </g>
        )}
      </svg>
      {idx !== null && (
        <div className="tip" style={{ left: `clamp(8px, calc(${tipLeft}% - 70px), calc(100% - 200px))`, top: 92 }}>
          <div style={{ marginBottom: 4 }}><strong>{data.startYear + idx}</strong> <span className="muted">(year {idx}{realTerms ? ", today's dollars" : ', future dollars'})</span></div>
          {rows.map(([name, v, color, op]) => (
            <div className="row2" key={name}>
              <span className="k"><i style={{ borderColor: color, opacity: op }} />{name}</span>
              <strong>{compactUSD(v)}</strong>
            </div>
          ))}
        </div>
      )}
      <details style={{ marginTop: 8 }}>
        <summary>Show as table</summary>
        <div style={{ overflowX: 'auto', maxHeight: 320 }}>
          <table>
            <thead>
              <tr><th>Year</th><th className="num">10th</th><th className="num">25th</th><th className="num">Median</th><th className="num">75th</th><th className="num">90th</th><th className="num">Steady</th></tr>
            </thead>
            <tbody>
              {data.p50.map((_, t) => (
                <tr key={t}>
                  <td>{data.startYear + t}</td>
                  <td className="num">{formatCents(Math.round(data.p10[t]))}</td>
                  <td className="num">{formatCents(Math.round(data.p25[t]))}</td>
                  <td className="num">{formatCents(Math.round(data.p50[t]))}</td>
                  <td className="num">{formatCents(Math.round(data.p75[t]))}</td>
                  <td className="num">{formatCents(Math.round(data.p90[t]))}</td>
                  <td className="num">{formatCents(Math.round(data.steady[t]))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
