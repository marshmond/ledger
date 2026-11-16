import { useMemo, useState, type ReactNode } from 'react';
import { Link } from '../../../core/router';
import { AttentionProviders } from '../../../core/AttentionProviders';
import { HIDE_AMOUNTS_KEY, HIDE_AMOUNTS_SCOPE, loadHideAmounts, saveHideAmounts } from '../../../core/hideAmounts';
import { dayLabel } from '../../../core/time';
import { addDays } from '../../../lib/dates';
import { PageHeader } from '../../../ui/components';
import { DateTile } from '../../../ui/DateTile';
import { Icon } from '../../../ui/icons';
import { MemberChip } from '../../../ui/MemberIdentity';
import type { MemberColorId } from '../../../ui/memberIdentityModel';
import type { WeekPerson } from '../../../core/weekReaders';
import { StatusChip, type StatusTone } from '../../../ui/StatusChip';
import { useToday } from '../../../ui/useToday';
import CardBoundary from '../CardBoundary';
import { NEEDS_PATH, NeedsRow } from '../NeedsYou';
import { openItem, openLabel } from '../TodayRow';
import { kindIcon } from '../todayModel';
import { moduleOf } from '../logic';
import type { CalItem } from '../../calendar/useCalendarData';
import './week.css';
import { useWeekInputs } from './useWeekInputs';
import { buildWeekReview, type WeekReview } from './weekModel';
import {
  CERTAINTY_WORDS, WEEK_SUBTITLE, WEEK_TITLE, cashLine, dayHeading, homeChip, homeDetail, itemTime, rowAmount, text, totalsLines, weekText,
} from './weekText';

const TONE: Record<string, StatusTone> = { overdue: 'overdue', warning: 'warning', info: 'info' };
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Copies text with the clipboard when the browser allows it, else the old select-and-copy way. Returns whether it worked. */
async function copyText(s: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(s); return true; } catch { /* fall through */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = s; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch { return false; }
}

function Card({ id, title, intro, count, link, children }: { id: string; title: string; intro?: string; count?: number; link?: ReactNode; children: ReactNode }) {
  return (
    <section className="card td-card wk-card" aria-labelledby={id}>
      <div className="card-head">
        <h2 className="card-title" id={id}>{title}</h2>
        {count !== undefined && count > 0 && <span className="badge" aria-label={plural(count, 'item')}>{count}</span>}
        {link}
      </div>
      {intro && <p className="muted small wk-intro">{intro}</p>}
      {children}
    </section>
  );
}

/** Everyone a row names: the member's own color dot and NAME (color is never the only cue), each linking to that member in Family. */
function People({ people }: { people: readonly WeekPerson[] }) {
  return (
    <span className="wk-people">
      {people.map((p) => <a key={p.memberId} href={p.href} className="wk-person"><MemberChip colorId={p.colorId as MemberColorId | null}>{p.name}</MemberChip></a>)}
    </span>
  );
}

/** One schedule row: read only. Opens the item where it lives; there is no check box here (marking things done stays on Today and in Tasks). */
function ScheduleRow({ item, hide }: { item: CalItem; hide: boolean }) {
  const title = text(item.title, hide);
  return (
    <li className="wk-row">
      <span className="wk-when">{itemTime(item)}</span>
      <span className="wk-kind" aria-hidden="true"><Icon name={kindIcon(moduleOf(item))} size={16} /></span>
      <span className="wk-main">
        <button type="button" className="td-title wk-title" onClick={() => openItem(item)} aria-label={`${title}. ${openLabel(item)}`}>{title}</button>
        <span className="wk-sub"><span className="wk-when-inline">{itemTime(item)} · </span>{item.layerName}{item.location ? ` · ${item.location}` : ''}</span>
      </span>
    </li>
  );
}

function NeedsCard({ r, hide }: { r: WeekReview; hide: boolean }) {
  if (r.needs.state !== 'ready' || r.needs.data.total === 0) return null;
  const n = r.needs.data;
  return (
    <Card id="wk-needs" title="Needs you" count={n.total} intro="The most important unresolved items, with why." link={n.remaining > 0 ? <Link className="card-link wk-noprint" to={NEEDS_PATH} aria-label={`See all ${n.total} items that need you`}>See all ({n.total})</Link> : undefined}>
      <ul className="plain td-list td-need-list">{n.shown.map((i) => <NeedsRow key={i.id} item={i} today={r.today} hide={hide} />)}</ul>
      {n.remaining > 0 && <p className="muted small wk-more wk-printonly">and {n.remaining} more in the full Needs you list</p>}
    </Card>
  );
}

function ScheduleCard({ r, hide }: { r: WeekReview; hide: boolean }) {
  if (r.schedule.state !== 'ready' || r.schedule.data.count === 0) return null;
  const s = r.schedule.data;
  return (
    <Card id="wk-schedule" title="Schedule" count={s.count} intro="Events, tasks and reminders across Ledger, day by day." link={<a className="card-link wk-noprint" href="#/calendar?v=agenda">Calendar</a>}>
      {s.days.map((d) => (
        <div key={d.date} className="td-day wk-day" data-day={d.date}>
          <div className="td-day-side" aria-hidden="true">
            <DateTile iso={d.date} today={r.today} size="sm" labelled={false} />
            {d.date === r.today && <span className="td-day-cap">Today</span>}
            {d.date === addDays(r.today, 1) && <span className="td-day-cap">Tomorrow</span>}
          </div>
          <div className="td-day-body">
            <h3 className="sr-only">{dayHeading(d.date, r.today)}</h3>
            <ul className="plain td-list">{d.items.map((i) => <ScheduleRow key={i.key} item={i} hide={hide} />)}</ul>
          </div>
        </div>
      ))}
    </Card>
  );
}

function MoneyCard({ r, hide }: { r: WeekReview; hide: boolean }) {
  const m = r.money.state === 'ready' && !r.money.empty ? r.money.data : null;
  const c = r.cash.state === 'ready' && !r.cash.empty ? r.cash.data : null;
  if (!m && !c) return null;
  const lines = m ? totalsLines(m.totals, hide) : [];
  return (
    <Card id="wk-money" title="Payments and cash" intro="Expected payments and commitments for the week. These are not payments made." link={<a className="card-link wk-noprint" href="#/household">Household finances</a>}>
      {m && m.rows.length > 0 && (
        <ul className="plain td-list wk-pays">
          {m.rows.map((x) => (
            <li key={x.id} className="wk-pay">
              <span className="wk-pay-date">{dayLabel(x.date)}</span>
              <span className="wk-pay-main">
                <a className="wk-pay-title" href={x.href}>{text(x.title, hide)}</a>
                <span className="wk-sub">{x.module === 'bills' ? 'Bills & Subscriptions' : 'Household Services'} · {CERTAINTY_WORDS[x.certainty]}{x.note ? ` · ${x.note}` : ''}</span>
              </span>
              <span className={`wk-pay-amt${x.certainty === 'known' ? '' : ' wk-pay-amt--soft'}`}>{rowAmount(x, hide)}</span>
            </li>
          ))}
        </ul>
      )}
      {lines.length > 0 && <ul className="plain wk-totals" aria-label="Tally for the week">{lines.map((l) => <li key={l}>{l}</li>)}</ul>}
      {m && m.notConverted > 0 && <p className="muted small wk-note">{plural(m.notConverted, 'service arrangement')} expected with no figure for the week.</p>}
      {m?.overlap && <p className="wk-warn small" role="note">Some linked bills and services may be the same charge, so a total could count it twice. <a href="#/household">Check in Household finances</a>.</p>}
      {m && m.contractDates.length > 0 && (
        <>
          <h3 className="wk-sub-h">Contract dates</h3>
          <ul className="plain td-list wk-pays">
            {m.contractDates.map((a) => (
              <li key={a.id} className="wk-pay">
                <span className="wk-pay-date">{dayLabel(a.date)}</span>
                <span className="wk-pay-main"><a className="wk-pay-title" href={a.href}>{text(a.title, hide)}</a><span className="wk-sub">{a.label}</span></span>
              </li>
            ))}
          </ul>
        </>
      )}
      {c && (
        <div className="wk-cash">
          <h3 className="wk-sub-h">Cash outlook</h3>
          {c.week && <p className={c.week.below ? 'warn' : 'ok'}>{cashLine(c.week, 'this week', hide)}</p>}
          {c.ninety && <p className={`${c.ninety.below ? 'warn' : 'ok'} wk-cash-90`}>{cashLine(c.ninety, 'in the next 90 days', hide)} <a className="wk-noprint" href="#/ledger/forecast">Forecast</a></p>}
        </div>
      )}
    </Card>
  );
}

function HomeCard({ r, hide }: { r: WeekReview; hide: boolean }) {
  if (r.home.state !== 'ready' || r.home.empty) return null;
  const h = r.home.data;
  return (
    <Card id="wk-home" title="Home and projects" count={h.items.length} intro="Maintenance, warranties and project budgets worth a look.">
      <ul className="plain td-list wk-home">
        {h.items.map((i) => (
          <li key={i.key} className="wk-hrow">
            <a className="wk-hlink" href={i.href}>
              <span className="wk-htop"><span className="wk-htitle">{text(i.title, hide)}</span>{homeChip(i, r.today) && <StatusChip tone={TONE[i.tone]}>{homeChip(i, r.today)}</StatusChip>}</span>
              <span className="wk-sub">{i.source} · {text(homeDetail(i, hide), hide)}</span>
            </a>
          </li>
        ))}
      </ul>
      {h.moreInNeeds > 0 && <p className="muted small wk-more">{h.moreInNeeds} more in <Link to={NEEDS_PATH}>Needs you</Link>.</p>}
    </Card>
  );
}

function FamilyCard({ r }: { r: WeekReview }) {
  if (r.family.state !== 'ready' || r.family.empty) return null;
  const f = r.family.data;
  return (
    <Card id="wk-family" title="Family" count={f.activities.length + f.dates.length} intro="Birthdays, important dates and activities that name a household member." link={<a className="card-link wk-noprint" href="#/family">Family</a>}>
      <ul className="plain td-list wk-fam">
        {f.dates.map((d) => (
          <li key={d.key} className="wk-pay">
            <span className="wk-pay-date">{dayLabel(d.date)}</span>
            <span className="wk-pay-main">
              <a className="wk-pay-title" href={d.href}>{d.title}</a>
              <span className="wk-sub">{d.kind}</span>
              {d.person && <People people={[d.person]} />}
            </span>
          </li>
        ))}
        {f.activities.map((a) => (
          <li key={a.key} className="wk-pay">
            <span className="wk-pay-date">{dayLabel(a.firstDay)}</span>
            <span className="wk-pay-main">
              <a className="wk-pay-title" href={a.href}>{a.title}</a>
              <span className="wk-sub">{a.when} · {a.calendarName}</span>
              <People people={a.people} />
            </span>
          </li>
        ))}
      </ul>
      {f.hiddenActivities > 0 && <p className="muted small wk-more">{plural(f.hiddenActivities, 'activity', 'activities')} on calendars you switched off {f.hiddenActivities === 1 ? 'is' : 'are'} not shown.</p>}
    </Card>
  );
}

function Summary({ r }: { r: WeekReview }) {
  if (r.summary.length === 0) return null;
  return (
    <ul className="plain wk-summary" aria-label="The week in numbers">
      {r.summary.map((t) => (
        <li key={t.id} className="wk-tile">
          <a className="wk-tile-a" href={t.href}><span className="wk-tile-n">{t.count}</span><span className="wk-tile-l">{t.label}</span><span className="wk-tile-note">{t.note}</span></a>
        </li>
      ))}
    </ul>
  );
}

/** Everything under the header: status lines, the week in numbers and the cards. The printed page is this same markup (print CSS only removes controls), so the screen, the paper and the test see one thing. */
export function WeekView({ review, hide }: { review: WeekReview; hide: boolean }) {
  return (
    <>
      {review.loading && <p className="muted td-msg" role="status">Reading your household…</p>}
      {review.unavailable.length > 0 && <p className="wk-warn small" role="status">Some parts could not be read just now ({review.unavailable.join(', ')}), so this review is incomplete.</p>}
      <Summary r={review} />
      {review.quiet && <div className="card"><p className="td-msg">A quiet week: nothing needs attention, and nothing is scheduled in the next seven days.</p></div>}

      <div className="wk-cols">
        <div className="wk-col wk-col--main">
          <CardBoundary title="Needs you"><NeedsCard r={review} hide={hide} /></CardBoundary>
          <CardBoundary title="Schedule"><ScheduleCard r={review} hide={hide} /></CardBoundary>
        </div>
        <div className="wk-col wk-col--side">
          <CardBoundary title="Payments and cash"><MoneyCard r={review} hide={hide} /></CardBoundary>
          <CardBoundary title="Home and projects"><HomeCard r={review} hide={hide} /></CardBoundary>
          <CardBoundary title="Family"><FamilyCard r={review} /></CardBoundary>
        </div>
      </div>
    </>
  );
}

function WeekBody({ today }: { today: string }) {
  const inputs = useWeekInputs(today);
  const [hide, setHide] = useState(() => loadHideAmounts());
  const [copy, setCopy] = useState<'idle' | 'ok' | 'failed'>('idle');
  const review = useMemo(() => buildWeekReview(inputs), [inputs]);
  const toggleHide = () => { const next = !hide; setHide(next); saveHideAmounts(next); };
  const body = useMemo(() => weekText(review, hide), [review, hide]);
  const doCopy = async () => { setCopy((await copyText(body)) ? 'ok' : 'failed'); };
  return (
    <>
      <PageHeader
        title={WEEK_TITLE}
        className="td-head wk-head"
        description={WEEK_SUBTITLE}
        actions={
          <div className="td-tools wk-noprint">
            <button type="button" role="switch" aria-checked={hide} className={`td-switch ${hide ? 'on' : ''}`} onClick={toggleHide} data-key={HIDE_AMOUNTS_KEY} aria-describedby="wk-hide-help">
              <span className="td-switch-box" aria-hidden="true" /> Hide amounts
            </button>
            <button type="button" className="ghost" onClick={() => void doCopy()}>Copy summary</button>
            <button type="button" className="ghost" onClick={() => window.print()}>Print</button>
            <Link className="link wk-back" to="/">Back to Today</Link>
          </div>
        }
      />
      {hide ? <p id="wk-hide-help" className="muted small td-hide-help">{HIDE_AMOUNTS_SCOPE.help}</p> : <span id="wk-hide-help" className="sr-only">{HIDE_AMOUNTS_SCOPE.help}</span>}
      <p className="wk-range"><Icon name="calendar" size={16} /> <time dateTime={review.from}>{review.range}</time> <span className="muted">· seven days from today</span></p>
      <span className="sr-only" role="status">{copy === 'ok' ? 'Summary copied' : copy === 'failed' ? 'Could not copy the summary' : ''}</span>
      {copy === 'ok' && <p className="ok small wk-noprint" aria-hidden="true">Summary copied. Paste it into a message or note.</p>}
      {copy === 'failed' && (
        <div className="card wk-noprint">
          <p className="small">This browser would not let Ledger copy for you. Select the text below and copy it yourself.</p>
          <textarea readOnly className="wk-copybox" rows={10} value={body} aria-label="Summary text" onFocus={(e) => e.currentTarget.select()} />
        </div>
      )}

      <WeekView review={review} hide={hide} />
      <p className="muted small wk-footer wk-printonly">Prepared {dayLabel(today, { weekday: 'long', year: true })}{hide ? '. Amounts are hidden.' : '.'}</p>
    </>
  );
}

/** `#/today/week`: the weekly household review. Read only; opened on demand (its code is not part of Today's first download). */
export default function WeekPage() {
  const today = useToday();
  return (
    <AttentionProviders today={today}>
      <div className="wk-page"><WeekBody today={today} /></div>
    </AttentionProviders>
  );
}
