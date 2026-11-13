import PayeeInput from '../ui/PayeeInput';
import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import type { Account, Category, CategoryGroup, Split, Txn, TxnStatus } from '../types';
import { formatCents, parseAmountMath, todayISO } from '../lib/money';
import { validateSplits } from '../lib/ledger';
import { createTxn, editTxn } from '../lib/txnCreate';
import { buildRef, EMPTY_TAG, tagFromRef, type TagState } from '../lib/txnProjectTag';
import { useToast } from '../ui/Toast';
import ProjectTag, { useProjectChoices } from './ProjectTag';
import { convertToTransfer, createTransfer, moveTxn, updateTxn } from '../lib/transfers';
import { recentPayees, suggestCategory } from '../lib/rules';
import AmountInput from './AmountInput';
import ConfirmDialog from '../shell/ConfirmDialog';

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
  const [splits, setSplits] = useState<{ cat: string; amt: string; tag: TagState }[]>(
    editing?.splits?.length
      ? editing.splits.map((s) => ({ cat: s.categoryId ? String(s.categoryId) : '', amt: centsToField(s.amountCents), tag: tagFromRef(s.project) }))
      : [{ cat: '', amt: '', tag: EMPTY_TAG }, { cat: '', amt: '', tag: EMPTY_TAG }],
  );
  const [tag, setTag] = useState<TagState>(tagFromRef(editing?.project));
  const projects = useProjectChoices();
  const toast = useToast();
  const [error, setError] = useState('');
  // Which field the message is about: that field points at the message (aria-describedby) and focus moves to it.
  const [errField, setErrField] = useState<'amount' | 'date' | 'other' | 'acct' | ''>('');
  const [hint, setHint] = useState('');
  // When editing, the account can be changed (an entry made on the wrong account). The one it is on now is always offered.
  const [acctId, setAcctId] = useState(String(account.id));
  // D20.1B (NC-37, NC-38): the reconciled move, and the split-to-single switch, waiting for the dialog's own button.
  const [askMove, setAskMove] = useState(false);
  const [askSingle, setAskSingle] = useState(false);
  const moving = !!editing && acctId !== String(account.id);
  const current = accounts.find((a) => String(a.id) === acctId) ?? account;
  const choices = accounts.filter((a) => a.id === account.id || (!a.closed && a.kind !== 'loan'));
  const reconciledMove = moving && editing?.status === 'reconciled' && status === 'reconciled';

  const total = parseAmountMath(amount);
  const splitTotal = splits.reduce((s, r) => s + (parseAmountMath(r.amt) ?? 0), 0);

  const FIELD = { amount: 'txn-amount', date: 'txn-date', other: 'txn-other', acct: 'txn-acct' } as const;
  function fail(field: 'amount' | 'date' | 'other' | 'acct', message: string) {
    setErrField(field);
    setError(message);
    setTimeout(() => document.getElementById(FIELD[field])?.focus(), 0);
  }
  const bad = (f: 'amount' | 'date' | 'other' | 'acct') => !!error && errField === f;

  /**
   * Validates, then saves. Returns an error message when the save itself failed (it is also shown on the form), nothing otherwise.
   * `moveConfirmed` (D20.1B, NC-37): true only when called from the reconciled-move dialog's own button; without it a reconciled move stops at the dialog, before ANY write.
   */
  async function save(moveConfirmed = false): Promise<string | void> {
    setError('');
    setErrField('');
    const abs = total === null ? null : Math.abs(total);
    if (abs === null || abs === 0) return fail('amount', 'Enter an amount');
    if (!date) return fail('date', 'Pick a date');
    const signed = dir === 'out' ? -abs : abs;
    const wantsTransfer = choice === 'transfer';
    if (wantsTransfer && !isTransfer && !other) return fail('other', 'Choose the other account for the transfer');
    if (moving && isTransfer && acctId === String(otherAccountId)) return fail('acct', 'A transfer needs two different accounts');
    if (moving && wantsTransfer && !isTransfer && other === acctId) return fail('acct', 'A transfer needs two different accounts');
    // NC-37: all validation above has passed; now (and only now) the question, before any database write. Cancel leaves the form open and the transaction untouched.
    if (reconciledMove && !moveConfirmed) { setAskMove(true); return; }

    try {
      if (isTransfer && editing) {
        await updateTxn(db, editing.id!, { date, memo, status, amountCents: signed });
        if (moving) await moveTxn(db, editing.id!, Number(acctId));
      } else {
        let splitData: Split[] | undefined;
        if (splitOn && !wantsTransfer) {
          splitData = [];
          for (const r of splits) {
            const built = buildRef(r.tag, projects, dir === 'in', { compact: true });
            if (built.error) return setError(built.error);
            splitData.push({
              categoryId: r.cat ? Number(r.cat) : null,
              amountCents: Math.abs(parseAmountMath(r.amt) ?? 0) * (dir === 'out' ? -1 : 1),
              ...(built.ref ? { project: built.ref } : {}),
            });
          }
          const err = validateSplits(signed, splitData);
          if (err) return setError(err.includes('at least') ? err : 'Split amounts must add up to the total');
        }
        const whole = wantsTransfer ? {} : buildRef(tag, projects, dir === 'in');
        if (whole.error) return setError(whole.error);
        const credits = [whole.ref, ...(splitData ?? []).map((s) => s.project)].filter((r) => r?.effect === 'credit').length;
        if (editing) {
          await editTxn(db, editing.id!, {
            date,
            payee: payee.trim(),
            memo,
            status,
            amountCents: signed,
            categoryId: wantsTransfer || splitData ? null : choice ? Number(choice) : null,
            splits: splitData,
            project: wantsTransfer ? undefined : whole.ref,
          });
          // Move first, so a transfer made in the same edit is set up against the new account.
          if (moving) await moveTxn(db, editing.id!, Number(acctId));
          if (wantsTransfer) await convertToTransfer(db, editing.id!, Number(other));
        } else if (wantsTransfer) {
          const [from, to] = dir === 'out' ? [account.id!, Number(other)] : [Number(other), account.id!];
          await createTransfer(db, { fromAccountId: from, toAccountId: to, date, amountCents: abs, memo, status });
        } else {
          await createTxn(db, {
            accountId: account.id!,
            date,
            amountCents: signed,
            payee: payee.trim(),
            memo,
            status,
            categoryId: splitData ? null : choice ? Number(choice) : null,
            splits: splitData,
            ...(whole.ref ? { project: whole.ref } : {}),
          });
        }
        if (credits) toast('Credit saved. Open the project to lower the agreed amount by the same, so the contract does not look owed again.');
      }
      onDone();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      return message;
    }
  }
  /** NC-37, on confirm: the transaction and the target account are read again first; if either changed while the question was open, nothing is written. Then the one existing save runs once. */
  async function confirmMove() {
    const fresh = await db.txns.get(editing!.id!);
    if (!fresh) throw new Error('This transaction no longer exists. Nothing was changed.');
    if (fresh.status !== 'reconciled' || fresh.accountId !== account.id) throw new Error('This transaction changed while the question was open. Nothing was changed. Close this form and open the transaction again.');
    const target = await db.accounts.get(Number(acctId));
    if (!target || (target.closed && target.id !== account.id)) throw new Error('The account you chose is no longer available. Nothing was changed. Choose an account again.');
    const failed = await save(true);
    if (typeof failed === 'string') return failed; // shown inside the dialog; the dialog stays open
    setAskMove(false);
  }

  const liability = current.kind === 'credit_card' || current.kind === 'loan';
  const incomeWord = liability ? 'Payment / credit (+)' : 'Inflow (+)';
  const outWord = current.kind === 'credit_card' ? 'Charge (−)' : current.kind === 'loan' ? 'Interest / added to balance (−)' : 'Outflow (−)';

  return (
    <div className="card">
      <div className="grid">
        {editing && (
          <label className="f">Account
            <select id="txn-acct" aria-invalid={bad('acct') || undefined} aria-describedby={bad('acct') ? 'txn-form-error' : undefined} value={acctId} onChange={(e) => setAcctId(e.target.value)}>
              {choices.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
        )}
        <label className="f">Date<input id="txn-date" aria-invalid={bad('date') || undefined} aria-describedby={bad('date') ? 'txn-form-error' : undefined} type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        {!isTransfer && (
          <label className="f">Payee
            <PayeeInput
              value={payee}
              onChange={setPayee}
              options={recentPayees(history)}
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
          </label>
        )}
        <label className="f">Type
          <select value={dir} onChange={(e) => setDir(e.target.value as 'out' | 'in')}>
            <option value="out">{outWord}</option>
            <option value="in">{incomeWord}</option>
          </select>
        </label>
        <label className="f">Amount<AmountInput id="txn-amount" invalid={bad('amount')} describedBy={bad('amount') ? 'txn-form-error' : undefined} value={amount} onChange={setAmount} /></label>
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
              <select id="txn-other" aria-invalid={bad('other') || undefined} aria-describedby={bad('other') ? 'txn-form-error' : undefined} value={other} onChange={(e) => setOther(e.target.value)}>
                <option value="">Choose…</option>
                {accounts.filter((a) => a.id !== current.id).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </label>
          )}
          {choice !== 'transfer' && (
            <button className="link" onClick={() => { if (splitOn && splits.some((r) => r.tag.projectId)) { setAskSingle(true); return; } setSplitOn(!splitOn); }}>
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
              {projects.length > 0 && <ProjectTag compact label={`Project for split ${i + 1}`} value={r.tag} onChange={(t) => setSplits(splits.map((x, j) => (j === i ? { ...x, tag: t } : x)))} choices={projects} moneyIn={dir === 'in'} />}
            </div>
          ))}
          <div className="row">
            <button onClick={() => setSplits([...splits, { cat: '', amt: '', tag: EMPTY_TAG }])}>+ category</button>
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

      {!isTransfer && choice !== 'transfer' && projects.length > 0 && (
        <div className="ptag-box">
          <ProjectTag value={tag} onChange={(t) => { setTag(t); setError(''); }} choices={projects} moneyIn={dir === 'in'} label={splitOn ? 'Project for splits without their own' : 'Project'} />
        </div>
      )}

      <label className="f" style={{ marginTop: 8 }}>Memo<input value={memo} onChange={(e) => setMemo(e.target.value)} /></label>
      <div className="row" style={{ marginTop: 8 }}>
        <button className="primary" onClick={() => void save()}>{editing ? 'Save' : 'Add transaction'}</button>
        <button onClick={onDone}>Cancel</button>
      </div>
      {error && <div className="error" id="txn-form-error" role="alert">{error}</div>}
      {askMove && (
        <ConfirmDialog
          title="Move reconciled transaction?"
          confirmLabel="Move transaction"
          busyLabel="Moving…"
          tone="primary"
          kind="linked"
          onCancel={() => setAskMove(false)}
          onConfirm={() => confirmMove()}
        >
          <p><strong>{editing?.payee || '(no payee)'}</strong><br /><span className="muted small">{account.name} → {current.name}</span></p>
          <p>This transaction is reconciled. Moving it to {current.name} changes the reconciled balance of both accounts, and it goes back to Cleared so you can reconcile again.</p>
          <p className="muted small">Nothing has been saved yet. Cancel keeps this form open and the transaction where it is.</p>
        </ConfirmDialog>
      )}
      {askSingle && (
        <ConfirmDialog
          title="Use a single category?"
          confirmLabel="Use single category"
          tone="primary"
          kind="replace"
          onCancel={() => setAskSingle(false)}
          onConfirm={() => { setSplitOn(false); setAskSingle(false); }}
        >
          <p>Using a single category removes the project tags on the individual splits.</p>
          <p className="muted small">This only changes the form. Nothing is saved until you press {editing ? 'Save' : 'Add transaction'}; Cancel here keeps your splits as they are.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}
