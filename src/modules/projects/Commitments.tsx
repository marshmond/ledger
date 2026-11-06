import { useLiveQuery } from 'dexie-react-hooks';
import { store } from '../../core/store';
import { dayLabel } from '../../core/time';
import { formatCents } from '../../lib/money';
import type { ProjectPiece } from '../../lib/txnProject';
import { EmptyState } from '../../ui/components';
import { useToast } from '../../ui/Toast';
import { COMMITMENT_LABEL, creditChangeOrderDraft, type CommitmentRecord, type CommitmentStatus } from './commitmentModel';
import type { CommitmentDraft } from './CommitmentForm';
import { removeCommitment, setCommitmentStatus } from './data';
import type { ContractGroups, ContractRow } from './financialView';
import type { BudgetLineRecord } from './model';

const signed = (c: number) => `${c < 0 ? '−' : '+'}${formatCents(Math.abs(c))}`;

interface Props {
  groups: ContractGroups;
  lines: BudgetLineRecord[];
  pieces: (ProjectPiece & { payee: string })[];
  /** Show only the contracts filed under this budget line (null = none). undefined = all. */
  focusLine: number | null | undefined;
  onNew: () => void;
  onEdit: (c: CommitmentRecord) => void;
  onChange: (root: CommitmentRecord, draft?: CommitmentDraft) => void;
}

/** Quotes, accepted agreements with their change orders, and the declined or cancelled ones, with what has been paid on each. */
export default function Commitments({ groups, lines, pieces, focusLine, onNew, onEdit, onChange }: Props) {
  const toast = useToast();
  const contacts = useLiveQuery(() => store.shared.contacts.query(), []) ?? [];
  const vendorName = (id: number | null) => (id === null ? '' : contacts.find((c) => c.id === id)?.name ?? '');
  const lineName = (id: number | null) => (id === null ? '' : lines.find((l) => l.id === id)?.data.name ?? '');

  const shown = (rows: ContractRow[]) => (focusLine === undefined ? rows : rows.filter((r) => r.root.data.budgetLineId === focusLine));
  const accepted = shown(groups.accepted), pending = shown(groups.pending), closed = shown(groups.closed);
  const total = groups.accepted.length + groups.pending.length + groups.closed.length;

  const act = (fn: () => Promise<void>, done?: string) => void fn().then(() => done && toast(done)).catch((e) => toast(e instanceof Error ? e.message : 'Something went wrong.'));
  const setStatus = (c: CommitmentRecord, s: CommitmentStatus, done: string) => act(() => setCommitmentStatus(c.id, s), done);
  const remove = (c: CommitmentRecord) => {
    if (confirm(`Remove "${c.data.title}"? If anything is paid on it, cancel it instead.`)) act(() => removeCommitment(c.id), 'Removed');
  };

  const meta = (c: CommitmentRecord) => [vendorName(c.data.vendorContactId), lineName(c.data.budgetLineId)].filter(Boolean).join(' · ');
  const paymentsFor = (row: ContractRow) => {
    const ids = new Set([row.root.id, ...row.changes.map((c) => c.id)]);
    return pieces.filter((p) => p.commitmentId !== undefined && ids.has(p.commitmentId));
  };

  function payments(row: ContractRow) {
    const list = paymentsFor(row);
    if (!list.length) return null;
    return (
      <details className="pj-pay">
        <summary>{list.length} transaction{list.length === 1 ? '' : 's'} on this</summary>
        <ul className="plain">
          {list.map((p, i) => (
            <li key={`${p.txnId}-${i}`} className="small">
              {p.date ? dayLabel(p.date, { year: true }) : ''} · {p.payee || '(no payee)'} ·{' '}
              <span className={p.amountCents > 0 ? 'pos' : ''}>{p.amountCents > 0 ? `${formatCents(p.amountCents)} back${p.effect ? ` (${p.effect})` : ''}` : `paid ${formatCents(-p.amountCents)}`}</span>
            </li>
          ))}
        </ul>
      </details>
    );
  }

  function changes(row: ContractRow) {
    if (!row.changes.length) return null;
    return (
      <ul className="plain pj-changes" aria-label={`Change orders for ${row.root.data.title}`}>
        {row.changes.map((c) => (
          <li key={c.id} className="pj-change">
            <span className="pj-change-main">
              <strong>{c.data.title}</strong>
              <span className="muted small">{COMMITMENT_LABEL[c.data.status]}{row.root.data.status !== 'accepted' ? ' · not counted while the agreement is not accepted' : ''}</span>
            </span>
            <span className={`pj-amount ${c.data.amountCents < 0 ? 'neg' : ''}`}>{signed(c.data.amountCents)}</span>
            <span className="pj-line-actions">
              {c.data.status === 'quoted' && <button className="link" onClick={() => setStatus(c, 'accepted', 'Change accepted')}>Accept</button>}
              {c.data.status === 'quoted' && <button className="link" onClick={() => setStatus(c, 'declined', 'Change declined')}>Decline</button>}
              {c.data.status === 'accepted' && <button className="link" onClick={() => setStatus(c, 'cancelled', 'Change cancelled')}>Cancel</button>}
              {(c.data.status === 'declined' || c.data.status === 'cancelled') && <button className="link" onClick={() => setStatus(c, 'quoted', 'Back to a quote')}>Reopen</button>}
              <button className="link" onClick={() => onEdit(c)}>Edit</button>
              <button className="link danger" onClick={() => remove(c)}>Remove</button>
            </span>
          </li>
        ))}
      </ul>
    );
  }

  const acceptedCard = (row: ContractRow) => {
    const c = row.root, m = row.money;
    return (
      <li key={c.id} className="pj-contract">
        <div className="pj-contract-head">
          <span className="pj-contract-title"><strong>{c.data.title}</strong>{meta(c) && <span className="muted small">{meta(c)}</span>}</span>
          <span className="pj-status s-active">Accepted{c.data.acceptedDate ? ` ${dayLabel(c.data.acceptedDate, { year: true })}` : ''}</span>
        </div>
        {m && (
          <dl className="pj-figures">
            <div><dt>Original</dt><dd>{formatCents(m.originalCents)}</dd></div>
            {row.changes.length > 0 && <div><dt>Accepted changes</dt><dd className={m.changesCents < 0 ? 'neg' : ''}>{m.changesCents === 0 ? formatCents(0) : signed(m.changesCents)}</dd></div>}
            <div><dt>Agreed now</dt><dd><strong>{formatCents(m.agreedCents)}</strong></dd></div>
            <div><dt>Paid so far</dt><dd>{formatCents(m.paidCents)}</dd></div>
            <div><dt>Left to pay</dt><dd className={m.leftCents > 0 ? '' : 'muted'}>{formatCents(m.leftCents)}</dd></div>
          </dl>
        )}
        {m && m.overpaidCents > 0 && <p className="pj-flag" role="status">Paid {formatCents(m.overpaidCents)} more than the agreed amount. Add a change order if the price went up, or ask for a refund.</p>}
        {m && m.creditGapCents > 0 && (
          <p className="pj-flag" role="status">
            You got {formatCents(m.creditsCents)} back as a credit, but the agreed amount has not come down by as much. Until it does, {formatCents(m.creditGapCents)} looks like it is still owed.{' '}
            <button className="btn" onClick={() => onChange(c, { ...creditChangeOrderDraft(c, m.creditGapCents), status: 'accepted', note: `Lowers the agreement by the ${formatCents(m.creditGapCents)} you received as a credit, so the totals match. Nothing changes until you press Add.` })}>
              Add a change order of −{formatCents(m.creditGapCents)}
            </button>
          </p>
        )}
        {changes(row)}
        {payments(row)}
        {c.data.notes && <p className="pj-notes small">{c.data.notes}</p>}
        <div className="pj-contract-actions">
          <button className="btn" onClick={() => onChange(c)}>Add change order</button>
          <button className="link" onClick={() => onEdit(c)}>Edit</button>
          <button className="link" onClick={() => { if (confirm(`Cancel "${c.data.title}"? It stays on the project and anything paid on it stays in the totals, but nothing more is expected on it.`)) setStatus(c, 'cancelled', 'Cancelled'); }}>Cancel agreement</button>
          <button className="link danger" onClick={() => remove(c)}>Remove</button>
        </div>
      </li>
    );
  };

  const otherCard = (row: ContractRow) => {
    const c = row.root, m = row.money;
    const status = c.data.status;
    return (
      <li key={c.id} className="pj-contract">
        <div className="pj-contract-head">
          <span className="pj-contract-title"><strong>{c.data.title}</strong>{meta(c) && <span className="muted small">{meta(c)}</span>}</span>
          <span className={`pj-status ${status === 'cancelled' ? 's-cancelled' : ''}`}>{COMMITMENT_LABEL[status]}</span>
        </div>
        <p className="pj-amount">{formatCents(c.data.amountCents)} {status === 'quoted' && <span className="muted small">· not counted until you accept it</span>}</p>
        {m && m.paidCents > 0 && <p className="pj-flag" role="status">{formatCents(m.paidCents)} has been paid on this. It stays counted as spent; nothing more is expected.</p>}
        {changes(row)}
        {payments(row)}
        {c.data.notes && <p className="pj-notes small">{c.data.notes}</p>}
        <div className="pj-contract-actions">
          {status === 'quoted' && <button className="btn primary" onClick={() => setStatus(c, 'accepted', 'Accepted. It now counts as agreed.')}>Accept</button>}
          {status === 'quoted' && <button className="btn" onClick={() => setStatus(c, 'declined', 'Declined')}>Decline</button>}
          {status === 'declined' && <button className="btn" onClick={() => setStatus(c, 'quoted', 'Back to a quote')}>Back to a quote</button>}
          {status === 'cancelled' && <button className="btn" onClick={() => setStatus(c, 'accepted', 'Reinstated')}>Reinstate</button>}
          <button className="link" onClick={() => onEdit(c)}>Edit</button>
          <button className="link danger" onClick={() => remove(c)}>Remove</button>
        </div>
      </li>
    );
  };

  return (
    <section className="card pj-card" id="pj-commitments" aria-labelledby="pj-commit-h">
      <div className="pj-card-head">
        <h2 id="pj-commit-h">Commitments</h2>
        <button className="btn" onClick={onNew}>Add quote or agreement</button>
      </div>
      {total === 0 ? (
        <EmptyState title="No quotes or agreements yet">Record what a contractor or shop quotes you. A quote is not counted until you accept it. Accepted agreements show what you still owe.</EmptyState>
      ) : (
        <>
          {accepted.length > 0 && <><h3 className="pj-sub">Accepted</h3><ul className="plain pj-contracts">{accepted.map(acceptedCard)}</ul></>}
          {pending.length > 0 && <><h3 className="pj-sub">Quotes waiting</h3><ul className="plain pj-contracts">{pending.map(otherCard)}</ul></>}
          {closed.length > 0 && (
            <details className="pj-closed">
              <summary>Declined and cancelled ({closed.length})</summary>
              <ul className="plain pj-contracts">{closed.map(otherCard)}</ul>
            </details>
          )}
          {accepted.length + pending.length + closed.length === 0 && <p className="muted">Nothing under this budget line.</p>}
        </>
      )}
    </section>
  );
}
