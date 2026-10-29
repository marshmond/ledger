import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import type { Property } from '../types';
import { formatCents, todayISO } from '../lib/money';
import { loadNetWorth, loanOwedById } from '../lib/netWorthLive';
import { equityOf, latestValue, valueAgeDays } from '../lib/property';
import { changeOver, snapshotOf, sortedSnapshots } from '../lib/snapshots';
import { NetWorthChart } from '../ui/charts';
import { netWorthBars } from '../lib/homeCharts';
import Collapsible from './Collapsible';
import { MoneyField } from './fields';
import { PageHeader } from '../ui/components';

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
    <div className="card">
      <div className="row spread">
        <div>
          <strong>{p.name}</strong> <span className="badge">{KIND_LABEL[p.kind]}</span>{p.excluded && <span className="badge"> not counted</span>}
        </div>
        <div className="row">
          <strong>{cur ? formatCents(cur.valueCents) : 'no value yet'}</strong>
        </div>
      </div>
      {cur && <div className="muted">As of {cur.date}{age !== null && age > 365 && <span className="warn"> · over a year old, update it</span>}</div>}
      {eq && p.loanIds.length > 0 && (
        <table><tbody>
          <tr><td>Owed on secured loans</td><td className="num">{formatCents(eq.owedCents)}</td></tr>
          <tr><td><strong>Equity</strong></td><td className={`num ${eq.equityCents < 0 ? 'neg' : 'pos'}`}><strong>{formatCents(eq.equityCents)}</strong></td></tr>
        </tbody></table>
      )}
      <div className="row" style={{ marginTop: 6 }}>
        <label className="f">Date<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <MoneyField key={values.length} label="New value" cents={amt} onChange={setAmt} width={130} />
        <button disabled={amt <= 0 || !date} onClick={async () => { await db.propertyValues.add({ propertyId: p.id!, date, valueCents: amt, note: '' }); setAmt(0); }}>Add value</button>
      </div>
      {loans.length > 0 && (
        <div className="checks wrap" style={{ marginTop: 6 }}>
          <div className="muted">Loans secured by this (for equity)</div>
          {loans.map((l) => (
            <label className="chk" key={l.id}>
              <input type="checkbox" checked={p.loanIds.includes(l.id)} onChange={(e) => db.properties.update(p.id!, { loanIds: e.target.checked ? [...p.loanIds, l.id] : p.loanIds.filter((x) => x !== l.id) })} /> {l.name}
            </label>
          ))}
        </div>
      )}
      <details style={{ marginTop: 6 }}>
        <summary>Value history ({sorted.length})</summary>
        <table><tbody>
          {sorted.map((v) => (
            <tr key={v.id}><td>{v.date}</td><td className="num">{formatCents(v.valueCents)}</td><td><button className="link danger" onClick={() => confirm('Delete this value?') && db.propertyValues.delete(v.id!)}>delete</button></td></tr>
          ))}
        </tbody></table>
      </details>
      <div className="row" style={{ marginTop: 6 }}>
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
    <>
      <PageHeader title="Net worth" description="What you own and owe, now and over time." />
      {nw && (
        <div className="viz">
          <div className="muted">Net worth today</div>
          <div className={`hero ${nw.total < 0 ? 'neg' : ''}`}>{formatCents(nw.total)}</div>
          {change && (
            <div className="muted">
              {change.sinceCents >= 0 ? 'Up' : 'Down'} <strong className={change.sinceCents >= 0 ? 'pos' : 'neg'}>{formatCents(Math.abs(change.sinceCents))}</strong> since {change.since}
            </div>
          )}
          <div className="tiles">
            <div className="tile"><div className="muted">Cash</div><div className="v">{formatCents(nw.cash)}</div></div>
            <div className="tile"><div className="muted">Investments</div><div className="v">{formatCents(nw.investments)}</div></div>
            <div className="tile"><div className="muted">Property</div><div className="v">{formatCents(nw.property)}</div></div>
            <div className="tile"><div className="muted">Cards</div><div className={`v ${nw.cards < 0 ? 'neg' : ''}`}>{formatCents(nw.cards)}</div></div>
            <div className="tile"><div className="muted">Loans</div><div className={`v ${nw.loans < 0 ? 'neg' : ''}`}>{formatCents(nw.loans)}</div></div>
          </div>
        </div>
      )}

      <Collapsible id="networth.history" title="History">
        {sorted.length < 2 ? (
          <p className="muted">
            The app saves a point each month when you open it, so the chart fills in as time passes ({sorted.length} saved so far). You can add past months below.
          </p>
        ) : (
          <NetWorthChart bars={netWorthBars(snaps, 60)} label="Assets and amounts owed by month, with net worth as a line" />
        )}
        <div className="row">
          <label className="f">Add a past point: date<input type="date" value={hDate} onChange={(e) => setHDate(e.target.value)} /></label>
          <MoneyField key={snaps.length} label="Net worth then" cents={hTotal} onChange={setHTotal} width={140} />
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
        {sorted.length > 0 && (
          <details style={{ marginTop: 6 }}>
            <summary>All points ({sorted.length})</summary>
            <div className="scroll-x">
              <table>
                <thead><tr><th>Date</th><th className="num">Net worth</th><th className="num">Cash</th><th className="num">Investments</th><th className="num">Property</th><th className="num">Cards</th><th className="num">Loans</th><th /></tr></thead>
                <tbody>
                  {[...sorted].reverse().map((s) => (
                    <tr key={s.id}>
                      <td>{s.date}</td><td className="num"><strong>{formatCents(s.totalCents)}</strong></td>
                      <td className="num">{formatCents(s.cashCents)}</td><td className="num">{formatCents(s.investmentsCents)}</td><td className="num">{formatCents(s.propertyCents)}</td>
                      <td className="num">{formatCents(s.cardsCents)}</td><td className="num">{formatCents(s.loansCents)}</td>
                      <td><button className="link danger" onClick={() => confirm(`Delete the ${s.date} point?`) && db.netWorthSnapshots.delete(s.id!)}>delete</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        )}
      </Collapsible>

      <Collapsible id="networth.property" title="Home and other property">
        <p className="muted">
          Enter what your home is worth and update it now and then (a recent listing or appraisal, or an online estimate). Value is never guessed. Link your mortgage and
          HELOC from the <Link to="/debt">Debt</Link> page to see equity.
        </p>
        {props.map((p) => <PropertyCard key={p.id} p={p} loans={loans} />)}
        <div className="card">
          <strong>Add property</strong>
          <div className="row" style={{ marginTop: 6 }}>
            <label className="f">Name<input value={pName} onChange={(e) => setPName(e.target.value)} placeholder="Our house" /></label>
            <label className="f">Kind
              <select value={pKind} onChange={(e) => setPKind(e.target.value as Property['kind'])}>
                {(Object.keys(KIND_LABEL) as Property['kind'][]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
              </select>
            </label>
            <MoneyField key={`pv${props.length}`} label="Value" cents={pVal} onChange={setPVal} width={130} />
            <label className="f">As of<input type="date" value={pDate} onChange={(e) => setPDate(e.target.value)} /></label>
            <button className="primary" disabled={!pName.trim()} onClick={addProperty}>Add</button>
          </div>
        </div>
      </Collapsible>
    </>
  );
}
