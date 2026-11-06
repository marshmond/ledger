import { useState } from 'react';
import { normalizeRule, type Recurrence } from '../../core/recurrence';
import Modal from '../../shell/Modal';
import { todayISO } from '../../lib/money';
import RepeatFields from '../../ui/RepeatFields';
import { useToast } from '../../ui/Toast';
import { createTask, removeTasks } from '../tasks/data';
import { blankTask } from '../tasks/model';
import { assetRef } from './data';
import { MAINTENANCE_SUGGESTIONS, repeatText, SUGGESTION_NOTE, type MaintenanceSuggestion } from './maintenance';
import type { AssetRecord } from './model';

/**
 * Makes an ordinary Task linked to the asset (Tasks owns its dates, repeats and reminders). Nothing is created until Add is pressed.
 * Suggestions only fill in the boxes; they are generic starting points and every box can be changed.
 */
export default function AddMaintenance({ asset, onClose }: { asset: AssetRecord; onClose: () => void }) {
  const toast = useToast();
  const today = todayISO();
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const [rule, setRule] = useState<Recurrence | null>(null);
  const [mode, setMode] = useState<'fixed' | 'after'>('fixed');
  const [notes, setNotes] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const pick = (s: MaintenanceSuggestion) => { setTitle(`${asset.data.name}: ${s.title}`); setRule(s.rule); setMode(s.mode); setPicked(s.id); setError(''); };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!title.trim()) return setError('Give it a title.');
    if (!due) return setError('Pick when it is first due, so it shows up in Tasks and the Calendar.');
    setBusy(true);
    try {
      const id = await createTask(blankTask({ title: title.trim(), notes: notes.trim(), dueDate: due, repeat: rule ? { mode, rule: normalizeRule(rule) ?? rule } : null }), [assetRef(asset.id)]);
      toast(`Added to Tasks: ${title.trim()}`, async () => { await removeTasks([id]); });
      onClose();
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not add that.'); setBusy(false); }
  }

  return (
    <Modal title="Add maintenance" onClose={onClose} wide>
      <form className="as-form" onSubmit={submit}>
        <p className="muted small">This adds a normal task linked to <strong>{asset.data.name}</strong>. It shows in Tasks and on the Calendar, and repeats the way any repeating task does.</p>
        <details className="as-sec" open>
          <summary>Start from a suggestion (optional)</summary>
          <p className="muted small" role="note">{SUGGESTION_NOTE}</p>
          <div className="as-suggest" role="group" aria-label="Suggestions">
            {MAINTENANCE_SUGGESTIONS.map((s) => (
              <button key={s.id} type="button" className={`btn${picked === s.id ? ' primary' : ''}`} aria-pressed={picked === s.id} onClick={() => pick(s)}>
                {s.title}<span className="muted small"> · {s.hint}</span>
              </button>
            ))}
          </div>
        </details>
        <label className="f">Task title
          <input value={title} onChange={(e) => { setTitle(e.target.value); setPicked(null); }} placeholder={`${asset.data.name}: replace filter`} maxLength={200} autoFocus />
        </label>
        <label className="f">First due
          <input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        </label>
        <RepeatFields rule={rule} onChange={setRule} start={due || today} mode={mode} onMode={setMode} />
        {rule && <p className="muted small">{repeatText({ mode, rule }, due || today)}.</p>}
        <label className="f">Notes <span className="muted">(optional)</span>
          <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Filter size, where the part is kept" />
        </label>
        {error && <div className="error" role="alert">{error}</div>}
        <div className="row as-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary" disabled={busy}>Add maintenance</button>
        </div>
      </form>
    </Modal>
  );
}
