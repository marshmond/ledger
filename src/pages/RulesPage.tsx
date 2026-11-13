import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { formatCents, todayISO } from '../lib/money';
import { applyRulesToExisting, detectRecurring, recurringFromGuess, suggestRules } from '../lib/rules';
import Collapsible from './Collapsible';
import { PageHeader } from '../ui/components';
import { countWord } from './moneyPresentation';
import './money.css';

const FREQ: Record<string, string> = { weekly: 'every week', biweekly: 'every 2 weeks', monthly: 'every month', quarterly: 'every 3 months', yearly: 'every year' };

/** Payee rules, categories learned from your history, and repeating charges worth scheduling. */
export default function RulesPage() {
  const today = todayISO();
  const rules = useLiveQuery(() => db.payeeRules.toArray(), []) ?? [];
  const txns = useLiveQuery(() => db.txns.toArray(), []) ?? [];
  const accounts = useLiveQuery(() => db.accounts.toArray(), []) ?? [];
  const groups = useLiveQuery(() => db.categoryGroups.toArray(), []) ?? [];
  const cats = useLiveQuery(() => db.categories.toArray(), []) ?? [];
  const scheduled = useLiveQuery(() => db.recurring.toArray(), []) ?? [];

  const [pattern, setPattern] = useState('');
  const [catId, setCatId] = useState('');
  const [rename, setRename] = useState('');
  const [acct, setAcct] = useState('');
  const [msg, setMsg] = useState('');

  const catName = (id: number | null) => cats.find((c) => c.id === id)?.name ?? 'Uncategorized';
  const acctName = (id: number) => accounts.find((a) => a.id === id)?.name ?? '?';
  const suggestions = useMemo(() => suggestRules(txns, rules), [txns, rules]);
  const guesses = useMemo(() => detectRecurring(txns, scheduled, today), [txns, scheduled, today]);
  const uncategorized = txns.filter((t) => t.categoryId == null && !t.transferTxnId && !t.splits?.length).length;

  const CatSelect = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Choose…</option>
      {groups.map((g) => <optgroup key={g.id} label={g.name}>{cats.filter((c) => c.groupId === g.id && !c.hidden).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</optgroup>)}
    </select>
  );

  return (
    <div className="mny-page mny-rules-page">
      <PageHeader title="Rules" description="Categorize transactions automatically as they arrive." about={<>Rules categorize transactions as you import or add them, so you do it once. The app also notices payees you always file the same way and charges that repeat. Nothing
        changes until you say so.</>} />

      <dl className="card mny-figs" aria-label="Rules at a glance">
        <div className="mny-fig"><dt>Payee rules</dt><dd>{rules.length}</dd></div>
        <div className="mny-fig"><dt>Suggested rules</dt><dd>{suggestions.length}</dd></div>
        <div className="mny-fig"><dt>Repeating charges noticed</dt><dd>{guesses.length}</dd></div>
        <div className="mny-fig"><dt>Uncategorized transactions</dt><dd>{uncategorized.toLocaleString()}</dd></div>
      </dl>

      <Collapsible id="rules.rules" title="Payee rules">
        <p className="muted">If a payee contains the text, it gets that category (and optionally a cleaner name). The longest matching text wins.</p>
        <div className="card mny-ruleform">
          <div className="mny-form mny-form--wide">
            <label className="f">Payee contains<input value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder="whole foods" /></label>
            <label className="f">Category<CatSelect value={catId} onChange={setCatId} /></label>
            <label className="f">Rename to (optional)<input value={rename} onChange={(e) => setRename(e.target.value)} placeholder="Whole Foods Market" /></label>
            <label className="f">Only in account
              <select value={acct} onChange={(e) => setAcct(e.target.value)}>
                <option value="">Any account</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </label>
          </div>
          <div className="mny-actions">
            <button
              className="primary"
              disabled={!pattern.trim() || !catId}
              onClick={async () => {
                await db.payeeRules.add({ pattern: pattern.trim(), categoryId: Number(catId), rename: rename.trim() || undefined, accountId: acct ? Number(acct) : null });
                setPattern('');
                setRename('');
                setMsg('');
              }}
            >Add rule</button>
          </div>
        </div>
        {rules.length > 0 && (
          <div className="card flush mny-tablecard">
            <table className="mny-stack" aria-label="Payee rules">
              <thead><tr><th>Payee contains</th><th>Category</th><th>Rename to</th><th>Account</th><th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {rules.map((r) => (
                  <tr key={r.id}>
                    <td data-label="Payee contains"><strong>{r.pattern}</strong></td>
                    <td data-label="Category">{catName(r.categoryId)}</td>
                    <td data-label="Rename to">{r.rename ?? '—'}</td>
                    <td data-label="Account">{r.accountId ? acctName(r.accountId) : 'any'}</td>
                    <td className="mny-cell-act"><button className="link danger" aria-label={`Delete rule for ${r.pattern}`} onClick={() => db.payeeRules.delete(r.id!)}>delete</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="mny-actions mny-actions--apply">
          <button
            disabled={rules.length === 0 || uncategorized === 0}
            onClick={async () => {
              const n = await applyRulesToExisting(db);
              setMsg(n === 0 ? 'No uncategorized transactions match your rules.' : `Categorized ${n} existing transaction${n === 1 ? '' : 's'}.`);
            }}
          >Apply rules to {uncategorized} uncategorized transaction{uncategorized === 1 ? '' : 's'}</button>
          {msg && <span className="ok" role="status">{msg}</span>}
        </div>
      </Collapsible>

      <Collapsible id="rules.suggested" title="Rules the app suggests">
        {suggestions.length === 0 ? (
          <p className="muted">When you file the same payee the same way three or more times, a suggested rule appears here.</p>
        ) : (
          <div className="card flush mny-tablecard">
            <table className="mny-stack" aria-label="Suggested rules">
              <thead><tr><th>Payee</th><th>Category</th><th className="num">Times</th><th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {suggestions.map((s) => (
                  <tr key={s.pattern}>
                    <td data-label="Payee"><strong>{s.pattern}</strong></td>
                    <td data-label="Category">{catName(s.categoryId)}</td>
                    <td className="num" data-label="Times">{s.count}</td>
                    <td className="mny-cell-act"><button className="link" aria-label={`Create rule for ${s.pattern}`} onClick={() => db.payeeRules.add({ pattern: s.pattern, categoryId: s.categoryId, accountId: null })}>create rule</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Collapsible>

      <Collapsible id="rules.recurring" title="Repeating charges we noticed">
        {guesses.length === 0 ? (
          <p className="muted">Charges that repeat on a regular schedule (at least three times, not already scheduled) appear here so you can add them to Scheduled.</p>
        ) : (
          <div className="card flush mny-tablecard">
            <table className="mny-stack" aria-label="Repeating charges noticed">
              <thead><tr><th>Payee</th><th>Account</th><th className="num">Amount</th><th>Repeats</th><th>Next</th><th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {guesses.map((g) => (
                  <tr key={`${g.accountId}-${g.payee}`}>
                    <td data-label="Payee"><strong>{g.payee}</strong><div className="muted mny-small">seen {countWord(g.count, 'time')}, last {g.lastDate}</div></td>
                    <td data-label="Account">{acctName(g.accountId)}</td>
                    <td className="num" data-label="Amount">{g.varies && '~'}{formatCents(g.amountCents)}</td>
                    <td data-label="Repeats">{FREQ[g.frequency]}</td>
                    <td data-label="Next">{g.nextDate}</td>
                    <td className="mny-cell-act"><button className="link" aria-label={`Add ${g.payee} to Scheduled`} onClick={() => db.recurring.add(recurringFromGuess(g))}>add to Scheduled</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted">Scheduled items are never posted on their own: you approve each one on the Scheduled tab.</p>
      </Collapsible>
    </div>
  );
}
