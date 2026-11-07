import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { addDays } from '../../lib/dates';
import { localISO } from '../../core/time';
import { newId } from '../../lib/sync/track';
import { useToday } from '../../ui/useToday';
import { day, useMoney, type Money } from './BillsParts';
import type { Conflict } from './cycleConflicts';
import type { TaskRecord } from '../tasks/model';
import { FactDialog, RemoveFactDialog, type FactKind } from './CycleDialogs';
import { amountLine, dueLine, PeriodLabel, periodName } from './PeriodParts';
import { ConflictCard, MoveDialog } from './RepairDialogs';
import { findConflicts } from './cycleConflicts';
import { loadCycles } from './cycleData';
import { factWords, type CycleRecord } from './cycleModel';
import { isLoanExcluded, type ObligationRecord } from './model';
import { periodsOf, type Period } from './periods';
import { slotWords2 } from './schedule';
import { extraSlot } from './slots';
import { loadBillTasks, markersOf } from './tasks';
import { loadTxnMap, lookupOfMap } from '../../lib/txnLookup';
import type { TxnLookup } from '../../lib/txnRef';
import { LinkPaymentDialog, PaymentList, removeLinkLines } from './PaymentUI';

interface RowCtx {
  ob: ObligationRecord;
  data: { cycles: CycleRecord[]; tasks: TaskRecord[]; lookup: TxnLookup };
  view: { conflicts: Conflict[]; byRec: Map<number, CycleRecord> };
  loan: boolean;
  money: Money;
  hide: boolean;
  setLink: (l: { period: Period; replace: CycleRecord | null } | null) => void;
  setDlg: (d: Dlg | null) => void;
  setRm: (r: { rec: CycleRecord; words: string } | null) => void;
  setMv: (s: string | null) => void;
}
interface Dlg { slot: string; kind: FactKind; existing?: CycleRecord; taskId?: number | null }

function PeriodRow({ p, x }: { p: Period; x: RowCtx }) {
  const { ob, data, view, loan, money, hide, setLink, setDlg, setRm, setMv } = x;
  const eff = (pp: Period, f: string) => pp.effective.filter((y) => y.body.fact === f);
  const openTasks = (pp: Period) => data.tasks.filter((t) => { const m = markersOf(t); return m?.purpose === 'pay' && m.cycle === pp.slot && t.data.status !== 'done'; });
  const doneTasks = (pp: Period) => data.tasks.filter((t) => { const m = markersOf(t); return m?.purpose === 'pay' && m.cycle === pp.slot && t.data.status === 'done'; });
  const slotConflicts = (slot: string) => view.conflicts.filter((c) => c.slot === slot);
  const open = openTasks(p)[0];
  const finished = doneTasks(p)[0];
  const invoices = eff(p, 'invoice'), dues = eff(p, 'due-date'), pays = p.effective.filter((x) => x.body.fact === 'paid-outside' || x.body.fact === 'paid-in-full'), skips = eff(p, 'skip');
  const hasLinks = p.effective.some((y) => y.body.fact === 'payment-link');
  const typedAmount = p.effective.some((y) => y.body.fact === 'paid-outside' && y.body.cents !== null && y.body.cents > 0);
  const settled = pays.length > 0 || skips.length > 0 || (hasLinks && p.amounts.paid > 0);
  const cs = slotConflicts(p.slot);
  return (
    <li className="bl-period" data-testid="period">
      <div className="bl-period-head">
        <strong>{periodName(p)}</strong>
        <span className="muted small">{dueLine(p)}</span>
      </div>
      <PeriodLabel p={p} money={money} />
      <p className="small bl-amt">{amountLine(p, money)}</p>
      <PaymentList p={p} money={money} hide={hide} onReplace={(r) => setLink({ period: p, replace: r })} onRemove={(r) => setRm({ rec: r, words: factWords(r.body!, money) })} />
      {open && <p className="small bl-task">Reminder Task &ldquo;{open.data.title}&rdquo; is for {open.data.dueDate ? day(open.data.dueDate) : 'no date'}{p.timing.date && open.data.dueDate !== p.timing.date ? ` (the bill is due ${day(p.timing.date)})` : ''}. Finishing the Task does not record a payment.</p>}
      {!open && finished && !settled && p.open && <p className="small bl-warn">The reminder Task was finished, but no payment is recorded here (finished, not yet confirmed).</p>}
      {cs.map((c) => <ConflictCard key={c.key} conflict={c} records={view.byRec} obligation={ob} />)}
      <div className="bl-actionrow">
        {invoices.length <= 1 && <button className="btn" onClick={() => setDlg({ slot: p.slot, kind: 'invoice', existing: invoices[0] })}>{invoices.length ? 'Change the bill' : 'Enter the bill'}</button>}
        {dues.length <= 1 && <button className="btn" onClick={() => setDlg({ slot: p.slot, kind: 'due-date', existing: dues[0] })}>{dues.length ? 'Change the due date' : 'Set the due date'}</button>}
        {!loan && <button className={`btn${!settled && !hasLinks ? ' primary' : ''}`} onClick={() => setLink({ period: p, replace: null })}>{typedAmount ? 'Replace the typed payment with a Finance payment' : hasLinks ? 'Link another Finance payment' : 'Link a Finance payment'}</button>}
        {!loan && pays.length <= 1 && <button className={`btn${!settled && !hasLinks ? ' primary' : ''}`} onClick={() => setDlg({ slot: p.slot, kind: 'paid', existing: pays[0], taskId: open?.id ?? null })}>{pays.length ? 'Change payment note' : open ? 'Done, mark paid' : 'Mark paid'}</button>}
        {skips.length <= 1 && <button className="btn" onClick={() => setDlg({ slot: p.slot, kind: 'skip', existing: skips[0], taskId: open?.id ?? null })}>{skips.length ? 'Change skip' : 'Skip this period'}</button>}
        <button className="btn" onClick={() => setDlg({ slot: p.slot, kind: 'credit' })}>Add a credit</button>
      </div>
      {p.records.length > 0 && (
        <details className="bl-sec">
          <summary>Records for this period ({p.records.length})</summary>
          <ul className="plain bl-items">
            {p.records.filter((r) => r.supersededBy === null).map((r) => (
              <li key={r.id} className="bl-rec">
                <span>{r.body ? factWords(r.body, money) : `Needs review: ${r.problem}`}</span>
                <span className="muted small">Recorded {day(localISO(r.createdAt))}{r.movedFrom ? ` · moved here from ${slotWords2(r.movedFrom)}` : ''}{typeof r.raw.separatedFrom === 'string' ? ` · made separate from ${slotWords2(r.raw.separatedFrom)}` : ''}</span>
                {r.body && <span className="bl-actionrow">{r.body.fact !== 'payment-link' && <button className="btn" onClick={() => setDlg({ slot: p.slot, kind: r.body!.fact === 'invoice' ? 'invoice' : r.body!.fact === 'due-date' ? 'due-date' : r.body!.fact === 'skip' ? 'skip' : r.body!.fact === 'credit' ? 'credit' : 'paid', existing: r })}>Change</button>}<button className="btn" onClick={() => setRm({ rec: r, words: factWords(r.body!, money) })}>Remove</button></span>}
              </li>
            ))}
          </ul>
          {p.superseded.length > 0 && (
            <>
              <h3 className="bl-h3">History (set aside, not counted)</h3>
              <ul className="plain bl-items">{p.superseded.map((r) => <li key={r.id} className="muted">{factWords(r.body!, money)} <span className="small">· recorded {day(localISO(r.createdAt))}</span></li>)}</ul>
            </>
          )}
          {p.records.some((r) => r.body !== null) && <p><button className="btn" onClick={() => setMv(p.slot)}>Move to another billing period…</button></p>}
        </details>
      )}
    </li>
  );
}


/**
 * The billing periods of one bill: what is expected, what has been billed, what the household recorded, and what is still open. Each period shows its
 * label with the mandatory line saying what Ledger actually knows, its amounts (an estimate says so, unknown is never $0), and the records behind it.
 * Slot identifiers are never shown: a period is a date and a description ("December 2026", "an extra bill").
 */
export default function PeriodsCard({ ob }: { ob: ObligationRecord }) {
  const today = useToday();
  const { money, hide } = useMoney();
  // the live Finance transactions the links point at are read in ONE bulk read, and the query re-runs by itself when one of them changes in Finance
  const data = useLiveQuery(async () => {
    const cycles = (await loadCycles()).filter((c) => c.obligationId === ob.id);
    const lookup = lookupOfMap(await loadTxnMap(cycles.flatMap((c) => (c.body?.fact === 'payment-link' && c.supersededBy === null ? [c.body.ref] : []))));
    return { cycles, lookup, tasks: (await loadBillTasks()).filter((t) => markersOf(t)?.obligation === ob.id) };
  }, [ob.id]);
  const [link, setLink] = useState<{ period: Period; replace: CycleRecord | null } | null>(null);
  const [dlg, setDlg] = useState<Dlg | null>(null);
  const [rm, setRm] = useState<{ rec: CycleRecord; words: string } | null>(null);
  const [mv, setMv] = useState<string | null>(null);

  const view = useMemo(() => {
    if (!data) return null;
    const all = periodsOf(ob, data.cycles, today, { from: addDays(today, -75), to: addDays(today, 100) }, { allRecorded: true, lookup: data.lookup });
    const conflicts = findConflicts([ob], data.cycles);
    const byRec = new Map(data.cycles.map((c) => [c.id, c]));
    const recent = all.filter((p) => !p.fromEarlier && (p.timing.date === null || p.timing.date >= addDays(today, -75) || p.open));
    return { all, conflicts, byRec, recent, earlier: all.filter((p) => p.fromEarlier), older: all.filter((p) => !p.fromEarlier && !recent.includes(p)) };
  }, [data, ob, today]);
  if (!view || !data) return <section className="card bl-card"><h2>Billing periods</h2><p className="muted">Loading…</p></section>;
  const loan = isLoanExcluded(ob.data);

  const ctx: RowCtx = { ob, data, view, loan, money, hide, setLink, setDlg, setRm, setMv };
  const obLevel = view.conflicts.filter((c) => c.slot === null);
  return (
    <section className="card bl-card" aria-labelledby="bl-per-h">
      <div className="bl-card-head">
        <h2 id="bl-per-h">Billing periods</h2>
        <button className="btn" onClick={() => setDlg({ slot: extraSlot(newId()), kind: 'invoice' })}>Record an extra bill</button>
      </div>
      <p className="muted small">What Ledger expects, what you have billed or recorded, and what is still open. Typed records are your own notes. A payment you link from Finance is read live from Finance every time. Nothing here posts, pays, clears or changes anything in Finance.</p>
      {obLevel.map((c) => <ConflictCard key={c.key} conflict={c} records={view.byRec} obligation={ob} />)}
      {view.recent.length === 0 && view.earlier.length === 0 ? <p className="muted">No billing periods yet. {ob.data.schedule ? 'The first one appears when it is within the next few months.' : 'This bill has no regular schedule: use "Record an extra bill" when one arrives.'}</p> : (
        <ul className="plain bl-periods" aria-label="Billing periods">{view.recent.map((p) => <PeriodRow key={p.slot} p={p} x={ctx} />)}</ul>
      )}
      {view.earlier.length > 0 && (
        <>
          <h3 className="bl-h3">From an earlier schedule</h3>
          <p className="muted small">These records belong to a period that no schedule of this bill produces any more. They are kept, and any payment note still counts. Nothing was moved or deleted.</p>
          <ul className="plain bl-periods">{view.earlier.map((p) => <PeriodRow key={p.slot} p={p} x={ctx} />)}</ul>
        </>
      )}
      {view.older.length > 0 && (
        <details className="bl-sec"><summary>Older periods ({view.older.length})</summary><ul className="plain bl-periods">{view.older.map((p) => <PeriodRow key={p.slot} p={p} x={ctx} />)}</ul></details>
      )}
      {dlg && <FactDialog obligation={ob} slot={dlg.slot} kind={dlg.kind} existing={dlg.existing} taskId={dlg.taskId} onClose={() => setDlg(null)} />}
      {rm && <RemoveFactDialog record={rm.rec} words={rm.words} extraLines={rm.rec.body?.fact === 'payment-link' ? removeLinkLines(periodName({ slot: rm.rec.slot ?? '' })) : undefined} onClose={() => setRm(null)} />}
      {link && <LinkPaymentDialog obligation={ob} period={link.period} replace={link.replace} onClose={() => setLink(null)} />}
      {mv && <MoveDialog obligation={ob} from={mv} onClose={() => setMv(null)} />}
    </section>
  );
}
