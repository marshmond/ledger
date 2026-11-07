import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from '../../core/router';
import { EmptyState, PageHeader } from '../../ui/components';
import { useToday } from '../../ui/useToday';
import ObligationForm from './ObligationForm';
import { amountOf, day, StatusChip, useMoney } from './BillsParts';
import { loadObligations } from './data';
import { TYPE_LABEL, TYPES, type BillType } from './model';
import { obligationRoute, overviewRoute } from './paths';
import { describeSchedule } from './schedule';
import { buildRows, countByStatus, filterRows, providersOf, STATUS_FILTERS, type BillRow, type StatusFilter } from './views';

function RowLine({ r, money, today }: { r: BillRow; money: (c: number) => string; today: string }) {
  const d = r.ob.data;
  return (
    <li>
      <Link to={obligationRoute(r.ob.id)} className="bl-rowlink">
        <span className="bl-row-main">
          <strong>{d.title}</strong>
          <span className="small muted">{d.providerNameSnapshot || 'No provider'} · {amountOf(d, today, money)} · {describeSchedule(d.schedule)}</span>
          <span className="bl-rowtags"><span className="bl-chip">{TYPE_LABEL[d.type]}</span>{d.review.on && <span className="bl-chip">Review list</span>}</span>
        </span>
        <span className="bl-row-side small">
          {r.next[0] ? <span>Next expected {day(r.next[0].nominal)}</span> : d.status === 'active' ? <span className="muted">Nothing expected</span> : null}
          {d.status !== 'active' && <StatusChip d={d} />}
        </span>
      </Link>
    </li>
  );
}

/** All bills and subscriptions with Active / Paused / Ended / All, and provider and type filters. */
export default function ListPage() {
  const today = useToday();
  const { money } = useMoney();
  const obligations = useLiveQuery(() => loadObligations(), []);
  const [status, setStatus] = useState<StatusFilter>('active');
  const [type, setType] = useState<BillType | 'all'>('all');
  const [provider, setProvider] = useState<string>('all');
  const [adding, setAdding] = useState(false);
  if (!obligations) return <div className="bl"><PageHeader title="All bills" /><p className="muted">Loading…</p></div>;
  const rows = buildRows(obligations, today);
  const shown = filterRows(rows, { status, type, provider: provider === 'all' || provider === 'none' ? provider : Number(provider) });
  const providers = providersOf(obligations);
  return (
    <div className="bl">
      <p className="bl-back"><Link to={overviewRoute()}>← Bills & Subscriptions</Link></p>
      <PageHeader title="All bills and subscriptions" actions={<button className="btn primary" onClick={() => setAdding(true)}>Add</button>} />
      {rows.length === 0 ? (
        <EmptyState title="Nothing here yet" action={<button className="btn primary" onClick={() => setAdding(true)}>Add your first bill or subscription</button>}>Three questions are enough: what is it, how much, and how often.</EmptyState>
      ) : (
        <>
          <div className="bl-filters" role="group" aria-label="Filter bills">
            <fieldset className="bl-seg"><legend className="sr-only">Show</legend>
              {STATUS_FILTERS.map((f) => (
                <label key={f.id} className={status === f.id ? 'on' : ''}><input type="radio" name="bl-status" value={f.id} checked={status === f.id} onChange={() => setStatus(f.id)} /> {f.label} ({countByStatus(rows, f.id)})</label>
              ))}
            </fieldset>
            <label className="bl-periodpick">Type <select value={type} onChange={(e) => setType(e.target.value as BillType | 'all')}>
              <option value="all">All types</option>
              {TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
            </select></label>
            {providers.length > 0 && (
              <label className="bl-periodpick">Provider <select value={provider} onChange={(e) => setProvider(e.target.value)}>
                <option value="all">All providers</option>
                <option value="none">No provider</option>
                {providers.map((p) => <option key={p.contactId} value={String(p.contactId)}>{p.name}</option>)}
              </select></label>
            )}
          </div>
          <section className="card bl-card" aria-labelledby="bl-list-h">
            <h2 id="bl-list-h">{STATUS_FILTERS.find((f) => f.id === status)!.label} ({shown.length})</h2>
            {shown.length === 0 ? <p className="muted">Nothing matches these filters.</p> : <ul className="plain bl-list">{shown.map((r) => <RowLine key={r.ob.id} r={r} money={money} today={today} />)}</ul>}
          </section>
        </>
      )}
      {adding && <ObligationForm onClose={() => setAdding(false)} />}
    </div>
  );
}
