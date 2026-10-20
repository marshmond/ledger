import { useState } from 'react';
import { db } from '../db';

/** Name of an account with a "rename" link. Works for both ledger accounts and investment accounts. */
export default function RenameAccount({ table, id, name, taken, heading }: { table: 'accounts' | 'invAccounts'; id: number; name: string; taken: string[]; heading?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [err, setErr] = useState('');

  const open = () => { setText(name); setErr(''); setEditing(true); };
  async function save() {
    const n = text.trim();
    if (!n) return setErr('Give the account a name');
    if (n.length > 60) return setErr('Keep the name to 60 characters or fewer');
    if (n.toLowerCase() !== name.toLowerCase() && taken.some((t) => t.toLowerCase() === n.toLowerCase())) return setErr('Another account already has that name');
    if (n !== name) await db[table].update(id, { name: n });
    setEditing(false);
  }

  if (editing) {
    return (
      <form className="row" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <label className="f">Account name<input value={text} onChange={(e) => setText(e.target.value)} maxLength={60} autoFocus /></label>
        <button className="primary" type="submit">Save</button>
        <button type="button" onClick={() => setEditing(false)}>Cancel</button>
        {err && <span className="error" role="alert">{err}</span>}
      </form>
    );
  }
  return (
    <span className="row" style={{ display: 'inline-flex' }}>
      {heading ? <h1>{name}</h1> : <strong>{name}</strong>}
      <button className="link" onClick={open}>rename</button>
    </span>
  );
}
