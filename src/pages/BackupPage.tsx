import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { decryptText, encryptText, exportAll, importAll, type BackupFile } from '../lib/backup';
import { storageStatus, type StorageStatus } from '../pwa';
import { readConfig } from '../lib/sync/auto';
import { touchAll } from '../lib/sync/track';
import { Link } from 'react-router-dom';
import { PageHeader } from '../ui/components';

/** Backups older than this trigger a reminder on the Accounts page. */
export const BACKUP_STALE_DAYS = 30;

async function saveOrShare(name: string, text: string): Promise<'shared' | 'downloaded'> {
  const file = new File([text], name, { type: 'application/json' });
  // On phones, the share sheet lets you save to Files / iCloud Drive / Google Drive. Elsewhere, download.
  const touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  if (touch && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Ledger backup' });
      return 'shared';
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') throw e; // user closed the sheet
    }
  }
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
  return 'downloaded';
}

export default function BackupPage() {
  const [pass, setPass] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [storage, setStorage] = useState<StorageStatus | null>(null);
  const last = (useLiveQuery(() => db.settings.get('lastBackup'), []) as { value?: string } | undefined)?.value;

  useEffect(() => { storageStatus().then(setStorage); }, []);

  async function doExport() {
    setMsg('');
    setErr('');
    if (pass.length < 8) return setErr('Use a passphrase of at least 8 characters. You cannot recover the backup without it.');
    try {
      const text = await encryptText(JSON.stringify(await exportAll(db)), pass);
      const how = await saveOrShare(`ledger-${new Date().toISOString().slice(0, 10)}.ledgerbackup`, text);
      await db.settings.put({ key: 'lastBackup', value: new Date().toISOString() });
      setMsg(how === 'shared' ? 'Encrypted backup shared.' : 'Encrypted backup downloaded.');
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) setErr(e instanceof Error ? e.message : String(e));
    }
  }

  async function doImport(f: File | undefined) {
    setMsg('');
    setErr('');
    if (!f) return;
    if (!pass) return setErr('Enter the passphrase used for this backup first.');
    if (!confirm(readConfig() ? 'This REPLACES all data in this browser with the backup, and because sync is on it will replace the data on your other devices too. Continue?' : 'This REPLACES all data in this browser with the backup. Continue?')) return;
    try {
      const data = JSON.parse(await decryptText(await f.text(), pass)) as BackupFile;
      await importAll(db, data);
      if (readConfig()) await touchAll(db); // so the restored data wins when this device syncs
      setMsg('Backup restored.');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  const days = last ? Math.floor((Date.now() - Date.parse(last)) / 86400000) : null;

  return (
    <>
      <PageHeader title="Backup" description="Keep a safe copy: your data lives only in this browser." />
      <div className="card">
        <p>
          Your data lives only in this browser on this device. Clearing site data, uninstalling the browser, or switching browsers erases it, so
          export a backup regularly. Backups are encrypted with your passphrase; keep the passphrase somewhere safe, because there is no way to recover it.
        </p>
        <p className={days === null || days > BACKUP_STALE_DAYS ? 'warn' : 'muted'}>
          {last ? `Last backup: ${new Date(last).toLocaleString()} (${days === 0 ? 'today' : `${days} day${days === 1 ? '' : 's'} ago`}).` : 'You have not exported a backup from this device yet.'}
        </p>
        <div className="row">
          <label className="f">Passphrase
            <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="off" />
          </label>
          <button className="primary" onClick={doExport}>Export encrypted backup</button>
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <label className="f">Restore from backup (replaces everything on this device)
            <input type="file" accept=".ledgerbackup,application/json" onChange={(e) => doImport(e.target.files?.[0])} />
          </label>
        </div>
        {msg && <div className="ok">{msg}</div>}
        {err && <div className="error">{err}</div>}
      </div>

      <div className="card">
        <strong>Using it on your phone and your computer</strong>
        <p className="muted">
          Each device keeps its own copy of your data. To keep them in step automatically, turn on <Link to="/sync">Sync devices</Link>. Without it, move data by exporting a backup
          on one device and restoring it on the other (a restore replaces what is on that device). The price-data key is never included in backups or sync and stays on each device.
        </p>
      </div>

      <div className="card">
        <strong>Storage protection</strong>
        <p className="muted">
          {storage?.persisted === true && 'This browser has agreed to keep your data unless you clear it yourself.'}
          {storage?.persisted === false && 'This browser may clear this site’s data if the device runs low on space. Installing the app to your home screen and keeping regular backups protects you.'}
          {storage?.persisted === null && 'This browser does not report storage protection. Keep regular backups.'}
          {storage?.usedBytes != null && ` Currently using about ${(storage.usedBytes / 1024).toFixed(0)} KB.`}
        </p>
        {storage?.persisted === false && (
          <button onClick={async () => { await navigator.storage?.persist?.(); setStorage(await storageStatus()); }}>Ask the browser to protect it</button>
        )}
      </div>
    </>
  );
}
