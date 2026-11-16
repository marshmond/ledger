import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { withBasePath } from '../core/paths';
import { requestEvent } from '../core/eventBridge';
import { requestTask } from '../core/taskBridge';
import { allAnswerReaders, allSearchSources, type SearchResult } from '../core/registry';
import { ANSWERS_BASE, exampleQuestions, matchAnswers } from '../core/answers';
import { todayISO } from '../lib/money';
import { answerHits, looksLikeQuestion } from './searchAnswers';
import { filterActions } from './searchActions';
import { groupResults, type ResultGroup } from './searchGroups';
import Modal from './Modal';
import { openAddTransaction } from './QuickAdd';
import { resetDocumentSearch, searchDocuments } from './recordsIndex';

/** Things you can do from the palette, not just places you can go. */
// `to` is written the way Ledger writes its pages (/budget); the dialog lives outside Ledger, so it adds the /ledger prefix itself.
const ACTIONS: { title: string; words: string; to?: string; full?: string; run?: () => void }[] = [
  { title: 'Add a task', words: 'add new task todo to-do reminder', run: () => requestTask() },
  { title: 'Add an event', words: 'add new event appointment meeting calendar', run: () => requestEvent() },
  { title: 'Add a transaction', words: 'add new transaction expense income spend log', run: openAddTransaction },
  { title: 'Log a trade', words: 'log buy sell trade investment stock', to: '/investments' },
  { title: 'Add a scheduled item', words: 'add new scheduled recurring bill', to: '/scheduled' },
  { title: 'New paycheck scenario', words: 'new paycheck scenario raise offer', to: '/paycheck' },
  { title: 'Import transactions', words: 'import csv bank upload', to: '/import' },
  // R4.1: the Records screen is a shell page (not a Ledger page), so it carries its full address.
  { title: 'Open Records', words: 'records documents document warranty warranties manual manuals contract contracts paperwork papers receipts', full: '/records' },
];

const PER_SOURCE = 14;
const DEBOUNCE_MS = 90;

/** Search everything from anywhere: each module offers its own source (Ledger, Calendar, Tasks, Today) and results are grouped by module. */
export default function SearchDialog({ onClose }: { onClose: () => void }) {
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [cur, setCur] = useState(0);
  const [groups, setGroups] = useState<ResultGroup[]>([]);
  const [busy, setBusy] = useState(false);
  const [ms, setMs] = useState<number | null>(null);
  // R4.1: modules whose document references could not be read for this search (so a short list is never mistaken for a complete one).
  const [docGaps, setDocGaps] = useState<string[]>([]);
  const token = useRef(0);

  // Let each module warm up while the dialog is open (e.g. keep a live snapshot of its data), and tidy up when it closes.
  useEffect(() => {
    const stops = allSearchSources().map((s) => { try { return s.source.start?.() ?? (() => undefined); } catch { return () => undefined; } });
    return () => { stops.forEach((stop) => { try { stop(); } catch { /* nothing to tidy */ } }); resetDocumentSearch(); };
  }, []);

  // Ask every module's source, a moment after typing stops. A source that fails is simply left out; the others still answer.
  useEffect(() => {
    const text = q.trim();
    const mine = ++token.current;
    if (text === '') { setGroups([]); setDocGaps([]); setBusy(false); setMs(null); return; }
    setBusy(true);
    const timer = setTimeout(async () => {
      const t0 = performance.now();
      const sources = allSearchSources();
      const answers = await Promise.all(sources.map(async (s) => {
        try { return { moduleId: s.moduleId, name: s.source.group ?? s.moduleName, results: await s.source.search(text, PER_SOURCE) }; } catch { return { moduleId: s.moduleId, name: s.source.group ?? s.moduleName, results: [] as SearchResult[] }; }
      }));
      // R4.1: document references (labels and where they belong), read once per open dialog; a failed read leaves the group out and says so.
      let docs: Awaited<ReturnType<typeof searchDocuments>> = { results: [], failed: ['Records'] };
      try { docs = await searchDocuments(text, todayISO(), PER_SOURCE); } catch { /* reported below */ }
      if (mine !== token.current) return; // a newer search has started
      setDocGaps(docs.failed);
      setGroups(groupResults([...answers, { moduleId: 'records', name: 'Documents', results: docs.results }]));
      setMs(Math.round(performance.now() - t0));
      setBusy(false);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [q]);

  const actions = useMemo(() => filterActions(q, ACTIONS), [q]);
  const flat = useMemo(() => groups.flatMap((g) => g.results.map((r) => ({ g, r }))), [groups]);
  // R3.2 Quick Answers: matched from the readers' fixed phrases (synchronous; reads no household data). Shown after Actions and before the module groups.
  const today = useMemo(() => todayISO(), []);
  const readers = useMemo(() => allAnswerReaders(), []);
  const hits = useMemo(() => answerHits(q, matchAnswers(q, readers, today), exampleQuestions(readers)), [q, readers, today]);
  const answers = hits.items;
  const total = actions.length + answers.length + flat.length;
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  useEffect(() => setCur(0), [q, groups]);

  const open = (r: SearchResult) => {
    onClose();
    if (r.open) void r.open();
    else if (r.path) nav(r.path);
  };
  const runAction = (a: (typeof ACTIONS)[number]) => {
    onClose();
    if (a.run) a.run();
    else if (a.full) nav(a.full);
    else if (a.to) nav(withBasePath('/ledger', a.to));
  };
  const openAnswer = (to: string) => { onClose(); nav(to); };
  const choose = (i: number) => (i < actions.length ? runAction(actions[i]) : i < actions.length + answers.length ? openAnswer(answers[i - actions.length].to) : open(flat[i - actions.length - answers.length].r));
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCur((c) => Math.min(total - 1, c + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCur((c) => Math.max(0, c - 1));
    } else if (e.key === 'Enter' && cur < total) {
      e.preventDefault();
      choose(cur);
    }
  };

  return (
    <Modal title="Search" onClose={onClose} wide>
      <input
        ref={input}
        className="searchinput"
        type="search"
        placeholder="Jump to a page, run an action, or search…"
        aria-label="Search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={onKey}
        role="combobox"
        aria-expanded={total > 0}
        aria-haspopup="listbox"
        aria-autocomplete="list"
        aria-controls="search-results"
        aria-activedescendant={cur < total ? `hit-${cur}` : undefined}
      />
      {/* Said once the answers are in, so a screen reader hears how many there are without having to move through them. */}
      <div className="sr-only" role="status" aria-live="polite">{q.trim() === '' || busy ? '' : total === 0 ? 'No results' : `${total} result${total === 1 ? '' : 's'}. Use the up and down arrow keys, then Enter.`}</div>
      <ul className="hits" id="search-results" role="listbox" aria-label="Search results" data-ms={ms ?? ''}>
        {q.trim() === '' && <li className="muted hint">Try “budget”, a task, an event, a payee, a ticker like VTI, or an amount like 45.20. Or ask a question, like “projects over budget”. <a href={`#${ANSWERS_BASE}`} onClick={onClose}>What can I ask?</a></li>}
        {actions.length > 0 && <li className="group" role="presentation">Actions</li>}
        {actions.map((a, i) => (
          <li key={a.title} id={`hit-${i}`} role="option" aria-selected={i === cur} className={i === cur ? 'on' : ''} onMouseEnter={() => setCur(i)} onClick={() => choose(i)}>
            <span className="hit-main"><strong>{a.title}</strong></span>
            <span className="badge">Action</span>
          </li>
        ))}
        {answers.length > 0 && <li className="group" role="presentation">{hits.heading}</li>}
        {hits.note && <li className="muted hint" role="presentation">{hits.note}</li>}
        {answers.map((a, k) => {
          const i = actions.length + k;
          return (
            <li key={a.key} id={`hit-${i}`} role="option" aria-selected={i === cur} className={i === cur ? 'on' : ''} onMouseEnter={() => setCur(i)} onClick={() => choose(i)}>
              <span className="hit-main">
                <strong>{a.title}</strong>
                {a.subtitle && <span className="muted"> · {a.subtitle}</span>}
                {a.caveat && <span className="ans-hit-note">{a.caveat}</span>}
              </span>
              <span className="badge">{a.kind}</span>
            </li>
          );
        })}
        {q.trim() !== '' && !busy && total === 0 && <li className="muted hint">Nothing matches “{q.trim()}”.{looksLikeQuestion(q) && <> Ledger answers a fixed set of questions. <a href={`#${ANSWERS_BASE}`} onClick={onClose}>What can I ask?</a></>}</li>}
        {q.trim() !== '' && !busy && total > 0 && answers.length === 0 && looksLikeQuestion(q) && <li className="muted hint">Ledger can also answer a fixed set of questions. <a href={`#${ANSWERS_BASE}`} onClick={onClose}>What can I ask?</a></li>}
        {q.trim() !== '' && !busy && docGaps.length > 0 && <li className="muted hint" role="presentation">Document search is incomplete: {docGaps.join(' and ')} could not be read.</li>}
        {q.trim() !== '' && busy && flat.length === 0 && actions.length === 0 && <li className="muted hint">Searching…</li>}
        {groups.map((g) => (
          <Fragment key={g.moduleId}>
            <li className="group" role="presentation">{g.name}</li>
            {g.results.map((r) => {
              const i = actions.length + answers.length + flat.findIndex((x) => x.g === g && x.r === r);
              return (
                <li key={`${g.moduleId}-${r.id}`} id={`hit-${i}`} role="option" aria-selected={i === cur} className={i === cur ? 'on' : ''} onMouseEnter={() => setCur(i)} onClick={() => open(r)}>
                  <span className="hit-main">
                    <strong>{r.title}</strong>
                    {r.subtitle && <span className="muted"> · {r.subtitle}</span>}
                  </span>
                  <span className="badge">{r.kind}</span>
                </li>
              );
            })}
          </Fragment>
        ))}
      </ul>
      <p className="muted hint">↑ ↓ to move, Enter to open, Esc to close</p>
    </Modal>
  );
}
