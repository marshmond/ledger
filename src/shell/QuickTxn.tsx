import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import type { Account } from '../types';
import { formatCents, parseAmountToCents, todayISO } from '../lib/money';
import { recentPayees, suggestCategory } from '../lib/rules';
import TxnForm from '../pages/TxnForm';

const LAST_KEY = 'ledger-quick-account';
const lastAccount = (): string => {
  try { return localStorage.getItem(LAST_KEY) ?? ''; } catch { return ''; }
};

/**
 * The fast way to log a purchase: payee (with suggestions), amount, category (filled in from your rules and history), and Save.
 * Splits, transfers, and memos are one click away in the full form.
 */
export default function QuickTxn({ accounts, onDone }: { accounts: Account[]; onDone: () => void }) {
  const txns = useLiveQuery(() => db.txns.toArray(), []) ?? [];
  const rules = useLiveQuery(() => db.payeeRules.toArray(), []) ?? [];
  const groups = useLiveQuery(() => db.categoryGroups.toArray(), []) ?? [];
  const cats = useLiveQuery(() => db.categories.toArray(), []) ?? [];

  const [acct, setAcct] = useState(() => (accounts.some((a) => String(a.id) === lastAccount()) ? lastAccount() : String(accounts[0]?.id ?? '')));
  const [payee, setPayee] = useState('');
  const [amount, setAmount] = useState('');
  const [dir, setDir] = useState<'out' | 'in'>('out');
  const [cat, setCat] = useState('');
  const [catTouched, setCatTouched] = useState(false);
  const [date, setDate] = useState(todayISO());
  const [msg, setMsg] = useState('');
  const [full, setFull] = useState(false);
  const payeeRef = useRef<HTMLInputElement>(null);
  const account = accounts.find((a) => String(a.id) === acct);
  const payees = recentPayees(txns);

  // Suggest a category as soon as the payee is recognised (unless you picked one).
  const suggestion = suggestCategory(txns, rules, payee, account?.id);
  useEffect(() => {
    if (!catTouched) setCat(suggestion?.categoryId ? String(suggestion.categoryId) : '');
  }, [suggestion?.categoryId, catTouched]);
  useEffect(() => payeeRef.current?.focus(), []);

  if (!account) return <p className="muted">Add an account first, on the Accounts page.</p>;
  if (full) return <TxnForm account={account} onDone={onDone} />;

  const cents = parseAmountToCents(amount);
  async function save(another: boolean) {
    setMsg('');
    const abs = cents === null ? 0 : Math.abs(cents);
    if (abs === 0) return setMsg('Enter an amount');
    const rule = suggestion?.source === 'rule' && suggestion.rename && !catTouched ? suggestion.rename : null;
    await db.txns.add({
      accountId: account!.id!,
      date,
      amountCents: dir === 'out' ? -abs : abs,
      payee: rule ?? payee.trim(),
      memo: '',
      status: 'pending',
      categoryId: cat ? Number(cat) : null,
    });
    try { localStorage.setItem(LAST_KEY, String(account!.id)); } catch { /* storage unavailable */ }
    if (!another) return onDone();
    setMsg(`Saved ${formatCents(abs)} ${payee.trim() ? `to ${payee.trim()}` : ''}. Add another:`);
    setPayee('');
    setAmount('');
    setCat('');
    setCatTouched(false);
    payeeRef.current?.focus();
  }

  return (
    <div className="quick">
      <label className="f">Account
        <select value={acct} onChange={(e) => setAcct(e.target.value)}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
      </label>
      <label className="f">Payee
        <input ref={payeeRef} list="quick-payees" value={payee} onChange={(e) => setPayee(e.target.value)} placeholder="Who was it?" autoComplete="off" />
        <datalist id="quick-payees">{payees.map((p) => <option key={p} value={p} />)}</datalist>
      </label>
      <div className="row">
        <label className="f" style={{ flex: 1 }}>Amount
          <input className="bigamt" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0.00" onKeyDown={(e) => e.key === 'Enter' && save(false)} />
        </label>
        <div className="seg" role="group" aria-label="Direction">
          <button className={dir === 'out' ? 'on' : ''} onClick={() => setDir('out')}>Spent</button>
          <button className={dir === 'in' ? 'on' : ''} onClick={() => setDir('in')}>Received</button>
        </div>
      </div>
      <label className="f">Category
        <select value={cat} onChange={(e) => { setCat(e.target.value); setCatTouched(true); }}>
          <option value="">Uncategorized</option>
          {groups.map((g) => (
            <optgroup key={g.id} label={g.name}>{cats.filter((c) => c.groupId === g.id && !c.hidden).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</optgroup>
          ))}
        </select>
      </label>
      {suggestion && !catTouched && suggestion.categoryId && <div className="muted" style={{ fontSize: '0.8rem' }}>{suggestion.source === 'rule' ? 'Category from your rule.' : 'Category from how you filed this payee before.'}</div>}
      <details>
        <summary className="muted">Change the date</summary>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </details>
      <div className="row" style={{ marginTop: 6 }}>
        <button className="primary" onClick={() => save(false)}>Save</button>
        <button onClick={() => save(true)}>Save and add another</button>
        <button className="link" onClick={() => setFull(true)}>More options (split, transfer, memo)</button>
      </div>
      {msg && <div className={msg.startsWith('Saved') ? 'ok' : 'error'} role="status">{msg}</div>}
    </div>
  );
}
