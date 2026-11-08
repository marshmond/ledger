import type { ModuleDef } from '../../core/registry';
import { GROUPS } from '../../shell/nav';
import LedgerModule, { LEDGER_BASE, LEDGER_ROUTES } from './LedgerModule';
import { ledgerDueProvider } from './dueProvider';
import { ledgerRecords } from './records';
import { ledgerSearchSource } from './searchSource';
import { ledgerTxnReferences } from './txnReferences';
import { LEDGER_QUICK_ADDS } from './quickAddDef';
import ScheduledFromEvent from './ScheduledFromEvent';
import { LEDGER_TODAY_CARDS } from './todayCards';

/** Ledger, module #1: personal finance. Its pages, sidebar and calculations are unchanged; this only registers them. */
export const ledgerModule: ModuleDef = {
  id: LEDGER_BASE.slice(1),
  name: 'Ledger',
  icon: <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="18" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /></svg>,
  Component: LedgerModule,
  hasTabBar: true,
  routePaths: LEDGER_ROUTES.map(([p]) => p),
  nav: GROUPS.map((g) => ({ id: g.id, label: g.label, to: g.to, items: g.items })),
  // What Ledger offers the other modules: dated things for the Calendar (read-only, computed), and records others can link to.
  // Also: a Calendar event of type Bill can be turned into a Ledger scheduled item (the Calendar draws Ledger's own form).
  contributes: {
    dueProvider: ledgerDueProvider,
    records: ledgerRecords,
    createFromEvent: { types: ['bill'], label: 'Create scheduled item in Ledger', ownerName: 'Ledger', Form: ScheduledFromEvent },
    // Today: Ledger's alerts (the same ones as Ledger Home, with dismiss and snooze) and the low point of the cash forecast.
    todayCards: LEDGER_TODAY_CARDS,
    // Global search: Ledger's pages, accounts, holdings, loans, scenarios, scheduled items and transactions.
    searchSource: ledgerSearchSource,
    // Global Add box: a transaction (Ledger's quick form) and a scheduled payment (opens Ledger's Scheduled screen).
    quickAdd: LEDGER_QUICK_ADDS,
    // Which scheduled payments remember posting a transaction (read-only; asked before a transaction is deleted).
    txnReferences: ledgerTxnReferences,
  },
};
