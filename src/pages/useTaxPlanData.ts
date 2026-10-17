import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { formatCents, todayISO } from '../lib/money';
import { buildIncomeModel, resolveTables, type IncomeModel } from '../lib/income';
import { hsaYearImpact } from '../lib/hsa';
import { holdingValue } from '../lib/investments';
import { netForTax, realizedFor } from '../lib/lots';
import { appreciatedCandidates, bracketRoom, harvestCandidates, withholdingPlan, yearEndChecklist } from '../lib/taxPlan';
import type { TaxTables } from '../data/taxYears';

/** Everything the tax planning page and the Home alerts need for one year, computed from the database. */
export function useTaxPlanData(year: number) {
  const today = todayISO();
  const people = useLiveQuery(() => db.people.toArray(), []) ?? [];
  const profiles = useLiveQuery(() => db.incomeProfiles.toArray(), []) ?? [];
  const bonuses = useLiveQuery(() => db.bonuses.toArray(), []) ?? [];
  const allSettings = useLiveQuery(() => db.taxSettings.toArray(), []) ?? [];
  const vests = useLiveQuery(() => db.rsuVests.toArray(), []) ?? [];
  const securities = useLiveQuery(() => db.securities.toArray(), []) ?? [];
  const invAccounts = useLiveQuery(() => db.invAccounts.toArray(), []) ?? [];
  const holdings = useLiveQuery(() => db.holdings.toArray(), []) ?? [];
  const lots = useLiveQuery(() => db.taxLots.toArray(), []) ?? [];
  const sales = useLiveQuery(() => db.sales.toArray(), []) ?? [];
  const hsaW = useLiveQuery(() => db.hsaWithdrawals.toArray(), []) ?? [];

  const settings = allSettings.find((s) => s.year === year);
  const hsa = useMemo(() => hsaYearImpact(hsaW, invAccounts, people, year), [hsaW, invAccounts, people, year]);
  const realized = useMemo(() => realizedFor(sales, year), [sales, year]);
  const gains = useMemo(() => netForTax(realized), [realized]);

  const build = (y: number, g = gains): IncomeModel =>
    buildIncomeModel(y, people, profiles, bonuses, allSettings.find((s) => s.year === y), { vests, securities }, y === year ? { taxableCents: hsa.taxableCents, penaltyCents: hsa.penaltyCents } : undefined, y === year ? g : undefined);

  /* eslint-disable react-hooks/exhaustive-deps */
  const model = useMemo(() => build(year), [year, people, profiles, bonuses, allSettings, vests, securities, hsa, gains]);
  const priorModel = useMemo(() => (profiles.some((p) => p.year === year - 1) ? build(year - 1) : null), [year, people, profiles, bonuses, allSettings, vests, securities]);
  const otherHoldings = holdings.map((h) => ({ accountId: h.accountId, securityId: h.securityId }));
  const candidates = useMemo(() => harvestCandidates(lots, securities, invAccounts, otherHoldings, today), [lots, securities, invAccounts, holdings, today]);
  /* eslint-enable react-hooks/exhaustive-deps */
  const gainLots = useMemo(() => appreciatedCandidates(lots, securities, invAccounts, today), [lots, securities, invAccounts, today]);

  const tables: TaxTables | null = resolveTables(year, settings).tables;
  const hh = model.household;
  const room = tables && hh ? bracketRoom(tables, hh.federal.taxableIncome, hh.federal.longTermGains) : null;
  const wp = hh ? withholdingPlan(hh, model.years, today, priorModel?.household ?? null) : null;

  const traditionalByOwner = new Map<number, number>();
  for (const a of invAccounts) {
    if (a.closed || a.taxType !== 'traditional' || a.personId == null) continue;
    const v = holdings.filter((h) => h.accountId === a.id).reduce((s, h) => s + holdingValue(h, securities.find((x) => x.id === h.securityId)), 0) + a.cashCents;
    traditionalByOwner.set(a.personId, (traditionalByOwner.get(a.personId) ?? 0) + v);
  }
  const checklist = tables && hh
    ? yearEndChecklist({
        today, year, people, years: model.years, household: hh, room, vests: model.vests.map((r) => ({ vest: r.vest, grossCents: r.grossCents })), invAccounts, traditionalByOwner,
        itemizedCents: settings?.itemizedDeductionCents ?? 0, standardCents: tables.stdDeductionMFJ, appreciatedLots: gainLots, fmt: formatCents,
      })
    : [];

  return { today, people, profiles, settings, model, priorModel, tables, hh, room, wp, realized, gains, candidates, gainLots, checklist, build };
}
