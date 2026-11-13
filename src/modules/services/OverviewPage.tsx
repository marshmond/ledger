import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from '../../core/router';
import { EmptyState, PageHeader } from '../../ui/components';
import { todayISO } from '../../lib/money';
import { useToday } from '../../ui/useToday';
import ArrangementForm from './ArrangementForm';
import { providerRoute } from './paths';
import { ArrangementCards, AttentionCard, ContractsCard, InsightsCard, SpendingCard, UpcomingCard, useMoney } from './OverviewParts';
import { loadServicesOverview } from './servicesOverview';
import { filterUpcomingByProvider, loadUpcomingDays, saveUpcomingDays, type UpcomingDays } from './upcomingWindow';
import VisitList from './VisitList';
import { LogVisitDialog, OneOffDialog } from './VisitDialogs';
import type { ArrangementRecord } from './model';

type StatusFilter = 'active' | 'paused' | 'ended' | 'all';
const FILTERS: { id: StatusFilter; label: string }[] = [{ id: 'active', label: 'Active' }, { id: 'paused', label: 'Paused' }, { id: 'ended', label: 'Ended' }, { id: 'all', label: 'All' }];

/**
 * Household Services landing page (S5, recomposed in D15): the upcoming visits and the arrangements on the left, what needs a look, the agreements, what was
 * logged and the providers on the right, and the spending and insights below. Every list, filter, window and action is the one the page had before; only
 * the arrangement of the page changed. Nothing is created or written to draw it.
 */
export default function OverviewPage() {
  const today = useToday() || todayISO();
  const { hide, money } = useMoney();
  const [period, setPeriod] = useState('last12');
  const [upcomingDays, setUpcomingDaysState] = useState<UpcomingDays>(() => loadUpcomingDays());
  const setUpcomingDays = (d: UpcomingDays) => { setUpcomingDaysState(d); saveUpcomingDays(d); };
  const [status, setStatus] = useState<StatusFilter>('active');
  const [provider, setProvider] = useState('all');
  const [adding, setAdding] = useState(false);
  const [oneOff, setOneOff] = useState(false);
  const [logging, setLogging] = useState<{ arrangementId: number; taskId: number } | null>(null);
  const ov = useLiveQuery(() => loadServicesOverview(period, today, undefined, money, upcomingDays), [period, today, hide, upcomingDays]);
  if (!ov) return <div className="sv"><PageHeader title="Household Services" eyebrow="Household" /><p className="muted">Loading…</p></div>;

  const rows = ov.base.rows;
  const byProvider = (a: ArrangementRecord) => provider === 'all' || String(a.data.providerContactId) === provider;
  const shown = rows.filter((r) => (status === 'all' || r.a.data.status === status) && byProvider(r.a));
  const upcoming = filterUpcomingByProvider(ov.upcoming, provider);
  const recent = ov.recent.filter((v) => provider === 'all' || String(v.v.data.providerContactId) === provider).slice(0, 10);
  const count = (s: StatusFilter) => (s === 'all' ? rows.length : rows.filter((r) => r.a.data.status === s).length);

  return (
    <div className="sv sv-ov">
      <PageHeader
        title="Household Services"
        eyebrow="Household"
        description="Who comes to the house, what is coming up, what needs a look, and what was recorded."
        actions={<><button className="btn" onClick={() => setOneOff(true)}>Log a one-off visit</button><button className="btn primary" onClick={() => setAdding(true)}>Add arrangement</button></>}
      />
      {rows.length === 0 ? (
        <EmptyState title="No services yet" action={<button className="btn primary" onClick={() => setAdding(true)}>Add your first arrangement</button>}>
          An arrangement is a standing service such as house cleaning, lawn mowing or a yearly furnace check. Only the provider and what they do are needed. If you choose how often, the next visit appears in Tasks and on the Calendar.
        </EmptyState>
      ) : (
        <>
          <AttentionCard items={ov.attention} onLog={(u) => setLogging({ arrangementId: u.arrangementId, taskId: u.task.id })} />

          <div className="sv-filters" role="group" aria-label="Filter arrangements, upcoming services and recent visits">
            <fieldset className="sv-seg"><legend className="sr-only">Show arrangements</legend>
              {FILTERS.map((f) => (
                <label key={f.id} className={status === f.id ? 'on' : ''}><input type="radio" name="sv-status" value={f.id} checked={status === f.id} onChange={() => setStatus(f.id)} /> {f.label} ({count(f.id)})</label>
              ))}
            </fieldset>
            {ov.providers.length > 1 && (
              <label className="sv-periodpick">Provider <select value={provider} onChange={(e) => setProvider(e.target.value)}>
                <option value="all">All providers</option>
                {ov.providers.map((p) => <option key={p.contactId} value={String(p.contactId)}>{p.name}</option>)}
              </select></label>
            )}
          </div>

          <div className="sv-layout">
            <div className="sv-col sv-col-main">
              <UpcomingCard rows={upcoming} total={ov.upcoming.length} days={upcomingDays} onDays={setUpcomingDays} today={today} />

              <section className="card sv-card" aria-labelledby="sv-act-h">
                <h2 id="sv-act-h">{FILTERS.find((f) => f.id === status)!.label} arrangements ({shown.length})</h2>
                <ArrangementCards rows={shown} today={today} money={money} empty={`None${status !== 'all' ? ` ${status}` : ''}${provider !== 'all' ? ' for this provider' : ''}.`} />
              </section>
            </div>

            <div className="sv-col sv-col-side">
              <ContractsCard today={today} rows={ov.contracts.filter((c) => provider === 'all' || String(rows.find((r) => r.a.id === c.arrangementId)?.a.data.providerContactId) === provider)} />

              <section className="card sv-card" aria-labelledby="sv-rec-h">
                <h2 id="sv-rec-h">Recent activity</h2>
                <p className="muted small">Visits that were logged: completed, skipped or cancelled. Scheduled visits that have not happened yet are under Upcoming services.</p>
                <VisitList rows={recent} empty="No visits logged yet." />
              </section>

              {ov.providers.length > 0 && (
                <section className="card sv-card" aria-labelledby="sv-prov-h">
                  <h2 id="sv-prov-h">Providers</h2>
                  <ul className="plain sv-items">
                    {ov.providers.map((p) => <li key={p.contactId}><Link to={providerRoute(p.contactId)}><strong>{p.name}</strong></Link><span className="muted small"> · {p.active} active{p.total > p.active ? `, ${p.total - p.active} past` : ''}</span></li>)}
                  </ul>
                </section>
              )}
            </div>
          </div>

          <div className="sv-below">
            <SpendingCard ov={ov} onPeriod={setPeriod} />
            <InsightsCard items={ov.insights} />
          </div>
        </>
      )}
      {adding && <ArrangementForm onClose={() => setAdding(false)} />}
      {oneOff && <OneOffDialog onClose={() => setOneOff(false)} />}
      {logging && <LogVisitDialog arrangementId={logging.arrangementId} taskId={logging.taskId} status="completed" onClose={() => setLogging(null)} />}
    </div>
  );
}
