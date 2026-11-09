import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useNavigate } from '../../core/router';
import { db } from '../../db';
import { sameNameMatches, validEmail } from '../../core/contacts';
import { readContactUsage, usageKindText, usageModuleName, usedModules } from '../../core/contactUsage';
import { isLive, store } from '../../core/store';
import { EmptyState, PageHeader } from '../../ui/components';
import { useToast } from '../../ui/Toast';
import ContactForm from './ContactForm';
import { contactRoute, dateText, distinguish, mailHref, telHref } from './model';

/** One Contact: its four details, where it is mentioned (counts by module), and Edit. Phone and email are plain `tel:` / `mailto:` links. */
export default function ContactPage({ id }: { id: number }) {
  const data = useLiveQuery(async () => {
    const c = await db.contacts.get(id);
    if (!c || !isLive(c)) return { contact: null, usage: null, others: [] };
    return { contact: c, usage: await readContactUsage(db, [id]), others: sameNameMatches(await store.shared.contacts.query(), c.name, id) };
  }, [id]);
  const [editing, setEditing] = useState(false);
  const toast = useToast();
  const navigate = useNavigate();

  if (!data) return <div className="ct"><PageHeader title="Contact" /><p className="muted" role="status">Loading…</p></div>;
  const c = data.contact;
  if (!c) {
    return (
      <div className="ct"><PageHeader title="Contact" />
        <EmptyState title="That contact no longer exists" action={<Link className="btn" to="/">Back to Contacts</Link>}>It may have been removed on another device.</EmptyState>
      </div>
    );
  }
  const entries = data.usage?.byContact.get(id) ?? [];
  const tel = c.phone ? telHref(c.phone) : null;
  const mail = c.email ? mailHref(c.email, validEmail) : null;

  return (
    <div className="ct">
      <PageHeader title={c.name} description={c.relationship || undefined} actions={<button type="button" className="btn primary" onClick={() => setEditing(true)}>Edit</button>} />
      <p><Link to="/" className="ct-back">← All contacts</Link></p>

      {data.others.length > 0 && (
        <div className="ct-warn" role="status">
          <strong>{data.others.length === 1 ? 'Another contact has the same name.' : `${data.others.length} other contacts have the same name.`}</strong>
          <p className="small">They may be different people or organizations. Nothing is merged.</p>
          <ul className="plain">{data.others.map((o) => <li key={o.id}><Link to={contactRoute(o.id as number)}>{o.name}</Link><br /><span className="muted small">{distinguish(o)}</span></li>)}</ul>
        </div>
      )}

      <section className="card" aria-labelledby="ct-details">
        <div className="card-head"><h2 className="card-title" id="ct-details">Details</h2></div>
        <dl className="ct-facts">
          <div><dt>Relationship</dt><dd>{c.relationship || <span className="muted">Not recorded</span>}</dd></div>
          <div><dt>Phone</dt><dd>{c.phone ? (tel ? <a href={tel}>{c.phone}</a> : c.phone) : <span className="muted">Not recorded</span>}</dd></div>
          <div><dt>Email</dt><dd>{c.email ? (mail ? <a href={mail}>{c.email}</a> : c.email) : <span className="muted">Not recorded</span>}</dd></div>
          <div><dt>Added</dt><dd>{dateText(c.createdAt)}</dd></div>
          <div><dt>Last changed</dt><dd>{dateText(c.updatedAt)}</dd></div>
        </dl>
        <p className="muted small">This is the one shared contact. Changing it here changes it everywhere it is linked. A few places keep the name as it was written at the time (provider names on past bills and service visits, and birthday event titles already created) and are not rewritten.</p>
      </section>

      <section className="card" aria-labelledby="ct-used">
        <div className="card-head"><h2 className="card-title" id="ct-used">Where this contact is mentioned</h2></div>
        {entries.length === 0 ? (
          <p className="muted">No other record mentions this contact yet.</p>
        ) : (
          <ul className="plain ct-usage">
            {usedModules(entries).map((m) => (
              <li key={m}><strong>{usageModuleName(m)}</strong>: {entries.filter((e) => e.module === m).map(usageKindText).join(', ')}</li>
            ))}
          </ul>
        )}
        <p className="muted small">These counts come from records that mention this contact. They are a guide to where it is used, not a full list of relationships, and they do not decide whether a contact can be removed. {data.usage?.approximate.has(id) ? 'This contact has an older style of identifier, so the counts may include unrelated records. ' : ''}Detailed lists come later.</p>
      </section>

      {editing && (
        <ContactForm
          contact={c}
          onClose={() => setEditing(false)}
          onOpen={(other) => { setEditing(false); navigate(contactRoute(other)); }}
          onSaved={(_id, changed) => { setEditing(false); toast(changed ? 'Saved' : 'No changes to save'); }}
        />
      )}
    </div>
  );
}
