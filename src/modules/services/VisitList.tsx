import { Link } from '../../core/router';
import { dayLabel } from '../../core/time';
import { formatCents } from '../../lib/money';
import { loadHideAmounts } from '../../core/hideAmounts';
import { arrangementRoute, visitRoute } from './paths';
import { chargeWords, statusWords } from './visitModel';
import type { VisitRow } from './views';

const day = (d: string) => (d ? dayLabel(d, { weekday: 'short', year: true }) : 'Date unknown');
const MARK = { completed: '✓', skipped: '–', cancelled: '✕', unsupported: '?' } as const;

/** Plain-words history lines, newest first. Every line is built from the visit's own saved facts, so nothing depends on a Task, contact or arrangement still existing. */
export default function VisitList({ rows, showProvider = true, showArrangement = true, empty }: { rows: VisitRow[]; showProvider?: boolean; showArrangement?: boolean; empty: string }) {
  if (rows.length === 0) return <p className="muted">{empty}</p>;
  const hide = loadHideAmounts();
  const money = (c: number) => (hide ? '$••••' : formatCents(c));
  return (
    <ul className="plain sv-items" aria-label="Visit history">
      {rows.map((r) => {
        const d = r.v.data;
        const fee = chargeWords(d, money);
        const sep = showProvider ? ' · ' : '';
        return (
          <li key={r.v.id}>
            <div className="sv-visit">
              <div className="sv-visit-top">
                <Link to={visitRoute(r.v.id)}><strong>{day(d.date)}</strong></Link>
                <span className={`sv-chip v-${d.status}`}><span aria-hidden="true">{MARK[d.status]} </span>{statusWords(d)}</span>
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
