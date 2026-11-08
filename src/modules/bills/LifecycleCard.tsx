import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useToast } from '../../ui/Toast';
import { useToday } from '../../ui/useToday';
import { day, useMoney } from './BillsParts';
import { billLinks, loadArrangementInfos } from './crossLinks';
import { acknowledgeEvidence } from './lifecycleData';
import { ConfirmDialog, ExtendTrialDialog, ServiceLinkDialog, PriceDialog, RenewalDialog, RenewalOutcomeDialog, RequestDialog, ResolveDialog, TrialDialog, TrialOutcomeDialog, WithdrawDialog } from './LifecycleDialogs';
import { lcOf } from './lifecycleRead';
import { PRICE_SOURCE_LABEL } from './lifecycleModel';
import { ackKeyRenewal, ackKeyTrial, effectiveDeadlines, lifecycleStates, nextPriceChange, renewalDates, timeline, type LcConflict, type StateFlag } from './lifecycleState';
import { derive, loadBillsSnapshot } from './readModel';
import { afterFor } from './lifecycleFinance';
import { LifecycleDialog } from './Dialogs';
import { priceNotice } from './priceEvidence';
import { isSubscriptionType, type ObligationRecord } from './model';
import { addDays } from '../../lib/dates';
import { readTerms } from './terms';
import { runUndo } from './undo';

type Dlg = null | { suggest: { from: string; cents: number } } | 'trial' | 'extend' | 'outcome' | 'price' | 'renewal' | 'request' | 'confirm' | 'withdraw' | 'reactivate' | { renewed: string } | { resolve: LcConflict } | { correct: { ids: number[]; row: { from: string; cents: number | null; until: string | null; status: 'fixed' | 'estimated' | 'unknown'; source: null | 'owner'; label: string } } };

const TONE: Record<StateFlag['tone'], string> = { warn: 'bl-state s-warn', info: 'bl-state s-info', calm: 'bl-state' };

/**
 * The subscription's life on one card (B4): where it stands (several states can hold at once), the price and what is coming, the cancellation evidence,
 * disagreements and charges after a cancellation, the readable history, and the optional Household Services link. Everything is derived from recorded
 * evidence; every button opens a preview first. Ordinary bills see only a collapsed "Subscription tools" summary.
 */
export default function LifecycleCard({ ob }: { ob: ObligationRecord }) {
  const today = useToday();
  const toast = useToast();
  const { money } = useMoney();
  const d = ob.data;
  const lc = lcOf(d);
  const terms = readTerms(d.terms);
  const [dlg, setDlg] = useState<Dlg>(null);
  const [link, setLink] = useState('');
  const [ending, setEnding] = useState(false);
  const [svc, setSvc] = useState<{ id: number; action: 'linked' | 'unlinked' } | null>(null);
  const extra = useLiveQuery(async () => {
    const snap = await loadBillsSnapshot();
    // a possible price change noticed from Finance: a reason to look, never applied (priceEvidence.ts)
    const x = derive(snap, today);
    const mine = x.snap.obligations.find((o) => o.id === ob.id);
    const notice = mine ? priceNotice(mine, x.recorded.get(ob.id) ?? [], today) : null;
    return { after: mine ? afterFor(snap.lcFinance, mine, snap.obligations, snap.cycles, today) : null, links: await billLinks(ob.id), arrangements: await loadArrangementInfos(), notice };
  }, [ob.id, ob.updatedAt, today]);
  const states = lifecycleStates(lc, terms, { status: d.status, endedOn: d.endedOn }, today);
  const deadlines = effectiveDeadlines(terms, lc, today);
  const trialEnd = deadlines.find((x) => x.kind === 'trial');
  const notice = deadlines.find((x) => x.kind === 'notice' && x.date >= today) ?? deadlines.find((x) => x.kind === 'notice');
  const nextRenewal = lc.renewal.fact ? renewalDates(lc, today, addDays(today, 400))[0] ?? lc.renewal.fact.body.renewalDate : terms.renewalDate;
  const renewalPassed = lc.renewal.fact && lc.renewal.fact.body.renewalDate < today && !lc.renewal.outcomes.some((o) => o.body.forDate === lc.renewal.fact!.body.renewalDate) && !lc.acked.has(ackKeyRenewal(lc.renewal.fact.body.renewalDate)) ? lc.renewal.fact.body.renewalDate : null;
  const nextPrice = nextPriceChange(lc, today);
  const c = lc.cancel;
  const has = lc.records.length > 0;
  const showAll = isSubscriptionType(d.type) || has;
  const tl = timeline(lc, d.lifecycle, money, today);
  const [allTl, setAllTl] = useState(false);
  const live = d.status === 'active';
  const priceNow = lc.priceRows.filter((r) => r.origin !== 'gap').length;

  async function leave(key: string) {
    try { const r = await acknowledgeEvidence(ob.id, key, today); toast('Left as is. It will come back only if the evidence changes.', () => runUndo(r.undo, toast).then(() => undefined)); }
    catch (e) { toast(e instanceof Error ? e.message : 'Could not save. Nothing was changed.'); }
  }
  const doLink = (id: number, action: 'linked' | 'unlinked') => setSvc({ id, action });

  return (
    <>
      <section className="card bl-card" aria-labelledby="bl-lc-h" data-testid="lifecycle-card">
        <div className="bl-card-head"><h2 id="bl-lc-h">Subscription life</h2></div>
        {!showAll ? (
          <details>
            <summary>Subscription tools (trial, price changes, renewal, cancellation)</summary>
            <p className="muted small">Most bills do not need these. They record what you know; Ledger never cancels, renews or reprices anything.</p>
            <div className="bl-actionrow">{live && <><button className="btn" onClick={() => setDlg('request')}>Record cancellation request</button><button className="btn" onClick={() => setDlg('price')}>Record a price change</button><button className="btn" onClick={() => setDlg('renewal')}>Renewal terms</button><button className="btn" onClick={() => setDlg('trial')}>Record a trial</button></>}</div>
          </details>
        ) : (
          <>
            {extra?.notice && !extra.notice.acknowledged && live && (
              <div className="bl-banner" role="status" data-testid="price-notice">
                <strong>Your latest recorded payment differs from the expected price.</strong> The payment linked for {extra.notice.date ? day(extra.notice.date) : 'the latest billing period'} was {money(extra.notice.paidCents)}, and the expected price is {money(extra.notice.expectedCents)} ({money(extra.notice.differenceCents)} more).
                {extra.notice.matchedBefore > 0 ? ` ${extra.notice.matchedBefore} earlier linked payment${extra.notice.matchedBefore === 1 ? '' : 's'} matched the expected price.` : ''} This might be a price change, or it might be tax, a fee, a credit or a one-off. Ledger has not changed the expected price and does not assume this is permanent.
                <div className="bl-actionrow">
                  {extra.notice.date && <button className="btn" onClick={() => setDlg({ suggest: { from: extra.notice!.date!, cents: extra.notice!.paidCents } })}>Record a price change…</button>}
                  <button className="btn" onClick={() => void leave(extra.notice!.key)}>Leave as is</button>
                </div>
              </div>
            )}
            <ul className="plain bl-states" aria-label="Where it stands">
              {states.length === 0 && <li className="bl-state"><strong>{d.status === 'paused' ? 'Paused' : d.status === 'ended' ? 'Ended' : 'Active'}</strong><span className="muted small"> Nothing about a trial, renewal or cancellation needs a look.</span></li>}
              {states.map((s) => <li key={s.id} className={TONE[s.tone]} data-state={s.id}><strong>{s.label}</strong><span className="muted small"> {s.detail}</span></li>)}
            </ul>
            <dl className="bl-facts">
              <div className="bl-fact"><dt>Next price change</dt><dd>{nextPrice ? `${day(nextPrice.from)}: ${nextPrice.cents === null ? 'not known' : `${nextPrice.estimated ? 'about ' : ''}${money(nextPrice.cents)}`}` : 'None recorded'}</dd></div>
              {trialEnd && <div className="bl-fact"><dt>Trial ends</dt><dd>{day(trialEnd.date)}{lc.trial.fact ? <span className="muted small"> · payment method on file: {lc.trial.fact.body.paymentOnFile}; conversion: {lc.trial.fact.body.conversion === 'auto' ? 'automatic' : lc.trial.fact.body.conversion === 'manual' ? 'manual' : 'not known'}{lc.trial.fact.body.convertsToCents !== null ? `; ${money(lc.trial.fact.body.convertsToCents)} after` : '; price after not known'}</span> : null}</dd></div>}
              {nextRenewal && <div className="bl-fact"><dt>Next renewal (expected)</dt><dd>{day(nextRenewal)}{lc.renewal.fact && !lc.renewal.fact.body.confirmed ? <span className="muted small"> · estimate</span> : null}</dd></div>}
              {notice && <div className="bl-fact"><dt>Cancel-by deadline</dt><dd>{day(notice.date)}</dd></div>}
              {c.request && <div className="bl-fact"><dt>Cancellation requested</dt><dd>{day(c.request.body.requestedOn)}{c.confirms.length === 0 ? ' · confirmation pending' : ''}</dd></div>}
              {c.confirm && <div className="bl-fact"><dt>Confirmed, effective</dt><dd>{day(c.confirm.body.effectiveOn)}<span className="muted small"> · confirmed {c.confirm.body.confirmedOn}</span></dd></div>}
            </dl>
            <div className="bl-actionrow">
              {states.some((s) => s.id === 'cancel-effective') && live && <button className="btn primary" onClick={() => setEnding(true)}>Mark it ended…</button>}
              {live && c.confirms.length === 0 && <button className="btn" onClick={() => setDlg('request')}>Record cancellation request</button>}
              {live && <button className="btn" onClick={() => setDlg('confirm')}>{c.confirm ? 'Provider changed the date' : 'Record cancellation confirmation'}</button>}
              {(c.requests.length > 0 || c.confirms.length > 0) && <button className="btn" onClick={() => setDlg('withdraw')}>Withdraw the cancellation</button>}
              {(c.confirms.length > 0 || d.status === 'ended') && <button className="btn" onClick={() => setDlg('reactivate')}>Reactivated</button>}
              {live && <button className="btn" onClick={() => setDlg('price')}>Record a price change</button>}
              {live && <button className="btn" onClick={() => setDlg('renewal')}>{lc.renewal.fact ? 'Edit renewal terms' : 'Renewal terms'}</button>}
              {live && !lc.trial.fact && <button className="btn" onClick={() => setDlg('trial')}>Record a trial</button>}
              {live && lc.trial.fact && !lc.trial.outcome && <><button className="btn" onClick={() => setDlg('extend')}>Trial extended</button><button className="btn" onClick={() => setDlg('outcome')}>What happened to the trial?</button></>}
              {renewalPassed && <button className="btn primary" onClick={() => setDlg({ renewed: renewalPassed })}>Did it renew?</button>}
              {states.some((s) => s.id === 'trial-check') && trialEnd && <button className="btn" onClick={() => void leave(ackKeyTrial(trialEnd.date))}>Leave as is</button>}
            </div>
            <p className="muted small">These record what you know. Ledger does not contact the provider, cancel, renew, convert or change a price by itself, and nothing here touches Finance.</p>
          </>
        )}
      </section>

      {lc.conflicts.length > 0 && (
        <section className="card bl-card" aria-labelledby="bl-lcc-h">
          <h2 id="bl-lcc-h">Records that disagree</h2>
          <ul className="plain bl-items">
            {lc.conflicts.map((x) => (
              <li key={x.key} data-testid="lc-conflict">
                <p style={{ margin: 0 }}>{x.text}{x.acknowledged ? <span className="muted small"> You chose to leave this as it is. It still counts for nothing until you choose.</span> : null}</p>
                <div className="bl-actionrow">
                  {x.kind !== 'unreadable' && x.kind !== 'price-overlap' && <button className="btn primary" onClick={() => setDlg({ resolve: x })}>Choose which stands</button>}
                  {!x.acknowledged && <button className="btn" onClick={() => void leave(x.key)}>Leave as is</button>}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {extra?.after && (extra.after.charges.length > 0 || extra.after.refunds.length > 0 || extra.after.weaker.length > 0) && (
        <section className="card bl-card" aria-labelledby="bl-aft-h" data-testid="after-cancel">
          <h2 id="bl-aft-h">Possible charges after the cancellation</h2>
          <p className="muted small">Transactions in Finance that look like this subscription, dated after {extra.after.effectiveOn}. A matching name is a reason to look, not proof of a mistake: a final or partial-period charge can be correct. Ledger does not dispute, reverse, link or refund anything, and does not conclude the cancellation failed.</p>
          <ul className="plain bl-items">
            {[...extra.after.charges, ...extra.after.refunds].sort((a, b) => a.date.localeCompare(b.date)).map((t) => (
              <li key={t.key}><strong>{t.kind === 'refund' ? 'Money back' : 'Charge'}</strong> · {day(t.date)} · {money(t.cents)} · {t.status}{t.linkedSlot ? ' · linked to this bill' : ''}<br /><span className="muted small">{t.notes.join(' ')}</span></li>
            ))}
          </ul>
          {extra.after.weaker.length > 0 && <details><summary>Weaker resemblances, not counted ({extra.after.weaker.length})</summary><ul className="plain bl-items">{extra.after.weaker.map((t) => <li key={t.key}>{day(t.date)} · {money(t.cents)} · {t.status}</li>)}</ul></details>}
          <div className="bl-actionrow">{extra.after.counted.length > 0 && !extra.after.acknowledged && <button className="btn" onClick={() => void leave(extra.after!.evidenceKey)}>Leave as is</button>}</div>
          <p className="muted small">To record a final bill, use an extra bill on the billing periods card; to link a payment, use Link a Finance payment there. Neither is done for you.</p>
        </section>
      )}

      {(has || priceNow > 1) && (
        <section className="card bl-card" aria-labelledby="bl-price-h">
          <div className="bl-card-head"><h2 id="bl-price-h">Price history</h2>{live && <button className="btn" onClick={() => setDlg('price')}>Record a price change</button>}</div>
          <ul className="plain bl-items">
            {lc.priceRows.map((r, i) => (
              <li key={`${r.from}-${r.recordId ?? i}-${r.origin}`}>
                <strong>{day(r.from)}</strong>{r.until ? ` to ${day(r.until)}` : ''} · {r.origin === 'gap' ? 'no price recorded after this' : r.origin === 'conflict' ? 'records disagree, so unknown' : r.cents === null ? 'not known' : `${r.status === 'estimated' ? 'about ' : ''}${money(r.cents)}`}{r.label ? ` (${r.label})` : ''}
                <span className="muted small">{r.origin === 'baseline' ? ' · the price you entered first' : r.source ? ` · ${PRICE_SOURCE_LABEL[r.source]}` : ''}</span>
                {r.origin === 'recorded' && r.recordId !== null && live && <button className="link small" onClick={() => setDlg({ correct: { ids: [r.recordId!], row: { from: r.from, cents: r.cents, until: r.until, status: r.status, source: null, label: r.label } } })}> Correct</button>}
              </li>
            ))}
          </ul>
          <p className="muted small">A price only changes what is expected from its start day. Bills you recorded and payments in Finance keep their own amounts; a provider credit is not a price change.</p>
        </section>
      )}

      {(d.status !== 'ended' || (extra?.links.length ?? 0) > 0) && extra && (extra.arrangements.length > 0 || extra.links.length > 0) && (
        <section className="card bl-card" aria-labelledby="bl-svc-h">
          <h2 id="bl-svc-h">Household Services</h2>
          {extra.links.length === 0 ? <p className="muted">Not linked. If a Household Services arrangement (such as the cleaners) is the same arrangement this bill pays for, you can link them. Nothing is merged, and nothing is linked from matching names.</p> : (
            <ul className="plain bl-items">{extra.links.map((l) => <li key={l.linkId}>Linked to <strong>{l.arrangement ? l.arrangement.title : 'an arrangement that is not on this device'}</strong>{l.arrangement?.status === 'ended' ? ' (ended)' : ''} <button className="link small" onClick={() => void doLink(l.arrangementId, 'unlinked')}>Unlink</button></li>)}</ul>
          )}
          {extra.arrangements.some((a) => !extra.links.some((l) => l.arrangementId === a.id)) && (
            <div className="bl-two">
              <label className="f">Link to an arrangement<select value={link} onChange={(e) => setLink(e.target.value)} aria-label="Household Services arrangement"><option value="">Choose…</option>{extra.arrangements.filter((a) => !extra.links.some((l) => l.arrangementId === a.id)).map((a) => <option key={a.id} value={a.id}>{a.title}{a.provider ? `, ${a.provider}` : ''}</option>)}</select></label>
              <div className="f"><span>&nbsp;</span><button className="btn" disabled={!link} onClick={() => void doLink(Number(link), 'linked')}>Link…</button></div>
            </div>
          )}
          <p className="muted small">The link does not change any total, merge any record, or hide any service visit.</p>
        </section>
      )}

      {tl.length > 0 && (
        <section className="card bl-card" aria-labelledby="bl-tl-h">
          <h2 id="bl-tl-h">History</h2>
          <ul className="plain bl-items bl-tl" aria-label="History">
            {(allTl ? tl : tl.slice(-8)).map((e, i) => <li key={`${e.date}-${i}`} className={e.muted ? 'muted' : ''}>{day(e.date)} · {e.text}{e.kind === 'expected' ? <span className="bl-tag"> expected</span> : null}</li>)}
          </ul>
          {tl.length > 8 && <button className="link small" onClick={() => setAllTl(!allTl)}>{allTl ? 'Show fewer' : `Show all ${tl.length}`}</button>}
          <p className="muted small">Only what was recorded, and dates still ahead marked as expected. Corrected or withdrawn records stay here, dimmed.</p>
        </section>
      )}

      {ending && <LifecycleDialog obligation={ob} action="end" initialDate={lc.cutoffOn ?? undefined} onClose={() => setEnding(false)} />}
      {svc && <ServiceLinkDialog ob={ob} arrangementId={svc.id} action={svc.action} onClose={() => { setSvc(null); setLink(''); }} />}
      {dlg && typeof dlg === 'object' && 'suggest' in dlg && <PriceDialog ob={ob} start={{ from: dlg.suggest.from, cents: dlg.suggest.cents, until: null, status: 'fixed', source: 'finance', label: '' }} onClose={() => setDlg(null)} />}
      {dlg === 'trial' && <TrialDialog ob={ob} onClose={() => setDlg(null)} />}
      {dlg === 'extend' && <ExtendTrialDialog ob={ob} onClose={() => setDlg(null)} />}
      {dlg === 'outcome' && <TrialOutcomeDialog ob={ob} onClose={() => setDlg(null)} />}
      {dlg === 'price' && <PriceDialog ob={ob} onClose={() => setDlg(null)} />}
      {dlg === 'renewal' && <RenewalDialog ob={ob} onClose={() => setDlg(null)} />}
      {dlg === 'request' && <RequestDialog ob={ob} onClose={() => setDlg(null)} />}
      {dlg === 'confirm' && <ConfirmDialog ob={ob} onClose={() => setDlg(null)} />}
      {dlg === 'withdraw' && <WithdrawDialog ob={ob} mode="withdraw" onClose={() => setDlg(null)} />}
      {dlg === 'reactivate' && <WithdrawDialog ob={ob} mode="reactivate" onClose={() => setDlg(null)} />}
      {dlg && typeof dlg === 'object' && 'renewed' in dlg && <RenewalOutcomeDialog ob={ob} forDate={dlg.renewed} onClose={() => setDlg(null)} />}
      {dlg && typeof dlg === 'object' && 'resolve' in dlg && <ResolveDialog ob={ob} conflict={dlg.resolve} onClose={() => setDlg(null)} />}
      {dlg && typeof dlg === 'object' && 'correct' in dlg && <PriceDialog ob={ob} correct={dlg.correct.ids} start={{ ...dlg.correct.row, source: null }} onClose={() => setDlg(null)} />}
    </>
  );
}
