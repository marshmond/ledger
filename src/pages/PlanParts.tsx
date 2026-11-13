import type { ReactNode } from 'react';
import { Link } from '../core/router';

/**
 * D18: small presentational pieces shared by the Financial Planning pages (Income, Paycheck, Tax planning, Affordability, Projections, Retirement,
 * Roth, Goals, Giving, Protection). They draw what a page hands them. Nothing here reads data, stores anything or works out an amount.
 */

export type KindName = 'actual' | 'estimate' | 'projected' | 'assumption' | 'input' | 'recorded' | 'guideline' | 'action' | 'unknown';

const KIND_CLASS: Record<KindName, string> = {
  actual: 'an-kind',
  recorded: 'an-kind an-kind--manual',
  input: 'an-kind an-kind--assumption',
  assumption: 'an-kind an-kind--assumption',
  estimate: 'an-kind an-kind--projected',
  projected: 'an-kind an-kind--projected',
  guideline: 'an-kind an-kind--projected',
  action: 'an-kind pl-kind--action',
  unknown: 'an-kind an-kind--unknown',
};

/** A word tag that says what kind of thing a figure or a section is. The word is the message; the border style only helps. */
export function Kind({ k, children }: { k: KindName; children: ReactNode }) {
  return <span className={KIND_CLASS[k]}>{children}</span>;
}

export interface Fig {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  kind?: ReactNode;
}

/** The navy headline panel of a page: one main figure with its meaning, and a few supporting figures. */
export function PlanHero({ label, kind, amount, message, figs, id, stack }: { label: ReactNode; kind?: ReactNode; amount: ReactNode; message?: ReactNode; figs?: Fig[]; id?: string; /** Lay the supporting figures under the main one (for a narrow column). */ stack?: boolean }) {
  return (
    <section className={`an-hero pl-hero${stack ? ' pl-hero--stack' : ''}`} aria-label={typeof label === 'string' ? label : undefined} id={id}>
      <div>
        <div className="an-hero-label">{label}{kind}</div>
        <div className="an-hero-amt">{amount}</div>
        {message && <p className="an-hero-msg">{message}</p>}
      </div>
      {figs && figs.length > 0 && (
        <dl className="an-hero-figs">
          {figs.map((f, i) => (
            <div key={i}>
              <dt>{f.label}{f.kind}</dt>
              <dd>{f.value}{f.sub && <span className="an-sub">{f.sub}</span>}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

/** A row of figures, hairline-divided. */
export function PlanFigs({ figs, label }: { figs: Fig[]; label?: string }) {
  return (
    <dl className="an-figs" aria-label={label}>
      {figs.map((f, i) => (
        <div className="an-fig" key={i}>
          <dt>{f.label}{f.kind}</dt>
          <dd>{f.value}{f.sub && <span className="an-sub">{f.sub}</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A titled card. `id` is the in-page jump target. The heading is always an h2 so the page outline stays page, section, detail. */
export function PlanSection({ id, title, kind, aside, children, className = '', intro }: { id?: string; title: ReactNode; kind?: ReactNode; aside?: ReactNode; children: ReactNode; className?: string; intro?: ReactNode }) {
  return (
    <section className={`an-card pl-section ${className}`} id={id} tabIndex={id ? -1 : undefined} aria-labelledby={id ? `${id}-h` : undefined}>
      <div className="an-head">
        <h2 className="an-h2" id={id ? `${id}-h` : undefined}>{title}{kind}</h2>
        {aside}
      </div>
      {intro && <p className="an-note pl-intro">{intro}</p>}
      {children}
    </section>
  );
}

/** A short list of places on this page, for a long page. Buttons scroll to a section; the address bar is not touched (the app uses hash routes). */
export function PlanJump({ items, label = 'On this page' }: { items: { id: string; label: string; /** Runs first, e.g. to open a folded section so the jump never lands on hidden content. */ onJump?: () => void }[]; label?: string }) {
  const go = (id: string, onJump?: () => void) => {
    onJump?.();
    const el = document.getElementById(id);
    if (!el) return;
    const calm = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'start' });
    el.focus({ preventScroll: true });
  };
  return (
    <nav className="pl-jump" aria-label={label}>
      <span className="pl-jump-label" aria-hidden="true">{label}</span>
      <ul>
        {items.map((it) => <li key={it.id}><button type="button" onClick={() => go(it.id, it.onJump)}>{it.label}</button></li>)}
      </ul>
    </nav>
  );
}

export type CheckLevel = 'ok' | 'info' | 'warn';

/** A list of checks. Each row carries a word as well as a mark, so no meaning rests on color. */
export function PlanChecks({ items, words, label }: { items: { id: string; level: CheckLevel; title: ReactNode; detail?: ReactNode; to?: string }[]; words: Record<CheckLevel, string>; label?: string }) {
  return (
    <ul className="checklist pl-checks" aria-label={label}>
      {items.map((c) => (
        <li key={c.id} className={`check ${c.level === 'warn' ? 'todo' : c.level === 'ok' ? 'ok' : 'info'}`}>
          <span className="mark" aria-hidden="true">{c.level === 'ok' ? '✓' : c.level === 'warn' ? '!' : 'i'}</span>
          <div>
            <strong>{c.title}</strong>
            {c.detail && <div className="muted">{c.detail}</div>}
          </div>
          <span className="pl-check-word">{words[c.level]}</span>
          {c.to && <Link to={c.to}>Open →</Link>}
        </li>
      ))}
    </ul>
  );
}

/** A group of related inputs under a visible name (a fieldset, so a screen reader announces the group). */
export function Fields({ legend, note, children, wide }: { legend: ReactNode; note?: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <fieldset className="pl-group">
      <legend>{legend}</legend>
      {note && <p className="an-note pl-group-note">{note}</p>}
      <div className={wide ? 'an-form an-form--wide' : 'an-form'}>{children}</div>
    </fieldset>
  );
}

/** A label and an amount per line (the two-column tables the pages used to draw). Pass `strong` for a total line. */
export function Lines({ rows, label }: { rows: { label: ReactNode; value: ReactNode; strong?: boolean; muted?: boolean }[]; label?: string }) {
  return (
    <dl className="pl-lines" aria-label={label}>
      {rows.map((r, i) => (
        <div key={i} className={`pl-line${r.strong ? ' pl-line--strong' : ''}${r.muted ? ' pl-line--muted' : ''}`}>
          <dt>{r.label}</dt>
          <dd>{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}
