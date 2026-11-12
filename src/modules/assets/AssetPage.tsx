import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from '../../core/router';
import { dayLabel } from '../../core/time';
import { store } from '../../core/store';
import { formatCents, todayISO } from '../../lib/money';
import { EmptyState } from '../../ui/components';
import { DateTile } from '../../ui/DateTile';
import { StatusChip } from '../../ui/StatusChip';
import { useToday } from '../../ui/useToday';
import { useToast } from '../../ui/Toast';
import AssetForm from './AssetForm';
import AssetWork from './AssetWork';
import DeleteAsset from './DeleteAsset';
import LinkedWork from './LinkedWork';
import NetWorthEntry from './NetWorthEntry';
import RelatedProjects from './RelatedProjects';
import { AssetServicesCard } from '../services/CrossModuleUI';
import SpendingCard from './SpendingCard';
import LifecycleDialog from './LifecycleDialog';
import WarrantyCard from './WarrantyCard';
import { loadWarrantiesFor } from './warrantyData';
import SensitiveValue from './Sensitive';
import { archiveAsset, childrenOf, loadAssets, restoreAsset, warrantyState } from './data';
import { STATUS_LABEL, TYPE_LABEL } from './model';
import { WARRANTY_TONE } from './presentation';

const Fact = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="as-fact"><dt>{label}</dt><dd>{children}</dd></div>
);
const date = (d: string | null) => (d ? dayLabel(d, { year: true }) : '');
const jump = (anchor: string) => document.getElementById(anchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

/**
 * One asset: a hero (name, type, status, warranty, key dates, actions), then two columns. The left column is the asset itself (details, maintenance and
 * service history, spending); the right column is what surrounds it (warranty, contacts, documents, what is inside it, related projects and work).
 * One column on a phone, with a "On this page" row to jump between the parts. D14 changed the arrangement only; every card, field and action is the
 * one that was here before.
 */
export default function AssetPage() {
  const toast = useToast();
  const { id } = useParams();
  const aid = /^\d+$/.test(id ?? '') ? Number(id) : NaN;
  const all = useLiveQuery(() => loadAssets(), []);
  const contacts = useLiveQuery(() => store.shared.contacts.query(), []) ?? [];
  const today = useToday() || todayISO();
  const [editing, setEditing] = useState(false);
  const [retiring, setRetiring] = useState<false | 'status' | 'replace'>(false);
  const warranties = useLiveQuery(() => (Number.isNaN(aid) ? Promise.resolve([]) : loadWarrantiesFor(aid)), [aid]) ?? [];
  const [deleting, setDeleting] = useState(false);
  const [adding, setAdding] = useState(false);

  if (all === undefined) return <p className="muted">Loading…</p>;
  const asset = all.find((a) => a.id === aid);
  if (!asset) {
    return (
      <div className="as">
        <EmptyState title="That asset no longer exists" action={<Link to="/" className="btn">Back to Home & Assets</Link>}>It may have been deleted on another device.</EmptyState>
      </div>
    );
  }
  const d = asset.data;
  const byId = new Map(all.map((a) => [a.id, a]));
  const trail: typeof all = [];
  for (let cur = d.parentId === null ? undefined : byId.get(d.parentId); cur && trail.length < 12 && !trail.includes(cur) && cur.id !== asset.id; cur = cur.data.parentId === null ? undefined : byId.get(cur.data.parentId)) trail.unshift(cur);
  const parentGone = d.parentId !== null && !byId.has(d.parentId);
  const kids = childrenOf(all, asset.id).sort((a, b) => a.data.name.localeCompare(b.data.name));
  const w = warrantyState(d, today, warranties);
  const leftUse = d.status === 'sold' || d.status === 'disposed' || d.status === 'replaced';
  const replacedBy = d.replacedById !== null ? byId.get(d.replacedById) : undefined;
  const replaces = all.filter((a) => a.data.replacedById === asset.id);

  async function toggleArchive() {
    try {
      if (d.archived) { await restoreAsset(asset!.id); toast('Restored'); } else { await archiveAsset(asset!.id); toast('Archived. Restore it any time from the Archived tab.'); }
    } catch (e) { toast(e instanceof Error ? e.message : 'Could not change that.'); }
  }

  return (
    <div className="as">
      <p className="as-back"><Link to="/">← Home & Assets</Link></p>
      <header className="card as-hero">
        <div className="as-hero-main">
          {(d.purchaseDate || d.installDate) && (
            <div className="as-hero-dates">
              {d.purchaseDate && <DateTile iso={d.purchaseDate} today={today} caption="Bought" />}
              {d.installDate && <DateTile iso={d.installDate} today={today} caption="In use" />}
            </div>
          )}
          <div className="as-hero-text">
            <nav aria-label="Where it is" className="as-crumbs small">
              {trail.map((a) => <span key={a.id}><Link to={`/${a.id}`}>{a.data.name}</Link> ›{' '}</span>)}
              {parentGone && <span className="muted">(place removed) › </span>}
            </nav>
            <h1>{d.name}</h1>
            <p className="as-chips">
              <StatusChip icon={false}>{TYPE_LABEL[d.type]}</StatusChip>
              {d.status !== 'active' && <StatusChip tone="warning">{STATUS_LABEL[d.status]}{d.statusDate ? ` ${date(d.statusDate)}` : ''}</StatusChip>}
              {d.archived && <StatusChip>Archived</StatusChip>}
              {w && <StatusChip tone={WARRANTY_TONE[w.tone]}>{w.label}</StatusChip>}
              {(d.manufacturer || d.model) && <span className="muted small">{[d.manufacturer, d.model].filter(Boolean).join(' ')}</span>}
            </p>
          </div>
        </div>
        <div className="as-head-actions">
          <button className="btn" onClick={() => setEditing(true)}>Edit</button>
          <button className="btn" onClick={() => setRetiring('status')}>Status…</button>
          {d.status !== 'replaced' && <button className="btn" onClick={() => setRetiring('replace')}>Replace…</button>}
          <button className="btn" onClick={() => void toggleArchive()}>{d.archived ? 'Restore' : 'Archive'}</button>
          <button className="btn danger" onClick={() => setDeleting(true)}>Delete…</button>
        </div>
      </header>

      {(leftUse || d.status === 'stored' || d.statusNote || replacedBy || replaces.length > 0) && (
        <section className="card as-card as-lifecycle" aria-label="Lifecycle">
          {leftUse && <p><strong>No longer in use:</strong> {STATUS_LABEL[d.status]}{d.statusDate ? ` on ${date(d.statusDate)}` : ''}. Its service history, warranties, spending and related projects are kept below.</p>}
          {d.status === 'stored' && <p><strong>In storage</strong>{d.statusDate ? ` since ${date(d.statusDate)}` : ''}.</p>}
          {d.statusNote && <p>{d.statusNote}</p>}
          {d.status === 'replaced' && d.replacedById !== null && !replacedBy && <p className="muted">Its replacement is not on this device (it may arrive when your devices sync, or it was deleted).</p>}
          {replacedBy && <p>Replaced by <Link to={`/${replacedBy.id}`}>{replacedBy.data.name}</Link>.</p>}
          {replaces.length > 0 && <p>Replaces {replaces.map((r, i) => <span key={r.id}>{i > 0 ? ', ' : ''}<Link to={`/${r.id}`}>{r.data.name}</Link></span>)}.</p>}
        </section>
      )}

      <nav className="ui-seg as-jump" aria-label="On this page">
        <button type="button" onClick={() => jump('as-main-col')}>Details</button>
        <button type="button" onClick={() => jump('as-work')}>Maintenance and history</button>
        <button type="button" onClick={() => jump('as-warranty')}>Warranty</button>
        <button type="button" onClick={() => jump('as-spending')}>Spending</button>
        <button type="button" onClick={() => jump('as-related')}>Related</button>
      </nav>

      <div className="as-layout">
        <div className="as-col as-col-main" id="as-main-col">
          <section className="card as-card" aria-labelledby="as-details-h">
            <h2 id="as-details-h">Details</h2>
            <dl className="as-facts">
              {d.manufacturer && <Fact label="Make">{d.manufacturer}</Fact>}
              {d.model && <Fact label="Model">{d.model}</Fact>}
              <SensitiveValue label={d.type === 'vehicle' ? 'VIN' : 'Serial number'} value={d.serialNumber} />
              {d.type === 'vehicle' && <SensitiveValue label="Plate" value={d.plate} />}
              {d.type === 'property' && <SensitiveValue label="Address" value={d.address} />}
              {d.purchaseDate && <Fact label="Bought">{date(d.purchaseDate)}</Fact>}
              {d.installDate && <Fact label="In use since">{date(d.installDate)}</Fact>}
              {d.purchaseCents !== null && <Fact label="Price paid">{formatCents(d.purchaseCents)} <span className="muted small">typed</span></Fact>}
              {d.purchaseTxnRefs.length > 0 && <Fact label="Price paid"><span className="muted small">from Finance, see Spending below</span></Fact>}
            </dl>
            {!d.manufacturer && !d.model && !d.serialNumber && !d.purchaseDate && !d.installDate && d.purchaseCents === null && d.purchaseTxnRefs.length === 0 && !d.address && !d.plate && (
              <p className="muted">Only the name is filled in. Use Edit to add the make, dates, warranty and more, whenever you like.</p>
            )}
            {d.specs.length > 0 && (
              <dl className="as-facts as-specs">{d.specs.map((s, i) => <Fact key={i} label={s.label}>{s.value}</Fact>)}</dl>
            )}
            {d.ledgerPropertyId !== null && <NetWorthEntry propertyId={d.ledgerPropertyId} />}
            {d.notes && <p className="as-notes">{d.notes}</p>}
          </section>

          <div id="as-work" className="as-stack"><AssetWork asset={asset} today={today} /></div>
          <AssetServicesCard assetId={asset.id} />
          <div id="as-spending" className="as-stack"><SpendingCard asset={asset} onEdit={() => setEditing(true)} /></div>
        </div>

        <div className="as-col as-col-side">
          <div id="as-warranty" className="as-stack"><WarrantyCard asset={asset} today={today} /></div>

          {d.contacts.length > 0 && (
            <section className="card as-card" aria-labelledby="as-contacts-h">
              <h2 id="as-contacts-h">Contacts</h2>
              <ul className="plain as-items">
                {d.contacts.map((c, i) => {
                  const k = contacts.find((x) => x.id === c.contactId);
                  return (
                    <li key={i}>
                      <strong>{k ? k.name : '(contact removed)'}</strong>{c.role && <span className="muted"> · {c.role}</span>}
                      {k?.phone && <> · <a href={`tel:${k.phone.replace(/[^\d+]/g, '')}`}>{k.phone}</a></>}
                      {k?.email && <> · <a href={`mailto:${k.email}`}>{k.email}</a></>}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {d.refs.length > 0 && (
            <section className="card as-card" aria-labelledby="as-docs-h">
              <h2 id="as-docs-h">Documents</h2>
              <ul className="plain as-items">
                {d.refs.map((r, i) => (
                  <li key={i}>
                    {r.url ? <a href={r.url} target="_blank" rel="noopener noreferrer">{r.label}</a> : <strong>{r.label}</strong>}
                    {r.note && <span className="muted"> · {r.note}</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <div id="as-related" className="as-stack">
            <section className="card as-card" aria-labelledby="as-inside-h">
              <div className="as-card-head">
                <h2 id="as-inside-h">Inside this</h2>
                <button className="btn" onClick={() => setAdding(true)}>Add inside</button>
              </div>
              {kids.length === 0 ? <p className="muted">Nothing is inside it yet.</p> : (
                <ul className="plain as-items">
                  {kids.map((k) => <li key={k.id}><Link to={`/${k.id}`}>{k.data.name}</Link> <span className="muted small">{TYPE_LABEL[k.data.type]}{k.data.status !== 'active' ? ` · ${STATUS_LABEL[k.data.status]}` : ''}{k.data.archived ? ' · Archived' : ''}</span></li>)}
                </ul>
              )}
            </section>
            <RelatedProjects asset={asset} />
            <LinkedWork assetId={asset.id} />
          </div>
        </div>
      </div>

      {editing && <AssetForm asset={asset} onClose={() => setEditing(false)} />}
      {adding && <AssetForm parentId={asset.id} onClose={() => setAdding(false)} onSaved={(nid) => { window.location.hash = `#/assets/${nid}`; }} />}
      {retiring && <LifecycleDialog asset={asset} replace={retiring === 'replace'} onClose={() => setRetiring(false)} />}
      {deleting && <DeleteAsset assetId={asset.id} onClose={() => setDeleting(false)} />}
    </div>
  );
}
