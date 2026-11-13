import { Link } from '../../core/router';
import { formatCents, todayISO } from '../../lib/money';
import { loadHideAmounts } from '../../core/hideAmounts';
import { DateInline } from '../../ui/DateTile';
import { StatusChip } from '../../ui/StatusChip';
import { arrangementRoute, visitRoute } from './paths';
import { VISIT_TONE } from './presentation';
import { chargeWords, statusWords } from './visitModel';
import type { VisitRow } from './views';

const MARK = { completed: '✓', skipped: '–', cancelled: '✕', unsupported: '?' } as const;

/**
 * Plain-words history lines, newest first. Every line is built from the visit's own saved facts, so nothing depends on a Task, contact or arrangement
 * still existing. The outcome is a word-and-icon chip (completed, skipped, cancelled, needs review): a visit in the past is never shown as completed
 * unless it was logged as completed.
 */
export default function VisitList({ rows, showProvider = true, showArrangement = true, empty }: { rows: VisitRow[]; showProvider?: boolean; showArrangement?: boolean; empty: string }) {
  if (rows.length === 0) return <p className="muted">{empty}</p>;
  const hide = loadHideAmounts();
  const money = (c: number) => (hide ? '$••••' : formatCents(c));
  const today = todayISO();
  return (
    <ul className="plain sv-items sv-history" aria-label="Visit history">
      {rows.map((r) => {
        const d = r.v.data;
        const fee = chargeWords(d, money);
        const sep = showProvider ? ' · ' : '';
        return (
          <li key={r.v.id}>
            <div className="sv-visit">
              <div className="sv-visit-top">
                {d.date ? <Link to={visitRoute(r.v.id)}><DateInline iso={d.date} today={today} /></Link> : <Link to={visitRoute(r.v.id)}><strong>Date unknown</strong></Link>}
                <StatusChip tone={VISIT_TONE[d.status]} icon={false}><span aria-hidden="true">{MARK[d.status]} </span>{statusWords(d)}</StatusChip>
              </div>
              <div>{d.title}</div>
              <div className="small muted">
                {showProvider && <>{d.providerNameSnapshot || 'No provider'}{r.contactGone ? ' (contact removed)' : ''}</>}
                {showArrangement && (d.arrangementId === null ? <>{sep}One-off job</> : r.arrangementTitle !== null ? <>{sep}<Link to={arrangementRoute(d.arrangementId)}>{r.arrangementTitle}</Link></> : <>{sep}Arrangement removed</>)}
              </div>
              {fee && <div className="small">{fee}. <span className="muted">Information only, not a payment.</span></div>}
              {r.possibleDuplicate && <div className="small sv-dup" role="status">⚠ Possible duplicate visit. <Link to={visitRoute(r.v.id)}>Look at it</Link></div>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
