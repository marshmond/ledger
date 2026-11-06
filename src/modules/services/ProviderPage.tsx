import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db';
import Modal from '../../shell/Modal';
import { Link } from '../../core/router';
import { updateContactDetails } from '../../core/contacts';
import { dayLabel } from '../../core/time';
import { EmptyState } from '../../ui/components';
import { useToast } from '../../ui/Toast';
import { projectsUsingContact } from '../projects/data';
import { cadenceText, STATUS_LABEL } from './model';
import { arrangementRoute } from './paths';
import { buildProvider, loadSnapshot, type Row } from './views';
import VisitList from './VisitList';

const day = (d: string) => dayLabel(d, { weekday: 'short', year: true });

/**
 * One provider: the shared Contact plus every arrangement with them. Phone and email are read live from the Contact and shown only here.
 * There is no general Contacts screen in Ledger, so this page is also where a provider's details are edited.
 */
export default function ProviderPage({ contactId }: { contactId: number }) {
  const snap = useLiveQuery(() => loadSnapshot(), []);
  const projects = useLiveQuery(() => projectsUsingContact(contactId), [contactId]) ?? [];
  const [editing, setEditing] = useState(false);
  if (!snap) return <div className="sv"><p className="muted">Loading…</p></div>;
  const p = buildProvider(snap, contactId);
  if (!p.contact && p.active.length + p.past.length === 0) {
    return <div className="sv"><p className="sv-back"><Link to="/">← Household Services</Link></p><EmptyState title="That provider is not here">The contact may have been removed, or the address is wrong.</EmptyState></div>;
  }
  const upcoming = [...p.active].filter((r) => r.open).sort((a, b) => a.nextDate!.localeCompare(b.nextDate ?? '9999'));
  const line = (r: Row) => (
    <li key={r.a.id}>
      <Link to={arrangementRoute(r.a.id)}><strong>{r.a.data.title}</strong></Link>
      <div className="small muted">{cadenceText(r.a.data.cadence)} · {STATUS_LABEL[r.a.data.status]}{r.a.data.endDate ? ` ${day(r.a.data.endDate)}` : ''}</div>
    </li>
  );
  return (
    <div className="sv">
      <p className="sv-back"><Link to="/">← Household Services</Link></p>
      <div className="sv-head">
        <div>
          <h1>{p.name || 'Provider'}</h1>
          {!p.contact && <p className="sv-warn small">This contact was removed. The name comes from the arrangements.</p>}
          {p.contact?.relationship && <p className="muted">{p.contact.relationship}</p>}
        </div>
        {p.contact && <div className="sv-head-actions"><button className="btn" onClick={() => setEditing(true)}>Edit contact details</button></div>}
      </div>

      {p.contact && (
        <section className="card sv-card" aria-labelledby="sv-ct-h">
          <h2 id="sv-ct-h">Contact</h2>
          <dl className="sv-facts">
            <div className="sv-fact"><dt>Phone</dt><dd>{p.contact.phone ? <a href={`tel:${p.contact.phone}`}>{p.contact.phone}</a> : <span className="muted">Not recorded</span>}</dd></div>
            <div className="sv-fact"><dt>Email</dt><dd>{p.contact.email ? <a href={`mailto:${p.contact.email}`}>{p.contact.email}</a> : <span className="muted">Not recorded</span>}</dd></div>
          </dl>
          <p className="muted small">These come from your shared Contacts and are shown only on this page.</p>
        </section>
      )}

      <section className="card sv-card" aria-labelledby="sv-pa-h">
        <h2 id="sv-pa-h">Current arrangements</h2>
        {p.active.length === 0 ? <p className="muted">None right now.</p> : <ul className="plain sv-items">{p.active.map(line)}</ul>}
      </section>
      {p.past.length > 0 && (
        <section className="card sv-card" aria-labelledby="sv-pp-h"><h2 id="sv-pp-h">Past arrangements</h2><ul className="plain sv-items">{p.past.map(line)}</ul></section>
      )}
      <section className="card sv-card" aria-labelledby="sv-pu-h">
        <h2 id="sv-pu-h">Upcoming visits</h2>
        {upcoming.length === 0 ? <p className="muted">Nothing scheduled.</p> : (
          <ul className="plain sv-items">{upcoming.map((r) => <li key={r.a.id}><a href={`#/tasks?task=${r.open!.id}`}><strong>{day(r.nextDate!)}{r.open!.data.dueTime ? ` at ${r.open!.data.dueTime}` : ''}</strong></a><div className="small muted">{r.a.data.title}</div></li>)}</ul>
        )}
      </section>
      {p.assets.length > 0 && (
        <section className="card sv-card" aria-labelledby="sv-pas-h">
          <h2 id="sv-pas-h">Properties and assets served</h2>
          <ul className="plain sv-items">{p.assets.map((a) => <li key={a.id}>{a.missing ? <span className="muted">{a.name}</span> : <><a href={`#/assets/${a.id}`}><strong>{a.name}</strong></a><div className="small muted">{a.typeLabel} · {a.statusLabel}</div></>}</li>)}</ul>
        </section>
      )}
      {projects.length > 0 && (
        <section className="card sv-card" aria-labelledby="sv-ppr-h">
          <h2 id="sv-ppr-h">Projects they work on</h2>
          <ul className="plain sv-items">{projects.map((pr) => <li key={pr.id}><a href={`#/projects/${pr.id}`}><strong>{pr.data.name}</strong></a></li>)}</ul>
        </section>
      )}
      <section className="card sv-card" aria-labelledby="sv-pv-h">
        <h2 id="sv-pv-h">Visit history</h2>
        {p.visits.length > 0 && (
          <p className="sv-stats small" aria-label="Visit totals">
            <span>Completed: <strong>{p.stats.completed}</strong></span><span>Skipped: <strong>{p.stats.skipped}</strong></span><span>Cancelled: <strong>{p.stats.cancelled}</strong></span>
            <span>Last serviced: <strong>{p.stats.lastServiced ? day(p.stats.lastServiced) : 'never logged'}</strong></span>
          </p>
        )}
        <VisitList rows={p.visits} showProvider={false} empty="No visits logged with this provider yet." />
      </section>
      {editing && p.contact && <EditContact id={contactId} name={p.contact.name} phone={p.contact.phone ?? ''} email={p.contact.email ?? ''} relationship={p.contact.relationship ?? ''} onClose={() => setEditing(false)} />}
    </div>
  );
}

function EditContact({ id, name: n0, phone: p0, email: e0, relationship: r0, onClose }: { id: number; name: string; phone: string; email: string; relationship: string; onClose: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(n0);
  const [phone, setPhone] = useState(p0);
  const [email, setEmail] = useState(e0);
  const [relationship, setRelationship] = useState(r0);
  const [error, setError] = useState('');
  async function save() {
    try { await updateContactDetails(db, id, { name, phone, email, relationship }); toast('Contact saved'); onClose(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not save.'); }
  }
  return (
    <Modal title="Edit contact details" onClose={onClose}>
      <form className="sv-form" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <label className="f">Name<input value={name} onChange={(e) => setName(e.target.value)} autoFocus /></label>
        <label className="f">What they do (optional)<input value={relationship} onChange={(e) => setRelationship(e.target.value)} placeholder="lawn care company" /></label>
        <div className="sv-two">
          <label className="f">Phone<input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="off" /></label>
          <label className="f">Email<input value={email} onChange={(e) => setEmail(e.target.value)} inputMode="email" autoComplete="off" /></label>
        </div>
        <p className="muted small">This changes the shared contact, so other places that use it show the new details too.</p>
        {error && <div className="error" role="alert">{error}</div>}
        <div className="row sv-actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button type="submit" className="btn primary">Save</button></div>
      </form>
    </Modal>
  );
}
