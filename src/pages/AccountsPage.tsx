import { useState } from 'react';
import { Link } from '../core/router';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import type { Account, AccountKind } from '../types';
import { formatCents, parseAmountToCents, todayISO } from '../lib/money';
import { creditStatus, parseLimit } from '../lib/credit';
import { canBePrimary, getPrimaryAccountId } from '../lib/primaryAccount';
import { BACKUP_STALE_DAYS } from './BackupPage';
import { Banner, EmptyState, PageHeader } from '../ui/components';
import { StatusChip } from '../ui/StatusChip';
import { KIND_LABEL, KIND_ORDER, countWord, isDebtKind, reconView } from './moneyPresentation';
import './money.css';

/** Accounts you can add by hand. Loans are created from the Debt tab so they carry their schedule. */
const ADDABLE: AccountKind[] = ['checking', 'savings', 'credit_card'];

/**
 * One account: name, what it is, whether it was reconciled, its own limits and the balance. Every value arrives already worked out by the page
 * (the balance is the account's opening balance plus its transactions, as before); the row only places it and puts a word beside it. A card or a loan
 * is debt, so its balance is not colored by its sign: the word "Owed" says what the number means.
 */
export function AccountRow({ account: a, balance, primary, today, onInclude }: { account: Account; balance: number; primary: boolean; today: string; onInclude?: (excluded: boolean) => void }) {
  const debt = isDebtKind(a.kind);
  const credit = a.kind === 'credit_card' ? creditStatus(balance, a.creditLimitCents) : null;
  const rec = a.closed ? null : reconView(a.lastReconciledDate, today);
  const under = !a.closed && !!a.minBalanceCents && balance < a.minBalanceCents;
  const belowZero = !debt && balance < 0;
  return (
    <li className={`mny-acct${a.closed ? ' is-closed' : ''}`}>
      <div className="mny-acct-main">
        <div className="mny-acct-title">
          <Link className="mny-acct-name" to={`/account/${a.id}`}>{a.name}</Link>
          {a.closed && <StatusChip tone="neutral" icon={false}>Closed</StatusChip>}
          {primary && canBePrimary(a) && <span title="Quick add starts on this account"><StatusChip tone="active" icon={false}>Primary</StatusChip></span>}
        </div>
        <div className="mny-acct-meta">
          <span className="mny-kind">{KIND_LABEL[a.kind]}</span>
          {rec && (
            <span className={`mny-recon mny-recon--${rec.tone}`} title={rec.title}>{rec.tone === 'done' && <span aria-hidden="true">✓ </span>}{rec.label}</span>
          )}
        </div>
        {!a.closed && !!a.minBalanceCents && (
          <div className="mny-acct-line">Minimum {formatCents(a.minBalanceCents)}{under && <> · <span className="warn">under it</span></>}</div>
        )}
        {credit && (
          <div className="mny-credit">
            <progress className={`mny-progress mny-progress--${credit.level}`} value={Math.min(100, Math.max(0, credit.usedPct))} max={100} aria-label={`Credit used on ${a.name}: ${Math.round(credit.usedPct)} percent`} />
            <div className="mny-acct-line">Credit left <span className={credit.level === 'over' ? 'neg' : credit.level === 'high' ? 'warn' : ''}>{formatCents(credit.available)}</span> of {formatCents(credit.limit)} ({Math.round(credit.usedPct)}% used)</div>
          </div>
        )}
        {(a.kind === 'checking' || a.kind === 'savings') && onInclude && (
          <label className="mny-incl" title="Leave this off for long-term savings: it will not count toward Ready to Assign">
            <input type="checkbox" checked={!a.budgetExcluded} onChange={(e) => onInclude(!e.target.checked)} />
            {' '}Include in budget
          </label>
        )}
      </div>
      <div className="mny-acct-bal">
        <span className={`mny-amt ${belowZero ? 'neg' : ''}`}>{formatCents(balance)}</span>
        {debt && <span className="mny-acct-cap">Owed</span>}
        {belowZero && <span className="mny-acct-cap neg">Below zero</span>}
      </div>
    </li>
  );
}

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
  // The field the message is about: it points at the message and takes focus, so the person knows what to correct.
  const [errField, setErrField] = useState<'name' | 'balance' | 'limit' | ''>('');
  const fail = (field: 'name' | 'balance' | 'limit', message: string) => {
    setErrField(field);
    setError(message);
    setTimeout(() => document.getElementById(`add-account-${field}`)?.focus(), 0);
  };
  const bad = (f: 'name' | 'balance' | 'limit') => (error && errField === f ? true : undefined);
  const why = (f: 'name' | 'balance' | 'limit') => (error && errField === f ? 'add-account-error' : undefined);

  async function add() {
    setError('');
    setErrField('');
    if (!name.trim()) return fail('name', 'Give the account a name');
    const cents = balance.trim() === '' ? 0 : parseAmountToCents(balance);
    if (cents === null) return fail('balance', 'Starting balance is not a valid amount');
    // For cards the user types what they owe (positive); we store debt as negative.
    const signed = kind === 'credit_card' ? -Math.abs(cents) : cents;
    const lim = kind === 'credit_card' ? parseLimit(limit) : { cents: undefined };
    if ('error' in lim) return fail('limit', `Credit limit: ${lim.error}`);
    await db.accounts.add({ name: name.trim(), kind, openingBalanceCents: signed, openingDate: date, ...(lim.cents ? { creditLimitCents: lim.cents } : {}) });
    setName('');
    setBalance('');
    setLimit('');
  }

  const total = (kinds: AccountKind[]) =>
    (data ?? []).filter((x) => kinds.includes(x.a.kind) && !x.a.closed).reduce((s, x) => s + x.balance, 0);
  const today = todayISO();

  return (
    <div className="mny-page">
      <PageHeader title="Accounts" description="Checking, savings, and credit cards." actions={<button className="primary" onClick={() => { const el = document.getElementById('add-account'); el?.scrollIntoView({ behavior: 'smooth', block: 'start' }); el?.querySelector('input')?.focus({ preventScroll: true }); }}>Add account</button>} />
      {hasData && (backupAge === null || backupAge > BACKUP_STALE_DAYS) && (
        <Banner level="warn" title={backupAge === null ? 'You have not backed up this data yet.' : `Your last backup was ${backupAge} days ago.`} action={<Link className="btn" to="/backup">Back up now</Link>}>
          Your data lives only in this browser, so keep a backup.
        </Banner>
      )}
      {data && data.length > 0 && (
        <dl className="card mny-figs" aria-label="Totals across your open accounts">
          <div className="mny-fig"><dt>Cash (checking + savings)</dt><dd>{formatCents(total(['checking', 'savings']))}</dd></div>
          <div className="mny-fig"><dt>Card debt</dt><dd>{formatCents(total(['credit_card']))}</dd></div>
          {(data ?? []).some((x) => !x.a.closed && x.a.creditLimitCents) && <div className="mny-fig"><dt>Credit left</dt><dd>{formatCents((data ?? []).filter((x) => !x.a.closed && x.a.kind === 'credit_card').reduce((s, x) => s + (creditStatus(x.balance, x.a.creditLimitCents)?.available ?? 0), 0))}</dd></div>}
          {(data ?? []).some((x) => x.a.kind === 'loan') && <div className="mny-fig"><dt>Loans</dt><dd>{formatCents(total(['loan']))}</dd></div>}
          <div className="mny-fig mny-fig--net"><dt>Net</dt><dd>{formatCents(total(['checking', 'savings', 'credit_card', 'loan']))}</dd></div>
        </dl>
      )}
      <div className="mny-split">
        <div className="mny-stack">
          {KIND_ORDER.map((k) => {
            const list = (data ?? []).filter((x) => x.a.kind === k);
            if (!list.length) return null;
            return (
              <section key={k} aria-labelledby={`acct-h-${k}`}>
                <h2 id={`acct-h-${k}`} className="mny-h2">{KIND_LABEL[k]} <span className="mny-count">{countWord(list.length, 'account')}</span></h2>
                <ul className="card flush mny-rows">
                  {list.map(({ a, balance: bal }) => (
                    <AccountRow key={a.id} account={a} balance={bal} primary={primaryId === a.id} today={today} onInclude={(excluded) => db.accounts.update(a.id!, { budgetExcluded: excluded })} />
                  ))}
                </ul>
              </section>
            );
          })}
          {data && data.length === 0 && (
            <EmptyState title="No accounts yet">Add your first account with the Add account form on this page.</EmptyState>
          )}
        </div>

        <section className="mny-side" aria-labelledby="add-account-h">
          <h2 id="add-account-h" className="mny-h2">Add account</h2>
          <div className="card" id="add-account">
            <div className="mny-form">
              <label className="f">Name<input id="add-account-name" aria-invalid={bad('name')} aria-describedby={why('name')} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Capital One" /></label>
              <label className="f">Type
                <select value={kind} onChange={(e) => setKind(e.target.value as AccountKind)}>
                  {ADDABLE.map((v) => <option key={v} value={v}>{KIND_LABEL[v]}</option>)}
                </select>
              </label>
              <label className="f">{kind === 'credit_card' ? 'Amount currently owed' : 'Starting balance'}
                <input id="add-account-balance" aria-invalid={bad('balance')} aria-describedby={why('balance')} value={balance} onChange={(e) => setBalance(e.target.value)} inputMode="decimal" placeholder="0.00" />
              </label>
              {kind === 'credit_card' && <label className="f">Credit limit (optional)<input id="add-account-limit" aria-invalid={bad('limit')} aria-describedby={why('limit')} value={limit} onChange={(e) => setLimit(e.target.value)} inputMode="decimal" placeholder="e.g. 5000" /></label>}
              <label className="f">As of<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
            </div>
            {error && <div className="error" id="add-account-error" role="alert">{error}</div>}
            <div className="mny-actions">
              <button className="primary" onClick={add}>Add account</button>
            </div>
            <p className="muted mny-note">Transactions before the “as of” date are treated as already included in the starting balance.</p>
          </div>
        </section>
      </div>
    </div>
  );
}
