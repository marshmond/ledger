import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import ConfirmDialog from '../../../shell/ConfirmDialog';
import type { Occurrence } from '../occurrences';
import NoticeComposer from './NoticeComposer';
import { offerForDetails, quietly, type NoticeOffer } from './offers';
import { foldRequests, type RequestView } from './records';
import { loadNoticeRows, refreshStatuses, retryRequest, sendApproved } from './send';
import { getTransport } from './transport';
import { RETRY_WARNING, statusLabel, statusWords, whenSent } from './words';

/**
 * CAL-N1: the event's Messages: what was communicated, to whom, when, and where each message stands, with a manual retry where one makes sense.
 * Everything here is read from the notification history; nothing is sent from opening it. "Check status" only asks the sender what became of a message.
 */
export default function MessagesSection({ occ }: { occ: Occurrence }) {
  const loaded = useLiveQuery(() => loadNoticeRows(), []);
  const transport = getTransport();
  const [composing, setComposing] = useState<NoticeOffer | null>(null);
  const [again, setAgain] = useState<RequestView | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  const rows = loaded?.rows ?? [];
  const mine = useMemo(() => foldRequests(rows).filter((v) => v.eventIds.includes(occ.eventId)), [rows, occ.eventId]);
  const declined = rows.filter((r) => r.data.t === 'declined' && r.data.eventIds.includes(occ.eventId));
  const groups = useMemo(() => {
    const m = new Map<string, { key: string; summary: string; at: number; views: RequestView[] }>();
    for (const v of mine) {
      const g = m.get(v.noticeKey) ?? { key: v.noticeKey, summary: v.summary, at: v.at, views: [] };
      g.views.push(v); g.at = Math.min(g.at, v.at);
      m.set(v.noticeKey, g);
    }
    return [...m.values()].sort((a, b) => b.at - a.at);
  }, [mine]);
  const waiting = mine.some((v) => v.state === 'queued' || v.state === 'unknown');

  const run = async (f: () => Promise<unknown>, done: string) => {
    setBusy(true); setNote('');
    try { await f(); setNote(done); } catch { setNote('That did not work. Nothing was changed. Try again later.'); } finally { setBusy(false); }
  };
  const check = () => transport && run(async () => { const n = await refreshStatuses(transport); setNote(n ? '' : 'Nothing new to report.'); }, '');

  return (
    <details className="cal-msgs" onToggle={(e) => { if ((e.currentTarget as HTMLDetailsElement).open && transport && waiting) void refreshStatuses(transport).catch(() => undefined); }}>
      <summary>Messages{mine.length ? ` (${groups.length})` : ''}</summary>
      <div className="cal-msgs-body">
        {groups.length === 0 && declined.length === 0 && <p className="muted small">No one has been emailed about this event.</p>}
        {groups.map((g) => (
          <div className="cal-msgs-group" key={g.key}>
            <div className="row spread"><strong>{g.summary}</strong><span className="muted small">{whenSent(g.at)}</span></div>
            <ul className="cal-msgs-list">
              {g.views.map((v) => (
                <li key={v.requestId}>
                  <div className="row"><span>{v.recipient.name}</span><span className="badge">{statusLabel(v, !!transport)}</span></div>
                  <div className="muted small">{statusWords(v, !!transport)}{v.attempt > 1 ? ` (attempt ${v.attempt})` : ''}</div>
                  <div className="row">
                    {v.state === 'confirmed' && transport && <button type="button" className="btn" disabled={busy} onClick={() => void run(() => sendApproved(v.requestId, transport), 'Checked and handed to the sender.')}>Send now</button>}
                    {v.state === 'failed' && v.reason !== 'stale' && <button type="button" className="btn" disabled={busy || !transport} onClick={() => transport && void run(() => retryRequest({ requestId: v.requestId, transport }), 'Tried again.')}>Try again</button>}
                    {v.state === 'unknown' && <button type="button" className="btn" disabled={busy || !transport} onClick={() => setAgain(v)}>Send again anyway…</button>}
                  </div>
                  {v.state === 'failed' && v.reason === 'stale' && <p className="muted small">To tell them about the new details, use "Email people the saved details" below.</p>}
                </li>
              ))}
            </ul>
          </div>
        ))}
        {declined.map((r) => <p key={r.id} className="muted small">You chose not to email: {r.data.t === 'declined' ? r.data.summary : ''} ({whenSent(r.createdAt)})</p>)}
        {waiting && transport && <button type="button" className="btn" disabled={busy} onClick={() => void check()}>Check status</button>}
        {!transport && mine.length > 0 && <p className="muted small">Email sending is not connected yet, so status can only change once it is.</p>}
        {note && <p className="muted small" role="status">{note}</p>}
        <div className="row">
          <button type="button" className="btn" onClick={() => void quietly(() => offerForDetails({ occ })).then((o) => o && setComposing(o))}>Email people the saved details…</button>
          <span className="muted small">Uses the saved event, not changes you have not saved yet.</span>
        </div>
      </div>
      {composing && <NoticeComposer offer={composing} onClose={() => setComposing(null)} />}
      {again && transport && (
        <ConfirmDialog
          title="Send this message again?" confirmLabel="Send again" tone="primary" busyLabel="Sending…"
          onCancel={() => setAgain(null)}
          onConfirm={async () => { const r = await retryRequest({ requestId: again.requestId, transport, acceptDuplicateRisk: true }); setAgain(null); if (r !== 'started') return; }}
        >
          <p>{RETRY_WARNING}</p>
          <p className="muted small">Ledger will send the same message to {again.recipient.name} as a new attempt.</p>
        </ConfirmDialog>
      )}
    </details>
  );
}
