import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { SETUP_CATEGORY_ID, SETUP_GROUP_ID } from '../lib/setupCategory';
import { PageHeader } from '../ui/components';

export default function CategoriesPage() {
  const groups = useLiveQuery(() => db.categoryGroups.toArray(), []);
  const cats = useLiveQuery(() => db.categories.toArray(), []);
  const [newGroup, setNewGroup] = useState('');
  const [newCat, setNewCat] = useState<Record<number, string>>({});

  async function removeCategory(id: number) {
    if (id === SETUP_CATEGORY_ID) return;
    const used = await db.txns.filter((t) => t.categoryId === id || !!t.splits?.some((s) => s.categoryId === id)).count();
    if (used > 0 && !confirm(`${used} transaction(s) use this category. They will become uncategorized. Delete anyway?`)) return;
    await db.transaction('rw', db.categories, db.txns, async () => {
      await db.txns.filter((t) => t.categoryId === id).modify({ categoryId: null });
      await db.txns.filter((t) => !!t.splits?.some((s) => s.categoryId === id)).modify((t) => {
        t.splits = t.splits!.map((s) => (s.categoryId === id ? { ...s, categoryId: null } : s));
      });
      await db.categories.delete(id);
    });
  }

  async function removeGroup(id: number) {
    if (id === SETUP_GROUP_ID) return;
    if ((cats ?? []).some((c) => c.groupId === id)) return alert('Delete or move this group’s categories first.');
    await db.categoryGroups.delete(id);
  }

  return (
    <>
      <PageHeader title="Categories" description="The names and groups used by the budget and reports." />
      {(groups ?? []).map((g) => (
        <div className="card" key={g.id}>
          <div className="row spread">
            <strong>{g.name}</strong>
            {g.id !== SETUP_GROUP_ID && <button className="link danger" onClick={() => removeGroup(g.id!)}>delete group</button>}
          </div>
          {g.id === SETUP_GROUP_ID && (
            <p className="muted">
              <strong>Initial setup</strong> is for entries that bring an account to its real balance (for example, add a transaction filed here to match what your bank shows today).
              It changes the account’s balance but is left out of income, spending, the budget, reports, the forecast, and the flow diagram. It cannot be renamed or deleted.
            </p>
          )}
          {g.id !== SETUP_GROUP_ID && (cats ?? []).filter((c) => c.groupId === g.id).map((c) => (
            <div className="row spread" key={c.id}>
              <input
                defaultValue={c.name}
                onBlur={(e) => e.target.value.trim() && db.categories.update(c.id!, { name: e.target.value.trim() })}
              />
              <select
                value={c.kind ?? 'expense'}
                onChange={(e) => db.categories.update(c.id!, { kind: e.target.value as 'expense' | 'income' })}
                title="Income categories feed Ready to Assign instead of being budgeted"
              >
                <option value="expense">Expense</option>
                <option value="income">Income</option>
              </select>
              <button className="link danger" onClick={() => removeCategory(c.id!)}>delete</button>
            </div>
          ))}
          {g.id !== SETUP_GROUP_ID && <div className="row" style={{ marginTop: 6 }}>
            <input
              placeholder="New category"
              value={newCat[g.id!] ?? ''}
              onChange={(e) => setNewCat({ ...newCat, [g.id!]: e.target.value })}
            />
            <button
              onClick={async () => {
                const name = (newCat[g.id!] ?? '').trim();
                if (!name) return;
                await db.categories.add({ groupId: g.id!, name });
                setNewCat({ ...newCat, [g.id!]: '' });
              }}
            >Add</button>
          </div>}
        </div>
      ))}
      <div className="row">
        <input placeholder="New group" value={newGroup} onChange={(e) => setNewGroup(e.target.value)} />
        <button
          onClick={async () => {
            if (!newGroup.trim()) return;
            await db.categoryGroups.add({ name: newGroup.trim() });
            setNewGroup('');
          }}
        >Add group</button>
      </div>
    </>
  );
}
