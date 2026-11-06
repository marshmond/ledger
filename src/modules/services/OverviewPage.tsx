import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from '../../core/router';
import { dayLabel } from '../../core/time';
import { EmptyState, PageHeader } from '../../ui/components';
import { todayISO } from '../../lib/money';
import { useToday } from '../../ui/useToday';
import ArrangementForm from './ArrangementForm';
import { cadenceText } from './model';
import { arrangementRoute, providerRoute, visitRoute } from './paths';
import VisitList from './VisitList';
import { LogVisitDialog, OneOffDialog } from './VisitDialogs';
import { statusWords } from './visitModel';
import { buildOverview, loadSnapshot, providerList, type Row } from './views';

const day = (d: string) => dayLabel(d, { weekday: 'short', year: true });

function RowLine({ r, today }: { r: Row; today: string }) {
  const d = r.a.data;
  return (
    <li>
      <Link to={arrangementRoute(r.a.id)} className="sv-rowlink">
        <span className="sv-row-main">
          <strong>{d.title}</strong>
          <span className="small muted">{d.providerNameSnapshot || 'No provider yet'} · {cadenceText(d.cadence)}</span>
        </span>
        <span className="sv-row-side small">
          {r.nextDate ? <span className={r.nextDate < today ? 'sv-late' : ''}>{r.nextDate < today ? 'Overdue ' : 'Next '}{day(r.nextDate)}</span> : d.status === 'active' ? <span className="muted">Nothing scheduled</span> : null}
          {d.status !== 'active' && <span className={`sv-chip s-${d.status}`}>{d.status === 'paused' ? 'Paused' : 'Ended'}</span>}
        </span>
      </Link>
    </li>
  );
}

/** Household Services landing page: what needs attention, what is coming up, and every arrangement. */
export default function OverviewPage() {
  const today = useToday() || todayISO();
  const snap = useLiveQuery(() => loadSnapshot(), []);
  const [adding, setAdding] = useState(false);
  const [oneOff, setOneOff] = useState(false);
  const [logging, setLogging] = useState<{ arrangementId: number; taskId: number } | null>(null);
  if (!snap) return <div className="sv"><PageHeader title="Household Services" /><p className="muted">Loading…</p></div>;
  const ov = buildOverview(snap);
  const providers = providerList(snap);

  return (
    <div className="sv">
      <PageHeader
        title="Household Services"
        description="Who comes to the house, how often, and when they are next due."
        actions={<><button className="btn" onClick={() => setOneOff(true)}>Log a one-off visit</button><button className="btn primary" onClick={() => setAdding(true)}>Add arrangement</button></>}
      />
      {ov.rows.length === 0 ? (
        <EmptyState title="No services yet" action={<button className="btn primary" onClick={() => setAdding(true)}>Add your first arrangement</button>}>
          An arrangement is a standing service such as house cleaning, lawn mowing or a yearly furnace check. Only the provider and what they do are needed. If you choose how often, the next visit appears in Tasks and on the Calendar.
        </EmptyState>
      ) : (
        <>
          <section className="card sv-card" aria-labelledby="sv-att-h">
            <h2 id="sv-att-h">Needs attention</h2>
            {ov.attention.length === 0 ? <p className="sv-ok" role="status">✓ Nothing needs attention right now.</p> : (
              <ul className="plain sv-items">
                {ov.attention.map((x) => (
                  <li key={x.key}><span aria-hidden="true">⚠ </span><Link to={arrangementRoute(x.arrangementId)}><strong>{x.text}</strong></Link><span className="muted small"> · {x.hint}</span></li>
                ))}
              </ul>
            )}
          </section>

          {ov.unlogged.length > 0 && (
            <section className="card sv-card" aria-labelledby="sv-unl-h">
              <h2 id="sv-unl-h">Finished, not yet logged ({ov.unlogged.length})</h2>
              <p className="muted small">These visit tasks were finished in Tasks or the Calendar, but no visit was saved. Nothing is saved until you choose.</p>
              <ul className="plain sv-items">
                {ov.unlogged.map((u) => {
                  const a = ov.rows.find((r) => r.a.id === u.arrangementId)?.a;
                  return (
                    <li key={u.task.id}>
                      <Link to={arrangementRoute(u.arrangementId)}><strong>{a?.data.title ?? u.task.data.title}</strong></Link>
                      <span className="muted small"> · finished {u.finishedOn ? day(u.finishedOn) : 'on an unknown day'}</span>
                      <div className="sv-actionrow"><button className="btn" onClick={() => setLogging({ arrangementId: u.arrangementId, taskId: u.task.id })}>Log this visit…</button></div>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {ov.needsReview.length > 0 && (
            <section className="card sv-card" aria-labelledby="sv-rev-h">
              <h2 id="sv-rev-h" className="sv-dup">⚠ Visits needing review ({ov.needsReview.length})</h2>
              <p className="muted small">These visits have a status this version does not understand. They count as nothing and are kept exactly as found.</p>
              <ul className="plain sv-items">{ov.needsReview.map((v) => <li key={v.id}><Link to={visitRoute(v.id)}>{day(v.data.date)}, {v.data.title}</Link></li>)}</ul>
            </section>
          )}

          {ov.duplicates.length > 0 && (
            <section className="card sv-card" aria-labelledby="sv-dup-h">
              <h2 id="sv-dup-h" className="sv-dup">⚠ Possible duplicate visits ({ov.duplicates.length})</h2>
              <p className="muted small">The same visit may have been logged twice, for example on two devices. Nothing was merged or removed. Open each one to look.</p>
              <ul className="plain sv-items">
                {ov.duplicates.map((g) => (
                  <li key={g.key}>
                    {g.visits.map((v, i) => <span key={v.id}>{i ? ' and ' : ''}<Link to={visitRoute(v.id)}>{day(v.data.date)}, {statusWords(v.data).toLowerCase()}</Link></span>)}
                    <span className="muted small"> · {g.visits[0].data.title}{g.reason === 'lookalike' ? ' (may be two real visits)' : ''}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="card sv-card" aria-labelledby="sv-up-h">
            <h2 id="sv-up-h">Upcoming visits</h2>
            {ov.upcoming.length === 0 ? <p className="muted">No visit is scheduled. Open an arrangement to schedule one.</p> : (
              <ul className="plain sv-items">
                {ov.upcoming.slice(0, 8).map((r) => (
                  <li key={r.a.id}>
                    <a href={`#/tasks?task=${r.open!.id}`}><strong>{day(r.nextDate!)}{r.open!.data.dueTime ? ` at ${r.open!.data.dueTime}` : ''}</strong></a>
                    {r.nextDate! < today && <span className="sv-late"> · overdue</span>}
                    <div className="small"><Link to={arrangementRoute(r.a.id)}>{r.a.data.title}</Link>{r.a.data.providerNameSnapshot && <span className="muted"> · {r.a.data.providerNameSnapshot}</span>}</div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card sv-card" aria-labelledby="sv-act-h">
            <h2 id="sv-act-h">Active arrangements ({ov.active.length})</h2>
            {ov.active.length === 0 ? <p className="muted">None active.</p> : <ul className="plain sv-list">{ov.active.map((r) => <RowLine key={r.a.id} r={r} today={today} />)}</ul>}
          </section>

          {(ov.paused.length > 0 || ov.ended.length > 0) && (
            <section className="card sv-card" aria-labelledby="sv-past-h">
              <h2 id="sv-past-h">Paused and ended</h2>
              <ul className="plain sv-list">{[...ov.paused, ...ov.ended].map((r) => <RowLine key={r.a.id} r={r} today={today} />)}</ul>
            </section>
          )}

          <section className="card sv-card" aria-labelledby="sv-rec-h">
            <h2 id="sv-rec-h">Recent visits</h2>
            <VisitList rows={ov.recent} empty="No visits logged yet." />
          </section>

          {providers.length > 0 && (
            <section className="card sv-card" aria-labelledby="sv-prov-h">
              <h2 id="sv-prov-h">Providers</h2>
              <ul className="plain sv-items">
                {providers.map((p) => <li key={p.contactId}><Link to={providerRoute(p.contactId)}><strong>{p.name}</strong></Link><span className="muted small"> · {p.active} active{p.total > p.active ? `, ${p.total - p.active} past` : ''}</span></li>)}
              </ul>
            </section>
          )}
        </>
      )}
      {adding && <ArrangementForm onClose={() => setAdding(false)} />}
      {oneOff && <OneOffDialog onClose={() => setOneOff(false)} />}
      {logging && <LogVisitDialog arrangementId={logging.arrangementId} taskId={logging.taskId} status="completed" onClose={() => setLogging(null)} />}
    </div>
  );
}
