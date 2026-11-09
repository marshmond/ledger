import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useNavigate } from '../../core/router';
import { db } from '../../db';
import { findRemovedButReferenced, restoreContact } from '../../core/contactRemoval';
import { readContactReferences } from '../../core/contactReferences';
import { readContactUsage, usageSummary } from '../../core/contactUsage';
import { allContactReferenceProviders } from '../../core/registry';
import { store } from '../../core/store';
import { todayISO } from '../../lib/money';
import { EmptyState, PageHeader } from '../../ui/components';
import { useToast } from '../../ui/Toast';
import ContactForm from './ContactForm';
import { contactRoute, filterContacts, sameNameCounts, sortContacts, type SortMode } from './model';
import { facetText, factsFor, FILTERS, matchesFilter, type FilterId } from './references';

/**
 * The Contacts directory: every live Contact, found by name, relationship, phone or email, and filtered by the relationships Ledger already stores
 * (household member, important Family contact, service provider, project participant, or no confirmed references). One list read, ONE usage read and ONE pass
 * of each module's named reader for the whole list (not one per row). A name shared by more than one Contact is marked, never merged.
 */
export default function DirectoryPage() {
  const data = useLiveQuery(async () => {
    const contacts = await store.shared.contacts.query();
    const ids = contacts.map((c) => c.id as number);
    const [usage, refs, removed] = await Promise.all([readContactUsage(db), readContactReferences(ids, db, allContactReferenceProviders(), todayISO()), findRemovedButReferenced(db)]);
    return { contacts, usage, refs, removed };
  }, []);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortMode>('name');
  const [filter, setFilter] = useState<FilterId>('all');
  const [adding, setAdding] = useState(false);
  const toast = useToast();
  const navigate = useNavigate();

  const facts = useMemo(() => {
    const m = new Map<number, ReturnType<typeof factsFor>>();
    if (data) for (const c of data.contacts) m.set(c.id as number, factsFor(data.refs.byContact.get(c.id as number), data.usage.byContact.get(c.id as number)));
    return m;
  }, [data]);
  const checked = !!data?.refs.verified;
  const counts = useMemo(() => {
    const out = new Map<FilterId, number>();
    if (data) for (const f of FILTERS) out.set(f.id, data.contacts.filter((c) => matchesFilter(f.id, facts.get(c.id as number)!, checked)).length);
    return out;
  }, [data, facts, checked]);
  const shown = useMemo(
    () => (data ? sortContacts(filterContacts(data.contacts, query), sort).filter((c) => matchesFilter(filter, facts.get(c.id as number)!, checked)) : []),
    [data, query, sort, filter, facts, checked],
  );
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
      {data.removed.length > 0 && (
        <section className="card ct-warn" aria-labelledby="ct-removed">
          <div className="card-head"><h2 className="card-title" id="ct-removed">Removed contacts that are still in use</h2></div>
          <p className="small">{data.removed.length === 1 ? 'A contact was removed, but a stored record still points at it.' : `${data.removed.length} contacts were removed, but stored records still point at them.`} This can happen when another device added something before the removal reached it. Nothing was lost: restore the contact to bring it back with the same identity.</p>
          <ul className="plain">
            {data.removed.map(({ contact, mentions }) => (
              <li key={contact.id} className="ct-match">
                <span>{contact.name}<br /><span className="muted small">{usageSummary(mentions)}</span></span>
                <button type="button" className="btn" aria-label={`Restore ${contact.name}`} onClick={async () => { await restoreContact(db, contact.id as number); toast('Contact restored'); }}>Restore</button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {data.contacts.length === 0 ? (
        <EmptyState title="No contacts yet" action={<button type="button" className="btn primary" onClick={() => setAdding(true)}>Add the first contact</button>}>
          Contacts are the people and organizations you deal with: family, a plumber, the school office.
        </EmptyState>
      ) : (
        <section className="card" aria-labelledby="ct-list">
          <div className="card-head"><h2 className="card-title" id="ct-list">{FILTERS.find((f) => f.id === filter)?.label}</h2><span className="muted small" role="status">{shown.length === data.contacts.length ? `${shown.length}` : `${shown.length} of ${data.contacts.length}`}</span></div>
          <div className="ct-tools">
            <label className="f">Search<input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name, relationship, phone or email" autoComplete="off" /></label>
            <label className="f">Show
              <select value={filter} onChange={(e) => setFilter(e.target.value as FilterId)}>
                {FILTERS.map((f) => <option key={f.id} value={f.id} disabled={f.id === 'none' && !checked}>{f.label} ({counts.get(f.id) ?? 0})</option>)}
              </select>
            </label>
            <label className="f">Sort
              <select value={sort} onChange={(e) => setSort(e.target.value as SortMode)}>
                <option value="name">A to Z</option>
                <option value="recent">Recently added or changed</option>
              </select>
            </label>
          </div>
          {!checked && <p className="ct-note small" role="status">Ledger could not check every module just now, so “No confirmed references” is not offered and the other filters may be missing some contacts.</p>}
          {filter === 'none' && <p className="muted small">These contacts have no named record and no stored mention. This is a way to find them, not a check that they can be removed: removal is checked again, in full, on the contact’s own page.</p>}
          {shown.length === 0 ? <p className="muted" role="status">{query.trim() ? `No contact matches “${query.trim()}”${filter === 'all' ? '' : ' in this list'}.` : 'No contact in this list.'}</p> : (
            <ul className="plain ct-list">
              {shown.map((c) => {
                const n = same.get(c.id as number);
                const f = facts.get(c.id as number)!;
                return (
                  <li key={c.id} className="ct-row">
                    <Link to={contactRoute(c.id as number)} className="ct-name">{c.name}</Link>
                    {c.relationship && <span className="ct-rel">{c.relationship}</span>}
                    {(c.phone || c.email) && <span className="muted small">{[c.phone, c.email].filter(Boolean).join(' · ')}</span>}
                    {n ? <span className="ct-same small">Same name as {n === 1 ? '1 other contact' : `${n} other contacts`}</span> : null}
                    {f.facets.size > 0 && <span className="small">{facetText(f.facets)}</span>}
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
