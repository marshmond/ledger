import PayeeInput from '../ui/PayeeInput';
import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, seedAssetClassesIfEmpty } from '../db';
import type { AssetClass, AssetKind, Holding, InvAccount, InvKind, InvTaxType, Person, Security } from '../types';
import { formatCents, todayISO } from '../lib/money';
import { allocationFor, gainLoss, holdingValue, summarize } from '../lib/investments';
import { PER_MINUTE, refreshAllPrices } from '../lib/prices';
import { AllocationBar, type AllocItem } from './charts';
import { MoneyField, NumField } from './fields';
import PriceCell from './PriceCell';
import HsaLog from './HsaLog';
import PageTabs from './PageTabs';
import RenameAccount from './RenameAccount';
import { LotsPanel, RealizedSection, TradePanel } from './TradePanels';
import { addLot, ensureLots, isTaxable, setHoldingBasis } from '../lib/lots';
import { Banner, PageHeader } from '../ui/components';
import ConfirmDialog from '../shell/ConfirmDialog';
import Collapsible from './Collapsible';
import { PRICE_KIND_WORD, priceKind } from './analysisPresentation';
import './analysis.css';

const KIND_LABEL: Record<InvKind, string> = { brokerage: 'Brokerage', ira: 'IRA', '401k': '401(k)', '529': '529', hsa: 'HSA' };
const KIND_ORDER: InvKind[] = ['brokerage', 'ira', '401k', 'hsa', '529'];
const ASSET_KINDS: [AssetKind, string][] = [
  ['equity', 'Stocks'],
  ['bond', 'Bonds'],
  ['real_estate', 'Real estate'],
  ['balanced', 'Balanced / target-date'],
  ['cash', 'Cash'],
  ['other', 'Other'],
];

const defaultTax = (k: InvKind): InvTaxType => (k === 'brokerage' ? 'taxable' : k === '529' ? '529' : k === 'hsa' ? 'hsa' : 'traditional');

function HoldingForm({ account, securities, classes, onDone }: { account: InvAccount; securities: Security[]; classes: AssetClass[]; onDone: () => void }) {
  const [ticker, setTicker] = useState('');
  const [shares, setShares] = useState('');
  const [basis, setBasis] = useState(0);
  const [name, setName] = useState('');
  const [classId, setClassId] = useState('');
  const [price, setPrice] = useState(0);
  const [bought, setBought] = useState('');
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
    // Taxable accounts get a tax lot (with the purchase date); other accounts just gain shares.
    await addLot(db, { accountId: account.id!, securityId: secId!, acquiredDate: bought || null, shares: n, costBasisCents: basis, source: 'manual' });
    onDone();
  }

  return (
    <div className="an-card an-card--soft">
      <div className="an-form">
        <label className="f">Ticker<PayeeInput value={ticker} onChange={setTicker} options={securities.map((s) => s.ticker)} placeholder="VTI" />
        </label>
        <label className="f">Shares<input value={shares} onChange={(e) => setShares(e.target.value)} inputMode="decimal" placeholder="0" /></label>
        <MoneyField label="Total cost basis (optional)" cents={basis} onChange={setBasis} />
        {isTaxable(account) && <label className="f">Purchase date (optional)<input type="date" value={bought} onChange={(e) => setBought(e.target.value)} /></label>}
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
      <div className="an-actions">
        <button className="primary" onClick={add}>Add holding</button>
        <button onClick={onDone}>Cancel</button>
      </div>
      {err && <div className="error" role="alert">{err}</div>}
    </div>
  );
}

/** Who owns an account. Retirement accounts need one: RMD ages, conversions, and the Roth planner depend on it. */
function OwnerSelect({ value, people, onChange }: { value: number | null | undefined; people: Person[]; onChange: (id: number | null) => void }) {
  return (
    <select aria-label="Owner" value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}>
      <option value="">Joint / none</option>
      {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
    </select>
  );
}

function AccountBlock({ s, holdings, securities, classes, people, otherNames }: { s: ReturnType<typeof summarize>['accounts'][number]; holdings: Holding[]; securities: Security[]; classes: AssetClass[]; people: Person[]; otherNames: string[] }) {
  const a = s.account;
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState<{ holdingId: number; mode: 'lots' | 'buy' | 'sell' } | null>(null);
  const taxable = isTaxable(a);
  const mine = holdings.filter((h) => h.accountId === a.id);
  const secById = new Map(securities.map((x) => [x.id!, x]));
  const lotIds = useLiveQuery(() => db.taxLots.where('accountId').equals(a.id!).toArray(), [a.id]);
  // Holdings in taxable accounts are tracked by lot: give any holding without one an opening lot.
  useEffect(() => {
    if (!taxable || !lotIds) return;
    for (const h of mine) if (!lotIds.some((l) => l.holdingId === h.id)) ensureLots(db, h.id!);
  }, [taxable, lotIds, mine.map((h) => h.id).join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  const panelHolding = panel ? mine.find((h) => h.id === panel.holdingId) : undefined;
  // D20.1B (NC-18, NC-19): the holding (by id) or this account whose remove / delete was pressed. Nothing is deleted until the dialog's own button is pressed.
  const [askHolding, setAskHolding] = useState<number | null>(null);
  const [askAccount, setAskAccount] = useState(false);
  const askHoldingRow = askHolding === null ? undefined : mine.find((h) => h.id === askHolding);

  const ticker = (h: Holding) => secById.get(h.securityId)?.ticker ?? 'holding';
  return (
    <div className="an-card an-acct">
      <div className="an-acct-head">
        <div className="an-acct-id">
          <div className="an-acct-name">
            <RenameAccount table="invAccounts" id={a.id!} name={a.name} taken={otherNames} /> <span className="badge">{KIND_LABEL[a.kind]}</span>
            {a.closed && <span className="badge">closed</span>}
          </div>
          <div className="an-acct-meta">
            {(a.kind === 'ira' || a.kind === '401k') && (
              <select aria-label={`Tax type for ${a.name}`} value={a.taxType} onChange={(e) => db.invAccounts.update(a.id!, { taxType: e.target.value as InvTaxType })}>
                <option value="traditional">Traditional</option>
                <option value="roth">Roth</option>
              </select>
            )}
            <label className="an-ctl-inline">Owner <OwnerSelect value={a.personId} people={people} onChange={(id) => db.invAccounts.update(a.id!, { personId: id })} /></label>
            <span>{mine.length} holding{mine.length === 1 ? '' : 's'}</span>
            <span>Invested {formatCents(s.invested)}</span>
            <span>Cash {formatCents(a.cashCents)}</span>
            {s.missingPrices.length > 0 && <span className="an-kind an-kind--unknown">No price: {s.missingPrices.join(', ')}</span>}
          </div>
          {(a.kind === 'ira' || a.kind === '401k') && a.personId == null && people.length > 0 && !a.closed && (
            <div className="warn">No owner set: the Roth planner counts this as {people[0]?.name ?? 'the first person'}’s. Pick an owner.</div>
          )}
        </div>
        <div className="an-acct-val">
          <span>{formatCents(s.total)}</span>
          <button className="link an-toggle" aria-expanded={open} aria-label={`${open ? 'Hide' : 'Show'} holdings of ${a.name}`} onClick={() => setOpen(!open)}>{open ? 'hide' : 'show'}</button>
        </div>
      </div>
      {open && (
        <div className="an-acct-body">
          <div className="an-form">
            <MoneyField label="Uninvested cash" cents={a.cashCents} width={120} onChange={(c) => db.invAccounts.update(a.id!, { cashCents: c })} />
          </div>
          {s.missingPrices.length > 0 && <p className="warn">No price yet: {s.missingPrices.join(', ')}. Refresh prices or enter one below.</p>}
          {mine.length > 0 && (
            <div className="an-tablewrap"><table className="an-table an-stack">
              <thead><tr><th>Holding</th><th className="num">Shares</th><th className="num">Price</th><th className="num">Value</th><th className="num">Cost basis</th><th className="num">Gain / loss</th><th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {mine.map((h) => {
                  const sec = secById.get(h.securityId);
                  const gl = gainLoss(h, sec);
                  return (
                    <tr key={h.id}>
                      <td className="an-lead"><span className="an-hold-name">{sec?.ticker}</span><span className="an-sub">{sec?.name} · {classes.find((c) => c.id === sec?.assetClassId)?.name}</span></td>
                      <td className="num" data-label="Shares">
                        {taxable ? (
                          <span title="Shares follow the tax lots">{Math.round(h.shares * 1e6) / 1e6}</span>
                        ) : (
                          <input style={{ width: 90, textAlign: 'right' }} inputMode="decimal" defaultValue={h.shares} key={`${h.id}-${h.shares}`} aria-label={`Shares of ${sec?.ticker ?? 'holding'}`}
                            onBlur={(e) => { const n = Number(e.target.value); if (n > 0 && n !== h.shares) db.holdings.update(h.id!, { shares: n }); else e.target.value = String(h.shares); }} />
                        )}
                      </td>
                      <td className="num" data-label="Price">{sec ? <PriceCell key={`${sec.id}-${sec.priceCents}`} sec={sec} /> : null}</td>
                      <td className="num" data-label="Value">{formatCents(holdingValue(h, sec))}</td>
                      <td className="num" data-label="Cost basis">
                        {taxable ? formatCents(h.costBasisCents ?? 0) : <MoneyField key={`${h.id}-${h.costBasisCents}`} cents={h.costBasisCents ?? 0} width={100} onChange={(c) => setHoldingBasis(db, h.id!, c > 0 ? c : null)} />}
                      </td>
                      <td className="num" data-label="Gain / loss">{gl === null ? <span className="muted">—<span className="an-sub">needs a price and a cost</span></span> : `${gl > 0 ? '+' : ''}${formatCents(gl)}`}</td>
                      <td className="an-cell-act">
                        <span className="an-rowbtns">
                          {taxable && <button className="link" aria-label={`Lots of ${ticker(h)}`} onClick={() => setPanel(panel !== null && panel.holdingId === h.id && panel.mode === 'lots' ? null : { holdingId: h.id!, mode: 'lots' })}>lots</button>}
                          <button className="link" aria-label={`Buy ${ticker(h)}`} onClick={() => setPanel({ holdingId: h.id!, mode: 'buy' })}>buy</button>
                          <button className="link" aria-label={`Sell ${ticker(h)}`} onClick={() => setPanel({ holdingId: h.id!, mode: 'sell' })}>sell</button>
                          <button className="link danger" aria-label={`Remove ${ticker(h)} from ${a.name}`} onClick={() => setAskHolding(h.id!)}>remove</button>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table></div>
          )}
          {panel && panelHolding && (panel.mode === 'lots'
            ? <LotsPanel holding={panelHolding} security={secById.get(panelHolding.securityId)} onClose={() => setPanel(null)} />
            : <TradePanel key={`${panel.mode}-${panelHolding.id}`} mode={panel.mode} account={a} holding={panelHolding} security={secById.get(panelHolding.securityId)} onClose={() => setPanel(null)} />)}
          {adding ? (
            <HoldingForm account={a} securities={securities} classes={classes} onDone={() => setAdding(false)} />
          ) : (
            <div className="an-acct-foot">
              <button onClick={() => setAdding(true)}>+ Add holding</button>
              <button className="link" onClick={() => db.invAccounts.update(a.id!, { closed: !a.closed })}>{a.closed ? 'reopen account' : 'close account'}</button>
              <button className="link danger" onClick={() => setAskAccount(true)}>delete account</button>
            </div>
          )}
          {a.kind === 'hsa' && <HsaLog account={a} people={people} />}
          {askHoldingRow && (
            <ConfirmDialog
              title="Remove holding?"
              confirmLabel="Remove holding"
              busyLabel="Removing…"
              kind="irreversible"
              onCancel={() => setAskHolding(null)}
              // The same two steps as before (its lots, then the holding), not wrapped in one transaction; see the D20.1B report.
              onConfirm={async () => { await db.taxLots.where('holdingId').equals(askHoldingRow.id!).delete(); await db.holdings.delete(askHoldingRow.id!); setAskHolding(null); }}
            >
              <p><strong>{ticker(askHoldingRow)}</strong> in {a.name}<br /><span className="muted small">{askHoldingRow.shares} share{askHoldingRow.shares === 1 ? '' : 's'}</span></p>
              <p>This removes the holding and its tax lots from the account. It does not record a sale: to record a sale, use sell instead.</p>
            </ConfirmDialog>
          )}
          {askAccount && (
            <ConfirmDialog
              title="Delete investment account?"
              confirmLabel="Delete account"
              busyLabel="Deleting…"
              kind="irreversible"
              onCancel={() => setAskAccount(false)}
              // The same two steps as before (the account's holdings, then the account), not wrapped in one transaction; see the D20.1B report.
              onConfirm={async () => { await db.holdings.where('accountId').equals(a.id!).delete(); await db.invAccounts.delete(a.id!); setAskAccount(false); }}
            >
              <p><strong>{a.name}</strong><br /><span className="muted small">{KIND_LABEL[a.kind]} · {mine.length} holding{mine.length === 1 ? '' : 's'}</span></p>
              <p>This deletes the account and its {mine.length} holding{mine.length === 1 ? '' : 's'}. It does not record any sales.</p>
            </ConfirmDialog>
          )}
        </div>
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
  const people = useLiveQuery(() => db.people.toArray(), []) ?? [];
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
  const [owner, setOwner] = useState<number | null>(null);
  const [keyText, setKeyText] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [newClass, setNewClass] = useState('');
  const [jump, setJump] = useState({ tab: 'prices', n: 0 });

  async function refresh() {
    setBusy(true);
    setStatus(await refreshAllPrices(db, setStatus));
    setBusy(false);
  }

  const secInUse = (id: number) => holdings.some((h) => h.securityId === id);

  return (
    <div className="an-page">
      <PageHeader eyebrow="Invest" title="Investments" description="Accounts, holdings, trades, and assumptions." />
      <PageTabs
        id="investments"
        jumpTo={jump}
        tabs={[
          {
            id: 'accounts',
            label: 'Accounts',
            content: (
              <div className="an-page">
                <section className="an-hero" aria-label="Investments total">
                  <div>
                    <div className="an-hero-label">Total investments <span className="an-kind">Current, at stored prices</span></div>
                    <div className="an-hero-amt">{formatCents(sum.total)}</div>
                    <p className="an-hero-msg">Each holding is worth its shares times the price stored for it, plus uninvested cash. Prices are only as fresh as the date shown on each one (see Prices &amp; assumptions).</p>
                  </div>
                  <dl className="an-hero-figs">
                    {KIND_ORDER.filter((k) => sum.byKind[k]).map((k) => (
                      <div key={k}><dt>{KIND_LABEL[k]}</dt><dd>{formatCents(sum.byKind[k])}</dd></div>
                    ))}
                  </dl>
                </section>
                {sum.missing.length > 0 && <Banner level="warn" title={`No price for ${sum.missing.join(', ')}; counted as $0 until priced.`}>Enter a price on the Prices &amp; assumptions tab, or refresh prices.</Banner>}

                <div className="an-stack-col">
                  <div className="an-head" style={{ marginBottom: 0 }}>
                    <h2 className="an-h2">Allocation</h2>
                    <label className="an-ctl-inline">Show allocation for
                      <select value={String(scope)} onChange={(e) => setScope(e.target.value === 'all' ? 'all' : Number(e.target.value))}>
                        <option value="all">All accounts</option>
                        {accounts.filter((a) => !a.closed).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                      </select>
                    </label>
                  </div>
                  <AllocationBar title={scope === 'all' ? 'Allocation by asset class: all accounts' : `Allocation by asset class: ${accounts.find((a) => a.id === scope)?.name}`} items={items} />
                </div>

                <div className="an-head" style={{ marginBottom: 0 }}>
                  <h2 className="an-h2">Accounts <span className="an-count muted an-small">{sum.accounts.length}</span></h2>
                  <button className="primary" disabled={busy} onClick={refresh}>Refresh prices</button>
                </div>
                {status && (
                  <p className={status.startsWith('Updated') || status.startsWith('Key saved') ? 'ok' : 'muted'} style={{ margin: 0 }}>
                    {status}
                    {!apiKey && status.startsWith('Save your API key') && <> <button className="link" onClick={() => setJump((j) => ({ tab: 'prices', n: j.n + 1 }))}>Go to Prices &amp; assumptions</button></>}
                  </p>
                )}
                {sum.accounts.length === 0 && <p className="muted">Add your brokerage, IRA, 401(k), and 529 accounts, then their holdings.</p>}
                {KIND_ORDER.flatMap((k) => sum.accounts.filter((s) => s.account.kind === k)).map((s) => (
                  <AccountBlock key={s.account.id} s={s} holdings={holdings} securities={securities} classes={classes} people={people} otherNames={sum.accounts.filter((o) => o.account.id !== s.account.id).map((o) => o.account.name)} />
                ))}

                <Collapsible id="investments.addaccount" title="Add account" defaultOpen={sum.accounts.length === 0}>
                  <div className="an-form">
                    <label className="f">Name<input value={nm} onChange={(e) => setNm(e.target.value)} placeholder="e.g. Fidelity brokerage" /></label>
                    <label className="f">Type
                      <select value={kind} onChange={(e) => setKind(e.target.value as InvKind)}>
                        {KIND_ORDER.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
                      </select>
                    </label>
                    <label className="f">Owner<OwnerSelect value={owner} people={people} onChange={setOwner} /></label>
                    <MoneyField label="Uninvested cash" cents={cash} onChange={setCash} />
                  </div>
                  <div className="an-actions">
                    <button
                      className="primary"
                      onClick={async () => {
                        if (!nm.trim()) return;
                        await db.invAccounts.add({ name: nm.trim(), kind, taxType: defaultTax(kind), personId: owner, cashCents: cash, annualContributionCents: 0, contributionGrowthPct: 0, linkToIncome: false });
                        setNm('');
                        setCash(0);
                        setOwner(null);
                      }}
                    >Add account</button>
                  </div>
                </Collapsible>
              </div>
            ),
          },
          { id: 'gains', label: 'Realized gains', content: <div className="an-page"><RealizedSection accounts={accounts} securities={securities} /></div> },
          {
            id: 'prices',
            label: 'Prices & assumptions',
            content: (
              <div className="an-page">
                <section className="an-card" aria-labelledby="inv-prices">
                  <div className="an-head">
                    <h2 className="an-h2" id="inv-prices">Prices <span className="an-kind an-kind--manual">Stored on this device</span></h2>
                  </div>
                  <div className="an-form an-form--wide">
                    <label className="f">Market-data API key (Twelve Data)
                      <input type="password" value={keyText} onChange={(e) => setKeyText(e.target.value)} placeholder={apiKey ? '•••••••• (saved on this device)' : 'paste your key'} autoComplete="off" />
                    </label>
                  </div>
                  <div className="an-actions">
                    <button onClick={async () => { if (keyText.trim()) { await db.settings.put({ key: 'priceApiKey', value: keyText.trim() }); setKeyText(''); setStatus('Key saved on this device.'); } }}>Save key</button>
                    {apiKey && <button className="link danger" onClick={() => db.settings.delete('priceApiKey')}>remove key</button>}
                    <button className="primary" disabled={busy} onClick={refresh}>Refresh prices</button>
                  </div>
                  {status && <p className={status.startsWith('Updated') || status.startsWith('Key saved') ? 'ok' : 'muted'}>{status}</p>}
                  <details style={{ marginTop: 'var(--sp-3)' }}>
                    <summary>How to get a free price key</summary>
                    <ol>
                      <li>Go to <strong>twelvedata.com</strong> and create a free account (you do this part; I can’t create accounts for you).</li>
                      <li>In your dashboard, copy your <strong>API key</strong> (a long string of letters and numbers).</li>
                      <li>Paste it above and click <strong>Save key</strong>. It is stored only in this browser, is never included in backups, and is sent only to twelvedata.com when you refresh.</li>
                      <li>Click <strong>Refresh prices</strong>. The free plan allows about {PER_MINUTE} lookups per minute and 800 per day (check their pricing page for current limits). With more than {PER_MINUTE} tickers the app pauses a minute between batches.</li>
                      <li>Some mutual funds may not be covered on the free plan; those show an error and you can type the price yourself in the table below. A holding is always worth whatever price is stored, so a manual price works the same.</li>
                    </ol>
                  </details>
                </section>

                <section className="an-card" aria-labelledby="inv-vehicles">
                  <div className="an-head"><h2 className="an-h2" id="inv-vehicles">Holdings vehicles and prices</h2></div>
                  {securities.length === 0 ? <p className="muted">None yet.</p> : (
                    <div className="an-tablewrap">
                      <table className="an-table an-stack">
                        <thead><tr><th>Ticker</th><th>Asset class</th><th className="num">Price</th><th>Price date and source</th><th><span className="sr-only">Actions</span></th></tr></thead>
                        <tbody>
                          {securities.map((s) => (
                            <tr key={s.id}>
                              <td className="an-lead"><span className="an-hold-name">{s.ticker}</span><span className="an-sub">{s.name}</span></td>
                              <td data-label="Asset class">
                                <select aria-label={`Asset class for ${s.ticker}`} value={s.assetClassId} onChange={(e) => db.securities.update(s.id!, { assetClassId: Number(e.target.value) })}>
                                  {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                                </select>
                              </td>
                              <td className="num" data-label="Price">
                                <PriceCell key={`${s.id}-${s.priceCents}`} sec={s} />
                              </td>
                              <td data-label="Price date and source">
                                <span className={`an-kind${priceKind(s) === 'none' ? ' an-kind--unknown' : priceKind(s) === 'manual' ? ' an-kind--manual' : ''}`}>{PRICE_KIND_WORD[priceKind(s)]}</span>
                                <span className="an-sub">{s.priceDate ? `as of ${s.priceDate} (${s.priceSource})` : 'Holdings in it are valued at $0 until a price is entered'}</span>
                              </td>
                              <td className="an-cell-act">{!secInUse(s.id!) && <button className="link danger" aria-label={`Delete ${s.ticker}`} onClick={() => db.securities.delete(s.id!)}>delete</button>}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>

                <section className="an-card" aria-labelledby="inv-assume">
                  <div className="an-head">
                    <h2 className="an-h2" id="inv-assume">Asset class assumptions <span className="an-kind an-kind--assumption">Your assumptions, not predictions</span></h2>
                  </div>
                  <p className="an-note" style={{ marginTop: 0 }}>
                    These drive every projection. They are <strong>assumptions you control, not predictions</strong>: the yearly return and how bumpy it is
                    (volatility). A holding takes the class you assign it, so a target-date fund can be its own class. Returns are <strong>compound (geometric)
                    and nominal</strong>: what a dollar actually grew by per year over the long run, before inflation (the figure published as CAGR). Do not enter
                    the simple yearly average (arithmetic mean), which is higher and would overstate growth. The projection can show today’s dollars.
                  </p>
                  <div className="an-tablewrap" style={{ marginTop: 'var(--sp-3)' }}>
                    <table className="an-table an-stack an-stack--3">
                      <thead><tr><th>Class</th><th>Kind</th><th className="num">Compound return %</th><th className="num">Volatility %</th><th><span className="sr-only">Actions</span></th></tr></thead>
                      <tbody>
                        {classes.map((c) => (
                          <tr key={c.id}>
                            <td className="an-lead"><input aria-label="Class name" defaultValue={c.name} onBlur={(e) => e.target.value.trim() && db.assetClasses.update(c.id!, { name: e.target.value.trim() })} /></td>
                            <td data-label="Kind">
                              <select aria-label={`Kind of ${c.name}`} value={c.kind} onChange={(e) => db.assetClasses.update(c.id!, { kind: e.target.value as AssetKind })}>
                                {ASSET_KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                              </select>
                            </td>
                            <td className="num" data-label="Compound return %"><NumField ariaLabel={`Compound return % for ${c.name}`} value={c.expectedReturnPct} step={0.1} width={80} onChange={(n) => db.assetClasses.update(c.id!, { expectedReturnPct: n })} /></td>
                            <td className="num" data-label="Volatility %"><NumField ariaLabel={`Volatility % for ${c.name}`} value={c.volatilityPct} step={0.1} width={80} onChange={(n) => db.assetClasses.update(c.id!, { volatilityPct: Math.max(0, n) })} /></td>
                            <td className="an-cell-act">{!securities.some((s) => s.assetClassId === c.id) && <button className="link danger" aria-label={`Delete ${c.name}`} onClick={() => db.assetClasses.delete(c.id!)}>delete</button>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="an-actions">
                    <input placeholder="New asset class" aria-label="New asset class" value={newClass} onChange={(e) => setNewClass(e.target.value)} />
                    <button onClick={async () => { if (newClass.trim()) { await db.assetClasses.add({ name: newClass.trim(), kind: 'other', expectedReturnPct: 5, volatilityPct: 15 }); setNewClass(''); } }}>Add class</button>
                  </div>
                  <p className="an-note">The “kind” sets how classes move together in the simulation (stocks move with stocks, bonds less so). Allocation colors follow each class’s position in this list.</p>
                </section>
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}
