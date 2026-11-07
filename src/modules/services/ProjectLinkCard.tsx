import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { recordSource } from '../../core/registry';
import { useToast } from '../../ui/Toast';
import { linkProject, projectLinksOf, unlinkProject, type ServiceEnd } from './projectLinks';
import { runUndo } from './undo';

/**
 * Projects an arrangement or a visit explicitly involves. Information only: a link changes neither record and no money anywhere (Project commitments,
 * budget and paid-to-date, Finance attribution and Services payments are all untouched). Never guessed from a vendor or an amount. Names and the
 * picker come from Projects through the shared record registry.
 */
export default function ProjectLinks({ end }: { end: ServiceEnd }) {
  const toast = useToast();
  const src = recordSource('projects');
  const [filter, setFilter] = useState('');
  const [pick, setPick] = useState('');
  const [error, setError] = useState('');
  const data = useLiveQuery(async () => {
    if (!src) return { rows: [], choices: [] };
    const links = await projectLinksOf(end);
    const rows = await Promise.all(links.map(async (l) => ({ ...l, info: await src.describe(l.projectId) })));
    const choices = (await src.search(filter)).filter((c) => !links.some((l) => String(l.projectId) === String(c.id)));
    return { rows: rows.sort((a, b) => (a.info?.label ?? '~').localeCompare(b.info?.label ?? '~')), choices };
  }, [end.kind, end.id, filter]);
  if (!src || !data) return null;
  const what = end.kind === 'arrangement' ? 'arrangement' : 'visit';

  async function add() {
    if (!pick) return;
    try {
      const r = await linkProject(end, Number(pick));
      setPick(''); setError('');
      toast(r.created ? 'Linked. Neither record was changed.' : 'Already linked.', r.created ? () => runUndo(r.undo, toast).then(() => undefined) : undefined);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not link.'); }
  }
  async function remove(projectId: number, label: string) {
    try {
      const r = await unlinkProject(end, projectId);
      toast(`${label} is no longer linked. Both records are kept.`, () => runUndo(r.undo, toast).then(() => undefined));
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not unlink.'); }
  }

  return (
    <section className="card sv-card" id="sv-projects" aria-labelledby="sv-prj-h">
      <h2 id="sv-prj-h">Related projects</h2>
      <p className="muted small">A project this {what} is part of, for your reference. A link only: it changes nothing in the project, its budget or any payment, and it is never added by guessing from a vendor.</p>
      {data.rows.length === 0 ? <p className="muted">No project is linked.</p> : (
        <ul className="plain sv-items">
          {data.rows.map((r) => (
            <li key={r.linkId} className="sv-linkrow">
              {r.info ? <a href={`#${r.info.path}`}><strong>{r.info.label}</strong></a> : <strong className="muted">(project no longer exists)</strong>}
              <button type="button" className="link" onClick={() => void remove(r.projectId, r.info?.label ?? 'That project')} aria-label={`Unlink ${r.info?.label ?? 'this project'} from this ${what}`}>Unlink</button>
            </li>
          ))}
        </ul>
      )}
      <div className="sv-pickrow">
        <input type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Find a project" aria-label="Find a project to link" />
        <select value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Pick a project to link">
          <option value="">Link a project…</option>
          {data.choices.map((c) => <option key={String(c.id)} value={String(c.id)}>{c.label}</option>)}
        </select>
        <button type="button" className="btn" disabled={!pick} onClick={() => void add()}>Link</button>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}
