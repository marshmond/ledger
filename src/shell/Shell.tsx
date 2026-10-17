import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation, useMatch } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { dueInstances } from '../lib/schedule';
import { todayISO } from '../lib/money';
import { loadNetWorth } from '../lib/netWorthLive';
import { saveMonthlySnapshot } from '../lib/snapshots';
import ThemeToggle from '../pages/ThemeToggle';
import { GROUPS, crumbsFor, groupForPath } from './nav';
import QuickAdd from './QuickAdd';
import SearchDialog from './SearchDialog';

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

  // Net worth history: this month's point follows the latest figures (saved shortly after they settle).
  useEffect(() => {
    if (!nw) return;
    const t = setTimeout(() => { saveMonthlySnapshot(db, todayISO(), nw).catch(() => undefined); }, 2500);
    return () => clearTimeout(t);
  }, [nw?.total, nw?.cash, nw?.investments, nw?.property, nw?.cards, nw?.loans]); // eslint-disable-line react-hooks/exhaustive-deps
  const crumbs = crumbsFor(loc.pathname, account?.name);

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

  // An account's ledger page lights up Accounts.
  const inLedger = (to: string) => to === '/accounts' && loc.pathname.startsWith('/account/');
  const badge = (to: string) => (to === '/scheduled' && dueCount > 0 ? <span className="count">{dueCount}</span> : null);

  return (
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
                <div className="side-head">{g.label}</div>
                {g.items.filter((i) => !(g.id === 'more' && i.to === '/more')).map((i) => (
                  <NavLink key={i.to} to={i.to} className={({ isActive }) => `side-link ${isActive || inLedger(i.to) ? 'active' : ''}`} end>{i.label}{badge(i.to)}</NavLink>
                ))}
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
          <button className="searchbtn" onClick={() => setSearchOpen(true)} aria-label="Search"><span aria-hidden="true">⌕</span><span className="searchbtn-text"> Search</span></button>
        </header>
        {group.items.length > 1 && (
          <nav className="sectiontabs" aria-label={`${group.label} pages`}>
            {group.items.map((i) => <NavLink key={i.to} to={i.to} end className={({ isActive }) => (isActive || inLedger(i.to) ? 'active' : '')}>{i.label}{badge(i.to)}</NavLink>)}
          </nav>
        )}
        <main className="main">{children}</main>
      </div>

      <nav className="tabbar" aria-label="Sections">
        {GROUPS.map((g) => (
          <NavLink key={g.id} to={g.to} end={g.id === 'home'} className={g.id === group.id ? 'active' : ''}>
            <span className="tab-icon" aria-hidden="true">{g.icon}</span>
            <span>{g.label}</span>
            {g.id === 'money' && dueCount > 0 && <span className="count tabcount">{dueCount}</span>}
          </NavLink>
        ))}
      </nav>

      <QuickAdd />
      {searchOpen && <SearchDialog onClose={() => setSearchOpen(false)} />}
    </div>
  );
}
