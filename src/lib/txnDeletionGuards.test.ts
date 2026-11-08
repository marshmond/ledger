import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** ST-S2 guards: Finance never imports a household module; the readers only read; nothing logs, stores or sends anything. */
const FINANCE_SIDE = ['src/lib/txnDeletion.ts', 'src/lib/txnBulk.ts', 'src/core/txnDependents.ts', 'src/core/txnDependentsBuild.ts', 'src/pages/TxnDeleteDialog.tsx'];
const READERS = ['bills', 'services', 'assets', 'projects', 'ledger'].map((m) => `src/modules/${m}/txnReferences.ts`);
const code = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('Finance does not know the household modules', () => {
  it.each(FINANCE_SIDE)('%s imports nothing from bills, services, assets, projects or household', (f) => {
    expect(code(readFileSync(f, 'utf8'))).not.toMatch(/from\s+['"][^'"]*\/modules\/(bills|services|assets|projects|household|ledger)\b/);
  });
});

describe('the readers only read', () => {
  it.each(READERS)('%s writes nothing, opens no transaction, logs nothing, stores nothing and sends nothing', (f) => {
    const c = code(readFileSync(f, 'utf8'));
    // (a Set's own .add is not a database write, so only calls on a database table are looked for)
    expect(c).not.toMatch(/\bd\.[A-Za-z]+\.(add|put|update|delete|bulkAdd|bulkPut|bulkDelete|clear)\s*\(|\.modify\s*\(/);
    expect(c).not.toMatch(/\.transaction\s*\(/);
    expect(c).not.toMatch(/console\.|localStorage|sessionStorage|indexedDB|\bfetch\(|XMLHttpRequest|sendBeacon/);
    expect(c).not.toMatch(/\b(recordFact|createTask|repo\()/);
  });
  it('the Finance side logs and sends nothing either, and never touches stored sync credentials', () => {
    for (const f of FINANCE_SIDE) {
      const c = code(readFileSync(f, 'utf8'));
      expect(c, f).not.toMatch(/console\.|localStorage|sessionStorage|\bfetch\(|XMLHttpRequest|sendBeacon|token|passphrase|credential/i);
    }
  });
});

describe('the delete dialog shows no money', () => {
  it('has no amount formatting at all, so Hide Amounts has nothing to hide', () => {
    const c = code(readFileSync('src/pages/TxnDeleteDialog.tsx', 'utf8'));
    expect(c).not.toMatch(/formatCents|signedCents|amountCents|toFixed|Intl\.NumberFormat/);
  });
});

describe('the screens use the guarded delete', () => {
  it('neither Finance screen deletes a transaction behind a plain confirm() any more', () => {
    for (const f of ['src/pages/LedgerPage.tsx', 'src/pages/TransactionsPage.tsx']) {
      const c = code(readFileSync(f, 'utf8'));
      expect(c, f).not.toMatch(/deleteTxn\s*\(/);
      expect(c, f).not.toMatch(/bulkDelete\s*\(/);
      expect(c, f).toMatch(/TxnDeleteDialog/);
    }
  });
});
