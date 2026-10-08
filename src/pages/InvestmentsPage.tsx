import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, seedAssetClassesIfEmpty } from '../db';
import type { AssetClass, AssetKind, Holding, InvAccount, InvKind, InvTaxType, Security } from '../types';
import { formatCents, parseAmountToCents, todayISO } from '../lib/money';
import { allocationFor, gainLoss, holdingValue, summarize } from '../lib/investments';
import { applyPrices, fetchPrices, PER_MINUTE } from '../lib/prices';
import { AllocationBar, compactUSD, type AllocItem } from './charts';
import { MoneyField, NumField } from './fields';

const KIND_LABEL: Record<InvKind, string> = { brokerage: 'Brokerage', ira: 'IRA', '401k': '401(k)', '529': '529' };
const KIND_ORDER: InvKind[] = ['brokerage', 'ira', '401k', '529'];
const ASSET_KINDS: [AssetKind, string][] = [
  ['equity', 'Stocks'],
  ['bond', 'Bonds'],
  ['real_estate', 'Real estate'],
  ['balanced', 'Balanced / target-date'],
  ['cash', 'Cash'],
  ['other', 'Other'],
];

const defaultTax = (k: InvKind): InvTaxType => (k === 'brokerage' ? 'taxable' : k === '529' ? '529' : 'traditional');

function HoldingForm({ account, securities, classes, onDone }: { account: InvAccount; securities: Security[]; classes: AssetClass[]; onDone: () => void }) {
  const [ticker, setTicker] = useState('');
  const [shares, setShares] = useState('');
  const [basis, setBasis] = useState(0);
  const [name, setName] = useState('');
  const [classId, setClassId] = useState('');
  const [price, setPrice] = useState(0);
  const [err, setErr] = useState('');
  const existing = securities.find((s) => s.ticker.toUpperCase() === ticker.trim().toUpperCase());
  const isNew = ticker.trim() !== '' && !existing;

  async function add() {
    setErr('');
    const t = ticker.trim().toUpperCase();
    const n = Number(shares);
    if (!t) return setErr('Enter a ticker or fund name');
    if (!(n > 0)) return setErr('Enter the number of shares (can be fractional)');
    let secId = existing?.id;
    if (!existing) {
      if (!classId) return setErr('Choose the asset class for this new holding');
      secId = await db.securities.add({
        ticker: t,
        name: name.trim() || t,
        assetClassId: Number(classId),
        priceCents: price > 0 ? price : null,
        priceDate: price > 0 ? todayISO() : null,
        priceSource: price > 0 ? 'manual' : null,
      });
    }
    await db.holdings.add({ accountId: account.id!, securityId: secId!, shares: n, costBasisCents: basis > 0 ? basis : null });
    onDone();
  }

  return (
    <div className="card">
      <div className="grid">
        <label className="f">Ticker<input value={ticker} onChange={(e) => setTicker(e.target.value)} placeholder="VTI" list={`tk-${account.id}`} />
          <datalist id={`tk-${account.id}`}>{securities.map((s) => <option key={s.id} value={s.ticker}>{s.name}</option>)}</datalist>
        </label>
        <label className="f">Shares<input value={shares} onChange={(e) => setShares(e.target.value)} inputMode="decimal" placeholder="0" /></label>
        <MoneyField label="Total cost basis (optional)" cents={basis} onChange={setBasis} />
        {isNew && (
          <>
            <label className="f">Name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Vanguard Total Stock Market" /></label>
            <label className="f">Asset class
              <select value={classId} onChange={(e) => setClassId(e.target.value)}>
                <option value="">Choose…</option>
                {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <MoneyField label="Price per share (optional)" cents={price} onChange={setPrice} />
          </>
        )}
      </div>
      {existing && <p className="muted">Existing holding vehicle: {existing.name} ({classes.find((c) => c.id === existing.assetClassId)?.name}).</p>}
      <div className="row" style={{ marginTop: 6 }}>
        <button className="primary" onClick={add}>Add holding</button>
        <button onClick={onDone}>Cancel</button>
      </div>
      {err && <div className="error">{err}</div>}
    </div>
  );
}

function AccountBlock({ s, holdings, securities, classes }: { s: ReturnType<typeof summarize>['accounts'][number]; holdings: Holding[]; securities: Security[]; classes: AssetClass[] }) {
  const a = s.account;
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState(true);
  const mine = holdings.filter((h) => h.accountId === a.id);
  const secById = new Map(securities.map((x) => [x.id!, x]));

  return (
    <div className="card">
      <div className="row spread">
        <div>
          <strong>{a.name}</strong> <span className="badge">{KIND_LABEL[a.kind]}</span>{' '}
          {(a.kind === 'ira' || a.kind === '401k') && (
            <select value={a.taxType} onChange={(e) => db.invAccounts.update(a.id!, { taxType: e.target.value as InvTaxType })}>
              <option value="traditional">Traditional</option>
              <option value="roth">Roth</option>
            </select>
          )}
          {a.closed && <span className="badge">closed</span>}
        </div>
        <div className="row">
          <strong>{formatCents(s.total)}</strong>
          <button className="link" onClick={() => setOpen(!open)}>{open ? 'hide' : 'show'}</button>
        </div>
      </div>
      {open && (
        <>
          <div className="row" style={{ margin: '6px 0' }}>
            <MoneyField label="Uninvested cash" cents={a.cashCents} width={120} onChange={(c) => db.invAccounts.update(a.id!, { cashCents: c })} />
            <span className="muted">Invested {formatCents(s.invested)}</span>
          </div>
          {s.missingPrices.length > 0 && <p className="warn">No price yet: {s.missingPrices.join(', ')}. Refresh prices or enter one below.</p>}
          {mine.length > 0 && (
            <table>
              <thead><tr><th>Holding</th><th className="num">Shares</th><th className="num hide-sm">Price</th><th className="num">Value</th><th className="num hide-sm">Gain / loss</th><th></th></tr></thead>
              <tbody>
                {mine.map((h) => {
                  const sec = secById.get(h.securityId);
                  const gl = gainLoss(h, sec);
                  return (
                    <tr key={h.id}>
                      <td>{sec?.ticker}<div className="muted">{sec?.name} · {classes.find((c) => c.id === sec?.assetClassId)?.name}</div></td>
                      <td className="num">
                        <input style={{ width: 90, textAlign: 'right' }} inputMode="decimal" defaultValue={h.shares} key={`${h.id}-${h.shares}`}
                          onBlur={(e) => { const n = Number(e.target.value); if (n > 0 && n !== h.shares) db.holdings.update(h.id!, { shares: n }); else e.target.value = String(h.shares); }} />
                      </td>
                      <td className="num hide-sm">{sec?.priceCents != null ? formatCents(sec.priceCents) : <span className="warn">none</span>}</td>
                      <td className="num">{formatCents(holdingValue(h, sec))}</td>
                      <td className={`num hide-sm ${gl === null ? 'muted' : gl < 0 ? 'neg' : 'pos'}`}>{gl === null ? '—' : formatCents(gl)}</td>
                      <td><button className="link danger" onClick={() => confirm(`Remove ${sec?.ticker} from ${a.name}?`) && db.holdings.delete(h.id!)}>remove</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {adding ? (
            <HoldingForm account={a} securities={securities} classes={classes} onDone={() => setAdding(false)} />
          ) : (
            <div className="row">
              <button onClick={() => setAdding(true)}>+ Add holding</button>
              <button className="link" onClick={() => db.invAccounts.update(a.id!, { closed: !a.closed })}>{a.closed ? 'reopen account' : 'close account'}</button>
              <button
                className="link danger"
                onClick={async () => {
                  if (!confirm(`Delete ${a.name} and its ${mine.length} holding(s)?`)) return;
                  await db.holdings.where('accountId').equals(a.id!).delete();
                  await db.invAccounts.delete(a.id!);
                }}
              >delete account</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function InvestmentsPage() {
  useEffect(() => { seedAssetClassesIfEmpty(); }, []);
  const accounts = useLiveQuery(() => db.invAccounts.toArray(), []) ?? [];
  const holdings = useLiveQuery(() => db.holdings.toArray(), []) ?? [];
  const securities = useLiveQuery(() => db.securities.toArray(), []) ?? [];
  const classes = useLiveQuery(() => db.assetClasses.toArray(), []) ?? [];
  const apiKey = (useLiveQuery(() => db.settings.get('priceApiKey'), []) as { value?: string } | undefined)?.value ?? '';

  const p = useMemo(() => ({ accounts, holdings, securities, assetClasses: classes }), [accounts, holdings, securities, classes]);
  const sum = useMemo(() => summarize(p), [p]);
  const [scope, setScope] = useState<'all' | number>('all');
  const slotOf = (id: number | null) => Math.min(7, Math.max(0, classes.findIndex((c) => c.id === id)));
  const items: AllocItem[] = allocationFor(scope === 'all' ? 'all' : [scope], p).map((s) => ({
    key: s.assetClassId ?? 'cash',
    name: s.name,
    cents: s.cents,
    pct: s.pct,
    slot: slotOf(s.assetClassId),
  }));

  const [nm, setNm] = useState('');
  const [kind, setKind] = useState<InvKind>('brokerage');
  const [cash, setCash] = useState(0);
  const [keyText, setKeyText] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [newClass, setNewClass] = useState('');

  async function refresh() {
    if (!apiKey) return setStatus('Save your API key first.');
    const held = [...new Set(holdings.map((h) => securities.find((s) => s.id === h.securityId)?.ticker).filter(Boolean) as string[])];
    if (held.length === 0) return setStatus('No holdings to price yet.');
    setBusy(true);
    setStatus(`Fetching ${held.length} price(s)…`);
    const res = await fetchPrices(held, apiKey, {
      onProgress: (done, total, waiting) => setStatus(waiting ? `Free plan allows ${PER_MINUTE} lookups a minute. Pausing before the next batch (${done}/${total} done)…` : `Fetched ${done}/${total}…`),
    });
    const n = await applyPrices(db, res);
    const bad = res.filter((r) => r.error);
    setStatus(`Updated ${n} security price(s).${bad.length ? ` Could not price: ${bad.map((b) => `${b.ticker} (${b.error})`).join('; ')}. Enter those manually below.` : ''}`);
    setBusy(false);
  }

  const secInUse = (id: number) => holdings.some((h) => h.securityId === id);

  return (
    <>
      <h1>Investments</h1>

      <div className="viz">
        <div className="muted">Total investments</div>
        <div className="hero">{formatCents(sum.total)}</div>
        <div className="tiles">
          {KIND_ORDER.filter((k) => sum.byKind[k]).map((k) => (
            <div className="tile" key={k}><div className="muted">{KIND_LABEL[k]}</div><div className="v">{compactUSD(sum.byKind[k])}</div></div>
          ))}
        </div>
        {sum.missing.length > 0 && <p className="warn">No price for {sum.missing.join(', ')}; counted as $0 until priced.</p>}
      </div>

      <div className="row">
        <label className="row">Show allocation for
          <select value={String(scope)} onChange={(e) => setScope(e.target.value === 'all' ? 'all' : Number(e.target.value))}>
            <option value="all">All accounts</option>
            {accounts.filter((a) => !a.closed).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
      </div>
      <AllocationBar title={scope === 'all' ? 'Allocation by asset class: all accounts' : `Allocation by asset class: ${accounts.find((a) => a.id === scope)?.name}`} items={items} />

      <h2>Accounts</h2>
      {sum.accounts.length === 0 && <p className="muted">Add your brokerage, IRA, 401(k), and 529 accounts, then their holdings.</p>}
      {KIND_ORDER.flatMap((k) => sum.accounts.filter((s) => s.account.kind === k)).map((s) => (
        <AccountBlock key={s.account.id} s={s} holdings={holdings} securities={securities} classes={classes} />
      ))}

      <div className="card">
        <strong>Add account</strong>
        <div className="grid" style={{ marginTop: 6 }}>
          <label className="f">Name<input value={nm} onChange={(e) => setNm(e.target.value)} placeholder="e.g. Fidelity brokerage" /></label>
          <label className="f">Type
            <select value={kind} onChange={(e) => setKind(e.target.value as InvKind)}>
              {KIND_ORDER.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
            </select>
          </label>
          <MoneyField label="Uninvested cash" cents={cash} onChange={setCash} />
        </div>
        <div className="row" style={{ marginTop: 6 }}>
          <button
            className="primary"
            onClick={async () => {
              if (!nm.trim()) return;
              await db.invAccounts.add({ name: nm.trim(), kind, taxType: defaultTax(kind), cashCents: cash, annualContributionCents: 0, contributionGrowthPct: 0, linkToIncome: false });
              setNm('');
              setCash(0);
            }}
          >Add account</button>
        </div>
      </div>

      <h2>Prices</h2>
      <div className="card">
        <div className="row">
          <label className="f">Market-data API key (Twelve Data)
            <input type="password" value={keyText} onChange={(e) => setKeyText(e.target.value)} placeholder={apiKey ? '•••••••• (saved on this device)' : 'paste your key'} autoComplete="off" />
          </label>
          <button onClick={async () => { if (keyText.trim()) { await db.settings.put({ key: 'priceApiKey', value: keyText.trim() }); setKeyText(''); setStatus('Key saved on this device.'); } }}>Save key</button>
          {apiKey && <button className="link danger" onClick={() => db.settings.delete('priceApiKey')}>remove key</button>}
          <button className="primary" disabled={busy} onClick={refresh}>Refresh prices</button>
        </div>
        {status && <p className={status.startsWith('Updated') || status.startsWith('Key saved') ? 'ok' : 'muted'}>{status}</p>}
        <details>
          <summary>How to get a free price key</summary>
          <ol>
            <li>Go to <strong>twelvedata.com</strong> and create a free account (you do this part; I can’t create accounts for you).</li>
            <li>In your dashboard, copy your <strong>API key</strong> (a long string of letters and numbers).</li>
            <li>Paste it above and click <strong>Save key</strong>. It is stored only in this browser, is never included in backups, and is sent only to twelvedata.com when you refresh.</li>
            <li>Click <strong>Refresh prices</strong>. The free plan allows about {PER_MINUTE} lookups per minute and 800 per day (check their pricing page for current limits). With more than {PER_MINUTE} tickers the app pauses a minute between batches.</li>
            <li>Some mutual funds may not be covered on the free plan; those show an error and you can type the price yourself in the table below. A holding is always worth whatever price is stored, so a manual price works the same.</li>
          </ol>
        </details>
      </div>

      <h2>Holdings vehicles and prices</h2>
      {securities.length === 0 ? <p className="muted">None yet.</p> : (
        <table>
          <thead><tr><th>Ticker</th><th>Asset class</th><th className="num">Price</th><th className="hide-sm">Updated</th><th></th></tr></thead>
          <tbody>
            {securities.map((s) => (
              <tr key={s.id}>
                <td>{s.ticker}<div className="muted">{s.name}</div></td>
                <td>
                  <select value={s.assetClassId} onChange={(e) => db.securities.update(s.id!, { assetClassId: Number(e.target.value) })}>
                    {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </td>
                <td className="num">
                  <input style={{ width: 100, textAlign: 'right' }} inputMode="decimal" key={`${s.id}-${s.priceCents}`} defaultValue={s.priceCents != null ? (s.priceCents / 100).toFixed(2) : ''} placeholder="price"
                    onBlur={(e) => {
                      const c = e.target.value.trim() === '' ? null : parseAmountToCents(e.target.value);
                      if (c === undefined || (c !== null && c <= 0)) return;
                      if (c !== s.priceCents) db.securities.update(s.id!, { priceCents: c, priceDate: c === null ? null : todayISO(), priceSource: c === null ? null : 'manual' });
                    }} />
                </td>
                <td className="hide-sm muted">{s.priceDate ? `${s.priceDate} (${s.priceSource})` : '—'}</td>
                <td>{!secInUse(s.id!) && <button className="link danger" onClick={() => db.securities.delete(s.id!)}>delete</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>Asset class assumptions</h2>
      <p className="muted">
        These drive every projection. They are <strong>assumptions you control, not predictions</strong>: average yearly return and how bumpy it is
        (volatility). A holding takes the class you assign it, so a target-date fund can be its own class. Nominal returns (before inflation); the
        projection can show today’s dollars.
      </p>
      <table>
        <thead><tr><th>Class</th><th>Kind</th><th className="num">Avg return %</th><th className="num">Volatility %</th><th></th></tr></thead>
        <tbody>
          {classes.map((c) => (
            <tr key={c.id}>
              <td><input defaultValue={c.name} onBlur={(e) => e.target.value.trim() && db.assetClasses.update(c.id!, { name: e.target.value.trim() })} /></td>
              <td>
                <select value={c.kind} onChange={(e) => db.assetClasses.update(c.id!, { kind: e.target.value as AssetKind })}>
                  {ASSET_KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </td>
              <td className="num"><NumField value={c.expectedReturnPct} step={0.1} width={80} onChange={(n) => db.assetClasses.update(c.id!, { expectedReturnPct: n })} /></td>
              <td className="num"><NumField value={c.volatilityPct} step={0.1} width={80} onChange={(n) => db.assetClasses.update(c.id!, { volatilityPct: Math.max(0, n) })} /></td>
              <td>{!securities.some((s) => s.assetClassId === c.id) && <button className="link danger" onClick={() => db.assetClasses.delete(c.id!)}>delete</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row" style={{ marginTop: 6 }}>
        <input placeholder="New asset class" value={newClass} onChange={(e) => setNewClass(e.target.value)} />
        <button onClick={async () => { if (newClass.trim()) { await db.assetClasses.add({ name: newClass.trim(), kind: 'other', expectedReturnPct: 5, volatilityPct: 15 }); setNewClass(''); } }}>Add class</button>
      </div>
      <p className="muted">The “kind” sets how classes move together in the simulation (stocks move with stocks, bonds less so). Allocation colors follow each class’s position in this list.</p>
    </>
  );
}
