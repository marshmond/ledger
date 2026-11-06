import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useSearchParams } from 'react-router-dom';
import { store } from '../../core/store';
import { useToast } from '../../ui/Toast';
import { getProject } from '../projects/data';
import { dayLabel } from '../../core/time';
import { formatCents } from '../../lib/money';
import type { TaskRecord } from '../tasks/model';
import { isOverdue } from '../tasks/views';
import AddMaintenance from './AddMaintenance';
import ServiceForm from './ServiceForm';
import { loadLinkedWork } from './data';
import { buildHistory, duplicateTaskGroups, repeatText, summarize, type HistoryEntry } from './maintenance';
import type { AssetRecord } from './model';
import { SERVICE_KIND_LABEL, type ServiceRecord } from './service';
import { loadServicesFor } from './serviceData';

const day = (d: string) => dayLabel(d, { year: true });

/** A project's name as a link; a project that no longer exists reads as such. */
function ProjectName({ id }: { id: number }) {
  const p = useLiveQuery(async () => (await getProject(id)) ?? null, [id]);
  if (p === undefined) return null;
  return p ? <a href={`#/projects/${p.id}`}>{p.data.name}</a> : <span className="muted">(project no longer exists)</span>;
}
type FormState = null | { kind: 'new' } | { kind: 'edit'; service: ServiceRecord } | { kind: 'done'; task: TaskRecord } | { kind: 'save'; task: TaskRecord } | { kind: 'maintenance' } | { kind: 'project'; projectId: number; projectName: string };

/**
 * Maintenance (open linked tasks, last serviced, next due) and Service history (saved records plus completed tasks not yet saved).
 * Everything shown is read from Tasks and from service records; nothing here keeps its own dates.
 */
export default function AssetWork({ asset, today }: { asset: AssetRecord; today: string }) {
  const data = useLiveQuery(async () => ({ work: await loadLinkedWork(asset.id), services: await loadServicesFor(asset.id) }), [asset.id]);
  const contacts = useLiveQuery(() => store.shared.contacts.query(), []) ?? [];
  const [form, setForm] = useState<FormState>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [params, setParams] = useSearchParams();
  const toast = useToast();
  const focus = params.get('service');
  const fromProject = params.get('fromProject');
  const focused = useRef<string | null>(null);
  const ownRefs = useRef(new Map<string, HTMLLIElement>());

  // "Record in Home & Assets…" on a completed Project lands here. It only OPENS the form with a few facts filled in; nothing is saved until Save.
  useEffect(() => {
    if (!fromProject) return;
    const clear = () => { const n = new URLSearchParams(params); n.delete('fromProject'); setParams(n, { replace: true }); };
    const pid = /^\d+$/.test(fromProject) ? Number(fromProject) : NaN;
    if (Number.isNaN(pid) || asset.data.archived) { if (asset.data.archived) toast('This asset is archived. Restore it first, then record the project work.'); clear(); return; }
    void getProject(pid).then((p) => {
      if (p) setForm({ kind: 'project', projectId: p.id, projectName: p.data.name }); else toast('That project no longer exists.');
      clear();
    });
  }, [fromProject]); // eslint-disable-line react-hooks/exhaustive-deps

  const services = data?.services;
  const focusKey = focus && /^\d+$/.test(focus) ? `s${focus}` : null;
  const focusFound = !!(focusKey && services?.some((s) => `s${s.id}` === focusKey));
  useEffect(() => {
    if (!focusKey || !focusFound || focused.current === focusKey) return;
    focused.current = focusKey;
    setOpen((o) => new Set(o).add(focusKey));
    setTimeout(() => ownRefs.current.get(focusKey)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 50);
  }, [focusKey, focusFound]);

  if (!data) return null;
  const { work, services: svcs } = data;
  const archived = asset.data.archived;
  const sm = summarize(work.openTasks, work.completedTasks, svcs, today);
  const history = buildHistory(svcs, work.completedTasks);
  const taskById = new Map([...work.openTasks, ...work.completedTasks].map((t) => [t.id, t]));
  const who = (id: number | null) => (id === null ? '' : contacts.find((c) => c.id === id)?.name ?? '(contact removed)');
  const toggle = (k: string) => setOpen((o) => { const n = new Set(o); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const dups = duplicateTaskGroups(svcs);
  const dupIds = new Set(dups.flat().map((x) => x.id));
  const none = work.openTasks.length === 0;
  const why = archived ? 'This asset is archived. Restore it first.' : undefined;

  const row = (h: HistoryEntry) => {
    if (h.type === 'task') {
      const t = h.task;
      return (
        <li key={h.key} className="as-hist as-unsaved">
          <div className="as-hist-main">
            <span className="as-hist-date">{day(h.date)}</span>
            <strong>{t.data.title}</strong>
            <span className="as-chip s-past">Completed task — not yet saved to service history</span>
          </div>
          <div className="as-hist-actions">
            <button className="btn" disabled={archived} title={why} onClick={() => setForm({ kind: 'save', task: t })}>Save to history</button>
            <a className="link small" href={`#/tasks?task=${t.id}`}>Open task</a>
          </div>
        </li>
      );
    }
    const s = h.service;
    const d = s.data;
    const isOpen = open.has(h.key);
    const src = d.taskId !== null ? taskById.get(d.taskId) : undefined;
    return (
      <li key={h.key} ref={(el) => { if (el) ownRefs.current.set(h.key, el); else ownRefs.current.delete(h.key); }} className={`as-hist${focusKey === h.key ? ' as-focus' : ''}`} id={`service-${s.id}`}>
        <button type="button" className="as-hist-toggle" aria-expanded={isOpen} onClick={() => toggle(h.key)}>
          <span className="as-hist-date">{d.date ? day(d.date) : 'No date'}</span>
          <strong>{d.title}</strong>
          <span className="as-chip">{SERVICE_KIND_LABEL[d.kind]}</span>
          {dupIds.has(s.id) && <span className="as-chip w-past">Possible duplicate</span>}
          {d.providerContactId !== null && <span className="muted small">{who(d.providerContactId)}</span>}
          {d.costCents !== null && d.txnRefs.length === 0 && <span className="small">{formatCents(d.costCents)}</span>}
          {d.txnRefs.length > 0 && <span className="small">From Finance ({d.txnRefs.length})</span>}
          {d.taskId !== null && <span className="muted small">From task: {d.taskTitleSnapshot || 'untitled'}</span>}
        </button>
        {isOpen && (
          <div className="as-hist-detail">
            <dl className="as-facts">
              <div className="as-fact"><dt>Date</dt><dd>{d.date ? day(d.date) : 'Not set'}</dd></div>
              <div className="as-fact"><dt>Done by</dt><dd>{d.providerContactId === null ? 'Not recorded' : who(d.providerContactId)}</dd></div>
              <div className="as-fact"><dt>Cost</dt><dd>{d.txnRefs.length > 0 ? `From Finance: ${d.txnRefs.length === 1 ? '1 linked transaction' : `${d.txnRefs.length} linked transactions`} (see Spending above)` : d.costCents === null ? 'Not recorded' : `${formatCents(d.costCents)} (typed)`}</dd></div>
              {d.projectId !== null && <div className="as-fact"><dt>Project</dt><dd><ProjectName id={d.projectId} /></dd></div>}
              {d.taskId !== null && (
                <div className="as-fact"><dt>From task</dt><dd>{d.taskTitleSnapshot || 'untitled'}{src ? <> · <a href={`#/tasks?task=${src.id}`}>Open task</a></> : <span className="muted"> · (task no longer in your list)</span>}</dd></div>
              )}
            </dl>
            {d.notes && <p className="as-notes">{d.notes}</p>}
            {d.refs.length > 0 && (
              <ul className="plain as-items">
                {d.refs.map((r, i) => <li key={i}>{r.url ? <a href={r.url} target="_blank" rel="noopener noreferrer">{r.label}</a> : <strong>{r.label}</strong>}{r.note && <span className="muted"> · {r.note}</span>}</li>)}
              </ul>
            )}
            <button className="btn" onClick={() => setForm({ kind: 'edit', service: s })}>Edit</button>
          </div>
        )}
      </li>
    );
  };

  return (
    <>
      <section className="card as-card" aria-labelledby="as-maint-h">
        <div className="as-card-head">
          <h2 id="as-maint-h">Maintenance</h2>
          <button className="btn" disabled={archived} title={why} onClick={() => setForm({ kind: 'maintenance' })}>Add maintenance</button>
        </div>
        <dl className="as-facts as-summary">
          <div className="as-fact"><dt>Last serviced</dt><dd>{sm.lastServiced ? <>{day(sm.lastServiced.date)} <span className="muted small">· {sm.lastServiced.title}{sm.lastServiced.source === 'task' ? ' (completed task, not yet saved)' : ''}</span></> : <span className="muted">Nothing recorded yet</span>}</dd></div>
          <div className="as-fact"><dt>Next due</dt><dd>{sm.nextDue ? <>{day(sm.nextDue.date)}{sm.nextDue.overdue && <span className="as-chip w-past"> Overdue</span>} <span className="muted small">· {sm.nextDue.task.data.title}</span></> : <span className="muted">Nothing planned</span>}</dd></div>
          <div className="as-fact"><dt>Needs attention</dt><dd>{sm.needsAttention ? <a href="#as-history-h">{sm.needsAttention} completed {sm.needsAttention === 1 ? 'task' : 'tasks'} not saved to history</a> : <span className="muted">Nothing</span>}</dd></div>
        </dl>
        {none ? (
          <p className="muted">No maintenance is planned. Use <strong>Add maintenance</strong> to set up a task, or open any task or event and use its <strong>Link a record</strong> box to link it here.</p>
        ) : (
          <ul className="plain as-items">
            {work.openTasks.map((t) => {
              const late = isOverdue(t, today);
              return (
                <li key={t.id} className="as-task">
                  <div>
                    <a href={`#/tasks?task=${t.id}`}>{t.data.title}</a>
                    <div className="small muted">
                      {t.data.dueDate ? `Due ${day(t.data.dueDate)}` : 'No due date'}
                      {late && <span className="as-chip w-past"> Overdue</span>}
                      {t.data.repeat ? ` · ${repeatText(t.data.repeat, t.data.dueDate ?? today)}` : ''}
                    </div>
                  </div>
                  <button className="btn" disabled={archived} title={why} onClick={() => setForm({ kind: 'done', task: t })}>Done, log it</button>
                </li>
              );
            })}
          </ul>
        )}
        {archived && <p className="muted small">This asset is archived, so new maintenance and history cannot be added until you restore it.</p>}
      </section>

      <section className="card as-card" aria-labelledby="as-history-h">
        <div className="as-card-head">
          <h2 id="as-history-h">Service history</h2>
          <button className="btn" disabled={archived} title={why} onClick={() => setForm({ kind: 'new' })}>Log service</button>
        </div>
        {dups.map((g) => (
          <div key={g[0].data.taskId} className="as-warn" role="alert">
            <strong>{g.length} records were saved for the same task, "{g[0].data.taskTitleSnapshot || 'untitled'}".</strong>
            <p className="small">This can happen when two devices both saved it while offline. Nothing was merged or removed. If it was really one piece of work, open the extra one and delete it. If these were separate jobs, leave them.</p>
            <ul className="plain as-items">
              {g.map((x) => (
                <li key={x.id}>
                  {x.data.date ? day(x.data.date) : 'No date'} · <strong>{x.data.title}</strong>
                  {x.data.providerContactId !== null && <> · {who(x.data.providerContactId)}</>}
                  {x.data.costCents !== null && <> · {formatCents(x.data.costCents)}</>}
                  <span className="muted small"> · saved {new Date(x.createdAt).toLocaleString()}</span>{' '}
                  <button type="button" className="link" onClick={() => { setOpen((o) => new Set(o).add('s' + x.id)); setForm({ kind: 'edit', service: x }); }}>Open</button>
                </li>
              ))}
            </ul>
          </div>
        ))}
        {focus && !focusFound && <p className="as-note small" role="status">That service record no longer exists. <button type="button" className="link" onClick={() => { const p = new URLSearchParams(params); p.delete('service'); setParams(p, { replace: true }); }}>Dismiss</button></p>}
        {history.length === 0 ? (
          <p className="muted">Nothing has been recorded yet. Use <strong>Log service</strong> for work that was done, or <strong>Done, log it</strong> on a maintenance task.</p>
        ) : (
          <ul className="plain as-hist-list">{history.map(row)}</ul>
        )}
      </section>

      {form?.kind === 'maintenance' && <AddMaintenance asset={asset} onClose={() => setForm(null)} />}
      {form?.kind === 'new' && <ServiceForm asset={asset} onClose={() => setForm(null)} />}
      {form?.kind === 'edit' && <ServiceForm asset={asset} service={form.service} onClose={() => setForm(null)} />}
      {form?.kind === 'done' && <ServiceForm asset={asset} task={form.task} complete onClose={() => setForm(null)} />}
      {form?.kind === 'project' && <ServiceForm asset={asset} prefill={{ title: form.projectName, kind: 'improvement', projectId: form.projectId, projectName: form.projectName }} onClose={() => setForm(null)} />}
      {form?.kind === 'save' && <ServiceForm asset={asset} task={form.task} onClose={() => setForm(null)} />}
    </>
  );
}
