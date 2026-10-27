import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { formatCents, todayISO } from '../lib/money';
import { ledgerBalance } from '../lib/netWorth';
import { holdingValue } from '../lib/investments';
import { latestValue } from '../lib/property';
import { loanOwedById } from '../lib/netWorthLive';
import { CONTACT_ROLES, DEFAULT_GUIDE, FIRST_STEPS, guideItems, type GuideData } from '../lib/guide';
import { POLICY_LABEL } from '../lib/protection';
import { useInsurance } from './useInsurance';
import { PageHeader } from '../ui/components';

/** A printable guide for whoever would have to take over: contacts, where documents are, accounts, insurance, and what to do first. */
export default function GuidePage() {
  const today = todayISO();
  const saved = useLiveQuery(() => db.settings.get('guide'), []);
  const g: GuideData = { ...DEFAULT_GUIDE, ...((saved?.value as Partial<GuideData>) ?? {}) };
  const setG = (p: Partial<GuideData>) => db.settings.put({ key: 'guide', value: { ...g, ...p } });
  const accounts = useLiveQuery(() => db.accounts.toArray(), []) ?? [];
  const txns = useLiveQuery(() => db.txns.toArray(), []) ?? [];
  const invAccounts = useLiveQuery(() => db.invAccounts.toArray(), []) ?? [];
  const holdings = useLiveQuery(() => db.holdings.toArray(), []) ?? [];
  const securities = useLiveQuery(() => db.securities.toArray(), []) ?? [];
  const loans = useLiveQuery(() => db.loans.toArray(), []) ?? [];
  const props = useLiveQuery(() => db.properties.toArray(), []) ?? [];
  const propValues = useLiveQuery(() => db.propertyValues.toArray(), []) ?? [];
  const people = useLiveQuery(() => db.people.toArray(), []) ?? [];
  const recurring = useLiveQuery(() => db.recurring.toArray(), []) ?? [];
  const owed = useLiveQuery(() => loanOwedById(db, today), [today]) ?? new Map<number, number>();
  const ins = useInsurance();

  const items = useMemo(
    () =>
      guideItems({
        accounts, invAccounts, loans, properties: props, people,
        balance: (a) => ledgerBalance(a, txns),
        invValue: (a) => holdings.filter((h) => h.accountId === a.id).reduce((t, h) => t + holdingValue(h, securities.find((x) => x.id === h.securityId)), 0) + a.cashCents,
        loanOwed: (l) => owed.get(l.id!) ?? 0,
        propertyValue: (p) => latestValue(propValues, p.id!)?.valueCents ?? null,
      }),
    [accounts, invAccounts, loans, props, people, txns, holdings, securities, owed, propValues],
  );
  const bills = recurring.filter((r) => r.active && !r.transferAccountId);
  const acctName = (id: number) => accounts.find((a) => a.id === id)?.name ?? '';
  const [cName, setCName] = useState('');
  const [cRole, setCRole] = useState(CONTACT_ROLES[0]);
  const [dName, setDName] = useState('');

  return (
    <>
      <PageHeader className="no-print" title="If something happens to me" description="A printable guide for your family." actions={<><button className="primary" onClick={() => window.print()}>Print or save as PDF</button></>} />
      <h1 className="print-only">If something happens to me: a guide for {people.map((p) => p.name).join(' and ') || 'my family'}</h1>
      <div className="card rta-neg no-print">
        <strong className="neg">Never put passwords, PINs, or full account numbers here.</strong>
        <div>This page is for where things are and who to call, not how to get in. Keep passwords in a password manager and write down only where that is and how someone you trust can reach it. Everything here is stored only on this device (and in your encrypted backups).</div>
      </div>
      <p className="muted">Printed {today}. Review it every year or after a big change. Keep a copy somewhere your family can reach it, and tell them where it is.</p>

      <section className="pkg">
        <h2>Who to call</h2>
        {g.contacts.length === 0 && <p className="muted no-print">Add the people who would need to be contacted first.</p>}
        <div className="scroll-x">
          <table>
            <thead><tr><th>Name</th><th>Role</th><th>Phone</th><th>Email</th><th>Note</th><th className="no-print" /></tr></thead>
            <tbody>
              {g.contacts.map((c) => (
                <tr key={c.id}>
                  <td><input value={c.name} onChange={(e) => setG({ contacts: g.contacts.map((x) => (x.id === c.id ? { ...x, name: e.target.value } : x)) })} /></td>
                  <td>{c.role}</td>
                  <td><input value={c.phone} onChange={(e) => setG({ contacts: g.contacts.map((x) => (x.id === c.id ? { ...x, phone: e.target.value } : x)) })} /></td>
                  <td><input value={c.email} onChange={(e) => setG({ contacts: g.contacts.map((x) => (x.id === c.id ? { ...x, email: e.target.value } : x)) })} /></td>
                  <td><input value={c.note} onChange={(e) => setG({ contacts: g.contacts.map((x) => (x.id === c.id ? { ...x, note: e.target.value } : x)) })} /></td>
                  <td className="no-print"><button className="link danger" onClick={() => setG({ contacts: g.contacts.filter((x) => x.id !== c.id) })}>remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="row no-print">
          <input placeholder="Name" value={cName} onChange={(e) => setCName(e.target.value)} />
          <select value={cRole} onChange={(e) => setCRole(e.target.value)}>{CONTACT_ROLES.map((r) => <option key={r}>{r}</option>)}</select>
          <button disabled={!cName.trim()} onClick={() => { setG({ contacts: [...g.contacts, { id: crypto.randomUUID(), name: cName.trim(), role: cRole, phone: '', email: '', note: '' }] }); setCName(''); }}>Add contact</button>
        </div>
      </section>

      <section className="pkg">
        <h2>Where the important papers are</h2>
        <table>
          <tbody>
            {g.docs.map((d) => (
              <tr key={d.id}>
                <td>{d.item}</td>
                <td><input style={{ width: '100%' }} placeholder="Where is it, and who has a copy?" value={d.where} onChange={(e) => setG({ docs: g.docs.map((x) => (x.id === d.id ? { ...x, where: e.target.value } : x)) })} /></td>
                <td className="no-print"><button className="link danger" onClick={() => setG({ docs: g.docs.filter((x) => x.id !== d.id) })}>remove</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="row no-print">
          <input placeholder="Another document or item" value={dName} onChange={(e) => setDName(e.target.value)} />
          <button disabled={!dName.trim()} onClick={() => { setG({ docs: [...g.docs, { id: crypto.randomUUID(), item: dName.trim(), where: '' }] }); setDName(''); }}>Add</button>
        </div>
      </section>

      <section className="pkg">
        <div className="row spread">
          <h2>Accounts, loans, and property</h2>
          <label className="chk no-print"><input type="checkbox" checked={g.showBalances} onChange={(e) => setG({ showBalances: e.target.checked })} /> Show balances</label>
        </div>
        <p className="muted">Filled in from the app. For each one, note the bank or firm, how to reach them, and who is the beneficiary. {items.length === 0 && 'Nothing has been added to the app yet.'}</p>
        <div className="scroll-x">
          <table>
            <thead><tr><th>Item</th><th>Kind</th>{g.showBalances && <th className="num">Balance</th>}<th>Institution, contact, beneficiary</th></tr></thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.key}>
                  <td>{i.title}</td><td>{i.detail}</td>
                  {g.showBalances && <td className="num">{i.balanceCents === undefined ? '' : formatCents(i.balanceCents)}</td>}
                  <td><input style={{ width: '100%' }} value={g.itemNotes[i.key] ?? ''} onChange={(e) => setG({ itemNotes: { ...g.itemNotes, [i.key]: e.target.value } })} placeholder="e.g. Fidelity, 800-555-0100, beneficiary: spouse" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="pkg">
        <h2>Insurance</h2>
        {ins.policies.length === 0 ? <p className="muted">No policies entered. Add them on the <Link to="/protection">Protection</Link> page.</p> : (
          <div className="scroll-x">
            <table>
              <thead><tr><th>Type</th><th>Company</th><th>Policy number</th><th className="num">Coverage</th><th>Beneficiary</th></tr></thead>
              <tbody>{ins.policies.map((p) => <tr key={p.id}><td>{POLICY_LABEL[p.type]}{p.personId ? ` (${people.find((x) => x.id === p.personId)?.name ?? ''})` : ''}</td><td>{p.company}</td><td>{p.policyNumber}</td><td className="num">{p.coverageCents ? formatCents(p.coverageCents) : ''}</td><td>{p.beneficiary}</td></tr>)}</tbody>
            </table>
          </div>
        )}
      </section>

      <section className="pkg">
        <h2>Bills that repeat</h2>
        {bills.length === 0 ? <p className="muted">No scheduled bills entered. Add them on the <Link to="/scheduled">Scheduled</Link> page.</p> : (
          <table>
            <thead><tr><th>Payee</th><th className="num">Amount</th><th>How often</th><th>Paid from</th></tr></thead>
            <tbody>{bills.map((r) => <tr key={r.id}><td>{r.payee}</td><td className="num">{formatCents(Math.abs(r.amountCents))}</td><td>{r.frequency}</td><td>{acctName(r.accountId)}</td></tr>)}</tbody>
          </table>
        )}
      </section>

      <section className="pkg">
        <h2>Phones, email, and passwords</h2>
        <textarea rows={5} style={{ width: '100%' }} placeholder="Which password manager I use and how my family can get into it; how to unlock my phone and computer (no actual passwords); which email accounts matter; where the 2-step codes go." value={g.digital} onChange={(e) => setG({ digital: e.target.value })} />
      </section>

      <section className="pkg">
        <h2>My wishes and anything else</h2>
        <textarea rows={5} style={{ width: '100%' }} placeholder="Who should look after pets, funeral wishes, bills to pay first, anything else that would help." value={g.wishes} onChange={(e) => setG({ wishes: e.target.value })} />
      </section>

      <section className="pkg">
        <h2>What to do first</h2>
        <ol>{FIRST_STEPS.map((s) => <li key={s}>{s}</li>)}</ol>
        <p className="muted">General guidance, not legal or tax advice. A lawyer and an accountant can tell you what applies.</p>
      </section>
    </>
  );
}
