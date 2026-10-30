import { useEffect, useRef, useState, type ReactNode } from 'react';
import { formatCents } from '../lib/money';

/** Page title, one line of explanation, and the page's main action on the right. Longer help goes in `about`, collapsed until asked for. */
export function PageHeader({ title, description, actions, about, className = '' }: { title: string; description?: ReactNode; actions?: ReactNode; about?: ReactNode; className?: string }) {
  return (
    <>
      <header className={`page-head ${className}`}>
        <div className="page-head-text">
          <h1>{title}</h1>
          {description && <p className="page-desc">{description}</p>}
        </div>
        {actions && <div className="page-actions">{actions}</div>}
      </header>
      {about && (
        <details className={`about ${className}`}>
          <summary>About this page</summary>
          <div className="prose">{about}</div>
        </details>
      )}
    </>
  );
}

/** A list or card with nothing in it yet: one sentence and, usually, one button. */
export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon" aria-hidden="true">○</div>
      <strong>{title}</strong>
      {children && <p className="muted">{children}</p>}
      {action}
    </div>
  );
}

/** A small labelled figure. */
export function Stat({ label, cents, tone }: { label: string; cents: number; tone?: 'auto' | 'none' }) {
  const cls = tone === 'none' ? '' : cents < 0 ? 'neg' : '';
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className={`stat-value ${cls}`}>{formatCents(cents)}</div>
    </div>
  );
}

/** A tinted notice. */
export function Banner({ level = 'info', title, children, action }: { level?: 'info' | 'warn' | 'bad' | 'ok'; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className={`banner ${level}`} role={level === 'bad' ? 'alert' : undefined}>
      <div className="banner-text">
        <strong>{title}</strong>
        {children && <div className="muted">{children}</div>}
      </div>
      {action && <div className="banner-act">{action}</div>}
    </div>
  );
}

/** Money with a visible sign: inflows get a "+", outflows keep their "-". Color is a second signal, never the only one. */
export function signedCents(cents: number): string {
  return cents > 0 ? `+${formatCents(cents)}` : formatCents(cents);
}

/** A small trend line with a dot on the latest value. Values are plain numbers in any unit. */
export function Sparkline({ values, label }: { values: number[]; label: string }) {
  if (values.length < 2) return null;
  const W = 600;
  const H = 120;
  const pad = 8;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * W, pad + (1 - (v - min) / span) * (H - pad * 2)] as const);
  const line = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${line} L${W},${H} L0,${H} Z`;
  const last = pts[pts.length - 1];
  return (
    <div className="spark">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={label}>
        <path d={area} className="spark-area" />
        <path d={line} className="spark-line" vectorEffect="non-scaling-stroke" />
      </svg>
      <span className="spark-dot" style={{ top: `${(last[1] / H) * 100}%` }} aria-hidden="true" />
    </div>
  );
}

/** Marks a scrolling strip with `fade-l` / `fade-r` when more is hidden off that edge, so the fade only shows when it means something. */
export function useEdgeFade<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const lastActive = useRef<HTMLElement | null>(null);
  const [state, setState] = useState({ l: false, r: false });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const l = el.scrollLeft > 4;
      const r = el.scrollLeft + el.clientWidth < el.scrollWidth - 4;
      setState((cur) => (cur.l === l && cur.r === r ? cur : { l, r }));
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    // Keep the active item in view, but only when it changes: this effect re-runs on every render, and
    // re-centering each time would snap the row back while the user is swiping it.
    const active = el.querySelector<HTMLElement>('.active, .on');
    if (active && active !== lastActive.current) {
      lastActive.current = active;
      active.scrollIntoView?.({ block: 'nearest', inline: 'center' });
    }
    return () => {
      el.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  });
  return { ref, className: `${state.l ? 'fade-l' : ''} ${state.r ? 'fade-r' : ''}` };
}
