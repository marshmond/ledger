import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import type { Contact, RecordRef } from '../core/entities';
import { addPickedContact, contactBrief, contactChoiceLabel, sharedNameIds } from '../core/contactChoice';
import { allModules, recordSource } from '../core/registry';
import { store } from '../core/store';

/** Chips for the shared tags attached to something, plus a box to add an existing or brand-new tag. */
export function TagPicker({ value, onChange }: { value: number[]; onChange: (ids: number[]) => void }) {
  const tags = useLiveQuery(() => store.shared.tags.query(), []) ?? [];
  const [text, setText] = useState('');
  const add = async () => {
    const name = text.trim();
    if (!name) return;
    const found = tags.find((t) => t.name.toLowerCase() === name.toLowerCase());
    const id = found?.id ?? (await store.shared.tags.put({ name }));
    if (!value.includes(id)) onChange([...value, id]);
    setText('');
  };
  return (
    <div className="cal-pick">
      <div className="row">
        {value.map((id) => (
          <span key={id} className="chip">{tags.find((t) => t.id === id)?.name ?? 'tag'}<button type="button" aria-label="Remove tag" onClick={() => onChange(value.filter((x) => x !== id))}>✕</button></span>
        ))}
      </div>
      <div className="row grow">
        {/* A plain menu for existing tags: the browser's suggestion pop-up (datalist) can open far from the box. */}
        {tags.some((t) => !value.includes(t.id!)) && (
          <select value="" onChange={(e) => { const id = Number(e.target.value); if (e.target.value && !value.includes(id)) onChange([...value, id]); }} aria-label="Pick an existing tag">
            <option value="">Pick a tag…</option>
            {tags.filter((t) => !value.includes(t.id!)).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        )}
        <input value={text} placeholder="or type a new tag" onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void add(); } }} aria-label="Tag name" />
        <button type="button" className="btn" onClick={() => void add()} disabled={!text.trim()}>Add</button>
      </div>
    </div>
  );
}

/**
 * Chips for the Contacts linked to something, a menu of existing Contacts (chosen by id), and a box to add a NEW Contact on purpose (C2).
 * Used by the Calendar event editor and the Task editor. It never reuses a Contact because a typed name matches: a name that is already taken is shown
 * with what tells the entries apart, and a different person with the same name needs an explicit tick. Choosing and removing change only the list of ids.
 */
export interface PendingSameName { name: string; matches: Contact[] }

/** The look of the picker for a given state. Pure (no database), so the states can be checked without a browser. */
export function ContactPickerView({ contacts, value, text, pending, different, error, busy, onText, onPick, onRemove, onAdd, onUse, onDifferent, onCancel }: {
  contacts: Contact[]; value: number[]; text: string; pending: PendingSameName | null; different: boolean; error: string; busy: boolean;
  onText: (t: string) => void; onPick: (id: number) => void; onRemove: (id: number) => void; onAdd: () => void; onUse: (id: number) => void;
  onDifferent: (v: boolean) => void; onCancel: () => void;
}) {
  const shared = sharedNameIds(contacts);
  const left = contacts.filter((c) => !value.includes(c.id!));
  return (
    <div className="cal-pick">
      <div className="row">
        {value.map((id) => {
          const c = contacts.find((x) => x.id === id);
          return (
            <span key={id} className="chip">
              {c ? contactChoiceLabel(c, contacts, shared) : 'A contact that no longer exists'}
              <button type="button" aria-label={`Remove ${c ? c.name : 'contact'}`} onClick={() => onRemove(id)}>✕</button>
            </span>
          );
        })}
      </div>
      <div className="row grow">
        {/* A plain menu for existing people: the browser's suggestion pop-up (datalist) can open far from the box. Each choice is a stable id. */}
        {left.length > 0 && (
          <select value="" onChange={(e) => { const id = Number(e.target.value); if (e.target.value && Number.isFinite(id)) onPick(id); }} aria-label="Pick an existing person">
            <option value="">Pick a person…</option>
            {left.map((c) => <option key={c.id} value={c.id}>{contactChoiceLabel(c, contacts, shared)}</option>)}
          </select>
        )}
        <input value={text} placeholder={left.length ? 'or type a new name' : 'Type a name to add a contact'} onChange={(e) => onText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onAdd(); } }} aria-label="Name of a new contact" />
        <button type="button" className="btn" onClick={onAdd} disabled={!text.trim() || busy}>Add new contact</button>
      </div>
      {error && <p className="cal-error" role="alert">{error}</p>}
      {pending && (
        <div className="cal-pick-same" role="group" aria-label="A contact with this name already exists">
          <p><strong>{pending.matches.length === 1 ? 'A contact named' : `${pending.matches.length} contacts named`} “{pending.name}” already {pending.matches.length === 1 ? 'exists' : 'exist'}.</strong> Use the right one, or confirm this is someone different.</p>
          <ul className="plain">
            {pending.matches.map((m) => (
              <li key={m.id} className="row spread">
                <span>{m.name} <span className="muted small">{contactBrief(m)}</span></span>
                {value.includes(m.id!) ? <span className="muted small">Already added</span> : <button type="button" className="btn" aria-label={`Use ${m.name}, ${contactBrief(m)}`} onClick={() => onUse(m.id!)}>Use this one</button>}
              </li>
            ))}
          </ul>
          <label className="as-check"><input type="checkbox" checked={different} onChange={(e) => onDifferent(e.target.checked)} /> <span>This is a different person or organization with the same name</span></label>
          <div className="row">
            <button type="button" className="btn primary" onClick={onAdd} disabled={!different || busy}>Add as a new contact</button>
            <button type="button" className="btn" onClick={onCancel}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

export function ContactPicker({ value, onChange }: { value: number[]; onChange: (ids: number[]) => void }) {
  const contacts = useLiveQuery(() => store.shared.contacts.query(), []) ?? [];
  const [text, setText] = useState('');
  const [pending, setPending] = useState<PendingSameName | null>(null);
  const [different, setDifferent] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const add = (id: number) => { if (!value.includes(id)) onChange([...value, id]); };
  const reset = () => { setText(''); setPending(null); setDifferent(false); setError(''); };
  const addNew = async () => {
    const name = pending?.name ?? text.trim();
    if (!name || busy) return;
    setBusy(true);
    setError('');
    try {
      const r = await addPickedContact(db, name, !!pending && different);
      if (r.status === 'created') { add(r.id); reset(); }
      else { setPending({ name, matches: r.matches }); setDifferent(false); }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That contact could not be added.');
    } finally { setBusy(false); }
  };
  return (
    <ContactPickerView
      contacts={contacts} value={value} text={text} pending={pending} different={different} error={error} busy={busy}
      onText={(t) => { setText(t); if (pending) { setPending(null); setDifferent(false); } setError(''); }}
      onPick={add} onRemove={(id) => onChange(value.filter((x) => x !== id))} onAdd={() => void addNew()}
      onUse={(id) => { add(id); reset(); }} onDifferent={setDifferent} onCancel={reset}
    />
  );
}

const refKey = (r: RecordRef) => `${r.module}|${r.id}`;

/** Shows what a linked record is called now (names come from the module that owns it) and where it lives. */
export function RefLabel({ r }: { r: RecordRef }) {
  const [info, setInfo] = useState<{ label: string; kind: string; path: string } | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    const src = recordSource(r.module);
    (src ? src.describe(r.id) : Promise.resolve(null)).then((x) => live && setInfo(x)).catch(() => live && setInfo(null));
    return () => { live = false; };
  }, [r.module, r.id]);
  if (info === undefined) return <span className="muted">…</span>;
  if (!info) return <span className="muted">(no longer exists)</span>;
  return <a href={`#${info.path}`}>{info.label}</a>;
}

/** Linked records: the ones already linked (with a remove button) and a small finder to link more. Changes are applied when the form is saved. */
export function RecordLinks({ existing, added, removed, onAdd, onRemove, onUndoRemove }: {
  existing: RecordRef[]; added: RecordRef[]; removed: Set<string>;
  onAdd: (r: RecordRef) => void; onRemove: (r: RecordRef) => void; onUndoRemove: (r: RecordRef) => void;
}) {
  const sources = allModules().filter((m) => m.contributes?.records);
  const [mod, setMod] = useState(sources[0]?.id ?? '');
  const [q, setQ] = useState('');
  const results = useLiveQuery(async () => (mod ? await recordSource(mod)?.search(q) : []) ?? [], [mod, q, db]) ?? [];
  const shown = [...existing.filter((r) => !removed.has(refKey(r))), ...added];
  const have = new Set(shown.map(refKey));
  return (
    <div className="cal-pick">
      {shown.length === 0 && <span className="muted">Nothing linked.</span>}
      <ul className="plain cal-links">
        {shown.map((r) => (
          <li key={refKey(r)} className="row spread">
            <RefLabel r={r} />
            <button type="button" className="link" onClick={() => onRemove(r)}>Remove</button>
          </li>
        ))}
        {existing.filter((r) => removed.has(refKey(r))).map((r) => (
          <li key={refKey(r)} className="row spread muted"><span>Will be unlinked</span><button type="button" className="link" onClick={() => onUndoRemove(r)}>Keep</button></li>
        ))}
      </ul>
      {sources.length > 0 && (
        <details>
          <summary>Link a record…</summary>
          <div className="row grow">
            {sources.length > 1 && <select value={mod} onChange={(e) => setMod(e.target.value)} aria-label="Module">{sources.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>}
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${sources.find((m) => m.id === mod)?.name ?? ''} records`} aria-label="Search records" />
          </div>
          <ul className="plain cal-results">
            {results.filter((r) => !have.has(refKey({ module: mod, id: r.id }))).map((r) => (
              <li key={String(r.id)}><button type="button" className="link" onClick={() => onAdd({ module: mod, id: r.id })}>{r.label} <span className="muted">· {r.kind}</span></button></li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

export { refKey };
