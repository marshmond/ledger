/**
 * Every Ledger page address, written without the `/ledger` prefix, in the same order as `LEDGER_ROUTES` in LedgerModule.tsx (a test pins
 * that the two lists agree). It lives here, away from the page components, because the module registry needs only the addresses (to send
 * an old bookmark such as #/budget to the right module) and must not pull every Ledger page into the first download.
 */
export const LEDGER_ROUTE_PATHS: readonly string[] = [
  '/', '/checkin', '/sync', '/accounts', '/account/:id', '/transactions', '/budget', '/income', '/taxplan', '/afford', '/giving',
  '/paycheck', '/networth', '/investments', '/projections', '/retirement', '/goals', '/protection', '/roth', '/payoff', '/debt',
  '/scheduled', '/forecast', '/reports', '/rules', '/import', '/categories', '/backup', '/more', '/review', '/guide', '/taxpackage',
];
