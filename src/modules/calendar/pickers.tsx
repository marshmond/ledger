import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db';
import type { RecordRef } from '../../core/entities';
import { allModules, recordSource } from '../../core/registry';
import { store } from '../../core/store';

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
        <input list="cal-tag-list" value={text} placeholder="Add a tag" onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void add(); } }} aria-label="Tag name" />
        <datalist id="cal-tag-list">{tags.filter((t) => !value.includes(t.id!)).map((t) => <option key={t.id} value={t.name} />)}</datalist>
        <button type="button" className="btn" onClick={() => void add()} disabled={!text.trim()}>Add</button>
      </div>
    </div>
  );
}

/** Chips for linked contacts, a list to pick from, and a box to create a new contact by name. */
export function ContactPicker({ value, onChange }: { value: number[]; onChange: (ids: number[]) => void }) {
  const contacts = useLiveQuery(() => store.shared.contacts.query(), []) ?? [];
  const [text, setText] = useState('');
  const addNew = async () => {
    const name = text.trim();
    if (!name) return;
    const found = contacts.find((c) => c.name.toLowerCase() === name.toLowerCase());
    const id = found?.id ?? (await store.shared.contacts.put({ name }));
    if (!value.includes(id)) onChange([...value, id]);
    setText('');
  };
  const left = contacts.filter((c) => !value.includes(c.id!));
  return (
    <div className="cal-pick">
      <div className="row">
        {value.map((id) => (
          <span key={id} className="chip">{contacts.find((c) => c.id === id)?.name ?? 'contact'}<button type="button" aria-label="Remove contact" onClick={() => onChange(value.filter((x) => x !== id))}>✕</button></span>
        ))}
      </div>
      <div className="row grow">
        <input list="cal-contact-list" value={text} placeholder={left.length ? 'Pick or type a name' : 'Type a name to add a contact'} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void addNew(); } }} aria-label="Contact name" />
        <datalist id="cal-contact-list">{left.map((c) => <option key={c.id} value={c.name} />)}</datalist>
        <button type="button" className="btn" onClick={() => void addNew()} disabled={!text.trim()}>Add</button>
      </div>
    </div>
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
