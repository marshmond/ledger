import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FinanceDB } from '../db';
import { createStore } from '../core/store';
import { encryptText } from './backup';
import { BackupFileError, buildBackup, checkBackupText, prepareEncryptedRestore, restoreWithSafetyCopy } from './backupFile';
import { installTracking } from './sync/track';
import { createTask, getTask } from '../modules/tasks/data';
import { blankTask } from '../modules/tasks/model';
import { createProject } from '../modules/projects/data';
import { blankProject } from '../modules/projects/model';

/**
 * G1 pre-commit correction: the encrypted restore runs the SAME safety sequence as the plain restore:
 * decrypt and check -> (owner confirms in the page) -> safety copy of current data -> one-transaction restore -> preferences.
 * These tests drive the real pipeline (real encryption, real checker, real safety-copy writer, real restore). Only the browser download
 * call is replaced, so the test can read what would have been saved. All data is invented.
 */
const downloads: { name: string; text: string }[] = [];
let failDownload = false;
vi.mock('./download', () => ({
  downloadText: (name: string, _mime: string, text: string) => {
    if (failDownload) throw new Error('download blocked (injected)');
    downloads.push({ name, text });
  },
}));

let n = 0;
const fresh = () => { const d = new FinanceDB(`test-encrestore-${n++}`); installTracking(d); return d; };
const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m }; };
const PASS = 'a good passphrase';

/** Every table, without `updatedAt` (a restore re-stamps it by design). */
async function all(d: FinanceDB) {
  const out: Record<string, unknown[]> = {};
  for (const t of d.tables) out[t.name] = (await t.toArray()).map((r) => { const { updatedAt: _u, ...rest } = r as Record<string, unknown>; return rest; }).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return out;
}

async function household(d: FinanceDB, label: string) {
  const store = createStore(d);
  const project = await createProject(blankProject({ name: `${label} project`, budgetCents: 100000 }), d);
  const contact = await store.shared.contacts.put({ name: `${label} contact` } as never);
  const task = await createTask(blankTask({ title: `${label} task`, dueDate: '2026-11-10', contactIds: [contact], repeat: { mode: 'fixed', rule: { freq: 'weekly', interval: 1, end: { type: 'never' } } } }), [{ module: 'projects', id: project }], d);
  const acct = (await d.accounts.add({ name: `${label} checking`, kind: 'checking' } as never)) as number;
  await d.txns.add({ accountId: acct, date: '2026-10-20', amountCents: -2500, payee: `${label} store`, project: { projectId: project } } as never);
  return { project, contact, task, acct };
}

/** A real encrypted backup file's text, made from `src` the way the Export encrypted backup button does. */
async function encryptedBackupOf(src: FinanceDB, prefs?: ReturnType<typeof mem>, pass = PASS) {
  return encryptText(JSON.stringify(await buildBackup(src, prefs)), pass);
}

beforeEach(() => { downloads.length = 0; failDownload = false; vi.stubGlobal('localStorage', mem()); }); // a fresh in-memory browser storage per test

describe('encrypted restore safety sequence', () => {
  it('a valid encrypted restore first saves a Pre-Import copy of the CURRENT data, then replaces the data', async () => {
    const src = fresh(); const ids = await household(src, 'Backup');
    const text = await encryptedBackupOf(src);
    const target = fresh(); await household(target, 'Current');
    const { file } = await prepareEncryptedRestore(text, PASS);
    expect(downloads.length).toBe(0); // preparing changes and saves nothing
    const before = await all(target);

    let stateWhenCopyWasMade: unknown;
    const saved = await restoreWithSafetyCopy(target, file, {
      saveCopy: async (d) => { stateWhenCopyWasMade = await all(d); return 'copy'; }, // runs before the database is touched
      storage: mem(),
    });
    expect(saved).toBe('copy');
    expect(stateWhenCopyWasMade).toEqual(before);
    expect((await getTask(ids.task, target))!.data.title).toBe('Backup task');
  }, 30000);

  it('uses the real Pre-Import writer: one plain file named Pre-Import holding the current data', async () => {
    const src = fresh(); await household(src, 'Backup');
    const text = await encryptedBackupOf(src);
    const target = fresh(); await household(target, 'Current');
    const { file } = await prepareEncryptedRestore(text, PASS);
    const name = await restoreWithSafetyCopy(target, file, { storage: mem() });
    expect(downloads.length).toBe(1);
    expect(downloads[0].name).toBe(name);
    expect(downloads[0].name).toMatch(/^Ledger Pre-Import /);
    expect(downloads[0].text).toContain('Current task');
    expect(downloads[0].text).not.toContain('Backup task');
    expect(() => checkBackupText(downloads[0].text)).not.toThrow(); // and it is itself a valid, restorable backup
  }, 30000);

  it('if the safety copy cannot be started, nothing is replaced (records and preferences unchanged)', async () => {
    const src = fresh(); await household(src, 'Backup');
    const text = await encryptedBackupOf(src);
    const target = fresh(); await household(target, 'Current');
    const { file } = await prepareEncryptedRestore(text, PASS);
    const before = await all(target);
    const prefs = mem(); prefs.setItem('ledger-theme', 'light');
    failDownload = true; // the real savePreImportCopy runs and its download throws
    await expect(restoreWithSafetyCopy(target, file, { storage: prefs })).rejects.toThrow(/download blocked/);
    expect(await all(target)).toEqual(before);
    expect(prefs.getItem('ledger-theme')).toBe('light');
    // and an injected failure of the saver itself behaves the same
    await expect(restoreWithSafetyCopy(target, file, { saveCopy: async () => { throw new Error('no space'); }, storage: prefs })).rejects.toThrow(/no space/);
    expect(await all(target)).toEqual(before);
  }, 30000);

  it('a wrong passphrase is refused before anything else happens: no copy, no change', async () => {
    const src = fresh(); await household(src, 'Backup');
    const text = await encryptedBackupOf(src);
    const target = fresh(); await household(target, 'Current');
    const before = await all(target);
    await expect(prepareEncryptedRestore(text, 'the wrong passphrase')).rejects.toThrow(/Wrong passphrase.*Nothing was changed/);
    await expect(prepareEncryptedRestore(text, 'the wrong passphrase')).rejects.toBeInstanceOf(BackupFileError);
    expect(downloads.length).toBe(0);
    expect(await all(target)).toEqual(before);
  }, 30000);

  it('not an encrypted file, or content that fails the plain checks, is refused before any destructive step', async () => {
    const target = fresh(); await household(target, 'Current');
    const before = await all(target);
    const src = fresh(); await household(src, 'Backup');
    const good = JSON.parse(JSON.stringify(await buildBackup(src))) as Record<string, unknown[]> & Record<string, unknown>;

    const bad: Record<string, string> = {
      'not json': 'this is not json',
      'a plain backup pasted in the encrypted box': JSON.stringify(good),
      'json but not an envelope': '{"hello":1}',
    };
    for (const [why, text] of Object.entries(bad)) await expect(prepareEncryptedRestore(text, PASS), why).rejects.toBeInstanceOf(BackupFileError);

    const incomplete = { ...good, txns: good.txns.slice(0, 0) }; // contents list says 1
    const future = { ...good, version: 99, schemaVersion: 99 };
    const unknownSection = { ...good, petRecords: [{ id: 1 }] };
    const duplicate = { ...good, accounts: [...good.accounts, ...good.accounts] };
    const notBackup = { hello: 'world' };
    for (const [why, content] of Object.entries({ incomplete, future, unknownSection, duplicate, notBackup })) {
      const enveloped = await encryptText(JSON.stringify(content), PASS);
      await expect(prepareEncryptedRestore(enveloped, PASS), why).rejects.toBeInstanceOf(BackupFileError);
    }
    await expect(prepareEncryptedRestore(await encryptText('not json inside', PASS), PASS)).rejects.toBeInstanceOf(BackupFileError);
    expect(downloads.length).toBe(0);
    expect(await all(target)).toEqual(before);
  }, 60000);

  it('a failure injected halfway through the database restore rolls back every table', async () => {
    const src = fresh(); await household(src, 'Backup');
    const text = await encryptedBackupOf(src);
    const target = fresh(); await household(target, 'Current');
    const { file } = await prepareEncryptedRestore(text, PASS);
    const before = await all(target);
    const prefs = mem(); prefs.setItem('ledger-theme', 'light');
    const spy = vi.spyOn(target.moduleRecords, 'bulkAdd').mockRejectedValueOnce(new Error('disk full (injected)')); // the last table written
    await expect(restoreWithSafetyCopy(target, file, { storage: prefs })).rejects.toThrow(/injected/);
    spy.mockRestore();
    expect(await all(target)).toEqual(before);
    expect(prefs.getItem('ledger-theme')).toBe('light'); // preferences only follow a committed restore
    expect(downloads.length).toBe(1); // the safety copy had already been started, which is the point of making it first
    expect(downloads[0].text).toContain('Current task');
  }, 30000);

  it('a successful encrypted restore keeps module records, links, recurrence, money references and the allowed preferences', async () => {
    const src = fresh(); const ids = await household(src, 'Backup');
    const srcPrefs = mem(); srcPrefs.setItem('ledger-theme', 'dark'); srcPrefs.setItem('ledger-palette', JSON.stringify({ id: 'teal' })); srcPrefs.setItem('ledger-sync-config', 'SECRET-TOKEN');
    const text = await encryptedBackupOf(src, srcPrefs);
    const target = fresh(); await household(target, 'Current');
    const targetPrefs = mem(); targetPrefs.setItem('ledger-theme', 'light');
    const { file } = await prepareEncryptedRestore(text, PASS);
    await restoreWithSafetyCopy(target, file, { storage: targetPrefs });

    expect(await all(target)).toEqual(await all(src));
    const t = (await getTask(ids.task, target))!;
    expect(t.data.repeat).toMatchObject({ mode: 'fixed', rule: { freq: 'weekly', interval: 1 } });
    expect(t.data.contactIds).toEqual([ids.contact]);
    expect(await target.links.where('[toModule+toId]').equals(['projects', ids.project]).count()).toBe(1);
    expect((await target.txns.toArray())[0].project).toEqual({ projectId: ids.project });
    expect(targetPrefs.getItem('ledger-theme')).toBe('dark');
    expect(JSON.parse(targetPrefs.getItem('ledger-palette')!)).toEqual({ id: 'teal' });
    expect(targetPrefs.getItem('ledger-sync-config')).toBeNull();
  }, 30000);

  it('the safety copy and the encrypted file never contain credentials', async () => {
    const src = fresh(); await household(src, 'Backup');
    const target = fresh(); await household(target, 'Current');
    await target.settings.put({ key: 'priceApiKey', value: 'DEVICE-ONLY-KEY' });
    localStorage.setItem('ledger-sync-config', 'SECRET-SYNC-TOKEN');
    localStorage.setItem('ledger-autobackup', 'SECRET-WEEKLY-PASSPHRASE');
    const { file } = await prepareEncryptedRestore(await encryptedBackupOf(src), PASS);
    await restoreWithSafetyCopy(target, file, { storage: mem() });
    expect(downloads.length).toBe(1);
    for (const secret of ['DEVICE-ONLY-KEY', 'SECRET-SYNC-TOKEN', 'SECRET-WEEKLY-PASSPHRASE', 'priceApiKey']) expect(downloads[0].text).not.toContain(secret);
    expect((await target.settings.get('priceApiKey'))!.value).toBe('DEVICE-ONLY-KEY'); // the device keeps its own key through the restore
  }, 30000);

  it('plain restore still works exactly as before through the same sequence', async () => {
    const src = fresh(); const ids = await household(src, 'Backup');
    const plain = JSON.stringify(await buildBackup(src));
    const target = fresh(); await household(target, 'Current');
    const { file } = checkBackupText(plain);
    const name = await restoreWithSafetyCopy(target, file, { storage: mem() });
    expect(downloads.map((d) => d.name)).toEqual([name]);
    expect(downloads[0].text).toContain('Current task');
    expect(await all(target)).toEqual(await all(src));
    expect((await getTask(ids.task, target))!.data.title).toBe('Backup task');
    // and a plain restore whose safety copy fails also changes nothing
    const before = await all(target);
    failDownload = true;
    await expect(restoreWithSafetyCopy(target, checkBackupText(JSON.stringify(await buildBackup(fresh()))).file, { storage: mem() })).rejects.toThrow(/download blocked/);
    expect(await all(target)).toEqual(before);
  }, 30000);
});
