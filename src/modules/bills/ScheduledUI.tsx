import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import Modal from '../../shell/Modal';
import { useToast } from '../../ui/Toast';
import { useToday } from '../../ui/useToday';
import type { RecurringRule } from '../../types';
import { day, Lines, useMoney, type Money } from './BillsParts';
import { isLoanExcluded, type ObligationRecord } from './model';
import { driftWords, frequencyWords, ruleEnded, type DriftNote } from './scheduledLink';
import { keepRuleLines, keepRuleOn, linkRule, loadLinkedRules, loadRuleChoices, unlinkRule, acknowledgeRuleConflict } from './scheduledLinkData';
import { runUndo } from './undo';

type AccountName = (id: number) => string;
const RULE_PATH = (id: number) => `#/ledger/scheduled?rule=${id}`;
const FINANCE_OWNS = 'Finance controls the scheduled payment. Bills tracks the obligation and its billing information.';
const NOT_PROOF = 'An approved Scheduled item is not evidence that the payee received the payment.';

const statusOf = (r: RecurringRule, today: string) => (!r.active ? 'Switched off in Finance' : ruleEnded(r, today) ? `Ended ${r.endDate}` : 'Active in Finance');

/** The facts of one rule, in the same words in the panel and in the link preview. Amounts follow Hide Amounts. */
function RuleFacts({ r, money, account, next, today }: { r: RecurringRule; money: Money; account: AccountName; next?: string | null; today: string }) {
  return (
    <dl className="bl-facts">
      <div><dt>Payee</dt><dd>{r.payee}</dd></div>
      <div><dt>Expected amount</dt><dd>{money(Math.abs(r.amountCents))}</dd></div>
      <div><dt>Repeats</dt><dd>{frequencyWords(r.frequency)}, from {day(r.startDate)}{r.endDate ? `, until ${day(r.endDate)}` : ''}</dd></div>
      {next !== undefined && <div><dt>Next scheduled</dt><dd>{next ? day(next) : 'None in the next year'}</dd></div>}
      <div><dt>Account</dt><dd>{account(r.accountId)}</dd></div>
      <div><dt>State</dt><dd><span className={`bl-chip${r.active && !ruleEnded(r, today) ? ' bl-l-paid' : ''}`}>{statusOf(r, today)}</span></dd></div>
    </dl>
  );
}

function Notes({ notes, money }: { notes: DriftNote[]; money: Money }) {
  const check = notes.filter((n) => n.level === 'check'), info = notes.filter((n) => n.level === 'info');
  return (
    <>
      {check.length > 0 && (
        <div className="bl-note" role="note">
          <strong>Worth a look</strong>
          <ul className="plain bl-items">{check.map((n, i) => <li key={i}>{driftWords(n, money)}</li>)}</ul>
          <p className="muted small">Ledger changes nothing about either side. Fix the bill or the Finance payment yourself if they should agree.</p>
        </div>
      )}
      {info.length > 0 && (
        <div className="muted small" role="note">
          <strong>Differences you may expect</strong>
          <ul className="plain bl-items">{info.map((n, i) => <li key={i}>{driftWords(n, money)}</li>)}</ul>
        </div>
      )}
    </>
  );
}

/**
 * "Payment instruction in Finance": a READ-ONLY panel on a bill. Finance owns the Scheduled payment, its dates, its approval and the forecast; the bill only
 * points at it. Ledger shows what Finance says, explains where the bill and the rule disagree, and never changes either, never posts or skips anything,
 * and never treats an approved posting as proof that the provider was paid.
 */
export function ScheduledCard({ ob, account }: { ob: ObligationRecord; account: AccountName }) {
  const today = useToday();
  const { money } = useMoney();
  const [linking, setLinking] = useState(false);
  const [removing, setRemoving] = useState<number | null>(null);
  const data = useLiveQuery(() => loadLinkedRules(ob, today), [ob.id, ob.updatedAt, today]);
  const blocked = ob.data.status === 'ended' ? 'An ended bill cannot be linked to a scheduled payment.' : isLoanExcluded(ob.data) ? 'Loan payments are tracked on the Loans page.' : null;
  const views = data?.views ?? [];
  return (
    <section className="card bl-card" aria-labelledby="bl-sched-h">
      <div className="bl-card-head">
        <h2 id="bl-sched-h">Payment instruction in Finance</h2>
        {!blocked && <button type="button" className="btn" onClick={() => setLinking(true)}>{views.length ? 'Link another scheduled payment' : 'Link existing Finance Scheduled payment'}</button>}
      </div>
      <p className="muted small">{FINANCE_OWNS} {NOT_PROOF}</p>
      {!data ? <p className="muted" role="status">Loading…</p> : views.length === 0 ? (
        <p className="muted">{blocked ?? 'No Finance Scheduled payment is linked to this bill. If you already schedule this payment in Finance, you can point this bill at it. That changes nothing in Finance and records no payment.'}</p>
      ) : views.map((v) => (
        <div key={v.ruleId} className="bl-sub" data-testid="linked-rule">
          {v.rule ? <RuleFacts r={v.rule} money={money} account={account} next={v.next} today={today} /> : <p className="bl-warn" role="alert">A linked scheduled payment (number {v.ruleId}) is not on this device, or it was deleted. The bill is unchanged, and nothing is assumed paid or unpaid.</p>}
          <Notes notes={v.rule ? v.notes : []} money={money} />
          <div className="bl-actionrow">
            {v.rule && <a className="btn" href={RULE_PATH(v.ruleId)}>Open this scheduled payment in Finance</a>}
            <button type="button" className="btn" onClick={() => setRemoving(v.ruleId)}>Remove this link</button>
          </div>
        </div>
      ))}
      {linking && <LinkRuleDialog ob={ob} account={account} onClose={() => setLinking(false)} />}
      {removing !== null && <RemoveRuleDialog ob={ob} ruleId={removing} onClose={() => setRemoving(null)} />}
    </section>
  );
}

/** Pick one existing Finance spending rule, read exactly what it is, and confirm. Income and transfers are not shown (they cannot be bills); a rule another bill holds is shown with the reason it cannot be used. */
export function LinkRuleDialog({ ob, account, onClose }: { ob: ObligationRecord; account: AccountName; onClose: () => void }) {
  const toast = useToast();
  const today = useToday();
  const { money } = useMoney();
  const [picked, setPicked] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const choices = useLiveQuery(() => loadRuleChoices(ob, today), [ob.id, ob.updatedAt, today]);
  const chosen = choices?.spending.find((c) => c.rule.id === picked) ?? null;

  async function confirm() {
    if (busy || !chosen) return;
    setBusy(true); setError('');
    try {
      const r = await linkRule({ obligationId: ob.id, ruleId: chosen.rule.id as number, expect: ob.updatedAt, today });
      toast('Linked. Nothing in Finance was changed.', () => runUndo(r.undo, toast).then(() => undefined));
      onClose();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not link it. Nothing was changed.'); setBusy(false); }
  }

  return (
    <Modal title="Link an existing Finance Scheduled payment" onClose={onClose} wide>
      <div className="bl-form">
        <p className="muted" style={{ margin: 0 }}><strong>{ob.data.title}</strong></p>
        {!chosen ? (
          <>
            <p className="muted small">{FINANCE_OWNS} Linking only makes this bill remember which Scheduled payment it goes with.</p>
            {!choices ? <p className="muted" role="status">Loading…</p> : choices.spending.length === 0 ? <p className="muted">There are no scheduled spending payments in Finance to link.</p> : (
              <ul className="plain bl-items" aria-label="Scheduled payments in Finance">
                {choices.spending.map((c) => (
                  <li key={c.rule.id} className="bl-rec">
                    <span><strong>{c.rule.payee}</strong> <span className="muted small">· {money(Math.abs(c.rule.amountCents))} · {frequencyWords(c.rule.frequency)} · {statusOf(c.rule, today)}</span></span>
                    {c.check.problem ? <span className="bl-warn small">{c.check.problem}</span> : <span className="bl-actionrow"><button type="button" className="btn" onClick={() => setPicked(c.rule.id as number)} aria-label={`Preview linking ${c.rule.payee}`}>Preview</button></span>}
                  </li>
                ))}
              </ul>
            )}
            {choices && choices.notBills > 0 && <p className="muted small">{choices.notBills} other scheduled item{choices.notBills === 1 ? '' : 's'} (income and transfers between your own accounts) {choices.notBills === 1 ? 'is' : 'are'} not shown, because they cannot be bills.</p>}
          </>
        ) : (
          <>
            <h3 className="bl-h3">The scheduled payment you picked</h3>
            <RuleFacts r={chosen.rule} money={money} account={account} today={today} />
            <h3 className="bl-h3">What will happen</h3>
            <Lines lines={[
              'This bill will remember that it goes with this Finance scheduled payment, and show it on the bill.',
              FINANCE_OWNS,
              'Nothing in Finance is changed, posted, skipped or created, and no payment is recorded or marked paid.',
              NOT_PROOF,
              ...chosen.check.warnings,
            ]} />
            <p className="muted small">You can remove the link later, or undo this right after.</p>
            {error && <div className="error" role="alert">{error}</div>}
            <div className="row bl-actions">
              <button type="button" className="btn" onClick={() => setPicked(null)}>Pick another</button>
              <button type="button" className="btn primary" disabled={busy} onClick={() => void confirm()}>Link this scheduled payment</button>
            </div>
          </>
        )}
        {!chosen && error && <div className="error" role="alert">{error}</div>}
        {!chosen && <div className="row bl-actions"><button type="button" className="btn" onClick={onClose}>Close</button></div>}
      </div>
    </Modal>
  );
}

/** Removing a link: a preview in words. The Finance payment and the bill's payment status are untouched. */
export function RemoveRuleDialog({ ob, ruleId, onClose }: { ob: ObligationRecord; ruleId: number; onClose: () => void }) {
  const toast = useToast();
  const today = useToday();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function confirm() {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const r = await unlinkRule({ obligationId: ob.id, ruleId, expect: ob.updatedAt, today });
      toast('Link removed. Nothing in Finance was changed.', () => runUndo(r.undo, toast).then(() => undefined));
      onClose();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not remove it. Nothing was changed.'); setBusy(false); }
  }
  return (
    <Modal title="Remove the link to a Finance scheduled payment" onClose={onClose}>
      <div className="bl-form">
        <Lines lines={[
          `Remove the link from "${ob.data.title}" to this scheduled payment.`,
          'The scheduled payment stays in Finance exactly as it is, and Finance keeps posting it. Only this bill stops pointing at it.',
          'No billing period, payment or status of this bill changes. You can undo this.',
        ]} />
        {error && <div className="error" role="alert">{error}</div>}
        <div className="row bl-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn primary" disabled={busy} onClick={() => void confirm()}>Remove the link</button>
        </div>
      </div>
    </Modal>
  );
}

/** Needs-review repair for one Scheduled payment linked to two bills: the owner chooses which bill keeps it (previewed, guarded), or leaves it as is. */
export function KeepRuleDialog({ ruleId, keep, holders, onClose }: { ruleId: number; keep: ObligationRecord; holders: ObligationRecord[]; onClose: () => void }) {
  const toast = useToast();
  const today = useToday();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const others = holders.filter((h) => h.id !== keep.id);
  async function confirm() {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const r = await keepRuleOn({ ruleId, keepId: keep.id, expect: Object.fromEntries(holders.map((h) => [h.id, h.updatedAt])), today });
      toast('Done. Nothing in Finance was changed.', () => runUndo(r.undo, toast).then(() => undefined));
      onClose();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not do that. Nothing was changed.'); setBusy(false); }
  }
  return (
    <Modal title={`Keep it on “${keep.data.title}”`} onClose={onClose}>
      <div className="bl-form">
        <Lines lines={keepRuleLines(keep.data.title, others.map((o) => o.data.title))} />
        {error && <div className="error" role="alert">{error}</div>}
        <div className="row bl-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn primary" disabled={busy} onClick={() => void confirm()}>Keep it on this bill</button>
        </div>
      </div>
    </Modal>
  );
}

/** "Leave as is" for a shared Scheduled payment: remembered for exactly this set of bills. */
export async function leaveRuleAsIs(ruleId: number, toast: (m: string, undo?: () => Promise<void> | void) => void) {
  try {
    const r = await acknowledgeRuleConflict(ruleId);
    toast('Left as is. If another bill is linked to it later, you will be asked again.', () => runUndo(r.undo, toast).then(() => undefined));
  } catch (e) { toast(e instanceof Error ? e.message : 'Could not save. Nothing was changed.'); }
}
