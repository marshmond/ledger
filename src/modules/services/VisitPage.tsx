import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from '../../core/router';
import { dayLabel } from '../../core/time';
import { EmptyState } from '../../ui/components';
import { DateTile } from '../../ui/DateTile';
import { StatusChip } from '../../ui/StatusChip';
import { todayISO as todayIso } from '../../lib/money';
import { VISIT_TONE } from './presentation';
import { formatCents } from '../../lib/money';
import { loadHideAmounts } from '../../core/hideAmounts';
import { loadAssets, publicLabel } from '../assets/data';
import { arrangementRoute, providerRoute, visitRoute } from './paths';
import { chargeWords, duplicateGroups, statusWords } from './visitModel';
import { loadSnapshot, visitRows } from './views';
import { visitAssetIds } from './visits';
import { VisitEditDialog } from './VisitDialogs';
import { usePayData, VisitPaymentCard } from './PaymentUI';
import { VisitHandoffCard } from './CrossModuleUI';
import ProjectLinks from './ProjectLinkCard';

const day = (d: string) => (d ? dayLabel(d, { weekday: 'short', year: true }) : 'Date unknown');
const REASON = {
  task: 'They came from the same task.', occurrence: 'They are for the same usual date.', 'same-day': 'They have the same arrangement, date and outcome.',
  lookalike: 'They have the same provider, title, date and outcome. They may be two real visits (a provider can come twice in a day), so this is only a notice.',
} as const;

/** One saved visit: what is written about it, where it came from, and any visit that looks like a duplicate of it. */
export default function VisitPage({ id }: { id: number }) {
  const snap = useLiveQuery(() => loadSnapshot(), []);
  const assetIds = useLiveQuery(() => visitAssetIds(id), [id]) ?? [];
  const assets = useLiveQuery(() => loadAssets(), []) ?? [];
  const [edit, setEdit] = useState(false);
  const pay = usePayData();
  if (!snap) return <div className="sv"><p className="muted">Loading…</p></div>;
  const v = snap.visits.find((x) => x.id === id);
  if (!v) return <div className="sv"><p className="sv-back"><Link to="/">← Household Services</Link></p><EmptyState title="That visit is not here">It may not have reached this device yet, or the address is wrong.</EmptyState></div>;
  const d = v.data;
  const row = visitRows(snap, [v])[0];
  const group = duplicateGroups(snap.visits).find((g) => g.visits.some((x) => x.id === id));
  const hide = loadHideAmounts();
  const money = (c: number) => (hide ? '$••••' : formatCents(c));
  const fee = chargeWords(d, money);
  return (
    <div className="sv">
      <p className="sv-back"><Link to={d.arrangementId !== null && row.arrangementTitle !== null ? arrangementRoute(d.arrangementId) : '/'}>← {row.arrangementTitle ?? 'Household Services'}</Link></p>
      <header className="card sv-hero">
        <div className="sv-hero-main">
          <div className="sv-hero-date">{d.date ? <DateTile iso={d.date} today={todayIso()} caption={d.status === 'completed' ? 'Visit' : undefined} /> : <span className="sv-hero-nodate"><span>Date unknown</span></span>}</div>
          <div className="sv-hero-text">
            <h1>{d.title}</h1>
            <p className="sv-chips"><StatusChip tone={VISIT_TONE[d.status]} icon={d.status === 'completed' ? undefined : false}>{statusWords(d)}</StatusChip><span className="sv-chip-text">{day(d.date)}</span></p>
          </div>
        </div>
        <div className="sv-head-actions"><button className="btn" onClick={() => setEdit(true)}>Edit</button></div>
      </header>
      {d.status === 'unsupported' && (
        <section className="card sv-card" aria-labelledby="sv-unsup-h" role="status">
          <h2 id="sv-unsup-h" className="sv-dup">⚠ Needs review: unsupported status</h2>
          <p>This visit was saved with an outcome this version does not understand ("{String(d.statusRaw)}"), perhaps by a newer version of Ledger. It is not counted as completed, skipped or cancelled, and it is kept exactly as found. Editing it keeps the outcome as it is unless you choose a real one.</p>
        </section>
      )}
      {group && (
        <section className="card sv-card" aria-labelledby="sv-dup-h" role="status">
          <h2 id="sv-dup-h" className="sv-dup">⚠ Possible duplicate visit</h2>
          <p>{REASON[group.reason]} Nothing has been merged or removed. Look at each one and decide.</p>
          <ul className="plain sv-items">
            {group.visits.map((x) => (
              <li key={x.id}>{x.id === id ? <strong>This one</strong> : <Link to={visitRoute(x.id)}>Open the other</Link>}: {day(x.data.date)}, {statusWords(x.data).toLowerCase()}, {x.data.title}</li>
            ))}
          </ul>
          <p className="muted small">There is no automatic fix. Edit a record if one of them is wrong, for example by changing its outcome to Skipped.</p>
        </section>
      )}
      <section className="card sv-card" aria-labelledby="sv-vd-h">
        <h2 id="sv-vd-h">Details</h2>
        <dl className="sv-facts">
          <div className="sv-fact"><dt>Provider at the time</dt><dd>{d.providerContactId !== null && !row.contactGone ? <Link to={providerRoute(d.providerContactId)}>{d.providerNameSnapshot}</Link> : <>{d.providerNameSnapshot || 'None'}{row.contactGone ? ' (contact removed)' : ''}</>}</dd></div>
          <div className="sv-fact"><dt>Arrangement</dt><dd>{d.arrangementId === null ? 'One-off job' : row.arrangementTitle !== null ? <Link to={arrangementRoute(d.arrangementId)}>{row.arrangementTitle}</Link> : 'Removed'}</dd></div>
          {d.endDate && <div className="sv-fact"><dt>Until</dt><dd>{day(d.endDate)}</dd></div>}
          {d.taskTitleSnapshot && <div className="sv-fact"><dt>Logged from the task</dt><dd>{d.taskTitleSnapshot}</dd></div>}
          {d.occurrence && <div className="sv-fact"><dt>Usual date it stood for</dt><dd>{day(d.occurrence)}</dd></div>}
          {fee && <div className="sv-fact"><dt>Charge</dt><dd>{fee}<div className="small muted">Information only. It is not a payment and not counted as money spent.</div></dd></div>}
        </dl>
        {d.status !== 'completed' && d.status !== 'unsupported' && <p className="muted small">This was not service delivered, so it does not count as the last time it was serviced.</p>}
        {assetIds.length > 0 && <p className="small">Concerned: {assetIds.map((a, i) => <span key={a}>{i ? ', ' : ''}{assets.some((x) => x.id === a) ? <a href={`#/assets/${a}`}>{publicLabel(assets, a)}</a> : 'an asset that no longer exists'}</span>)}</p>}
        {d.refs.length > 0 && <ul className="plain sv-items">{d.refs.map((r, i) => <li key={i}>{r.url ? <a href={r.url} target="_blank" rel="noopener noreferrer">{r.label}</a> : r.label}</li>)}</ul>}
        {d.notes && <p className="sv-notes">{d.notes}</p>}
      </section>
      {pay && v.data.status !== 'unsupported' && <VisitPaymentCard visit={v} data={pay} />}
      <VisitHandoffCard visit={v} />
      <ProjectLinks end={{ kind: 'visit', id: v.id }} />
      {edit && <VisitEditDialog visit={v} onClose={() => setEdit(false)} />}
    </div>
  );
}
