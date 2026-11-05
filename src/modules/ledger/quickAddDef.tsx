import { useLiveQuery } from 'dexie-react-hooks';
import type { QuickAddDef } from '../../core/registry';
import { db } from '../../db';
import { getPrimaryAccountId } from '../../lib/primaryAccount';
import QuickTxn from '../../shell/QuickTxn';

/** The transaction form inside the Add box: Ledger's own quick form (suggestions, amount math, account default, "Save and add another"). */
function TransactionForm({ onDone }: { onDone: () => void }) {
  const accounts = (useLiveQuery(() => db.accounts.toArray(), []) ?? []).filter((a) => !a.closed && a.kind !== 'loan');
  const primaryId = useLiveQuery(() => getPrimaryAccountId(db), []);
  return <QuickTxn key={`${accounts.length}-${primaryId ?? ''}`} accounts={accounts} primaryId={primaryId} onDone={onDone} />;
}

/** What the Add box can create in Ledger. A transaction is a form; a scheduled payment opens Ledger's own Scheduled screen (it is not typed in). */
export const LEDGER_QUICK_ADDS: QuickAddDef[] = [
  { id: 'transaction', label: 'Transaction', prefix: '$', aliases: ['txn', 'transaction', 'expense'], Form: TransactionForm },
  { id: 'scheduled', label: 'Scheduled payment', prefix: 'b', aliases: ['bill', 'scheduled'], open: ({ navigate }) => navigate('/ledger/scheduled') },
];
