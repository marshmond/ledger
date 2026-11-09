import { useState } from 'react';
import { useNavigate } from '../../core/router';
import { db } from '../../db';
import { applyContactRemoval, planContactRemoval, RemovalRefused, undoContactRemoval, type RemovalPlan } from '../../core/contactRemoval';
import { allContactReferenceProviders } from '../../core/registry';
import type { Contact } from '../../core/entities';
import { contactBrief } from '../../core/contactChoice';
import { todayISO } from '../../lib/money';
import ConfirmDialog from '../../shell/ConfirmDialog';
import Modal from '../../shell/Modal';
import { useToast } from '../../ui/Toast';
import { contactRoute } from './model';

/**
 * Remove a Contact that nothing uses (C2). The button appears only when the page already knows nothing mentions the Contact; pressing it runs the full
 * check again (every scan and every module reader), and the removal itself runs the check a THIRD time inside one transaction. It is a soft delete with an
 * Undo that brings back the same Contact. A used Contact cannot be removed from here.
 */
export default function RemoveContact({ contact, inUse, checkedAll }: { contact: Contact; inUse: boolean; checkedAll: boolean }) {
  const [step, setStep] = useState<'idle' | 'checking' | 'blocked' | 'confirm'>('idle');
  const [plan, setPlan] = useState<RemovalPlan | null>(null);
  const [problem, setProblem] = useState('');
  const toast = useToast();
  const navigate = useNavigate();
  const id = contact.id as number;

  async function open() {
    setStep('checking'); setProblem('');
    try {
      const p = await planContactRemoval(db, id, allContactReferenceProviders(), todayISO());
      setPlan(p);
      setStep(p.eligible ? 'confirm' : 'blocked');
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'The check failed.');
      setStep('blocked');
    }
  }

  async function confirm(): Promise<string | void> {
    if (!plan) return 'Look at the contact again first.';
    try {
      const undo = await applyContactRemoval(db, plan, allContactReferenceProviders(), todayISO());
      setStep('idle');
      toast('Contact removed', async () => {
        try { await undoContactRemoval(db, undo); toast('Contact restored'); navigate(contactRoute(id)); }
        catch (e) { toast(e instanceof RemovalRefused ? e.message : 'Undo could not finish. Nothing was changed.'); }
      });
      navigate('/');
    } catch (e) {
      if (e instanceof RemovalRefused) return e.message;
      throw e;
    }
  }

  return (
    <section className="card" aria-labelledby="ct-remove">
      <div className="card-head"><h2 className="card-title" id="ct-remove">Remove this contact</h2></div>
      {inUse || !checkedAll ? (
        <p className="muted">{inUse ? 'This contact is in use, so it cannot be removed. Remove or change the records that use it first.' : 'Ledger could not finish checking every module, so removal is not offered.'}</p>
      ) : (
        <>
          <p className="muted">Nothing in Ledger uses this contact. Removing it takes it out of the shared contact list for every module. It is not erased for good, and Undo brings back the same contact straight away.</p>
          <button type="button" className="btn danger" onClick={() => void open()} disabled={step === 'checking'}>{step === 'checking' ? 'Checking…' : 'Remove from Ledger…'}</button>
        </>
      )}

      {step === 'confirm' && plan?.contact && (
        <ConfirmDialog title="Remove this contact?" confirmLabel="Remove contact" busyLabel="Removing…" onConfirm={confirm} onCancel={() => setStep('idle')}>
          <p><strong>{plan.contact.name}</strong><br /><span className="muted small">{contactBrief(plan.contact)}</span></p>
          <p>This changes the one shared contact, not just this screen. Ledger checked every place a contact can be used and found nothing that uses this one.</p>
          <ul>
            <li>It disappears from the lists and menus of every module.</li>
            <li>It is hidden, not erased. Undo restores this same contact.</li>
            <li>If another device adds something that uses it before the removal reaches that device, Ledger keeps that record and offers to restore the contact. It cannot promise that two devices never cross.</li>
          </ul>
        </ConfirmDialog>
      )}
      {step === 'blocked' && (
        <Modal title="This contact cannot be removed" onClose={() => setStep('idle')}>
          <div className="confirm-body">
            <p>{problem || plan?.reasons[0] || 'Something uses this contact.'}</p>
            <p className="muted small">Nothing was changed.</p>
            <div className="row confirm-actions"><button type="button" className="primary" onClick={() => setStep('idle')}>Close</button></div>
          </div>
        </Modal>
      )}
    </section>
  );
}
