import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useSearchParams } from 'react-router-dom';
import { store } from '../../core/store';
import { dayLabel } from '../../core/time';
import WarrantyForm from './WarrantyForm';
import type { AssetRecord } from './model';
import { effectiveWarranties, warrantyStatus, WARRANTY_STATUS_LABEL, type EffectiveWarranty, type WarrantyRecord, type WarrantyStatus } from './warranty';
import { loadWarrantiesFor } from './warrantyData';

const day = (d: string) => dayLabel(d, { year: true });
const TONE: Record<WarrantyStatus, string> = { active: 'w-ok', soon: 'w-soon', expired: 'w-past', none: '' };

/**
 * Warranties on an asset page. Shows the stored warranty records; if there are none, the one older simple warranty from the asset's details
 * (marked as such). Retired assets show their warranties too, as history. Rows are folded; open one for the details.
 */
export default function WarrantyCard({ asset, today }: { asset: AssetRecord; today: string }) {
  const stored = useLiveQuery(() => loadWarrantiesFor(asset.id), [asset.id]);
  const contacts = useLiveQuery(() => store.shared.contacts.query(), []) ?? [];
  const [form, setForm] = useState<null | { kind: 'new' } | { kind: 'edit'; w: WarrantyRecord } | { kind: 'implicit'; w: EffectiveWarranty }>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [params, setParams] = useSearchParams();
  const focus = params.get('warranty');
  const focused = useRef<string | null>(null);
  const refs = useRef(new Map<string, HTMLLIElement>());
  const list = stored ? effectiveWarranties(asset.id, asset.data, stored) : [];
  const key = (w: EffectiveWarranty) => (w.id === null ? 'implicit' : `w${w.id}`);
  const focusKey = focus && /^\d+$/.test(focus) ? `w${focus}` : null;
  const focusFound = !!(focusKey && list.some((w) => key(w) === focusKey));

  useEffect(() => {
    if (!focusKey || !focusFound || focused.current === focusKey) return;
    focused.current = focusKey;
    setOpen((o) => new Set(o).add(focusKey));
    setTimeout(() => refs.current.get(focusKey)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 50);
  }, [focusKey, focusFound]);

  if (!stored) return null;
  const archived = asset.data.archived;
  const who = (id: number | null) => (id === null ? '' : contacts.find((c) => c.id === id)?.name ?? '(contact removed)');
  const toggle = (k: string) => setOpen((o) => { const n = new Set(o); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const hasOld = !!(asset.data.warrantyEndDate || asset.data.warrantyNote.trim());

  return (
    <section className="card as-card" aria-labelledby="as-war-h">
      <div className="as-card-head">
        <h2 id="as-war-h">Warranties</h2>
        <button className="btn" disabled={archived} title={archived ? 'This asset is archived. Restore it first.' : undefined} onClick={() => setForm({ kind: 'new' })}>Add warranty</button>
      </div>
      {focus && !focusFound && stored && <p className="as-note small" role="status">That warranty no longer exists. <button type="button" className="link" onClick={() => { const p = new URLSearchParams(params); p.delete('warranty'); setParams(p, { replace: true }); }}>Dismiss</button></p>}
      {list.length === 0 ? (
        <p className="muted">No warranty recorded. Use <strong>Add warranty</strong> for each coverage, such as the manufacturer&apos;s and an extended one.</p>
      ) : (
        <ul className="plain as-hist-list">
          {list.map((w) => {
            const k = key(w);
            const isOpen = open.has(k);
            const st = warrantyStatus(w.endDate, today);
            return (
              <li key={k} ref={(el) => { if (el) refs.current.set(k, el); else refs.current.delete(k); }} className={`as-hist${focusKey === k ? ' as-focus' : ''}`} id={w.id === null ? 'warranty-implicit' : `warranty-${w.id}`}>
                <button type="button" className="as-hist-toggle" aria-expanded={isOpen} onClick={() => toggle(k)}>
                  <strong>{w.title}</strong>
                  <span className={`as-chip ${TONE[st]}`}>{WARRANTY_STATUS_LABEL[st]}</span>
                  {w.endDate && <span className="small">Ends {day(w.endDate)}</span>}
                  {w.providerContactId !== null && <span className="muted small">{who(w.providerContactId)}</span>}
                  {w.implicit && <span className="muted small">From the asset&apos;s details</span>}
                </button>
                {isOpen && (
                  <div className="as-hist-detail">
                    <dl className="as-facts">
                      <div className="as-fact"><dt>Starts</dt><dd>{w.startDate ? day(w.startDate) : 'Not recorded'}</dd></div>
                      <div className="as-fact"><dt>Ends</dt><dd>{w.endDate ? day(w.endDate) : 'Not recorded'}</dd></div>
                      <div className="as-fact"><dt>Provided by</dt><dd>{w.providerContactId === null ? 'Not recorded' : who(w.providerContactId)}</dd></div>
                    </dl>
                    {w.coverageNotes && <p className="as-notes"><strong>Covers:</strong> {w.coverageNotes}</p>}
                    {w.claimInfo && <p className="as-notes"><strong>To claim:</strong> {w.claimInfo}</p>}
                    {w.refs.length > 0 && (
                      <ul className="plain as-items">
                        {w.refs.map((r, i) => <li key={i}>{r.url ? <a href={r.url} target="_blank" rel="noopener noreferrer">{r.label}</a> : <strong>{r.label}</strong>}{r.note && <span className="muted"> · {r.note}</span>}</li>)}
                      </ul>
                    )}
                    {w.implicit ? (
                      <>
                        <p className="muted small">This is the warranty date saved in the asset&apos;s details. Make it a warranty record to add the start date, provider and documents; the details are not changed.</p>
                        <button className="btn" disabled={archived} onClick={() => setForm({ kind: 'implicit', w })}>Make this a warranty record</button>
                      </>
                    ) : (
                      <button className="btn" onClick={() => { const rec = stored.find((x) => x.id === w.id); if (rec) setForm({ kind: 'edit', w: rec }); }}>Edit</button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {archived && <p className="muted small">This asset is archived, so warranties cannot be added until you restore it.</p>}
      {form?.kind === 'new' && <WarrantyForm asset={asset} onClose={() => setForm(null)} />}
      {form?.kind === 'implicit' && <WarrantyForm asset={asset} fromImplicit={form.w} onClose={() => setForm(null)} />}
      {form?.kind === 'edit' && <WarrantyForm asset={asset} warranty={form.w} lastWithOld={stored.length === 1 && hasOld} onClose={() => setForm(null)} />}
    </section>
  );
}
