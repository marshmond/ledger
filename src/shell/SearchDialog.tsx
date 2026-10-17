import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { KIND_LABEL, searchAll, type SearchData } from '../lib/search';
import Modal from './Modal';

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
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  useEffect(() => setCur(0), [q]);

  const go = (to: string) => {
    onClose();
    nav(to);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCur((c) => Math.min(hits.length - 1, c + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCur((c) => Math.max(0, c - 1));
    } else if (e.key === 'Enter' && hits[cur]) {
      e.preventDefault();
      go(hits[cur].to);
    }
  };

  return (
    <Modal title="Search" onClose={onClose} wide>
      <input
        ref={input}
        className="searchinput"
        type="search"
        placeholder="Search pages, accounts, holdings, transactions…"
        aria-label="Search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={onKey}
        aria-controls="search-results"
        aria-activedescendant={hits[cur] ? `hit-${cur}` : undefined}
      />
      <ul className="hits" id="search-results" role="listbox">
        {q.trim() === '' && <li className="muted hint">Try “budget”, a payee, a ticker like VTI, or an amount like 45.20.</li>}
        {q.trim() !== '' && hits.length === 0 && <li className="muted hint">Nothing matches “{q.trim()}”.</li>}
        {hits.map((h, i) => (
          <li key={`${h.kind}-${h.to}-${h.title}-${i}`} id={`hit-${i}`} role="option" aria-selected={i === cur} className={i === cur ? 'on' : ''} onMouseEnter={() => setCur(i)} onClick={() => go(h.to)}>
            <span className="hit-main">
              <strong>{h.title}</strong>
              {h.subtitle && <span className="muted"> · {h.subtitle}</span>}
            </span>
            <span className="badge">{KIND_LABEL[h.kind]}</span>
          </li>
        ))}
      </ul>
      <p className="muted hint">↑ ↓ to move, Enter to open, Esc to close</p>
    </Modal>
  );
}
