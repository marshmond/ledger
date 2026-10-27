import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { formatCents, todayISO } from '../lib/money';
import { ledgerBalance } from '../lib/netWorth';
import { loanView, nextRow } from '../lib/loanSchedule';
import { comparePayoff, extraVsInvest, refinance, type Debt, type PayoffStrategy } from '../lib/payoff';
import { LinesChart } from './charts';
import Collapsible from './Collapsible';
import { MoneyField, NumField } from './fields';
import { PageHeader } from '../ui/components';

interface PayoffSettings {
  cardTerms: Record<string, { aprPct: number; minPaymentCents: number }>;
  /** Debts left out of the plan, by id (a mortgage is usually left out). */
  exclude: string[];
  manual: Debt[];
  extraCents: number;
  pick: PayoffStrategy;
  returnPct: number;
  taxDragPct: number;
}

const DEFAULTS: PayoffSettings = { cardTerms: {}, exclude: [], manual: [], extraCents: 0, pick: 'avalanche', returnPct: 7, taxDragPct: 0 };
const NAME: Record<PayoffStrategy, string> = { minimum: 'Minimum payments only', avalanche: 'Avalanche: highest rate first', snowball: 'Snowball: smallest balance first' };
const monthsText = (m: number | null) => (m === null ? 'never' : `${Math.floor(m / 12)} yr ${m % 12} mo`.replace('0 yr ', '').replace(' 0 mo', ''));

/** How to get out of debt fastest, whether a refinance pays off, and whether extra principal beats investing. */
export default function PayoffPage() {
  const today = todayISO();
  const accounts = useLiveQuery(() => db.accounts.toArray(), []) ?? [];
  const txns = useLiveQuery(() => db.txns.toArray(), []) ?? [];
  const loans = useLiveQuery(() => db.loans.toArray(), []) ?? [];
  const rates = useLiveQuery(() => db.loanRates.toArray(), []) ?? [];
  const events = useLiveQuery(() => db.loanEvents.toArray(), []) ?? [];
  const saved = useLiveQuery(() => db.settings.get('payoff'), []);
  const s: PayoffSettings = { ...DEFAULTS, ...((saved?.value as Partial<PayoffSettings>) ?? {}) };
  const setS = (p: Partial<PayoffSettings>) => db.settings.put({ key: 'payoff', value: { ...s, ...p } });

  // every debt we know about
  const all: (Debt & { source: string; editable: boolean; months?: number })[] = useMemo(() => {
    const out: (Debt & { source: string; editable: boolean; months?: number })[] = [];
    for (const a of accounts) {
      if (a.closed || a.kind !== 'credit_card') continue;
      const owed = -ledgerBalance(a, txns);
      if (owed <= 0) continue;
      const t = s.cardTerms[String(a.id)];
      out.push({ id: `card-${a.id}`, name: a.name, balanceCents: owed, aprPct: t?.aprPct ?? 0, minPaymentCents: t?.minPaymentCents ?? Math.max(2500, Math.round(owed * 0.02)), source: 'Credit card', editable: true });
    }
    for (const l of loans) {
      if (l.scenario) continue;
      const v = loanView(l, rates.filter((r) => r.loanId === l.id), events.filter((e) => e.loanId === l.id));
      const r = v.schedule.rows.length ? nextRow(v.schedule, today) : null;
      if (!r) continue;
      out.push({ id: `loan-${l.id}`, name: l.name, balanceCents: Math.round(r.startBalance), aprPct: r.ratePct, minPaymentCents: Math.round(r.payment), source: l.kind === 'mortgage' ? 'Mortgage' : l.kind === 'heloc' ? 'HELOC' : 'Loan', editable: false, months: v.schedule.rows.filter((x) => x.date >= today).length });
    }
    for (const m of s.manual) out.push({ ...m, source: 'Entered by hand', editable: false });
    return out;
  }, [accounts, txns, loans, rates, events, s.cardTerms, s.manual, today]);

  // a mortgage is left out unless you include it
  const excluded = new Set(s.exclude);
  const isIn = (d: (typeof all)[number]) => (d.source === 'Mortgage' ? s.exclude.includes(`in:${d.id}`) : !excluded.has(d.id));
  const used: Debt[] = all.filter(isIn);
  const cmp = useMemo(() => comparePayoff(used, s.extraCents), [used.map((d) => `${d.id}:${d.balanceCents}:${d.aprPct}:${d.minPaymentCents}`).join('|'), s.extraCents]); // eslint-disable-line react-hooks/exhaustive-deps
  const picked = cmp[s.pick];
  const length = Math.max(cmp.minimum.balances.length, cmp.avalanche.balances.length, cmp.snowball.balances.length);
  const labels = Array.from({ length }, (_, i) => { const d = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1 + i, 1)); return d.toISOString().slice(0, 10); });
  const toggle = (d: (typeof all)[number]) => {
    if (d.source === 'Mortgage') setS({ exclude: isIn(d) ? s.exclude.filter((x) => x !== `in:${d.id}`) : [...s.exclude, `in:${d.id}`] });
    else setS({ exclude: isIn(d) ? [...s.exclude, d.id] : s.exclude.filter((x) => x !== d.id) });
  };

  // manual debt form
  const [mName, setMName] = useState('');
  const [mBal, setMBal] = useState(0);
  const [mApr, setMApr] = useState(0);
  const [mMin, setMMin] = useState(0);

  // refinance and extra-vs-invest tools
  const loanOptions = all.filter((d) => d.source !== 'Credit card');
  const [toolId, setToolId] = useState('');
  const tool = loanOptions.find((d) => d.id === toolId) ?? loanOptions[0];
  // Defaults come from the chosen loan; anything you type replaces them.
  const [remainingIn, setRemaining] = useState<number | null>(null);
  const [newAprIn, setNewApr] = useState<number | null>(null);
  const [newTermIn, setNewTerm] = useState<number | null>(null);
  const [closingIn, setClosing] = useState<number | null>(null);
  const remaining = remainingIn ?? tool?.months ?? 300;
  const newApr = newAprIn ?? Math.max(0, Math.round(((tool?.aprPct ?? 6) - 1) * 8) / 8);
  const newTerm = newTermIn ?? remaining;
  const closing = closingIn ?? (tool && (tool.source === 'Mortgage' || tool.source === 'HELOC') ? 500000 : 0);
  const [roll, setRoll] = useState(false);
  const [extraMo, setExtraMo] = useState(50000);
  const refi = tool ? refinance({ balanceCents: tool.balanceCents, aprPct: tool.aprPct, remainingMonths: remaining, newAprPct: newApr, newTermMonths: newTerm, closingCostsCents: closing, rollCosts: roll }) : null;
  const xv = tool ? extraVsInvest({ balanceCents: tool.balanceCents, aprPct: tool.aprPct, remainingMonths: remaining, extraMonthlyCents: extraMo, returnPct: s.returnPct, taxDragPct: s.taxDragPct }) : null;

  return (
    <>
      <PageHeader title="Debt payoff planner" description="Compare ways to pay down debt, refinance, or invest instead." about={<>Compare ways of paying down your debts, see whether a refinance would pay for itself, and weigh extra payments on a loan against investing the money. Mortgage and HELOC
        schedules are on the <Link to="/debt">Debt</Link> page.</>} />

      <Collapsible id="payoff.debts" title="Your debts">
        {all.length === 0 && <p className="muted">No debts found. Credit cards with a balance, loans on the Debt page, and anything you add below appear here.</p>}
        {all.length > 0 && (
          <div className="scroll-x">
            <table>
              <thead><tr><th>Include</th><th>Debt</th><th className="num">Balance</th><th className="num">Rate %</th><th className="num">Minimum / month</th><th /></tr></thead>
              <tbody>
                {all.map((d) => {
                  const cardId = d.id.startsWith('card-') ? d.id.slice(5) : null;
                  const t = cardId ? s.cardTerms[cardId] : undefined;
                  return (
                    <tr key={d.id}>
                      <td><input type="checkbox" aria-label={`Include ${d.name}`} checked={isIn(d)} onChange={() => toggle(d)} /></td>
                      <td>{d.name}<div className="muted" style={{ fontSize: '0.75rem' }}>{d.source}{d.source === 'Mortgage' && ' (left out by default)'}</div></td>
                      <td className="num">{formatCents(d.balanceCents)}</td>
                      <td className="num">{d.editable ? <NumField value={t?.aprPct ?? 0} step={0.1} width={70} onChange={(n) => setS({ cardTerms: { ...s.cardTerms, [cardId!]: { aprPct: n, minPaymentCents: t?.minPaymentCents ?? d.minPaymentCents } } })} /> : d.aprPct.toFixed(2)}</td>
                      <td className="num">{d.editable ? <MoneyField key={`${cardId}-${t?.minPaymentCents}`} cents={t?.minPaymentCents ?? d.minPaymentCents} width={90} onChange={(c) => setS({ cardTerms: { ...s.cardTerms, [cardId!]: { aprPct: t?.aprPct ?? 0, minPaymentCents: c } } })} /> : formatCents(d.minPaymentCents)}</td>
                      <td>{d.source === 'Entered by hand' && <button className="link danger" onClick={() => setS({ manual: s.manual.filter((x) => x.id !== d.id) })}>remove</button>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {all.some((d) => d.editable && !(s.cardTerms[d.id.slice(5)]?.aprPct)) && <p className="warn">Enter each card’s interest rate (APR) from your statement. A rate of 0 makes the card look free.</p>}
        <details>
          <summary>Add a debt by hand (student loan, car loan, medical bill…)</summary>
          <div className="row" style={{ marginTop: 6 }}>
            <label className="f">Name<input value={mName} onChange={(e) => setMName(e.target.value)} /></label>
            <MoneyField key={`b${s.manual.length}`} label="Balance" cents={mBal} onChange={setMBal} width={110} />
            <NumField label="Rate %" value={mApr} step={0.1} width={80} onChange={setMApr} />
            <MoneyField key={`m${s.manual.length}`} label="Minimum / month" cents={mMin} onChange={setMMin} width={110} />
            <button disabled={!mName.trim() || mBal <= 0 || mMin <= 0} onClick={() => { setS({ manual: [...s.manual, { id: `manual-${Date.now()}`, name: mName.trim(), balanceCents: mBal, aprPct: mApr, minPaymentCents: mMin }] }); setMName(''); setMBal(0); setMMin(0); setMApr(0); }}>Add</button>
          </div>
        </details>
      </Collapsible>

      <Collapsible id="payoff.compare" title="Pay them off">
        <div className="row">
          <MoneyField key={`x${s.extraCents}`} label="Extra to put toward debt each month" cents={s.extraCents} onChange={(c) => setS({ extraCents: c })} width={130} />
          <span className="muted">On top of all the minimums. Minimums freed up by a finished debt roll into the next one.</span>
        </div>
        {used.length === 0 ? <p className="muted">Include at least one debt above.</p> : (
          <>
            {picked.notCovering.length > 0 && <p className="warn">The minimum payment on {picked.notCovering.join(', ')} does not cover its interest, so it only shrinks once extra money reaches it.</p>}
            <div className="scroll-x">
              <table>
                <thead><tr><th>Plan</th><th className="num">Debt-free in</th><th className="num">Interest paid</th><th className="num">Interest saved</th></tr></thead>
                <tbody>
                  {(['minimum', 'avalanche', 'snowball'] as PayoffStrategy[]).map((k) => (
                    <tr key={k} className={s.pick === k ? 'sel' : ''}>
                      <td><button className="link" onClick={() => setS({ pick: k })}>{NAME[k]}</button></td>
                      <td className="num">{monthsText(cmp[k].months)}</td>
                      <td className="num">{formatCents(cmp[k].totalInterestCents)}</td>
                      <td className="num pos">{k === 'minimum' ? '—' : formatCents(cmp.savings[k as 'avalanche' | 'snowball'].interestCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <LinesChart
              title="Total debt over time"
              xLabels={labels}
              series={(['minimum', 'avalanche', 'snowball'] as PayoffStrategy[]).map((k, i) => ({ label: NAME[k].split(':')[0], color: `var(--s${i + 1})`, values: cmp[k].balances }))}
            />
            <h3>Order for “{NAME[s.pick]}”</h3>
            <ol>
              {picked.order.map((o) => <li key={o.id}>{o.name}: paid off in {monthsText(o.month)}</li>)}
            </ol>
            <p className="muted">The avalanche pays the least interest. The snowball clears small debts sooner, which some people find easier to stick with. Interest is simple monthly (balance × rate ÷ 12), so it may differ slightly from your statements.</p>
          </>
        )}
      </Collapsible>

      {tool && (
        <Collapsible id="payoff.tools" title="Refinance and extra payments">
          <div className="row">
            <label className="f">Loan
              <select value={tool.id} onChange={(e) => { setToolId(e.target.value); setRemaining(null); setNewApr(null); setNewTerm(null); setClosing(null); }}>{loanOptions.map((d) => <option key={d.id} value={d.id}>{d.name} ({formatCents(d.balanceCents)} at {d.aprPct.toFixed(2)}%)</option>)}</select>
            </label>
            <NumField key={`r${tool.id}`} label="Months left on it" value={remaining} step={1} width={90} onChange={(n) => setRemaining(Math.max(1, Math.round(n)))} />
          </div>

          <div className="card">
            <strong>Would refinancing pay off?</strong>
            <div className="row">
              <NumField key={`n${tool?.id}`} label="New rate %" value={newApr} step={0.125} width={90} onChange={setNewApr} />
              <NumField key={`t${tool?.id}-${remaining}`} label="New term (months)" value={newTerm} step={12} width={100} onChange={(n) => setNewTerm(Math.max(1, Math.round(n)))} />
              <MoneyField key={`cc${tool?.id}`} label="Closing costs" cents={closing} onChange={setClosing} width={110} />
              <label className="chk"><input type="checkbox" checked={roll} onChange={(e) => setRoll(e.target.checked)} /> Roll the costs into the loan</label>
            </div>
            {refi && (
              <table><tbody>
                <tr><td>Payment now → after</td><td className="num">{formatCents(refi.currentPaymentCents)} → {formatCents(refi.newPaymentCents)}</td></tr>
                <tr><td>Monthly savings</td><td className={`num ${refi.monthlySavingsCents > 0 ? 'pos' : 'neg'}`}>{formatCents(refi.monthlySavingsCents)}</td></tr>
                <tr><td>Break-even on closing costs</td><td className="num">{refi.breakEvenMonths === null ? 'never' : refi.breakEvenMonths === 0 ? 'none (rolled in)' : `${refi.breakEvenMonths} months`}</td></tr>
                <tr><td>Interest to pay off: now → after</td><td className="num">{formatCents(refi.currentInterestCents)} → {formatCents(refi.newInterestCents)}</td></tr>
                <tr><td><strong>Total difference (incl. closing costs)</strong></td><td className={`num ${refi.lifetimeSavingsCents > 0 ? 'pos' : 'neg'}`}><strong>{refi.lifetimeSavingsCents > 0 ? 'saves ' : 'costs '}{formatCents(Math.abs(refi.lifetimeSavingsCents))}</strong></td></tr>
              </tbody></table>
            )}
            {refi?.extendsTerm && <p className="warn">The new loan is longer than what is left on the current one, so a lower payment can still mean more total interest. Compare the last two rows.</p>}
          </div>

          <div className="card">
            <strong>Extra on this loan, or invest it?</strong>
            <div className="row">
              <MoneyField label="Extra per month" cents={extraMo} onChange={setExtraMo} width={110} />
              <NumField label="Expected investment return %" value={s.returnPct} step={0.5} width={110} onChange={(n) => setS({ returnPct: n })} />
              <NumField label="Tax on that return %" value={s.taxDragPct} step={5} width={100} onChange={(n) => setS({ taxDragPct: n })} />
            </div>
            {xv && (
              <>
                <table><tbody>
                  <tr><td>Paying the extra: loan gone in</td><td className="num">{monthsText(xv.payoffMonths)} (saves {monthsText(xv.monthsSaved)})</td></tr>
                  <tr><td>Interest saved</td><td className="num pos">{formatCents(xv.interestSavedCents)}</td></tr>
                  <tr><td>Money at the end of the original term, if you prepay</td><td className="num">{formatCents(xv.wealthIfPrepayCents)}</td></tr>
                  <tr><td>Money at the end of the original term, if you invest instead</td><td className="num">{formatCents(xv.wealthIfInvestCents)}</td></tr>
                </tbody></table>
                <p>
                  {xv.better === 'even' ? 'About even.' : xv.better === 'prepay' ? <strong>Paying down the loan comes out ahead</strong> : <strong>Investing comes out ahead</strong>}
                  {xv.better !== 'even' && ` by ${formatCents(Math.abs(xv.wealthIfPrepayCents - xv.wealthIfInvestCents))}`}. Prepaying earns a sure {tool.aprPct.toFixed(2)}% (the loan rate); investing earns an uncertain {xv.afterTaxReturnPct.toFixed(2)}% after tax.
                  A guaranteed return is worth more than an expected one of the same size.
                </p>
              </>
            )}
          </div>
        </Collapsible>
      )}
    </>
  );
}
