import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import type { Account, Split, Txn, TxnStatus } from '../types';
import { formatCents, parseAmountToCents, todayISO } from '../lib/money';
import { validateSplits } from '../lib/ledger';
import { convertToTransfer, createTransfer, updateTxn } from '../lib/transfers';

interface Props {
  account: Account;
  editing?: Txn;
  /** For an existing transfer: the account on the other side. */
  otherAccountId?: number;
  onDone: () => void;
}

const centsToField = (c: number) => (Math.abs(c) / 100).toFixed(2);

export default function TxnForm({ account, editing, otherAccountId, onDone }: Props) {
  const accounts = useLiveQuery(() => db.accounts.toArray(), []) ?? [];
  const groups = useLiveQuery(() => db.categoryGroups.toArray(), []) ?? [];
  const cats = useLiveQuery(() => db.categories.toArray(), []) ?? [];

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

    try {
      if (isTransfer && editing) {
        await updateTxn(db, editing.id!, { date, memo, status, amountCents: signed });
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

  const CatSelect = ({ value, onChange, allowTransfer }: { value: string; onChange: (v: string) => void; allowTransfer?: boolean }) => (
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

  const incomeWord = account.kind === 'credit_card' ? 'Payment / credit (+)' : 'Inflow (+)';
  const outWord = account.kind === 'credit_card' ? 'Charge (−)' : 'Outflow (−)';

  return (
    <div className="card">
      <div className="grid">
        <label className="f">Date<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        {!isTransfer && (
          <label className="f">Payee<input value={payee} onChange={(e) => setPayee(e.target.value)} /></label>
        )}
        <label className="f">Type
          <select value={dir} onChange={(e) => setDir(e.target.value as 'out' | 'in')}>
            <option value="out">{outWord}</option>
            <option value="in">{incomeWord}</option>
          </select>
        </label>
        <label className="f">Amount<input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0.00" /></label>
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
            <label className="f">Category <CatSelect value={choice} onChange={setChoice} allowTransfer /></label>
          ) : (
            <strong>Split</strong>
          )}
          {choice === 'transfer' && (
            <label className="f">{dir === 'out' ? 'To account' : 'From account'}
              <select value={other} onChange={(e) => setOther(e.target.value)}>
                <option value="">Choose…</option>
                {accounts.filter((a) => a.id !== account.id).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
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
      {isTransfer && <p className="muted">Transfer with {accounts.find((a) => a.id === otherAccountId)?.name ?? 'another account'}. The other side stays in sync.</p>}
      {choice === 'transfer' && !isTransfer && (
        <p className="muted">The matching entry on the other account is posted automatically (or linked, if you already entered it).</p>
      )}

      {splitOn && choice !== 'transfer' && !isTransfer && (
        <div style={{ marginTop: 8 }}>
          {splits.map((r, i) => (
            <div className="row" key={i} style={{ marginBottom: 4 }}>
              <CatSelect value={r.cat} onChange={(v) => setSplits(splits.map((x, j) => (j === i ? { ...x, cat: v } : x)))} />
              <input
                style={{ width: 110 }}
                inputMode="decimal"
                placeholder="0.00"
                value={r.amt}
                onChange={(e) => setSplits(splits.map((x, j) => (j === i ? { ...x, amt: e.target.value } : x)))}
              />
              {splits.length > 2 && <button className="link danger" onClick={() => setSplits(splits.filter((_, j) => j !== i))}>remove</button>}
            </div>
          ))}
          <div className="row">
            <button onClick={() => setSplits([...splits, { cat: '', amt: '' }])}>+ category</button>
            <span className={splitTotal === Math.abs(total ?? 0) ? 'ok' : 'warn'}>
              Split {formatCents(splitTotal)} of {formatCents(Math.abs(total ?? 0))}
            </span>
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
