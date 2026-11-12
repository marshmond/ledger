import { dayLabel } from '../../core/time';
import { formatCents } from '../../lib/money';
import { reportProjectLink } from '../../lib/reports';
import type { ProjectPiece, ProjectSummary } from '../../lib/txnProject';
import CostBar from './CostBar';
import { noLineNotes, projectCostBar, type Warning } from './financialView';

const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

interface Props {
  summary: ProjectSummary;
  warnings: Warning[];
  focusLine: number | null | undefined;
  onFocus: (line: number | null | undefined) => void;
  onFix: (w: Warning) => void;
  /** For the link to this project's filtered Finance report. */
  projectId?: number;
}

/**
 * The headline money figures of one project, in four groups that keep the different ideas apart: the plan (budget and its lines), what is committed
 * (accepted agreements; quotes are shown but never counted), what has actually been spent (Finance transactions) and the outlook that follows from them.
 * D14 only regrouped and restyled the figures that were already here; every value still comes straight from the Finance summary.
 */
export function FinancialBand({ summary: s, derived }: { summary: ProjectSummary; derived: boolean }) {
  const left = s.leftInBudgetCents;
  const fig = (label: string, value: string, tone?: 'neg') => (
    <div className="pj-fig"><span className="pj-fig-label">{label}</span><strong className={`pj-fig-value${tone ? ` ${tone}` : ''}`}>{value}</strong></div>
  );
  return (
    <section className="card pj-band" aria-label="Project money">
      <div className="pj-band-group">
        <h2 className="pj-band-h">Plan</h2>
        <div className="pj-band-figs">
          {fig(derived ? 'Budget (total of lines)' : 'Project budget', formatCents(s.budgetCents))}
          {fig('Planned in lines', formatCents(s.plannedTotalCents))}
          {!derived && s.notYetPlannedCents !== 0 && fig(s.notYetPlannedCents < 0 ? 'Lines over budget by' : 'Not planned in lines', formatCents(Math.abs(s.notYetPlannedCents)), s.notYetPlannedCents < 0 ? 'neg' : undefined)}
        </div>
      </div>
      <div className="pj-band-group">
        <h2 className="pj-band-h">Committed</h2>
        <div className="pj-band-figs">
          <button className="pj-fig as-btn" onClick={() => jump('pj-commitments')} aria-label={`Agreed ${formatCents(s.agreedCents)}. Show commitments`}><span className="pj-fig-label">Agreed (accepted)</span><strong className="pj-fig-value">{formatCents(s.agreedCents)}</strong></button>
          {s.quotedCents > 0 && <button className="pj-fig as-btn" onClick={() => jump('pj-commitments')}><span className="pj-fig-label">Quotes waiting (not counted)</span><strong className="pj-fig-value">{formatCents(s.quotedCents)}</strong></button>}
        </div>
      </div>
      <div className="pj-band-group">
        <h2 className="pj-band-h">Spent</h2>
        <div className="pj-band-figs">
          <button className="pj-fig as-btn" onClick={() => jump('pj-txns')} aria-label={`Paid ${formatCents(s.paidCents)}. Show transactions`}><span className="pj-fig-label">Paid so far</span><strong className="pj-fig-value">{formatCents(s.paidCents)}</strong></button>
        </div>
      </div>
      <div className="pj-band-group">
        <h2 className="pj-band-h">Outlook</h2>
        <div className="pj-band-figs">
          {fig('Left to pay', formatCents(s.leftToPayCents))}
          {fig('Expected total cost', formatCents(s.expectedTotalCents), s.flags.overBudget ? 'neg' : undefined)}
          {fig(left < 0 ? 'Over budget by' : 'Left in budget', formatCents(Math.abs(left)), left < 0 ? 'neg' : undefined)}
        </div>
      </div>
    </section>
  );
}

/** What needs attention on the project, where the money goes, and the budget lines side by side. All figures come from Finance. */
export default function Financials({ summary: s, warnings, focusLine, onFocus, onFix, projectId }: Props) {
  return (
    <>
      {warnings.length > 0 && (
        <section className="card pj-card pj-warnings" aria-labelledby="pj-warn-h">
          <h2 id="pj-warn-h">Needs attention</h2>
          <ul className="plain">
            {warnings.map((w, i) => (
              <li key={`${w.kind}-${w.commitmentId ?? w.lineId ?? i}`} className="pj-warn">
                <span>{w.text}</span>
                {w.creditGapCents ? <button className="btn" onClick={() => onFix(w)}>Add the change order</button> : null}
                {(w.kind === 'splitBroken' || w.kind === 'changeNotSplit' || w.kind === 'splitLineGone') && <button className="btn" onClick={() => onFix(w)}>{w.kind === 'changeNotSplit' ? 'Open the change order' : 'Open the agreement'}</button>}
                {w.kind === 'splitUnassigned' && <button className="btn" onClick={() => jump('pj-commitments')}>Show the payments</button>}
                {w.kind === 'lineOver' && w.lineId !== undefined && <button className="link" onClick={() => { onFocus(w.lineId); jump('pj-breakdown'); }}>Show this line</button>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <CostBar
        title="Where the money goes"
        totalLabel="Expected total cost"
        partLabel="Expected cost"
        model={projectCostBar(s)}
        linkSlot={projectId !== undefined && (
          <p className="pj-cost-link small"><a className="link" href={reportProjectLink(projectId)}>See spending over time</a> <span className="muted">(Finance reports, this project only)</span></p>
        )}
      />

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
        {noLineNotes(s).length > 0 && (
          <div className="muted small pj-noline" id="pj-noline">
            <strong>What is in "No budget line":</strong>
            <ul className="plain">{noLineNotes(s).map((t, i) => <li key={i}>{t}</li>)}</ul>
          </div>
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
