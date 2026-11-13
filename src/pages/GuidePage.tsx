import { useMemo, useState } from 'react';
import { Link } from '../core/router';
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
import { Kind, PlanJump, PlanSection } from './PlanParts';
import './analysis.css';
import './plan.css';
import './docs.css';

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

  const setContact = (id: string, patch: Partial<GuideData['contacts'][number]>) => setG({ contacts: g.contacts.map((x) => (x.id === id ? { ...x, ...patch } : x)) });
  /** On paper an empty answer is a ruled blank, so the page can be filled in by hand. */
  const blank = (text: string) => (text.trim() ? text : <span className="dc-blank" />);

  return (
    <div className="dc-doc dc-guide">
      <PageHeader className="no-print" title="If something happens to me" description="A printable guide for your family." actions={<><button className="primary" onClick={() => window.print()}>Print or save as PDF</button></>} />
      <h1 className="print-only">If something happens to me: a guide for {people.map((p) => p.name).join(' and ') || 'my family'}</h1>

      <section className="an-card dc-orient no-print" aria-label="About this guide">
        <div className="dc-orient-main">
          <h2 className="an-h2">What this guide is for</h2>
          <p>If you could not manage things yourself, this is where your family finds who to call, where the important papers are, and what accounts and insurance you have.</p>
          <ol className="dc-steps">
            <li>Fill in each section below. It saves as you type, on this device only (and in your encrypted backups).</li>
            <li>Use <strong>Print or save as PDF</strong> to make a copy; buttons and menus are left off the page.</li>
            <li>Keep a copy somewhere your family can reach it, and tell them where it is.</li>
          </ol>
        </div>
        <div className="dc-orient-warn rta-neg" role="note">
          <strong className="neg">Never put passwords, PINs, or full account numbers here.</strong>
          <div>This page is for where things are and who to call, not how to get in. Keep passwords in a password manager and write down only where that is and how someone you trust can reach it. Everything here is stored only on this device (and in your encrypted backups).</div>
        </div>
      </section>
      <p className="muted dc-printed">Printed {today}. Review it every year or after a big change. Keep a copy somewhere your family can reach it, and tell them where it is.</p>

      <PlanJump label="Sections" items={[
        { id: 'gd-call', label: 'Who to call' }, { id: 'gd-papers', label: 'Papers' }, { id: 'gd-accounts', label: 'Accounts' }, { id: 'gd-insurance', label: 'Insurance' },
        { id: 'gd-bills', label: 'Bills' }, { id: 'gd-digital', label: 'Phones and email' }, { id: 'gd-wishes', label: 'Wishes' }, { id: 'gd-first', label: 'What to do first' },
      ]} />

      <PlanSection id="gd-call" title="Who to call" kind={<Kind k="input">You fill this in</Kind>}>
        {g.contacts.length === 0 && <p className="muted no-print">Add the people who would need to be contacted first.</p>}
        <ul className="dc-contacts">
          {g.contacts.map((c) => (
            <li key={c.id} className="dc-contact">
              <div className="dc-contact-edit no-print">
                <div className="dc-contact-top">
                  <strong>{c.name || 'Unnamed contact'}</strong>
                  <span className="dc-role">{c.role}</span>
                  <button className="link danger" aria-label={`Remove ${c.name || 'this contact'}`} onClick={() => setG({ contacts: g.contacts.filter((x) => x.id !== c.id) })}>remove</button>
                </div>
                <div className="an-form">
                  <label className="f">Name<input value={c.name} onChange={(e) => setContact(c.id, { name: e.target.value })} /></label>
                  <label className="f">Phone<input value={c.phone} onChange={(e) => setContact(c.id, { phone: e.target.value })} /></label>
                  <label className="f">Email<input value={c.email} onChange={(e) => setContact(c.id, { email: e.target.value })} /></label>
                  <label className="f">Note<input value={c.note} onChange={(e) => setContact(c.id, { note: e.target.value })} /></label>
                </div>
              </div>
              <dl className="dc-contact-print print-only">
                <div><dt>Name</dt><dd>{blank(c.name)}</dd></div>
                <div><dt>Role</dt><dd>{c.role}</dd></div>
                <div><dt>Phone</dt><dd>{blank(c.phone)}</dd></div>
                <div><dt>Email</dt><dd>{blank(c.email)}</dd></div>
                <div><dt>Note</dt><dd>{blank(c.note)}</dd></div>
              </dl>
            </li>
          ))}
        </ul>
        <div className="row no-print dc-add">
          <input aria-label="Name of a new contact" placeholder="Name" value={cName} onChange={(e) => setCName(e.target.value)} />
          <select aria-label="Role of the new contact" value={cRole} onChange={(e) => setCRole(e.target.value)}>{CONTACT_ROLES.map((r) => <option key={r}>{r}</option>)}</select>
          <button disabled={!cName.trim()} onClick={() => { setG({ contacts: [...g.contacts, { id: crypto.randomUUID(), name: cName.trim(), role: cRole, phone: '', email: '', note: '' }] }); setCName(''); }}>Add contact</button>
        </div>
      </PlanSection>

      <PlanSection id="gd-papers" title="Where the important papers are" kind={<Kind k="input">You fill this in</Kind>}
        intro="A note about where each one is kept is not the document itself. Keep the originals where they are stored.">
        <ul className="dc-papers">
          {g.docs.map((d) => (
            <li key={d.id} className="dc-paper">
              <span className="dc-paper-item">{d.item}</span>
              <input className="no-print" aria-label={`Where is: ${d.item}`} placeholder="Where is it, and who has a copy?" value={d.where} onChange={(e) => setG({ docs: g.docs.map((x) => (x.id === d.id ? { ...x, where: e.target.value } : x)) })} />
              <span className="dc-paper-where print-only">{blank(d.where)}</span>
              <button className="link danger no-print" aria-label={`Remove ${d.item}`} onClick={() => setG({ docs: g.docs.filter((x) => x.id !== d.id) })}>remove</button>
            </li>
          ))}
        </ul>
        <div className="row no-print dc-add">
          <input aria-label="Another document or item" placeholder="Another document or item" value={dName} onChange={(e) => setDName(e.target.value)} />
          <button disabled={!dName.trim()} onClick={() => { setG({ docs: [...g.docs, { id: crypto.randomUUID(), item: dName.trim(), where: '' }] }); setDName(''); }}>Add</button>
        </div>
      </PlanSection>

      <PlanSection id="gd-accounts" title="Accounts, loans, and property" kind={<Kind k="actual">Filled in from the app</Kind>}
        aside={<label className="chk no-print"><input type="checkbox" checked={g.showBalances} onChange={(e) => setG({ showBalances: e.target.checked })} /> Show balances</label>}
        intro={<>Filled in from the app. For each one, note the bank or firm, how to reach them, and who is the beneficiary. {items.length === 0 && 'Nothing has been added to the app yet.'}</>}>
        <p className="an-note dc-bal-note no-print">{g.showBalances ? 'Balances are shown here and will be on the printed page.' : 'Balances are hidden here and on the printed page.'}</p>
        <div className="an-tablewrap">
          <table className="an-table dc-stack">
            <thead><tr><th>Item</th><th>Kind</th>{g.showBalances && <th className="num">Balance</th>}<th>Institution, contact, beneficiary</th></tr></thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.key}>
                  <td data-label="Item" className="an-title">{i.title}</td><td data-label="Kind">{i.detail}</td>
                  {g.showBalances && <td data-label="Balance" className="num">{i.balanceCents === undefined ? '' : formatCents(i.balanceCents)}</td>}
                  <td data-label="Institution, contact, beneficiary">
                    <input className="no-print" aria-label={`Institution, contact, beneficiary for ${i.title}`} value={g.itemNotes[i.key] ?? ''} onChange={(e) => setG({ itemNotes: { ...g.itemNotes, [i.key]: e.target.value } })} placeholder="e.g. Fidelity, 800-555-0100, beneficiary: spouse" />
                    <span className="print-only">{blank(g.itemNotes[i.key] ?? '')}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </PlanSection>

      <PlanSection id="gd-insurance" title="Insurance" kind={<Kind k="actual">Filled in from Protection</Kind>}>
        {ins.policies.length === 0 ? <p className="muted">No policies entered. Add them on the <Link to="/protection">Protection</Link> page.</p> : (
          <div className="an-tablewrap">
            <table className="an-table dc-stack">
              <thead><tr><th>Type</th><th>Company</th><th>Policy number</th><th className="num">Coverage</th><th>Beneficiary</th></tr></thead>
              <tbody>{ins.policies.map((p) => <tr key={p.id}><td data-label="Type" className="an-title">{POLICY_LABEL[p.type]}{p.personId ? ` (${people.find((x) => x.id === p.personId)?.name ?? ''})` : ''}</td><td data-label="Company">{p.company}</td><td data-label="Policy number">{p.policyNumber}</td><td data-label="Coverage" className="num">{p.coverageCents ? formatCents(p.coverageCents) : ''}</td><td data-label="Beneficiary">{p.beneficiary}</td></tr>)}</tbody>
            </table>
          </div>
        )}
      </PlanSection>

      <PlanSection id="gd-bills" title="Bills that repeat" kind={<Kind k="actual">Filled in from Scheduled</Kind>}>
        {bills.length === 0 ? <p className="muted">No scheduled bills entered. Add them on the <Link to="/scheduled">Scheduled</Link> page.</p> : (
          <div className="an-tablewrap">
            <table className="an-table dc-stack">
              <thead><tr><th>Payee</th><th className="num">Amount</th><th>How often</th><th>Paid from</th></tr></thead>
              <tbody>{bills.map((r) => <tr key={r.id}><td data-label="Payee" className="an-title">{r.payee}</td><td data-label="Amount" className="num">{formatCents(Math.abs(r.amountCents))}</td><td data-label="How often">{r.frequency}</td><td data-label="Paid from">{acctName(r.accountId)}</td></tr>)}</tbody>
            </table>
          </div>
        )}
      </PlanSection>

      <PlanSection id="gd-digital" title="Phones, email, and passwords" kind={<Kind k="input">You fill this in</Kind>}>
        <label className="f dc-note-field"><span className="pl-vh">Phones, email, and passwords</span>
          <textarea className="no-print" rows={5} placeholder="Which password manager I use and how my family can get into it; how to unlock my phone and computer (no actual passwords); which email accounts matter; where the 2-step codes go." value={g.digital} onChange={(e) => setG({ digital: e.target.value })} />
        </label>
        {g.digital.trim() ? <p className="print-only dc-pre">{g.digital}</p> : <div className="print-only dc-lines" />}
      </PlanSection>

      <PlanSection id="gd-wishes" title="My wishes and anything else" kind={<Kind k="input">You fill this in</Kind>}>
        <label className="f dc-note-field"><span className="pl-vh">My wishes and anything else</span>
          <textarea className="no-print" rows={5} placeholder="Who should look after pets, funeral wishes, bills to pay first, anything else that would help." value={g.wishes} onChange={(e) => setG({ wishes: e.target.value })} />
        </label>
        {g.wishes.trim() ? <p className="print-only dc-pre">{g.wishes}</p> : <div className="print-only dc-lines" />}
      </PlanSection>

      <PlanSection id="gd-first" title="What to do first" kind={<Kind k="guideline">General guidance</Kind>}>
        <ol className="dc-first">{FIRST_STEPS.map((s) => <li key={s}>{s}</li>)}</ol>
        <p className="muted">General guidance, not legal or tax advice. A lawyer and an accountant can tell you what applies.</p>
      </PlanSection>
    </div>
  );
}
