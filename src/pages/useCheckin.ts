import { useEffect, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { todayISO } from '../lib/money';
import { addDays, monthOf } from '../lib/dates';
import { loadBudget } from '../lib/budget';
import { loadForecast } from '../lib/forecastLive';
import { dueInstances } from '../lib/schedule';
import { valueAgeDays } from '../lib/property';
import { planFunding, targetNeed } from '../lib/budgetTargets';
import { buildCheckin, progress, streak, withMarks, type Marks, type Step } from '../lib/checkin';

interface CheckinStore {
  marks: Record<string, Marks>;
  completed: string[];
}

/** The monthly check-in for this month: steps (with your ticks applied), progress, and the streak of completed months. */
export function useCheckin() {
  const today = todayISO();
  const month = monthOf(today);
  const budget = useLiveQuery(() => loadBudget(db, month), [month]);
  const forecast = useLiveQuery(() => loadForecast(db, today), [today]);
  const due = useLiveQuery(() => dueInstances(db, today, 0), [today]);
  const txns = useLiveQuery(() => db.txns.toArray(), []) ?? [];
  const accounts = useLiveQuery(() => db.accounts.toArray(), []) ?? [];
  const invAccounts = useLiveQuery(() => db.invAccounts.toArray(), []) ?? [];
  const holdings = useLiveQuery(() => db.holdings.toArray(), []) ?? [];
  const securities = useLiveQuery(() => db.securities.toArray(), []) ?? [];
  const props = useLiveQuery(() => db.properties.toArray(), []) ?? [];
  const propValues = useLiveQuery(() => db.propertyValues.toArray(), []) ?? [];
  const targets = useLiveQuery(() => db.budgetTargets.toArray(), []) ?? [];
  const loans = useLiveQuery(() => db.loans.toArray(), []) ?? [];
  const lastBackup = (useLiveQuery(() => db.settings.get('lastBackup'), []) as { value?: string } | undefined)?.value;
  const saved = useLiveQuery(() => db.settings.get('checkin'), []);
  const store: CheckinStore = { marks: {}, completed: [], ...((saved?.value as Partial<CheckinStore>) ?? {}) };
  const marks = store.marks[month] ?? {};

  const ready = !!budget && !!forecast && !!due;
  const steps: Step[] = useMemo(() => {
    if (!budget || !forecast || !due) return [];
    const needs = targets.flatMap((t) => {
      const row = budget.rows.find((r) => r.kind === 'category' && r.categoryId === t.categoryId);
      return row ? [targetNeed(t, row, month)] : [];
    });
    const plan = planFunding(needs, Number.MAX_SAFE_INTEGER);
    const openIds = new Set(invAccounts.filter((a) => !a.closed).map((a) => a.id));
    const held = new Set(holdings.filter((h) => openIds.has(h.accountId)).map((h) => h.securityId));
    const heldSecs = securities.filter((s) => held.has(s.id!));
    const dates = heldSecs.map((s) => s.priceDate).filter((d): d is string => !!d).sort();
    const oldest = dates[0];
    const base = buildCheckin({
      today,
      dueScheduled: due.length,
      uncategorized: txns.filter((t) => t.date.startsWith(month) && !t.transferTxnId && t.categoryId == null && !t.splits?.length && t.amountCents < 0).length,
      pendingOld: txns.filter((t) => t.status === 'pending' && t.date < addDays(today, -7)).length,
      overspentCategories: budget.rows.filter((r) => r.kind === 'category' && r.available < 0).length,
      readyToAssignCents: budget.readyToAssign,
      targetsCount: needs.length,
      targetsNeedCents: plan.totalNeedCents,
      holdings: heldSecs.length,
      noPriceCount: heldSecs.filter((s) => s.priceCents === null).length,
      oldestPriceDays: oldest ? Math.round((Date.parse(today) - Date.parse(oldest)) / 86400000) : heldSecs.length ? null : null,
      propertyCount: props.filter((p) => !p.excluded).length,
      propertyStale: props.filter((p) => !p.excluded && (valueAgeDays(propValues, p.id!, today) ?? 0) > 365).length,
      forecastBelow: forecast.result.firstBelow,
      hasCashAccounts: forecast.cashAccounts > 0,
      lastBackup,
      hasData: accounts.length > 0 || invAccounts.length > 0 || loans.length > 0,
    });
    return withMarks(base, marks);
  }, [budget, forecast, due, targets, txns, invAccounts, holdings, securities, props, propValues, accounts, loans, lastBackup, month, today, JSON.stringify(marks)]); // eslint-disable-line react-hooks/exhaustive-deps

  const prog = progress(steps);
  const doneMonths = store.completed;

  // remember a finished month
  useEffect(() => {
    if (ready && prog.complete && !doneMonths.includes(month)) db.settings.put({ key: 'checkin', value: { ...store, completed: [...doneMonths, month] } });
  }, [ready, prog.complete, month]); // eslint-disable-line react-hooks/exhaustive-deps

  const setMark = (id: string, on: boolean) => db.settings.put({ key: 'checkin', value: { ...store, marks: { ...store.marks, [month]: { ...marks, [id]: on } } } });
  return { ready, month, steps, progress: prog, completed: doneMonths, streak: streak(doneMonths, month), setMark, marks };
}
