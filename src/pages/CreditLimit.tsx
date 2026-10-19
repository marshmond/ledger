import { useState } from 'react';
import { db } from '../db';
import type { Account } from '../types';
import { creditStatus, parseLimit, utilizationNote } from '../lib/credit';
import { formatCents } from '../lib/money';

/** On a credit card's page: the limit (optional), how much credit is left, and how much of the limit is in use. */
export default function CreditLimit({ account, balance }: { account: Account; balance: number }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const s = creditStatus(balance, account.creditLimitCents);

  async function save() {
    const r = parseLimit(text);
    if ('error' in r) return setErr(r.error);
    await db.accounts.update(account.id!, { creditLimitCents: r.cents });
    setEditing(false);
  }
  const open = () => { setText(account.creditLimitCents ? (account.creditLimitCents / 100).toFixed(2) : ''); setErr(''); setEditing(true); };

  return (
    <div className="card">
      {editing ? (
        <form className="row" onSubmit={(e) => { e.preventDefault(); save(); }}>
          <label className="f">Credit limit (leave blank for none)<input value={text} onChange={(e) => setText(e.target.value)} inputMode="decimal" placeholder="e.g. 5000" autoFocus /></label>
          <button className="primary" type="submit">Save</button>
          <button type="button" onClick={() => setEditing(false)}>Cancel</button>
          {err && <span className="error" role="alert">{err}</span>}
        </form>
      ) : s ? (
        <>
          <div className="row spread">
            <span>Credit left: <strong className={s.level === 'over' ? 'neg' : s.level === 'high' ? 'warn' : 'pos'}>{formatCents(s.available)}</strong> of {formatCents(s.limit)} limit</span>
            <button className="link" onClick={open}>change limit</button>
          </div>
          <div className="progress" role="progressbar" aria-label="Share of the limit in use" aria-valuenow={Math.min(100, Math.round(s.usedPct))} aria-valuemin={0} aria-valuemax={100}>
            <div style={{ width: `${Math.min(100, s.usedPct)}%`, background: s.level === 'over' ? 'var(--neg)' : s.level === 'high' ? 'var(--warn)' : 'var(--pos)' }} />
          </div>
          <div className="muted">{Math.round(s.usedPct)}% of the limit in use. {utilizationNote(s)}</div>
        </>
      ) : (
        <div className="row spread">
          <span className="muted">Add the card’s credit limit to see how much credit is left.</span>
          <button onClick={open}>Set credit limit</button>
        </div>
      )}
    </div>
  );
}
