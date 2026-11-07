import { Link } from '../../core/router';
import { dayLabel } from '../../core/time';
import { formatCents } from '../../lib/money';
import { maskMoney } from '../../ui/TxnRefs';
import { loadHideAmounts } from '../today/layout';
import { MODULE_LABEL, type Claim, type ClaimStatus } from './householdSpend';
import type { Insight } from './insights';
import { arrangementRoute } from './paths';
import { sourceTarget, type AttentionEntry, type ContractRow, type ServicesOverview, type UpcomingRow } from './servicesOverview';
import type { ExpectedWindow } from './expectedCharges';
import { addDays } from '../../lib/dates';

const day = (d: string) => dayLabel(d, { weekday: 'short', year: true });
/** Hide Amounts (the global preference) shows no digits anywhere on this page. */
export const useMoney = () => { const hide = loadHideAmounts(); return { hide, money: (c: number) => (hide ? '$••••' : formatCents(c)), text: (t: string) => (hide ? maskMoney(t) : t) }; };

/** A link to a Household Services page (`to`) or a Home & Assets page (`href`). */
function Target({ t, children }: { t: { to?: string; href?: string }; children: React.ReactNode }) {
  return t.to ? <Link to={t.to}>{children}</Link> : <a href={t.href}>{children}</a>;
}

// ---- needs attention ----

const KIND_LABEL: Record<AttentionEntry['kind'], string> = {
  contract: 'Agreement date', unlogged: 'Not yet logged', schedule: 'Schedule', 'duplicate-visits': 'Possible duplicate', 'duplicate-handoff': 'Possible duplicate', 'finance-reference': 'Payment link', 'typed-amount': 'Typed amount',
  'review-visit': 'Needs review', provider: 'Provider', asset: 'Asset',
};

export function AttentionCard({ items, onLog }: { items: AttentionEntry[]; onLog: (u: NonNullable<AttentionEntry['unlogged']>) => void }) {
  const { text } = useMoney();
  return (
    <section className="card sv-card" aria-labelledby="sv-att-h">
      <h2 id="sv-att-h">Needs attention{items.length ? ` (${items.length})` : ''}</h2>
      {items.length === 0 ? <p className="sv-ok" role="status">✓ Nothing needs attention right now.</p> : (
        <ul className="plain sv-items">
          {items.map((x) => (
            <li key={x.id}>
              <span className="sv-chip sv-kind">{KIND_LABEL[x.kind]}</span>{' '}
              {x.to || x.href ? <Target t={x}><strong>{text(x.text)}</strong></Target> : <strong>{text(x.text)}</strong>}
              <span className="muted small"> · {text(x.hint)}</span>
              {x.unlogged && <div className="sv-actionrow"><button className="btn" onClick={() => onLog(x.unlogged!)}>Log this visit…</button></div>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---- upcoming ----

export function UpcomingCard({ rows, total }: { rows: UpcomingRow[]; total: number }) {
  return (
    <section className="card sv-card" aria-labelledby="sv-up-h">
      <h2 id="sv-up-h">Upcoming services</h2>
      {rows.length === 0 ? <p className="muted">Nothing is scheduled{total > 0 ? ' for the selected provider' : ''}. Open an arrangement to schedule a visit.</p> : (
        <>
          <ul className="plain sv-items">
            {rows.map((r) => (
              <li key={r.key}>
                <div className="sv-visit-top">
                  {r.kind === 'task'
                    ? <a href={`#/tasks?task=${r.taskId}`}><strong>{day(r.date)}{r.time ? ` at ${r.time}` : ''}</strong></a>
                    : <strong>{day(r.date)}{r.time ? ` at ${r.time}` : ''}</strong>}
                  <span className={`sv-chip ${r.kind === 'task' ? 'v-completed' : 'v-skipped'}`}>{r.kind === 'task' ? 'Next visit (task)' : 'Expected from schedule'}</span>
                  {r.overdue && <span className="sv-late"> overdue</span>}
                  {r.movedFrom && <span className="sv-chip v-cancelled" title="Only this visit was moved; later dates are not shifted">Moved from {day(r.movedFrom)}</span>}
                </div>
                <div className="small"><Link to={arrangementRoute(r.arrangementId)}>{r.title}</Link>{r.providerName && <span className="muted"> · {r.providerName}</span>}{r.assetNames.length > 0 && <span className="muted"> · {r.assetNames.join(', ')}</span>}</div>
              </li>
            ))}
          </ul>
          <p className="muted small">The next visit of each arrangement is a task. "Expected from schedule" dates come from the arrangement's schedule; they are not tasks and nothing marks them done.</p>
        </>
      )}
    </section>
  );
}

// ---- agreements ----

export function ContractsCard({ rows }: { rows: ContractRow[] }) {
  if (!rows.length) return null;
  return (
    <section className="card sv-card" aria-labelledby="sv-con-h">
      <h2 id="sv-con-h">Agreements to review (next 90 days)</h2>
      <ul className="plain sv-items">
        {rows.map((r) => (
          <li key={`${r.kind}-${r.arrangementId}`}>
            <strong>{r.label}</strong>: <Link to={arrangementRoute(r.arrangementId)}>{r.title}</Link>{r.providerName && <span className="muted"> · {r.providerName}</span>}
            <div className="small">{day(r.date)} · <span className="muted">{r.daysAway === 0 ? 'today' : r.daysAway === 1 ? 'tomorrow' : `in ${r.daysAway} days`}</span></div>
          </li>
        ))}
      </ul>
      <p className="muted small">Nothing renews, cancels or repeats by itself. These are the dates you entered.</p>
    </section>
  );
}

// ---- spending ----

const STATUS_WORDS: Record<ClaimStatus, string> = {
  included: 'Counted', merged: 'Same payment, counted once elsewhere', covered: 'Part of a counted whole transaction', excluded: 'Not added (needs review, or a typed amount on a linked job)',
};
const STATUS_ORDER: ClaimStatus[] = ['included', 'merged', 'covered', 'excluded'];
const CLAIM_ROWS = 40;

function ClaimList({ claims }: { claims: Claim[] }) {
  const { money, text } = useMoney();
  const groups = STATUS_ORDER.map((s) => ({ s, rows: claims.filter((c) => c.status === s) })).filter((g) => g.rows.length);
  return (
    <>
      {groups.map(({ s, rows }) => (
        <div key={s}>
          <h4 className="sv-h3">{STATUS_WORDS[s]} ({rows.length})</h4>
          <ul className="plain sv-items small">
            {rows.slice(0, CLAIM_ROWS).map((c, i) => (
              <li key={`${c.recordId}|${c.key ?? 'typed'}|${i}`}>
                <Target t={sourceTarget(c.source)}>{c.title}</Target> <span className="muted">· {MODULE_LABEL[c.module]} · {c.kind === 'finance' ? 'Finance payment' : 'typed, paid outside Finance'}</span>
                {s !== 'merged' && s !== 'excluded' || c.kind === 'typed' ? <span> · {money(c.cents)}</span> : null}
                {c.reason && <div className="muted">{text(c.reason)}</div>}
              </li>
            ))}
          </ul>
          {rows.length > CLAIM_ROWS && <p className="muted small">{rows.length - CLAIM_ROWS} more not shown.</p>}
        </div>
      ))}
    </>
  );
}

export function SpendingCard({ ov, onPeriod }: { ov: ServicesOverview; onPeriod: (id: string) => void }) {
  const { money, text } = useMoney();
  const h = ov.spend;
  const r = h.reconciliation;
  const nothing = h.claims.length === 0 && h.unknown.homeWork === 0 && h.unknown.completedVisits === 0;
  return (
    <section className="card sv-card" aria-labelledby="sv-hh-h">
      <div className="sv-card-head">
        <h2 id="sv-hh-h">Recorded spending</h2>
        <label className="sv-periodpick">Period <select value={ov.period.id} onChange={(e) => onPeriod(e.target.value)} aria-label="Period for spending and insights">
          {ov.periodOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select></label>
      </div>
      <p className="muted small">Period: <strong>{ov.period.label}</strong>. Payments recorded in Household Services and Home &amp; Assets, each counted once. This is not all household spending, and it is not what each service "costs".</p>
      {nothing ? <p className="muted">No payments are recorded in this period.</p> : (
        <dl className="sv-facts">
          <div className="sv-fact"><dt>Recorded payments, each counted once</dt><dd><strong>{money(h.totalCents)}</strong><div className="small muted">{money(h.financeCents)} linked to Finance · {money(h.typedCents)} typed as paid outside Finance</div></dd></div>
          <div className="sv-fact"><dt>Household Services (its own page's figure)</dt><dd>{money(h.servicesCents)}</dd></div>
          <div className="sv-fact"><dt>Home &amp; Assets (its own page's figure, including buying assets)</dt><dd>{money(h.homeCents)}</dd></div>
          <div className="sv-fact"><dt>Linked in both modules</dt><dd>{money(h.linkedInBothCents)}<div className="small muted">Counted once in the total. Not split between the modules.</div></dd></div>
        </dl>
      )}
      {r.differenceCents !== 0 && (
        <p className="small">The two module figures add up to {money(r.simpleSumCents)}; the total above is {money(h.totalCents)}. The {money(r.differenceCents)} difference is the same money recorded in both places ({money(r.overlapBothCents)} of payments linked in both{r.coveredAcrossCents ? `, ${money(r.coveredAcrossCents)} of parts covered by a whole transaction linked in the other module` : ''}{r.typedNotAddedCents ? `, ${money(r.typedNotAddedCents)} of typed amounts on visits and records that are linked as one job` : ''}).</p>
      )}
      {h.review.length > 0 && (
        <ul className="plain sv-lines" aria-label="Spending review notes">
          {h.review.slice(0, 8).map((x, i) => (
            <li key={i} className={x.kind === 'finance-reference' ? 'sv-warn small' : 'small muted'} role={x.kind === 'finance-reference' ? 'alert' : undefined}>
              <span aria-hidden="true">{x.kind === 'finance-reference' ? '⚠ ' : 'ℹ '}</span>{text(x.text)}{x.sources[0] && <> <Target t={sourceTarget(x.sources[0])}>Open</Target></>}
            </li>
          ))}
          {h.review.length > 8 && <li className="small muted">{h.review.length - 8} more review notes.</li>}
        </ul>
      )}
      {(h.unknown.completedVisits > 0 || h.unknown.homeWork > 0) && (
        <p className="small muted">
          {h.unknown.completedVisits > 0 && <>{h.unknown.completedVisits} completed visit{h.unknown.completedVisits === 1 ? ' has' : 's have'} no payment recorded. That does not mean unpaid. </>}
          {h.unknown.homeWork > 0 && <>{h.unknown.homeWork} Home &amp; Assets record{h.unknown.homeWork === 1 ? ' has' : 's have'} no cost recorded (not counted as $0).</>}
        </p>
      )}
      {h.projectTaggedPieces > 0 && <p className="small muted">{h.projectTaggedPieces} counted payment{h.projectTaggedPieces === 1 ? ' is' : 's are'} also attributed to a Project in Finance. Project spending is separate and is never added here.</p>}
      <details className="sv-sec">
        <summary>How these figures fit together ({h.claims.length} claim{h.claims.length === 1 ? '' : 's'})</summary>
        <p className="small muted">Every recorded payment is one claim. Each ends up counted, counted once through another claim, covered by a whole transaction, or not added. The counted claims add up to the total{r.reconciles ? '' : ' (they do not here: please report this)'}. Nothing is matched by amount, date or payee: two payments are the same only when they point at the same Finance transaction (or part), or when a visit and its Home &amp; Assets record are explicitly linked.</p>
        <ClaimList claims={h.claims} />
      </details>
      <EstimatesBlock windows={ov.estimates} today={ov.today} />
      {ov.byProvider.rows.length > 0 && (
        <details className="sv-sec">
          <summary>By provider (Household Services payments)</summary>
          <ul className="plain sv-items small">
            {ov.byProvider.rows.map((p) => <li key={p.providerKey}>{p.name}: <strong>{money(p.cents)}</strong></li>)}
            {ov.byProvider.sharedCents !== 0 && <li>Shared or unclear (reached by more than one provider's records): {money(ov.byProvider.sharedCents)}</li>}
          </ul>
          <p className="muted small">A payment linked on records of more than one provider is not given to either. The rows and the shared line add up to the Household Services figure.</p>
        </details>
      )}
    </section>
  );
}

// ---- estimates (kept apart from recorded money) ----

export function EstimatesBlock({ windows, today }: { windows: ExpectedWindow[]; today: string }) {
  const { money } = useMoney();
  if (!windows.some((w) => w.items.length || w.notConverted.length)) return null;
  const label = (days: number) => (days > 120 ? 'next 12 months' : `next ${days} days`);
  return (
    <div className="sv-sub" aria-label="Estimates of upcoming charges">
      <strong>Estimates of upcoming charges</strong>
      <p className="small muted">Estimates only, from your cost estimates and the schedule. They are not charges, not payments and not spending, and they are not part of the figures above.</p>
      {windows.map((w) => (
        <p key={w.days} className="small">{label(w.days).replace(/^./, (c) => c.toUpperCase())} (to {addDays(today, w.days)}): <strong>{w.items.length ? `about ${money(w.estimateCents)}` : 'no estimate available'}</strong></p>
      ))}
      {windows[windows.length - 1].notConverted.length > 0 && (
        <details className="small"><summary>Not included ({windows[windows.length - 1].notConverted.length})</summary>
          <ul className="plain">{windows[windows.length - 1].notConverted.map((n) => <li key={n.arrangementId}><strong>{n.title}</strong>: {n.reason}</li>)}</ul>
        </details>
      )}
    </div>
  );
}

// ---- insights ----

export function InsightsCard({ items }: { items: Insight[] }) {
  const { text } = useMoney();
  return (
    <section className="card sv-card" aria-labelledby="sv-ins-h">
      <h2 id="sv-ins-h">Things to know</h2>
      {items.length === 0 ? <p className="muted">Nothing stands out. Ledger only points out things it can support with your records, and it needs some history first.</p> : (
        <ul className="plain sv-items">
          {items.map((x) => (
            <li key={x.id}>
              <div><span aria-hidden="true">{x.tone === 'check' ? '⚑ ' : 'ℹ '}</span><strong>{text(x.title)}</strong></div>
              <div className="small">{text(x.detail)}</div>
              {x.links.length > 0 && <div className="small">{x.links.map((l, i) => <span key={l.to + i}>{i ? ' · ' : ''}<Link to={l.to}>{l.label}</Link></span>)}</div>}
            </li>
          ))}
        </ul>
      )}
      <p className="muted small">Worked out from your records each time you open this page. Nothing here is changed, sent or saved.</p>
    </section>
  );
}
