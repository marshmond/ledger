import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { dayLabel } from '../../core/time';
import { loadAssets, publicLabel } from '../assets/data';
import { duplicateHandoffs, handoffDivergence, handoffEligibility, handoffsOfVisit, visitsOfServiceRecord } from './handoff';
import { loadAssetServices } from './assetLinks';
import { HandoffChooser } from './S4Dialogs';
import type { VisitRecord } from './visitModel';

const day = (d: string) => dayLabel(d, { weekday: 'short', year: true });

/** On a visit page: the Home & Assets entries made from it, differences worth a look, and the button that starts a new handoff. */
export function VisitHandoffCard({ visit }: { visit: VisitRecord }) {
  const [open, setOpen] = useState(false);
  const data = useLiveQuery(async () => ({ handoffs: await handoffsOfVisit(visit.id), assets: await loadAssets() }), [visit.id, visit.updatedAt]);
  if (!data) return null;
  const elig = handoffEligibility(visit);
  const dups = duplicateHandoffs(data.handoffs);
  if (!elig.ok && data.handoffs.length === 0) {
    return visit.data.status === 'unsupported' ? null : (
      <section className="card sv-card" aria-labelledby="sv-ho-h"><h2 id="sv-ho-h">Home & Assets</h2><p className="muted small">{elig.reason}</p></section>
    );
  }
  return (
    <section className="card sv-card" aria-labelledby="sv-ho-h">
      <div className="sv-card-head"><h2 id="sv-ho-h">Home & Assets</h2>{elig.ok && <button type="button" className="btn" onClick={() => setOpen(true)}>Record maintenance in Home & Assets…</button>}</div>
      {data.handoffs.length === 0 ? <p className="muted small">Not recorded in an asset's maintenance history. You can do that when the visit was maintenance, an inspection or a repair of something you own. You review everything first, and nothing is saved until you press Save there.</p> : (
        <ul className="plain sv-items">
          {data.handoffs.map((h) => (
            <li key={h.linkId}>
              {h.service ? (
                <>
                  Recorded for <a href={`#/assets/${h.service.data.assetId}?service=${h.serviceId}`}><strong>{publicLabel(data.assets, h.service.data.assetId)}</strong></a>
                  <span className="muted small"> · {h.service.data.title}, {h.service.data.date ? day(h.service.data.date) : 'no date'}</span>
                  {handoffDivergence(visit, h.service).map((t, i) => <div key={i} className="small sv-warn" role="status">{t} Editing one side does not change the other. Check both if it matters.</div>)}
                </>
              ) : <span className="sv-warn">A Home & Assets entry made from this visit is not on this device (it may have been deleted, or has not synced yet).</span>}
            </li>
          ))}
        </ul>
      )}
      {dups.map((x) => (
        <p key={x.assetId} className="sv-warn" role="alert">
          <strong>This visit was recorded {x.serviceIds.length} times for {publicLabel(data.assets, x.assetId)}.</strong> This can happen when two devices both did it while offline. Nothing was merged or removed. If it was one piece of work, open the extra entry and delete it.{' '}
          {x.serviceIds.map((id, i) => <span key={id}>{i > 0 ? ', ' : ''}<a href={`#/assets/${x.assetId}?service=${id}`}>entry {i + 1}</a></span>)}
        </p>
      ))}
      <p className="muted small">The two records are not kept in step. Linking them lets Ledger recognize them as the same job later; it does not copy edits either way.</p>
      {open && <HandoffChooser visit={visit} onClose={() => setOpen(false)} />}
    </section>
  );
}

/** On a Home & Assets service entry: where it came from, and a review notice when the same visit was recorded twice. */
export function SourceVisitChip({ serviceId, assetId }: { serviceId: number; assetId: number }) {
  const data = useLiveQuery(async () => {
    const from = await visitsOfServiceRecord(serviceId);
    const dup = await Promise.all(from.map(async (f) => ({ visitId: f.visitId, dups: duplicateHandoffs(await handoffsOfVisit(f.visitId)).find((x) => x.assetId === assetId) })));
    return { from, dup };
  }, [serviceId, assetId]);
  if (!data || data.from.length === 0) return null;
  return (
    <>
      {data.from.map((f) => (
        <span key={f.visitId} className="as-chip">
          {f.visit ? <>From Household Services: <a href={`#/services/v/${f.visitId}`}>{f.visit.data.title}</a></> : 'From a Household Services visit that is not on this device'}
        </span>
      ))}
      {data.dup.some((x) => x.dups) && <span className="as-chip w-past">Possible duplicate: this visit was recorded more than once</span>}
    </>
  );
}

/** On an asset page: the Household Services arrangements that serve it. A pointer only; nothing is copied, and it is not maintenance history. */
export function AssetServicesCard({ assetId }: { assetId: number }) {
  const data = useLiveQuery(() => loadAssetServices(assetId), [assetId]);
  if (!data) return null;
  return (
    <section className="card as-card" aria-labelledby="as-svc-h">
      <h2 id="as-svc-h">Household services</h2>
      <p className="muted small">Regular services that look after this. A pointer to Household Services, not a record that work was done: completed visits are saved in the service history only when you record them there.</p>
      {data.rows.length === 0 ? <p className="muted">No standing service is linked.</p> : (
        <ul className="plain as-items">
          {data.rows.map((r) => (
            <li key={r.arrangementId}>
              <a href={`#/services/a/${r.arrangementId}`}><strong>{r.title}</strong></a>{' '}
              <span className={`as-chip${r.status !== 'active' ? ' s-past' : ''}`}>{r.statusLabel}</span>
              <div className="small muted">
                {r.providerName ? `${r.providerName}${r.contactGone ? ' (contact removed)' : ''} · ` : 'No provider yet · '}{r.cadence}
                {r.status === 'active' && (r.nextVisit ? ` · next visit ${day(r.nextVisit)}` : ' · nothing scheduled')}
              </div>
            </li>
          ))}
        </ul>
      )}
      {data.unavailable > 0 && <p className="muted small">{data.unavailable === 1 ? '1 linked service is' : `${data.unavailable} linked services are`} not on this device (deleted, or not synced yet).</p>}
    </section>
  );
}
