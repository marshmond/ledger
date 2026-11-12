import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from '../../core/router';
import { store } from '../../core/store';
import { dayLabel } from '../../core/time';
import { EmptyState, PageHeader } from '../../ui/components';
import { DateTile } from '../../ui/DateTile';
import { Figure } from '../../ui/Figure';
import { StatusChip } from '../../ui/StatusChip';
import { formatCents, todayISO } from '../../lib/money';
import { useToday } from '../../ui/useToday';
import { loadAssets } from './data';
import { attentionRows } from './overviewText';
import { loadOverview } from './overviewData';
import { isYear, type Overview } from './overview';
import { topLevelPlaces } from './presentation';
import { SERVICE_KIND_LABEL } from './service';
import { GROUP_LABEL, type CostGroup } from './spending';
import { SOON_DAYS } from './warranty';
import { TYPE_LABEL } from './model';

/** Written as constants (not inline) because the address check in core.test.ts reads inline addresses as Ledger pages. */
const LIST = '/list';
const LIST_NEW = '/list?new=1';
const day = (d: string) => dayLabel(d, { year: true });
const GROUPS: CostGroup[] = ['acquisition', 'maintenance', 'other'];

/** "Dishwasher" or "Dishwasher +2 more" for a task linked to several assets. The name only, never a serial number or address. */
const assetNames = (names: Map<number, string>, ids: number[]) => {
  const first = names.get(ids[0]) ?? '(asset removed)';
  return ids.length > 1 ? `${first} +${ids.length - 1} more` : first;
};

/**
 * The landing view of Home & Assets: a band of counts, then what needs attention, what maintenance is coming, which warranties end soon, what was done
 * lately and what was spent, beside a list of the places and top-level assets. Every number is read from the same records the asset pages use
 * (`overviewData.ts`); nothing is stored here, and the counts in the band are the lengths of the lists below it.
 */
export default function OverviewPage() {
  const today = useToday() || todayISO();
  const [period, setPeriod] = useState<string>('');
  const year = period || today.slice(0, 4);
  const ov = useLiveQuery(() => loadOverview(year, today), [year, today]);
  const assets = useLiveQuery(() => loadAssets(), []);
  const contacts = useLiveQuery(() => store.shared.contacts.query(), []) ?? [];

  if (!ov || !assets) return <div className="as"><PageHeader title="Home & Assets" /><p className="muted">Loading…</p></div>;
  const names = new Map(assets.map((a) => [a.id, a.data.name]));
  const rows = attentionRows(ov.attention);
  const places = topLevelPlaces(assets);
  const contact = (id: number | null) => (id === null ? '' : contacts.find((c) => c.id === id)?.name ?? '');

  return (
    <div className="as as-ov">
      <PageHeader
        title="Home & Assets"
        description="What the household owns that needs looking after: the house, what is in it, and vehicles."
        actions={<><Link to={LIST} className="btn">All assets</Link><Link to={LIST_NEW} className="btn primary">Add asset</Link></>}
      />

      {ov.counts.total === 0 ? (
        <EmptyState title="Start with your home" action={<Link to={LIST_NEW} className="btn primary">Add your first asset</Link>}>
          Add the house or a vehicle first (only a name is needed), then the appliances and systems inside it. Maintenance reminders, repairs and warranties attach to each one.
        </EmptyState>
      ) : (
        <>
          <section className="card as-band ui-band" aria-label="At a glance">
            <Figure label="Assets" value={ov.counts.total} description={`${ov.counts.inUse} in use`} />
            <Figure label="Needs attention" value={rows.length} tone={rows.length > 0 ? 'warn' : 'default'} />
            <Figure label="Upcoming maintenance" value={ov.upcomingTotal} />
            <Figure label="Warranties ending soon" value={ov.attention.expiringWarranties.length} description={`next ${SOON_DAYS} days`} />
          </section>

          <div className="as-layout as-ov-layout">
            <div className="as-col">
              <section className="card as-card" aria-labelledby="ov-att-h">
                <h2 id="ov-att-h">Needs attention</h2>
                {rows.length === 0 ? <p className="as-ok" role="status">✓ Nothing needs attention right now.</p> : (
                  <ul className="plain as-items">
                    {rows.map((r) => (
                      <li key={r.id}>
                        <span aria-hidden="true">⚠ </span><strong>{r.text}</strong>{r.hint && <span className="muted small"> · {r.hint}</span>}
                      </li>
                    ))}
                  </ul>
                )}
                <AttentionLinks ov={ov} names={names} />
              </section>

              <section className="card as-card" aria-labelledby="ov-next-h">
                <h2 id="ov-next-h">Upcoming maintenance</h2>
                {ov.upcoming.length === 0 ? <p className="muted">No dated maintenance. Open an asset and use Add maintenance to schedule some.</p> : (
                  <ul className="plain as-items as-dated">
                    {ov.upcoming.map((m) => (
                      <li key={m.taskId} className="as-trow">
                        <DateTile iso={m.dueDate} today={today} overdue={m.overdue} size="sm" labelled={false} />
                        <div className="as-trow-main">
                          <a href={`#/tasks?task=${m.taskId}`}><strong>{m.title}</strong></a>
                          <div className="small">
                            <Link to={`/${m.assetIds[0]}`}>{assetNames(names, m.assetIds)}</Link> · {m.overdue ? <StatusChip tone="overdue">Overdue, was due {day(m.dueDate)}</StatusChip> : <>Due {day(m.dueDate)}</>}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                {ov.upcomingTotal > ov.upcoming.length && <p className="muted small">{ov.upcomingTotal - ov.upcoming.length} more in <a href="#/tasks">Tasks</a>.</p>}
              </section>

              <section className="card as-card" aria-labelledby="ov-rec-h">
                <h2 id="ov-rec-h">Recent service history</h2>
                {ov.recent.length === 0 ? <p className="muted">No work has been logged yet. Finish a maintenance task with &ldquo;Done, log it&rdquo;, or use Log service on an asset.</p> : (
                  <ul className="plain as-items as-dated">
                    {ov.recent.map(({ service: s, cost }) => (
                      <li key={s.id} className="as-trow">
                        <DateTile iso={s.data.date} today={today} size="sm" labelled={false} />
                        <div className="as-trow-main">
                          <Link to={`/${s.data.assetId}?service=${s.id}`}><strong>{s.data.title}</strong></Link>
                          <div className="small">
                            {day(s.data.date)} · {names.get(s.data.assetId) ?? '(asset removed)'} · {SERVICE_KIND_LABEL[s.data.kind]}
                            {contact(s.data.providerContactId) && <> · {contact(s.data.providerContactId)}</>}
                            {' · '}{cost.kind === 'amount' ? formatCents(cost.cents) : cost.kind === 'review' ? <span className="as-late">cost needs review</span> : <span className="muted">cost not recorded</span>}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="muted small">Find older work on each asset&rsquo;s page, or search for it from the search box.</p>
              </section>
            </div>

            <div className="as-col">
              <section className="card as-card" aria-labelledby="ov-places-h">
                <div className="as-card-head">
                  <h2 id="ov-places-h">Places and assets</h2>
                  <Link to={LIST} className="small">All assets</Link>
                </div>
                {places.length === 0 ? <p className="muted">Nothing is in use right now. Past and archived assets are on the All assets page.</p> : (
                  <ul className="plain as-items as-places">
                    {places.map(({ asset: a, inside }) => (
                      <li key={a.id}>
                        <Link to={`/${a.id}`} className="as-place-link">
                          <span className="as-place-name"><strong>{a.data.name}</strong><span className="muted small">{TYPE_LABEL[a.data.type]}</span></span>
                          <span className="muted small">{inside === 0 ? 'Nothing inside yet' : `${inside} inside`}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="card as-card" aria-labelledby="ov-war-h">
                <h2 id="ov-war-h">Warranties ending soon</h2>
                {ov.warranties.length === 0 ? <p className="muted">No warranty ends in the next {SOON_DAYS} days.</p> : (
                  <ul className="plain as-items as-dated">
                    {ov.warranties.map((w) => (
                      <li key={`${w.assetId}:${w.warrantyId ?? 'old'}`} className="as-trow">
                        <DateTile iso={w.endDate} today={today} size="sm" labelled={false} caption="Ends" />
                        <div className="as-trow-main">
                          <Link to={w.warrantyId === null ? `/${w.assetId}` : `/${w.assetId}?warranty=${w.warrantyId}`}><strong>{names.get(w.assetId)}</strong>{w.title !== 'Warranty' && <> · {w.title}</>}</Link>
                          <div className="small">Ends {day(w.endDate)} <span className="muted">({w.daysLeft === 0 ? 'today' : `in ${w.daysLeft} ${w.daysLeft === 1 ? 'day' : 'days'}`})</span>{contact(w.providerContactId) && <span className="muted"> · {contact(w.providerContactId)}</span>}</div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                {ov.attention.expiringWarranties.length > ov.warranties.length && <p className="muted small">{ov.attention.expiringWarranties.length - ov.warranties.length} more on the <a href="#/calendar">Calendar</a>.</p>}
              </section>
            </div>
          </div>

          <SpendingBlock ov={ov} period={year} onPeriod={setPeriod} />
        </>
      )}
    </div>
  );
}

/** Direct links into the places the attention lines point at, one per kind (the counts above are in plain words, these take you there). */
function AttentionLinks({ ov, names }: { ov: Overview; names: Map<number, string> }) {
  const a = ov.attention;
  const overdue = a.overdueTasks.slice(0, 3);
  if (!overdue.length && !a.unsaved.length && !a.orphans && !a.reviewRefs && !a.duplicateJobs) return null;
  return (
    <ul className="plain as-items as-att-links">
      {overdue.map((m) => <li key={`o${m.taskId}`} className="small"><a href={`#/tasks?task=${m.taskId}`}>{m.title}</a> <span className="muted">· {assetNames(names, m.assetIds)}, was due {day(m.dueDate)}</span></li>)}
      {a.overdueTasks.length > overdue.length && <li className="small muted">{a.overdueTasks.length - overdue.length} more overdue in <a href="#/tasks?view=overdue">Tasks</a></li>}
      {a.unsaved.slice(0, 3).map((u) => <li key={`u${u.taskId}`} className="small"><Link to={`/${u.assetIds[0]}`}>Save &ldquo;{u.title}&rdquo; to history</Link> <span className="muted">· {assetNames(names, u.assetIds)}</span></li>)}
      {a.unsaved.length > 3 && <li className="small muted">{a.unsaved.length - 3} more on their asset pages</li>}
      {a.duplicateJobs > 0 && <li className="small muted">Saved-twice jobs are flagged on the asset&rsquo;s page, under Service history.</li>}
      {a.orphans > 0 && <li className="small"><Link to={LIST}>Review the records that point at a missing asset</Link></li>}
      {a.reviewRefs > 0 && <li className="small muted">Each is marked &ldquo;needs review&rdquo; on the asset&rsquo;s Spending card; open a service record or the asset to pick the payment again.</li>}
    </ul>
  );
}

function SpendingBlock({ ov, period, onPeriod }: { ov: Overview; period: string; onPeriod: (p: string) => void }) {
  const s = ov.spending;
  const h = s.household;
  const thisYear = String(new Date().getFullYear());
  const years = [...new Set([period, ...s.years, thisYear].filter(isYear))].sort().reverse();
  const label = isYear(period) ? `in ${period}` : 'all time';
  const hasAny = h.totalCents !== 0 || h.review.length > 0 || h.unknown.length > 0 || h.pieces.length > 0;
  return (
    <section className="card as-card" aria-labelledby="ov-spend-h">
      <div className="as-card-head">
        <h2 id="ov-spend-h">Spending on assets</h2>
        <label className="f as-inline">Period
          <select value={period} onChange={(e) => onPeriod(e.target.value)}>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
            <option value="all">All time</option>
          </select>
        </label>
      </div>
      <p className="muted small">Paid for assets and their repairs, {label}, whole household. Each payment is counted once. Amounts come from the purchase and service records and the Finance transactions they point at. A Finance payment counts in the year it was paid; a typed cost counts in the year of its service or purchase date. Project spending is not included.</p>
      {!hasAny ? <p className="muted">Nothing recorded {label}.</p> : (
        <>
          <dl className="as-facts as-spend-top">
            <div className="as-fact as-total"><dt>Total, {label}</dt><dd><strong>{formatCents(h.totalCents)}</strong></dd></div>
            <div className="as-fact"><dt>{GROUP_LABEL.maintenance}</dt><dd>{formatCents(h.byGroup.maintenance)}</dd></div>
            {GROUPS.filter((g) => g !== 'maintenance' && (h.byGroup[g] !== 0 || h.pieces.some((p) => p.group === g))).map((g) => <div className="as-fact" key={g}><dt>{GROUP_LABEL[g]}</dt><dd>{formatCents(h.byGroup[g])}</dd></div>)}
            <div className="as-fact"><dt>From Finance transactions</dt><dd>{formatCents(h.financeCents)}</dd></div>
            <div className="as-fact"><dt>Typed amounts</dt><dd>{formatCents(h.manualCents)}</dd></div>
          </dl>
          {s.places.length > 0 && (
            <>
              <h3 className="as-sub">By property or top-level asset</h3>
              <ul className="plain as-items">
                {s.places.map((p) => <li key={p.rootId} className="as-place"><Link to={`/${p.rootId}`}>{p.name}</Link>{p.summary.pieces.length === 0 && p.summary.manualRecords === 0 ? <span className="muted small">no cost recorded</span> : <strong>{formatCents(p.summary.totalCents)}</strong>}</li>)}
              </ul>
              {s.placesSumCents !== h.totalCents && <p className="muted small" role="note">These do not add up to the household total because a payment linked to things in two places counts once in each place, but only once in the household total.</p>}
            </>
          )}
          {h.review.length > 0 && <p className="as-warn-line" role="status"><strong>{h.review.length} linked {h.review.length === 1 ? 'payment needs' : 'payments need'} review {label}.</strong> {h.review.length === 1 ? 'It is' : 'They are'} left out of the figures above, and nothing has been guessed in its place.</p>}
          {h.unknown.length > 0 && <p className="muted small">{h.unknown.length} service {h.unknown.length === 1 ? 'record has' : 'records have'} no cost recorded {label}. Not counted as $0.</p>}
          {s.undatedTyped > 0 && isYear(period) && <p className="muted small">{s.undatedTyped} typed {s.undatedTyped === 1 ? 'cost has' : 'costs have'} no date, so {s.undatedTyped === 1 ? 'it appears' : 'they appear'} only under All time.</p>}
        </>
      )}
      <p className="muted small">Per-asset detail, and which payment is behind each figure, is on each asset&rsquo;s Spending card.</p>
    </section>
  );
}
