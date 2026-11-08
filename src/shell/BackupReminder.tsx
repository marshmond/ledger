import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { REMIND_AFTER_DAYS, daysBetween, exportBackupNow, localDay, readMeta, writeMeta } from '../lib/backupFile';

/** Shown only when this device's last backup is more than 10 days old. Sits in the page flow (not floating), so it never covers anything. */
export default function BackupReminder() {
  const [meta, setMeta] = useState(readMeta);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const hasData = useLiveQuery(async () => (await db.accounts.count()) > 0, []);
  const legacy = useLiveQuery(() => db.settings.get('lastBackup'), []) as { value?: string } | undefined | null;

  // Re-read when something else records a backup or dismisses the banner.
  useEffect(() => {
    const sync = () => setMeta(readMeta());
    window.addEventListener('ledger-backup-changed', sync);
    return () => window.removeEventListener('ledger-backup-changed', sync);
  }, []);

  // First run of this version: seed from an older backup record if there is one, otherwise start the 10-day clock today.
  useEffect(() => {
    if (legacy === undefined) return; // still loading
    const m = readMeta();
    if (m.lastBackupAt || m.firstRun) return;
    if (legacy?.value) writeMeta({ lastBackupAt: legacy.value });
    else writeMeta({ firstRun: localDay() });
  }, [legacy]);

  const today = localDay();
  const since = meta.lastBackupAt ? localDay(new Date(meta.lastBackupAt)) : meta.firstRun;
  const overdue = !!since && daysBetween(since, today) > REMIND_AFTER_DAYS;
  if (!hasData || !overdue || meta.dismissedDay === today) return null;

  async function exportNow() {
    setBusy(true); setErr('');
    try { await exportBackupNow(db); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  }

  return (
    <div className="banner warn backup-reminder" role="status">
      <span>
        It has been more than {REMIND_AFTER_DAYS} days since your last backup. Your data lives only in this browser.
        {err && <span className="error" role="alert"> {err}</span>}
      </span>
      <span className="row">
        <button className="primary" onClick={exportNow} disabled={busy}>{busy ? 'Saving…' : 'Export now'}</button>
        <button onClick={() => writeMeta({ dismissedDay: today })}>Dismiss for today</button>
      </span>
    </div>
  );
}
