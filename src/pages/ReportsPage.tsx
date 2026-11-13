import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { formatCents, todayISO } from '../lib/money';
import { monthLabel } from '../lib/dates';
import { categoryCsv, categoryStats, projectCsvName, projectFromParam, resolveReportProject, compareTotals, jumps, lastMonths, savingsRates, spendingMatrix, topPayees } from '../lib/reports';
import { downloadText } from '../lib/download';
import { LinesChart } from './charts';
import Collapsible from './Collapsible';
import PageTabs from './PageTabs';
import FlowPanel from './FlowPanel';
import { PageHeader } from '../ui/components';
import { deltaWords } from './analysisPresentation';
import './analysis.css';
import { projectLabel, useProjectChoicesLoaded } from '../core/projectLink';
import { projectOnlyTxns } from '../lib/txnProject';

const SERIES = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)'];
const pct = (f: number) => `${f >= 0 ? '+' : '−'}${Math.abs(Math.round(f * 100))}%`;

/** One comparison figure: the other month's total, with how this month moved against it in words (no color is tied to the direction). */
function Compare({ now, then, label }: { now: number; then: number | null; label: string }) {
  if (then === null) return <div className="an-fig"><dt>{label}</dt><dd>—</dd></div>;
  return (
    <div className="an-fig">
      <dt>{label}</dt>
      <dd>{formatCents(then)}<span className="an-sub">This month is {deltaWords(now, then)}</span></dd>
    </div>
  );
}

/** Where the money went: a flow diagram, and month-by-month totals, category trends, what jumped, and top payees. */
export default function ReportsPage() {
  // Arriving from a project (#/ledger/reports?project=3): open Trends filtered to it, then tidy the address.
  const [sp, setSp] = useSearchParams();
  const raw = sp.get('project');
  const [start, setStart] = useState<{ id: number; n: number } | null>(null);
  useEffect(() => {
    if (raw === null) return;
    const id = projectFromParam(raw);
    if (id !== undefined) setStart((s) => ({ id, n: (s?.n ?? 0) + 1 }));
    const next = new URLSearchParams(sp); next.delete('project'); setSp(next, { replace: true });
  }, [raw]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="an-page">
      <PageHeader eyebrow="Money" title="Reports" description="Where the money went." />
      <PageTabs id="reports" jumpTo={start ? { tab: 'trends', n: start.n } : undefined} tabs={[{ id: 'trends', label: 'Trends', content: <Trends start={start} /> }, { id: 'flow', label: 'Flow diagram', content: <FlowPanel /> }]} />
    </div>
  );
}

function Trends({ start }: { start: { id: number; n: number } | null }) {
  const thisMonth = todayISO().slice(0, 7);
  const [end, setEnd] = useState(thisMonth);
  const [payeeRange, setPayeeRange] = useState<'month' | 'year'>('month');
  const allTxns = useLiveQuery(() => db.txns.toArray(), []) ?? [];
  const { projects, loaded: projectsLoaded } = useProjectChoicesLoaded();
  // A project filter shows only that project's own pieces of transactions (each transaction once). Income and savings do not apply to it.
  const [projectId, setProjectId] = useState<number | null>(null);
  // A link from a project selects it once the projects are known. An id that no longer exists leaves the filter off.
  const applied = useRef(0);
  useEffect(() => {
    if (!start || !projectsLoaded || applied.current === start.n) return;
    applied.current = start.n;
    const id = resolveReportProject(start.id, projects);
    if (id !== null) setProjectId(id);
  }, [start, projectsLoaded, projects]);
  const projectMissing = projectId !== null && !projects.some((p) => p.id === projectId);
  const txns = useMemo(() => (projectId === null ? allTxns : projectOnlyTxns(allTxns, projectId)), [allTxns, projectId]);
  const net = projectId !== null;
  const categories = useLiveQuery(() => db.categories.toArray(), []) ?? [];

  const months = useMemo(() => lastMonths(end, 13), [end]);
  const view = useMemo(() => months.slice(1), [months]);
  const matrix = useMemo(() => spendingMatrix(txns, categories, months, { net }), [txns, categories, months, net]);
  const stats = useMemo(() => categoryStats(matrix), [matrix]);
  const cmp = compareTotals(matrix);
  const saved = savingsRates(matrix);
  const jumped = jumps(stats);
  const top5 = matrix.cats.slice(0, 5);
  const payees = useMemo(() => topPayees(txns, categories, payeeRange === 'month' ? `${end}-01` : `${months[1]}-01`, `${end}-31`, 10, { net }), [txns, categories, payeeRange, end, months, net]);
  const options = lastMonths(thisMonth, 24).reverse();
  const n = matrix.months.length;

  return (
    <div className="an-page">
      <div className="an-head" style={{ marginBottom: 0 }}>
        <h2 className="an-h2">{net ? 'Project spending by month' : 'Spending by month'} <span className="an-kind">Actual transactions</span></h2>
      </div>
      <div className="an-tools">
        <label className="f an-ctl">Through
          <select value={end} onChange={(e) => setEnd(e.target.value)}>{options.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}</select>
        </label>
        {projects.length > 0 && (
          <label className="f an-ctl">Project
            <select value={projectId === null ? '' : String(projectId)} onChange={(e) => setProjectId(e.target.value ? Number(e.target.value) : null)} aria-label="Show one project only">
              <option value="">All spending</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{projectLabel(projects, p.id)}</option>)}
              {projectMissing && <option value={projectId!}>(project removed)</option>}
            </select>
          </label>
        )}
        {projectId !== null && (
          <span className="badge" role="status">Only: {projectLabel(projects, projectId)} <button className="link" onClick={() => setProjectId(null)} aria-label="Remove the project filter">remove</button></span>
        )}
      </div>
      {net ? (
        <p className="an-note" style={{ margin: 0 }}>Only the parts of transactions tagged to this project, each counted once (a split transaction contributes just the parts on this project). Refunds, reversals and credits lower the total. Income and savings do not apply to one project, so they are not shown. The Flow diagram tab is not filtered.{projectMissing ? ' This project no longer exists; remove the filter.' : ''}</p>
      ) : (
        <p className="an-note" style={{ margin: 0 }}>Where your money went, from the transactions in your accounts. Transfers between accounts are left out; refunds reduce spending.</p>
      )}

      <dl className="an-figs" aria-label={`Spending in ${monthLabel(end)} compared with other periods`}>
        <div className="an-fig"><dt>Spent in {monthLabel(end)}</dt><dd>{formatCents(cmp.thisMonth)}</dd></div>
        <Compare now={cmp.thisMonth} then={cmp.lastMonth} label="Last month" />
        <Compare now={cmp.thisMonth} then={cmp.sameMonthLastYear} label="Same month last year" />
        <Compare now={cmp.thisMonth} then={cmp.avg3} label="3-month average" />
        {!net && <div className="an-fig"><dt>Saved this month</dt><dd>{saved[n - 1] === null ? '—' : `${Math.round((saved[n - 1] as number) * 100)}%`}<span className="an-sub">of income</span></dd></div>}
      </dl>

      <Collapsible id="reports.trend" title="Spending and income by month">
        {view.every((_, i) => matrix.spent[i + 1] === 0 && matrix.income[i + 1] === 0) ? <p className="muted">No transactions in this period yet.</p> : (
          <LinesChart
            title="Last 12 months"
            subtitle="Spending and income"
            xLabels={view.map((m) => `${m}-01`)}
            fit
            precise
            axis="month"
            series={[
              { label: 'Spending', color: 'var(--s2)', values: matrix.spent.slice(1) },
              ...(net ? [] : [{ label: 'Income', color: 'var(--s3)', values: matrix.income.slice(1) }]),
            ]}
          />
        )}
        <div className="an-tablewrap" style={{ marginTop: 'var(--sp-3)' }}>
          <table className="an-table an-matrix">
            <thead>{net ? <tr><th>Month</th><th className="num">Spending</th></tr> : <tr><th>Month</th><th className="num">Income</th><th className="num">Spending</th><th className="num">Saved</th><th className="num">Savings rate</th></tr>}</thead>
            <tbody>
              {[...view].reverse().map((m, k) => {
                const i = n - 1 - k;
                return (
                  net ? <tr key={m}><td className="an-lead"><strong>{monthLabel(m)}</strong></td><td className="num" data-label="Spending">{formatCents(matrix.spent[i])}</td></tr> : (
                  <tr key={m}>
                    <td className="an-lead"><strong>{monthLabel(m)}</strong></td><td className="num" data-label="Income">{formatCents(matrix.income[i])}</td><td className="num" data-label="Spending">{formatCents(matrix.spent[i])}</td>
                    <td className="num" data-label="Saved">{formatCents(matrix.income[i] - matrix.spent[i])}</td>
                    <td className="num" data-label="Savings rate">{saved[i] === null ? '—' : `${Math.round((saved[i] as number) * 100)}%`}</td>
                  </tr>)
                );
              })}
            </tbody>
          </table>
          <p className="an-scrollhint">Scroll sideways for more columns.</p>
        </div>
      </Collapsible>

      <div className="an-split">
        <Collapsible id="reports.cats" title="Categories" right={<button className="link" disabled={matrix.cats.length === 0} onClick={() => downloadText(net && projectId !== null ? projectCsvName(projects.find((p) => p.id === projectId)?.name ?? '', months[1], end) : `spending-${months[1]}-to-${end}.csv`, 'text/csv', categoryCsv({ ...matrix, months: view, cats: matrix.cats.map((c) => ({ ...c, byMonth: c.byMonth.slice(1) })), spent: matrix.spent.slice(1), income: matrix.income.slice(1) }, { projectView: net }))}>download CSV</button>}>
          {top5.length > 0 && (
            <LinesChart title="Top categories over 12 months" xLabels={view.map((m) => `${m}-01`)} fit precise axis="month" series={top5.map((c, i) => ({ label: c.name, color: SERIES[i], values: c.byMonth.slice(1) }))} />
          )}
          {stats.length === 0 ? <p className="muted">No spending yet.</p> : (
            <div className="an-tablewrap" style={{ marginTop: 'var(--sp-3)' }}>
              <table className="an-table an-matrix">
                <thead><tr><th>Category</th><th className="num">{monthLabel(end).split(' ')[0]}</th><th className="num">Last month</th><th className="num">3-mo avg</th><th className="num">vs avg</th><th className="num">12-mo avg</th></tr></thead>
                <tbody>
                  {stats.filter((s) => s.thisMonth > 0 || s.avg3 > 0).map((s) => (
                    <tr key={s.name}>
                      <td className="an-lead an-title">{s.name}</td><td className="num" data-label={monthLabel(end).split(' ')[0]}><strong>{formatCents(s.thisMonth)}</strong></td><td className="num" data-label="Last month">{formatCents(s.lastMonth)}</td><td className="num" data-label="3-mo avg">{formatCents(s.avg3)}</td>
                      <td className="num" data-label="vs avg">{s.vsAvg3 === null ? '—' : pct(s.vsAvg3)}</td>
                      <td className="num" data-label="12-mo avg">{formatCents(s.avg12)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="an-scrollhint">Scroll sideways for more columns.</p>
            </div>
          )}
        </Collapsible>

        <div className="an-stack-col">
          <Collapsible id="reports.jumps" title="Where spending jumped">
            {jumped.length === 0 ? <p className="muted">No category is far above its recent average this month.</p> : (
              <ul className="an-jumps">
                {jumped.map((j) => (
                  <li key={j.name} className="an-jump"><span><strong>{j.name}</strong>: {formatCents(j.thisMonth)} vs a usual {formatCents(j.avg3)}</span> <span className="an-delta">({pct(j.vsAvg3 as number)}, {formatCents(j.thisMonth - j.avg3)} more)</span></li>
                ))}
              </ul>
            )}
          </Collapsible>

          <Collapsible id="reports.payees" title="Top payees" right={
            <div className="seg" role="group" aria-label="Period">
              <button className={payeeRange === 'month' ? 'on' : ''} onClick={() => setPayeeRange('month')}>This month</button>
              <button className={payeeRange === 'year' ? 'on' : ''} onClick={() => setPayeeRange('year')}>12 months</button>
            </div>
          }>
            {payees.length === 0 ? <p className="muted">No spending in this period.</p> : (
              <ul className="plain" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {payees.map((p) => <li className="an-payee" key={p.payee}><span className="an-payee-name">{p.payee}</span><span className="an-payee-count">{p.count} time{p.count === 1 ? '' : 's'}</span><span className="an-payee-amt">{formatCents(p.cents)}</span></li>)}
              </ul>
            )}
          </Collapsible>
        </div>
      </div>
    </div>
  );
}
