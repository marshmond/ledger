import { useMemo, useState, type ReactNode } from 'react';
import { Link } from '../core/router';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { formatCents } from '../lib/money';
import { useToday } from '../ui/useToday';
import { refreshAllPrices } from '../lib/prices';
import { monthLabel, monthOf } from '../lib/dates';
import { loadNetWorth } from '../lib/netWorthLive';
import { changeOver } from '../lib/snapshots';
import { spendingSnapshot } from '../lib/spending';
import ComingUp from './ComingUp';
import { useLedgerAlerts } from './useLedgerAlerts';
import { EmptyState, PageHeader, signedCents } from '../ui/components';
import { BarList, Donut, NetWorthChart, PairedColumns, Ring } from '../ui/charts';
import { CARD_IDS, DEFAULT_LAYOUT, addCard, loadLayout, moveCard, removeCard, saveLayout, toggleSize, type HomeCard } from '../lib/homeLayout';
import { budgetBars, monthlyFlow, netWorthBars, spendingSlices } from '../lib/homeCharts';
import { openAddTransaction } from '../shell/QuickAdd';

const TITLES: Record<string, string> = {
  start: 'Get started', networth: 'Net worth', attention: 'Needs attention', month: 'This month', spending: 'Spending by category', budget: 'Budget progress',
  cashflow: 'Income vs spending', breakdown: 'What you own and owe', recent: 'Recent transactions', comingup: 'Coming up', checkin: 'Monthly check-in', goals: 'Goals',
};

const ONBOARD_KEY = 'ledger.onboarding.dismissed';

/** The landing page: where you stand, what needs attention, and where to go next. */
export default function HomePage() {
  const today = useToday();
  const month = monthOf(today);
  const year = Number(today.slice(0, 4));
  const categories = useLiveQuery(() => db.categories.toArray(), []) ?? [];
  const snaps = useLiveQuery(() => db.netWorthSnapshots.toArray(), []) ?? [];
  const goals = useLiveQuery(() => db.goals.toArray(), []) ?? [];
  // The alert list and everything that feeds it live in useLedgerAlerts, so the Today screen shows exactly the same alerts.
  const { alerts, hasData, checkin, budget, accounts, txns, invAccounts, people, lastBackup } = useLedgerAlerts(today);

  const net = useLiveQuery(() => loadNetWorth(db, today), [today]);
  const spending = useMemo(() => spendingSnapshot(txns, categories, month), [txns, categories, month]);

  const change = changeOver(snaps);
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

  const nwBars = netWorthBars(snaps, 12);
  const nextStep = checkin.steps.find((s) => s.status === 'todo');

  // Which cards show, in what order and width. Saved on this device only.
  const [layout, setLayout] = useState(loadLayout);
  const [editing, setEditing] = useState(false);
  const [pricing, setPricing] = useState(false);
  const [priceMsg, setPriceMsg] = useState('');
  async function refreshPrices() {
    setPricing(true);
    try {
      setPriceMsg(await refreshAllPrices(db, setPriceMsg));
    } finally {
      setPricing(false);
    }
  }
  const update = (next: HomeCard[]) => { setLayout(next); saveLayout(next); };

  const slices = useMemo(() => spendingSlices(txns, categories, month), [txns, categories, month]);
  const flow = useMemo(() => monthlyFlow(txns, categories, month, 6), [txns, categories, month]);
  const bars = useMemo(() => budgetBars(budget?.rows ?? []), [budget]);

  const assets = net ? [{ name: 'Cash', cents: net.cash }, { name: 'Investments', cents: net.investments }, { name: 'Property', cents: net.property }].filter((s) => s.cents > 0) : [];
  const assetTotal = assets.reduce((s, x) => s + x.cents, 0);
  const owed = net ? -(Math.min(0, net.cards) + Math.min(0, net.loans)) : 0;
  const monthMax = Math.max(spending.incomeCents, spending.spentCents, 1);
  const yearsAway = (g: { startYear: number }) => Math.max(0, g.startYear - year);
  const farthest = Math.max(1, ...goals.map(yearsAway));
  const shortMonth = (m: string) => monthLabel(m).slice(0, 3);
  const checkinOn = checkin.ready && checkin.progress.total > 0;

  const cards: Record<string, { hidden?: string; node: ReactNode }> = {
    start: {
      hidden: showOnboard ? undefined : 'Setup is finished or dismissed, so this is hidden.',
      node: (
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
              </li>
            ))}
          </ul>
        </div>
      ),
    },
    networth: {
      node: (
        <section className="card hero-card" aria-label="Net worth">
          <div className="card-head"><span className="muted">Net worth</span><Link className="card-link" to="/networth">History</Link></div>
          <div className={`hero ${(net?.total ?? 0) < 0 ? 'neg' : ''}`}>{formatCents(net?.total ?? 0)}</div>
          {change && <div className="muted">{change.sinceCents >= 0 ? 'Up' : 'Down'} <strong className={change.sinceCents >= 0 ? 'pos' : 'neg'}>{change.sinceCents >= 0 ? '+' : '-'}{formatCents(Math.abs(change.sinceCents))}</strong> since {change.since}</div>}
          {nwBars.length >= 2
            ? <NetWorthChart bars={nwBars} label="Assets and amounts owed by month, with net worth as a line" />
            : <p className="muted">A trend line appears once a couple of months of history have been saved.</p>}
        </section>
      ),
    },
    attention: {
      node: (
        <section className="card" aria-label="Needs attention">
          <div className="card-head"><h2 className="card-title">Needs attention</h2>{alerts.length > 0 && <span className="badge">{alerts.length}</span>}</div>
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
      ),
    },
    month: {
      node: (
        <div className="card">
          <div className="card-head"><h2 className="card-title">{monthLabel(month)}</h2><Link className="card-link" to="/budget">Budget</Link></div>
          <BarList bars={[
            { name: 'Income', ratio: spending.incomeCents / monthMax, detail: formatCents(spending.incomeCents), good: true },
            { name: 'Spent', ratio: spending.spentCents / monthMax, detail: formatCents(spending.spentCents), over: spending.spentCents > spending.incomeCents && spending.incomeCents > 0 },
          ]} />
          {budget && <div className="kv" style={{ marginTop: 'var(--sp-3)' }}><span>Ready to assign</span><span className={`v ${budget.readyToAssign < 0 ? 'neg' : ''}`}>{formatCents(budget.readyToAssign)}</span></div>}
        </div>
      ),
    },
    spending: {
      node: (
        <div className="card">
          <div className="card-head"><h2 className="card-title">Spending by category</h2><Link className="card-link" to="/reports">Reports</Link></div>
          {slices.length === 0
            ? <p className="muted">No spending recorded in {monthLabel(month)} yet.</p>
            : <Donut slices={slices} label={`Spending by category in ${monthLabel(month)}, ${formatCents(spending.spentCents)} in total`} center={<><strong>{formatCents(spending.spentCents)}</strong><span className="muted">spent</span></>} />}
        </div>
      ),
    },
    budget: {
      node: (
        <div className="card">
          <div className="card-head"><h2 className="card-title">Budget progress</h2><Link className="card-link" to="/budget">Budget</Link></div>
          {bars.length === 0
            ? <p className="muted">Assign money to categories on the Budget page to track it here.</p>
            : <BarList bars={bars.map((b) => ({ name: b.name, ratio: b.ratio, over: b.over, detail: b.fundsCents > 0 ? `${formatCents(b.spentCents)} of ${formatCents(b.fundsCents)}` : `${formatCents(b.spentCents)}, none set aside` }))} />}
        </div>
      ),
    },
    cashflow: {
      node: (
        <div className="card">
          <div className="card-head"><h2 className="card-title">Income vs spending</h2><Link className="card-link" to="/reports">Reports</Link></div>
          {flow.every((f) => f.incomeCents === 0 && f.spentCents === 0)
            ? <p className="muted">Income and spending for the last six months will chart here.</p>
            : <PairedColumns aName="Income" bName="Spent" label={`Income and spending by month: ${flow.map((f) => `${monthLabel(f.month)} ${formatCents(f.incomeCents)} in, ${formatCents(f.spentCents)} out`).join('; ')}`} points={flow.map((f) => ({ label: shortMonth(f.month), a: f.incomeCents, b: f.spentCents }))} />}
        </div>
      ),
    },
    breakdown: {
      node: (
        <div className="card">
          <div className="card-head"><h2 className="card-title">What you own and owe</h2><Link className="card-link" to="/networth">Net worth</Link></div>
          {assets.length === 0
            ? <p className="muted">Add accounts, investments or property to see the mix.</p>
            : (
              <>
                <Donut slices={assets} label={`Assets: ${assets.map((a) => `${a.name} ${formatCents(a.cents)}`).join(', ')}`} center={<><strong>{formatCents(assetTotal)}</strong><span className="muted">assets</span></>} />
                <div style={{ marginTop: 'var(--sp-4)' }}>
                  <BarList bars={[{ name: 'Owed (cards and loans)', ratio: owed / assetTotal, detail: formatCents(owed), over: owed > assetTotal }]} />
                </div>
              </>
            )}
        </div>
      ),
    },
    recent: {
      node: (
        <div className="card">
          <div className="card-head"><h2 className="card-title">Recent transactions</h2><Link className="card-link" to="/transactions">All</Link></div>
          {recent.length === 0 ? (
            <EmptyState title="No transactions yet" action={<button className="primary" onClick={openAddTransaction}>Add a transaction</button>}>Add one by hand or import a bank file.</EmptyState>
          ) : recent.map((t) => (
            <Link className="list-row" key={t.id} to={`/account/${t.accountId}`}>
              <span><strong>{t.payee || '(no payee)'}</strong><span className="sub">{t.date} · {acctName(t.accountId)}</span></span>
              <span className={`amt ${t.amountCents < 0 ? '' : 'pos'}`}>{signedCents(t.amountCents)}</span>
            </Link>
          ))}
        </div>
      ),
    },
    comingup: { node: <ComingUp limit={5} withDownload={false} /> },
    checkin: {
      hidden: checkinOn ? undefined : 'There is no check-in to show yet.',
      node: (
        <div className="card">
          <div className="card-head"><h2 className="card-title">Monthly check-in</h2><Link className="card-link" to="/checkin">{checkin.progress.complete ? 'Done ✓' : 'Open'}</Link></div>
          <div className="ring-row">
            <Ring fraction={checkin.progress.total ? checkin.progress.done / checkin.progress.total : 0} label={`Check-in: ${checkin.progress.done} of ${checkin.progress.total} steps done`}>
              <strong>{checkin.progress.done}/{checkin.progress.total}</strong>
            </Ring>
            <div className="muted">{checkin.progress.complete ? 'All steps done.' : `Next: ${nextStep?.title ?? ''}`}{checkin.streak > 1 && <><br />{checkin.streak} months in a row</>}</div>
          </div>
        </div>
      ),
    },
    goals: {
      node: (
        <div className="card">
          <div className="card-head"><h2 className="card-title">Goals</h2><Link className="card-link" to="/goals">Goals</Link></div>
          {goals.length === 0 ? (
            <EmptyState title="No goals yet" action={<Link className="btn" to="/goals">Plan a goal</Link>}>College, a purchase, or retirement.</EmptyState>
          ) : (
            <BarList bars={goals.map((g) => ({ name: g.name, ratio: Math.max(0.04, yearsAway(g) / farthest), detail: yearsAway(g) === 0 ? `now (${g.startYear})` : `${g.startYear} · ${yearsAway(g)} yr` }))} />
          )}
        </div>
      ),
    },
  };

  const missing = CARD_IDS.filter((id) => !layout.some((c) => c.id === id));

  return (
    <>
      <PageHeader
        title="Home"
        description="Where you stand today, and what needs a look."
        actions={
          <>
            {!editing && checkinOn && !checkin.progress.complete && <Link className="btn" to="/checkin">Monthly check-in · {checkin.progress.done}/{checkin.progress.total}</Link>}
            {!editing && <button disabled={pricing} onClick={refreshPrices}>{pricing ? 'Refreshing…' : 'Refresh prices'}</button>}
            <button className={editing ? 'primary' : ''} onClick={() => setEditing(!editing)}>{editing ? 'Done' : 'Edit Home'}</button>
          </>
        }
      />
      {priceMsg && (
        <p className={priceMsg.startsWith('Updated') ? 'ok' : 'muted'}>
          {priceMsg}
          {priceMsg.startsWith('Save your API key') && <> <Link to="/investments">Add it on Investments, Prices</Link></>}
        </p>
      )}

      {editing && (
        <div className="card edit-panel">
          <div className="card-head"><h2 className="card-title">Edit Home</h2><button className="link" onClick={() => update(DEFAULT_LAYOUT.map((c) => ({ ...c })))}>Reset to default</button></div>
          <p className="muted">Use the arrows to reorder, the width button to make a card wider or narrower (computer screens), and Remove to take one off. This layout is saved on this device only.</p>
          {missing.length > 0
            ? <div className="row"><span className="muted">Add a card:</span>{missing.map((id) => <button key={id} onClick={() => update(addCard(layout, id))}>+ {TITLES[id]}</button>)}</div>
            : <p className="muted" style={{ margin: 0 }}>Every card is on the page.</p>}
        </div>
      )}

      <div className="home-grid">
        {layout.map((c, i) => {
          const card = cards[c.id];
          if (!card || (card.hidden && !editing)) return null;
          const title = TITLES[c.id];
          return (
            <div key={c.id} className={`hc ${c.size} ${editing ? 'editing' : ''}`}>
              {editing && (
                <div className="hc-bar">
                  <span className="grow">{title}</span>
                  <button aria-label={`Move ${title} earlier`} disabled={i === 0} onClick={() => update(moveCard(layout, c.id, -1))}>↑</button>
                  <button aria-label={`Move ${title} later`} disabled={i === layout.length - 1} onClick={() => update(moveCard(layout, c.id, 1))}>↓</button>
                  <button className="hc-width" onClick={() => update(toggleSize(layout, c.id))}>{c.size === 'full' ? 'Make narrower' : 'Make wider'}</button>
                  <button aria-label={`Remove ${title}`} onClick={() => update(removeCard(layout, c.id))}>Remove</button>
                </div>
              )}
              {card.hidden ? <div className="card hc-stub"><p className="muted" style={{ margin: 0 }}>{card.hidden}</p></div> : card.node}
            </div>
          );
        })}
      </div>
    </>
  );
}
