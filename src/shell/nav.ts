/**
 * The app's map. Pages are grouped by what you are doing:
 *   Home (what needs attention), Money (day to day), Invest (what you own and owe), Plan (income, taxes, the future),
 *   More (backup, appearance). The sidebar (desktop) and bottom tabs (phone) are both drawn from this one list, and so are
 *   breadcrumbs and search. Page addresses never change, so bookmarks keep working.
 */

export type GroupId = 'home' | 'money' | 'invest' | 'plan' | 'more';

export interface NavItem {
  to: string;
  label: string;
  /** Extra words that should find this page in search. */
  keywords?: string;
}

export interface NavGroup {
  id: GroupId;
  label: string;
  /** Short symbol for the bottom tab bar. */
  icon: string;
  /** Where the group's tab opens. */
  to: string;
  items: NavItem[];
}

export const GROUPS: NavGroup[] = [
  { id: 'home', label: 'Home', icon: '⌂', to: '/', items: [{ to: '/', label: 'Home', keywords: 'today net worth alerts overview' }] },
  {
    id: 'money',
    label: 'Money',
    icon: '$',
    to: '/accounts',
    items: [
      { to: '/checkin', label: 'Check-in', keywords: 'monthly routine checklist chores month end review' },
      { to: '/accounts', label: 'Accounts', keywords: 'checking savings credit card balances ledger' },
      { to: '/transactions', label: 'Transactions', keywords: 'history spending search filter export csv' },
      { to: '/budget', label: 'Budget', keywords: 'envelope categories assign ready to assign' },
      { to: '/scheduled', label: 'Scheduled', keywords: 'recurring bills upcoming' },
      { to: '/forecast', label: 'Forecast', keywords: 'cash flow projection balance low afford bills paychecks months' },
      { to: '/reports', label: 'Reports', keywords: 'spending trends categories payees savings rate month compare sankey flow diagram where money goes income gross net' },
      { to: '/rules', label: 'Rules', keywords: 'payee auto categorize recurring detect repeating subscriptions' },
      { to: '/import', label: 'Import', keywords: 'csv bank statement upload' },
      { to: '/categories', label: 'Categories', keywords: 'groups rename' },
    ],
  },
  {
    id: 'invest',
    label: 'Invest',
    icon: '↗',
    to: '/networth',
    items: [
      { to: '/networth', label: 'Net worth', keywords: 'assets home value equity property history chart' },
      { to: '/investments', label: 'Investments', keywords: 'brokerage ira 401k hsa 529 holdings lots cost basis sell buy realized gains prices' },
      { to: '/payoff', label: 'Payoff', keywords: 'debt payoff avalanche snowball credit card refinance break-even extra payment invest' },
      { to: '/debt', label: 'Debt', keywords: 'mortgage heloc loan amortization payoff net worth' },
    ],
  },
  {
    id: 'plan',
    label: 'Plan',
    icon: '◔',
    to: '/income',
    items: [
      { to: '/income', label: 'Income', keywords: 'salary tax withholding 401k bonus rsu payroll deductions' },
      { to: '/taxplan', label: 'Tax planning', keywords: 'year end bracket room withholding estimated payments harvest loss checklist' },
      { to: '/giving', label: 'Giving', keywords: 'charity donations gifts deduction bunching donor advised fund appreciated shares' },
      { to: '/afford', label: 'Afford it', keywords: 'can i afford house car purchase mortgage down payment rent vs buy affordability' },
      { to: '/paycheck', label: 'Paycheck', keywords: 'calculator take-home scenario raise offer' },
      { to: '/projections', label: 'Projections', keywords: 'growth monte carlo future' },
      { to: '/retirement', label: 'Retirement', keywords: 'withdrawal spending last windfall' },
      { to: '/goals', label: 'Goals', keywords: 'college 529 savings' },
      { to: '/protection', label: 'Protection', keywords: 'insurance life disability umbrella emergency fund runway coverage gap' },
      { to: '/roth', label: 'Roth', keywords: 'conversion rmd irmaa aca bracket' },
    ],
  },
  {
    id: 'more',
    label: 'More',
    icon: '⋯',
    to: '/more',
    items: [
      { to: '/more', label: 'Settings', keywords: 'more appearance theme dark about shortcuts' },
      { to: '/review', label: 'Year in review', keywords: 'annual summary highlights net worth savings rate taxes year' },
      { to: '/guide', label: 'If something happens', keywords: 'emergency guide spouse family contacts documents will beneficiaries where things are' },
      { to: '/taxpackage', label: 'Tax package', keywords: 'cpa accountant preparer 1099 w-2 8949 export pdf csv tax time' },
      { to: '/sync', label: 'Sync devices', keywords: 'phone computer desktop mobile github keep in step two devices same data' },
      { to: '/backup', label: 'Backup', keywords: 'export restore encrypted data' },
    ],
  },
];

export const ALL_ITEMS: (NavItem & { group: GroupId })[] = GROUPS.flatMap((g) => g.items.map((i) => ({ ...i, group: g.id })));

/** The group a path belongs to. An account's ledger page belongs to Money. */
export function groupForPath(pathname: string): NavGroup {
  const p = pathname.replace(/\/+$/, '') || '/';
  if (p.startsWith('/account/')) return GROUPS.find((g) => g.id === 'money')!;
  const hit = ALL_ITEMS.find((i) => i.to === p);
  return GROUPS.find((g) => g.id === (hit?.group ?? 'home'))!;
}

export interface Crumb {
  label: string;
  to?: string;
}

/** Breadcrumbs for a path. `detail` names a deeper page (e.g. an account) when there is one. Home has none. */
export function crumbsFor(pathname: string, detail?: string): Crumb[] {
  const p = pathname.replace(/\/+$/, '') || '/';
  if (p === '/') return [];
  const group = groupForPath(p);
  const out: Crumb[] = [{ label: group.label, to: group.to }];
  if (p.startsWith('/account/')) {
    out.push({ label: 'Accounts', to: '/accounts' });
    out.push({ label: detail ?? 'Account' });
    return out;
  }
  const item = ALL_ITEMS.find((i) => i.to === p);
  if (item && item.label !== group.label) out.push({ label: item.label });
  return out;
}
