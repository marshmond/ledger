import Main from './Main';
import { useEffect, type ReactNode } from 'react';
import { matchPath } from 'react-router-dom';
import { Link, NavLink, useLocation } from '../core/router';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { dueInstances } from '../lib/schedule';
import { useToday } from '../ui/useToday';
import { loadNetWorth } from '../lib/netWorthLive';
import { saveMonthlySnapshot } from '../lib/snapshots';
import { GROUPS, crumbsFor, groupForPath } from './nav';
import LedgerNav, { ICONS } from './LedgerNav';
import { activePageFor } from './ledgerNavModel';
import { ToastProvider } from '../ui/Toast';
import { useEdgeFade } from '../ui/components';
import BackupReminder from './BackupReminder';

/**
 * The frame around every page. Desktop (900 px and wider, D8): a bar of the five groups under the global header (LedgerNav), then the page's
 * top bar with its breadcrumbs. Phone: the section's pages as a scrolling row, and a bottom tab bar for the five groups (unchanged by D8).
 * Search and quick add are reachable from everywhere (the global header).
 */
export default function Shell({ children }: { children: ReactNode }) {
  const loc = useLocation();
  const group = groupForPath(loc.pathname);
  const accountMatch = matchPath('/account/:id', loc.pathname);
  const accountId = accountMatch?.params.id ? Number(accountMatch.params.id) : null;
  const account = useLiveQuery(() => (accountId ? db.accounts.get(accountId) : undefined), [accountId]);
  const today = useToday();
  const dueCount = useLiveQuery(async () => (await dueInstances(db, today, 7)).length, [today]) ?? 0;
  const nw = useLiveQuery(() => loadNetWorth(db, today), [today]);

  // Net worth history: this month's point follows the latest figures (saved shortly after they settle).
  useEffect(() => {
    if (!nw) return;
    const t = setTimeout(() => { saveMonthlySnapshot(db, today, nw).catch(() => undefined); }, 2500);
    return () => clearTimeout(t);
  }, [nw?.total, nw?.cash, nw?.investments, nw?.property, nw?.cards, nw?.loans]); // eslint-disable-line react-hooks/exhaustive-deps
  const crumbs = crumbsFor(loc.pathname, account?.name);
  const fade = useEdgeFade<HTMLElement>();

  // Search and quick add are app-wide (GlobalFrame and the module bar); Ctrl/Cmd+K and "/" are handled there.

  // An account's ledger page lights up Accounts (the same rule the desktop bar uses, from the navigation model).
  const inLedger = (to: string) => activePageFor(loc.pathname) === to;
  const badge = (to: string) => (to === '/scheduled' && dueCount > 0 ? <span className="count" aria-label={`${dueCount} due`}>{dueCount}</span> : null);

  return (
    <ToastProvider>
    <div className="shell">
      <LedgerNav pathname={loc.pathname} dueCount={dueCount} />

      <div className="shell-main">
        <header className={crumbs.length === 0 ? 'topbar topbar-home' : 'topbar'}>
          <nav className="crumbs" aria-label="Breadcrumb">
            {crumbs.length === 0 ? <span>Home</span> : crumbs.map((c, i) => (
              <span key={i}>{i > 0 && <span className="sep"> › </span>}{c.to && i < crumbs.length - 1 ? <Link to={c.to}>{c.label}</Link> : <span aria-current={i === crumbs.length - 1 ? 'page' : undefined}>{c.label}</span>}</span>
            ))}
          </nav>
          <strong className="topbar-title">{group.id === 'home' ? 'Home' : group.label}</strong>
        </header>
        {group.items.length > 1 && (
          <div className={`sectiontabs-wrap ${fade.className}`}>
          <nav className="sectiontabs" aria-label={`${group.label} pages`} ref={fade.ref}>
            {group.items.map((i) => <NavLink key={i.to} to={i.to} end className={({ isActive }) => (isActive || inLedger(i.to) ? 'active' : '')}>{i.label}{badge(i.to)}</NavLink>)}
          </nav>
          </div>
        )}
        <BackupReminder />
        <Main className="main">{children}</Main>
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
    </div>
    </ToastProvider>
  );
}
