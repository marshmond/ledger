import { dayLabel } from '../../core/time';
import { formatCents } from '../../lib/money';
import type { ProjectPiece, ProjectSummary } from '../../lib/txnProject';
import type { Warning } from './financialView';

const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

interface Props {
  summary: ProjectSummary;
  /** True when no overall budget is set, so the budget is the total of the lines. */
  derived: boolean;
  warnings: Warning[];
  focusLine: number | null | undefined;
  onFocus: (line: number | null | undefined) => void;
  onFix: (w: Warning) => void;
}

/** The money picture of one project: the headline figures, what needs attention, and the budget lines side by side. All figures come from Finance. */
export default function Financials({ summary: s, derived, warnings, focusLine, onFocus, onFix }: Props) {
  const left = s.leftInBudgetCents;
  return (
    <>
      <section className="pj-summary" aria-label="Project money">
        <div className="pj-stat"><span className="muted small">{derived ? 'Budget (total of lines)' : 'Project budget'}</span><strong>{formatCents(s.budgetCents)}</strong></div>
        <div className="pj-stat"><span className="muted small">Planned in lines</span><strong>{formatCents(s.plannedTotalCents)}</strong></div>
        <button className="pj-stat as-btn" onClick={() => jump('pj-commitments')} aria-label={`Agreed ${formatCents(s.agreedCents)}. Show commitments`}><span className="muted small">Agreed (accepted)</span><strong>{formatCents(s.agreedCents)}</strong></button>
        <button className="pj-stat as-btn" onClick={() => jump('pj-txns')} aria-label={`Paid ${formatCents(s.paidCents)}. Show transactions`}><span className="muted small">Paid so far</span><strong>{formatCents(s.paidCents)}</strong></button>
        <div className="pj-stat"><span className="muted small">Left to pay</span><strong>{formatCents(s.leftToPayCents)}</strong></div>
        <div className="pj-stat"><span className="muted small">Expected total cost</span><strong className={s.flags.overBudget ? 'neg' : ''}>{formatCents(s.expectedTotalCents)}</strong></div>
        <div className="pj-stat"><span className="muted small">{left < 0 ? 'Over budget by' : 'Left in budget'}</span><strong className={left < 0 ? 'neg' : ''}>{formatCents(Math.abs(left))}</strong></div>
        {!derived && s.notYetPlannedCents !== 0 && (
          <div className="pj-stat"><span className="muted small">{s.notYetPlannedCents < 0 ? 'Lines over budget by' : 'Not planned in lines'}</span><strong className={s.notYetPlannedCents < 0 ? 'neg' : ''}>{formatCents(Math.abs(s.notYetPlannedCents))}</strong></div>
        )}
        {s.quotedCents > 0 && <button className="pj-stat as-btn" onClick={() => jump('pj-commitments')}><span className="muted small">Quotes waiting (not counted)</span><strong>{formatCents(s.quotedCents)}</strong></button>}
      </section>

      {warnings.length > 0 && (
        <section className="card pj-card pj-warnings" aria-labelledby="pj-warn-h">
          <h2 id="pj-warn-h">Needs attention</h2>
          <ul className="plain">
            {warnings.map((w, i) => (
              <li key={`${w.kind}-${w.commitmentId ?? w.lineId ?? i}`} className="pj-warn">
                <span>{w.text}</span>
                {w.creditGapCents ? <button className="btn" onClick={() => onFix(w)}>Add the change order</button> : null}
                {w.kind === 'lineOver' && w.lineId !== undefined && <button className="link" onClick={() => { onFocus(w.lineId); jump('pj-breakdown'); }}>Show this line</button>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card pj-card" id="pj-breakdown" aria-labelledby="pj-break-h">
        <div className="pj-card-head">
          <h2 id="pj-break-h">Budget by line</h2>
          {focusLine !== undefined && <button className="link" onClick={() => onFocus(undefined)}>Show all lines</button>}
        </div>
        {s.lines.length === 0 ? <p className="muted">Add budget lines below to see how each part is doing.</p> : (
          <table className="pj-table">
            <thead>
              <tr><th>Line</th><th className="num">Planned</th><th className="num">Agreed</th><th className="num">Paid</th><th className="num">Left to pay</th><th className="num">Expected</th><th className="num">Remaining</th></tr>
            </thead>
            <tbody>
              {s.lines.map((l) => (
                <tr key={l.lineId ?? 'none'} className={focusLine !== undefined && focusLine === l.lineId ? 'focus' : ''}>
                  <th scope="row" data-label="Line"><button className="link" onClick={() => onFocus(focusLine === l.lineId ? undefined : l.lineId)} aria-pressed={focusLine === l.lineId}>{l.name}</button></th>
                  <td className="num" data-label="Planned">{l.lineId === null ? '—' : formatCents(l.plannedCents)}</td>
                  <td className="num" data-label="Agreed">{formatCents(l.agreedCents)}</td>
                  <td className="num" data-label="Paid">{formatCents(l.paidCents)}</td>
                  <td className="num" data-label="Left to pay">{formatCents(l.leftToPayCents)}</td>
                  <td className="num" data-label="Expected">{formatCents(l.expectedCents)}</td>
                  <td className={`num ${l.varianceCents < 0 ? 'neg' : ''}`} data-label="Remaining">{l.lineId === null ? '—' : l.varianceCents < 0 ? `${formatCents(-l.varianceCents)} over` : formatCents(l.varianceCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}

interface TxnProps {
  projectId: number;
  pieces: (ProjectPiece & { payee: string })[];
  lineName: (id: number | undefined) => string;
  contractName: (id: number | undefined) => string;
  focusLine: number | null | undefined;
  lineOfCommitment: (id: number | undefined) => number | null;
}

/** The transactions tagged to this project: the actual spending. These are the same transactions as in Finance; nothing is copied. */
export function ProjectTxns({ projectId, pieces, lineName, contractName, focusLine, lineOfCommitment }: TxnProps) {
  const lineOf = (p: ProjectPiece) => p.budgetLineId ?? lineOfCommitment(p.commitmentId);
  const shown = focusLine === undefined ? pieces : pieces.filter((p) => (lineOf(p) ?? null) === focusLine);
  return (
    <section className="card pj-card" id="pj-txns" aria-labelledby="pj-txn-h">
      <div className="pj-card-head">
        <h2 id="pj-txn-h">Transactions on this project</h2>
        {pieces.length > 0 && <a className="link" href={`#/ledger/transactions?project=${projectId}`}>See in Finance</a>}
      </div>
      {shown.length === 0 ? (
        <p className="muted">{pieces.length === 0 ? 'Nothing is tagged to this project yet. Open a transaction and choose this project, or select several on the Transactions page and use Project.' : 'Nothing under this budget line.'}</p>
      ) : (
        <ul className="plain pj-paylist">
          {shown.map((p, i) => (
            <li key={`${p.txnId}-${i}`} className="pj-payrow">
              <span className="pj-payrow-main"><a href={`#/ledger/transactions?txn=${p.txnId}`} aria-label={`Open transaction: ${p.payee || 'no payee'}`}><strong>{p.payee || '(no payee)'}</strong></a><span className="muted small">{p.date ? dayLabel(p.date, { year: true }) : ''}{[contractName(p.commitmentId), lineName(p.budgetLineId)].filter(Boolean).map((s) => ` · ${s}`).join('')}{p.effect ? ` · ${p.effect}` : ''}</span></span>
              <span className={`pj-amount ${p.amountCents > 0 ? 'pos' : ''}`}>{p.amountCents > 0 ? `+${formatCents(p.amountCents)}` : formatCents(-p.amountCents)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
