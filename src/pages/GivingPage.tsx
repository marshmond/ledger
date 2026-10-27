import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import type { Donation } from '../types';
import { formatCents, todayISO } from '../lib/money';
import { DEFAULT_SETTINGS } from '../lib/income';
import { bunching, charityTotals, deductionAnalysis, gainAvoided, giftsInYear, reminders } from '../lib/giving';
import Collapsible from './Collapsible';
import { MoneyField } from './fields';
import { useTaxPlanData } from './useTaxPlanData';
import { PageHeader } from '../ui/components';

const KIND: Record<Donation['kind'], string> = { cash: 'Cash or check', stock: 'Stock or fund shares', other: 'Other property' };
const LTCG_RATE = 0.15;

/** Charitable gifts: what you gave, the tax effect, whether bunching would help, and the paperwork to keep. */
export default function GivingPage() {
  const thisYear = Number(todayISO().slice(0, 4));
  const [year, setYear] = useState(thisYear);
  const donations = useLiveQuery(() => db.donations.toArray(), []) ?? [];
  const settings = useLiveQuery(() => db.taxSettings.toArray(), []) ?? [];
  const plan = useTaxPlanData(year);

  const [date, setDate] = useState(todayISO());
  const [charity, setCharity] = useState('');
  const [kind, setKind] = useState<Donation['kind']>('cash');
  const [amt, setAmt] = useState(0);
  const [basis, setBasis] = useState(0);
  const [longTerm, setLongTerm] = useState(true);
  const [receipt, setReceipt] = useState(false);
  const [note, setNote] = useState('');
  const [other, setOther] = useState<number | null>(null);
  const [msg, setMsg] = useState('');

  const y = useMemo(() => giftsInYear(donations, year), [donations, year]);
  const byCharity = useMemo(() => charityTotals(donations, year), [donations, year]);
  const notes = reminders(y);
  const avoided = y.items.reduce((s, d) => s + gainAvoided(d, LTCG_RATE), 0);
  const tables = plan.tables;
  const taxSettings = settings.find((s) => s.year === year);
  const otherItemized = other ?? taxSettings?.itemizedDeductionCents ?? 0;
  const rate = plan.room?.rate ?? 0.22;
  const analysis = tables ? deductionAnalysis({ giftsCents: y.deductibleCents, otherItemizedCents: otherItemized, standardCents: tables.stdDeductionMFJ, marginalRate: rate }) : null;
  const typical = donations.length ? y.deductibleCents || giftsInYear(donations, year - 1).deductibleCents : 0;
  const bunch = tables && typical > 0 ? bunching({ yearlyGiftCents: typical, otherItemizedCents: otherItemized, standardCents: tables.stdDeductionMFJ, marginalRate: rate }) : null;
  const years = [...new Set([thisYear, thisYear - 1, ...donations.map((d) => Number(d.date.slice(0, 4)))])].sort((a, b) => b - a);
  const charities = [...new Set(donations.map((d) => d.charity.trim()).filter(Boolean))];

  async function add() {
    if (amt <= 0 || !date) return;
    const d: Donation = { date, charity: charity.trim(), kind, amountCents: amt, receipt, note: note.trim() };
    if (kind !== 'cash') {
      d.basisCents = basis;
      d.longTerm = longTerm;
    }
    await db.donations.add(d);
    setAmt(0);
    setBasis(0);
    setNote('');
    setReceipt(false);
  }

  async function useInEstimate() {
    if (!analysis) return;
    const cur = taxSettings ?? DEFAULT_SETTINGS(year);
    await db.taxSettings.put({ ...cur, year, itemizedDeductionCents: analysis.itemizedCents });
    setMsg(`Income tab updated: itemized deductions for ${year} are now ${formatCents(analysis.itemizedCents)}.`);
  }

  return (
    <>
      <PageHeader title="Charitable giving" description="Charitable gifts, their tax value, and the paperwork to keep." about={<>Log your gifts to see what they are worth as a deduction, whether itemizing pays, and the paperwork to keep. Giving shares you have held more than a year, instead of cash,
        deducts their full value and the gain is never taxed. See which shares in <Link to="/taxplan">Tax planning</Link>. This is a planning estimate, not tax advice.</>} actions={<><label className="row">Year<select value={year} onChange={(e) => setYear(Number(e.target.value))}>{years.map((v) => <option key={v} value={v}>{v}</option>)}</select></label></>} />

      <div className="tiles">
        <div className="tile"><div className="muted">Given in {year}</div><div className="v">{formatCents(y.givenCents)}</div><div className="muted" style={{ fontSize: '0.8rem' }}>{y.count} gift{y.count === 1 ? '' : 's'}</div></div>
        <div className="tile"><div className="muted">Cash</div><div className="v">{formatCents(y.cashCents)}</div></div>
        <div className="tile"><div className="muted">Shares and property</div><div className="v">{formatCents(y.propertyCents)}</div></div>
        <div className="tile"><div className="muted">Gain tax avoided</div><div className="v pos">{formatCents(avoided)}</div><div className="muted" style={{ fontSize: '0.8rem' }}>at {Math.round(LTCG_RATE * 100)}%</div></div>
      </div>

      {notes.map((n) => <p key={n.id} className="warn">{n.message}</p>)}

      <Collapsible id="giving.add" title="Log a gift">
        <div className="row">
          <label className="f">Date<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label className="f">Charity<input list="charities" value={charity} onChange={(e) => setCharity(e.target.value)} placeholder="Food Bank" /></label>
          <datalist id="charities">{charities.map((c) => <option key={c} value={c} />)}</datalist>
          <label className="f">What you gave
            <select value={kind} onChange={(e) => setKind(e.target.value as Donation['kind'])}>{(Object.keys(KIND) as Donation['kind'][]).map((k) => <option key={k} value={k}>{KIND[k]}</option>)}</select>
          </label>
          <MoneyField key={`a${donations.length}`} label={kind === 'cash' ? 'Amount' : 'Market value on the day'} cents={amt} onChange={setAmt} width={120} />
          {kind !== 'cash' && <MoneyField key={`b${donations.length}`} label="What you paid for it" cents={basis} onChange={setBasis} width={120} />}
        </div>
        {kind !== 'cash' && (
          <div className="checks wrap">
            <label className="chk"><input type="checkbox" checked={longTerm} onChange={(e) => setLongTerm(e.target.checked)} /> I held it more than a year (then the full market value is deductible)</label>
          </div>
        )}
        <div className="row">
          <label className="f" style={{ flex: 1 }}>Note<input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Year-end appeal, donor-advised fund…" /></label>
          <label className="chk"><input type="checkbox" checked={receipt} onChange={(e) => setReceipt(e.target.checked)} /> I have the charity’s written acknowledgment</label>
          <button className="primary" disabled={amt <= 0} onClick={add}>Add gift</button>
        </div>
        {kind === 'stock' && <p className="muted">After the transfer clears, remove those shares from the holding on the Investments tab (use the lot’s remove button, not a sale, because nothing is sold and no gain is realized).</p>}
      </Collapsible>

      <Collapsible id="giving.list" title={`Gifts in ${year}`}>
        {y.items.length === 0 ? <p className="muted">No gifts logged for {year}.</p> : (
          <div className="scroll-x">
            <table>
              <thead><tr><th>Date</th><th>Charity</th><th>What</th><th className="num">Value</th><th className="num">Deductible</th><th>Receipt</th><th /></tr></thead>
              <tbody>
                {y.items.map((d) => (
                  <tr key={d.id}>
                    <td>{d.date}</td><td>{d.charity || '—'}{d.note && <div className="muted" style={{ fontSize: '0.75rem' }}>{d.note}</div>}</td>
                    <td>{KIND[d.kind]}{d.kind !== 'cash' && d.basisCents !== undefined && <div className="muted" style={{ fontSize: '0.75rem' }}>cost {formatCents(d.basisCents)}, {d.longTerm === false ? 'short-term' : 'long-term'}</div>}</td>
                    <td className="num">{formatCents(d.amountCents)}</td>
                    <td className="num">{formatCents(d.kind === 'cash' ? d.amountCents : d.longTerm === false ? Math.min(d.amountCents, d.basisCents ?? d.amountCents) : d.amountCents)}</td>
                    <td><input type="checkbox" aria-label="Receipt on file" checked={!!d.receipt} onChange={(e) => db.donations.update(d.id!, { receipt: e.target.checked })} /></td>
                    <td><button className="link danger" onClick={() => confirm('Delete this gift?') && db.donations.delete(d.id!)}>delete</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {byCharity.length > 1 && (
          <table><thead><tr><th>By charity</th><th className="num">Total</th></tr></thead><tbody>{byCharity.map((c) => <tr key={c.charity}><td>{c.charity} <span className="muted">({c.count})</span></td><td className="num">{formatCents(c.cents)}</td></tr>)}</tbody></table>
        )}
      </Collapsible>

      <Collapsible id="giving.tax" title="Does it lower my tax?">
        {!analysis ? <p className="warn">Add tax tables for {year} on the <Link to="/income">Income</Link> tab first.</p> : (
          <>
            <div className="row">
              <MoneyField key={`o${year}-${taxSettings?.itemizedDeductionCents ?? 0}`} label="Other itemized deductions (mortgage interest, state and local tax up to the cap, medical), not counting gifts" cents={otherItemized} onChange={setOther} width={140} />
            </div>
            <table><tbody>
              <tr><td>Standard deduction</td><td className="num">{formatCents(analysis.standardCents)}</td></tr>
              <tr><td>Other itemized deductions</td><td className="num">{formatCents(analysis.otherItemizedCents)}</td></tr>
              <tr><td>Gifts (deductible amount)</td><td className="num">{formatCents(analysis.giftsCents)}</td></tr>
              <tr><td><strong>Itemized total</strong></td><td className="num"><strong>{formatCents(analysis.itemizedCents)}</strong></td></tr>
            </tbody></table>
            <p>
              {analysis.itemizes
                ? <>Itemizing beats the standard deduction by <strong>{formatCents(analysis.extraDeductionCents)}</strong>, saving about <strong className="pos">{formatCents(analysis.taxSavedCents)}</strong> at your {Math.round(rate * 100)}% federal bracket. Your gifts account for about {formatCents(analysis.giftBenefitCents)} of that.</>
                : <>Itemized deductions are below the standard deduction, so these gifts do not lower your federal tax this year.</>}
            </p>
            {analysis.itemizes && <div className="row"><button onClick={useInEstimate}>Use {formatCents(analysis.itemizedCents)} in my tax estimate</button>{msg && <span className="ok" role="status">{msg}</span>}</div>}
            {bunch && (
              <div className="card">
                <strong>Bunching</strong>
                <p>
                  {bunch.worthIt
                    ? <>Giving two years of gifts ({formatCents(typical * 2)}) in one year and none the next would add about <strong>{formatCents(bunch.extraDeductionCents)}</strong> of deductions over the two years, saving roughly <strong className="pos">{formatCents(bunch.taxSavedCents)}</strong>. A donor-advised fund lets you take the deduction now and give to charities over time.</>
                    : <>With your usual giving of {formatCents(typical)}, bunching two years together would not add a deduction.</>}
                </p>
              </div>
            )}
            <p className="muted">Cash gifts to public charities are limited to 60% of your income, and gifts of appreciated shares to 30%; the excess carries forward. Not modeled here.</p>
          </>
        )}
      </Collapsible>
    </>
  );
}
