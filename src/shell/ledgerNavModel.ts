/**
 * D8: the desktop financial navigation as a small PURE model. It adds no pages and no addresses of its own: every section, label and address
 * is read from GROUPS in nav.ts (the one list that also feeds the phone tab bar, the phone section tabs, breadcrumbs and search), so the
 * 31 pages cannot drift apart between the desktop bar and the phone.
 *
 * A section (Money, Invest, Plan, More) is a LINK to its default page (`to`, from nav.ts) plus, separately, a disclosure that lists the
 * section's pages. Home has no disclosure. Which section and page are current is decided here, once, from the same rule the router uses
 * (a path is a page when it equals the page's address, ignoring a trailing slash); an individual account (/account/:id) is Money > Accounts.
 */
import { GROUPS, groupForPath, type GroupId } from './nav';

/** Words shown in the desktop menus where they differ from the page's name in nav.ts (the phone and search keep the nav.ts name). */
export const MENU_LABEL: Readonly<Record<string, string>> = { '/more': 'Settings & about' };

export interface LedgerNavItem {
  to: string;
  label: string;
  /** `page` = exactly this page; `true` = a page inside it (an account under Accounts); undefined = not current. */
  current: 'page' | 'true' | undefined;
  /** Pending payments due in the next 7 days, on Scheduled only; 0 = no badge. The number is passed in, never computed here. */
  badge: number;
}

export interface LedgerNavSection {
  id: GroupId;
  label: string;
  /** Where the section's own link goes (its default page). */
  to: string;
  /** True when the section is the one the current page belongs to. */
  active: boolean;
  /** `page` when the section's own link IS the current page; `true` when the current page is elsewhere in the section. */
  current: 'page' | 'true' | undefined;
  /** Home is a plain link; the others also carry a disclosure listing their pages. */
  hasMenu: boolean;
  items: LedgerNavItem[];
  /** Menu columns: 2 for the two long sections (Money, Plan), else 1. */
  columns: 1 | 2;
  /** Due-count on the section itself (Money), 0 = none. */
  badge: number;
}

export const normalizePath = (pathname: string): string => pathname.replace(/\/+$/, '') || '/';

/** The page a path lights up in the menus: its own address, or Accounts for an individual account. Null for an address that is not a page. */
export function activePageFor(pathname: string): string | null {
  const p = normalizePath(pathname);
  if (p.startsWith('/account/')) return '/accounts';
  return GROUPS.some((g) => g.items.some((i) => i.to === p)) ? p : null;
}

export function currentKind(pathname: string, to: string): 'page' | 'true' | undefined {
  const p = normalizePath(pathname);
  if (p === to) return 'page';
  return activePageFor(p) === to ? 'true' : undefined;
}

export function ledgerNavSections(pathname: string, dueCount: number): LedgerNavSection[] {
  const here = groupForPath(pathname);
  const due = dueCount > 0 ? dueCount : 0;
  return GROUPS.map((g) => {
    const hasMenu = g.items.length > 1;
    return {
      id: g.id,
      label: g.label,
      to: g.to,
      active: here.id === g.id,
      current: currentKind(pathname, g.to) === 'page' ? 'page' : here.id === g.id ? 'true' : undefined,
      hasMenu,
      items: g.items.map((i) => ({ to: i.to, label: MENU_LABEL[i.to] ?? i.label, current: currentKind(pathname, i.to), badge: i.to === '/scheduled' ? due : 0 })),
      columns: g.items.length > 6 ? 2 : 1,
      badge: g.id === 'money' ? due : 0,
    };
  });
}
