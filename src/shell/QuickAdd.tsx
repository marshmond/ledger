import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import QuickTxn from './QuickTxn';
import { getPrimaryAccountId } from '../lib/primaryAccount';
import Modal from './Modal';

/** Anything can ask for the "add a transaction" form by sending this event (the command palette and page buttons do). */
export const ADD_TXN_EVENT = 'ledger:add-transaction';
export const openAddTransaction = () => window.dispatchEvent(new Event(ADD_TXN_EVENT));

/**
 * Quick add: an "Add" button in the top bar on a computer, a round button above the tab bar on a phone.
 * The menu closes on Escape, on a click elsewhere, and when you change page.
 */
export default function QuickAdd() {
  const nav = useNavigate();
  const loc = useLocation();
  const accounts = (useLiveQuery(() => db.accounts.toArray(), []) ?? []).filter((a) => !a.closed && a.kind !== 'loan');
  const primaryId = useLiveQuery(() => getPrimaryAccountId(db), []);
  const [menu, setMenu] = useState(false);
  const [form, setForm] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => setMenu(false), [loc.pathname]);
  useEffect(() => {
    const open = () => { setMenu(false); setForm(true); };
    window.addEventListener(ADD_TXN_EVENT, open);
    return () => window.removeEventListener(ADD_TXN_EVENT, open);
  }, []);
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenu(false);
    const onDown = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setMenu(false); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [menu]);

  const go = (to: string) => {
    setMenu(false);
    nav(to);
  };

  return (
    <>
      <div className="qa" ref={wrap}>
        {menu && (
          <div className="qa-menu" role="menu">
            <button role="menuitem" onClick={() => { setMenu(false); setForm(true); }}>Add a transaction</button>
            <button role="menuitem" onClick={() => go('/investments')}>Log a trade</button>
            <div className="qa-sep" role="separator" />
            <button role="menuitem" onClick={() => go('/scheduled')}>Add a scheduled item</button>
            <button role="menuitem" onClick={() => go('/paycheck')}>New paycheck scenario</button>
          </div>
        )}
        <button className="qa-btn" aria-label="Quick add" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>
          <span className="qa-plus" aria-hidden="true">{menu ? '×' : '+'}</span>
          <span className="qa-label">Add</span>
        </button>
      </div>
      {form && createPortal(
        <Modal title="Add a transaction" onClose={() => setForm(false)} wide>
          <QuickTxn key={`${accounts.length}-${primaryId ?? ''}`} accounts={accounts} primaryId={primaryId} onDone={() => setForm(false)} />
        </Modal>,
        document.body,
      )}
    </>
  );
}
