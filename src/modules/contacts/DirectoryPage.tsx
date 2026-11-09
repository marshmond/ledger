import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useNavigate } from '../../core/router';
import { db } from '../../db';
import { readContactUsage, usageSummary } from '../../core/contactUsage';
import { store } from '../../core/store';
import { EmptyState, PageHeader } from '../../ui/components';
import { useToast } from '../../ui/Toast';
import ContactForm from './ContactForm';
import { contactRoute, filterContacts, sameNameCounts, sortContacts, type SortMode } from './model';

/**
 * The Contacts directory: every live Contact, found by name, relationship, phone or email. One list read and ONE shared usage read for the whole
 * list (not one scan per row). A name shared by more than one Contact is marked, never merged.
 */
export default function DirectoryPage() {
  const data = useLiveQuery(async () => ({ contacts: await store.shared.contacts.query(), usage: await readContactUsage(db) }), []);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortMode>('name');
  const [adding, setAdding] = useState(false);
  const toast = useToast();
  const navigate = useNavigate();

  const shown = useMemo(() => (data ? sortContacts(filterContacts(data.contacts, query), sort) : []), [data, query, sort]);
  const same = useMemo(() => (data ? sameNameCounts(data.contacts) : new Map<number, number>()), [data]);

  const head = (
    <PageHeader
      title="Contacts & Relationships"
      description="The people and organizations in your Ledger. One shared list: a contact you add here can be used by Family, Tasks, Calendar, Projects and the rest."
      actions={<button type="button" className="btn primary" onClick={() => setAdding(true)}>Add contact</button>}
    />
  );
  const form = adding && (
    <ContactForm
      onClose={() => setAdding(false)}
      onOpen={(id) => { setAdding(false); navigate(contactRoute(id)); }}
      onSaved={(id) => { setAdding(false); toast('Contact added'); navigate(contactRoute(id)); }}
    />
  );
  if (!data) return <div className="ct">{head}<p className="muted" role="status">Loading…</p>{form}</div>;

  return (
    <div className="ct">
      {head}
      {data.contacts.length === 0 ? (
        <EmptyState title="No contacts yet" action={<button type="button" className="btn primary" onClick={() => setAdding(true)}>Add the first contact</button>}>
          Contacts are the people and organizations you deal with: family, a plumber, the school office.
        </EmptyState>
      ) : (
        <section className="card" aria-labelledby="ct-list">
          <div className="card-head"><h2 className="card-title" id="ct-list">All contacts</h2><span className="muted small" role="status">{shown.length === data.contacts.length ? `${shown.length}` : `${shown.length} of ${data.contacts.length}`}</span></div>
          <div className="ct-tools">
            <label className="f">Search<input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name, relationship, phone or email" autoComplete="off" /></label>
            <label className="f">Sort
              <select value={sort} onChange={(e) => setSort(e.target.value as SortMode)}>
                <option value="name">A to Z</option>
                <option value="recent">Recently added or changed</option>
              </select>
            </label>
          </div>
          {shown.length === 0 ? <p className="muted" role="status">No contact matches “{query.trim()}”.</p> : (
            <ul className="plain ct-list">
              {shown.map((c) => {
                const n = same.get(c.id as number);
                return (
                  <li key={c.id} className="ct-row">
                    <Link to={contactRoute(c.id as number)} className="ct-name">{c.name}</Link>
                    {c.relationship && <span className="ct-rel">{c.relationship}</span>}
                    {(c.phone || c.email) && <span className="muted small">{[c.phone, c.email].filter(Boolean).join(' · ')}</span>}
                    {n ? <span className="ct-same small">Same name as {n === 1 ? '1 other contact' : `${n} other contacts`}</span> : null}
                    <span className="muted small">{usageSummary(data.usage.byContact.get(c.id as number))}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
      {form}
    </div>
  );
}
