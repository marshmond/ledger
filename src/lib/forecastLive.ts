import type { FinanceDB } from '../db';
import { isSetupAlloc, isSetupTxn } from './setupCategory';
import type { Category, Txn } from '../types';
import { allocations } from './ledger';
import { ledgerBalance } from './netWorth';
import { buildIncomeModel } from './income';
import { hsaYearImpact } from './hsa';
import { netForTax, realizedFor } from './lots';
import { loanView } from './loanSchedule';
import { addMonths } from './dates';
import { occurrencesBetween } from './schedule';
import { runForecast, type ForecastInput, type ForecastResult } from './forecast';
import { lastMonths } from './reports';

export interface ForecastSettings {
  months: number;
  /** Count savings accounts as cash you can spend. */
  includeSavings: boolean;
  /** Typical spending per month outside scheduled bills and loan payments. null = use the estimate from your history. */
  everydayCents: number | null;
  otherIncomeMonthlyCents: number;
  /** Warn when the balance would fall below this. */
  thresholdCents: number;
  includeTaxes: boolean;
  oneOffs: { id: string; date: string; label: string; cents: number }[];
}

export const DEFAULT_FORECAST: ForecastSettings = { months: 12, includeSavings: true, everydayCents: null, otherIncomeMonthlyCents: 0, thresholdCents: 100000, includeTaxes: true, oneOffs: [] };

/**
 * Typical monthly spending that is not a scheduled item: the average of the last three full months, leaving out items posted from
 * Scheduled (they are forecast separately) and the categories used for loan interest and escrow (the loan schedule covers those).
 * Months with no transactions at all are not counted.
 */
export function estimateEveryday(txns: Txn[], categories: Category[], today: string, excludeCategoryIds: number[] = []): number {
  const income = new Set(categories.filter((c) => c.kind === 'income').map((c) => c.id!));
  const skip = new Set(excludeCategoryIds);
  const months = lastMonths(addMonths(`${today.slice(0, 7)}-01`, -1).slice(0, 7), 3);
  const totals = months.map(() => 0);
  const seen = months.map(() => false);
  for (const t of txns) {
    const i = months.indexOf(t.date.slice(0, 7));
    if (i < 0 || t.transferTxnId || isSetupTxn(t)) continue;
    seen[i] = true;
    if (t.recurringId) continue;
    for (const s of allocations(t)) {
      if (isSetupAlloc(s)) continue;
      if (s.categoryId != null && (income.has(s.categoryId) || skip.has(s.categoryId))) continue;
      if (s.categoryId == null && s.amountCents > 0) continue;
      totals[i] -= s.amountCents;
    }
  }
  const used = totals.filter((_, i) => seen[i]);
  return used.length ? Math.max(0, Math.round(used.reduce((a, b) => a + b, 0) / used.length)) : 0;
}

export interface LoadedForecast {
  settings: ForecastSettings;
  input: ForecastInput;
  result: ForecastResult;
  estimateCents: number;
  cashAccounts: number;
}

/** Reads your data and builds the forecast. */
export async function loadForecast(d: FinanceDB, today: string, overrides: Partial<ForecastSettings> = {}): Promise<LoadedForecast> {
  const saved = (await d.settings.get('forecast'))?.value as Partial<ForecastSettings> | undefined;
  const settings: ForecastSettings = { ...DEFAULT_FORECAST, ...(saved ?? {}), ...overrides };
  const year = Number(today.slice(0, 4));
  const horizonEnd = addMonths(`${today.slice(0, 7)}-01`, settings.months);

  const [accounts, txns, categories, people, profiles, bonuses, taxSettings, rsu, securities, sales, hsaW, invAccounts, loans, rates, events, rules, logs] = await Promise.all([
    d.accounts.toArray(), d.txns.toArray(), d.categories.toArray(), d.people.toArray(), d.incomeProfiles.toArray(), d.bonuses.toArray(), d.taxSettings.toArray(), d.rsuVests.toArray(),
    d.securities.toArray(), d.sales.toArray(), d.hsaWithdrawals.toArray(), d.invAccounts.toArray(), d.loans.toArray(), d.loanRates.toArray(), d.loanEvents.toArray(), d.recurring.toArray(), d.recurringLog.toArray(),
  ]);

  const open = accounts.filter((a) => !a.closed);
  const cash = open.filter((a) => a.kind === 'checking' || (settings.includeSavings && a.kind === 'savings'));
  const startCents = cash.reduce((s, a) => s + ledgerBalance(a, txns), 0);

  // paychecks and bonuses (shares you keep from a vest are not cash)
  const pay: ForecastInput['pay'] = [];
  const taxes: ForecastInput['taxes'] = [];
  for (const y of [year, year + 1]) {
    const hsa = hsaYearImpact(hsaW, invAccounts, people, y);
    const m = buildIncomeModel(y, people, profiles, bonuses, taxSettings.find((s) => s.year === y), { vests: rsu, securities }, { taxableCents: hsa.taxableCents, penaltyCents: hsa.penaltyCents }, netForTax(realizedFor(sales, y)));
    for (const py of m.years) {
      const who = people.find((p) => p.id === py.personId)?.name ?? '';
      for (const e of py.events) if (e.date > today && e.net > 0) pay.push({ date: e.date, label: `${who ? who + ': ' : ''}${e.kind === 'regular' ? 'Paycheck' : e.label}`, netCents: e.net });
    }
    if (settings.includeTaxes && m.household && y === year) {
      const due = `${y + 1}-04-15`;
      const f = m.household.federal.balance;
      const s = m.household.ma.balance;
      if (f < 0) taxes.push({ date: due, label: 'Federal tax due at filing', cents: f });
      if (s < 0) taxes.push({ date: due, label: 'Massachusetts tax due at filing', cents: s });
      if (f > 0) taxes.push({ date: `${y + 1}-03-15`, label: 'Expected federal refund', cents: f });
      if (s > 0) taxes.push({ date: `${y + 1}-03-15`, label: 'Expected Massachusetts refund', cents: s });
    }
  }

  // scheduled items (not transfers: card payments would double-count card spending, loan payments come from the loan schedules)
  const handled = new Set(logs.map((l) => `${l.ruleId}|${l.date}`));
  const cashIds = new Set(open.filter((a) => a.kind === 'checking' || a.kind === 'savings' || a.kind === 'credit_card').map((a) => a.id));
  const scheduled: ForecastInput['scheduled'] = [];
  for (const r of rules) {
    if (!r.active || r.transferAccountId || !cashIds.has(r.accountId)) continue;
    for (const date of occurrencesBetween(r, today, horizonEnd)) if (date > today && !handled.has(`${r.id}|${date}`)) scheduled.push({ date, label: r.payee, cents: r.amountCents });
  }

  // loan payments (principal and interest, plus escrow and PMI you pay with it)
  const loanItems: ForecastInput['loans'] = [];
  const loanCats: number[] = [];
  for (const l of loans) {
    if (l.scenario) continue;
    if (l.interestCategoryId) loanCats.push(l.interestCategoryId);
    if (l.escrowCategoryId) loanCats.push(l.escrowCategoryId);
    const v = loanView(l, rates.filter((r) => r.loanId === l.id), events.filter((e) => e.loanId === l.id));
    for (const r of v.schedule.rows) if (r.date > today && r.date < horizonEnd) loanItems.push({ date: r.date, label: `${l.name} payment`, paymentCents: r.payment + (l.escrowMonthlyCents ?? 0) + (l.pmiMonthlyCents ?? 0) });
  }

  const estimateCents = estimateEveryday(txns, categories, today, loanCats);
  const input: ForecastInput = {
    today,
    months: settings.months,
    startCents,
    pay,
    scheduled,
    loans: loanItems,
    taxes,
    oneOffs: settings.oneOffs,
    everydayMonthlyCents: settings.everydayCents ?? estimateCents,
    otherIncomeMonthlyCents: settings.otherIncomeMonthlyCents,
  };
  return { settings, input, result: runForecast(input, settings.thresholdCents), estimateCents, cashAccounts: cash.length };
}
