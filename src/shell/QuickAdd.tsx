import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import TxnForm from '../pages/TxnForm';
import Modal from './Modal';

/** A floating "+" for the things you do most: add a transaction from anywhere, or jump straight to logging a trade. */
export default function QuickAdd() {
  const nav = useNavigate();
  const accounts = (useLiveQuery(() => db.accounts.toArray(), []) ?? []).filter((a) => !a.closed && a.kind !== 'loan');
  const [menu, setMenu] = useState(false);
  const [form, setForm] = useState(false);
  const [acct, setAcct] = useState('');
  const account = accounts.find((a) => String(a.id) === acct) ?? accounts[0];

  const go = (to: string) => {
    setMenu(false);
    nav(to);
  };

  return (
    <>
      <div className="fab-wrap">
        {menu && (
          <div className="fab-menu" role="menu">
            <button role="menuitem" onClick={() => { setMenu(false); setForm(true); }}>Add a transaction</button>
            <button role="menuitem" onClick={() => go('/investments')}>Log a trade</button>
            <button role="menuitem" onClick={() => go('/paycheck')}>New paycheck scenario</button>
            <button role="menuitem" onClick={() => go('/scheduled')}>Add a scheduled item</button>
          </div>
        )}
        <button className="fab" aria-label="Quick add" aria-expanded={menu} onClick={() => setMenu(!menu)}>{menu ? '×' : '+'}</button>
      </div>
      {form && (
        <Modal title="Add a transaction" onClose={() => setForm(false)} wide>
          {accounts.length === 0 ? (
            <p className="muted">Add an account first, on the Accounts page.</p>
          ) : (
            <>
              <label className="f" style={{ maxWidth: 320 }}>Account
                <select value={account ? String(account.id) : ''} onChange={(e) => setAcct(e.target.value)}>
                  {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </label>
              {account && <TxnForm key={account.id} account={account} onDone={() => setForm(false)} />}
            </>
          )}
        </Modal>
      )}
    </>
  );
}
