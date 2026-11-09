import { readdirSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { db, type FinanceDB } from '../db';
import { fresh } from '../modules/bills/billsTestkit';
import { allDueProviders } from '../core/dueProvider';
import { allSearchSources, allTxnReferenceProviders } from '../core/registry';
import { registerModules } from '../modules';
import { loadBillsSnapshot } from '../modules/bills/readModel';
import { TODAY, seed, type Seed } from '../modules/household/householdSeed';
import { loadHouseholdOverview } from '../modules/household/overview';
import { loadSnapshotAndLinks } from '../modules/services/views';
import { planTxnDeletion } from './txnDeletion';

/**
 * ST-S4 (TS-03): a BEHAVIOURAL read-only guard. The older guards search source text for write calls by name (`.put(`, `createTask`, ...), which a
 * write under a new name or through an alias would slip past. This one watches the database itself: every table's create, update and delete hooks,
 * `clear`, and any read-write transaction are recorded while the readers run on a seeded (invented) household. If a reader writes by ANY route that
 * goes through the database, it shows up here, whatever the code calls it.
 *
 * The trap is proved not vacuous first: a positive control performs each kind of write (including through an alias) and must be seen every time.
 */

function trap(d: FinanceDB) {
  const seen: string[] = [];
  for (const t of d.tables) {
    t.hook('creating', () => { seen.push(`${t.name}:creating`); });
    t.hook('updating', () => { seen.push(`${t.name}:updating`); });
    t.hook('deleting', () => { seen.push(`${t.name}:deleting`); });
    const clear = t.clear.bind(t);
    (t as { clear: () => Promise<void> }).clear = () => { seen.push(`${t.name}:clear`); return clear(); };
  }
  const tx = d.transaction.bind(d) as (...a: unknown[]) => unknown;
  (d as { transaction: unknown }).transaction = (...a: unknown[]) => { if (String(a[0]).startsWith('rw')) seen.push('rw-transaction'); return tx(...a); };
  return { seen, reset: () => { seen.length = 0; } };
}

let s: Seed;
let t: ReturnType<typeof trap>;
beforeAll(async () => {
  registerModules();
  s = await seed(db); // seeded BEFORE the trap is set
  t = trap(db);
});

describe('the trap itself notices every kind of write (so a quiet result means something)', () => {
  let d: FinanceDB;
  let s2: Seed;
  let t2: ReturnType<typeof trap>;
  beforeAll(async () => { d = fresh('readonly-trap-controls'); s2 = await seed(d); t2 = trap(d); }); // its own database: the readers below must see the seeded household untouched
  it.each([
    ['add', () => d.txns.add({ accountId: s2.acct, date: TODAY, amountCents: -1, payee: 'x', memo: '', status: 'pending', categoryId: null } as never)],
    ['put', () => d.txns.put({ ...s2.T1, memo: 'changed' })],
    ['update', () => d.txns.update(s2.T1.id!, { memo: 'again' })],
    ['delete', () => d.txns.delete(s2.T6.id!)],
    ['bulk add', () => d.moduleRecords.bulkAdd([{ module: 'zz', kind: 'k', createdAt: 1, updatedAt: 1, data: {} } as never])],
    ['through an alias with an innocent name', () => { const harmless = d.table('moduleRecords'); return harmless.put({ module: 'zz', kind: 'k', createdAt: 1, updatedAt: 1, data: { n: 1 } } as never); }],
    ['a read-write transaction', () => d.transaction('rw', d.txns, async () => undefined)],
  ])('%s', async (_name, write) => {
    t2.reset();
    await write();
    expect(t2.seen.length).toBeGreaterThan(0);
  });

  it('clear', async () => {
    t2.reset();
    await d.table('links').clear();
    expect(t2.seen).toContain('links:clear');
  });
});

describe('the readers write nothing, by any route', () => {
  it('registration is complete (the readers below are the real registered ones)', () => {
    expect(allDueProviders().length).toBeGreaterThan(0);
    expect(allSearchSources().length).toBe(10); // C1: Contacts & Relationships is the tenth search source
    expect(allTxnReferenceProviders().length).toBe(5);
  });

  it('every Calendar due provider, over a year around today', async () => {
    t.reset();
    for (const p of allDueProviders()) await p.getDueItems({ from: '2026-01-01', to: '2027-12-31', today: TODAY, overdueDays: 30 });
    expect(t.seen).toEqual([]);
  });

  it('every search source, with and without its snapshot, for a few typed words', async () => {
    t.reset();
    for (const { source } of allSearchSources()) {
      const stop = source.start?.();
      for (const q of ['a', 'bill', 'power', 'visit']) await source.search(q, 20);
      stop?.();
    }
    expect(t.seen).toEqual([]);
  });

  it('the Bills snapshot, the Services snapshot and the household overview', async () => {
    t.reset();
    await loadBillsSnapshot(db);
    await loadSnapshotAndLinks(db);
    await loadHouseholdOverview('last12', TODAY, db);
    await loadHouseholdOverview('last12', TODAY, db);
    expect(t.seen).toEqual([]);
  });

  it('Finance\'s transaction-reference readers (the delete preview), for a payment that records point at and for one nothing points at', async () => {
    t.reset();
    await planTxnDeletion(db, [s.T1.id!, s.T4.id!, s.T5.id!], allTxnReferenceProviders());
    await planTxnDeletion(db, [s.T6.id!], allTxnReferenceProviders());
    expect(t.seen).toEqual([]);
  });
});

describe('the reader files cannot be missed by a name list', () => {
  it('every module that has a transaction-reference reader file is registered, and the other way round', () => {
    const files = readdirSync('src/modules', { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).filter((m) => readdirSync(`src/modules/${m}`).includes('txnReferences.ts')).sort();
    expect(files).toEqual(['assets', 'bills', 'ledger', 'projects', 'services']); // the list the source guard in txnDeletionGuards.test.ts checks
    expect(allTxnReferenceProviders().length).toBe(files.length);
  });
});
