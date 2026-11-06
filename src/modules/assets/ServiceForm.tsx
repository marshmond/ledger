import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { findOrCreateContact, validateContact } from '../../core/contacts';
import { dayLabel } from '../../core/time';
import { db } from '../../db';
import { store } from '../../core/store';
import Modal from '../../shell/Modal';
import { todayISO } from '../../lib/money';
import { useToast } from '../../ui/Toast';
import { nextDueDate } from '../tasks/recur';
import type { TaskRecord } from '../tasks/model';
import { completedOn, completionBasis } from './maintenance';
import { chooseCost, initialChoice, type CostChoice } from './costSource';
import type { AssetRecord, AssetRef } from './model';
import { CostSourceField } from './TxnRefs';
import { blankService, costFromText, SERVICE_KINDS, SERVICE_KIND_LABEL, type ServiceKind, type ServiceRecord } from './service';
import { createService, deleteService, DuplicateServiceError, logTaskService, restoreService, updateService } from './serviceData';

/** The line that says what else happens when "Done, log it" is pressed. Uses the same `nextDueDate` the Tasks module uses; shows, never stores. */
export function nextLine(task: TaskRecord, doneOn: string): string {
  const today = todayISO();
  const rep = task.data.repeat;
  if (!rep) return 'This marks the task done. It does not repeat, so no new task is made.';
  const next = nextDueDate(task.data.dueDate, rep, completionBasis(task, doneOn, today));
  return next ? `This marks the task done. It repeats, so the next one is made, due ${dayLabel(next, { year: true })}${next < today ? ', which is already past, so it will show as overdue' : ''}.` : 'This marks the task done. It has finished repeating, so no new task is made.';
}

type Props = {
  asset: AssetRecord;
  /** Editing this record. */
  service?: ServiceRecord;
  /** Starting from this linked task: `complete` = "Done, log it" (also marks it done); otherwise "Save to history" for a task already done. */
  task?: TaskRecord;
  complete?: boolean;
  /** Starting point from a Project ("Record in Home & Assets…"). Nothing is saved until the owner presses Save; no cost is filled in. */
  prefill?: { title: string; kind: ServiceKind; projectId: number; projectName: string };
  onClose: () => void;
};

/**
 * One form for every way a service record is made: log work with no task, edit a record, "Done, log it" and "Save to history".
 * Only known facts are prefilled (the task's title and notes, its date, a single contact). Cost and "what was done" are never invented:
 * a blank cost is saved as "not recorded", not as $0.
 */
export default function ServiceForm({ asset, service, task, complete = false, prefill, onClose }: Props) {
  const toast = useToast();
  const today = todayISO();
  const contacts = useLiveQuery(() => store.shared.contacts.query(), []) ?? [];
  const base = service?.data ?? blankService(asset.id);
  const taskContact = task && task.data.contactIds.length === 1 ? task.data.contactIds[0] : null;
  const [title, setTitle] = useState(service ? base.title : task?.data.title ?? prefill?.title ?? '');
  const [date, setDate] = useState(service ? base.date : task ? (complete ? today : completedOn(task)) : today);
  const [kind, setKind] = useState<ServiceKind>(service ? base.kind : prefill?.kind ?? 'maintenance');
  const [notes, setNotes] = useState(service ? base.notes : task?.data.notes ?? '');
  const [provider, setProvider] = useState<number | null>(service ? base.providerContactId : taskContact);
  const [costText, setCostText] = useState(service && base.costCents !== null ? (base.costCents / 100).toFixed(2) : '');
  const [refs, setRefs] = useState<AssetRef[]>(base.refs);
  const [txnRefs, setTxnRefs] = useState(base.txnRefs);
  const [choice, setChoice] = useState<CostChoice>(initialChoice(base.costCents, base.txnRefs));
  const [ack, setAck] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const known = provider !== null && contacts.some((c) => c.id === provider);
  const heading = service ? 'Edit service record' : task ? (complete ? 'Done, log it' : 'Save to service history') : 'Log service';

  async function addContact() {
    const problem = validateContact({ name: newName, phone: newPhone, email: newEmail });
    if (problem) return setError(problem);
    try {
      const { id, created } = await findOrCreateContact(db, { name: newName, phone: newPhone, email: newEmail });
      setProvider(id);
      toast(created ? `Added ${newName.trim()} to your contacts` : `${newName.trim()} was already in your contacts, so that contact was used`);
      setNewName(''); setNewPhone(''); setNewEmail(''); setError('');
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not add the contact.'); }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const chosen = chooseCost(choice, costText, txnRefs, costFromText);
    if (chosen.badAmount) return setError('The cost is not an amount. Leave it blank if you do not know it.');
    if (chosen.dropped && !ack) return setError(`Tick the box to confirm removing ${chosen.dropped}, or switch back to keep it.`);
    const data = { ...base, assetId: asset.id, date, kind, title, notes, providerContactId: provider, costCents: chosen.cents, txnRefs: chosen.refs, refs, projectId: service ? base.projectId : prefill?.projectId ?? base.projectId };
    setBusy(true);
    try {
      if (service) { await updateService(service.id, data); toast('Saved'); }
      else if (task) {
        const r = await logTaskService({ taskId: task.id, data, complete });
        toast(complete ? (r.spawnedId ? 'Done and saved to history. The next one is created.' : 'Done and saved to history') : 'Saved to service history');
      } else { await createService(data); toast('Service logged'); }
      onClose();
    } catch (err) {
      if (err instanceof DuplicateServiceError) { toast('That task was already saved to history'); onClose(); return; }
      setError(err instanceof Error ? err.message : 'Could not save.');
      setBusy(false);
    }
  }

  async function remove() {
    if (!service) return;
    setBusy(true);
    try {
      await deleteService(service.id);
      toast('Service record deleted', async () => { try { await restoreService(service.id); } catch (err) { toast(err instanceof Error ? err.message : 'Could not bring it back.'); } });
      onClose();
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not delete.'); setBusy(false); }
  }

  return (
    <Modal title={heading} onClose={onClose} wide>
      <form className="as-form" onSubmit={submit}>
        <p className="muted small">On <strong>{asset.data.name}</strong>. Only the description and date are needed; everything else is optional and stays blank if you leave it.</p>
        {task && !service && (
          <p className="as-note small" role="note">
            {complete ? nextLine(task, date) : 'This task is already done. Saving keeps a permanent record of it; the task itself is not changed.'}
          </p>
        )}
        <label className="f">What was done
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Replaced the filter" maxLength={160} autoFocus />
        </label>
        <div className="as-two">
          <label className="f">Date it was done
            <input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="f">Kind of work
            <select value={kind} onChange={(e) => setKind(e.target.value as ServiceKind)}>
              {SERVICE_KINDS.map((k) => <option key={k} value={k}>{SERVICE_KIND_LABEL[k]}</option>)}
            </select>
          </label>
        </div>
        {prefill && !service && (
          <p className="as-note small" role="note">Started from the project "{prefill.projectName}". Nothing is saved until you press Save. The project's payments stay on the project and are not copied here; add a cost only if you want one counted on this asset.</p>
        )}
        <div className="as-two">
          <label className="f">Done by <span className="muted">(optional)</span>
            <select value={provider ?? ''} onChange={(e) => setProvider(e.target.value === '' ? null : Number(e.target.value))}>
              <option value="">Nobody chosen</option>
              {provider !== null && !known && <option value={provider}>(contact removed)</option>}
              {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
        </div>
        <CostSourceField idp="svc" label="Cost" choice={choice} setChoice={setChoice} text={costText} setText={setCostText} refs={txnRefs} setRefs={setTxnRefs} parse={costFromText} ack={ack} setAck={setAck}
          help="Just a note for this record. It does not add anything to your accounts or budget. Blank means unknown; type 0 for free." />
        <details className="as-sec">
          <summary>Add someone new as the provider</summary>
          <div className="as-new-contact">
            <div className="as-two">
              <input aria-label="New provider name" placeholder="Name" value={newName} onChange={(e) => setNewName(e.target.value)} />
              <input aria-label="New provider phone" placeholder="Phone (optional)" value={newPhone} onChange={(e) => setNewPhone(e.target.value)} inputMode="tel" />
            </div>
            <input aria-label="New provider email" placeholder="Email (optional)" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} inputMode="email" />
            <button type="button" className="btn" onClick={() => void addContact()} disabled={!newName.trim()}>Add and choose</button>
          </div>
        </details>
        <label className="f">Notes <span className="muted">(optional)</span>
          <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={5000} placeholder="What was found, parts used, what to watch for" />
        </label>
        <details className="as-sec" open={refs.length > 0}>
          <summary>Documents ({refs.length})</summary>
          <p className="muted small">Where the invoice or report is: a link to your own storage, or a note such as "paper copy, blue folder". Files are not stored in Ledger.</p>
          {refs.map((r, i) => (
            <div key={i} className="as-ref">
              <input aria-label="Document label" placeholder="Label, e.g. Invoice" value={r.label} maxLength={80} onChange={(e) => setRefs(refs.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
              <input aria-label="Document link" placeholder="https://… (optional)" value={r.url ?? ''} maxLength={500} inputMode="url" onChange={(e) => setRefs(refs.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} />
              <input aria-label="Document note" placeholder="Note (optional)" value={r.note ?? ''} maxLength={200} onChange={(e) => setRefs(refs.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)))} />
              <button type="button" className="link" onClick={() => setRefs(refs.filter((_, j) => j !== i))}>Remove</button>
            </div>
          ))}
          <button type="button" className="btn" onClick={() => setRefs([...refs, { label: '' }])}>Add a document</button>
        </details>
        {service && (service.data.taskId !== null || service.data.taskTitleSnapshot) && (
          <p className="muted small">Saved from the task "{service.data.taskTitleSnapshot || 'untitled'}". Changing or deleting that task does not change this record.</p>
        )}
        {error && <div className="error" role="alert">{error}</div>}
        <div className="row as-actions">
          {service && !confirmDelete && <button type="button" className="btn danger" onClick={() => setConfirmDelete(true)}>Delete…</button>}
          {service && confirmDelete && (
            <span className="as-confirm" role="group" aria-label="Confirm delete">
              <span className="small">Delete this record?{service.data.taskId !== null ? ' Its task will show as not yet saved.' : ''}</span>
              <button type="button" className="btn danger" onClick={() => void remove()} disabled={busy}>Yes, delete</button>
              <button type="button" className="btn" onClick={() => setConfirmDelete(false)}>Keep</button>
            </span>
          )}
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary" disabled={busy}>{service ? 'Save' : task && complete ? 'Mark done and save' : task ? 'Save to history' : 'Save'}</button>
        </div>
      </form>
    </Modal>
  );
}
