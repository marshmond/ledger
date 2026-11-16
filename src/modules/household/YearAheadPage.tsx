import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { dayLabel } from '../../core/time';
import { EmptyState, PageHeader } from '../../ui/components';
import { DateTile } from '../../ui/DateTile';
import { Figure } from '../../ui/Figure';
import { Icon } from '../../ui/icons';
import { todayISO } from '../../lib/money';
import { useToday } from '../../ui/useToday';
import { Amt, CertaintyChip, useMoney, type Money, type Text } from './Parts';
import { GROUP_LABEL, KIND_LABEL, SOURCE_LABEL, type Attn, type YaPeriod, type YaRow, type YearAhead } from './yearAhead';
import { loadYearAhead } from './yearAheadData';
import type { Totals } from './commitments';
import './household.css';

const day = (d: string) => dayLabel(d, { weekday: 'short', year: true });
const mo = (d: string, year: boolean) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(year ? { year: 'numeric' } : {}), timeZone: 'UTC' });
/** "Nov 16 to Dec 15", with the year on the end when the period leaves the current year. */
const span = (p: { from: string; to: string }, today: string) => `${mo(p.from, p.from.slice(0, 4) !== today.slice(0, 4))} to ${mo(p.to, p.to.slice(0, 4) !== today.slice(0, 4) || p.from.slice(0, 4) !== p.to.slice(0, 4))}`;
const plural = (c: number, one: string, many: string) => `${c} ${c === 1 ? one : many}`;

/**
 * Year Ahead (R3.1): a read-only look at the next twelve months, composed from what the other modules already know. It adds nothing across its groups and a source that fails
 * to read removes only its own figure. Hide Amounts is honoured everywhere an amount is shown, including amounts typed into a title or note.
 */
export default function YearAheadPage() {
  const today = useToday() || todayISO();
  const { hide, money, text } = useMoney();
  const [again, setAgain] = useState(0);
  const res = useLiveQuery(async () => {
    try { return { ok: true as const, ya: await loadYearAhead(today) }; }
    catch (e) { return { ok: false as const, error: e instanceof Error ? e.message : 'Something went wrong while reading.' }; }
  }, [today, hide, again]);

  const head = <PageHeader title="Year Ahead" eyebrow="Household Finances" description="Upcoming commitments, expected payments, and important dates" actions={<><a className="btn" href="#/household">Household Finances</a><span className="hh-readonly"><Icon name="info" size={16} />Read-only: nothing here changes a record</span></>} />;
  if (!res) return <div className="hh">{head}<p className="hh-skel" role="status">Loading… nothing is shown as a total until it has been read.</p></div>;
  if (!res.ok) {
    return (
      <div className="hh">{head}
        <div className="hh-err" role="alert">
          <strong>Ledger could not read your records, so it is showing nothing.</strong>
          <p className="small">Nothing was changed. {res.error}</p>
          <button type="button" className="btn" onClick={() => setAgain((n) => n + 1)}>Try again</button>
        </div>
      </div>
    );
  }
  const ya = res.ya;
  const empty = ya.rows.length === 0 && ya.undated.length === 0 && !ya.incomplete;
  return (
    <div className="hh ya">
      {head}
      <p className="ya-range" aria-label="Planning period"><Icon name="calendar" size={18} /><span><strong>{day(ya.from)}</strong> to <strong>{day(ya.to)}</strong><span className="muted"> · the next twelve months</span></span></p>
      {ya.incomplete && <Incomplete ya={ya} onRetry={() => setAgain((n) => n + 1)} />}
      <NearTerm ya={ya} money={money} text={text} />
      <Summary ya={ya} money={money} />
      {empty ? (
        <EmptyState title="Nothing is planned for the next twelve months" action={<span className="row"><a className="btn primary" href="#/bills">Bills &amp; Subscriptions</a><a className="btn" href="#/services">Household Services</a></span>}>
          Add a bill, a household service, a scheduled payment or a project agreement, and what it expects over the year appears here.
        </EmptyState>
      ) : (
        <>
          <Attention items={ya.attention} text={text} />
          <Undated rows={ya.undated} money={money} text={text} today={ya.today} />
          <Months ya={ya} money={money} text={text} />
        </>
      )}
      <HowToRead ya={ya} />
    </div>
  );
}

function Incomplete({ ya, onRetry }: { ya: YearAhead; onRetry: () => void }) {
  return (
    <div className="hh-warn ya-incomplete" role="alert">
      <Icon name="warning" size={18} className="hh-callout-ic" />
      <span><strong>This review is incomplete.</strong> {ya.sources.filter((s) => !s.ok).map((s) => s.label).join(' and ')} could not be read, so any figure that depends on {ya.sources.filter((s) => !s.ok).length === 1 ? 'it is' : 'them are'} not shown. What was read is listed below, with its links. Nothing was changed. <button type="button" className="link" onClick={onRetry}>Try again</button></span>
    </div>
  );
}

/** Phone only (hidden from 761px up): the first few dated items sit above the long summary, so what is coming soonest is never a long scroll away. */
function NearTerm({ ya, money, text }: { ya: YearAhead; money: Money; text: Text }) {
  const rows = ya.rows.slice(0, 5);
  if (rows.length === 0) return null;
  return (
    <section className="card hh-card ya-near" aria-labelledby="ya-near-h">
      <div className="hh-card-head"><h2 id="ya-near-h">Coming up first</h2></div>
      <ul className="plain hh-list hh-plist">{rows.map((r) => <Row key={r.id} r={r} money={money} text={text} today={ya.today} />)}</ul>
      <button type="button" className="link" onClick={() => document.getElementById('ya-months-h')?.scrollIntoView({ block: 'start' })}>See all twelve months</button>
    </section>
  );
}

// ---- summary: four groups, never added together ----

function Group({ title, tag, children, id }: { title: string; tag: string; children: React.ReactNode; id: string }) {
  return (
    <section className="hh-tile ya-tile" aria-labelledby={id}>
      <div className="hh-tile-head"><h2 id={id} className="hh-tile-title">{title}</h2><span className="hh-tag">{tag}</span></div>
      {children}
    </section>
  );
}
const Unavailable = () => <p className="hh-unknown-note ya-na" role="note"><Icon name="warning" size={16} />Not shown: a source could not be read, and a partial figure could look complete.</p>;

function TotalsFigs({ t, money }: { t: Totals; money: Money }) {
  return (
    <div className="hh-tile-figs">
      <Figure label="Known" value={money(t.known.cents)} description={plural(t.known.count, 'payment', 'payments')} />
      <Figure certainty="estimated" label="Estimated" value={money(t.estimated.cents)} description={plural(t.estimated.count, 'payment', 'payments')} />
      <Figure certainty="unknown" label="Amount not known" value={plural(t.unknown.count, 'item', 'items')} description="not added, and not zero" />
      {t.disputed.count > 0 && <Figure certainty="unknown" label="In dispute" value={plural(t.disputed.count, 'item', 'items')} description="not added" />}
    </div>
  );
}

export function Summary({ ya, money }: { ya: YearAhead; money: Money }) {
  const bs = ya.figures.billsServices, f = ya.figures.finance, p = ya.figures.projects;
  const overlap = ya.commitments?.twelve.overlapExposureCents ?? 0;
  const finOverlap = ya.rows.filter((r) => r.source === 'finance' && r.overlap).length;
  return (
    <div className="hh-tiles ya-tiles" role="group" aria-label="Summary of the next twelve months. The groups are kept apart and not added together.">
      <Group id="ya-g-bs" title={GROUP_LABEL.billsServices} tag="Plans, not payments">
        {bs.complete ? <><TotalsFigs t={bs.totals} money={money} />{ya.commitments?.twelve.mayOverlap && <p className="small ya-qual">A bill and a service may overlap by up to <Amt c={overlap} money={money} />. Both are counted until you decide.</p>}</> : <Unavailable />}
        <a className="link hh-jump" href="#/household">How these are worked out</a>
      </Group>
      <Group id="ya-g-fin" title={GROUP_LABEL.finance} tag="Not in the figure at left">
        {f.complete ? <><TotalsFigs t={f.totals} money={money} />{finOverlap > 0 && <p className="small ya-qual">{plural(finOverlap, 'payment resembles', 'payments resemble')} another record and {finOverlap === 1 ? 'is' : 'are'} listed but not added.</p>}{ya.linkedScheduled > 0 && <p className="small muted">{plural(ya.linkedScheduled, 'scheduled payment is', 'scheduled payments are')} linked to a bill and counted once, as the bill.</p>}</> : <Unavailable />}
      </Group>
      <Group id="ya-g-pr" title={GROUP_LABEL.projects} tag="Agreed, still to pay">
        {p.complete ? <div className="hh-tile-figs"><Figure label="Still to pay" value={money(p.leftCents)} description={plural(p.count, 'agreement', 'agreements')} /><Figure certainty="unknown" label="Payment date" value={p.undated > 0 ? 'Not specified' : 'None needed'} description={p.undated > 0 ? 'so not placed in a month' : ''} /></div> : <Unavailable />}
      </Group>
      <Group id="ya-g-dt" title="Important dates" tag="No money">
        {ya.sources.find((s) => s.id === 'assets')?.ok !== false && ya.sources.find((s) => s.id === 'bills')?.ok !== false ? <div className="hh-tile-figs"><Figure label="Dates to prepare for" value={String(ya.deadlineCount)} description="renewals, trials, notice, warranties, maintenance" />{ya.overdueMaintenance > 0 && <Figure certainty="unknown" label="Already overdue" value={String(ya.overdueMaintenance)} description="maintenance tasks" />}</div> : <Unavailable />}
      </Group>
    </div>
  );
}

// ---- planning attention ----

const ATTN_ICON = { overlap: 'warning', unknown: 'help', irregular: 'wave', undated: 'help', deadline: 'calendar', maintenance: 'warning', source: 'warning' } as const;
export function Attention({ items, text }: { items: Attn[]; text: Text }) {
  const [all, setAll] = useState(false);
  if (items.length === 0) return null;
  const shown = all ? items : items.slice(0, 6);
  return (
    <section className="card hh-card hh-card--review" aria-labelledby="ya-attn-h">
      <div className="hh-card-head"><div><span className="ui-eyebrow">Worth a look</span><h2 id="ya-attn-h" tabIndex={-1}>Planning attention</h2></div><span className="hh-count">{items.length}</span></div>
      <p className="hh-lede">Things that may need a decision or more information before the year gets going. Fix them in the record they link to.</p>
      <ul className="plain hh-list">
        {shown.map((a) => (
          <li key={a.id}>
            <div className="hh-row"><span className="hh-row-main"><span className={`ya-attn ya-attn--${a.kind}`}><Icon name={ATTN_ICON[a.kind]} size={14} />{a.href ? <a href={a.href}><strong>{text(a.title)}</strong></a> : <strong>{text(a.title)}</strong>}</span><span className="small muted">{text(a.reason)}</span></span></div>
          </li>
        ))}
      </ul>
      {items.length > 6 && <button type="button" className="btn" onClick={() => setAll(!all)} aria-expanded={all}>{all ? 'Show fewer' : `Show all ${items.length}`}</button>}
    </section>
  );
}

// ---- undated project commitments ----

export function Undated({ rows, money, text, today }: { rows: YaRow[]; money: Money; text: Text; today: string }) {
  if (rows.length === 0) return null;
  return (
    <section className="card hh-card" aria-labelledby="ya-und-h">
      <div className="hh-card-head"><div><span className="ui-eyebrow">Agreed · no date recorded</span><h2 id="ya-und-h" tabIndex={-1}>Date not specified</h2></div></div>
      <p className="hh-lede">Agreed project amounts that are still to be paid. No payment date is recorded for them, so Ledger does not place them in a month.</p>
      <ul className="plain hh-list hh-plist">{rows.map((r) => <Row key={r.id} r={r} money={money} text={text} today={today} />)}</ul>
    </section>
  );
}

// ---- the twelve periods ----

export function Months({ ya, money, text }: { ya: YearAhead; money: Money; text: Text }) {
  const [open, setOpen] = useState<boolean[]>(() => ya.periods.map((p, i) => i < 3 && p.rows.length > 0));
  const [rev, setRev] = useState(0);
  const set = (v: boolean) => { setOpen(ya.periods.map(() => v)); setRev((n) => n + 1); };
  return (
    <section aria-labelledby="ya-months-h" className="ya-months">
      <div className="hh-card-head">
        <div><span className="ui-eyebrow">Month by month</span><h2 id="ya-months-h" tabIndex={-1}>The next twelve months</h2></div>
        <span className="row"><button type="button" className="btn" onClick={() => set(true)}>Open all</button><button type="button" className="btn" onClick={() => set(false)}>Close all</button></span>
      </div>
      {ya.periods.map((p, i) => <Period key={`${p.from}:${rev}`} p={p} ya={ya} open={open[i]} onToggle={(v) => setOpen((o) => o.map((x, j) => (j === i ? v : x)))} money={money} text={text} />)}
    </section>
  );
}

function Subtotal({ label, t, money }: { label: string; t: Totals; money: Money }) {
  if (t.known.count + t.estimated.count + t.unknown.count + t.disputed.count === 0) return null;
  return (
    <span className="ya-sub"><strong>{label}:</strong> {t.known.count > 0 && <>{money(t.known.cents)} known</>}{t.known.count > 0 && t.estimated.count > 0 && ', '}{t.estimated.count > 0 && <>{money(t.estimated.cents)} estimated</>}{(t.unknown.count > 0 || t.disputed.count > 0) && <>{t.known.count + t.estimated.count > 0 ? ', ' : ''}{plural(t.unknown.count + t.disputed.count, 'amount', 'amounts')} not known</>}</span>
  );
}

function Period({ p, ya, open, onToggle, money, text }: { p: YaPeriod; ya: YearAhead; open: boolean; onToggle: (v: boolean) => void; money: Money; text: Text }) {
  const id = `ya-p-${p.index}`;
  return (
    <details className="hh-det ya-period" open={open} onToggle={(e) => onToggle((e.currentTarget as HTMLDetailsElement).open)} id={id}>
      <summary>
        <span className="ya-psum">
          <strong>{span(p, ya.today)}</strong>
          <span className="small muted">{p.rows.length === 0 ? 'Nothing dated' : `${plural(p.payments, 'payment', 'payments')} · ${plural(p.deadlines, 'date', 'dates')}`}</span>
          {p.billsServices && <Subtotal label="Bills and services" t={p.billsServices} money={money} />}
          {p.finance && <Subtotal label="Finance-only" t={p.finance} money={money} />}
        </span>
      </summary>
      {p.rows.length === 0 ? <p className="muted">Nothing is dated in this period.</p> : <ul className="plain hh-list hh-plist">{p.rows.map((r) => <Row key={r.id} r={r} money={money} text={text} today={ya.today} />)}</ul>}
    </details>
  );
}

function Row({ r, money, text, today }: { r: YaRow; money: Money; text: Text; today: string }) {
  return (
    <li className={`hh-prow ya-row${r.folded ? ' hh-folded' : ''}${r.financial ? '' : ' ya-info'}`}>
      {r.date ? <DateTile iso={r.date} today={today} size="sm" labelled={false} /> : <span className="ya-nodate" aria-hidden="true"><Icon name="help" size={18} /></span>}
      <span className="hh-prow-main">
        <a href={r.href}><strong>{text(r.title)}</strong></a>
        <span className="small muted">{r.date ? day(r.date) : 'Date not specified'} · {SOURCE_LABEL[r.source]} · {KIND_LABEL[r.kind]}</span>
        {r.note && <span className="small muted">{text(r.note)}</span>}
        {r.overlap && <span className="small ya-ovl"><Icon name="warning" size={14} />{text(r.overlap)}{r.source === 'finance' ? ' Not added to any figure.' : ''}</span>}
        {r.folded && <span className="small">Same expense as the linked bill; kept here but not added again.</span>}
      </span>
      <span className="hh-prow-tags">
        {r.financial && r.certainty && <CertaintyChip c={r.certainty} />}
        {!r.financial && <span className="hh-chip">Date only</span>}
        {r.forecast && <span className={`hh-chip ya-fc ya-fc--${r.forecast}`}>{r.forecast === 'in' ? 'In the Forecast' : 'Not in the Forecast'}</span>}
        {r.irregular && r.financial && <span className="hh-chip ya-irr">Not every month</span>}
      </span>
      <span className="hh-prow-amt">{!r.financial ? <span className="muted">No amount</span> : r.cents === null ? <span className="hh-unknown">Amount not known</span> : <Amt c={r.cents} money={money} />}</span>
    </li>
  );
}

// ---- how to read ----

function HowToRead({ ya }: { ya: YearAhead }) {
  return (
    <details className="hh-det hh-readme ya-read">
      <summary><Icon name="info" size={16} />How to read this page</summary>
      <ul className="plain">
        <li><strong>Plans, not payments.</strong> These are amounts your records expect over {day(ya.from)} to {day(ya.to)}. Nothing here proves a payment was made, and nothing is paid or scheduled for you.</li>
        <li><strong>The groups are kept apart.</strong> Bills and services, Finance-only payments and project amounts come from different records and are never added into one number. Recorded spending is not used here.</li>
        <li><strong>The Forecast is separate.</strong> Appearing on this page does not mean a payment is in the Finance Forecast. Each Finance row says whether the Forecast already holds it. A bill is in the Forecast only when a scheduled payment is linked to it.</li>
        <li><strong>Possible overlaps are not reconciled.</strong> When two records may be the same expense and Ledger cannot be sure, both are shown and the overlap is stated. A Finance payment that resembles a bill is listed but kept out of the figure.</li>
        <li><strong>Not known stays not known.</strong> An amount that is missing is shown as a count and is never counted as zero. Estimates are labelled.</li>
        <li><strong>Home &amp; Assets adds dates only.</strong> It keeps no expected cost for replacing or servicing things, so none is shown.</li>
      </ul>
    </details>
  );
}
