import type { ModuleDef } from '../../core/registry';
import { GROUPS } from '../../shell/nav';
import LedgerModule, { LEDGER_BASE, LEDGER_ROUTES } from './LedgerModule';

/** Ledger, module #1: personal finance. Its pages, sidebar and calculations are unchanged; this only registers them. */
export const ledgerModule: ModuleDef = {
  id: LEDGER_BASE.slice(1),
  name: 'Ledger',
  icon: <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="18" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /></svg>,
  Component: LedgerModule,
  routePaths: LEDGER_ROUTES.map(([p]) => p),
  nav: GROUPS.map((g) => ({ id: g.id, label: g.label, to: g.to, items: g.items })),
  // Phase 2 will fill this in (scheduled bills, RSU vests, tax dates, ...). Left empty on purpose.
  contributes: { dueItems: async () => [], tasks: async () => [] },
};
