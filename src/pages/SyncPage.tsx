import { useEffect, useState } from 'react';
import { Link } from '../core/router';
import { clearConfig, engineFor, meta, readConfig, refreshConflicts, saveConfig, syncNow, useSyncStatus, type SyncConfig } from '../lib/sync/auto';
import { githubRemote, parseRepo } from '../lib/sync/github';
import type { Conflict } from '../lib/sync/merge';
import { PageHeader } from '../ui/components';
import ConfirmDialog from '../shell/ConfirmDialog';
import { db } from '../db';
import { downloadText } from '../lib/download';
import { listSnapshots, readSnapshot, restoreLostVersion, takeSnapshot } from '../lib/sync/safety';
import { conflictKey, readConflicts, removeConflict, removeConflicts } from '../lib/sync/conflicts';
import { Pill, SettingsSection, SubHeading } from './SettingsParts';

/** The encrypted file passes this size: time to think about a faster way to sync (see docs/PHASE0-PLAN-2026-11-05.md). */
const BIG_FILE = 5 * 1024 * 1024;
const fileSize = (b: number) => (b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);
const when = (ms?: number) => (ms ? new Date(ms).toLocaleString() : 'never');

/** How many saved versions are drawn before "Show all". A display limit only; nothing beyond it is ever discarded. */
const SHOWN_AT_FIRST = 50;

/** Keep your phone and computer in step through a private GitHub repository. The data is encrypted before it leaves the device. */
export default function SyncPage() {
  const s = useSyncStatus();
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  // Display only: the list is long when many edits clashed. Every saved version is still kept; this only limits the rows drawn.
  const [showAll, setShowAll] = useState(false);
  // The saved versions the owner was looking at when they asked to clear (their keys). Only these are removed, never ones that arrived later.
  const [clearKeys, setClearKeys] = useState<string[] | null>(null);
  const [askStop, setAskStop] = useState(false);
  useEffect(() => { readConflicts(meta).then(setConflicts); }, [s.lastSyncedAt, s.configured, s.conflicts]);

  const [snaps, setSnaps] = useState<Awaited<ReturnType<typeof listSnapshots>>>([]);
  useEffect(() => { listSnapshots(meta).then(setSnaps).catch(() => undefined); }, [s.lastSyncedAt, s.configured]);

  async function putBack(c: Conflict) {
    try {
      await restoreLostVersion(db, c);
      // Remove only this entry, from the CURRENT saved list (a sync may have added entries since this screen was drawn).
      await removeConflict(meta, conflictKey(c));
      setConflicts(await readConflicts(meta));
      refreshConflicts();
      setMsg(`Put back “${c.label}”. It will reach your other devices at the next sync.`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }
  /** Removes exactly the versions that were listed in the question. Anything a sync added since stays, and is mentioned. */
  async function clearConflicts(keys: string[]) {
    const removed = await removeConflicts(meta, keys);
    const rest = await readConflicts(meta);
    setConflicts(rest);
    refreshConflicts();
    setClearKeys(null);
    setMsg(rest.length > 0 ? `Removed ${removed} saved version${removed === 1 ? '' : 's'}. ${rest.length} newer one${rest.length === 1 ? ' that arrived' : 's that arrived'} while you were deciding ${rest.length === 1 ? 'was' : 'were'} kept.` : `Removed ${removed} saved version${removed === 1 ? '' : 's'}.`);
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
    const c = readConfig();
    if (c) await engineFor(c).forget();
    clearConfig();
    setAskStop(false);
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
      {err && <div className="error" id="sync-error" role="alert">{err}</div>}

      {clearKeys && (
        <ConfirmDialog
          title={`Remove ${clearKeys.length === 1 ? 'this saved version' : `all ${clearKeys.length} saved versions`}?`}
          confirmLabel={clearKeys.length === 1 ? 'Remove it for good' : 'Remove them for good'}
          kind="irreversible"
          busyLabel="Removing…"
          onCancel={() => setClearKeys(null)}
          onConfirm={() => clearConflicts(clearKeys)}
        >
          <p>These are the other versions of edits that lost a tie between your devices. Once removed, you can no longer put them back.</p>
          <p>Your current data, and the copy on your other devices, are not changed. Only the versions listed on this page now are removed; any that arrive later are kept.</p>
        </ConfirmDialog>
      )}
      {askStop && (
        <ConfirmDialog
          title="Stop syncing this device?"
          tone="primary"
          confirmLabel="Stop syncing"
          onCancel={() => setAskStop(false)}
          onConfirm={disconnect}
        >
          <p>Your data on this device stays exactly as it is, and the copy on GitHub is untouched.</p>
          <p>The sync token and passphrase are forgotten on this device, so you would type them in again to turn sync back on.</p>
        </ConfirmDialog>
      )}

      {s.configured ? (
        <>
          <SettingsSection id="sync-status" title={`Syncing with ${s.repo}`} tone={s.state === 'error' ? 'warn' : 'default'}
            badge={<Pill tone={s.state === 'error' ? 'bad' : s.state === 'syncing' ? 'info' : 'ok'}>{s.state === 'syncing' ? 'syncing…' : s.state === 'error' ? 'problem' : 'up to date'}</Pill>}>
            <dl className="se-facts">
              <div><dt>Last synced</dt><dd>{when(s.lastSyncedAt)}</dd></div>
              {s.last && s.state === 'idle' && <div><dt>Last run</dt><dd>{s.last.pulled} changed here, {s.last.removedHere} removed here, {s.last.pushed ? 'sent your changes' : 'nothing to send'}</dd></div>}
              {s.stats?.fileBytes !== undefined && <div><dt>Synced file</dt><dd>{fileSize(s.stats.fileBytes)}{s.stats.records !== undefined && `, ${s.stats.records.toLocaleString()} records`}</dd></div>}
              {s.stats?.fileBytes !== undefined && <div><dt>Sent to GitHub</dt><dd>{s.stats.uploadsToday} {s.stats.uploadsToday === 1 ? 'time' : 'times'} today, {s.stats.uploads30d} in the last 30 days</dd></div>}
            </dl>
            {s.stats?.fileBytes !== undefined && (
              <p className="muted small">
                Each upload adds a copy to the repository's history.
                {s.stats.fileBytes > BIG_FILE && ' The file is getting large; a faster way to sync may be needed soon.'}
              </p>
            )}
            {s.state === 'error' && <div className="error" role="status">{s.error}</div>}
            <div className="row se-actions">
              <button className="primary" disabled={s.state === 'syncing'} onClick={() => syncNow()}>Sync now</button>
              <label className="chk"><input type="checkbox" checked={s.auto} onChange={(e) => { const c = readConfig(); if (c) saveConfig({ ...c, auto: e.target.checked }); }} /> Sync automatically</label>
            </div>
          </SettingsSection>

          {conflicts.length > 0 && (
            <SettingsSection id="conflicts" title={`Edits that lost a tie (${conflicts.length})`} tone="warn"
              badge={<button className="link" onClick={() => setClearKeys(conflicts.map(conflictKey))}>clear this list</button>}
              intro="You and another device both changed these since the last sync. The later edit was kept. The other version is saved here so nothing is lost: put it back if you prefer it.">
              <ul className="plain se-list">
                {(showAll ? conflicts : conflicts.slice(0, SHOWN_AT_FIRST)).map((c) => (
                  <li key={conflictKey(c)} className="se-item">
                    <span>{c.label} <span className="muted">({c.table}, {when(c.at)}): {c.kept === 'this device' ? 'the other device’s version was replaced by the one here' : 'the version on this device was replaced by the other device’s'}</span></span>
                    {c.lost ? <button onClick={() => putBack(c)}>Put that version back</button> : <span className="muted">no copy saved</span>}
                  </li>
                ))}
              </ul>
              {conflicts.length > SHOWN_AT_FIRST && (
                <button className="link" onClick={() => setShowAll((v) => !v)}>{showAll ? `Show only the newest ${SHOWN_AT_FIRST}` : `Show all ${conflicts.length}`}</button>
              )}
            </SettingsSection>
          )}

          {snaps.length > 0 && (
            <SettingsSection id="snapshots" title="Automatic safety copies on this device" badge={<Pill tone="quiet">This browser only</Pill>}
              intro="Full copies taken automatically before risky moments. They stay in this browser only. Download one if you want to keep it; it is a normal backup file that Import backup can restore.">
              <ul className="plain se-list">
                {snaps.map((x) => (
                  <li key={x.key} className="se-item">
                    <span>{x.why} <span className="muted">({when(x.at)}, {x.records.toLocaleString()} records)</span></span>
                    <button onClick={() => downloadSnap(x.key)}>Download</button>
                  </li>
                ))}
              </ul>
            </SettingsSection>
          )}

          <SettingsSection id="sync-token" title="Token" intro="If GitHub says the token expired, create a new one (same steps as below) and paste it here.">
            <div className="row">
              <label className="f">New token<input type="password" value={newToken} onChange={(e) => setNewToken(e.target.value)} autoComplete="off" /></label>
              <button disabled={!newToken.trim()} onClick={updateToken}>Update token</button>
            </div>
          </SettingsSection>

          <SettingsSection id="sync-off" title="Turn off" tone="danger" badge={<Pill tone="quiet">This device only</Pill>}>
            <p className="muted">Stops syncing on this device only. Nothing is deleted. To use sync again here you would replace this device’s data with the synced copy.</p>
            <button onClick={() => setAskStop(true)}>Stop syncing on this device</button>
          </SettingsSection>
        </>
      ) : (
        <>
          <SettingsSection id="sync-state" title="Sync is not set up on this device" badge={<Pill tone="quiet">Not set up</Pill>}
            intro="Until it is, this device keeps its own copy of your data and nothing is sent anywhere.">
            <div className="se-choices">
              <div className="se-choice">
                <SubHeading>Send this device’s data</SubHeading>
                <p className="muted small">For the device that already has your data. It uploads everything here as the starting copy. Nothing on this device changes.</p>
              </div>
              <div className="se-choice se-choice--replace">
                <SubHeading>Replace this device’s data</SubHeading>
                <p className="muted small">For your other devices, once a synced copy exists. It swaps everything here for the synced copy, so export a backup first if this device has data that is not synced anywhere.</p>
              </div>
            </div>
            <p className="muted small">Setup checks the repository first and offers the one that fits: “send” when nothing has been synced yet, “replace” when a synced copy already exists.</p>
          </SettingsSection>

          <SettingsSection id="sync-setup" title="Set up (about five minutes, once per device)">
            <ol className="se-steps">
              <li>On GitHub, create a <strong>new private repository</strong> just for this (for example <code>ledger-data</code>). Tick “Add a README file”. Do not reuse this app’s own repository; that one is public.</li>
              <li>
                Create a <strong>fine-grained personal access token</strong> (GitHub, Settings, Developer settings, Personal access tokens). Give it access to <strong>only that repository</strong>,
                with the permission <strong>Contents: Read and write</strong>. Copy it.
              </li>
              <li>Fill in the boxes below on this device. The token and passphrase are kept in this browser only. Choose the sync passphrase once and use the same one on every device; it cannot be recovered.</li>
            </ol>
            <div className="an-form an-form--wide">
              <label className="f">Repository<input aria-invalid={err ? true : undefined} aria-describedby={err ? 'sync-error' : undefined} value={repoText} onChange={(e) => setRepoText(e.target.value)} placeholder="owner/ledger-data" autoComplete="off" /></label>
              <label className="f">Token<input type="password" aria-invalid={err ? true : undefined} aria-describedby={err ? 'sync-error' : undefined} value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" /></label>
              <label className="f">Sync passphrase<input type="password" aria-invalid={err ? true : undefined} aria-describedby={err ? 'sync-error' : undefined} value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="off" /></label>
            </div>
            <div className="row se-actions">
              <button className="primary" disabled={busy} onClick={check}>{busy && !probe ? 'Checking…' : 'Check connection'}</button>
            </div>
          </SettingsSection>

          {probe && !probe.hasRemote && (
            <SettingsSection id="sync-send" title="Connected. Nothing has been synced yet." badge={<Pill tone="info">Send this device’s data</Pill>}>
              <p className="muted">Use this on the device that has your data (your main one). It uploads everything here as the starting copy. Then set up your other device and choose to use the synced copy.</p>
              <button className="primary" disabled={busy} onClick={() => connect('upload')}>Upload this device’s data</button>
            </SettingsSection>
          )}
          {probe && probe.hasRemote && (
            <SettingsSection id="sync-replace" title="Connected. A synced copy already exists." tone="danger" badge={<Pill tone="bad">Replaces this device’s data</Pill>}>
              <p className="muted">
                Using it <strong>replaces everything on this device</strong> with the synced copy. If this device has data you have not synced anywhere, <Link to="/backup">export a backup</Link> first.
                After this, changes flow both ways.
              </p>
              <label className="chk"><input type="checkbox" checked={replaceOk} onChange={(e) => setReplaceOk(e.target.checked)} /> I understand this replaces the data on this device</label>
              <div className="se-actions"><button className="primary" disabled={busy || !replaceOk} onClick={() => connect('replace')}>Use the synced copy on this device</button></div>
            </SettingsSection>
          )}
        </>
      )}

      <SettingsSection id="sync-know" title="Good to know">
        <ul className="se-points">
          <li>If two devices change the same item, the later edit wins and the other version is saved in the list above, with a button to put it back.</li>
          <li>Deleting something on one device deletes it everywhere. Restoring a backup on a synced device replaces the data everywhere too.</li>
          <li>The price-data key stays on each device and is never synced. Sync is not a backup: keep exporting <Link to="/backup">backups</Link> too.</li>
          <li>Anyone with the token and your passphrase could read your data, so keep both private. If a phone is lost, delete the token on GitHub.</li>
        </ul>
      </SettingsSection>
    </>
  );
}
