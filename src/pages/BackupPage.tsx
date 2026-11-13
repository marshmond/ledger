import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { encryptText } from '../lib/backup';
import { storageStatus, type StorageStatus } from '../pwa';
import { readConfig } from '../lib/sync/auto';
import { touchAll } from '../lib/sync/track';
import { Link } from '../core/router';
import PlainBackupCard, { RestoreConfirm } from './PlainBackupCard';
import { buildBackup, localDay, prepareEncryptedRestore, recordBackup, restoreWithSafetyCopy, type BackupSummary } from '../lib/backupFile';
import type { BackupFile } from '../lib/backup';
import { PageHeader } from '../ui/components';
import ConfirmDialog from '../shell/ConfirmDialog';
import {
  AUTO_BACKUP_KEEP, AUTO_BACKUP_MIN_PASSPHRASE, autoBackupNow, clearAutoBackup, readAutoBackup, readAutoStatus, saveAutoBackup,
} from '../lib/autoBackup';
import { BACKUP_DIR as AUTO_BACKUP_DIR } from '../lib/sync/github';
import { Pill, SettingsSection, SubHeading } from './SettingsParts';

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
  const [askChange, setAskChange] = useState(false);

  if (!sync) {
    return (
      <SettingsSection id="auto-backup" title="Automatic weekly backup" badge={<Pill tone="quiet">Needs Sync devices first</Pill>}>
        <p className="muted">
          This saves a dated, encrypted copy of your data to the private GitHub repository once a week, so you always have older copies to go back to.
          It needs <Link to="/sync">Sync devices</Link> to be set up first.
        </p>
      </SettingsSection>
    );
  }

  function turnOn() {
    setErr('');
    if (pass.length < AUTO_BACKUP_MIN_PASSPHRASE) return setErr(`Use a passphrase of at least ${AUTO_BACKUP_MIN_PASSPHRASE} characters. You cannot recover the backups without it.`);
    if (pass !== again) return setErr('The two passphrases are different.');
    // Replacing a working passphrase gets a real question first (the old copies stay locked with the old one). The new passphrase is never shown in it.
    if (cfg && cfg.passphrase !== pass) return setAskChange(true);
    applyPassphrase();
  }

  function applyPassphrase() {
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
    <SettingsSection id="auto-backup" title="Automatic weekly backup" badge={cfg ? <Pill tone={status.error ? 'bad' : 'ok'}>{status.error ? 'Last try failed' : 'On for this device'}</Pill> : <Pill tone="warn">Off on this device</Pill>}>
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
          <details className="se-details">
            <summary>Change the passphrase</summary>
            <div className="row">
              <label className="f">New passphrase<input type="password" aria-invalid={err ? true : undefined} aria-describedby={err ? 'auto-backup-error' : undefined} value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="off" /></label>
              <label className="f">Again<input type="password" aria-invalid={err ? true : undefined} aria-describedby={err ? 'auto-backup-error' : undefined} value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="off" /></label>
              <button onClick={turnOn}>Change</button>
            </div>
          </details>
          <p className="muted small">To restore a copy, download it from the repository on GitHub and use “Restore from backup” above with this passphrase.</p>
        </>
      ) : (
        <div className="row">
          <label className="f">Passphrase<input type="password" aria-invalid={err ? true : undefined} aria-describedby={err ? 'auto-backup-error' : undefined} value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="off" /></label>
          <label className="f">Again<input type="password" aria-invalid={err ? true : undefined} aria-describedby={err ? 'auto-backup-error' : undefined} value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="off" /></label>
          <button className="primary" onClick={turnOn}>Turn on automatic backups</button>
        </div>
      )}
      {err && <div className="error" id="auto-backup-error" role="alert">{err}</div>}
      {askChange && (
        <ConfirmDialog
          title="Change the backup passphrase?"
          tone="primary"
          confirmLabel="Change passphrase"
          onCancel={() => setAskChange(false)}
          onConfirm={() => { applyPassphrase(); setAskChange(false); }}
        >
          <p>Copies already saved in your repository stay locked with the <strong>old</strong> passphrase, so keep it somewhere safe. New copies will use the new one.</p>
        </ConfirmDialog>
      )}
    </SettingsSection>
  );
}

export default function BackupPage() {
  const [pass, setPass] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [storage, setStorage] = useState<StorageStatus | null>(null);
  const last = (useLiveQuery(() => db.settings.get('lastBackup'), []) as { value?: string } | undefined)?.value;
  // Which half of the encrypted card the last action belongs to, so its message appears beside the button that caused it. Display only.
  const [zone, setZone] = useState<'create' | 'restore'>('create');

  useEffect(() => { storageStatus().then(setStorage); }, []);

  async function doExport() {
    setZone('create');
    setMsg('');
    setErr('');
    if (pass.length < 8) return setErr('Use a passphrase of at least 8 characters. You cannot recover the backup without it.');
    try {
      const text = await encryptText(JSON.stringify(await buildBackup(db)), pass);
      const how = await saveOrShare(`ledger-${localDay()}.ledgerbackup`, text);
      await db.settings.put({ key: 'lastBackup', value: new Date().toISOString() });
      recordBackup(); // this device's reminder clock
      setMsg(how === 'shared' ? 'Encrypted backup shared.' : 'Encrypted backup downloaded.');
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) setErr(e instanceof Error ? e.message : String(e));
    }
  }

  // Encrypted restore, same order as the plain one: decrypt and check -> confirm -> safety copy of current data -> one-transaction restore.
  const [pending, setPending] = useState<{ file: BackupFile; summary: BackupSummary; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [fileKey, setFileKey] = useState(0);

  async function doImport(f: File | undefined) {
    setZone('restore');
    setMsg('');
    setErr('');
    setPending(null);
    if (!f) return;
    if (!pass) { setFileKey((k) => k + 1); return setErr('Enter the passphrase used for this backup first.'); }
    try {
      const { file, summary } = await prepareEncryptedRestore(await f.text(), pass);
      setPending({ file, summary, name: f.name });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setFileKey((k) => k + 1);
    }
  }

  async function replaceFromEncrypted() {
    if (!pending) return;
    setZone('restore');
    setBusy(true); setErr(''); setMsg('');
    try {
      const saved = await restoreWithSafetyCopy(db, pending.file, { afterCopy: () => new Promise((r) => setTimeout(r, 1200)) });
      if (readConfig()) await touchAll(db); // so the restored data wins when this device syncs
      sessionStorage.setItem('ledger-restored', saved);
      location.reload();
    } catch (e) {
      setBusy(false);
      setErr(`The restore did not finish, and your existing data was left as it was. (${e instanceof Error ? e.message : String(e)})`);
    }
  }

  const days = last ? Math.floor((Date.now() - Date.parse(last)) / 86400000) : null;

  const stale = days === null || days > BACKUP_STALE_DAYS;

  return (
    <>
      <PageHeader title="Data & Backups" description="Keep a safe copy: your data lives only in this browser. This page covers all of Ledger, not just Finance." />

      <SettingsSection id="status" title="Backup status" tone={stale ? 'warn' : 'default'}
        badge={<Pill tone={stale ? 'warn' : 'ok'}>{last ? (stale ? 'Backup is getting old' : 'Backed up recently') : 'No backup yet'}</Pill>}>
        <p className={stale ? 'warn se-flat' : 'muted se-flat'}>
          {last ? `Last backup: ${new Date(last).toLocaleString()} (${days === 0 ? 'today' : `${days} day${days === 1 ? '' : 's'} ago`}).` : 'You have not exported a backup from this device yet.'}
        </p>
        <p className="muted small">Making a backup never changes your data. <strong>Restoring</strong> a backup does: it replaces everything on this device. The two are kept apart below, on each backup type.</p>
      </SettingsSection>

      <PlainBackupCard />

      <SettingsSection id="encrypted-backup" title="Encrypted backup (optional)" badge={<Pill tone="ok">Needs your passphrase</Pill>}>
        <div className="se-zone">
          <SubHeading>Make an encrypted backup</SubHeading>
          <p>
            Your data lives only in this browser on this device. Clearing site data, uninstalling the browser, or switching browsers erases it, so
            export a backup regularly. Backups are encrypted with your passphrase; keep the passphrase somewhere safe, because there is no way to recover it.
          </p>
          <p className={days === null || days > BACKUP_STALE_DAYS ? 'warn' : 'muted'}>
            {last ? `Last backup: ${new Date(last).toLocaleString()} (${days === 0 ? 'today' : `${days} day${days === 1 ? '' : 's'} ago`}).` : 'You have not exported a backup from this device yet.'}
          </p>
          <div className="row">
            <label className="f">Passphrase
              <input type="password" aria-invalid={err ? true : undefined} aria-describedby={err ? 'backup-error' : undefined} value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="off" />
            </label>
            <button className="primary" onClick={doExport}>Export encrypted backup</button>
          </div>
          {zone === 'create' && msg && <div className="ok" role="status">{msg}</div>}
          {zone === 'create' && err && <div className="error" id="backup-error" role="alert">{err}</div>}
        </div>

        <div className="se-zone se-zone--restore">
          <div className="se-zone-head">
            <SubHeading>Restore an encrypted backup</SubHeading>
            <Pill tone="bad">Replaces everything on this device</Pill>
          </div>
          <p className="muted small">Enter the passphrase above first. The file is decrypted and checked, you see what is in it, and nothing changes until you confirm.</p>
          <div className="row">
            <label className="f">Restore an encrypted backup (replaces everything on this device)
              <input key={fileKey} id="encrypted-restore-file" type="file" accept=".ledgerbackup,application/json" disabled={busy} onChange={(e) => doImport(e.target.files?.[0])} />
            </label>
          </div>
          {pending && <RestoreConfirm encrypted pending={pending} busy={busy} onConfirm={replaceFromEncrypted} onCancel={() => { setPending(null); setFileKey((k) => k + 1); setTimeout(() => document.getElementById('encrypted-restore-file')?.focus(), 0); }} />}
          {zone === 'restore' && msg && <div className="ok" role="status">{msg}</div>}
          {zone === 'restore' && err && <div className="error" id="backup-error" role="alert">{err}</div>}
        </div>
      </SettingsSection>

      <AutoBackupCard />

      <SettingsSection id="devices" title="Using it on your phone and your computer">
        <p className="muted">
          Each device keeps its own copy of your data. To keep them in step automatically, turn on <Link to="/sync">Sync devices</Link>. Without it, move data by exporting a backup
          on one device and restoring it on the other (a restore replaces what is on that device). The price-data key is never included in backups or sync and stays on each device.
        </p>
      </SettingsSection>

      <SettingsSection id="storage" title="Storage protection"
        badge={!storage ? undefined : storage.persisted === true ? <Pill tone="ok">Protected</Pill> : storage.persisted === false ? <Pill tone="warn">Not protected</Pill> : <Pill tone="quiet">Not reported</Pill>}>
        <p className="muted">
          {storage?.persisted === true && 'This browser has agreed to keep your data unless you clear it yourself.'}
          {storage?.persisted === false && 'This browser may clear this site’s data if the device runs low on space. Installing the app to your home screen and keeping regular backups protects you.'}
          {storage?.persisted === null && 'This browser does not report storage protection. Keep regular backups.'}
          {storage?.usedBytes != null && ` Currently using about ${(storage.usedBytes / 1024).toFixed(0)} KB.`}
        </p>
        {storage?.persisted === false && (
          <button onClick={async () => { await navigator.storage?.persist?.(); setStorage(await storageStatus()); }}>Ask the browser to protect it</button>
        )}
      </SettingsSection>
    </>
  );
}
