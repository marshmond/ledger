import { useLiveQuery } from 'dexie-react-hooks';
import { formatCents } from '../../lib/money';
import { maskMoney } from '../../ui/TxnRefs';
import { loadHideAmounts } from '../today/layout';
import { loadRelatedBills } from './relatedBill';

/**
 * "Related bill" on a Household Services arrangement (B5). Read only: it shows the bill the owner linked to this arrangement ("bills for", made from the bill's own page) and
 * links to it. It does not create, change or remove the link, never links by matching names, and changes no schedule, Task, visit, payment or total.
 */
export default function RelatedBillCard({ arrangementId }: { arrangementId: number }) {
  const hide = loadHideAmounts();
  const rows = useLiveQuery(() => loadRelatedBills(arrangementId), [arrangementId, hide]);
  const money = (c: number) => (hide ? '$••••' : formatCents(c));
  return (
    <section className="card sv-card" aria-labelledby="sv-bill-h">
      <h2 id="sv-bill-h">Related bill</h2>
      {!rows ? <p className="muted">Loading…</p> : rows.length === 0 ? (
        <p className="muted">No bill is linked to this arrangement. A link is made from the bill's own page in Bills &amp; Subscriptions, and only if you choose to.</p>
      ) : (
        <ul className="plain sv-items">
          {rows.map((b) => (
            <li key={b.billId}>
              {b.state === 'missing' ? <strong>{b.title}</strong> : <a href={b.href}><strong>{hide ? maskMoney(b.title) : b.title}</strong></a>}
              <div className="small muted">
                <span className={`sv-chip ${b.state === 'active' ? 's-active' : b.state === 'missing' || b.state === 'unreadable' ? '' : 's-paused'}`}>{b.state === 'missing' ? 'Not here' : b.state === 'unreadable' ? 'Needs review' : b.state === 'cancelling' ? 'Cancelling' : b.state === 'ended' ? 'Ended' : b.state === 'paused' ? 'Paused' : 'Active'}</span>{' '}
                {b.statusText}
              </div>
              {b.arrangementText && <div className="small">{b.arrangementText}{b.amountKind === 'fixed' && b.amountCents !== null ? ` · ${money(b.amountCents)} each time` : b.amountKind === 'variable' ? (b.amountCents !== null ? ` · varies, about ${money(b.amountCents)}` : ' · amount varies') : b.amountKind === 'unknown' || b.amountCents === null ? ' · amount not known' : ''}</div>}
            </li>
          ))}
        </ul>
      )}
      <p className="muted small">The link says only that the two records are related. It does not merge them, their money, their schedules or their reminders, and it changes nothing here.</p>
    </section>
  );
}
