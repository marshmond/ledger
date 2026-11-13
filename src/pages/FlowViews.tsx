import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { addView, checkName, newViewId, parseViews, renameView, sameState, updateView, type FlowViewState, type SavedFlowView } from '../lib/flowViews';
import { removeStoredFlowView } from '../lib/savedRemoval';
import ConfirmDialog from '../shell/ConfirmDialog';

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
  // D20.1A: the view whose "delete" was pressed, by id. Nothing is changed until the dialog's own Delete view button is pressed.
  const [askDelete, setAskDelete] = useState<string | null>(null);
  const target = askDelete === null ? undefined : views.find((v) => v.id === askDelete);

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
        {active && <button className="link" onClick={() => setAskDelete(active.id)}>delete</button>}
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
      {target && (
        <ConfirmDialog
          title="Delete saved view?"
          confirmLabel="Delete view"
          busyLabel="Deleting…"
          onCancel={() => setAskDelete(null)}
          onConfirm={async () => {
            // The list is read again now and only this id is taken out (see lib/savedRemoval.ts). If this view was the one showing, nothing is selected afterwards, as before.
            await removeStoredFlowView(db, target.id);
            if (activeRef.current === target.id) setActiveId(null);
            setAskDelete(null);
          }}
        >
          <p><strong>{target.name}</strong></p>
          <p>This removes the saved view. The flow diagram, your transactions and your other saved views are not changed, and the diagram keeps its current settings. If you sync your devices, the view is removed from them too.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}
