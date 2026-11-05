import { describe, expect, it } from 'vitest';
import { FinanceDB } from '../db';
import { exportAll, importAll } from './backup';
import { checkBackupText } from './backupFile';
import { snapshotOf } from './sync/engine';

/**
 * Guard: every table in the database must be in the backup, in the file checker and in the sync snapshot.
 * If you add a table to db.ts and forget a backup list, this fails. All data here is invented.
 */
let n = 0;
const fresh = () => new FinanceDB(`test-coverage-${n++}`);
const names = () => fresh().tables.map((t) => t.name);

const sampleRow = (table: string, i: number) => (table === 'settings' ? { key: 'sample-key', value: 'v' } : { id: 1000 + i, updatedAt: 5, sample: `row-${table}` });

async function filled() {
  const d = fresh();
  await d.open();
  for (const [i, t] of d.tables.entries()) await t.add(sampleRow(t.name, i) as never);
  return d;
}

describe('backup covers every table', () => {
  it('the export has a list for every table', async () => {
    const d = await filled();
    const file = (await exportAll(d)) as unknown as Record<string, unknown>;
    for (const t of names()) expect(Array.isArray(file[t]), `exportAll is missing table "${t}"`).toBe(true);
  });

  it('the file checker knows every table (so none is dropped when a file is read)', async () => {
    const d = await filled();
    const text = JSON.stringify(await exportAll(d));
    const { file } = checkBackupText(text);
    for (const t of names()) expect((file as unknown as Record<string, unknown[]>)[t].length, `"${t}" lost in the file checker`).toBe(1);
  });

  it('one row in every table survives export and restore into an empty database', async () => {
    const d = await filled();
    const text = JSON.stringify(await exportAll(d));
    const target = fresh();
    await target.open();
    await importAll(target, checkBackupText(text).file);
    for (const t of target.tables) {
      expect(await t.toArray(), `table "${t.name}" did not round-trip`).toEqual(await d.table(t.name).toArray());
    }
  });

  it('the sync snapshot walks every table', async () => {
    const d = await filled();
    const snap = await snapshotOf(d);
    for (const t of names()) expect(Object.keys(snap.tables[t] ?? {}).length, `sync is missing "${t}"`).toBe(1);
  });

  it('an old version-1 file (only the first five lists) restores with everything else empty', async () => {
    const old = { version: 1, exportedAt: 'x', accounts: [], categoryGroups: [], categories: [], txns: [], importBatches: [] };
    const target = await filled();
    await importAll(target, checkBackupText(JSON.stringify(old)).file);
    for (const t of target.tables) expect(await t.count(), `"${t.name}" should be empty`).toBe(0);
  });
});
