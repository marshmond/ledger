import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import Modal from '../../shell/Modal';
import RepeatFields from '../../ui/RepeatFields';
import { useToast } from '../../ui/Toast';
import { store } from '../../core/store';
import type { Recurrence } from '../../core/recurrence';
import { dayOfWeek } from '../../lib/dates';
import { formatCents, parseAmountToCents, todayISO } from '../../lib/money';
import { loadAssets, publicLabel } from '../assets/data';
import { applyUndo } from './changes';
import { createArrangement, updateArrangement, type ProviderInput } from './data';
import {
  BASIS_LABEL, blankArrangement, EXPECTED_BASES, notesWarning, withExplicitWeekday, type ArrangementRecord, type DocRef, type ExpectedBasis,
} from './model';

const NEW = '__new';

/**
 * Add or edit an arrangement. Only the provider and what they do are needed; everything else is under "More details". When editing, the
 * schedule, status and provider are changed by their own buttons on the arrangement page (so each shows a preview first).
 */
export default function ArrangementForm({ arrangement, assetIds: startAssets = [], onClose, onSaved }: { arrangement?: ArrangementRecord; assetIds?: number[]; onClose: () => void; onSaved?: (id: number) => void }) {
  const toast = useToast();
  const editing = !!arrangement;
  const d = arrangement?.data ?? blankArrangement();
  const contacts = useLiveQuery(() => store.shared.contacts.query(), []) ?? [];
  const assets = useLiveQuery(() => loadAssets(), []) ?? [];
  const today = todayISO();

  const [title, setTitle] = useState(d.title);
  const [choice, setChoice] = useState<string>(d.providerContactId !== null ? String(d.providerContactId) : '');
  const [newName, setNewName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [startDate, setStartDate] = useState(d.startDate ?? '');
  const [rule, setRule] = useState<Recurrence | null>(null);
  const [mode, setMode] = useState<'fixed' | 'after'>('fixed');
  const [first, setFirst] = useState(today);
  const [time, setTime] = useState('');
  const [makeTask, setMakeTask] = useState(true);
  const [assetIds, setAssetIds] = useState<number[]>(startAssets);
  const [cost, setCost] = useState(d.expected ? (d.expected.cents / 100).toFixed(2) : '');
  const [basis, setBasis] = useState<ExpectedBasis>(d.expected?.basis ?? 'perVisit');
  const [refs, setRefs] = useState<DocRef[]>(d.refs);
  const [notes, setNotes] = useState(d.notes);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const hasProvider = d.providerContactId !== null;
  const providerName = hasProvider ? contacts.find((c) => c.id === d.providerContactId)?.name ?? d.providerNameSnapshot : '';
  const typed = newName.trim().toLowerCase();
  const sameAsExisting = !!typed && contacts.some((c) => c.name.trim().toLowerCase() === typed);
  const warn = notesWarning(notes);

  const onFirst = (v: string) => {
    setFirst(v);
    if (v && rule?.freq === 'weekly' && (rule.byWeekday?.length ?? 0) <= 1) setRule({ ...rule, byWeekday: [dayOfWeek(v)] });
  };

  async function save() {
    if (busy) return;
    setError('');
    let expected: ArrangementRecord['data']['expected'] = null;
    if (cost.trim()) {
      const cents = parseAmountToCents(cost);
      if (cents === null || cents < 0) return setError('The cost estimate is not a valid amount.');
      expected = { basis, cents };
    }
    const provider: ProviderInput | null = choice === NEW ? { name: newName, phone, email } : choice ? { contactId: Number(choice) } : null;
    if (choice === NEW && !newName.trim()) return setError('Enter the provider\'s name, or pick "No provider yet".');
    setBusy(true);
    try {
      if (arrangement) {
        await updateArrangement(arrangement.id, { title, startDate: startDate || null, extraContactIds: d.extraContactIds, expected, refs, notes, assignProvider: hasProvider ? null : provider, assetIds }, arrangement.updatedAt);
        toast('Saved');
        onSaved?.(arrangement.id);
      } else {
        if (!first && rule) throw new Error('Pick the first date.');
        const cadence = rule ? { mode, rule: withExplicitWeekday(rule, first), anchorDate: first } : null;
        const r = await createArrangement({ data: blankArrangement({ title, startDate: startDate || null, cadence, visitTime: cadence && time ? time : null, expected, refs, notes }), provider: provider?.contactId != null || provider?.name ? provider : null, assetIds, scheduleFirstVisit: makeTask, today });
        toast(r.taskId ? 'Added, with its first visit in Tasks' : 'Added', async () => { await applyUndo({ arrangements: [], tasks: [], created: [r.id, ...(r.taskId !== null ? [r.taskId] : [])] }); });
        onSaved?.(r.id);
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save. Nothing was changed.');
      setBusy(false);
    }
  }

  const setRef = (i: number, p: Partial<DocRef>) => setRefs(refs.map((r, j) => (j === i ? { ...r, ...p } : r)));

  return (
    <Modal title={editing ? 'Edit arrangement' : 'Add a household service'} onClose={onClose} wide>
      <form className="sv-form" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <label className="f">What do they do?
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="House cleaning, lawn mowing, furnace service…" autoFocus maxLength={120} />
        </label>

        {hasProvider ? (
          <p className="sv-note">Provider: <strong>{providerName}</strong>. To change who does this, use <em>Replace provider</em> on the arrangement page. That keeps the history with the original provider.</p>
        ) : (
          <>
            <label className="f">Provider
              <select value={choice} onChange={(e) => setChoice(e.target.value)}>
                <option value="">No provider yet</option>
                {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                <option value={NEW}>A new provider…</option>
              </select>
            </label>
            {choice === NEW && (
              <div className="sv-sub">
                <label className="f">Provider name<input value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={120} /></label>
                {sameAsExisting && <p className="sv-note small">A contact with this name already exists, so it will be used. No second contact is made.</p>}
                <div className="sv-two">
                  <label className="f">Phone (optional)<input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="off" /></label>
                  <label className="f">Email (optional)<input value={email} onChange={(e) => setEmail(e.target.value)} inputMode="email" autoComplete="off" /></label>
                </div>
                <p className="muted small">Saved in your shared Contacts, and shown only on the provider page.</p>
              </div>
            )}
          </>
        )}

        <details className="sv-sec" open={!editing && false}>
          <summary>More details</summary>
          {!editing && (
            <fieldset className="sv-sub">
              <legend>How often?</legend>
              <RepeatFields rule={rule} onChange={setRule} start={first || today} mode={mode} onMode={setMode} />
              {rule && (
                <>
                  <div className="sv-two">
                    <label className="f">First visit date<input type="date" value={first} onChange={(e) => onFirst(e.target.value)} /></label>
                    <label className="f">Time (optional)<input type="time" value={time} onChange={(e) => setTime(e.target.value)} /></label>
                  </div>
                  <label className="as-check"><input type="checkbox" checked={makeTask} onChange={(e) => setMakeTask(e.target.checked)} /> Create the next visit as a task now</label>
                  <p className="muted small">The visit is an ordinary task. It shows in Tasks, on the Calendar and on Today.</p>
                </>
              )}
            </fieldset>
          )}
          {editing && <p className="muted small">The schedule is changed with <em>Change schedule</em> on the arrangement page.</p>}

          <label className="f">Started (optional)<input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></label>

          <div className="sv-sub">
            <strong>Property or asset it serves</strong>
            <div className="row">
              {assetIds.map((id) => <span key={id} className="chip">{assets.some((a) => a.id === id) ? publicLabel(assets, id) : 'Asset that no longer exists'}<button type="button" aria-label="Remove link to asset" onClick={() => setAssetIds(assetIds.filter((x) => x !== id))}>✕</button></span>)}
            </div>
            {assets.filter((a) => !assetIds.includes(a.id)).length > 0 ? (
              <select value="" onChange={(e) => e.target.value && setAssetIds([...assetIds, Number(e.target.value)])} aria-label="Link an asset">
                <option value="">Link a property or asset…</option>
                {assets.filter((a) => !assetIds.includes(a.id) && !a.data.archived).map((a) => <option key={a.id} value={a.id}>{publicLabel(assets, a.id)}</option>)}
              </select>
            ) : <p className="muted small">{assets.length ? 'Every asset is linked.' : 'No assets yet. Add them under Home & Assets.'}</p>}
          </div>

          <div className="sv-two">
            <label className="f">Cost estimate (optional)<input value={cost} onChange={(e) => setCost(e.target.value)} inputMode="decimal" placeholder="0.00" /></label>
            <label className="f">Estimate is<select value={basis} onChange={(e) => setBasis(e.target.value as ExpectedBasis)}>{EXPECTED_BASES.map((b) => <option key={b} value={b}>{BASIS_LABEL[b]}</option>)}</select></label>
          </div>
          <p className="muted small">An estimate only. It is never counted as money spent{cost && parseAmountToCents(cost) !== null ? ` (${formatCents(parseAmountToCents(cost)!)} ${BASIS_LABEL[basis]})` : ''}.</p>

          <div className="sv-sub">
            <strong>Document links</strong>
            {refs.map((r, i) => (
              <div key={i} className="sv-ref">
                <input value={r.label} onChange={(e) => setRef(i, { label: e.target.value })} placeholder="Name (Contract, Quote…)" aria-label="Document name" />
                <input value={r.url ?? ''} onChange={(e) => setRef(i, { url: e.target.value })} placeholder="https://…" aria-label="Document link" inputMode="url" />
                <button type="button" className="btn" onClick={() => setRefs(refs.filter((_, j) => j !== i))} aria-label="Remove document link">✕</button>
              </div>
            ))}
            <button type="button" className="btn" onClick={() => setRefs([...refs, { label: '' }])} disabled={refs.length >= 20}>Add a link</button>
          </div>

          <label className="f">Notes
            <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={4000} />
          </label>
          <p className="muted small">Do not store codes, passwords or bank details here. Plain backups and exports are not encrypted. Keep those in a password manager.</p>
          {warn && <p className="sv-warn small" role="alert">{warn}</p>}
        </details>

        {error && <div className="error" role="alert">{error}</div>}
        <div className="row sv-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary" disabled={busy}>{editing ? 'Save' : 'Add'}</button>
        </div>
      </form>
    </Modal>
  );
}
