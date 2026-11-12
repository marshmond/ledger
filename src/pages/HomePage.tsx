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
import HomeHero from './HomeHero';
import { CheckinSteps, OwnOweBars } from './HomeParts';
import { useLedgerAlerts } from './useLedgerAlerts';
import { EmptyState, PageHeader, signedCents } from '../ui/components';
import { DateTile } from '../ui/DateTile';
import { BarList, Donut, PairedColumns } from '../ui/charts';
import { NOTICE_KEY, SECTION_TITLE, copySections, forgetSections, hideSection, loadSections, moveSection, readCustomLegacy, saveSections, showSection, DEFAULT_SECTIONS, type HomeSections, type SectionId } from '../lib/homeSections';
import { budgetBars, monthlyFlow, netWorthBars, spendingSlices } from '../lib/homeCharts';
import { openAddTransaction } from '../shell/QuickAdd';
import './home.css';

const ONBOARD_KEY = 'ledger.onboarding.dismissed';

/**
 * The landing page: where you stand, what needs attention, and where to go next.
 *
 * D12 refinement: a fixed top (the net-worth and month panel, Needs attention, Get started) and two columns of sections. The wide column holds the analysis (spending and
 * budget, income vs spending, what you own and owe); the narrow one holds the supporting lists (recent transactions, coming up, the monthly check-in, goals). Every figure
 * still comes from the same readers as before. Sections can be moved up or down inside their column and hidden (see src/lib/homeSections.ts); the earlier saved
 * layout (`ledger.home.layout.v1`) is never changed.
 */
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

  // First-run checklist: one slim row with progress. It stays out of the way once dismissed or finished.
  const [onboardOff, setOnboardOff] = useState(() => { try { return localStorage.getItem(ONBOARD_KEY) === '1'; } catch { return false; } });
  const steps = [
    { label: 'Add your checking, savings, and credit card accounts', to: '/accounts', done: accounts.length > 0 },
    { label: 'Set up income to see take-home pay and taxes', to: '/income', done: people.length > 0 },
    { label: 'Add investment accounts and their holdings', to: '/investments', done: invAccounts.length > 0 },
    { label: 'Make a backup (your data lives only in this browser)', to: '/backup', done: !!lastBackup },
  ];
  const stepsDone = steps.filter((s) => s.done).length;
  const showOnboard = !onboardOff && stepsDone < steps.length;
  const [stepsOpen, setStepsOpen] = useState(false);
  const nextOnboard = steps.find((x) => !x.done);
  const dismissOnboard = () => { try { localStorage.setItem(ONBOARD_KEY, '1'); } catch { /* private window: it just comes back next time */ } setOnboardOff(true); };

  const nwBars = netWorthBars(snaps, 12);
  const nextStep = checkin.steps.find((s) => s.status === 'todo');

  // Which sections show, and in what order inside their column. Saved on this device only.
  const [loaded, setLoaded] = useState(() => loadSections());
  const sections = loaded.sections;
  const [noticeOff, setNoticeOff] = useState(() => { try { return localStorage.getItem(NOTICE_KEY) === '1'; } catch { return false; } });
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
  const update = (next: HomeSections) => { setLoaded({ sections: next, source: 'saved', nowAlwaysShown: [] }); saveSections(next); };
  const resetToDefault = () => update(copySections(DEFAULT_SECTIONS));
  const useEarlier = () => { forgetSections(); setLoaded(loadSections()); };
  const dismissNotice = () => { try { localStorage.setItem(NOTICE_KEY, '1'); } catch { /* it just comes back next time */ } setNoticeOff(true); };
  const earlier = readCustomLegacy();

  const slices = useMemo(() => spendingSlices(txns, categories, month), [txns, categories, month]);
  const flow = useMemo(() => monthlyFlow(txns, categories, month, 6), [txns, categories, month]);
  const bars = useMemo(() => budgetBars(budget?.rows ?? []), [budget]);

  const assets = net ? [{ name: 'Cash', cents: net.cash }, { name: 'Investments', cents: net.investments }, { name: 'Property', cents: net.property }].filter((s) => s.cents > 0) : [];
  const assetTotal = assets.reduce((s, x) => s + x.cents, 0);
  const owed = net ? -(Math.min(0, net.cards) + Math.min(0, net.loans)) : 0;
  const yearsAway = (g: { startYear: number }) => Math.max(0, g.startYear - year);
  const farthest = Math.max(1, ...goals.map(yearsAway));
  const shortMonth = (m: string) => monthLabel(m).slice(0, 3);
  const checkinOn = checkin.ready && checkin.progress.total > 0;

  const sec = (id: string, title: string, link: ReactNode, body: ReactNode) => (
    <section className="card home-sec" aria-labelledby={`home-${id}-h`}>
      <div className="card-head"><h2 className="card-title" id={`home-${id}-h`}>{title}</h2>{link}</div>
      {body}
    </section>
  );

  const nodes: Record<SectionId, { hidden?: string; node: ReactNode }> = {
    analysis: {
      node: (
        <section className="card home-sec home-analysis" aria-labelledby="home-analysis-h">
          <div className="card-head"><h2 className="card-title" id="home-analysis-h">{SECTION_TITLE.analysis}</h2></div>
          <div className="home-split">
            <div className="home-panel">
              <div className="home-panel-head"><h3>Spending by category</h3><Link className="card-link" to="/reports">Reports</Link></div>
              {slices.length === 0
                ? <p className="muted">No spending recorded in {monthLabel(month)} yet.</p>
                : <Donut slices={slices} label={`Spending by category in ${monthLabel(month)}, ${formatCents(spending.spentCents)} in total`} center={<><strong>{formatCents(spending.spentCents)}</strong><span className="muted">spent</span></>} />}
            </div>
            <div className="home-panel">
              <div className="home-panel-head"><h3>Budget progress</h3><Link className="card-link" to="/budget">Budget</Link></div>
              {bars.length === 0
                ? <p className="muted">Assign money to categories on the Budget page to track it here.</p>
                : <BarList bars={bars.map((b) => ({ name: b.name, ratio: b.ratio, over: b.over, overLabel: 'Over budget', detail: b.fundsCents > 0 ? `${formatCents(b.spentCents)} of ${formatCents(b.fundsCents)}` : `${formatCents(b.spentCents)}, none set aside` }))} />}
            </div>
          </div>
        </section>
      ),
    },
    cashflow: {
      node: sec('cashflow', SECTION_TITLE.cashflow, <Link className="card-link" to="/reports">Reports</Link>, (
        <>
          {flow.every((f) => f.incomeCents === 0 && f.spentCents === 0)
            ? <p className="muted">Income and spending for the last six months will chart here.</p>
            : <PairedColumns aName="Income" bName="Spent" label={`Income and spending by month: ${flow.map((f) => `${monthLabel(f.month)} ${formatCents(f.incomeCents)} in, ${formatCents(f.spentCents)} out`).join('; ')}`} points={flow.map((f) => ({ label: shortMonth(f.month), a: f.incomeCents, b: f.spentCents, partial: f.month === month }))} />}
          {!flow.every((f) => f.incomeCents === 0 && f.spentCents === 0) && <p className="muted home-note">{monthLabel(month)} is still in progress, so its columns show the month so far.</p>}
        </>
      )),
    },
    breakdown: {
      node: sec('breakdown', SECTION_TITLE.breakdown, <Link className="card-link" to="/networth">Net worth</Link>, (
        <OwnOweBars assetsCents={assetTotal} owedCents={owed} parts={assets} empty={<p className="muted">Add accounts, investments or property to see the mix.</p>} />
      )),
    },
    recent: {
      node: sec('recent', SECTION_TITLE.recent, <Link className="card-link" to="/transactions">All</Link>, (
        recent.length === 0 ? (
          <EmptyState title="No transactions yet" action={<button className="primary" onClick={openAddTransaction}>Add a transaction</button>}>Add one by hand or import a bank file.</EmptyState>
        ) : recent.map((t) => (
          <Link className="list-row home-txn" key={t.id} to={`/account/${t.accountId}`}>
            <DateTile iso={t.date} today={today} size="sm" />
            <span className="home-txn-main"><strong>{t.payee || '(no payee)'}</strong><span className="sub">{acctName(t.accountId)}</span></span>
            <span className={`amt ${t.amountCents < 0 ? '' : 'pos'}`}>{signedCents(t.amountCents)}</span>
          </Link>
        ))
      )),
    },
    comingup: { node: <ComingUp limit={5} withDownload={false} /> },
    checkin: {
      hidden: checkinOn ? undefined : 'There is no check-in to show yet.',
      node: sec('checkin', SECTION_TITLE.checkin, <Link className="card-link" to="/checkin">{checkin.progress.complete ? 'Done ✓' : 'Open'}</Link>, (
        <CheckinSteps steps={checkin.steps} done={checkin.progress.done} total={checkin.progress.total} complete={checkin.progress.complete} nextTitle={nextStep?.title} streak={checkin.streak} />
      )),
    },
    goals: {
      node: sec('goals', SECTION_TITLE.goals, <Link className="card-link" to="/goals">Goals</Link>, (
        goals.length === 0 ? (
          <EmptyState title="No goals yet" action={<Link className="btn" to="/goals">Plan a goal</Link>}>College, a purchase, or retirement.</EmptyState>
        ) : (
          <BarList bars={goals.map((g) => ({ name: g.name, ratio: Math.max(0.04, yearsAway(g) / farthest), detail: yearsAway(g) === 0 ? `now (${g.startYear})` : `${g.startYear} · ${yearsAway(g)} yr` }))} />
        )
      )),
    },
  };

  const column = (ids: SectionId[]) => ids.map((id, i) => {
    const s = nodes[id];
    if (s.hidden && !editing) return null;
    const title = SECTION_TITLE[id];
    return (
      <div key={id} data-section={id} className={`home-slot${editing ? ' editing' : ''}`}>
        {editing && (
          <div className="hc-bar">
            <span className="grow">{title}</span>
            <button aria-label={`Move ${title} earlier`} disabled={i === 0} onClick={() => update(moveSection(sections, id, -1))}>↑</button>
            <button aria-label={`Move ${title} later`} disabled={i === ids.length - 1} onClick={() => update(moveSection(sections, id, 1))}>↓</button>
            <button aria-label={`Hide ${title}`} onClick={() => update(hideSection(sections, id))}>Hide</button>
          </div>
        )}
        {s.hidden ? <div className="card hc-stub"><p className="muted" style={{ margin: 0 }}>{s.hidden}</p></div> : s.node}
      </div>
    );
  });

  const fixedNames: Record<string, string> = { networth: 'the net-worth panel', month: 'the month figures', attention: 'Needs attention', start: 'Get started' };

  return (
    <>
      <PageHeader
        title="Home"
        eyebrow="Ledger"
        className="home-head"
        description="Where you stand today, and what needs a look."
        actions={
          <>
            {!editing && checkinOn && !checkin.progress.complete && <Link className="btn" to="/checkin">Monthly check-in · {checkin.progress.done}/{checkin.progress.total}</Link>}
            {!editing && <button className="ghost" disabled={pricing} onClick={refreshPrices}>{pricing ? 'Refreshing…' : 'Refresh prices'}</button>}
            <button className={editing ? 'primary' : 'ghost'} onClick={() => setEditing(!editing)}>{editing ? 'Done' : 'Edit Home'}</button>
          </>
        }
      />
      {priceMsg && (
        <p className={priceMsg.startsWith('Updated') ? 'ok' : 'muted'}>
          {priceMsg}
          {priceMsg.startsWith('Save your API key') && <> <Link to="/investments">Add it on Investments, Prices</Link></>}
        </p>
      )}

      <div className="home-page">
        {loaded.source === 'carried' && !noticeOff && (
          <div className="card home-notice" role="status">
            <div>
              <strong>Home has a new arrangement.</strong>{' '}
              <span>Your earlier order and the cards you removed were carried over where they fit. Card widths no longer apply{loaded.nowAlwaysShown.length > 0 ? `, and ${loaded.nowAlwaysShown.map((id) => fixedNames[id]).join(', ')} now always show` : ''}. Your earlier settings are kept on this device.</span>
            </div>
            <div className="row">
              <button onClick={() => { resetToDefault(); dismissNotice(); }}>Use the new default</button>
              <button className="link" onClick={dismissNotice}>Dismiss</button>
            </div>
          </div>
        )}

        {editing && (
          <div className="card edit-panel">
            <div className="card-head"><h2 className="card-title">Edit Home</h2><button className="link" onClick={resetToDefault}>Reset to default</button></div>
            <p className="muted">Move a section up or down inside its column, or hide it. The net-worth panel, Needs attention and Get started stay where they are. This arrangement is saved on this device only.</p>
            {sections.hidden.length > 0
              ? <div className="row"><span className="muted">Hidden:</span>{sections.hidden.map((id) => <button key={id} onClick={() => update(showSection(sections, id))}>+ {SECTION_TITLE[id]}</button>)}</div>
              : <p className="muted" style={{ margin: 0 }}>Every section is on the page.</p>}
            {earlier && <p className="muted" style={{ margin: 'var(--sp-3) 0 0' }}>You also have an earlier Home layout saved. It has not been changed. <button className="link" onClick={useEarlier}>Use my earlier arrangement again</button></p>}
          </div>
        )}

        <HomeHero
          netCents={net?.total ?? 0}
          change={change}
          nwBars={nwBars}
          monthName={monthLabel(month)}
          incomeCents={spending.incomeCents}
          spentCents={spending.spentCents}
          readyCents={budget ? budget.readyToAssign : null}
          assetsCents={net && (assetTotal > 0 || owed > 0) ? assetTotal : null}
          owedCents={net && (assetTotal > 0 || owed > 0) ? owed : null}
        />

        <section className="card home-attn" aria-labelledby="home-attn-h">
          <div className="card-head"><h2 className="card-title" id="home-attn-h">Needs attention</h2>{alerts.length > 0 && <span className="badge">{alerts.length}</span>}</div>
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

        {showOnboard && (
          <div className="card home-start">
            <div className="home-start-row">
              <strong className="home-start-title">Get started</strong>
              <span className="muted home-start-count">{stepsDone} of {steps.length} done</span>
              <div className="progress home-start-bar" role="progressbar" aria-label="Setup progress" aria-valuenow={stepsDone} aria-valuemin={0} aria-valuemax={steps.length}><div style={{ width: `${(stepsDone / steps.length) * 100}%` }} /></div>
              {nextOnboard && <span className="home-start-next"><span className="home-start-eyebrow">Next</span><Link to={nextOnboard.to}>{nextOnboard.label}</Link></span>}
              <span className="home-start-acts">
                <button className="link" aria-expanded={stepsOpen} aria-controls="home-start-steps" onClick={() => setStepsOpen(!stepsOpen)}>{stepsOpen ? 'Hide steps' : 'Show all steps'}</button>
                <button className="link" onClick={dismissOnboard}>Dismiss</button>
              </span>
            </div>
            {stepsOpen && (
              <ul className="onboard-steps" id="home-start-steps">
                {steps.map((x) => (
                  <li key={x.to} className={x.done ? 'done' : ''}>
                    <span className="tick" aria-hidden="true">{x.done ? '✓' : ''}</span>
                    <Link to={x.to}>{x.label}</Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="home-cols">
          <div className="home-primary">{column(sections.primary)}</div>
          <div className="home-side">{column(sections.side)}</div>
        </div>
      </div>
    </>
  );
}
