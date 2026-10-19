import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { formatCents, todayISO } from '../lib/money';
import { buildFlow, filterTree, flowRows, summarizePay, type FlowDetail } from '../lib/flow';
import { layoutFlow } from '../lib/flowLayout';
import { RANGE_LABELS, rangeText, resolveRange, yearsIn, type RangePreset } from '../lib/flowRange';
import { loadIncomeModel } from '../lib/income';
import Collapsible from './Collapsible';
import FlowViews from './FlowViews';
import { accountsFromOff, parseLast, type FlowViewState } from '../lib/flowViews';

const usd0 = (c: number) => `${c < 0 ? '-' : ''}$${Math.round(Math.abs(c) / 100).toLocaleString('en-US')}`;
const PRESETS = Object.keys(RANGE_LABELS) as RangePreset[];
const LAST_KEY = 'ledger-flow-last';

/** What the page showed last time on this device, so it reopens the way you left it. */
function readLast() {
  try {
    return parseLast(JSON.parse(localStorage.getItem(LAST_KEY) ?? 'null'));
  } catch {
    return null;
  }
}

function Tri({ checked, some, onChange, label }: { checked: boolean; some: boolean; onChange: (on: boolean) => void; label: string }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (ref.current) ref.current.indeterminate = some && !checked; }, [some, checked]);
  return <label className="chk"><input ref={ref} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /> {label}</label>;
}

/** The flow diagram: where money came from and where it went, for any period, with categories and accounts switched on or off. */
export default function FlowPanel() {
  const today = todayISO();
  const txns = useLiveQuery(() => db.txns.toArray(), []) ?? [];
  const accounts = useLiveQuery(() => db.accounts.toArray(), []) ?? [];
  const categories = useLiveQuery(() => db.categories.toArray(), []) ?? [];
  const groups = useLiveQuery(() => db.categoryGroups.toArray(), []) ?? [];
  const profiles = useLiveQuery(() => db.incomeProfiles.toArray(), []) ?? [];

  const last = useMemo(readLast, []);
  const [view, setView] = useState<'net' | 'gross'>(last?.view ?? 'net');
  const [preset, setPreset] = useState<RangePreset>(last?.preset ?? 'last3');
  const [cStart, setCStart] = useState(last?.customStart ?? '');
  const [cEnd, setCEnd] = useState(last?.customEnd ?? '');
  const [detail, setDetail] = useState<FlowDetail>(last?.detail ?? 'groups');
  const [off, setOff] = useState<Set<string>>(new Set(last?.off ?? []));
  // Accounts are remembered as the ones switched OFF, so an account you add later is counted and a deleted one cannot hide anything.
  const [acctOff, setAcctOff] = useState<Set<number>>(new Set(last?.accountsOff ?? []));
  const [activeId, setActiveId] = useState<string | null>(last?.activeId ?? null);
  const [includeSetup, setIncludeSetup] = useState(!!last?.includeSetup);
  const [sel, setSel] = useState<{ kind: 'node' | 'link'; id: string } | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(LAST_KEY, JSON.stringify({ view, preset, detail, off: [...off], accountsOff: [...acctOff], includeSetup, customStart: cStart, customEnd: cEnd, activeId }));
    } catch { /* storage unavailable: the page just opens fresh next time */ }
  }, [view, preset, detail, off, acctOff, includeSetup, cStart, cEnd, activeId]);
  const accountIds = accounts.map((a) => a.id!);
  const idKey = accountIds.join();
  const acctOn = useMemo(() => accountsFromOff(accountIds, [...acctOff]), [idKey, acctOff]); // eslint-disable-line react-hooks/exhaustive-deps
  const current: FlowViewState = { view, preset, detail, off: [...off], accountsOff: [...acctOff], ...(includeSetup ? { includeSetup: true } : {}) };
  const applyView = (v: FlowViewState) => {
    setView(v.view);
    setPreset(v.preset);
    setDetail(v.detail);
    setOff(new Set(v.off));
    setAcctOff(new Set(v.accountsOff));
    setIncludeSetup(!!v.includeSetup);
  };

  const earliest = useMemo(() => txns.reduce<string | undefined>((m, t) => (!m || t.date < m ? t.date : m), undefined), [txns]);
  const range = useMemo(() => resolveRange(preset, today, { start: cStart, end: cEnd }, earliest), [preset, today, cStart, cEnd, earliest]);
  const years = yearsIn(range);
  const models = useLiveQuery(() => (view === 'gross' ? Promise.all(years.map((y) => loadIncomeModel(db, y))) : Promise.resolve([])), [view, years.join()]);
  const dedName = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of profiles) for (const d of p.deductions) m.set(d.id, d.name);
    return (id: string) => m.get(id) ?? 'Deduction';
  }, [profiles]);
  const pay = useMemo(() => (view === 'gross' ? summarizePay((models ?? []).flatMap((m) => m.years), range.start, range.end, dedName) : null), [view, models, range, dedName]);

  const tree = useMemo(() => filterTree(categories, groups), [categories, groups]);
  const graph = useMemo(
    () => buildFlow({ txns, accounts, categories, groups, start: range.start, end: range.end, accountIds: acctOn, off, detail, pay, includeSetup }),
    [txns, accounts, categories, groups, range, acctOn, off, detail, pay, includeSetup],
  );

  // Draw at the width of the box, but never so narrow that labels collide (about 200px per column; it scrolls sideways on a phone).
  const box = useRef<HTMLDivElement>(null);
  const [boxW, setBoxW] = useState(800);
  useEffect(() => {
    if (!box.current) return;
    const ro = new ResizeObserver(([e]) => setBoxW(Math.floor(e.contentRect.width)));
    ro.observe(box.current);
    return () => ro.disconnect();
  }, []);
  const colCount = graph.nodes.length ? Math.max(...graph.nodes.map((n) => n.col)) + 1 : 3;
  const lay = useMemo(() => layoutFlow(graph, { width: Math.max(350 + (colCount - 1) * 200, boxW), padLeft: 150, padRight: 200, gap: 14 }), [graph, boxW, colCount]);
  const nodeById = new Map(lay.nodes.map((n) => [n.id, n]));
  // A lone node in a middle column (the Income or Take-home bar) is labelled above it, so its name is not drawn over the bands.
  const alone = (col: number) => col > 0 && col < lay.cols - 1 && lay.nodes.filter((x) => x.col === col).length === 1;

  const toggleKeys = (keys: string[], on: boolean) => setOff((cur) => { const n = new Set(cur); keys.forEach((k) => (on ? n.delete(k) : n.add(k))); return n; });
  const toggleAcct = (id: number, on: boolean) => setAcctOff((cur) => { const n = new Set(cur); if (on) n.delete(id); else n.add(id); return n; });
  const filtering = off.size > 0 || acctOn !== null;
  const share = (v: number) => (graph.income > 0 ? ` (${Math.round((v / graph.income) * 100)}% of ${graph.mode === 'gross' ? 'take-home' : 'income'})` : '');

  const readout = (() => {
    if (!sel) return 'Tap or hover a band or a bar to see its amount.';
    if (sel.kind === 'link') {
      const l = lay.links[Number(sel.id)];
      return l ? `${nodeById.get(l.source)?.label} → ${nodeById.get(l.target)?.label}: ${formatCents(l.value)}${share(l.value)}` : '';
    }
    const n = nodeById.get(sel.id);
    return n ? `${n.label}: ${formatCents(n.value)}${share(n.value)}` : '';
  })();

  const rows = flowRows(graph);
  const noPay = view === 'gross' && pay && pay.sources.length === 0;
  const inLabel = graph.mode === 'gross' ? 'Take-home pay' : 'Income';

  return (
    <>
      <p className="muted">
        How money moved through the period. Bands are as wide as the dollars. Credit card payments and moves to savings or investments are left out (card spending is already counted); loan, mortgage, and HELOC payments are included.
      </p>

      <div className="card">
        <FlowViews current={current} activeId={activeId} setActiveId={setActiveId} apply={applyView} />
        <div className="row" style={{ marginTop: 10 }}>
          <div className="seg" role="group" aria-label="Income shown">
            <button className={view === 'net' ? 'on' : ''} onClick={() => setView('net')}>Net (deposits)</button>
            <button className={view === 'gross' ? 'on' : ''} onClick={() => setView('gross')}>Gross (paycheck)</button>
          </div>
          <label className="row">Period
            <select value={preset} onChange={(e) => setPreset(e.target.value as RangePreset)}>{PRESETS.map((p) => <option key={p} value={p}>{RANGE_LABELS[p]}</option>)}</select>
          </label>
          {preset === 'custom' && (
            <>
              <label className="row">From <input type="date" value={cStart || range.start} max={today} onChange={(e) => setCStart(e.target.value)} /></label>
              <label className="row">To <input type="date" value={cEnd || range.end} max={today} onChange={(e) => setCEnd(e.target.value)} /></label>
            </>
          )}
          <div className="seg" role="group" aria-label="Detail">
            <button className={detail === 'groups' ? 'on' : ''} onClick={() => setDetail('groups')}>Groups</button>
            <button className={detail === 'categories' ? 'on' : ''} onClick={() => setDetail('categories')}>All categories</button>
          </div>
        </div>
        <div className="muted" style={{ marginTop: 6 }}>{rangeText(range)}.{view === 'gross' && ' Pay comes from your Income setup, not from deposits; spending comes from your accounts.'}</div>
      </div>

      <div className="tiles">
        <div className="tile"><div className="muted">{inLabel}</div><div className="v">{usd0(graph.income)}</div></div>
        <div className="tile"><div className="muted">Spending</div><div className="v">{usd0(graph.spending)}</div></div>
        <div className="tile"><div className="muted">{graph.left < 0 ? 'Drawn from savings' : graph.filtered ? 'Left over' : 'Saved'}</div><div className={`v ${graph.left < 0 ? 'neg' : ''}`}>{usd0(Math.abs(graph.left))}</div>{graph.income > 0 && graph.left > 0 && <div className="muted" style={{ fontSize: '0.8rem' }}>{Math.round((graph.left / graph.income) * 100)}% of {inLabel.toLowerCase()}</div>}</div>
      </div>
      {filtering && (
        <div className="row" role="status">
          <span className="warn">Some accounts or categories are switched off, so “left over” is not your true savings.</span>
          <button className="link" onClick={() => { setOff(new Set()); setAcctOff(new Set()); }}>show everything</button>
        </div>
      )}

      <div className="card viz" ref={box}>
        {noPay ? (
          <p className="muted">No pay is set up for this period. Add your salary on the <Link to="/income">Income</Link> page to see the gross view.</p>
        ) : graph.empty ? (
          <p className="muted">Nothing to show for this period{filtering ? ' with these switches' : ''}. Try a longer period.</p>
        ) : (
          <>
            <div className="scroll-x">
              <svg width={lay.width} height={lay.height} style={{ width: lay.width, height: lay.height, maxWidth: 'none' }} viewBox={`0 0 ${lay.width} ${lay.height}`} role="img" aria-label={`Flow of money, ${rangeText(range)}. Income ${usd0(graph.income)}, spending ${usd0(graph.spending)}. The table below lists every flow.`}>
                {lay.links.map((l, i) => (
                  <path key={i} d={l.path} fill="none" stroke={l.color} strokeWidth={Math.max(1, l.width)} strokeOpacity={sel?.kind === 'link' && sel.id === String(i) ? 0.7 : 0.35} style={{ cursor: 'pointer' }}
                    onClick={() => setSel({ kind: 'link', id: String(i) })} onMouseEnter={() => setSel({ kind: 'link', id: String(i) })}>
                    <title>{`${nodeById.get(l.source)?.label} → ${nodeById.get(l.target)?.label}: ${formatCents(l.value)}`}</title>
                  </path>
                ))}
                {lay.nodes.map((n) => (
                  <g key={n.id} style={{ cursor: 'pointer' }} onClick={() => setSel({ kind: 'node', id: n.id })} onMouseEnter={() => setSel({ kind: 'node', id: n.id })}>
                    <rect x={n.x} y={n.y} width={lay.nodeW} height={Math.max(1, n.h)} fill={n.color} rx={2}><title>{`${n.label}: ${formatCents(n.value)}`}</title></rect>
                    <text x={alone(n.col) ? n.x + lay.nodeW / 2 : n.col === 0 ? n.x - 6 : n.x + lay.nodeW + 6} y={alone(n.col) ? n.y - 8 : n.y + n.h / 2} dy={alone(n.col) ? undefined : '0.35em'} textAnchor={alone(n.col) ? 'middle' : n.col === 0 ? 'end' : 'start'} fontSize={12} fill="var(--fg)" stroke="var(--bg)" strokeWidth={3} paintOrder="stroke">
                      {n.label} <tspan fill="var(--muted)">{usd0(n.value)}</tspan>
                    </text>
                  </g>
                ))}
              </svg>
            </div>
            {lay.width > boxW + 4 && <div className="muted" style={{ fontSize: '0.85rem' }}>Swipe sideways to see the whole diagram.</div>}
            <div className="muted" aria-live="polite">{readout}</div>
          </>
        )}
      </div>

      <Collapsible id="flow.accounts" title={`Accounts${acctOn ? ` (${acctOn.size} of ${accounts.length})` : ''}`} defaultOpen={false}
        right={<span className="row"><button className="link" onClick={() => setAcctOff(new Set())}>all</button><button className="link" onClick={() => setAcctOff(new Set(accountIds))}>none</button></span>}>
        <p className="muted">Only spending and income in the accounts you leave on are counted. Loan principal counts when it is paid from one of them.</p>
        <div className="checks wrap">
          {accounts.map((a) => <label className="chk" key={a.id}><input type="checkbox" checked={acctOn ? acctOn.has(a.id!) : true} onChange={(e) => toggleAcct(a.id!, e.target.checked)} /> {a.name}{a.closed ? ' (closed)' : ''}</label>)}
        </div>
      </Collapsible>

      <Collapsible id="flow.cats" title={`Categories${off.size ? ` (${off.size} off)` : ''}`} defaultOpen={false}
        right={<span className="row"><button className="link" onClick={() => setOff(new Set())}>all on</button></span>}>
        <p className="muted">Switch a category or a whole group off to leave it out. Spending and “left over” update to match.</p>
        <label className="chk" style={{ marginBottom: 8 }}><input type="checkbox" checked={includeSetup} onChange={(e) => setIncludeSetup(e.target.checked)} /> Include “Initial setup” entries (balances you entered to get started; normally left out)</label>
        {view === 'net' && (
          <fieldset className="checks wrap" style={{ border: 'none', padding: 0, margin: '0 0 10px' }}>
            <legend><strong>Income</strong></legend>
            <Tri label="All income" checked={tree.income.every((i) => !off.has(i.key))} some={tree.income.some((i) => !off.has(i.key))} onChange={(on) => toggleKeys(tree.income.map((i) => i.key), on)} />
            {tree.income.map((i) => <label className="chk" key={i.key} style={{ marginLeft: 20 }}><input type="checkbox" checked={!off.has(i.key)} onChange={(e) => toggleKeys([i.key], e.target.checked)} /> {i.label}</label>)}
          </fieldset>
        )}
        {tree.groups.map((g) => (
          <fieldset key={g.id} className="checks wrap" style={{ border: 'none', padding: 0, margin: '0 0 10px' }}>
            <legend><strong>{g.label}</strong></legend>
            <Tri label={`All ${g.label.toLowerCase()}`} checked={g.items.every((i) => !off.has(i.key))} some={g.items.some((i) => !off.has(i.key))} onChange={(on) => toggleKeys(g.items.map((i) => i.key), on)} />
            {g.items.map((i) => <label className="chk" key={i.key} style={{ marginLeft: 20 }}><input type="checkbox" checked={!off.has(i.key)} onChange={(e) => toggleKeys([i.key], e.target.checked)} /> {i.label}</label>)}
          </fieldset>
        ))}
      </Collapsible>

      {!graph.empty && !noPay && (
        <details className="card">
          <summary>Show as table</summary>
          <div className="scroll-x">
            <table>
              <thead><tr><th>From</th><th>To</th><th className="num">Amount</th><th className="num">% of {inLabel.toLowerCase()}</th></tr></thead>
              <tbody>{rows.map((r, i) => <tr key={i}><td>{r.from}</td><td>{r.to}</td><td className="num">{formatCents(r.cents)}</td><td className="num">{Math.round(r.share * 100)}%</td></tr>)}</tbody>
            </table>
          </div>
        </details>
      )}
    </>
  );
}
