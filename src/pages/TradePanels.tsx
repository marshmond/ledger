import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import type { Holding, InvAccount, Sale, SaleMethod, Security, TaxLot } from '../types';
import { formatCents, todayISO } from '../lib/money';
import { addLot, deleteLot, isLongTerm, isTaxable, netForTax, previewSale, realizedFor, recordBuy, recordSale, undoSale, updateLot } from '../lib/lots';
import { MoneyField } from './fields';

const METHOD_LABEL: Record<SaleMethod, string> = {
  fifo: 'First in, first out (oldest shares)',
  hifo: 'Highest cost first',
  lifo: 'Last in, first out (newest shares)',
  average: 'Average cost (all lots, in proportion)',
  specific: 'Pick specific lots',
};
const METHOD_KEY = 'ledger-sale-method';
function loadMethod(): SaleMethod {
  try {
    const v = localStorage.getItem(METHOD_KEY) as SaleMethod | null;
    if (v && v in METHOD_LABEL && v !== 'specific') return v;
  } catch { /* storage unavailable */ }
  return 'fifo';
}

const perShare = (cents: number, shares: number) => (shares > 0 ? formatCents(Math.round(cents / shares)) : '—');
const shortShares = (n: number) => String(Math.round(n * 1e6) / 1e6);

/** The lots behind one taxable holding: edit a lot's date, shares, or cost basis. */
export function LotsPanel({ holding, security, onClose }: { holding: Holding; security: Security | undefined; onClose: () => void }) {
  const lots = useLiveQuery(() => db.taxLots.where('holdingId').equals(holding.id!).toArray(), [holding.id]) ?? [];
  const sorted = [...lots].sort((a, b) => (a.acquiredDate ?? '').localeCompare(b.acquiredDate ?? '') || (a.id ?? 0) - (b.id ?? 0));
  const price = security?.priceCents ?? null;
  const today = todayISO();
  const [adding, setAdding] = useState(false);

  return (
    <div className="card">
      <div className="row spread">
        <strong>{security?.ticker}: tax lots</strong>
        <button className="link" onClick={onClose}>close</button>
      </div>
      <p className="muted">Each purchase is a lot. Edit a lot’s purchase date (it decides short- vs long-term), share count, or total cost. The holding’s totals follow the lots.</p>
      <div className="scroll-x">
        <table>
          <thead><tr><th>Bought</th><th className="num">Shares</th><th className="num">Total cost</th><th className="num">Per share</th><th className="num">Gain / loss</th><th>Term</th><th /></tr></thead>
          <tbody>
            {sorted.map((l) => {
              const value = price === null ? null : Math.round(l.shares * price);
              const gl = value === null ? null : value - l.costBasisCents;
              return (
                <tr key={`${l.id}-${l.shares}-${l.costBasisCents}-${l.acquiredDate}`}>
                  <td>
                    <input type="date" value={l.acquiredDate ?? ''} aria-label="Purchase date" onChange={(e) => updateLot(db, l.id!, { acquiredDate: e.target.value || null })} />
                    {!l.acquiredDate && <div className="warn" style={{ fontSize: '0.75rem' }}>date unknown: counted as long-term</div>}
                    {l.source !== 'buy' && l.source !== 'manual' && <div className="muted" style={{ fontSize: '0.75rem' }}>{l.source === 'opening' ? 'opening balance' : l.source}</div>}
                  </td>
                  <td className="num">
                    <input style={{ width: 90, textAlign: 'right' }} inputMode="decimal" defaultValue={shortShares(l.shares)} aria-label="Lot shares"
                      onBlur={(e) => { const n = Number(e.target.value); if (n > 0 && n !== l.shares) updateLot(db, l.id!, { shares: n, costBasisCents: l.costBasisCents }); else e.target.value = shortShares(l.shares); }} />
                  </td>
                  <td className="num">
                    <MoneyField cents={l.costBasisCents} width={100} onChange={(c) => updateLot(db, l.id!, { costBasisCents: c })} />
                    {l.costBasisCents === 0 && <div className="warn" style={{ fontSize: '0.75rem' }}>enter the cost</div>}
                  </td>
                  <td className="num">{perShare(l.costBasisCents, l.shares)}</td>
                  <td className={`num ${gl === null ? 'muted' : gl < 0 ? 'neg' : 'pos'}`}>{gl === null ? '—' : formatCents(gl)}</td>
                  <td>{isLongTerm(l.acquiredDate, today) ? 'long' : 'short'}</td>
                  <td><button className="link danger" onClick={() => confirm('Remove this lot? The holding shrinks by its shares. (To record a sale, use Sell instead.)') && deleteLot(db, l.id!)}>remove</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {adding ? <AddLot holding={holding} onDone={() => setAdding(false)} /> : <button onClick={() => setAdding(true)}>+ Add a lot</button>}
    </div>
  );
}

function AddLot({ holding, onDone }: { holding: Holding; onDone: () => void }) {
  const [date, setDate] = useState(todayISO());
  const [shares, setShares] = useState('');
  const [cost, setCost] = useState(0);
  const add = async () => {
    const n = Number(shares);
    if (!(n > 0)) return;
    await addLot(db, { accountId: holding.accountId, securityId: holding.securityId, acquiredDate: date || null, shares: n, costBasisCents: cost, source: 'manual' });
    onDone();
  };
  return (
    <div className="row" style={{ marginTop: 6 }}>
      <label className="f">Bought<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
      <label className="f">Shares<input style={{ width: 90 }} inputMode="decimal" value={shares} onChange={(e) => setShares(e.target.value)} /></label>
      <MoneyField label="Total cost" cents={cost} onChange={setCost} width={110} />
      <button className="primary" onClick={add}>Add lot</button>
      <button onClick={onDone}>Cancel</button>
    </div>
  );
}

/** Log a purchase or a sale of a holding. */
export function TradePanel({ mode, account, holding, security, onClose }: { mode: 'buy' | 'sell'; account: InvAccount; holding: Holding; security: Security | undefined; onClose: () => void }) {
  const taxable = isTaxable(account);
  const lots = useLiveQuery(() => db.taxLots.where('holdingId').equals(holding.id!).toArray(), [holding.id]) ?? [];
  const [date, setDate] = useState(todayISO());
  const [shares, setShares] = useState('');
  const [price, setPrice] = useState(security?.priceCents ?? 0);
  const [fees, setFees] = useState(0);
  const [method, setMethod] = useState<SaleMethod>(loadMethod());
  const [pick, setPick] = useState<Record<number, string>>({});
  const [cash, setCash] = useState(false);
  const [reinvest, setReinvest] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const n = Number(shares);
  const specific = useMemo(() => Object.fromEntries(Object.entries(pick).map(([k, v]) => [Number(k), Number(v) || 0])), [pick]);
  const pickedTotal = Object.values(specific).reduce((a, b) => a + b, 0);
  const preview = useMemo(
    () => (mode === 'sell' && taxable && n > 0 && price > 0 && lots.length ? previewSale(lots, { shares: n, pricePerShareCents: price, feesCents: fees, date, method, specific }) : null),
    [mode, taxable, n, price, fees, date, method, specific, lots],
  );

  async function submit() {
    setMsg(null);
    if (mode === 'buy') {
      const r = await recordBuy(db, { accountId: account.id!, securityId: holding.securityId, date, shares: n, pricePerShareCents: price, feesCents: fees, reinvested: reinvest, takeFromCash: cash });
      if (!r.ok) return setMsg({ kind: 'error', text: r.error });
      setMsg({ kind: 'ok', text: `Logged a purchase of ${shortShares(n)} shares.` });
      setShares('');
      return;
    }
    const r = await recordSale(db, { accountId: account.id!, securityId: holding.securityId, date, shares: n, pricePerShareCents: price, feesCents: fees, method, specific, addToCash: cash });
    if (!r.ok) return setMsg({ kind: 'error', text: r.error });
    try { if (method !== 'specific') localStorage.setItem(METHOD_KEY, method); } catch { /* storage unavailable */ }
    const s = r.sale;
    setMsg({ kind: 'ok', text: s.taxable ? `Sold ${shortShares(n)} shares: ${s.gainCents >= 0 ? 'gain' : 'loss'} of ${formatCents(Math.abs(s.gainCents))}.` : `Sold ${shortShares(n)} shares. No tax is calculated in this account.` });
    setShares('');
    setPick({});
  }

  const sellAll = () => setShares(shortShares(holding.shares));

  return (
    <div className="card">
      <div className="row spread">
        <strong>{mode === 'sell' ? 'Sell' : 'Buy'} {security?.ticker}</strong>
        <button className="link" onClick={onClose}>close</button>
      </div>
      {mode === 'sell' && !taxable && <p className="muted">This is a tax-sheltered account, so a sale just lowers the holding. No gain or tax is calculated.</p>}
      <div className="row">
        <label className="f">Date<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label className="f">Shares<input style={{ width: 100 }} inputMode="decimal" value={shares} onChange={(e) => setShares(e.target.value)} placeholder="0" /></label>
        {mode === 'sell' && <button className="link" onClick={sellAll}>all {shortShares(holding.shares)}</button>}
        <MoneyField key={`p${security?.priceCents}`} label={`Price per share${security?.priceCents ? ` (now ${formatCents(security.priceCents)})` : ''}`} cents={price} onChange={setPrice} width={120} />
        <MoneyField label="Fees" cents={fees} onChange={setFees} width={80} />
      </div>
      {mode === 'sell' && taxable && (
        <div className="row">
          <label className="f" style={{ minWidth: 260 }}>Which shares
            <select value={method} onChange={(e) => setMethod(e.target.value as SaleMethod)}>
              {(Object.keys(METHOD_LABEL) as SaleMethod[]).map((m) => <option key={m} value={m}>{METHOD_LABEL[m]}</option>)}
            </select>
          </label>
        </div>
      )}
      {mode === 'sell' && taxable && method === 'specific' && (
        <div className="scroll-x">
          <table>
            <thead><tr><th>Bought</th><th className="num">Shares in lot</th><th className="num">Cost per share</th><th className="num">Sell</th></tr></thead>
            <tbody>
              {[...lots].sort((a, b) => (a.acquiredDate ?? '').localeCompare(b.acquiredDate ?? '')).map((l: TaxLot) => (
                <tr key={l.id}>
                  <td>{l.acquiredDate ?? 'unknown'}</td><td className="num">{shortShares(l.shares)}</td><td className="num">{perShare(l.costBasisCents, l.shares)}</td>
                  <td className="num"><input style={{ width: 90, textAlign: 'right' }} inputMode="decimal" value={pick[l.id!] ?? ''} onChange={(e) => setPick({ ...pick, [l.id!]: e.target.value })} placeholder="0" /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted">Picked {shortShares(pickedTotal)} of {n || 0} shares.{' '}
            <button className="link" onClick={() => { let left = n; const next: Record<number, string> = {}; for (const l of [...lots].sort((a, b) => (a.acquiredDate ?? '').localeCompare(b.acquiredDate ?? ''))) { const t = Math.min(left, l.shares); if (t > 0) next[l.id!] = shortShares(t); left -= t; } setPick(next); }}>fill oldest first</button></p>
        </div>
      )}
      <div className="checks wrap">
        <label className="chk"><input type="checkbox" checked={cash} onChange={(e) => setCash(e.target.checked)} /> {mode === 'sell' ? 'Add the proceeds to this account’s cash' : 'Take the cost out of this account’s cash'}</label>
        {mode === 'buy' && <label className="chk"><input type="checkbox" checked={reinvest} onChange={(e) => setReinvest(e.target.checked)} /> This is a reinvested dividend or distribution</label>}
      </div>
      {preview && (
        <div className="card">
          <strong>If you sell</strong>
          <table><tbody>
            <tr><td>Proceeds (after fees)</td><td className="num">{formatCents(preview.proceedsCents)}</td></tr>
            <tr><td>Cost basis of the shares sold</td><td className="num">{formatCents(preview.basisCents)}</td></tr>
            <tr><td><strong>{preview.gainCents >= 0 ? 'Gain' : 'Loss'}</strong></td><td className={`num ${preview.gainCents < 0 ? 'neg' : 'pos'}`}><strong>{formatCents(preview.gainCents)}</strong></td></tr>
            <tr><td className="muted">Short-term (held a year or less)</td><td className="num">{formatCents(preview.shortTermCents)}</td></tr>
            <tr><td className="muted">Long-term</td><td className="num">{formatCents(preview.longTermCents)}</td></tr>
          </tbody></table>
          {preview.shortfall > 1e-9 && <p className="warn">{method === 'specific' ? `Pick ${shortShares(preview.shortfall)} more shares.` : 'More shares than the lots hold.'}</p>}
          {preview.lots.some((l) => !l.acquiredDate) && <p className="warn">Some lots have no purchase date; they are counted as long-term.</p>}
          {preview.allocs.some((a) => a.lot.costBasisCents === 0) && <p className="warn">A lot being sold has a $0 cost basis, so the whole sale counts as gain. Edit the lot’s cost first if that is wrong.</p>}
        </div>
      )}
      <div className="row" style={{ marginTop: 6 }}>
        <button className="primary" disabled={!(n > 0) || !(price > 0)} onClick={submit}>{mode === 'sell' ? 'Log sale' : 'Log purchase'}</button>
        {msg && <span className={msg.kind === 'ok' ? 'ok' : 'error'} role="status">{msg.text}</span>}
      </div>
    </div>
  );
}

/** Gains and losses realized from logged sales, by year. */
export function RealizedSection({ accounts, securities }: { accounts: InvAccount[]; securities: Security[] }) {
  const sales = useLiveQuery(() => db.sales.toArray(), []) ?? [];
  const thisYear = Number(todayISO().slice(0, 4));
  const [year, setYear] = useState(thisYear);
  const years = [...new Set([thisYear, ...sales.map((s) => Number(s.date.slice(0, 4)))])].sort((a, b) => b - a);
  const r = useMemo(() => realizedFor(sales, year), [sales, year]);
  const tax = useMemo(() => netForTax(r), [r]);
  const list = sales.filter((s) => s.date.startsWith(`${year}-`)).sort((a, b) => b.date.localeCompare(a.date) || (b.id ?? 0) - (a.id ?? 0));
  const acct = (id: number) => accounts.find((a) => a.id === id)?.name ?? '?';
  const tick = (id: number) => securities.find((s) => s.id === id)?.ticker ?? '?';
  const cls = (v: number) => (v < 0 ? 'neg' : 'pos');

  return (
    <>
      <div className="row spread">
        <h2>Realized gains</h2>
        <label className="row">Year<select value={year} onChange={(e) => setYear(Number(e.target.value))}>{years.map((y) => <option key={y} value={y}>{y}</option>)}</select></label>
      </div>
      <p className="muted">Sales in taxable accounts only. Sales in IRAs, 401(k)s, Roths, HSAs, and 529s are logged but never taxed. These gains feed the tax estimate on the Income tab and the Roth planner.</p>
      <div className="tiles">
        <div className="tile"><div className="muted">Short-term</div><div className={`v ${cls(r.shortTermCents)}`}>{formatCents(r.shortTermCents)}</div></div>
        <div className="tile"><div className="muted">Long-term</div><div className={`v ${cls(r.longTermCents)}`}>{formatCents(r.longTermCents)}</div></div>
        <div className="tile"><div className="muted">Net realized, {year}</div><div className={`v ${cls(r.netCents)}`}>{formatCents(r.netCents)}</div></div>
        <div className="tile"><div className="muted">Sales</div><div className="v">{r.count}</div></div>
      </div>
      {tax.lossDeductionCents > 0 && <p className="muted">A net loss lowers income by up to $3,000 a year ({formatCents(tax.lossDeductionCents)} here); any more carries to later years, which is not tracked.</p>}
      {list.length === 0 ? <p className="muted">No sales logged for {year}.</p> : (
        <div className="scroll-x">
          <table>
            <thead><tr><th>Date</th><th>Account</th><th>Security</th><th className="num">Shares</th><th className="num">Proceeds</th><th className="num">Cost</th><th className="num">Gain / loss</th><th /></tr></thead>
            <tbody>
              {list.map((s: Sale) => (
                <tr key={s.id}>
                  <td>{s.date}</td><td>{acct(s.accountId)}</td><td>{tick(s.securityId)}</td>
                  <td className="num">{shortShares(s.shares)}</td><td className="num">{formatCents(s.proceedsCents)}</td>
                  <td className="num">{s.taxable ? formatCents(s.basisCents) : '—'}</td>
                  <td className={`num ${s.taxable ? cls(s.gainCents) : 'muted'}`}>
                    {s.taxable ? formatCents(s.gainCents) : 'not taxed'}
                    {s.taxable && <div className="muted" style={{ fontSize: '0.75rem' }}>{formatCents(s.shortTermCents)} short · {formatCents(s.longTermCents)} long</div>}
                  </td>
                  <td><button className="link danger" onClick={() => confirm('Undo this sale? The shares go back into their lots.') && undoSale(db, s.id!)}>undo</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted">Wash sales (rebuying within 30 days of a loss) are not tracked. Check your broker’s 1099-B for the official figures.</p>
    </>
  );
}

