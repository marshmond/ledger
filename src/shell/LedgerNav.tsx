import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from '../core/router';
import { Icon } from '../ui/icons';
import ThemeToggle from '../pages/ThemeToggle';
import { type GroupId } from './nav';
import { ledgerNavSections, type LedgerNavSection } from './ledgerNavModel';

/** Simple line icons, one per group: the phone's bottom tab bar draws them, and Signature's desktop bar draws the same ones. */
export const ICONS: Record<GroupId, ReactNode> = {
  home: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11.5 12 4l9 7.5" /><path d="M5.5 10v9.5h13V10" /></svg>,
  money: <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="18" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /></svg>,
  invest: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 16 5-5 4 4 7-8" /><path d="M15 7h5v5" /></svg>,
  plan: <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M4 10h16M9 3v4M15 3v4" /></svg>,
  more: <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.2" /><circle cx="12" cy="12" r="1.2" /><circle cx="19" cy="12" r="1.2" /></svg>,
};

/** The count of payments due, with the word kept for assistive technology (the number is the visible cue, so colour is never the only one). */
const Due = ({ n }: { n: number }) => (n > 0 ? <span className="count">{n}<span className="sr-only"> due</span></span> : null);

/** One section's list of pages: plain links in one or two columns. The current page carries aria-current and a visible mark. */
export function SectionMenu({ section: s }: { section: LedgerNavSection }) {
  return (
    <div className={`lnav-menu cols-${s.columns}`} id={`lnav-menu-${s.id}`}>
      <ul>
        {s.items.map((i) => (
          <li key={i.to}>
            <Link to={i.to} className={i.current ? 'active' : undefined} aria-current={i.current}>
              <span>{i.label}</span>
              <Due n={i.badge} />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * D8: Ledger's desktop navigation, a bar directly under the global header (900 px and wider; the phone keeps its bottom tab bar and the
 * scrolling section tabs, drawn by Shell). Each section is a LINK to its default page plus a SEPARATE button that lists its pages, so
 * clicking a name always navigates and the chevron always opens the list. The list is a plain disclosure of links (no ARIA menu, no
 * dialog, no hover-only opening): Tab walks into it, Escape closes it and returns focus to its button, a click or Tab outside closes it,
 * and so does going to a page. Which section and page are current comes from the pure model in ledgerNavModel.ts.
 */
export default function LedgerNav({ pathname, dueCount }: { pathname: string; dueCount: number }) {
  const sections = useMemo(() => ledgerNavSections(pathname, dueCount), [pathname, dueCount]);
  const [open, setOpen] = useState<GroupId | null>(null);
  const navRef = useRef<HTMLElement>(null);
  const itemRefs = useRef<Partial<Record<GroupId, HTMLLIElement | null>>>({});

  // Going to a page closes the list.
  useEffect(() => { setOpen(null); }, [pathname]);

  // While a list is open: Escape closes it (and puts focus back on its button when focus was inside the bar); a press outside it closes it.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const inside = navRef.current?.contains(document.activeElement) ?? false;
      setOpen(null);
      if (inside) itemRefs.current[open]?.querySelector<HTMLButtonElement>('.lnav-tog')?.focus();
    };
    const onDown = (e: PointerEvent) => {
      if (!itemRefs.current[open]?.contains(e.target as Node)) setOpen(null);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('pointerdown', onDown); };
  }, [open]);

  return (
    <nav className="lnav" aria-label="Ledger sections" ref={navRef}>
      <div className="lnav-in">
        <ul className="lnav-list">
          {sections.map((s) => (
            <li
              key={s.id}
              className={`lnav-item ${s.active ? 'active' : ''} ${open === s.id ? 'open' : ''}`}
              ref={(el) => { itemRefs.current[s.id] = el; }}
              onBlur={(e) => { if (open === s.id && e.relatedTarget && !e.currentTarget.contains(e.relatedTarget as Node)) setOpen(null); }}
            >
              <div className="lnav-tab">
                <Link to={s.to} className="lnav-link" aria-current={s.current}>
                  <span className="lnav-ic" aria-hidden="true">{ICONS[s.id]}</span>
                  <span>{s.label}</span>
                  <Due n={s.badge} />
                </Link>
                {s.hasMenu && (
                  <button
                    type="button"
                    className="lnav-tog"
                    aria-expanded={open === s.id}
                    aria-controls={`lnav-menu-${s.id}`}
                    aria-label={`${s.label} pages`}
                    onClick={() => setOpen((cur) => (cur === s.id ? null : s.id))}
                  >
                    <Icon name="chevron-down" size={14} />
                  </button>
                )}
              </div>
              {s.hasMenu && open === s.id && <SectionMenu section={s} />}
            </li>
          ))}
        </ul>
        <div className="lnav-tools"><ThemeToggle /></div>
      </div>
    </nav>
  );
}
