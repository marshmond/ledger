import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { formatCents, todayISO } from '../lib/money';
import { monthLabel, monthOf } from '../lib/dates';
import { loadBudget } from '../lib/budget';
import { dueInstances } from '../lib/schedule';
import { loadNetWorth } from '../lib/netWorthLive';
import { changeOver, sortedSnapshots } from '../lib/snapshots';
import { spendingSnapshot } from '../lib/spending';
import { computeAlerts } from '../lib/alerts';
import { buildIncomeModel } from '../lib/income';
import { hsaYearImpact } from '../lib/hsa';
import { netForTax, realizedFor } from '../lib/lots';
import { estimatedDueDates } from '../lib/taxPlan';
import { valueAgeDays } from '../lib/property';
import { useTaxPlanData } from './useTaxPlanData';
import ComingUp from './ComingUp';
import { useCheckin } from './useCheckin';
import { loadForecast } from '../lib/forecastLive';
import { addDays } from '../lib/dates';
import { EmptyState, PageHeader, Sparkline, Stat, signedCents } from '../ui/components';
import { openAddTransaction } from '../shell/QuickAdd';

const ONBOARD_KEY = 'ledger.onboarding.dismissed';

/** The landing page: where you stand, what needs attention, and where to go next. */
export default function HomePage() {
  const today = todayISO();
  const month = monthOf(today);
  const year = Number(today.slice(0, 4));
  const accounts = useLiveQuery(() => db.accounts.toArray(), []) ?? [];
  const txns = useLiveQuery(() => db.txns.toArray(), []) ?? [];
  const categories = useLiveQuery(() => db.categories.toArray(), []) ?? [];
  const invAccounts = useLiveQuery(() => db.invAccounts.toArray(), []) ?? [];
  const holdings = useLiveQuery(() => db.holdings.toArray(), []) ?? [];
  const securities = useLiveQuery(() => db.securities.toArray(), []) ?? [];
  const loans = useLiveQuery(() => db.loans.toArray(), []) ?? [];
  const snaps = useLiveQuery(() => db.netWorthSnapshots.toArray(), []) ?? [];
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
  const goals = useLiveQuery(() => db.goals.toArray(), []) ?? [];
  const lastBackup = (useLiveQuery(() => db.settings.get('lastBackup'), []) as { value?: string } | undefined)?.value;
  const due = useLiveQuery(() => dueInstances(db, today, 7), [today]) ?? [];
  const budget = useLiveQuery(() => loadBudget(db, month), [month]);

  const net = useLiveQuery(() => loadNetWorth(db, today), [today]);
  const spending = useMemo(() => spendingSnapshot(txns, categories, month), [txns, categories, month]);

  const sortedSnaps = sortedSnapshots(snaps);
  const change = changeOver(snaps);
  const gains = useMemo(() => netForTax(realizedFor(sales, year)), [sales, year]);
  const hsa = useMemo(() => hsaYearImpact(hsaWithdrawals, invAccounts, people, year), [hsaWithdrawals, invAccounts, people, year]);
  const income = useMemo(
    () => buildIncomeModel(year, people, profiles, bonuses, taxSettings.find((t) => t.year === year), { vests, securities }, { taxableCents: hsa.taxableCents, penaltyCents: hsa.penaltyCents }, gains),
    [year, people, profiles, bonuses, taxSettings, vests, securities, hsa, gains],
  );

  const forecast = useLiveQuery(() => loadForecast(db, today), [today]);
  const checkin = useCheckin();
  const plan = useTaxPlanData(year);
  const nextEstimated = estimatedDueDates(year).find((d) => d >= today) ?? null;
  const overspent = (budget?.rows ?? []).filter((r) => r.kind === 'category' && r.available < 0).map((r) => r.name);
  const hasData = accounts.length > 0 || invAccounts.length > 0 || loans.length > 0 || people.length > 0 || props.length > 0;
  const alerts = computeAlerts({
    today, hasData, lastBackup, scheduledDue: due.length, overspent, invAccounts, holdings, securities, lots, vests, people,
    federalBalanceCents: income.household?.federal.balance ?? null,
    propertyStale: props.filter((p) => !p.excluded && (valueAgeDays(propValues, p.id!, today) ?? 0) > 365).map((p) => p.name),
    estimatedDue: nextEstimated && plan.wp ? { date: nextEstimated, amountCents: plan.wp.estimatedPaymentCents } : null,
    harvestableCents: plan.candidates.reduce((s, c) => s + c.lossCents, 0),
    yearEndTodo: plan.checklist.filter((c) => c.status === 'todo').length,
    checkinLeft: checkin.ready && !checkin.progress.complete && Number(today.slice(8, 10)) >= 25 ? checkin.progress.left : 0,
    forecastLow: accounts.some((a) => !a.closed && (a.kind === 'checking' || a.kind === 'savings')) && forecast?.result.firstBelow && forecast.result.firstBelow.date <= addDays(today, 90) ? { ...forecast.result.firstBelow, thresholdCents: forecast.settings.thresholdCents } : null,
  });
  const recent = [...txns].filter((t) => !t.transferTxnId).sort((a, b) => b.date.localeCompare(a.date) || (b.id ?? 0) - (a.id ?? 0)).slice(0, 6);
  const acctName = (id: number) => accounts.find((a) => a.id === id)?.name ?? '';
  const first = !hasData;
  void first;

  // First-run checklist: a dismissible card with progress. It stays out of the way once dismissed or finished.
  const [onboardOff, setOnboardOff] = useState(() => { try { return localStorage.getItem(ONBOARD_KEY) === '1'; } catch { return false; } });
  const steps = [
    { label: 'Add your checking, savings, and credit card accounts', to: '/accounts', done: accounts.length > 0 },
    { label: 'Set up income to see take-home pay and taxes', to: '/income', done: people.length > 0 },
    { label: 'Add investment accounts and their holdings', to: '/investments', done: invAccounts.length > 0 },
    { label: 'Make a backup (your data lives only in this browser)', to: '/backup', done: !!lastBackup },
  ];
  const stepsDone = steps.filter((s) => s.done).length;
  const showOnboard = !onboardOff && stepsDone < steps.length;
  const dismissOnboard = () => { try { localStorage.setItem(ONBOARD_KEY, '1'); } catch { /* private window: it just comes back next time */ } setOnboardOff(true); };

  const trend = sortedSnaps.map((s) => s.totalCents);
  const nextStep = checkin.steps.find((s) => s.status === 'todo');

  return (
    <>
      <PageHeader
        title="Home"
        description="Where you stand today, and what needs a look."
        actions={checkin.ready && checkin.progress.total > 0 && !checkin.progress.complete ? <Link className="btn" to="/checkin">Monthly check-in · {checkin.progress.done}/{checkin.progress.total}</Link> : undefined}
      />

      {showOnboard && (
        <div className="card">
          <div className="card-head">
            <strong>Get started</strong>
            <button className="link" onClick={dismissOnboard}>Dismiss</button>
          </div>
          <div className="progress" role="progressbar" aria-label="Setup progress" aria-valuenow={stepsDone} aria-valuemin={0} aria-valuemax={steps.length}><div style={{ width: `${(stepsDone / steps.length) * 100}%` }} /></div>
          <div className="muted">{stepsDone} of {steps.length} done</div>
          <ul className="onboard-steps">
            {steps.map((s) => (
              <li key={s.to} className={s.done ? 'done' : ''}>
                <span className="tick" aria-hidden="true">{s.done ? '✓' : ''}</span>
                <Link to={s.to}>{s.label}</Link>
                {s.done && <span className="muted"> (done)</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="dash">
        <div className="dash-main">
          <section className="card hero-card o0" aria-label="Net worth">
            <div className="card-head"><span className="muted">Net worth</span><Link className="card-link" to="/networth">History</Link></div>
            <div className={`hero ${(net?.total ?? 0) < 0 ? 'neg' : ''}`}>{formatCents(net?.total ?? 0)}</div>
            {change && <div className="muted">{change.sinceCents >= 0 ? 'Up' : 'Down'} <strong className={change.sinceCents >= 0 ? 'pos' : 'neg'}>{change.sinceCents >= 0 ? '+' : '-'}{formatCents(Math.abs(change.sinceCents))}</strong> since {change.since}</div>}
            {trend.length >= 2
              ? <Sparkline values={trend} label={`Net worth by month, from ${formatCents(trend[0])} to ${formatCents(trend[trend.length - 1])}`} />
              : <p className="muted">A trend line appears once a couple of months of history have been saved.</p>}
            {net && (
              <div className="stat-row">
                <Stat label="Cash" cents={net.cash} />
                <Stat label="Investments" cents={net.investments} />
                <Stat label="Property" cents={net.property} />
                <Stat label="Cards" cents={net.cards} />
                <Stat label="Loans" cents={net.loans} />
              </div>
            )}
            {props.length === 0 && <p className="muted" style={{ marginTop: 'var(--sp-3)' }}>Add your home’s value on the <Link to="/networth">Net worth</Link> page to include it.</p>}
          </section>

          <div className="grid2 o3">
            <div className="card">
              <div className="card-head"><strong>{monthLabel(month)}</strong><Link className="card-link" to="/budget">Budget</Link></div>
              <div className="kv"><span>Spent</span><span className="v">{formatCents(spending.spentCents)}</span></div>
              <div className="kv"><span>Income</span><span className="v">{formatCents(spending.incomeCents)}</span></div>
              {budget && <div className="kv"><span>Ready to assign</span><span className={`v ${budget.readyToAssign < 0 ? 'neg' : ''}`}>{formatCents(budget.readyToAssign)}</span></div>}
              {spending.top.length > 0 && (
                <>
                  <h3 className="muted" style={{ fontSize: 'var(--fs-sm)', marginBottom: 0 }}>Top categories</h3>
                  {spending.top.map((t) => <div className="kv" key={t.name}><span>{t.name}</span><span className="v">{formatCents(t.cents)}</span></div>)}
                </>
              )}
            </div>

            <div className="card">
              <div className="card-head"><strong>Recent transactions</strong><Link className="card-link" to="/transactions">All</Link></div>
              {recent.length === 0 ? (
                <EmptyState title="No transactions yet" action={<button className="primary" onClick={openAddTransaction}>Add a transaction</button>}>Add one by hand or import a bank file.</EmptyState>
              ) : recent.map((t) => (
                <Link className="list-row" key={t.id} to={`/account/${t.accountId}`}>
                  <span><strong>{t.payee || '(no payee)'}</strong><span className="sub">{t.date} · {acctName(t.accountId)}</span></span>
                  <span className={`amt ${t.amountCents < 0 ? '' : 'pos'}`}>{signedCents(t.amountCents)}</span>
                </Link>
              ))}
            </div>

            {checkin.ready && checkin.progress.total > 0 && (
              <div className="card">
                <div className="card-head"><strong>Monthly check-in</strong><Link className="card-link" to="/checkin">{checkin.progress.complete ? 'Done ✓' : 'Open'}</Link></div>
                <div className="progress" role="progressbar" aria-label="Check-in progress" aria-valuenow={checkin.progress.done} aria-valuemin={0} aria-valuemax={checkin.progress.total}><div style={{ width: `${Math.round((checkin.progress.done / checkin.progress.total) * 100)}%` }} /></div>
                <div className="muted">{checkin.progress.complete ? `All ${checkin.progress.total} steps done this month.` : `${checkin.progress.done} of ${checkin.progress.total} done. Next: ${nextStep?.title ?? ''}.`}{checkin.streak > 1 && ` ${checkin.streak} months in a row.`}</div>
              </div>
            )}

            <div className="card">
              <div className="card-head"><strong>Goals</strong><Link className="card-link" to="/goals">Goals</Link></div>
              {goals.length === 0 ? (
                <EmptyState title="No goals yet" action={<Link className="btn" to="/goals">Plan a goal</Link>}>College, a purchase, or retirement.</EmptyState>
              ) : (
                <ul className="plain">{goals.map((g) => <li key={g.id}>{g.name}<span className="muted"> · starts {g.startYear}</span></li>)}</ul>
              )}
            </div>
          </div>
        </div>

        <div className="dash-rail">
          <section className="card o1" aria-label="Needs attention">
            <div className="card-head"><strong>Needs attention</strong>{alerts.length > 0 && <span className="badge">{alerts.length}</span>}</div>
            {alerts.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>{hasData ? 'Nothing needs attention right now.' : 'Alerts will show here once you have entered some data.'}</p>
            ) : (
              <ul className="alerts">
                {alerts.map((a) => (
                  <li key={a.id} className={`alert ${a.level}`}>
                    <div>
                      <strong>{a.title}</strong>
                      <div className="muted">{a.detail}</div>
                    </div>
                    <Link className="alert-act" to={a.to}>{a.actionLabel}</Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <div className="o4"><ComingUp /></div>
        </div>
      </div>
    </>
  );
}
