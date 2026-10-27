import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation, useMatch } from 'react-router-dom';
import { loadOpenGroup, saveOpenGroup, toggleGroup } from './sideState';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { dueInstances } from '../lib/schedule';
import { todayISO } from '../lib/money';
import { loadNetWorth } from '../lib/netWorthLive';
import { saveMonthlySnapshot } from '../lib/snapshots';
import ThemeToggle from '../pages/ThemeToggle';
import { GROUPS, crumbsFor, groupForPath, type GroupId } from './nav';
import { ToastProvider } from '../ui/Toast';
import { useEdgeFade } from '../ui/components';
import QuickAdd from './QuickAdd';
import SearchDialog from './SearchDialog';

/** Simple line icons for the bottom tab bar, one per group. */
const ICONS: Record<GroupId, ReactNode> = {
  home: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11.5 12 4l9 7.5" /><path d="M5.5 10v9.5h13V10" /></svg>,
  money: <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="18" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /></svg>,
  invest: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 16 5-5 4 4 7-8" /><path d="M15 7h5v5" /></svg>,
  plan: <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M4 10h16M9 3v4M15 3v4" /></svg>,
  more: <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.2" /><circle cx="12" cy="12" r="1.2" /><circle cx="19" cy="12" r="1.2" /></svg>,
};

/**
 * The frame around every page. Desktop: a left sidebar with the five groups and their pages. Phone: a top bar with the section's
 * pages as a scrolling row, and a bottom tab bar for the five groups. Search and quick add are reachable from everywhere.
 */
export default function Shell({ children }: { children: ReactNode }) {
  const loc = useLocation();
  const group = groupForPath(loc.pathname);
  const accountMatch = useMatch('/account/:id');
  const accountId = accountMatch?.params.id ? Number(accountMatch.params.id) : null;
  const account = useLiveQuery(() => (accountId ? db.accounts.get(accountId) : undefined), [accountId]);
  const dueCount = useLiveQuery(async () => (await dueInstances(db, todayISO(), 7)).length, []) ?? 0;
  const nw = useLiveQuery(() => loadNetWorth(db, todayISO()), []);
  const [searchOpen, setSearchOpen] = useState(false);
  const [open, setOpen] = useState<string | null>(() => loadOpenGroup());
  const toggle = (id: string) => setOpen((cur) => { const next = toggleGroup(cur, id); saveOpenGroup(next); return next; });

  // Net worth history: this month's point follows the latest figures (saved shortly after they settle).
  useEffect(() => {
    if (!nw) return;
    const t = setTimeout(() => { saveMonthlySnapshot(db, todayISO(), nw).catch(() => undefined); }, 2500);
    return () => clearTimeout(t);
  }, [nw?.total, nw?.cash, nw?.investments, nw?.property, nw?.cards, nw?.loans]); // eslint-disable-line react-hooks/exhaustive-deps
  const crumbs = crumbsFor(loc.pathname, account?.name);
  const fade = useEdgeFade<HTMLElement>();

  // Ctrl/Cmd+K, or "/" when not typing, opens search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement)?.tagName ?? '') || (e.target as HTMLElement)?.isContentEditable;
      if ((e.key === 'k' || e.key === 'K') && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setSearchOpen(true);
      } else if (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => setSearchOpen(false), [loc.pathname]);
  // Landing on a page opens its group in the sidebar, so you can always see its neighbours.
  useEffect(() => { if (group.id !== 'home') setOpen((cur) => { if (cur === group.id) return cur; saveOpenGroup(group.id); return group.id; }); }, [group.id]);

  // An account's ledger page lights up Accounts.
  const inLedger = (to: string) => to === '/accounts' && loc.pathname.startsWith('/account/');
  const badge = (to: string) => (to === '/scheduled' && dueCount > 0 ? <span className="count" aria-label={`${dueCount} due`}>{dueCount}</span> : null);

  return (
    <ToastProvider>
    <div className="shell">
      <aside className="sidebar" aria-label="Main">
        <Link to="/" className="brand-link"><strong className="brand">Ledger</strong></Link>
        <button className="searchbtn side" onClick={() => setSearchOpen(true)} aria-label="Search">
          <span aria-hidden="true">⌕</span> Search <kbd>Ctrl K</kbd>
        </button>
        {GROUPS.map((g) => (
          <div className="side-group" key={g.id}>
            {g.id === 'home' ? (
              <NavLink to="/" end className="side-link top">⌂ Home</NavLink>
            ) : (
              <>
                <button
                  className={`side-head ${open === g.id ? '' : 'closed'} ${group.id === g.id ? 'has-active' : ''}`}
                  aria-expanded={open === g.id}
                  aria-controls={`side-${g.id}`}
                  onClick={() => toggle(g.id)}
                >
                  <span>{g.label}</span>
                  <span className="chev" aria-hidden="true">▾</span>
                </button>
                {open === g.id && (
                  <div className="side-items" id={`side-${g.id}`}>
                    {g.items.filter((i) => !(g.id === 'more' && i.to === '/more')).map((i) => (
                      <NavLink key={i.to} to={i.to} className={({ isActive }) => `side-link ${isActive || inLedger(i.to) ? 'active' : ''}`} end>{i.label}{badge(i.to)}</NavLink>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        ))}
        <div className="side-foot">
          <NavLink to="/more" className="side-link">Settings &amp; about</NavLink>
          <ThemeToggle />
        </div>
      </aside>

      <div className="shell-main">
        <header className="topbar">
          <nav className="crumbs" aria-label="Breadcrumb">
            {crumbs.length === 0 ? <span>Home</span> : crumbs.map((c, i) => (
              <span key={i}>{i > 0 && <span className="sep"> › </span>}{c.to && i < crumbs.length - 1 ? <Link to={c.to}>{c.label}</Link> : <span aria-current={i === crumbs.length - 1 ? 'page' : undefined}>{c.label}</span>}</span>
            ))}
          </nav>
          <strong className="topbar-title">{group.id === 'home' ? 'Ledger' : group.label}</strong>
          <button className="searchbtn top" onClick={() => setSearchOpen(true)} aria-label="Search"><span aria-hidden="true">⌕</span></button>
          <QuickAdd />
        </header>
        {group.items.length > 1 && (
          <div className={`sectiontabs-wrap ${fade.className}`}>
          <nav className="sectiontabs" aria-label={`${group.label} pages`} ref={fade.ref}>
            {group.items.map((i) => <NavLink key={i.to} to={i.to} end className={({ isActive }) => (isActive || inLedger(i.to) ? 'active' : '')}>{i.label}{badge(i.to)}</NavLink>)}
          </nav>
          </div>
        )}
        <main className="main">{children}</main>
      </div>

      <nav className="tabbar" aria-label="Sections">
        {GROUPS.map((g) => (
          <NavLink key={g.id} to={g.to} end={g.id === 'home'} className={g.id === group.id ? 'active' : ''}>
            {ICONS[g.id]}
            <span>{g.label}</span>
            {g.id === 'money' && dueCount > 0 && <span className="count tabcount">{dueCount}</span>}
          </NavLink>
        ))}
      </nav>

      {searchOpen && <SearchDialog onClose={() => setSearchOpen(false)} />}
    </div>
    </ToastProvider>
  );
}
