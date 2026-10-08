import { useState } from 'react';
import { db } from '../db';
import { decryptText, encryptText, exportAll, importAll, type BackupFile } from '../lib/backup';

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export default function BackupPage() {
  const [pass, setPass] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  async function doExport() {
    setMsg('');
    setErr('');
    if (pass.length < 8) return setErr('Use a passphrase of at least 8 characters. You cannot recover the backup without it.');
    const text = await encryptText(JSON.stringify(await exportAll(db)), pass);
    download(`ledger-${new Date().toISOString().slice(0, 10)}.ledgerbackup`, text);
    setMsg('Encrypted backup downloaded.');
  }

  async function doImport(f: File | undefined) {
    setMsg('');
    setErr('');
    if (!f) return;
    if (!pass) return setErr('Enter the passphrase used for this backup first.');
    if (!confirm('This REPLACES all data in this browser with the backup. Continue?')) return;
    try {
      const data = JSON.parse(await decryptText(await f.text(), pass)) as BackupFile;
      await importAll(db, data);
      setMsg('Backup restored.');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <>
      <h1>Backup</h1>
      <div className="card">
        <p>
          Your data lives only in this browser on this device. Clearing site data or changing browsers erases it, so export a
          backup regularly. Backups are encrypted with your passphrase.
        </p>
        <div className="row">
          <label className="f">Passphrase
            <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="off" />
          </label>
          <button className="primary" onClick={doExport}>Export encrypted backup</button>
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <label className="f">Restore from backup (replaces everything)
            <input type="file" accept=".ledgerbackup,application/json" onChange={(e) => doImport(e.target.files?.[0])} />
          </label>
        </div>
        {msg && <div className="ok">{msg}</div>}
        {err && <div className="error">{err}</div>}
      </div>
    </>
  );
}
