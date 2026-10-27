import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import type { AccountKind } from '../types';
import { formatCents, parseAmountToCents, todayISO } from '../lib/money';
import { creditStatus, parseLimit } from '../lib/credit';
import { canBePrimary, getPrimaryAccountId } from '../lib/primaryAccount';
import { BACKUP_STALE_DAYS } from './BackupPage';
import { Banner, PageHeader } from '../ui/components';

const KIND_LABEL: Record<AccountKind, string> = {
  checking: 'Checking',
  savings: 'Savings',
  credit_card: 'Credit Card',
  loan: 'Loan',
};

/** Accounts you can add by hand. Loans are created from the Debt tab so they carry their schedule. */
const ADDABLE: AccountKind[] = ['checking', 'savings', 'credit_card'];

export default function AccountsPage() {
  const data = useLiveQuery(async () => {
    const [accounts, txns] = await Promise.all([db.accounts.toArray(), db.txns.toArray()]);
    return accounts.map((a) => ({
      a,
      balance: a.openingBalanceCents + txns.filter((t) => t.accountId === a.id).reduce((s, t) => s + t.amountCents, 0),
    }));
  });

  const primaryId = useLiveQuery(() => getPrimaryAccountId(db), []);
  const lastBackup = (useLiveQuery(() => db.settings.get('lastBackup'), []) as { value?: string } | undefined)?.value;
  const hasData = (data?.length ?? 0) > 0;
  const backupAge = lastBackup ? Math.floor((Date.now() - Date.parse(lastBackup)) / 86400000) : null;
  const [name, setName] = useState('');
  const [kind, setKind] = useState<AccountKind>('checking');
  const [balance, setBalance] = useState('');
  const [date, setDate] = useState(todayISO());
  const [limit, setLimit] = useState('');
  const [error, setError] = useState('');

  async function add() {
    setError('');
    if (!name.trim()) return setError('Give the account a name');
    const cents = balance.trim() === '' ? 0 : parseAmountToCents(balance);
    if (cents === null) return setError('Starting balance is not a valid amount');
    // For cards the user types what they owe (positive); we store debt as negative.
    const signed = kind === 'credit_card' ? -Math.abs(cents) : cents;
    const lim = kind === 'credit_card' ? parseLimit(limit) : { cents: undefined };
    if ('error' in lim) return setError(`Credit limit: ${lim.error}`);
    await db.accounts.add({ name: name.trim(), kind, openingBalanceCents: signed, openingDate: date, ...(lim.cents ? { creditLimitCents: lim.cents } : {}) });
    setName('');
    setBalance('');
    setLimit('');
  }

  const total = (kinds: AccountKind[]) =>
    (data ?? []).filter((x) => kinds.includes(x.a.kind) && !x.a.closed).reduce((s, x) => s + x.balance, 0);

  return (
    <>
      <PageHeader title="Accounts" description="Checking, savings, and credit cards." actions={<button className="primary" onClick={() => { const el = document.getElementById('add-account'); el?.scrollIntoView({ behavior: 'smooth', block: 'start' }); el?.querySelector('input')?.focus({ preventScroll: true }); }}>Add account</button>} />
      {hasData && (backupAge === null || backupAge > BACKUP_STALE_DAYS) && (
        <Banner level="warn" title={backupAge === null ? 'You have not backed up this data yet.' : `Your last backup was ${backupAge} days ago.`} action={<Link className="btn" to="/backup">Back up now</Link>}>
          Your data lives only in this browser, so keep a backup.
        </Banner>
      )}
      {data && data.length > 0 && (
        <div className="card summary">
          <span>Cash (checking + savings): <strong>{formatCents(total(['checking', 'savings']))}</strong></span>
          <span>Card debt: <strong className="neg">{formatCents(total(['credit_card']))}</strong></span>
          {(data ?? []).some((x) => !x.a.closed && x.a.creditLimitCents) && <span>Credit left: <strong>{formatCents((data ?? []).filter((x) => !x.a.closed && x.a.kind === 'credit_card').reduce((s, x) => s + (creditStatus(x.balance, x.a.creditLimitCents)?.available ?? 0), 0))}</strong></span>}
          {(data ?? []).some((x) => x.a.kind === 'loan') && <span>Loans: <strong className="neg">{formatCents(total(['loan']))}</strong></span>}
          <span>Net: <strong>{formatCents(total(['checking', 'savings', 'credit_card', 'loan']))}</strong></span>
        </div>
      )}
      {(['checking', 'savings', 'credit_card', 'loan'] as AccountKind[]).map((k) => {
        const list = (data ?? []).filter((x) => x.a.kind === k);
        if (!list.length) return null;
        return (
          <section key={k}>
            <h2>{KIND_LABEL[k]}</h2>
            <div className="card flush"><table>
              <tbody>
                {list.map(({ a, balance }) => (
                  <tr key={a.id}>
                    <td>
                      <Link to={`/account/${a.id}`}>{a.name}</Link> {a.closed && <span className="badge">closed</span>}
                      {primaryId === a.id && canBePrimary(a) && <span className="badge" title="Quick add starts on this account"> primary</span>}
                      {a.kind === 'credit_card' && (() => { const s = creditStatus(balance, a.creditLimitCents); return s ? <div className="muted" style={{ fontSize: '0.85rem' }}>Credit left <span className={s.level === 'over' ? 'neg' : s.level === 'high' ? 'warn' : ''}>{formatCents(s.available)}</span> of {formatCents(s.limit)} ({Math.round(s.usedPct)}% used)</div> : null; })()}
                    </td>
                    <td className={`num ${balance < 0 ? 'neg' : ''}`}>{formatCents(balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </section>
        );
      })}

      <h2>Add account</h2>
      <div className="card" id="add-account">
        <div className="grid">
          <label className="f">Name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Capital One" /></label>
          <label className="f">Type
            <select value={kind} onChange={(e) => setKind(e.target.value as AccountKind)}>
              {ADDABLE.map((v) => <option key={v} value={v}>{KIND_LABEL[v]}</option>)}
            </select>
          </label>
          <label className="f">{kind === 'credit_card' ? 'Amount currently owed' : 'Starting balance'}
            <input value={balance} onChange={(e) => setBalance(e.target.value)} inputMode="decimal" placeholder="0.00" />
          </label>
          {kind === 'credit_card' && <label className="f">Credit limit (optional)<input value={limit} onChange={(e) => setLimit(e.target.value)} inputMode="decimal" placeholder="e.g. 5000" /></label>}
          <label className="f">As of<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <button className="primary" onClick={add}>Add account</button>
          <span className="muted">Transactions before the “as of” date are treated as already included in the starting balance.</span>
        </div>
        {error && <div className="error">{error}</div>}
      </div>
    </>
  );
}
