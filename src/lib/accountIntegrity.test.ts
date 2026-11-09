import { describe, expect, it } from 'vitest';
import { FinanceDB } from '../db';
import { buildBackup, checkBackupText, restoreChecked } from './backupFile';
import { blockedReasons, blocksDeletion, confirmText, deleteAccountWithTransactions, noteLines, orphanedRules, readAccountDependents } from './accountDependents';
import { MissingAccountError, postInstance, skipInstance } from './schedule';
import { dexieMeta, RemoteConflict, SyncEngine, type RemoteFile, type RemoteStore } from './sync/engine';
import { installTracking } from './sync/track';
import { ledgerDueItems } from '../modules/ledger/dueProvider';
import type { RecurringRule } from '../types';

/**
 * ST-S1 / DI-01: an account that Scheduled items still use cannot be deleted, and approving an item whose account is missing never writes anything.
 * Real Dexie over fake-indexeddb, the real SyncEngine for the two-device case. Every name and amount is invented.
 */
let n = 0;
const fresh = () => new FinanceDB(`di01-${Date.now()}-${n++}`);
const TODAY = '2026-11-08';

async function world(d: FinanceDB) {
  const checking = (await d.accounts.add({ name: 'Test checking', kind: 'checking', openingBalanceCents: 100000, openingDate: '2026-01-01' } as never)) as number;
  const savings = (await d.accounts.add({ name: 'Test savings', kind: 'savings', openingBalanceCents: 0, openingDate: '2026-01-01' } as never)) as number;
  await d.txns.bulkAdd([
    { accountId: checking, date: '2026-10-02', amountCents: -2500, payee: 'Sample cafe', memo: '', status: 'cleared', categoryId: null },
    { accountId: checking, date: '2026-10-03', amountCents: -4000, payee: 'Sample grocer', memo: '', status: 'cleared', categoryId: null },
  ] as never);
  return { checking, savings };
}
const rule = (accountId: number, over: Partial<RecurringRule> = {}): RecurringRule => ({ accountId, payee: 'Sample rent', amountCents: -120000, categoryId: null, memo: '', frequency: 'monthly', startDate: '2026-10-01', active: true, ...over });
const addRule = async (d: FinanceDB, r: RecurringRule) => ({ ...r, id: (await d.recurring.add(r)) as number });
const counts = async (d: FinanceDB) => ({ txns: await d.txns.count(), log: await d.recurringLog.count(), accounts: await d.accounts.count(), rules: await d.recurring.count() });

describe('DI-01 account deletion with dependents', () => {
  it('1. an ACTIVE Scheduled rule blocks the deletion, and nothing is deleted', async () => {
    const d = fresh();
    const { checking } = await world(d);
    await addRule(d, rule(checking));
    const before = await counts(d);
    const res = await deleteAccountWithTransactions(d, checking);
    expect(res.ok).toBe(false);
    expect(await counts(d)).toEqual(before); // account, both transactions and the rule are all still there
    const dep = await readAccountDependents(d, checking);
    const text = blockedReasons('Test checking', dep).join(' ');
    expect(text).toMatch(/1 Scheduled item still uses "Test checking" \(all active\): Sample rent/);
    expect(text).not.toMatch(/\$|\d{4,}/); // no amounts or ids in the explanation
  });

  it('2. an INACTIVE (paused) rule also blocks it, and the message says it is paused; a transfer rule on ANOTHER account that targets it blocks too', async () => {
    const d = fresh();
    const { checking, savings } = await world(d);
    await addRule(d, rule(checking, { payee: 'Paused item', active: false }));
    expect(blockedReasons('Test checking', await readAccountDependents(d, checking)).join(' ')).toMatch(/\(all paused\)/);
    await d.recurring.clear();
    await addRule(d, rule(savings, { payee: 'Move to checking', transferAccountId: checking, amountCents: -5000 }));
    const dep = await readAccountDependents(d, checking);
    expect(dep.rules.map((r) => r.payee)).toEqual(['Move to checking']);
    expect((await deleteAccountWithTransactions(d, checking)).ok).toBe(false);
    await d.recurring.clear();
    await addRule(d, rule(checking, { payee: 'A', active: true }));
    await addRule(d, rule(checking, { payee: 'B', active: false }));
    expect(blockedReasons('Test checking', await readAccountDependents(d, checking)).join(' ')).toMatch(/2 Scheduled items still use.*1 active and 1 paused/);
  });

  it('3. other dependents: a linked loan blocks; payee rules, imports, a bill and the primary choice are only mentioned and do not block', async () => {
    const d = fresh();
    const { checking } = await world(d);
    await d.loans.add({ name: 'Sample car loan', ledgerAccountId: checking } as never);
    let dep = await readAccountDependents(d, checking);
    expect(blocksDeletion(dep)).toBe(true);
    expect(blockedReasons('Test checking', dep).join(' ')).toMatch(/1 loan is linked.*Sample car loan.*Unlink it there first/);
    expect((await deleteAccountWithTransactions(d, checking)).ok).toBe(false);
    await d.loans.clear();

    await d.payeeRules.add({ pattern: 'cafe', categoryId: null, accountId: checking } as never);
    await d.importBatches.add({ accountId: checking, importedAt: 1 } as never);
    await d.settings.put({ key: 'primaryAccountId', value: checking });
    await d.moduleRecords.add({ module: 'bills', kind: 'obligation', data: { title: 'Sample power', payment: { how: 'manual', fundingAccountId: checking } }, createdAt: 1, updatedAt: 1, deletedAt: null } as never);
    dep = await readAccountDependents(d, checking);
    expect(blocksDeletion(dep)).toBe(false);
    const notes = noteLines(dep).join(' ');
    expect(notes).toMatch(/Sample power/);
    expect(notes).toMatch(/payee rule/);
    expect(notes).toMatch(/primary payment account/);
    expect(notes).toMatch(/import/);
    expect(confirmText('Test checking', dep)).toMatch(/Delete "Test checking" and all 2 of its transactions\?.*cannot be undone/s);
    // none of those records is changed by the deletion itself
    expect((await deleteAccountWithTransactions(d, checking)).ok).toBe(true);
    expect(await d.payeeRules.count()).toBe(1);
    expect(await d.moduleRecords.count()).toBe(1);
    expect(await d.importBatches.count()).toBe(1);
  });

  it('4. an account with no dependents is deleted with its transactions, exactly as before; other accounts are untouched', async () => {
    const d = fresh();
    const { checking, savings } = await world(d);
    await d.txns.add({ accountId: savings, date: '2026-10-04', amountCents: 900, payee: 'Interest', memo: '', status: 'cleared', categoryId: null } as never);
    const res = await deleteAccountWithTransactions(d, checking);
    expect(res).toEqual({ ok: true, transactionsDeleted: 2 });
    expect(await d.accounts.get(checking)).toBeUndefined();
    expect((await d.txns.toArray()).map((t) => t.payee)).toEqual(['Interest']);
    expect(await d.accounts.get(savings)).toBeDefined();
  });

  it('a Scheduled rule appearing between the check and the deletion is still seen: the deletion re-checks inside its own transaction', async () => {
    const d = fresh();
    const { checking } = await world(d);
    expect(blocksDeletion(await readAccountDependents(d, checking))).toBe(false); // the screen checked and found nothing
    await addRule(d, rule(checking)); // ...then another device's rule arrives, or the owner adds one in another tab
    const before = await counts(d);
    expect((await deleteAccountWithTransactions(d, checking)).ok).toBe(false);
    expect(await counts(d)).toEqual(before);
  });
});

describe('DI-01 posting guard', () => {
  async function orphan(d: FinanceDB) {
    const { checking } = await world(d);
    const r = await addRule(d, rule(checking));
    await d.transaction('rw', d.accounts, d.txns, async () => { await d.txns.where('accountId').equals(checking).delete(); await d.accounts.delete(checking); }); // an orphan, as old data or a sync could leave
    return r;
  }

  it('5. approving a rule whose account is missing is refused with a plain message', async () => {
    const d = fresh();
    const r = await orphan(d);
    await expect(postInstance(d, r, '2026-11-01')).rejects.toBeInstanceOf(MissingAccountError);
    await expect(postInstance(d, r, '2026-11-01')).rejects.toThrow(/Nothing was posted: the account this scheduled item belongs to no longer exists/);
  });

  it('6. an account that disappears between the preview and the click: the stale button is refused', async () => {
    const d = fresh();
    const { checking } = await world(d);
    const r = await addRule(d, rule(checking));
    const previewed = (await d.recurring.toArray())[0]; // what the screen holds
    expect(previewed.id).toBe(r.id);
    await d.accounts.delete(checking); // meanwhile the account is removed (another device)
    await expect(postInstance(d, previewed, '2026-11-01')).rejects.toBeInstanceOf(MissingAccountError);
  });

  it('7. a refusal writes NO transaction and NO recurring log, and changes nothing else', async () => {
    const d = fresh();
    const r = await orphan(d);
    const before = JSON.stringify([await d.txns.toArray(), await d.recurringLog.toArray(), await d.accounts.toArray(), await d.recurring.toArray()]);
    await expect(postInstance(d, r, '2026-11-01', { amountCents: -999 })).rejects.toThrow();
    expect(JSON.stringify([await d.txns.toArray(), await d.recurringLog.toArray(), await d.accounts.toArray(), await d.recurring.toArray()])).toBe(before);
  });

  it('a transfer rule is refused when EITHER account is missing', async () => {
    const d = fresh();
    const { checking, savings } = await world(d);
    const r = await addRule(d, rule(checking, { transferAccountId: savings, amountCents: -3000, payee: 'Move' }));
    await d.accounts.delete(savings);
    await expect(postInstance(d, r, '2026-11-01')).rejects.toThrow(/transfer goes to or comes from no longer exists/);
    expect(await d.recurringLog.count()).toBe(0);
    expect(await d.txns.count()).toBe(2);
  });

  it('a rule with a valid account still posts exactly as before (one pending transaction and one log entry)', async () => {
    const d = fresh();
    const { checking } = await world(d);
    const r = await addRule(d, rule(checking));
    const id = await postInstance(d, r, '2026-11-01');
    expect((await d.txns.get(id))).toMatchObject({ accountId: checking, amountCents: -120000, status: 'pending', recurringId: r.id });
    expect(await d.recurringLog.toArray()).toMatchObject([{ ruleId: r.id, date: '2026-11-01', action: 'posted', txnId: id }]);
  });

  it('skipping an orphaned item is still allowed (it only records that the date was handled), so the owner can clear old dates', async () => {
    const d = fresh();
    const r = await orphan(d);
    await skipInstance(d, r, '2026-11-01');
    expect(await d.recurringLog.toArray()).toMatchObject([{ ruleId: r.id, date: '2026-11-01', action: 'skipped' }]);
    expect(await d.txns.count()).toBe(0);
  });
});

describe('DI-01 what Today and Calendar show for an orphaned rule', () => {
  it('8. the item is NOT hidden (so it is not forgotten); its title is unchanged and its detail says the account is missing; a healthy rule has no such note', async () => {
    const d = fresh();
    const { checking, savings } = await world(d);
    await addRule(d, rule(checking, { payee: 'Orphaned rent' }));
    await addRule(d, rule(savings, { payee: 'Healthy item', amountCents: -1000 }));
    await d.accounts.delete(checking);
    const items = await ledgerDueItems(d, { from: '2026-11-01', to: '2026-12-31', today: TODAY, overdueDays: 14 }, false);
    const orphaned = items.filter((i) => String(i.sourceRecordId).startsWith('scheduled:') && i.title.startsWith('Orphaned rent'));
    const healthy = items.filter((i) => i.title.startsWith('Healthy item'));
    expect(orphaned.length).toBeGreaterThan(0);
    expect(healthy.length).toBeGreaterThan(0);
    for (const i of orphaned) {
      expect(i.title).toBe('Orphaned rent $1,200.00'); // unchanged
      expect(i.detail).toMatch(/Its account no longer exists, so it cannot be approved/);
      expect(i.status).toBe('open');
    }
    for (const i of healthy) expect(i.detail).not.toMatch(/no longer exists/);
  });

  it('orphanedRules finds a missing posting account or a missing transfer account, and nothing else', () => {
    const rs = [{ ...rule(1), id: 1 }, { ...rule(2), id: 2 }, { ...rule(1, { transferAccountId: 3 }), id: 3 }, { ...rule(1, { transferAccountId: null }), id: 4 }];
    expect(orphanedRules(rs, new Set([1])).map((r) => r.id)).toEqual([2, 3]);
    expect(orphanedRules(rs, new Set([1, 2, 3])).map((r) => r.id)).toEqual([]);
  });
});

describe('DI-01 backup and restore keep unresolved historical evidence', () => {
  it('9. an orphaned rule and an orphaned transaction survive export and restore unchanged: nothing is repaired or dropped', async () => {
    const d = fresh();
    const { checking } = await world(d);
    const r = await addRule(d, rule(checking));
    const orphanTxn = (await d.txns.add({ accountId: 424242, date: '2026-10-09', amountCents: -1800, payee: 'Old orphan', memo: '', status: 'pending', categoryId: null } as never)) as number;
    await d.accounts.delete(checking);
    const { file } = checkBackupText(JSON.stringify(await buildBackup(d)));
    const target = fresh();
    await target.open();
    await restoreChecked(target, file);
    expect((await target.recurring.toArray()).map((x) => [x.id, x.accountId])).toEqual([[r.id, checking]]);
    expect((await target.txns.get(orphanTxn))?.accountId).toBe(424242);
    expect(await target.accounts.count()).toBe(await d.accounts.count()); // the surviving account only
  });
});

describe('DI-01 two devices (real SyncEngine): a deletion on one, a Scheduled operation on the other', () => {
  function memoryRemote(): RemoteStore {
    let file: RemoteFile | null = null;
    let puts = 0;
    return {
      async getFile() { return file ? { sha: file.sha, bytes: file.bytes.slice() } : null; },
      async putFile(bytes, sha) {
        if ((file?.sha ?? undefined) !== sha) throw new RemoteConflict('stale');
        puts++;
        file = { sha: `sha${puts}`, bytes: bytes.slice() };
        return file.sha;
      },
    };
  }
  const device = (remote: RemoteStore) => { const d = fresh(); installTracking(d); return { d, engine: new SyncEngine(d, dexieMeta(`m-${n++}`), remote, 'test passphrase for scratch') }; };

  it('10. A deletes an account with no rules; B (not yet synced) schedules and approves an item on it; after syncing the account is gone on both, the rule remains, and approving again is refused on BOTH devices', async () => {
    const remote = memoryRemote();
    const A = device(remote);
    const B = device(remote);
    const { checking } = await world(A.d);
    await A.engine.initialUpload();
    await B.engine.replaceFromRemote();
    await new Promise((r) => setTimeout(r, 5));

    expect((await deleteAccountWithTransactions(A.d, checking)).ok).toBe(true); // allowed on A: A sees no rules
    const rB = await addRule(B.d, rule(checking, { payee: 'Added on B' })); // B, offline, still has the account
    const first = await postInstance(B.d, rB, '2026-10-01'); // valid on B at that moment
    expect(first).toBeGreaterThan(0);

    await A.engine.sync();
    await B.engine.sync();
    await A.engine.sync();

    for (const x of [A, B]) {
      expect(await x.d.accounts.get(checking)).toBeUndefined(); // the deletion stands on both
      expect((await x.d.recurring.toArray()).map((r) => r.payee)).toEqual(['Added on B']); // the rule arrived, unrepaired
      const before = await counts(x.d);
      await expect(postInstance(x.d, rB, '2026-11-01')).rejects.toBeInstanceOf(MissingAccountError); // the guard holds on each device
      expect(await counts(x.d)).toEqual(before);
    }
    // what the guard CANNOT undo: the one transaction B posted before it knew; it is visible and kept, not silently removed
    expect(await A.d.txns.get(first)).toMatchObject({ payee: 'Added on B', accountId: checking });
  });

  it('B schedules a rule on an account that A then tries to delete after syncing: A is blocked', async () => {
    const remote = memoryRemote();
    const A = device(remote);
    const B = device(remote);
    const { checking } = await world(A.d);
    await A.engine.initialUpload();
    await B.engine.replaceFromRemote();
    await addRule(B.d, rule(checking));
    await B.engine.sync();
    await A.engine.sync();
    expect((await deleteAccountWithTransactions(A.d, checking)).ok).toBe(false);
    expect(await A.d.accounts.get(checking)).toBeDefined();
  });
});
