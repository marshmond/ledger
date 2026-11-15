import { createContext, useContext, type ReactNode } from 'react';
import { useLedgerAlerts } from '../../pages/useLedgerAlerts';

/** What `useLedgerAlerts` hands back (the alerts and everything that feeds them). */
export type LedgerAlertsValue = ReturnType<typeof useLedgerAlerts>;
const Ctx = createContext<LedgerAlertsValue | null>(null);

/**
 * R1.1: ONE copy of Ledger's alert hook (about 25 live queries and the tax and check-in calculations behind them) per Today screen, shared by the "Needs attention"
 * card and by "Needs you". Without this the second copy doubled the main-thread work, which is most of the cost on a slow phone (see the R1.1 report).
 *
 * Today wraps its columns in this through the registry (`contributes.attention.Provider`), so Today never imports Ledger. The wrapped content is the SAME element on
 * every render, so React skips it when only the alerts change; only the two readers below re-render. The shared copy is the read-only form (it does not remember a
 * finished check-in month, so Today never writes); Ledger Home and the Check-in page still do.
 */
export function LedgerAlertsProvider({ today, children }: { today: string; children: ReactNode }) {
  const value = useLedgerAlerts(today, { readOnly: true });
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** The shared copy, or null outside a provider (then the reader falls back to what it did before). */
export const useSharedLedgerAlerts = (): LedgerAlertsValue | null => useContext(Ctx);
