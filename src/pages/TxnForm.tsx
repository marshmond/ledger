import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import type { Account, Category, CategoryGroup, Split, Txn, TxnStatus } from '../types';
import { formatCents, parseAmountToCents, todayISO } from '../lib/money';
import { validateSplits } from '../lib/ledger';
import { convertToTransfer, createTransfer, moveTxn, updateTxn } from '../lib/transfers';
import { recentPayees, suggestCategory } from '../lib/rules';
import AmountInput from './AmountInput';

interface Props {
  account: Account;
  editing?: Txn;
  /** For an existing transfer: the account on the other side. */
  otherAccountId?: number;
  onDone: () => void;
}

function CategorySelect({
  value,
  onChange,
  allowTransfer,
  groups,
  cats,
}: {
  value: string;
  onChange: (v: string) => void;
  allowTransfer?: boolean;
  groups: CategoryGroup[];
  cats: Category[];
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Uncategorized</option>
      {allowTransfer && <option value="transfer">↔ Transfer to/from another account…</option>}
      {groups.map((g) => (
        <optgroup key={g.id} label={g.name}>
          {cats.filter((c) => c.groupId === g.id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </optgroup>
      ))}
    </select>
  );
}

const centsToField =(c: number) => (Math.abs(c) / 100).toFixed(2);

export default function TxnForm({ account, editing, otherAccountId, onDone }: Props) {
  const accounts = useLiveQuery(() => db.accounts.toArray(), []) ?? [];
  const groups = useLiveQuery(() => db.categoryGroups.toArray(), []) ?? [];
  const cats = useLiveQuery(() => db.categories.toArray(), []) ?? [];
  const history = useLiveQuery(() => db.txns.toArray(), []) ?? [];
  const rules = useLiveQuery(() => db.payeeRules.toArray(), []) ?? [];

  const isTransfer = !!editing?.transferTxnId;
  const [date, setDate] = useState(editing?.date ?? todayISO());
  const [payee, setPayee] = useState(editing?.payee ?? '');
  const [memo, setMemo] = useState(editing?.memo ?? '');
  const [dir, setDir] = useState<'out' | 'in'>(editing ? (editing.amountCents < 0 ? 'out' : 'in') : 'out');
  const [amount, setAmount] = useState(editing ? centsToField(editing.amountCents) : '');
  const [status, setStatus] = useState<TxnStatus>(editing?.status ?? 'pending');
  const [choice, setChoice] = useState<string>(
    isTransfer ? 'transfer' : editing?.categoryId ? String(editing.categoryId) : '',
  );
  const [other, setOther] = useState<string>(otherAccountId ? String(otherAccountId) : '');
  const [splitOn, setSplitOn] = useState(!!editing?.splits?.length);
  const [splits, setSplits] = useState<{ cat: string; amt: string }[]>(
    editing?.splits?.length
      ? editing.splits.map((s) => ({ cat: s.categoryId ? String(s.categoryId) : '', amt: centsToField(s.amountCents) }))
      : [{ cat: '', amt: '' }, { cat: '', amt: '' }],
  );
  const [error, setError] = useState('');
  const [hint, setHint] = useState('');
  // When editing, the account can be changed (an entry made on the wrong account). The one it is on now is always offered.
  const [acctId, setAcctId] = useState(String(account.id));
  const moving = !!editing && acctId !== String(account.id);
  const current = accounts.find((a) => String(a.id) === acctId) ?? account;
  const choices = accounts.filter((a) => a.id === account.id || (!a.closed && a.kind !== 'loan'));
  const reconciledMove = moving && editing?.status === 'reconciled' && status === 'reconciled';

  const total = parseAmountToCents(amount);
  const splitTotal = splits.reduce((s, r) => s + (parseAmountToCents(r.amt) ?? 0), 0);

  async function save() {
    setError('');
    const abs = total === null ? null : Math.abs(total);
    if (abs === null || abs === 0) return setError('Enter an amount');
    if (!date) return setError('Pick a date');
    const signed = dir === 'out' ? -abs : abs;
    const wantsTransfer = choice === 'transfer';
    if (wantsTransfer && !isTransfer && !other) return setError('Choose the other account for the transfer');
    if (moving && isTransfer && acctId === String(otherAccountId)) return setError('A transfer needs two different accounts');
    if (moving && wantsTransfer && !isTransfer && other === acctId) return setError('A transfer needs two different accounts');
    if (reconciledMove && !confirm(`This transaction is reconciled. Moving it to ${current.name} changes the reconciled balance of both accounts, and it goes back to Cleared so you can reconcile again. Move it?`)) return;

    try {
      if (isTransfer && editing) {
        await updateTxn(db, editing.id!, { date, memo, status, amountCents: signed });
        if (moving) await moveTxn(db, editing.id!, Number(acctId));
      } else {
        let splitData: Split[] | undefined;
        if (splitOn && !wantsTransfer) {
          splitData = splits.map((r) => ({
            categoryId: r.cat ? Number(r.cat) : null,
            amountCents: Math.abs(parseAmountToCents(r.amt) ?? 0) * (dir === 'out' ? -1 : 1),
          }));
          const err = validateSplits(signed, splitData);
          if (err) return setError(err.includes('at least') ? err : 'Split amounts must add up to the total');
        }
        if (editing) {
          await updateTxn(db, editing.id!, {
            date,
            payee: payee.trim(),
            memo,
            status,
            amountCents: signed,
            categoryId: wantsTransfer || splitData ? null : choice ? Number(choice) : null,
            splits: splitData,
          });
          // Move first, so a transfer made in the same edit is set up against the new account.
          if (moving) await moveTxn(db, editing.id!, Number(acctId));
          if (wantsTransfer) await convertToTransfer(db, editing.id!, Number(other));
        } else if (wantsTransfer) {
          const [from, to] = dir === 'out' ? [account.id!, Number(other)] : [Number(other), account.id!];
          await createTransfer(db, { fromAccountId: from, toAccountId: to, date, amountCents: abs, memo, status });
        } else {
          await db.txns.add({
            accountId: account.id!,
            date,
            amountCents: signed,
            payee: payee.trim(),
            memo,
            status,
            categoryId: splitData ? null : choice ? Number(choice) : null,
            splits: splitData,
          });
        }
      }
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const liability = current.kind === 'credit_card' || current.kind === 'loan';
  const incomeWord = liability ? 'Payment / credit (+)' : 'Inflow (+)';
  const outWord = current.kind === 'credit_card' ? 'Charge (−)' : current.kind === 'loan' ? 'Interest / added to balance (−)' : 'Outflow (−)';

  return (
    <div className="card">
      <div className="grid">
        {editing && (
          <label className="f">Account
            <select value={acctId} onChange={(e) => setAcctId(e.target.value)}>
              {choices.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
        )}
        <label className="f">Date<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        {!isTransfer && (
          <label className="f">Payee
            <input
              list="txn-payees"
              value={payee}
              onChange={(e) => setPayee(e.target.value)}
              onBlur={() => {
                // A new transaction with no category yet: fill it in from your rules or how you filed this payee before.
                if (editing || choice !== '' || splitOn) return;
                const s = suggestCategory(history, rules, payee, account.id);
                if (s?.categoryId) {
                  setChoice(String(s.categoryId));
                  setHint(s.source === 'rule' ? 'Category filled in from your rule.' : 'Category filled in from how you filed this payee before.');
                }
              }}
            />
            <datalist id="txn-payees">{recentPayees(history).map((p) => <option key={p} value={p} />)}</datalist>
          </label>
        )}
        <label className="f">Type
          <select value={dir} onChange={(e) => setDir(e.target.value as 'out' | 'in')}>
            <option value="out">{outWord}</option>
            <option value="in">{incomeWord}</option>
          </select>
        </label>
        <label className="f">Amount<AmountInput value={amount} onChange={setAmount} /></label>
        <label className="f">Status
          <select value={status} onChange={(e) => setStatus(e.target.value as TxnStatus)}>
            <option value="pending">Pending</option>
            <option value="cleared">Cleared</option>
            <option value="reconciled">Reconciled</option>
          </select>
        </label>
      </div>

      {!isTransfer && (
        <div className="row" style={{ marginTop: 8 }}>
          {!splitOn || choice === 'transfer' ? (
            <label className="f">Category <CategorySelect groups={groups} cats={cats} value={choice} onChange={setChoice} allowTransfer /></label>
          ) : (
            <strong>Split</strong>
          )}
          {choice === 'transfer' && (
            <label className="f">{dir === 'out' ? 'To account' : 'From account'}
              <select value={other} onChange={(e) => setOther(e.target.value)}>
                <option value="">Choose…</option>
                {accounts.filter((a) => a.id !== current.id).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </label>
          )}
          {choice !== 'transfer' && (
            <button className="link" onClick={() => setSplitOn(!splitOn)}>
              {splitOn ? 'Use a single category' : 'Split across categories'}
            </button>
          )}
        </div>
      )}
      {moving && <p className="muted">Saving moves this {isTransfer ? 'side of the transfer' : 'transaction'} from {account.name} to {current.name}.</p>}
      {reconciledMove && <p className="warn">This transaction is reconciled. Moving it changes the reconciled balance of both accounts, and it goes back to Cleared.</p>}
      {hint && !isTransfer && <p className="muted">{hint}</p>}
      {isTransfer && <p className="muted">Transfer with {accounts.find((a) => a.id === otherAccountId)?.name ?? 'another account'}. The other side stays in sync.</p>}
      {choice === 'transfer' && !isTransfer && (
        <p className="muted">The matching entry on the other account is posted automatically (or linked, if you already entered it).</p>
      )}

      {splitOn && choice !== 'transfer' && !isTransfer && (
        <div style={{ marginTop: 8 }}>
          {splits.map((r, i) => (
            <div className="row" key={i} style={{ marginBottom: 4 }}>
              <CategorySelect groups={groups} cats={cats} value={r.cat} onChange={(v) => setSplits(splits.map((x, j) => (j === i ? { ...x, cat: v } : x)))} />
              <AmountInput
                style={{ width: 110 }}
                label={`Amount for split ${i + 1}`}
                value={r.amt}
                onChange={(t) => setSplits(splits.map((x, j) => (j === i ? { ...x, amt: t } : x)))}
              />
              {splits.length > 2 && <button className="link danger" onClick={() => setSplits(splits.filter((_, j) => j !== i))}>remove</button>}
            </div>
          ))}
          <div className="row">
            <button onClick={() => setSplits([...splits, { cat: '', amt: '' }])}>+ category</button>
            {total === null || total === 0 ? (
              <span className="warn">Enter the amount above, then split it</span>
            ) : (
              <span className={splitTotal === Math.abs(total) ? 'ok' : 'warn'}>
                Allocated {formatCents(splitTotal)} · {splitTotal > Math.abs(total)
                  ? `Over by ${formatCents(splitTotal - Math.abs(total))}`
                  : `Left to allocate ${formatCents(Math.abs(total) - splitTotal)}`}{' '}
                (of {formatCents(Math.abs(total))})
              </span>
            )}
          </div>
        </div>
      )}

      <label className="f" style={{ marginTop: 8 }}>Memo<input value={memo} onChange={(e) => setMemo(e.target.value)} /></label>
      <div className="row" style={{ marginTop: 8 }}>
        <button className="primary" onClick={save}>{editing ? 'Save' : 'Add transaction'}</button>
        <button onClick={onDone}>Cancel</button>
      </div>
      {error && <div className="error">{error}</div>}
    </div>
  );
}
