import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { decryptText, encryptText, exportAll, importAll, type BackupFile } from '../lib/backup';
import { storageStatus, type StorageStatus } from '../pwa';
import { readConfig } from '../lib/sync/auto';
import { touchAll } from '../lib/sync/track';
import { Link } from 'react-router-dom';
import { PageHeader } from '../ui/components';
import {
  AUTO_BACKUP_KEEP, AUTO_BACKUP_MIN_PASSPHRASE, autoBackupNow, clearAutoBackup, readAutoBackup, readAutoStatus, saveAutoBackup,
} from '../lib/autoBackup';
import { BACKUP_DIR as AUTO_BACKUP_DIR } from '../lib/sync/github';

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

/** Weekly encrypted copies in the private GitHub repository that Sync uses, under a passphrase of their own. */
function AutoBackupCard() {
  const sync = readConfig();
  const [cfg, setCfg] = useState(readAutoBackup());
  const [status, setStatus] = useState(readAutoStatus());
  const [pass, setPass] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  if (!sync) {
    return (
      <div className="card">
        <strong>Automatic weekly backup</strong>
        <p className="muted">
          This saves a dated, encrypted copy of your data to the private GitHub repository once a week, so you always have older copies to go back to.
          It needs <Link to="/sync">Sync devices</Link> to be set up first.
        </p>
      </div>
    );
  }

  function turnOn() {
    setErr('');
    if (pass.length < AUTO_BACKUP_MIN_PASSPHRASE) return setErr(`Use a passphrase of at least ${AUTO_BACKUP_MIN_PASSPHRASE} characters. You cannot recover the backups without it.`);
    if (pass !== again) return setErr('The two passphrases are different.');
    if (cfg && cfg.passphrase !== pass && !confirm('Copies already saved stay locked with the OLD passphrase, so keep it. Change to the new one?')) return;
    saveAutoBackup({ passphrase: pass });
    setCfg({ passphrase: pass });
    setPass('');
    setAgain('');
  }

  async function backUpNow() {
    setBusy(true);
    setErr('');
    setStatus(await autoBackupNow({ force: true }));
    setBusy(false);
  }

  return (
    <div className="card">
      <strong>Automatic weekly backup</strong>
      <p className="muted">
        About once a week, when the app is open, an encrypted copy is saved to the <code>{AUTO_BACKUP_DIR}</code> folder of your private GitHub repository ({sync.owner}/{sync.repo}).
        The last {AUTO_BACKUP_KEEP} copies are kept. It uses its own passphrase, saved in this browser only. Write it down: it cannot be recovered, and each device that should back up needs it entered.
      </p>
      {cfg ? (
        <>
          <p className={status.error ? 'warn' : 'muted'}>
            {status.day ? `Newest copy in the repository: ${status.day}.` : 'No automatic copy has been made from this device yet.'}
            {status.error && ` The last try failed: ${status.error}`}
          </p>
          <div className="row">
            <button className="primary" disabled={busy} onClick={backUpNow}>{busy ? 'Backing up…' : 'Back up now'}</button>
            <button onClick={() => { clearAutoBackup(); setCfg(null); }}>Turn off on this device</button>
          </div>
          <details style={{ marginTop: 8 }}>
            <summary>Change the passphrase</summary>
            <div className="row">
              <label className="f">New passphrase<input type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="off" /></label>
              <label className="f">Again<input type="password" value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="off" /></label>
              <button onClick={turnOn}>Change</button>
            </div>
          </details>
          <p className="muted" style={{ fontSize: '0.85rem' }}>To restore a copy, download it from the repository on GitHub and use “Restore from backup” above with this passphrase.</p>
        </>
      ) : (
        <div className="row">
          <label className="f">Passphrase<input type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="off" /></label>
          <label className="f">Again<input type="password" value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="off" /></label>
          <button className="primary" onClick={turnOn}>Turn on automatic backups</button>
        </div>
      )}
      {err && <div className="error">{err}</div>}
    </div>
  );
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

      <AutoBackupCard />

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
