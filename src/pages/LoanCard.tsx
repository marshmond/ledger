import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import type { Account, Category, CategoryGroup, Loan, LoanEvent, LoanKind, LoanRateChange } from '../types';
import { formatCents, todayISO } from '../lib/money';
import { addMonths } from '../lib/dates';
import { balanceAt, loanView, monthlyTotal, nextRow, scheduleToCsv, yearlySummary, type Schedule } from '../lib/loanSchedule';
import { createLoanLedgerAccount, ledgerOwed, recordLoanPayment } from '../lib/loanLedger';
import Collapsible, { useCollapsed } from './Collapsible';
import { LinesChart, compactUSD, type LineSeries } from './charts';
import { MoneyField, NumField } from './fields';

export const KIND_NAMES: Record<LoanKind, string> = {
  mortgage: 'Mortgage', heloc: 'HELOC', auto: 'Auto loan', student: 'Student loan', personal: 'Personal loan', other: 'Other loan',
};

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

const monthYear = (iso: string | null | undefined) => (iso ? new Date(iso + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—');

// ---------------- record a payment ----------------

/** Defined at the top level on purpose: a component declared inside another is rebuilt on every keystroke and loses focus. */
function CatSelect({ value, onChange, groups, categories }: { value: string; onChange: (v: string) => void; groups: CategoryGroup[]; categories: Category[] }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Uncategorized</option>
      {groups.map((g) => (
        <optgroup key={g.id} label={g.name}>
          {categories.filter((c) => c.groupId === g.id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </optgroup>
      ))}
    </select>
  );
}

function RecordPayment({
  loan, next, accounts, groups, categories,
}: { loan: Loan; next: Schedule['rows'][number] | undefined; accounts: Account[]; groups: CategoryGroup[]; categories: Category[] }) {
  const fromAccounts = accounts.filter((a) => a.kind === 'checking' || a.kind === 'savings');
  const [date, setDate] = useState(next?.date ?? todayISO());
  const [from, setFrom] = useState(fromAccounts[0]?.id ? String(fromAccounts[0].id) : '');
  const [interest, setInterest] = useState(next?.interest ?? 0);
  const [principal, setPrincipal] = useState(next?.principal ?? 0);
  const [extra, setExtra] = useState(0);
  const [escrow, setEscrow] = useState((loan.escrowMonthlyCents ?? 0) + (loan.pmiMonthlyCents ?? 0));
  const [iCat, setICat] = useState(loan.interestCategoryId ? String(loan.interestCategoryId) : '');
  const [eCat, setECat] = useState(loan.escrowCategoryId ? String(loan.escrowCategoryId) : '');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function record() {
    setMsg(null);
    try {
      await recordLoanPayment(db, {
        loanId: loan.id!, date, fromAccountId: Number(from), interestCents: interest, principalCents: principal, extraCents: extra,
        escrowCents: escrow, interestCategoryId: iCat ? Number(iCat) : null, escrowCategoryId: eCat ? Number(eCat) : iCat ? Number(iCat) : null,
      });
      await db.loans.update(loan.id!, { interestCategoryId: iCat ? Number(iCat) : null, escrowCategoryId: eCat ? Number(eCat) : null });
      setMsg({ ok: true, text: `Recorded as pending in your ledger: ${formatCents(principal + extra)} to the loan, ${formatCents(interest + escrow)} as expense.` });
      setExtra(0);
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    }
  }

  return (
    <div className="card">
      <strong>Record a payment</strong>
      <p className="muted">
        Prefilled from the next scheduled payment; change anything to match what you actually paid. The principal moves from the account to the
        loan (it is not spending). The interest{loan.escrowMonthlyCents || loan.pmiMonthlyCents ? ' and escrow/PMI' : ''} is recorded as an expense in the category you pick.
      </p>
      <div className="grid">
        <label className="f">Date<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label className="f">Paid from
          <select value={from} onChange={(e) => setFrom(e.target.value)}>
            <option value="">Choose…</option>
            {fromAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
        <MoneyField key={`i${next?.n}`} label="Interest" cents={interest} onChange={setInterest} />
        <MoneyField key={`p${next?.n}`} label="Principal" cents={principal} onChange={setPrincipal} />
        <MoneyField label="Extra principal" cents={extra} onChange={setExtra} />
        <MoneyField label="Escrow / PMI" cents={escrow} onChange={setEscrow} />
        <label className="f">Interest category<CatSelect value={iCat} onChange={setICat} groups={groups} categories={categories} /></label>
        {escrow > 0 && <label className="f">Escrow / PMI category<CatSelect value={eCat} onChange={setECat} groups={groups} categories={categories} /></label>}
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <button className="primary" onClick={record} disabled={!from}>Record payment</button>
        <span className="muted">Total out of the account: {formatCents(principal + extra + interest + escrow)}</span>
      </div>
      {msg && <div className={msg.ok ? 'ok' : 'error'}>{msg.text}</div>}
    </div>
  );
}

// ---------------- the card ----------------

export default function LoanCard({
  loan, rates, events, accounts, groups, categories,
}: { loan: Loan; rates: LoanRateChange[]; events: LoanEvent[]; accounts: Account[]; groups: CategoryGroup[]; categories: Category[] }) {
  const id = loan.id!;
  const today = todayISO();
  const view = useMemo(() => loanView(loan, rates, events), [loan, rates, events]);
  const s = view.schedule;
  const isHeloc = loan.kind === 'heloc';
  const [open, setOpen] = useCollapsed(`debt.l${id}`);
  const [d, setD] = useState<Loan>(loan);
  const dirty = JSON.stringify(d) !== JSON.stringify(loan);
  // Merge onto the latest draft (not the one captured at render), so two quick edits can never overwrite each other.
  const set = (p: Partial<Loan>) => setD((prev) => ({ ...prev, ...p }));
  const setHeloc = (p: Partial<NonNullable<Loan['heloc']>>) => setD((prev) => ({ ...prev, heloc: { ...prev.heloc!, ...p } }));
  const owed = useLiveQuery(() => ledgerOwed(db, loan), [loan.ledgerAccountId, loan.balanceCents]);

  // new rate / event forms
  const [rDate, setRDate] = useState(today);
  const [rPct, setRPct] = useState(loan.annualRatePct);
  const [eType, setEType] = useState<'extra-once' | 'extra-monthly' | 'draw'>('extra-monthly');
  const [eDate, setEDate] = useState(today);
  const [eEnd, setEEnd] = useState('');
  const [eAmt, setEAmt] = useState(0);
  const [eNote, setENote] = useState('');
  const [page, setPage] = useState(0);
  const [mode, setMode] = useState<'yearly' | 'monthly'>('yearly');

  const next = nextRow(s, today);
  const balanceNow = balanceAt(s, today);
  const lastDrawIdx = s.rows.findIndex((r) => r.phase === 'repay');
  const startLabel = s.rows[0] ? addMonths(s.rows[0].date, -1) : '';
  const longest = Math.max(s.rows.length, view.baseline.rows.length, view.shocked?.rows.length ?? 0);
  const longestLabels = (() => {
    const src = [s, view.baseline, view.shocked].filter(Boolean).sort((a, b) => b!.rows.length - a!.rows.length)[0]!;
    return [startLabel, ...src.rows.map((r) => r.date)];
  })();
  const series: LineSeries[] = [
    { label: 'Your plan', color: 'var(--s1)', values: [s.startBalance, ...s.rows.map((r) => r.endBalance)] },
    ...(s.totalExtra > 0 ? [{ label: 'Without extra payments', color: 'var(--s2)', dashed: true, values: [view.baseline.startBalance, ...view.baseline.rows.map((r) => r.endBalance)] }] : []),
    ...(view.shocked ? [{ label: `Rates ${loan.shockPct! > 0 ? '+' : ''}${loan.shockPct}%`, color: 'var(--s3)', values: [view.shocked.startBalance, ...view.shocked.rows.map((r) => r.endBalance)] }] : []),
  ];
  const years = yearlySummary(s.rows);
  const pageSize = 60;
  const pages = Math.max(1, Math.ceil(s.rows.length / pageSize));
  const cur = Math.min(page, pages - 1);
  const mismatch = owed != null ? owed - balanceNow : null;

  async function addEvent() {
    if (eAmt <= 0) return;
    const ev: LoanEvent = {
      loanId: id,
      type: eType === 'draw' ? 'draw' : 'extra',
      date: eDate,
      amountCents: eAmt,
      monthly: eType === 'extra-monthly' ? true : undefined,
      endDate: eType === 'extra-monthly' && eEnd ? eEnd : null,
      note: eNote.trim() || undefined,
    };
    await db.loanEvents.add(ev);
    setEAmt(0);
    setENote('');
  }

  async function createAccount() {
    const useAsOf = loan.setup === 'current' || isHeloc;
    await createLoanLedgerAccount(db, id, {
      balanceCents: useAsOf ? loan.balanceCents ?? 0 : balanceNow,
      date: useAsOf ? loan.asOfDate ?? today : today,
    });
  }

  return (
    <div className="card">
      <div className="row spread">
        <button className="collapse-btn" aria-expanded={open} onClick={() => setOpen(!open)}>
          <span className="chev" aria-hidden="true">{open ? '▾' : '▸'}</span> <strong>{loan.name}</strong>
          <span className="badge">{KIND_NAMES[loan.kind]}</span>
          {loan.scenario && <span className="badge scheduled">what-if</span>}
          {dirty && <span className="badge pending">unsaved</span>}
        </button>
        <div className="row">
          <strong>{formatCents(balanceNow)}</strong>
          <button
            className="link danger"
            onClick={async () => {
              if (!confirm(`Delete "${loan.name}" and its rate changes and extra payments? ${loan.ledgerAccountId ? 'Its ledger account and transactions are kept.' : ''}`)) return;
              await db.transaction('rw', db.loans, db.loanRates, db.loanEvents, async () => {
                await db.loanRates.where('loanId').equals(id).delete();
                await db.loanEvents.where('loanId').equals(id).delete();
                await db.loans.delete(id);
              });
            }}
          >delete</button>
        </div>
      </div>

      <div hidden={!open}>
        {s.warnings.map((w) => <p key={w} className="warn">{w}</p>)}

        {s.rows.length > 0 && (
          <div className="viz" style={{ marginTop: 8 }}>
            <div className="tiles">
              <div className="tile">
                <div className="muted">{isHeloc && next?.phase === 'draw' ? 'Interest-only payment' : 'Payment now'}</div>
                <div className="v">{formatCents(next?.payment ?? 0)}</div>
                {(loan.escrowMonthlyCents || loan.pmiMonthlyCents) ? <div className="muted">{formatCents(monthlyTotal(loan, next?.payment ?? 0))} with escrow/PMI</div> : null}
              </div>
              <div className="tile"><div className="muted">Rate now</div><div className="v">{(next?.ratePct ?? loan.annualRatePct).toFixed(3).replace(/0+$/, '').replace(/\.$/, '')}%</div></div>
              <div className="tile"><div className="muted">Paid off</div><div className="v">{monthYear(s.payoffDate)}</div></div>
              <div className="tile"><div className="muted">Interest, rest of loan</div><div className="v">{compactUSD(s.totalInterest)}</div></div>
              {s.totalExtra > 0 && (
                <div className="tile"><div className="muted">Saved by extra payments</div><div className="v pos">{compactUSD(view.interestSaved)}</div><div className="muted">{view.monthsSaved} month(s) sooner</div></div>
              )}
              {isHeloc && s.conversion && (
                <div className="tile">
                  <div className="muted">Payback starts {monthYear(s.conversion.date)}</div>
                  <div className="v">{formatCents(s.conversion.payment)}</div>
                  <div className="muted">on {formatCents(s.conversion.balance)}</div>
                </div>
              )}
            </div>
            {isHeloc && s.conversion && (
              <p className="muted">
                Payments step from interest-only to principal-and-interest when the draw period ends: roughly{' '}
                <strong>{formatCents(Math.max(0, s.conversion.payment - (s.rows[lastDrawIdx - 1]?.payment ?? 0)))}</strong> more per month than the last interest-only payment.
              </p>
            )}
            {view.shocked && (
              <p>
                <strong>What if rates are {loan.shockPct! > 0 ? 'up' : 'down'} {Math.abs(loan.shockPct!)}% from {loan.shockFrom || 'the first payment'}?</strong>{' '}
                Highest payment {formatCents(view.shocked.peakPayment)} ({view.shocked.peakPayment >= s.peakPayment ? '+' : '−'}{formatCents(Math.abs(view.shocked.peakPayment - s.peakPayment))}),
                total interest {compactUSD(view.shocked.totalInterest)} ({view.shocked.totalInterest >= s.totalInterest ? '+' : '−'}{compactUSD(Math.abs(view.shocked.totalInterest - s.totalInterest))}),
                paid off {monthYear(view.shocked.payoffDate)}.
              </p>
            )}
          </div>
        )}

        {s.rows.length > 0 && longest > 1 && (
          <LinesChart
            title="Balance over time"
            subtitle="What you owe after each payment"
            series={series}
            xLabels={longestLabels}
            marker={isHeloc && lastDrawIdx > 0 ? { index: lastDrawIdx + 1, label: 'Payback starts' } : undefined}
          />
        )}

        <Collapsible id={`debt.l${id}.setup`} level={3} title="Loan details">
          <div className="grid">
            <label className="f">Name<input value={d.name} onChange={(e) => set({ name: e.target.value })} /></label>
            <label className="f">Type
              <select
                value={d.kind}
                onChange={(e) => {
                  const kind = e.target.value as LoanKind;
                  set(kind === 'heloc'
                    ? { kind, setup: 'current', heloc: d.heloc ?? { drawStartDate: today, drawMonths: 120, repayMonths: 180, creditLimitCents: null } }
                    : { kind });
                }}
              >
                {(Object.keys(KIND_NAMES) as LoanKind[]).map((k) => <option key={k} value={k}>{KIND_NAMES[k]}</option>)}
              </select>
            </label>
            {!isHeloc && (
              <label className="f">Describe it by
                <select value={d.setup} onChange={(e) => set({ setup: e.target.value as Loan['setup'] })}>
                  <option value="original">Original terms (amount, term, first payment)</option>
                  <option value="current">Today’s balance and months left</option>
                </select>
              </label>
            )}
            {!isHeloc && d.setup === 'original' && (
              <>
                <MoneyField label="Original loan amount" cents={d.originalAmountCents ?? 0} onChange={(c) => set({ originalAmountCents: c })} />
                <NumField label="Term (months)" value={d.termMonths ?? 0} step={1} onChange={(n) => set({ termMonths: Math.round(n) })} />
                <label className="f">First payment date<input type="date" value={d.firstPaymentDate ?? ''} onChange={(e) => set({ firstPaymentDate: e.target.value })} /></label>
              </>
            )}
            {(isHeloc || d.setup === 'current') && (
              <>
                <MoneyField label="Current balance" cents={d.balanceCents ?? 0} onChange={(c) => set({ balanceCents: c })} />
                <label className="f">Balance is as of<input type="date" value={d.asOfDate ?? ''} onChange={(e) => set({ asOfDate: e.target.value })} /></label>
                <label className="f">Next payment due<input type="date" value={d.nextPaymentDate ?? ''} onChange={(e) => set({ nextPaymentDate: e.target.value })} /></label>
                {!isHeloc && <NumField label="Months remaining" value={d.remainingMonths ?? 0} step={1} onChange={(n) => set({ remainingMonths: Math.round(n) })} />}
              </>
            )}
            <NumField label="Interest rate now (%)" value={d.annualRatePct} step={0.001} onChange={(n) => set({ annualRatePct: n })} />
            {isHeloc && d.heloc && (
              <>
                <label className="f">Draw period started<input type="date" value={d.heloc.drawStartDate} onChange={(e) => setHeloc({ drawStartDate: e.target.value })} /></label>
                <NumField label="Draw period (months)" value={d.heloc.drawMonths} step={1} onChange={(n) => setHeloc({ drawMonths: Math.round(n) })} />
                <NumField label="Payback period (months)" value={d.heloc.repayMonths} step={1} onChange={(n) => setHeloc({ repayMonths: Math.round(n) })} />
                <MoneyField label="Credit limit (optional)" cents={d.heloc.creditLimitCents ?? 0} onChange={(c) => setHeloc({ creditLimitCents: c > 0 ? c : null })} />
              </>
            )}
            {!isHeloc && <MoneyField label="Your monthly payment, if you know it (optional)" cents={d.paymentOverrideCents ?? 0} onChange={(c) => set({ paymentOverrideCents: c > 0 ? c : null })} />}
            {d.kind === 'mortgage' && (
              <>
                <MoneyField label="Escrow per month (taxes, insurance)" cents={d.escrowMonthlyCents ?? 0} onChange={(c) => set({ escrowMonthlyCents: c })} />
                <MoneyField label="PMI per month" cents={d.pmiMonthlyCents ?? 0} onChange={(c) => set({ pmiMonthlyCents: c })} />
              </>
            )}
            <label className="f">Extra principal between rate changes
              <select value={d.extraMode} onChange={(e) => set({ extraMode: e.target.value as Loan['extraMode'] })}>
                <option value="shorten">Keep my payment and pay off sooner</option>
                <option value="lower">Lower my payment as the balance falls</option>
              </select>
            </label>
          </div>
          <label className="chk" style={{ marginTop: 6 }}>
            <input type="checkbox" checked={!!d.scenario} onChange={(e) => set({ scenario: e.target.checked })} />
            This is a new or what-if loan (not counted in my debt, not tied to my ledger)
          </label>
          <p className="muted">
            Interest is figured monthly (balance × rate ÷ 12). Your lender may accrue daily, so figures can differ from your statement by a few dollars a year;
            compare with a statement balance. {isHeloc ? 'Draw period: interest-only payments. Payback: the balance is paid off over the payback months, and the payment is recalculated whenever the rate changes.' : 'When a rate changes, the payment is recalculated to pay the balance off over the months that remain.'}
          </p>
          <div className="row">
            <button className="primary" disabled={!dirty} onClick={() => db.loans.put(d)}>{dirty ? 'Save changes' : 'Saved'}</button>
            {dirty && <button onClick={() => setD(loan)}>Discard</button>}
          </div>
        </Collapsible>

        <Collapsible id={`debt.l${id}.rates`} level={3} title="Rate changes">
          <p className="muted">Enter each date the rate changes (for a variable rate, a past or expected change). Each applies to payments on or after its date.</p>
          {rates.length > 0 && (
            <table>
              <tbody>
                {[...rates].sort((a, b) => a.date.localeCompare(b.date)).map((r) => (
                  <tr key={r.id}><td>{r.date}</td><td className="num">{r.annualRatePct}%</td><td><button className="link danger" onClick={() => db.loanRates.delete(r.id!)}>remove</button></td></tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="row">
            <label className="f">Effective<input type="date" value={rDate} onChange={(e) => setRDate(e.target.value)} /></label>
            <NumField label="New rate (%)" value={rPct} step={0.001} width={100} onChange={setRPct} />
            <button onClick={() => db.loanRates.add({ loanId: id, date: rDate, annualRatePct: rPct })}>Add rate change</button>
          </div>
        </Collapsible>

        <Collapsible id={`debt.l${id}.events`} level={3} title={isHeloc ? 'Draws and extra principal' : 'Extra principal'}>
          <p className="muted">
            Extra principal can be paid in any period, including the interest-only draw period and the payback period. {isHeloc ? 'Draws add to the balance and are only allowed during the draw period. ' : ''}
            Payments dated before the balance date above are already in your balance, so they are ignored.
          </p>
          {events.length > 0 && (
            <table>
              <tbody>
                {[...events].sort((a, b) => a.date.localeCompare(b.date)).map((e) => (
                  <tr key={e.id}>
                    <td>{e.type === 'draw' ? 'Draw' : 'Extra principal'}{e.monthly ? ' every month' : ''}</td>
                    <td>{e.date}{e.monthly && e.endDate ? ` to ${e.endDate}` : e.monthly ? ' onward' : ''}</td>
                    <td className="num">{formatCents(e.amountCents)}</td>
                    <td className="muted hide-sm">{e.note}</td>
                    <td><button className="link danger" onClick={() => db.loanEvents.delete(e.id!)}>remove</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="row">
            <label className="f">What
              <select value={eType} onChange={(e) => setEType(e.target.value as typeof eType)}>
                <option value="extra-monthly">Extra principal, every month</option>
                <option value="extra-once">Extra principal, one time</option>
                {isHeloc && <option value="draw">Draw (adds to the balance)</option>}
              </select>
            </label>
            <label className="f">{eType === 'extra-monthly' ? 'Starting' : 'Date'}<input type="date" value={eDate} onChange={(e) => setEDate(e.target.value)} /></label>
            {eType === 'extra-monthly' && <label className="f">Through (optional)<input type="date" value={eEnd} onChange={(e) => setEEnd(e.target.value)} /></label>}
            <MoneyField label="Amount" cents={eAmt} onChange={setEAmt} width={120} />
            <label className="f">Note<input value={eNote} onChange={(e) => setENote(e.target.value)} placeholder="optional" /></label>
            <button className="primary" disabled={eAmt <= 0} onClick={addEvent}>Add</button>
          </div>
        </Collapsible>

        <Collapsible id={`debt.l${id}.whatif`} level={3} title="What if rates change?">
          <div className="row">
            <NumField label="Add to every rate (points; negative for lower)" value={loan.shockPct ?? 0} step={0.25} width={140} onChange={(n) => db.loans.update(id, { shockPct: n })} />
            <label className="f">Starting<input type="date" value={loan.shockFrom ?? ''} onChange={(e) => db.loans.update(id, { shockFrom: e.target.value })} /></label>
            {loan.shockPct ? <button className="link" onClick={() => db.loans.update(id, { shockPct: 0 })}>clear</button> : null}
          </div>
          <p className="muted">For example +2 shows your payments and total interest if every rate from that date on were 2 percentage points higher. The result appears in the summary and the chart above.</p>
        </Collapsible>

        {s.rows.length > 0 && (
          <Collapsible id={`debt.l${id}.schedule`} level={3} title="Amortization schedule" right={<button className="link" onClick={() => download(`${loan.name.replace(/[^\w]+/g, '-')}-schedule.csv`, scheduleToCsv(s))}>export CSV</button>}>
            <div className="row">
              <button className={mode === 'yearly' ? 'primary' : ''} onClick={() => setMode('yearly')}>By year</button>
              <button className={mode === 'monthly' ? 'primary' : ''} onClick={() => setMode('monthly')}>Month by month</button>
            </div>
            <div style={{ overflowX: 'auto' }}>
              {mode === 'yearly' ? (
                <table>
                  <thead><tr><th>Year</th><th className="num">Payments</th><th className="num">Interest</th><th className="num">Principal</th><th className="num">Extra</th>{isHeloc && <th className="num">Draws</th>}<th className="num">Balance at year end</th></tr></thead>
                  <tbody>
                    {years.map((y) => (
                      <tr key={y.year}>
                        <td>{y.year}</td><td className="num">{formatCents(y.payments)}</td><td className="num">{formatCents(y.interest)}</td>
                        <td className="num">{formatCents(y.principal)}</td><td className="num">{formatCents(y.extra)}</td>
                        {isHeloc && <td className="num">{formatCents(y.draws)}</td>}
                        <td className="num">{formatCents(y.endBalance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <>
                  <table>
                    <thead><tr><th>#</th><th>Date</th>{isHeloc && <th>Phase</th>}<th className="num">Rate</th><th className="num">Payment</th><th className="num">Interest</th><th className="num">Principal</th><th className="num">Extra</th>{isHeloc && <th className="num hide-sm">Draw</th>}<th className="num">Balance</th></tr></thead>
                    <tbody>
                      {s.rows.slice(cur * pageSize, (cur + 1) * pageSize).map((r) => (
                        <tr key={r.n} className={r.phase === 'repay' && s.conversion?.date === r.date ? 'selected' : ''}>
                          <td>{r.n}</td><td>{r.date}</td>{isHeloc && <td>{r.phase === 'draw' ? 'interest-only' : 'payback'}</td>}
                          <td className="num">{r.ratePct.toFixed(2)}%</td><td className="num">{formatCents(r.payment)}</td><td className="num">{formatCents(r.interest)}</td>
                          <td className="num">{formatCents(r.principal)}</td><td className="num">{r.extra ? formatCents(r.extra) : ''}</td>
                          {isHeloc && <td className="num hide-sm">{r.draw ? formatCents(r.draw) : ''}</td>}
                          <td className="num">{formatCents(r.endBalance)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="row">
                    <button disabled={cur === 0} onClick={() => setPage(cur - 1)}>‹ Prev</button>
                    <span className="muted">Page {cur + 1} of {pages}</span>
                    <button disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)}>Next ›</button>
                  </div>
                </>
              )}
            </div>
          </Collapsible>
        )}

        {!loan.scenario && (
          <Collapsible id={`debt.l${id}.ledger`} level={3} title="Your ledger">
            {!loan.ledgerAccountId ? (
              <>
                <p className="muted">
                  Tie this loan to your ledger so payments you record split into principal (reduces the loan) and interest (an expense in your budget).
                  This creates a liability account named “{loan.name}” starting at {formatCents(loan.setup === 'current' || isHeloc ? loan.balanceCents ?? 0 : balanceNow)}.
                </p>
                <button className="primary" disabled={s.rows.length === 0} onClick={createAccount}>Create ledger account</button>
              </>
            ) : (
              <>
                <p>
                  Ledger account: <Link to={`/account/${loan.ledgerAccountId}`}>{loan.name}</Link>. The ledger says you owe <strong>{owed != null ? formatCents(owed) : '…'}</strong>;
                  the schedule says <strong>{formatCents(balanceNow)}</strong> today.
                </p>
                {mismatch !== null && Math.abs(mismatch) > 10000 && (
                  <p className="warn">They differ by {formatCents(Math.abs(mismatch))}. Check for a payment not yet recorded, an extra payment missing from the list above, or a different balance date.</p>
                )}
                <RecordPayment key={`${next?.n}-${loan.interestCategoryId}`} loan={loan} next={next} accounts={accounts} groups={groups} categories={categories} />
              </>
            )}
          </Collapsible>
        )}
      </div>
    </div>
  );
}
