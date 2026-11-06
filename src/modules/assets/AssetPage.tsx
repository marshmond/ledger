import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from '../../core/router';
import { dayLabel } from '../../core/time';
import { store } from '../../core/store';
import { formatCents, todayISO } from '../../lib/money';
import { EmptyState } from '../../ui/components';
import { useToday } from '../../ui/useToday';
import { useToast } from '../../ui/Toast';
import AssetForm from './AssetForm';
import DeleteAsset from './DeleteAsset';
import LinkedWork from './LinkedWork';
import RetireDialog from './RetireDialog';
import SensitiveValue from './Sensitive';
import { archiveAsset, childrenOf, loadAssets, restoreAsset, warrantyState } from './data';
import { STATUS_LABEL, TYPE_LABEL } from './model';

const Fact = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="as-fact"><dt>{label}</dt><dd>{children}</dd></div>
);
const date = (d: string | null) => (d ? dayLabel(d, { year: true }) : '');

/** One asset: its details, what is inside it, who is behind it, and the tasks and events linked to it. */
export default function AssetPage() {
  const toast = useToast();
  const { id } = useParams();
  const aid = /^\d+$/.test(id ?? '') ? Number(id) : NaN;
  const all = useLiveQuery(() => loadAssets(), []);
  const contacts = useLiveQuery(() => store.shared.contacts.query(), []) ?? [];
  const today = useToday() || todayISO();
  const [editing, setEditing] = useState(false);
  const [retiring, setRetiring] = useState(false);
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
  const w = warrantyState(d, today);
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
      <nav aria-label="Where it is" className="as-crumbs small">
        {trail.map((a) => <span key={a.id}><Link to={`/${a.id}`}>{a.data.name}</Link> ›{' '}</span>)}
        {parentGone && <span className="muted">(place removed) › </span>}
      </nav>
      <div className="as-head">
        <div>
          <h1>{d.name}</h1>
          <p className="as-chips">
            <span className="as-chip">{TYPE_LABEL[d.type]}</span>
            {d.status !== 'active' && <span className="as-chip s-past">{STATUS_LABEL[d.status]}{d.statusDate ? ` ${date(d.statusDate)}` : ''}</span>}
            {d.archived && <span className="as-chip s-past">Archived</span>}
            {w && <span className={`as-chip w-${w.tone}`}>{w.label}</span>}
          </p>
        </div>
        <div className="as-head-actions">
          <button className="btn" onClick={() => setEditing(true)}>Edit</button>
          <button className="btn" onClick={() => setRetiring(true)}>Status…</button>
          <button className="btn" onClick={() => void toggleArchive()}>{d.archived ? 'Restore' : 'Archive'}</button>
          <button className="btn danger" onClick={() => setDeleting(true)}>Delete…</button>
        </div>
      </div>

      {(d.statusNote || replacedBy || replaces.length > 0) && (
        <section className="card as-card">
          {d.statusNote && <p>{d.statusNote}</p>}
          {replacedBy && <p>Replaced by <Link to={`/${replacedBy.id}`}>{replacedBy.data.name}</Link>.</p>}
          {replaces.length > 0 && <p>Replaces {replaces.map((r, i) => <span key={r.id}>{i > 0 ? ', ' : ''}<Link to={`/${r.id}`}>{r.data.name}</Link></span>)}.</p>}
        </section>
      )}

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
          {d.purchaseCents !== null && <Fact label="Price paid">{formatCents(d.purchaseCents)}</Fact>}
          {d.warrantyEndDate && <Fact label="Warranty ends">{date(d.warrantyEndDate)}{d.warrantyNote ? ` · ${d.warrantyNote}` : ''}</Fact>}
        </dl>
        {!d.manufacturer && !d.model && !d.serialNumber && !d.purchaseDate && !d.installDate && d.purchaseCents === null && !d.warrantyEndDate && !d.address && !d.plate && (
          <p className="muted">Only the name is filled in. Use Edit to add the make, dates, warranty and more, whenever you like.</p>
        )}
        {d.specs.length > 0 && (
          <dl className="as-facts as-specs">{d.specs.map((s, i) => <Fact key={i} label={s.label}>{s.value}</Fact>)}</dl>
        )}
        {d.notes && <p className="as-notes">{d.notes}</p>}
      </section>

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

      <LinkedWork assetId={asset.id} />

      {editing && <AssetForm asset={asset} onClose={() => setEditing(false)} />}
      {adding && <AssetForm parentId={asset.id} onClose={() => setAdding(false)} onSaved={(nid) => { window.location.hash = `#/assets/${nid}`; }} />}
      {retiring && <RetireDialog asset={asset} onClose={() => setRetiring(false)} />}
      {deleting && <DeleteAsset assetId={asset.id} onClose={() => setDeleting(false)} />}
    </div>
  );
}
