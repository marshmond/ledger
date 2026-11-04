import { useState } from 'react';
import { db } from '../db';
import { readConfig } from '../lib/sync/auto';
import { touchAll } from '../lib/sync/track';
import {
  BackupFileError, checkBackupText, exportBackupNow, readMeta, recordBackup, restoreChecked, savePreImportCopy, writeMeta, localDay,
  type BackupSummary,
} from '../lib/backupFile';
import type { BackupFile } from '../lib/backup';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Export and restore as one plain JSON file: no passphrase. */
export default function PlainBackupCard() {
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{ file: BackupFile; summary: BackupSummary; name: string } | null>(null);
  const [fileKey, setFileKey] = useState(0); // changing it empties the file chooser

  async function doExport() {
    setMsg(''); setErr('');
    try {
      const name = await exportBackupNow(db);
      if (name) setMsg(`Saved “${name}” (check your Downloads folder).`);
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
      const saved = await savePreImportCopy(db); // if this fails we stop before touching anything
      await sleep(1200); // let the browser start the download before the page reloads
      await restoreChecked(db, pending.file);
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
      <strong>Backup file (plain JSON, no passphrase)</strong>
      <p className="muted">
        Saves everything — accounts, transactions, budget, investments, settings and look-and-feel choices — as one readable file named like “Ledger Backup {fmtToday()}.json”,
        normally in your Downloads folder. It is NOT encrypted, so keep it somewhere private. The price-lookup key, sync token and weekly-backup passphrase are never included.
      </p>
      {restored && <div className="ok">Backup restored. Your previous data was saved first as “{restored}”.</div>}
      <div className="row">
        <button className="primary" onClick={doExport} disabled={busy}>Export backup</button>
      </div>

      <div className="row" style={{ marginTop: 12 }}>
        <label className="f">Import backup (replaces everything on this device)
          <input key={fileKey} type="file" accept=".json,application/json" disabled={busy} onChange={(e) => choose(e.target.files?.[0])} />
        </label>
      </div>

      {w && pending && (
        <div className="banner warn" style={{ display: 'block', marginTop: 12 }} role="alertdialog" aria-label="Confirm import">
          <strong>Replace your data with this backup?</strong>
          <ul className="plain">
            <li>File: {pending.name}</li>
            <li>Backup made: {w.exportedAt ? new Date(w.exportedAt).toLocaleString() : 'unknown'}</li>
            {w.counts.map((c) => <li key={c.label}>{c.label}: {c.n.toLocaleString()}</li>)}
            {w.fromVersion < 14 && <li>This is an older file (data version {w.fromVersion}); it will be upgraded automatically.</li>}
          </ul>
          <p className="warn"><strong>This REPLACES all the data currently in this browser.</strong> A copy of your current data downloads first
            (“Ledger Pre-Import …”) so you can undo it. {readConfig() ? 'Sync is on, so the restored data will also replace the data on your other devices.' : ''}
          </p>
          <div className="row">
            <button className="primary" onClick={replace} disabled={busy}>{busy ? 'Restoring…' : 'Replace my data'}</button>
            <button onClick={() => { setPending(null); setFileKey((k) => k + 1); }} disabled={busy}>Cancel</button>
          </div>
        </div>
      )}

      {msg && <div className="ok">{msg}</div>}
      {err && <div className="error">{err}</div>}

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

function fmtToday() {
  const [y, m, d] = localDay().split('-');
  return `${m}-${d}-${y.slice(2)}`;
}
