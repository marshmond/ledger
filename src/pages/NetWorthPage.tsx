import { useState } from 'react';
import { Link } from '../core/router';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import type { Property } from '../types';
import { formatCents, todayISO } from '../lib/money';
import { monthLabel } from '../lib/dates';
import { loadNetWorth, loanOwedById } from '../lib/netWorthLive';
import { equityOf, latestValue, valueAgeDays } from '../lib/property';
import { changeOver, snapshotOf, sortedSnapshots } from '../lib/snapshots';
import { NetWorthChart } from '../ui/charts';
import { netWorthBars } from '../lib/homeCharts';
import Collapsible from './Collapsible';
import { MoneyField } from './fields';
import { PageHeader } from '../ui/components';
import { missingMonths, signedWords } from './analysisPresentation';
import './analysis.css';

const KIND_LABEL: Record<Property['kind'], string> = { home: 'Home', vehicle: 'Vehicle', other: 'Other property' };

function PropertyCard({ p, loans }: { p: Property; loans: { id: number; name: string }[] }) {
  const today = todayISO();
  const values = useLiveQuery(() => db.propertyValues.where('propertyId').equals(p.id!).toArray(), [p.id]) ?? [];
  const owed = useLiveQuery(() => loanOwedById(db, today), [today]) ?? new Map<number, number>();
  const [date, setDate] = useState(today);
  const [amt, setAmt] = useState(0);
  const cur = latestValue(values, p.id!);
  const eq = equityOf(p, values, owed);
  const age = valueAgeDays(values, p.id!, today);
  const sorted = [...values].sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div className="an-card an-prop">
      <div className="an-prop-head">
        <div className="an-stack-col" style={{ gap: 'var(--sp-1)' }}>
          <div className="an-acct-name"><strong>{p.name}</strong> <span className="badge">{KIND_LABEL[p.kind]}</span>{p.excluded && <span className="badge"> not counted</span>}</div>
          {cur && <div className="an-small muted">Value you entered, as of {cur.date}{age !== null && age > 365 && <span className="warn"> · over a year old, update it</span>}</div>}
        </div>
        <div className="an-prop-val">{cur ? formatCents(cur.valueCents) : <span className="an-kind an-kind--unknown">no value yet</span>}</div>
      </div>
      {eq && p.loanIds.length > 0 && (
        <table className="an-table">
          <tbody>
            <tr><td>Owed on secured loans</td><td className="num">{formatCents(eq.owedCents)}</td></tr>
            <tr><td><strong>Equity</strong></td><td className="num"><strong>{formatCents(eq.equityCents)}</strong></td></tr>
          </tbody>
        </table>
      )}
      <div className="an-form">
        <label className="f">Date<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <MoneyField key={values.length} label="New value" cents={amt} onChange={setAmt} width={130} />
        <div><button disabled={amt <= 0 || !date} onClick={async () => { await db.propertyValues.add({ propertyId: p.id!, date, valueCents: amt, note: '' }); setAmt(0); }}>Add value</button></div>
      </div>
      {loans.length > 0 && (
        <div className="an-checks" style={{ marginTop: 0 }}>
          <div className="an-small muted">Loans secured by this (for equity)</div>
          {loans.map((l) => (
            <label className="chk" key={l.id}>
              <input type="checkbox" checked={p.loanIds.includes(l.id)} onChange={(e) => db.properties.update(p.id!, { loanIds: e.target.checked ? [...p.loanIds, l.id] : p.loanIds.filter((x) => x !== l.id) })} /> {l.name}
            </label>
          ))}
        </div>
      )}
      <details>
        <summary>Value history ({sorted.length})</summary>
        <table className="an-table an-stack">
          <thead><tr><th>Date</th><th className="num">Value</th><th /></tr></thead>
          <tbody>
            {sorted.map((v) => (
              <tr key={v.id}><td data-label="Date">{v.date}</td><td className="num" data-label="Value">{formatCents(v.valueCents)}</td><td className="an-cell-act"><button className="link danger" onClick={() => confirm('Delete this value?') && db.propertyValues.delete(v.id!)}>delete</button></td></tr>
            ))}
          </tbody>
        </table>
      </details>
      <div className="an-actions" style={{ marginTop: 0, justifyContent: 'space-between' }}>
        <label className="chk"><input type="checkbox" checked={!p.excluded} onChange={(e) => db.properties.update(p.id!, { excluded: !e.target.checked })} /> Count in net worth</label>
        <button className="link danger" onClick={async () => { if (!confirm(`Delete ${p.name} and its value history?`)) return; await db.propertyValues.where('propertyId').equals(p.id!).delete(); await db.properties.delete(p.id!); }}>delete</button>
      </div>
    </div>
  );
}

/** Net worth now, over time, and the property that is part of it. */
export default function NetWorthPage() {
  const today = todayISO();
  const nw = useLiveQuery(() => loadNetWorth(db, today), [today]);
  const snaps = useLiveQuery(() => db.netWorthSnapshots.toArray(), []) ?? [];
  const props = useLiveQuery(() => db.properties.toArray(), []) ?? [];
  const loans = (useLiveQuery(() => db.loans.toArray(), []) ?? []).filter((l) => !l.scenario).map((l) => ({ id: l.id!, name: l.name }));
  const sorted = sortedSnapshots(snaps);
  const change = changeOver(snaps);
  const gaps = missingMonths(sorted.map((s) => s.date));

  const [pName, setPName] = useState('');
  const [pKind, setPKind] = useState<Property['kind']>('home');
  const [pVal, setPVal] = useState(0);
  const [pDate, setPDate] = useState(today);
  const [hDate, setHDate] = useState('');
  const [hTotal, setHTotal] = useState(0);

  async function addProperty() {
    if (!pName.trim()) return;
    const id = await db.properties.add({ name: pName.trim(), kind: pKind, loanIds: pKind === 'home' ? loans.filter((l) => /mortgage|heloc|home/i.test(l.name)).map((l) => l.id) : [] });
    if (pVal > 0) await db.propertyValues.add({ propertyId: id, date: pDate, valueCents: pVal, note: '' });
    setPName('');
    setPVal(0);
  }

  return (
    <div className="an-page">
      <PageHeader eyebrow="Invest" title="Net worth" description="What you own and owe, now and over time." />
      {nw && (
        <>
          <section className="an-hero" aria-label="Net worth today">
            <div>
              <div className="an-hero-label">Net worth today <span className="an-kind">Current</span></div>
              <div className="an-hero-amt">{formatCents(nw.total)}</div>
              {change ? (
                <p className="an-hero-msg">
                  {change.sinceCents >= 0 ? 'Up' : 'Down'} <strong>{formatCents(Math.abs(change.sinceCents))}</strong> since {change.since}. That is the latest saved point from a year ago or more, or the earliest saved point if the history is shorter.
                </p>
              ) : (
                <p className="an-hero-msg">The change over time appears once two points are saved.</p>
              )}
            </div>
            <dl className="an-hero-figs">
              <div><dt>Saved points</dt><dd>{sorted.length}<span className="an-sub">one is saved each month you open the app</span></dd></div>
              <div><dt>Latest saved point</dt><dd style={{ fontSize: 'var(--fs-lg)' }}>{sorted.length ? sorted[sorted.length - 1].date : '—'}</dd></div>
              {change && <div><dt>Change since {change.since}</dt><dd>{signedWords(change.sinceCents)}</dd></div>}
              <div><dt>Property values</dt><dd>{props.length}<span className="an-sub">entered by you, never guessed</span></dd></div>
            </dl>
          </section>

          <div className="an-split an-split--even">
            <section className="an-card" aria-labelledby="nw-assets">
              <div className="an-head"><h2 className="an-h2" id="nw-assets">What you own</h2><span className="an-kind">Current values</span></div>
              <ul className="an-lines">
                <li className="an-line"><span><span className="an-line-name">Cash</span><br /><span className="an-line-src">Checking and savings, from <Link to="/accounts">Accounts</Link></span></span><span className="an-line-amt">{formatCents(nw.cash)}</span></li>
                <li className="an-line"><span><span className="an-line-name">Investments</span><br /><span className="an-line-src">Holdings at their stored prices, from <Link to="/investments">Investments</Link></span></span><span className="an-line-amt">{formatCents(nw.investments)}</span></li>
                <li className="an-line"><span><span className="an-line-name">Property</span><br /><span className="an-line-src">Values you entered (see Home and other property below)</span></span><span className="an-line-amt">{formatCents(nw.property)}</span></li>
              </ul>
            </section>
            <section className="an-card" aria-labelledby="nw-owe">
              <div className="an-head"><h2 className="an-h2" id="nw-owe">What you owe</h2><span className="an-kind">Current balances</span></div>
              <ul className="an-lines">
                <li className="an-line"><span><span className="an-line-name">Credit cards</span><br /><span className="an-line-src">Balances owed, from <Link to="/accounts">Accounts</Link></span></span><span className="an-line-amt">{formatCents(nw.cards)}</span></li>
                <li className="an-line"><span><span className="an-line-name">Loans</span><br /><span className="an-line-src">Mortgage, HELOC and other loans, from <Link to="/debt">Debt</Link></span></span><span className="an-line-amt">{formatCents(nw.loans)}</span></li>
                <li className="an-line-note an-small muted" style={{ padding: 'var(--sp-2) 0 0' }}>Amounts owed are shown as negative numbers because they lower your net worth. A negative balance is a debt, not an error.</li>
              </ul>
            </section>
          </div>
        </>
      )}

      <Collapsible id="networth.history" title="History">
        {sorted.length < 2 ? (
          <p className="muted">
            The app saves a point each month when you open it, so the chart fills in as time passes ({sorted.length} saved so far). You can add past months below.
          </p>
        ) : (
          <>
            <p className="an-note" style={{ margin: '0 0 var(--sp-3)' }}>Each saved point is what was recorded that month; nothing is estimated between points. Points entered by hand carry only a total (no breakdown).</p>
            <NetWorthChart bars={netWorthBars(snaps, 60)} label="Assets and amounts owed by month, with net worth as a line" />
            {gaps.length > 0 && (
              <p className="an-note" role="note">
                No point was saved for {gaps.map((g) => monthLabel(g)).join(', ')}. The chart draws saved points side by side, so a missing month is not drawn as empty space; it is simply not there.
              </p>
            )}
          </>
        )}
        <div className="an-form an-form--wide" style={{ marginTop: 'var(--sp-4)' }}>
          <label className="f">Add a past point: date<input type="date" value={hDate} onChange={(e) => setHDate(e.target.value)} /></label>
          <MoneyField key={snaps.length} label="Net worth then" cents={hTotal} onChange={setHTotal} width={140} />
          <div>
            <button
              disabled={!hDate || hTotal === 0}
              onClick={async () => {
                const exists = snaps.some((s) => s.date.slice(0, 7) === hDate.slice(0, 7));
                if (exists && !confirm('There is already a point in that month. Add another?')) return;
                await db.netWorthSnapshots.add({ ...snapshotOf(hDate, { cash: 0, investments: 0, property: 0, cards: 0, loans: 0, total: hTotal }) });
                setHDate('');
                setHTotal(0);
              }}
            >Add</button>
          </div>
        </div>
        {sorted.length > 0 && (
          <details style={{ marginTop: 'var(--sp-3)' }}>
            <summary>All points ({sorted.length})</summary>
            <div className="an-tablewrap">
              <table className="an-table an-matrix">
                <thead><tr><th>Date</th><th className="num">Net worth</th><th className="num">Cash</th><th className="num">Investments</th><th className="num">Property</th><th className="num">Cards</th><th className="num">Loans</th><th /></tr></thead>
                <tbody>
                  {[...sorted].reverse().map((s) => (
                    <tr key={s.id}>
                      <td className="an-lead">{s.date}{s.cashCents === 0 && s.investmentsCents === 0 && s.propertyCents === 0 && s.cardsCents === 0 && s.loansCents === 0 && <span className="an-kind an-kind--manual" style={{ marginLeft: 8 }}>Total only</span>}</td>
                      <td className="num" data-label="Net worth"><strong>{formatCents(s.totalCents)}</strong></td>
                      <td className="num" data-label="Cash">{formatCents(s.cashCents)}</td><td className="num" data-label="Investments">{formatCents(s.investmentsCents)}</td><td className="num" data-label="Property">{formatCents(s.propertyCents)}</td>
                      <td className="num" data-label="Cards">{formatCents(s.cardsCents)}</td><td className="num" data-label="Loans">{formatCents(s.loansCents)}</td>
                      <td className="an-cell-act"><button className="link danger" onClick={() => confirm(`Delete the ${s.date} point?`) && db.netWorthSnapshots.delete(s.id!)}>delete</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="an-scrollhint">Scroll sideways for more columns.</p>
            </div>
          </details>
        )}
      </Collapsible>

      <Collapsible id="networth.property" title="Home and other property">
        <p className="an-note" style={{ marginTop: 0 }}>
          Enter what your home is worth and update it now and then (a recent listing or appraisal, or an online estimate). Value is never guessed. Link your mortgage and
          HELOC from the <Link to="/debt">Debt</Link> page to see equity.
        </p>
        <div className="an-props" style={{ marginTop: 'var(--sp-3)' }}>
          {props.map((p) => <PropertyCard key={p.id} p={p} loans={loans} />)}
          <div className="an-card an-card--soft an-stack-col">
            <h3 className="an-h2" style={{ fontSize: 'var(--fs-base)' }}>Add property</h3>
            <div className="an-form">
              <label className="f">Name<input value={pName} onChange={(e) => setPName(e.target.value)} placeholder="Our house" /></label>
              <label className="f">Kind
                <select value={pKind} onChange={(e) => setPKind(e.target.value as Property['kind'])}>
                  {(Object.keys(KIND_LABEL) as Property['kind'][]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
                </select>
              </label>
              <MoneyField key={`pv${props.length}`} label="Value" cents={pVal} onChange={setPVal} width={130} />
              <label className="f">As of<input type="date" value={pDate} onChange={(e) => setPDate(e.target.value)} /></label>
            </div>
            <div className="an-actions" style={{ marginTop: 0 }}><button className="primary" disabled={!pName.trim()} onClick={addProperty}>Add</button></div>
          </div>
        </div>
      </Collapsible>
    </div>
  );
}
