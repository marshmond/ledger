import { useEffect, useMemo, useState } from 'react';
import { useMediaQuery } from '../ui/useMediaQuery';
import { useSearchParams } from 'react-router-dom';
import { expiryState, filterRefs, type DocumentGap, type DocumentRef } from '../core/documentRefs';
import { loadHideAmounts } from '../core/hideAmounts';
import { dayLabel } from '../core/time';
import { todayISO } from '../lib/money';
import { ToastProvider } from '../ui/Toast';
import { Banner, EmptyLine, EmptyState, PageHeader } from '../ui/components';
import { Icon } from '../ui/icons';
import { StatusChip } from '../ui/StatusChip';
import { maskMoney } from '../ui/TxnRefs';
import { useToday } from '../ui/useToday';
import Main from './Main';
import { loadDocumentIndex, type DocumentIndex } from './recordsIndex';
import './records.css';

/** How many rows are drawn before "Show more": a household with a few hundred references still opens at once. */
const PAGE = 100;

/**
 * R4.1 Records: one read-only list of the document references already stored in Home & Assets, Household Services and Bills & Subscriptions. Nothing is copied or changed here: a row
 * has two different actions, "Open document" (the stored web link, in a new tab, only if it is a safe http(s) address) and "View record" (the record that holds the reference, in its own
 * module, where it is edited). The module readers are called when this page opens, never at start-up; if one cannot be read the page says the list is incomplete. Hide amounts is read when the page opens.
 */
export default function RecordsPage() {
  return (
    <ToastProvider>
      <div className="shell-main">
        <Main className="main">
          <div className="rec">
            <Records />
          </div>
        </Main>
      </div>
    </ToastProvider>
  );
}

type Load = { state: 'loading' } | { state: 'done'; index: DocumentIndex };

function Records() {
  const today = useToday() || todayISO();
  const [params] = useSearchParams();
  const focusId = params.get('ref');
  const hide = loadHideAmounts();
  const text = (t: string) => (hide ? maskMoney(t) : t);
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [again, setAgain] = useState(0);
  const [query, setQuery] = useState('');
  const [source, setSource] = useState('all');
  const [expiring, setExpiring] = useState(false);
  const [review, setReview] = useState(false);
  const [shown, setShown] = useState(PAGE);

  useEffect(() => {
    let live = true;
    setLoad({ state: 'loading' });
    loadDocumentIndex(today).then((index) => { if (live) setLoad({ state: 'done', index }); });
    return () => { live = false; };
  }, [today, again]);

  useEffect(() => setShown(PAGE), [query, source, expiring, review, focusId]);

  const index = load.state === 'done' ? load.index : null;
  const visible = useMemo(() => {
    if (!index) return [];
    if (focusId) return index.refs.filter((r) => r.id === focusId);
    return filterRefs(index.refs, { source, query, expiring, review }, today);
  }, [index, focusId, source, query, expiring, review, today]);

  const header = <PageHeader eyebrow="Household" title="Records" description="Your household documents and where to find them" />;
  if (!index) return <>{header}<p className="rec-skel" role="status">Reading your records…</p></>;

  const failed = index.sources.filter((s) => !s.ok);
  const total = index.refs.length;
  const countOf = (id: string) => index.refs.filter((r) => r.moduleId === id).length;
  const anyExpiry = index.refs.some((r) => r.expires && expiryState(r.expires.date, today) !== 'later');
  const anyReview = index.refs.some((r) => r.link === 'review');
  const filtering = !focusId && (query.trim() !== '' || source !== 'all' || expiring || review);
  const records = new Set(index.refs.map((r) => r.id.split('#')[0])).size;

  return (
    <>
      {header}
      {failed.length > 0 && (
        <Banner level="warn" title="This list is incomplete" action={<button type="button" onClick={() => setAgain((n) => n + 1)}>Try again</button>}>
          Ledger could not read {failed.map((f) => f.label).join(' and ')}, so its documents are not shown below. The rest are listed. Nothing was changed.
        </Banner>
      )}
      {focusId && (
        <Banner level="info" title="Showing one document from Search" action={<a className="btn" href="#/records">Show all records</a>}>This is the reference you picked. “Open document” opens the stored link; “View record” opens the record that holds it.</Banner>
      )}

      {!focusId && index.gaps.length > 0 && <Gaps gaps={index.gaps} text={text} />}

      {!focusId && total === 0 && failed.length === 0 && (
        <EmptyState title="No document links yet" action={<div className="rec-empty-links"><a className="btn" href="#/assets">Home & Assets</a><a className="btn" href="#/services">Household Services</a><a className="btn" href="#/bills">Bills & Subscriptions</a></div>}>
          Add documents to your appliances, services or bills, and they will appear here. Ledger keeps the links you type, not the files themselves.
        </EmptyState>
      )}

      {!focusId && total > 0 && (
        <section className="rec-controls" aria-label="Find a document">
          <p className="rec-count muted" role="status">{filtering ? `${visible.length} of ${total} document ${total === 1 ? 'link' : 'links'}` : `${total} document ${total === 1 ? 'link' : 'links'} on ${records} ${records === 1 ? 'record' : 'records'}`}{failed.length > 0 ? ' (incomplete)' : ''}</p>
          <label className="rec-search">
            <span className="sr-only">Search document links</span>
            <Icon name="search" size={18} />
            <input type="search" placeholder="Search by document name, item or module" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <div className="rec-filters" role="group" aria-label="Show records from">
            <button type="button" aria-pressed={source === 'all'} onClick={() => setSource('all')}>All records ({total})</button>
            {index.sources.map((s) => (
              <button key={s.moduleId} type="button" aria-pressed={source === s.moduleId} disabled={!s.ok} onClick={() => setSource(s.moduleId)}>{s.label} ({s.ok ? countOf(s.moduleId) : 'not read'})</button>
            ))}
          </div>
          {(anyExpiry || anyReview) && (
            <div className="rec-filters" role="group" aria-label="Narrow the list">
              {anyExpiry && <button type="button" aria-pressed={expiring} onClick={() => setExpiring((v) => !v)}>Warranty ending soon or ended</button>}
              {anyReview && <button type="button" aria-pressed={review} onClick={() => setReview((v) => !v)}>Link needs review</button>}
            </div>
          )}
        </section>
      )}

      {focusId && visible.length === 0 && (
        <EmptyState title="That document link is no longer there" action={<a className="btn primary" href="#/records">Show all records</a>}>The record that held it may have been changed or removed, or the list was edited after Search found it.</EmptyState>
      )}

      {total > 0 && !focusId && visible.length === 0 && <EmptyLine>No document links match. Try fewer words or clear a filter.</EmptyLine>}

      {visible.length > 0 && <List refs={visible.slice(0, shown)} today={today} text={text} grouped={!focusId && source === 'all'} />}
      {visible.length > shown && <div className="rec-more"><button type="button" onClick={() => setShown((n) => n + PAGE)}>Show more ({visible.length - shown} left)</button></div>}

      {total > 0 && !focusId && <p className="rec-foot muted small">Ledger lists the links you saved. It does not keep the files, and it cannot tell whether a link still works. Edit or remove a link on the record that holds it.</p>}
    </>
  );
}

/** Gaps shown before "Show all": a household with many warranties still sees the list below without scrolling past a wall of gaps. */
const GAPS_SHOWN = 3;

export function Gaps({ gaps, text }: { gaps: DocumentGap[]; text: (t: string) => string }) {
  const [all, setAll] = useState(false);
  // On a phone the gaps start folded away (one line) so the records themselves are not pushed off the first screen; on a computer they start open.
  const phone = useMediaQuery('(max-width: 640px)');
  const [open, setOpen] = useState(!phone);
  const rows = all ? gaps : gaps.slice(0, GAPS_SHOWN);
  return (
    <section className="rec-gaps" aria-labelledby="rec-gaps-h">
      <h2 id="rec-gaps-h"><button type="button" className="rec-gaps-toggle" aria-expanded={open} aria-controls="rec-gaps-body" onClick={() => setOpen((v) => !v)}>Documentation gaps <span className="rec-n muted">{gaps.length}</span><Icon name={open ? 'chevron-up' : 'chevron-down'} size={16} /></button></h2>
      {open && <div id="rec-gaps-body">
      <p className="muted small">A warranty record has no document linked. That is not proof you do not have the paper: it only means no link is recorded here. Add one on the record.</p>
      <ul className="rec-list">
        {rows.map((g) => (
          <li key={g.id} className="rec-row rec-gap">
            <div className="rec-main">
              <div className="rec-title">{text(g.ownerName)}<span className="rec-kind"> · {g.recordKind}: {text(g.recordName)}</span></div>
              <div className="rec-meta"><StatusChip tone="neutral" icon="info">{g.message}</StatusChip><span>{g.sourceLabel}{g.context ? ` · ${text(g.context)}` : ''}</span></div>
            </div>
            <div className="rec-actions"><a className="btn" href={`#${g.recordPath}`} aria-label={`${g.recordAction}: ${text(g.ownerName)}, ${text(g.recordName)}`}>{g.recordAction}</a></div>
          </li>
        ))}
      </ul>
      {gaps.length > GAPS_SHOWN && <div className="rec-more"><button type="button" aria-expanded={all} onClick={() => setAll((v) => !v)}>{all ? 'Show fewer' : `Show all ${gaps.length}`}</button></div>}
      </div>}
    </section>
  );
}

export function List({ refs, today, text, grouped }: { refs: DocumentRef[]; today: string; text: (t: string) => string; grouped: boolean }) {
  if (!grouped) return <ul className="rec-list" aria-label="Document links">{refs.map((r) => <Row key={r.id} r={r} today={today} text={text} />)}</ul>;
  const sections: { moduleId: string; label: string; rows: DocumentRef[] }[] = [];
  for (const r of refs) {
    const last = sections[sections.length - 1];
    if (last && last.moduleId === r.moduleId) last.rows.push(r); else sections.push({ moduleId: r.moduleId, label: r.sourceLabel, rows: [r] });
  }
  return (
    <>
      {sections.map((s) => (
        <section key={s.moduleId} className="rec-group" aria-labelledby={`rec-h-${s.moduleId}`}>
          <h2 id={`rec-h-${s.moduleId}`}>{s.label}</h2>
          <ul className="rec-list">{s.rows.map((r) => <Row key={r.id} r={r} today={today} text={text} />)}</ul>
        </section>
      ))}
    </>
  );
}

export function Row({ r, today, text }: { r: DocumentRef; today: string; text: (t: string) => string }) {
  const state = r.expires ? expiryState(r.expires.date, today) : null;
  const belongs = r.recordName ? `${r.recordKind}: ${text(r.recordName)}` : r.recordKind;
  return (
    <li className="rec-row" data-ref={r.id}>
      <div className="rec-main">
        <div className="rec-title">{text(r.label)}</div>
        <div className="rec-belongs">Belongs to <strong>{text(r.ownerName)}</strong><span className="muted"> · {belongs}</span></div>
        <div className="rec-meta">
          <span>{r.sourceLabel}{r.context ? ` · ${text(r.context)}` : ''}</span>
          {r.status && <StatusChip tone="neutral" icon={false}>{r.status}</StatusChip>}
          {r.host && <span title="The site this link opens" className="rec-host"><Icon name="external" size={14} /> {r.host}</span>}
          {r.expires && <span>{r.expires.label} {dayLabel(r.expires.date, { year: true })}</span>}
          {state === 'soon' && <StatusChip tone="warning">Expiring soon</StatusChip>}
          {state === 'expired' && <StatusChip tone="overdue">Expired</StatusChip>}
          {r.link === 'review' && <StatusChip tone="warning">Link needs review</StatusChip>}
          {r.link === 'label-only' && <span className="muted">No web link saved</span>}
        </div>
        {r.note && <div className="rec-note small muted">{text(r.note)}</div>}
        {r.link === 'review' && <div className="rec-note small">The saved address is not a normal web link, so Ledger will not open it. Check it on the record.</div>}
      </div>
      <div className="rec-actions">
        {r.href && <a className="btn primary" href={r.href} target="_blank" rel="noopener noreferrer" aria-label={`Open document: ${text(r.label)} (opens in a new tab)`}>Open document<Icon name="external" size={14} /></a>}
        <a className="btn" href={`#${r.recordPath}`} aria-label={`${r.recordAction}: ${text(r.ownerName)}${r.recordName ? `, ${text(r.recordName)}` : ''}`}>{r.recordAction}</a>
      </div>
    </li>
  );
}

