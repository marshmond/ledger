import { useState, type ReactNode } from 'react';
import { dayLabel } from '../../core/time';
import { formatCents } from '../../lib/money';
import { maskMoney } from '../../ui/TxnRefs';
import { loadHideAmounts } from '../../core/hideAmounts';
import { DateTile } from '../../ui/DateTile';
import { Figure } from '../../ui/Figure';
import { Icon, type IconName } from '../../ui/icons';
import type { CommitmentRow, Consolidation, HouseholdCommitments, Totals, WindowFigures } from './commitments';
import { ATTRIBUTION_LABEL, ATTRIBUTION_ORDER, CERTAINTY_LABEL, HMOD_LABEL, REVIEW_CLASS_LABEL, type Certainty, type HMod, type ReviewClass } from './model';
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
/** The words are always present; the shape (check, wave, question mark) and the edge only reinforce them. */
const CERT_ICON: Record<Certainty, IconName> = { known: 'check', estimated: 'wave', unknown: 'help', disputed: 'warning' };
const CertaintyChip = ({ c }: { c: Certainty }) => <span className={`hh-chip c-${c}`}><Icon name={CERT_ICON[c]} size={12} />{CERTAINTY_LABEL[c]}</span>;

/** Moves the reader to a section on this page. (The app uses hash routes, so a "#section" link would leave the page.) */
function jump(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ block: 'start' });
  el.focus({ preventScroll: true });
}

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
    <details className="hh-det hh-readme">
      <summary><Icon name="info" size={16} />How to read this page<span className="hh-pills" aria-hidden="true"><span className="hh-pill hh-pill--exp">Expected</span><span className="hh-pill hh-pill--com">Committed</span><span className="hh-pill hh-pill--rec">Recorded</span></span></summary>
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

// ---- the three summary tiles (Expected, Committed, Recorded). They only repeat figures the sections below already show; nothing is added across them. ----

function TileCounts({ t, money }: { t: Totals; money: Money }) {
  return (
    <div className="hh-tile-figs">
      <Figure label="Known amounts" value={money(t.known.cents)} description={n(t.known.count, 'payment', 'payments')} />
      <Figure certainty="estimated" label="Estimated amounts" value={money(t.estimated.cents)} description={n(t.estimated.count, 'payment', 'payments')} />
      <Figure certainty="unknown" label="Amount not known" value={n(t.unknown.count, 'item', 'items')} description="not added, and not zero" />
      {t.disputed.count > 0 && <DisputedFigure count={t.disputed.count} />}
    </div>
  );
}

export function SummaryTiles({ c, s, days, periodLabel, hide = false, money }: { c: HouseholdCommitments; s: RecordedAcrossModules; days: 7 | 30 | 90; periodLabel: string; hide?: boolean; money: Money }) {
  const w: WindowFigures = c.windows.find((x) => x.days === days)!;
  const split = !hide && s.totalCents > 0 && s.financeCents >= 0 && s.typedCents >= 0 ? Math.min(1, s.financeCents / s.totalCents) : null; // a drawing only; no number comes from it
  return (
    <div className="hh-tiles" role="group" aria-label="Summary: expected, committed and recorded">
      <section className="hh-tile hh-tile--exp" aria-labelledby="hh-t-exp">
        <div className="hh-tile-head"><h2 id="hh-t-exp" className="hh-tile-title">Expected</h2><span className="hh-tag">Not spent yet</span></div>
        <p className="hh-tile-win">Next {days} days, to {day(w.to)}</p>
        <TileCounts t={w.totals} money={money} />
        <button type="button" className="link hh-jump" onClick={() => jump('hh-up-h')}>See expected payments</button>
      </section>
      <section className="hh-tile hh-tile--com" aria-labelledby="hh-t-com">
        <div className="hh-tile-head"><h2 id="hh-t-com" className="hh-tile-title">Committed</h2><span className="hh-tag">Plans, not payments</span></div>
        <p className="hh-tile-win">Next 12 months, to {day(c.twelve.to)}</p>
        <TileCounts t={c.twelve.totals} money={money} />
        <button type="button" className="link hh-jump" onClick={() => jump('hh-com-h')}>See commitments</button>
      </section>
      <section className="hh-tile hh-tile--rec" aria-labelledby="hh-t-rec">
        <div className="hh-tile-head"><h2 id="hh-t-rec" className="hh-tile-title">Recorded</h2><span className="hh-tag">Backed by a record</span></div>
        <p className="hh-tile-win">{periodLabel}</p>
        <p className="hh-tile-total" aria-label="Recorded spending total">{money(s.totalCents)}</p>
        <p className="small muted">Each payment counted once. Not all of your spending.</p>
        {split !== null && <div className="hh-split" aria-hidden="true"><span style={{ width: `${split * 100}%` }} /></div>}
        <p className="hh-split-key small"><span className="hh-keyitem"><span className="hh-key hh-key--fin" aria-hidden="true" />Backed by Finance <Amt c={s.financeCents} money={money} /></span><span className="hh-keyitem"><span className="hh-key hh-key--typed" aria-hidden="true" />Typed outside Finance <Amt c={s.typedCents} money={money} /></span></p>
        <button type="button" className="link hh-jump" onClick={() => jump('hh-rec-h')}>See recorded spending</button>
      </section>
    </div>
  );
}

// ---- expected payments (7 / 30 / 90 days) ----

function DisputedFigure({ count }: { count: number }) {
  return (
    <div className="ui-figure ui-figure--unknown hh-dispute">
      <div className="ui-figure-label">Amount in dispute</div>
      <div className="ui-figure-value">{n(count, 'item', 'items')}</div>
      <span className="ui-figure-tag"><Icon name="warning" size={12} />In dispute</span>
      <div className="ui-figure-desc">not added</div>
    </div>
  );
}

function TotalsFigs({ t, money }: { t: Totals; money: Money }) {
  return (
    <div className="hh-figs" role="group" aria-label="Amounts by how sure they are">
      <Figure label="Known amounts" value={money(t.known.cents)} description={n(t.known.count, 'payment', 'payments')} />
      <Figure certainty="estimated" label="Estimated amounts" value={money(t.estimated.cents)} description={n(t.estimated.count, 'payment', 'payments')} />
      <Figure certainty="unknown" label="Amount not known" value={n(t.unknown.count, 'item', 'items')} description="not added, and not zero" />
      {t.disputed.count > 0 && <DisputedFigure count={t.disputed.count} />}
    </div>
  );
}

function RowLine({ r, today, money, text, billTitles }: { r: CommitmentRow; today: string; money: Money; text: Text; billTitles: Map<string, string> }) {
  const into = r.foldedInto ? billTitles.get(r.foldedInto) : undefined;
  return (
    <li className={`hh-prow${r.foldedInto ? ' hh-folded' : ''}`}>
      <DateTile iso={r.date} today={today} size="sm" labelled={false} />
      <span className="hh-prow-main">
        <a href={r.href}><strong>{text(r.title)}</strong></a>
        <span className="small muted">{day(r.date)}</span>
        {r.note && <span className="small muted">{text(r.note)}</span>}
        {r.foldedInto && <span className="small">Same expense as the linked bill{into ? ` ${text(into)}` : ''}; kept here but not added again.</span>}
      </span>
      <span className="hh-prow-tags"><span className={chipClass(r.module)}>{HMOD_LABEL[r.module]}</span><CertaintyChip c={r.certainty} /></span>
      <span className="hh-prow-amt">{r.cents === null ? <span className="hh-unknown">Amount not known</span> : <Amt c={r.cents} money={money} />}</span>
    </li>
  );
}

function Overlap({ c, money, text }: { c: Consolidation; money: Money; text: Text }) {
  return (
    <p className={c.status === 'folded' ? 'hh-note' : 'hh-warn'} role="note">
      {c.status !== 'folded' && <Icon name="warning" size={18} className="hh-callout-ic" />}
      <span><strong>{text(c.billTitle)} (Bills) and {text(c.arrangementTitle)} (Household Services).</strong> {c.reason}
      {c.status !== 'folded' && <> Over this period the total may be overstated by {c.exposureIsFloor ? 'at least ' : 'up to '}<strong className="hh-amt">{money(c.exposureCents)}</strong>.</>}</span>
    </p>
  );
}

export function UpcomingCard({ c, money, text, days: daysIn, onDays }: { c: HouseholdCommitments; money: Money; text: Text; days?: 7 | 30 | 90; onDays?: (d: 7 | 30 | 90) => void }) {
  const [inner, setInner] = useState<7 | 30 | 90>(30);
  const days = daysIn ?? inner;
  const setDays = onDays ?? setInner;
  const w: WindowFigures = c.windows.find((x) => x.days === days)!;
  const billTitles = new Map(w.consolidations.map((x) => [`bill:${x.billId}`, x.billTitle]));
  const [all, setAll] = useState(false);
  const shown = all ? w.rows : w.rows.slice(0, 8);
  return (
    <section className="card hh-card hh-card--exp" aria-labelledby="hh-up-h">
      <div className="hh-card-head">
        <div><span className="ui-eyebrow">Expected · not spent yet</span><h2 id="hh-up-h" tabIndex={-1}>Expected payments</h2></div>
        <Seg legend="How far ahead" name="hh-days" value={days} onChange={setDays} options={[{ id: 7, label: '7 days' }, { id: 30, label: '30 days' }, { id: 90, label: '90 days' }]} />
      </div>
      <p className="hh-lede">What is anticipated from today to {day(w.to)}. Expected, not spent. Bills count what is still to pay; service visits are estimates.</p>
      <TotalsFigs t={w.totals} money={money} />
      {w.consolidations.map((x) => <Overlap key={`${x.billId}:${x.arrangementId}`} c={x} money={money} text={text} />)}
      {w.notConverted.length > 0 && <p className="small muted">{n(w.notConverted.length, 'service arrangement has', 'service arrangements have')} an estimate that is not per visit (for example per month). It is not turned into a figure for this period and is counted as not known.</p>}
      {w.rows.length === 0 ? <p className="muted">Nothing is expected in the next {days} days.</p> : (
        <>
          <ul className="plain hh-list hh-plist">{shown.map((r) => <RowLine key={r.id} r={r} today={w.from} money={money} text={text} billTitles={billTitles} />)}</ul>
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
    <section className="card hh-card hh-card--com" aria-labelledby="hh-com-h">
      <span className="ui-eyebrow">Committed · plans, not payments</span>
      <h2 id="hh-com-h" tabIndex={-1}>Commitments for the next twelve months</h2>
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

export function SpendingCard({ s, periodLabel, periodOptions, period, onPeriod, money, hide = false }: { s: RecordedAcrossModules; periodLabel: string; periodOptions: { id: string; label: string }[]; period: string; onPeriod: (p: string) => void; money: Money; hide?: boolean }) {
  const split = !hide && s.totalCents > 0 && s.financeCents >= 0 && s.typedCents >= 0 ? Math.min(1, s.financeCents / s.totalCents) : null; // a drawing only
  return (
    <section className="card hh-card hh-card--rec" aria-labelledby="hh-rec-h">
      <div className="hh-card-head">
        <div><span className="ui-eyebrow">Recorded · what the records support</span><h2 id="hh-rec-h" tabIndex={-1}>Recorded spending</h2></div>
        <label className="small">Period <select value={period} onChange={(e) => onPeriod(e.target.value)} aria-label="Period for recorded spending">{periodOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select></label>
      </div>
      <p className="hh-lede">{periodLabel}. Each payment counted once, however many records point at it. This is what is recorded in Bills, Household Services and Home &amp; Assets, not all of your spending.</p>
      <p className="hh-big" aria-label="Recorded spending total">{money(s.totalCents)}</p>
      {split !== null && <div className="hh-split" aria-hidden="true"><span style={{ width: `${split * 100}%` }} /></div>}
      <div className="hh-figs" role="group" aria-label="What the total is made of">
        <Figure label="Backed by Finance transactions" value={money(s.financeCents)} description={n(s.pieces.length, 'payment', 'payments')} />
        <Figure label="Typed as paid outside Finance" value={money(s.typedCents)} description={n(s.typed.filter((t) => t.authoritative).length, 'entry', 'entries')} />
        <Figure label="Money back (refunds) already subtracted" value={money(s.moneyBackCents)} />
      </div>
      {(s.statusCents.pending !== 0) && <p className="small muted">Of the Finance-backed amount, {money(s.statusCents.pending)} is {STATUS_WORDS.pending}. Finance's words are marks you keep, not proof that the bank has settled.</p>}
      {!s.reconciled ? (
        <div className="hh-warn" role="status"><Icon name="warning" size={18} className="hh-callout-ic" /><div><strong>Some spending relationships need review.</strong> This figure counts what is recorded, but:<ul className="plain">{s.caveats.map((c) => <li key={c}>{c}.</li>)}</ul></div></div>
      ) : <p className="hh-ok" role="status"><Icon name="check" size={18} className="hh-callout-ic" /><span><strong>Cross-module totals verified.</strong> Nothing unresolved is affecting this figure. This compares Ledger's own records with each other; it is not a check against a bank statement.</span></p>}
      {(s.unknown.completedVisits > 0 || s.unknown.homeWork > 0) && (
        <p className="hh-unknown-note small"><Icon name="help" size={16} className="hh-callout-ic" /><span>{[s.unknown.completedVisits > 0 ? `${n(s.unknown.completedVisits, 'completed visit has', 'completed visits have')} no payment recorded` : '', s.unknown.homeWork > 0 ? `${n(s.unknown.homeWork, 'maintenance record has', 'maintenance records have')} no cost recorded` : ''].filter(Boolean).join('; ')}. Those are unknown, not zero.</span></p>
      )}
    </section>
  );
}

// ---- by household area, and why it differs from the module pages ----

export function AreasCard({ s, money, hide = false }: { s: RecordedAcrossModules; money: Money; hide?: boolean }) {
  const r = s.reconciliation;
  const ratio = (c: number) => (hide || s.totalCents <= 0 || c < 0 ? null : Math.min(1, c / s.totalCents)); // a drawing only
  return (
    <section className="card hh-card" aria-labelledby="hh-area-h">
      <span className="ui-eyebrow">Recorded spending</span>
      <h2 id="hh-area-h">Spending by household area</h2>
      <p className="hh-lede">Each payment is credited to the one area whose records link it, or to "Shared between modules" when more than one does. The rows add up to the total.</p>
      <table className="hh-table">
        <caption className="sr-only">Recorded spending by household area</caption>
        <thead><tr><th scope="col">Area</th><th scope="col" className="num">Recorded</th></tr></thead>
        <tbody>
          {ATTRIBUTION_ORDER.map((a) => {
            const f = ratio(s.byAttribution[a]);
            return (
              <tr key={a}><th scope="row" className="small">{ATTRIBUTION_LABEL[a]}{f !== null && <span className="hh-areabar" aria-hidden="true"><span className={`hh-areabar-fill a-${a}`} style={{ width: `${f * 100}%` }} /></span>}</th><td className="num"><Amt c={s.byAttribution[a]} money={money} /></td></tr>
            );
          })}
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
      <span className="ui-eyebrow">Reconciliation</span>
      <h2 id="hh-trace-h">What is counted</h2>
      <p className="sr-only">Every figure above is the sum of these lists: {money(s.proof.piecesCents)} from Finance payments plus {money(s.proof.typedCents)} typed = {money(s.proof.sumCents)}.</p>
      <p className="hh-lede" aria-hidden="true">Every figure above is the sum of these lists:</p>
      <div className="hh-eq" aria-hidden="true">
        <div className="hh-eqbox"><span>Finance payments</span><Amt c={s.proof.piecesCents} money={money} /></div>
        <span className="hh-eqop">+</span>
        <div className="hh-eqbox"><span>Typed outside Finance</span><Amt c={s.proof.typedCents} money={money} /></div>
        <span className="hh-eqop">=</span>
        <div className="hh-eqbox hh-eqbox--sum"><span>Recorded total</span><Amt c={s.proof.sumCents} money={money} /></div>
      </div>
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
      <li key={i.id}><div>{text(i.text)}</div>{i.links.length > 0 && <div className="hh-links small">{i.links.map((l) => <a key={l.href} href={l.href} className="hh-link">{text(l.label)}<Icon name="external" size={12} /></a>)}</div>}</li>
    ))}</ul>
  );
  const nAction = action.reduce((t, g) => t + g.rows.length, 0);
  return (
    <section className={`card hh-card hh-card--review${nAction > 0 ? ' needs' : ''}`} aria-labelledby="hh-rev-h">
      <div className="hh-card-head"><h2 id="hh-rev-h">{nAction > 0 && <Icon name="warning" size={18} className="hh-callout-ic" />}Needs review</h2>{nAction > 0 && <Count>{nAction}</Count>}</div>
      {nAction === 0 ? <p className="hh-ok"><Icon name="check" size={18} className="hh-callout-ic" /><span>Nothing needs a look.</span></p> : <p className="hh-lede">Nothing here is changed for you. Each item links to the record where you can look at it and decide.</p>}
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
      <span className="ui-eyebrow">Contract dates</span>
      <h2 id="hh-act-h">Upcoming contractual actions</h2>
      <p className="hh-lede">Trials ending, renewals, cancel-by deadlines and cancellation requests waiting for an answer, over the next 90 days. Ledger never renews, converts or cancels anything for you.</p>
      {actions.length === 0 ? <p className="hh-empty"><Icon name="calendar" size={18} />No contract dates in the next 90 days.</p> : (
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

const MOD_ICON: Record<HMod, IconName> = { bills: 'receipt', services: 'wrench', home: 'home' };

export function ManagedCard({ managed }: { managed: Record<'bills' | 'services' | 'home', number> }) {
  const rows: { m: 'bills' | 'services' | 'home'; href: string; what: string }[] = [
    { m: 'bills', href: '#/bills', what: managed.bills === 1 ? 'active bill or subscription' : 'active bills and subscriptions' },
    { m: 'services', href: '#/services', what: managed.services === 1 ? 'active service arrangement' : 'active service arrangements' },
    { m: 'home', href: '#/assets', what: managed.home === 1 ? 'asset or property' : 'assets and properties' },
  ];
  return (
    <section className="card hh-card" aria-labelledby="hh-man-h">
      <h2 id="hh-man-h">Where things are managed</h2>
      <ul className="plain hh-list">{rows.map((r) => <li key={r.m}><div className="hh-row hh-mrow"><span className="hh-mic" aria-hidden="true"><Icon name={MOD_ICON[r.m]} size={18} /></span><span className="hh-row-main"><a href={r.href}><strong>{HMOD_LABEL[r.m]}</strong></a><span className="small muted"><Count>{managed[r.m]}</Count> {r.what}</span></span></div></li>)}</ul>
    </section>
  );
}
