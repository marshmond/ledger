import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useNavigate } from '../../core/router';
import { EmptyState, PageHeader } from '../../ui/components';
import { todayISO } from '../../lib/money';
import { useToday } from '../../ui/useToday';
import AssetForm from './AssetForm';
import { buildTree, loadAssets, whereIs, warrantyState } from './data';
import OrphanCard from './OrphanCard';
import { groupByAsset } from './warranty';
import { loadWarranties } from './warrantyData';
import { STATUS_LABEL, TYPE_LABEL, type AssetRecord } from './model';

type Tab = 'active' | 'stored' | 'past' | 'archived' | 'all';
const TABS: { id: Tab; label: string; show: (a: AssetRecord) => boolean }[] = [
  { id: 'active', label: 'In use', show: (a) => !a.data.archived && a.data.status === 'active' },
  { id: 'stored', label: 'Stored', show: (a) => !a.data.archived && a.data.status === 'stored' },
  { id: 'past', label: 'Past', show: (a) => !a.data.archived && ['sold', 'disposed', 'replaced'].includes(a.data.status) },
  { id: 'archived', label: 'Archived', show: (a) => a.data.archived },
  { id: 'all', label: 'All', show: () => true },
];
const EMPTY: Record<Tab, string> = {
  active: 'Nothing here yet. Start with your home: only a name is needed, and you can add details whenever you like.',
  stored: 'Nothing is in storage.',
  past: 'Nothing has been sold, disposed of or replaced.',
  archived: 'Nothing is archived.',
  all: 'No assets yet.',
};

/** "Sold 3 Nov 2026" / "Replaced by Dishwasher (new)" for a retired row; nothing for assets in use. */
const retiredLine = (a: AssetRecord, all: AssetRecord[]) => {
  if (a.data.status === 'active' || a.data.status === 'stored') return '';
  const by = a.data.replacedById !== null ? all.find((x) => x.id === a.data.replacedById) : undefined;
  return [a.data.statusDate ? `${STATUS_LABEL[a.data.status]} ${a.data.statusDate}` : '', by ? `replaced by ${by.data.name}` : ''].filter(Boolean).join(' · ');
};

/** The list: a tree grouped by where things are, or a flat list with the place written out. */
export default function AssetsPage() {
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const assets = useLiveQuery(() => loadAssets(), []);
  const today = useToday() || todayISO();
  const warranties = useLiveQuery(() => loadWarranties(), []);
  const warByAsset = useMemo(() => groupByAsset(warranties ?? []), [warranties]);
  const [pastKind, setPastKind] = useState('');
  const [tab, setTab] = useState<Tab>('active');
  const [type, setType] = useState('');
  const [text, setText] = useState('');
  const [flat, setFlat] = useState(false);
  const [folded, setFolded] = useState<Set<number>>(new Set());

  const creating = params.get('new') === '1';
  const parentParam = Number(params.get('parent'));
  const closeForm = () => setParams({}, { replace: true });

  const rows = useMemo(() => buildTree(assets ?? []), [assets]);
  const q = text.trim().toLowerCase();
  const filtering = !!q || !!type;
  const counts = useMemo(() => Object.fromEntries(TABS.map((t) => [t.id, (assets ?? []).filter(t.show).length])) as Record<Tab, number>, [assets]);
  const show = TABS.find((t) => t.id === tab)!.show;
  const hiddenByFold = (r: (typeof rows)[number]) => {
    if (flat || filtering) return false;
    // A row is hidden when any ancestor shown above it is folded.
    let cur = r.asset.data.parentId;
    const byId = new Map(rows.map((x) => [x.asset.id, x.asset]));
    for (let i = 0; i < 12 && cur !== null && cur !== undefined; i++) {
      if (folded.has(cur)) return true;
      cur = byId.get(cur)?.data.parentId ?? null;
    }
    return false;
  };
  const shown = rows.filter((r) => show(r.asset) && (tab !== 'past' || !pastKind || r.asset.data.status === pastKind) && (!type || r.asset.data.type === type) && (!q || r.asset.data.name.toLowerCase().includes(q) || r.asset.data.manufacturer.toLowerCase().includes(q) || r.asset.data.model.toLowerCase().includes(q)) && !hiddenByFold(r));
  const useFlat = flat || filtering;
  const hasKids = new Set((assets ?? []).map((a) => a.data.parentId).filter((x): x is number => x !== null));

  return (
    <div className="as">
      <PageHeader
        title="Home & Assets"
        description="What the household owns that needs looking after: the house, what is in it, and vehicles."
        actions={<button className="btn primary" onClick={() => setParams({ new: '1' })}>Add asset</button>}
      />
      <div className="as-tabs" role="tablist" aria-label="Show">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
            {t.label} <span className="count">{counts[t.id]}</span>
          </button>
        ))}
      </div>
      {tab === 'past' && (
        <div className="as-tabs as-subtabs" role="group" aria-label="Kind of past asset">
          {[['', 'All past'], ['sold', 'Sold'], ['disposed', 'Disposed of'], ['replaced', 'Replaced']].map(([k, label]) => (
            <button key={k} aria-pressed={pastKind === k} className={pastKind === k ? 'on' : ''} onClick={() => setPastKind(k)}>{label}</button>
          ))}
        </div>
      )}
      <div className="as-filters">
        <label className="f">Find<input value={text} onChange={(e) => setText(e.target.value)} placeholder="Name, make or model" type="search" /></label>
        <label className="f">Type
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">All types</option>
            {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="as-check"><input type="checkbox" checked={flat} onChange={(e) => setFlat(e.target.checked)} /> Flat list</label>
      </div>

      <OrphanCard />

      {assets === undefined ? (
        <p className="muted">Loading…</p>
      ) : shown.length === 0 ? (
        <EmptyState title={assets.length === 0 ? 'No assets yet' : 'Nothing here'} action={assets.length === 0 ? <button className="btn primary" onClick={() => setParams({ new: '1' })}>Add asset</button> : undefined}>
          {filtering ? 'Nothing matches that.' : EMPTY[tab]}
        </EmptyState>
      ) : (
        <ul className="plain as-list">
          {shown.map((r) => {
            const a = r.asset, w = warrantyState(a.data, today, warByAsset.get(a.id) ?? []), place = whereIs(assets, a.id);
            return (
              <li key={a.id} style={useFlat ? undefined : { paddingLeft: `${Math.min(r.depth, 6) * 20}px` }} className="as-li">
                {!useFlat && (hasKids.has(a.id)
                  ? <button className="btn icon as-fold" aria-expanded={!folded.has(a.id)} aria-label={`${folded.has(a.id) ? 'Show' : 'Hide'} what is inside ${a.data.name}`} onClick={() => setFolded((s) => { const n = new Set(s); n.has(a.id) ? n.delete(a.id) : n.add(a.id); return n; })}>{folded.has(a.id) ? '▸' : '▾'}</button>
                  : <span className="as-fold-gap" aria-hidden="true" />)}
                <Link to={`/${a.id}`} className="as-row">
                  <span className="as-row-main">
                    <strong>{a.data.name}</strong>
                    <span className="muted small">
                      {[useFlat ? place : '', retiredLine(a, assets), r.orphan ? '(place removed)' : '', r.cycle ? '(loop in places, fix on its page)' : ''].filter(Boolean).join(' · ') || TYPE_LABEL[a.data.type]}
                    </span>
                  </span>
                  <span className="as-row-side">
                    <span className="as-chip">{TYPE_LABEL[a.data.type]}</span>
                    {a.data.status !== 'active' && <span className="as-chip s-past">{STATUS_LABEL[a.data.status]}</span>}
                    {a.data.archived && <span className="as-chip s-past">Archived</span>}
                    {w && <span className={`as-chip w-${w.tone}`}>{w.label}</span>}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {creating && <AssetForm parentId={Number.isFinite(parentParam) && parentParam > 0 ? parentParam : null} onClose={closeForm} onSaved={(id) => nav(`/${id}`)} />}
    </div>
  );
}
