import { useState, type DragEvent } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { SETUP_CATEGORY_ID, SETUP_GROUP_ID } from '../lib/setupCategory';
import { moveBefore, nudge, sortByOrder } from '../lib/order';
import { targetNeed } from '../lib/budgetTargets';
import { formatCents, todayISO } from '../lib/money';
import { monthOf } from '../lib/dates';
import { readCollapsed, writeCollapsed } from './Collapsible';
import { PageHeader } from '../ui/components';

type Drag = { kind: 'group' | 'cat' | 'target'; id: number };

/** Which item a drop lands before: this one if the pointer is in its upper half, otherwise the next one (null = at the end). */
function beforeId(e: DragEvent, ids: number[], id: number): number | null {
  const r = e.currentTarget.getBoundingClientRect();
  if (e.clientY < r.top + r.height / 2) return id;
  return ids[ids.indexOf(id) + 1] ?? null;
}

const foldKey = (id: number) => `categories.g${id}`;

export default function CategoriesPage() {
  const groups = sortByOrder(useLiveQuery(() => db.categoryGroups.toArray(), []) ?? []);
  const cats = useLiveQuery(() => db.categories.toArray(), []);
  const targets = useLiveQuery(() => db.budgetTargets.toArray(), []) ?? [];
  const [newGroup, setNewGroup] = useState('');
  const [newCat, setNewCat] = useState<Record<number, string>>({});
  const [drag, setDrag] = useState<Drag | null>(null);
  const [folded, setFolded] = useState<Record<number, boolean>>({});
  const isFolded = (id: number) => folded[id] ?? readCollapsed(foldKey(id)) ?? false;
  const setFold = (id: number, v: boolean) => {
    setFolded({ ...folded, [id]: v });
    writeCollapsed(foldKey(id), v);
  };
  const allGroupIds = groups.map((g) => g.id!);
  const manageable = groups.filter((g) => g.id !== SETUP_GROUP_ID);
  const allFolded = manageable.length > 0 && manageable.every((g) => isFolded(g.id!));
  const setAllFolds = (v: boolean) => {
    const next = { ...folded };
    for (const g of manageable) {
      next[g.id!] = v;
      writeCollapsed(foldKey(g.id!), v);
    }
    setFolded(next);
  };

  const catsOf = (groupId: number) => sortByOrder((cats ?? []).filter((c) => c.groupId === groupId));
  const targetsOf = (categoryId: number) => sortByOrder(targets.filter((t) => t.categoryId === categoryId));

  async function saveGroups(ids: number[]) {
    await db.transaction('rw', db.categoryGroups, async () => {
      for (const [i, id] of ids.entries()) if (groups.find((g) => g.id === id)?.order !== i) await db.categoryGroups.update(id, { order: i });
    });
  }
  async function saveCats(groupId: number, ids: number[]) {
    await db.transaction('rw', db.categories, async () => {
      for (const [i, id] of ids.entries()) {
        const c = (cats ?? []).find((x) => x.id === id);
        if (c && (c.order !== i || c.groupId !== groupId)) await db.categories.update(id, { order: i, groupId });
      }
    });
  }
  async function saveTargets(ids: number[]) {
    await db.transaction('rw', db.budgetTargets, async () => {
      for (const [i, id] of ids.entries()) if (targets.find((t) => t.id === id)?.order !== i) await db.budgetTargets.update(id, { order: i });
    });
  }

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

  const start = (d: Drag, card: HTMLElement | null) => (e: DragEvent) => {
    e.stopPropagation();
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(d.id));
    if (card) e.dataTransfer.setDragImage(card, 0, 0);
    setDrag(d);
  };
  const end = () => setDrag(null);
  const over = (ok: boolean) => (e: DragEvent) => {
    if (!ok) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
  };

  /** Props that make a group card a drop place for dragged groups (before it) and dragged categories (at the end of it). */
  const groupDrop = (gid: number) => {
    const ok = drag?.kind === 'group' ? drag.id !== gid : drag?.kind === 'cat' && gid !== SETUP_GROUP_ID;
    return {
      onDragOver: over(ok),
      onDrop: (e: DragEvent) => {
        if (!ok || !drag) return;
        e.preventDefault();
        e.stopPropagation();
        if (drag.kind === 'group') void saveGroups(moveBefore(allGroupIds, drag.id, beforeId(e, allGroupIds, gid)));
        else void saveCats(gid, moveBefore(catsOf(gid).map((c) => c.id!), drag.id, null));
        setDrag(null);
      },
    };
  };
  const catDrop = (gid: number, cid: number) => {
    const ok = drag?.kind === 'cat' && drag.id !== cid;
    const ids = catsOf(gid).map((c) => c.id!);
    return {
      onDragOver: over(ok),
      onDrop: (e: DragEvent) => {
        if (!ok || !drag) return;
        e.preventDefault();
        e.stopPropagation();
        void saveCats(gid, moveBefore(ids, drag.id, beforeId(e, ids, cid)));
        setDrag(null);
      },
    };
  };
  const targetDrop = (categoryId: number, tid: number) => {
    const ids = targetsOf(categoryId).map((t) => t.id!);
    const ok = drag?.kind === 'target' && drag.id !== tid && ids.includes(drag.id);
    return {
      onDragOver: over(ok),
      onDrop: (e: DragEvent) => {
        if (!ok || !drag) return;
        e.preventDefault();
        e.stopPropagation();
        void saveTargets(moveBefore(ids, drag.id, beforeId(e, ids, tid)));
        setDrag(null);
      },
    };
  };

  const arrows = (up: () => void, down: () => void, what: string) => (
    <span className="reorder">
      <button className="link" aria-label={`Move ${what} up`} title="Move up" onClick={up}>▲</button>
      <button className="link" aria-label={`Move ${what} down`} title="Move down" onClick={down}>▼</button>
    </span>
  );

  const month = monthOf(todayISO());

  return (
    <>
      <PageHeader
        title="Categories"
        description="The names and groups used by the budget and reports. Drag the ⠿ handles (or use ▲▼) to re-order; the Budget page follows this order."
        actions={manageable.length > 0 ? <button onClick={() => setAllFolds(!allFolded)}>{allFolded ? 'Expand all' : 'Collapse all'}</button> : undefined}
      />
      {groups.map((g) => {
        const gid = g.id!;
        const setup = gid === SETUP_GROUP_ID;
        const open = setup || !isFolded(gid);
        const list = catsOf(gid);
        return (
          <div className={`card${drag?.kind === 'group' && drag.id === gid ? ' dragging' : ''}`} key={gid} {...groupDrop(gid)}>
            <div className="row spread">
              <span className="row">
                {!setup && (
                  <span
                    className="drag-handle"
                    draggable
                    title="Drag to move this group"
                    aria-hidden="true"
                    onDragStart={(e) => start({ kind: 'group', id: gid }, e.currentTarget.closest('.card') as HTMLElement)(e)}
                    onDragEnd={end}
                  >⠿</span>
                )}
                {setup ? <strong>{g.name}</strong> : (
                  <button className="collapse-btn" aria-expanded={open} onClick={() => setFold(gid, open)}>
                    <span className="chev" aria-hidden="true">{open ? '▾' : '▸'}</span> <strong>{g.name}</strong>
                    {!open && <span className="muted"> · {list.length} categor{list.length === 1 ? 'y' : 'ies'}</span>}
                  </button>
                )}
              </span>
              <span className="row">
                {!setup && arrows(() => saveGroups(nudge(allGroupIds, gid, -1)), () => saveGroups(nudge(allGroupIds, gid, 1)), `group ${g.name}`)}
                {!setup && <button className="link danger" onClick={() => removeGroup(gid)}>delete group</button>}
              </span>
            </div>
            {setup && (
              <p className="muted">
                <strong>Initial setup</strong> is for entries that bring an account to its real balance (for example, add a transaction filed here to match what your bank shows today).
                It changes the account’s balance but is left out of income, spending, the budget, reports, the forecast, and the flow diagram. It cannot be renamed or deleted.
              </p>
            )}
            {!setup && open && list.map((c) => {
              const ts = c.kind === 'income' ? [] : targetsOf(c.id!);
              const tids = ts.map((t) => t.id!);
              return (
                <div key={c.id} className={drag?.kind === 'cat' && drag.id === c.id ? 'dragging' : ''} {...catDrop(gid, c.id!)}>
                  <div className="row spread">
                    <span className="row grow">
                      <span
                        className="drag-handle"
                        draggable
                        title="Drag to move this category"
                        aria-hidden="true"
                        onDragStart={(e) => start({ kind: 'cat', id: c.id! }, e.currentTarget.closest('.row.spread') as HTMLElement)(e)}
                        onDragEnd={end}
                      >⠿</span>
                      <input
                        defaultValue={c.name}
                        onBlur={(e) => e.target.value.trim() && db.categories.update(c.id!, { name: e.target.value.trim() })}
                      />
                    </span>
                    <span className="row">
                      {arrows(() => saveCats(gid, nudge(list.map((x) => x.id!), c.id!, -1)), () => saveCats(gid, nudge(list.map((x) => x.id!), c.id!, 1)), c.name)}
                      <select
                        value={c.kind ?? 'expense'}
                        onChange={(e) => db.categories.update(c.id!, { kind: e.target.value as 'expense' | 'income' })}
                        title="Income categories feed Ready to Assign instead of being budgeted"
                      >
                        <option value="expense">Expense</option>
                        <option value="income">Income</option>
                      </select>
                      <button className="link danger" onClick={() => removeCategory(c.id!)}>delete</button>
                    </span>
                  </div>
                  {ts.map((t) => (
                    <div
                      key={t.id}
                      className={`row target-line${drag?.kind === 'target' && drag.id === t.id ? ' dragging' : ''}`}
                      {...targetDrop(c.id!, t.id!)}
                    >
                      <span
                        className="drag-handle"
                        draggable
                        title="Drag to re-order this target"
                        aria-hidden="true"
                        onDragStart={(e) => start({ kind: 'target', id: t.id! }, e.currentTarget.closest('.target-line') as HTMLElement)(e)}
                        onDragEnd={end}
                      >⠿</span>
                      <span className="muted">Target: {targetNeed(t, { carry: 0, assigned: 0, available: 0 }, month, formatCents).description}</span>
                      {arrows(() => saveTargets(nudge(tids, t.id!, -1)), () => saveTargets(nudge(tids, t.id!, 1)), 'target')}
                    </div>
                  ))}
                </div>
              );
            })}
            {!setup && open && (
              <div className="row" style={{ marginTop: 6 }}>
                <input
                  placeholder="New category"
                  value={newCat[gid] ?? ''}
                  onChange={(e) => setNewCat({ ...newCat, [gid]: e.target.value })}
                />
                <button
                  onClick={async () => {
                    const name = (newCat[gid] ?? '').trim();
                    if (!name) return;
                    await db.categories.add({ groupId: gid, name, order: list.length });
                    setNewCat({ ...newCat, [gid]: '' });
                  }}
                >Add</button>
              </div>
            )}
          </div>
        );
      })}
      {drag?.kind === 'group' && (
        <div
          className="drop-end"
          onDragOver={over(true)}
          onDrop={(e) => {
            e.preventDefault();
            void saveGroups(moveBefore(allGroupIds, drag.id, null));
            setDrag(null);
          }}
        >Drop here to move to the end</div>
      )}
      <p className="muted">Targets are set on the <Link to="/budget">Budget</Link> page; here you can put them in order.</p>
      <div className="row">
        <input placeholder="New group" value={newGroup} onChange={(e) => setNewGroup(e.target.value)} />
        <button
          onClick={async () => {
            if (!newGroup.trim()) return;
            await db.categoryGroups.add({ name: newGroup.trim(), order: groups.length });
            setNewGroup('');
          }}
        >Add group</button>
      </div>
    </>
  );
}
