import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from '../core/router';
import { allTxnReferenceProviders } from '../core/registry';
import { db } from '../db';
import { applyTxnDeletion, DeletionRefused, deletionWords, planTxnDeletion, type DeletionPlan } from '../lib/txnDeletion';
import Modal from '../shell/Modal';

/**
 * The delete confirmation for Finance transactions (single or a selection). It looks first, says which other Ledger records point at the payment(s), and deletes only when the
 * owner presses Delete. It shows NO amounts (nothing for Hide Amounts to hide). If a module cannot be checked, Delete stays off and "Check again" is offered.
 * If anything changed since the owner looked, nothing is deleted and the new list is shown to confirm.
 */
const SHOWN = 12;
/** Makes sure a message ends with one full stop. */
const sentence = (t: string) => `${t.trim().replace(/[.!?]+$/, '')}.`;

export default function TxnDeleteDialog({ ids, subject, onClose, onDeleted }: { ids: number[]; subject: 'transaction' | 'selection'; onClose: () => void; onDeleted: (deleted: number) => void }) {
  const [plan, setPlan] = useState<DeletionPlan | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [changed, setChanged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  // A caller may pass a fresh array each render; only a change in WHICH transactions re-runs the check.
  const idsRef = useRef(ids);
  idsRef.current = ids;
  const key = ids.join(',');
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const look = useCallback(async () => {
    setPlan(null); setFailed(null); setError(null);
    try {
      const p = await planTxnDeletion(db, idsRef.current, allTxnReferenceProviders());
      if (alive.current) setPlan(p);
    } catch (e) {
      if (alive.current) setFailed(e instanceof Error ? e.message : 'The check failed.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => { void look(); }, [look]);

  async function confirmDelete() {
    if (!plan || busy) return;
    setBusy(true); setError(null);
    try {
      const r = await applyTxnDeletion(db, plan, allTxnReferenceProviders());
      onDeleted(r.deleted);
    } catch (e) {
      if (!alive.current) return;
      if (e instanceof DeletionRefused && e.reason === 'stale') {
        setChanged(true);
        try { setPlan(await planTxnDeletion(db, idsRef.current, allTxnReferenceProviders())); } catch { setPlan(null); setFailed('The check failed.'); }
      } else setError(e instanceof Error ? e.message : 'Nothing was deleted.');
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  const words = plan ? deletionWords(plan, subject) : null;
  const n = plan?.willDelete.length ?? 0;
  const title = subject === 'selection' ? 'Delete selected transactions?' : 'Delete this transaction?';
  const canDelete = !!plan && plan.verified && n > 0 && !busy;
  const sorted = plan ? [...plan.dependents].sort((a, b) => Number(b.evidence) - Number(a.evidence) || a.moduleLabel.localeCompare(b.moduleLabel) || a.title.localeCompare(b.title)) : [];
  const seen = new Set<string>();
  const records = sorted.filter((x) => { const k = `${x.module}|${x.recordId}`; if (seen.has(k)) return false; seen.add(k); return true; });

  return (
    <Modal title={title} onClose={onClose}>
      <div style={{ display: 'grid', gap: 10 }} aria-busy={!plan && !failed}>
        {!plan && !failed && <p className="muted" role="status">Checking what else in Ledger uses {subject === 'selection' ? 'these transactions' : 'this transaction'}…</p>}
        {failed && (
          <div className="banner bad" role="alert">
            <div>
              <strong>Could not check.</strong> {sentence(failed)} Nothing was deleted.
              <div className="row" style={{ marginTop: 8 }}><button onClick={() => void look()}>Check again</button></div>
            </div>
          </div>
        )}
        {changed && <div className="banner warn" role="alert"><div><strong>Something changed since you looked.</strong> Nothing was deleted. This is the new list; check it, then confirm again.</div></div>}
        {plan && words && (
          <>
            {subject === 'selection' && <p style={{ margin: 0 }}><strong>{plan.requested.length}</strong> selected{plan.splitTransactions ? `, ${plan.splitTransactions} split` : ''}.</p>}
            {plan.missing.length > 0 && <p className="muted" style={{ margin: 0 }}>{plan.missing.length === 1 ? '1 selected transaction is' : `${plan.missing.length} selected transactions are`} already gone and will be skipped.</p>}
            {!plan.verified ? (
              <div className="banner bad" role="alert">
                <div>
                  <strong>Could not finish checking.</strong> {plan.unverified.map((u) => sentence(`${u.label}: ${u.message}`)).join(' ')} Delete stays off, because Ledger cannot tell whether something depends on {subject === 'selection' ? 'these payments' : 'this payment'}. Nothing was deleted.
                  <div className="row" style={{ marginTop: 8 }}><button onClick={() => void look()}>Check again</button></div>
                </div>
              </div>
            ) : (
              <>
                <p style={{ margin: 0 }}><strong>{words.headline}</strong></p>
                {words.consequence && <p style={{ margin: 0 }}>{words.consequence}</p>}
                {words.spending && <p style={{ margin: 0 }}>{words.spending}</p>}
              </>
            )}
            {records.length > 0 && (
              <ul className="small" style={{ margin: 0, paddingLeft: 18 }} aria-label="Records that use these transactions">
                {records.slice(0, SHOWN).map((x) => (
                  <li key={`${x.module}|${x.recordId}`}>
                    {x.href ? <Link to={x.href} onClick={onClose}>{x.title}</Link> : <span>{x.title}</span>}
                    <span className="muted"> · {x.moduleLabel}{x.scope === 'part' ? ' · one part of a split' : ''}{x.standing === 'stale' ? ' · already needs review' : x.standing === 'historical' ? ' · history only' : ''}</span>
                    {x.note && <div className="muted">{x.note}</div>}
                  </li>
                ))}
                {records.length > SHOWN && <li className="muted">…and {records.length - SHOWN} more.</li>}
              </ul>
            )}
            <p className="muted small" style={{ margin: 0 }}>Deleting cannot be undone here. Your backup can bring it back.</p>
          </>
        )}
        {error && <div className="banner bad" role="alert">{error}</div>}
        <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose} autoFocus>Cancel</button>
          <button className="danger" disabled={!canDelete} onClick={() => void confirmDelete()}>{busy ? 'Deleting…' : n > 1 ? `Delete ${n} transactions` : 'Delete'}</button>
        </div>
      </div>
    </Modal>
  );
}
