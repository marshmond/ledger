import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { addView, checkName, newViewId, parseViews, removeView, renameView, sameState, updateView, type FlowViewState, type SavedFlowView } from '../lib/flowViews';

/** Saved views for the flow diagram. Stored with your data (so they are in backups and sync to your other devices). */
export default function FlowViews({
  current,
  activeId,
  setActiveId,
  apply,
}: {
  current: FlowViewState;
  activeId: string | null;
  setActiveId: (id: string | null) => void;
  apply: (v: FlowViewState) => void;
}) {
  const stored = useLiveQuery(async () => parseViews((await db.settings.get('flowViews'))?.value), []);
  const views: SavedFlowView[] = stored ?? [];
  const active = views.find((v) => v.id === activeId);
  const dirty = !!active && !sameState(current, active);
  const [naming, setNaming] = useState<null | 'new' | 'rename'>(null);
  const [name, setName] = useState('');
  const [err, setErr] = useState('');

  // A view deleted on another device is no longer selected here. (Only checked when the stored list changes, so a view you have just
  // saved is not mistaken for a missing one before the list catches up.)
  const activeRef = useRef(activeId);
  activeRef.current = activeId;
  useEffect(() => { if (stored && activeRef.current && !stored.some((v) => v.id === activeRef.current)) setActiveId(null); }, [stored, setActiveId]);

  const save = (list: SavedFlowView[]) => db.settings.put({ key: 'flowViews', value: list });
  const open = (mode: 'new' | 'rename') => { setNaming(mode); setName(mode === 'rename' ? active?.name ?? '' : ''); setErr(''); };

  async function commitName() {
    const problem = checkName(views, name, naming === 'rename' ? active?.id : undefined);
    if (problem) return setErr(problem);
    if (naming === 'rename' && active) await save(renameView(views, active.id, name));
    else {
      const id = newViewId();
      await save(addView(views, name, current, id));
      setActiveId(id);
    }
    setNaming(null);
  }

  return (
    <div>
      <div className="row">
        <label className="row">Saved view
          <select value={active?.id ?? ''} onChange={(e) => {
            const v = views.find((x) => x.id === e.target.value);
            setActiveId(v?.id ?? null);
            if (v) apply(v);
          }}>
            <option value="">{views.length ? 'None (current settings)' : 'None saved yet'}</option>
            {views.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </label>
        {dirty && <span className="warn">changed</span>}
        {dirty && <button onClick={() => active && save(updateView(views, active.id, current))}>Update “{active!.name}”</button>}
        <button onClick={() => open('new')}>Save as new view…</button>
        {active && <button className="link" onClick={() => open('rename')}>rename</button>}
        {active && <button className="link" onClick={async () => { if (confirm(`Delete the view “${active.name}”?`)) { await save(removeView(views, active.id)); setActiveId(null); } }}>delete</button>}
      </div>
      {naming && (
        <form className="row" style={{ marginTop: 6 }} onSubmit={(e) => { e.preventDefault(); commitName(); }}>
          <label className="f">{naming === 'rename' ? 'New name' : 'Name for this view'}<input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoFocus /></label>
          <button className="primary" type="submit">Save</button>
          <button type="button" onClick={() => setNaming(null)}>Cancel</button>
          {err && <span className="error" role="alert">{err}</span>}
        </form>
      )}
      {!naming && <div className="muted" style={{ fontSize: '0.85rem', marginTop: 4 }}>A view remembers the income type, period, detail, and what you switched off. Custom dates are not part of a view. Categories and accounts you add later appear in your saved views.</div>}
    </div>
  );
}
