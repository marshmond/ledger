import { useId, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useNavigate } from '../../core/router';
import { store } from '../../core/store';
import ConfirmDialog from '../../shell/ConfirmDialog';
import { EmptyState, PageHeader } from '../../ui/components';
import { useToast } from '../../ui/Toast';
import { useToday } from '../../ui/useToday';
import { MemberChip, MemberMark } from '../../ui/MemberIdentity';
import { ImportantContactsSection } from './ImportantContacts';
import { memberColorId } from './memberIdentity';
import { MemberDatesSection, ProjectsSection, ScheduleSection, TodoSection } from './MemberSections';
import MemberForm, { contactDetail } from './MemberForm';
import { getMember, loadMembers, setBirthdayOnCalendar, setMe, setMemberStatus } from './data';
import { colorName, duplicateGroups, effectiveMe, memberHint, memberRoute, monthDayText, ROLE_LABEL, STATUS_LABEL } from './model';
import { readContactReferences, referenceLines } from './references';

/** The private note: not in the page at all until Show is pressed, and hidden again when you leave. Never part of a label or a message. */
function MaskedNote({ note }: { note: string }) {
  const [shown, setShown] = useState(false);
  const id = useId();
  return (
    <div>
      <button type="button" className="btn" aria-expanded={shown} aria-controls={id} onClick={() => setShown((s) => !s)}>{shown ? 'Hide note' : 'Show note'}</button>
      <div id={id} className="fm-secret" aria-live="polite">{shown ? note : <span className="muted">Hidden</span>}</div>
    </div>
  );
}

/** One household member: their profile, the contact they are linked to, where that contact is used, and edit / past actions. */
export default function MemberPage({ id }: { id: number }) {
  const m = useLiveQuery(async () => ({ m: (await getMember(id)) ?? null }), [id]);
  const all = useLiveQuery(() => loadMembers(), []);
  const contacts = useLiveQuery(() => store.shared.contacts.query(), []);
  const refs = useLiveQuery(async () => {
    const mem = await getMember(id);
    return mem?.data ? readContactReferences(mem.data.contactId, undefined, id) : null;
  }, [id]);
  const today = useToday();
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState<'past' | 'active' | null>(null);
  const toast = useToast();
  const navigate = useNavigate();

  if (!m || !all || !contacts) return <div className="fm"><PageHeader title="Family member" /><p className="muted" role="status">Loading…</p></div>;
  const rec = m.m;
  if (!rec) {
    return (
      <div className="fm"><PageHeader title="Family member" />
        <EmptyState title="That member no longer exists" action={<Link className="btn" to="/">Back to Family</Link>}>It may have been removed on another device.</EmptyState>
      </div>
    );
  }
  if (!rec.data) {
    return (
      <div className="fm">
        <PageHeader title={`Record ${rec.id}`} description="This record could not be read by this version of Ledger." />
        <div className="fm-warn" role="status">
          <strong>Needs review</strong>
          <ul className="plain">{rec.problems.map((p) => <li key={p}>{p}</li>)}</ul>
          <p className="small">It is kept exactly as it is and nothing was changed. It cannot be edited here. A newer version, or the device that made it, may be able to open it.</p>
        </div>
        <Link className="btn" to="/">Back to Family</Link>
      </div>
    );
  }

  const d = rec.data;
  const contact = contacts.find((c) => c.id === d.contactId);
  const name = contact?.name ?? 'Contact no longer exists';
  const dupGroup = duplicateGroups(all).find((g) => g.some((x) => x.id === rec.id));
  const lines = refs ? referenceLines(refs) : [];
  const meState = effectiveMe(all);
  const isMe = meState.me?.id === rec.id;
  const inMeConflict = meState.conflict.some((x) => x.id === rec.id);
  const nameOfMember = (m: { data: { contactId: number } | null }) => (m.data ? nameByContactId.get(m.data.contactId) ?? 'Contact no longer exists' : 'Unreadable record');
  const bday = monthDayText(d.birthMonthDay);
  const nameByContact = new Map(contacts.filter((c) => c.id !== undefined).map((c) => [c.id as number, c.name]));
  const nameByContactId = nameByContact;
  const nameOfContact = (cid: number) => nameByContact.get(cid) ?? 'A contact that no longer exists';
  /** The OTHER active household members' Contacts: only these are named as "Also for" on a row. */
  const otherContacts = new Set(all.filter((x) => x.id !== rec.id && x.data?.status === 'active' && x.data.contactId !== d.contactId).map((x) => x.data!.contactId));

  return (
    <div className="fm">
      <PageHeader
        title={name}
        description={`${ROLE_LABEL[d.role]} · ${STATUS_LABEL[d.status]}${isMe ? ' · This is you' : ''}`}
        actions={
          <span className="row">
            <button type="button" className="btn" onClick={() => setEditing(true)}>Edit</button>
            {d.status === 'active'
              ? <button type="button" className="btn" onClick={() => setConfirm('past')}>Mark as past member</button>
              : <button type="button" className="btn" onClick={() => setConfirm('active')}>Mark as in the household</button>}
          </span>
        }
      />
      <p><Link to="/" className="fm-back">← All family members</Link></p>

      {!contact && <div className="fm-warn" role="alert"><strong>The linked contact no longer exists.</strong><p className="small">This member is kept. Nothing was deleted by Family.</p></div>}
      {dupGroup && (
        <div className="fm-warn" role="alert">
          <strong>Possible duplicate member</strong>
          <p className="small">More than one active record points at this contact. Nothing was merged or deleted. If one is extra, open it and mark it as a past member.</p>
          <ul className="plain">{dupGroup.filter((x) => x.id !== rec.id).map((x) => <li key={x.id}><Link to={memberRoute(x.id)}>The other record, added {new Date(x.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</Link></li>)}</ul>
        </div>
      )}
      {inMeConflict && (
        <div className="fm-warn" role="alert">
          <strong>More than one member is marked “This is me”</strong>
          <p className="small">This can happen when two devices each chose someone while offline. Nothing was changed or deleted, and for now nobody is treated as you. Choose who you are:</p>
          <ul className="plain">{meState.conflict.map((x) => <li key={x.id} className="row"><span>{nameOfMember(x)} ({memberHint(x)})</span><button type="button" className="btn fm-touch" aria-label={`${nameOfMember(x)} (${memberHint(x)}) is me`} onClick={async () => { await setMe(x.id); toast(`${nameOfMember(x)} is marked as you`); }}>This one is me</button></li>)}</ul>
        </div>
      )}
      {rec.problems.length > 0 && (
        <div className="fm-warn" role="status"><strong>Part of this record could not be read</strong><ul className="plain">{rec.problems.map((p) => <li key={p}>{p}</li>)}</ul><p className="small">The stored value is untouched until you save that field again.</p></div>
      )}

      <section className="card" aria-labelledby="fm-profile">
        <div className="card-head fm-profile-head"><MemberMark name={contact?.name} colorId={memberColorId(d.color)} size="lg" /><h2 className="card-title" id="fm-profile">Profile</h2></div>
        <dl className="fm-facts">
          <div><dt>Role</dt><dd>{ROLE_LABEL[d.role]}</dd></div>
          <div><dt>Status</dt><dd>{STATUS_LABEL[d.status]}</dd></div>
          <div>
            <dt>This is me</dt>
            <dd>
              {d.status !== 'active' ? <span className="muted">Only a member in the household can be you</span> : (
                <>
                  {isMe ? 'Yes, this is your profile' : inMeConflict ? 'Not decided (see above)' : <span className="muted">No</span>}{' '}
                  {isMe
                    ? <button type="button" className="btn fm-mini" aria-label={`Clear: ${name} is not me`} onClick={async () => { await setMe(null); toast('No one is marked as you'); }}>Clear</button>
                    : <button type="button" className="btn fm-mini" aria-label={`Mark ${name} as me`} onClick={async () => { await setMe(rec.id); toast(`${name} is marked as you`); }}>This is me</button>}
                </>
              )}
            </dd>
          </div>
          <div><dt>Birthday</dt><dd>{bday || <span className="muted">Not set</span>}</dd></div>
          <div>
            <dt>On my Calendar</dt>
            <dd>
              {!d.birthMonthDay ? <span className="muted">No birthday set</span>
                : d.status !== 'active' ? <span className="muted">Not shown (past member)</span>
                : (
                  <>
                    {d.birthdayOnCalendar === false ? 'Off' : 'On'}{' '}
                    <button type="button" className="btn fm-mini" aria-label={d.birthdayOnCalendar === false ? "Turn on birthday on my Calendar" : "Turn off birthday on my Calendar"} onClick={async () => { await setBirthdayOnCalendar(rec.id, d.birthdayOnCalendar === false); toast(d.birthdayOnCalendar === false ? 'Birthday is on your Calendar' : 'Birthday removed from your Calendar'); }}>
                      {d.birthdayOnCalendar === false ? 'Turn on' : 'Turn off'}
                    </button>
                  </>
                )}
            </dd>
          </div>
          <div><dt>Birth year</dt><dd>{d.birthYear ?? <span className="muted">Not set</span>}</dd></div>
          <div><dt>Display color</dt><dd>{d.color ? <MemberChip colorId={memberColorId(d.color)}>{colorName(d.color)}</MemberChip> : <MemberChip>No color</MemberChip>}</dd></div>
        </dl>
      </section>

      <ScheduleSection contactId={d.contactId} today={today} nameOfContact={nameOfContact} />
      <TodoSection contactId={d.contactId} today={today} nameOfContact={nameOfContact} otherContacts={otherContacts} />
      <ProjectsSection contactId={d.contactId} />
      <ImportantContactsSection memberId={rec.id} ownContactId={d.contactId} memberName={name} />
      <MemberDatesSection memberId={rec.id} />

      <section className="card" aria-labelledby="fm-contact">
        <div className="card-head"><h2 className="card-title" id="fm-contact">Linked contact</h2></div>
        {contact ? <p><strong>{contact.name}</strong><br /><span className="muted small">{contactDetail(contact)}</span></p> : <p className="muted">The contact was removed.</p>}
        <p className="muted small">The name comes from this contact. The link stays fixed so that tasks and events keep belonging to the same person.</p>
        {refs && (
          lines.length
            ? <p className="small">This contact is used on {lines.join(', ')}.</p>
            : <p className="muted small">No task or calendar event names this contact yet. Add them under “People” on a task or event.</p>
        )}
      </section>

      <section className="card" aria-labelledby="fm-notes">
        <div className="card-head"><h2 className="card-title" id="fm-notes">Private note</h2></div>
        {d.note ? <MaskedNote note={d.note} /> : <p className="muted">No note.</p>}
      </section>

      {editing && <MemberForm member={rec} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); toast('Saved'); }} />}
      {confirm && (
        <ConfirmDialog
          title={confirm === 'past' ? 'Mark as a past member?' : 'Mark as in the household?'}
          confirmLabel={confirm === 'past' ? 'Mark as past member' : 'Mark as in the household'}
          tone="primary"
          onCancel={() => setConfirm(null)}
          onConfirm={async () => {
            await setMemberStatus(rec.id, confirm === 'past' ? 'past' : 'active');
            setConfirm(null);
            toast(confirm === 'past' ? 'Marked as a past member' : 'Marked as in the household');
            if (confirm === 'past') navigate('/');
          }}
        >
          <p>{confirm === 'past'
            ? `${name} moves to “Past members”. Nothing is deleted: their contact, and every task and event that names them, stay as they are. You can bring them back at any time.`
            : `${name} moves back to “In the household”.`}</p>
        </ConfirmDialog>
      )}
    </div>
  );
}
