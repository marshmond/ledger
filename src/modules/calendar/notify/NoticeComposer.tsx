import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../../db';
import { validEmail } from '../../../core/contacts';
import Modal from '../../../shell/Modal';
import { todayISO } from '../../../lib/money';
import type { NoticeOffer } from './offers';
import { classifyContacts, MAX_PER_DAY, MAX_RECIPIENTS, pickRecipients } from './recipients';
import { confirmAndSend, loadRequests, prepare, type Prepared, type PreparedItem } from './send';
import { loadNoticeSettings, saveNoticeSettings } from './settings';
import { getTransport } from './transport';
import { buildMessage, PERSONAL_MAX, summaryOf } from './wording';
import { statusLabel, statusWords, zoneLabelFor } from './words';
import type { MessageOptions } from './types';

/**
 * CAL-N1: choose people, read exactly what each will receive, and send deliberately.
 * Opening this, changing anything in it, and Cancel write nothing and send nothing. The only button that records or sends is Send.
 */
export default function NoticeComposer({ offer, onClose }: { offer: NoticeOffer; onClose: () => void }) {
  const s = offer.subject;
  const contacts = useLiveQuery(() => db.contacts.toArray(), []);
  const history = useLiveQuery(() => loadRequests(), []);
  const saved = useLiveQuery(() => loadNoticeSettings(), []);
  const transport = getTransport();

  const [chosen, setChosen] = useState<number[]>([]); // nobody is chosen for you
  const [includeLocation, setIncludeLocation] = useState(false);
  const [includePeople, setIncludePeople] = useState(s.facts.people.length > 0);
  const [note, setNote] = useState('');
  const [name, setName] = useState('');
  const [reply, setReply] = useState('');
  const [typed, setTyped] = useState(false);
  const [previewId, setPreviewId] = useState<number | null>(null);
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [byContact, setByContact] = useState<Map<number, PreparedItem>>(new Map());
  const [phase, setPhase] = useState<'edit' | 'done'>('edit');
  const [sent, setSent] = useState<string[]>([]);
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (saved && !typed) { setName(saved.senderName); setReply(saved.replyTo); } }, [saved, typed]);

  const rows = useMemo(() => classifyContacts(contacts ?? [], offer.involved), [contacts, offer.involved]);
  const picked = useMemo(() => pickRecipients(rows, chosen), [rows, chosen]);
  const replyOk = !reply.trim() || validEmail(reply.trim());
  const options: MessageOptions = useMemo(() => ({
    includeLocation: includeLocation && !!s.facts.location.trim(), includePeople: includePeople && s.facts.people.length > 0, personalMessage: note,
    senderName: name.trim(), replyTo: replyOk ? reply.trim() : '', zoneLabel: zoneLabelFor(s.facts.startMs), today: todayISO(),
  }), [includeLocation, includePeople, note, name, reply, replyOk, s]);

  // The exact text per person (and what is already known about each), recomputed whenever anything it depends on changes.
  useEffect(() => {
    let live = true;
    void (async () => {
      const all = await prepare(s, rows.filter((r) => r.usable), options, history ?? []);
      const mine = await prepare(s, picked.picked, options, history ?? []);
      if (!live) return;
      setByContact(new Map(all.items.map((i) => [i.row.contactId, i])));
      setPrepared(mine);
    })();
    return () => { live = false; };
  }, [s, rows, picked.picked, options, history]);

  const already = (id: number) => byContact.get(id)?.status === 'already';
  const sendable = (prepared?.items ?? []).filter((i) => i.status !== 'already');
  const involvedRows = rows.filter((r) => r.involved);
  const others = rows.filter((r) => !r.involved && r.usable && !already(r.contactId) && !chosen.includes(r.contactId));
  const noEmailOthers = rows.filter((r) => !r.involved && !r.usable).length;
  const toggle = (id: number) => setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : c.length >= MAX_RECIPIENTS ? c : [...c, id]));
  const selectAllInvolved = () => setChosen((c) => [...new Set([...c, ...involvedRows.filter((r) => r.usable && !already(r.contactId)).map((r) => r.contactId)])].slice(0, MAX_RECIPIENTS));
  const toldRows = rows.filter((r) => r.usable && offer.told.includes(r.contactId) && !already(r.contactId));
  const selectTold = () => setChosen((c) => [...new Set([...c, ...toldRows.map((r) => r.contactId)])].slice(0, MAX_RECIPIENTS));

  const shown = prepared?.items.find((i) => i.row.contactId === previewId) ?? prepared?.items[0];
  const preview = shown ? { subject: shown.subject, text: shown.text } : buildMessage(s, options, '');

  const eventTitle = s.facts.title.trim() || '(untitled event)';
  const summary = summaryOf(s, todayISO());
  const whatLine = summary.includes(eventTitle) ? summary : `${eventTitle} · ${summary}`;
  const canSend = sendable.length > 0 && !!name.trim() && replyOk && !busy;
  const onSend = async () => {
    if (!prepared || !canSend) return;
    setBusy(true);
    setProblem('');
    try {
      await saveNoticeSettings({ senderName: name, replyTo: replyOk ? reply : '' });
      const r = await confirmAndSend({ subject: s, prepared, transport });
      if (r.kind === 'recorded') { setSent(sendable.map((i) => i.requestId)); setPhase('done'); }
      else if (r.kind === 'nothing-new') setProblem('Everyone you picked has already been emailed about this change, so nothing new was sent.');
      else if (r.kind === 'daily-limit') setProblem(`Ledger approves at most ${MAX_PER_DAY} messages a day. ${r.left} left in the last 24 hours.`);
      else setProblem(`You can email up to ${MAX_RECIPIENTS} people at once.`);
    } catch {
      setProblem('The message could not be recorded, so nothing was sent. Your event is not affected. Try again.');
    } finally { setBusy(false); }
  };

  const who = `${sendable.length} ${sendable.length === 1 ? 'person' : 'people'}`;
  const sendLabel = sendable.length === 0 ? 'Choose someone first' : transport ? `Send to ${who}` : `Approve for ${who}`;

  return (
    <Modal title="Email about this event" onClose={onClose} wide variant="sheet" locked={busy}>
      {phase === 'done' ? (
        <div className="cal-form cal-np-form">
          <div className={`banner ${transport ? '' : 'warn'}`}><div className="banner-text"><strong>{transport ? (transport.live ? 'Handed to the sender' : 'Test mode: nothing was really sent') : 'Approved, not sent'}</strong><br />
            {transport ? 'Here is where each message stands. Ledger can only say the mail service accepted it, never that it reached an inbox.' : 'Email sending is not connected yet, so nothing was sent. Your approval is saved with the exact text; it can be sent later from this event\'s Messages.'}</div></div>
          <ul className="cal-np-results" aria-label="Message status">
            {sent.map((id) => {
              const v = (history ?? []).find((x) => x.requestId === id);
              return v ? <li key={id}><strong>{v.recipient.name}</strong> <span className="badge">{statusLabel(v, !!transport)}</span><div className="muted small">{statusWords(v, !!transport)}</div></li> : null;
            })}
          </ul>
          <div className="row cal-actions"><button type="button" className="btn primary" onClick={onClose}>Done</button></div>
        </div>
      ) : (
        <div className="cal-form cal-np-form">
          <p className="cal-np-what"><strong>{whatLine}</strong></p>
          <p className="muted small">Nothing is sent until you press <strong>{transport ? 'Send' : 'Approve'}</strong>. Closing this does nothing.</p>
          {!transport && <div className="banner warn"><div className="banner-text"><strong>Email sending is not connected yet.</strong><br />You can choose people and review the message. Pressing Approve saves your approval; nothing is sent until sending is set up.</div></div>}
          {transport && !transport.live && <div className="banner"><div className="banner-text"><strong>Test mode.</strong> Nothing is really sent.</div></div>}

          <section className="cal-sec" aria-labelledby="np-who">
            <h4 className="cal-np-title" id="np-who">Who should know?</h4>
            <div className="row cal-np-quick">
              {involvedRows.some((r) => r.usable && !already(r.contactId)) && <button type="button" className="btn" onClick={selectAllInvolved}>Select all involved people with email</button>}
              {toldRows.length > 0 && <button type="button" className="btn" onClick={selectTold}>Select the people who were told it was cancelled</button>}
            </div>
            {involvedRows.length === 0 && <p className="muted small">No one is listed as involved in this event. Pick anyone below.</p>}
            <ul className="cal-np-list" aria-label="People involved in this event">
              {involvedRows.map((r) => {
                const told = byContact.get(r.contactId);
                const off = !r.usable || already(r.contactId);
                return (
                  <li key={r.contactId}>
                    <label className={`row cal-check${off ? ' cal-np-off' : ''}`}>
                      <input type="checkbox" checked={chosen.includes(r.contactId)} disabled={off || (!chosen.includes(r.contactId) && chosen.length >= MAX_RECIPIENTS)} onChange={() => toggle(r.contactId)} />
                      <span>{r.name}</span>
                      <span className="muted small">{!r.usable ? r.reason : already(r.contactId) && told?.existing ? `Already emailed about this (${statusLabel(told.existing, !!transport)})` : r.email}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
            <label className="f">Add someone else
              <select value="" onChange={(e) => { if (e.target.value) toggle(Number(e.target.value)); }} aria-label="Add someone else" disabled={others.length === 0 || chosen.length >= MAX_RECIPIENTS}>
                <option value="">{others.length ? 'Choose a contact…' : 'No other contacts with an email'}</option>
                {others.map((r) => <option key={r.contactId} value={r.contactId}>{r.name} ({r.email})</option>)}
              </select>
            </label>
            {noEmailOthers > 0 && <p className="muted small">{noEmailOthers} other contact{noEmailOthers === 1 ? ' has' : 's have'} no usable email address and cannot be chosen.</p>}
            <div className="cal-np-to" aria-live="polite">
              <span className="muted small">{chosen.length ? `Emailing ${picked.picked.length} ${picked.picked.length === 1 ? 'person' : 'people'} (up to ${MAX_RECIPIENTS}):` : 'No one is chosen yet.'}</span>
              <div className="row">
                {picked.picked.map((r) => <span key={r.contactId} className="chip">{r.name}<button type="button" aria-label={`Remove ${r.name}`} onClick={() => toggle(r.contactId)}>✕</button></span>)}
              </div>
            </div>
          </section>

          <section className="cal-sec" aria-labelledby="np-msg">
            <h4 className="cal-np-title" id="np-msg">What to include</h4>
            <label className="f"><span>A short note from you <span className="muted">(optional)</span></span>
              <textarea rows={2} maxLength={PERSONAL_MAX} value={note} onChange={(e) => setNote(e.target.value)} placeholder="For example: Bring water bottles." />
            </label>
            <label className="row cal-check"><input type="checkbox" checked={includeLocation && !!s.facts.location.trim()} disabled={!s.facts.location.trim()} onChange={(e) => setIncludeLocation(e.target.checked)} /> Include the place{s.facts.location.trim() ? '' : ' (this event has none)'}</label>
            {s.facts.people.length > 0 && <label className="row cal-check"><input type="checkbox" checked={includePeople} onChange={(e) => setIncludePeople(e.target.checked)} /> Mention who it involves ({s.facts.people.join(', ')})</label>}
            <p className="muted small">Your private notes, tags, project, priority and any amounts are never included.</p>
          </section>

          <section className="cal-sec" aria-labelledby="np-from">
            <h4 className="cal-np-title" id="np-from">Sent as</h4>
            <div className="cal-when">
              <label className="f">Your name (shown to the people you email)
                <input value={name} onChange={(e) => { setTyped(true); setName(e.target.value); }} maxLength={80} autoComplete="name" />
              </label>
              <label className="f"><span>Reply address <span className="muted">(optional)</span></span>
                <input type="email" value={reply} onChange={(e) => { setTyped(true); setReply(e.target.value); }} autoComplete="email" aria-invalid={!replyOk} />
              </label>
            </div>
            {!replyOk && <p className="cal-error" role="alert">That reply address does not look right.</p>}
            {!name.trim() && <p className="muted small">Enter your name so people know who the message is from.</p>}
          </section>

          <section className="cal-sec" aria-labelledby="np-prev">
            <h4 className="cal-np-title" id="np-prev">Preview</h4>
            {(prepared?.items.length ?? 0) > 1 && (
              <label className="f">Message for
                <select value={shown?.row.contactId ?? ''} onChange={(e) => setPreviewId(Number(e.target.value))} aria-label="Preview the message for">
                  {prepared!.items.map((i) => <option key={i.row.contactId} value={i.row.contactId}>{i.row.name}</option>)}
                </select>
              </label>
            )}
            <div className="cal-np-preview" role="region" aria-label="Message preview">
              <p className="cal-np-subject"><span className="muted">Subject:</span> {preview.subject}</p>
              <pre className="cal-np-body">{preview.text}</pre>
            </div>
            <p className="muted small">{shown ? 'This is exactly what will be sent.' : 'Choose a person to see their copy.'} Each person gets their own message; no one sees anyone else&apos;s address.</p>
          </section>

          {problem && <p className="cal-error" role="alert">{problem}</p>}
          <div className="row spread cal-actions">
            <span className="row">
              <button type="button" className="btn primary" disabled={!canSend} onClick={() => void onSend()}>{busy ? 'Working…' : sendLabel}</button>
              <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button>
            </span>
          </div>
        </div>
      )}
    </Modal>
  );
}
