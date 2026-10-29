import type { Txn } from '../types';
import { signedCents } from '../ui/components';

/** Click-to-open breakdown of a split transaction, shared by the Transactions tab and the account pages. */

export function SplitToggle({ open, onToggle, className, children }: { open: boolean; onToggle: () => void; className?: string; children: React.ReactNode }) {
  return (
    <button type="button" className={`link split-toggle ${className ?? ''}`} aria-expanded={open} onClick={onToggle} title={open ? 'Hide the breakdown' : 'Show the dollar amounts'}>
      <span aria-hidden="true">{open ? '▾' : '▸'}</span> {children}
    </button>
  );
}

/**
 * The row under a split transaction: one line per part with its category and amount. On computer screens the category
 * names sit under the Category column and the amounts under Amount; on phones they show as one list.
 * `variant` is the table's column layout: 'all' is the Transactions tab (checkbox, date, account, payee, category,
 * amount, status, actions), 'account' is an account page (date, payee, category, amount, balance, actions).
 */
export function SplitDetailRow({ txn, catName, variant }: { txn: Txn; catName: (id: number | null) => string; variant: 'all' | 'account' }) {
  const parts = txn.splits ?? [];
  const names = parts.map((s, i) => <div key={i}>{catName(s.categoryId)}</div>);
  const amounts = parts.map((s, i) => <div key={i} className={s.amountCents < 0 ? 'neg' : 'pos'}>{signedCents(s.amountCents)}</div>);
  return (
    <tr className="split-detail">
      {variant === 'all' ? <><td className="c-sel" /><td className="c-date" /><td className="c-acct hide-sm" /><td className="c-payee" /></> : <><td className="c-date" /><td className="c-payee" /></>}
      <td className="c-cat">{names}</td>
      <td className="num c-amt">{amounts}</td>
      {variant === 'all' ? <><td className="c-status" /><td className="c-act" /></> : <><td className="c-cat" /><td className="c-act" /></>}
      <td className="split-phone show-sm">
        {parts.map((s, i) => (
          <div className="split-line" key={i}><span>{catName(s.categoryId)}</span><span className={s.amountCents < 0 ? 'neg' : 'pos'}>{signedCents(s.amountCents)}</span></div>
        ))}
      </td>
    </tr>
  );
}
