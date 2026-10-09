import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import type { Loan, LoanKind } from '../types';
import { formatCents, todayISO } from '../lib/money';
import { addMonths, monthOf } from '../lib/dates';
import { balanceAt, loanView, nextRow } from '../lib/loanSchedule';
import { summarize } from '../lib/investments';
import Collapsible from './Collapsible';
import LoanCard, { KIND_NAMES } from './LoanCard';

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
  const net = useMemo(() => {
    const bal = (id: number) => {
      const a = accounts.find((x) => x.id === id);
      return a ? a.openingBalanceCents + txns.filter((t) => t.accountId === id).reduce((s, t) => s + t.amountCents, 0) : 0;
    };
    const sumKind = (k: string) => accounts.filter((a) => a.kind === k).reduce((s, a) => s + bal(a.id!), 0);
    const cash = sumKind('checking') + sumKind('savings');
    const cards = sumKind('credit_card'); // negative
    const ledgerLoans = sumKind('loan'); // negative
    const unlinked = actual.filter((v) => !v.loan.ledgerAccountId || !accounts.some((a) => a.id === v.loan.ledgerAccountId)).reduce((s, v) => s - balanceAt(v.view.schedule, today), 0);
    const investments = summarize({ accounts: invAccounts, holdings, securities, assetClasses }).total;
    return { cash, investments, cards, loans: ledgerLoans + unlinked, total: cash + investments + cards + ledgerLoans + unlinked };
  }, [accounts, txns, actual, invAccounts, holdings, securities, assetClasses, today]);

  async function add() {
    const nm = name.trim() || KIND_NAMES[kind];
    await db.loans.add(defaultLoan(nm, kind, scenario));
    setName('');
  }

  return (
    <>
      <h1>Debt</h1>
      <p className="muted">
        Track your mortgage and HELOC, see the full amortization schedule, and model extra payments and rate changes. Tie a loan to your ledger and
        its payments split into principal and interest automatically.
      </p>

      {actual.length > 0 && (
        <div className="viz">
          <div className="muted">You owe on your loans</div>
          <div className="hero">{formatCents(owedTotal)}</div>
          <div className="tiles">
            <div className="tile"><div className="muted">Due this month</div><div className="v">{formatCents(dueThisMonth)}</div></div>
            <div className="tile"><div className="muted">Interest in {thisYear}</div><div className="v">{formatCents(interestThisYear)}</div></div>
            <div className="tile"><div className="muted">Loans</div><div className="v">{actual.length}</div></div>
          </div>
        </div>
      )}

      <Collapsible id="debt.networth" title="Net worth">
        <table>
          <tbody>
            <tr><td>Cash (checking and savings)</td><td className="num">{formatCents(net.cash)}</td></tr>
            <tr><td>Investments</td><td className="num">{formatCents(net.investments)}</td></tr>
            <tr><td>Credit cards</td><td className={`num ${net.cards < 0 ? 'neg' : ''}`}>{formatCents(net.cards)}</td></tr>
            <tr><td>Loans</td><td className={`num ${net.loans < 0 ? 'neg' : ''}`}>{formatCents(net.loans)}</td></tr>
            <tr><td><strong>Net worth</strong></td><td className={`num ${net.total < 0 ? 'neg' : 'pos'}`}><strong>{formatCents(net.total)}</strong></td></tr>
          </tbody>
        </table>
        <p className="muted">Counts what the app knows about: your accounts, investments, and loans. Property value and other assets are not included.</p>
      </Collapsible>

      <h2>Loans</h2>
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

      <div className="card">
        <strong>Add a loan</strong>
        <div className="grid" style={{ marginTop: 6 }}>
          <label className="f">Name<input value={name} onChange={(e) => setName(e.target.value)} placeholder={KIND_NAMES[kind]} /></label>
          <label className="f">Type
            <select value={kind} onChange={(e) => setKind(e.target.value as LoanKind)}>
              {(Object.keys(KIND_NAMES) as LoanKind[]).map((k) => <option key={k} value={k}>{KIND_NAMES[k]}</option>)}
            </select>
          </label>
        </div>
        <label className="chk" style={{ marginTop: 6 }}>
          <input type="checkbox" checked={scenario} onChange={(e) => setScenario(e.target.checked)} />
          New or what-if loan (compare a refinance or a loan you are considering; not counted in your debt)
        </label>
        <div className="row" style={{ marginTop: 6 }}>
          <button className="primary" onClick={add}>Add loan</button>
          <span className="muted">You will fill in its details next.</span>
        </div>
      </div>
    </>
  );
}
