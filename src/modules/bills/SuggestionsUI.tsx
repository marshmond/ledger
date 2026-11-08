import { useLiveQuery } from 'dexie-react-hooks';
import { dayLabel } from '../../core/time';
import { financeLink } from '../../ui/TxnRefs';
import { useToast } from '../../ui/Toast';
import type { TxnRef } from '../../lib/txnRef';
import { useMoney, type Money } from './BillsParts';
import { newOp, reconsiderRejection, rejectSuggestion } from './cycleData';
import { factWords } from './cycleModel';
import type { ObligationRecord } from './model';
import type { Period } from './periods';
import { evidenceWords, TIER_WORDS, type RejectedPiece, type Suggestion } from './suggest';
import { loadSuggestions } from './suggestData';
import { runUndo } from './undo';

const REJECT_STATE: Record<RejectedPiece['state'], string> = {
  unchanged: '',
  changed: 'It has changed in Finance since, so it may be offered again with a warning.',
  'split-changed': 'Its parts were changed in Finance since, so the part in that position may be a different one.',
  gone: 'It is no longer in Finance.',
};

/** One transaction piece in words: who, when, which part, and how much (Hide Amounts applies). */
function Head({ s, money }: { s: Suggestion; money: Money }) {
  const t = s.txn;
  return (
    <div className="bl-sugg-head">
      <span className="as-txn-main">
        <strong>{t.payee || '(no payee)'}</strong>
        <span className="muted small"> · {dayLabel(t.date, { year: true })}{s.part ? ` · part ${s.part.index + 1} of ${s.part.count}` : (t.splits?.length ?? 0) > 1 ? ' · whole transaction' : ''}</span>
      </span>
      <strong>Paid {money(s.spendCents)}</strong>
    </div>
  );
}

function Why({ s, money }: { s: Suggestion; money: Money }) {
  return (
    <>
      <ul className="plain bl-ev" aria-label="Why Ledger suggests it">{s.forPoints.map((e, i) => <li key={i}>{evidenceWords(e, money)}</li>)}</ul>
      {s.againstPoints.length > 0 && <ul className="plain bl-ev bl-ev-against" aria-label="What is uncertain">{s.againstPoints.map((e, i) => <li key={i}>{evidenceWords(e, money)}</li>)}</ul>}
      {s.reviewReasons.map((r, i) => <p key={i} className="bl-warn small" role="note">{r}</p>)}
      {s.elsewhere.bills.length > 0 && <p className="small" role="note">Already linked to {s.elsewhere.bills.map((b) => `"${b.title}"${b.sameBill ? ' (another period of this bill)' : ''}`).join(' and ')}.</p>}
      {s.elsewhere.modules.length > 0 && <p className="small" role="note">Also used by {s.elsewhere.modules.join(' and ')}.</p>}
    </>
  );
}

/**
 * Suggested payments for one billing period, shown ABOVE the ordinary search inside the Link-a-payment dialog. A suggestion is a pointer only:
 * looking at the list writes nothing, "Use this payment" only takes you to the same preview and confirmation as picking by hand (the existing B3
 * checks decide), and nothing counts as money paid until you confirm there. "Not this payment" is the only thing here that writes, and it writes one
 * small record for THIS billing period only. Amounts follow Hide Amounts.
 */
export function SuggestedMatches({ obligation, period, today, onUse }: { obligation: ObligationRecord; period: Period; today: string; onUse: (ref: TxnRef) => void }) {
  const toast = useToast();
  const { money } = useMoney();
  const stamp = `${obligation.id}|${obligation.updatedAt}|${period.slot}|${period.records.map((r) => `${r.id}.${r.updatedAt}`).join(',')}|${today}`;
  const data = useLiveQuery(() => loadSuggestions(obligation, period, today).then((r) => ({ ok: true as const, r })).catch(() => ({ ok: false as const })), [stamp]);

  async function reject(s: Suggestion) {
    try {
      const r = await rejectSuggestion({ obligationId: obligation.id, slot: period.slot, ref: s.ref, op: newOp() });
      toast('Noted. Ledger will not suggest that payment for this billing period again. Nothing in Finance was changed.', r.reused ? undefined : () => runUndo(r.undo, toast).then(() => undefined));
    } catch (e) { toast(e instanceof Error ? e.message : 'Could not save that. Nothing was changed.'); }
  }
  async function again(x: RejectedPiece) {
    try {
      const r = await reconsiderRejection(x.rec.id, x.rec.updatedAt);
      toast('Ledger may suggest that payment again.', () => runUndo(r.undo, toast).then(() => undefined));
    } catch (e) { toast(e instanceof Error ? e.message : 'Could not change that. Nothing was changed.'); }
  }

  return (
    <section className="bl-suggs" aria-labelledby="bl-sugg-h">
      <h3 className="bl-h3" id="bl-sugg-h">Suggested payments</h3>
      <p className="muted small">Ledger compares the payee, the date and, when it can rely on it, the amount. A suggestion is not a link: it counts as no money paid, and nothing is linked or changed in Finance until you choose one and confirm.</p>
      {!data ? <p className="muted" role="status">Looking at Finance…</p> : !data.ok ? <p className="bl-warn" role="alert">Ledger could not look for suggestions just now. You can still search below.</p> : (
        <>
          {data.r.suggestions.length === 0 && data.r.none && <p className="muted" role="status">{data.r.none}</p>}
          <ul className="plain bl-sugg-list" aria-label="Suggested payments">
            {data.r.suggestions.map((s) => (
              <li key={s.key} className="bl-sugg" data-testid="suggestion">
                <Head s={s} money={money} />
                <p className="bl-chips">
                  <span className={`bl-chip${s.tier === 'strong' ? ' bl-l-paid' : ''}`}>{TIER_WORDS[s.tier]}</span>
                  {s.fromRule && <span className="bl-chip">From your linked Scheduled payment</span>}
                  {s.needsReview && <span className="bl-chip bl-l-needs-review">Look closely first</span>}
                </p>
                <Why s={s} money={money} />
                <div className="bl-actionrow">
                  <button type="button" className="btn primary" onClick={() => onUse(s.ref)} aria-label={`Use this payment: ${s.txn.payee}, ${s.txn.date}, ${money(s.spendCents)}${s.part ? `, part ${s.part.index + 1}` : ''}`}>Use this payment</button>
                  <button type="button" className="btn" onClick={() => void reject(s)} aria-label={`Not this payment: ${s.txn.payee}, ${s.txn.date}`}>Not this payment</button>
                  <a className="small" href={financeLink(s.txn.id!)}>Open in Finance</a>
                </div>
              </li>
            ))}
          </ul>
          {data.r.elsewhere.length > 0 && (
            <details className="bl-sec">
              <summary>Already linked somewhere else ({data.r.elsewhere.length})</summary>
              <p className="muted small">These look like this bill but are already counted for another period, bill or part of the app. They are not recommendations. You may still use one (a real payment can be shared), and it will be counted once and never divided.</p>
              <ul className="plain bl-sugg-list" aria-label="Payments already linked elsewhere">
                {data.r.elsewhere.map((s) => (
                  <li key={s.key} className="bl-sugg bl-sugg-dim" data-testid="suggestion-elsewhere">
                    <Head s={s} money={money} />
                    <Why s={s} money={money} />
                    <div className="bl-actionrow">
                      <button type="button" className="btn" onClick={() => onUse(s.ref)} aria-label={`Look at this shared payment: ${s.txn.payee}, ${s.txn.date}`}>Look at this one</button>
                      <button type="button" className="btn" onClick={() => void reject(s)} aria-label={`Not this payment: ${s.txn.payee}, ${s.txn.date}`}>Not this payment</button>
                    </div>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {data.r.rejected.length > 0 && (
            <details className="bl-sec">
              <summary>Payments you said are not this one ({data.r.rejected.length})</summary>
              <p className="muted small">Only for this billing period. Nothing in Finance was changed, and the bill is not marked paid or skipped.</p>
              <ul className="plain bl-items" aria-label="Rejected suggestions">
                {data.r.rejected.map((x) => (
                  <li key={x.rec.id} className="bl-rec">
                    <span>{factWords(x.rec.body, money)}</span>
                    {REJECT_STATE[x.state] && <span className="muted small">{REJECT_STATE[x.state]}</span>}
                    <span className="bl-actionrow"><button type="button" className="btn" onClick={() => void again(x)}>Look at it again</button></span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </section>
  );
}
