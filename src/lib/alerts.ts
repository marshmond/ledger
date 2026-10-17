import type { Holding, InvAccount, Person, RsuVest, Security, TaxLot } from '../types';
import { daysBetween, formatCents } from './money';

/** Things that need attention, gathered from across the app. Pure: the Home screen supplies the data. */

export interface Alert {
  id: string;
  level: 'warn' | 'info';
  title: string;
  detail: string;
  /** Where to go to deal with it. */
  to: string;
  actionLabel: string;
}

export interface AlertInput {
  today: string;
  /** Anything entered yet? (Avoids nagging an empty app.) */
  hasData: boolean;
  lastBackup?: string;
  backupStaleDays?: number;
  scheduledDue: number;
  overspent: string[];
  invAccounts: InvAccount[];
  holdings: Holding[];
  securities: Security[];
  lots: TaxLot[];
  vests: RsuVest[];
  people: Person[];
  /** Federal refund (+) or amount due (-) this year, if the income model can compute it. */
  federalBalanceCents?: number | null;
  priceStaleDays?: number;
  /** Names of properties whose value has not been updated in over a year. */
  propertyStale?: string[];
  /** The next estimated-tax due date and the federal shortfall, when you are on track to owe. */
  estimatedDue?: { date: string; amountCents: number } | null;
  /** Losses sitting in taxable lots that could be harvested. */
  harvestableCents?: number;
  /** The lowest point of the cash forecast, when it falls below your warning level in the next 90 days. */
  forecastLow?: { date: string; balanceCents: number; thresholdCents: number } | null;
  /** Year-end checklist items that still need action. */
  yearEndTodo?: number;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const list = (xs: string[], max = 3) => (xs.length <= max ? xs.join(', ') : `${xs.slice(0, max).join(', ')} and ${xs.length - max} more`);

export function computeAlerts(i: AlertInput): Alert[] {
  const out: Alert[] = [];
  const stale = i.backupStaleDays ?? 30;
  const priceStale = i.priceStaleDays ?? 10;

  if (i.hasData) {
    const age = i.lastBackup ? Math.floor((Date.parse(i.today) - Date.parse(i.lastBackup)) / 86400000) : null;
    if (age === null) {
      out.push({ id: 'backup', level: 'warn', title: 'No backup yet', detail: 'Your data lives only in this browser. Export an encrypted backup so you can restore it if the browser data is cleared.', to: '/backup', actionLabel: 'Back up now' });
    } else if (age > stale) {
      out.push({ id: 'backup', level: 'warn', title: `Last backup was ${age} days ago`, detail: 'Export a fresh encrypted backup.', to: '/backup', actionLabel: 'Back up now' });
    }
  }

  if (i.overspent.length > 0) {
    out.push({ id: 'overspent', level: 'warn', title: `Over budget: ${list(i.overspent)}`, detail: 'Move money from another category or adjust the budget.', to: '/budget', actionLabel: 'Open budget' });
  }

  if (i.federalBalanceCents != null && i.federalBalanceCents < -100000) {
    out.push({
      id: 'owe',
      level: 'warn',
      title: `On track to owe about ${formatCents(-i.federalBalanceCents)} in federal tax`,
      detail: 'Withholding is below the estimated tax for the year. Adjust withholding or plan a payment.',
      to: '/income',
      actionLabel: 'See the estimate',
    });
  }

  if (i.forecastLow) {
    out.push({ id: 'forecast', level: 'warn', title: `Cash may drop to ${formatCents(i.forecastLow.balanceCents)} on ${i.forecastLow.date}`, detail: `That is below your ${formatCents(i.forecastLow.thresholdCents)} warning level.`, to: '/forecast', actionLabel: 'See the forecast' });
  }

  if (i.scheduledDue > 0) {
    out.push({ id: 'scheduled', level: 'info', title: `${plural(i.scheduledDue, 'scheduled item')} due`, detail: 'Approve or skip them to keep your ledger current.', to: '/scheduled', actionLabel: 'Review' });
  }

  const retire = i.invAccounts.filter((a) => !a.closed && (a.kind === 'ira' || a.kind === '401k' || a.kind === 'hsa') && a.personId == null);
  if (retire.length > 0 && i.people.length > 0) {
    out.push({
      id: 'owners',
      level: 'warn',
      title: `${plural(retire.length, 'account')} with no owner`,
      detail: `${list(retire.map((a) => a.name))}: RMD ages and the Roth planner depend on who owns each retirement account.`,
      to: '/investments',
      actionLabel: 'Set owners',
    });
  }

  const openIds = new Set(i.invAccounts.filter((a) => !a.closed).map((a) => a.id));
  const held = new Set(i.holdings.filter((h) => openIds.has(h.accountId)).map((h) => h.securityId));
  const heldSecs = i.securities.filter((s) => held.has(s.id!));
  const unpriced = heldSecs.filter((s) => s.priceCents === null).map((s) => s.ticker);
  if (unpriced.length > 0) {
    out.push({ id: 'noprice', level: 'warn', title: `No price for ${list(unpriced)}`, detail: 'These holdings count as $0 until priced.', to: '/investments', actionLabel: 'Enter prices' });
  } else {
    const dates = heldSecs.map((s) => s.priceDate).filter((d): d is string => !!d);
    const oldest = dates.sort()[0];
    if (oldest && daysBetween(i.today, oldest) > priceStale) {
      out.push({ id: 'stale', level: 'info', title: `Prices are ${daysBetween(i.today, oldest)} days old`, detail: 'Refresh or enter current prices so balances and net worth are right.', to: '/investments', actionLabel: 'Update prices' });
    }
  }

  const bad = i.lots.filter((l) => l.costBasisCents === 0 || !l.acquiredDate).length;
  if (bad > 0) {
    out.push({ id: 'lots', level: 'info', title: `${plural(bad, 'tax lot')} missing a cost or date`, detail: 'Gains on a sale are wrong until each lot has its cost and purchase date.', to: '/investments', actionLabel: 'Fix lots' });
  }

  const soon = i.vests.filter((v) => v.date >= i.today && daysBetween(v.date, i.today) <= 30).sort((a, b) => a.date.localeCompare(b.date));
  if (soon.length > 0) {
    out.push({ id: 'vest', level: 'info', title: `${plural(soon.length, 'RSU vest')} in the next 30 days`, detail: `Next: ${soon[0].date}${soon[0].grant ? ` (${soon[0].grant})` : ''}. It counts as wages and may change your tax picture.`, to: '/income', actionLabel: 'See vests' });
  }

  if (i.estimatedDue && i.estimatedDue.amountCents > 0 && daysBetween(i.estimatedDue.date, i.today) >= 0 && daysBetween(i.estimatedDue.date, i.today) <= 30) {
    out.push({ id: 'estimated', level: 'warn', title: `Estimated tax payment due ${i.estimatedDue.date}`, detail: `You are on track to owe about ${formatCents(i.estimatedDue.amountCents)} beyond withholding.`, to: '/taxplan', actionLabel: 'See options' });
  }

  const daysLeft = daysBetween(`${i.today.slice(0, 4)}-12-31`, i.today);
  if (i.yearEndTodo && i.yearEndTodo > 0 && daysLeft <= 75) {
    out.push({ id: 'yearend', level: 'info', title: `${plural(i.yearEndTodo, 'year-end item')} to review`, detail: `${daysLeft} days left in the year to use retirement and HSA room, take required distributions, and plan conversions.`, to: '/taxplan', actionLabel: 'Open the checklist' });
  }

  if ((i.harvestableCents ?? 0) >= 100000 && daysLeft <= 75) {
    out.push({ id: 'harvest', level: 'info', title: `${formatCents(i.harvestableCents!)} of losses could be harvested`, detail: 'Selling lots that are below cost can offset gains and lower this year’s tax.', to: '/taxplan', actionLabel: 'See candidates' });
  }

  if (i.propertyStale && i.propertyStale.length > 0) {
    out.push({ id: 'property', level: 'info', title: `Update the value of ${list(i.propertyStale)}`, detail: 'The last value is over a year old, so net worth may be off.', to: '/networth', actionLabel: 'Update value' });
  }

  const rank = (a: Alert) => (a.level === 'warn' ? 0 : 1);
  return out.sort((a, b) => rank(a) - rank(b));
}
