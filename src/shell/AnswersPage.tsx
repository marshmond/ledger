import { Suspense, useState, type ReactNode } from 'react';
import { Route, Routes, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { allAnswerReaders } from '../core/registry';
import { answerPath, type AnswerFigure, type AnswerGroup, type AnswerLiveProps, type AnswerPart, type AnswerReader, type AnswerResult, type AnswerRow, type AnswerRun } from '../core/answers';
import { loadHideAmounts } from '../core/hideAmounts';
import { dayLabel } from '../core/time';
import { formatCents, todayISO } from '../lib/money';
import { ToastProvider } from '../ui/Toast';
import { Banner, EmptyState, PageHeader } from '../ui/components';
import { Figure } from '../ui/Figure';
import { Icon } from '../ui/icons';
import { StatusChip } from '../ui/StatusChip';
import { maskMoney } from '../ui/TxnRefs';
import { useToday } from '../ui/useToday';
import Main from './Main';
import { answerStatusView, formatFigure, rowAmountText, type Money, type Text } from './answersModel';
import './answers.css';

/**
 * R3.2 Quick Answers. One screen for the fixed catalog: `/answers` lists the questions ("What can I ask?") and `/answers/<id>` shows one answer. It reads a reader only when the answer is
 * opened (nothing is read at start-up or when Search opens), never writes, and draws the reader's STRUCTURED result: figures, rows, links, the period, what was assumed and left out, and
 * where it came from. It is not a conversation: there is no typing, no generated prose and no confidence score. Hide amounts is read when the page opens, like the other module screens.
 */
export default function AnswersPage() {
  return (
    <ToastProvider>
      <div className="shell-main">
        <Main className="main">
          <div className="ans">
            <Routes>
              <Route index element={<AnswersIndex />} />
              <Route path=":id" element={<AnswerView />} />
            </Routes>
          </div>
        </Main>
      </div>
    </ToastProvider>
  );
}

// ---- the list of questions ----

function AnswersIndex() {
  const readers = allAnswerReaders();
  return (
    <>
      <PageHeader eyebrow="Quick Answers" title="What can I ask?" description="A fixed set of questions Ledger can answer from your own records" />
      <p className="ans-lead">Quick Answers are not a chat. Each question below is answered from the same figures the module pages show, with the records behind it, what was assumed, and what is left out. Nothing leaves this device and nothing is changed.</p>
      <p className="ans-lead small muted">Type any of these into Search (the magnifier, or Ctrl+K) and pick the answer. For example: “projects over budget”, “payments coming up”, “warranties expiring”.</p>
      {readers.length === 0 ? <EmptyState title="No questions are available" /> : (
        <ul className="ans-questions" aria-label="Questions Ledger can answer">
          {readers.map(({ reader }) => (
            <li key={reader.id}>
              <a href={`#${answerPath(reader.id)}`} className="ans-q">
                <strong>{reader.question}</strong>
                <span className="muted small">Period: {reader.defaultPeriod}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

// ---- one answer ----

function AnswerView() {
  const { id = '' } = useParams();
  const entry = allAnswerReaders().find((x) => x.reader.id === decodeURIComponent(id));
  const today = useToday() || todayISO();
  if (!entry) {
    return (
      <>
        <PageHeader eyebrow="Quick Answers" title="Ledger does not have that question" />
        <EmptyState title="That question is not in the list" action={<a className="btn primary" href="#/answers">What can I ask?</a>}>Ledger answers a fixed set of questions. Pick one from the list.</EmptyState>
      </>
    );
  }
  return <AnswerHost reader={entry.reader} today={today} />;
}

function Header({ reader, today }: { reader: AnswerReader; today: string }) {
  return (
    <PageHeader eyebrow="Quick Answer" title={reader.question} description={`Today is ${dayLabel(today, { weekday: 'long', year: true })}.`}
      actions={<a className="btn" href="#/answers">What can I ask?</a>} />
  );
}

/** Runs ONE reader, when this screen is open. A reader that throws shows "could not be read", never an empty answer. */
function AnswerHost({ reader, today }: { reader: AnswerReader; today: string }) {
  const hide = loadHideAmounts();
  const [again, setAgain] = useState(0);
  const retry = () => setAgain((n) => n + 1);
  const ctx = { today };
  const render = (run: AnswerRun): ReactNode => <Outcome reader={reader} today={today} hide={hide} run={run} onRetry={retry} />;
  if (reader.Live) {
    const Live = reader.Live as (p: AnswerLiveProps) => ReactNode;
    return <Suspense fallback={<Loading reader={reader} today={today} />}><Live key={again} ctx={ctx} render={render} /></Suspense>;
  }
  return <RunHost reader={reader} today={today} hide={hide} again={again} onRetry={retry} />;
}

function RunHost({ reader, today, hide, again, onRetry }: { reader: AnswerReader; today: string; hide: boolean; again: number; onRetry(): void }) {
  const res = useLiveQuery(async (): Promise<AnswerRun> => {
    try { return { state: 'ready', result: await reader.run!({ today }) }; }
    catch (e) { return { state: 'failed', message: e instanceof Error ? e.message : 'Something went wrong while reading.' }; }
  }, [reader.id, today, again]);
  return <Outcome reader={reader} today={today} hide={hide} run={res ?? { state: 'loading' }} onRetry={onRetry} />;
}

function Loading({ reader, today }: { reader: AnswerReader; today: string }) {
  return <><Header reader={reader} today={today} /><p className="ans-skel" role="status">Reading your records… nothing is shown until it has been read.</p></>;
}

function Outcome({ reader, today, hide, run, onRetry }: { reader: AnswerReader; today: string; hide: boolean; run: AnswerRun; onRetry(): void }) {
  if (run.state === 'loading') return <Loading reader={reader} today={today} />;
  if (run.state === 'failed') {
    return (
      <>
        <Header reader={reader} today={today} />
        <div className="ans-err" role="alert">
          <strong>Ledger could not read the records for this answer, so it is showing nothing.</strong>
          <p className="small">This is not the same as “no results”. Nothing was changed. {run.message}</p>
          <button type="button" className="btn" onClick={onRetry}>Try again</button>
        </div>
      </>
    );
  }
  return <><Header reader={reader} today={today} /><AnswerBody result={run.result} hide={hide} /></>;
}

// ---- the answer ----

export function AnswerBody({ result, hide }: { result: AnswerResult; hide: boolean }) {
  const money: Money = (c) => (hide ? '$••••' : formatCents(c));
  const text: Text = (t) => (hide ? maskMoney(t) : t);
  const st = answerStatusView(result.status);
  return (
    <div className="ans-body" data-status={result.status} data-hide={hide ? 'on' : 'off'}>
      <section className="ans-answer" aria-labelledby="ans-answer-h">
        <div className="ans-answer-top">
          <h2 id="ans-answer-h" className="ans-headline"><Headline parts={result.headline} money={money} text={text} /></h2>
          {st && <StatusChip tone={st.tone}>{st.label}</StatusChip>}
        </div>
        <p className="ans-period"><Icon name="calendar" size={16} /><span><strong>Period:</strong> {text(result.period.label)}</span></p>
        {result.status === 'insufficient' && result.missing && (
          <Banner level="warn" title="Ledger cannot answer this yet" action={<a className="btn" href={result.missing.href}>Open</a>}>
            <strong>Missing:</strong> {text(result.missing.what)}. <strong>Where to add it:</strong> {text(result.missing.where)}
          </Banner>
        )}
        {result.figures.length > 0 && (
          <ul className="ans-figures" aria-label="Figures">
            {result.figures.map((f) => <FigureTile key={f.id} f={f} money={money} text={text} />)}
          </ul>
        )}
      </section>

      {result.groups.filter((g) => g.rows.length > 0).map((g) => <Group key={g.id} g={g} money={money} text={text} />)}

      <section className="ans-notes" aria-labelledby="ans-notes-h">
        <h2 id="ans-notes-h">How this was worked out</h2>
        {result.assumptions.length > 0 && <><h3>What was assumed</h3><ul>{result.assumptions.map((a, i) => <li key={i}>{text(a)}</li>)}</ul></>}
        {result.limitations.length > 0 && <><h3>What is left out or uncertain</h3><ul>{result.limitations.map((a, i) => <li key={i}>{text(a)}</li>)}</ul></>}
      </section>

      <section className="ans-sources" aria-labelledby="ans-src-h">
        <h2 id="ans-src-h">Where this came from</h2>
        <ul>{result.sources.map((s) => <li key={`${s.module}|${s.href}`}><a href={s.href}>{s.label}</a></li>)}</ul>
        {result.fullView && <p><a className="btn primary" href={result.fullView.href}>{result.fullView.label}</a></p>}
        <p className="muted small">Quick Answers only read your records. Nothing here changes anything.</p>
      </section>
    </div>
  );
}

function Headline({ parts, money, text }: { parts: AnswerPart[]; money: Money; text: Text }) {
  return <>{parts.map((p, i) => (typeof p === 'string' ? <span key={i}>{text(p)}</span> : <strong key={i} className="ans-money">{money(p.money)}</strong>))}</>;
}

function FigureTile({ f, money, text }: { f: AnswerFigure; money: Money; text: Text }) {
  const v = formatFigure(f, { money, text, day: (d) => dayLabel(d, { weekday: 'short', year: true }) });
  return <Figure as="li" label={f.label} value={v.value} certainty={v.certainty} description={f.note ? text(f.note) : undefined} />;
}

function Group({ g, money, text }: { g: AnswerGroup; money: Money; text: Text }) {
  const hid = `ans-g-${g.id}`;
  return (
    <section className="ans-group" aria-labelledby={hid}>
      <h2 id={hid}>{g.heading} <span className="muted ans-count">({g.rows.length + (g.hidden ?? 0)})</span></h2>
      {g.note && <p className="muted small">{text(g.note)}</p>}
      <ul className="ans-rows">{g.rows.map((r) => <Row key={r.id} r={r} money={money} text={text} />)}</ul>
      {g.more ? <p><a className="link" href={g.more.href}>{g.more.label}{g.hidden ? ` (${g.hidden} more)` : ''}</a></p> : g.hidden ? <p className="muted small">{g.hidden} more not shown.</p> : null}
    </section>
  );
}

function Row({ r, money, text }: { r: AnswerRow; money: Money; text: Text }) {
  return (
    <li className="ans-row">
      <div className="ans-row-main">
        <a className="ans-row-title" href={r.href}>{text(r.title)}</a>
        {r.detail && <span className="ans-row-detail">{text(r.detail)}</span>}
        <span className="ans-row-meta">
          {r.date && <span>{r.dateLabel ? `${r.dateLabel}: ` : ''}{dayLabel(r.date, { weekday: 'short', year: true })}</span>}
          <span className="muted">{text(r.source)}</span>
          {(r.links ?? []).map((l) => <a key={l.href} className="link" href={l.href}>{l.label}</a>)}
        </span>
        {r.chips && r.chips.length > 0 && <span className="ans-chips">{r.chips.map((c, i) => <StatusChip key={i} tone={c.tone ?? 'neutral'} icon={false}>{text(c.text)}</StatusChip>)}</span>}
      </div>
      {r.amounts && r.amounts.length > 0 && (
        <dl className="ans-amounts">
          {r.amounts.map((a, i) => (
            <div key={i} className={a.strong ? 'ans-amt strong' : 'ans-amt'}>
              <dt>{a.label}</dt>
              <dd>{rowAmountText(a, money)}</dd>
            </div>
          ))}
        </dl>
      )}
    </li>
  );
}
