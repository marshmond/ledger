import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useNavigate } from '../../core/router';
import Modal from '../../shell/Modal';
import { useToast } from '../../ui/Toast';
import { useToday } from '../../ui/useToday';
import { day, useMoney, type Money } from './BillsParts';
import { newOp } from './cycleData';
import { loadObligations } from './data';
import type { Candidate, CandidateTier } from './discovery';
import { decisionRow, loadDiscovery, recordDecision, rememberOnBill, removeDecision, snapOf } from './discoveryData';
import { seedOfCandidate, seedOfRule, type FormSeed } from './formSeed';
import ObligationForm from './ObligationForm';
import { type ObligationRecord } from './model';
import { obligationRoute } from './paths';
import { frequencyWords } from './scheduledLink';
import { runUndo } from './undo';
import type { RecurringRule } from '../../types';

const TIER_WORDS: Record<CandidateTier, string> = { strong: 'Strong pattern', possible: 'Possible pattern', 'more-info': 'Needs more information' };
const SHOWN = 5;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** One line about a pattern: how often, how many payments, the last one and a typical amount. No percentage, ever. */
const summary = (c: Candidate, money: Money) =>
  `${c.frequency ? cap(frequencyWords(c.frequency)) : 'Two payments'} · ${c.count} payment${c.count === 1 ? '' : 's'} · last ${day(c.lastDate)} · ${c.amounts.fixed ? 'about' : 'typically'} ${money(c.amounts.typical)}${c.amounts.fixed ? '' : ' (it varies)'}`;

/**
 * "Discover recurring expenses": payees in your Finance history that repeat on a regular schedule, offered as SUGGESTIONS. Looking, reviewing and setting
 * aside change nothing in Finance and create no bill; a bill is made only from an editable form you confirm, and it starts with no payment linked.
 * Amounts follow Hide Amounts. Groups are collapsed so a long history never becomes a long list.
 */
export function DiscoverCard() {
  const today = useToday();
  const toast = useToast();
  const navigate = useNavigate();
  const { money } = useMoney();
  const data = useLiveQuery(() => loadDiscovery(today).then((r) => ({ ok: true as const, r })).catch(() => ({ ok: false as const })), [today]);
  const [review, setReview] = useState<Candidate | null>(null);
  const [making, setMaking] = useState<FormSeed | null>(null);
  const [all, setAll] = useState(false);

  async function lookAgain(c: Candidate) {
    if (!c.decision) return;
    try {
      const row = await decisionRow(c.decision.id);
      if (!row) throw new Error('That choice can no longer be changed here.');
      const r = await removeDecision(c.decision.id, row.updatedAt);
      toast('Ledger may suggest this again.', () => runUndo(r.undo, toast).then(() => undefined));
    } catch (e) { toast(e instanceof Error ? e.message : 'Could not change that. Nothing was changed.'); }
  }

  const r = data?.ok ? data.r : null;
  const list = r ? (all ? r.suggestions : r.suggestions.slice(0, SHOWN)) : [];
  return (
    <section className="card bl-card" aria-labelledby="bl-disc-h">
      <h2 id="bl-disc-h">Discover recurring expenses</h2>
      <p className="muted small">Ledger looks at the payments already in Finance for payees that repeat on a regular schedule, so you do not have to type every bill by hand. These are only suggestions: nothing becomes a bill, and no payment is linked, until you say so.</p>
      {!data ? <p className="muted" role="status">Looking at your Finance history…</p> : !r ? <p className="bl-warn" role="alert">Ledger could not read your Finance history just now. Nothing was changed. Try again in a moment.</p> : (
        <>
          {r.suggestions.length === 0 ? (
            <p className="muted" role="status" data-testid="disc-empty">{r.scanned.transactions === 0 ? 'There are no payments in Finance to look at yet.' : `Nothing in your ${r.scanned.transactions} payment${r.scanned.transactions === 1 ? '' : 's'} looks like a regular bill or subscription yet. Ledger needs at least three payments to the same payee at a steady spacing.`}</p>
          ) : (
            <ul className="plain bl-items bl-disc-list" aria-label="Suggested recurring expenses">
              {list.map((c) => (
                <li key={c.key} className="bl-disc-row" data-testid="candidate">
                  <div className="bl-row-main">
                    <strong>{c.payee}</strong> <span className={`bl-chip${c.tier === 'strong' ? ' bl-l-paid' : ''}`}>{TIER_WORDS[c.tier]}</span>
                    <span className="muted small bl-disc-sum">{summary(c, money)}</span>
                    {c.rules.length > 0 && <span className="muted small">A Finance scheduled payment may stand for this.</span>}
                  </div>
                  <div className="bl-row-side"><button type="button" className="btn" onClick={() => setReview(c)} aria-label={`Review the suggestion: ${c.payee}`}>Review</button></div>
                </li>
              ))}
            </ul>
          )}
          {r.suggestions.length > SHOWN && <button type="button" className="btn" aria-expanded={all} onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show all ${r.suggestions.length} suggestions`}</button>}

          {r.moreInfo.length > 0 && (
            <details className="bl-sec">
              <summary>Needs more information ({r.moreInfo.length})</summary>
              <p className="muted small">Only two payments so far, for nearly the same amount. Two payments do not make a pattern, so Ledger does not say how often they repeat. A third one would.</p>
              <ul className="plain bl-items">
                {r.moreInfo.map((c) => <li key={c.key} className="bl-disc-row"><div className="bl-row-main"><strong>{c.payee}</strong><span className="muted small bl-disc-sum">{summary(c, money)}</span></div><div className="bl-row-side"><button type="button" className="btn" onClick={() => setReview(c)} aria-label={`Review the suggestion: ${c.payee}`}>Review</button></div></li>)}
              </ul>
            </details>
          )}

          {r.rulesNotTracked.length > 0 && (
            <details className="bl-sec">
              <summary>Scheduled payments in Finance that are not a bill here ({r.rulesNotTracked.length})</summary>
              <p className="muted small">These are plans you set up in Finance. Making a bill from one only fills in the form for you: the Scheduled payment is not changed, and no past payment is copied.</p>
              <ul className="plain bl-items">
                {r.rulesNotTracked.map((rule: RecurringRule) => (
                  <li key={rule.id} className="bl-disc-row" data-testid="untracked-rule">
                    <div className="bl-row-main"><strong>{rule.payee}</strong><span className="muted small bl-disc-sum">{cap(frequencyWords(rule.frequency))} · {money(Math.abs(rule.amountCents))}</span></div>
                    <div className="bl-row-side"><button type="button" className="btn" onClick={() => setMaking(seedOfRule(rule))} aria-label={`Make a bill from the scheduled payment: ${rule.payee}`}>Make a bill from this</button></div>
                  </li>
                ))}
              </ul>
            </details>
          )}

          {r.tracked.length > 0 && (
            <details className="bl-sec">
              <summary>Already in Bills ({r.tracked.length})</summary>
              <ul className="plain bl-items">{r.tracked.map((c) => <li key={c.key}><strong>{c.payee}</strong> <span className="muted small">is covered by <Link to={obligationRoute(c.existing!.id)}>{c.existing!.data.title}</Link>. {summary(c, money)}</span></li>)}</ul>
            </details>
          )}

          {r.hidden.length > 0 && (
            <details className="bl-sec">
              <summary>Set aside ({r.hidden.length})</summary>
              <p className="muted small">You said these are not recurring, or to look again later. They come back on their own only if the pattern changes a lot (or, for "for now", after a while).</p>
              <ul className="plain bl-items">
                {r.hidden.map((c) => (
                  <li key={c.key} className="bl-disc-row">
                    <div className="bl-row-main"><strong>{c.payee}</strong><span className="muted small bl-disc-sum">{c.state === 'not-recurring' ? 'You said: not a recurring expense' : `Set aside for now on ${day(c.decision!.on)}`}</span></div>
                    <div className="bl-row-side"><button type="button" className="btn" onClick={() => void lookAgain(c)}>Look at it again</button></div>
                  </li>
                ))}
              </ul>
            </details>
          )}

          {(r.loanLeftOut > 0 || r.endedLeftOut > 0) && (
            <p className="muted small">
              {r.loanLeftOut > 0 ? `${r.loanLeftOut} payee${r.loanLeftOut === 1 ? '' : 's'} that look like a loan payment ${r.loanLeftOut === 1 ? 'is' : 'are'} left out, because loans are tracked on the Loans page. ` : ''}
              {r.endedLeftOut > 0 ? `${r.endedLeftOut} pattern${r.endedLeftOut === 1 ? '' : 's'} match${r.endedLeftOut === 1 ? 'es' : ''} a bill you ended and ${r.endedLeftOut === 1 ? 'is' : 'are'} not suggested again.` : ''}
            </p>
          )}
        </>
      )}
      {review && <ReviewDialog c={review} onClose={() => setReview(null)} onCreate={(seed) => { setReview(null); setMaking(seed); }} />}
      {making && <ObligationForm seed={making} onClose={() => setMaking(null)} onSaved={(id) => navigate(obligationRoute(id))} />}
    </section>
  );
}

/**
 * Review one suggestion. Reviewing itself writes nothing. The four choices mean four different things, and each says what it does and does not do.
 */
function ReviewDialog({ c, onClose, onCreate }: { c: Candidate; onClose: () => void; onCreate: (seed: FormSeed) => void }) {
  const toast = useToast();
  const today = useToday();
  const { money } = useMoney();
  const bills = useLiveQuery(() => loadObligations().then((x) => x.filter((o) => o.data.status !== 'ended')), []) ?? [];
  const [pick, setPick] = useState('');
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [op] = useState(newOp); // one per open dialog: a second press writes nothing
  const from = { key: c.key, snap: snapOf(c), op };

  async function decide(decision: 'not-recurring' | 'dismissed') {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const r = await recordDecision({ key: c.key, decision, snap: from.snap, today, op: from.op });
      toast(decision === 'dismissed' ? 'Set aside for now. Nothing was created or changed.' : 'Noted: not a recurring expense. Nothing was created or changed.', r.reused ? undefined : () => runUndo(r.undo, toast).then(() => undefined));
      onClose();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save that. Nothing was changed.'); setBusy(false); }
  }
  async function link() {
    const bill = bills.find((b: ObligationRecord) => String(b.id) === pick);
    if (busy || !bill) return;
    setBusy(true); setError('');
    try {
      const r = await rememberOnBill({ obligationId: bill.id, expect: bill.updatedAt, from, hint: remember ? seedOfCandidate(c).payeeHint : null, today });
      toast(`Linked to “${bill.data.title}”. No payment was linked and nothing in Finance changed.`, r.reused ? undefined : () => runUndo(r.undo, toast).then(() => undefined));
      onClose();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not link it. Nothing was changed.'); setBusy(false); }
  }

  const shownOcc = c.occurrences.slice(-12);
  return (
    <Modal title={`Review: ${c.payee}`} onClose={onClose} wide>
      <div className="bl-form">
        <p className="bl-chips"><span className={`bl-chip${c.tier === 'strong' ? ' bl-l-paid' : ''}`}>{TIER_WORDS[c.tier]}</span> <span className="muted small">{summary(c, money)}</span></p>
        <h3 className="bl-h3">Why Ledger thinks it may recur</h3>
        <ul className="plain bl-ev">{c.reasons.map((x, i) => <li key={i}>{x}</li>)}</ul>
        {c.uncertain.length > 0 && <><h3 className="bl-h3">What is not certain</h3><ul className="plain bl-ev bl-ev-against">{c.uncertain.map((x, i) => <li key={i}>{x}</li>)}</ul></>}
        <h3 className="bl-h3">The payments Ledger saw ({c.count})</h3>
        <ul className="plain bl-items" aria-label="Observed payments">
          {c.occurrences.length > shownOcc.length && <li className="muted small">…and {c.occurrences.length - shownOcc.length} earlier</li>}
          {shownOcc.map((o) => <li key={o.txnId}>{day(o.date)} · {money(o.cents)}</li>)}
        </ul>
        {c.similar.length > 0 && <p className="small">A bill with a similar name: {c.similar.map((s) => s.data.title).join(', ')}. It may be the same thing; "Link to an existing bill" below says so.</p>}
        {c.rules.length > 0 && <p className="small">Finance has a scheduled payment that may stand for this: {c.rules.map((x) => `${x.rule.payee} (${frequencyWords(x.rule.frequency)}${x.live ? '' : ', switched off'}${x.linkedTo ? `, already linked to "${x.linkedTo.data.title}"` : ''})`).join('; ')}. It is a plan; it does not show that payments happened.</p>}
        <p className="muted small">Looking at this changes nothing. Pick what you want to do; each choice is separate.</p>

        <div className="bl-sub">
          <strong>Create a bill from this suggestion</strong>
          <p className="muted small">Opens the Add form with these details filled in. You can change anything, and nothing is saved until you press Add. The bill starts with no payments linked; link past payments yourself afterwards.</p>
          <div className="bl-actionrow"><button type="button" className="btn primary" onClick={() => onCreate(seedOfCandidate(c))}>Create a bill from this suggestion</button></div>
        </div>

        {bills.length > 0 && (
          <div className="bl-sub">
            <strong>Link to an existing bill</strong>
            <p className="muted small">This is already one of your bills. It creates nothing and links no payment.</p>
            <label className="f">Which bill?
              <select value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Which bill is this already">
                <option value="">Choose a bill…</option>
                {bills.map((b: ObligationRecord) => <option key={b.id} value={b.id}>{b.data.title}</option>)}
              </select>
            </label>
            <label className="as-check"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Remember the payee name so Ledger can suggest that bill's payments later</label>
            <div className="bl-actionrow"><button type="button" className="btn" disabled={!pick || busy} onClick={() => void link()}>Link to this bill</button></div>
          </div>
        )}

        <div className="bl-sub">
          <strong>Not a recurring expense, or not now</strong>
          <p className="muted small">"Not a recurring expense" says this is not a bill or subscription; it stays hidden unless the pattern changes a lot. "Dismiss for now" only postpones deciding. Neither creates a bill, links a payment or changes Finance, and you can take either back under "Set aside".</p>
          <div className="bl-actionrow">
            <button type="button" className="btn" disabled={busy} onClick={() => void decide('not-recurring')}>Not a recurring expense</button>
            <button type="button" className="btn" disabled={busy} onClick={() => void decide('dismissed')}>Dismiss for now</button>
          </div>
        </div>
        {error && <div className="error" role="alert">{error}</div>}
        <div className="row bl-actions"><button type="button" className="btn" onClick={onClose}>Close without choosing</button></div>
      </div>
    </Modal>
  );
}
