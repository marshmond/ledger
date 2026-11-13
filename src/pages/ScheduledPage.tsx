import TaskActions from '../modules/tasks/TaskActions';
import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useLocation } from '../core/router';
import { db } from '../db';
import type { Frequency, RecurringRule } from '../types';
import { formatCents, parseAmountToCents, todayISO } from '../lib/money';
import { deleteRule, dueInstances, postInstance, skipInstance, type DueInstance } from '../lib/schedule';
import { orphanedRules } from '../lib/accountDependents';
import Modal from '../shell/Modal';
import { EmptyLine, PageHeader } from '../ui/components';
import { DateTile } from '../ui/DateTile';
import { StatusChip } from '../ui/StatusChip';
import { dueAmountLabel, dueApproveLabel, dueDateLabel, dueSkipLabel, ruleActionLabel } from '../lib/a11yLabels';
import { countWord, isOverdueDate, splitRules } from './moneyPresentation';
import './money.css';

const FREQ: Record<Frequency, string> = {
  weekly: 'Weekly',
  biweekly: 'Every 2 weeks',
  semimonthly: 'Twice a month',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  yearly: 'Yearly',
};

const LOOKAHEAD_DAYS = 7;

type FormField = 'account' | 'payee' | 'amount' | 'other' | 'semi1';
const FIELD_ID: Record<FormField, string> = { account: 'sched-account', payee: 'sched-payee', amount: 'sched-amount', other: 'sched-other', semi1: 'sched-semi1' };
const FORM_ERROR_ID = 'sched-form-error';

/** One scheduled item that has come due: its date and amount can be changed, then Approve posts it (as a pending transaction) or Skip clears that one date. Nothing posts by itself. */
export function DueRow({ item, accountMissing }: { item: DueInstance; accountMissing: boolean }) {
  const { rule, date } = item;
  const [d, setD] = useState(date);
  const [amt, setAmt] = useState((Math.abs(rule.amountCents) / 100).toFixed(2));
  const [err, setErr] = useState('');
  const errId = `due-err-${rule.id}-${date}`;
  const sign = rule.amountCents < 0 ? -1 : 1;
  const today = todayISO();
  const overdue = isOverdueDate(date, today);

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
    <li className={`mny-due${overdue ? ' is-overdue' : ''}`}>
      <DateTile iso={date} today={today} overdue={overdue} size="sm" labelled={false} />
      <div className="mny-due-main">
        <div className="mny-due-title">
          <strong>{rule.payee}</strong>
          {overdue && <StatusChip tone="overdue">Overdue</StatusChip>}
          <StatusChip tone="info" icon={false}>scheduled</StatusChip>
          {rule.transferAccountId ? <StatusChip tone="neutral" icon={false}>Transfer</StatusChip> : null}
        </div>
        <div className={overdue ? 'warn' : 'muted'}>{overdue ? 'overdue · ' : ''}scheduled {date} · {sign < 0 ? 'out' : 'in'} · {formatCents(rule.amountCents)} expected</div>
        {accountMissing && <div className="warn" role="note">Its account no longer exists, so it cannot be approved. Skip it, or fix or delete it under Recurring items below.</div>}
        <div className="mny-due-fields">
          <label className="f"><span className="mny-lbl">Post on</span>
            <input type="date" aria-label={dueDateLabel(rule.payee, date)} value={d} onChange={(e) => setD(e.target.value)} />
          </label>
          <label className="f"><span className="mny-lbl">Amount</span>
            <input inputMode="decimal" aria-label={dueAmountLabel(rule.payee, date)} aria-invalid={err ? true : undefined} aria-describedby={err ? errId : undefined} value={amt} onChange={(e) => { setAmt(e.target.value); setErr(''); }} />
          </label>
        </div>
        {err && <div className="error" id={errId} role="alert">{err}</div>}
      </div>
      <div className="mny-due-act">
        <button className="primary" aria-label={dueApproveLabel(rule.payee, date)} onClick={approve} disabled={accountMissing} title={accountMissing ? 'Its account no longer exists' : undefined}>Approve</button>
        <button aria-label={dueSkipLabel(rule.payee, date)} onClick={() => skipInstance(db, rule, date)}>Skip</button>
      </div>
    </li>
  );
}

export default function ScheduledPage() {
  const accounts = useLiveQuery(() => db.accounts.toArray(), []) ?? [];
  const cats = useLiveQuery(() => db.categories.toArray(), []) ?? [];
  const groups = useLiveQuery(() => db.categoryGroups.toArray(), []) ?? [];
  const rules = useLiveQuery(() => db.recurring.toArray(), []) ?? [];
  const due = useLiveQuery(() => dueInstances(db, todayISO(), LOOKAHEAD_DAYS), []);

  // Read-only: rules that name an account which no longer exists. Nothing is repaired automatically (ST-S1, DI-01).
  const orphans = new Set(orphanedRules(rules, new Set(accounts.map((a) => a.id!))).map((r) => r.id!));
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
  // Which field the message is about, so it can be tied to that field (aria-describedby) and focus can go straight to it.
  const [errField, setErrField] = useState<FormField | ''>('');
  // An in-app confirmation (the browser's own pop-up can be blocked, which made Delete look broken).
  const [askDelete, setAskDelete] = useState<RecurringRule | null>(null);

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
    // The form sits below the lists: bring it into view (it used to be the bottom of the page).
    setTimeout(() => document.getElementById('sched-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  }

  // The Calendar's "Edit in Ledger" opens this page with ?rule=<id>: show that item in the edit form below.
  const { search } = useLocation();
  const wanted = Number(new URLSearchParams(search).get('rule')) || null;
  useEffect(() => {
    const r = wanted ? rules.find((x) => x.id === wanted) : undefined;
    if (r && editing !== r.id) load(r);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted, rules.length]);

  /** Shows the message, ties it to the field it is about, and moves focus there so the person can correct it. */
  function fail(field: FormField, message: string) {
    setErrField(field);
    setError(message);
    setTimeout(() => document.getElementById(FIELD_ID[field])?.focus(), 0);
  }
  const invalid = (f: FormField) => (error && errField === f ? true : undefined);
  const described = (f: FormField) => (error && errField === f ? FORM_ERROR_ID : undefined);

  async function save() {
    setError('');
    setErrField('');
    const cents = parseAmountToCents(amount);
    if (!accountId) return fail('account', 'Choose an account');
    if (!payee.trim()) return fail('payee', 'Give it a name');
    if (cents === null || cents === 0) return fail('amount', 'Enter an amount');
    if (choice === 'transfer' && (!other || other === accountId)) return fail('other', 'Choose a different account for the transfer');
    const d1 = Number(semi1);
    const d2 = Number(semi2);
    if (freq === 'semimonthly' && (![d1, d2].every((x) => Number.isInteger(x) && x >= 1 && x <= 31) || d1 === d2)) {
      return fail('semi1', 'Pick two different days of the month (31 means the last day)');
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

  const today = todayISO();
  const { active, paused } = splitRules(rules);
  const overdueCount = (due ?? []).filter((x) => isOverdueDate(x.date, today)).length;

  const ruleRow = (r: RecurringRule) => {
    return (
      <li key={r.id} className={`mny-rule${r.active ? '' : ' is-paused'}`}>
        <div className="mny-rule-main">
          <div className="mny-rule-title">
            <strong>{r.payee}</strong>
            {!r.active && <StatusChip tone="neutral" icon={false}>Paused</StatusChip>}
            {orphans.has(r.id!) && <StatusChip tone="warning">account missing</StatusChip>}
          </div>
          <div className="muted">{acctName(r.accountId)} · {r.transferAccountId ? `transfer ${r.amountCents < 0 ? 'to' : 'from'} ${acctName(r.transferAccountId)}` : catName(r.categoryId)}</div>
        </div>
        <div className="mny-rule-when">
          <div>{FREQ[r.frequency]}</div>
          <div className="muted">
            from {r.startDate}{r.endDate ? ` to ${r.endDate}` : ''}
            {r.frequency === 'semimonthly' ? ` (days ${r.semiDays?.join(' & ')})` : ''}
          </div>
        </div>
        <div className="mny-rule-amt">
          <span className={`mny-amt ${r.amountCents < 0 ? 'neg' : 'pos'}`}>{formatCents(r.amountCents)}</span>
          <span className="mny-acct-cap">{r.amountCents < 0 ? 'out' : 'in'}</span>
        </div>
        <div className="mny-rule-act">
          <TaskActions module="ledger" id={`scheduled:${r.id}`} label={r.payee} />
          <button className="link" aria-label={ruleActionLabel('Edit', r.payee)} onClick={() => load(r)}>edit</button>
          <button className="link" aria-label={ruleActionLabel(r.active ? 'Pause' : 'Resume', r.payee)} onClick={() => db.recurring.update(r.id!, { active: !r.active })}>{r.active ? 'pause' : 'resume'}</button>
          <button className="link danger" aria-label={ruleActionLabel('Delete', r.payee)} onClick={() => setAskDelete(r)}>delete</button>
        </div>
      </li>
    );
  };

  return (
    <div className="mny-page mny-sched">
      <PageHeader title="Scheduled" description="Recurring items you approve before they post." about={<>Recurring items show up here as they come due (up to {LOOKAHEAD_DAYS} days ahead). Nothing is posted until you approve it, and you
        can change the date or amount first. Approved items land in the ledger as pending, marked “scheduled”.</>} />

      {orphans.size > 0 && (
        <div className="card" role="note">
          <strong>{orphans.size === 1 ? '1 scheduled item points' : `${orphans.size} scheduled items point`} at an account that no longer exists.</strong>
          <p className="muted">They cannot be approved, because nothing can be posted to a missing account. Nothing has been changed. For each one, choose an account that exists (edit it below) or delete it; skipping only clears one date.</p>
        </div>
      )}

      <dl className="card mny-figs" aria-label="Scheduled at a glance">
        <div className="mny-fig"><dt>Due now</dt><dd>{due ? due.length : '…'}</dd>{due && due.length > 0 && <dd className="mny-fig-sub">{overdueCount > 0 ? `${overdueCount} overdue` : `next ${LOOKAHEAD_DAYS} days`}</dd>}</div>
        <div className="mny-fig"><dt>Recurring items</dt><dd>{active.length}</dd></div>
        <div className="mny-fig"><dt>Paused</dt><dd>{paused.length}</dd></div>
      </dl>

      <section aria-labelledby="sched-due">
        <h2 id="sched-due" className="mny-h2">Due now</h2>
        {due && due.length === 0 && <div className="card"><EmptyLine>Nothing due.</EmptyLine></div>}
        {due && due.length > 0 && (
          <ul className="card flush mny-dues">{due.map((x) => <DueRow key={`${x.rule.id}-${x.date}`} item={x} accountMissing={orphans.has(x.rule.id!)} />)}</ul>
        )}
      </section>

      <section aria-labelledby="sched-rules">
        <h2 id="sched-rules" className="mny-h2">Recurring items <span className="mny-count">{countWord(rules.length, 'item')}</span></h2>
        {rules.length === 0 && <div className="card"><EmptyLine>None yet. Add rent, paychecks, subscriptions, card payments…</EmptyLine></div>}
        {active.length > 0 && <ul className="card flush mny-rules" aria-label="Active recurring items">{active.map(ruleRow)}</ul>}
        {paused.length > 0 && (
          <>
            <h3 className="mny-h3">Paused <span className="mny-count">{paused.length}</span></h3>
            <ul className="card flush mny-rules" aria-label="Paused recurring items">{paused.map(ruleRow)}</ul>
          </>
        )}
      </section>

      <section aria-labelledby="sched-form-h" id="sched-form">
        <h2 id="sched-form-h" className="mny-h2">{editing ? 'Edit recurring item' : 'Add recurring item'}</h2>
        <div className="card">
          <div className="mny-form mny-form--wide">
            <label className="f">Account
              <select id={FIELD_ID.account} aria-invalid={invalid('account')} aria-describedby={described('account')} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                <option value="">Choose…</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </label>
            <label className="f">Name<input id={FIELD_ID.payee} aria-invalid={invalid('payee')} aria-describedby={described('payee')} value={payee} onChange={(e) => setPayee(e.target.value)} placeholder="e.g. Rent" /></label>
            <label className="f">Type
              <select value={dir} onChange={(e) => setDir(e.target.value as 'out' | 'in')}>
                <option value="out">Outflow (−)</option>
                <option value="in">Inflow (+)</option>
              </select>
            </label>
            <label className="f">Amount<input id={FIELD_ID.amount} aria-invalid={invalid('amount')} aria-describedby={described('amount')} value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0.00" /></label>
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
                <select id={FIELD_ID.other} aria-invalid={invalid('other')} aria-describedby={described('other')} value={other} onChange={(e) => setOther(e.target.value)}>
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
                <label className="f">1st day of month<input id={FIELD_ID.semi1} aria-invalid={invalid('semi1')} aria-describedby={described('semi1')} value={semi1} onChange={(e) => setSemi1(e.target.value)} inputMode="numeric" /></label>
                <label className="f">2nd day (31 = last)<input value={semi2} onChange={(e) => setSemi2(e.target.value)} inputMode="numeric" /></label>
              </>
            )}
          </div>
          <label className="f mny-memo">Memo<input value={memo} onChange={(e) => setMemo(e.target.value)} /></label>
          {error && <div className="error" id={FORM_ERROR_ID} role="alert">{error}</div>}
          <div className="mny-actions">
            <button className="primary" onClick={save}>{editing ? 'Save changes' : 'Add recurring item'}</button>
            {editing && <button onClick={reset}>Cancel</button>}
          </div>
        </div>
      </section>

      {askDelete && (
        <Modal title="Delete this recurring item?" onClose={() => setAskDelete(null)}>
          <p>Delete “{askDelete.payee}”? Its upcoming dates will disappear (from the Calendar too). Transactions already posted are kept.</p>
          <div className="row">
            <button className="primary danger" onClick={async () => { const id = askDelete.id!; setAskDelete(null); if (editing === id) reset(); await deleteRule(db, id); }}>Delete</button>
            <button onClick={() => setAskDelete(null)}>Cancel</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
