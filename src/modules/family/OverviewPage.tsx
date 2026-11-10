import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useNavigate } from '../../core/router';
import { store } from '../../core/store';
import { EmptyState, PageHeader } from '../../ui/components';
import { useToast } from '../../ui/Toast';
import { useToday } from '../../ui/useToday';
import { readVisibility } from '../calendar/useCalendarData';
import { ActivitiesSection, DatesSection, ResponsibilitiesSection } from './HouseholdSections';
import MemberForm from './MemberForm';
import { loadMembers } from './data';
import { forPerson, readHouseholdOverview } from './householdOverview';
import { ADD_MEMBER } from './quickAddDef';
import { useAddIntent } from './useAddIntent';
import { colorName, DATES_ROUTE, duplicateGroups, effectiveMe, memberRoute, monthDayText, ROLE_LABEL, type MemberRecord } from './model';

/**
 * The Family overview (F4): the household members as simple cards, then a READ-ONLY summary of the household's next 7 days of Calendar activities,
 * the open Tasks that name a member, and the next 30 days of birthdays and important dates. Past members and unreadable records are kept apart and
 * any possible duplicates are flagged. Nothing on this page changes a Calendar event, Task or Contact; every row opens the screen that owns it.
 */
export default function OverviewPage() {
  const members = useLiveQuery(() => loadMembers(), []);
  const contacts = useLiveQuery(() => store.shared.contacts.query(), []);
  const today = useToday();
  const overview = useLiveQuery(() => readHouseholdOverview(today, readVisibility()), [today]);
  const [adding, setAdding] = useState(false);
  const [who, setWho] = useState<number | null>(null);
  const toast = useToast();
  const navigate = useNavigate();
  useAddIntent(ADD_MEMBER, () => setAdding(true)); // F5: the Add box's "Family member" opens this same form

  const head = (
    <PageHeader
      title="Family"
      description="The people in your household. Each one is linked to a contact, so tasks and events that name that contact belong to them."
      actions={<span className="row"><Link to={DATES_ROUTE} className="btn">Family dates</Link><button type="button" className="btn primary" onClick={() => setAdding(true)}>Add member</button></span>}
    />
  );
  const form = adding && (
    <MemberForm onClose={() => setAdding(false)} onSaved={(id, created) => { setAdding(false); toast(created ? 'Added, with a new contact' : 'Added'); navigate(memberRoute(id)); }} />
  );
  if (!members || !contacts) return <div className="fm">{head}<p className="muted" role="status">Loading…</p></div>;

  const nameOf = (m: MemberRecord) => (m.data ? contacts.find((c) => c.id === m.data!.contactId)?.name ?? 'Contact no longer exists' : 'Unreadable record');
  const readable = members.filter((m) => m.data);
  const active = readable.filter((m) => m.data!.status === 'active').sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
  const past = readable.filter((m) => m.data!.status === 'past').sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
  const review = members.filter((m) => !m.data);
  const dups = duplicateGroups(members);
  const meState = effectiveMe(members);
  // The optional person filter lasts for this visit only (nothing is stored or synced). A person who is no longer in the household resets it to Everyone.
  const picked = overview?.people.find((p) => p.memberId === who) ?? null;
  const view = overview ? forPerson(overview, picked ? picked.memberId : null) : null;

  const card = (m: MemberRecord) => {
    const d = m.data!;
    const bday = monthDayText(d.birthMonthDay);
    return (
      <li key={m.id} className="fm-card">
        <span className="fm-dot" style={d.color ? { background: d.color } : undefined} aria-hidden="true" />
        <div className="fm-card-text">
          <Link to={memberRoute(m.id)} className="fm-name">{nameOf(m)}</Link>
          <span className="muted small">{ROLE_LABEL[d.role]}{meState.me?.id === m.id ? ' · This is you' : ''}{d.color ? ` · ${colorName(d.color)}` : ''}{bday ? ` · Birthday ${bday}` : ''}{m.problems.length ? ' · needs a look' : ''}</span>
        </div>
      </li>
    );
  };

  return (
    <div className="fm">
      {head}
      {meState.conflict.length > 0 && (
        <div className="fm-warn" role="alert">
          <strong>More than one member is marked “This is me”</strong>
          <p className="small">This can happen when two devices each chose someone while offline. Nothing was changed or deleted, and for now nobody is treated as you. Open the member who is you and press “This is me”.</p>
          <ul className="plain">{meState.conflict.map((m) => <li key={m.id}><Link to={memberRoute(m.id)}>{nameOf(m)}</Link></li>)}</ul>
        </div>
      )}
      {dups.map((g) => (
        <div key={g[0].data!.contactId} className="fm-warn" role="alert">
          <strong>Possible duplicate member</strong>
          <p className="small">{g.length} active records point at the same contact{contacts.find((c) => c.id === g[0].data!.contactId) ? `, ${contacts.find((c) => c.id === g[0].data!.contactId)!.name}` : ''}. This can happen when two devices add the same person while offline. Nothing was merged or deleted. Open each one, then mark the extra one as past.</p>
          <ul className="plain">{g.map((m) => <li key={m.id}><Link to={memberRoute(m.id)}>{nameOf(m)}, added {new Date(m.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</Link></li>)}</ul>
        </div>
      ))}

      {members.length === 0 ? (
        <EmptyState title="No family members yet" action={<button type="button" className="btn primary" onClick={() => setAdding(true)}>Add the first member</button>}>
          Choose someone from your contacts, or create a new contact. Nothing is copied: the name always comes from the contact.
        </EmptyState>
      ) : (
        <>
          <section className="card" aria-labelledby="fm-active">
            <div className="card-head"><h2 className="card-title" id="fm-active">In the household</h2><span className="muted small">{active.length}</span></div>
            {active.length ? <ul className="plain fm-list">{active.map(card)}</ul> : <p className="muted">Nobody is marked as in the household.</p>}
          </section>
          {overview && view && overview.people.length > 0 && (
            <>
              {overview.people.length > 1 && (
                <div className="fm-filter">
                  <label htmlFor="fm-who" className="fm-filter-label">Show</label>
                  <select id="fm-who" value={picked ? String(picked.memberId) : ''} onChange={(e) => setWho(e.target.value ? Number(e.target.value) : null)} aria-describedby="fm-who-help">
                    <option value="">Everyone</option>
                    {overview.people.map((p) => <option key={p.memberId} value={p.memberId}>{p.name}</option>)}
                  </select>
                  <span className="muted small" id="fm-who-help">Narrows the three sections below. Nothing is saved.</span>
                </div>
              )}
              <ActivitiesSection items={view.activities.items} hiddenCount={view.activities.hidden.length} today={today} who={picked?.name ?? null} />
              <ResponsibilitiesSection items={view.tasks.items} who={picked?.name ?? null} />
              <DatesSection items={view.dates} today={today} who={picked?.name ?? null} />
            </>
          )}
          {overview && overview.people.length === 0 && overview.dates.length > 0 && <DatesSection items={overview.dates} today={today} who={null} />}
          {past.length > 0 && (
            <section className="card" aria-labelledby="fm-past">
              <div className="card-head"><h2 className="card-title" id="fm-past">Past members</h2><span className="muted small">{past.length}</span></div>
              <ul className="plain fm-list">{past.map(card)}</ul>
            </section>
          )}
          {review.length > 0 && (
            <section className="card" aria-labelledby="fm-review">
              <div className="card-head"><h2 className="card-title" id="fm-review">Needs review</h2><span className="muted small">{review.length}</span></div>
              <p className="muted small">These records could not be read by this version of Ledger. They are kept exactly as they are and nothing was changed. A newer version, or the device that made them, may be able to open them.</p>
              <ul className="plain fm-list">{review.map((m) => <li key={m.id} className="fm-card"><div className="fm-card-text"><Link to={memberRoute(m.id)} className="fm-name">Record {m.id}</Link><span className="muted small">{m.problems.join(' ')}</span></div></li>)}</ul>
            </section>
          )}
        </>
      )}
      {form}
    </div>
  );
}
