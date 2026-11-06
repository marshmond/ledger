import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { onTaskRequest, type TaskRequest } from '../../core/taskBridge';
import { loadProjectChoices, selectableProjects, useProjectChoices } from '../../core/projectLink';
import { store } from '../../core/store';
import { todayISO } from '../../lib/money';
import Modal from '../../shell/Modal';
import { ToastProvider, useToast } from '../../ui/Toast';
import { createList, createTask, loadLists, removeTasks } from './data';
import { blankTask } from './model';
import { describeParsed, parseQuickAdd } from './quickAdd';

/**
 * The quick-add box: type a title with optional shorthand ("pay contractor fri !high #renovation @home"). It always shows what it
 * understood before saving, and "Use as plain title" turns the shorthand off.
 */
export function QuickAddBar({ seed, onAdded, autoFocus = false }: { seed?: TaskRequest; onAdded?: (id: number) => void; autoFocus?: boolean }) {
  const toast = useToast();
  const [text, setText] = useState(seed?.title ?? '');
  const [plain, setPlain] = useState(false);
  const [busy, setBusy] = useState(false);
  const lists = useLiveQuery(() => loadLists(), []) ?? [];
  const tags = useLiveQuery(() => store.shared.tags.query(), []) ?? [];
  const today = todayISO();

  const projects = useProjectChoices();
  const parsed = useMemo(() => (plain ? { title: text.trim(), tags: [] as string[] } : parseQuickAdd(text, today, projects)), [text, plain, today, projects]);
  const dueDate = (parsed as { dueDate?: string }).dueDate ?? seed?.dueDate;
  const understood = plain ? [] : describeParsed(parsed, lists.map((l) => l.name), tags.map((t) => t.name));
  if (seed?.dueDate && !(parsed as { dueDate?: string }).dueDate && !plain) understood.unshift(`Due ${seed.dueDate}`);
  const title = parsed.title.trim();

  const add = async () => {
    if (!title || busy) return;
    setBusy(true);
    try {
      const p = parsed as ReturnType<typeof parseQuickAdd>;
      const listId = p.list ? await createList(p.list) : null;
      const tagIds: number[] = [];
      for (const name of p.tags ?? []) {
        const found = tags.find((t) => t.name.toLowerCase() === name.toLowerCase());
        tagIds.push(found?.id ?? (await store.shared.tags.put({ name })));
      }
      if (p.project && !selectableProjects(await loadProjectChoices()).some((x) => x.id === p.project!.id)) {
        toast(`${p.project.name} is no longer open for new tasks. Nothing was added.`);
        return;
      }
      const id = await createTask({
        ...blankTask({
          title, notes: seed?.notes ?? '', priority: p.priority ?? 'medium', dueDate: dueDate ?? null, dueTime: dueDate ? p.dueTime ?? null : null,
          repeat: p.repeat ?? null, tagIds, listId, ...(seed?.from ? { createdFrom: seed.from } : {}),
        }),
        ...(p.project ? { projectId: p.project.id } : {}),
      });
      toast(`Task added: ${title}`, async () => { await removeTasks([id]); });
      setText('');
      onAdded?.(id);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="tk-quick" onSubmit={(e) => { e.preventDefault(); void add(); }}>
      <div className="row grow">
        <input value={text} onChange={(e) => setText(e.target.value)} autoFocus={autoFocus} placeholder="Add a task… try: pay contractor fri !high #renovation @home" aria-label="New task" />
        <button type="submit" className="btn primary" disabled={!title || busy}>Add</button>
      </div>
      {text.trim() && (
        <p className="tk-preview" aria-live="polite">
          <span>Will add: <strong>{title}</strong></span>
          {understood.map((u) => <span key={u} className="tk-pill">{u}</span>)}
          <label className="tk-plain"><input type="checkbox" checked={plain} onChange={(e) => setPlain(e.target.checked)} /> Use as plain title</label>
        </p>
      )}
    </form>
  );
}

/** Mounted once for the whole app: opens when any module calls `createTaskFrom` / `requestTask`. */
export function TaskCreator() {
  const [req, setReq] = useState<TaskRequest | null>(null);
  useEffect(() => onTaskRequest(setReq), []);
  // The toast provider stays mounted so "Task added" (with Undo) outlives the closing dialog.
  return (
    <ToastProvider>
      {req && <Modal title="New task" onClose={() => setReq(null)}>
        {req.from && <p className="muted small">About: <strong>{req.from.label}</strong>. The task will link back to it.</p>}
        <QuickAddBar key={JSON.stringify(req)} seed={req} autoFocus onAdded={() => setReq(null)} />
        <p className="muted small">Shorthand: a date word (fri, tomorrow, nov 12), <code>!high</code>, <code>#tag</code>, <code>@list</code>, <code>+project</code>, <code>every week</code>.</p>
      </Modal>}
    </ToastProvider>
  );
}
