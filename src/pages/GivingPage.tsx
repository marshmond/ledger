import PayeeInput from '../ui/PayeeInput';
import { useMemo, useState } from 'react';
import { Link } from '../core/router';
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
import ConfirmDialog from '../shell/ConfirmDialog';
import { Kind, Lines, PlanHero } from './PlanParts';
import './analysis.css';
import './plan.css';

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
  // D20.1A: the gift whose "Delete" was pressed, by id (never by position or name). Nothing is changed until the dialog's own Delete gift button is pressed.
  const [askGift, setAskGift] = useState<number | null>(null);

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
  // If the gift disappeared while the question was open (deleted on another device), there is nothing left to ask about and the dialog closes by itself.
  const gift = askGift === null ? undefined : donations.find((d) => d.id === askGift);

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
    <div className="an-page pl-page">
      <PageHeader eyebrow="Plan" title="Charitable giving" description="Charitable gifts, their tax value, and the paperwork to keep." about={<>Log your gifts to see what they are worth as a deduction, whether itemizing pays, and the paperwork to keep. Giving shares you have held more than a year, instead of cash,
        deducts their full value and the gain is never taxed. See which shares in <Link to="/taxplan">Tax planning</Link>. This is a planning estimate, not tax advice.</>} actions={<><label className="row">Year<select value={year} onChange={(e) => setYear(Number(e.target.value))}>{years.map((v) => <option key={v} value={v}>{v}</option>)}</select></label></>} />

      <PlanHero
        label={`Given in ${year}`}
        kind={<Kind k="recorded">Recorded gifts</Kind>}
        amount={formatCents(y.givenCents)}
        message={<>{y.count} gift{y.count === 1 ? '' : 's'} you logged for {year}. The tax figures below are estimates of what these gifts could be worth; they are not a filed deduction.</>}
        figs={[
          { label: 'Cash', value: formatCents(y.cashCents), sub: 'checks and cash gifts' },
          { label: 'Shares and property', value: formatCents(y.propertyCents), sub: 'noncash gifts, at market value' },
          { label: 'Gain tax avoided', value: formatCents(avoided), sub: `estimate, at ${Math.round(LTCG_RATE * 100)}%`, kind: <Kind k="estimate">Estimate</Kind> },
        ]}
      />

      {notes.map((n) => <p key={n.id} className="warn pl-reminder" role="note"><strong>Paperwork: </strong>{n.message}</p>)}

      <div className="pl-cols pl-cols--narrow-first">
        <div className="an-stack-col">
          <Collapsible id="giving.add" title="Log a gift">
            <div className="an-form">
              <label className="f">Date<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
              <label className="f">Charity<PayeeInput value={charity} onChange={setCharity} options={charities} placeholder="Food Bank" /></label>
              <label className="f">What you gave
                <select value={kind} onChange={(e) => setKind(e.target.value as Donation['kind'])}>{(Object.keys(KIND) as Donation['kind'][]).map((k) => <option key={k} value={k}>{KIND[k]}</option>)}</select>
              </label>
              <MoneyField key={`a${donations.length}`} label={kind === 'cash' ? 'Amount' : 'Market value on the day'} cents={amt} onChange={setAmt} />
              {kind !== 'cash' && <MoneyField key={`b${donations.length}`} label="What you paid for it" cents={basis} onChange={setBasis} />}
            </div>
            {kind !== 'cash' && (
              <div className="an-checks">
                <label className="chk"><input type="checkbox" checked={longTerm} onChange={(e) => setLongTerm(e.target.checked)} /> I held it more than a year (then the full market value is deductible)</label>
              </div>
            )}
            <label className="f" style={{ marginTop: 'var(--sp-3)' }}>Note<input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Year-end appeal, donor-advised fund…" /></label>
            <div className="an-checks">
              <label className="chk"><input type="checkbox" checked={receipt} onChange={(e) => setReceipt(e.target.checked)} /> I have the charity’s written acknowledgment</label>
            </div>
            <div className="an-actions"><button className="primary" disabled={amt <= 0} onClick={add}>Add gift</button></div>
            {kind === 'stock' && <p className="an-note">After the transfer clears, remove those shares from the holding on the Investments tab (use the lot’s remove button, not a sale, because nothing is sold and no gain is realized).</p>}
          </Collapsible>
        </div>
        <div className="an-stack-col">
          <Collapsible id="giving.list" title={`Gifts in ${year}`}>
            {y.items.length === 0 ? <p className="muted">No gifts logged for {year}.</p> : (
              <div className="an-tablewrap">
                <table className="an-table an-stack" aria-label={`Gifts logged for ${year}`}>
                  <thead><tr><th>Date</th><th>Charity</th><th>What</th><th className="num">Value</th><th className="num">Deductible (est.)</th><th>Receipt</th><th /></tr></thead>
                  <tbody>
                    {y.items.map((d) => (
                      <tr key={d.id}>
                        <td data-label="Date">{d.date}</td>
                        <td className="an-full"><span className="an-title">{d.charity || '—'}</span>{d.note && <span className="an-sub">{d.note}</span>}</td>
                        <td data-label="What"><span className={d.kind === 'cash' ? 'an-kind' : 'an-kind an-kind--projected'}>{d.kind === 'cash' ? 'Cash' : d.kind === 'stock' ? 'Shares' : 'Property'}</span>{d.kind !== 'cash' && d.basisCents !== undefined && <span className="an-sub">cost {formatCents(d.basisCents)}, {d.longTerm === false ? 'short-term' : 'long-term'}</span>}</td>
                        <td className="num" data-label="Value">{formatCents(d.amountCents)}</td>
                        <td className="num" data-label="Deductible (est.)">{formatCents(d.kind === 'cash' ? d.amountCents : d.longTerm === false ? Math.min(d.amountCents, d.basisCents ?? d.amountCents) : d.amountCents)}</td>
                        <td data-label="Receipt"><label className="chk pl-receipt"><input type="checkbox" aria-label="Receipt on file" checked={!!d.receipt} onChange={(e) => db.donations.update(d.id!, { receipt: e.target.checked })} /><span>{d.receipt ? 'On file' : 'Not on file'}</span></label></td>
                        <td className="an-cell-act"><button className="link danger" aria-label={`Delete gift to ${d.charity || 'charity'} on ${d.date}`} onClick={() => setAskGift(d.id!)}>delete</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {byCharity.length > 1 && (
              <div className="an-tablewrap" style={{ marginTop: 'var(--sp-4)' }}>
                <table className="an-table"><thead><tr><th>By charity</th><th className="num">Total</th></tr></thead><tbody>{byCharity.map((c) => <tr key={c.charity}><td>{c.charity} <span className="muted">({c.count})</span></td><td className="num">{formatCents(c.cents)}</td></tr>)}</tbody></table>
              </div>
            )}
          </Collapsible>
        </div>

      </div>

      <Collapsible id="giving.tax" title="Does it lower my tax?">
        {!analysis ? <p className="warn">Add tax tables for {year} on the <Link to="/income">Income</Link> tab first.</p> : (
          <div className="an-split an-split--even">
            <div className="an-stack-col">
              <p className="an-note" style={{ margin: 0 }}><Kind k="estimate">Estimate</Kind> What your logged gifts might be worth as a deduction. Nothing here has been filed.</p>
              <MoneyField key={`o${year}-${taxSettings?.itemizedDeductionCents ?? 0}`} label="Other itemized deductions (mortgage interest, state and local tax up to the cap, medical), not counting gifts" cents={otherItemized} onChange={setOther} />
              <Lines rows={[
                { label: 'Standard deduction', value: formatCents(analysis.standardCents) },
                { label: 'Other itemized deductions', value: formatCents(analysis.otherItemizedCents) },
                { label: 'Gifts (deductible amount)', value: formatCents(analysis.giftsCents) },
                { label: 'Itemized total', value: formatCents(analysis.itemizedCents), strong: true },
              ]} />
              <p style={{ margin: 0 }}>
                {analysis.itemizes
                  ? <>Itemizing beats the standard deduction by <strong>{formatCents(analysis.extraDeductionCents)}</strong>, saving about <strong>{formatCents(analysis.taxSavedCents)}</strong> at your {Math.round(rate * 100)}% federal bracket. Your gifts account for about {formatCents(analysis.giftBenefitCents)} of that.</>
                  : <>Itemized deductions are below the standard deduction, so these gifts do not lower your federal tax this year.</>}
              </p>
              {analysis.itemizes && <div className="an-actions" style={{ margin: 0 }}><button onClick={useInEstimate}>Use {formatCents(analysis.itemizedCents)} in my tax estimate</button>{msg && <span className="ok" role="status">{msg}</span>}</div>}
            </div>
            <div className="an-stack-col">
              {bunch && (
                <section className="an-card an-card--soft" aria-labelledby="gv-bunch">
                  <h3 className="an-h2" id="gv-bunch" style={{ fontSize: 'var(--fs-base)' }}>Bunching <Kind k="estimate">Estimate</Kind></h3>
                  <p>
                    {bunch.worthIt
                      ? <>Giving two years of gifts ({formatCents(typical * 2)}) in one year and none the next would add about <strong>{formatCents(bunch.extraDeductionCents)}</strong> of deductions over the two years, saving roughly <strong>{formatCents(bunch.taxSavedCents)}</strong>. A donor-advised fund lets you take the deduction now and give to charities over time.</>
                      : <>With your usual giving of {formatCents(typical)}, bunching two years together would not add a deduction.</>}
                  </p>
                </section>
              )}
              <p className="an-note" style={{ margin: 0 }}>Cash gifts to public charities are limited to 60% of your income, and gifts of appreciated shares to 30%; the excess carries forward. Not modeled here.</p>
            </div>
          </div>
        )}
      </Collapsible>

      {gift && (
        <ConfirmDialog
          title="Delete gift?"
          confirmLabel="Delete gift"
          busyLabel="Deleting…"
          onCancel={() => setAskGift(null)}
          onConfirm={async () => { await db.donations.delete(gift.id!); setAskGift(null); }}
        >
          <p><strong>Gift to {gift.charity || 'charity'}</strong><br /><span className="muted small">{gift.date} · {formatCents(gift.amountCents)} · {KIND[gift.kind]}</span></p>
          <p>This removes the gift from your giving log, so it is no longer counted in the totals and estimates on this page. An amount you already copied into your tax estimate is not changed.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}
