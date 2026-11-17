import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { useToast } from '../ui/Toast';
import ConfirmDialog from '../shell/ConfirmDialog';
import Modal from '../shell/Modal';
import { Pill, SettingsSection, SubHeading } from './SettingsParts';
import { appendDecision, loadGrantRows } from '../display/grantStore';
import { subjectOf } from '../display/grants';
import { Preview, shortDay } from '../display/DisplayPreview';
import type { DisplayReport } from '../display/readState';
import { generatePassphrase, normalizePassphrase, openEnvelope, PASSPHRASE_RE } from '../display/transport/envelope';
import { encodePairing, pairingProblem } from '../display/transport/pairing';
import { expiryOf, publisherVersion, readActivity, readPublisher, subscribePublisher, updatePublisher, type PublisherConfig } from '../display/publish/config';
import { diffProjections } from '../display/publish/protocol';
import { changePassphrase, confirmFirstPublication, connectPublisher, depsFor, disconnectPublisher, prepareReview, requestPublish, type FirstReview } from '../display/publish/runner';
import { ago, revocationOf, statusOf } from '../display/publish/status';

/**
 * CS-2: the publishing part of Settings > Family display. Setup, the first-publication review, status and errors, recovery, tablet pairing,
 * credentials and the activity log. Plain words throughout; it never says "published" before GitHub confirmed a write, and it never claims a
 * tablet has received anything.
 */
type D =
  | { k: 'review'; review: FirstReview }
  | { k: 'newfile' } | { k: 'takeover' } | { k: 'rotate' } | { k: 'disconnect' } | { k: 'key' } | { k: 'pair' }
  | { k: 'recover'; added: string[]; removed: string[]; missing: number }
  | { k: 'newpass'; pass: string };

function usePublisher() {
  const version = useSyncExternalStore(subscribePublisher, publisherVersion);
  const [outside, setOutside] = useState(0);
  useEffect(() => {
    const f = (e: StorageEvent) => { if (e.key?.startsWith('ledger-display-')) setOutside((n) => n + 1); };
    window.addEventListener('storage', f); // another tab on this device published
    return () => window.removeEventListener('storage', f);
  }, []);
  return useMemo(() => ({ cfg: readPublisher(), act: readActivity() }), [version, outside]); // eslint-disable-line react-hooks/exhaustive-deps
}
function useNow(ms: number) {
  const [n, setN] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setN(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return n;
}
const when = (at: number) => new Date(at).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const copy = (text: string) => { void navigator.clipboard?.writeText(text).catch(() => undefined); };

export default function PublishingPanel({ report }: { report: DisplayReport }) {
  const toast = useToast();
  const { cfg, act } = usePublisher();
  const now = useNow(30_000);
  const rows = useLiveQuery(() => loadGrantRows(db), []) ?? [];
  const [dialog, setDialog] = useState<D | null>(null);
  const [error, setError] = useState<string | null>(null);
  const status = statusOf(cfg, act);
  const expiry = expiryOf(cfg, act, now);
  const live = !!cfg?.reviewedAt || act.lastSuccessAt !== null;
  const rev = revocationOf(rows, act, live);
  const last = act.lastAttempt;
  const stopped = last && (last.outcome === 'blocked' || last.outcome === 'failed') && (!act.lastSuccessAt || last.at >= act.lastSuccessAt) ? last : null;

  const publishNow = async () => {
    setError(null);
    const r = await requestPublish('manual');
    if (!r) return;
    if (r.outcome === 'published') toast('Published. GitHub confirmed the update.');
    else if (r.outcome === 'unchanged') toast('Checked: the display file is already up to date.');
  };
  const openReview = async () => {
    if (!cfg) return;
    setError(null);
    try { setDialog({ k: 'review', review: await prepareReview(cfg, db) }); } catch (e) { setError(e instanceof Error ? e.message : 'The review could not be built.'); }
  };
  const openRecover = async () => {
    if (!cfg) return;
    setError(null);
    try {
      const deps = await depsFor(cfg, db);
      const read = await deps.store.read();
      const remote = read.kind === 'file' ? await openEnvelope(deps.keys, read.file.bytes) : null;
      if (!remote || !remote.ok) { setError('The published file could not be read, so there is nothing to compare. Use "Start a new display file" instead.'); return; }
      const local = await deps.readLocal();
      const d = diffProjections(remote.projection, local.projection);
      const have = new Set(local.projection.grantsSeen);
      setDialog({ k: 'recover', added: d.added, removed: d.removed, missing: remote.projection.grantsSeen.filter((x) => !have.has(x)).length });
    } catch (e) { setError(e instanceof Error ? e.message : 'The comparison could not be made.'); }
  };
  const run = async (f: () => Promise<unknown>) => { try { await f(); setDialog(null); } catch (e) { return e instanceof Error ? e.message : 'That did not work.'; } };

  return (
    <>
      <SettingsSection id="fd-publish" title="Publishing to a family display" badge={<Pill tone={status.tone}>{status.label}</Pill>} tone={status.tone === 'bad' ? 'warn' : 'default'}
        intro="Ledger can send the schedule you approved, encrypted, to a private place on GitHub that a separate family display (a kitchen tablet) reads. Nothing is sent until you set this up and review what will be shown.">
        <p role="status">{status.detail}</p>
        {error && <p className="cal-error" role="alert">{error}</p>}
        {rev.message && <p className={`ds-note${rev.waiting ? ' ds-note--stop' : ''}`} role="status">{rev.message}</p>}
        {expiry.level !== 'none' && (
          <p className="ds-note ds-note--stop" role="status">{expiry.level === 'expired' ? `The publishing key expired on ${expiry.date}. Replace it to keep publishing.` : `The publishing key expires on ${expiry.date} (${expiry.days} day${expiry.days === 1 ? '' : 's'}). Make a new one in GitHub before then and replace it here.`}</p>
        )}
        {cfg && (
          <ul className="ds-stats">
            <li><strong>{act.lastRevision || '—'}</strong><span className="muted small">revision published</span></li>
            <li><strong>{act.publishedCounts?.entries ?? '—'}</strong><span className="muted small">calendar items in it</span></li>
            <li><strong>{act.publishedCounts?.tasks ?? '—'}</strong><span className="muted small">Tasks in it</span></li>
            <li><strong>{act.pending ? 'Yes' : 'No'}</strong><span className="muted small">changes waiting</span></li>
          </ul>
        )}
        {cfg && <p className="muted small">{act.lastSuccessAt ? `Last published ${ago(act.lastSuccessAt, now)} (${when(act.lastSuccessAt)}). ` : 'Nothing has been published yet. '}This confirms GitHub has the file. Whether the tablet has picked it up is shown on the tablet itself; a tablet that is off or offline may still hold an older copy.</p>}
        {stopped && <p className="ds-note ds-note--stop" role="status"><strong>{stopped.outcome === 'blocked' ? 'Stopped' : 'Failed'} {ago(stopped.at, now)}:</strong> {stopped.message}</p>}

        {!cfg && <ConnectCard onReview={(review) => setDialog({ k: 'review', review })} />}
        {cfg && !cfg.reviewedAt && <p><button type="button" className="btn primary" onClick={() => void openReview()}>Review what will be shown, then publish…</button></p>}
        {cfg && cfg.reviewedAt && (
          <p className="row">
            <button type="button" className="btn primary" disabled={act.publishing} onClick={() => void publishNow()}>{act.publishing ? 'Publishing…' : 'Publish now'}</button>
            {stopped?.code === 'remote-unreadable' && <button type="button" className="btn" onClick={() => setDialog({ k: 'newfile' })}>Start a new display file…</button>}
            {stopped?.code === 'behind-history' && <button type="button" className="btn" onClick={() => void openRecover()}>Review and recover…</button>}
            {stopped?.code === 'publisher-mismatch' && <button type="button" className="btn" onClick={() => setDialog({ k: 'takeover' })}>Make this device the publisher…</button>}
            {(act.connection === 'rejected' || expiry.level === 'expired') && <button type="button" className="btn" onClick={() => setDialog({ k: 'key' })}>Replace the publishing key…</button>}
          </p>
        )}
        <p className="muted small">Ledger publishes after you change something relevant, straight away after you hide something, when you open Ledger, when the device comes back online and every ten minutes while it is open. It cannot publish while it is closed: if you change something and close Ledger at once, the display learns of it the next time a publishing device is opened.</p>
      </SettingsSection>

      {report.withheld.length > 0 && (
        <SettingsSection id="fd-withheld" title="Needs your review before it can appear" badge={<Pill tone="warn">{report.withheld.length}</Pill>} tone="warn"
          intro="These events are on a shown calendar, but they were added after you first reviewed the display by a version of Ledger that cannot confirm whether you meant them to be private (an older copy of the app on some device may have created them, for example by changing a repeating event). They are held back until you choose.">
          <ul className="ds-list">
            {report.withheld.map((w) => (
              <li key={w.eventId} className="ds-row">
                <span className="ds-row-main"><strong>{w.title || '(no title)'}</strong><span className="muted small">{w.calendarName} · added {when(w.createdAt)} · {shortDay(w.nextDate)} · not shown</span></span>
                <span className="ds-row-actions">
                  <button type="button" className="btn" onClick={() => void appendDecision({ subject: subjectOf('event', w.eventId), decision: 'show', titleAtGrant: w.title }, db).then(() => toast('Marked to show'))} aria-label={`Show ${w.title}`}>Show</button>
                  <button type="button" className="btn" onClick={() => void appendDecision({ subject: subjectOf('event', w.eventId), decision: 'hide' }, db).then(() => toast('Kept private'))} aria-label={`Keep ${w.title} private`}>Keep private</button>
                </span>
              </li>
            ))}
          </ul>
        </SettingsSection>
      )}

      {cfg && cfg.reviewedAt && (
        <SettingsSection id="fd-pair" title="Pair a tablet" intro="A tablet needs a pairing code once. It lets that tablet read (never change) the approved schedule.">
          <p><button type="button" className="btn" onClick={() => setDialog({ k: 'pair' })}>Make a pairing code…</button></p>
          <p className="muted small">Lost or replaced tablet? In GitHub, delete the tablet's read key. Then in Ledger choose "Change the display passphrase" below and pair the new tablet. That stops the old one from reading anything new; it cannot erase what the old tablet already saved.</p>
        </SettingsSection>
      )}

      {cfg && (
        <SettingsSection id="fd-credentials" title="Keys, passphrase and recovery" intro="The publishing key and the display passphrase are kept on this device only. They are never synced, never in a backup file, and never sent anywhere except to GitHub (the key) and into the encryption (the passphrase).">
          <ul className="ds-list">
            <li className="ds-row"><span className="ds-row-main"><strong>Repository</strong><span className="muted small">{cfg.owner}/{cfg.repo} · publisher {cfg.publisherId.slice(0, 6)}</span></span></li>
            <li className="ds-row"><span className="ds-row-main"><strong>Publishing key</strong><span className="muted small">{expiry.date ? `Expires ${expiry.date}` : 'No expiry date recorded'}</span></span><span className="ds-row-actions"><button type="button" className="btn" onClick={() => setDialog({ k: 'key' })}>Replace or set expiry…</button></span></li>
            <li className="ds-row"><span className="ds-row-main"><strong>Display passphrase</strong><span className="muted small">Save it in your password manager. A tablet and any other publishing device need it.</span></span><span className="ds-row-actions"><button type="button" className="btn" onClick={() => setDialog({ k: 'rotate' })}>Change the display passphrase…</button></span></li>
            <li className="ds-row"><span className="ds-row-main"><strong>This device</strong><span className="muted small">Forget the keys here. The display file in GitHub and any tablet are not changed.</span></span><span className="ds-row-actions"><button type="button" className="btn danger" onClick={() => setDialog({ k: 'disconnect' })}>Disconnect this device…</button></span></li>
          </ul>
        </SettingsSection>
      )}

      {cfg && (
        <SettingsSection id="fd-activity" title="Publishing activity" intro="Times and outcomes only. No titles or names are kept here.">
          {act.log.length === 0 ? <p className="muted">Nothing yet.</p> : (
            <ul className="ds-list">
              {[...act.log].reverse().slice(0, 25).map((l, i) => (
                <li key={`${l.at}-${i}`} className="ds-row"><span className="ds-row-main"><strong>{l.outcome === 'published' ? 'Published' : l.outcome === 'unchanged' ? 'Checked, nothing to send' : l.outcome === 'blocked' ? 'Stopped' : 'Failed'}</strong><span className="muted small">{when(l.at)} · {l.message}</span></span></li>
              ))}
            </ul>
          )}
        </SettingsSection>
      )}

      {dialog?.k === 'review' && <ReviewDialog review={dialog.review} onClose={() => setDialog(null)} />}
      {dialog?.k === 'newfile' && (
        <ConfirmDialog title="Start a new display file" confirmLabel="Replace the file" busyLabel="Working…" tone="danger"
          onConfirm={() => run(async () => { updatePublisher({ replaceExisting: true }); const r = await requestPublish('manual', { startNewFile: true }); if (r?.outcome !== 'published') throw new Error(r && 'message' in r ? r.message : 'Not published.'); toast('A new display file was published'); })} onCancel={() => setDialog(null)}>
          <p>The file in the display repository cannot be read with this device's passphrase (for example it was made with an earlier passphrase). Replacing it deletes that file's current contents in the repository. A tablet will need to be paired again if the passphrase is different from the one it holds.</p>
        </ConfirmDialog>
      )}
      {dialog?.k === 'takeover' && (
        <ConfirmDialog title="Make this device the publisher" confirmLabel="Make this the publisher" busyLabel="Working…" tone="primary"
          onConfirm={() => run(async () => { updatePublisher({ takeOver: true }); const r = await requestPublish('manual', { takeOver: true }); if (r?.outcome !== 'published') throw new Error(r && 'message' in r ? r.message : 'Not published.'); toast('This device is now the publisher'); })} onCancel={() => setDialog(null)}>
          <p>Another device is set up as the only publisher for this display. If you use this device from now on, that device will be refused until you make it the publisher again. Only do this if the other device is lost, replaced or no longer used for scheduling.</p>
          <p className="muted small">This device must hold every privacy choice the display already knows, or publishing will still stop and ask you to review it.</p>
        </ConfirmDialog>
      )}
      {dialog?.k === 'recover' && <RecoverDialog d={dialog} onClose={() => setDialog(null)} />}
      {dialog?.k === 'rotate' && (
        <ConfirmDialog title="Change the display passphrase" confirmLabel="Make a new passphrase" busyLabel="Working…" tone="danger"
          onConfirm={() => run(async () => { const pass = changePassphrase(); setDialog({ k: 'newpass', pass }); void requestPublish('manual', { startNewFile: true }); })} onCancel={() => setDialog(null)}>
          <p>Use this if a tablet is lost or the passphrase may have leaked. Ledger makes a new passphrase, replaces the file in GitHub with one encrypted under it, and every tablet and publishing device must be given the new one.</p>
          <p className="muted small">Do this on a device that is up to date (open Settings, let sync finish first). The old file's earlier versions stay in the repository's history, readable only with the old passphrase and old read key, which is why you should also delete the old read key in GitHub.</p>
        </ConfirmDialog>
      )}
      {dialog?.k === 'newpass' && (
        <Modal title="Your new display passphrase" size="sm" onClose={() => setDialog(null)}>
          <p>Save this in your password manager now. It is shown only here.</p>
          <p><code className="ds-secret">{dialog.pass}</code> <button type="button" className="btn" onClick={() => copy(dialog.pass)}>Copy</button></p>
          <p className="muted small">Then make a new pairing code for each tablet.</p>
          <p className="row"><button type="button" className="btn primary" onClick={() => setDialog(null)}>I saved it</button></p>
        </Modal>
      )}
      {dialog?.k === 'disconnect' && (
        <ConfirmDialog title="Disconnect this device" confirmLabel="Disconnect" busyLabel="Working…" tone="danger"
          onConfirm={() => run(async () => { disconnectPublisher(); toast('This device no longer publishes'); })} onCancel={() => setDialog(null)}>
          <p>This device forgets the publishing key, the display passphrase and its publishing history. Your approvals and everything else in Ledger stay as they are. The display file in GitHub and any tablet are not changed, so a tablet keeps what it has until it expires.</p>
          <p className="muted small">To stop the tablet getting new data, delete its read key in GitHub.</p>
        </ConfirmDialog>
      )}
      {dialog?.k === 'key' && cfg && <KeyDialog cfg={cfg} onClose={() => setDialog(null)} />}
      {dialog?.k === 'pair' && cfg && <PairDialog cfg={cfg} onClose={() => setDialog(null)} />}
    </>
  );
}

// ---------------- setup ----------------

function ConnectCard({ onReview }: { onReview: (r: FirstReview) => void }) {
  const [pass, setPass] = useState('');
  const [saved, setSaved] = useState(false);
  const [mode, setMode] = useState<'new' | 'have'>('new');
  const [repo, setRepo] = useState('');
  const [token, setToken] = useState('');
  const [expires, setExpires] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warn, setWarn] = useState<string[]>([]);
  const effective = normalizePassphrase(pass);
  const ready = mode === 'new' ? PASSPHRASE_RE.test(effective) && saved : PASSPHRASE_RE.test(effective);

  const connect = async () => {
    setBusy(true);
    setError(null);
    const r = await connectPublisher({ repoText: repo, token, passphrase: effective, tokenExpiresOn: expires || null });
    if (!r.ok) { setBusy(false); setError(r.message); return; }
    setWarn(r.warnings);
    setToken('');
    try { onReview(await prepareReview(r.config, db)); } catch (e) { setError(e instanceof Error ? e.message : 'The review could not be built.'); }
    setBusy(false);
  };

  return (
    <div className="ds-connect">
      <SubHeading>Set up (about five minutes, in GitHub and here)</SubHeading>
      <ol className="plain small">
        <li>In GitHub, make a new <strong>private</strong> repository just for this (for example <code>ledger-display</code>). Nothing else goes in it.</li>
        <li>In GitHub, make a <strong>publishing key</strong> (a fine-grained personal access token) for <em>only that repository</em> with <strong>Contents: Read and write</strong>. Give it an expiry date you will remember.</li>
        <li>Fill in the boxes below. The key is checked, then kept on this device only.</li>
      </ol>
      <fieldset className="ds-fieldset">
        <legend>Display passphrase</legend>
        <p className="row cal-check">
          <label><input type="radio" name="fd-pass" checked={mode === 'new'} onChange={() => { setMode('new'); setPass(''); setSaved(false); }} /> Make a new one (first device)</label>
          <label><input type="radio" name="fd-pass" checked={mode === 'have'} onChange={() => { setMode('have'); setPass(''); }} /> I already have one (another publishing device)</label>
        </p>
        {mode === 'new' ? (
          <>
            {!pass ? <button type="button" className="btn" onClick={() => setPass(generatePassphrase())}>Make a passphrase</button> : (
              <>
                <p><code className="ds-secret">{pass}</code> <button type="button" className="btn" onClick={() => copy(pass)}>Copy</button></p>
                <label className="row cal-check"><input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} /> I saved this passphrase in my password manager</label>
              </>
            )}
            <p className="muted small">This is a different secret from your sync and backup passphrases. If you lose it, you can make a new one, but every tablet must be paired again.</p>
          </>
        ) : (
          <label className="f">Display passphrase<input value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="off" autoCapitalize="characters" spellCheck={false} placeholder="ABCD-EFGH-…" /></label>
        )}
      </fieldset>
      <label className="f">Display repository<input value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="yourname/ledger-display" autoComplete="off" spellCheck={false} /></label>
      <label className="f">Publishing key<input type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" spellCheck={false} placeholder="github_pat_…" /></label>
      <label className="f">When does the key expire? (optional, for a reminder)<input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} /></label>
      {error && <p className="cal-error" role="alert">{error}</p>}
      {warn.map((w) => <p key={w} className="ds-note ds-note--stop" role="status">{w}</p>)}
      <p><button type="button" className="btn primary" disabled={busy || !ready || !repo.trim() || !token.trim()} onClick={() => void connect()}>{busy ? 'Checking…' : 'Check the connection and review'}</button></p>
      <p className="muted small">Nothing is published at this step. Never type these into a chat or an email.</p>
    </div>
  );
}

function ReviewDialog({ review, onClose }: { review: FirstReview; onClose: () => void }) {
  const toast = useToast();
  const [ok, setOk] = useState(false);
  const p = review.projection;
  return (
    <ConfirmDialog title="Review what the display will be able to show" confirmLabel="Publish this to the display" busyLabel="Publishing…" tone="primary"
      onConfirm={async () => {
        if (!ok) return 'Tick the box to confirm you have looked at the list.';
        const r = await confirmFirstPublication(review, db);
        if (r?.outcome === 'published' || r?.outcome === 'unchanged') { toast(r.outcome === 'published' ? 'Published. GitHub confirmed the update.' : 'The display already matched.'); onClose(); return; }
        onClose();
      }} onCancel={onClose}>
      <p><strong>{p.counts.entries} calendar item{p.counts.entries === 1 ? '' : 's'} and {p.counts.tasks} Task{p.counts.tasks === 1 ? '' : 's'}</strong>, naming {p.people.length} {p.people.length === 1 ? 'person' : 'people'}, will become readable by a tablet that has the pairing code. Everything else stays private. Look through the whole list below: titles appear exactly as typed.</p>
      {review.existing === 'readable' && <p className="ds-note" role="status">A display file made with this passphrase already exists (another device published it). Publishing will continue it.</p>}
      {review.existing === 'unreadable' && <p className="ds-note ds-note--stop" role="status">A file already in the repository cannot be read with this passphrase. It will not be replaced unless you later choose "Start a new display file".</p>}
      <div className="ds-review"><Preview p={p} killed={false} /></div>
      <label className="row cal-check"><input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} /> I have looked through this list and it is right to publish it</label>
      <p className="muted small">Events added after you press the button by an older copy of Ledger are held for your review instead of appearing automatically.</p>
    </ConfirmDialog>
  );
}

function RecoverDialog({ d, onClose }: { d: Extract<D, { k: 'recover' }>; onClose: () => void }) {
  const toast = useToast();
  const [ok, setOk] = useState(false);
  return (
    <ConfirmDialog title="This device is missing privacy choices" confirmLabel="Accept this device's state and publish" busyLabel="Publishing…" tone="danger"
      onConfirm={async () => {
        if (!ok) return 'Tick the box to confirm.';
        const r = await requestPublish('manual', { acceptHistoryReset: true });
        if (r?.outcome !== 'published' && r?.outcome !== 'unchanged') return r && 'message' in r ? r.message : 'Not published.';
        toast('Published from this device'); onClose();
      }} onCancel={onClose}>
      <p>The published display knows about <strong>{d.missing} privacy choice{d.missing === 1 ? '' : 's'}</strong> that this device does not have. That usually means this device was restored from an older backup. Ledger will not publish until you decide.</p>
      <p><strong>If you accept this device's state:</strong></p>
      <p className="small">Would come back onto the display ({d.added.length}):</p>
      {d.added.length === 0 ? <p className="muted small">Nothing new would appear.</p> : <ul className="plain small">{d.added.slice(0, 30).map((x) => <li key={x}>{x}</li>)}</ul>}
      <p className="small">Would be removed from the display ({d.removed.length}):</p>
      {d.removed.length === 0 ? <p className="muted small">Nothing would be removed.</p> : <ul className="plain small">{d.removed.slice(0, 30).map((x) => <li key={x}>{x}</li>)}</ul>}
      <p className="muted small">Anything you had hidden since this device's backup would be forgotten here, so check the list above. A better first step is to let Ledger sync on this device (if you use sync), which brings the choices back.</p>
      <label className="row cal-check"><input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} /> I have read this and want this device's state to become the display's</label>
    </ConfirmDialog>
  );
}

function KeyDialog({ cfg, onClose }: { cfg: PublisherConfig; onClose: () => void }) {
  const toast = useToast();
  const [token, setToken] = useState('');
  const [expires, setExpires] = useState(cfg.tokenExpiresOn ?? '');
  return (
    <ConfirmDialog title="Replace the publishing key" confirmLabel="Save" busyLabel="Checking…" tone="primary"
      onConfirm={async () => {
        if (token.trim()) {
          const r = await connectPublisher({ repoText: `${cfg.owner}/${cfg.repo}`, token, passphrase: cfg.passphrase, tokenExpiresOn: expires || null });
          if (!r.ok) return r.message;
          updatePublisher({ reviewedAt: cfg.reviewedAt, replaceExisting: cfg.replaceExisting });
        } else updatePublisher({ tokenExpiresOn: expires || null });
        toast('Saved'); onClose();
        if (token.trim()) void requestPublish('manual');
      }} onCancel={onClose}>
      <p>Paste a new key to replace the one on this device (leave it empty to change only the expiry date). It must be a fine-grained key for this repository only, with <strong>Contents: Read and write</strong>.</p>
      <label className="f">New publishing key<input type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" spellCheck={false} placeholder="github_pat_…" /></label>
      <label className="f">Expires on (optional)<input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} /></label>
    </ConfirmDialog>
  );
}

function PairDialog({ cfg, onClose }: { cfg: PublisherConfig; onClose: () => void }) {
  const [token, setToken] = useState('');
  const [code, setCode] = useState<string | null>(null);
  const [shown, setShown] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (!shown) return; const t = setTimeout(() => setShown(false), 60_000); return () => clearTimeout(t); }, [shown]);
  const make = () => {
    const input = { owner: cfg.owner, repo: cfg.repo, token, passphrase: cfg.passphrase };
    const problem = pairingProblem(input);
    if (problem) { setError(problem); return; }
    if (token.trim() === cfg.token) { setError('That is the publishing key. A tablet must get a separate read-only key.'); return; }
    setError(null);
    setCode(encodePairing(input));
    setToken('');
    setShown(false);
  };
  return (
    <Modal title="Pair a tablet" size="md" onClose={onClose}>
      <p className="ds-note ds-note--stop" role="note"><strong>The pairing code is a secret.</strong> Whoever has it can read your approved family schedule. Use it only on the tablet, never in a message or a photo, and never in a web address.</p>
      {!code ? (
        <>
          <ol className="plain small">
            <li>In GitHub make a second key for the same repository with <strong>Contents: Read-only</strong> (and nothing else). Name it after the tablet.</li>
            <li>Paste it here. Ledger does not keep it; it only goes into the code below.</li>
          </ol>
          <label className="f">Read-only key for the tablet<input type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" spellCheck={false} placeholder="github_pat_…" /></label>
          {error && <p className="cal-error" role="alert">{error}</p>}
          <p className="row"><button type="button" className="btn primary" disabled={!token.trim()} onClick={make}>Make the pairing code</button><button type="button" className="btn" onClick={onClose}>Cancel</button></p>
        </>
      ) : (
        <>
          {shown ? <textarea className="ds-secret-box" readOnly rows={5} value={code} aria-label="Pairing code" onFocus={(e) => e.currentTarget.select()} /> : <p className="muted">The code is hidden. Show it only when you are ready to type or paste it on the tablet.</p>}
          <p className="row">
            <button type="button" className="btn" onClick={() => setShown((s) => !s)}>{shown ? 'Hide the code' : 'Show the code (hides itself after a minute)'}</button>
            <button type="button" className="btn" onClick={() => copy(code)}>Copy</button>
            <button type="button" className="btn primary" onClick={onClose}>Done</button>
          </p>
          <p className="muted small">On the tablet, open the family display page, paste this code and press Pair. Ledger shows no QR code in this version.</p>
        </>
      )}
    </Modal>
  );
}

/** The page's opening note: a local preview until publishing is set up and used, then a plain statement of what is true. */
export function PreviewBanner() {
  const { cfg, act } = usePublisher();
  if (!cfg) return (
    <p className="ds-banner" role="note">
      <strong>This is a local preview. Nothing has been published.</strong> No display is connected, and Ledger has sent nothing to any device or service. Your choices are saved only in Ledger (and in your backups and synced devices, like everything else). Finance, Bills, Projects, notes, places and contact details can never be shown.
    </p>
  );
  return (
    <p className="ds-banner" role="note">
      <strong>{act.lastSuccessAt ? 'A family display is connected.' : 'A family display is set up, but nothing has been published yet.'}</strong> Only what you approve below is ever sent, encrypted, to your private display repository. Finance, Bills, Projects, notes, places and contact details can never be shown.
    </p>
  );
}
