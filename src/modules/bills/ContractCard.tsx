import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import Modal from '../../shell/Modal';
import { useToast } from '../../ui/Toast';
import { useToday } from '../../ui/useToday';
import { Lines, day } from './BillsParts';
import { saveReminders, saveTerms } from './contractData';
import type { ObligationRecord } from './model';
import { effectiveReminders, loadBillTasks, markersOf } from './tasks';
import { DEADLINE_LABEL, DEADLINE_MEANING, deadlinesOf, noticeFromRenewal, readTerms, relativeDay, termsWarnings, type Terms } from './terms';
import { runUndo } from './undo';
import { daysUntil } from './timing';

/** Renewal, cancel-by, trial-end and "renews by itself": dates only. Nothing renews, cancels, reprices or posts when one passes. */
function TermsDialog({ ob, onClose }: { ob: ObligationRecord; onClose: () => void }) {
  const toast = useToast();
  const today = useToday();
  const start = readTerms(ob.data.terms);
  const [auto, setAuto] = useState<string>(start.autoRenews === null ? 'unknown' : start.autoRenews ? 'yes' : 'no');
  const [renewal, setRenewal] = useState(start.renewalDate ?? '');
  const [notice, setNotice] = useState(start.noticeByDate ?? '');
  const [days, setDays] = useState(start.noticeDays === null ? '' : String(start.noticeDays));
  const [trial, setTrial] = useState(start.trialEndsOn ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const next: Terms = { ...start, autoRenews: auto === 'yes' ? true : auto === 'no' ? false : null, renewalDate: renewal || null, noticeByDate: notice || null, noticeDays: days.trim() === '' ? null : Number(days), trialEndsOn: trial || null };
  const warnings = termsWarnings(next);
  const reminders = effectiveReminders(ob.data);
  const wantsTask = reminders.deadlineTasks && ob.data.status === 'active' && [next.noticeByDate, next.trialEndsOn].some((d) => d !== null && d >= today);
  async function save() {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const r = await saveTerms(ob.id, next, ob.updatedAt, today);
      toast(r.createdTasks.length ? 'Dates saved. A reminder Task was made.' : 'Dates saved', () => runUndo(r.undo, toast).then(() => undefined));
      onClose();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save. Nothing was changed.'); setBusy(false); }
  }
  return (
    <Modal title="Contract dates" onClose={onClose} wide>
      <form className="bl-form" onSubmit={(e) => { e.preventDefault(); void save(); }} noValidate>
        <label className="f">Does it renew by itself?
          <select value={auto} onChange={(e) => setAuto(e.target.value)} aria-label="Renews by itself">
            <option value="unknown">Not sure</option><option value="yes">Yes, it renews automatically</option><option value="no">No, I have to renew it</option>
          </select>
        </label>
        <div className="bl-two">
          <label className="f">Renewal date<input type="date" value={renewal} onChange={(e) => setRenewal(e.target.value)} /></label>
          <label className="f">Last day to cancel or give notice<input type="date" value={notice} onChange={(e) => setNotice(e.target.value)} /></label>
        </div>
        <div className="bl-two">
          <label className="f">Notice needed (days before renewal, optional)<input value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, ''))} inputMode="numeric" /></label>
          <div className="f"><span>&nbsp;</span><button type="button" className="btn" disabled={!renewal || days.trim() === ''} onClick={() => setNotice(noticeFromRenewal(renewal, Number(days)))}>Work out the cancel-by date</button></div>
        </div>
        <label className="f">Trial ends (optional)<input type="date" value={trial} onChange={(e) => setTrial(e.target.value)} /></label>
        <h3 className="bl-h3">What will happen</h3>
        <Lines lines={[
          'These are only dates to remind you. Nothing renews, cancels, changes price or posts a payment when one passes, and Ledger never assumes a trial turned into a paid plan.',
          wantsTask ? 'A reminder Task will be made for each cancel-by or trial-end date that is still ahead (you can turn that off under Reminders).' : 'No reminder Task will be made for these dates.',
          'Nothing in Finance is changed.',
        ]} />
        {warnings.map((w) => <p key={w} className="bl-warn small">{w}</p>)}
        {error && <div className="error" role="alert">{error}</div>}
        <div className="row bl-actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button type="submit" className="btn primary" disabled={busy}>Save</button></div>
      </form>
    </Modal>
  );
}

function RemindersDialog({ ob, onClose }: { ob: ObligationRecord; onClose: () => void }) {
  const toast = useToast();
  const today = useToday();
  const cur = effectiveReminders(ob.data);
  const [pay, setPay] = useState(cur.payTask);
  const [lead, setLead] = useState(String(cur.leadDays));
  const [dl, setDl] = useState(cur.deadlineTasks);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function save() {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const r = await saveReminders(ob.id, { payTask: pay, leadDays: Number(lead), deadlineTasks: dl }, ob.updatedAt, today);
      toast(r.createdTasks.length ? 'Reminders saved. A reminder Task was made.' : 'Reminders saved', () => runUndo(r.undo, toast).then(() => undefined));
      onClose();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save. Nothing was changed.'); setBusy(false); }
  }
  return (
    <Modal title="Reminders" onClose={onClose} wide>
      <form className="bl-form" onSubmit={(e) => { e.preventDefault(); void save(); }} noValidate>
        <label className="as-check"><input type="checkbox" checked={pay} onChange={(e) => setPay(e.target.checked)} /> Remind me to pay this by hand (one Task at a time)</label>
        <label className="f">How many days before the due date should the Task be for?
          <select value={lead} onChange={(e) => setLead(e.target.value)} aria-label="Days before the due date">{[0, 1, 2, 3, 5, 7, 10, 14].map((n) => <option key={n} value={n}>{n === 0 ? 'On the due date' : `${n} day${n === 1 ? '' : 's'} before`}</option>)}</select>
        </label>
        <label className="as-check"><input type="checkbox" checked={dl} onChange={(e) => setDl(e.target.checked)} /> Remind me before cancel-by and trial-end dates</label>
        <h3 className="bl-h3">What will happen</h3>
        <Lines lines={[
          pay ? 'One Task is kept for the next bill that is still open (never one for every future month). Its date is a reminder date, usually a few days before the bill is due; the due date itself is shown separately.' : 'No Task is made for paying this bill. Any open Task already made stays in Tasks.',
          'Finishing a Task never records a payment. Use "Done, mark paid" on the bill, which writes your note and finishes the Task together.',
          'Turning a reminder off never deletes a Task.',
        ]} />
        {error && <div className="error" role="alert">{error}</div>}
        <div className="row bl-actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button type="submit" className="btn primary" disabled={busy}>Save</button></div>
      </form>
    </Modal>
  );
}

export default function ContractCard({ ob }: { ob: ObligationRecord }) {
  const today = useToday();
  const tasks = useLiveQuery(async () => (await loadBillTasks()).filter((t) => markersOf(t)?.obligation === ob.id && t.data.status !== 'done'), [ob.id]);
  const [dlg, setDlg] = useState<'terms' | 'reminders' | null>(null);
  const terms = readTerms(ob.data.terms);
  const rem = effectiveReminders(ob.data);
  const dls = deadlinesOf(terms);
  const set = dls.length > 0 || terms.autoRenews !== null;
  return (
    <>
      <section className="card bl-card" aria-labelledby="bl-con-h">
        <div className="bl-card-head"><h2 id="bl-con-h">Contract dates</h2><button className="btn" onClick={() => setDlg('terms')}>{set ? 'Edit' : 'Add dates'}</button></div>
        {!set ? <p className="muted">Terms not recorded. Add a renewal, cancel-by or trial-end date to get reminders. Ledger never renews or cancels anything.</p> : (
          <>
            <dl className="bl-facts">
              <div className="bl-fact"><dt>Renews by itself</dt><dd>{terms.autoRenews === null ? 'Not sure' : terms.autoRenews ? 'Yes' : 'No'}</dd></div>
              {dls.map((d) => (
                <div className="bl-fact" key={d.kind}>
                  <dt>{DEADLINE_LABEL[d.kind]}</dt>
                  <dd>{day(d.date)} <span className="muted small">({relativeDay(d.date, today)})</span></dd>
                </div>
              ))}
            </dl>
            {dls.filter((d) => daysUntil(d.date, today) < 0 && d.kind !== 'notice').map((d) => (
              <p key={d.kind} className="bl-warn small">The {DEADLINE_LABEL[d.kind].toLowerCase()} date has passed. {d.kind === 'renewal' ? 'Ledger did not renew anything, and it does not know whether it renewed.' : 'Ledger does not know whether it became a paid plan or was cancelled.'} Check, and update the date if it is out of date.</p>
            ))}
            <ul className="plain bl-items">{dls.map((d) => <li key={d.kind} className="muted small">{DEADLINE_LABEL[d.kind]}: {DEADLINE_MEANING[d.kind]}</li>)}</ul>
          </>
        )}
      </section>
      <section className="card bl-card" aria-labelledby="bl-rem-h">
        <div className="bl-card-head"><h2 id="bl-rem-h">Reminders</h2><button className="btn" onClick={() => setDlg('reminders')}>Change</button></div>
        <ul className="plain bl-items">
          <li>Pay reminder: <strong>{rem.payTask ? `on (the Task is for ${rem.leadDays === 0 ? 'the due date' : `${rem.leadDays} day${rem.leadDays === 1 ? '' : 's'} before`})` : 'off'}</strong></li>
          <li>Cancel-by and trial-end reminders: <strong>{rem.deadlineTasks ? 'on' : 'off'}</strong>{terms.noticeByDate || terms.trialEndsOn ? '' : <span className="muted small"> (no such dates set)</span>}</li>
        </ul>
        {tasks && tasks.length > 0 && (
          <>
            <h3 className="bl-h3">Open reminder Tasks</h3>
            <ul className="plain bl-items">{tasks.map((t) => <li key={t.id}>{t.data.title} · for {t.data.dueDate ? day(t.data.dueDate) : 'no date'} <a href="#/tasks" className="small">Open Tasks</a></li>)}</ul>
          </>
        )}
        <p className="muted small">A reminder date is not the due date: both are shown. Finishing a Task never records a payment.</p>
      </section>
      {dlg === 'terms' && <TermsDialog ob={ob} onClose={() => setDlg(null)} />}
      {dlg === 'reminders' && <RemindersDialog ob={ob} onClose={() => setDlg(null)} />}
    </>
  );
}

