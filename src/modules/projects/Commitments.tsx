import { useLiveQuery } from 'dexie-react-hooks';
import { store } from '../../core/store';
import { dayLabel } from '../../core/time';
import { formatCents } from '../../lib/money';
import type { ProjectPiece } from '../../lib/txnProject';
import { EmptyState } from '../../ui/components';
import { useToast } from '../../ui/Toast';
import { activeSplit, COMMITMENT_LABEL, creditChangeOrderDraft, type CommitmentRecord, type CommitmentStatus } from './commitmentModel';
import type { CommitmentDraft } from './CommitmentForm';
import { removeCommitment, setCommitmentStatus } from './data';
import CostBar from './CostBar';
import { agreementCostBar, type ContractGroups, type ContractRow } from './financialView';
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

  // A split agreement shows under every line it touches; an unsplit one under its home line.
  const shown = (rows: ContractRow[]) => (focusLine === undefined ? rows : rows.filter((r) => (r.money?.split ? r.money.split.lines.some((l) => l.lineId === focusLine) : r.root.data.budgetLineId === focusLine)));
  const accepted = shown(groups.accepted), pending = shown(groups.pending), closed = shown(groups.closed);
  const total = groups.accepted.length + groups.pending.length + groups.closed.length;

  const act = (fn: () => Promise<void>, done?: string) => void fn().then(() => done && toast(done)).catch((e) => toast(e instanceof Error ? e.message : 'Something went wrong.'));
  const setStatus = (c: CommitmentRecord, s: CommitmentStatus, done: string) => act(() => setCommitmentStatus(c.id, s), done);
  const remove = (c: CommitmentRecord) => {
    if (confirm(`Remove "${c.data.title}"? If anything is paid on it, cancel it instead.`)) act(() => removeCommitment(c.id), 'Removed');
  };

  const meta = (c: CommitmentRecord, row?: ContractRow) => [vendorName(c.data.vendorContactId), row?.money?.split ? `Split across ${row.money.split.lines.filter((l) => l.lineId !== null).length || 'no'} line${row.money.split.lines.filter((l) => l.lineId !== null).length === 1 ? '' : 's'}` : lineName(c.data.budgetLineId)].filter(Boolean).join(' · ');
  const splitName = (id: number | null) => (id === null ? 'No budget line' : lineName(id) || 'A removed line');

  /** How a split agreement divides over the budget lines. One agreement, one payment total; this only shows where the money sits. */
  function splitTable(row: ContractRow) {
    const sp = row.money?.split;
    if (!sp) return null;
    const tot = sp.lines.reduce((t, l) => ({ a: t.a + l.agreedCents, p: t.p + l.paidCents, l: t.l + l.leftCents }), { a: 0, p: 0, l: 0 });
    return (
      <details className="pj-split-view" open={sp.unassignedPieces > 0}>
        <summary>Split across budget lines ({sp.lines.length})</summary>
        <table className="pj-table pj-split-table">
          <thead><tr><th>Line</th><th className="num">Agreed</th><th className="num">Paid</th><th className="num">Left</th></tr></thead>
          <tbody>
            {sp.lines.map((l) => (
              <tr key={l.lineId ?? 'none'}>
                <th scope="row" data-label="Line">{l.lineId === null && l.agreedCents === 0 ? 'Paid, line not chosen' : splitName(l.lineId)}</th>
                <td className="num" data-label="Agreed">{formatCents(l.agreedCents)}</td>
                <td className="num" data-label="Paid">{formatCents(l.paidCents)}</td>
                <td className={`num ${l.leftCents < 0 ? 'neg' : ''}`} data-label="Left">{l.lineId === null && l.agreedCents === 0 ? 'balances the lines' : l.leftCents < 0 ? `${formatCents(-l.leftCents)} paid beyond its share` : formatCents(l.leftCents)}</td>
              </tr>
            ))}
            <tr className="pj-total"><th scope="row" data-label="Line">Together</th><td className="num" data-label="Agreed">{formatCents(tot.a)}</td><td className="num" data-label="Paid">{formatCents(tot.p)}</td><td className="num" data-label="Left">{formatCents(tot.l)}</td></tr>
          </tbody>
        </table>
        {sp.unassignedPieces > 0 && <p className="pj-flag" role="status">{formatCents(sp.unassignedPaidCents)} paid in {sp.unassignedPieces} payment{sp.unassignedPieces === 1 ? '' : 's'} is not assigned to a line. Open the transaction and choose the line. Until then the lines above show {formatCents(sp.unassignedPaidCents)} too much left to pay; the "Together" row is the agreement's true total.</p>}
        <p className="muted small">Each payment counts once toward the agreement, however many lines it is split over.</p>
      </details>
    );
  }
  const paymentsFor = (row: ContractRow) => {
    const ids = new Set([row.root.id, ...row.changes.map((c) => c.id)]);
    return pieces.filter((p) => p.commitmentId !== undefined && ids.has(p.commitmentId));
  };

  function payments(row: ContractRow) {
    const list = paymentsFor(row);
    if (!list.length) return null;
    return (
      <details className="pj-pay">
        <summary>{(() => { const n = new Set(list.map((p) => p.txnId)).size; return `${n} transaction${n === 1 ? '' : 's'} on this${list.length > n ? ` (${list.length} parts, each counted once)` : ''}`; })()}</summary>
        <ul className="plain">
          {list.map((p, i) => (
            <li key={`${p.txnId}-${i}`} className="small">
              {p.date ? dayLabel(p.date, { year: true }) : ''} · {p.payee || '(no payee)'} ·{' '}
              <span className={p.amountCents > 0 ? 'pos' : ''}>{p.amountCents > 0 ? `${formatCents(p.amountCents)} back${p.effect ? ` (${p.effect})` : ''}` : `paid ${formatCents(-p.amountCents)}`}</span>
              {row.money?.split && <span className="muted"> · {p.budgetLineId !== undefined ? `for ${splitName(p.budgetLineId)}` : 'not assigned to a line'}</span>}
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
              <span className="muted small">{COMMITMENT_LABEL[c.data.status]}{row.root.data.status !== 'accepted' ? ' · not counted while the agreement is not accepted' : ''}{activeSplit(c) ? ` · ${activeSplit(c)!.map((e) => `${splitName(e.budgetLineId)} ${signed(e.amountCents)}`).join(', ')}` : ''}</span>
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
          <span className="pj-contract-title"><strong>{c.data.title}</strong>{meta(c, row) && <span className="muted small">{meta(c, row)}</span>}</span>
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
        {m?.split && <CostBar title="Where this agreement goes" totalLabel="Agreed now" partLabel="Agreed" model={agreementCostBar(m, (id) => lineName(id))} inline />}
        {splitTable(row)}
        {m?.split && row.changes.some((x) => x.data.status === 'accepted' && !activeSplit(x)) && <p className="pj-flag" role="status">A change order on this agreement is not split across lines, so its amount shows under "No budget line". Edit it to split it.</p>}
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
          <span className="pj-contract-title"><strong>{c.data.title}</strong>{meta(c, row) && <span className="muted small">{meta(c, row)}</span>}</span>
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
