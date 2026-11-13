import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import type { Loan, LoanKind } from '../types';
import { formatCents, todayISO } from '../lib/money';
import { addMonths, monthOf } from '../lib/dates';
import { balanceAt, loanView, nextRow } from '../lib/loanSchedule';
import { summarize } from '../lib/investments';
import { computeNetWorth } from '../lib/netWorth';
import { propertyTotal } from '../lib/property';
import Collapsible from './Collapsible';
import LoanCard, { KIND_NAMES } from './LoanCard';
import { PageHeader } from '../ui/components';
import './analysis.css';

function defaultLoan(name: string, kind: LoanKind, scenario: boolean): Loan {
  const today = todayISO();
  const base = { name, kind, scenario: scenario || undefined, annualRatePct: 0, extraMode: 'shorten' as const };
  if (kind === 'heloc') {
    return {
      ...base,
      setup: 'current',
      balanceCents: 0,
      asOfDate: today,
      nextPaymentDate: addMonths(`${monthOf(today)}-01`, 1),
      heloc: { drawStartDate: today, drawMonths: 120, repayMonths: 180, creditLimitCents: null },
    };
  }
  return { ...base, setup: 'original' };
}

export default function DebtPage() {
  const today = todayISO();
  const loans = useLiveQuery(() => db.loans.toArray(), []) ?? [];
  const rates = useLiveQuery(() => db.loanRates.toArray(), []) ?? [];
  const events = useLiveQuery(() => db.loanEvents.toArray(), []) ?? [];
  const accounts = useLiveQuery(() => db.accounts.toArray(), []) ?? [];
  const txns = useLiveQuery(() => db.txns.toArray(), []) ?? [];
  const groups = useLiveQuery(() => db.categoryGroups.toArray(), []) ?? [];
  const categories = useLiveQuery(() => db.categories.toArray(), []) ?? [];
  const invAccounts = useLiveQuery(() => db.invAccounts.toArray(), []) ?? [];
  const holdings = useLiveQuery(() => db.holdings.toArray(), []) ?? [];
  const securities = useLiveQuery(() => db.securities.toArray(), []) ?? [];
  const assetClasses = useLiveQuery(() => db.assetClasses.toArray(), []) ?? [];
  const props = useLiveQuery(() => db.properties.toArray(), []) ?? [];
  const propValues = useLiveQuery(() => db.propertyValues.toArray(), []) ?? [];

  const [name, setName] = useState('');
  const [kind, setKind] = useState<LoanKind>('mortgage');
  const [scenario, setScenario] = useState(false);

  const views = useMemo(
    () =>
      loans.map((l) => ({
        loan: l,
        view: loanView(l, rates.filter((r) => r.loanId === l.id), events.filter((e) => e.loanId === l.id)),
      })),
    [loans, rates, events],
  );
  const actual = views.filter((v) => !v.loan.scenario && v.view.schedule.rows.length > 0);
  const thisMonth = monthOf(today);
  const thisYear = today.slice(0, 4);
  const owedTotal = actual.reduce((s, v) => s + balanceAt(v.view.schedule, today), 0);
  const dueThisMonth = actual.reduce((s, v) => {
    const r = nextRow(v.view.schedule, `${thisMonth}-01`);
    return r && monthOf(r.date) === thisMonth ? s + r.payment : s;
  }, 0);
  const interestThisYear = actual.reduce((s, v) => s + v.view.schedule.rows.filter((r) => r.date.startsWith(thisYear)).reduce((a, r) => a + r.interest, 0), 0);

  // Net worth. Loans tied to a ledger account are counted once, from the ledger; the rest from their schedule.
  const net = useMemo(
    () =>
      computeNetWorth(
        accounts,
        txns,
        summarize({ accounts: invAccounts, holdings, securities, assetClasses }).total,
        actual.map((v) => ({ ledgerAccountId: v.loan.ledgerAccountId, owedCents: balanceAt(v.view.schedule, today) })),
        propertyTotal(props, propValues, today),
      ),
    [accounts, txns, actual, invAccounts, holdings, securities, assetClasses, today, props, propValues],
  );

  async function add() {
    const nm = name.trim() || KIND_NAMES[kind];
    await db.loans.add(defaultLoan(nm, kind, scenario));
    setName('');
  }

  return (
    <div className="an-page">
      <PageHeader eyebrow="Invest" title="Debt" description="Mortgage, HELOC, and other loans, with schedules and what-ifs." about={<>Track your mortgage and HELOC, see the full amortization schedule, and model extra payments and rate changes. Tie a loan to your ledger and
        its payments split into principal and interest automatically.</>} />

      {actual.length > 0 && (
        <section className="an-hero" aria-label="What you owe on your loans">
          <div>
            <div className="an-hero-label">You owe on your loans <span className="an-kind">From each loan’s schedule</span></div>
            <div className="an-hero-amt">{formatCents(owedTotal)}</div>
            <p className="an-hero-msg">The balance each loan’s schedule reaches today. Later months in the schedules are projections from the rates and payments you entered, not guarantees.</p>
          </div>
          <dl className="an-hero-figs">
            <div><dt>Due this month</dt><dd>{formatCents(dueThisMonth)}</dd></div>
            <div><dt>Interest in {thisYear} <span className="an-kind an-kind--projected">Scheduled</span></dt><dd>{formatCents(interestThisYear)}</dd></div>
            <div><dt>Loans</dt><dd>{actual.length}</dd></div>
          </dl>
        </section>
      )}

      <Collapsible id="debt.networth" title="Net worth">
        <table className="an-table">
          <tbody>
            <tr><td>Cash (checking and savings)</td><td className="num">{formatCents(net.cash)}</td></tr>
            <tr><td>Investments</td><td className="num">{formatCents(net.investments)}</td></tr>
            <tr><td>Credit cards</td><td className="num">{formatCents(net.cards)}</td></tr>
            <tr><td>Loans</td><td className="num">{formatCents(net.loans)}</td></tr>
            <tr><td><strong>Net worth</strong></td><td className="num"><strong>{formatCents(net.total)}</strong></td></tr>
          </tbody>
        </table>
        <p className="an-note">Counts what the app knows about: your accounts, investments, and loans. Property value and other assets are not included. Amounts owed are negative because they lower net worth.</p>
      </Collapsible>

      <div className="an-head" style={{ marginBottom: 0 }}>
        <h2 className="an-h2">Loans <span className="an-small muted">{loans.length}</span></h2>
      </div>
      {loans.length === 0 && <p className="muted">No loans yet. Add your mortgage or HELOC below.</p>}
      {views.map(({ loan }) => (
        <LoanCard
          key={loan.id}
          loan={loan}
          rates={rates.filter((r) => r.loanId === loan.id)}
          events={events.filter((e) => e.loanId === loan.id)}
          accounts={accounts}
          groups={groups}
          categories={categories}
        />
      ))}

      <section className="an-card an-stack-col" aria-label="Add a loan">
        <h2 className="an-h2" style={{ fontSize: 'var(--fs-base)' }}>Add a loan</h2>
        <div className="an-form">
          <label className="f">Name<input value={name} onChange={(e) => setName(e.target.value)} placeholder={KIND_NAMES[kind]} /></label>
          <label className="f">Type
            <select value={kind} onChange={(e) => setKind(e.target.value as LoanKind)}>
              {(Object.keys(KIND_NAMES) as LoanKind[]).map((k) => <option key={k} value={k}>{KIND_NAMES[k]}</option>)}
            </select>
          </label>
        </div>
        <label className="chk">
          <input type="checkbox" checked={scenario} onChange={(e) => setScenario(e.target.checked)} />
          New or what-if loan (compare a refinance or a loan you are considering; not counted in your debt)
        </label>
        <div className="an-actions" style={{ marginTop: 0 }}>
          <button className="primary" onClick={add}>Add loan</button>
          <span className="muted">You will fill in its details next.</span>
        </div>
      </section>
    </div>
  );
}
