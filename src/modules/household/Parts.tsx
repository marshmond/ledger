import { useState, type ReactNode } from 'react';
import { dayLabel } from '../../core/time';
import { formatCents } from '../../lib/money';
import { maskMoney } from '../../ui/TxnRefs';
import { loadHideAmounts } from '../../core/hideAmounts';
import type { CommitmentRow, Consolidation, HouseholdCommitments, Totals, WindowFigures } from './commitments';
import { ATTRIBUTION_LABEL, ATTRIBUTION_ORDER, CERTAINTY_LABEL, HMOD_LABEL, REVIEW_CLASS_LABEL, type ReviewClass } from './model';
import type { ContractAction } from './overview';
import type { ReviewItem } from './review';
import type { RecordedAcrossModules } from './unionSpend';

const day = (d: string) => dayLabel(d, { weekday: 'short', year: true });
/** Hide Amounts (the global preference) shows no digits of money anywhere on this page. */
export const useMoney = () => { const hide = loadHideAmounts(); return { hide, money: (c: number) => (hide ? '$••••' : formatCents(c)), text: (t: string) => (hide ? maskMoney(t) : t) }; };
export type Money = (c: number) => string;
export type Text = (t: string) => string;

const n = (c: number, one: string, many: string) => `${c} ${c === 1 ? one : many}`;
export const Amt = ({ c, money }: { c: number; money: Money }) => <strong className="hh-amt">{money(c)}</strong>;
const Count = ({ children }: { children: ReactNode }) => <span className="hh-count">{children}</span>;
const chipClass = (m: string) => `hh-chip m-${m}`;

function Seg<T extends string | number>({ legend, name, value, options, onChange }: { legend: string; name: string; value: T; options: { id: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <fieldset className="hh-seg"><legend className="sr-only">{legend}</legend>
      {options.map((o) => (
        <label key={String(o.id)} className={value === o.id ? 'on' : ''}><input type="radio" name={name} value={String(o.id)} checked={value === o.id} onChange={() => onChange(o.id)} /> {o.label}</label>
      ))}
    </fieldset>
  );
}

// ---- how to read this page ----

export function ReadMe() {
  return (
    <details className="hh-det">
      <summary>How to read this page</summary>
      <ul className="plain">
        <li><strong>Expected payments</strong> are what is anticipated in the next few days. They are not spent yet.</li>
        <li><strong>Commitments</strong> are what you have agreed or reasonably expect to pay over the next twelve months. They are not evidence that anything was paid.</li>
        <li><strong>Recorded spending</strong> is what a Finance transaction (or one part of it) or an amount you typed as paid outside Finance supports. A payment that several records point at is counted once. It is not all of your household spending.</li>
        <li>An amount that is not known stays "not known". It is shown as a count, never as zero. An estimate is labelled an estimate.</li>
        <li>Nothing here changes any record. To fix something, open the record the item links to.</li>
      </ul>
    </details>
  );
}

// ---- expected payments (7 / 30 / 90 days) ----

function TotalsFigs({ t, money }: { t: Totals; money: Money }) {
  return (
    <dl className="hh-figs">
      <div className="hh-fig k-known"><dt>Known amounts</dt><dd><Amt c={t.known.cents} money={money} /><Count>{n(t.known.count, 'payment', 'payments')}</Count></dd></div>
      <div className="hh-fig k-estimated"><dt>Estimated amounts</dt><dd><Amt c={t.estimated.cents} money={money} /><Count>{n(t.estimated.count, 'payment', 'payments')}</Count></dd></div>
      <div className="hh-fig k-unknown"><dt>Amount not known</dt><dd><Count>{n(t.unknown.count, 'item', 'items')}</Count><span className="small muted">not added</span></dd></div>
      {t.disputed.count > 0 && <div className="hh-fig k-disputed"><dt>Amount in dispute</dt><dd><Count>{n(t.disputed.count, 'item', 'items')}</Count><span className="small muted">not added</span></dd></div>}
    </dl>
  );
}

function RowLine({ r, money, text, billTitles }: { r: CommitmentRow; money: Money; text: Text; billTitles: Map<string, string> }) {
  const into = r.foldedInto ? billTitles.get(r.foldedInto) : undefined;
  return (
    <li className={r.foldedInto ? 'hh-folded' : ''}>
      <div className="hh-row">
        <span className="hh-row-main">
          <a href={r.href}><strong>{text(r.title)}</strong></a>
          <span className="small muted">{day(r.date)} · <span className={chipClass(r.module)}>{HMOD_LABEL[r.module]}</span> <span className={`hh-chip c-${r.certainty}`}>{CERTAINTY_LABEL[r.certainty]}</span></span>
          {r.note && <span className="small muted">{text(r.note)}</span>}
          {r.foldedInto && <span className="small">Same expense as the linked bill{into ? ` ${text(into)}` : ''}; kept here but not added again.</span>}
        </span>
        <span>{r.cents === null ? <span className="muted">Amount not known</span> : <Amt c={r.cents} money={money} />}</span>
      </div>
    </li>
  );
}

function Overlap({ c, money, text }: { c: Consolidation; money: Money; text: Text }) {
  return (
    <p className={c.status === 'folded' ? 'hh-note' : 'hh-warn'} role="note">
      <strong>{text(c.billTitle)} (Bills) and {text(c.arrangementTitle)} (Household Services).</strong> {c.reason}
      {c.status !== 'folded' && <> Over this period the total may be overstated by {c.exposureIsFloor ? 'at least ' : 'up to '}<strong className="hh-amt">{money(c.exposureCents)}</strong>.</>}
    </p>
  );
}

export function UpcomingCard({ c, money, text }: { c: HouseholdCommitments; money: Money; text: Text }) {
  const [days, setDays] = useState<7 | 30 | 90>(30);
  const w: WindowFigures = c.windows.find((x) => x.days === days)!;
  const billTitles = new Map(w.consolidations.map((x) => [`bill:${x.billId}`, x.billTitle]));
  const [all, setAll] = useState(false);
  const shown = all ? w.rows : w.rows.slice(0, 8);
  return (
    <section className="card hh-card" aria-labelledby="hh-up-h">
      <div className="hh-card-head"><h2 id="hh-up-h">Expected payments</h2><Seg legend="How far ahead" name="hh-days" value={days} onChange={setDays} options={[{ id: 7, label: '7 days' }, { id: 30, label: '30 days' }, { id: 90, label: '90 days' }]} /></div>
      <p className="hh-lede">What is anticipated from today to {day(w.to)}. Expected, not spent. Bills count what is still to pay; service visits are estimates.</p>
      <TotalsFigs t={w.totals} money={money} />
      {w.consolidations.map((x) => <Overlap key={`${x.billId}:${x.arrangementId}`} c={x} money={money} text={text} />)}
      {w.notConverted.length > 0 && <p className="small muted">{n(w.notConverted.length, 'service arrangement has', 'service arrangements have')} an estimate that is not per visit (for example per month). It is not turned into a figure for this period and is counted as not known.</p>}
      {w.rows.length === 0 ? <p className="muted">Nothing is expected in the next {days} days.</p> : (
        <>
          <ul className="plain hh-list">{shown.map((r) => <RowLine key={r.id} r={r} money={money} text={text} billTitles={billTitles} />)}</ul>
          {w.rows.length > 8 && <button type="button" className="btn" onClick={() => setAll(!all)} aria-expanded={all}>{all ? 'Show fewer' : `Show all ${w.rows.length}`}</button>}
        </>
      )}
    </section>
  );
}

// ---- commitments (twelve months) ----

export function CommitmentsCard({ c, money, text }: { c: HouseholdCommitments; money: Money; text: Text }) {
  const t = c.twelve;
  return (
    <section className="card hh-card" aria-labelledby="hh-com-h">
      <h2 id="hh-com-h">Commitments for the next twelve months</h2>
      <p className="hh-lede">What your bills and standing services add up to if nothing changes, from {day(t.from)} to {day(t.to)}. These are plans, not payments, and not a forecast of your bank balance.</p>
      <TotalsFigs t={t.totals} money={money} />
      <ul className="plain hh-list">
        <li><div className="hh-row"><span><span className={chipClass('bills')}>{HMOD_LABEL.bills}</span> known <Amt c={t.bills.known.cents} money={money} />{t.bills.estimated.cents > 0 && <>, estimated <Amt c={t.bills.estimated.cents} money={money} /></>}</span><span className="small muted">{n(t.bills.unknown.periods, 'date', 'dates')} with no amount{t.disputedBills > 0 ? `, ${n(t.disputedBills, 'bill', 'bills')} with a disputed price` : ''}</span></div></li>
        <li><div className="hh-row"><span><span className={chipClass('services')}>{HMOD_LABEL.services}</span> estimated <Amt c={t.services.estimateCents} money={money} /></span><span className="small muted">{t.servicesNoEstimate > 0 ? `${n(t.servicesNoEstimate, 'arrangement has', 'arrangements have')} visits but no estimate` : 'per-visit estimates only'}</span></div></li>
        <li><div className="hh-row"><span><span className={chipClass('home')}>{HMOD_LABEL.home}</span> nothing</span><span className="small muted">{c.homeAssets.why}</span></div></li>
      </ul>
      {t.consolidations.map((x) => <Overlap key={`${x.billId}:${x.arrangementId}`} c={x} money={money} text={text} />)}
      {c.loansExcluded > 0 && <p className="small muted">{n(c.loansExcluded, 'bill is', 'bills are')} left out because Loans owns {c.loansExcluded === 1 ? 'its' : 'their'} payments.</p>}
    </section>
  );
}

// ---- recorded spending ----

const STATUS_WORDS = { pending: 'pending in Finance', cleared: 'marked cleared in Finance', reconciled: 'marked reconciled in Finance', other: 'with no status' } as const;

export function SpendingCard({ s, periodLabel, periodOptions, period, onPeriod, money }: { s: RecordedAcrossModules; periodLabel: string; periodOptions: { id: string; label: string }[]; period: string; onPeriod: (p: string) => void; money: Money }) {
  return (
    <section className="card hh-card" aria-labelledby="hh-rec-h">
      <div className="hh-card-head">
        <h2 id="hh-rec-h">Recorded spending</h2>
        <label className="small">Period <select value={period} onChange={(e) => onPeriod(e.target.value)} aria-label="Period for recorded spending">{periodOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select></label>
      </div>
      <p className="hh-lede">{periodLabel}. Each payment counted once, however many records point at it. This is what is recorded in Bills, Household Services and Home &amp; Assets, not all of your spending.</p>
      <p className="hh-big" aria-label="Recorded spending total">{money(s.totalCents)}</p>
      <dl className="hh-figs">
        <div className="hh-fig k-known"><dt>Backed by Finance transactions</dt><dd><Amt c={s.financeCents} money={money} /><Count>{n(s.pieces.length, 'payment', 'payments')}</Count></dd></div>
        <div className="hh-fig"><dt>Typed as paid outside Finance</dt><dd><Amt c={s.typedCents} money={money} /><Count>{n(s.typed.filter((t) => t.authoritative).length, 'entry', 'entries')}</Count></dd></div>
        <div className="hh-fig"><dt>Money back (refunds) already subtracted</dt><dd><Amt c={s.moneyBackCents} money={money} /></dd></div>
      </dl>
      {(s.statusCents.pending !== 0) && <p className="small muted">Of the Finance-backed amount, {money(s.statusCents.pending)} is {STATUS_WORDS.pending}. Finance's words are marks you keep, not proof that the bank has settled.</p>}
      {!s.reconciled ? (
        <div className="hh-warn" role="status"><strong>Some spending relationships need review.</strong> This figure counts what is recorded, but:<ul className="plain">{s.caveats.map((c) => <li key={c}>{c}.</li>)}</ul></div>
      ) : <p className="hh-ok" role="status"><strong>Cross-module totals verified.</strong> Nothing unresolved is affecting this figure. This compares Ledger's own records with each other; it is not a check against a bank statement.</p>}
      {(s.unknown.completedVisits > 0 || s.unknown.homeWork > 0) && <p className="small muted">{[s.unknown.completedVisits > 0 ? `${n(s.unknown.completedVisits, 'completed visit has', 'completed visits have')} no payment recorded` : '', s.unknown.homeWork > 0 ? `${n(s.unknown.homeWork, 'maintenance record has', 'maintenance records have')} no cost recorded` : ''].filter(Boolean).join('; ')}. Those are unknown, not zero.</p>}
    </section>
  );
}

// ---- by household area, and why it differs from the module pages ----

export function AreasCard({ s, money }: { s: RecordedAcrossModules; money: Money }) {
  const r = s.reconciliation;
  return (
    <section className="card hh-card" aria-labelledby="hh-area-h">
      <h2 id="hh-area-h">Spending by household area</h2>
      <p className="hh-lede">Each payment is credited to the one area whose records link it, or to "Shared between modules" when more than one does. The rows add up to the total.</p>
      <table className="hh-table">
        <caption className="sr-only">Recorded spending by household area</caption>
        <thead><tr><th scope="col">Area</th><th scope="col" className="num">Recorded</th></tr></thead>
        <tbody>
          {ATTRIBUTION_ORDER.map((a) => <tr key={a}><th scope="row" className="small">{ATTRIBUTION_LABEL[a]}</th><td className="num"><Amt c={s.byAttribution[a]} money={money} /></td></tr>)}
        </tbody>
        <tfoot><tr><th scope="row">Total recorded</th><td className="num"><Amt c={s.totalCents} money={money} /></td></tr></tfoot>
      </table>
      <details className="hh-det">
        <summary>Why this is less than the three module pages added together</summary>
        <p className="small">Each module page shows everything that module links: Bills <Amt c={s.moduleOwnCents.bills} money={money} />, Household Services <Amt c={s.moduleOwnCents.services} money={money} />, Home &amp; Assets <Amt c={s.moduleOwnCents.home} money={money} />. Those add up to <Amt c={r.simpleSumCents} money={money} />, which is <Amt c={r.differenceCents} money={money} /> more than the household counts, because a payment linked from several places is counted once here:</p>
        <ul className="hh-recon small">
          <li>Shared between Household Services and Home &amp; Assets: <Amt c={r.withinServicesHomeCents} money={money} /></li>
          <li>Also linked from Bills: <Amt c={r.alsoInBillsCents} money={money} /></li>
          <li>A part of a transaction whose whole is counted elsewhere: <Amt c={r.coveredAcrossBillsCents} money={money} /></li>
        </ul>
        <p className="small muted">{r.explainsDifference ? 'These three lines account for the whole difference.' : 'These lines do not account for the whole difference. Please report this.'}</p>
      </details>
      {s.byCategory.length > 0 && (
        <details className="hh-det">
          <summary>By kind of spending <Count>{s.byCategory.length}</Count></summary>
          <table className="hh-table"><tbody>{s.byCategory.map((c) => <tr key={c.category}><th scope="row" className="small">{c.category}</th><td className="num"><Amt c={c.cents} money={money} /></td></tr>)}</tbody></table>
        </details>
      )}
    </section>
  );
}

// ---- every counted payment (the reconciliation trace) ----

export function TraceCard({ s, money, text }: { s: RecordedAcrossModules; money: Money; text: Text }) {
  const typed = s.typed;
  return (
    <section className="card hh-card" aria-labelledby="hh-trace-h">
      <h2 id="hh-trace-h">What is counted</h2>
      <p className="hh-lede">Every figure above is the sum of these lists: <Amt c={s.proof.piecesCents} money={money} /> from Finance payments plus <Amt c={s.proof.typedCents} money={money} /> typed = <Amt c={s.proof.sumCents} money={money} />.</p>
      <details className="hh-det">
        <summary>Finance payments counted <Count>{s.pieces.length}</Count></summary>
        {s.pieces.length === 0 ? <p className="muted">None in this period.</p> : (
          <ul className="plain hh-list">
            {s.pieces.map((p) => (
              <li key={p.key}>
                <div className="hh-row">
                  <span className="hh-row-main">
                    <span className="small muted">{p.date ? day(p.date) : 'Date not found'} · {p.part === null ? 'whole transaction' : `part ${p.part + 1} of a split`}{p.status ? ` · ${p.status} in Finance` : ''}{p.changed ? ' · changed since linked' : ''}</span>
                    <span className="small"><span className={chipClass(p.attribution)}>{ATTRIBUTION_LABEL[p.attribution]}</span>{p.category !== ATTRIBUTION_LABEL[p.attribution] && ` ${p.category}`}</span>
                  </span>
                  <Amt c={p.cents} money={money} />
                </div>
                <div className="small">Linked from: {p.associations.map((a, i) => <span key={`${a.recordId}${a.via}`}>{i > 0 && '; '}<a href={a.href}>{text(a.title)}</a> <span className={chipClass(a.module)}>{HMOD_LABEL[a.module]}</span>{a.via === 'covered-part' && ' (a part, covered by the whole)'}</span>)}</div>
                <div className="small muted">{p.why}</div>
              </li>
            ))}
          </ul>
        )}
      </details>
      <details className="hh-det">
        <summary>Typed as paid outside Finance <Count>{typed.length}</Count></summary>
        {typed.length === 0 ? <p className="muted">None in this period.</p> : (
          <ul className="plain hh-list">
            {typed.map((t) => (
              <li key={`${t.recordId}:${t.cents}:${t.authoritative}`}>
                <div className="hh-row"><span className="hh-row-main"><a href={t.href}>{text(t.title)}</a><span className="small muted"><span className={chipClass(t.module)}>{HMOD_LABEL[t.module]}</span> {t.date ? day(t.date) : 'undated'} · {t.authoritative ? 'counted' : 'kept, not counted'}</span></span><Amt c={t.cents} money={money} /></div>
                <div className="small muted">{t.note}</div>
              </li>
            ))}
          </ul>
        )}
      </details>
    </section>
  );
}

// ---- needs review ----

const GOOD: ReviewClass[] = ['informational'];
export function ReviewCard({ items, text }: { items: ReviewItem[]; text: Text }) {
  const groups = (Object.keys(REVIEW_CLASS_LABEL) as ReviewClass[]).map((c) => ({ c, rows: items.filter((i) => i.class === c) })).filter((g) => g.rows.length > 0);
  const action = groups.filter((g) => !GOOD.includes(g.c));
  const good = groups.filter((g) => GOOD.includes(g.c));
  const body = (rows: ReviewItem[]) => (
    <ul className="plain hh-list">{rows.map((i) => (
      <li key={i.id}><div>{text(i.text)}</div>{i.links.length > 0 && <div className="hh-links small">{i.links.map((l) => <a key={l.href} href={l.href}>{text(l.label)}</a>)}</div>}</li>
    ))}</ul>
  );
  const nAction = action.reduce((t, g) => t + g.rows.length, 0);
  return (
    <section className="card hh-card" aria-labelledby="hh-rev-h">
      <div className="hh-card-head"><h2 id="hh-rev-h">Needs review</h2>{nAction > 0 && <Count>{nAction}</Count>}</div>
      {nAction === 0 ? <p className="hh-ok">Nothing needs a look.</p> : <p className="hh-lede">Nothing here is changed for you. Each item links to the record where you can look at it and decide.</p>}
      {action.map((g) => <div key={g.c}><h3 className="hh-group">{REVIEW_CLASS_LABEL[g.c]} <Count>{g.rows.length}</Count></h3>{body(g.rows)}</div>)}
      {good.map((g) => <details key={g.c} className="hh-det"><summary>{REVIEW_CLASS_LABEL[g.c]} <Count>{g.rows.length}</Count></summary>{body(g.rows)}</details>)}
    </section>
  );
}

// ---- contractual actions ----

export function ActionsCard({ actions, text }: { actions: ContractAction[]; text: Text }) {
  const ago = (d: number) => (d === 0 ? 'today' : d > 0 ? `in ${n(d, 'day', 'days')}` : `${n(-d, 'day', 'days')} ago`);
  return (
    <section className="card hh-card" aria-labelledby="hh-act-h">
      <h2 id="hh-act-h">Upcoming contractual actions</h2>
      <p className="hh-lede">Trials ending, renewals, cancel-by deadlines and cancellation requests waiting for an answer, over the next 90 days. Ledger never renews, converts or cancels anything for you.</p>
      {actions.length === 0 ? <p className="muted">No contract dates in the next 90 days.</p> : (
        <ul className="plain hh-list">
          {actions.map((a) => (
            <li key={a.id}><div className="hh-row"><span className="hh-row-main"><a href={a.href}><strong>{text(a.title)}</strong></a><span className="small muted">{a.label} · {day(a.date)} ({ago(a.daysAway)}) · <span className={chipClass(a.module)}>{HMOD_LABEL[a.module]}</span></span>{a.note && <span className="small muted">{text(a.note)}</span>}</span></div></li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---- where things are managed ----

export function ManagedCard({ managed }: { managed: Record<'bills' | 'services' | 'home', number> }) {
  const rows: { m: 'bills' | 'services' | 'home'; href: string; what: string }[] = [
    { m: 'bills', href: '#/bills', what: managed.bills === 1 ? 'active bill or subscription' : 'active bills and subscriptions' },
    { m: 'services', href: '#/services', what: managed.services === 1 ? 'active service arrangement' : 'active service arrangements' },
    { m: 'home', href: '#/assets', what: managed.home === 1 ? 'asset or property' : 'assets and properties' },
  ];
  return (
    <section className="card hh-card" aria-labelledby="hh-man-h">
      <h2 id="hh-man-h">Where things are managed</h2>
      <ul className="plain hh-list">{rows.map((r) => <li key={r.m}><div className="hh-row"><a href={r.href}><strong>{HMOD_LABEL[r.m]}</strong></a><span className="small muted"><Count>{managed[r.m]}</Count> {r.what}</span></div></li>)}</ul>
    </section>
  );
}
