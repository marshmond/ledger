import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { formatCents, todayISO } from '../lib/money';
import { monthLabel, monthOf } from '../lib/dates';
import { loadBudget } from '../lib/budget';
import { dueInstances } from '../lib/schedule';
import { summarize } from '../lib/investments';
import { balanceAt, loanView } from '../lib/loanSchedule';
import { computeNetWorth } from '../lib/netWorth';
import { spendingSnapshot } from '../lib/spending';
import { computeAlerts } from '../lib/alerts';
import { buildIncomeModel } from '../lib/income';
import { hsaYearImpact } from '../lib/hsa';
import { netForTax, realizedFor } from '../lib/lots';

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
  const assetClasses = useLiveQuery(() => db.assetClasses.toArray(), []) ?? [];
  const loans = useLiveQuery(() => db.loans.toArray(), []) ?? [];
  const rates = useLiveQuery(() => db.loanRates.toArray(), []) ?? [];
  const events = useLiveQuery(() => db.loanEvents.toArray(), []) ?? [];
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

  const owed = useMemo(
    () =>
      loans
        .filter((l) => !l.scenario)
        .map((l) => {
          const v = loanView(l, rates.filter((r) => r.loanId === l.id), events.filter((e) => e.loanId === l.id));
          return { ledgerAccountId: l.ledgerAccountId, owedCents: v.schedule.rows.length ? balanceAt(v.schedule, today) : 0 };
        }),
    [loans, rates, events, today],
  );
  const inv = useMemo(() => summarize({ accounts: invAccounts, holdings, securities, assetClasses }), [invAccounts, holdings, securities, assetClasses]);
  const net = useMemo(() => computeNetWorth(accounts, txns, inv.total, owed), [accounts, txns, inv.total, owed]);
  const spending = useMemo(() => spendingSnapshot(txns, categories, month), [txns, categories, month]);

  const gains = useMemo(() => netForTax(realizedFor(sales, year)), [sales, year]);
  const hsa = useMemo(() => hsaYearImpact(hsaWithdrawals, invAccounts, people, year), [hsaWithdrawals, invAccounts, people, year]);
  const income = useMemo(
    () => buildIncomeModel(year, people, profiles, bonuses, taxSettings.find((t) => t.year === year), { vests, securities }, { taxableCents: hsa.taxableCents, penaltyCents: hsa.penaltyCents }, gains),
    [year, people, profiles, bonuses, taxSettings, vests, securities, hsa, gains],
  );

  const overspent = (budget?.rows ?? []).filter((r) => r.kind === 'category' && r.available < 0).map((r) => r.name);
  const hasData = accounts.length > 0 || invAccounts.length > 0 || loans.length > 0 || people.length > 0;
  const alerts = computeAlerts({
    today, hasData, lastBackup, scheduledDue: due.length, overspent, invAccounts, holdings, securities, lots, vests, people,
    federalBalanceCents: income.household?.federal.balance ?? null,
  });
  const recent = [...txns].filter((t) => !t.transferTxnId).sort((a, b) => b.date.localeCompare(a.date) || (b.id ?? 0) - (a.id ?? 0)).slice(0, 6);
  const acctName = (id: number) => accounts.find((a) => a.id === id)?.name ?? '';
  const first = !hasData;

  return (
    <>
      <h1>Home</h1>

      {first && (
        <div className="card">
          <strong>Welcome. Start with one of these:</strong>
          <ul className="starts">
            <li><Link to="/accounts">Add your checking, savings, and credit card accounts</Link> and their starting balances.</li>
            <li><Link to="/income">Set up income</Link> to see take-home pay and taxes.</li>
            <li><Link to="/investments">Add investment accounts</Link> and their holdings.</li>
            <li><Link to="/backup">Make a backup</Link> once you have entered data. It lives only in this browser.</li>
          </ul>
        </div>
      )}

      <div className="viz">
        <div className="muted">Net worth</div>
        <div className={`hero ${net.total < 0 ? 'neg' : ''}`}>{formatCents(net.total)}</div>
        <div className="tiles">
          <div className="tile"><div className="muted">Cash</div><div className="v">{formatCents(net.cash)}</div></div>
          <div className="tile"><div className="muted">Investments</div><div className="v">{formatCents(net.investments)}</div></div>
          <div className="tile"><div className="muted">Cards</div><div className={`v ${net.cards < 0 ? 'neg' : ''}`}>{formatCents(net.cards)}</div></div>
          <div className="tile"><div className="muted">Loans</div><div className={`v ${net.loans < 0 ? 'neg' : ''}`}>{formatCents(net.loans)}</div></div>
        </div>
        <p className="muted">Does not include the value of your home or other property.</p>
      </div>

      <h2>Needs attention</h2>
      {alerts.length === 0 ? (
        <p className="muted">{hasData ? 'Nothing needs attention right now.' : 'Alerts will show here once you have entered some data.'}</p>
      ) : (
        <ul className="alerts">
          {alerts.map((a) => (
            <li key={a.id} className={`alert ${a.level}`}>
              <div>
                <strong>{a.title}</strong>
                <div className="muted">{a.detail}</div>
              </div>
              <Link className="alert-act" to={a.to}>{a.actionLabel} →</Link>
            </li>
          ))}
        </ul>
      )}

      <div className="grid2">
        <div className="card">
          <div className="row spread"><strong>{monthLabel(month)}</strong><Link to="/budget">Budget →</Link></div>
          <table><tbody>
            <tr><td>Spent</td><td className="num">{formatCents(spending.spentCents)}</td></tr>
            <tr><td>Income</td><td className="num">{formatCents(spending.incomeCents)}</td></tr>
            {budget && <tr><td>Ready to assign</td><td className={`num ${budget.readyToAssign < 0 ? 'neg' : ''}`}>{formatCents(budget.readyToAssign)}</td></tr>}
          </tbody></table>
          {spending.top.length > 0 && (
            <>
              <div className="muted" style={{ marginTop: 6 }}>Top categories</div>
              <table><tbody>{spending.top.map((t) => <tr key={t.name}><td>{t.name}</td><td className="num">{formatCents(t.cents)}</td></tr>)}</tbody></table>
            </>
          )}
        </div>

        <div className="card">
          <div className="row spread"><strong>Recent transactions</strong><Link to="/transactions">All →</Link></div>
          {recent.length === 0 ? <p className="muted">None yet.</p> : (
            <table><tbody>
              {recent.map((t) => (
                <tr key={t.id}>
                  <td><Link to={`/account/${t.accountId}`}>{t.payee || '(no payee)'}</Link><div className="muted" style={{ fontSize: '0.75rem' }}>{t.date} · {acctName(t.accountId)}</div></td>
                  <td className={`num ${t.amountCents < 0 ? '' : 'pos'}`}>{formatCents(t.amountCents)}</td>
                </tr>
              ))}
            </tbody></table>
          )}
        </div>
      </div>

      <div className="grid2">
        <div className="card">
          <div className="row spread"><strong>Goals</strong><Link to="/goals">Goals →</Link></div>
          {goals.length === 0 ? <p className="muted">No goals yet. Plan for college, a purchase, or retirement.</p> : (
            <ul className="plain">{goals.map((g) => <li key={g.id}>{g.name}<span className="muted"> · starts {g.startYear}</span></li>)}</ul>
          )}
          <p><Link to="/retirement">Does your money last? →</Link></p>
        </div>
        <div className="card">
          <strong>Quick links</strong>
          <ul className="plain links">
            <li><Link to="/paycheck">Paycheck calculator</Link></li>
            <li><Link to="/roth">Roth conversion planner</Link></li>
            <li><Link to="/investments">Trades and realized gains</Link></li>
            <li><Link to="/debt">Mortgage and HELOC</Link></li>
            <li><Link to="/import">Import transactions</Link></li>
          </ul>
        </div>
      </div>
    </>
  );
}
