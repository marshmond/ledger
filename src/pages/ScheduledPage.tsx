import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import type { Frequency, RecurringRule } from '../types';
import { formatCents, parseAmountToCents, todayISO } from '../lib/money';
import { deleteRule, dueInstances, postInstance, skipInstance, type DueInstance } from '../lib/schedule';
import { PageHeader } from '../ui/components';

const FREQ: Record<Frequency, string> = {
  weekly: 'Weekly',
  biweekly: 'Every 2 weeks',
  semimonthly: 'Twice a month',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  yearly: 'Yearly',
};

const LOOKAHEAD_DAYS = 7;

function DueRow({ item }: { item: DueInstance }) {
  const { rule, date } = item;
  const [d, setD] = useState(date);
  const [amt, setAmt] = useState((Math.abs(rule.amountCents) / 100).toFixed(2));
  const [err, setErr] = useState('');
  const sign = rule.amountCents < 0 ? -1 : 1;
  const overdue = date < todayISO();

  async function approve() {
    const cents = parseAmountToCents(amt);
    if (cents === null || cents === 0) return setErr('Enter an amount');
    try {
      await postInstance(db, rule, date, { date: d, amountCents: sign * Math.abs(cents) });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <tr>
      <td>
        <input type="date" value={d} onChange={(e) => setD(e.target.value)} />
        <div className={overdue ? 'warn' : 'muted'}>{overdue ? 'overdue · ' : ''}scheduled {date}</div>
      </td>
      <td>
        {rule.payee} <span className="badge">scheduled</span>
        <div className="muted">{rule.transferAccountId ? 'Transfer' : ''}</div>
      </td>
      <td className="num">
        <input style={{ width: 100 }} inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value)} />
        <div className="muted">{sign < 0 ? 'out' : 'in'} · {formatCents(rule.amountCents)} expected</div>
      </td>
      <td>
        <div className="row">
          <button className="primary" onClick={approve}>Approve</button>
          <button onClick={() => skipInstance(db, rule, date)}>Skip</button>
        </div>
        {err && <div className="error">{err}</div>}
      </td>
    </tr>
  );
}

export default function ScheduledPage() {
  const accounts = useLiveQuery(() => db.accounts.toArray(), []) ?? [];
  const cats = useLiveQuery(() => db.categories.toArray(), []) ?? [];
  const groups = useLiveQuery(() => db.categoryGroups.toArray(), []) ?? [];
  const rules = useLiveQuery(() => db.recurring.toArray(), []) ?? [];
  const due = useLiveQuery(() => dueInstances(db, todayISO(), LOOKAHEAD_DAYS), []);

  const [editing, setEditing] = useState<number | null>(null);
  const [accountId, setAccountId] = useState('');
  const [payee, setPayee] = useState('');
  const [dir, setDir] = useState<'out' | 'in'>('out');
  const [amount, setAmount] = useState('');
  const [choice, setChoice] = useState('');
  const [other, setOther] = useState('');
  const [freq, setFreq] = useState<Frequency>('monthly');
  const [start, setStart] = useState(todayISO());
  const [end, setEnd] = useState('');
  const [semi1, setSemi1] = useState('1');
  const [semi2, setSemi2] = useState('15');
  const [memo, setMemo] = useState('');
  const [error, setError] = useState('');

  const acctName = (id: number | null | undefined) => accounts.find((a) => a.id === id)?.name ?? '?';
  const catName = (id: number | null) => cats.find((c) => c.id === id)?.name ?? 'Uncategorized';

  function reset() {
    setEditing(null);
    setPayee('');
    setAmount('');
    setChoice('');
    setOther('');
    setEnd('');
    setMemo('');
    setError('');
  }

  function load(r: RecurringRule) {
    setEditing(r.id!);
    setAccountId(String(r.accountId));
    setPayee(r.payee);
    setDir(r.amountCents < 0 ? 'out' : 'in');
    setAmount((Math.abs(r.amountCents) / 100).toFixed(2));
    setChoice(r.transferAccountId ? 'transfer' : r.categoryId ? String(r.categoryId) : '');
    setOther(r.transferAccountId ? String(r.transferAccountId) : '');
    setFreq(r.frequency);
    setStart(r.startDate);
    setEnd(r.endDate ?? '');
    setSemi1(String(r.semiDays?.[0] ?? 1));
    setSemi2(String(r.semiDays?.[1] ?? 15));
    setMemo(r.memo);
    window.scrollTo({ top: document.body.scrollHeight });
  }

  async function save() {
    setError('');
    const cents = parseAmountToCents(amount);
    if (!accountId) return setError('Choose an account');
    if (!payee.trim()) return setError('Give it a name');
    if (cents === null || cents === 0) return setError('Enter an amount');
    if (choice === 'transfer' && (!other || other === accountId)) return setError('Choose a different account for the transfer');
    const d1 = Number(semi1);
    const d2 = Number(semi2);
    if (freq === 'semimonthly' && (![d1, d2].every((x) => Number.isInteger(x) && x >= 1 && x <= 31) || d1 === d2)) {
      return setError('Pick two different days of the month (31 means the last day)');
    }
    const rule: RecurringRule = {
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
    if (editing) {
      const prev = rules.find((r) => r.id === editing);
      await db.recurring.put({ ...rule, id: editing, active: prev?.active ?? true });
    } else await db.recurring.add(rule);
    reset();
  }

  return (
    <>
      <PageHeader title="Scheduled" description="Recurring items you approve before they post." about={<>Recurring items show up here as they come due (up to {LOOKAHEAD_DAYS} days ahead). Nothing is posted until you approve it, and you
        can change the date or amount first. Approved items land in the ledger as pending, marked “scheduled”.</>} />

      <h2>Due now</h2>
      {due && due.length === 0 && <p className="muted">Nothing due.</p>}
      {due && due.length > 0 && (
        <table>
          <thead><tr><th>Date</th><th>Item</th><th className="num">Amount</th><th></th></tr></thead>
          <tbody>{due.map((x) => <DueRow key={`${x.rule.id}-${x.date}`} item={x} />)}</tbody>
        </table>
      )}

      <h2>Recurring items</h2>
      {rules.length === 0 && <p className="muted">None yet. Add rent, paychecks, subscriptions, card payments…</p>}
      <table>
        <tbody>
          {rules.map((r) => (
            <tr key={r.id} className={r.active ? '' : 'muted'}>
              <td>
                {r.payee}
                <div className="muted">
                  {acctName(r.accountId)} · {r.transferAccountId ? `transfer ${r.amountCents < 0 ? 'to' : 'from'} ${acctName(r.transferAccountId)}` : catName(r.categoryId)}
                </div>
              </td>
              <td>
                {FREQ[r.frequency]}
                <div className="muted">
                  from {r.startDate}{r.endDate ? ` to ${r.endDate}` : ''}
                  {r.frequency === 'semimonthly' ? ` (days ${r.semiDays?.join(' & ')})` : ''}
                </div>
              </td>
              <td className={`num ${r.amountCents < 0 ? 'neg' : 'pos'}`}>{formatCents(r.amountCents)}</td>
              <td>
                <div className="row">
                  <button className="link" onClick={() => load(r)}>edit</button>
                  <button className="link" onClick={() => db.recurring.update(r.id!, { active: !r.active })}>{r.active ? 'pause' : 'resume'}</button>
                  <button className="link danger" onClick={() => confirm(`Delete "${r.payee}"? Transactions already posted are kept.`) && deleteRule(db, r.id!)}>delete</button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>{editing ? 'Edit recurring item' : 'Add recurring item'}</h2>
      <div className="card">
        <div className="grid">
          <label className="f">Account
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <option value="">Choose…</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
          <label className="f">Name<input value={payee} onChange={(e) => setPayee(e.target.value)} placeholder="e.g. Rent" /></label>
          <label className="f">Type
            <select value={dir} onChange={(e) => setDir(e.target.value as 'out' | 'in')}>
              <option value="out">Outflow (−)</option>
              <option value="in">Inflow (+)</option>
            </select>
          </label>
          <label className="f">Amount<input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0.00" /></label>
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
            <select value={freq} onChange={(e) => setFreq(e.target.value as Frequency)}>
              {Object.entries(FREQ).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
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
        <label className="f" style={{ marginTop: 8 }}>Memo<input value={memo} onChange={(e) => setMemo(e.target.value)} /></label>
        <div className="row" style={{ marginTop: 8 }}>
          <button className="primary" onClick={save}>{editing ? 'Save changes' : 'Add recurring item'}</button>
          {editing && <button onClick={reset}>Cancel</button>}
        </div>
        {error && <div className="error">{error}</div>}
      </div>
    </>
  );
}
