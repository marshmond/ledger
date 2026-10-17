import type { FinanceDB } from '../db';
import { summarize } from './investments';
import { balanceAt, loanView } from './loanSchedule';
import { computeNetWorth, type NetWorth } from './netWorth';
import { propertyTotal } from './property';

/** Reads everything net worth needs from the database and computes it as of `today`. */
export async function loadNetWorth(d: FinanceDB, today: string): Promise<NetWorth> {
  const [accounts, txns, invAccounts, holdings, securities, assetClasses, loans, rates, events, props, values] = await Promise.all([
    d.accounts.toArray(), d.txns.toArray(), d.invAccounts.toArray(), d.holdings.toArray(), d.securities.toArray(), d.assetClasses.toArray(),
    d.loans.toArray(), d.loanRates.toArray(), d.loanEvents.toArray(), d.properties.toArray(), d.propertyValues.toArray(),
  ]);
  const owed = loans
    .filter((l) => !l.scenario)
    .map((l) => {
      const v = loanView(l, rates.filter((r) => r.loanId === l.id), events.filter((e) => e.loanId === l.id));
      return { ledgerAccountId: l.ledgerAccountId, owedCents: v.schedule.rows.length ? balanceAt(v.schedule, today) : 0 };
    });
  const invested = summarize({ accounts: invAccounts, holdings, securities, assetClasses }).total;
  return computeNetWorth(accounts, txns, invested, owed, propertyTotal(props, values, today));
}

/** What is owed on each loan today (by loan id), for showing equity. */
export async function loanOwedById(d: FinanceDB, today: string): Promise<Map<number, number>> {
  const [loans, rates, events] = await Promise.all([d.loans.toArray(), d.loanRates.toArray(), d.loanEvents.toArray()]);
  const out = new Map<number, number>();
  for (const l of loans) {
    if (l.scenario) continue;
    const v = loanView(l, rates.filter((r) => r.loanId === l.id), events.filter((e) => e.loanId === l.id));
    out.set(l.id!, v.schedule.rows.length ? balanceAt(v.schedule, today) : 0);
  }
  return out;
}
