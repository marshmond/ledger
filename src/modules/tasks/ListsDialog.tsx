import { useState } from 'react';
import Modal from '../../shell/Modal';
import { useToast } from '../../ui/Toast';
import { createList, deleteList, renameList } from './data';
import type { TaskList } from './model';

/** Add, rename and delete lists (the optional one-level grouping). Deleting a list never deletes its tasks. */
export default function ListsDialog({ lists, counts, onClose }: { lists: TaskList[]; counts: Map<number, number>; onClose: () => void }) {
  const toast = useToast();
  const [name, setName] = useState('');
  return (
    <Modal title="Lists" onClose={onClose}>
      {lists.length === 0 && <p className="muted">No lists yet. A list groups tasks, such as Renovation, Taxes or Household. Tasks do not need one.</p>}
      <ul className="plain cal-manage">
        {lists.map((l) => (
          <li key={l.id} className="row grow">
            <input defaultValue={l.name} aria-label="List name" onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== l.name) void renameList(l.id, v); else e.target.value = l.name; }} />
            <span className="muted small">{counts.get(l.id) ?? 0} open</span>
            <button className="link danger" onClick={async () => {
              if (!confirm(`Delete the list "${l.name}"? Its tasks are kept and will have no list.`)) return;
              const n = await deleteList(l.id);
              toast(n ? `List deleted. ${n} task${n === 1 ? '' : 's'} kept, with no list.` : 'List deleted');
            }}>Delete</button>
          </li>
        ))}
      </ul>
      <form className="row grow" onSubmit={async (e) => { e.preventDefault(); if (!name.trim()) return; await createList(name); setName(''); }}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New list name" aria-label="New list name" />
        <button className="btn" type="submit" disabled={!name.trim()}>Add list</button>
      </form>
      <div className="row cal-actions"><button className="btn primary" onClick={onClose}>Done</button></div>
    </Modal>
  );
}
