import { useState } from 'react';
import { db } from '../db';
import type { IncomeProfile, InvAccount, Person, RsuVest, Security } from '../types';
import type { TaxTables } from '../data/taxYears';
import type { IncomeModel } from '../lib/income';
import { formatCents, parseAmountToCents, todayISO } from '../lib/money';
import { recordHeldVest, vestOutcome, vestProblem, type ResolvedVest } from '../lib/rsu';
import { NumField } from './fields';
import Collapsible from './Collapsible';

const SOURCE_TEXT = { deal: 'deal price', actual: 'actual vest price', current: 'current price', none: 'no price' } as const;

const blank = (personId: number | undefined): Partial<RsuVest> => ({ personId, date: todayISO(), grant: '', kind: 'cash', shares: 0, priceCents: null, securityId: null, afterVest: 'sold', accountId: null });

/** Inline price box for one vest: the cash deal price, or (stock) the actual price once the vest has happened. */
function VestPrice({ r }: { r: ResolvedVest }) {
  const v = r.vest;
  const stored = v.priceCents != null && v.priceCents > 0 ? (v.priceCents / 100).toFixed(2) : '';
  const [text, setText] = useState(stored);
  const [bad, setBad] = useState(false);
  const commit = async () => {
    if (text.trim() === stored) return setBad(false);
    if (text.trim() === '') {
      if (v.kind === 'cash') { setText(stored); return setBad(true); } // a cash vest needs its price
      await db.rsuVests.update(v.id!, { priceCents: null });
      return setBad(false);
    }
    const c = parseAmountToCents(text);
    if (c === null || c <= 0) { setBad(true); setText(stored); return; }
    setBad(false);
    await db.rsuVests.update(v.id!, { priceCents: c });
  };
  return (
    <div>
      <input
        style={{ width: 88, textAlign: 'right' }}
        inputMode="decimal"
        placeholder={v.kind === 'stock' && r.priceCents ? (r.priceCents / 100).toFixed(2) : 'price'}
        aria-label={`${v.kind === 'cash' ? 'Price per share' : 'Actual vest price'} for ${v.grant || 'vest'} on ${v.date}`}
        value={text}
        aria-invalid={bad}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      <div className={bad ? 'error' : 'muted'} style={{ fontSize: '0.75rem' }}>{bad ? 'Enter a price above zero' : SOURCE_TEXT[r.source]}</div>
    </div>
  );
}

export default function RsuSection({
  year, people, profiles, model, vests, securities, invAccounts, tables,
}: {
  year: number;
  people: Person[];
  profiles: IncomeProfile[];
  model: IncomeModel;
  vests: RsuVest[];
  securities: Security[];
  invAccounts: InvAccount[];
  tables: TaxTables | null;
}) {
  const [draft, setDraft] = useState<Partial<RsuVest>>(() => blank(people[0]?.id));
  const [editing, setEditing] = useState<number | null>(null);
  const [sharesText, setSharesText] = useState('');
  const [priceText, setPriceText] = useState('');
  const [msg, setMsg] = useState('');
  const [showAll, setShowAll] = useState(false);

  const personName = (id: number) => people.find((p) => p.id === id)?.name ?? '?';
  const secName = (id?: number | null) => securities.find((s) => s.id === id)?.ticker ?? '';
  const brokerage = invAccounts.filter((a) => !a.closed && a.kind === 'brokerage');
  const set = (patch: Partial<RsuVest>) => setDraft((d) => ({ ...d, ...patch }));

  const shown = model.vests
    .filter((r) => showAll || r.vest.date.startsWith(`${year}-`))
    .sort((a, b) => a.vest.date.localeCompare(b.vest.date) || a.vest.personId - b.vest.personId);
  const missingProfile = (r: ResolvedVest) => !profiles.some((p) => p.personId === r.vest.personId && r.vest.date.startsWith(`${p.year}-`));
  const yearOf = (r: ResolvedVest) => model.years.find((y) => y.personId === r.vest.personId && y.year === Number(r.vest.date.slice(0, 4)));

  function startEdit(v: RsuVest) {
    setEditing(v.id!);
    setDraft({ ...v });
    setSharesText(String(v.shares));
    setPriceText(v.priceCents ? (v.priceCents / 100).toFixed(2) : '');
    setMsg('');
  }
  function reset() {
    setEditing(null);
    setDraft(blank(people[0]?.id));
    setSharesText('');
    setPriceText('');
  }
  async function save() {
    const shares = Number(sharesText);
    const priceCents = priceText.trim() === '' ? null : parseAmountToCents(priceText);
    if (priceText.trim() !== '' && (priceCents === null || priceCents <= 0)) return setMsg('The price is not a valid amount');
    const v = { ...draft, shares: Number.isFinite(shares) ? shares : 0, priceCents } as Partial<RsuVest>;
    const problem = vestProblem(v);
    if (problem) return setMsg(problem);
    const clean: RsuVest = {
      personId: v.personId!,
      date: v.date!,
      grant: (v.grant ?? '').trim(),
      kind: v.kind!,
      shares: v.shares!,
      priceCents: v.priceCents ?? null,
      securityId: v.kind === 'stock' ? v.securityId! : null,
      afterVest: v.kind === 'stock' ? v.afterVest ?? 'sold' : undefined,
      accountId: v.kind === 'stock' && v.afterVest === 'held' ? v.accountId ?? null : null,
      recorded: editing ? vests.find((x) => x.id === editing)?.recorded && v.kind === 'stock' && v.afterVest === 'held' : false,
    };
    if (editing) await db.rsuVests.put({ ...clean, id: editing });
    else await db.rsuVests.add(clean);
    setMsg('Saved');
    reset();
  }

  const fedDefault = tables ? +(tables.supplementalFedRate * 100).toFixed(2) : 22;
  const stateDefault = tables ? +(tables.ma.withholdingRate * 100).toFixed(2) : 5;
  const yearProfiles = profiles.filter((p) => p.year === year);

  return (
    <Collapsible id="income.rsu" title="Stock awards (RSUs)">
      <p className="muted">
        Enter each vest date. A vest is taxed as wages on its date: Social Security, Medicare, and the income-tax estimates all include it.
        Choose <strong>cash</strong> if the award pays out in cash at a set price per share, or <strong>common stock</strong> if it vests as shares.
      </p>

      <div className="card">
        <strong>{editing ? 'Edit vest' : 'Add a vest'}</strong>
        <div className="row" style={{ marginTop: 6 }}>
          <label className="f">Person
            <select value={draft.personId ?? ''} onChange={(e) => set({ personId: Number(e.target.value) })}>
              <option value="">Choose…</option>
              {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label className="f">Vest date<input type="date" value={draft.date ?? ''} onChange={(e) => set({ date: e.target.value })} /></label>
          <label className="f">Grant (optional)<input value={draft.grant ?? ''} onChange={(e) => set({ grant: e.target.value })} placeholder="2024 new-hire grant" /></label>
          <label className="f">Shares<input inputMode="decimal" style={{ width: 90 }} value={sharesText} onChange={(e) => setSharesText(e.target.value)} placeholder="0" /></label>
        </div>

        <fieldset className="checks" style={{ border: 0, padding: 0, margin: '8px 0' }}>
          <legend className="muted">How does this award pay out?</legend>
          <label className="chk"><input type="radio" name="rsukind" checked={draft.kind === 'cash'} onChange={() => set({ kind: 'cash' })} /> Vests as cash</label>
          <label className="chk"><input type="radio" name="rsukind" checked={draft.kind === 'stock'} onChange={() => set({ kind: 'stock' })} /> Tied to common stock</label>
        </fieldset>

        {draft.kind === 'cash' ? (
          <div className="row">
            <label className="f">Synthetic price per share<input inputMode="decimal" style={{ width: 120 }} value={priceText} onChange={(e) => setPriceText(e.target.value)} placeholder="e.g. 12.50" /></label>
            <span className="muted">The fixed price this award pays at. Value = shares × this price. No stock ticker is needed.</span>
          </div>
        ) : (
          <>
            <div className="row">
              <label className="f">Stock
                <select value={draft.securityId ?? ''} onChange={(e) => set({ securityId: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">Choose…</option>
                  {securities.map((s) => <option key={s.id} value={s.id}>{s.ticker}{s.name && s.name !== s.ticker ? ` · ${s.name}` : ''}</option>)}
                </select>
              </label>
              <label className="f">Actual vest price (optional)<input inputMode="decimal" style={{ width: 120 }} value={priceText} onChange={(e) => setPriceText(e.target.value)} placeholder="uses current price" /></label>
            </div>
            {securities.length === 0 && <p className="warn">Add the ticker on the Investments tab first (under Holdings vehicles and prices), then pick it here.</p>}
            <p className="muted">Until you enter the actual vest price, future vests are valued at the stock’s current price. The actual price also becomes the cost basis of any shares you keep.</p>
            <fieldset className="checks" style={{ border: 0, padding: 0, margin: '8px 0' }}>
              <legend className="muted">After it vests</legend>
              <label className="chk"><input type="radio" name="rsuafter" checked={draft.afterVest !== 'held'} onChange={() => set({ afterVest: 'sold' })} /> Sold immediately (cash income)</label>
              <label className="chk"><input type="radio" name="rsuafter" checked={draft.afterVest === 'held'} onChange={() => set({ afterVest: 'held' })} /> Held in a brokerage account</label>
            </fieldset>
            {draft.afterVest === 'held' && (
              <label className="f">Brokerage account
                <select value={draft.accountId ?? ''} onChange={(e) => set({ accountId: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">Choose…</option>
                  {brokerage.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </label>
            )}
            {draft.afterVest === 'held' && brokerage.length === 0 && <p className="warn">Create a brokerage account on the Investments tab first.</p>}
          </>
        )}

        <div className="row" style={{ marginTop: 8 }}>
          <button className="primary" onClick={save}>{editing ? 'Save changes' : 'Add vest'}</button>
          {editing && <button onClick={reset}>Cancel</button>}
          {msg && <span className={msg === 'Saved' ? 'ok' : 'error'} role="status">{msg}</span>}
        </div>
      </div>

      {yearProfiles.length > 0 && (
        <details style={{ margin: '8px 0' }}>
          <summary><strong>Withholding on vests</strong> <span className="muted">(defaults: federal {fedDefault}%, MA {stateDefault}%, plus Social Security and Medicare)</span></summary>
          <p className="muted">Companies differ here. Set the rates your payer actually withholds, so the take-home and refund-or-owe estimates match.</p>
          <div className="row">
            {yearProfiles.map((p) => (
              <div className="card" key={p.id}>
                <strong>{personName(p.personId)}</strong>
                <div className="row">
                  <NumField label="Federal %" width={80} value={p.rsuWithholding?.fedPct ?? fedDefault} step={0.5}
                    onChange={(n) => db.incomeProfiles.update(p.id!, { rsuWithholding: { fedPct: n, statePct: p.rsuWithholding?.statePct ?? stateDefault } })} />
                  <NumField label="MA %" width={80} value={p.rsuWithholding?.statePct ?? stateDefault} step={0.5}
                    onChange={(n) => db.incomeProfiles.update(p.id!, { rsuWithholding: { fedPct: p.rsuWithholding?.fedPct ?? fedDefault, statePct: n } })} />
                  {p.rsuWithholding && <button className="link" onClick={() => db.incomeProfiles.update(p.id!, { rsuWithholding: undefined })}>use defaults</button>}
                </div>
              </div>
            ))}
          </div>
        </details>
      )}

      <div className="row spread">
        <strong>{showAll ? 'All vests' : `Vests in ${year}`}</strong>
        <label className="chk"><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Show every year</label>
      </div>
      {shown.length === 0 ? <p className="muted">No vests entered{showAll ? '' : ` for ${year}`}.</p> : (
        <div className="scroll-x">
          <table>
            <thead>
              <tr><th>Date</th><th>Person</th><th>Award</th><th className="num">Shares</th><th className="num">Price</th><th className="num">Value</th><th className="num">After tax</th><th>After vest</th><th /></tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const v = r.vest;
                const o = vestOutcome(r, yearOf(r));
                const inYear = v.date.startsWith(`${year}-`);
                const due = v.date <= todayISO() && inYear;
                const held = v.kind === 'stock' && v.afterVest === 'held';
                return (
                  <tr key={v.id}>
                    <td>{v.date}{v.date > todayISO() && <span className="badge"> upcoming</span>}</td>
                    <td>{personName(v.personId)}</td>
                    <td>{v.grant || '—'}<div className="muted" style={{ fontSize: '0.75rem' }}>{v.kind === 'cash' ? 'Cash' : `Stock · ${secName(v.securityId)}`}</div></td>
                    <td className="num">{v.shares}</td>
                    <td className="num"><VestPrice key={`${v.id}-${v.priceCents}`} r={r} /></td>
                    <td className="num">{r.warning ? <span className="warn">no value</span> : formatCents(r.grossCents)}</td>
                    <td className="num">
                      {r.grossCents === 0 || !inYear ? '—' : held ? `${o.sharesKept.toFixed(3)} sh` : formatCents(o.netCashCents)}
                      {!inYear && <div className="muted" style={{ fontSize: '0.75rem' }}>pick {v.date.slice(0, 4)} above</div>}
                      {missingProfile(r) && <div className="warn" style={{ fontSize: '0.75rem' }}>no {v.date.slice(0, 4)} income setup: not in tax totals</div>}
                    </td>
                    <td>
                      {v.kind === 'cash' ? 'Paid in cash' : held ? `Held · ${invAccounts.find((a) => a.id === v.accountId)?.name ?? '?'}` : 'Sold'}
                      {held && v.recorded && <div className="ok" style={{ fontSize: '0.75rem' }}>in holdings</div>}
                    </td>
                    <td>
                      {held && !v.recorded && due && r.grossCents > 0 && (
                        <button
                          className="link"
                          title="Add the shares you kept (after the tax is covered by selling shares) to the account’s holdings"
                          onClick={async () => {
                            const res = await recordHeldVest(db, v.id!, o);
                            setMsg(res === 'recorded' ? `Added ${o.sharesKept.toFixed(3)} shares to holdings` : 'Could not record this vest');
                          }}
                        >add to holdings</button>
                      )}{' '}
                      <button className="link" onClick={() => startEdit(v)}>edit</button>{' '}
                      <button className="link danger" onClick={() => confirm(`Delete this ${v.date} vest?${v.recorded ? ' The shares already added to holdings stay there.' : ''}`) && db.rsuVests.delete(v.id!)}>delete</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {model.vests.some((r) => r.warning) && <p className="warn">Vests with no price are left out of your income until they have one.</p>}
      <p className="muted">
        Held stock: the tax is assumed to be covered by selling shares on the vest date, so you keep the net shares and the cost basis is the net value.
        “Add to holdings” puts them in the account once the vest date has passed. Before that they are projections only.
      </p>
    </Collapsible>
  );
}
