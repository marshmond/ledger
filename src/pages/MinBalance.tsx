import { db } from '../db';
import type { Account } from '../types';
import { formatCents } from '../lib/money';
import { MoneyField } from './fields';

/** The account's own "never go below" amount. Today, Home and the cash forecast warn when the balance is (or would be) under it. */
export default function MinBalance({ account, balance }: { account: Account; balance: number }) {
  const min = account.minBalanceCents ?? 0;
  const under = min > 0 && balance < min;
  return (
    <div className="card">
      <div className="row spread">
        <MoneyField
          key={`m${min}`}
          label="Minimum balance (never let this account go below)"
          cents={min}
          width={130}
          onChange={(c) => { void db.accounts.update(account.id!, { minBalanceCents: c > 0 ? c : undefined }); }}
        />
        {min > 0 && (under
          ? <span className="warn">Under the minimum by {formatCents(min - balance)}</span>
          : <span className="ok">Above the minimum by {formatCents(balance - min)}</span>)}
      </div>
      <p className="muted" style={{ margin: 'var(--sp-2) 0 0' }}>Optional. Leave blank for no minimum. Today and Ledger Home warn you when the balance is under it, and the cash forecast warns when your accounts together would fall under their minimums.</p>
    </div>
  );
}
