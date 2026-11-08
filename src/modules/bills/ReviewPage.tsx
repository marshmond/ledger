import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from '../../core/router';
import { EmptyState, PageHeader } from '../../ui/components';
import { useToast } from '../../ui/Toast';
import { useToday } from '../../ui/useToday';
import { FactDialog } from './CycleDialogs';
import { ConflictCard } from './RepairDialogs';
import type { ObligationRecord } from './model';
import { attention, derive, loadBillsSnapshot, type AttentionCategory, type AttentionItem } from './readModel';
import { obligationRoute, overviewRoute, upcomingRoute } from './paths';
import { leaveTaskAsIs } from './cycleRepair';
import { tidyReminders } from './contractData';
import { acknowledgeEvidence } from './lifecycleData';
import { runUndo } from './undo';
import { KeepRuleDialog, leaveRuleAsIs } from './ScheduledUI';
import { ruleLinkConflicts } from './scheduledLink';

const GROUP: { id: AttentionCategory[]; title: string; hint: string }[] = [
  { id: ['conflicts'], title: 'Records that disagree or look alike', hint: 'Nothing was merged or deleted. Choose what to keep, or leave them as they are.' },
  { id: ['typedFinance'], title: 'A typed payment and a Finance payment', hint: 'Ledger counts one source at a time: the Finance payment counts and the typed amount is left out and kept. Choose the Finance payment to set the typed one aside, or leave it as it is.' },
  { id: ['ruleShared'], title: 'One scheduled payment linked to two bills', hint: 'Both links are kept. Choose which bill keeps the Finance scheduled payment, or leave it as it is. Nothing in Finance is changed.' },
  { id: ['duplicatePieces'], title: 'The same payment linked more than once', hint: 'A payment is counted once however many times it is linked. Nothing was deleted; remove a link you did not mean from its billing period.' },
  { id: ['paymentReview', 'paymentChanged'], title: 'Linked Finance payments to look at', hint: 'A linked payment is missing, restructured, no longer spending, reversed or changed in Finance. The link is kept and shown; what Finance says now is used, and one that cannot be trusted counts nothing until you pick the payment again.' },
  { id: ['declaredShort'], title: 'Marked paid in full, but Finance shows less', hint: 'Your declaration is kept and nothing was added or cleared. Link the remaining payment, or remove the declaration if the bill is not paid in full.' },
  { id: ['partlyPaid'], title: 'Partly paid and due', hint: 'Part of the bill is recorded as paid and the rest is due or late.' },
  { id: ['unconfirmedTasks'], title: 'Finished reminder Tasks, not yet confirmed', hint: 'A finished Task is not evidence of payment. Tell Ledger what happened.' },
  { id: ['notConfirmed', 'autopayCheck'], title: 'Not confirmed paid', hint: 'Ledger only knows that no payment is recorded, not that anything is unpaid.' },
  { id: ['records'], title: 'Records that need a look', hint: 'Unreadable records, records without their bill, and periods left behind by a schedule change. All are kept.' },
  { id: ['lifecycleConflict'], title: 'Subscription records that disagree', hint: 'Nothing was merged or deleted, and the disputed date or price is not being used. Open the bill to choose which record stands, or leave it as it is.' },
  { id: ['cancelAwaiting'], title: 'Cancellation requests awaiting confirmation', hint: 'You recorded a request and no confirmation. The subscription is still treated as active: a request is not proof the provider accepted it. Open the bill to record the confirmation, or leave it as it is.' },
  { id: ['afterCancel'], title: 'Possible charges after a cancellation', hint: 'Transactions in Finance that look like this subscription are dated after the cancellation date. A matching name is a reason to look, not proof of a mistake: a final or partial-period charge can be correct. Ledger disputes, reverses and links nothing.' },
  { id: ['scheduledAfterEnd'], title: 'Finance scheduled payments still active', hint: 'Finance still has an active scheduled payment for a bill that was cancelled or ended. Ledger does not change Finance: stop it on the Scheduled page if it should end.' },
  { id: ['passedDates'], title: 'Contract dates that have passed', hint: 'Ledger never renews, cancels or converts anything. Check and update the date.' },
  { id: ['taskProblems'], title: 'Reminder Tasks to check', hint: 'Open Tasks that no longer match their bill. "Update reminders" only removes a Task Bills made and you never changed; yours are never touched.' },
];

/**
 * Everything that needs a person's eyes, from the same list the Today card and the Overview count, so the numbers always agree. Each item links to the
 * bill and, where a repair exists, offers it here with a preview first.
 */
export default function ReviewPage() {
  const today = useToday();
  const toast = useToast();
  const x = useLiveQuery(async () => derive(await loadBillsSnapshot(), today), [today]);
  const [paid, setPaid] = useState<{ ob: ObligationRecord; slot: string; taskId: number | null } | null>(null);
  const [keep, setKeep] = useState<{ ruleId: number; keepId: number } | null>(null);
  if (!x) return <div className="bl"><PageHeader title="Needs review" /><p className="muted">Loading…</p></div>;
  const a = attention(x);
  const byRec = new Map(x.snap.cycles.map((c) => [c.id, c]));
  const obOf = (id: number | null) => (id === null ? undefined : x.snap.obligations.find((o) => o.id === id));
  const acked = x.conflicts.filter((c) => c.acknowledged);

  async function tidy(item: AttentionItem) {
    if (item.obligationId === null) return;
    try {
      const r = await tidyReminders(item.obligationId, today);
      toast(r.retired || r.created ? `Reminders updated (${r.retired} removed, ${r.created} made)` : 'Nothing needed changing. Tasks you changed are never touched.', () => runUndo(r.undo, toast).then(() => undefined));
    } catch (e) { toast(e instanceof Error ? e.message : 'Could not update. Nothing was changed.'); }
  }
  async function leaveEvidence(obligationId: number, key: string) {
    try {
      const r = await acknowledgeEvidence(obligationId, key, today);
      toast('Left as is. It will come back only if the evidence changes.', () => runUndo(r.undo, toast).then(() => undefined));
    } catch (e) { toast(e instanceof Error ? e.message : 'Could not save. Nothing was changed.'); }
  }
  async function leaveTask(item: AttentionItem) {
    const ob = obOf(item.obligationId);
    if (!ob || item.taskId === undefined) return;
    try {
      const res = await leaveTaskAsIs(ob.id, item.taskId, ob.updatedAt);
      toast('Left as is. The Task stays finished and nothing was recorded.', () => runUndo(res.undo, toast).then(() => undefined));
    } catch (e) { toast(e instanceof Error ? e.message : 'Could not save. Nothing was changed.'); }
  }

  return (
    <div className="bl">
      <p className="bl-back"><Link to={overviewRoute()}>← Bills & Subscriptions</Link></p>
      <PageHeader title="Needs review" description="Bills and records that need a person's eyes. Nothing here changes by itself." actions={<Link to={upcomingRoute()} className="btn">Upcoming</Link>} />
      {a.total - a.dueSoon - a.trials - a.notices - a.renewals === 0 && acked.length === 0 ? <EmptyState title="Nothing needs review">No billing records disagree, no reminder Task is waiting to be confirmed, and no bill is waiting to be confirmed paid.</EmptyState> : null}
      {GROUP.map((g) => {
        const items = a.items.filter((i) => g.id.includes(i.category));
        if (items.length === 0) return null;
        return (
          <section className="card bl-card" key={g.title} aria-label={g.title}>
            <h2>{g.title} ({items.length})</h2>
            <p className="muted small">{g.hint}</p>
            <ul className="plain bl-items">
              {items.map((i) => {
                const ob = obOf(i.obligationId);
                return (
                  <li key={i.id} data-testid="review-item">
                    {i.conflict ? <ConflictCard conflict={i.conflict} records={byRec} obligation={ob} /> : <p style={{ margin: 0 }}>{i.text}</p>}
                    <div className="bl-actionrow">
                      {ob && <Link className="btn" to={obligationRoute(ob.id)}>Open the bill</Link>}
                      {ob && i.slot && (i.category === 'unconfirmedTasks' || i.category === 'notConfirmed' || i.category === 'autopayCheck') && <button className="btn primary" onClick={() => setPaid({ ob, slot: i.slot!, taskId: null })}>Mark paid…</button>}
                      {i.category === 'ruleShared' && i.ruleId !== undefined && ruleLinkConflicts(x.snap.obligations).find((c) => c.ruleId === i.ruleId)?.holders.map((h) => <button key={h.id} className="btn" onClick={() => setKeep({ ruleId: i.ruleId!, keepId: h.id })}>Keep it on “{h.data.title}”</button>)}
                      {i.category === 'ruleShared' && i.ruleId !== undefined && <button className="btn" onClick={() => void leaveRuleAsIs(i.ruleId!, toast)}>Leave as is</button>}
                      {i.category === 'taskProblems' && <button className="btn" onClick={() => void tidy(i)}>Update reminders</button>}
                      {i.category === 'unconfirmedTasks' && <button className="btn" onClick={() => void leaveTask(i)}>Leave as is</button>}
                      {(i.category === 'cancelAwaiting' || i.category === 'lifecycleConflict' || i.category === 'afterCancel' || i.category === 'scheduledAfterEnd') && ob && i.ackKey && <button className="btn" onClick={() => void leaveEvidence(ob.id, i.ackKey!)}>Leave as is</button>}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
      {acked.length > 0 && (
        <details className="bl-sec">
          <summary>Left as is ({acked.length})</summary>
          <p className="muted small">You looked at these and chose to leave them. They still exist: the amounts stay unclear until you choose, and a changed record brings the question back.</p>
          <ul className="plain bl-items">{acked.map((c) => <li key={c.key}><ConflictCard conflict={c} records={byRec} obligation={obOf(c.obligationId)} /></li>)}</ul>
        </details>
      )}
      {keep && (() => { const c = ruleLinkConflicts(x.snap.obligations).find((k) => k.ruleId === keep.ruleId); const k = c?.holders.find((h) => h.id === keep.keepId); return c && k ? <KeepRuleDialog ruleId={keep.ruleId} keep={k} holders={c.holders} onClose={() => setKeep(null)} /> : null; })()}
      {paid && <FactDialog obligation={paid.ob} slot={paid.slot} kind="paid" taskId={paid.taskId} onClose={() => setPaid(null)} />}
    </div>
  );
}
