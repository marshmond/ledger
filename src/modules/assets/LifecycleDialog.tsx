import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import Modal from '../../shell/Modal';
import { todayISO } from '../../lib/money';
import { useToast } from '../../ui/Toast';
import { dayLabel } from '../../core/time';
import { loadAssets, publicLabel, setAssetStatus } from './data';
import { applyRetirement, BULK_STATUSES, describeRetirement, planRetirement, replacementDraft, RETIRE_STATUSES, TASK_ACTION_LABEL, type RetirementPlan, type RetireRequest, type RetireStatus, type TaskAction } from './lifecycle';
import { ASSET_TYPES, STATUS_LABEL, TYPE_LABEL, type AssetRecord, type AssetStatus, type AssetType } from './model';

type Which = 'existing' | 'new' | 'none';

/**
 * One dialog for "Status…" and "Replace…": how an asset left (or came back to) everyday use, what replaced it, whether the things inside it
 * go too, and what happens to its open tasks. Nothing changes until the owner presses Confirm on the review step.
 * Defaults are the do-nothing ones: only this asset, every task kept linked.
 */
export default function LifecycleDialog({ asset, replace = false, onClose }: { asset: AssetRecord; replace?: boolean; onClose: () => void }) {
  const toast = useToast();
  const all = useLiveQuery(() => loadAssets(), []) ?? [];
  const [plan, setPlan] = useState<RetirementPlan | null>(null);
  const [status, setStatus] = useState<AssetStatus>(replace ? 'replaced' : asset.data.status);
  const [date, setDate] = useState(asset.data.statusDate ?? todayISO());
  const [note, setNote] = useState(asset.data.statusNote);
  const [which, setWhich] = useState<Which>(replace ? 'new' : asset.data.replacedById !== null ? 'existing' : 'none');
  const [existing, setExisting] = useState<number | null>(asset.data.replacedById);
  const draft = useMemo(() => replacementDraft(asset.data), [asset.data]);
  const [newName, setNewName] = useState(draft.name);
  const [newType, setNewType] = useState<AssetType>(draft.type);
  const [newParent, setNewParent] = useState<number | null>(draft.parentId);
  const [newInstalled, setNewInstalled] = useState('');
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [actions, setActions] = useState<Record<number, TaskAction>>({});
  const [review, setReview] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { void planRetirement(asset.id).then(setPlan).catch((e) => setError(e instanceof Error ? e.message : 'Could not read the asset.')); }, [asset.id]);

  const out = status !== 'active';
  const hasReplacement = status === 'replaced' && ((which === 'existing' && existing !== null) || (which === 'new' && newName.trim() !== ''));
  const bulk = BULK_STATUSES.includes(status);
  const taskStatus = status === 'sold' || status === 'disposed' || status === 'replaced';
  const eligible = plan?.descendants.filter((x) => !x.alreadyOut) ?? [];
  const scope = new Set([asset.id, ...(bulk ? [...picked] : [])]);

  const request = (): RetireRequest => ({
    assetId: asset.id, status: status as RetireStatus, statusDate: date || null, statusNote: note,
    replacement: status !== 'replaced' || which === 'none' ? { kind: 'none' }
      : which === 'existing' ? { kind: 'existing', id: existing as number }
        : { kind: 'new', data: { ...draft, name: newName, type: newType, parentId: newParent, installDate: newInstalled || null } },
    descendantIds: bulk ? [...picked] : [],
    taskActions: taskStatus ? Object.fromEntries(Object.entries(actions).filter(([id, a]) => a !== 'keep' && scope.has(owner(Number(id))))) : {},
  });
  // Which asset (the one being retired, or something inside it) a listed task is attached to.
  function owner(taskId: number): number {
    for (const [aid, ts] of Object.entries(plan?.openTasks ?? {})) if (ts.some((t) => t.id === taskId)) return Number(aid);
    return -1;
  }

  const replacementName = which === 'new' ? newName.trim() : existing !== null ? publicLabel(all, existing) : '';
  const lines = review && plan ? describeRetirement(plan, request(), replacementName) : [];

  function goReview(e: React.FormEvent) {
    e.preventDefault();
    if (status === 'replaced' && replace && !hasReplacement) return setError(which === 'new' ? 'Give the new asset a name.' : 'Pick the asset that replaced it.');
    if (status === 'replaced' && which === 'existing' && existing === null) return setError('Pick the asset that replaced it, or choose "Not recorded".');
    if (status === 'replaced' && which === 'new' && !newName.trim()) return setError('Give the new asset a name.');
    setError('');
    setReview(true);
  }

  async function confirm() {
    if (busy) return;
    setBusy(true);
    try {
      if (!out) {
        await setAssetStatus(asset.id, { status: 'active', statusDate: null, statusNote: '', replacedById: null });
        toast('Back in use');
      } else {
        const r = await applyRetirement(request());
        const extra = [r.newAssetId ? 'new asset created' : '', r.retired.length > 1 ? `${r.retired.length} assets` : '', r.moved ? `${r.moved} task${r.moved === 1 ? '' : 's'} moved` : '', r.stopped ? `${r.stopped} stopped repeating` : '', r.deleted ? `${r.deleted} deleted` : ''].filter(Boolean);
        toast(`Marked as ${STATUS_LABEL[status].toLowerCase()}${extra.length ? ` (${extra.join(', ')})` : ''}`);
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save. Nothing was changed.');
      setReview(false);
      setBusy(false);
      void planRetirement(asset.id).then(setPlan).catch(() => undefined);
    }
  }

  const togglePick = (id: number) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const taskRows = plan ? [...scope].flatMap((id) => (plan.openTasks[id] ?? []).map((t) => ({ t, id }))).filter((x, i, a) => a.findIndex((y) => y.t.id === x.t.id) === i) : [];
  const nameOf = (id: number) => (id === asset.id ? asset.data.name : plan?.descendants.find((x) => x.asset.id === id)?.asset.data.name ?? '');

  return (
    <Modal title={replace ? `Replace ${asset.data.name}` : `Status of ${asset.data.name}`} onClose={onClose} wide>
      {review ? (
        <div className="as-form">
          <h3 className="as-review-h">Review before confirming</h3>
          <ul className="as-reasons" aria-label="What will change">{lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
          {error && <div className="error" role="alert">{error}</div>}
          <div className="row as-actions">
            <button type="button" className="btn" onClick={() => setReview(false)} disabled={busy}>Back</button>
            <button type="button" className="btn primary" onClick={() => void confirm()} disabled={busy}>Confirm</button>
          </div>
        </div>
      ) : (
        <form className="as-form" onSubmit={goReview}>
          {!replace && (
            <label className="f">Status
              <select value={status} onChange={(e) => setStatus(e.target.value as AssetStatus)}>
                <option value="active">{STATUS_LABEL.active}</option>
                {RETIRE_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
              </select>
            </label>
          )}
          {out && (
            <>
              <label className="f">{status === 'stored' ? 'Since' : 'On'}<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
              <label className="f">Note (optional)<input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder={status === 'sold' ? 'Who bought it' : ''} /></label>
            </>
          )}

          {status === 'replaced' && (
            <fieldset className="as-sec as-fs">
              <legend>What replaced it</legend>
              {!replace && <label className="as-check"><input type="radio" name="rep" checked={which === 'none'} onChange={() => setWhich('none')} /> Not recorded</label>}
              <label className="as-check"><input type="radio" name="rep" checked={which === 'existing'} onChange={() => setWhich('existing')} /> An asset I already have</label>
              {which === 'existing' && (
                <label className="f">Replacement
                  <select value={existing ?? ''} onChange={(e) => setExisting(e.target.value ? Number(e.target.value) : null)}>
                    <option value="">Pick one</option>
                    {all.filter((a) => a.id !== asset.id && !a.data.archived).map((a) => <option key={a.id} value={a.id}>{publicLabel(all, a.id)}</option>)}
                  </select>
                </label>
              )}
              <label className="as-check"><input type="radio" name="rep" checked={which === 'new'} onChange={() => setWhich('new')} /> A new asset</label>
              {which === 'new' && (
                <div className="as-sub">
                  <p className="muted small">The new asset starts with its own history. Only the name, type and place are filled in from <strong>{asset.data.name}</strong>. Serial numbers, plates, warranty, price and history are never copied; add the new one&apos;s details from its own page.</p>
                  <label className="f">Name<input value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={120} /></label>
                  <div className="as-two">
                    <label className="f">Type
                      <select value={newType} onChange={(e) => setNewType(e.target.value as AssetType)}>{ASSET_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}</select>
                    </label>
                    <label className="f">Installed (optional)<input type="date" value={newInstalled} onChange={(e) => setNewInstalled(e.target.value)} /></label>
                  </div>
                  {newType !== 'property' && (
                    <label className="f">Where
                      <select value={newParent ?? ''} onChange={(e) => setNewParent(e.target.value ? Number(e.target.value) : null)}>
                        <option value="">Top level</option>
                        {all.filter((a) => !a.data.archived && a.id !== asset.id && !plan?.descendants.some((x) => x.asset.id === a.id)).map((a) => <option key={a.id} value={a.id}>{publicLabel(all, a.id)}</option>)}
                      </select>
                    </label>
                  )}
                </div>
              )}
            </fieldset>
          )}

          {out && bulk && plan && plan.descendants.length > 0 && (
            <fieldset className="as-sec as-fs">
              <legend>Things inside it ({plan.descendants.length})</legend>
              <p className="muted small">By default only <strong>{asset.data.name}</strong> changes. Tick anything inside it that should be marked {STATUS_LABEL[status].toLowerCase()} too.</p>
              {eligible.length > 1 && (
                <button type="button" className="link" onClick={() => setPicked(picked.size === eligible.length ? new Set() : new Set(eligible.map((x) => x.asset.id)))}>{picked.size === eligible.length ? 'Untick all' : 'Tick all'}</button>
              )}
              <ul className="plain as-items">
                {plan.descendants.map((x) => (
                  <li key={x.asset.id} style={{ paddingLeft: `${Math.min(x.depth - 1, 4) * 16}px` }}>
                    <label className="as-check">
                      <input type="checkbox" disabled={x.alreadyOut} checked={picked.has(x.asset.id)} onChange={() => togglePick(x.asset.id)} />
                      {x.asset.data.name} <span className="muted small">· {TYPE_LABEL[x.asset.data.type]} · {STATUS_LABEL[x.asset.data.status]}{x.asset.data.archived ? ' · Archived' : ''}{x.alreadyOut ? ' (already out of use, left alone)' : ''}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
          )}
          {out && status === 'replaced' && plan && plan.descendants.length > 0 && (
            <p className="muted small">The {plan.descendants.length} {plan.descendants.length === 1 ? 'item' : 'items'} inside it stay as they are. Mark them separately if they went too.</p>
          )}

          {out && taskStatus && plan && taskRows.length > 0 && (
            <fieldset className="as-sec as-fs">
              <legend>Open tasks ({taskRows.length})</legend>
              <p className="muted small">Nothing happens to a task unless you change its choice. Completed tasks and service history stay with the old asset either way.</p>
              <ul className="plain as-items">
                {taskRows.map(({ t, id }) => {
                  const cur = actions[t.id] ?? 'keep';
                  const canMove = hasReplacement && id === asset.id;
                  return (
                    <li key={t.id} className="as-taskrow">
                      <span><strong>{t.data.title}</strong> <span className="muted small">· {id === asset.id ? 'this asset' : nameOf(id)} · {t.data.dueDate ? `due ${dayLabel(t.data.dueDate, { year: true })}` : 'no due date'}{t.data.repeat ? ' · repeats' : ''}</span></span>
                      <select aria-label={`What to do with ${t.data.title}`} value={cur} onChange={(e) => setActions((a) => ({ ...a, [t.id]: e.target.value as TaskAction }))}>
                        <option value="keep">{TASK_ACTION_LABEL.keep}</option>
                        <option value="move" disabled={!canMove}>{TASK_ACTION_LABEL.move}{canMove ? '' : id === asset.id ? ' (needs a replacement)' : ' (not available)'}</option>
                        {t.data.repeat && <option value="stop">{TASK_ACTION_LABEL.stop}</option>}
                        <option value="delete">{TASK_ACTION_LABEL.delete}</option>
                      </select>
                      {cur === 'delete' && plan.sharedWith[t.id]?.length ? <p className="as-warn small" role="alert">This task is also linked to {plan.sharedWith[t.id].join(', ')}. Deleting it removes it for every one of them, not only for {asset.data.name}. Choose Keep linked or Move instead if the others still need it.</p> : null}
                    </li>
                  );
                })}
              </ul>
            </fieldset>
          )}

          <p className="muted small">{out ? 'Nothing is saved until you confirm on the next step. You can set it back to "In use" at any time; that does not undo changes made to tasks.' : 'This puts it back in everyday use. Tasks and the things inside it are not changed.'}</p>
          {error && <div className="error" role="alert">{error}</div>}
          <div className="row as-actions">
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn primary" disabled={!plan}>Review</button>
          </div>
        </form>
      )}
    </Modal>
  );
}
