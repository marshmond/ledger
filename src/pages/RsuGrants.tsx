import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import type { InvAccount, Person, RsuGrant, RsuVest, Security, VestFrequency } from '../types';
import { formatCents, parseAmountToCents, todayISO } from '../lib/money';
import { resolveVest } from '../lib/rsu';
import {
  FREQUENCY_LABELS, deleteGrant, fillEvenly, grantProblem, refreshSecurityPrice, saveGrant, scheduleChange, securityForTicker, setVestShares, vestDates,
} from '../lib/rsuGrant';

const blank = (personId: number | undefined): Partial<RsuGrant> => ({ personId, name: '', startDate: todayISO(), frequency: 'quarterly', years: 4, cliffMonths: null, kind: 'cash', priceCents: null, afterVest: 'sold', accountId: null });

/** A text box that saves when you click away or press Enter; text that is not valid goes back to the saved value. */
function CommitBox({ value, label, width, placeholder, onCommit }: { value: string; label: string; width: number; placeholder?: string; onCommit: (text: string) => Promise<boolean> | boolean }) {
  const [text, setText] = useState(value);
  const [bad, setBad] = useState(false);
  return (
    <input
      style={{ width, textAlign: 'right' }}
      inputMode="decimal"
      aria-label={label}
      aria-invalid={bad}
      placeholder={placeholder}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      onBlur={async () => {
        if (text.trim() === value) return setBad(false);
        const ok = await onCommit(text);
        setBad(!ok);
        if (!ok) setText(value);
      }}
    />
  );
}

function Worksheet({ grant, vests, security }: { grant: RsuGrant; vests: RsuVest[]; security?: Security }) {
  const [total, setTotal] = useState('');
  const [msg, setMsg] = useState('');
  const dates = vestDates(grant);
  const byDate = new Map(vests.filter((v) => v.grantId === grant.id).map((v) => [v.date, v]));
  const today = todayISO();
  const entered = [...byDate.values()];
  const sumShares = entered.reduce((s, v) => s + v.shares, 0);
  const sumValue = entered.reduce((s, v) => s + resolveVest(v, security ? [security] : []).grossCents, 0);
  const cash = grant.kind === 'cash';

  async function fill() {
    const t = Number(total);
    if (!(t > 0)) return setMsg('Enter the total number of shares to split');
    if (entered.length > 0 && !confirm(`Replace the ${entered.length} vest${entered.length === 1 ? '' : 's'} already entered with an even split of ${t} shares?`)) return;
    await fillEvenly(db, grant, t);
    setMsg(`Split ${t} shares over ${dates.length} vests`);
    setTotal('');
  }

  return (
    <div style={{ marginTop: 8 }}>
      <div className="row">
        <label className="f">Total shares to split evenly<input inputMode="decimal" style={{ width: 130 }} value={total} onChange={(e) => setTotal(e.target.value)} placeholder="e.g. 160" /></label>
        <button onClick={fill}>Fill evenly</button>
        {msg && <span className="muted" role="status">{msg}</span>}
      </div>
      <div className="scroll-x">
        <table>
          <thead>
            <tr><th>Vest date</th><th className="num">Shares</th><th className="num">{cash ? 'Price per share' : 'Actual vest price'}</th><th className="num">Value</th><th>Status</th></tr>
          </thead>
          <tbody>
            {dates.map((date) => {
              const v = byDate.get(date);
              const r = v ? resolveVest(v, security ? [security] : []) : null;
              return (
                <tr key={date} className={v ? undefined : 'muted'}>
                  <td style={{ whiteSpace: 'nowrap' }}>{date}{date > today && <div className="badge" style={{ width: 'fit-content' }}>upcoming</div>}</td>
                  <td className="num">
                    {v?.recorded ? <>{v.shares}<div className="ok" style={{ fontSize: '0.75rem' }}>in holdings</div></> : (
                      <CommitBox
                        key={`${date}-${v?.shares ?? ''}`}
                        label={`Shares vesting on ${date}`}
                        width={90}
                        placeholder="0"
                        value={v ? String(v.shares) : ''}
                        onCommit={async (t) => {
                          const n = t.trim() === '' ? 0 : Number(t);
                          if (!Number.isFinite(n) || n < 0) return false;
                          await setVestShares(db, grant, date, n);
                          return true;
                        }}
                      />
                    )}
                  </td>
                  <td className="num">
                    {v && !v.recorded ? (
                      <CommitBox
                        key={`${date}-${v.priceCents ?? ''}-${grant.priceCents ?? ''}`}
                        label={`${cash ? 'Price per share' : 'Actual vest price'} for ${date}`}
                        width={88}
                        placeholder={cash ? (grant.priceCents ? (grant.priceCents / 100).toFixed(2) : 'price') : security?.priceCents ? (security.priceCents / 100).toFixed(2) : 'price'}
                        value={v.priceCents && v.priceCents > 0 && (!cash || v.priceCents !== grant.priceCents) ? (v.priceCents / 100).toFixed(2) : ''}
                        onCommit={async (t) => {
                          if (t.trim() === '') { await db.rsuVests.update(v.id!, { priceCents: cash ? grant.priceCents ?? null : null }); return true; }
                          const c = parseAmountToCents(t);
                          if (c === null || c <= 0) return false;
                          await db.rsuVests.update(v.id!, { priceCents: c });
                          return true;
                        }}
                      />
                    ) : v ? (r?.priceCents ? formatCents(r.priceCents) : '—') : '—'}
                  </td>
                  <td className="num">{!v ? '—' : r?.warning ? <span className="warn">no value</span> : formatCents(r!.grossCents)}</td>
                  <td>{v ? (date <= today ? 'vested' : 'planned') : <span className="muted">enter shares</span>}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr><th>Entered</th><th className="num">{sumShares}</th><th /><th className="num">{formatCents(sumValue)}</th><th>{entered.length} of {dates.length} vests</th></tr>
          </tfoot>
        </table>
      </div>
      {grant.cliffMonths ? <p className="muted">With a {grant.cliffMonths}-month cliff, the first vest usually covers everything earned up to that date, so it is often larger than the ones after it.</p> : null}
    </div>
  );
}

export default function RsuGrants({ people, vests, securities, invAccounts }: { people: Person[]; vests: RsuVest[]; securities: Security[]; invAccounts: InvAccount[] }) {
  const grants = useLiveQuery(() => db.rsuGrants.toArray(), []) ?? [];
  const classes = useLiveQuery(() => db.assetClasses.toArray(), []) ?? [];
  const hasKey = !!(useLiveQuery(() => db.settings.get('priceApiKey'), []) as { value?: string } | undefined)?.value;
  const [draft, setDraft] = useState<Partial<RsuGrant>>(() => blank(people[0]?.id));
  const [ticker, setTicker] = useState('');
  const [priceText, setPriceText] = useState('');
  const [editing, setEditing] = useState<number | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (patch: Partial<RsuGrant>) => setDraft((d) => ({ ...d, ...patch }));
  const brokerage = invAccounts.filter((a) => !a.closed && a.kind === 'brokerage');
  const personName = (id: number) => people.find((p) => p.id === id)?.name ?? '?';
  const secOf = (id?: number | null) => securities.find((s) => s.id === id);
  const defaultClass = classes.find((c) => c.kind === 'equity') ?? classes[0];

  function startEdit(g: RsuGrant) {
    setEditing(g.id!);
    setAdding(true);
    setDraft({ ...g });
    setTicker(secOf(g.securityId)?.ticker ?? '');
    setPriceText(g.priceCents ? (g.priceCents / 100).toFixed(2) : '');
    setMsg('');
  }
  function reset() {
    setEditing(null);
    setAdding(false);
    setDraft(blank(people[0]?.id));
    setTicker('');
    setPriceText('');
  }

  async function save() {
    setMsg('');
    const priceCents = draft.kind === 'cash' ? parseAmountToCents(priceText) : null;
    if (draft.kind === 'cash' && priceText.trim() !== '' && (priceCents === null || priceCents <= 0)) return setMsg('The price is not a valid amount');
    let security: Security | undefined;
    if (draft.kind === 'stock') {
      if (!ticker.trim()) return setMsg('Enter the stock ticker');
      if (!defaultClass) return setMsg('Add an asset class on the Investments tab first');
      security = await securityForTicker(db, ticker, defaultClass.id!);
    }
    const g = { ...draft, personId: draft.personId ?? (people.length === 1 ? people[0].id : undefined), priceCents, securityId: security?.id ?? null, years: Number(draft.years), cliffMonths: draft.cliffMonths || null } as Partial<RsuGrant>;
    const problem = grantProblem(g);
    if (problem) return setMsg(problem);
    const full = { ...g, ...(editing ? { id: editing } : {}) } as RsuGrant;
    if (editing) {
      const gone = scheduleChange(full, vests).orphaned.filter((v) => !v.recorded);
      if (gone.length > 0 && !confirm(`This schedule drops ${gone.length} vest${gone.length === 1 ? '' : 's'} that no longer fall on a vest date (${gone.slice(0, 3).map((v) => `${v.date}: ${v.shares} sh`).join(', ')}${gone.length > 3 ? ', …' : ''}). Continue?`)) return;
    }
    setBusy(true);
    const id = await saveGrant(db, full);
    let note = 'Saved';
    if (security && security.priceCents == null) {
      const r = await refreshSecurityPrice(db, security);
      note = r.ok ? `Saved. ${r.message}` : `Saved. ${r.message}`;
    }
    setBusy(false);
    setMsg(note);
    setOpen(id);
    setEditing(null);
    setAdding(false);
    setDraft(blank(people[0]?.id));
    setTicker('');
    setPriceText('');
  }

  const dateCount = draft.startDate && draft.frequency && Number(draft.years) >= 1 ? vestDates({ startDate: draft.startDate, frequency: draft.frequency, years: Number(draft.years), cliffMonths: draft.cliffMonths }).length : 0;

  return (
    <div className="card">
      <div className="row spread">
        <strong>Grants with a vesting schedule</strong>
        {!adding && <button onClick={() => { setAdding(true); setMsg(''); }}>New grant</button>}
      </div>
      <p className="muted">
        Enter the grant once: its start date, how often it vests, and how many years it runs. The app works out every vest date; then you fill in the shares for each
        date. Whether it vests as cash or as stock is set here once. For a single vest or one that already happened, use “Add a single vest” below.
      </p>

      {adding && (
        <div className="card">
          <strong>{editing ? 'Edit grant' : 'New grant'}</strong>
          <div className="row" style={{ marginTop: 6 }}>
            <label className="f">Person
              <select value={draft.personId ?? (people.length === 1 ? people[0].id : '')} onChange={(e) => set({ personId: Number(e.target.value) })}>
                <option value="">Choose…</option>
                {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <label className="f">Grant name<input value={draft.name ?? ''} onChange={(e) => set({ name: e.target.value })} placeholder="2026 new-hire grant" /></label>
            <label className="f">Start date<input type="date" value={draft.startDate ?? ''} onChange={(e) => set({ startDate: e.target.value })} /></label>
          </div>
          <div className="row">
            <label className="f">Vests
              <select value={draft.frequency} onChange={(e) => set({ frequency: e.target.value as VestFrequency })}>
                {(Object.keys(FREQUENCY_LABELS) as VestFrequency[]).map((f) => <option key={f} value={f}>{FREQUENCY_LABELS[f]}</option>)}
              </select>
            </label>
            <label className="f">Length (years)<input type="number" min={1} max={10} step={1} style={{ width: 90 }} value={draft.years ?? ''} onChange={(e) => set({ years: e.target.value === '' ? undefined : Number(e.target.value) })} /></label>
            <label className="f">Cliff, in months (optional)<input type="number" min={1} step={1} style={{ width: 110 }} value={draft.cliffMonths ?? ''} placeholder="none" onChange={(e) => set({ cliffMonths: e.target.value === '' ? null : Number(e.target.value) })} /></label>
          </div>
          {dateCount > 0 && <p className="muted">{dateCount} vest dates, from {vestDates({ startDate: draft.startDate!, frequency: draft.frequency!, years: Number(draft.years), cliffMonths: draft.cliffMonths })[0]} to {vestDates({ startDate: draft.startDate!, frequency: draft.frequency!, years: Number(draft.years), cliffMonths: draft.cliffMonths }).at(-1)}.</p>}

          <fieldset className="checks" style={{ border: 0, padding: 0, margin: '8px 0' }}>
            <legend className="muted">How does this grant pay out?</legend>
            <label className="chk"><input type="radio" name="grantkind" checked={draft.kind === 'cash'} onChange={() => set({ kind: 'cash' })} /> Vests as cash</label>
            <label className="chk"><input type="radio" name="grantkind" checked={draft.kind === 'stock'} onChange={() => set({ kind: 'stock' })} /> Tied to common stock</label>
          </fieldset>
          {draft.kind === 'cash' ? (
            <div className="row">
              <label className="f">Price per share<input inputMode="decimal" style={{ width: 120 }} value={priceText} onChange={(e) => setPriceText(e.target.value)} placeholder="e.g. 12.50" /></label>
              <span className="muted">Every vest uses this price. You can give any single vest its own price in the worksheet.</span>
            </div>
          ) : (
            <>
              <div className="row">
                <label className="f">Stock ticker
                  <input list="grant-tickers" style={{ width: 120 }} value={ticker} onChange={(e) => setTicker(e.target.value.toUpperCase())} placeholder="e.g. ACME" />
                  <datalist id="grant-tickers">{securities.map((s) => <option key={s.id} value={s.ticker}>{s.name}</option>)}</datalist>
                </label>
                <span className="muted">
                  {hasKey ? 'The price is looked up with your price key when the grant is saved, and the refresh button on the grant updates it.' : 'No price key on this device, so the price stays manual. Add a key under Prices & assumptions on the Investments tab to look prices up automatically.'}
                </span>
              </div>
              <fieldset className="checks" style={{ border: 0, padding: 0, margin: '8px 0' }}>
                <legend className="muted">After each vest</legend>
                <label className="chk"><input type="radio" name="grantafter" checked={draft.afterVest !== 'held'} onChange={() => set({ afterVest: 'sold' })} /> Sold immediately (cash income)</label>
                <label className="chk"><input type="radio" name="grantafter" checked={draft.afterVest === 'held'} onChange={() => set({ afterVest: 'held' })} /> Held in a brokerage account</label>
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
            <button className="primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Create grant'}</button>
            <button onClick={reset}>Cancel</button>
          </div>
        </div>
      )}
      {msg && <p className={msg.startsWith('Saved') || msg.startsWith('Split') ? 'ok' : 'error'} role="status">{msg}</p>}

      {grants.length === 0 && !adding && <p className="muted">No grants yet.</p>}
      {grants.map((g) => {
        const sec = secOf(g.securityId);
        const mine = vests.filter((v) => v.grantId === g.id);
        const shown = open === g.id;
        return (
          <div className="card" key={g.id}>
            <div className="row spread">
              <div>
                <strong>{g.name}</strong> <span className="muted">· {personName(g.personId)}</span>
                <div className="muted">
                  {FREQUENCY_LABELS[g.frequency]} for {g.years} year{g.years === 1 ? '' : 's'} from {g.startDate}{g.cliffMonths ? `, ${g.cliffMonths}-month cliff` : ''} ·{' '}
                  {g.kind === 'cash' ? `cash at ${g.priceCents ? formatCents(g.priceCents) : '—'} a share` : `stock ${sec?.ticker ?? '?'}${sec?.priceCents ? ` at ${formatCents(sec.priceCents)}${sec.priceDate ? ` (${sec.priceDate})` : ''}` : ' (no price yet)'}, ${g.afterVest === 'held' ? `held in ${invAccounts.find((a) => a.id === g.accountId)?.name ?? '?'}` : 'sold at vest'}`}
                  {' '}· {mine.length} of {vestDates(g).length} vests entered
                </div>
              </div>
              <div className="row">
                <button className="link" onClick={() => setOpen(shown ? null : g.id!)}>{shown ? 'hide worksheet' : 'worksheet'}</button>
                {g.kind === 'stock' && sec && (
                  <button className="link" onClick={async () => { const r = await refreshSecurityPrice(db, sec); setMsg(r.ok ? `Saved. ${r.message}` : r.message); }}>refresh price</button>
                )}
                <button className="link" onClick={() => startEdit(g)}>edit</button>
                <button className="link danger" onClick={async () => {
                  const held = mine.filter((v) => v.recorded).length;
                  if (!confirm(`Delete “${g.name}” and its ${mine.length - held} vest${mine.length - held === 1 ? '' : 's'}?${held ? ` ${held} vest${held === 1 ? ' that was' : 's that were'} already added to holdings will stay as single vests.` : ''}`)) return;
                  await deleteGrant(db, g.id!);
                  setMsg('Saved. Grant deleted');
                }}>delete</button>
              </div>
            </div>
            {shown && <Worksheet grant={g} vests={vests} security={sec} />}
          </div>
        );
      })}
    </div>
  );
}
