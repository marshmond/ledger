import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { addDays } from '../../lib/dates';
import { loadTxnMap, lookupOfMap } from '../../lib/txnLookup';
import { useToday } from '../../ui/useToday';
import { localISO } from '../../core/time';
import { day, useMoney } from './BillsParts';
import { findConflicts } from './cycleConflicts';
import { loadCycles } from './cycleData';
import { factWords } from './cycleModel';
import { isLoanExcluded, type ObligationRecord } from './model';
import { PaymentList } from './PaymentUI';
import { amountLine, dueLine, PeriodLabel, periodName } from './PeriodParts';
import { periodsOf } from './periods';
import { slotWords2 } from './schedule';

/**
 * PAYMENT HISTORY of one bill (B3): read only. For every billing period that holds a record it shows, apart and in this order: what was billed, the
 * Finance payments linked to it (live amounts and Finance's own status words), what you typed as paid outside Finance, provider credits, anything that
 * needs review, and what is still owed. It is not a payment ledger: Finance stays the one place payments live, and nothing here can change a payment.
 * It survives schedule changes, pausing, ending and provider changes because periods are identified by their own slot, not by a date or a provider.
 */
export default function PaymentHistoryCard({ ob }: { ob: ObligationRecord }) {
  const today = useToday();
  const { money, hide } = useMoney();
  const data = useLiveQuery(async () => {
    const cycles = (await loadCycles()).filter((c) => c.obligationId === ob.id);
    const lookup = lookupOfMap(await loadTxnMap(cycles.flatMap((c) => (c.body?.fact === 'payment-link' && c.supersededBy === null ? [c.body.ref] : []))));
    return { cycles, lookup };
  }, [ob.id]);
  const view = useMemo(() => {
    if (!data) return null;
    const periods = periodsOf(ob, data.cycles, today, { from: addDays(today, -3650), to: addDays(today, 100) }, { allRecorded: true, lookup: data.lookup })
      .filter((p) => p.records.length > 0)
      .sort((a, b) => (b.timing.date ?? '').localeCompare(a.timing.date ?? '') || b.slot.localeCompare(a.slot));
    return { periods, conflicts: findConflicts([ob], data.cycles) };
  }, [data, ob, today]);
  if (!view) return <section className="card bl-card"><h2>Payment history</h2><p className="muted">Loading…</p></section>;
  const loan = isLoanExcluded(ob.data);

  return (
    <section className="card bl-card" aria-labelledby="bl-hist-h">
      <h2 id="bl-hist-h">Payment history</h2>
      <p className="muted small">What was billed and paid for each period, newest first. Payments are read live from Finance; this list only shows them and cannot change one.</p>
      {loan ? <p className="muted">Loan payments are tracked on the Loans page.</p> : view.periods.length === 0 ? <p className="muted">Nothing has been recorded for this bill yet.</p> : (
        <ul className="plain bl-hist" aria-label="Payment history">
          {view.periods.map((p) => {
            const eff = p.effective;
            const credits = eff.filter((f) => f.body.fact === 'credit');
            const typed = eff.filter((f) => f.body.fact === 'paid-outside' || f.body.fact === 'paid-in-full');
            const setAside = p.superseded.filter((r) => r.body && (r.body.fact === 'paid-outside' || r.body.fact === 'payment-link' || r.body.fact === 'paid-in-full'));
            const issues = view.conflicts.filter((c) => c.slot === p.slot && !c.acknowledged);
            return (
              <li key={p.slot} className="bl-histrow" data-testid="history-period">
                <div className="bl-period-head"><strong>{periodName(p)}</strong><span className="muted small">{dueLine(p)}</span></div>
                <PeriodLabel p={p} money={money} />
                <p className="small bl-amt">{amountLine(p, money)}</p>
                {p.amounts.remaining !== null && p.amounts.remaining > 0 && p.open && <p className="small">Still owed: {money(p.amounts.remaining)}</p>}
                <PaymentList p={p} money={money} hide={hide} readOnly />
                {typed.length > 0 && (
                  <ul className="plain bl-items" aria-label={`Typed payment notes for ${slotWords2(p.slot)}`}>
                    {typed.map((r) => <li key={r.id} className={p.amounts.typedLeftOut.length > 0 && r.body.fact === 'paid-outside' && r.body.cents !== null ? 'muted' : ''}>{factWords(r.body, money)}{p.amounts.typedLeftOut.length > 0 && r.body.fact === 'paid-outside' && r.body.cents !== null ? ' (left out of the figures while a Finance payment is linked)' : ''} <span className="small muted">· recorded {day(localISO(r.createdAt))}</span></li>)}
                  </ul>
                )}
                {credits.length > 0 && <ul className="plain bl-items" aria-label="Provider credits">{credits.map((r) => <li key={r.id}>{factWords(r.body, money)} <span className="small muted">· not a payment</span></li>)}</ul>}
                {setAside.length > 0 && (
                  <details className="bl-sec"><summary>Set aside, not counted ({setAside.length})</summary>
                    <ul className="plain bl-items">{setAside.map((r) => <li key={r.id} className="muted">{factWords(r.body!, money)} <span className="small">· recorded {day(localISO(r.createdAt))}</span></li>)}</ul>
                  </details>
                )}
                {issues.length > 0 && <ul className="plain bl-items" aria-label="Needs review">{issues.map((c) => <li key={c.key} className="bl-warn small">{c.text}</li>)}</ul>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
