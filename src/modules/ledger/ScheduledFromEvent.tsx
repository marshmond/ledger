import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db';
import type { HandoffFormProps } from '../../core/registry';
import type { Frequency, RecurringRule } from '../../types';
import { formatCents, parseAmountToCents, todayISO } from '../../lib/money';
import { FREQUENCIES, FREQUENCY_LABEL, matchRepeat } from './fromEvent';

/**
 * "Create scheduled item in Ledger", opened from a Calendar event of type Bill. A prefilled version of the Scheduled page's own
 * form: the event supplies the name, date and repeat; this asks for what an event cannot know (account, amount, category or
 * transfer). Nothing is written until the second step is confirmed. The Calendar then retires the event.
 */
export default function ScheduledFromEvent({ seed, consequence, onCreated, onCancel }: HandoffFormProps) {
  const accounts = (useLiveQuery(() => db.accounts.toArray(), []) ?? []).filter((a) => !a.closed);
  const cats = useLiveQuery(() => db.categories.toArray(), []) ?? [];
  const groups = useLiveQuery(() => db.categoryGroups.toArray(), []) ?? [];
  const match = matchRepeat(seed);

  const [step, setStep] = useState<'edit' | 'confirm'>('edit');
  const [accountId, setAccountId] = useState('');
  const [payee, setPayee] = useState(seed.title);
  const [dir, setDir] = useState<'out' | 'in'>('out');
  const [amount, setAmount] = useState('');
  const [choice, setChoice] = useState('');
  const [other, setOther] = useState('');
  const [freq, setFreq] = useState<Frequency | ''>(match.frequency ?? '');
  const [start, setStart] = useState(seed.date);
  const [end, setEnd] = useState(match.endDate ?? '');
  const [semi1, setSemi1] = useState('1');
  const [semi2, setSemi2] = useState('15');
  const [memo, setMemo] = useState(seed.notes);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [draft, setDraft] = useState<RecurringRule | null>(null);
  // With only one account there is nothing to choose.
  useEffect(() => { if (!accountId && accounts.length === 1) setAccountId(String(accounts[0].id)); }, [accounts.length, accountId]); // eslint-disable-line react-hooks/exhaustive-deps

  const acct = (id: string) => accounts.find((a) => String(a.id) === id)?.name ?? '?';
  const catName = (id: string) => cats.find((c) => String(c.id) === id)?.name ?? 'Uncategorized';

  /** Builds the rule from the form, or says what is missing. */
  const build = (): RecurringRule | null => {
    const cents = parseAmountToCents(amount);
    if (!accountId) { setError('Choose an account.'); return null; }
    if (!payee.trim()) { setError('Give it a name.'); return null; }
    if (cents === null || cents === 0) { setError('Enter an amount.'); return null; }
    if (!freq) { setError('Pick how often it repeats.'); return null; }
    if (!start) { setError('Pick the first date.'); return null; }
    if (end && end < start) { setError('The end date is before the first date.'); return null; }
    if (choice === 'transfer' && (!other || other === accountId)) { setError('Choose a different account for the transfer.'); return null; }
    const d1 = Number(semi1), d2 = Number(semi2);
    if (freq === 'semimonthly' && (![d1, d2].every((x) => Number.isInteger(x) && x >= 1 && x <= 31) || d1 === d2)) {
      setError('Pick two different days of the month (31 means the last day).'); return null;
    }
    setError('');
    return {
      accountId: Number(accountId),
      payee: payee.trim(),
      amountCents: dir === 'out' ? -Math.abs(cents) : Math.abs(cents),
      categoryId: choice && choice !== 'transfer' ? Number(choice) : null,
      transferAccountId: choice === 'transfer' ? Number(other) : null,
      memo,
      frequency: freq,
      startDate: start,
      endDate: end || null,
      semiDays: freq === 'semimonthly' ? [d1, d2] : undefined,
      active: true,
    };
  };

  const create = async () => {
    const rule = draft;
    if (!rule) return;
    setBusy(true);
    try {
      const id = await db.recurring.add(rule);
      onCreated({ recordId: `scheduled:${id}`, label: rule.payee });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create it.');
      setBusy(false);
    }
  };

  if (step === 'confirm' && draft) {
    const rule = draft;
    return (
      <div className="stack">
        <p><strong>Ready to create this in Ledger?</strong></p>
        <ul>
          <li>{rule.payee}: {formatCents(rule.amountCents)} {rule.amountCents < 0 ? 'out of' : 'into'} {acct(accountId)}</li>
          <li>{rule.transferAccountId ? `Transfer ${rule.amountCents < 0 ? 'to' : 'from'} ${acct(String(rule.transferAccountId))}` : catName(choice)}</li>
          <li>{FREQUENCY_LABEL[rule.frequency]}{rule.frequency === 'semimonthly' ? ` (days ${rule.semiDays?.join(' and ')})` : ''}, first on {rule.startDate}{rule.endDate ? `, ending ${rule.endDate}` : ''}</li>
        </ul>
        <p>{consequence}</p>
        <div className="row">
          <button className="primary" disabled={busy} onClick={() => void create()}>Create it in Ledger</button>
          <button disabled={busy} onClick={() => setStep('edit')}>Back</button>
          <button className="link" disabled={busy} onClick={onCancel}>Keep it as a calendar event</button>
        </div>
        {error && <div className="error" role="alert">{error}</div>}
      </div>
    );
  }

  const review = () => { const r = build(); if (r) { setDraft(r); setStep('confirm'); } };
  return (
    <form className="stack" onSubmit={(e) => { e.preventDefault(); review(); }}>
      <p className="muted small">Ledger will approve this item each time it comes due, and will own its date and amount from now on. Fill in what a calendar event cannot know.</p>
      {match.note && <p className="warn" role="status">{match.note}</p>}
      {seed.hasExceptions && <p className="warn" role="status">Some single dates of this event were skipped or changed on their own. Those changes do not carry over.</p>}
      <div className="grid">
        <label className="f">Account
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">Choose…</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
        <label className="f">Name<input value={payee} onChange={(e) => setPayee(e.target.value)} /></label>
        <label className="f">Type
          <select value={dir} onChange={(e) => setDir(e.target.value as 'out' | 'in')}>
            <option value="out">Outflow (−)</option>
            <option value="in">Inflow (+)</option>
          </select>
        </label>
        <label className="f">Amount<input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0.00" autoFocus /></label>
        <label className="f">Category
          <select value={choice} onChange={(e) => setChoice(e.target.value)}>
            <option value="">Uncategorized</option>
            <option value="transfer">↔ Transfer to/from another account…</option>
            {groups.map((g) => (
              <optgroup key={g.id} label={g.name}>
                {cats.filter((c) => c.groupId === g.id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </optgroup>
            ))}
          </select>
        </label>
        {choice === 'transfer' && (
          <label className="f">{dir === 'out' ? 'To account' : 'From account'}
            <select value={other} onChange={(e) => setOther(e.target.value)}>
              <option value="">Choose…</option>
              {accounts.filter((a) => String(a.id) !== accountId).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
        )}
        <label className="f">Repeats
          <select value={freq} onChange={(e) => setFreq(e.target.value as Frequency | '')}>
            {!freq && <option value="">Pick one…</option>}
            {FREQUENCIES.map((v) => <option key={v} value={v}>{FREQUENCY_LABEL[v]}</option>)}
          </select>
        </label>
        <label className="f">First date<input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></label>
        <label className="f">Ends (optional)<input type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></label>
        {freq === 'semimonthly' && (
          <>
            <label className="f">1st day of month<input value={semi1} onChange={(e) => setSemi1(e.target.value)} inputMode="numeric" /></label>
            <label className="f">2nd day (31 = last)<input value={semi2} onChange={(e) => setSemi2(e.target.value)} inputMode="numeric" /></label>
          </>
        )}
      </div>
      {start && start < todayISO() && <p className="warn" role="status">The first date is in the past, so every earlier date will show up as due on the Scheduled page. Move it to the next date to avoid that.</p>}
      <label className="f">Memo<input value={memo} onChange={(e) => setMemo(e.target.value)} /></label>
      {error && <div className="error" role="alert">{error}</div>}
      <div className="row">
        <button type="submit" className="primary">Review</button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
