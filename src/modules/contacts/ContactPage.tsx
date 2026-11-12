import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useNavigate } from '../../core/router';
import { db } from '../../db';
import { sameNameMatches, validEmail } from '../../core/contacts';
import { readContactUsage } from '../../core/contactUsage';
import { groupReferences, readContactReferences, unlistedMentions } from '../../core/contactReferences';
import { allContactReferenceProviders } from '../../core/registry';
import { todayISO } from '../../lib/money';
import { isLive, store } from '../../core/store';
import { EmptyState, PageHeader } from '../../ui/components';
import { memberInitials } from '../../ui/memberIdentityModel';
import { StatusChip } from '../../ui/StatusChip';
import { useToast } from '../../ui/Toast';
import ContactForm from './ContactForm';
import RemoveContact from './RemoveContact';
import WhereUsed, { MentionCounts } from './WhereUsed';
import { contactRoute, dateText, distinguish, mailHref, telHref } from './model';
import { facetList, factsFor } from './references';

/** One Contact: its four details, where it is mentioned (counts by module), and Edit. Phone and email are plain `tel:` / `mailto:` links. */
export default function ContactPage({ id }: { id: number }) {
  const data = useLiveQuery(async () => {
    const c = await db.contacts.get(id);
    if (!c || !isLive(c)) return { contact: null, usage: null, refs: null, others: [] };
    const [usage, refs] = await Promise.all([readContactUsage(db, [id]), readContactReferences([id], db, allContactReferenceProviders(), todayISO())]);
    return { contact: c, usage, refs, others: sameNameMatches(await store.shared.contacts.query(), c.name, id) };
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
  const refs = data.refs?.byContact.get(id) ?? [];
  const unlisted = unlistedMentions(entries, refs);
  const tel = c.phone ? telHref(c.phone) : null;
  const mail = c.email ? mailHref(c.email, validEmail) : null;

  const rels = facetList(factsFor(refs, entries).facets);
  const groups = groupReferences(refs);

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

      <section className="card ct-hero" aria-label="Summary">
        <span className="ct-mono ct-mono--lg" aria-hidden="true">{memberInitials(c.name) || '?'}</span>
        <div className="ct-hero-body">
          <div className="ct-hero-rels">
            {rels.length === 0 ? <span className="muted small">No stored relationship to Family, Projects or service providers.</span> : rels.map((r) => <StatusChip key={r} icon={false}>{r}</StatusChip>)}
          </div>
          {groups.length > 0 && (
            <ul className="plain ct-strip" aria-label="Where it is used, by module">
              {groups.map((g) => <li key={g.id}><strong>{g.items.length}</strong><span className="muted small">{g.label}</span></li>)}
            </ul>
          )}
        </div>
      </section>

      <div className="ct-layout">
        <div className="ct-col">
          <WhereUsed refs={refs} unlisted={unlisted} unverified={data.refs?.unverified ?? []} />
          <MentionCounts entries={entries} approximate={!!data.usage?.approximate.has(id)} />
        </div>
        <div className="ct-col">
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
          <RemoveContact contact={c} inUse={refs.length > 0 || entries.length > 0} checkedAll={!!data.refs?.verified} />
        </div>
      </div>

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
