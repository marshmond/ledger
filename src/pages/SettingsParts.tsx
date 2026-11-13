import { useContext, type ReactNode } from 'react';
import { PageHeadingLevel } from '../ui/components';
import './analysis.css';
import './settings.css';

/**
 * D19: small presentational pieces shared by the Settings pages (General, Appearance, Data & Backups, Sync devices, Calendar) and the Sync page's second address.
 * They draw what a page hands them. Nothing here reads data, stores anything or decides what an action does.
 */

export type PillTone = 'ok' | 'warn' | 'bad' | 'info' | 'quiet';

/** A short status word in a small tag. The word carries the meaning; the color only helps. */
export function Pill({ tone = 'quiet', children }: { tone?: PillTone; children: ReactNode }) {
  return <span className={`se-pill se-pill--${tone}`}>{children}</span>;
}

/**
 * A titled card. The heading follows the page: a page that sits inside another titled page (Settings) has an h2 title, so its sections are h3;
 * a page on its own (Sync at its Ledger address) has an h1 title, so its sections are h2.
 * `tone="danger"` is for the zone where something is replaced or switched off: it gets a labelled edge, never a bigger button.
 */
export function SettingsSection({ id, titleId, title, badge, intro, tone = 'default', children, className = '' }: {
  id?: string; /** Overrides the heading's id (the section is labelled by it). */ titleId?: string; title: ReactNode; badge?: ReactNode; intro?: ReactNode; tone?: 'default' | 'warn' | 'danger'; children: ReactNode; className?: string;
}) {
  const level = useContext(PageHeadingLevel);
  const Title = level === 2 ? 'h3' : 'h2';
  return (
    <section className={`an-card se-section se-section--${tone} ${className}`} aria-labelledby={titleId ?? (id ? `${id}-h` : undefined)} id={id}>
      <div className="an-head">
        <Title className="an-h2" id={titleId ?? (id ? `${id}-h` : undefined)}>{title}</Title>
        {badge}
      </div>
      {intro && <p className="an-note se-intro">{intro}</p>}
      {children}
    </section>
  );
}

/** A small heading inside a section (one level under the section's heading). */
export function SubHeading({ children }: { children: ReactNode }) {
  const level = useContext(PageHeadingLevel);
  const H = level === 2 ? 'h4' : 'h3';
  return <H className="se-sub">{children}</H>;
}
