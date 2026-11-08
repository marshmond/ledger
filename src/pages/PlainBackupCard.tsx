import { useEffect, useRef, useState } from 'react';
import { db } from '../db';
import { readConfig } from '../lib/sync/auto';
import { touchAll } from '../lib/sync/track';
import {
  APP_VERSION, BackupFileError, CURRENT_SCHEMA_VERSION, checkBackupText, exportBackupNow, readMeta, recordBackup, restoreWithSafetyCopy, writeMeta, localDay,
  type BackupSummary,
} from '../lib/backupFile';
import type { BackupFile } from '../lib/backup';
import { PRIVACY_WARNING, summarizeBackup, type SummaryGroup } from '../lib/backupSummary';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Export and restore as one plain JSON file: no passphrase. */
export default function PlainBackupCard() {
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{ file: BackupFile; summary: BackupSummary; name: string } | null>(null);
  const [fileKey, setFileKey] = useState(0); // changing it empties the file chooser
  const [saved, setSaved] = useState<SummaryGroup[] | null>(null);

  async function doExport() {
    setMsg(''); setErr(''); setSaved(null);
    try {
      const name = await exportBackupNow(db, (f) => setSaved(summarizeBackup(f)));
      if (name) setMsg(`Saved “${name}” (check your Downloads folder).`);
      else setSaved(null);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }

  async function choose(f: File | undefined) {
    setMsg(''); setErr(''); setPending(null);
    if (!f) return;
    try {
      const { file, summary } = checkBackupText(await f.text());
      setPending({ file, summary, name: f.name });
    } catch (e) {
      setErr(e instanceof BackupFileError ? e.message : 'This file could not be read as a Ledger backup. Nothing was changed.');
      setFileKey((k) => k + 1);
    }
  }

  async function replace() {
    if (!pending) return;
    setBusy(true); setErr(''); setMsg('');
    try {
      // Safety copy first (if it fails nothing is touched), then the one-transaction restore. Same sequence as the encrypted restore.
      const saved = await restoreWithSafetyCopy(db, pending.file, { afterCopy: () => sleep(1200) }); // the pause lets the browser start the download before the page reloads
      if (readConfig()) await touchAll(db); // so the restored data wins when this device syncs
      sessionStorage.setItem('ledger-restored', saved);
      location.reload();
    } catch (e) {
      setBusy(false);
      setErr(`The restore did not finish, and your existing data was left as it was. (${e instanceof Error ? e.message : String(e)})`);
    }
  }

  // Set just before the reload that follows a restore; read once so the confirmation shows after the page comes back.
  const [restored] = useState(() => {
    try {
      const v = sessionStorage.getItem('ledger-restored');
      if (v) sessionStorage.removeItem('ledger-restored');
      return v;
    } catch { return null; }
  });

  // Testing aid for the 10-day reminder: moves the recorded "last backup" back in time. Changes no financial data.
  const [fake, setFake] = useState(() => readMeta().lastBackupAt);
  function pretend(daysAgo: number | null) {
    if (daysAgo === null) { recordBackup(); setFake(readMeta().lastBackupAt); return; }
    const d = new Date(); d.setDate(d.getDate() - daysAgo);
    writeMeta({ lastBackupAt: d.toISOString(), dismissedDay: undefined });
    setFake(d.toISOString());
  }

  const w = pending?.summary;
  return (
    <div className="card">
      <h3 style={{ margin: 0 }}>Back up Ledger data</h3>
      <p className="muted">
        One file holds everything Ledger keeps in this browser: Finance, Tasks &amp; Calendar, Projects, Home &amp; Assets, Household Services, contacts, tags and links
        between records, plus your settings and look-and-feel choices (colors, light/dark, layout). It is saved as a readable file named like “Ledger Backup {fmtToday()}.json”,
        normally in your Downloads folder.
      </p>
      <div className="banner warn" style={{ display: 'block' }} role="note"><strong>{PRIVACY_WARNING}</strong> This file is NOT encrypted. It can include serial numbers, vehicle identification numbers, plates and addresses saved in Home &amp; Assets. For an encrypted copy, use “Encrypted backup” below.</div>
      <details style={{ marginTop: 8 }}>
        <summary>What is and is not in a backup</summary>
        <ul className="plain">
          <li><strong>Included:</strong> every record in every module, including deleted-record markers, and the colors, light/dark and layout choices kept in this browser.</li>
          <li><strong>Web addresses and file names only:</strong> documents you attach or link are NOT inside the backup. Keep the original files wherever they are stored.</li>
          <li><strong>Never included:</strong> the price-lookup key, the sync token and passphrase, and the weekly-backup passphrase. They stay on each device, so after restoring on a new device you set them up again.</li>
          <li><strong>Not the same as sync:</strong> sync keeps devices in step; it is not a backup. This file is the copy you control.</li>
        </ul>
        <p className="muted small">Which choices follow you to other devices and which stay on one: see Settings &gt; General.</p>
        <p className="muted small">File format: data version {CURRENT_SCHEMA_VERSION}, written by Ledger {APP_VERSION}. Older files are upgraded automatically; files from a newer Ledger are refused before anything changes.</p>
      </details>
      {restored && <div className="ok" role="status">Backup restored. Your previous data was saved first as “{restored}”.</div>}
      <div className="row" style={{ marginTop: 8 }}>
        <button className="primary" onClick={doExport} disabled={busy}>Export backup</button>
      </div>
      {saved && <SummaryList title="What this backup contains" groups={saved} />}

      <h3 style={{ margin: '16px 0 0' }}>Restore Ledger data</h3>
      <div className="row">
        <label className="f">Choose a backup file (replaces everything on this device)
          <input key={fileKey} id="plain-restore-file" type="file" accept=".json,application/json" disabled={busy} onChange={(e) => choose(e.target.files?.[0])} />
        </label>
      </div>

      {w && pending && <RestoreConfirm pending={pending} busy={busy} onConfirm={replace} onCancel={() => { setPending(null); setFileKey((k) => k + 1); setTimeout(() => document.getElementById('plain-restore-file')?.focus(), 0); }} />}

      {msg && <div className="ok" role="status">{msg}</div>}
      {err && <div className="error" role="alert">{err}</div>}

      <details style={{ marginTop: 12 }}>
        <summary>Testing tools (for checking the backup reminder)</summary>
        <p className="muted">
          These only change the date this device has on record for its last backup. They do not touch your money data. Current record:
          {' '}{fake ? new Date(fake).toLocaleString() : 'none'}.
        </p>
        <div className="row">
          <button onClick={() => pretend(11)}>Pretend my last backup was 11 days ago</button>
          <button onClick={() => pretend(null)}>Set last backup to now</button>
        </div>
      </details>
    </div>
  );
}

/** The restore question, shared by the plain and the encrypted restore so both say the same thing. Focus lands on it; Escape cancels. */
export function RestoreConfirm({ pending, busy, onConfirm, onCancel, encrypted = false }: { pending: { summary: BackupSummary; name: string }; busy: boolean; onConfirm: () => void; onCancel: () => void; encrypted?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  const w = pending.summary;
  return (
    <div ref={ref} tabIndex={-1} className="banner warn" style={{ display: 'block', marginTop: 12 }} role="alertdialog" aria-label="Confirm restore"
      onKeyDown={(e) => { if (e.key === 'Escape' && !busy) onCancel(); }}>
      <strong>Replace your data with this backup?</strong>
      <ul className="plain">
        <li>File: {pending.name}{encrypted ? ' (decrypted and checked; nothing has been changed yet)' : ''}</li>
        <li>Backup made: {w.exportedAt ? new Date(w.exportedAt).toLocaleString() : 'unknown'}</li>
        {w.fromVersion < CURRENT_SCHEMA_VERSION && <li>This is an older file (data version {w.fromVersion}); it will be upgraded automatically. Areas that did not exist then stay empty.</li>}
      </ul>
      <SummaryList title="What is in the file" groups={w.groups} />
      {w.notes.map((n) => <p key={n} className="muted small">Note: {n}</p>)}
      <p className="warn">
        <strong>This REPLACES all the data currently in this browser</strong>: it is not a merge. Anything you added or changed after this backup was made will be gone, and anything you deleted since comes back.
        A copy of your current data (plain, not encrypted) is downloaded first (“Ledger Pre-Import …”) so you can undo it; if that cannot be started, nothing is replaced. Your browser only reports that the download started, so check that the file appears in your Downloads folder.{' '}
        {readConfig() ? 'Sync is on, so the restored data will also replace the data on your other devices at their next sync.' : 'If you also use Sync on another device, turn Sync on only after deciding which copy should win.'}
      </p>
      <div className="row">
        <button className="primary" onClick={onConfirm} disabled={busy}>{busy ? 'Restoring…' : 'Replace my data'}</button>
        <button onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </div>
  );
}

/** Counts by area. These are groupings for reading, not database tables. */
function SummaryList({ title, groups }: { title: string; groups: SummaryGroup[] }) {
  return (
    <div style={{ marginTop: 8 }}>
      <strong>{title}</strong>
      <ul className="plain" aria-label={title}>
        {groups.map((g) => (
          <li key={g.id}><strong>{g.label}:</strong> {g.items.map((i) => `${i.label}: ${i.n.toLocaleString()}`).join(' · ')}</li>
        ))}
      </ul>
      <p className="muted small">Areas are groupings for reading, not separate files. Counts only; no names or amounts are shown here.</p>
    </div>
  );
}

function fmtToday() {
  const [y, m, d] = localDay().split('-');
  return `${m}-${d}-${y.slice(2)}`;
}
