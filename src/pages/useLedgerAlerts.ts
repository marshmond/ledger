import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { useSharedLive } from '../core/sharedLive';
import { monthOf } from '../lib/dates';
import { loadBudget } from '../lib/budget';
import { dueInstances } from '../lib/schedule';
import { computeAlerts, forecastLowForAlert } from '../lib/alerts';
import { belowMinimum } from '../lib/minBalance';
import { buildIncomeModel } from '../lib/income';
import { hsaYearImpact } from '../lib/hsa';
import { netForTax, realizedFor } from '../lib/lots';
import { estimatedDueDates } from '../lib/taxPlan';
import { valueAgeDays } from '../lib/property';
import { loadForecast } from '../lib/forecastLive';
import { useTaxPlanData } from './useTaxPlanData';
import { useCheckin } from './useCheckin';

/**
 * Ledger's "needs attention" alerts for `today`, with everything that feeds them. Home and the Today screen both call this, so the
 * two always agree. (It was lifted out of HomePage unchanged apart from the minimum-balance alerts; Home still draws its own list.)
 * It also hands back the data Home draws other cards from, so Home does not read the same tables twice.
 */
export function useLedgerAlerts(today: string) {
  const month = monthOf(today);
  const year = Number(today.slice(0, 4));
  const accounts = useLiveQuery(() => db.accounts.toArray(), []) ?? [];
  const txns = useLiveQuery(() => db.txns.toArray(), []) ?? [];
  const invAccounts = useLiveQuery(() => db.invAccounts.toArray(), []) ?? [];
  const holdings = useLiveQuery(() => db.holdings.toArray(), []) ?? [];
  const securities = useLiveQuery(() => db.securities.toArray(), []) ?? [];
  const loans = useLiveQuery(() => db.loans.toArray(), []) ?? [];
  const props = useLiveQuery(() => db.properties.toArray(), []) ?? [];
  const propValues = useLiveQuery(() => db.propertyValues.toArray(), []) ?? [];
  const lots = useLiveQuery(() => db.taxLots.toArray(), []) ?? [];
  const vests = useLiveQuery(() => db.rsuVests.toArray(), []) ?? [];
  const people = useLiveQuery(() => db.people.toArray(), []) ?? [];
  const profiles = useLiveQuery(() => db.incomeProfiles.toArray(), []) ?? [];
  const bonuses = useLiveQuery(() => db.bonuses.toArray(), []) ?? [];
  const taxSettings = useLiveQuery(() => db.taxSettings.toArray(), []) ?? [];
  const sales = useLiveQuery(() => db.sales.toArray(), []) ?? [];
  const hsaWithdrawals = useLiveQuery(() => db.hsaWithdrawals.toArray(), []) ?? [];
  const lastBackup = (useLiveQuery(() => db.settings.get('lastBackup'), []) as { value?: string } | undefined)?.value;
  const due = useLiveQuery(() => dueInstances(db, today, 7), [today]) ?? [];
  const budget = useLiveQuery(() => loadBudget(db, month), [month]);
  // Shared with Today's cash-outlook card, so the forecast is worked out once per screen.
  const forecast = useSharedLive(`ledger.forecast:${today}`, () => loadForecast(db, today));
  const checkin = useCheckin();
  const plan = useTaxPlanData(year);

  const gains = useMemo(() => netForTax(realizedFor(sales, year)), [sales, year]);
  const hsa = useMemo(() => hsaYearImpact(hsaWithdrawals, invAccounts, people, year), [hsaWithdrawals, invAccounts, people, year]);
  const income = useMemo(
    () => buildIncomeModel(year, people, profiles, bonuses, taxSettings.find((t) => t.year === year), { vests, securities }, { taxableCents: hsa.taxableCents, penaltyCents: hsa.penaltyCents }, gains),
    [year, people, profiles, bonuses, taxSettings, vests, securities, hsa, gains],
  );

  const nextEstimated = estimatedDueDates(year).find((d) => d >= today) ?? null;
  const overspent = (budget?.rows ?? []).filter((r) => r.kind === 'category' && r.available < 0).map((r) => r.name);
  const hasData = accounts.length > 0 || invAccounts.length > 0 || loans.length > 0 || people.length > 0 || props.length > 0;
  const cashIds = new Set(accounts.filter((a) => !a.closed && (a.kind === 'checking' || a.kind === 'savings')).map((a) => a.id!));
  const alerts = computeAlerts({
    today, hasData, lastBackup, scheduledDue: due.length, overspent, invAccounts, holdings, securities, lots, vests, people,
    federalBalanceCents: income.household?.federal.balance ?? null,
    propertyStale: props.filter((p) => !p.excluded && (valueAgeDays(propValues, p.id!, today) ?? 0) > 365).map((p) => p.name),
    estimatedDue: nextEstimated && plan.wp ? { date: nextEstimated, amountCents: plan.wp.estimatedPaymentCents } : null,
    harvestableCents: plan.candidates.reduce((s, c) => s + c.lossCents, 0),
    yearEndTodo: plan.checklist.filter((c) => c.status === 'todo').length,
    checkinLeft: checkin.ready && !checkin.progress.complete && Number(today.slice(8, 10)) >= 25 ? checkin.progress.left : 0,
    forecastLow: forecastLowForAlert({
      today, firstBelow: forecast?.result.firstBelow, thresholdCents: forecast?.thresholdCents ?? 0,
      cashAccounts: cashIds.size, cashTxnCount: txns.filter((t) => cashIds.has(t.accountId)).length, forecastEventCount: forecast?.result.events.length ?? 0,
    }),
    belowMinimum: belowMinimum(accounts, txns),
  });

  return { alerts, hasData, checkin, budget, accounts, txns, invAccounts, people, props, lastBackup, forecast };
}
