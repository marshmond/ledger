import { db } from '../../db';
import type { RecordChoice, RecordSource } from '../../core/registry';

/**
 * Lets other modules link to Ledger records and show them by name. Ledger has several kinds of record, so the id is text:
 * `account:12`, `scheduled:7`, `loan:3`. (Transactions and others can be added here later without changing anything else.)
 */
const KINDS = {
  account: { label: 'Account', path: (n: number) => `/ledger/account/${n}` },
  scheduled: { label: 'Scheduled item', path: () => '/ledger/scheduled' },
  loan: { label: 'Loan', path: () => '/ledger/debt' },
  // Transactions are found by the page they sit on, not searched (there can be thousands).
  txn: { label: 'Transaction', path: (n: number) => '/ledger/account/' + n },
} as const;
type Kind = keyof typeof KINDS;

const parse = (id: string | number): { kind: Kind; n: number } | null => {
  const m = /^(account|scheduled|loan|txn):(\d+)$/.exec(String(id));
  return m ? { kind: m[1] as Kind, n: Number(m[2]) } : null;
};

export const ledgerRecords: RecordSource = {
  async search(text) {
    const q = text.trim().toLowerCase();
    const [accounts, rules, loans] = await Promise.all([db.accounts.toArray(), db.recurring.toArray(), db.loans.toArray()]);
    const rows: RecordChoice[] = [
      ...accounts.filter((a) => !a.closed).map((a) => ({ id: `account:${a.id}`, label: a.name, kind: KINDS.account.label })),
      ...rules.map((r) => ({ id: `scheduled:${r.id}`, label: r.payee, kind: KINDS.scheduled.label })),
      ...loans.filter((l) => !l.scenario).map((l) => ({ id: `loan:${l.id}`, label: l.name, kind: KINDS.loan.label })),
    ];
    return rows.filter((r) => !q || r.label.toLowerCase().includes(q)).slice(0, 30);
  },
  async describe(id) {
    const p = parse(id);
    if (!p) return null;
    if (p.kind === 'txn') {
      const t = await db.txns.get(p.n);
      return t ? { label: (t.payee || 'Transaction') + ' ' + t.date, kind: KINDS.txn.label, path: KINDS.txn.path(t.accountId) } : null;
    }
    const row = p.kind === 'account' ? await db.accounts.get(p.n) : p.kind === 'scheduled' ? await db.recurring.get(p.n) : await db.loans.get(p.n);
    if (!row) return null;
    const label = 'payee' in row ? row.payee : row.name;
    return { label, kind: KINDS[p.kind].label, path: KINDS[p.kind].path(p.n) };
  },
};
