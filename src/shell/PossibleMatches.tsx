import { useCallback, useEffect, useRef, useState } from 'react';
import { db } from '../db';
import { loadHideAmounts } from '../core/hideAmounts';
import { acceptCandidate, gatherSuggestions, rejectCandidate, type GatherResult, type LinkCandidate } from '../core/paymentSuggestions';
import { formatCents } from '../lib/money';
import { financeLink } from '../ui/TxnRefs';
import { StatusChip } from '../ui/StatusChip';
import { useToast } from '../ui/Toast';
import { useToday } from '../ui/useToday';
import Modal from './Modal';
import './possibleMatches.css';

/**
 * R2.2 "Possible matches". Ledger suggests, the owner confirms, and the module that owns the record does the linking (see `core/paymentSuggestions.ts`).
 *
 * This screen only READS until a button is pressed. "Accept link" hands the candidate back to its module's own link operation (which re-checks everything and may refuse
 * with a plain reason); "Review link" opens the module's own screen, where the question that is still open gets asked; "Not a match" remembers that one pair. Nothing here
 * edits a transaction, creates a record, or links on its own. Amounts follow Hide Amounts. No amount, percentage or score is written into a reason.
 */
const money = (cents: number, hide: boolean) => (hide ? '$••••' : formatCents(cents));

export function PossibleMatchesDialog({ txnIds, onClose, onChanged }: { txnIds: number[]; onClose: () => void; onChanged?: () => void }) {
  const today = useToday();
  const toast = useToast();
  const hide = loadHideAmounts();
  const [result, setResult] = useState<GatherResult | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string[]>([]);
  const [refusal, setRefusal] = useState<{ id: string; text: string } | null>(null);
  const alive = useRef(true);
  const ids = useRef(txnIds);
  ids.current = txnIds;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const look = useCallback(async () => {
    try {
      const r = await gatherSuggestions(ids.current, today, db);
      if (alive.current) { setResult(r); setFailed(false); }
    } catch { if (alive.current) setFailed(true); }
  }, [today]);
  useEffect(() => { void look(); }, [look, txnIds.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  async function accept(c: LinkCandidate) {
    if (busy) return;
    setBusy(c.id); setRefusal(null);
    const r = await acceptCandidate(c, db, today);
    if (!alive.current) return;
    setBusy(null);
    if (r.ok) {
      setDone((x) => [...x, r.message]); toast(r.message); onChanged?.();
      setResult((cur) => (cur ? { ...cur, groups: cur.groups.filter((g) => g.txn.id !== c.txnId) } : cur)); // gone at once; the look below confirms it
    } else setRefusal({ id: c.id, text: r.message });
    await look();
  }
  async function reject(c: LinkCandidate) {
    if (busy) return;
    setBusy(c.id); setRefusal(null);
    try {
      const undo = await rejectCandidate(c, db);
      toast('Noted. Ledger will not suggest that record for that payment again. Nothing was changed.', undo ? async () => { await undo(); if (alive.current) await look(); } : undefined);
    } catch (e) { if (alive.current) setRefusal({ id: c.id, text: e instanceof Error && e.message ? `${e.message} Nothing was changed.` : 'Could not save that. Nothing was changed.' }); }
    if (alive.current) setBusy(null);
    await look();
  }

  const groups = result?.groups ?? [];
  return (
    <Modal title="Possible matches" onClose={onClose} size="lg" description="Payments that may belong to a bill, a service visit, a maintenance record or a project. Nothing is linked until you say so.">
      <div className="pm" aria-busy={!result && !failed}>
        {!result && !failed && <p className="muted" role="status">Looking at your household records…</p>}
        {failed && <p className="warn" role="alert">Ledger could not look for matches just now. Nothing was changed. Close this and try again.</p>}
        {result && !result.checked && <p className="warn" role="alert">Ledger could not check which payments are already linked, so it is suggesting nothing. Nothing was changed. Close this and try again.</p>}
        {result && result.unavailable.length > 0 && <p className="warn" role="status">Could not look at {result.unavailable.join(' and ')} just now. The rest is shown.</p>}
        {result && result.leftOut > 0 && <p className="muted" role="status">Only the newest {result.considered} payments were looked at; {result.leftOut} older ones were left out.</p>}
        {done.length > 0 && (
          <ul className="plain pm-done" aria-label="Linked just now">
            {done.map((m, i) => <li key={i} className="ok" role="status">{m}</li>)}
          </ul>
        )}
        {result?.checked && groups.length === 0 && !failed && (
          <p className="muted" role="status">{done.length > 0 ? 'No more possible matches.' : 'No credible matches right now. Ledger only suggests a record when the payee, the date and the record agree, so a missed one can still be linked by hand in its own screen.'}</p>
        )}
        <ul className="plain pm-groups" aria-label="Payments with possible matches">
          {groups.map((g) => (
            <li key={g.txn.id} className="pm-group" data-testid="match-group">
              <div className="pm-txn">
                <span className="pm-txn-main">
                  <strong>{g.txn.payee || '(no payee)'}</strong>
                  <span className="muted small"> · {g.txn.date}</span>
                </span>
                <strong className="pm-amt">Paid {money(-g.txn.amountCents, hide)}</strong>
                <a className="small" href={financeLink(g.txn.id!)} onClick={onClose}>Open transaction</a>
              </div>
              {g.ambiguous && <p className="pm-ambig" role="note"><strong>{g.candidates.length} records could match this payment.</strong> Ledger has not chosen one. Open the one you mean.</p>}
              <ul className="plain pm-cands">
                {g.candidates.map((c) => (
                  <li key={c.id} className="pm-cand" data-testid="match-candidate">
                    <div className="pm-cand-head">
                      <StatusChip tone="neutral" icon={false}>{c.moduleLabel}</StatusChip>
                      <a href={`#${c.href}`} onClick={onClose}><strong>{c.targetTitle}</strong></a>
                      <span className="muted small">{c.targetKind}{c.targetDetail ? ` · ${c.targetDetail}` : ''}</span>
                    </div>
                    <ul className="plain pm-why" aria-label="Why Ledger suggests it">
                      {c.reasons.map((r, i) => <li key={i}>{r}</li>)}
                    </ul>
                    {c.action === 'review' && c.reviewNote && <p className="small pm-note" role="note">{c.reviewNote}</p>}
                    {refusal?.id === c.id && <p className="warn small" role="alert">{refusal.text}</p>}
                    <div className="pm-actions">
                      {c.action === 'accept'
                        ? <button type="button" className="primary" disabled={busy !== null} aria-label={`Accept link: ${g.txn.payee} to ${c.targetTitle}, ${c.targetDetail}`} onClick={() => void accept(c)}>{busy === c.id ? 'Linking…' : 'Accept link'}</button>
                        : <a className="btn" href={`#${c.reviewHref ?? c.href}`} onClick={onClose} aria-label={`Review link: ${g.txn.payee} to ${c.targetTitle}, ${c.targetDetail}`}>Review link</a>}
                      <button type="button" disabled={busy !== null} aria-label={`Not a match: ${g.txn.payee} and ${c.targetTitle}, ${c.targetDetail}`} onClick={() => void reject(c)}>Not a match</button>
                    </div>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
        <p className="muted small">Accepting uses the same step as linking by hand in that record&rsquo;s own screen. The payment itself is never changed.</p>
        <div className="row pm-foot"><button type="button" onClick={onClose}>Close</button></div>
      </div>
    </Modal>
  );
}

/**
 * The small follow-up after an import: nothing at all when there is no credible match (no empty panel), otherwise one line and a button. The import has already
 * succeeded; looking is optional. It reads once when it appears and never again on its own.
 */
export function MatchesNotice({ txnIds }: { txnIds: number[] }) {
  const today = useToday();
  const [count, setCount] = useState(0);
  const [open, setOpen] = useState(false);
  const key = txnIds.join(',');
  useEffect(() => {
    let live = true;
    setCount(0); setOpen(false);
    if (txnIds.length === 0) return;
    gatherSuggestions(txnIds, today, db).then((r) => { if (live) setCount(r.groups.length); }).catch(() => { if (live) setCount(0); });
    return () => { live = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  if (count === 0) return null;
  return (
    <>
      <div className="pm-notice" role="status">
        <span>{count === 1 ? '1 transaction may match a household record.' : `${count} transactions may match household records.`}</span>
        <button type="button" onClick={() => setOpen(true)}>Review possible matches</button>
      </div>
      {open && <PossibleMatchesDialog txnIds={txnIds} onClose={() => setOpen(false)} onChanged={() => undefined} />}
    </>
  );
}
