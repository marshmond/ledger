import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { dayLabel } from '../../core/time';
import { pathFor } from '../calendar/records';
import { loadLinkedWork } from './data';

/** Tasks and Calendar events that were linked to this asset from their own editors ("Link a record"). Read-only here. */
export default function LinkedWork({ assetId }: { assetId: number }) {
  const work = useLiveQuery(() => loadLinkedWork(assetId), [assetId]);
  const [showDone, setShowDone] = useState(false);
  if (!work) return null;
  const { openTasks, completedTasks, events } = work;
  const none = openTasks.length + completedTasks.length + events.length === 0;
  return (
    <section className="card as-card" aria-labelledby="as-linked-h">
      <h2 id="as-linked-h">Tasks and events linked to this</h2>
      {none ? (
        <p className="muted">Nothing is linked yet. To link a task or an event, open it and use its own <strong>Link a record</strong> box.</p>
      ) : (
        <>
          {openTasks.length > 0 && (
            <ul className="plain as-items">
              {openTasks.map((t) => (
                <li key={t.id}>
                  <a href={`#/tasks?task=${t.id}`}>{t.data.title}</a>
                  <span className="muted small"> {t.data.dueDate ? `Due ${dayLabel(t.data.dueDate, { year: true })}` : 'No due date'}{t.data.repeat ? ' · repeats' : ''}</span>
                </li>
              ))}
            </ul>
          )}
          {events.length > 0 && (
            <ul className="plain as-items">
              {events.map((e) => (
                <li key={e.id}>
                  <a href={`#${pathFor(e)}`}>{e.data.title}</a>
                  <span className="muted small"> Event · {dayLabel(e.data.startDate, { year: true })}</span>
                </li>
              ))}
            </ul>
          )}
          {completedTasks.length > 0 && (
            <p className="small">
              {completedTasks.length} completed {completedTasks.length === 1 ? 'task' : 'tasks'}{' '}
              <button type="button" className="link" aria-expanded={showDone} onClick={() => setShowDone((s) => !s)}>{showDone ? 'Hide' : 'Show'}</button>
            </p>
          )}
          {showDone && (
            <ul className="plain as-items">
              {completedTasks.map((t) => <li key={t.id}><a href={`#/tasks?task=${t.id}`}>{t.data.title}</a><span className="muted small"> Done</span></li>)}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
