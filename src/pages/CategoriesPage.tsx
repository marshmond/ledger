import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';

export default function CategoriesPage() {
  const groups = useLiveQuery(() => db.categoryGroups.toArray(), []);
  const cats = useLiveQuery(() => db.categories.toArray(), []);
  const [newGroup, setNewGroup] = useState('');
  const [newCat, setNewCat] = useState<Record<number, string>>({});

  async function removeCategory(id: number) {
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
    if ((cats ?? []).some((c) => c.groupId === id)) return alert('Delete or move this group’s categories first.');
    await db.categoryGroups.delete(id);
  }

  return (
    <>
      <h1>Categories</h1>
      {(groups ?? []).map((g) => (
        <div className="card" key={g.id}>
          <div className="row spread">
            <strong>{g.name}</strong>
            <button className="link danger" onClick={() => removeGroup(g.id!)}>delete group</button>
          </div>
          {(cats ?? []).filter((c) => c.groupId === g.id).map((c) => (
            <div className="row spread" key={c.id}>
              <input
                defaultValue={c.name}
                onBlur={(e) => e.target.value.trim() && db.categories.update(c.id!, { name: e.target.value.trim() })}
              />
              <button className="link danger" onClick={() => removeCategory(c.id!)}>delete</button>
            </div>
          ))}
          <div className="row" style={{ marginTop: 6 }}>
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
          </div>
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
