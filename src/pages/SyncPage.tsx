import { useEffect, useState } from 'react';
import { Link } from '../core/router';
import { clearConfig, engineFor, meta, readConfig, refreshConflicts, saveConfig, syncNow, useSyncStatus, type SyncConfig } from '../lib/sync/auto';
import { githubRemote, parseRepo } from '../lib/sync/github';
import type { Conflict } from '../lib/sync/merge';
import { PageHeader } from '../ui/components';
import { db } from '../db';
import { downloadText } from '../lib/download';
import { listSnapshots, readSnapshot, restoreLostVersion, takeSnapshot } from '../lib/sync/safety';

const when = (ms?: number) => (ms ? new Date(ms).toLocaleString() : 'never');

/** Keep your phone and computer in step through a private GitHub repository. The data is encrypted before it leaves the device. */
export default function SyncPage() {
  const s = useSyncStatus();
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  useEffect(() => { meta.get<Conflict[]>('conflicts').then((c) => setConflicts(c ?? [])); }, [s.lastSyncedAt, s.configured]);

  const [snaps, setSnaps] = useState<Awaited<ReturnType<typeof listSnapshots>>>([]);
  useEffect(() => { listSnapshots(meta).then(setSnaps).catch(() => undefined); }, [s.lastSyncedAt, s.configured]);

  async function putBack(i: number) {
    const c = conflicts[i];
    try {
      await restoreLostVersion(db, c);
      const rest = conflicts.filter((_, j) => j !== i);
      await meta.set('conflicts', rest);
      setConflicts(rest);
      refreshConflicts();
      setMsg(`Put back “${c.label}”. It will reach your other devices at the next sync.`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }
  async function clearConflicts() {
    await meta.set('conflicts', []);
    setConflicts([]);
    refreshConflicts();
  }
  async function downloadSnap(key: string) {
    const snap = await readSnapshot(meta, key);
    if (!snap) return setErr('That copy is no longer stored on this device.');
    const d = new Date(snap.at);
    const day = `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}-${String(d.getFullYear()).slice(2)}`;
    downloadText(`Ledger Auto Snapshot ${day}.json`, 'application/json', snap.text);
  }

  const [repoText, setRepoText] = useState('');
  const [token, setToken] = useState('');
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [probe, setProbe] = useState<{ cfg: SyncConfig; hasRemote: boolean } | null>(null);
  const [replaceOk, setReplaceOk] = useState(false);
  const [newToken, setNewToken] = useState('');

  async function check() {
    setErr('');
    setMsg('');
    setProbe(null);
    const r = parseRepo(repoText);
    if (!r) return setErr('Enter the repository as owner/name, for example alex/ledger-data.');
    if (!token.trim()) return setErr('Paste the token you created on GitHub.');
    if (pass.length < 8) return setErr('Use a sync passphrase of at least 8 characters. Every device needs the same one, and it cannot be recovered.');
    setBusy(true);
    try {
      const cfg: SyncConfig = { ...r, token: token.trim(), passphrase: pass, auto: true };
      const gh = githubRemote(cfg);
      const repo = await gh.checkRepo();
      if (!repo.private) throw new Error('That repository is public. Make it private on GitHub (Settings, then Danger Zone) before using it for sync.');
      setProbe({ cfg, hasRemote: (await gh.getFile()) !== null });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function connect(mode: 'upload' | 'replace') {
    if (!probe) return;
    setErr('');
    setBusy(true);
    try {
      const engine = engineFor(probe.cfg);
      if (mode === 'upload') await engine.initialUpload();
      else {
        // Replacing wipes this device first, so keep a full local copy before doing it.
        await takeSnapshot(db, meta, 'before-replace', 'Taken automatically just before this device was replaced with the synced copy.');
        await engine.replaceFromRemote();
      }
      saveConfig(probe.cfg);
      setProbe(null);
      setToken('');
      setPass('');
      setMsg(mode === 'upload' ? 'Done. This device’s data is now the synced copy. Set up your other device next.' : 'Done. This device now has the synced data.');
      await syncNow();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!confirm('Stop syncing this device? Your data here stays, and the copy on GitHub is untouched.')) return;
    const c = readConfig();
    if (c) await engineFor(c).forget();
    clearConfig();
    setMsg('Sync is off for this device.');
  }

  function updateToken() {
    const c = readConfig();
    if (c && newToken.trim()) {
      saveConfig({ ...c, token: newToken.trim() });
      setNewToken('');
      setMsg('Token updated.');
      syncNow();
    }
  }

  return (
    <>
      <PageHeader title="Sync devices" description="Keep your phone and computer in step, encrypted." about={<>Keep your phone and computer in step. Your data is encrypted on this device with your sync passphrase, then stored as one file in a private repository
        of yours on GitHub. GitHub only ever sees scrambled data. Each device syncs when you open the app, when you come back to it, and a few seconds after you change something.</>} />
      {msg && <div className="ok" role="status">{msg}</div>}
      {err && <div className="error" role="alert">{err}</div>}

      {s.configured ? (
        <>
          <div className="card">
            <div className="row spread">
              <strong>Syncing with {s.repo}</strong>
              <span className="badge">{s.state === 'syncing' ? 'syncing…' : s.state === 'error' ? 'problem' : 'up to date'}</span>
            </div>
            <p className="muted">Last synced: {when(s.lastSyncedAt)}.{s.last && s.state === 'idle' && ` Last run: ${s.last.pulled} changed here, ${s.last.removedHere} removed here, ${s.last.pushed ? 'sent your changes' : 'nothing to send'}.`}</p>
            {s.state === 'error' && <div className="error">{s.error}</div>}
            <div className="row">
              <button className="primary" disabled={s.state === 'syncing'} onClick={() => syncNow()}>Sync now</button>
              <label className="chk"><input type="checkbox" checked={s.auto} onChange={(e) => { const c = readConfig(); if (c) saveConfig({ ...c, auto: e.target.checked }); }} /> Sync automatically</label>
            </div>
          </div>

          {conflicts.length > 0 && (
            <div className="card" id="conflicts">
              <div className="row spread">
                <strong>Edits that lost a tie ({conflicts.length})</strong>
                <button className="link" onClick={clearConflicts}>clear this list</button>
              </div>
              <p className="muted">You and another device both changed these since the last sync. The later edit was kept. The other version is saved here so nothing is lost: put it back if you prefer it.</p>
              <ul className="plain">
                {conflicts.map((c, i) => (
                  <li key={i} className="row spread">
                    <span>{c.label} <span className="muted">({c.table}, {when(c.at)}): {c.kept === 'this device' ? 'the other device’s version was replaced by the one here' : 'the version on this device was replaced by the other device’s'}</span></span>
                    {c.lost ? <button onClick={() => putBack(i)}>Put that version back</button> : <span className="muted">no copy saved</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {snaps.length > 0 && (
            <div className="card">
              <strong>Automatic safety copies on this device</strong>
              <p className="muted">Full copies taken automatically before risky moments. They stay in this browser only. Download one if you want to keep it; it is a normal backup file that Import backup can restore.</p>
              <ul className="plain">
                {snaps.map((x) => (
                  <li key={x.key} className="row spread">
                    <span>{x.why} <span className="muted">({when(x.at)}, {x.records.toLocaleString()} records)</span></span>
                    <button onClick={() => downloadSnap(x.key)}>Download</button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="card">
            <strong>Token</strong>
            <p className="muted">If GitHub says the token expired, create a new one (same steps as below) and paste it here.</p>
            <div className="row">
              <label className="f">New token<input type="password" value={newToken} onChange={(e) => setNewToken(e.target.value)} autoComplete="off" /></label>
              <button disabled={!newToken.trim()} onClick={updateToken}>Update token</button>
            </div>
          </div>

          <div className="card">
            <strong>Turn off</strong>
            <p className="muted">Stops syncing on this device only. Nothing is deleted. To use sync again here you would replace this device’s data with the synced copy.</p>
            <button onClick={disconnect}>Stop syncing on this device</button>
          </div>
        </>
      ) : (
        <>
          <div className="card">
            <strong>Set up (about five minutes, once per device)</strong>
            <ol>
              <li>On GitHub, create a <strong>new private repository</strong> just for this (for example <code>ledger-data</code>). Tick “Add a README file”. Do not reuse this app’s own repository; that one is public.</li>
              <li>
                Create a <strong>fine-grained personal access token</strong> (GitHub, Settings, Developer settings, Personal access tokens). Give it access to <strong>only that repository</strong>,
                with the permission <strong>Contents: Read and write</strong>. Copy it.
              </li>
              <li>Fill in the boxes below on this device. The token and passphrase are kept in this browser only. Choose the sync passphrase once and use the same one on every device; it cannot be recovered.</li>
            </ol>
            <div className="row">
              <label className="f">Repository<input value={repoText} onChange={(e) => setRepoText(e.target.value)} placeholder="owner/ledger-data" autoComplete="off" /></label>
              <label className="f">Token<input type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" /></label>
              <label className="f">Sync passphrase<input type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="off" /></label>
              <button className="primary" disabled={busy} onClick={check}>{busy && !probe ? 'Checking…' : 'Check connection'}</button>
            </div>
          </div>

          {probe && !probe.hasRemote && (
            <div className="card">
              <strong>Connected. Nothing has been synced yet.</strong>
              <p className="muted">Use this on the device that has your data (your main one). It uploads everything here as the starting copy. Then set up your other device and choose to use the synced copy.</p>
              <button className="primary" disabled={busy} onClick={() => connect('upload')}>Upload this device’s data</button>
            </div>
          )}
          {probe && probe.hasRemote && (
            <div className="card">
              <strong>Connected. A synced copy already exists.</strong>
              <p className="muted">
                Using it <strong>replaces everything on this device</strong> with the synced copy. If this device has data you have not synced anywhere, <Link to="/backup">export a backup</Link> first.
                After this, changes flow both ways.
              </p>
              <label className="chk"><input type="checkbox" checked={replaceOk} onChange={(e) => setReplaceOk(e.target.checked)} /> I understand this replaces the data on this device</label>
              <div><button className="primary" disabled={busy || !replaceOk} onClick={() => connect('replace')}>Use the synced copy on this device</button></div>
            </div>
          )}
        </>
      )}

      <div className="card">
        <strong>Good to know</strong>
        <ul>
          <li>If two devices change the same item, the later edit wins and the other version is saved in the list above, with a button to put it back.</li>
          <li>Deleting something on one device deletes it everywhere. Restoring a backup on a synced device replaces the data everywhere too.</li>
          <li>The price-data key stays on each device and is never synced. Sync is not a backup: keep exporting <Link to="/backup">backups</Link> too.</li>
          <li>Anyone with the token and your passphrase could read your data, so keep both private. If a phone is lost, delete the token on GitHub.</li>
        </ul>
      </div>
    </>
  );
}
