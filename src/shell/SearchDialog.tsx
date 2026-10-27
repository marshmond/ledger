import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { KIND_LABEL, searchAll, type SearchData } from '../lib/search';
import Modal from './Modal';
import { openAddTransaction } from './QuickAdd';

/** Things you can do from the palette, not just places you can go. */
const ACTIONS: { title: string; words: string; to?: string; run?: () => void }[] = [
  { title: 'Add a transaction', words: 'add new transaction expense income spend log', run: openAddTransaction },
  { title: 'Log a trade', words: 'log buy sell trade investment stock', to: '/investments' },
  { title: 'Add a scheduled item', words: 'add new scheduled recurring bill', to: '/scheduled' },
  { title: 'New paycheck scenario', words: 'new paycheck scenario raise offer', to: '/paycheck' },
  { title: 'Import transactions', words: 'import csv bank upload', to: '/import' },
];

const EMPTY: SearchData = { accounts: [], invAccounts: [], securities: [], holdings: [], loans: [], scenarios: [], txns: [] };

/** Search everything from anywhere: pages, accounts, holdings, loans, scenarios, and transactions. */
export default function SearchDialog({ onClose }: { onClose: () => void }) {
  const nav = useNavigate();
  const data = useLiveQuery(async (): Promise<SearchData> => ({
    accounts: await db.accounts.toArray(),
    invAccounts: await db.invAccounts.toArray(),
    securities: await db.securities.toArray(),
    holdings: await db.holdings.toArray(),
    loans: await db.loans.toArray(),
    scenarios: await db.payScenarios.toArray(),
    txns: await db.txns.toArray(),
  }), []) ?? EMPTY;
  const [q, setQ] = useState('');
  const [cur, setCur] = useState(0);
  const hits = useMemo(() => searchAll(q, data), [q, data]);
  const actions = useMemo(() => {
    const words = q.trim().toLowerCase().split(/s+/).filter(Boolean);
    return ACTIONS.filter((a) => words.every((w) => a.title.toLowerCase().includes(w) || a.words.includes(w)));
  }, [q]);
  const total = actions.length + hits.length;
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  useEffect(() => setCur(0), [q]);

  const go = (to: string) => {
    onClose();
    nav(to);
  };
  const runAction = (a: (typeof ACTIONS)[number]) => {
    onClose();
    if (a.run) a.run();
    else if (a.to) nav(a.to);
  };
  const choose = (i: number) => (i < actions.length ? runAction(actions[i]) : go(hits[i - actions.length].to));
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
        aria-controls="search-results"
        aria-activedescendant={cur < total ? `hit-${cur}` : undefined}
      />
      <ul className="hits" id="search-results" role="listbox">
        {q.trim() === '' && <li className="muted hint">Try “budget”, a payee, a ticker like VTI, or an amount like 45.20.</li>}
        {actions.length > 0 && <li className="group" role="presentation">Actions</li>}
        {actions.map((a, i) => (
          <li key={a.title} id={`hit-${i}`} role="option" aria-selected={i === cur} className={i === cur ? 'on' : ''} onMouseEnter={() => setCur(i)} onClick={() => choose(i)}>
            <span className="hit-main"><strong>{a.title}</strong></span>
            <span className="badge">Action</span>
          </li>
        ))}
        {hits.length > 0 && actions.length > 0 && <li className="group" role="presentation">Go to</li>}
        {q.trim() !== '' && total === 0 && <li className="muted hint">Nothing matches “{q.trim()}”.</li>}
        {hits.map((h, hi) => {
          const i = hi + actions.length;
          return (
          <li key={`${h.kind}-${h.to}-${h.title}-${hi}`} id={`hit-${i}`} role="option" aria-selected={i === cur} className={i === cur ? 'on' : ''} onMouseEnter={() => setCur(i)} onClick={() => go(h.to)}>
            <span className="hit-main">
              <strong>{h.title}</strong>
              {h.subtitle && <span className="muted"> · {h.subtitle}</span>}
            </span>
            <span className="badge">{KIND_LABEL[h.kind]}</span>
          </li>
          );
        })}
      </ul>
      <p className="muted hint">↑ ↓ to move, Enter to open, Esc to close</p>
    </Modal>
  );
}
