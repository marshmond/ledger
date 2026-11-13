import PayeeInput from '../ui/PayeeInput';
import { useId, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import type { InvAccount, Person, RsuGrant, RsuVest, Security, VestFrequency } from '../types';
import { formatCents, parseAmountToCents, todayISO } from '../lib/money';
import { resolveVest } from '../lib/rsu';
import { inScope } from './incomeOwners';
import ConfirmDialog from '../shell/ConfirmDialog';
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
  const [askFill, setAskFill] = useState<number | null>(null); // the total shares to split, waiting for the dialog's own button
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
    // NC-29 (D20.1B): when vests are already entered, ask first (the dialog's own button runs the split); with none entered it runs at once, as before.
    if (entered.length > 0) { setAskFill(t); return; }
    await doFill(t);
  }
  async function doFill(t: number) {
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
      {askFill !== null && (
        <ConfirmDialog
          title="Replace entered vests?"
          confirmLabel="Fill evenly"
          busyLabel="Filling…"
          tone="primary"
          kind="replace"
          onCancel={() => setAskFill(null)}
          // The one existing operation, run once. The count shown is the live one, so it is what is stored when the button is pressed.
          onConfirm={async () => { await doFill(askFill); setAskFill(null); }}
        >
          <p>Replace the {entered.length} vest{entered.length === 1 ? '' : 's'} already entered for <strong>{grant.name}</strong> with an even split of {askFill} shares over {dates.length} vest dates?</p>
          <p>Shares you typed on individual vests are overwritten. Vests whose shares were already added to holdings are kept.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}

export default function RsuGrants({ people, vests, securities, invAccounts, personId, unassigned }: {
  people: Person[]; vests: RsuVest[]; securities: Security[]; invAccounts: InvAccount[];
  /** D18.1: show only this person's grants (by stored person id). A new grant starts with this person and the person cannot be changed on a new grant. */
  personId?: number;
  /** D18.1: show only the grants whose person is no longer on the page. Nothing is created or reassigned automatically. */
  unassigned?: boolean;
}) {
  const allGrants = useLiveQuery(() => db.rsuGrants.toArray(), []) ?? [];
  const grants = allGrants.filter((g) => inScope(g.personId, { personId, unassigned }, people));
  const scoped = personId !== undefined;
  const uid = useId(); // radio groups need a name of their own when several people's forms are on one page
  const startPerson = scoped ? personId : unassigned ? undefined : people[0]?.id;
  const classes = useLiveQuery(() => db.assetClasses.toArray(), []) ?? [];
  const hasKey = !!(useLiveQuery(() => db.settings.get('priceApiKey'), []) as { value?: string } | undefined)?.value;
  const [draft, setDraft] = useState<Partial<RsuGrant>>(() => blank(startPerson));
  const [ticker, setTicker] = useState('');
  const [priceText, setPriceText] = useState('');
  const [editing, setEditing] = useState<number | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  // D20.1B (NC-30, NC-31): the grant save that would drop vests (the grant, the resolved stock, the vests by id), and the grant whose "delete" was pressed (by id).
  // Nothing is saved or deleted until the dialog's own button is pressed.
  const [askSave, setAskSave] = useState<{ full: RsuGrant; security: Security | undefined; goneIds: number[] } | null>(null);
  const [askDelete, setAskDelete] = useState<number | null>(null);
  const askDeleteGrant = askDelete === null ? undefined : allGrants.find((x) => x.id === askDelete);

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
    setDraft(blank(startPerson));
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
    // A new grant in one person's workspace always belongs to that person; only editing an existing grant can deliberately move it to someone else.
    const g = { ...draft, personId: scoped && !editing ? personId : draft.personId ?? (people.length === 1 ? people[0].id : undefined), priceCents, securityId: security?.id ?? null, years: Number(draft.years), cliffMonths: draft.cliffMonths || null } as Partial<RsuGrant>;
    const problem = grantProblem(g);
    if (problem) return setMsg(problem);
    const full = { ...g, ...(editing ? { id: editing } : {}) } as RsuGrant;
    if (editing) {
      // NC-30 (D20.1B): validated first, then the vests this schedule would drop are listed and the question is asked. Nothing is saved until the dialog's own button is pressed.
      const gone = scheduleChange(full, vests).orphaned.filter((v) => !v.recorded);
      if (gone.length > 0) { setAskSave({ full, security, goneIds: gone.map((v) => v.id!) }); return; }
    }
    await commitSave(full, security);
  }
  /** The save itself (unchanged): the grant, its vests that no longer fit, then the optional price lookup. */
  async function commitSave(full: RsuGrant, security: Security | undefined) {
    setBusy(true);
    try {
      const id = await saveGrant(db, full);
      let note = 'Saved';
      if (security && security.priceCents == null) {
        const r = await refreshSecurityPrice(db, security);
        note = r.ok ? `Saved. ${r.message}` : `Saved. ${r.message}`;
      }
      setMsg(note);
      setOpen(id);
      setEditing(null);
      setAdding(false);
      setDraft(blank(startPerson));
      setTicker('');
      setPriceText('');
    } finally {
      setBusy(false);
    }
  }
  /** NC-30, on confirm: the grant and its vests are read again; if what would be dropped is no longer the list that was shown, nothing is saved and the dialog says so. */
  async function confirmSave(a: { full: RsuGrant; security: Security | undefined; goneIds: number[] }) {
    if (!(await db.rsuGrants.get(a.full.id!))) throw new Error('This grant no longer exists. Nothing was saved.');
    const fresh = await db.rsuVests.where('grantId').equals(a.full.id!).toArray();
    const now = scheduleChange(a.full, fresh).orphaned.filter((v) => !v.recorded).map((v) => v.id!).sort((x, y) => x - y);
    const shown = [...a.goneIds].sort((x, y) => x - y);
    if (now.length !== shown.length || now.some((x, i) => x !== shown[i])) {
      setAskSave({ ...a, goneIds: now });
      return `The vests this schedule would drop changed while the question was open (now ${now.length}). Nothing was saved. Check the list and confirm again.`;
    }
    await commitSave(a.full, a.security);
    setAskSave(null);
  }

  const dateCount = draft.startDate && draft.frequency && Number(draft.years) >= 1 ? vestDates({ startDate: draft.startDate, frequency: draft.frequency, years: Number(draft.years), cliffMonths: draft.cliffMonths }).length : 0;

  return (
    <div className="card">
      <div className="row spread">
        <strong>Grants with a vesting schedule</strong>
        {!adding && !unassigned && <button onClick={() => { setAdding(true); setMsg(''); }}>{scoped ? `New grant for ${personName(personId!)}` : 'New grant'}</button>}
      </div>
      <p className="muted">
        Enter the grant once: its start date, how often it vests, and how many years it runs. The app works out every vest date; then you fill in the shares for each
        date. Whether it vests as cash or as stock is set here once. For a single vest or one that already happened, use “Add a single vest” below.
      </p>

      {adding && (
        <div className="card">
          <strong>{editing ? 'Edit grant' : scoped ? `New grant for ${personName(personId!)}` : 'New grant'}</strong>
          <div className="row" style={{ marginTop: 6 }}>
            {scoped && !editing ? (
              <div className="f">Person<span className="pw-owner">{personName(personId!)}</span></div>
            ) : (
              <label className="f">Person
                <select value={draft.personId ?? (people.length === 1 ? people[0].id : '')} onChange={(e) => set({ personId: Number(e.target.value) })}>
                  <option value="">Choose…</option>
                  {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>
            )}
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
            <label className="chk"><input type="radio" name={`grantkind${uid}`} checked={draft.kind === 'cash'} onChange={() => set({ kind: 'cash' })} /> Vests as cash</label>
            <label className="chk"><input type="radio" name={`grantkind${uid}`} checked={draft.kind === 'stock'} onChange={() => set({ kind: 'stock' })} /> Tied to common stock</label>
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
                  <PayeeInput style={{ width: 120 }} value={ticker} onChange={(v) => setTicker(v.toUpperCase())} options={securities.map((s) => s.ticker)} placeholder="e.g. ACME" />
                </label>
                <span className="muted">
                  {hasKey ? 'The price is looked up with your price key when the grant is saved, and the refresh button on the grant updates it.' : 'No price key on this device, so the price stays manual. Add a key under Prices & assumptions on the Investments tab to look prices up automatically.'}
                </span>
              </div>
              <fieldset className="checks" style={{ border: 0, padding: 0, margin: '8px 0' }}>
                <legend className="muted">After each vest</legend>
                <label className="chk"><input type="radio" name={`grantafter${uid}`} checked={draft.afterVest !== 'held'} onChange={() => set({ afterVest: 'sold' })} /> Sold immediately (cash income)</label>
                <label className="chk"><input type="radio" name={`grantafter${uid}`} checked={draft.afterVest === 'held'} onChange={() => set({ afterVest: 'held' })} /> Held in a brokerage account</label>
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
          {editing && (scoped || unassigned) && <p className="muted" style={{ marginBottom: 0 }}>Choosing a different person moves this grant, and every vest it has produced, to that person.</p>}
        </div>
      )}
      {msg && <p className={msg.startsWith('Saved') || msg.startsWith('Split') ? 'ok' : 'error'} role="status">{msg}</p>}

      {grants.length === 0 && !adding && <p className="muted">{unassigned ? 'No grants without a matching person.' : scoped ? `No grants for ${personName(personId!)} yet.` : 'No grants yet.'}</p>}
      {grants.map((g) => {
        const sec = secOf(g.securityId);
        const mine = vests.filter((v) => v.grantId === g.id);
        const shown = open === g.id;
        return (
          <div className="card" key={g.id}>
            <div className="row spread">
              <div>
                <strong>{g.name}</strong> {(!scoped) && <span className={unassigned ? 'warn' : 'muted'}>· {unassigned ? 'no matching person' : personName(g.personId)}</span>}
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
                <button className="link danger" aria-label={`Delete grant ${g.name}`} onClick={() => setAskDelete(g.id!)}>delete</button>
              </div>
            </div>
            {shown && <Worksheet grant={g} vests={vests} security={sec} />}
          </div>
        );
      })}
      {askSave && (() => {
        const dropped = vests.filter((v) => askSave.goneIds.includes(v.id!)).sort((x, y) => x.date.localeCompare(y.date));
        return (
          <ConfirmDialog
            title="Replace vest schedule?"
            confirmLabel="Save and drop vests"
            busyLabel="Saving…"
            kind="replace"
            onCancel={() => setAskSave(null)}
            onConfirm={() => confirmSave(askSave)}
          >
            <p>Saving <strong>{askSave.full.name}</strong> with this schedule drops {askSave.goneIds.length} vest{askSave.goneIds.length === 1 ? '' : 's'} that no longer fall on a vest date.</p>
            <ul className="plain">
              {dropped.slice(0, 8).map((v) => <li key={v.id} className="small">{v.date}: {v.shares} share{v.shares === 1 ? '' : 's'}</li>)}
              {dropped.length > 8 && <li className="muted small">…and {dropped.length - 8} more</li>}
            </ul>
            <p>Vests whose shares were already added to holdings are kept and are not part of this count.</p>
          </ConfirmDialog>
        );
      })()}
      {askDeleteGrant && (() => {
        const mine = vests.filter((v) => v.grantId === askDeleteGrant.id);
        const held = mine.filter((v) => v.recorded).length;
        return (
          <ConfirmDialog
            title="Delete grant?"
            confirmLabel="Delete grant"
            busyLabel="Deleting…"
            kind="irreversible"
            onCancel={() => setAskDelete(null)}
            onConfirm={async () => { await deleteGrant(db, askDeleteGrant.id!); setMsg('Saved. Grant deleted'); setAskDelete(null); }}
          >
            <p><strong>{askDeleteGrant.name}</strong></p>
            <p>This deletes the grant and its {mine.length - held} vest{mine.length - held === 1 ? '' : 's'}.{held ? ` ${held} vest${held === 1 ? ' that was' : 's that were'} already added to holdings will stay as single vests.` : ''}</p>
          </ConfirmDialog>
        );
      })()}
    </div>
  );
}
