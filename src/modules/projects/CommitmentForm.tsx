import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { findOrCreateContact } from '../../core/contacts';
import { store } from '../../core/store';
import { db } from '../../db';
import { formatCents, parseAmountToCents, todayISO } from '../../lib/money';
import Modal from '../../shell/Modal';
import { useToast } from '../../ui/Toast';
import type { AllocationEntry } from '../../lib/txnProject';
import { activeSplit, COMMITMENT_LABEL, splitEvenly, splitProportionally, suggestChangeSplit, validateAllocations, validateCommitment, type CommitmentRecord, type CommitmentStatus } from './commitmentModel';
import { createCommitment, saveCommitment } from './data';
import type { BudgetLineRecord } from './model';

export interface CommitmentDraft { title?: string; amount?: string; parentId?: number | null; status?: CommitmentStatus; note?: string }

const NEW_VENDOR = 'new';

interface Part { line: string; amt: string }
const partsFrom = (list: AllocationEntry[]): Part[] => list.map((e) => ({ line: e.budgetLineId === null ? '' : String(e.budgetLineId), amt: (e.amountCents / 100).toFixed(2) }));
/** The parts as entries, or null when an amount is not an amount. */
function entriesOf(parts: Part[]): AllocationEntry[] | null {
  const out: AllocationEntry[] = [];
  for (const p of parts) {
    const c = parseAmountToCents(p.amt);
    if (c === null) return null;
    out.push({ budgetLineId: p.line ? Number(p.line) : null, amountCents: c });
  }
  return out;
}

/**
 * Create or edit a quote, an accepted agreement or a change order. `parentId` makes it a change order (positive adds cost, negative
 * takes it off). `draft` pre-fills a new one, for example the negative change order that matches a credit.
 */
export default function CommitmentForm({ projectId, vendorIds, lines, all, commitment, draft, onClose }: {
  projectId: number;
  vendorIds: number[];
  lines: BudgetLineRecord[];
  all: CommitmentRecord[];
  commitment?: CommitmentRecord;
  draft?: CommitmentDraft;
  onClose: () => void;
}) {
  const toast = useToast();
  const contacts = useLiveQuery(() => store.shared.contacts.query(), []) ?? [];
  const d = commitment?.data;
  const parentId = d ? d.parentId : draft?.parentId ?? null;
  const parent = parentId === null ? undefined : all.find((c) => c.id === parentId);
  const isChange = parentId !== null;

  const [title, setTitle] = useState(d?.title ?? draft?.title ?? '');
  const [amount, setAmount] = useState(d ? (d.amountCents / 100).toFixed(2) : draft?.amount ?? '');
  const [status, setStatus] = useState<CommitmentStatus>(d?.status ?? draft?.status ?? (isChange ? 'accepted' : 'quoted'));
  const [acceptedDate, setAcceptedDate] = useState(d?.acceptedDate ?? todayISO());
  const [lineId, setLineId] = useState(d?.budgetLineId === null || d?.budgetLineId === undefined ? '' : String(d.budgetLineId));
  const [vendor, setVendor] = useState(d?.vendorContactId === null || d?.vendorContactId === undefined ? '' : String(d.vendorContactId));
  const [newVendor, setNewVendor] = useState('');
  const [notes, setNotes] = useState(d?.notes ?? '');
  // The split across budget lines. A stored split that no longer adds up is shown as stored so it can be fixed.
  const storedList = commitment ? commitment.data.allocations : undefined;
  const parentSplit = parent ? activeSplit(parent) : undefined;
  const startsSplit = !!storedList || (!commitment && isChange && !!parentSplit);
  const [splitOn, setSplitOn] = useState(startsSplit);
  const [parts, setParts] = useState<Part[]>(storedList ? partsFrom(storedList) : []);
  const [touched, setTouched] = useState(!!storedList);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const onProject = contacts.filter((c) => vendorIds.includes(c.id as number)).sort((a, b) => a.name.localeCompare(b.name));
  const others = contacts.filter((c) => !vendorIds.includes(c.id as number)).sort((a, b) => a.name.localeCompare(b.name));
  const cents = parseAmountToCents(amount);
  // A new change order on a split agreement opens with the agreement's proportions; it only follows the amount until the owner edits a part.
  const suggested = !commitment && isChange && parent && cents !== null && cents !== 0 ? suggestChangeSplit(parent, cents) : undefined;
  const shownParts: Part[] = splitOn && !touched && suggested ? partsFrom(suggested) : parts;
  const edit = (next: Part[]) => { setParts(next); setTouched(true); setError(''); };
  const entries = splitOn ? entriesOf(shownParts) : null;
  const allocated = entries ? entries.reduce((n, e) => n + e.amountCents, 0) : null;
  const leftToAllocate = cents !== null && allocated !== null ? cents - allocated : null;
  const usedLines = new Set(shownParts.map((p) => p.line));
  const lineLabel = (id: string) => (id ? lines.find((l) => String(l.id) === id)?.data.name ?? 'a budget line' : 'No budget line');
  const parentAgreed = parent && parent.data.status === 'accepted'
    ? parent.data.amountCents + all.filter((c) => c.data.parentId === parent.id && c.data.status === 'accepted' && c.id !== commitment?.id).reduce((s, c) => s + c.data.amountCents, 0)
    : null;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const problem = validateCommitment(
      { title, amount, status, parentId, budgetLineId: lineId ? Number(lineId) : null, acceptedDate: status === 'accepted' ? acceptedDate : '' },
      { lineIds: lines.map((l) => l.id), all, editingId: commitment?.id },
    ) ?? (vendor === NEW_VENDOR && !newVendor.trim() ? 'Enter the vendor name, or choose none.' : null);
    if (problem) return setError(problem);
    let allocations: AllocationEntry[] | null | undefined;
    if (splitOn) {
      const list = entriesOf(shownParts);
      if (!list) return setError('Every part of the split needs an amount.');
      const bad = validateAllocations(list, cents ?? 0, {
        lineIds: lines.map((l) => l.id), lineName: (id) => lines.find((l) => l.id === id)?.data.name ?? 'a budget line', all,
        self: commitment, parentId, status,
      });
      if (bad) return setError(bad);
      allocations = list;
    } else if (storedList) allocations = null;
    setBusy(true);
    try {
      let vendorContactId = vendor && vendor !== NEW_VENDOR ? Number(vendor) : null;
      if (vendor === NEW_VENDOR) vendorContactId = (await findOrCreateContact(db, { name: newVendor })).id;
      const fields = {
        title, amountCents: cents ?? 0, status, parentId, budgetLineId: isChange ? d?.budgetLineId ?? null : lineId ? Number(lineId) : null,
        vendorContactId, acceptedDate: status === 'accepted' ? acceptedDate : null, notes, allocations,
      };
      const r = commitment ? await saveCommitment(commitment.id, fields) : await createCommitment(projectId, fields);
      toast(`${commitment ? 'Saved' : isChange ? 'Change order added' : status === 'accepted' ? 'Agreement added' : 'Quote added'}${r.vendorAdded ? '. The vendor was added to this project too' : ''}`);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
      setBusy(false);
    }
  }

  const heading = commitment ? (isChange ? 'Edit change order' : 'Edit commitment') : isChange ? `Change order for "${parent?.data.title ?? 'agreement'}"` : 'New quote or agreement';

  return (
    <Modal title={heading} onClose={onClose}>
      <form className="pj-form" onSubmit={save}>
        {draft?.note && <p className="pj-compare">{draft.note}</p>}
        <label className="f">Title<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={isChange ? 'Upgrade to stone counters' : 'Cabinet install'} autoFocus maxLength={120} /></label>
        <label className="f">{isChange ? 'Amount (use a minus sign to take cost off)' : 'Amount'}
          <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode={isChange ? 'text' : 'decimal'} placeholder={isChange ? '-500.00 or 1,200.00' : '10,000.00'} />
        </label>
        {cents !== null && isChange && parentAgreed !== null && status === 'accepted' && (
          <p className="muted small">Agreed now {formatCents(parentAgreed)}; with this change {formatCents(parentAgreed + cents)}.</p>
        )}
        <div className="pj-two">
          <label className="f">Status
            <select value={status} onChange={(e) => setStatus(e.target.value as CommitmentStatus)}>
              {(['quoted', 'accepted', 'declined', 'cancelled'] as CommitmentStatus[]).map((s) => <option key={s} value={s}>{COMMITMENT_LABEL[s]}</option>)}
            </select>
          </label>
          {status === 'accepted' && <label className="f">Accepted on<input type="date" value={acceptedDate} onChange={(e) => setAcceptedDate(e.target.value)} /></label>}
        </div>
        {status === 'quoted' && <p className="muted small">A quote is shown on the project but not counted as owed until you accept it.</p>}
        {!isChange && lines.length > 0 && !splitOn && (
          <label className="f">Budget line
            <select value={lineId} onChange={(e) => setLineId(e.target.value)}>
              <option value="">No budget line</option>
              {lines.map((l) => <option key={l.id} value={l.id}>{l.data.name}</option>)}
            </select>
          </label>
        )}
        {lines.length > 0 && (!isChange || splitOn || parentSplit) && (
          <fieldset className="pj-split">
            <legend>{splitOn ? 'Split across budget lines' : 'Budget lines'}</legend>
            {!splitOn ? (
              <button type="button" className="btn" onClick={() => { setSplitOn(true); setTouched(false); if (!parts.length) setParts([{ line: lineId, amt: cents !== null ? (cents / 100).toFixed(2) : '' }]); }}>Split across budget lines</button>
            ) : (
              <>
                <p className="muted small">
                  {isChange ? 'This change order is part of a split agreement. Say which lines it adds to or takes from. ' : 'One agreement, spread over several lines. '}
                  {suggested && !touched ? 'Suggested in the same proportions as the agreement: check it, then press Add. ' : ''}
                  The parts must add up to the amount exactly.
                </p>
                <ul className="plain pj-parts">
                  {shownParts.map((p, i) => (
                    <li key={i} className="pj-part">
                      <select aria-label={`Line for part ${i + 1}`} value={p.line} onChange={(e) => edit(shownParts.map((x, j) => (j === i ? { ...x, line: e.target.value } : x)))}>
                        <option value="">No budget line (not decided)</option>
                        {lines.map((l) => <option key={l.id} value={l.id} disabled={usedLines.has(String(l.id)) && p.line !== String(l.id)}>{l.data.name}</option>)}
                      </select>
                      <input aria-label={`Amount for ${lineLabel(p.line)}`} inputMode={isChange ? 'text' : 'decimal'} value={p.amt} onChange={(e) => edit(shownParts.map((x, j) => (j === i ? { ...x, amt: e.target.value } : x)))} placeholder="0.00" />
                      <button type="button" className="link danger" onClick={() => edit(shownParts.filter((_, j) => j !== i))} aria-label={`Remove part ${i + 1}`}>Remove</button>
                    </li>
                  ))}
                </ul>
                <div className="row pj-part-tools">
                  <button type="button" className="link" onClick={() => edit([...shownParts, { line: '', amt: '' }])}>Add a line</button>
                  <button type="button" className="link" disabled={cents === null || shownParts.length === 0} onClick={() => { const v = splitEvenly(cents ?? 0, shownParts.length); edit(shownParts.map((x, j) => ({ ...x, amt: (v[j] / 100).toFixed(2) }))); }}>Split evenly</button>
                  <button type="button" className="link" disabled={cents === null || shownParts.length === 0} onClick={() => { const v = splitProportionally(cents ?? 0, shownParts.map((x) => lines.find((l) => String(l.id) === x.line)?.data.plannedCents ?? 0)); edit(shownParts.map((x, j) => ({ ...x, amt: (v[j] / 100).toFixed(2) }))); }}>In proportion to planned amounts</button>
                  <button type="button" className="link" onClick={() => { setSplitOn(false); setError(''); }}>{isChange ? 'Do not split this change' : 'Remove the split'}</button>
                </div>
                <p className={`small pj-left ${leftToAllocate === 0 ? 'ok' : 'neg'}`} role="status">
                  {leftToAllocate === null ? 'Enter the amount and the parts.' : leftToAllocate === 0 ? 'Left to allocate: $0.00. The parts add up.' : `Left to allocate: ${formatCents(leftToAllocate)}`}
                </p>
              </>
            )}
            {isChange && !splitOn && parentSplit && <p className="muted small">If you do not split a change order, its amount shows under "No budget line" with a warning.</p>}
          </fieldset>
        )}
        <label className="f">Vendor
          <select value={vendor} onChange={(e) => setVendor(e.target.value)}>
            <option value="">None</option>
            {onProject.length > 0 && <optgroup label="On this project">{onProject.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</optgroup>}
            {others.length > 0 && <optgroup label="Other contacts">{others.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</optgroup>}
            <option value={NEW_VENDOR}>New vendor…</option>
          </select>
        </label>
        {vendor === NEW_VENDOR && <label className="f">New vendor name<input value={newVendor} onChange={(e) => setNewVendor(e.target.value)} maxLength={120} placeholder="Name or business" /></label>}
        {vendor && vendor !== NEW_VENDOR && !vendorIds.includes(Number(vendor)) && <p className="muted small">This contact will also be added to the project's vendors (no second copy is made).</p>}
        <label className="f">Notes<textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} /></label>
        {error && <div className="error" role="alert">{error}</div>}
        <div className="row pj-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary" disabled={busy}>{commitment ? 'Save' : 'Add'}</button>
        </div>
      </form>
    </Modal>
  );
}
